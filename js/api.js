// js/api.js - Claude API (Cloudflare Workers経由) リクエスト
'use strict';

const API = (() => {

  // ▼ Cloudflare Workers をデプロイしたら、下の '' にURLを貼り付ける
  // 例: 'https://chai-api.yourname.workers.dev'
  const HARDCODED_URL = '';

  const WORKER_URL = HARDCODED_URL || localStorage.getItem('chai_worker_url') || '';

  function hasWorker() {
    return WORKER_URL && WORKER_URL.startsWith('http');
  }

  /**
   * NPC会話をClaude APIで動的生成
   * @param {string} npcId - NPC ID
   * @param {string} personality - プレイヤー性格
   * @param {string} spice - 渡したスパイス
   * @param {Array}  history - 会話履歴
   * @param {Object} gameState - ゲーム状態
   */
  async function generateNPCResponse(npcId, personality, spice, history, gameState) {
    const npcData = Story.npcs[npcId];
    if (!npcData) return null;

    if (!hasWorker()) {
      return null; // フォールバックへ
    }

    const systemPrompt = npcData.systemPrompt + `

プレイヤー（チャイ）の性格: ${personality === 'A' ? 'やんちゃ（直感行動型）' : personality === 'B' ? 'やさしい（他者配慮型）' : 'しずか（内省観察型）'}
${spice ? `チャイに使われたスパイス: ${Story.items[spice]?.name || spice}（効果: ${Story.items[spice]?.desc || ''}）` : ''}
これまでのやりとり: ${history.length}回`;

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
    ];

    if (messages.length === 0) {
      messages.push({
        role: 'user',
        content: `チャイ（${personality === 'A' ? 'やんちゃ' : personality === 'B' ? 'やさしい' : 'しずか'}な子供）があなたに話しかけています。自然に返答してください。`,
      });
    }

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemPrompt, messages }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.content?.[0]?.text || null;
    } catch (e) {
      console.warn('API error:', e);
      return null;
    }
  }

  /**
   * エンディングをClaude APIで動的生成
   */
  async function generateEnding(personality, gameState) {
    if (!hasWorker()) return null;

    const fieldChoicesSummary = Object.entries(gameState.fieldChoices || {})
      .map(([k, v]) => `${k}: ${v}`).join(', ');

    const npcSummary = Object.entries(gameState.npcProgress || {})
      .map(([k, v]) => `${k}との関わり: ${v}回`).join(', ');

    const systemPrompt = Story.ending.systemPrompt;

    const viveka = gameState.status?.viveka || 0;
    const vivekaLevel = viveka >= 70 ? '高い（深い気づきがある）' : viveka >= 30 ? '中程度（旅の途中にある）' : '低い（まだ始まったばかり）';

    const userMessage = `チャイの性格: ${personality === 'A' ? 'やんちゃ' : personality === 'B' ? 'やさしい' : 'しずか'}
ヴィヴェーカ（内なる洞察）レベル: ${viveka}/100（${vivekaLevel}）

旅の選択傾向:
${fieldChoicesSummary || '（記録なし）'}

NPCとの関わり:
${npcSummary}

チャイが使ったスパイス: ${JSON.stringify(gameState.chaiGiven || {})}

ガンジス川のほとりに到着したチャイの様子を書いてください。ヴィヴェーカレベルに応じて、チャイの内面の深さや静けさを表現に反映させてください。`;

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.content?.[0]?.text || null;
    } catch (e) {
      console.warn('Ending API error:', e);
      return null;
    }
  }

  return { generateNPCResponse, generateEnding, hasWorker };
})();
