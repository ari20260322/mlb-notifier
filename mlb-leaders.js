/**
 * MLB ア・リーグ＆ナ・リーグ タイトルランキング トップ3 取得スクリプト
 */
const REPO = process.env.GITHUB_REPOSITORY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GH_BOT_TOKEN;
const MENTION_USER = REPO ? REPO.split('/')[0] : '';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 取得するスタッツの定義
const CATEGORIES = {
  hitting: [
    { name: '打率', id: 'battingAverage' },
    { name: '本塁打', id: 'homeRuns' },
    { name: '打点', id: 'runsBattedIn' },
    { name: 'OPS', id: 'ops' }
  ],
  pitching: [
    { name: '防御率', id: 'earnedRunAverage' },
    { name: '勝利', id: 'wins' },
    { name: '奪三振', id: 'strikeOuts' },
    { name: 'WHIP', id: 'whip' }
  ]
};

// リーグの定義（103: ア・リーグ, 104: ナ・リーグ）
const LEAGUES = [
  { name: '🔴 ア・リーグ (AL)', id: 103 },
  { name: '🔵 ナ・リーグ (NL)', id: 104 }
];

async function main() {
  let message = `⚾️MLB 現在のタイトルランキング トップ3⚾️\n`;
  
  for (let i = 0; i < LEAGUES.length; i++) {
    const league = LEAGUES[i];
    
    // 2つ目のリーグ（ナ・リーグ）の直前だけ空行を入れる
    if (i > 0) {
      message += `\n`;
    }
    
    // ★ここが修正ポイント：先頭の余計な \n を削った
    message += `### ${league.name}\n`;

    // 打者部門の表作成
    message += `**【打者部門】**\n`;
    message += `| 項目 | 1位 | 2位 | 3位 |\n`;
    message += `| :--- | :--- | :--- | :--- |\n`;
    for (const stat of CATEGORIES.hitting) {
      const top3 = await fetchTop3(league.id, 'hitting', stat.id);
      message += `| **${stat.name}** | ${top3.join(' | ')} |\n`;
      await sleep(200); // APIへの負荷軽減
    }

    // 投手部門の表作成
    message += `\n**【投手部門】**\n`;
    message += `| 項目 | 1位 | 2位 | 3位 |\n`;
    message += `| :--- | :--- | :--- | :--- |\n`;
    for (const stat of CATEGORIES.pitching) {
      const top3 = await fetchTop3(league.id, 'pitching', stat.id);
      message += `| **${stat.name}** | ${top3.join(' | ')} |\n`;
      await sleep(200); // APIへの負荷軽減
    }
  }

  await sendToGitHubIssue(message);
}

// MLB APIから指定部門のトップ3を取得する関数
async function fetchTop3(leagueId, statGroup, leaderCategory) {
  const url = `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=${leaderCategory}&statGroup=${statGroup}&leagueId=${leagueId}&limit=3`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return ['取得失敗', '-', '-'];
    
    const data = await res.json();
    if (!data.leagueLeaders || data.leagueLeaders.length === 0) return ['データなし', '-', '-'];
    
    const leaders = data.leagueLeaders[0].leaders;
    // 上位3名分をループ。データが足りない場合は "-" で埋める
    const result = [];
    for (let i = 0; i < 3; i++) {
      if (leaders[i]) {
        // 例: "Ohtani (.310)" のようなフォーマットにする
        result.push(`${leaders[i].person.fullName} (${leaders[i].value})`);
      } else {
        result.push('-');
      }
    }
    return result;
  } catch (err) {
    console.error(`API Fetch Error (${leaderCategory}):`, err.message);
    return ['エラー', '-', '-'];
  }
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

  for (let i = 0; i < 5; i++) {
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
        return;
      }
      await sleep(1000);
    } catch (e) {
      await sleep(1000);
    }
  }
  throw new Error("GitHub Issueへの書き込みに失敗しました。");
}

main().catch(err => {
  console.error("実行エラー:", err);
  process.exit(1);
});
