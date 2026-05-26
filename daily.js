/**
 * ドジャースの当日の試合有無をGitHub Issueに通知するスクリプト
 */
const REPO = process.env.GITHUB_REPOSITORY; // "owner/repo"
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GH_BOT_TOKEN;
const MENTION_USER = REPO ? REPO.split('/')[0] : ''; // リポジトリのオーナー（あなた）にメンション

// MLBチーム名の日本語辞書
const MLB_TEAM_NAMES_JA = {
  "Los Angeles Dodgers": "ドジャース",
  "San Diego Padres": "パドレス",
  "Chicago Cubs": "カブス",
  "Boston Red Sox": "レッドソックス",
  "New York Yankees": "ヤンキース",
  "Atlanta Braves": "ブレーブス",
  "Houston Astros": "アストロズ",
  "Philadelphia Phillies": "フィリーズ",
  "Texas Rangers": "レンジャース"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  // 実行時の日本時間から「マイナス1日」した日付を算出する
  // Node.js環境では、まずUTCで現在時刻を取得し、そこからJST(UTC+9)を計算する
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jstNow.setDate(jstNow.getDate() - 1);
  
  const mm = String(jstNow.getMonth() + 1).padStart(2, '0');
  const dd = String(jstNow.getDate()).padStart(2, '0');
  const yyyy = jstNow.getFullYear();
  
  // APIへ渡す形式 (MM/dd/yyyy) と、通知表示用の形式 (yyyy/MM/dd)
  const usDateForApi = `${mm}/${dd}/${yyyy}`;
  const usDateDisplay = `${yyyy}/${mm}/${dd}`;

  // ドジャースのチームIDは 119
  const dodgersTeamId = 119;
  const apiUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${dodgersTeamId}&date=${usDateForApi}`;
  
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`MLB APIの取得に失敗しました。ステータス: ${response.status}`);
  }
  
  const data = await response.json();
  let message = `⚾️ 米国時間${usDateDisplay}のドジャース試合情報 ⚾️\n`;
  
  // 試合の有無を判定
  if (!data.dates || data.dates.length === 0 || !data.dates[0].games || data.dates[0].games.length === 0) {
    message += "本日の試合はありません";
  } else {
    const game = data.dates[0].games[0];
    const awayTeamEn = game.teams.away.team.name;
    const homeTeamEn = game.teams.home.team.name;
    
    // 辞書を参照して日本語に変換
    const awayTeamJa = MLB_TEAM_NAMES_JA[awayTeamEn] || awayTeamEn;
    const homeTeamJa = MLB_TEAM_NAMES_JA[homeTeamEn] || homeTeamEn;

    message += `対戦カード: ${awayTeamJa} vs ${homeTeamJa}`;

    // 開始時刻(UTC)を取得し、日本時間(時刻のみ)に変換して追記
    if (game.gameDate) {
      const gameDateObj = new Date(game.gameDate);
      const jstTimeStr = new Intl.DateTimeFormat('ja-JP', { 
        timeZone: 'Asia/Tokyo', 
        hour: '2-digit', 
        minute: '2-digit' 
      }).format(gameDateObj);
      message += `\n開始時間: ${jstTimeStr} (日本時間)`;
    }
  }

  // GitHub Issueに送信する
  await sendToGitHubIssue(message);
}

// GitHub Issueへの通知関数
async function sendToGitHubIssue(message) {
  if (!REPO || !ISSUE_NUMBER || !GH_TOKEN) {
    console.error("GitHubの環境変数(シークレット)が設定されていないため、通知をスキップします。");
    return;
  }

  // あなた宛てにメンションを飛ばす
  const finalMessage = `@${MENTION_USER}\n${message}`;
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
        console.log("GitHub Issueへの書き込み成功:", finalMessage);
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
});s
