// js/map.js - マップデータ・タイル描画
'use strict';

const MapSystem = (() => {

  // タイル定数
  const T = {
    WATER: 0, SAND: 1, GRASS: 2, PATH: 3,
    WALL: 4, STONE: 5, ROCK: 6, FLOOR: 7,
    STEPS: 8, MOUNTAIN: 9, TREE: 10, DEEP_WATER: 11,
  };

  // タイル色パレット
  const PALETTE = {
    [T.WATER]:      { base:'#3B7BC4', dark:'#2D6AB0', light:'#5B9BE0' },
    [T.SAND]:       { base:'#D4A84B', dark:'#B89038', light:'#E8C06A' },
    [T.GRASS]:      { base:'#4A7C59', dark:'#3A6449', light:'#5A9C6A' },
    [T.PATH]:       { base:'#B8975A', dark:'#9A7A44', light:'#D0AE72' },
    [T.WALL]:       { base:'#7A6050', dark:'#5C4A3A', light:'#9A8070' },
    [T.STONE]:      { base:'#8A7A6A', dark:'#706050', light:'#A08A7A' },
    [T.ROCK]:       { base:'#706060', dark:'#504040', light:'#908080' },
    [T.FLOOR]:      { base:'#C0A880', dark:'#A08860', light:'#E0C8A0' },
    [T.STEPS]:      { base:'#D0C0A0', dark:'#B0A080', light:'#F0E0C0' },
    [T.MOUNTAIN]:   { base:'#8A8070', dark:'#6A6050', light:'#AAA090' },
    [T.TREE]:       { base:'#2D6030', dark:'#1E4020', light:'#3D8040' },
    [T.DEEP_WATER]: { base:'#2050A0', dark:'#143080', light:'#3070C0' },
  };

  // タイルが通行可能か
  const WALKABLE = {
    [T.WATER]: false, [T.SAND]: true,  [T.GRASS]: true,  [T.PATH]: true,
    [T.WALL]: false,  [T.STONE]: true, [T.ROCK]: false,  [T.FLOOR]: true,
    [T.STEPS]: true,  [T.MOUNTAIN]: false, [T.TREE]: false, [T.DEEP_WATER]: false,
  };

  const S = 32; // tile size px (will be drawn at this size)

  // ========= マップデータ 20列×15行 =========
  const maps = {

    // ===== ゴーカルナ =====
    gokarna: {
      bgColor: '#1a3a5c',
      ambience: '波の音がする。',
      tiles: [
        [11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 4, 7, 7, 4, 2, 2, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2],
        [2, 2, 2, 2, 4, 7, 7, 4, 2, 2, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2],
        [2, 2, 2, 2, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2,10, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,10, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      ],
      npcs: [
        { id: 'amma', x: 5, y: 7, name: 'アンマー', color: '#D4884B' },
      ],
      items: [
        { id: 'milk',     x: 14, y: 7,  name: 'ミルク',     icon: '🥛' },
        { id: 'cardamom', x: 10, y: 11, name: 'カルダモン',  icon: '🌿' },
      ],
      exits: [
        { x: 19, y: 10, y2: 11, nextMap: 'hampi', label: 'ハンピへ→', eventKey: 'gokarna-hampi' },
      ],
      playerStart: { x: 10, y: 13 },
    },

    // ===== ハンピ =====
    hampi: {
      bgColor: '#3a2a1a',
      ambience: '風が岩を撫でる音がする。',
      tiles: [
        [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
        [9, 9, 9, 6, 6, 9, 9, 9, 9, 9, 9, 9, 9, 9, 6, 6, 9, 9, 9, 9],
        [9, 6, 6, 5, 5, 6, 9, 9, 9, 9, 9, 9, 9, 6, 5, 5, 6, 9, 9, 9],
        [9, 6, 5, 5, 5, 5, 6, 9, 9, 9, 9, 9, 6, 5, 5, 5, 5, 6, 9, 9],
        [9, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 9, 9, 9],
        [9, 9, 6, 5, 5, 5, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 9, 9, 9, 9],
        [9, 9, 9, 5, 5, 5, 4, 7, 7, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9],
        [9, 9, 9, 5, 5, 5, 4, 7, 7, 4, 5, 5, 3, 3, 3, 3, 3, 3, 3, 9],
        [9, 9, 9, 5, 5, 5, 4, 4, 4, 4, 5, 5, 3, 3, 3, 3, 3, 3, 3, 9],
        [9, 9, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9],
        [9, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 9],
        [9, 9, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 9],
        [9, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9],
        [9, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9],
        [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
      ],
      npcs: [
        { id: 'sandeep', x: 7, y: 7, name: 'サンディープ', color: '#8B6040' },
      ],
      items: [
        { id: 'milk',    x: 15, y: 7, name: 'ミルク',    icon: '🥛' },
        { id: 'ginger',  x: 4,  y: 11, name: 'ショウガ', icon: '🫚' },
        { id: 'cinnamon',x: 15, y: 11, name: 'シナモン', icon: '🟤' },
      ],
      exits: [
        { x: 19, y: 6, y2: 8, nextMap: 'varanasi', label: 'バラナシへ→', eventKey: 'hampi-varanasi' },
      ],
      playerStart: { x: 5, y: 10 },
    },

    // ===== バラナシ =====
    varanasi: {
      bgColor: '#1a2a3a',
      ambience: 'ガンジス川の音がする。',
      tiles: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
        [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 4, 4, 3, 3, 3, 4, 4, 3, 3, 3, 3, 4, 4, 3, 3, 3, 4, 4, 3],
        [3, 4, 7, 3, 3, 3, 4, 7, 3, 3, 3, 3, 4, 7, 3, 3, 3, 4, 7, 3],
        [3, 4, 4, 3, 3, 3, 4, 4, 3, 3, 3, 3, 4, 4, 3, 3, 3, 4, 4, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      ],
      npcs: [
        { id: 'raju', x: 10, y: 3, name: 'ラジュ', color: '#C08040' },
      ],
      items: [
        { id: 'milk',     x: 5,  y: 9, name: 'ミルク',     icon: '🥛' },
        { id: 'turmeric', x: 15, y: 9, name: 'ターメリック', icon: '🟡' },
        { id: 'cinnamon', x: 10, y: 12, name: 'シナモン',  icon: '🟤' },
      ],
      exits: [
        { x: 19, y: 8, y2: 11, nextMap: 'rishikesh', label: 'リシケシュへ→', eventKey: 'varanasi-rishikesh' },
      ],
      playerStart: { x: 5, y: 12 },
    },

    // ===== リシケシュ =====
    rishikesh: {
      bgColor: '#1a3a2a',
      ambience: 'ガンジス川の流れる音がする。',
      tiles: [
        [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
        [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
        [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [2, 2,10, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,10, 2, 2, 2, 2],
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11],
        [11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11],
        [11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11],
      ],
      npcs: [
        { id: 'saraswati', x: 10, y: 8, name: 'サラスワティ', color: '#A0C0D0' },
      ],
      items: [
        { id: 'cardamom', x: 5, y: 7, name: 'カルダモン', icon: '🌿' },
        { id: 'milk',     x: 15, y: 7, name: 'ミルク',    icon: '🥛' },
      ],
      exits: [], // ゴール地点
      playerStart: { x: 10, y: 6 },
    },
  };

  // ===== 描画関数 =====

  function drawTile(ctx, tileType, px, py, size, frame) {
    const p = PALETTE[tileType] || PALETTE[T.GRASS];
    ctx.fillStyle = p.base;
    ctx.fillRect(px, py, size, size);

    // タイルごとのディテール
    if (tileType === T.WATER || tileType === T.DEEP_WATER) {
      // 多重波紋（速度・幅が異なる3本）
      const w1 = (frame % 80) / 80;
      const w2 = (frame % 55) / 55;
      const w3 = (frame % 100) / 100;
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 2, py + 2 + Math.floor(w1 * (size - 6)), size - 4, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(px + 6, py + size - 4 - Math.floor(w2 * (size - 10)), size - 12, 1);
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 4, py + 4 + Math.floor(w3 * (size - 8)), size - 8, 1);
      // 移動スパークル（タイル座標でランダムに見える位置）
      if ((frame + (px >> 5) + (py >> 5)) % 70 < 5) {
        const sx = px + 4 + ((frame * 2 + px) % (size - 8));
        const sy = py + 4 + ((frame + py) % (size - 8));
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(sx, sy, 2, 2);
      }
      // 深水は暗めのオーバーレイ
      if (tileType === T.DEEP_WATER) {
        ctx.fillStyle = 'rgba(0,0,40,0.32)';
        ctx.fillRect(px, py, size, size);
      }

    } else if (tileType === T.GRASS) {
      // 風で揺れる草（各タイルがpx位相で微妙にずれる）
      const sway = Math.sin(frame * 0.04 + px * 0.1) * 2;
      ctx.fillStyle = p.dark;
      ctx.fillRect(px + 8 + Math.round(sway), py + 6, 2, 4);
      ctx.fillRect(px + 18 + Math.round(-sway), py + 16, 2, 4);
      ctx.fillRect(px + 24 + Math.round(sway * 0.7), py + 8, 2, 3);
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 12 + Math.round(sway * 0.5), py + 10, 1, 3);

    } else if (tileType === T.SAND) {
      // 砂のゆるやかなドリフト
      const drift = (frame * 0.28 + (px >> 5) * 3.1) % (size - 4);
      ctx.fillStyle = p.dark;
      for (let i = 0; i < 6; i++) {
        const bx = px + ((i * 5 + 2 + Math.floor(drift)) % (size - 2));
        ctx.fillRect(bx, py + (i % 3) * 8 + 4, 2, 2);
      }
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 2 + (Math.floor(drift * 0.5) % (size - 4)), py + 2, size - 12, 1);

    } else if (tileType === T.ROCK) {
      // 岩のひび割れ
      ctx.fillStyle = p.dark;
      ctx.fillRect(px + 6, py + 10, 14, 1);
      ctx.fillRect(px + 16, py + 10, 1, 10);
      ctx.fillRect(px + 4, py + 18, 10, 1);
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 2, py + 2, 10, 4);

    } else if (tileType === T.STONE || tileType === T.STEPS) {
      // 石の目地
      ctx.fillStyle = p.dark;
      ctx.fillRect(px, py + size / 2, size, 1);
      ctx.fillRect(px + size / 2, py, 1, size);

    } else if (tileType === T.PATH) {
      // 道の筋
      ctx.fillStyle = p.dark;
      ctx.fillRect(px + 4, py + 4, size - 8, 2);
      ctx.fillRect(px + 4, py + size - 8, size - 8, 2);

    } else if (tileType === T.WALL) {
      // 壁のブロック感
      ctx.fillStyle = p.dark;
      ctx.fillRect(px, py, size, 4);
      ctx.fillStyle = p.light;
      ctx.fillRect(px, py, size, 2);

    } else if (tileType === T.TREE) {
      // 木：幹 + 3段の葉
      ctx.fillStyle = '#3D2510';
      ctx.fillRect(px + 13, py + 21, 6, 11); // 幹
      ctx.fillStyle = p.dark;
      ctx.fillRect(px + 5, py + 17, 22, 7);  // 下葉
      ctx.fillStyle = p.base;
      ctx.fillRect(px + 8, py + 10, 16, 9);  // 中葉
      ctx.fillRect(px + 11, py + 3, 10, 9);  // 上葉
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 13, py + 5, 5, 5);   // 光ハイライト

    } else if (tileType === T.MOUNTAIN) {
      // 山
      ctx.fillStyle = p.dark;
      ctx.fillRect(px + 10, py + 2, 12, size - 4);
      ctx.fillStyle = p.light;
      ctx.fillRect(px + 12, py + 4, 4, 8);
    }
  }

  function drawNPC(ctx, npc, px, py, size, frame, npcState) {
    const farewellSeen = npcState?.farewellSeen || false;
    // NPC個別アニメーション（別れ後は静止）
    let bounce = 0, sway = 0;
    if (!farewellSeen) {
      if (npc.id === 'amma') {
        bounce = Math.sin(frame * 0.035) * 1.4;           // 老人のゆっくりした揺れ
        sway   = Math.sin(frame * 0.028) * 1.5;           // 左右のゆらぎ
      } else if (npc.id === 'sandeep') {
        bounce = 0;                                        // 瞑想中は静止
        sway   = 0;
      } else if (npc.id === 'raju') {
        bounce = Math.sin(frame * 0.09) * 2.8 + Math.abs(Math.sin(frame * 0.19)) * 0.7; // 元気なバウンス
        sway   = Math.sin(frame * 0.13) * 1.8;            // 軽い左右
      } else if (npc.id === 'saraswati') {
        bounce = Math.sin(frame * 0.024) * 1.1;           // 幽玄なゆっくり
        sway   = Math.sin(frame * 0.019) * 2.6;           // 広い左右揺れ
      } else {
        bounce = Math.sin(frame * 0.05) * 2;
      }
    }
    const cx = px + size / 2 + sway;
    const bx = cx - 8;
    const by = py + bounce;
    const chaiGiven = npcState?.chaiGiven;

    // 別れを済ませた後: 静かな金の輪（チャイ輪より淡い）
    if (farewellSeen) {
      const fadePulse = 0.12 + 0.06 * Math.sin(frame * 0.025);
      const fGrad = ctx.createRadialGradient(cx, py + size * 0.5, 4, cx, py + size * 0.5, size * 1.1);
      fGrad.addColorStop(0, `rgba(220,200,120,${fadePulse * 2})`);
      fGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fGrad;
      ctx.fillRect(cx - size, py - 4, size * 2, size + 8);
    // チャイを渡した後: 温かい光輪
    } else if (chaiGiven) {
      const glowPulse = 0.28 + 0.12 * Math.sin(frame * 0.06);
      const gGrad = ctx.createRadialGradient(cx, py + size * 0.5, 4, cx, py + size * 0.5, size * 0.85);
      gGrad.addColorStop(0, `rgba(255,200,80,${glowPulse})`);
      gGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gGrad;
      ctx.fillRect(cx - size, py - 4, size * 2, size + 8);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, py + size - 4, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    if (npc.id === 'amma') {
      // アンマー: 老漁師、体が少し曲がっている、頭に布
      ctx.fillStyle = npc.color;
      ctx.fillRect(bx + 1, by + 9, 14, 12); // 少し細い体
      ctx.fillStyle = '#C48040';
      ctx.fillRect(bx + 2, by, 12, 11);
      // 白髪ショール
      ctx.fillStyle = '#E8E0D0';
      ctx.fillRect(bx - 1, by - 1, 18, 5);
      ctx.fillRect(bx - 2, by + 4, 4, 8);
      // しわ
      ctx.fillStyle = '#A06830';
      ctx.fillRect(bx + 4, by + 5, 4, 1);
      ctx.fillRect(bx + 4, by + 7, 3, 1);

    } else if (npc.id === 'sandeep') {
      // サンディープ: 瞑想ポーズで座っている
      ctx.fillStyle = npc.color;
      ctx.fillRect(bx, by + 10, 16, 10); // 座っているので短い
      // 袈裟
      ctx.fillStyle = '#6A4A28';
      ctx.fillRect(bx - 2, by + 9, 20, 3);
      ctx.fillStyle = '#C48040';
      ctx.fillRect(bx + 2, by, 12, 11);
      // 瞑想の目（閉じている）
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx + 3, by + 6, 4, 1);
      ctx.fillRect(bx + 9, by + 6, 4, 1);
      // 髭
      ctx.fillStyle = '#2A1A0A';
      ctx.fillRect(bx + 4, by + 8, 8, 2);

    } else if (npc.id === 'raju') {
      // ラジュ: 少年、やや小さく、ぼさぼさ髪
      ctx.fillStyle = npc.color;
      ctx.fillRect(bx + 1, by + 8, 14, 13);
      ctx.fillStyle = '#C48040';
      ctx.fillRect(bx + 2, by + 1, 12, 10);
      // ぼさぼさ黒髪
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx, by - 1, 16, 5);
      ctx.fillRect(bx - 1, by + 1, 3, 5); // はねた髪
      ctx.fillRect(bx + 14, by + 1, 3, 4);
      // 目（少し大きい）
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(bx + 3, by + 4, 4, 4);
      ctx.fillRect(bx + 9, by + 4, 4, 4);
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx + 4, by + 5, 2, 2);
      ctx.fillRect(bx + 10, by + 5, 2, 2);

    } else if (npc.id === 'saraswati') {
      // サラスワティ: 修行者、細い体、白い衣
      ctx.fillStyle = '#D8EEF4';
      ctx.fillRect(bx, by + 8, 16, 14);
      ctx.fillStyle = '#C48040';
      ctx.fillRect(bx + 2, by, 12, 11);
      // 長い黒髪（両サイドに垂れる）
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx + 1, by - 2, 14, 6);
      ctx.fillRect(bx, by + 4, 3, 10);
      ctx.fillRect(bx + 13, by + 4, 3, 10);
      // 眉間の力（別れを済ませると消える）
      if (!farewellSeen) {
        ctx.fillStyle = '#FF4444';
        ctx.fillRect(bx + 7, by + 3, 2, 2);
      }
      // 目（閉じ気味）
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(bx + 3, by + 5, 4, 2);
      ctx.fillRect(bx + 9, by + 5, 4, 2);
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx + 4, by + 5, 2, 1);
      ctx.fillRect(bx + 10, by + 5, 2, 1);

    } else {
      // デフォルト
      ctx.fillStyle = npc.color;
      ctx.fillRect(bx, by + 8, 16, 14);
      ctx.fillStyle = '#C48040';
      ctx.fillRect(bx + 2, by, 12, 12);
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx, by - 2, 16, 6);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(bx + 3, by + 4, 4, 3);
      ctx.fillRect(bx + 9, by + 4, 4, 3);
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx + 4, by + 5, 2, 2);
      ctx.fillRect(bx + 10, by + 5, 2, 2);
    }

    // Name tag
    ctx.font = '9px monospace';
    const nameText = farewellSeen ? `★ ${npc.name}` : chaiGiven ? `☕ ${npc.name}` : npc.name;
    const tw = ctx.measureText(nameText).width + 8;
    ctx.fillStyle = farewellSeen ? 'rgba(20,16,0,0.82)' : chaiGiven ? 'rgba(40,28,0,0.88)' : 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - tw / 2, by - 18, tw, 14);
    if (farewellSeen) {
      ctx.strokeStyle = 'rgba(180,160,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - tw / 2 + 0.5, by - 17.5, tw - 1, 13);
    } else if (chaiGiven) {
      ctx.strokeStyle = 'rgba(212,168,75,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - tw / 2 + 0.5, by - 17.5, tw - 1, 13);
    }
    ctx.fillStyle = farewellSeen ? 'rgba(200,185,120,0.8)' : '#FFD700';
    ctx.textAlign = 'center';
    ctx.fillText(nameText, cx, by - 8);
  }

  function drawItem(ctx, item, px, py, size, frame) {
    const cx = px + size / 2;
    const cy = py + size / 2;
    const glow = 0.5 + 0.5 * Math.sin(frame * 0.1);
    const rot = (frame * 0.025) % (Math.PI * 2);

    // 放射グロー
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 15);
    grad.addColorStop(0, `rgba(255,220,100,${glow * 0.45})`);
    grad.addColorStop(1, 'rgba(255,220,100,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();

    // 4点星（回転放射線 + 中央ダイヤ）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = `rgba(255,248,160,${glow * 0.85})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const ang = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 3, Math.sin(ang) * 3);
      ctx.lineTo(Math.cos(ang) * 10, Math.sin(ang) * 10);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255,252,210,${glow})`;
    ctx.beginPath();
    ctx.moveTo(0, -2.5); ctx.lineTo(2.5, 0); ctx.lineTo(0, 2.5); ctx.lineTo(-2.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // アイテムアイコン
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.icon || '✨', cx, cy);

    // チャイ・ミルク系は湯気
    if (item.id === 'chai' || item.id === 'milk') {
      for (let s = 0; s < 3; s++) {
        const st = (frame * 0.04 + s * 1.1) % (Math.PI * 2);
        const sx = cx + Math.sin(st + s * 2.1) * 3;
        const sy = cy - 10 - (frame * 0.35 + s * 8) % 14;
        const sa = Math.max(0, 0.45 - ((frame * 0.35 + s * 8) % 14) / 14 * 0.45);
        if (sa < 0.02) continue;
        ctx.save();
        ctx.globalAlpha = sa;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(sx, sy, 2.2 - s * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawExit(ctx, exit, px, py, size, frame) {
    const pulse = 0.6 + 0.4 * Math.sin(frame * 0.08);
    ctx.fillStyle = `rgba(100,255,150,${pulse * 0.35})`;
    ctx.fillRect(px, py, size, size);
    ctx.strokeStyle = `rgba(100,255,150,${pulse * 0.9})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);

    // 点滅する矢印
    const arrowAlpha = 0.7 + 0.3 * Math.sin(frame * 0.12);
    ctx.fillStyle = `rgba(136,255,153,${arrowAlpha})`;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▶', px + size / 2, py + size / 2 + 4);

    // 行き先ラベル（上に小さく）
    const dest = (exit.label || '').replace('へ→', '').replace('→', '').trim();
    if (dest) {
      ctx.font = '7px monospace';
      ctx.fillStyle = `rgba(180,255,190,${arrowAlpha * 0.8})`;
      ctx.fillText(dest, px + size / 2, py + size / 2 - 7);
    }
  }

  function drawPlayer(ctx, px, py, dir, frame, hasChai, stillFrames) {
    const step = Math.floor(frame / 6) % 4;
    const idle = (stillFrames || 0) > 180 ? Math.round(Math.sin(frame * 0.06) * 1.4) : 0;
    const bx = Math.floor(px) - 12;
    const by = Math.floor(py) - 24;

    // 左向き時は水平ミラー（プレイヤー中心を軸に反転）
    const facingLeft = dir === 'left';
    if (facingLeft) {
      ctx.save();
      ctx.transform(-1, 0, 0, 1, 2 * Math.floor(px), 0);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(Math.floor(px), Math.floor(py) + 4, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Leg animation
    const legL = (step === 1) ? 2 : (step === 3) ? -2 : 0;
    const legR = -legL;

    // Legs
    ctx.fillStyle = '#5C3D1E';
    ctx.fillRect(bx + 4, by + 22, 7, 10 + legL);
    ctx.fillRect(bx + 13, by + 22, 7, 10 + legR);

    // Body
    ctx.fillStyle = '#8B5A2B';
    ctx.fillRect(bx + 3, by + 12, 18, 12);

    // Arm (slight swing)
    ctx.fillStyle = '#C48040';
    ctx.fillRect(bx, by + 13, 4, 8 + legL);
    ctx.fillRect(bx + 20, by + 13, 4, 8 + legR);

    // Head（アイドル時は左右に揺れる）
    ctx.fillStyle = '#C48040';
    ctx.fillRect(bx + 4 + idle, by + 1, 16, 14);

    // Hair
    ctx.fillStyle = '#1A0A00';
    ctx.fillRect(bx + 2 + idle, by - 1, 20, 8);
    ctx.fillRect(bx + 2 + idle, by + 5, 3, 8);
    ctx.fillRect(bx + 19 + idle, by + 5, 3, 8);

    // Eyes (direction-based)
    ctx.fillStyle = '#FFFFFF';
    if (dir !== 'up') {
      ctx.fillRect(bx + 6 + idle, by + 6, 5, 4);
      ctx.fillRect(bx + 13 + idle, by + 6, 5, 4);
      ctx.fillStyle = '#1A0A00';
      ctx.fillRect(bx + 7 + idle, by + 7, 3, 3);
      ctx.fillRect(bx + 14 + idle, by + 7, 3, 3);
    }

    // Bag
    ctx.fillStyle = '#7A6550';
    ctx.fillRect(bx + 21, by + 12, 6, 8);
    ctx.fillStyle = '#5A4530';
    ctx.fillRect(bx + 22, by + 9, 2, 5);

    // チャイカップ（持っているとき）
    if (hasChai) {
      const cx2 = bx - 3;
      const cy2 = by + 14;
      // カップ本体（小さな茶色いカップ）
      ctx.fillStyle = '#8B5010';
      ctx.fillRect(cx2, cy2, 6, 5);
      // カップの中身（チャイの色）
      ctx.fillStyle = '#C87020';
      ctx.fillRect(cx2 + 1, cy2, 4, 2);
      // 湯気
      const steamAlpha = 0.5 + 0.5 * Math.sin(frame * 0.15);
      ctx.save();
      ctx.globalAlpha = steamAlpha * 0.7;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx2 + 1, cy2 - 3, 1, 2);
      ctx.fillRect(cx2 + 3, cy2 - 4, 1, 3);
      ctx.restore();
    }

    if (facingLeft) ctx.restore();
  }

  // ===== ロケーション固有大気オーバーレイ =====
  function drawLocationAtmosphere(ctx, mapId, frame, w, h) {
    switch (mapId) {
      case 'gokarna': {
        // 海からの斜めの淡い光線
        for (let i = 0; i < 3; i++) {
          const x = ((i * w / 2.8 + frame * 0.15) % (w * 1.2)) - w * 0.1;
          const bw = 22 + i * 12;
          ctx.save();
          ctx.globalAlpha = 0.038;
          ctx.fillStyle = '#FFFEE0';
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + bw, 0);
          ctx.lineTo(x + bw + h * 0.28, h);
          ctx.lineTo(x + h * 0.28, h);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'hampi': {
        // 石の熱：上部から揺れる陽炎グラデーション
        const g = ctx.createLinearGradient(0, 0, 0, h * 0.55);
        const a = 0.05 + 0.02 * Math.sin(frame * 0.025);
        g.addColorStop(0, `rgba(210,165,40,${a})`);
        g.addColorStop(1, 'rgba(210,165,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h * 0.55);
        break;
      }
      case 'varanasi': {
        // ガンジスの靄：下から立ち上る線香の煙
        const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
        const a = 0.06 + 0.018 * Math.sin(frame * 0.018);
        g.addColorStop(0, 'rgba(175,158,138,0)');
        g.addColorStop(1, `rgba(175,158,138,${a})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, h * 0.55, w, h * 0.45);
        break;
      }
      case 'rishikesh': {
        // ヒマラヤの清澄：全体にわずかな青白の霞
        const base = 0.028 + 0.008 * Math.sin(frame * 0.012);
        ctx.fillStyle = `rgba(200,228,255,${base})`;
        ctx.fillRect(0, 0, w, h);
        // 上部（山側）はより濃い霞
        const mg = ctx.createLinearGradient(0, 0, 0, h * 0.38);
        mg.addColorStop(0, 'rgba(180,215,255,0.08)');
        mg.addColorStop(1, 'rgba(180,215,255,0)');
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, w, h * 0.38);
        break;
      }
    }
  }

  // ===== ロケーション固有装飾スプライト =====
  function drawLocationDecorations(ctx, mapId, frame, ts) {
    switch (mapId) {
      case 'rishikesh': {
        // 祈りの旗：木（col2,row4）から木（col15,row4）へ
        const x1 = 2 * ts + ts / 2, y1 = 4 * ts - 2;
        const x2 = 15 * ts + ts / 2, y2 = 4 * ts - 2;
        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.strokeStyle = 'rgba(140,115,80,0.7)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, y1 + ts * 0.5, x2, y2);
        ctx.stroke();
        const flagColors = ['#E84040','#E89020','#E8E020','#40C040','#4080E0'];
        const N = 7;
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          const fx = x1 + (x2 - x1) * t;
          const sag = Math.sin(t * Math.PI) * ts * 0.5;
          const fy = y1 + sag;
          const wave = Math.sin(frame * 0.07 + i * 1.0) * 2.8;
          ctx.fillStyle = flagColors[i % flagColors.length];
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + 8, fy + 5 + wave);
          ctx.lineTo(fx, fy + 12 + wave * 0.65);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'gokarna': {
        // ヤシの実クラスター：木タイル上部（col2,row12 / col14,row12）
        [{x:2,y:12},{x:14,y:12}].forEach(({x,y}) => {
          const tx = x * ts + ts / 2;
          const ty = y * ts;
          ctx.save();
          ctx.globalAlpha = 0.85;
          for (let i = 0; i < 3; i++) {
            const cx = tx + (i - 1) * 8;
            const cy = ty - ts * 0.5 + Math.sin(frame * 0.035 + i * 1.2) * 2.5;
            ctx.fillStyle = '#2E6818';
            ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1E4810';
            ctx.beginPath(); ctx.arc(cx, cy - 1, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.42;
            ctx.fillStyle = '#58A028';
            ctx.fillRect(cx - 2, cy - 4, 2, 2);
            ctx.globalAlpha = 0.85;
          }
          ctx.restore();
        });
        break;
      }
      case 'varanasi': {
        // 蓮の花：水面（rows 0-1）をゆっくり流れる
        for (let l = 0; l < 5; l++) {
          const speed = 0.22 + l * 0.055;
          const lx = ((frame * speed + l * (20 * ts / 5)) % (20 * ts + ts * 2)) - ts;
          const ly = (l % 2) * ts + ts * 0.55 + Math.sin(frame * 0.035 + l * 1.5) * 3.5;
          ctx.save();
          ctx.globalAlpha = 0.50;
          for (let p = 0; p < 6; p++) {
            const angle = (p / 6) * Math.PI * 2 + frame * 0.01;
            ctx.fillStyle = p % 2 === 0 ? '#FFB0C8' : '#FF90B0';
            ctx.beginPath();
            ctx.ellipse(lx + Math.cos(angle) * 4.5, ly + Math.sin(angle) * 2.8, 3.2, 1.6, angle, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#FFE040';
          ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'hampi': {
        // 石柱の刻文：wall(4)タイルに薄い彫刻線
        [{c:6,r:5},{c:9,r:5}].forEach(({c,r}) => {
          const cx = c * ts + ts / 2;
          const cy = r * ts + ts / 2;
          ctx.save();
          ctx.globalAlpha = 0.22 + 0.06 * Math.sin(frame * 0.018 + c * 0.7);
          ctx.strokeStyle = '#D4A840';
          ctx.lineWidth = 0.7;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(cx - 6 + i * 5, cy - 7);
            ctx.lineTo(cx - 4 + i * 5, cy + 7);
            ctx.stroke();
          }
          ctx.beginPath(); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy); ctx.stroke();
          ctx.restore();
        });
        break;
      }
    }
  }

  // ===== 全マップ描画 =====
  function render(ctx, mapId, items, frame, playerX, playerY, playerDir, tileSize, npcState) {
    const map = maps[mapId];
    if (!map) return;

    const cols = map.tiles[0].length;
    const rows = map.tiles.length;
    const ts = tileSize || S;

    // 背景
    ctx.fillStyle = map.bgColor;
    ctx.fillRect(0, 0, cols * ts, rows * ts);

    // タイル描画
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        drawTile(ctx, map.tiles[r][c], c * ts, r * ts, ts, frame);
      }
    }

    // ロケーション固有大気
    drawLocationAtmosphere(ctx, mapId, frame, cols * ts, rows * ts);
    drawLocationDecorations(ctx, mapId, frame, ts);

    // 足跡
    const fps = npcState?.footprints || [];
    for (const fp of fps) {
      if (fp.alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = fp.alpha;
      // 砂タイル(1)は薄いベージュの凹み、それ以外は暗い点
      ctx.fillStyle = fp.tileType === 1 ? 'rgba(160,110,40,0.7)' : 'rgba(25,15,5,0.55)';
      const r = fp.size || 1.5;
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y + 1, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 出口
    for (const ex of map.exits) {
      for (let ey = ex.y; ey <= (ex.y2 || ex.y); ey++) {
        drawExit(ctx, ex, (ex.x) * ts, ey * ts, ts, frame);
      }
    }

    // アイテム
    for (const item of (items || map.items)) {
      if (!item.collected) {
        drawItem(ctx, item, item.x * ts, item.y * ts, ts, frame);
      }
    }

    // NPC
    for (const npc of map.npcs) {
      const state = npcState?.npcs?.[npc.id];
      drawNPC(ctx, npc, npc.x * ts, npc.y * ts, ts, frame, state);
    }

    // プレイヤー
    drawPlayer(ctx, playerX * ts + ts / 2, playerY * ts + ts / 2, playerDir, frame, npcState?.hasChai, npcState?.playerStillFrames);
  }

  function isWalkable(mapId, col, row) {
    const map = maps[mapId];
    if (!map) return false;
    if (row < 0 || row >= map.tiles.length) return false;
    if (col < 0 || col >= map.tiles[0].length) return false;
    const t = map.tiles[row][col];
    return WALKABLE[t] !== false;
  }

  function getMap(mapId) { return maps[mapId]; }
  function getTileSize() { return S; }

  return { render, isWalkable, getMap, getTileSize, maps };
})();
