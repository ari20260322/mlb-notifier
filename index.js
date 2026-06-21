/**
 * MLB打席・投球速報をGitHub Issueに通知するスクリプト
 */
const fs = require('fs');
const path = require('path');

// GitHub連携用の設定
const REPO = process.env.GITHUB_REPOSITORY; // "owner/repo"
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GH_BOT_TOKEN;
const MENTION_USER = REPO ? REPO.split('/')[0] : ''; // リポジトリのオーナー（あなた）にメンション

const PLAYERS_FILE = path.join(__dirname, 'players.json');
const STATE_FILE = path.join(__dirname, 'state.json');

// 野球用語の日本語変換辞書
const EVENT_DICTIONARY = {
  "Home Run": "⚾️🔥ホームラン🔥⚾️",
  "Single": "ヒット",
  "Double": "ツーベースヒット",
  "Triple": "スリーベースヒット",
  "Strikeout": "三振",
  "Walk": "四球",
  "Intent Walk": "申告敬遠",
  "Hit By Pitch": "死球",
  "Flyout": "フライアウト",
  "Groundout": "ゴロアウト",
  "Lineout": "ライナー",
  "Pop Out": "ポップフライ",
  "Double Play": "ダブルプレー",
  "Grounded Into DP": "併殺打",
  "Field Error": "エラーでの出塁",
  "Sac Fly": "犠牲フライ",
  "Los Angeles Dodgers": "ドジャース",
  "San Diego Padres": "パドレス",
  "Chicago Cubs": "カブス",
  "Boston Red Sox": "レッドソックス",
  "New York Yankees": "ヤンキース"
};

const translate = (text) => EVENT_DICTIONARY[text] || text;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  let state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state.players) state.players = {};

  const activePlayers = players.filter(p => p.isNotify === 1 && p.playerId && p.teamId);
  if (activePlayers.length === 0) return;

  // 日本時間から1日引いた日付を取得（YYYY-MM-DD）
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(yesterday);
  state.lastDate = dateStr;

  const teamIds = [...new Set(activePlayers.map(p => p.teamId))];
  let stateModified = false;

  for (const teamId of teamIds) {
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&date=${dateStr}`;
    const scheduleRes = await fetch(scheduleUrl);
    if (!scheduleRes.ok) continue;
   
    const scheduleData = await scheduleRes.json();
    const teamPlayers = activePlayers.filter(p => p.teamId === teamId);
   
    if (!scheduleData.dates || scheduleData.dates.length === 0 || scheduleData.dates[0].games.length === 0) {
      teamPlayers.forEach(player => {
        const pid = player.playerId;
        if (!state.players[pid]) state.players[pid] = { lastRecord1: "", lastRecord2: "", lastRecordP1: "", lastRecordP2: "" };
        
        ['lastRecord1', 'lastRecord2', 'lastRecordP1', 'lastRecordP2'].forEach(key => {
          if (state.players[pid][key] !== "試合なし") {
            state.players[pid][key] = "試合なし";
            stateModified = true;
          }
        });
      });
      continue;
    }
   
    const games = scheduleData.dates[0].games;

    if (games.length === 1) {
      teamPlayers.forEach(player => {
        const pid = player.playerId;
        if (!state.players[pid]) state.players[pid] = { lastRecord1: "", lastRecord2: "", lastRecordP1: "", lastRecordP2: "" };
        
        ['lastRecord2', 'lastRecordP2'].forEach(key => {
          if (state.players[pid][key] !== "試合なし") {
            state.players[pid][key] = "試合なし";
            stateModified = true;
          }
        });
      });
    }

    for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
      if (gameIndex > 1) break;

      const gamePk = games[gameIndex].gamePk;
      const gameUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
      const gameRes = await fetch(gameUrl);
      if (!gameRes.ok) continue;
     
      const gameData = await gameRes.json();
      const allPlays = gameData.liveData.plays.allPlays;

      const awayTeamJa = translate(gameData.gameData.teams.away.name);
      const homeTeamJa = translate(gameData.gameData.teams.home.name);
      const awayScore = gameData.liveData.linescore.teams.away.runs || 0;
      const homeScore = gameData.liveData.linescore.teams.home.runs || 0;

      for (const player of teamPlayers) {
        const pid = player.playerId;
        if (!state.players[pid]) state.players[pid] = { lastRecord1: "", lastRecord2: "", lastRecordP1: "", lastRecordP2: "" };

        // ★修正ポイント：バッター・ピッチャー共通で使う成績データを一番最初に取得する！
        const boxscore = gameData.liveData.boxscore;
        const playerKey = 'ID' + player.playerId;
        const pData = boxscore.teams.away.players[playerKey] || boxscore.teams.home.players[playerKey];

        // ==========================================
        // バッターの処理
        // ==========================================
        const targetPlays = allPlays.filter(play => play.matchup.batter.id === player.playerId && play.about.isComplete === true);
        const currentAtBatCount = targetPlays.length;
        const targetLastRecord = (gameIndex === 0) ? state.players[pid].lastRecord1 : state.players[pid].lastRecord2;

        let savedGamePk = '';
        let savedCount = 0;
       
        if (targetLastRecord && targetLastRecord !== "試合なし") {
          const parts = String(targetLastRecord).split('_');
          savedGamePk = parts[0];
          savedCount = parseInt(parts[1], 10) || 0;
        }
       
        if (savedGamePk !== String(gamePk)) savedCount = 0;
       
        if (currentAtBatCount > savedCount) {
          let messageText = `⚾ ${player.name} 打席速報 ⚾\n`;
          let avg = '-'; let hr = '-'; let rbi = '-'
          if (pData && pData.seasonStats && pData.seasonStats.batting) {
            avg = pData.seasonStats.batting.avg || '.000';
            hr = pData.seasonStats.batting.homeRuns || '0';
            rbi = pData.seasonStats.batting.rbi || '0';
          }
          for (let i = savedCount; i < currentAtBatCount; i++) {
            const play = targetPlays[i];
            const inning = `${play.about.inning}回 ${play.about.halfInning === 'top' ? '表' : '裏'}`;
            const eventJa = translate(play.result.event);
            messageText += `第${i + 1}打席 (${inning})：${eventJa}\n`;
            messageText += `(打率: ${avg}  本塁打: ${hr}  打点: ${rbi})\n`;
          }
          messageText += `\n【試合経過】\n${awayTeamJa} ${awayScore} - ${homeScore} ${homeTeamJa}\n`;
          await sendToGitHubIssue(messageText);
        }
       
        const newRecord = `${gamePk}_${currentAtBatCount}`;
        if (String(targetLastRecord) !== newRecord) {
          if (gameIndex === 0) state.players[pid].lastRecord1 = newRecord;
          if (gameIndex === 1) state.players[pid].lastRecord2 = newRecord;
          stateModified = true;
        }

        // ==========================================
        // ピッチャーの処理
        // ==========================================
        const targetLastRecordP = (gameIndex === 0) ? state.players[pid].lastRecordP1 : state.players[pid].lastRecordP2;
        let savedGamePkP = '';
        let savedInnings = 0;
        let savedOuts = 0;

        if (targetLastRecordP && targetLastRecordP !== "試合なし") {
          const partsP = String(targetLastRecordP).split('_');
          savedGamePkP = partsP[0];
          savedInnings = parseInt(partsP[1], 10) || 0;
          savedOuts = parseInt(partsP[2], 10) || 0;
        }

        if (savedGamePkP !== String(gamePk)) {
          savedInnings = 0;
          savedOuts = 0;
        }

        const savedTotalOuts = savedInnings * 3 + savedOuts;
        let currentInnings = 0; let currentOuts = 0; let runs = 0;
        let strikeOuts = 0; let numberOfPitches = 0; let hits = 0; let walksAndHbp = 0;

        if (pData && pData.stats && pData.stats.pitching) {
          const pStats = pData.stats.pitching;
          if (pStats.inningsPitched !== undefined) {
            const ipParts = String(pStats.inningsPitched).split('.');
            currentInnings = parseInt(ipParts[0], 10) || 0;
            currentOuts = parseInt(ipParts[1], 10) || 0;
          }
          runs = pStats.runs || 0;
          strikeOuts = pStats.strikeOuts || 0;
          numberOfPitches = pStats.numberOfPitches || 0;
          hits = pStats.hits || 0;
          walksAndHbp = (pStats.baseOnBalls || 0) + (pStats.hitByPitch || 0);
        }

        const currentTotalOuts = currentInnings * 3 + currentOuts;

        if (currentTotalOuts > savedTotalOuts) {
          let messageTextP = `⚾ ${player.name} 投球速報 ⚾\n`;
          let ipDisplay = currentOuts > 0 ? `${currentInnings} ${currentOuts}/3` : `${currentInnings}`;
          messageTextP += `${ipDisplay}イニング ${numberOfPitches}球 ${strikeOuts}奪三振\n`;
          messageTextP += `${runs}失点 ${hits}被安打 ${walksAndHbp}四死球\n`;
          messageTextP += `\n【試合経過】\n${awayTeamJa} ${awayScore} - ${homeScore} ${homeTeamJa}\n`;
          
          await sendToGitHubIssue(messageTextP);
        }

        const newRecordP = `${gamePk}_${currentInnings}_${currentOuts}`;
        if (String(targetLastRecordP) !== newRecordP) {
          if (gameIndex === 0) state.players[pid].lastRecordP1 = newRecordP;
          if (gameIndex === 1) state.players[pid].lastRecordP2 = newRecordP;
          stateModified = true;
        }
      }
    }
  }

  // 履歴（state.json）を上書き保存
  if (stateModified) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    console.log("State updated.");
  }
}

// GitHub Issueへの通知関数
async function sendToGitHubIssue(message) {
  if (!REPO || !ISSUE_NUMBER || !GH_TOKEN) {
    console.error("GitHub設定が足りないため通知をスキップします。");
    return;
  }

  // あなた宛てにメンションを飛ばす
  const finalMessage = `@${MENTION_USER}\n${message}`;
  const url = `https://api.github.com/repos/${REPO}/issues/${ISSUE_NUMBER}/comments`;

  const MAX_RETRIES = 10;
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
        await sleep(500);
        success = true;
        break;
      } else if (response.status === 403 || response.status === 429) {
        lastErrorDetail = "GitHub API Rate Limit";
        await sleep(2000);
      } else {
        lastErrorDetail = `HTTP ${response.status}`;
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
