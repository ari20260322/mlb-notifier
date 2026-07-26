/**
 * GASから渡されたURLをスクレイピングし、WARトップ10をGitHub Issueに通知する
 */
const cheerio = require('cheerio'); // HTML解析ライブラリ

const REPO = process.env.GITHUB_REPOSITORY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GH_BOT_TOKEN;
const MENTION_USER = REPO ? REPO.split('/')[0] : '';
const TARGET_URL = process.env.TARGET_URL;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (!TARGET_URL) {
    throw new Error('URLが指定されていません。');
  }

  // 1. URLからHTMLを取得
  const response = await fetch(TARGET_URL);
  if (!response.ok) {
    throw new Error(`サイトの取得に失敗しました。ステータス: ${response.status}`);
  }
  const html = await response.text();

  // 2. CheerioでHTMLをロード（これでjQueryのようにHTMLを簡単に扱える）
  const $ = cheerio.load(html);

  // 3. 「ナ・リーグ（野手＋投手）」の見出し(h3)を探し、その直後のテーブル(table)を取得
  let targetTable = null;
  $('h3').each((i, el) => {
    const headingText = $(el).text();
    if (headingText.includes('ナ・リーグ（野手＋投手）')) {
      targetTable = $(el).nextAll('table').first();
      return false; // ループを抜ける
    }
  });

  if (!targetTable || targetTable.length === 0) {
    throw new Error('HTML内に「ナ・リーグ（野手＋投手）」のテーブルが見つかりませんでした。');
  }

  // 4. トップ10のデータを抽出
  const players = [];
  targetTable.find('tr').each((i, tr) => {
    if (players.length >= 10) return; // 10人取れたら終了

    const tds = $(tr).find('td');
    if (tds.length >= 6) {
      players.push({
        rank: $(tds[0]).text().trim(),
        name: $(tds[1]).text().trim(),
        fWar: $(tds[3]).text().trim(),
        rWar: $(tds[4]).text().trim(),
        avgWar: $(tds[5]).text().trim() // ★平均WARを追加
      });
    }
  });

  if (players.length === 0) {
    throw new Error('選手データが抽出できませんでした。HTMLの構造が変わった可能性があります。');
  }

  // 5. GitHub Issue用のMarkdownテーブルを作成（文字幅計算なんて不要！）
  let message = "⚾ナ・リーグ WAR トップ10⚾\n";
  message += "| 順位 | Name | fWAR | rWAR | 平均WAR |\n";
  message += "| :--- | :--- | :--- | :--- | :--- |\n"; // 左寄せ指定
  
  players.forEach(p => {
    message += `| ${p.rank} | ${p.name} | ${p.fWar} | ${p.rWar} | ${p.avgWar} |\n`;
  });

  // 6. GitHub Issueへ送信
  await sendToGitHubIssue(message);
}

// GitHub Issueへの通知関数
async function sendToGitHubIssue(message) {
  if (!REPO || !ISSUE_NUMBER || !GH_TOKEN) {
    console.error("GitHub設定が足りないため通知をスキップします。");
    return;
  }

  // ★ここだけ変更！メンションを末尾にしたぞ！
  const finalMessage = `${message}\n@${MENTION_USER}`;
  const url = `https://api.github.com/repos/${REPO}/issues/${ISSUE_NUMBER}/comments`;

  const MAX_RETRIES = 5;
  let success = false;
  let lastErrorDetail = "";

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: finalMessage })
      });

      if (response.ok) {
        console.log("GitHub Issueへの書き込み成功");
        success = true;
        break;
      } else if (response.status === 403 || response.status === 429) {
        lastErrorDetail = "GitHub API Rate Limit";
        await sleep(2000);
      } else {
        lastErrorDetail = `HTTP ${response.status}: ${await response.text()}`;
        await sleep(1000);
      }
    } catch (e) {
      lastErrorDetail = e.message;
      await sleep(1000);
    }
  }

  if (!success) {
    throw new Error(`GitHub Issueへの書き込みに失敗しました。(原因: ${lastErrorDetail})`);
  }
}

main().catch(err => {
  console.error("実行エラー:", err);
  process.exit(1);
});
