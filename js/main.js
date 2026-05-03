// js/main.js - メインゲームエンジン
'use strict';

// ===== ゲーム状態 =====
const GameState = {
  personality: null,       // 'A'|'B'|'C'
  location: 'gokarna',
  inventory: {
    milk: 1, cardamom: 1, ginger: 0, cinnamon: 0, turmeric: 0, chai: 0,
    wooden_doll: 0, spice_from_sandeep: 0, stone_from_raju: 0,
  },
  status: { chitta: 50, prana: 100, viveka: 0 },
  dreamChoices: [],
  fieldChoices: {},
  npcProgress: { amma: 0, sandeep: 0, raju: 0, saraswati: 0 },
  chaiGiven: { amma: null, sandeep: null, raju: null, saraswati: null },
  lastChaiSpice: null,
  visitedLocations: [],
  fieldEventsSeen: [],
  npcHistory: { amma: [], sandeep: [], raju: [], saraswati: [] },
  collectedItems: {},
  currentMapItems: null, // ロード済みマップアイテム
  _farewellSeen: {},
  _vivekaNotified: 0,   // bitflag: bit1=25, bit2=50, bit4=75
};

// ===== プレイヤー状態 =====
const Player = {
  x: 10, y: 12,
  targetX: 10, targetY: 12,
  moving: false,
  dir: 'down',
  frame: 0,
  stillFrames: 0,
};

// ===== UI 状態 =====
const UI = {
  screen: 'init', // init|dream|field|dialogue|menu|fieldEvent|ending|chai
  dreamStep: 0,
  dreamChoices: [],
  dialogueQueue: [],
  dialogueCurrent: null,
  currentNpc: null,
  pendingFieldEvent: null,
  fieldEventStep: 0,
};

// ===== Canvas =====
let canvas, ctx;
let animFrame = 0;
let fieldEnterFrame = 0;
let gameLoop = null;
let tileSize = 32;
let typeTextSkip = false;
let typeTextRunning = false;
const npcProximityState = {}; // NPC近接状態トラッキング

// ===== DOM 要素キャッシュ =====
const $ = id => document.getElementById(id);

// ===== HTML エスケープ（innerHTML に外部由来の値を入れる際に使用）=====
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ===== レスポンシブスケーリング =====
function scaleGame() {
  const wrapper = $('game-wrapper');
  if (!wrapper) return;
  const scaleX = window.innerWidth  / 640;
  const scaleY = window.innerHeight / 520;
  const scale  = Math.min(scaleX, scaleY);
  wrapper.style.transform = `scale(${scale})`;
  // body のサイズをラッパーの実際の占有サイズに合わせる
  document.body.style.width  = `${640 * scale}px`;
  document.body.style.height = `${520 * scale}px`;
}

// ===== 初期化 =====
function init() {
  canvas = $('game-canvas');
  ctx = canvas.getContext('2d');

  // タイルサイズ計算 (canvas 640×480, map 20×15)
  tileSize = Math.floor(canvas.width / 20);

  // レスポンシブ対応
  scaleGame();
  window.addEventListener('resize', scaleGame);

  AudioSystem.init();

  // 最初のクリックで AudioContext を resume
  document.addEventListener('click', () => AudioSystem.init(), { once: true });

  // スペース / Enter でテキストスキップ or NPC話しかけ
  document.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (skipText()) { e.preventDefault(); return; }
      if (UI.screen === 'field') {
        // 近くのNPCに話しかける
        const map = MapSystem.getMap(GameState.location);
        if (map) {
          for (const npc of map.npcs) {
            if (Math.abs(npc.x - Player.x) <= 1.5 && Math.abs(npc.y - Player.y) <= 1.5) {
              interactWithNPC(npc.id);
              e.preventDefault();
              return;
            }
          }
        }
      }
    }
  });

  setupCanvasClick();
  setupKeyboard();
  setupDpad();

  // URL パラメータ判定
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');

  if (mode === 'continue') {
    const newest = SaveSystem.getNewestSave();
    const autosave = SaveSystem.getAutoSave();
    let toLoad = null;
    if (newest && autosave) {
      toLoad = (autosave.timestamp || 0) > (newest.data.timestamp || 0) ? autosave : newest.data;
    } else {
      toLoad = newest?.data || autosave;
    }
    if (toLoad) {
      loadFromSave(toLoad);
      startField();
      return;
    }
  }
  if (mode === 'load') {
    showMenuOverlay('load');
    return;
  }

  // 新規ゲーム → 夢のシーン
  startDreamSequence();
}

// ===== 夢のシーケンス =====
function startDreamSequence() {
  UI.screen = 'dream';
  UI.dreamStep = 0;
  UI.dreamChoices = [];
  $('dream-overlay').classList.add('active');
  AudioSystem.playBgm('dream');

  showDreamOpening();
}

function showDreamOpening() {
  const opening = Story.dream.opening;
  let idx = 0;
  $('dream-scene-title').textContent = '— 夢のはじまり —';
  $('dream-text').textContent = '';
  $('dream-choices').innerHTML = '';

  function showNext() {
    if (idx < opening.length) {
      typeText($('dream-text'), opening[idx], 40, () => {
        idx++;
        setTimeout(showNext, 600);
      }, true);
    } else {
      setTimeout(() => showDreamScene(0), 800);
    }
  }
  showNext();
}

function showDreamScene(sceneIdx) {
  const scene = Story.dream.scenes[sceneIdx];
  if (!scene) {
    finalizeDream();
    return;
  }

  $('dream-scene-title').textContent = scene.title;
  $('dream-text').textContent = '';
  $('dream-choices').innerHTML = '';

  $('dream-content').onclick = skipText;
  typeText($('dream-text'), scene.text, 45, () => {
    $('dream-content').onclick = null;
    scene.choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'dream-choice';
      btn.textContent = choice.label;
      btn.onclick = () => {
        AudioSystem.sfxDecide();
        UI.dreamChoices.push(choice.key);
        $('dream-choices').querySelectorAll('button').forEach(b => b.disabled = true);
        btn.style.borderColor = 'var(--gold)';
        btn.style.color = 'var(--gold)';
        setTimeout(() => showDreamScene(sceneIdx + 1), 700);
      };
      $('dream-choices').appendChild(btn);
    });
  }, true);
}

function finalizeDream() {
  // 多数決で性格決定
  const counts = { A: 0, B: 0, C: 0 };
  UI.dreamChoices.forEach(c => counts[c]++);
  const personality = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);

  GameState.personality = personality;
  GameState.dreamChoices = UI.dreamChoices;

  const result = Story.dream.result[personality];

  $('dream-scene-title').textContent = `— ${result.name}のチャイ —`;
  $('dream-choices').innerHTML = '';

  typeText($('dream-text'), result.awakening, 50, () => {
    setTimeout(() => {
      $('dream-overlay').classList.remove('active');
      GameState.visitedLocations.push('gokarna');
      showLocationIntro('gokarna', () => startField());
    }, 2000);
  }, true);
}

// ===== ロケーション紹介 =====
function showLocationIntro(locId, callback) {
  const intro = Story.locationIntros[locId];
  if (!intro) { callback(); return; }

  const loc = Story.locations[locId];
  $('dream-overlay').classList.add('active');
  $('dream-scene-title').textContent = `— ${loc.name} —`;
  $('dream-text').textContent = '';
  $('dream-choices').innerHTML = '';

  $('dream-content').onclick = skipText;
  let idx = 0;
  function next() {
    if (idx < intro.length) {
      typeText($('dream-text'), intro[idx], 50, () => {
        idx++;
        setTimeout(next, 800);
      }, true);
    } else {
      $('dream-content').onclick = null;
      setTimeout(() => {
        $('dream-overlay').classList.remove('active');
        callback();
      }, 1000);
    }
  }
  next();
}

// ===== フィールド開始 =====
function startField() {
  UI.screen = 'field';
  const map = MapSystem.getMap(GameState.location);
  if (!map) return;

  if (!GameState.currentMapItems) {
    // マップのアイテムを初期化（収集済み除外）
    GameState.currentMapItems = JSON.parse(JSON.stringify(map.items));
    GameState.currentMapItems.forEach(item => {
      const key = `${GameState.location}_${item.id}_${item.x}_${item.y}`;
      if (GameState.collectedItems[key]) item.collected = true;
    });
  }

  // プレイヤー初期位置
  const start = map.playerStart;
  Player.x = start.x;
  Player.y = start.y;
  Player.targetX = start.x;
  Player.targetY = start.y;

  fieldEnterFrame = animFrame;
  locationTitleAlpha = 1.0;
  spawnEntranceRings();
  // NPC近接状態をリセット
  Object.keys(npcProximityState).forEach(k => delete npcProximityState[k]);
  // 最初の updateStatusBar で変化通知が出ないよう prevStatus を同期
  Object.assign(prevStatus, GameState.status);
  updateStatusBar();

  AudioSystem.playBgm(GameState.location);

  if (!gameLoop) {
    gameLoop = requestAnimationFrame(tick);
  }
}

// ===== メインループ =====
function tick() {
  animFrame++;
  gameLoop = requestAnimationFrame(tick);

  if (UI.screen !== 'field') return;

  // プレイヤー移動
  updatePlayerMovement();

  // リシケシュ滞在中のヴィヴェーカ自然上昇（360フレームに+1、静止中は+2）
  if (GameState.location === 'rishikesh' && animFrame % 360 === 0) {
    const gain = Player.stillFrames > 120 ? 2 : 1;
    GameState.status.viveka = Math.min(100, (GameState.status.viveka || 0) + gain);
    updateStatusBar();
  }

  // 描画
  renderField();
}

function updatePlayerMovement() {
  const prana = GameState.status.prana || 100;
  const speed = prana > 75 ? 0.15 : prana < 20 ? 0.08 : 0.12;
  const dx = Player.targetX - Player.x;
  const dy = Player.targetY - Player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 0.05) {
    Player.x += dx * speed;
    Player.y += dy * speed;
    Player.moving = true;
    // タイル情報取得（足音・ほこり・足跡で共用）
    const _tRow = Math.min(14, Math.max(0, Math.round(Player.y)));
    const _tCol = Math.min(19, Math.max(0, Math.round(Player.x)));
    const _tMap = MapSystem.getMap(GameState.location);
    const _tt   = _tMap?.tiles?.[_tRow]?.[_tCol] ?? 2;

    if (animFrame % 14 === 0) AudioSystem.sfxStepTile(_tt);

    if (animFrame % 10 === 0) {
      const dustX = Player.x * tileSize + tileSize / 2;
      const dustY = Player.y * tileSize + tileSize - 4;
      const dustColors = {
        0:'rgba(80,160,220,0.5)', 1:'rgba(220,190,110,0.7)', 2:'rgba(70,140,70,0.5)',
        3:'rgba(185,155,90,0.6)', 5:'rgba(160,150,140,0.6)', 6:'rgba(140,130,120,0.6)',
        7:'rgba(190,170,130,0.5)', 8:'rgba(200,185,150,0.6)',
      };
      spawnParticles(dustX, dustY, dustColors[_tt] || 'rgba(200,180,140,0.6)', 2);
    }

    if (animFrame % 22 === 0) addFootprint(Player.x, Player.y, Math.floor(animFrame / 22) % 2 === 0);

    if (Math.abs(dx) > Math.abs(dy)) {
      Player.dir = dx > 0 ? 'right' : 'left';
    } else {
      Player.dir = dy > 0 ? 'down' : 'up';
    }
  } else {
    Player.x = Player.targetX;
    Player.y = Player.targetY;
    if (Player.moving) {
      Player.moving = false;
      checkTileInteraction();
    }
    // 静止フレーム計測（瞑想ゾーン判定）
    Player.stillFrames = (Player.stillFrames || 0) + 1;
    checkMeditationZone();
  }
}

// 瞑想ゾーン：各ロケーションの静かなエリアで静止するとヴィヴェーカが少し上がる
const MEDITATION_ZONES = {
  gokarna:   { rows: [0, 3],  label: '波が　静かだった。', viveka: 2 },
  hampi:     { rows: [3, 8],  label: '石が　黙っていた。', viveka: 2 },
  varanasi:  { rows: [0, 3],  label: '川が　流れていた。', viveka: 2 },
  rishikesh: { rows: [6, 11], label: '山が　静かだった。', viveka: 3 },
};
const _meditationCooldown = {};
const STILL_THRESHOLD = 240;  // 約4秒（60fps）

function checkMeditationZone() {
  const zone = MEDITATION_ZONES[GameState.location];
  if (!zone) return;
  const row = Math.floor(Player.y);
  if (row < zone.rows[0] || row > zone.rows[1]) {
    Player.stillFrames = 0;
    return;
  }
  const sf = Player.stillFrames;
  // 静止中：かすかに立ち上る光の粒（瞑想ゾーンの手がかり）
  if (sf > 40 && sf < STILL_THRESHOLD && sf % 25 === 0) {
    const px = Player.x * tileSize + tileSize / 2 + (Math.random() - 0.5) * 18;
    const py = Player.y * tileSize - 2;
    spawnParticles(px, py, 'rgba(180,195,220,0.5)', 1);
  }
  // 半分の時間で「…」フローティングテキスト
  if (sf === Math.floor(STILL_THRESHOLD / 2)) {
    spawnFloatingText('……', 'rgba(200,200,180,0.9)');
  }
  // 閾値到達でヴィヴェーカ加算（ロケーションごとに1回）
  if (sf === STILL_THRESHOLD) {
    const key = GameState.location;
    if (_meditationCooldown[key]) return;
    _meditationCooldown[key] = true;
    const gain = zone.viveka;
    GameState.status.viveka = Math.min(100, (GameState.status.viveka || 0) + gain);
    updateStatusBar();
    spawnFloatingText(`＋ヴィヴェーカ ${gain}`, '#A8D8FF');
    notify(zone.label, 2500);
    AudioSystem.sfxMeditate();
    // 小さなパーティクル
    const px = Player.x * tileSize + tileSize / 2;
    const py = Player.y * tileSize;
    for (let i = 0; i < 8; i++) spawnParticles(px, py, '#A8D8FF', 1);
  }
}

// フローティングテキストシステム（ステータス変化表示）
const floatingTexts = [];

// ===== フィールド入場リング =====
const entranceRings = [];

function spawnEntranceRings() {
  const px = Player.x * tileSize + tileSize / 2;
  const py = Player.y * tileSize + tileSize / 2;
  for (let i = 0; i < 3; i++) {
    entranceRings.push({
      x: px, y: py,
      r: 0,
      delay: i * 16,
      maxR: tileSize * (1.6 + i * 1.0),
      alpha: 0.52 - i * 0.11,
    });
  }
}

function renderEntranceRings() {
  for (let i = entranceRings.length - 1; i >= 0; i--) {
    const ring = entranceRings[i];
    if (ring.delay > 0) { ring.delay--; continue; }
    ring.r += 2.6;
    ring.alpha = Math.max(0, ring.alpha - 0.017);
    if (ring.alpha <= 0) { entranceRings.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = ring.alpha;
    ctx.strokeStyle = '#D4C890';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ===== ロケーション移行波紋エフェクト =====
let transitionRipple = null;

function startTransitionRipple() {
  const px = Player.x * tileSize + tileSize / 2;
  const py = Player.y * tileSize + tileSize / 2;
  const maxR = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height);
  transitionRipple = { x: px, y: py, r: 0, maxR, alpha: 0.72 };
}

function renderTransitionRipple() {
  if (!transitionRipple) return;
  const rp = transitionRipple;
  rp.r += 20;
  rp.alpha = Math.max(0, rp.alpha - 0.025);
  if (rp.r >= rp.maxR || rp.alpha <= 0) { transitionRipple = null; return; }
  ctx.save();
  ctx.globalAlpha = rp.alpha;
  ctx.strokeStyle = '#E8D8A0';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
  ctx.stroke();
  if (rp.r > 32) {
    ctx.globalAlpha = rp.alpha * 0.35;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, rp.r - 30, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// NPC別れ時のキャンバスフラッシュ
let canvasFlash = null;
let locationTitleAlpha = 0;
function triggerCanvasFlash(color, duration) {
  canvasFlash = { color, alpha: 0.55, decay: 0.55 / ((duration || 600) / 16) };
}
function renderCanvasFlash() {
  if (!canvasFlash) return;
  ctx.save();
  ctx.globalAlpha = canvasFlash.alpha;
  ctx.fillStyle = canvasFlash.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  canvasFlash.alpha -= canvasFlash.decay;
  if (canvasFlash.alpha <= 0) canvasFlash = null;
}

// ===== 入場タイトルテキスト =====
function renderLocationTitle() {
  if (locationTitleAlpha <= 0.005) return;
  const loc = Story.locations[GameState.location];
  if (!loc) return;
  // 0→1→0 のフェード（120フレームかけて上がり、240フレームで消える）
  const elapsed = animFrame - fieldEnterFrame;
  const fadeIn  = Math.min(1, elapsed / 90);
  const fadeOut = Math.max(0, 1 - Math.max(0, elapsed - 140) / 120);
  const alpha   = fadeIn * fadeOut * 0.88;
  if (alpha < 0.01) { locationTitleAlpha = 0; return; }
  locationTitleAlpha = alpha;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.22;
  ctx.save();
  ctx.globalAlpha = alpha;
  // 背景帯
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(cx - 120, cy - 18, 240, 36);
  // 場所名
  ctx.font = 'bold 18px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#F0E0A0';
  ctx.fillText(`— ${loc.name} —`, cx, cy);
  ctx.restore();
}

function spawnFloatingText(text, color) {
  floatingTexts.push({
    text,
    color: color || '#FFD700',
    x: canvas.width / 2 + (Math.random() - 0.5) * 60,
    y: canvas.height * 0.62,
    vy: -0.7,
    life: 1.0,
    decay: 0.012,
  });
}

function updateFloatingTexts() {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const t = floatingTexts[i];
    t.y += t.vy;
    t.life -= t.decay;
    if (t.life <= 0) floatingTexts.splice(i, 1);
  }
}

function renderFloatingTexts() {
  for (const t of floatingTexts) {
    ctx.save();
    ctx.globalAlpha = t.life * t.life;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(t.text, t.x + 1, t.y + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  }
}

// ===== 環境浮遊パーティクル（ロケーション別天気） =====
const ambientParticles = [];

const AMBIENT_CFG = {
  gokarna:   { color:'rgba(190,225,255,0.55)', vx: 0.18, vy:-0.14, r:1.4, life:200 },
  hampi:     { color:'rgba(205,175,75,0.50)',  vx: 0.50, vy: 0.04, r:1.1, life:160 },
  varanasi:  { color:'rgba(140,155,185,0.30)', vx: 0.9,  vy: 2.5,  r:0.9, life:70, isRain:true },
  rishikesh: { color:'rgba(215,240,255,0.40)', vx: 0.04, vy: 0.12, r:1.7, life:260 },
};

function spawnAmbientParticle(location) {
  const cfg = AMBIENT_CFG[location];
  if (!cfg) return;
  ambientParticles.push({
    x: Math.random() * canvas.width,
    y: cfg.isRain ? -Math.random() * 20 : Math.random() * canvas.height,
    vx: cfg.vx + (Math.random() - 0.5) * 0.18,
    vy: cfg.vy + (Math.random() - 0.5) * 0.12,
    r: cfg.r + Math.random() * 0.9,
    color: cfg.color,
    isRain: cfg.isRain || false,
    age: 0,
    maxLife: cfg.life + Math.floor(Math.random() * 30 - 15),
  });
  if (ambientParticles.length > 55) ambientParticles.shift();
}

function updateAmbientParticles() {
  for (let i = ambientParticles.length - 1; i >= 0; i--) {
    const p = ambientParticles[i];
    p.x += p.vx; p.y += p.vy; p.age++;
    if (p.age >= p.maxLife) ambientParticles.splice(i, 1);
  }
}

function renderAmbientParticles() {
  for (const p of ambientParticles) {
    const progress = p.age / p.maxLife;
    const alpha = progress < 0.2 ? progress / 0.2 : progress > 0.78 ? (1 - progress) / 0.22 : 1;
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = p.color;
    if (p.isRain) {
      ctx.fillRect(p.x, p.y, 1, 4);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ===== 足跡システム =====
const footprints = [];

function addFootprint(px, py, isLeft) {
  const tileRow = Math.min(14, Math.max(0, Math.round(py)));
  const tileCol = Math.min(19, Math.max(0, Math.round(px)));
  const curMap = MapSystem.getMap(GameState.location);
  const tt = curMap?.tiles?.[tileRow]?.[tileCol] ?? 2;
  if (tt === 0 || tt === 10 || tt === 11) return; // 水・山・木は足跡なし
  const isSand = tt === 1;
  footprints.push({
    x: px * tileSize + tileSize / 2 + (isLeft ? -3 : 3),
    y: py * tileSize + tileSize - 3,
    alpha: isSand ? 0.60 : 0.38,
    size: isSand ? 2.5 : 1.5,
    tileType: tt,
  });
  if (footprints.length > 28) footprints.shift();
}

function updateFootprints() {
  for (let i = footprints.length - 1; i >= 0; i--) {
    footprints[i].alpha -= 0.0046;
    if (footprints[i].alpha <= 0) footprints.splice(i, 1);
  }
}

// ===== 自然パーティクル（ロケーション別の浮遊物） =====
const NATURE_CFG = {
  gokarna:   { color:'rgba(255,255,255,0.75)', w:3.0, h:1.0, vx:[0.35,0.65], vy:[-0.08,0.08], rate:160, spawnY:'random' },
  hampi:     { color:'rgba(170,110,35,0.80)',  w:3.5, h:1.2, vx:[0.65,1.20], vy:[0.05,0.25],  rate:110, spawnY:'top'    },
  varanasi:  { color:'rgba(255,215,80,0.65)',  w:2.5, h:0.9, vx:[0.15,0.45], vy:[-0.18,0.04], rate:190, spawnY:'random' },
  rishikesh: { color:'rgba(210,235,255,0.70)', w:3.0, h:0.9, vx:[-0.15,0.12],vy:[0.18,0.38],  rate:145, spawnY:'top'    },
};
const natureParticles = [];

function spawnNatureParticle(location) {
  const cfg = NATURE_CFG[location];
  if (!cfg || animFrame % cfg.rate !== 0) return;
  natureParticles.push({
    x: Math.random() * canvas.width,
    y: cfg.spawnY === 'top' ? -6 : Math.random() * canvas.height * 0.85,
    vx: cfg.vx[0] + Math.random() * (cfg.vx[1] - cfg.vx[0]),
    vy: cfg.vy[0] + Math.random() * (cfg.vy[1] - cfg.vy[0]),
    w: cfg.w * (0.7 + Math.random() * 0.6),
    h: cfg.h,
    color: cfg.color,
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.045,
    life: 0,
    maxLife: 280 + Math.floor(Math.random() * 120),
  });
  if (natureParticles.length > 32) natureParticles.shift();
}

function updateNatureParticles() {
  for (let i = natureParticles.length - 1; i >= 0; i--) {
    const p = natureParticles[i];
    p.x += p.vx + Math.sin(p.rot * 0.7) * 0.14;
    p.y += p.vy;
    p.rot += p.rotV;
    p.life++;
    if (p.life >= p.maxLife || p.x > canvas.width + 12 || p.y > canvas.height + 12) {
      natureParticles.splice(i, 1);
    }
  }
}

function renderNatureParticles() {
  for (const p of natureParticles) {
    const progress = p.life / p.maxLife;
    const alpha = progress < 0.12 ? progress / 0.12 : progress > 0.82 ? (1 - progress) / 0.18 : 1;
    ctx.save();
    ctx.globalAlpha = alpha * 0.72;
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, 0.38);
    ctx.beginPath();
    ctx.ellipse(0, 0, p.w, p.w * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ===== 瞑想リング（瞑想ゾーンで静止中に呼吸する光輪） =====
function renderMeditationRing() {
  const zone = MEDITATION_ZONES[GameState.location];
  if (!zone) return;
  const sf = Player.stillFrames || 0;
  if (sf < 55) return;
  const row = Math.floor(Player.y);
  if (row < zone.rows[0] || row > zone.rows[1]) return;
  const px = Player.x * tileSize + tileSize / 2;
  const py = Player.y * tileSize + tileSize / 2;
  const appear = Math.min(1, (sf - 55) / 80);
  const breath = (sf % 88) / 88;
  const r = tileSize * (1.1 + breath * 2.0);
  const a = (1 - breath) * 0.28 * appear;
  if (a <= 0.004) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = 'rgba(170,200,255,1)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();
  if (breath < 0.5) {
    ctx.globalAlpha = a * 0.38;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.65, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ===== 星降りシステム (ヴィヴェーカ >= 60 で発動) =====
const starfallParticles = [];

function spawnStarfall() {
  const viveka = GameState.status.viveka || 0;
  if (viveka < 60) return;
  const rate = viveka >= 80 ? 110 : 190;
  if (animFrame % rate !== 0) return;
  const count = viveka >= 80 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    starfallParticles.push({
      x: Math.random() * canvas.width,
      y: -8,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0.35 + Math.random() * 0.45,
      size: 1.4 + Math.random() * 1.6,
      alpha: 0,
      maxAlpha: 0.45 + Math.random() * 0.3,
      life: 0,
      maxLife: 270 + Math.floor(Math.random() * 90),
      phase: Math.random() * Math.PI * 2,
    });
    if (starfallParticles.length > 28) starfallParticles.shift();
  }
}

function updateStarfall() {
  for (let i = starfallParticles.length - 1; i >= 0; i--) {
    const s = starfallParticles[i];
    s.x += s.vx;
    s.y += s.vy;
    s.life++;
    s.phase += 0.055;
    const progress = s.life / s.maxLife;
    s.alpha = progress < 0.12 ? (progress / 0.12) * s.maxAlpha
            : progress > 0.78 ? ((1 - progress) / 0.22) * s.maxAlpha
            : s.maxAlpha;
    if (s.life >= s.maxLife || s.y > canvas.height + 10) starfallParticles.splice(i, 1);
  }
}

function renderStarfall() {
  if (starfallParticles.length === 0) return;
  for (const s of starfallParticles) {
    if (s.alpha <= 0.005) continue;
    const twinkle = 0.65 + 0.35 * Math.sin(s.phase);
    const r = s.size;
    ctx.save();
    ctx.globalAlpha = s.alpha * twinkle;
    ctx.fillStyle = '#FFE8A0';
    // 4点星（縦横の十字）
    ctx.fillRect(s.x - r * 0.22, s.y - r, r * 0.44, r * 2);
    ctx.fillRect(s.x - r, s.y - r * 0.22, r * 2, r * 0.44);
    ctx.restore();
  }
}

// ===== ヴィヴェーカ地面輝き (viveka >= 75) =====
const groundSparkles = [];

function updateGroundSparkles() {
  const viveka = GameState.status.viveka || 0;
  if (viveka >= 75 && animFrame % 22 === 0) {
    const map = MapSystem.getMap(GameState.location);
    if (map && map.tiles) {
      const rows = map.tiles.length;
      const cols = map.tiles[0].length;
      const walkable = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (MapSystem.isWalkable(GameState.location, col, row)) walkable.push({ col, row });
        }
      }
      if (walkable.length > 0) {
        const count = viveka >= 90 ? 3 : 2;
        for (let k = 0; k < count; k++) {
          const t = walkable[Math.floor(Math.random() * walkable.length)];
          groundSparkles.push({
            x: t.col * tileSize + tileSize / 2 + (Math.random() - 0.5) * 14,
            y: t.row * tileSize + tileSize / 2 + (Math.random() - 0.5) * 14,
            life: 1.0,
            decay: 0.038 + Math.random() * 0.022,
            size: 2.2 + Math.random() * 1.8,
          });
          if (groundSparkles.length > 40) groundSparkles.shift();
        }
      }
    }
  }
  for (let i = groundSparkles.length - 1; i >= 0; i--) {
    groundSparkles[i].life -= groundSparkles[i].decay;
    if (groundSparkles[i].life <= 0) groundSparkles.splice(i, 1);
  }
}

function renderGroundSparkles() {
  if (groundSparkles.length === 0) return;
  for (const s of groundSparkles) {
    const twinkle = 0.5 + 0.5 * Math.sin(animFrame * 0.18 + s.x);
    const a = s.life * twinkle * 0.7;
    if (a < 0.02) continue;
    const r = s.size;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#FFD96A';
    ctx.fillRect(s.x - r * 0.2, s.y - r, r * 0.4, r * 2);
    ctx.fillRect(s.x - r, s.y - r * 0.2, r * 2, r * 0.4);
    ctx.restore();
  }
}

// ===== 地平線グロー (ロケーション別ほんのり輝き) =====
const HORIZON_CFG = {
  gokarna:   { row: 3,  h: 18, colors: ['rgba(255,180,60,', 'rgba(255,130,30,'] },
  hampi:     { row: 4,  h: 16, colors: ['rgba(200,140,60,', 'rgba(170,100,30,'] },
  varanasi:  { row: 2,  h: 20, colors: ['rgba(255,120,60,', 'rgba(200,80,40,']  },
  rishikesh: { row: 3,  h: 14, colors: ['rgba(60,180,120,',  'rgba(30,140,80,']  },
};

function renderHorizonGlow() {
  const cfg = HORIZON_CFG[GameState.location];
  if (!cfg) return;
  const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.025);
  const baseAlpha = 0.06 + pulse * 0.05;
  const y = cfg.row * tileSize - cfg.h / 2;
  const g = ctx.createLinearGradient(0, y - cfg.h, 0, y + cfg.h * 1.5);
  g.addColorStop(0, cfg.colors[0] + '0)');
  g.addColorStop(0.38, cfg.colors[1] + baseAlpha + ')');
  g.addColorStop(0.62, cfg.colors[0] + baseAlpha * 0.7 + ')');
  g.addColorStop(1,   cfg.colors[0] + '0)');
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, y - cfg.h, canvas.width, cfg.h * 3);
  ctx.restore();
}

// ===== ロケーション固有の大気エフェクト =====
function renderLocationMagic() {
  const loc = GameState.location;

  // ── ゴーカルナ / リシケシュ: 空を渡る鳥のシルエット ──
  if (loc === 'gokarna' || loc === 'rishikesh') {
    const skyRows = loc === 'gokarna' ? 2.5 : 2.8;
    const birdCount = 4;
    ctx.save();
    for (let b = 0; b < birdCount; b++) {
      const speed  = 0.28 + b * 0.09;
      const bx     = (animFrame * speed + b * 163) % (canvas.width + 60) - 30;
      const by     = (b * 31 + 14) % (Math.floor(skyRows) * tileSize - 8) + 4;
      const wing   = Math.sin(animFrame * 0.12 + b * 1.4) * 3;
      const alpha  = 0.30 + 0.10 * Math.sin(animFrame * 0.04 + b);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = loc === 'gokarna' ? '#203860' : '#1a3a28';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx - 7, by + wing);
      ctx.quadraticCurveTo(bx, by, bx + 7, by + wing);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 砂と水の境界に白い泡が打ち寄せる ──
  if (loc === 'gokarna') {
    const foamY = 3 * tileSize; // 砂タイル開始行（行3）の上端 = 水との境界
    for (let wave = 0; wave < 4; wave++) {
      const speed  = 0.028 + wave * 0.009;
      const phase  = (animFrame * speed + wave * 2.2) % (Math.PI * 2);
      const yOff   = Math.sin(phase) * 3.5;
      const alpha  = (0.18 + 0.12 * Math.sin(phase * 0.7)) * (0.5 + 0.5 * Math.sin(phase));
      if (alpha < 0.02) continue;
      const startX = (wave * 51 + animFrame * (0.12 + wave * 0.05)) % (canvas.width + 30) - 15;
      const len    = 55 + wave * 20;
      ctx.save();
      ctx.globalAlpha = alpha;
      const fg = ctx.createLinearGradient(startX, 0, startX + len, 0);
      fg.addColorStop(0,   'rgba(255,255,255,0)');
      fg.addColorStop(0.4, 'rgba(255,255,255,0.9)');
      fg.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(startX, foamY - 2 + yOff, len, 3);
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 椰子の木シルエット ──
  if (loc === 'gokarna') {
    const palms = [
      { x: canvas.width - 36, gy: 3 * tileSize - 2, lean: -0.14, h: 50 },
      { x: canvas.width - 72, gy: 3 * tileSize - 2, lean:  0.10, h: 43 },
      { x: canvas.width - 14, gy: 3 * tileSize,     lean: -0.20, h: 37 },
    ];
    const sway = Math.sin(animFrame * 0.022) * 1.8;
    ctx.save();
    ctx.strokeStyle = '#1A2A12';
    ctx.fillStyle   = '#1A2A12';
    ctx.globalAlpha = 0.70;
    for (const p of palms) {
      const tx = p.x + p.lean * p.h + sway;
      const ty = p.gy - p.h;
      // 幹
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.gy);
      ctx.quadraticCurveTo(p.x + p.lean * p.h * 0.55, p.gy - p.h * 0.6, tx, ty);
      ctx.stroke();
      // 葉
      ctx.lineWidth = 1.5;
      for (let fi = 0; fi < 6; fi++) {
        const fa  = -Math.PI * 0.72 + fi * (Math.PI * 0.29) + sway * 0.03;
        const fl  = 15 + fi % 2 * 5;
        const fx2 = tx + Math.cos(fa) * fl;
        const fy2 = ty + Math.sin(fa) * fl;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + Math.cos(fa) * fl * 0.55, ty + Math.sin(fa) * fl * 0.55 + 3.5, fx2, fy2 + 3);
        ctx.stroke();
      }
      // ヤシの実
      ctx.beginPath();
      ctx.arc(tx - 1.5, ty + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 黄金時間の水面きらめき ──
  if (loc === 'gokarna') {
    const elapsedGs = animFrame - fieldEnterFrame;
    if (elapsedGs >= 400 && elapsedGs < 1400) {
      const rise      = Math.min(1, (elapsedGs - 400) / 300);
      const fall      = Math.max(0, 1 - (elapsedGs - 1100) / 300);
      const intensity = rise * fall;
      ctx.save();
      for (let i = 0; i < 22; i++) {
        const sx    = ((i * 71 + Math.floor(animFrame * 0.9) + i * 23) % canvas.width + canvas.width) % canvas.width;
        const sy    = ((i * 31 + 7) % (3 * tileSize - 6)) + 3;
        const blink = Math.pow(Math.abs(Math.sin(animFrame * 0.068 + i * 1.4)), 2.8);
        if (blink < 0.28) continue;
        ctx.globalAlpha = intensity * blink * 0.60;
        ctx.fillStyle = '#FFE880';
        ctx.fillRect(sx - 2, sy, 4, 1);
        ctx.fillRect(sx, sy - 2, 1, 4);
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夜の生物発光の波 ──
  if (loc === 'gokarna') {
    const elapsedBl = animFrame - fieldEnterFrame;
    if (elapsedBl >= 1800) {
      const mt    = Math.min(1, (elapsedBl - 1800) / 500);
      const foamY = 3 * tileSize;
      for (let wave = 0; wave < 5; wave++) {
        const speed  = 0.022 + wave * 0.007;
        const phase  = (animFrame * speed + wave * 2.4) % (Math.PI * 2);
        const yOff   = Math.sin(phase) * 3;
        const alpha  = mt * (0.24 + 0.14 * Math.sin(phase * 0.8));
        if (alpha < 0.018) continue;
        const startX = (wave * 63 + animFrame * (0.10 + wave * 0.04)) % (canvas.width + 40) - 20;
        const len    = 58 + wave * 18;
        ctx.save();
        ctx.globalAlpha = alpha;
        const bg = ctx.createLinearGradient(startX, 0, startX + len, 0);
        bg.addColorStop(0,   'rgba(60,220,180,0)');
        bg.addColorStop(0.4, 'rgba(80,255,200,0.9)');
        bg.addColorStop(1,   'rgba(60,220,180,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(startX, foamY - 3 + yOff, len, 3);
        ctx.restore();
      }
    }
  }

  // ── ゴーカルナ: イルカのシルエット ──
  if (loc === 'gokarna') {
    const dp = animFrame % 380;
    if (dp < 78) {
      const t       = dp / 78;
      const dx      = t * canvas.width * 0.62 + canvas.width * 0.08;
      const arcH    = Math.sin(t * Math.PI) * 20;
      const waterY  = 2.5 * tileSize;
      const dy      = waterY - arcH;
      const fade    = t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1;
      if (arcH > 1.5) {
        const tilt = -0.3 * (1 - t * 2); // 前半上向き、後半下向き
        ctx.save();
        ctx.globalAlpha = fade * 0.54;
        ctx.fillStyle = '#1A2E3C';
        // 胴体
        ctx.beginPath();
        ctx.ellipse(dx, dy, 13, 4.5, tilt, 0, Math.PI * 2);
        ctx.fill();
        // 背びれ
        ctx.beginPath();
        ctx.moveTo(dx + 2, dy - 4);
        ctx.lineTo(dx + 7, dy - 11);
        ctx.lineTo(dx + 9, dy - 4);
        ctx.closePath();
        ctx.fill();
        // 尾びれ (二股)
        ctx.beginPath();
        ctx.moveTo(dx - 11, dy + 1);
        ctx.lineTo(dx - 17, dy - 5);
        ctx.lineTo(dx - 14, dy + 1);
        ctx.lineTo(dx - 17, dy + 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ── ゴーカルナ: 水平線の漁船 ──
  if (loc === 'gokarna') {
    const boatDefs = [
      { speed: 0.038, phase: 0,   row: 0 },
      { speed: 0.025, phase: 180, row: 1 },
      { speed: 0.050, phase: 360, row: 0 },
    ];
    ctx.save();
    for (let b = 0; b < boatDefs.length; b++) {
      const bd  = boatDefs[b];
      const bx  = ((animFrame * bd.speed + bd.phase) % (canvas.width + 50)) - 25;
      const by  = bd.row * tileSize + tileSize * 0.48 + Math.sin(animFrame * 0.016 + b * 1.4) * 1.4;
      const sc  = 0.50 + bd.row * 0.18;
      const a   = 0.32 + 0.07 * Math.sin(animFrame * 0.012 + b);
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#152535';
      ctx.strokeStyle = '#152535';
      // 船体
      ctx.beginPath();
      ctx.moveTo(bx - 11 * sc, by + 2);
      ctx.quadraticCurveTo(bx, by + 4 * sc, bx + 11 * sc, by + 2);
      ctx.lineTo(bx + 9 * sc,  by - 1);
      ctx.quadraticCurveTo(bx, by + 2 * sc, bx - 9 * sc, by - 1);
      ctx.closePath();
      ctx.fill();
      // マスト
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(bx - 1, by - 1);
      ctx.lineTo(bx - 1, by - 11 * sc);
      ctx.stroke();
      // 帆
      ctx.globalAlpha = a * 0.65;
      ctx.beginPath();
      ctx.moveTo(bx - 1, by - 11 * sc);
      ctx.lineTo(bx + 7 * sc, by - 4 * sc);
      ctx.lineTo(bx - 1,      by - 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 海の岩のアーチ ──
  if (loc === 'gokarna') {
    // 画面右に海食洞/岩のアーチのシルエット
    const archX = canvas.width * 0.88;
    const archY = tileSize * 2.0;  // 水平線の高さ
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle   = '#1A1408';
    // 右側の岩の塊
    ctx.beginPath();
    ctx.moveTo(archX + 20, archY + 20);
    ctx.lineTo(archX + 20, archY - 35);
    ctx.quadraticCurveTo(archX + 10, archY - 42, archX, archY - 38);
    ctx.quadraticCurveTo(archX - 12, archY - 32, archX - 14, archY - 18);
    ctx.lineTo(archX - 14, archY + 5);  // アーチの左脚
    // アーチの穴（空白で海が見える）
    ctx.quadraticCurveTo(archX - 5, archY - 12, archX + 5, archY - 8);
    ctx.quadraticCurveTo(archX + 12, archY - 4, archX + 14, archY + 5);
    ctx.lineTo(archX + 14, archY + 20);
    ctx.closePath();
    ctx.fill();
    // 岩の質感（細かい線）
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = '#2A1E10';
    ctx.lineWidth   = 0.6;
    for (let line = 0; line < 4; line++) {
      ctx.beginPath();
      ctx.moveTo(archX - 10, archY - 20 + line * 8);
      ctx.lineTo(archX - 5, archY - 22 + line * 8);
      ctx.stroke();
    }
    // アーチの穴から見える海の輝き（明るい青）
    ctx.globalAlpha = 0.12;
    ctx.fillStyle   = '#80C0E8';
    ctx.beginPath();
    ctx.ellipse(archX + 2, archY - 3, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── ゴーカルナ: 夕暮れの海面の光の道 ──
  if (loc === 'gokarna') {
    const elapsedPath = animFrame - fieldEnterFrame;
    const pathFadeIn  = Math.min(1, Math.max(0, (elapsedPath - 600) / 400));
    const pathFadeOut = Math.max(0, 1 - Math.max(0, (elapsedPath - 2400) / 350));
    const pathAlpha   = pathFadeIn * pathFadeOut * 0.68;
    if (pathAlpha > 0.005) {
      ctx.save();
      // Sun position (setting, near horizon)
      const sunX = canvas.width * 0.5;
      const sunY = canvas.height * 0.20;
      // Reflection column on water — tapering from horizon to near
      const nearY  = canvas.height * 0.95;
      const farY   = canvas.height * 0.50;
      const nearW  = canvas.width  * 0.28;
      const farW   = canvas.width  * 0.06;
      // Shimmer oscillation
      const shimmer = Math.sin(animFrame * 0.07) * 0.12 + 0.88;
      ctx.globalAlpha = pathAlpha * shimmer;
      // Build trapezoid path for the light column
      const pathGrad = ctx.createLinearGradient(sunX, farY, sunX, nearY);
      pathGrad.addColorStop(0,   'rgba(255,210,60,0)');
      pathGrad.addColorStop(0.2, 'rgba(255,195,40,' + (pathAlpha * 0.60).toFixed(3) + ')');
      pathGrad.addColorStop(0.6, 'rgba(255,170,20,' + (pathAlpha * 0.45).toFixed(3) + ')');
      pathGrad.addColorStop(1,   'rgba(255,140,10,' + (pathAlpha * 0.25).toFixed(3) + ')');
      ctx.fillStyle = pathGrad;
      ctx.beginPath();
      ctx.moveTo(sunX - farW * 0.5, farY);
      ctx.lineTo(sunX + farW * 0.5, farY);
      ctx.lineTo(sunX + nearW * 0.5, nearY);
      ctx.lineTo(sunX - nearW * 0.5, nearY);
      ctx.closePath();
      ctx.fill();
      // Horizontal sparkle lines across the column
      const sparkLines = 14;
      for (let si = 0; si < sparkLines; si++) {
        const sy = farY + (nearY - farY) * (si / sparkLines);
        const frac = si / sparkLines;
        const w = (farW + (nearW - farW) * frac) * 0.5;
        const sparkPhase = Math.sin(animFrame * 0.11 + si * 0.7) * 0.5 + 0.5;
        ctx.globalAlpha = pathAlpha * sparkPhase * 0.35;
        ctx.strokeStyle = 'rgba(255,240,120,1)';
        ctx.lineWidth   = 0.6 + frac * 0.8;
        ctx.beginPath();
        ctx.moveTo(sunX - w, sy);
        ctx.lineTo(sunX + w, sy);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 砂浜の貝殻 ──
  if (loc === 'gokarna') {
    const elapsedShell = animFrame - fieldEnterFrame;
    const shellAlpha = Math.min(1, elapsedShell / 220) * 0.80;
    if (shellAlpha > 0) {
      ctx.save();
      // Scattered shells along the waterline
      const shells = [
        { x: 0.06, y: 0.88, r: 4.5, rot: 0.3,  kind: 0, hue: 20  },
        { x: 0.14, y: 0.92, r: 3.0, rot: 1.1,  kind: 1, hue: 15  },
        { x: 0.23, y: 0.86, r: 5.0, rot: -0.4, kind: 0, hue: 25  },
        { x: 0.33, y: 0.91, r: 3.5, rot: 0.8,  kind: 2, hue: 10  },
        { x: 0.43, y: 0.89, r: 4.0, rot: -1.0, kind: 1, hue: 30  },
        { x: 0.52, y: 0.93, r: 3.0, rot: 0.5,  kind: 0, hue: 18  },
        { x: 0.62, y: 0.87, r: 4.8, rot: 1.4,  kind: 2, hue: 22  },
        { x: 0.72, y: 0.91, r: 3.2, rot: -0.7, kind: 1, hue: 28  },
        { x: 0.82, y: 0.88, r: 4.2, rot: 0.2,  kind: 0, hue: 12  },
        { x: 0.91, y: 0.93, r: 3.6, rot: -1.2, kind: 2, hue: 35  },
      ];
      for (const sh of shells) {
        const sx = canvas.width  * sh.x;
        const sy = canvas.height * sh.y;
        const s  = sh.r;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(sh.rot);
        ctx.globalAlpha = shellAlpha * 0.90;
        if (sh.kind === 0) {
          // Conch-like spiral
          const shellColor = 'hsl(' + sh.hue + ',45%,78%)';
          ctx.fillStyle = shellColor;
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 1.4, s * 0.9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'hsl(' + sh.hue + ',30%,60%)';
          ctx.lineWidth = 0.6;
          // Spiral lines
          for (let li = 0; li < 3; li++) {
            ctx.globalAlpha = shellAlpha * 0.5;
            ctx.beginPath();
            ctx.ellipse(li * 0.8 - s * 0.3, 0, s * (0.5 - li * 0.1), s * (0.35 - li * 0.07), 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (sh.kind === 1) {
          // Clam-like bi-valve
          ctx.fillStyle = 'hsl(' + (sh.hue + 8) + ',40%,82%)';
          ctx.beginPath();
          ctx.ellipse(0, 0, s, s * 0.7, 0, 0, Math.PI);
          ctx.fill();
          ctx.fillStyle = 'hsl(' + sh.hue + ',40%,72%)';
          ctx.beginPath();
          ctx.ellipse(0, 0, s, s * 0.7, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'hsl(' + sh.hue + ',25%,60%)';
          ctx.lineWidth = 0.7;
          ctx.globalAlpha = shellAlpha * 0.45;
          for (let ri = 1; ri <= 4; ri++) {
            ctx.beginPath();
            ctx.ellipse(0, 0, s * ri * 0.22, s * 0.65 * ri * 0.22, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          // Small cone shell
          ctx.fillStyle = 'hsl(' + sh.hue + ',50%,74%)';
          ctx.beginPath();
          ctx.moveTo(-s, 0);
          ctx.quadraticCurveTo(-s * 0.2, -s * 0.9, s * 1.1, 0);
          ctx.quadraticCurveTo(-s * 0.2,  s * 0.9, -s, 0);
          ctx.fill();
          ctx.strokeStyle = 'hsl(' + (sh.hue + 10) + ',35%,55%)';
          ctx.lineWidth = 0.5;
          ctx.globalAlpha = shellAlpha * 0.4;
          for (let band = 1; band <= 3; band++) {
            ctx.beginPath();
            ctx.moveTo(-s + band * s * 0.55, -s * 0.5 * (1 - band * 0.2));
            ctx.lineTo(-s + band * s * 0.55,  s * 0.5 * (1 - band * 0.2));
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 波打ち際の泡沫 ──
  if (loc === 'gokarna') {
    const elapsedFoam = animFrame - fieldEnterFrame;
    const foamAlpha = Math.min(1, elapsedFoam / 180) * 0.75;
    if (foamAlpha > 0) {
      ctx.save();
      // Multiple foam lines at staggered beach positions
      const foamLines = [
        { yBase: 0.80, waveAmp: 4, waveFreq: 0.028, cycleLen: 90,  cycleOff: 0   },
        { yBase: 0.84, waveAmp: 3, waveFreq: 0.032, cycleLen: 110, cycleOff: 35  },
        { yBase: 0.88, waveAmp: 5, waveFreq: 0.024, cycleLen: 75,  cycleOff: 18  },
      ];
      for (const fl of foamLines) {
        const cp = (animFrame + fl.cycleOff) % fl.cycleLen;
        const ct = cp / fl.cycleLen; // 0..1
        // Rush-in phase (0..0.4), hold (0.4..0.7), recede (0.7..1)
        let runT;
        if (ct < 0.4)      runT = ct / 0.4;
        else if (ct < 0.7) runT = 1.0;
        else               runT = 1.0 - (ct - 0.7) / 0.3;
        const foamY = canvas.height * fl.yBase - runT * 18;
        // Draw bubbly foam stripe
        const steps = 24;
        for (let xi = 0; xi < steps; xi++) {
          const xf = (xi / steps) * canvas.width;
          const wy = foamY + Math.sin(xf * fl.waveFreq + animFrame * 0.04) * fl.waveAmp;
          const bubbleR = (1.2 + Math.sin(xf * 0.17 + animFrame * 0.08) * 0.6) * runT;
          if (bubbleR < 0.1) continue;
          // Dense foam patch
          const foamDensity = 0.5 + Math.sin(xf * 0.09 + animFrame * 0.05) * 0.5;
          if (foamDensity < 0) continue;
          ctx.globalAlpha = foamAlpha * foamDensity * runT * 0.85;
          ctx.fillStyle = 'rgba(240,248,255,1)';
          ctx.beginPath();
          ctx.ellipse(xf, wy, bubbleR * 2.2, bubbleR * 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Thin leading edge line
        ctx.globalAlpha = foamAlpha * runT * 0.55;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let xi = 0; xi <= steps; xi++) {
          const xf = (xi / steps) * canvas.width;
          const wy = foamY + Math.sin(xf * fl.waveFreq + animFrame * 0.04) * fl.waveAmp;
          if (xi === 0) ctx.moveTo(xf, wy); else ctx.lineTo(xf, wy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 岩場の磯蟹 ──
  if (loc === 'gokarna') {
    const elapsedCrab = animFrame - fieldEnterFrame;
    const crabAlpha = Math.min(1, elapsedCrab / 200) * 0.82;
    if (crabAlpha > 0) {
      ctx.save();
      const crabs = [
        { bx: 0.12, by: 0.82, size: 5, speed: 0.008, phase: 0.0, dir: 1  },
        { bx: 0.22, by: 0.87, size: 4, speed: 0.011, phase: 1.2, dir: -1 },
        { bx: 0.31, by: 0.79, size: 6, speed: 0.007, phase: 2.5, dir: 1  },
        { bx: 0.07, by: 0.91, size: 4, speed: 0.013, phase: 0.7, dir: -1 },
        { bx: 0.41, by: 0.85, size: 5, speed: 0.009, phase: 3.1, dir: 1  },
        { bx: 0.18, by: 0.94, size: 3, speed: 0.014, phase: 1.8, dir: -1 },
      ];
      for (const cr of crabs) {
        // Sideways scuttle — oscillate X position
        const scuttle = Math.sin(animFrame * cr.speed + cr.phase) * 18 * cr.dir;
        const legWave = Math.sin(animFrame * cr.speed * 4 + cr.phase);
        const cx = canvas.width  * cr.bx + scuttle;
        const cy = canvas.height * cr.by + Math.abs(legWave) * 1.5;
        const s  = cr.size;
        ctx.globalAlpha = crabAlpha * 0.88;
        // Body — flattened ellipse
        ctx.fillStyle = 'rgba(180,80,30,1)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 1.3, s * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        // Claws
        ctx.fillStyle = 'rgba(200,100,40,1)';
        for (const side of [-1, 1]) {
          const clawX = cx + side * s * 1.8;
          const clawY = cy - s * 0.3 + legWave * side * 1.2;
          ctx.beginPath();
          ctx.ellipse(clawX, clawY, s * 0.7, s * 0.45, side * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Legs (4 per side)
        ctx.strokeStyle = 'rgba(160,60,20,0.7)';
        ctx.lineWidth = 0.8;
        for (let li = 0; li < 4; li++) {
          for (const side of [-1, 1]) {
            const lx0 = cx + side * s * 0.5;
            const ly0 = cy + s * 0.4;
            const lx1 = cx + side * (s * 1.2 + li * 1.8);
            const ly1 = cy + s * 0.9 + Math.sin(animFrame * cr.speed * 4 + li * 0.8 + cr.phase) * 2;
            ctx.beginPath();
            ctx.moveTo(lx0, ly0);
            ctx.lineTo(lx1, ly1);
            ctx.stroke();
          }
        }
        // Eyes on stalks
        ctx.fillStyle = 'rgba(20,20,20,1)';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + side * s * 0.6, cy - s * 0.9, s * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夕日のグリーンフラッシュ ──
  if (loc === 'gokarna') {
    const elapsedGF = animFrame - fieldEnterFrame;
    // Green flash: appears briefly just at sunset moment
    if (elapsedGF >= 1380 && elapsedGF < 1480) {
      const gfT = (elapsedGF - 1380) / 100;
      const gfIntensity = gfT < 0.5 ? gfT * 2 : (1 - gfT) * 2;
      ctx.save();
      const sunX = canvas.width * 0.5;
      const sunY = canvas.height * 0.22;
      // Green flash burst
      ctx.globalAlpha = gfIntensity * 0.85;
      const gfGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 28);
      gfGrad.addColorStop(0, 'rgba(100,255,140,0.95)');
      gfGrad.addColorStop(0.3, 'rgba(60,220,100,0.6)');
      gfGrad.addColorStop(0.7, 'rgba(20,200,80,0.2)');
      gfGrad.addColorStop(1, 'rgba(0,180,60,0)');
      ctx.fillStyle = gfGrad;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 28, 0, Math.PI * 2);
      ctx.fill();
      // Horizontal lens flare streak
      ctx.globalAlpha = gfIntensity * 0.5;
      const streakGrad = ctx.createLinearGradient(0, sunY, canvas.width, sunY);
      streakGrad.addColorStop(0, 'rgba(0,200,80,0)');
      streakGrad.addColorStop(0.4, 'rgba(80,255,140,0.3)');
      streakGrad.addColorStop(0.5, 'rgba(150,255,180,0.5)');
      streakGrad.addColorStop(0.6, 'rgba(80,255,140,0.3)');
      streakGrad.addColorStop(1, 'rgba(0,200,80,0)');
      ctx.fillStyle = streakGrad;
      ctx.fillRect(0, sunY - 3, canvas.width, 6);
      ctx.restore();
    }
    // Faint green tint on horizon before/after
    if (elapsedGF >= 1300 && elapsedGF < 1550) {
      const tintT = elapsedGF < 1380 ? (elapsedGF - 1300) / 80 : Math.max(0, 1 - (elapsedGF - 1480) / 70);
      ctx.save();
      ctx.globalAlpha = tintT * 0.18;
      const horizGrad = ctx.createLinearGradient(0, canvas.height * 0.15, 0, canvas.height * 0.28);
      horizGrad.addColorStop(0, 'rgba(40,220,90,0.4)');
      horizGrad.addColorStop(1, 'rgba(40,220,90,0)');
      ctx.fillStyle = horizGrad;
      ctx.fillRect(0, canvas.height * 0.15, canvas.width, canvas.height * 0.13);
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 磯のイソギンチャク ──
  if (loc === 'gokarna') {
    const elapsedAnem = animFrame - fieldEnterFrame;
    const anemAlpha = Math.min(1, elapsedAnem / 230) * 0.78;
    if (anemAlpha > 0) {
      ctx.save();
      // Sea anemones in tide pools, tentacles swaying
      const anemones = [
        { x: 0.09, y: 0.76, tentacles: 12, r: 8,  hue: 0   },
        { x: 0.28, y: 0.79, tentacles: 10, r: 6.5, hue: 200 },
        { x: 0.52, y: 0.75, tentacles: 14, r: 9,  hue: 280 },
        { x: 0.74, y: 0.77, tentacles: 10, r: 7,  hue: 30  },
        { x: 0.91, y: 0.76, tentacles: 11, r: 7.5, hue: 160 },
      ];
      for (const an of anemones) {
        const ax = canvas.width * an.x;
        const ay = canvas.height * an.y;
        // Base disc
        ctx.globalAlpha = anemAlpha * 0.75;
        ctx.fillStyle = 'hsl(' + an.hue + ',70%,30%)';
        ctx.beginPath();
        ctx.ellipse(ax, ay, an.r, an.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Tentacles waving
        for (let t = 0; t < an.tentacles; t++) {
          const ta = (t / an.tentacles) * Math.PI * 2;
          const wave = Math.sin(animFrame * 0.035 + t * 0.6 + an.x * 5) * 6;
          const tentLen = an.r * 1.4;
          const tipX = ax + Math.cos(ta) * an.r * 0.7 + wave * 0.3;
          const tipY = ay - tentLen + Math.cos(animFrame * 0.025 + t * 0.8) * 3;
          ctx.globalAlpha = anemAlpha * 0.7;
          ctx.strokeStyle = 'hsl(' + (an.hue + 20) + ',75%,55%)';
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(ax + Math.cos(ta) * an.r * 0.5, ay - 2);
          ctx.quadraticCurveTo(
            ax + Math.cos(ta) * an.r + wave,
            ay - tentLen * 0.5,
            tipX, tipY
          );
          ctx.stroke();
          // Tip bulb
          ctx.globalAlpha = anemAlpha * 0.8;
          ctx.fillStyle = 'hsl(' + (an.hue + 40) + ',80%,70%)';
          ctx.beginPath();
          ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        // Oral disc center
        ctx.globalAlpha = anemAlpha * 0.9;
        ctx.fillStyle = 'hsl(' + (an.hue + 60) + ',60%,65%)';
        ctx.beginPath();
        ctx.ellipse(ax, ay - 3, an.r * 0.35, an.r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 砂の砂金 ──
  if (loc === 'gokarna') {
    const elapsedGold = animFrame - fieldEnterFrame;
    const goldIn = Math.min(1, Math.max(0, (elapsedGold - 600) / 300));
    const goldOut = Math.max(0, 1 - (elapsedGold - 1800) / 400);
    const goldAlpha = goldIn * goldOut * 0.65;
    if (goldAlpha > 0.005) {
      ctx.save();
      // Tiny gold flecks in the wet sand catching sunlight
      const fleckCount = 35;
      for (let gi = 0; gi < fleckCount; gi++) {
        const gx = canvas.width * (0.03 + (gi % 9) * 0.11 + Math.sin(gi * 1.7) * 0.03);
        const gy = canvas.height * (0.78 + (gi % 5) * 0.04 + Math.cos(gi * 1.1) * 0.01);
        const twinkle = Math.pow((Math.sin(animFrame * 0.1 + gi * 0.83) + 1) / 2, 3);
        if (twinkle < 0.1) continue;
        ctx.globalAlpha = goldAlpha * twinkle * 0.8;
        const gr = 1.5 + twinkle * 1.5;
        const gGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * 2.5);
        gGrad.addColorStop(0, 'rgba(255,220,60,1)');
        gGrad.addColorStop(0.4, 'rgba(255,185,30,0.5)');
        gGrad.addColorStop(1, 'rgba(220,160,0,0)');
        ctx.fillStyle = gGrad;
        ctx.beginPath();
        ctx.arc(gx, gy, gr * 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Sharp glint cross
        if (twinkle > 0.7) {
          ctx.strokeStyle = 'rgba(255,245,180,0.9)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(gx - gr * 2, gy);
          ctx.lineTo(gx + gr * 2, gy);
          ctx.moveTo(gx, gy - gr * 2);
          ctx.lineTo(gx, gy + gr * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夜の月輪 ──
  if (loc === 'gokarna') {
    const elapsedMoonHalo = animFrame - fieldEnterFrame;
    if (elapsedMoonHalo >= 1700) {
      const mhAlpha = Math.min(1, (elapsedMoonHalo - 1700) / 350) * 0.65;
      ctx.save();
      const moonHX = canvas.width * 0.72;
      const moonHY = canvas.height * 0.1;
      // Moon
      ctx.globalAlpha = mhAlpha * 0.9;
      ctx.fillStyle = 'rgba(255,255,240,0.95)';
      ctx.beginPath();
      ctx.arc(moonHX, moonHY, 9, 0, Math.PI * 2);
      ctx.fill();
      // Halo rings (ice crystal effect)
      const halos = [
        { r: 28, a: 0.35 },
        { r: 32, a: 0.2 },
        { r: 36, a: 0.1 },
      ];
      for (const halo of halos) {
        ctx.globalAlpha = mhAlpha * halo.a;
        ctx.strokeStyle = 'rgba(220,230,255,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(moonHX, moonHY, halo.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Radial shimmer in halo
      const shimmerCount = 24;
      for (let shi = 0; shi < shimmerCount; shi++) {
        const shAngle = (shi / shimmerCount) * Math.PI * 2 + animFrame * 0.005;
        const shAlpha = mhAlpha * (Math.sin(animFrame * 0.04 + shi * 0.5) + 1) / 2 * 0.2;
        ctx.globalAlpha = shAlpha;
        ctx.strokeStyle = 'rgba(200,215,255,0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(moonHX + Math.cos(shAngle) * 24, moonHY + Math.sin(shAngle) * 24);
        ctx.lineTo(moonHX + Math.cos(shAngle) * 38, moonHY + Math.sin(shAngle) * 38);
        ctx.stroke();
      }
      // Reflection path on sea
      ctx.globalAlpha = mhAlpha * 0.3;
      const refGrad = ctx.createLinearGradient(moonHX, canvas.height * 0.35, moonHX, canvas.height * 0.7);
      refGrad.addColorStop(0, 'rgba(220,230,255,0.4)');
      refGrad.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = refGrad;
      ctx.beginPath();
      ctx.ellipse(moonHX, canvas.height * 0.52, 20, canvas.height * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 浜辺の風紋 ──
  if (loc === 'gokarna') {
    const elapsedSandRipple = animFrame - fieldEnterFrame;
    const srAlpha = Math.min(1, elapsedSandRipple / 220) * 0.55;
    if (srAlpha > 0) {
      ctx.save();
      // Sand ripple patterns on the beach (parallel curves)
      const rippleCount = 10;
      const rippleBaseY = canvas.height * 0.8;
      const rippleSpacing = 7;
      for (let ri = 0; ri < rippleCount; ri++) {
        const ry = rippleBaseY + ri * rippleSpacing;
        if (ry > canvas.height) break;
        const drift = Math.sin(animFrame * 0.008 + ri * 0.4) * 5;
        const waviness = 3 + Math.sin(ri * 0.6) * 1.5;
        ctx.globalAlpha = srAlpha * (1 - ri / rippleCount) * 0.6;
        ctx.strokeStyle = 'rgba(180,160,120,0.5)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, ry + drift);
        for (let wx = 0; wx < canvas.width; wx += 15) {
          const wy = ry + drift + Math.sin((wx + animFrame * 2) * 0.02) * waviness;
          ctx.lineTo(wx, wy);
        }
        ctx.stroke();
        // Highlight on ridge
        ctx.strokeStyle = 'rgba(220,205,165,0.3)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, ry + drift - 1);
        for (let wx = 0; wx < canvas.width; wx += 15) {
          const wy = ry + drift - 1 + Math.sin((wx + animFrame * 2) * 0.02) * waviness;
          ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 薄明光線 ──
  if (loc === 'gokarna') {
    const elapsedCrRay = animFrame - fieldEnterFrame;
    const crIn = Math.min(1, Math.max(0, (elapsedCrRay - 1000) / 400));
    const crOut = Math.max(0, 1 - (elapsedCrRay - 2200) / 400);
    const crAlpha = crIn * crOut * 0.45;
    if (crAlpha > 0.005) {
      ctx.save();
      // Crepuscular rays fanning from behind cloud gaps
      const sourceX = canvas.width * 0.42;
      const sourceY = -30;
      const rayCount = 8;
      for (let ri = 0; ri < rayCount; ri++) {
        const baseAngle = Math.PI * (0.25 + ri * 0.07);
        const angleSwing = Math.sin(animFrame * 0.009 + ri * 0.5) * 0.015;
        const rAngle = baseAngle + angleSwing;
        const rayLen = canvas.height * 0.9;
        const endX = sourceX + Math.cos(rAngle) * rayLen;
        const endY = sourceY + Math.sin(rAngle) * rayLen;
        const spreadW = 0.03 + (ri % 3) * 0.01;
        const rayAlpha = crAlpha * (0.5 + Math.sin(ri * 0.8) * 0.3) * (1 - ri * 0.05);
        const rGrad = ctx.createLinearGradient(sourceX, sourceY, endX, endY);
        rGrad.addColorStop(0, 'rgba(255,240,180,' + (rayAlpha * 0.5).toFixed(3) + ')');
        rGrad.addColorStop(0.3, 'rgba(255,220,140,' + (rayAlpha * 0.2).toFixed(3) + ')');
        rGrad.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = rGrad;
        ctx.beginPath();
        ctx.moveTo(sourceX - 3, sourceY);
        ctx.lineTo(sourceX + 3, sourceY);
        ctx.lineTo(endX + Math.sin(rAngle) * rayLen * spreadW, endY);
        ctx.lineTo(endX - Math.sin(rAngle) * rayLen * spreadW, endY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 岩場の海のスプレー ──
  if (loc === 'gokarna') {
    const elapsedSpray = animFrame - fieldEnterFrame;
    const sprayAlpha = Math.min(1, elapsedSpray / 200) * 0.65;
    if (sprayAlpha > 0) {
      ctx.save();
      // Sea spray on rocks: bursts of mist when waves hit
      const rocks = [
        { x: 0.12, y: 0.55, burstCycle: 90, phase: 0 },
        { x: 0.42, y: 0.52, burstCycle: 70, phase: 25 },
        { x: 0.68, y: 0.56, burstCycle: 80, phase: 15 },
        { x: 0.88, y: 0.53, burstCycle: 95, phase: 40 },
      ];
      for (const rock of rocks) {
        const rx = canvas.width * rock.x;
        const ry = canvas.height * rock.y;
        const burstPhase = (animFrame + rock.phase) % rock.burstCycle;
        const burstT = burstPhase / rock.burstCycle;
        const burstIntensity = burstT < 0.35 ?
          Math.sin(burstT / 0.35 * Math.PI) :
          Math.max(0, 1 - (burstT - 0.35) / 0.65);
        if (burstIntensity < 0.05) continue;
        // Spray mist fan
        const particleCount = 12;
        for (let sp = 0; sp < particleCount; sp++) {
          const spAngle = Math.PI * (1.1 + sp / particleCount * 0.8) - Math.PI;
          const spDist = burstIntensity * (18 + sp * 2) * (1 + Math.sin(sp * 0.9) * 0.3);
          const spX = rx + Math.cos(spAngle) * spDist;
          const spY = ry + Math.sin(spAngle) * spDist - burstIntensity * 8;
          const dropR = 1.5 + Math.sin(sp * 1.3) * 0.8;
          ctx.globalAlpha = sprayAlpha * burstIntensity * (0.4 + Math.sin(sp * 0.6) * 0.3);
          ctx.fillStyle = 'rgba(220,235,245,0.8)';
          ctx.beginPath();
          ctx.arc(spX, spY, dropR, 0, Math.PI * 2);
          ctx.fill();
        }
        // Central mist cloud
        ctx.globalAlpha = sprayAlpha * burstIntensity * 0.3;
        const mistGrad = ctx.createRadialGradient(rx, ry - 6, 0, rx, ry, 16 * burstIntensity);
        mistGrad.addColorStop(0, 'rgba(240,245,255,0.5)');
        mistGrad.addColorStop(1, 'rgba(220,235,250,0)');
        ctx.fillStyle = mistGrad;
        ctx.beginPath();
        ctx.arc(rx, ry - 4, 16 * burstIntensity, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 砂浜の波模様 ──
  if (loc === 'gokarna') {
    const elapsedWavePat = animFrame - fieldEnterFrame;
    const wpAlpha = Math.min(1, elapsedWavePat / 180) * 0.6;
    if (wpAlpha > 0) {
      ctx.save();
      // Concentric arc patterns left by receding waves on wet sand
      const arcCount = 6;
      for (let arc = 0; arc < arcCount; arc++) {
        // Each arc shifts position over time (waves come and go)
        const arcPhase = ((animFrame * 0.15 + arc * 45) % 70) / 70;
        const arcY = canvas.height * (0.82 - arcPhase * 0.08);
        const arcW = canvas.width * (0.7 + arcPhase * 0.2);
        const arcAlpha = wpAlpha * (1 - arcPhase) * 0.55;
        if (arcAlpha < 0.02) continue;
        ctx.globalAlpha = arcAlpha;
        ctx.strokeStyle = 'rgba(160,190,210,0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(canvas.width * 0.5, arcY + arcW * 0.15, arcW * 0.6,
          Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        // Foam dots along the arc
        const dotCount = Math.floor(arcW * 0.04);
        for (let d = 0; d < dotCount; d++) {
          const dAngle = Math.PI * (1.08 + (d / dotCount) * 0.84);
          const dr = arcW * 0.6;
          const dx = canvas.width * 0.5 + Math.cos(dAngle) * dr;
          const dy = arcY + arcW * 0.15 + Math.sin(dAngle) * dr;
          const visible = Math.sin(animFrame * 0.06 + d * 0.4 + arc) > 0;
          if (!visible) continue;
          ctx.globalAlpha = arcAlpha * 0.5;
          ctx.fillStyle = 'rgba(220,235,245,0.6)';
          ctx.beginPath();
          ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夕陽の海面光道 ──
  if (loc === 'gokarna') {
    const elapsedGlitter = animFrame - fieldEnterFrame;
    const glitIn = Math.min(1, Math.max(0, (elapsedGlitter - 900) / 300));
    const glitOut = Math.max(0, 1 - (elapsedGlitter - 1900) / 400);
    const glitAlpha = glitIn * glitOut * 0.6;
    if (glitAlpha > 0.005) {
      ctx.save();
      // Sunpath: glittering trail stretching from horizon to foreground
      const sunX = canvas.width * 0.5;
      const horizonY = canvas.height * 0.25;
      const shoreY = canvas.height * 0.72;
      // Broad gradient beam
      const beamGrad = ctx.createLinearGradient(sunX, horizonY, sunX, shoreY);
      beamGrad.addColorStop(0, 'rgba(255,200,60,' + (glitAlpha * 0.35).toFixed(3) + ')');
      beamGrad.addColorStop(0.5, 'rgba(255,170,40,' + (glitAlpha * 0.18).toFixed(3) + ')');
      beamGrad.addColorStop(1, 'rgba(255,140,20,0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(sunX - 5, horizonY);
      ctx.lineTo(sunX + 5, horizonY);
      ctx.lineTo(sunX + 80, shoreY);
      ctx.lineTo(sunX - 80, shoreY);
      ctx.closePath();
      ctx.fill();
      // Individual glitter sparkles along the path
      const sparkleCount = 22;
      for (let gs = 0; gs < sparkleCount; gs++) {
        const t = gs / sparkleCount;
        const gx = sunX + (Math.random() < 0.5 ? -1 : 1) * Math.sin(animFrame * 0.02 + gs * 0.9) * (t * 70);
        const gy = horizonY + t * (shoreY - horizonY);
        const twinkle = Math.pow((Math.sin(animFrame * 0.11 + gs * 1.3) + 1) / 2, 2);
        if (twinkle < 0.2) continue;
        ctx.globalAlpha = glitAlpha * twinkle * (1 - t * 0.4);
        const gr = 2 + twinkle * 2;
        const gGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * 2);
        gGrad.addColorStop(0, 'rgba(255,240,150,1)');
        gGrad.addColorStop(1, 'rgba(255,180,50,0)');
        ctx.fillStyle = gGrad;
        ctx.beginPath();
        ctx.arc(gx, gy, gr * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 磯のヒトデ ──
  if (loc === 'gokarna') {
    const elapsedStar = animFrame - fieldEnterFrame;
    const starAlpha = Math.min(1, elapsedStar / 250) * 0.8;
    if (starAlpha > 0) {
      ctx.save();
      // Starfish in tide pools on the rocks
      const starfishes = [
        { x: 0.1,  y: 0.78, r: 10, arms: 5, hue: 15,  rot: 0.3 },
        { x: 0.31, y: 0.81, r: 8,  arms: 5, hue: 25,   rot: 0.8 },
        { x: 0.58, y: 0.77, r: 11, arms: 5, hue: 10,   rot: 1.2 },
        { x: 0.79, y: 0.8,  r: 7,  arms: 5, hue: 340,  rot: 0.5 },
      ];
      for (const sf of starfishes) {
        const sfX = canvas.width * sf.x;
        const sfY = canvas.height * sf.y;
        const slowWave = Math.sin(animFrame * 0.008 + sf.x * 4) * 0.05;
        ctx.globalAlpha = starAlpha * 0.85;
        // Draw star shape with 5 arms
        const armCount = sf.arms;
        const outerR = sf.r;
        const innerR = sf.r * 0.38;
        ctx.fillStyle = 'hsl(' + sf.hue + ',70%,52%)';
        ctx.beginPath();
        for (let ai = 0; ai < armCount * 2; ai++) {
          const angle = (ai / (armCount * 2)) * Math.PI * 2 + sf.rot + slowWave;
          const r = ai % 2 === 0 ? outerR : innerR;
          const px = sfX + Math.cos(angle) * r;
          const py = sfY + Math.sin(angle) * r;
          ai === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        // Texture dots on arms
        ctx.fillStyle = 'hsl(' + (sf.hue - 5) + ',60%,40%)';
        for (let d = 0; d < 5; d++) {
          const da = (d / 5) * Math.PI * 2 + sf.rot + slowWave;
          const dr = outerR * 0.62;
          ctx.globalAlpha = starAlpha * 0.5;
          ctx.beginPath();
          ctx.arc(sfX + Math.cos(da) * dr, sfY + Math.sin(da) * dr, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Center circle
        ctx.globalAlpha = starAlpha * 0.7;
        ctx.fillStyle = 'hsl(' + (sf.hue + 10) + ',55%,62%)';
        ctx.beginPath();
        ctx.arc(sfX, sfY, innerR * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 岩場の海草のなびき ──
  if (loc === 'gokarna') {
    const elapsedSeaweed = animFrame - fieldEnterFrame;
    const swAlpha = Math.min(1, elapsedSeaweed / 200) * 0.75;
    if (swAlpha > 0) {
      ctx.save();
      // Clusters of seaweed on rocks swaying with tide
      const clusters = [
        { x: 0.07, y: 0.72, count: 6, hue: 140 },
        { x: 0.24, y: 0.76, count: 5, hue: 150 },
        { x: 0.48, y: 0.71, count: 7, hue: 135 },
        { x: 0.72, y: 0.74, count: 5, hue: 145 },
        { x: 0.9,  y: 0.73, count: 4, hue: 138 },
      ];
      for (const cl of clusters) {
        const clX = canvas.width * cl.x;
        const clY = canvas.height * cl.y;
        for (let sw = 0; sw < cl.count; sw++) {
          const rootX = clX + (sw - (cl.count - 1) / 2) * 5;
          const rootY = clY + (sw % 2) * 3;
          const len = 14 + sw * 3;
          const waveDir = Math.sin(animFrame * 0.025 + cl.x * 8 + sw * 0.6) * 10;
          const segments = 4;
          ctx.globalAlpha = swAlpha * (0.6 + Math.sin(sw * 0.7) * 0.2);
          ctx.strokeStyle = 'hsl(' + cl.hue + ',' + (65 + sw * 4) + '%,' + (25 + sw * 3) + '%)';
          ctx.lineWidth = 2.2 - sw * 0.1;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(rootX, rootY);
          let prevX = rootX, prevY = rootY;
          for (let seg = 1; seg <= segments; seg++) {
            const t = seg / segments;
            const segX = rootX + waveDir * t * t;
            const segY = rootY - len * t;
            ctx.quadraticCurveTo(
              (prevX + segX) / 2 + Math.sin(animFrame * 0.03 + sw + seg) * 3 * t,
              (prevY + segY) / 2,
              segX, segY
            );
            prevX = segX; prevY = segY;
          }
          ctx.stroke();
          // Small leaf fronds at tip
          ctx.fillStyle = 'hsl(' + (cl.hue + 10) + ',55%,38%)';
          ctx.globalAlpha = swAlpha * 0.5;
          ctx.beginPath();
          ctx.ellipse(prevX, prevY, 4, 2, waveDir * 0.08, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 波の中の魚の群れ ──
  if (loc === 'gokarna') {
    const elapsedFish = animFrame - fieldEnterFrame;
    const fishAlpha = Math.min(1, elapsedFish / 220) * 0.7;
    if (fishAlpha > 0) {
      ctx.save();
      // Shoal of small fish visible through translucent wave
      const shoalCount = 18;
      const shoalCX = canvas.width * 0.38;
      const shoalCY = canvas.height * 0.58;
      const shoalDrift = Math.sin(animFrame * 0.012) * 40;
      for (let fi = 0; fi < shoalCount; fi++) {
        const angle = (fi / shoalCount) * Math.PI * 2 + animFrame * 0.008;
        const spread = 28 + (fi % 3) * 10;
        const fx = shoalCX + shoalDrift + Math.cos(angle) * spread * (1 + Math.sin(fi) * 0.3);
        const fy = shoalCY + Math.sin(angle) * spread * 0.4 + Math.sin(animFrame * 0.03 + fi) * 4;
        const swimDir = Math.cos(animFrame * 0.008 + fi * 0.2);
        const faceRight = swimDir > 0;
        const bodyLen = 6 + (fi % 3) * 2;
        ctx.globalAlpha = fishAlpha * (0.5 + Math.sin(fi * 0.9 + animFrame * 0.02) * 0.2);
        ctx.fillStyle = 'rgba(80,160,220,0.7)';
        // Body ellipse
        ctx.beginPath();
        ctx.ellipse(fx, fy, bodyLen, bodyLen * 0.4, faceRight ? 0.1 : Math.PI - 0.1, 0, Math.PI * 2);
        ctx.fill();
        // Tail fin
        ctx.fillStyle = 'rgba(60,130,190,0.6)';
        ctx.beginPath();
        const tailDir = faceRight ? -1 : 1;
        ctx.moveTo(fx + tailDir * bodyLen, fy);
        ctx.lineTo(fx + tailDir * (bodyLen + 5), fy - 3);
        ctx.lineTo(fx + tailDir * (bodyLen + 5), fy + 3);
        ctx.closePath();
        ctx.fill();
        // Shimmer scale highlight
        ctx.globalAlpha = fishAlpha * 0.3;
        ctx.fillStyle = 'rgba(200,240,255,0.6)';
        ctx.beginPath();
        ctx.ellipse(fx + tailDir * (-bodyLen * 0.2), fy - bodyLen * 0.1, bodyLen * 0.3, bodyLen * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夜明けのカモメの群れ ──
  if (loc === 'gokarna') {
    const elapsedGull = animFrame - fieldEnterFrame;
    const gullAlpha = Math.min(1, Math.max(0, (elapsedGull - 80) / 200)) * 0.8;
    if (gullAlpha > 0) {
      ctx.save();
      const gullCount = 12;
      for (let gi = 0; gi < gullCount; gi++) {
        // Each gull circles in a loose flock
        const orbitCX = canvas.width * (0.3 + Math.sin(gi * 0.9) * 0.3);
        const orbitCY = canvas.height * (0.15 + (gi % 4) * 0.06);
        const orbitR = 30 + gi * 8;
        const speed = 0.018 + gi * 0.003;
        const phase = gi * 0.52;
        const gx = orbitCX + Math.cos(animFrame * speed + phase) * orbitR;
        const gy = orbitCY + Math.sin(animFrame * speed * 0.6 + phase) * orbitR * 0.4;
        // Wing flap
        const flap = Math.sin(animFrame * 0.14 + gi * 0.8);
        const wingAmp = 5 + flap * 4;
        ctx.globalAlpha = gullAlpha * (0.6 + Math.sin(gi * 0.7) * 0.3);
        ctx.strokeStyle = '#e8e8f0';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        // Left wing
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.quadraticCurveTo(gx - 6, gy - wingAmp, gx - 11, gy - flap * 2);
        ctx.stroke();
        // Right wing
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.quadraticCurveTo(gx + 6, gy - wingAmp, gx + 11, gy - flap * 2);
        ctx.stroke();
        // Body dot
        ctx.fillStyle = '#d0d0e0';
        ctx.beginPath();
        ctx.arc(gx, gy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夜の星の海への映り込み ──
  if (loc === 'gokarna') {
    const elapsedStarRef = animFrame - fieldEnterFrame;
    if (elapsedStarRef >= 1600) {
      const starRefAlpha = Math.min(1, (elapsedStarRef - 1600) / 400) * 0.65;
      ctx.save();
      // Reflected star shimmer on the sea surface
      const starRefCount = 28;
      for (let sr = 0; sr < starRefCount; sr++) {
        const refX = canvas.width * (0.04 + (sr % 8) * 0.13 + Math.sin(sr * 2.1) * 0.04);
        const refY = canvas.height * (0.55 + (sr % 5) * 0.07 + Math.cos(sr * 1.3) * 0.02);
        const shimmer = Math.pow((Math.sin(animFrame * 0.055 + sr * 0.83) + 1) / 2, 3);
        if (shimmer < 0.1) continue;
        ctx.globalAlpha = starRefAlpha * shimmer * 0.8;
        // Elongated vertical star reflection on water
        const refGrad = ctx.createRadialGradient(refX, refY, 0, refX, refY, 6);
        refGrad.addColorStop(0, 'rgba(200,220,255,1)');
        refGrad.addColorStop(0.3, 'rgba(160,190,240,0.5)');
        refGrad.addColorStop(1, 'rgba(120,160,220,0)');
        ctx.fillStyle = refGrad;
        ctx.beginPath();
        ctx.ellipse(refX, refY, 2, 6 * shimmer, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(240,245,255,0.9)';
        ctx.beginPath();
        ctx.arc(refX, refY, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夕焼けの遠帆 ──
  if (loc === 'gokarna') {
    const elapsedSail = animFrame - fieldEnterFrame;
    const sailIn = Math.min(1, Math.max(0, (elapsedSail - 600) / 300));
    const sailAlpha = sailIn * 0.7;
    if (sailAlpha > 0.01) {
      ctx.save();
      // Two sailing ships on the horizon, moving slowly
      const ships = [
        { startX: 0.9, speed: -0.06, masts: 2, hullH: 5 },
        { startX: 0.5, speed: -0.04, masts: 1, hullH: 4 },
      ];
      const sunsetTSail = Math.min(1, Math.max(0, (elapsedSail - 1400) / 800));
      const silColor = 'rgba(' + Math.round(40 + sunsetTSail * 20) + ',' + Math.round(20 + sunsetTSail * 15) + ',10,' + sailAlpha.toFixed(3) + ')';
      for (const sh of ships) {
        const cycle = 1200 + sh.startX * 300;
        const progress = ((animFrame * Math.abs(sh.speed) + sh.startX * 600) % (canvas.width * 1.4)) / (canvas.width * 1.4);
        const sx = canvas.width * (1.1 - progress * 1.3);
        const sy = canvas.height * 0.18;
        ctx.globalAlpha = sailAlpha;
        // Hull
        ctx.fillStyle = silColor;
        ctx.beginPath();
        ctx.ellipse(sx, sy + sh.hullH, 18, sh.hullH, 0, 0, Math.PI);
        ctx.fill();
        // Masts and sails
        for (let m = 0; m < sh.masts; m++) {
          const mastX = sx + (m - (sh.masts - 1) / 2) * 14;
          // Mast
          ctx.strokeStyle = silColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(mastX, sy + sh.hullH);
          ctx.lineTo(mastX, sy - 22);
          ctx.stroke();
          // Sail (triangle for simplicity)
          ctx.fillStyle = silColor;
          ctx.beginPath();
          ctx.moveTo(mastX, sy - 22);
          ctx.lineTo(mastX + 12, sy - 4);
          ctx.lineTo(mastX, sy - 4);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 波間のサーファー ──
  if (loc === 'gokarna') {
    const elapsedSurf = animFrame - fieldEnterFrame;
    const surfAlpha = Math.min(1, elapsedSurf / 200) * 0.85;
    if (surfAlpha > 0) {
      ctx.save();
      // Surfer rides a sine-wave shaped wave, cycling
      const cycle = 340;
      const cp = animFrame % cycle;
      const t = cp / cycle;
      // Position along the canvas
      const surfX = canvas.width * (0.85 - t * 0.7);
      const waveY = canvas.height * 0.62 + Math.sin(t * Math.PI * 2.5) * 14;
      // Wave crest (crescent shape)
      ctx.globalAlpha = surfAlpha * 0.6;
      ctx.fillStyle = 'rgba(80,160,200,0.55)';
      ctx.beginPath();
      ctx.moveTo(surfX + 30, waveY + 4);
      ctx.quadraticCurveTo(surfX + 55, waveY - 18, surfX + 80, waveY + 6);
      ctx.quadraticCurveTo(surfX + 55, waveY + 16, surfX + 30, waveY + 4);
      ctx.fill();
      // Foam at crest
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(surfX + 55, waveY - 8, 18, 6, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // Surfboard
      ctx.globalAlpha = surfAlpha * 0.9;
      ctx.fillStyle = '#f0c030';
      ctx.beginPath();
      ctx.ellipse(surfX + 55, waveY + 2, 18, 4, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Surfer silhouette
      const lean = Math.sin(t * Math.PI * 2.5) * 0.35;
      ctx.fillStyle = '#2a2a2a';
      // Body
      ctx.save();
      ctx.translate(surfX + 55, waveY - 4);
      ctx.rotate(lean);
      ctx.beginPath();
      ctx.ellipse(0, -8, 3, 7, lean * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.beginPath();
      ctx.arc(0, -16, 3, 0, Math.PI * 2);
      ctx.fill();
      // Arms outstretched for balance
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-3, -9);
      ctx.lineTo(-12, -6 + lean * 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, -9);
      ctx.lineTo(12, -6 - lean * 8);
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 浜の打ち上げ海月 ──
  if (loc === 'gokarna') {
    const elapsedJelly = animFrame - fieldEnterFrame;
    const jellyAlpha = Math.min(1, elapsedJelly / 180) * 0.8;
    if (jellyAlpha > 0) {
      ctx.save();
      const jellyCount = 5;
      for (let ji = 0; ji < jellyCount; ji++) {
        const jx = canvas.width * (0.1 + ji * 0.19 + Math.sin(ji * 2.3) * 0.04);
        const jy = canvas.height * (0.76 + (ji % 3) * 0.05);
        const jR = 10 + ji * 2;
        // Bioluminescent pulse
        const pulse = (Math.sin(animFrame * 0.05 + ji * 1.3) + 1) / 2;
        const glowR = Math.round(80 + pulse * 60);
        const glowG = Math.round(180 + pulse * 50);
        const glowB = 255;
        ctx.globalAlpha = jellyAlpha * (0.5 + pulse * 0.4);
        // Bell glow
        const jGrad = ctx.createRadialGradient(jx, jy, 0, jx, jy, jR * 1.6);
        jGrad.addColorStop(0, 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',0.7)');
        jGrad.addColorStop(0.5, 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',0.3)');
        jGrad.addColorStop(1, 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',0)');
        ctx.fillStyle = jGrad;
        ctx.beginPath();
        ctx.arc(jx, jy, jR * 1.6, 0, Math.PI * 2);
        ctx.fill();
        // Bell dome
        ctx.globalAlpha = jellyAlpha * (0.6 + pulse * 0.3);
        ctx.fillStyle = 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',0.35)';
        ctx.beginPath();
        ctx.ellipse(jx, jy, jR, jR * 0.6, 0, Math.PI, 0);
        ctx.fill();
        // Tentacles
        for (let t = 0; t < 5; t++) {
          const tx = jx + (t - 2) * (jR * 0.38);
          const tentLen = 10 + t * 2 + Math.sin(animFrame * 0.04 + ji + t) * 4;
          ctx.strokeStyle = 'rgba(' + glowR + ',' + glowG + ',' + glowB + ',0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx, jy);
          ctx.quadraticCurveTo(tx + Math.sin(animFrame * 0.06 + t) * 4, jy + tentLen * 0.5, tx, jy + tentLen);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 海の夕映え雲 ──
  if (loc === 'gokarna') {
    const elapsedCloud = animFrame - fieldEnterFrame;
    const cloudIn = Math.min(1, Math.max(0, (elapsedCloud - 800) / 400));
    const cloudFade = Math.max(0, 1 - (elapsedCloud - 2000) / 500);
    const cloudAlpha = cloudIn * cloudFade * 0.7;
    if (cloudAlpha > 0.01) {
      ctx.save();
      const sunsetT = Math.min(1, Math.max(0, (elapsedCloud - 1200) / 800));
      const sr = Math.round(255 - sunsetT * 30);
      const sg = Math.round(140 - sunsetT * 80);
      const sb = Math.round(60 + sunsetT * 120);
      const clouds = [
        { x: 0.15, y: 0.12, rx: 55, ry: 28, drift: 0.04 },
        { x: 0.55, y: 0.08, rx: 70, ry: 35, drift: 0.03 },
        { x: 0.82, y: 0.15, rx: 45, ry: 22, drift: 0.05 },
      ];
      for (const cl of clouds) {
        const ccx = canvas.width * cl.x + Math.sin(animFrame * cl.drift) * 12;
        const ccy = canvas.height * cl.y + Math.sin(animFrame * cl.drift * 0.7) * 5;
        const grad = ctx.createRadialGradient(ccx, ccy + 10, 0, ccx, ccy, cl.rx);
        grad.addColorStop(0, 'rgba(' + sr + ',' + sg + ',' + sb + ',' + (cloudAlpha * 0.9).toFixed(3) + ')');
        grad.addColorStop(0.5, 'rgba(' + sr + ',' + Math.round(sg * 0.6) + ',' + sb + ',' + (cloudAlpha * 0.5).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(' + sr + ',' + sg + ',' + sb + ',0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(ccx, ccy, cl.rx, cl.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let p = 0; p < 4; p++) {
          const px = ccx + (p - 1.5) * cl.rx * 0.45;
          const py = ccy - cl.ry * 0.3;
          const pr = cl.ry * (0.5 + p * 0.1);
          const pGrad = ctx.createRadialGradient(px, py - pr * 0.2, 0, px, py, pr);
          pGrad.addColorStop(0, 'rgba(255,' + Math.round(200 - sunsetT * 80) + ',' + Math.round(180 - sunsetT * 100) + ',' + (cloudAlpha * 0.8).toFixed(3) + ')');
          pGrad.addColorStop(1, 'rgba(' + sr + ',' + sg + ',' + sb + ',0)');
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.ellipse(px, py, pr * 0.9, pr, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 浜辺のカニ ──
  if (loc === 'gokarna') {
    const elapsedCrab = animFrame - fieldEnterFrame;
    const crabAlpha = Math.min(1, elapsedCrab / 120) * 0.85;
    if (crabAlpha > 0) {
      ctx.save();
      const crabCount = 6;
      for (let ci = 0; ci < crabCount; ci++) {
        const homeX = canvas.width * (0.08 + (ci % 3) * 0.28 + Math.floor(ci / 3) * 0.14);
        const baseY = canvas.height * (0.72 + (ci % 2) * 0.07 + Math.floor(ci / 4) * 0.05);
        const sideAmp = 22 + ci * 4;
        const sideFreq = 0.009 + ci * 0.002;
        const cx2 = homeX + Math.sin(animFrame * sideFreq + ci * 1.7) * sideAmp;
        const cy2 = baseY + Math.sin(animFrame * sideFreq * 2 + ci) * 3;
        const dx = Math.cos(animFrame * sideFreq + ci * 1.7);
        const facing = dx > 0 ? 1 : -1;
        const bodyW = 9, bodyH = 6;
        ctx.globalAlpha = crabAlpha;
        ctx.fillStyle = '#c45c2a';
        ctx.beginPath();
        ctx.ellipse(cx2, cy2, bodyW, bodyH, 0, 0, Math.PI * 2);
        ctx.fill();
        const clawAngle = Math.sin(animFrame * 0.06 + ci * 0.5) * 0.3;
        ctx.strokeStyle = '#a03a18';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx2 + facing * bodyW * 0.8, cy2 - 2);
        ctx.lineTo(cx2 + facing * (bodyW * 0.8 + 10), cy2 - 6 + Math.sin(clawAngle) * 5);
        ctx.stroke();
        ctx.fillStyle = '#a03a18';
        ctx.beginPath();
        ctx.arc(cx2 + facing * (bodyW * 0.8 + 10), cy2 - 6 + Math.sin(clawAngle) * 5, 3, 0, Math.PI * 2);
        ctx.fill();
        for (let leg = 0; leg < 4; leg++) {
          const legPhase = Math.sin(animFrame * 0.12 + ci * 0.7 + leg * 0.5);
          const legBaseX = cx2 + (leg - 1.5) * 3;
          ctx.strokeStyle = 'rgba(160,80,30,0.7)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(legBaseX, cy2 + 4);
          ctx.lineTo(legBaseX - 8, cy2 + 11 + legPhase * 3);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(legBaseX, cy2 + 4);
          ctx.lineTo(legBaseX + 8, cy2 + 11 - legPhase * 3);
          ctx.stroke();
        }
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(cx2 - 3, cy2 - bodyH + 1, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx2 + 3, cy2 - bodyH + 1, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 月光の潮溜まり ──
  if (loc === 'gokarna') {
    // elapsed > 1700: 夜の岩礁に月光が差し込み、潮溜まりが輝く
    const elapsedTP = animFrame - fieldEnterFrame;
    if (elapsedTP > 1600) {
      const tpAlpha = Math.min(1, (elapsedTP - 1600) / 300) * 0.65;
      const tidePools = [
        { x: canvas.width * 0.06, y: tileSize * 7.8, rx: 14, ry: 8  },
        { x: canvas.width * 0.22, y: tileSize * 7.6, rx: 10, ry: 6  },
        { x: canvas.width * 0.78, y: tileSize * 7.7, rx: 12, ry: 7  },
        { x: canvas.width * 0.92, y: tileSize * 7.5, rx: 9,  ry: 5  },
      ];
      ctx.save();
      for (let ti = 0; ti < tidePools.length; ti++) {
        const { x, y, rx, ry } = tidePools[ti];
        // 岩（プールを囲む）
        ctx.globalAlpha = tpAlpha * 0.65;
        ctx.fillStyle = '#3a2a18';
        ctx.beginPath();
        ctx.ellipse(x, y, rx + 6, ry + 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // 水（月光が映る）
        const shimmer = Math.sin(animFrame * 0.04 + ti * 1.2) * 0.15 + 0.85;
        ctx.globalAlpha = tpAlpha * shimmer;
        const poolGrad = ctx.createRadialGradient(x - 3, y - 2, 0, x, y, rx);
        poolGrad.addColorStop(0,   'rgba(180,210,255,0.8)');
        poolGrad.addColorStop(0.5, 'rgba(120,170,220,0.6)');
        poolGrad.addColorStop(1,   'rgba(60,100,160,0.3)');
        ctx.fillStyle = poolGrad;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // 月光の反射（白い輝点）
        ctx.globalAlpha = tpAlpha * 0.80;
        ctx.fillStyle = 'rgba(230,240,255,0.9)';
        const moonRefX = x - 4 + Math.sin(animFrame * 0.02 + ti) * 2;
        const moonRefY = y - 2 + Math.cos(animFrame * 0.03 + ti) * 1;
        ctx.beginPath();
        ctx.ellipse(moonRefX, moonRefY, 4, 2, -0.3, 0, Math.PI * 2);
        ctx.fill();
        // 小さな生き物（イソギンチャク・ヤドカリの影）
        ctx.globalAlpha = tpAlpha * 0.40;
        ctx.fillStyle = '#6a3a18';
        for (let ci = 0; ci < 3; ci++) {
          const cx = x + (ci - 1) * rx * 0.4;
          const cy = y + (ci % 2) * ry * 0.3;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5 + ci % 2, 0, Math.PI * 2);
          ctx.fill();
        }
        // 水面の揺らぎ（細い楕円）
        ctx.strokeStyle = 'rgba(150,200,255,0.4)';
        ctx.lineWidth = 0.7;
        ctx.globalAlpha = tpAlpha * 0.35;
        ctx.beginPath();
        ctx.ellipse(x, y, rx * 0.6, ry * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: ヤシの木のハンモック ──
  if (loc === 'gokarna') {
    // 二本のヤシの木の間にハンモックが張られ、誰かが横になって揺れている
    const hmLeft  = canvas.width * 0.24;
    const hmRight = canvas.width * 0.44;
    const hmBaseY = tileSize * 8.0;
    const hmSway  = Math.sin(animFrame * 0.018) * 6; // 揺れ
    ctx.save();
    ctx.globalAlpha = 0.58;
    // 左のヤシの幹
    ctx.strokeStyle = '#3a2008';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hmLeft, hmBaseY);
    ctx.quadraticCurveTo(hmLeft - 5, hmBaseY - 45, hmLeft - 8, hmBaseY - 80);
    ctx.stroke();
    // 右のヤシの幹
    ctx.beginPath();
    ctx.moveTo(hmRight, hmBaseY);
    ctx.quadraticCurveTo(hmRight + 5, hmBaseY - 45, hmRight + 8, hmBaseY - 80);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // ロープ（左右の幹からハンモックへ）
    ctx.strokeStyle = '#8a6030';
    ctx.lineWidth = 1;
    const hammockY = hmBaseY - 28 + hmSway;
    ctx.beginPath();
    ctx.moveTo(hmLeft - 6, hmBaseY - 60);
    ctx.lineTo(hmLeft + 2, hammockY);
    ctx.moveTo(hmRight + 6, hmBaseY - 60);
    ctx.lineTo(hmRight - 2, hammockY);
    ctx.stroke();
    // ハンモック本体（カテナリー曲線）
    const hmMidX = (hmLeft + hmRight) / 2;
    const hmMidY = hammockY + 14; // 中央が最も低い
    ctx.fillStyle = '#d4a850';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(hmLeft + 2, hammockY);
    ctx.quadraticCurveTo(hmMidX + hmSway * 0.3, hmMidY, hmRight - 2, hammockY);
    ctx.quadraticCurveTo(hmMidX + hmSway * 0.3, hmMidY + 10, hmLeft + 2, hammockY + 8);
    ctx.closePath();
    ctx.fill();
    // ハンモックの縦縞模様
    ctx.strokeStyle = '#b88030';
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.40;
    for (let si = 0; si <= 6; si++) {
      const t = si / 6;
      const sx = hmLeft + 2 + t * (hmRight - hmLeft - 4);
      const sy = hammockY + Math.pow(t - 0.5, 2) * 16 * 4; // カテナリー近似
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy + 10);
      ctx.stroke();
    }
    // 横になっている人のシルエット
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#2a1808';
    // 体
    ctx.save();
    ctx.translate(hmMidX + hmSway * 0.4, hmMidY + 2);
    ctx.rotate(hmSway * 0.008); // ハンモックと一緒に傾く
    ctx.beginPath();
    ctx.ellipse(-18, 0, 20, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.arc(20, -3, 5, 0, Math.PI * 2);
    ctx.fill();
    // 帽子（麦わら帽子を顔に乗せて昼寝中）
    ctx.fillStyle = '#c8a040';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(20, -6, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, -8, 5, Math.PI, Math.PI * 2);
    ctx.fill();
    // 腕（頭の後ろで組んでいる）
    ctx.strokeStyle = '#2a1808';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(10, -1);
    ctx.lineTo(16, -6);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // ── ゴーカルナ: 夕暮れの帆影 ──
  if (loc === 'gokarna') {
    // elapsed 800-2000: 水平線に帆船のシルエットが夕焼けを背に浮かぶ
    const elapsedSail = animFrame - fieldEnterFrame;
    if (elapsedSail >= 700) {
      const sailAlpha = Math.min(1, (elapsedSail - 700) / 300) * 0.60;
      const silhouettes = [
        { x: canvas.width * 0.12, speed: 0.08, size: 0.7 },
        { x: canvas.width * 0.40, speed: 0.05, size: 1.0 },
        { x: canvas.width * 0.70, speed: 0.06, size: 0.85 },
      ];
      const horizonY = tileSize * 7.0;
      ctx.save();
      ctx.globalAlpha = sailAlpha;
      for (let si = 0; si < silhouettes.length; si++) {
        const { x, speed, size } = silhouettes[si];
        const drift = Math.sin(animFrame * 0.005 + si * 2.1) * 8;
        const sx = x + drift + animFrame * speed;
        const modX = ((sx % (canvas.width + 80)) + canvas.width + 80) % (canvas.width + 80) - 40;
        const sy = horizonY + Math.sin(animFrame * 0.02 + si) * 1.5;
        const s = size;
        ctx.fillStyle = '#1a0a00';
        // 船体
        ctx.beginPath();
        ctx.moveTo(modX - 22 * s, sy + 4 * s);
        ctx.lineTo(modX + 22 * s, sy + 4 * s);
        ctx.lineTo(modX + 18 * s, sy + 8 * s);
        ctx.lineTo(modX - 18 * s, sy + 8 * s);
        ctx.closePath();
        ctx.fill();
        // メインマスト
        ctx.lineWidth = 1.5 * s;
        ctx.strokeStyle = '#1a0a00';
        ctx.beginPath();
        ctx.moveTo(modX, sy + 4 * s);
        ctx.lineTo(modX, sy - 28 * s);
        ctx.stroke();
        // 大三角帆
        ctx.fillStyle = '#2a1808';
        ctx.globalAlpha = sailAlpha * 0.85;
        ctx.beginPath();
        ctx.moveTo(modX, sy - 28 * s);
        ctx.lineTo(modX + 20 * s, sy + 2 * s);
        ctx.lineTo(modX, sy + 2 * s);
        ctx.closePath();
        ctx.fill();
        // 前マスト
        ctx.lineWidth = 1 * s;
        ctx.strokeStyle = '#1a0a00';
        ctx.globalAlpha = sailAlpha;
        ctx.beginPath();
        ctx.moveTo(modX + 10 * s, sy + 4 * s);
        ctx.lineTo(modX + 10 * s, sy - 18 * s);
        ctx.stroke();
        // 小三角帆
        ctx.fillStyle = '#2a1808';
        ctx.globalAlpha = sailAlpha * 0.75;
        ctx.beginPath();
        ctx.moveTo(modX + 10 * s, sy - 18 * s);
        ctx.lineTo(modX + 22 * s, sy + 3 * s);
        ctx.lineTo(modX + 10 * s, sy + 3 * s);
        ctx.closePath();
        ctx.fill();
        // 水面の映り込み
        ctx.globalAlpha = sailAlpha * 0.20;
        ctx.fillStyle = '#2a1808';
        ctx.beginPath();
        ctx.ellipse(modX, sy + 10 * s, 22 * s, 4 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 磯の釣り人 ──
  if (loc === 'gokarna') {
    // 右端の岩礁に立ち、長い竿で沖を狙う老漁師
    const fisherX = canvas.width * 0.88;
    const fisherY = tileSize * 7.5;
    const castSway = Math.sin(animFrame * 0.02) * 2;
    ctx.save();
    ctx.globalAlpha = 0.60;
    // 岩（足元）
    ctx.fillStyle = '#4a3a28';
    ctx.beginPath();
    ctx.ellipse(fisherX, fisherY + 8, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(fisherX + 10, fisherY + 10, 10, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 脚
    ctx.fillStyle = '#2a1808';
    ctx.beginPath();
    ctx.rect(fisherX - 5, fisherY - 2, 4, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(fisherX + 1, fisherY - 1, 4, 12);
    ctx.fill();
    // 胴体
    ctx.fillStyle = '#3a5a3a'; // 草色の服
    ctx.beginPath();
    ctx.rect(fisherX - 5, fisherY - 16, 11, 15);
    ctx.fill();
    // 頭（麦わら帽子）
    ctx.fillStyle = '#2a1808';
    ctx.beginPath();
    ctx.arc(fisherX + 1, fisherY - 21, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8a040';
    ctx.globalAlpha = 0.60;
    ctx.beginPath();
    ctx.ellipse(fisherX + 1, fisherY - 17, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fisherX + 1, fisherY - 20, 6, Math.PI, Math.PI * 2);
    ctx.fill();
    // 腕（竿を持つ）
    ctx.strokeStyle = '#2a1808';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.60;
    ctx.beginPath();
    ctx.moveTo(fisherX + 4, fisherY - 12);
    ctx.lineTo(fisherX + 12 + castSway, fisherY - 20 + castSway * 0.5);
    ctx.stroke();
    // 釣り竿（長い）
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fisherX + 10 + castSway, fisherY - 19 + castSway * 0.5);
    ctx.lineTo(fisherX - 30 + castSway * 2, fisherY - 52 + castSway);
    ctx.stroke();
    // 糸（竿先から海面へ）
    ctx.strokeStyle = 'rgba(180,180,180,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(fisherX - 30 + castSway * 2, fisherY - 52 + castSway);
    ctx.quadraticCurveTo(
      fisherX - 45 + castSway, fisherY - 20,
      fisherX - 55 + castSway, fisherY + 4
    );
    ctx.stroke();
    // ウキ
    ctx.fillStyle = '#ff4422';
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.ellipse(
      fisherX - 55 + castSway,
      fisherY + 3 + Math.sin(animFrame * 0.06) * 1.5,
      2.5, 4, 0, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── ゴーカルナ: 鯨のブリーチング（v100記念） ──
  if (loc === 'gokarna') {
    // 沖合で巨大なザトウクジラが海面を割って跳躍する
    const whaleCycle = 600;
    const wp = animFrame % whaleCycle;
    const wt = wp / whaleCycle;
    // ブリーチングのフェーズ: 0-0.35 上昇, 0.35-0.55 最高点, 0.55-0.80 落下, 0.80-1.0 着水
    if (wt < 0.85) {
      const whaleX = canvas.width * 0.62;
      const seaY   = tileSize * 7.9;
      let whaleBodyT, bodyAngle;
      if (wt < 0.35) {
        whaleBodyT = wt / 0.35; // 0→1
        bodyAngle  = -Math.PI * 0.5 + whaleBodyT * Math.PI * 0.15; // 真上→やや前傾
      } else if (wt < 0.55) {
        whaleBodyT = 1;
        bodyAngle  = -Math.PI * 0.5 + Math.PI * 0.15;
      } else {
        const fallT = (wt - 0.55) / 0.30;
        whaleBodyT  = 1 - fallT * 0.4;
        bodyAngle   = -Math.PI * 0.5 + Math.PI * 0.15 + fallT * Math.PI * 0.55;
      }
      // 高さ計算（放物線）
      const arcT   = wt / 0.80;
      const height = wt < 0.80 ? Math.sin(arcT * Math.PI) * tileSize * 3.8 : 0;
      const wY     = seaY - height;
      ctx.save();
      ctx.globalAlpha = 0.68;
      ctx.translate(whaleX, wY);
      ctx.rotate(bodyAngle);
      // 胴体
      ctx.fillStyle = '#1a2830';
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      // 腹部（白）
      ctx.fillStyle = '#e8e8e0';
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(6, 0, 8, 28, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.68;
      // 尾びれ（フルーク）
      ctx.fillStyle = '#1a2830';
      ctx.beginPath();
      ctx.moveTo(0, -32);
      ctx.quadraticCurveTo(-20, -44, -28, -40);
      ctx.quadraticCurveTo(-14, -34, 0, -36);
      ctx.quadraticCurveTo(14, -34, 28, -40);
      ctx.quadraticCurveTo(20, -44, 0, -32);
      ctx.fill();
      // 胸びれ
      ctx.beginPath();
      ctx.moveTo(12, 5);
      ctx.quadraticCurveTo(28, 18, 24, 28);
      ctx.quadraticCurveTo(18, 22, 8, 15);
      ctx.closePath();
      ctx.fill();
      // 頭部のこぶ（ザトウクジラ特有）
      ctx.globalAlpha = 0.50;
      for (let bi = 0; bi < 4; bi++) {
        ctx.beginPath();
        ctx.arc(-6 + bi * 5, 28, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // 海面の飛沫
      if (wt > 0.70 && wt < 0.85) {
        const splashT = (wt - 0.70) / 0.15;
        ctx.save();
        ctx.globalAlpha = 0.50 * (1 - splashT);
        ctx.fillStyle = '#ddeeff';
        for (let si = 0; si < 14; si++) {
          const sAngle = (si / 14) * Math.PI * 2;
          const sR = splashT * 40;
          const sx = whaleX + Math.cos(sAngle) * sR;
          const sy = seaY + Math.sin(sAngle) * sR * 0.35 - splashT * 12;
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5 - splashT * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // 着水グロー
        ctx.globalAlpha = 0.20 * (1 - splashT);
        ctx.fillStyle = '#aaccff';
        ctx.beginPath();
        ctx.ellipse(whaleX, seaY, 40 * splashT, 10 * splashT, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 水面に続く泡のライン（体が出た跡）
      if (wt < 0.45) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#aaccff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(whaleX, seaY);
        ctx.lineTo(whaleX + 8, seaY + 5);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ── ゴーカルナ: 岩陰のタコ ──
  if (loc === 'gokarna') {
    // 右端の岩の裂け目に大きなタコが潜んでいる。触手がゆらゆら揺れる
    const octX = canvas.width * 0.93;
    const octY = tileSize * 7.6;
    ctx.save();
    ctx.globalAlpha = 0.55;
    // 岩の奥（暗い背景）
    ctx.fillStyle = '#2a1a08';
    ctx.beginPath();
    ctx.ellipse(octX + 8, octY, 20, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    // 胴体（マント）
    ctx.fillStyle = '#cc4422';
    ctx.globalAlpha = 0.50;
    ctx.beginPath();
    ctx.ellipse(octX, octY - 4, 12, 9, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // 頭部の模様
    ctx.fillStyle = '#aa3310';
    ctx.globalAlpha = 0.38;
    for (let si = 0; si < 4; si++) {
      const sx = octX - 6 + si * 4;
      const sy = octY - 6 + (si % 2) * 3;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 2.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 目
    ctx.fillStyle = '#ffdd88';
    ctx.globalAlpha = 0.70;
    ctx.beginPath();
    ctx.arc(octX - 4, octY - 7, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0808';
    ctx.beginPath();
    ctx.ellipse(octX - 4, octY - 7, 1.8, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(octX - 3, octY - 8, 0.8, 0, Math.PI * 2);
    ctx.fill();
    // 8本の触手（波打つベジェ曲線）
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#cc4422';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let ti = 0; ti < 8; ti++) {
      const baseAngle = Math.PI * 0.4 + (ti / 7) * Math.PI * 0.9;
      const wave1 = Math.sin(animFrame * 0.03 + ti * 0.8) * 8;
      const wave2 = Math.sin(animFrame * 0.025 + ti * 0.5 + 1.2) * 5;
      const len = 18 + (ti % 3) * 8;
      const tx1 = octX + Math.cos(baseAngle) * len * 0.4 + wave1 * 0.3;
      const ty1 = octY + 4 + Math.sin(baseAngle) * len * 0.4 + wave1 * 0.2;
      const tx2 = octX + Math.cos(baseAngle) * len + wave1;
      const ty2 = octY + 4 + Math.sin(baseAngle) * len * 0.6 + wave2;
      ctx.lineWidth = 2.5 - ti * 0.1;
      ctx.beginPath();
      ctx.moveTo(octX, octY + 2);
      ctx.quadraticCurveTo(tx1, ty1, tx2, ty2);
      ctx.stroke();
      // 吸盤（触手の途中）
      ctx.fillStyle = '#ffccaa';
      ctx.globalAlpha = 0.35;
      for (let su = 1; su <= 2; su++) {
        const st = su / 3;
        const sx2 = octX + (tx2 - octX) * st;
        const sy2 = (octY + 2) + (ty2 - (octY + 2)) * st;
        ctx.beginPath();
        ctx.arc(sx2, sy2, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#cc4422';
      ctx.globalAlpha = 0.45;
    }
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── ゴーカルナ: 浜の流木 ──
  if (loc === 'gokarna') {
    // 潮が引いた後、砂浜に白化した流木が散らばっている
    const driftwoods = [
      { x: canvas.width * 0.06, y: tileSize * 8.5, angle:  0.3, len: 45, thick: 4 },
      { x: canvas.width * 0.28, y: tileSize * 8.3, angle: -0.2, len: 32, thick: 3 },
      { x: canvas.width * 0.47, y: tileSize * 8.6, angle:  0.5, len: 55, thick: 5 },
      { x: canvas.width * 0.65, y: tileSize * 8.4, angle: -0.4, len: 38, thick: 3 },
      { x: canvas.width * 0.83, y: tileSize * 8.5, angle:  0.1, len: 28, thick: 4 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (let di = 0; di < driftwoods.length; di++) {
      const { x, y, angle, len, thick } = driftwoods[di];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      // 流木の幹
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#c8b898';
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      // 節のある曲がった幹
      ctx.quadraticCurveTo(len * 0.3, Math.sin(di * 1.5) * 4, len, Math.sin(di * 0.8) * 6);
      ctx.stroke();
      // 細かい枝（折れた跡）
      ctx.strokeStyle = '#b8a888';
      ctx.lineWidth = thick * 0.5;
      for (let bi = 0; bi < 3; bi++) {
        const bt = 0.2 + bi * 0.25;
        const bx = len * bt;
        const by = Math.sin(di * 1.5 + bt) * 3;
        const branchAngle = (bi % 2 === 0 ? 1 : -1) * (0.4 + bi * 0.1);
        const branchLen = 6 + bi * 3;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(branchAngle) * branchLen, by + Math.sin(branchAngle) * branchLen);
        ctx.stroke();
      }
      // 藤壺（白い楕円）
      ctx.fillStyle = '#e8e0d0';
      ctx.globalAlpha = 0.45;
      for (let ci = 0; ci < 4; ci++) {
        const cx = len * (0.15 + ci * 0.2);
        const cy = Math.sin(di * 1.5 + cx / len) * 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy - thick * 0.5, 2.5, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'butt';
      ctx.restore();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 波のバイオルミネッセンス ──
  if (loc === 'gokarna') {
    // elapsed > 1600: 夜の波打ち際が青く光る生物発光現象
    const elapsedBL = animFrame - fieldEnterFrame;
    if (elapsedBL > 1500) {
      const blAlpha = Math.min(1, (elapsedBL - 1500) / 300) * 0.70;
      // 波頭（row=8付近）が光る
      const waveRow = tileSize * 8.0;
      ctx.save();
      // 主波線（3本の発光帯）
      for (let wi = 0; wi < 3; wi++) {
        const waveOffset = (animFrame * 1.8 + wi * 90) % canvas.width;
        const waveY = waveRow + wi * 5 + Math.sin(animFrame * 0.025 + wi) * 3;
        const wGrad = ctx.createLinearGradient(0, waveY - 6, 0, waveY + 6);
        wGrad.addColorStop(0,   'rgba(0,180,255,0)');
        wGrad.addColorStop(0.5, `rgba(20,220,255,${blAlpha * 0.6})`);
        wGrad.addColorStop(1,   'rgba(0,150,200,0)');
        ctx.fillStyle = wGrad;
        ctx.globalAlpha = 1;
        // ジグザグ波形
        ctx.beginPath();
        ctx.moveTo(0, waveY);
        for (let wx = 0; wx <= canvas.width; wx += 8) {
          const wy = waveY + Math.sin((wx + waveOffset) * 0.045) * 4 + Math.sin((wx + waveOffset) * 0.02) * 2;
          ctx.lineTo(wx, wy);
        }
        ctx.lineTo(canvas.width, waveY + 6);
        ctx.lineTo(0, waveY + 6);
        ctx.closePath();
        ctx.fill();
        // 発光粒子（白い輝点）
        for (let px = 0; px < canvas.width; px += 18) {
          const pyWave = waveY + Math.sin((px + waveOffset) * 0.045) * 4;
          const particleGlow = (Math.sin((px + animFrame * 2) * 0.1) + 1) / 2;
          ctx.globalAlpha = blAlpha * particleGlow * 0.7;
          const pGrad = ctx.createRadialGradient(px, pyWave, 0, px, pyWave, 4);
          pGrad.addColorStop(0, 'rgba(150,240,255,1)');
          pGrad.addColorStop(1, 'rgba(0,200,255,0)');
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.arc(px, pyWave, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 砂浜のバイオルミネッセンス（ランダム点灯）
      ctx.globalAlpha = blAlpha * 0.45;
      for (let gi = 0; gi < 20; gi++) {
        const gx = (gi * 31 + 10) % canvas.width;
        const gy = waveRow + 5 + (gi * 7) % 20;
        const glow = (Math.sin(animFrame * 0.07 + gi * 0.9) + 1) / 2;
        if (glow < 0.4) continue;
        ctx.fillStyle = `rgba(0,220,255,${glow * 0.5})`;
        ctx.beginPath();
        ctx.arc(gx, gy, 2.5 * glow, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 岩の野花 ──
  if (loc === 'gokarna') {
    // 海岸の岩の割れ目や砂地に色鮮やかな野花が咲いている
    const wildflowers = [
      { x: canvas.width * 0.04, y: tileSize * 7.5, type: 0, color: '#ff6688', size: 5 },
      { x: canvas.width * 0.09, y: tileSize * 7.2, type: 1, color: '#ffee44', size: 4 },
      { x: canvas.width * 0.13, y: tileSize * 7.6, type: 2, color: '#ff8844', size: 6 },
      { x: canvas.width * 0.85, y: tileSize * 7.3, type: 0, color: '#ff44aa', size: 5 },
      { x: canvas.width * 0.90, y: tileSize * 7.6, type: 1, color: '#aaddff', size: 4 },
      { x: canvas.width * 0.95, y: tileSize * 7.2, type: 2, color: '#ffcc44', size: 5 },
      { x: canvas.width * 0.22, y: tileSize * 7.8, type: 1, color: '#cc88ff', size: 3 },
      { x: canvas.width * 0.76, y: tileSize * 7.7, type: 0, color: '#ff6644', size: 4 },
    ];
    ctx.save();
    for (let fi = 0; fi < wildflowers.length; fi++) {
      const { x, y, type, color, size } = wildflowers[fi];
      const sway = Math.sin(animFrame * 0.028 + fi * 1.3) * 2;
      ctx.save();
      ctx.translate(x, y);
      // 茎
      ctx.strokeStyle = '#2a6a18';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sway, -size * 1.2, sway, -size * 2.5);
      ctx.stroke();
      // 花
      ctx.globalAlpha = 0.65;
      if (type === 0) {
        // 5弁花
        for (let pi = 0; pi < 5; pi++) {
          const pa = (pi / 5) * Math.PI * 2;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(sway + Math.cos(pa) * size * 0.7, -size * 2.5 + Math.sin(pa) * size * 0.7, size * 0.65, size * 0.45, pa, 0, Math.PI * 2);
          ctx.fill();
        }
        // 花芯
        ctx.fillStyle = '#ffee44';
        ctx.beginPath();
        ctx.arc(sway, -size * 2.5, size * 0.35, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 1) {
        // デイジー型（細い花弁）
        for (let pi = 0; pi < 8; pi++) {
          const pa = (pi / 8) * Math.PI * 2;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(sway + Math.cos(pa) * size, -size * 2.5 + Math.sin(pa) * size, size * 0.35, size * 0.2, pa, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(sway, -size * 2.5, size * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // ベル型（垂れ下がる釣鐘花）
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sway, -size * 2.5);
        ctx.quadraticCurveTo(sway + size, -size * 2.5 + size * 0.3, sway + size * 0.5, -size * 2.5 + size * 1.2);
        ctx.quadraticCurveTo(sway, -size * 2.5 + size * 1.4, sway - size * 0.5, -size * 2.5 + size * 1.2);
        ctx.quadraticCurveTo(sway - size, -size * 2.5 + size * 0.3, sway, -size * 2.5);
        ctx.fill();
      }
      // 葉
      ctx.fillStyle = '#3a7a20';
      ctx.globalAlpha = 0.50;
      ctx.beginPath();
      ctx.ellipse(sway * 0.5 - 3, -size * 1.5, 4, 2, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: ペリカンの急降下 ──
  if (loc === 'gokarna') {
    // 海面をペリカンが急降下して魚を捕る
    const pelCycle = 340;
    const pp = animFrame % pelCycle;
    const pt = pp / pelCycle;
    ctx.save();
    ctx.globalAlpha = 0.60;
    ctx.fillStyle = '#e8e0d0';
    ctx.strokeStyle = '#8a8078';
    if (pt < 0.45) {
      // 飛行フェーズ（水平飛行）
      const flyT = pt / 0.45;
      const px = canvas.width * 0.85 - flyT * canvas.width * 0.60;
      const py = tileSize * 6.5 + Math.sin(flyT * Math.PI * 3) * 8;
      ctx.translate(px, py);
      // 体
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 首と頭
      ctx.beginPath();
      ctx.ellipse(12, -4, 6, 3.5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(18, -7, 4, 3, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // くちばし（長い）
      ctx.fillStyle = '#ddaa44';
      ctx.beginPath();
      ctx.moveTo(21, -6);
      ctx.lineTo(34, -7.5);
      ctx.lineTo(34, -6);
      ctx.lineTo(21, -5);
      ctx.closePath();
      ctx.fill();
      // 喉袋
      ctx.fillStyle = '#cc9933';
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(20, -4, 4, 3, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.60;
      ctx.fillStyle = '#e8e0d0';
      // 翼（広げた）
      const wingFlap = Math.sin(animFrame * 0.15) * 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-5, -14 + wingFlap, -26, -10 + wingFlap);
      ctx.quadraticCurveTo(-20, -3, -10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-5, 14 - wingFlap, -26, 10 - wingFlap);
      ctx.quadraticCurveTo(-20, 3, -10, 0);
      ctx.closePath();
      ctx.fill();
    } else if (pt < 0.62) {
      // 急降下フェーズ
      const diveT = (pt - 0.45) / 0.17;
      const px = canvas.width * 0.25 + diveT * canvas.width * 0.03;
      const py = tileSize * 6.5 + diveT * tileSize * 1.3;
      ctx.translate(px, py);
      ctx.rotate(diveT * 0.7); // 頭を下げる
      // 折り畳んだ翼で急降下
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ddaa44';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(2, -26);
      ctx.lineTo(-2, -26);
      ctx.closePath();
      ctx.fill();
    } else if (pt < 0.75) {
      // 水面着水・魚を捕る（スプラッシュ）
      const splashT = (pt - 0.62) / 0.13;
      const px = canvas.width * 0.28;
      const py = tileSize * 7.8;
      ctx.globalAlpha = 0.45 * (1 - splashT);
      // 水飛沫
      ctx.fillStyle = '#ddeeff';
      for (let si = 0; si < 8; si++) {
        const sAngle = (si / 8) * Math.PI * 2;
        const sR = splashT * 20;
        ctx.beginPath();
        ctx.arc(px + Math.cos(sAngle) * sR, py + Math.sin(sAngle) * sR * 0.4 - splashT * 8, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 飛び去るフェーズ
      const leaveT = (pt - 0.75) / 0.25;
      const px = canvas.width * 0.28 - leaveT * canvas.width * 0.25;
      const py = tileSize * 7.8 - leaveT * tileSize * 2;
      ctx.translate(px, py);
      ctx.rotate(-leaveT * 0.3);
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 夜の打ち上げ花火 ──
  if (loc === 'gokarna') {
    // elapsed > 1700: 夜の浜辺に祭りの打ち上げ花火が上がる
    const elapsedFW = animFrame - fieldEnterFrame;
    if (elapsedFW > 1700) {
      const fwAlpha = Math.min(1, (elapsedFW - 1700) / 200) * 0.85;
      // 3発の花火、それぞれ異なる周期
      const fireworks = [
        { x: canvas.width * 0.22, y: tileSize * 1.8, cycle: 180, phase:   0, color1: '#ff4488', color2: '#ff8844' },
        { x: canvas.width * 0.55, y: tileSize * 1.2, cycle: 220, phase:  70, color1: '#44aaff', color2: '#88ffee' },
        { x: canvas.width * 0.82, y: tileSize * 1.6, cycle: 200, phase: 130, color1: '#ffee44', color2: '#ffaacc' },
      ];
      ctx.save();
      for (let fi = 0; fi < fireworks.length; fi++) {
        const fw = fireworks[fi];
        const fp = (animFrame + fw.phase) % fw.cycle;
        const ft = fp / fw.cycle;
        if (ft < 0.25) {
          // 打ち上げ軌跡（下から上へ）
          const trailY = canvas.height - (canvas.height - fw.y) * (ft / 0.25);
          ctx.globalAlpha = fwAlpha * (ft / 0.25) * 0.7;
          ctx.strokeStyle = fw.color1;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(fw.x + canvas.width * 0.05, canvas.height - 10);
          ctx.lineTo(fw.x, trailY);
          ctx.stroke();
        } else if (ft < 0.75) {
          // 爆発（放射状の火花）
          const burstT = (ft - 0.25) / 0.50;
          const burstR = burstT * 38;
          const sparkCount = 18;
          for (let si = 0; si < sparkCount; si++) {
            const angle = (si / sparkCount) * Math.PI * 2;
            const drift = Math.sin(angle * 3 + fi) * 4 * burstT;
            const sx = fw.x + Math.cos(angle) * burstR + drift;
            const sy = fw.y + Math.sin(angle) * burstR + burstT * 12; // 重力落下
            const sparkAlpha = fwAlpha * (1 - burstT) * 0.9;
            ctx.globalAlpha = sparkAlpha;
            // 火花の軌跡
            const trailLen = 6 * (1 - burstT);
            const grad = ctx.createLinearGradient(sx, sy, sx - Math.cos(angle) * trailLen, sy - Math.sin(angle) * trailLen);
            grad.addColorStop(0, fw.color1);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - Math.cos(angle) * trailLen, sy - Math.sin(angle) * trailLen + burstT * 3);
            ctx.stroke();
            // 火花の点
            ctx.fillStyle = si % 2 === 0 ? fw.color1 : fw.color2;
            ctx.globalAlpha = sparkAlpha * 0.8;
            ctx.beginPath();
            ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
          // 中心の閃光
          ctx.globalAlpha = fwAlpha * (1 - burstT) * 0.5;
          const cGrad = ctx.createRadialGradient(fw.x, fw.y, 0, fw.x, fw.y, 15);
          cGrad.addColorStop(0, fw.color2);
          cGrad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = cGrad;
          ctx.beginPath();
          ctx.arc(fw.x, fw.y, 15 * (1 - burstT), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夕暮れのたき火 ──
  if (loc === 'gokarna') {
    // elapsed 1000-2000: 浜辺に焚き火が燃えている
    const elapsedBf = animFrame - fieldEnterFrame;
    if (elapsedBf >= 800) {
      const bfAlpha = Math.min(1, (elapsedBf - 800) / 300) * 0.80;
      const bfX = canvas.width * 0.58;
      const bfY = tileSize * 8.05;
      ctx.save();
      ctx.globalAlpha = bfAlpha;
      // 薪（交差した丸太）
      ctx.strokeStyle = '#4a2808';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bfX - 16, bfY + 5);
      ctx.lineTo(bfX + 16, bfY - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bfX + 16, bfY + 5);
      ctx.lineTo(bfX - 16, bfY - 2);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // 炭の赤熱
      ctx.fillStyle = '#ff4400';
      ctx.globalAlpha = bfAlpha * 0.6;
      ctx.beginPath();
      ctx.ellipse(bfX, bfY + 1, 12, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 炎（4層）
      const flameColors = ['#ff2200','#ff6600','#ffaa00','#ffee66'];
      for (let fl = 0; fl < 4; fl++) {
        const fFlicker = Math.sin(animFrame * 0.14 + fl * 0.9) * 3;
        const fFlicker2 = Math.sin(animFrame * 0.09 + fl * 1.5) * 2;
        const fH = (fl + 1) * 8 + fFlicker;
        const fW = (4 - fl) * 4 + fFlicker2;
        ctx.globalAlpha = bfAlpha * (0.9 - fl * 0.15);
        const fGrad = ctx.createRadialGradient(bfX, bfY - fl * 6, 0, bfX, bfY - fl * 6, fH);
        fGrad.addColorStop(0,   flameColors[fl]);
        fGrad.addColorStop(0.6, flameColors[fl]);
        fGrad.addColorStop(1,   'rgba(255,100,0,0)');
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.ellipse(bfX + fFlicker2 * 0.3, bfY - fl * 6, fW, fH, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 火の粉
      ctx.fillStyle = '#ffcc44';
      for (let si = 0; si < 10; si++) {
        const sparkAge = (animFrame * 1.3 + si * 37) % 80;
        const sparkT = sparkAge / 80;
        const sx = bfX + Math.sin(si * 2.3 + animFrame * 0.04) * 12 * sparkT;
        const sy = bfY - sparkAge * 0.7;
        ctx.globalAlpha = bfAlpha * (1 - sparkT) * 0.8;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // 地面の橙色グロー
      ctx.globalAlpha = bfAlpha * 0.25;
      const groundGrad = ctx.createRadialGradient(bfX, bfY + 6, 0, bfX, bfY + 6, 30);
      groundGrad.addColorStop(0, 'rgba(255,120,0,0.7)');
      groundGrad.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = groundGrad;
      ctx.beginPath();
      ctx.ellipse(bfX, bfY + 6, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 砂のお城 ──
  if (loc === 'gokarna') {
    // 子どもたちが作った砂のお城が浜辺に佇む
    const castleX = canvas.width * 0.42;
    const castleY = tileSize * 8.0;
    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#d4b870';
    ctx.strokeStyle = '#a88840';
    ctx.lineWidth = 1;
    // 土台
    ctx.beginPath();
    ctx.rect(castleX - 22, castleY - 4, 44, 14);
    ctx.fill();
    ctx.stroke();
    // 中央の塔
    ctx.beginPath();
    ctx.rect(castleX - 8, castleY - 20, 16, 18);
    ctx.fill();
    ctx.stroke();
    // 塔の凹凸（銃眼）
    for (let ci = -1; ci <= 1; ci++) {
      ctx.beginPath();
      ctx.rect(castleX + ci * 6 - 2, castleY - 26, 4, 8);
      ctx.fill();
      ctx.stroke();
    }
    // 左右の小塔
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(castleX + side * 18 - 5, castleY - 14, 10, 12);
      ctx.fill();
      ctx.stroke();
      // 小塔の銃眼
      for (let ci = -1; ci <= 1; ci++) {
        ctx.beginPath();
        ctx.rect(castleX + side * 18 + ci * 4 - 1.5, castleY - 18, 3, 5);
        ctx.fill();
        ctx.stroke();
      }
    }
    // 入口のアーチ
    ctx.fillStyle = '#b09030';
    ctx.beginPath();
    ctx.arc(castleX, castleY - 4, 4, Math.PI, Math.PI * 2);
    ctx.lineTo(castleX + 4, castleY + 2);
    ctx.lineTo(castleX - 4, castleY + 2);
    ctx.closePath();
    ctx.fill();
    // 旗（先端の棒）
    ctx.strokeStyle = '#884422';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(castleX, castleY - 26);
    ctx.lineTo(castleX, castleY - 36);
    ctx.stroke();
    // 旗布
    const flagWave = Math.sin(animFrame * 0.05) * 2;
    ctx.fillStyle = '#ee4422';
    ctx.globalAlpha = 0.70;
    ctx.beginPath();
    ctx.moveTo(castleX, castleY - 36);
    ctx.lineTo(castleX + 10 + flagWave, castleY - 33);
    ctx.lineTo(castleX + 10 - flagWave * 0.5, castleY - 30);
    ctx.lineTo(castleX, castleY - 32);
    ctx.closePath();
    ctx.fill();
    // 周りの砂のモリ（装飾）
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = '#c8aa58';
    for (let di = -3; di <= 3; di++) {
      ctx.beginPath();
      ctx.arc(castleX + di * 6, castleY + 12, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 打ち上げられた貝殻 ──
  if (loc === 'gokarna') {
    // 満潮線（row=8付近）に色とりどりの貝殻が散らばっている
    const shells = [
      { x: canvas.width * 0.10, y: tileSize * 8.2, type: 0, rot: 0.3,  size: 7  },
      { x: canvas.width * 0.20, y: tileSize * 8.0, type: 1, rot: -0.5, size: 5  },
      { x: canvas.width * 0.29, y: tileSize * 8.3, type: 2, rot: 1.1,  size: 8  },
      { x: canvas.width * 0.39, y: tileSize * 7.9, type: 0, rot: 2.0,  size: 6  },
      { x: canvas.width * 0.50, y: tileSize * 8.1, type: 1, rot: -1.2, size: 9  },
      { x: canvas.width * 0.60, y: tileSize * 8.3, type: 2, rot: 0.7,  size: 5  },
      { x: canvas.width * 0.71, y: tileSize * 8.0, type: 0, rot: -0.8, size: 7  },
      { x: canvas.width * 0.80, y: tileSize * 8.2, type: 1, rot: 1.5,  size: 6  },
    ];
    const shellColors = ['#e8d5b0','#f0c8a0','#d4a87a','#c8b890','#e0ccaa'];
    ctx.save();
    ctx.globalAlpha = 0.65;
    for (let si = 0; si < shells.length; si++) {
      const s = shells[si];
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = shellColors[si % shellColors.length];
      if (s.type === 0) {
        // 二枚貝（扇形）
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, s.size, -Math.PI * 0.7, Math.PI * 0.7);
        ctx.closePath();
        ctx.fill();
        // 放射線
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 0.5;
        for (let ri = -2; ri <= 2; ri++) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(ri * 0.25) * s.size, Math.sin(ri * 0.25) * s.size);
          ctx.stroke();
        }
      } else if (s.type === 1) {
        // 巻き貝（三角形を巻く）
        ctx.beginPath();
        ctx.moveTo(0, -s.size);
        ctx.quadraticCurveTo(s.size, 0, 0, s.size * 0.6);
        ctx.quadraticCurveTo(-s.size * 0.5, s.size * 0.3, 0, -s.size);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        // 内側渦
        ctx.fillStyle = shellColors[(si + 2) % shellColors.length];
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(0, s.size * 0.15, s.size * 0.3, s.size * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // ウニ殻（丸いとげとげ）
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#cc9966';
        ctx.beginPath();
        ctx.arc(0, 0, s.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = shellColors[si % shellColors.length];
        ctx.lineWidth = 0.8;
        for (let pi = 0; pi < 8; pi++) {
          const pa = (pi / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(pa) * s.size * 0.7, Math.sin(pa) * s.size * 0.7);
          ctx.lineTo(Math.cos(pa) * s.size * 1.1, Math.sin(pa) * s.size * 1.1);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 岩礁の打ち寄せ波 ──
  if (loc === 'gokarna') {
    // 画面右端の岩礁に波が当たり、白い飛沫が上がる
    const rockPositions = [
      { rx: canvas.width * 0.82, ry: tileSize * 7.8, size: 18 },
      { rx: canvas.width * 0.91, ry: tileSize * 7.4, size: 13 },
      { rx: canvas.width * 0.96, ry: tileSize * 7.9, size: 10 },
    ];
    const waveCycle = 90; // 波の周期
    ctx.save();
    for (let ri = 0; ri < rockPositions.length; ri++) {
      const { rx, ry, size } = rockPositions[ri];
      const wavePhase = (animFrame + ri * 30) % waveCycle;
      const impact = wavePhase / waveCycle; // 0〜1
      // 岩のシルエット
      ctx.globalAlpha = 0.60;
      ctx.fillStyle = '#4a3a28';
      ctx.beginPath();
      ctx.ellipse(rx, ry, size, size * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      // 波の進入（岩の左側から白い帯）
      const waveX = rx - size - (1 - impact) * 25;
      ctx.globalAlpha = 0.35 * Math.sin(impact * Math.PI);
      ctx.fillStyle = '#ddeeff';
      ctx.beginPath();
      ctx.ellipse(waveX, ry + 2, 18 * impact, 5 * impact, 0, 0, Math.PI * 2);
      ctx.fill();
      // 飛沫パーティクル（衝突時 impact 0.3〜0.7）
      if (impact > 0.2 && impact < 0.85) {
        const splashT = (impact - 0.2) / 0.65;
        const splashCount = 8;
        ctx.globalAlpha = 0.55 * (1 - splashT);
        ctx.fillStyle = '#eef8ff';
        for (let si = 0; si < splashCount; si++) {
          const angle = -Math.PI * 0.7 + (si / splashCount) * Math.PI * 0.8;
          const dist = splashT * (12 + (si % 3) * 6);
          const sx = rx - size * 0.6 + Math.cos(angle) * dist;
          const sy = ry + Math.sin(angle) * dist - splashT * 8;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.2 + (si % 2) * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 泡（岩の下）
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(animFrame * 0.08 + ri);
      ctx.fillStyle = '#ffffff';
      for (let bi = 0; bi < 5; bi++) {
        const bx = rx - size + (bi * size * 0.4);
        const bSize = 1.5 + (bi % 3) * 1.2;
        ctx.beginPath();
        ctx.arc(bx, ry + size * 0.45 + Math.sin(animFrame * 0.1 + bi * 1.1) * 2, bSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 浜辺のヤドカリ ──
  if (loc === 'gokarna') {
    // 潮溜まり付近（砂浜タイル row=8）に3匹のヤドカリが歩き回る
    const hermits = [
      { bx: canvas.width * 0.30, cycle: 260, phase:   0, dir:  1 },
      { bx: canvas.width * 0.50, cycle: 310, phase:  80, dir: -1 },
      { bx: canvas.width * 0.65, cycle: 280, phase: 140, dir:  1 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.65;
    for (let hi = 0; hi < hermits.length; hi++) {
      const h = hermits[hi];
      const cp = (animFrame + h.phase) % h.cycle;
      // 0-80: 移動、80-160: 静止、160-260: 移動（逆方向）
      let cx = h.bx;
      let legAnim = 0;
      if (cp < 80) {
        cx = h.bx + h.dir * (cp / 80) * 25;
        legAnim = cp;
      } else if (cp >= 160) {
        cx = h.bx + h.dir * 25 - h.dir * ((cp - 160) / 100) * 25;
        legAnim = cp - 160;
      }
      const cy = tileSize * 8.4 + Math.sin(animFrame * 0.04 + hi * 1.3) * 1.5;
      ctx.fillStyle = '#9a6030';
      ctx.strokeStyle = '#9a6030';
      // 貝殻（渦巻き状に近似）
      ctx.save();
      ctx.translate(cx + 6, cy - 4);
      ctx.rotate(0.4 + hi * 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      // 大きい円→小さい円の渦巻き近似
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#c48040';
      ctx.globalAlpha = 0.65;
      ctx.fill();
      ctx.strokeStyle = '#7a4010';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(2, 1, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#b07030';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(3, 2, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#9a5a20';
      ctx.fill();
      ctx.restore();
      // 蟹の体
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = '#9a6030';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // ハサミ（左右）
      ctx.lineWidth = 1.5;
      const pinch = Math.sin(legAnim * 0.15) * 0.3;
      ctx.strokeStyle = '#9a6030';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx - 13, cy - 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - 14, cy - 3, 3, -0.5 + pinch, Math.PI - pinch, false);
      ctx.stroke();
      // 脚（3対）
      ctx.lineWidth = 1;
      for (let li = 0; li < 3; li++) {
        const legSwing = Math.sin(legAnim * 0.2 + li * 0.8) * 3;
        ctx.beginPath();
        ctx.moveTo(cx - 2 + li * 2, cy + 3);
        ctx.lineTo(cx - 4 + li * 2, cy + 9 + legSwing);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 2 + li * 2, cy + 3);
        ctx.lineTo(cx - 4 + li * 2, cy - 6 - legSwing);
        ctx.stroke();
      }
      // 触角
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx + 5, cy - 2);
      ctx.lineTo(cx + 13, cy - 8);
      ctx.moveTo(cx + 5, cy - 1);
      ctx.lineTo(cx + 11, cy - 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 夜明けの漁船の出港 ──
  if (loc === 'gokarna') {
    // elapsed < 500: 夜明け前に漁師の小舟が沖へ向かう
    const elapsedBoat = animFrame - fieldEnterFrame;
    if (elapsedBoat < 600) {
      const fadeIn = Math.min(1, elapsedBoat / 120);
      const fadeOut = elapsedBoat > 480 ? 1 - (elapsedBoat - 480) / 120 : 1;
      const alpha = fadeIn * fadeOut * 0.75;
      // 舟が右から左へ沖に向かって進む
      const progress = elapsedBoat / 600;
      const boatX = canvas.width * 0.85 - progress * canvas.width * 0.55;
      const boatY = tileSize * 8.1 + Math.sin(animFrame * 0.04) * 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#1a1008';
      ctx.strokeStyle = '#1a1008';
      ctx.lineWidth = 1;
      // 船体（横長楕円）
      ctx.beginPath();
      ctx.ellipse(boatX, boatY, 22, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 舷側の膨らみ
      ctx.beginPath();
      ctx.ellipse(boatX, boatY - 2, 18, 4, 0, 0, Math.PI);
      ctx.fill();
      // マスト
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(boatX + 2, boatY - 4);
      ctx.lineTo(boatX + 2, boatY - 22);
      ctx.stroke();
      // 帆（三角形、風でふくらむ）
      const billowX = Math.sin(animFrame * 0.03) * 3;
      ctx.fillStyle = '#f5e8c0';
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.moveTo(boatX + 2, boatY - 22);
      ctx.lineTo(boatX + 2 + billowX, boatY - 13);
      ctx.lineTo(boatX + 14 + billowX, boatY - 7);
      ctx.closePath();
      ctx.fill();
      // 漕ぎ手のシルエット
      ctx.fillStyle = '#1a1008';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(boatX - 8, boatY - 7, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(boatX - 10, boatY - 4, 5, 5);
      ctx.fill();
      // 水面の波紋（進行方向と逆に）
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = '#88aacc';
      ctx.lineWidth = 0.8;
      for (let wi = 1; wi <= 3; wi++) {
        ctx.beginPath();
        ctx.ellipse(boatX + 18 + wi * 10, boatY + 1, wi * 5, 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: ヤシの木 ──
  if (loc === 'gokarna') {
    // 砂浜の背後に3本のヤシの木。幹が緩やかに湾曲し葉が風にそよぐ
    const palms = [
      { bx: canvas.width * 0.08, by: tileSize * 7.8, lean: -0.18, h: 90 },
      { bx: canvas.width * 0.14, by: tileSize * 7.4, lean:  0.10, h: 105 },
      { bx: canvas.width * 0.21, by: tileSize * 7.6, lean: -0.07, h: 80  },
    ];
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#2a1a0a';
    ctx.strokeStyle = '#2a1a0a';
    for (let pi = 0; pi < palms.length; pi++) {
      const { bx, by, lean, h } = palms[pi];
      const sway = Math.sin(animFrame * 0.022 + pi * 1.7) * 4;
      // 幹（二次ベジェ）
      const tx = bx + sway + lean * h;
      const ty = by - h;
      const cx1 = bx + sway * 0.4 + lean * h * 0.4;
      const cy1 = by - h * 0.5;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(cx1, cy1, tx, ty);
      ctx.stroke();
      // 葉（8枚を放射状に）
      ctx.lineWidth = 1.5;
      for (let li = 0; li < 8; li++) {
        const baseAngle = (li / 8) * Math.PI * 2;
        const frondSway = Math.sin(animFrame * 0.03 + pi * 1.3 + li * 0.5) * 0.15;
        const angle = baseAngle + frondSway;
        const frondLen = 28 + (li % 3) * 6;
        const midX = tx + Math.cos(angle) * frondLen * 0.5;
        const midY = ty + Math.sin(angle) * frondLen * 0.5 + frondLen * 0.18;
        const endX = tx + Math.cos(angle) * frondLen;
        const endY = ty + Math.sin(angle) * frondLen + frondLen * 0.32;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(midX, midY, endX, endY);
        ctx.stroke();
      }
      // ヤシの実（根元付近に2〜3個）
      ctx.globalAlpha = 0.5;
      for (let ni = 0; ni < 2; ni++) {
        const nAngle = -0.5 + ni * 0.6;
        ctx.beginPath();
        ctx.arc(tx + Math.cos(nAngle) * 5, ty + Math.sin(nAngle) * 5 + 4, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.55;
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 網を繕う漁師たち ──
  if (loc === 'gokarna') {
    // 砂浜の左端に3人の漁師が輪になって網を直す
    const netWorkers = [
      { x: canvas.width * 0.06, y: tileSize * 2.55 },
      { x: canvas.width * 0.12, y: tileSize * 2.65 },
      { x: canvas.width * 0.09, y: tileSize * 2.40 },
    ];
    ctx.save();
    // 網（曲線の格子パターン）
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = '#506870';
    ctx.lineWidth   = 0.6;
    const netCx = canvas.width * 0.09;
    const netCy = tileSize * 2.52;
    for (let row = 0; row < 4; row++) {
      ctx.beginPath();
      ctx.moveTo(netCx - 18, netCy - 6 + row * 4);
      for (let col = 0; col < 8; col++) {
        const nx = netCx - 18 + col * 5;
        const wave = Math.sin(nx * 0.3 + animFrame * 0.02 + row) * 1.5;
        ctx.lineTo(nx + 5, netCy - 6 + row * 4 + wave);
      }
      ctx.stroke();
    }
    for (let col = 0; col < 8; col++) {
      const nx = netCx - 18 + col * 5;
      ctx.beginPath();
      ctx.moveTo(nx, netCy - 6);
      for (let row = 0; row < 4; row++) {
        const wave = Math.sin(nx * 0.3 + animFrame * 0.02 + row) * 1.5;
        ctx.lineTo(nx, netCy - 6 + row * 4 + wave);
      }
      ctx.stroke();
    }
    // 漁師のシルエット
    for (let w = 0; w < netWorkers.length; w++) {
      const nw = netWorkers[w];
      const handMove = Math.sin(animFrame * 0.09 + w * 1.2) * 2;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle   = '#1A1008';
      // 頭
      ctx.beginPath();
      ctx.arc(nw.x, nw.y - 9, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // 体（前傾み）
      ctx.beginPath();
      ctx.ellipse(nw.x, nw.y - 4, 3, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // 腕（網を持つ）
      ctx.strokeStyle = '#1A1008';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(nw.x + 2, nw.y - 6);
      ctx.lineTo(nw.x + 8, nw.y - 4 + handMove);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 夜の砂浜の生物発光 ──
  if (loc === 'gokarna') {
    const elapsedBs = animFrame - fieldEnterFrame;
    if (elapsedBs > 1500) {
      const bsStr = Math.min(1, (elapsedBs - 1500) / 400);
      // 砂浜タイル（行2）に散らばる青白い発光点
      ctx.save();
      for (let p = 0; p < 25; p++) {
        // 砂浜上の固定位置にランダムな光点
        const px2 = (p * 137 + 23) % canvas.width;
        const py2 = tileSize * 2.05 + (p * 41 + 7) % (tileSize * 0.85);
        const twinkle = 0.3 + 0.7 * Math.sin(animFrame * 0.08 + p * 0.53);
        const a = bsStr * twinkle * (0.35 + (p % 4) * 0.08);
        if (a < 0.01) continue;
        const glowR = 2 + (p % 3) * 0.8;
        const grd = ctx.createRadialGradient(px2, py2, 0, px2, py2, glowR * 2);
        grd.addColorStop(0, `rgba(100,200,255,${a})`);
        grd.addColorStop(0.5, `rgba(60,160,240,${a * 0.4})`);
        grd.addColorStop(1, 'rgba(40,120,200,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px2, py2, glowR * 2, 0, Math.PI * 2);
        ctx.fill();
        // 光点の核
        ctx.globalAlpha = a * 0.90;
        ctx.fillStyle = '#B0E8FF';
        ctx.beginPath();
        ctx.arc(px2, py2, glowR * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 朝の法螺貝 ──
  if (loc === 'gokarna') {
    const elapsedCh = animFrame - fieldEnterFrame;
    // 夜明け（elapsed < 300）に砂浜で法螺貝を吹く
    const chStr = elapsedCh < 40 ? elapsedCh / 40 :
                  elapsedCh < 250 ? 1 :
                  elapsedCh < 350 ? 1 - (elapsedCh - 250) / 100 : 0;
    if (chStr > 0.01) {
      const chx = canvas.width * 0.60;
      const chy = tileSize * 2.5;
      ctx.save();
      ctx.globalAlpha = chStr * 0.35;
      ctx.fillStyle   = '#0E1420';
      // 人物（立って法螺貝を吹く）
      ctx.beginPath();
      ctx.arc(chx, chy - 14, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0E1420';
      ctx.beginPath();
      ctx.moveTo(chx, chy - 11);
      ctx.lineTo(chx, chy - 4);
      ctx.stroke();
      // 腕（法螺貝を持ち上げる）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(chx - 2, chy - 9);
      ctx.lineTo(chx - 6, chy - 15);
      ctx.moveTo(chx + 2, chy - 9);
      ctx.lineTo(chx + 8, chy - 15);
      ctx.stroke();
      // 法螺貝（螺旋形）
      ctx.globalAlpha = chStr * 0.40;
      ctx.fillStyle   = '#D4C090';
      ctx.beginPath();
      ctx.ellipse(chx + 6, chy - 16, 5, 3, 0.5, 0, Math.PI * 2);
      ctx.fill();
      // 音の波紋（半円形に広がる）
      ctx.strokeStyle = 'rgba(255,240,200,1)';
      ctx.lineWidth   = 0.8;
      for (let r = 0; r < 4; r++) {
        const rAge = (animFrame * 0.7 + r * 30) % 100;
        const rt   = rAge / 100;
        const rR   = rt * tileSize * 2.5;
        const ra   = (1 - rt) * chStr * 0.25;
        if (ra < 0.005) continue;
        ctx.globalAlpha = ra;
        ctx.beginPath();
        ctx.arc(chx + 11, chy - 16, rR, -Math.PI * 0.7, Math.PI * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 遠洋を行く帆船 ──
  if (loc === 'gokarna') {
    const dhowDefs = [
      { speed: 0.018, phase: 0,   sailCol: '#C84030', row: 0 },
      { speed: 0.012, phase: 220, sailCol: '#D08020', row: 1 },
    ];
    ctx.save();
    for (const dd of dhowDefs) {
      const dhX = ((animFrame * dd.speed + dd.phase) % (canvas.width + 80)) - 40;
      const dhY = dd.row * 6 + tileSize * 0.65 + Math.sin(animFrame * 0.014 + dd.phase) * 1.5;
      const sc  = 0.45 + dd.row * 0.12;
      const a   = 0.28 + 0.06 * Math.sin(animFrame * 0.01 + dd.phase);
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#0D1C28';
      // 船体
      ctx.beginPath();
      ctx.moveTo(dhX - 16 * sc, dhY + 2);
      ctx.quadraticCurveTo(dhX, dhY + 5 * sc, dhX + 16 * sc, dhY + 2);
      ctx.lineTo(dhX + 14 * sc, dhY - 1);
      ctx.quadraticCurveTo(dhX, dhY + 3 * sc, dhX - 14 * sc, dhY - 1);
      ctx.closePath();
      ctx.fill();
      // マスト
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = '#0D1C28';
      ctx.beginPath();
      ctx.moveTo(dhX - 2, dhY - 1);
      ctx.lineTo(dhX - 2, dhY - 18 * sc);
      ctx.stroke();
      // メインセイル（三角形の縦帆）
      ctx.globalAlpha = a * 0.75;
      ctx.fillStyle   = dd.sailCol;
      ctx.beginPath();
      ctx.moveTo(dhX - 2, dhY - 18 * sc);
      ctx.lineTo(dhX + 14 * sc, dhY - 2);
      ctx.lineTo(dhX - 2, dhY - 2);
      ctx.closePath();
      ctx.fill();
      // 小さな前帆
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle   = '#E8D8C0';
      ctx.beginPath();
      ctx.moveTo(dhX - 2, dhY - 14 * sc);
      ctx.lineTo(dhX - 12 * sc, dhY - 2);
      ctx.lineTo(dhX - 2, dhY - 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: ビーチパラソルと休む人 ──
  if (loc === 'gokarna') {
    // 砂浜（タイル行2付近）に2本のパラソル
    const parasols = [
      { x: canvas.width * 0.28, color: '#E04030' },
      { x: canvas.width * 0.65, color: '#2860C0' },
    ];
    ctx.save();
    for (const ps of parasols) {
      const px = ps.x;
      const py = tileSize * 2.35;
      const sway = Math.sin(animFrame * 0.022 + ps.x) * 1.5;
      // 支柱
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#5A4020';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + sway * 0.2, py + 10);
      ctx.lineTo(px + sway, py - 16);
      ctx.stroke();
      // 傘の骨と布（扇形）
      ctx.fillStyle   = ps.color;
      ctx.globalAlpha = 0.40;
      ctx.beginPath();
      ctx.moveTo(px + sway, py - 16);
      ctx.arc(px + sway, py - 16, 14, Math.PI * 0.75, Math.PI * 2.25);
      ctx.closePath();
      ctx.fill();
      // 傘のストライプ（3本）
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#FFFFFF';
      for (let s = 0; s < 3; s++) {
        const sa = Math.PI * 0.75 + s * (Math.PI * 1.5 / 6);
        ctx.beginPath();
        ctx.moveTo(px + sway, py - 16);
        ctx.lineTo(px + sway + Math.cos(sa) * 14, py - 16 + Math.sin(sa) * 14);
        ctx.lineTo(px + sway + Math.cos(sa + 0.35) * 14, py - 16 + Math.sin(sa + 0.35) * 14);
        ctx.closePath();
        ctx.fill();
      }
      // 休む人（横たわる）
      ctx.globalAlpha = 0.32;
      ctx.fillStyle   = '#1A1008';
      ctx.beginPath();
      ctx.ellipse(px - 4, py + 8, 10, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.arc(px + 7, py + 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: イルカの群れ ──
  if (loc === 'gokarna') {
    // 2-3頭のイルカが波と一緒に飛び跳ねる
    const podDefs = [
      { speed: 0.42, phase: 0,   delay: 0   },
      { speed: 0.38, phase: 90,  delay: 18  },
      { speed: 0.45, phase: 180, delay: 36  },
    ];
    ctx.save();
    for (let d = 0; d < podDefs.length; d++) {
      const pd = podDefs[d];
      const jumpCycle = 160;
      const jp = (animFrame + pd.delay) % jumpCycle;
      const t  = jp / jumpCycle;
      const dx2 = ((animFrame * pd.speed + pd.phase) % (canvas.width + 60)) - 30;
      // 飛び跳ねる軌道（sin波）
      const dy2 = tileSize * 1.65 - Math.max(0, Math.sin(t * Math.PI)) * 20;
      const airborne = Math.sin(t * Math.PI) > 0;
      const flipAngle = airborne ? -Math.sin(t * Math.PI) * 0.6 : 0;
      const a = 0.32 + 0.08 * Math.sin(animFrame * 0.025 + d);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(dx2, dy2);
      ctx.rotate(flipAngle);
      ctx.fillStyle = '#1E3A4A';
      // 胴体（細長い流線形）
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 背びれ
      ctx.beginPath();
      ctx.moveTo(2, -4);
      ctx.lineTo(5, -10);
      ctx.lineTo(8, -4);
      ctx.closePath();
      ctx.fill();
      // 尾びれ
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(-14, -4);
      ctx.lineTo(-13, 0);
      ctx.lineTo(-14, 4);
      ctx.closePath();
      ctx.fill();
      // 胸びれ
      ctx.beginPath();
      ctx.ellipse(2, 3, 4, 2, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 飛び跳ね時の水しぶき
      if (jp < 10 || jp > 148) {
        const splA = jp < 10 ? jp / 10 : (160 - jp) / 12;
        ctx.globalAlpha = splA * 0.30;
        ctx.strokeStyle = 'rgba(180,220,255,1)';
        ctx.lineWidth   = 0.8;
        for (let s = 0; s < 4; s++) {
          const sa = (s / 4) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(dx2, tileSize * 1.65);
          ctx.lineTo(dx2 + Math.cos(sa) * 8, tileSize * 1.65 + Math.sin(sa) * 5);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 水中の魚の群れ ──
  if (loc === 'gokarna') {
    // 水タイル（行1-2）を泳ぐ魚の群れ（上から見た影）
    const shoalCenter = animFrame * 0.28 % (canvas.width + 60) - 30;
    const shoalY = tileSize * 1.55 + Math.sin(animFrame * 0.018) * 8;
    ctx.save();
    // 群れは楕円形に散らばる約12匹
    for (let f = 0; f < 12; f++) {
      // 群れの中心からの相対位置（変化する楕円配置）
      const angle  = (f / 12) * Math.PI * 2 + animFrame * 0.008;
      const spread = 18 + Math.sin(animFrame * 0.025 + f * 0.5) * 6;
      const fx = shoalCenter + Math.cos(angle) * spread;
      const fy = shoalY     + Math.sin(angle) * spread * 0.4;
      // 魚の向き（群れの移動方向に従う）
      const fishAngle = Math.atan2(
        Math.sin(animFrame * 0.008) * spread * 0.4,
        0.28 + Math.cos(animFrame * 0.025 + f) * 0.05
      );
      const a = 0.18 + 0.06 * Math.sin(animFrame * 0.04 + f * 0.6);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(fx, fy);
      ctx.rotate(fishAngle);
      ctx.fillStyle = '#1A3050';
      // 魚体（小さな楕円）
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 尾
      ctx.beginPath();
      ctx.moveTo(-3.5, 0);
      ctx.lineTo(-6, -1.5);
      ctx.lineTo(-6, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 夜明けの砂浜の瞑想者 ──
  if (loc === 'gokarna') {
    const elapsedMed = animFrame - fieldEnterFrame;
    // 夜明け（低elapsed）に現れ、黄金時間帯に消える
    const medStr = elapsedMed < 60 ? elapsedMed / 60 :
                   elapsedMed < 350 ? 1 :
                   elapsedMed < 500 ? 1 - (elapsedMed - 350) / 150 : 0;
    if (medStr > 0.01) {
      const medX = canvas.width * 0.42;
      const medY = tileSize * 2.4;
      const breath = Math.sin(animFrame * 0.015) * 0.4;
      ctx.save();
      ctx.globalAlpha = medStr * 0.35;
      ctx.fillStyle   = '#0A0C10';
      // 結跏趺坐（蓮華座）
      ctx.beginPath();
      ctx.ellipse(medX, medY + 4, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // 胴体（三角形）
      ctx.beginPath();
      ctx.moveTo(medX - 5, medY + 4);
      ctx.lineTo(medX + 5, medY + 4);
      ctx.lineTo(medX, medY - 6 + breath);
      ctx.closePath();
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.arc(medX, medY - 9 + breath * 0.4, 3, 0, Math.PI * 2);
      ctx.fill();
      // 腕（膝の上に置く）
      ctx.strokeStyle = '#0A0C10';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(medX - 5, medY + 2 + breath * 0.2);
      ctx.lineTo(medX - 7, medY + 5);
      ctx.moveTo(medX + 5, medY + 2 + breath * 0.2);
      ctx.lineTo(medX + 7, medY + 5);
      ctx.stroke();
      // 夜明けの光輪
      ctx.globalAlpha = medStr * 0.12;
      const medAura = ctx.createRadialGradient(medX, medY, 0, medX, medY, 22);
      medAura.addColorStop(0, 'rgba(255,200,100,0.5)');
      medAura.addColorStop(1, 'rgba(255,160,50,0)');
      ctx.fillStyle = medAura;
      ctx.beginPath();
      ctx.arc(medX, medY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 月光の海面 ──
  if (loc === 'gokarna') {
    const elapsedMn = animFrame - fieldEnterFrame;
    if (elapsedMn > 1600) {
      const mnStr = Math.min(1, (elapsedMn - 1600) / 400);
      // 月の位置（夜空の左寄り）
      const moonX = canvas.width * 0.28;
      const moonY = tileSize * 0.45;
      ctx.save();
      // 月光の海面への反射（縦長の銀の帯）
      const pathW = 20 + Math.sin(animFrame * 0.02) * 8;
      const reflGrad = ctx.createLinearGradient(0, tileSize * 1.8, 0, tileSize * 2.2);
      reflGrad.addColorStop(0, `rgba(220,230,255,0)`);
      reflGrad.addColorStop(0.3, `rgba(200,215,255,${mnStr * 0.30})`);
      reflGrad.addColorStop(0.7, `rgba(180,200,240,${mnStr * 0.20})`);
      reflGrad.addColorStop(1, `rgba(160,185,230,0)`);
      // 海面の揺れる月光帯
      ctx.globalAlpha = 1;
      for (let seg = 0; seg < 12; seg++) {
        const sy = tileSize * 1.85 + seg * 3;
        const sw = pathW - seg * 0.8 + Math.sin(animFrame * 0.08 + seg * 0.5) * 4;
        const sa = mnStr * (0.20 - seg * 0.012) * (0.5 + 0.5 * Math.sin(animFrame * 0.06 + seg));
        if (sa < 0.005) continue;
        ctx.globalAlpha = sa;
        ctx.fillStyle   = '#D8E8FF';
        ctx.fillRect(moonX - sw * 0.5, sy, sw, 2.5);
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 灯台の光 ──
  if (loc === 'gokarna') {
    const elapsedLh = animFrame - fieldEnterFrame;
    if (elapsedLh > 1400) {
      const lhFade = Math.min(1, (elapsedLh - 1400) / 300);
      // 画面右端の岬に灯台
      const lhX = canvas.width * 0.94;
      const lhY = tileSize * 1.3;
      ctx.save();
      // 灯台タワー
      ctx.globalAlpha = lhFade * 0.45;
      ctx.fillStyle   = '#C8C0A8';
      ctx.fillRect(lhX - 3, lhY, 6, 18);
      // 点滅するビーコン（3秒周期）
      const blinkPhase = animFrame % 90;
      const blinkOn = blinkPhase < 15 || (blinkPhase >= 30 && blinkPhase < 45);
      if (blinkOn) {
        const blink = blinkPhase < 15
          ? Math.sin((blinkPhase / 15) * Math.PI)
          : Math.sin(((blinkPhase - 30) / 15) * Math.PI);
        // 光線（扇形のビーム）
        const beamAngle = animFrame * 0.025;  // 回転
        const beamLen   = tileSize * 4;
        const beamGrad = ctx.createLinearGradient(lhX, lhY,
          lhX + Math.cos(beamAngle) * beamLen, lhY + Math.sin(beamAngle) * beamLen);
        beamGrad.addColorStop(0, `rgba(255,240,160,${lhFade * blink * 0.55})`);
        beamGrad.addColorStop(1, 'rgba(255,230,120,0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(lhX, lhY);
        ctx.arc(lhX, lhY, beamLen, beamAngle - 0.15, beamAngle + 0.15);
        ctx.closePath();
        ctx.fill();
        // 灯台の光源
        ctx.globalAlpha = lhFade * blink * 0.90;
        const beaconGlow = ctx.createRadialGradient(lhX, lhY, 0, lhX, lhY, 10);
        beaconGlow.addColorStop(0, 'rgba(255,250,200,1)');
        beaconGlow.addColorStop(1, 'rgba(255,220,100,0)');
        ctx.fillStyle = beaconGlow;
        ctx.beginPath();
        ctx.arc(lhX, lhY, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 岩に止まるカモメ ──
  if (loc === 'gokarna') {
    // 2羽のカモメが固定した岩の上で休む
    const gullRocks = [
      { x: canvas.width * 0.18, y: tileSize * 2.1 },
      { x: canvas.width * 0.72, y: tileSize * 2.0 },
    ];
    ctx.save();
    for (let g = 0; g < gullRocks.length; g++) {
      const gr = gullRocks[g];
      const gx = gr.x;
      const gy = gr.y;
      // 頭を周期的に動かす
      const headBob = Math.sin(animFrame * 0.04 + g * 1.7) > 0.6 ? 1 : 0;  // たまに頭を動かす
      const headY   = headBob ? -1.5 : 0;
      const a = 0.40 + 0.10 * Math.sin(animFrame * 0.025 + g);
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#E8E8E8';
      // 体
      ctx.beginPath();
      ctx.ellipse(gx, gy, 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.arc(gx + 5, gy - 2 + headY, 2.8, 0, Math.PI * 2);
      ctx.fill();
      // くちばし（黄色）
      ctx.fillStyle = '#D0A020';
      ctx.beginPath();
      ctx.moveTo(gx + 7.5, gy - 1.5 + headY);
      ctx.lineTo(gx + 11, gy - 1 + headY);
      ctx.lineTo(gx + 7.5, gy - 0.5 + headY);
      ctx.closePath();
      ctx.fill();
      // 目（黒い点）
      ctx.fillStyle = '#101010';
      ctx.beginPath();
      ctx.arc(gx + 6, gy - 2.5 + headY, 0.7, 0, Math.PI * 2);
      ctx.fill();
      // 翼の折りたたんだ先（グレー）
      ctx.fillStyle = '#989898';
      ctx.beginPath();
      ctx.ellipse(gx - 2, gy + 1, 4, 2, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // 岩
      ctx.fillStyle = '#5A5040';
      ctx.globalAlpha = a * 0.55;
      ctx.beginPath();
      ctx.ellipse(gx, gy + 4, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 波打ち際で遊ぶ子どもたち ──
  if (loc === 'gokarna') {
    const kidDefs = [
      { speed: 0.15, phase: 0,   row: 0.05 },
      { speed: -0.10, phase: 90, row: 0.12 },
      { speed: 0.20, phase: 200, row: 0.0  },
    ];
    ctx.save();
    for (let k = 0; k < kidDefs.length; k++) {
      const kd = kidDefs[k];
      const kx = ((animFrame * kd.speed + kd.phase) % (canvas.width + 30) + canvas.width + 30) % (canvas.width + 30) - 15;
      const ky = tileSize * (2 + kd.row) + Math.sin(animFrame * 0.18 + k * 0.9) * 2;
      const run = Math.sin(animFrame * 0.25 + k * 0.6);
      const a   = 0.35 + 0.08 * Math.sin(animFrame * 0.03 + k);
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#1E1008';
      ctx.strokeStyle = '#1E1008';
      // 頭
      ctx.beginPath();
      ctx.arc(kx, ky - 8, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // 体
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(kx, ky - 5.5);
      ctx.lineTo(kx, ky);
      ctx.stroke();
      // 腕（走る動き）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(kx, ky - 4);
      ctx.lineTo(kx - 4, ky - 2 + run * 2);
      ctx.moveTo(kx, ky - 4);
      ctx.lineTo(kx + 4, ky - 2 - run * 2);
      ctx.stroke();
      // 脚
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(kx - 3, ky + 5 + run * 2);
      ctx.moveTo(kx, ky);
      ctx.lineTo(kx + 3, ky + 5 - run * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 嵐の後の虹 ──
  if (loc === 'gokarna') {
    const elapsedRb = animFrame - fieldEnterFrame;
    // 嵐後（elapsed 900-1300）に虹が現れる
    const rbStr = elapsedRb < 900 ? 0 :
                  elapsedRb < 1050 ? (elapsedRb - 900) / 150 :
                  elapsedRb < 1200 ? 1 :
                  elapsedRb < 1350 ? 1 - (elapsedRb - 1200) / 150 : 0;
    if (rbStr > 0.01) {
      ctx.save();
      // 虹（7色の同心弧、水平線付近から空へ）
      const rbCx = canvas.width * 0.35;
      const rbCy = tileSize * 2.0;  // 水平線の高さ
      const rbColors = [
        'rgba(255,30,30,',   // 赤
        'rgba(255,120,0,',   // 橙
        'rgba(255,220,0,',   // 黄
        'rgba(30,200,30,',   // 緑
        'rgba(30,120,255,',  // 青
        'rgba(80,30,200,',   // 藍
        'rgba(180,30,220,',  // 紫
      ];
      for (let c = 0; c < rbColors.length; c++) {
        const rr = 55 + c * 5;
        ctx.globalAlpha = rbStr * 0.28;
        ctx.strokeStyle = rbColors[c] + '1)';
        ctx.lineWidth   = 4;
        ctx.beginPath();
        ctx.arc(rbCx, rbCy, rr, Math.PI, 0);  // 上半円
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 跳ねる魚 ──
  if (loc === 'gokarna') {
    const fishCycle = 280;
    ctx.save();
    // 2匹の魚がずれたタイミングで跳ねる
    for (let f = 0; f < 2; f++) {
      const fp = (animFrame + f * 140) % fishCycle;
      if (fp > 55) continue;
      const t = fp / 55;
      // 放物線の軌跡
      const startX = canvas.width * (0.25 + f * 0.38);
      const peakX  = startX + 22;
      const fx = startX + t * 40;
      const fy = tileSize * 1.6 - Math.sin(t * Math.PI) * 28;  // 水面上に飛び出す
      const fade = t < 0.06 ? t / 0.06 : t > 0.90 ? (1 - t) / 0.10 : 1;
      const tilt = (t - 0.5) * 2;  // 飛翔角度
      ctx.save();
      ctx.globalAlpha = fade * 0.55;
      ctx.translate(fx, fy);
      ctx.rotate(Math.atan2(-Math.cos(t * Math.PI) * 28, 40) + Math.PI * 0.5);
      // 魚体（細長い楕円）
      ctx.fillStyle = '#C8D8E8';
      ctx.beginPath();
      ctx.ellipse(0, 0, 2, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // 尾ひれ
      ctx.fillStyle = '#A0B8D0';
      ctx.beginPath();
      ctx.moveTo(0, 7);
      ctx.lineTo(-4, 13);
      ctx.lineTo(4, 13);
      ctx.closePath();
      ctx.fill();
      // 水しぶき（飛び出し・着水時）
      ctx.restore();
      if (fp < 5 || fp > 48) {
        const splashA = fp < 5 ? (fp / 5) * 0.4 : ((55 - fp) / 7) * 0.4;
        ctx.globalAlpha = fade * splashA;
        ctx.strokeStyle = 'rgba(200,230,255,1)';
        ctx.lineWidth   = 0.8;
        for (let s = 0; s < 4; s++) {
          const sa = (s / 4) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(fx, tileSize * 1.65);
          ctx.lineTo(fx + Math.cos(sa) * 6, tileSize * 1.65 + Math.sin(sa) * 4);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 遠雷 ──
  if (loc === 'gokarna') {
    const elapsedLt = animFrame - fieldEnterFrame;
    // 嵐のタイミング（elapsed 600-900 のあいだ断続的に）
    if (elapsedLt >= 600 && elapsedLt <= 900) {
      const ltCycle = 130;
      const ltPhase = elapsedLt % ltCycle;
      if (ltPhase < 8) {
        const intensity = Math.sin((ltPhase / 8) * Math.PI);
        ctx.save();
        // 水平線付近に白い光の閃光
        const lx = canvas.width * (0.25 + (elapsedLt % 5) * 0.14);
        const horizLt = tileSize * 2;
        const ltGrad = ctx.createRadialGradient(lx, horizLt, 0, lx, horizLt, 60);
        ltGrad.addColorStop(0, `rgba(220,230,255,${intensity * 0.55})`);
        ltGrad.addColorStop(0.3, `rgba(180,200,240,${intensity * 0.25})`);
        ltGrad.addColorStop(1, 'rgba(140,170,220,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = ltGrad;
        ctx.fillRect(0, horizLt - 30, canvas.width, 60);
        // 細い稲妻（ジグザグ線）
        if (ltPhase < 3) {
          ctx.globalAlpha = intensity * 0.70;
          ctx.strokeStyle = '#D8E8FF';
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(lx, horizLt - 22);
          ctx.lineTo(lx - 4, horizLt - 12);
          ctx.lineTo(lx + 3, horizLt - 4);
          ctx.lineTo(lx - 2, horizLt + 4);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // ── ゴーカルナ: 水平線の夕焼けグロー ──
  if (loc === 'gokarna') {
    const elapsedGl = animFrame - fieldEnterFrame;
    // 黄金時間帯（elapsed 1000-1800）にピーク
    const glStr = elapsedGl < 800 ? 0 :
                  elapsedGl < 1100 ? (elapsedGl - 800) / 300 :
                  elapsedGl < 1600 ? 1 :
                  elapsedGl < 2000 ? 1 - (elapsedGl - 1600) / 400 : 0;
    if (glStr > 0.01) {
      ctx.save();
      // 水平線（タイル行2の上端）に広がる暖色グラデーション
      const horizY = tileSize * 2;
      const glGrad = ctx.createLinearGradient(0, horizY - tileSize * 1.2, 0, horizY + tileSize * 0.5);
      glGrad.addColorStop(0, `rgba(255,140,20,0)`);
      glGrad.addColorStop(0.35, `rgba(255,100,10,${glStr * 0.28})`);
      glGrad.addColorStop(0.65, `rgba(220,60,20,${glStr * 0.18})`);
      glGrad.addColorStop(1, `rgba(180,30,10,0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = glGrad;
      ctx.fillRect(0, horizY - tileSize * 1.2, canvas.width, tileSize * 1.7);
      // 太陽（水平線上に半分沈んだ円）
      const sunR = 14;
      const sunX = canvas.width * 0.60 + Math.sin(elapsedGl * 0.0008) * 18;
      const sunY = horizY + 2;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.5);
      sunGlow.addColorStop(0, `rgba(255,220,100,${glStr * 0.90})`);
      sunGlow.addColorStop(0.35, `rgba(255,120,20,${glStr * 0.55})`);
      sunGlow.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR * 2.5, 0, Math.PI * 2);
      ctx.fill();
      // 太陽の本体（水平線の下半分は隠れる）
      ctx.globalAlpha = glStr * 0.80;
      ctx.fillStyle = '#FFDD60';
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR, Math.PI, 0);  // 上半円のみ
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ゴーカルナ: 夜の星空 ──
  if (loc === 'gokarna') {
    const elapsedSt = animFrame - fieldEnterFrame;
    if (elapsedSt > 1400) {
      const starFade = Math.min(1, (elapsedSt - 1400) / 500);
      ctx.save();
      // 空タイル（y < 2*tileSize）に散りばめる
      for (let s = 0; s < 40; s++) {
        const sx = (s * 163 + 7) % canvas.width;
        const sy = (s * 97 + 11)  % (tileSize * 2.2);
        const twinkle = 0.4 + 0.6 * Math.sin(animFrame * 0.05 + s * 0.73);
        ctx.globalAlpha = starFade * twinkle * 0.70;
        const sz = s % 5 === 0 ? 1.5 : 1;
        ctx.fillStyle = s % 7 === 0 ? '#FFE8C8' : '#FFFFFF';
        ctx.fillRect(sx - sz * 0.5, sy - sz * 0.5, sz, sz);
      }
      // 月（右上）
      const moonA = starFade * 0.55;
      ctx.globalAlpha = moonA;
      const mg = ctx.createRadialGradient(canvas.width * 0.82, tileSize * 0.55, 0, canvas.width * 0.82, tileSize * 0.55, 11);
      mg.addColorStop(0, 'rgba(255,248,220,1)');
      mg.addColorStop(0.7, 'rgba(240,230,190,0.7)');
      mg.addColorStop(1, 'rgba(220,210,170,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(canvas.width * 0.82, tileSize * 0.55, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ゴーカルナ: ビーチの凧 ──
  if (loc === 'gokarna') {
    // 空タイルを飛ぶ三角形の凧
    const kx = canvas.width * 0.55 + Math.sin(animFrame * 0.017) * 55 + Math.sin(animFrame * 0.037) * 20;
    const ky = tileSize * 0.75 + Math.sin(animFrame * 0.021) * 14 + Math.sin(animFrame * 0.011) * 8;
    const kFade = 0.55 + 0.15 * Math.sin(animFrame * 0.025);
    ctx.save();
    ctx.globalAlpha = kFade;
    // 凧本体（カラフルな菱形）
    ctx.fillStyle   = '#E83028';
    ctx.beginPath();
    ctx.moveTo(kx, ky - 10);
    ctx.lineTo(kx + 6, ky);
    ctx.lineTo(kx, ky + 8);
    ctx.lineTo(kx - 6, ky);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle   = '#F8C020';
    ctx.beginPath();
    ctx.moveTo(kx, ky - 10);
    ctx.lineTo(kx + 6, ky);
    ctx.lineTo(kx, ky);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2858C0';
    ctx.beginPath();
    ctx.moveTo(kx - 6, ky);
    ctx.lineTo(kx, ky);
    ctx.lineTo(kx, ky + 8);
    ctx.closePath();
    ctx.fill();
    // 糸（砂浜まで続く曲線）
    ctx.globalAlpha = kFade * 0.45;
    ctx.strokeStyle = 'rgba(90,70,40,1)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(kx, ky + 8);
    ctx.quadraticCurveTo(kx + 15, ky + 60, canvas.width * 0.38, tileSize * 3.2);
    ctx.stroke();
    // 尻尾（小さな三角形が数個）
    ctx.globalAlpha = kFade * 0.55;
    for (let tail = 0; tail < 3; tail++) {
      const tr = tail / 3;
      const tx = kx + Math.sin(animFrame * 0.06 + tail * 0.8) * 4;
      const ty = ky + 10 + tail * 7;
      const tc = tail % 2 === 0 ? '#E83028' : '#F8C020';
      ctx.fillStyle = tc;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + 3, ty + 5);
      ctx.lineTo(tx - 3, ty + 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: 岸辺のカニ ──
  if (loc === 'gokarna') {
    ctx.save();
    for (let c = 0; c < 3; c++) {
      // カニは横方向に動く
      const cSpeed = (c % 2 === 0 ? 1 : -1) * (0.28 + c * 0.12);
      const cPhase = c * 137;
      const cx = ((animFrame * cSpeed + cPhase) % (canvas.width + 30) + canvas.width + 30) % (canvas.width + 30) - 15;
      // 水辺のすぐ上（タイル行 2 付近）
      const cy = tileSize * 2 + tileSize * 0.08 + (c % 2) * 4;
      const scuttle = Math.sin(animFrame * 0.22 + c * 1.0) * 0.5;
      const a = 0.38 + 0.10 * Math.sin(animFrame * 0.04 + c);
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#2A1A10';
      ctx.strokeStyle = '#2A1A10';
      // 体（楕円）
      ctx.beginPath();
      ctx.ellipse(cx, cy, 4, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 8本の脚（両側に4本）
      ctx.lineWidth = 0.8;
      for (let leg = 0; leg < 4; leg++) {
        const loff = -3 + leg * 2;
        const langle = leg % 2 === 0 ? -0.35 + scuttle * 0.1 : -0.55 - scuttle * 0.1;
        // 左脚
        ctx.beginPath();
        ctx.moveTo(cx + loff, cy - 1);
        ctx.lineTo(cx + loff - 5, cy - 2 - Math.abs(langle) * 3);
        ctx.stroke();
        // 右脚
        ctx.beginPath();
        ctx.moveTo(cx + loff, cy + 1);
        ctx.lineTo(cx + loff - 5, cy + 2 + Math.abs(langle) * 3);
        ctx.stroke();
      }
      // ハサミ（前）
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + 4, cy - 1);
      ctx.lineTo(cx + 8, cy - 3 + scuttle);
      ctx.moveTo(cx + 4, cy + 1);
      ctx.lineTo(cx + 8, cy + 3 - scuttle);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ゴーカルナ: クラゲの群れ ──
  if (loc === 'gokarna') {
    ctx.save();
    for (let j = 0; j < 7; j++) {
      const jSpeed  = 0.012 + j * 0.005;
      const jPhase  = j * 89;
      const jx = ((animFrame * jSpeed + jPhase) % (canvas.width + 60)) - 30;
      const rowJ = j % 2;
      const jy = rowJ * tileSize + tileSize * 0.55 + Math.sin(animFrame * 0.025 + j * 1.1) * 4;
      const pulse = 0.55 + 0.45 * Math.sin(animFrame * 0.06 + j * 0.8);
      const jR = 6 + j % 3 * 2;
      const fade = 0.22 + 0.10 * Math.sin(animFrame * 0.04 + j * 0.5);
      // 傘部分（半円グラデーション）
      const jg = ctx.createRadialGradient(jx, jy - jR * 0.3, 0, jx, jy, jR);
      jg.addColorStop(0, `rgba(160,220,255,${pulse * 0.55})`);
      jg.addColorStop(0.6, `rgba(80,160,220,${pulse * 0.30})`);
      jg.addColorStop(1, 'rgba(40,100,180,0)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = jg;
      ctx.beginPath();
      ctx.ellipse(jx, jy, jR, jR * 0.6, 0, Math.PI, 0);  // 上向き半円
      ctx.closePath();
      ctx.fill();
      // 触手（4本）
      ctx.strokeStyle = `rgba(140,200,240,${pulse * 0.35})`;
      ctx.lineWidth   = 0.7;
      for (let t = 0; t < 4; t++) {
        const tx = jx - jR * 0.5 + t * (jR / 3);
        const len = 7 + t % 2 * 3;
        const wave = Math.sin(animFrame * 0.07 + t * 0.8 + j * 0.4) * 3;
        ctx.beginPath();
        ctx.moveTo(tx, jy);
        ctx.quadraticCurveTo(tx + wave, jy + len * 0.5, tx + wave * 0.5, jy + len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── ゴーカルナ: ウミガメのシルエット ──
  if (loc === 'gokarna') {
    const turtleCycle = 550;
    const turtleActive = 160;
    const tp = animFrame % turtleCycle;
    if (tp < turtleActive) {
      const t  = tp / turtleActive;
      const tx = t * canvas.width * 0.72 + canvas.width * 0.04;
      const rowSeed = Math.floor(animFrame / turtleCycle) % 2;
      const ty = (rowSeed + 1) * tileSize + tileSize * 0.42 + Math.sin(animFrame * 0.018 + 1.5) * 2.2;
      const fade = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
      const flipper = Math.sin(animFrame * 0.085) * 3.5;
      ctx.save();
      ctx.globalAlpha = fade * 0.38;
      ctx.fillStyle   = '#0A1C28';
      ctx.strokeStyle = '#0A1C28';
      // 甲羅
      ctx.beginPath();
      ctx.ellipse(tx, ty, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.ellipse(tx + 11, ty, 3.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 前ひれ左右
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx - 3, ty - 1);
      ctx.lineTo(tx - 13, ty - 4 - flipper);
      ctx.moveTo(tx - 3, ty + 1);
      ctx.lineTo(tx - 13, ty + 4 + flipper);
      ctx.stroke();
      // 後ひれ左右
      ctx.beginPath();
      ctx.moveTo(tx + 3, ty - 1);
      ctx.lineTo(tx + 9, ty - 6 + flipper * 0.5);
      ctx.moveTo(tx + 3, ty + 1);
      ctx.lineTo(tx + 9, ty + 6 - flipper * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── バラナシ: ディヤ（灯籠）が川面をゆっくり流れる ──
  if (loc === 'varanasi') {
    const diyaCount = 7;
    for (let i = 0; i < diyaCount; i++) {
      const speed  = 0.22 + (i % 3) * 0.11;
      const dx     = (animFrame * speed + i * 91) % (canvas.width + 40) - 20;
      const row    = i % 2;                              // 水タイル行 0 or 1
      const dy     = row * tileSize + 10 + Math.sin(animFrame * 0.04 + i * 1.3) * 4;
      const glow   = 0.55 + 0.45 * Math.sin(animFrame * 0.07 + i * 0.9);
      const r      = 10 + i % 3 * 2;
      const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, r);
      g.addColorStop(0,   `rgba(255,200,60,${glow * 0.9})`);
      g.addColorStop(0.4, `rgba(255,130,30,${glow * 0.5})`);
      g.addColorStop(1,   'rgba(255,80,0,0)');
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
      // 芯の光点
      ctx.globalAlpha = glow * 0.95;
      ctx.fillStyle = '#FFEEAA';
      ctx.fillRect(dx - 1, dy - 1, 2, 2);
      ctx.restore();
    }
  }

  // ── バラナシ: ガンジス川を漂うハスの花びら ──
  if (loc === 'varanasi') {
    const petalCount = 7;
    for (let i = 0; i < petalCount; i++) {
      const speed = 0.18 + (i % 3) * 0.12;
      const px2   = ((animFrame * speed + i * 119) % (canvas.width + 30) + canvas.width + 30) % (canvas.width + 30) - 15;
      const py2   = ((i * 47 + 11) % (2 * tileSize - 8)) + 4 + Math.sin(animFrame * 0.03 + i * 1.1) * 2;
      const ang   = animFrame * 0.006 + i * 0.8;
      const pulse = 0.55 + 0.45 * Math.sin(animFrame * 0.04 + i * 0.9);
      ctx.save();
      ctx.globalAlpha = 0.50 * pulse;
      ctx.fillStyle = i % 3 === 0 ? '#FFB0C8' : i % 3 === 1 ? '#FF90A8' : '#FFCCE0';
      ctx.beginPath();
      ctx.ellipse(px2, py2, 4, 2.2, ang, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── バラナシ: ガンジス川を流れる小舟 ──
  if (loc === 'varanasi') {
    const boatX = canvas.width + 30 - ((animFrame * 0.14) % (canvas.width + 60));
    const boatY = tileSize * 1.35 + Math.sin(animFrame * 0.025) * 2;
    const bob   = Math.sin(animFrame * 0.042) * 1.4;
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#5C3D1E';
    ctx.beginPath();
    ctx.moveTo(boatX - 15, boatY + 2 + bob);
    ctx.quadraticCurveTo(boatX, boatY + 7 + bob, boatX + 15, boatY + 2 + bob);
    ctx.lineTo(boatX + 13, boatY - 1 + bob);
    ctx.quadraticCurveTo(boatX, boatY + 4 + bob, boatX - 13, boatY - 1 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.50;
    ctx.strokeStyle = '#3A2410';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boatX - 1, boatY - 1 + bob);
    ctx.lineTo(boatX - 1, boatY - 13 + bob);
    ctx.stroke();
    ctx.fillStyle = '#E8C87A';
    ctx.beginPath();
    ctx.moveTo(boatX - 1, boatY - 13 + bob);
    ctx.lineTo(boatX + 8, boatY - 5 + bob);
    ctx.lineTo(boatX - 1, boatY - 1 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── バラナシ: 寺院の鐘（石段上のお堂から広がる波紋） ──
  if (loc === 'varanasi') {
    const bellShrines = [{x: 1.5, y: 5}, {x: 6.5, y: 5}, {x: 12.5, y: 5}, {x: 17.5, y: 5}];
    const bellPeriod  = 160;
    ctx.save();
    ctx.strokeStyle = '#FFD070';
    ctx.lineWidth   = 0.9;
    for (let si = 0; si < bellShrines.length; si++) {
      const phase = (animFrame + si * 40) % bellPeriod;
      if (phase >= 70) continue;
      const t     = phase / 70;
      const alpha = (1 - t) * 0.28;
      const r     = t * tileSize * 2.8;
      const sx    = bellShrines[si].x * tileSize;
      const sy    = bellShrines[si].y * tileSize;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── バラナシ: ガートに佇む人影 ──
  if (loc === 'varanasi') {
    const figures = [
      {x: 1,  y: 3, sit: true }, {x: 3,  y: 3, sit: false},
      {x: 5,  y: 2, sit: true }, {x: 8,  y: 3, sit: true },
      {x: 10, y: 2, sit: false}, {x: 13, y: 3, sit: true },
      {x: 15, y: 2, sit: false}, {x: 17, y: 3, sit: true },
      {x: 19, y: 2, sit: true },
    ];
    ctx.save();
    ctx.fillStyle = '#261408';
    for (const fg of figures) {
      const fx  = fg.x * tileSize + tileSize * 0.45;
      const fy  = fg.y * tileSize + tileSize - 3;
      const bob = Math.sin(animFrame * 0.018 + fg.x * 0.8) * 0.6;
      ctx.globalAlpha = 0.48 + 0.10 * Math.sin(animFrame * 0.014 + fg.x);
      if (fg.sit) {
        ctx.beginPath(); ctx.arc(fx, fy - 5 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(fx, fy - 1.5 + bob, 2.8, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(fx, fy - 9 + bob, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(fx - 1.5, fy - 7 + bob, 3, 7);
      }
    }
    ctx.restore();
  }

  // ── バラナシ: 時折スコール（雨粒が斜めに流れる） ──
  if (loc === 'varanasi') {
    // 240フレーム周期、うち最初の80フレームだけ降る
    const rainCycle = 360;
    const rainPhase = animFrame % rainCycle;
    if (rainPhase < 100) {
      const intensity = Math.sin((rainPhase / 100) * Math.PI); // ゆっくり始まりゆっくり終わり
      const dropCount = Math.floor(18 * intensity);
      ctx.save();
      ctx.strokeStyle = 'rgba(180,210,255,0.55)';
      ctx.lineWidth = 1;
      for (let d = 0; d < dropCount; d++) {
        // 決定論的な位置（フレーム＋dのハッシュ）
        const rx = ((d * 71 + rainPhase * 3) % canvas.width);
        const ry = ((d * 53 + rainPhase * 5) % canvas.height);
        const len = 6 + (d % 3) * 2;
        ctx.globalAlpha = 0.3 * intensity + 0.2 * ((d % 3) / 3);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + 3, ry + len); // 斜め右下
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 雨粒の水面波紋 ──
  if (loc === 'varanasi') {
    const rp2 = animFrame % 360;
    if (rp2 < 100) {
      const inten2 = Math.sin((rp2 / 100) * Math.PI);
      const ripN   = Math.floor(7 * inten2) + 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(150,195,225,1)';
      ctx.lineWidth   = 0.7;
      for (let ri = 0; ri < ripN; ri++) {
        const rx  = ((ri * 83 + rp2 * 11) % canvas.width + canvas.width) % canvas.width;
        const ry  = ((ri * 29 + 7) % (2 * tileSize - 6)) + 3;
        const rr  = ((rp2 + ri * 17) % 24) * 0.65;
        const ra  = inten2 * Math.max(0, 1 - rr / 14) * 0.32;
        if (ra < 0.02) continue;
        ctx.globalAlpha = ra;
        ctx.beginPath();
        ctx.ellipse(rx, ry, rr, rr * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 夜明けのお供え花びら ──
  if (loc === 'varanasi') {
    const elapsedVd = animFrame - fieldEnterFrame;
    if (elapsedVd < 220) {
      const intensity = Math.sin((elapsedVd / 220) * Math.PI) * 0.88;
      const petalCols = ['#FF8C00', '#FFD700', '#FF4500', '#FF6B35', '#FFAA20'];
      ctx.save();
      for (let i = 0; i < 10; i++) {
        const speed = 0.32 + (i % 3) * 0.16;
        const px    = ((i * 61 + animFrame * speed * 0.9) % (canvas.width + 20) + canvas.width + 20) % (canvas.width + 20) - 10;
        const py    = ((animFrame * speed * 0.6 + i * 47) % (canvas.height * 0.65)) + canvas.height * 0.08;
        const rot   = animFrame * 0.022 + i * 0.65;
        const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.05 + i * 1.1);
        ctx.globalAlpha = intensity * pulse * 0.42;
        ctx.fillStyle   = petalCols[i % petalCols.length];
        ctx.beginPath();
        ctx.ellipse(px, py, 3.2, 1.8, rot, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガート（段）に小さな燭台の炎 ──
  if (loc === 'varanasi') {
    const candlePositions = [2, 7, 13, 18]; // ガート行(2-3)上のX列
    for (let ci = 0; ci < candlePositions.length; ci++) {
      const cx   = candlePositions[ci] * tileSize + tileSize / 2;
      const cy2  = 2 * tileSize + 6; // ガート最上段
      const flicker = 0.6 + 0.4 * Math.sin(animFrame * 0.18 + ci * 1.7);
      const alpha = flicker * 0.75;
      // 炎グロー
      const cg = ctx.createRadialGradient(cx, cy2, 0, cx, cy2, 7);
      cg.addColorStop(0, `rgba(255,180,40,${alpha})`);
      cg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy2, 7, 0, Math.PI * 2);
      ctx.fill();
      // 炎の芯
      ctx.globalAlpha = flicker * 0.95;
      ctx.fillStyle = '#FFEEAA';
      ctx.fillRect(cx - 1, cy2 - 3, 2, 4);
      ctx.restore();
    }
  }

  // ── バラナシ: ガンガー・アーティの炎光線 ──
  if (loc === 'varanasi') {
    const elapsedAa = animFrame - fieldEnterFrame;
    if (elapsedAa >= 600) {
      const rise     = Math.min(1, (elapsedAa - 600) / 400);
      const shrinesA = [{x: 1.5, y: 5}, {x: 6.5, y: 5}, {x: 12.5, y: 5}, {x: 17.5, y: 5}];
      for (const sh of shrinesA) {
        const sx      = sh.x * tileSize;
        const sy      = sh.y * tileSize;
        const flicker = 0.72 + 0.28 * Math.sin(animFrame * 0.09 + sh.x);
        for (let b = 0; b < 6; b++) {
          const angle  = -Math.PI * 0.82 + b * (Math.PI / 5);
          const len    = tileSize * (2.4 + 0.7 * Math.sin(animFrame * 0.05 + b * 0.8));
          const alpha  = rise * flicker * (0.075 - (b % 2) * 0.018);
          if (alpha < 0.005) continue;
          const ex = sx + Math.cos(angle) * len;
          const ey = sy + Math.sin(angle) * len;
          ctx.save();
          ctx.globalAlpha = alpha;
          const bg = ctx.createLinearGradient(sx, sy, ex, ey);
          bg.addColorStop(0, 'rgba(255,200,55,1)');
          bg.addColorStop(1, 'rgba(255,90,10,0)');
          ctx.strokeStyle = bg;
          ctx.lineWidth   = 2 + b % 2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // ── バラナシ: ランゴリー ──
  if (loc === 'varanasi') {
    // 石段の一角に描かれた幾何学的なランゴリー模様
    const rgX = canvas.width * 0.65;
    const rgY = tileSize * 3.8;
    const pulse = 0.7 + 0.3 * Math.sin(animFrame * 0.025);
    ctx.save();
    // 外側から内側へ同心の花弁模様
    const rgColors = ['#E04090', '#FF8020', '#FFEE20', '#40B840', '#2060E0'];
    for (let layer = 4; layer >= 0; layer--) {
      const r = 4 + layer * 4;
      const petals = 8;
      ctx.globalAlpha = (0.18 + layer * 0.04) * pulse;
      ctx.fillStyle   = rgColors[layer % rgColors.length];
      for (let p = 0; p < petals; p++) {
        const pa = (p / petals) * Math.PI * 2 + layer * 0.2;
        ctx.beginPath();
        ctx.ellipse(
          rgX + Math.cos(pa) * r * 0.5,
          rgY + Math.sin(pa) * r * 0.4,
          r * 0.45, r * 0.25, pa, 0, Math.PI * 2
        );
        ctx.fill();
      }
    }
    // 中心の点
    ctx.globalAlpha = 0.45 * pulse;
    ctx.fillStyle   = '#FFEE80';
    ctx.beginPath();
    ctx.arc(rgX, rgY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // 外側の小さな点の輪
    ctx.globalAlpha = 0.22 * pulse;
    ctx.fillStyle   = '#F0C030';
    for (let d = 0; d < 12; d++) {
      const da = (d / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(rgX + Math.cos(da) * 22, rgY + Math.sin(da) * 18, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── バラナシ: ガートの聖なる牛 ──
  if (loc === 'varanasi') {
    const elapsedCow = animFrame - fieldEnterFrame;
    const cowAlpha = Math.min(1, elapsedCow / 300) * 0.84;
    if (cowAlpha > 0) {
      ctx.save();
      const cows = [
        { x: 0.08, y: 0.78, facing: 1,  size: 1.0, phase: 0.0  },
        { x: 0.30, y: 0.82, facing: -1, size: 0.9, phase: 1.7  },
        { x: 0.55, y: 0.76, facing: 1,  size: 1.1, phase: 0.8  },
        { x: 0.78, y: 0.80, facing: -1, size: 0.95,phase: 2.5  },
        { x: 0.92, y: 0.84, facing: 1,  size: 0.85,phase: 1.2  },
      ];
      for (const cow of cows) {
        const cx = canvas.width  * cow.x;
        const cy = canvas.height * cow.y;
        const s  = 14 * cow.size;
        const f  = cow.facing;
        // Idle head bob
        const headBob = Math.sin(animFrame * 0.018 + cow.phase) * 1.5;
        ctx.globalAlpha = cowAlpha * 0.88;
        ctx.save();
        ctx.scale(f, 1);
        const ox = -cx * f; // offset to keep position
        // Body
        ctx.fillStyle = 'rgba(235,225,210,1)';
        ctx.beginPath();
        ctx.ellipse(cx * f + ox, cy, s * 1.4, s * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.beginPath();
        ctx.ellipse(cx * f + s * 1.7 + ox, cy - s * 0.3 + headBob, s * 0.65, s * 0.55, 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Hump
        ctx.fillStyle = 'rgba(220,210,195,1)';
        ctx.beginPath();
        ctx.ellipse(cx * f + s * 0.2 + ox, cy - s * 0.75, s * 0.6, s * 0.45, -0.3, 0, Math.PI * 2);
        ctx.fill();
        // Legs
        ctx.fillStyle = 'rgba(210,200,185,1)';
        const legPositions = [-s * 0.9, -s * 0.3, s * 0.4, s * 1.0];
        for (let li = 0; li < legPositions.length; li++) {
          const legX = cx * f + legPositions[li] + ox;
          const legSway = Math.sin(animFrame * 0.02 + cow.phase + li * 0.8) * 1.5;
          ctx.beginPath();
          ctx.rect(legX - 2.5, cy + s * 0.55 + legSway, 5, s * 0.55);
          ctx.fill();
        }
        // Tail
        ctx.strokeStyle = 'rgba(180,165,145,1)';
        ctx.lineWidth = 2;
        const tailSwing = Math.sin(animFrame * 0.032 + cow.phase) * 8;
        ctx.beginPath();
        ctx.moveTo(cx * f - s * 1.3 + ox, cy - s * 0.1);
        ctx.quadraticCurveTo(cx * f - s * 1.7 + ox, cy + s * 0.4 + tailSwing, cx * f - s * 1.5 + ox, cy + s * 0.9 + tailSwing);
        ctx.stroke();
        // Eye
        ctx.fillStyle = 'rgba(30,20,10,1)';
        ctx.beginPath();
        ctx.arc(cx * f + s * 1.95 + ox, cy - s * 0.4 + headBob, 2, 0, Math.PI * 2);
        ctx.fill();
        // Flower garland hint
        ctx.fillStyle = 'rgba(255,80,80,0.8)';
        ctx.globalAlpha = cowAlpha * 0.55;
        for (let gi = 0; gi < 4; gi++) {
          const gx = cx * f + s * (0.4 + gi * 0.35) + ox;
          const gy = cy - s * 0.68;
          ctx.beginPath();
          ctx.arc(gx, gy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 霧の中の船影 ──
  if (loc === 'varanasi') {
    const elapsedBoat = animFrame - fieldEnterFrame;
    const boatFadeIn  = Math.min(1, Math.max(0, (elapsedBoat - 300) / 350));
    const boatFadeOut = Math.max(0, 1 - Math.max(0, (elapsedBoat - 2800) / 300));
    const boatAlpha   = boatFadeIn * boatFadeOut * 0.78;
    if (boatAlpha > 0.005) {
      ctx.save();
      // River mist veil
      const mistGrad = ctx.createLinearGradient(0, canvas.height * 0.60, 0, canvas.height * 0.78);
      mistGrad.addColorStop(0, 'rgba(210,220,230,0)');
      mistGrad.addColorStop(0.4, 'rgba(210,220,230,' + (boatAlpha * 0.42).toFixed(3) + ')');
      mistGrad.addColorStop(1, 'rgba(200,215,228,' + (boatAlpha * 0.28).toFixed(3) + ')');
      ctx.fillStyle = mistGrad;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, canvas.height * 0.60, canvas.width, canvas.height * 0.18);
      // Boat silhouettes drifting slowly
      const boats = [
        { baseX: 0.12, y: 0.69, driftSpeed: 0.00008, phase: 0.0,  len: 45, mast: true  },
        { baseX: 0.38, y: 0.72, driftSpeed: 0.00006, phase: 1.8,  len: 38, mast: false },
        { baseX: 0.60, y: 0.67, driftSpeed: 0.00010, phase: 0.9,  len: 52, mast: true  },
        { baseX: 0.82, y: 0.71, driftSpeed: 0.00007, phase: 3.1,  len: 35, mast: false },
      ];
      for (const bt of boats) {
        const driftX = (bt.baseX + animFrame * bt.driftSpeed) % 1.15 - 0.05;
        const bobY   = Math.sin(animFrame * 0.02 + bt.phase) * 2;
        const bx     = canvas.width  * driftX;
        const by     = canvas.height * bt.y + bobY;
        const hl     = bt.len * 0.5;
        // Distance-based mist fade
        const distFog = 0.5 + Math.abs(driftX - 0.5) * 0.8;
        ctx.globalAlpha = boatAlpha * (1 - Math.min(0.6, distFog * 0.5)) * 0.88;
        // Hull silhouette
        ctx.fillStyle = 'rgba(35,28,22,1)';
        ctx.beginPath();
        ctx.moveTo(bx - hl, by);
        ctx.quadraticCurveTo(bx - hl * 0.9, by + 6, bx, by + 7);
        ctx.quadraticCurveTo(bx + hl * 0.9, by + 6, bx + hl, by);
        ctx.lineTo(bx + hl * 0.8, by - 3);
        ctx.lineTo(bx - hl * 0.8, by - 3);
        ctx.closePath();
        ctx.fill();
        if (bt.mast) {
          // Mast and sail
          ctx.strokeStyle = 'rgba(45,35,25,1)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(bx - 4, by - 3);
          ctx.lineTo(bx - 4, by - 32);
          ctx.stroke();
          // Furled sail shape
          ctx.globalAlpha = boatAlpha * 0.65;
          ctx.fillStyle = 'rgba(80,65,50,0.8)';
          ctx.beginPath();
          ctx.moveTo(bx - 4, by - 28);
          ctx.quadraticCurveTo(bx + 14, by - 22, bx + 12, by - 10);
          ctx.lineTo(bx - 4, by - 10);
          ctx.closePath();
          ctx.fill();
        }
        // Reflection on water
        ctx.globalAlpha = boatAlpha * 0.22;
        ctx.fillStyle = 'rgba(35,28,22,1)';
        ctx.save();
        ctx.scale(1, -0.4);
        ctx.translate(0, -by * 2 - 14);
        ctx.beginPath();
        ctx.moveTo(bx - hl, by);
        ctx.quadraticCurveTo(bx, by + 7, bx + hl, by);
        ctx.lineTo(bx + hl * 0.8, by - 3);
        ctx.lineTo(bx - hl * 0.8, by - 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 朝の鐘の波紋 ──
  if (loc === 'varanasi') {
    const elapsedBell = animFrame - fieldEnterFrame;
    const bellAlpha = Math.min(1, elapsedBell / 250) * 0.70;
    if (bellAlpha > 0) {
      ctx.save();
      // Bell rings at intervals — each ring spawns ripple rings on the water
      const bellIntervals = [0, 140, 310, 500, 720, 960, 1230];
      for (const bStart of bellIntervals) {
        if (elapsedBell < bStart) continue;
        const bAge = elapsedBell - bStart;
        // 3 concentric ripple rings per bell strike
        for (let ri = 0; ri < 3; ri++) {
          const ringDelay = ri * 18;
          if (bAge < ringDelay) continue;
          const rAge   = bAge - ringDelay;
          const rDur   = 160;
          const rT     = Math.min(1, rAge / rDur);
          const rAlpha = (1 - rT) * bellAlpha * 0.55;
          if (rAlpha < 0.005) continue;
          // Ripple origin — center of river scene
          const ringX  = canvas.width  * (0.35 + (bStart % 200) / 700);
          const ringY  = canvas.height * (0.68 + ri * 0.03);
          const maxR   = 40 + ri * 20;
          const curR   = rT * maxR;
          ctx.globalAlpha = rAlpha;
          ctx.strokeStyle = 'rgba(180,210,240,1)';
          ctx.lineWidth   = 1.2 - ri * 0.25;
          ctx.beginPath();
          ctx.ellipse(ringX, ringY, curR * 2.2, curR * 0.55, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Subtle golden shimmer on water surface from temple glow
      const shimmerT = Math.sin(animFrame * 0.025) * 0.5 + 0.5;
      ctx.globalAlpha = bellAlpha * shimmerT * 0.15;
      const shimGrad = ctx.createLinearGradient(0, canvas.height * 0.62, 0, canvas.height * 0.85);
      shimGrad.addColorStop(0, 'rgba(255,220,100,0.6)');
      shimGrad.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = shimGrad;
      ctx.fillRect(0, canvas.height * 0.62, canvas.width, canvas.height * 0.23);
      ctx.restore();
    }
  }

  // ── バラナシ: 夕暮れのディヤ流し ──
  if (loc === 'varanasi') {
    const elapsedDiya = animFrame - fieldEnterFrame;
    const diyaFadeIn  = Math.min(1, Math.max(0, (elapsedDiya - 700) / 280));
    const diyaFadeOut = Math.max(0, 1 - Math.max(0, (elapsedDiya - 2500) / 350));
    const diyaAlpha   = diyaFadeIn * diyaFadeOut;
    if (diyaAlpha > 0.005) {
      ctx.save();
      // Amber dusk wash on lower canvas
      const duskGrad = ctx.createLinearGradient(0, canvas.height * 0.55, 0, canvas.height);
      duskGrad.addColorStop(0, 'rgba(200,100,20,' + (diyaAlpha * 0.18).toFixed(3) + ')');
      duskGrad.addColorStop(1, 'rgba(160,60,10,' + (diyaAlpha * 0.08).toFixed(3) + ')');
      ctx.fillStyle = duskGrad;
      ctx.fillRect(0, canvas.height * 0.55, canvas.width, canvas.height * 0.45);
      // Floating diyas drifting downstream (rightward)
      const diyaDefs = [
        { baseX: 0.05, baseY: 0.72, speed: 0.00022, phase: 0.0,  size: 4.5, hue: 30  },
        { baseX: 0.18, baseY: 0.78, speed: 0.00019, phase: 1.4,  size: 3.8, hue: 40  },
        { baseX: 0.30, baseY: 0.68, speed: 0.00025, phase: 0.7,  size: 5.0, hue: 25  },
        { baseX: 0.44, baseY: 0.74, speed: 0.00021, phase: 2.1,  size: 4.2, hue: 35  },
        { baseX: 0.56, baseY: 0.81, speed: 0.00018, phase: 3.3,  size: 3.6, hue: 45  },
        { baseX: 0.67, baseY: 0.70, speed: 0.00024, phase: 0.3,  size: 4.8, hue: 28  },
        { baseX: 0.79, baseY: 0.77, speed: 0.00020, phase: 1.9,  size: 4.0, hue: 38  },
        { baseX: 0.90, baseY: 0.65, speed: 0.00023, phase: 2.8,  size: 5.2, hue: 22  },
      ];
      for (const d of diyaDefs) {
        // Drift right over time, wrap around
        const drift = (d.baseX + animFrame * d.speed) % 1.0;
        const bob   = Math.sin(animFrame * 0.038 + d.phase) * 3;
        const dx    = canvas.width  * drift;
        const dy    = canvas.height * d.baseY + bob;
        const s     = d.size;
        // Reflection shimmer on water
        const reflAlpha = diyaAlpha * 0.35 * (0.6 + Math.sin(animFrame * 0.09 + d.phase) * 0.4);
        ctx.globalAlpha = reflAlpha;
        const reflGrad = ctx.createRadialGradient(dx, dy + s * 2.5, 0, dx, dy + s * 2.5, s * 3.5);
        reflGrad.addColorStop(0, 'rgba(255,180,40,0.8)');
        reflGrad.addColorStop(1, 'rgba(255,120,0,0)');
        ctx.fillStyle = reflGrad;
        ctx.beginPath();
        ctx.ellipse(dx, dy + s * 2.5, s * 1.6, s * 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Clay saucer
        ctx.globalAlpha = diyaAlpha * 0.92;
        ctx.fillStyle = 'rgba(180,90,40,1)';
        ctx.beginPath();
        ctx.ellipse(dx, dy, s * 1.4, s * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Flame glow halo
        const flickerAmp = 0.6 + Math.sin(animFrame * 0.22 + d.phase * 3) * 0.4;
        ctx.globalAlpha = diyaAlpha * flickerAmp * 0.75;
        const flameGrad = ctx.createRadialGradient(dx, dy - s, 0, dx, dy - s, s * 3);
        flameGrad.addColorStop(0, 'rgba(255,230,80,0.9)');
        flameGrad.addColorStop(0.4, 'rgba(255,140,20,0.5)');
        flameGrad.addColorStop(1, 'rgba(200,60,0,0)');
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.arc(dx, dy - s, s * 3, 0, Math.PI * 2);
        ctx.fill();
        // Flame tip
        ctx.globalAlpha = diyaAlpha * (0.8 + flickerAmp * 0.2);
        ctx.fillStyle = 'rgba(255,240,140,1)';
        ctx.beginPath();
        ctx.ellipse(dx, dy - s * 1.2, s * 0.3, s * 0.7 * flickerAmp, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの朝の白鷺 ──
  if (loc === 'varanasi') {
    const elapsedEgret = animFrame - fieldEnterFrame;
    const egretAlpha = Math.min(1, elapsedEgret / 220) * 0.82;
    if (egretAlpha > 0) {
      ctx.save();
      // White egrets standing at the water's edge
      const egrets = [
        { x: 0.14, y: 0.66, pose: 'standing' },
        { x: 0.35, y: 0.68, pose: 'feeding' },
        { x: 0.62, y: 0.65, pose: 'standing' },
        { x: 0.81, y: 0.67, pose: 'preening' },
      ];
      for (const eg of egrets) {
        const ex = canvas.width * eg.x;
        const ey = canvas.height * eg.y;
        const bob = Math.sin(animFrame * 0.018 + eg.x * 5) * 1.5;
        ctx.globalAlpha = egretAlpha * 0.9;
        ctx.fillStyle = '#f0f0f8';
        // Legs
        ctx.strokeStyle = '#d0b080';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - 3, ey + bob);
        ctx.lineTo(ex - 3, ey + 14 + bob);
        ctx.moveTo(ex + 3, ey + bob);
        ctx.lineTo(ex + 3, ey + 14 + bob);
        ctx.stroke();
        // Feet
        ctx.strokeStyle = '#c0a060';
        ctx.beginPath();
        ctx.moveTo(ex - 3, ey + 14 + bob);
        ctx.lineTo(ex - 8, ey + 15 + bob);
        ctx.moveTo(ex + 3, ey + 14 + bob);
        ctx.lineTo(ex + 8, ey + 15 + bob);
        ctx.stroke();
        if (eg.pose === 'feeding') {
          // Neck extended down
          ctx.fillStyle = '#f0f0f8';
          ctx.beginPath();
          ctx.ellipse(ex, ey - 4 + bob, 5, 12, 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(ex + 7, ey + 6 + bob, 7, 4, 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#c0b040';
          ctx.beginPath();
          ctx.moveTo(ex + 12, ey + 7 + bob);
          ctx.lineTo(ex + 20, ey + 9 + bob);
          ctx.lineTo(ex + 12, ey + 9 + bob);
          ctx.closePath();
          ctx.fill();
        } else if (eg.pose === 'preening') {
          // Body + head turned to side
          ctx.beginPath();
          ctx.ellipse(ex, ey - 6 + bob, 7, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(ex - 6, ey - 14 + bob, 4, 3, -0.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Standard standing: upright body + neck
          ctx.beginPath();
          ctx.ellipse(ex, ey - 5 + bob, 6, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(ex, ey - 16 + bob, 3, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(ex + 2, ey - 24 + bob, 4, 3, 0.2, 0, Math.PI * 2);
          ctx.fill();
          // Bill
          ctx.fillStyle = '#c0b040';
          ctx.beginPath();
          ctx.moveTo(ex + 5, ey - 24 + bob);
          ctx.lineTo(ex + 14, ey - 24 + bob);
          ctx.lineTo(ex + 5, ey - 22 + bob);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの彩色された船 ──
  if (loc === 'varanasi') {
    const elapsedBoatV = animFrame - fieldEnterFrame;
    const boatVAlpha = Math.min(1, elapsedBoatV / 240) * 0.8;
    if (boatVAlpha > 0) {
      ctx.save();
      // Colorful painted wooden boats moored at the ghat
      const boats = [
        { x: 0.08, y: 0.70, w: 40, color: '#2060b0', stripe: '#e04020' },
        { x: 0.32, y: 0.72, w: 50, color: '#206040', stripe: '#e0c030' },
        { x: 0.62, y: 0.71, w: 44, color: '#802060', stripe: '#40a0d0' },
        { x: 0.88, y: 0.69, w: 38, color: '#a04010', stripe: '#60c060' },
      ];
      for (const bt of boats) {
        const bx = canvas.width * bt.x;
        const by = canvas.height * bt.y;
        const bw = bt.w;
        const bob = Math.sin(animFrame * 0.02 + bt.x * 5) * 2;
        ctx.globalAlpha = boatVAlpha;
        // Hull
        ctx.fillStyle = bt.color;
        ctx.beginPath();
        ctx.moveTo(bx - bw, by + 4 + bob);
        ctx.quadraticCurveTo(bx - bw - 5, by + 10 + bob, bx - bw + 4, by + 14 + bob);
        ctx.lineTo(bx + bw - 4, by + 14 + bob);
        ctx.quadraticCurveTo(bx + bw + 5, by + 10 + bob, bx + bw, by + 4 + bob);
        ctx.closePath();
        ctx.fill();
        // Stripe
        ctx.fillStyle = bt.stripe;
        ctx.beginPath();
        ctx.rect(bx - bw + 6, by + 5 + bob, bw * 2 - 12, 3);
        ctx.fill();
        // Gunwale
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx - bw, by + 4 + bob);
        ctx.lineTo(bx + bw, by + 4 + bob);
        ctx.stroke();
        // Oar
        ctx.strokeStyle = '#8a5a20';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.5, by + 4 + bob);
        ctx.lineTo(bx + bw * 0.8, by - 10 + bob);
        ctx.stroke();
        // Water reflection
        ctx.globalAlpha = boatVAlpha * 0.18;
        ctx.fillStyle = bt.color;
        ctx.beginPath();
        ctx.ellipse(bx, by + 18 + bob, bw * 0.7, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの賑わい ──
  if (loc === 'varanasi') {
    const elapsedCrowd = animFrame - fieldEnterFrame;
    const crowdAlpha = Math.min(1, elapsedCrowd / 250) * 0.72;
    if (crowdAlpha > 0) {
      ctx.save();
      // Silhouette crowd on the ghat steps
      const rowCount = 3;
      for (let row = 0; row < rowCount; row++) {
        const rowY = canvas.height * (0.55 + row * 0.07);
        const figureCount = 7 + row * 2;
        for (let fi = 0; fi < figureCount; fi++) {
          const fx = canvas.width * (0.04 + fi * (0.92 / figureCount)) + Math.sin(fi * 0.9 + row) * 4;
          const height = 18 - row * 3;
          const bob = Math.sin(animFrame * 0.025 + fi * 0.7 + row * 1.1) * 1.5;
          ctx.globalAlpha = crowdAlpha * (0.5 + row * 0.15);
          const shade = 30 + row * 15;
          ctx.fillStyle = 'rgb(' + shade + ',' + shade + ',' + (shade + 5) + ')';
          // Body
          ctx.beginPath();
          ctx.ellipse(fx, rowY + bob, 4.5 - row * 0.5, height * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          // Head
          ctx.beginPath();
          ctx.arc(fx, rowY + bob - height * 0.55, 4 - row * 0.4, 0, Math.PI * 2);
          ctx.fill();
          // Some with raised arms (prayer gesture)
          if (fi % 3 === 0) {
            ctx.strokeStyle = 'rgb(' + shade + ',' + shade + ',' + (shade + 5) + ')';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(fx - 4, rowY + bob - height * 0.2);
            ctx.lineTo(fx - 8, rowY + bob - height * 0.5);
            ctx.moveTo(fx + 4, rowY + bob - height * 0.2);
            ctx.lineTo(fx + 8, rowY + bob - height * 0.5);
            ctx.stroke();
          }
          // Some with cloth on head
          if (fi % 4 === 1) {
            ctx.fillStyle = 'rgba(200,180,140,' + (crowdAlpha * 0.6).toFixed(3) + ')';
            ctx.beginPath();
            ctx.ellipse(fx, rowY + bob - height * 0.55, 5, 3, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの石段の苔 ──
  if (loc === 'varanasi') {
    const elapsedMoss = animFrame - fieldEnterFrame;
    const mossAlpha = Math.min(1, elapsedMoss / 280) * 0.6;
    if (mossAlpha > 0) {
      ctx.save();
      // Patches of wet moss on ghat steps near waterline
      const mossPatches = 9;
      for (let mi = 0; mi < mossPatches; mi++) {
        const mx = canvas.width * (0.06 + mi * 0.11);
        const my = canvas.height * (0.6 + (mi % 3) * 0.05);
        const mw = 20 + (mi % 4) * 8;
        const mh = 6 + (mi % 3) * 3;
        const shimmer = (Math.sin(animFrame * 0.015 + mi * 0.9) + 1) / 2;
        ctx.globalAlpha = mossAlpha * (0.55 + shimmer * 0.2);
        // Dark wet stone base
        ctx.fillStyle = 'rgba(40,50,35,0.4)';
        ctx.beginPath();
        ctx.ellipse(mx, my, mw * 0.55, mh * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        // Moss color (multiple tiny blobs)
        const blobCount = 5 + mi * 2;
        for (let bl = 0; bl < blobCount; bl++) {
          const bx = mx + (Math.sin(bl * 1.3 + mi) * mw * 0.4);
          const by = my + (Math.cos(bl * 0.9 + mi) * mh * 0.35);
          const br = 2.5 + Math.sin(bl * 0.7) * 1;
          const mosshue = 110 + (bl % 3) * 15;
          ctx.globalAlpha = mossAlpha * (0.6 + shimmer * 0.3);
          ctx.fillStyle = 'hsl(' + mosshue + ',65%,' + (25 + shimmer * 10) + '%)';
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }
        // Wet sheen highlight
        ctx.globalAlpha = mossAlpha * shimmer * 0.2;
        ctx.fillStyle = 'rgba(160,200,160,0.4)';
        ctx.beginPath();
        ctx.ellipse(mx - mw * 0.1, my - mh * 0.1, mw * 0.25, mh * 0.2, -0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの大傘 ──
  if (loc === 'varanasi') {
    const elapsedUmbrella = animFrame - fieldEnterFrame;
    const umbAlpha = Math.min(1, elapsedUmbrella / 250) * 0.75;
    if (umbAlpha > 0) {
      ctx.save();
      // Large ceremonial parasol/umbrella providing shade on the ghat
      const umbX = canvas.width * 0.72;
      const umbY = canvas.height * 0.38;
      const poleH = 55;
      const umbR = 38;
      const gentle = Math.sin(animFrame * 0.018) * 1.5;
      ctx.globalAlpha = umbAlpha;
      // Pole
      ctx.strokeStyle = '#8a6a30';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(umbX, umbY + poleH);
      ctx.lineTo(umbX + gentle, umbY);
      ctx.stroke();
      // Canopy (multiple concentric rings for depth)
      const layers = [
        { r: umbR,       color: '#e04030', yOff: 0 },
        { r: umbR * 0.8, color: '#f06040', yOff: -5 },
        { r: umbR * 0.6, color: '#f08050', yOff: -9 },
      ];
      for (const layer of layers) {
        ctx.globalAlpha = umbAlpha * 0.85;
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.ellipse(umbX + gentle, umbY + layer.yOff, layer.r, layer.r * 0.25, 0, Math.PI, 0);
        ctx.fill();
        // Scalloped edge
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(umbX + gentle, umbY + layer.yOff, layer.r, layer.r * 0.25, 0, Math.PI, 0);
        ctx.stroke();
      }
      // Fringe along the edge
      const fringeCount = 16;
      for (let fi = 0; fi < fringeCount; fi++) {
        const fa = Math.PI + (fi / fringeCount) * Math.PI;
        const fxA = umbX + gentle + Math.cos(fa) * umbR;
        const fyA = umbY + Math.sin(fa) * umbR * 0.25;
        const fringeLen = 6 + Math.sin(fi * 0.7 + animFrame * 0.04) * 2;
        ctx.globalAlpha = umbAlpha * 0.6;
        ctx.strokeStyle = '#ffd080';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fxA, fyA);
        ctx.lineTo(fxA + Math.cos(fa) * fringeLen, fyA + fringeLen * 0.5);
        ctx.stroke();
      }
      // Shadow on ground
      ctx.globalAlpha = umbAlpha * 0.15;
      ctx.fillStyle = 'rgba(30,20,10,0.4)';
      ctx.beginPath();
      ctx.ellipse(umbX + gentle * 0.5, umbY + poleH + 4, umbR * 0.7, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── バラナシ: チャイワラーの湯気 ──
  if (loc === 'varanasi') {
    const elapsedChai = animFrame - fieldEnterFrame;
    const chaiAlpha = Math.min(1, elapsedChai / 220) * 0.8;
    if (chaiAlpha > 0) {
      ctx.save();
      const chaiX = canvas.width * 0.38;
      const chaiY = canvas.height * 0.73;
      ctx.globalAlpha = chaiAlpha;
      // Small stove/brazier
      ctx.fillStyle = '#5a3a18';
      ctx.beginPath();
      ctx.ellipse(chaiX, chaiY + 6, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a4a20';
      ctx.beginPath();
      ctx.rect(chaiX - 8, chaiY - 2, 16, 8);
      ctx.fill();
      // Flames in stove
      const flameFlicker = Math.sin(animFrame * 0.15) * 2;
      ctx.fillStyle = 'rgba(255,150,30,0.7)';
      ctx.beginPath();
      ctx.ellipse(chaiX, chaiY, 5, 4 + flameFlicker, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,220,60,0.6)';
      ctx.beginPath();
      ctx.ellipse(chaiX, chaiY - 2, 3, 2.5 + flameFlicker * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Pot (dekchi)
      ctx.fillStyle = '#b8a040';
      ctx.beginPath();
      ctx.ellipse(chaiX, chaiY - 6, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(chaiX, chaiY - 10, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Chai color (brown liquid visible at top)
      ctx.fillStyle = 'rgba(140,70,20,0.8)';
      ctx.beginPath();
      ctx.ellipse(chaiX, chaiY - 10, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Steam wisps rising
      const steamCount = 6;
      for (let st = 0; st < steamCount; st++) {
        const stPhase = ((animFrame * 0.4 + st * 22) % 60) / 60;
        const stX = chaiX + Math.sin(animFrame * 0.06 + st * 1.1) * 5 + (st - 2.5) * 2;
        const stY = chaiY - 14 - stPhase * 35;
        ctx.globalAlpha = chaiAlpha * (1 - stPhase) * 0.35;
        const stGrad = ctx.createRadialGradient(stX, stY, 0, stX, stY, 5);
        stGrad.addColorStop(0, 'rgba(220,215,210,0.7)');
        stGrad.addColorStop(1, 'rgba(210,205,200,0)');
        ctx.fillStyle = stGrad;
        ctx.beginPath();
        ctx.arc(stX, stY, 5 + stPhase * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Vendor silhouette (squatting)
      ctx.globalAlpha = chaiAlpha * 0.8;
      ctx.fillStyle = '#2a1a0a';
      ctx.beginPath();
      ctx.ellipse(chaiX + 14, chaiY - 4, 6, 8, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(chaiX + 16, chaiY - 14, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── バラナシ: 紙の提灯のぼんぼり ──
  if (loc === 'varanasi') {
    const elapsedLanternV = animFrame - fieldEnterFrame;
    const lvAlpha = Math.min(1, Math.max(0, (elapsedLanternV - 1300) / 300)) * 0.8;
    if (lvAlpha > 0.01) {
      ctx.save();
      // String of paper lanterns hanging across the ghat at night
      const lanternPositions = [0.08, 0.22, 0.37, 0.52, 0.67, 0.82, 0.93];
      const strY = canvas.height * 0.22;
      // Hanging string
      ctx.globalAlpha = lvAlpha * 0.35;
      ctx.strokeStyle = 'rgba(100,80,50,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, strY);
      for (let i = 0; i <= 10; i++) {
        const sx = canvas.width * i / 10;
        const sy = strY + Math.sin(i * 0.8) * 3;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      // Individual lanterns
      for (let li = 0; li < lanternPositions.length; li++) {
        const lx = canvas.width * lanternPositions[li];
        const ly = strY + 3;
        const flicker = 0.8 + Math.sin(animFrame * 0.09 + li * 1.3) * 0.2;
        const hue = [30, 0, 180, 60, 300, 120, 210][li];
        // Glow
        ctx.globalAlpha = lvAlpha * flicker * 0.5;
        const glowGrad = ctx.createRadialGradient(lx, ly + 4, 0, lx, ly + 4, 16);
        glowGrad.addColorStop(0, 'hsla(' + hue + ',90%,70%,0.7)');
        glowGrad.addColorStop(1, 'hsla(' + hue + ',80%,60%,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(lx, ly + 4, 16, 0, Math.PI * 2);
        ctx.fill();
        // Lantern body
        ctx.globalAlpha = lvAlpha * flicker * 0.85;
        ctx.fillStyle = 'hsla(' + hue + ',85%,55%,0.85)';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 8, 6, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        // Inner light
        ctx.fillStyle = 'hsla(' + hue + ',90%,80%,0.6)';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 8, 3.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Top/bottom caps
        ctx.fillStyle = '#8a6a40';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 2, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(lx, ly + 14, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Tassel
        ctx.strokeStyle = 'hsla(' + hue + ',70%,45%,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx, ly + 16);
        ctx.lineTo(lx, ly + 22);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの太鼓奏者 ──
  if (loc === 'varanasi') {
    const elapsedDrum = animFrame - fieldEnterFrame;
    const drumAlpha = Math.min(1, elapsedDrum / 220) * 0.82;
    if (drumAlpha > 0) {
      ctx.save();
      const drumX = canvas.width * 0.15;
      const drumY = canvas.height * 0.72;
      const beat = Math.floor(animFrame / 18) % 4;
      ctx.globalAlpha = drumAlpha;
      // Dhol drum
      ctx.fillStyle = '#8a4a20';
      ctx.beginPath();
      ctx.ellipse(drumX, drumY + 5, 14, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a05a28';
      ctx.beginPath();
      ctx.ellipse(drumX, drumY, 14, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Drum heads
      ctx.fillStyle = '#e8d0a0';
      ctx.beginPath();
      ctx.ellipse(drumX - 13, drumY, 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(drumX + 13, drumY, 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rope tension
      ctx.strokeStyle = '#6a3a18';
      ctx.lineWidth = 1;
      for (let r = 0; r < 5; r++) {
        const ropeFrac = r / 4;
        ctx.beginPath();
        ctx.moveTo(drumX - 10, drumY - 7 + r * 3.5);
        ctx.lineTo(drumX + 10, drumY - 7 + r * 3.5);
        ctx.stroke();
      }
      // Player body
      ctx.fillStyle = '#3a2a40';
      ctx.beginPath();
      ctx.ellipse(drumX, drumY - 20, 8, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(drumX, drumY - 34, 6, 0, Math.PI * 2);
      ctx.fill();
      // Arms striking
      const strikeL = beat === 0 || beat === 2 ? 1 : 0;
      const strikeR = beat === 1 || beat === 3 ? 1 : 0;
      ctx.strokeStyle = '#3a2a40';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(drumX - 4, drumY - 22);
      ctx.lineTo(drumX - 16 + strikeL * 3, drumY - 5 + strikeL * 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(drumX + 4, drumY - 22);
      ctx.lineTo(drumX + 16 - strikeR * 3, drumY - 5 + strikeR * 3);
      ctx.stroke();
      // Sound ripples on beat
      if (strikeL || strikeR) {
        const rippleR = (animFrame % 18) * 2.5;
        ctx.globalAlpha = drumAlpha * (1 - (animFrame % 18) / 18) * 0.4;
        ctx.strokeStyle = 'rgba(180,140,100,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(drumX, drumY, rippleR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートを歩く白牛 ──
  if (loc === 'varanasi') {
    const elapsedBull = animFrame - fieldEnterFrame;
    const bullAlpha = Math.min(1, elapsedBull / 250) * 0.85;
    if (bullAlpha > 0) {
      ctx.save();
      // White bull slowly walking along the ghat
      const bullCycle = 500;
      const bullT = (animFrame % bullCycle) / bullCycle;
      const bx = canvas.width * (0.05 + bullT * 0.78);
      const by = canvas.height * 0.72;
      const walkBob = Math.sin(animFrame * 0.09) * 2;
      ctx.globalAlpha = bullAlpha;
      // Body
      ctx.fillStyle = '#f0ece0';
      ctx.beginPath();
      ctx.ellipse(bx, by + walkBob, 22, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      // Hump (zebu)
      ctx.beginPath();
      ctx.ellipse(bx + 8, by + walkBob - 13, 9, 8, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // Neck
      ctx.beginPath();
      ctx.ellipse(bx + 17, by + walkBob - 6, 8, 6, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = '#e8e4d8';
      ctx.beginPath();
      ctx.ellipse(bx + 26, by + walkBob - 8, 10, 7, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Dewlap (loose skin under neck)
      ctx.fillStyle = '#e0dcd0';
      ctx.beginPath();
      ctx.ellipse(bx + 19, by + walkBob + 2, 5, 9, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Horns
      ctx.strokeStyle = '#c0b898';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + 24, by + walkBob - 14);
      ctx.quadraticCurveTo(bx + 30, by + walkBob - 22, bx + 26, by + walkBob - 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + 28, by + walkBob - 14);
      ctx.quadraticCurveTo(bx + 34, by + walkBob - 21, bx + 30, by + walkBob - 25);
      ctx.stroke();
      // Eye
      ctx.fillStyle = '#2a1a0a';
      ctx.beginPath();
      ctx.arc(bx + 30, by + walkBob - 8, 2, 0, Math.PI * 2);
      ctx.fill();
      // Legs walking animation
      const legSwingB = Math.sin(animFrame * 0.09) * 4;
      ctx.strokeStyle = '#d8d4c0';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const legX = [bx - 12, bx - 4, bx + 5, bx + 14];
      legX.forEach((lx, i) => {
        const swing = i % 2 === 0 ? legSwingB : -legSwingB;
        ctx.beginPath();
        ctx.moveTo(lx, by + walkBob + 10);
        ctx.lineTo(lx + swing, by + walkBob + 22);
        ctx.stroke();
      });
      // Tail
      ctx.strokeStyle = '#d8d4c0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - 20, by + walkBob - 2);
      ctx.quadraticCurveTo(bx - 28, by + walkBob + 5, bx - 24, by + walkBob + 14);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの護摩壇の炎 ──
  if (loc === 'varanasi') {
    const elapsedHoma = animFrame - fieldEnterFrame;
    const homaAlpha = Math.min(1, elapsedHoma / 200) * 0.82;
    if (homaAlpha > 0) {
      ctx.save();
      // Sacred fire pit on the ghat steps with rising embers
      const fireX = canvas.width * 0.5;
      const fireY = canvas.height * 0.75;
      // Stone pit base
      ctx.globalAlpha = homaAlpha * 0.7;
      ctx.fillStyle = '#6a5040';
      ctx.beginPath();
      ctx.ellipse(fireX, fireY, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Fire glow on ground
      const fireGlow = ctx.createRadialGradient(fireX, fireY - 5, 0, fireX, fireY, 28);
      fireGlow.addColorStop(0, 'rgba(255,180,50,0.4)');
      fireGlow.addColorStop(0.5, 'rgba(255,100,20,0.15)');
      fireGlow.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = fireGlow;
      ctx.beginPath();
      ctx.arc(fireX, fireY - 5, 28, 0, Math.PI * 2);
      ctx.fill();
      // Flame layers
      const flameLayers = 4;
      for (let fl = 0; fl < flameLayers; fl++) {
        const flH = (18 - fl * 3) + Math.sin(animFrame * 0.09 + fl * 1.2) * 5;
        const flW = 8 - fl * 1.5;
        const flicker = Math.sin(animFrame * 0.12 + fl * 0.8) * 2;
        const flameGrad = ctx.createLinearGradient(fireX + flicker, fireY - 8, fireX + flicker, fireY - 8 - flH);
        if (fl === 0) {
          flameGrad.addColorStop(0, 'rgba(255,100,10,0.9)');
          flameGrad.addColorStop(0.5, 'rgba(255,170,20,0.7)');
          flameGrad.addColorStop(1, 'rgba(255,220,80,0)');
        } else {
          flameGrad.addColorStop(0, 'rgba(255,140,30,0.6)');
          flameGrad.addColorStop(1, 'rgba(255,200,50,0)');
        }
        ctx.globalAlpha = homaAlpha * (0.9 - fl * 0.15);
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.ellipse(fireX + flicker, fireY - 8 - flH * 0.4, flW, flH * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Rising embers
      const emberCount = 8;
      for (let em = 0; em < emberCount; em++) {
        const emPhase = ((animFrame * 0.6 + em * 28) % 70) / 70;
        const emX = fireX + Math.sin(animFrame * 0.07 + em * 1.1) * 8 * emPhase;
        const emY = fireY - 8 - emPhase * 50;
        ctx.globalAlpha = homaAlpha * (1 - emPhase) * 0.7;
        ctx.fillStyle = emPhase < 0.4 ? '#ff9020' : '#ff5010';
        ctx.beginPath();
        ctx.arc(emX, emY, 1.5 * (1 - emPhase * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガンジス川の月橋 ──
  if (loc === 'varanasi') {
    const elapsedMoonBridge = animFrame - fieldEnterFrame;
    if (elapsedMoonBridge >= 1600) {
      const mbAlpha = Math.min(1, (elapsedMoonBridge - 1600) / 400) * 0.65;
      ctx.save();
      // Moonbeam path stretching across the river surface
      const moonX = canvas.width * 0.85;
      const moonY = canvas.height * 0.08;
      const riverY = canvas.height * 0.65;
      // Glowing column from moon to river
      const colGrad = ctx.createLinearGradient(moonX, moonY, moonX, riverY);
      colGrad.addColorStop(0, 'rgba(220,230,255,' + (mbAlpha * 0.3).toFixed(3) + ')');
      colGrad.addColorStop(0.7, 'rgba(200,215,255,' + (mbAlpha * 0.15).toFixed(3) + ')');
      colGrad.addColorStop(1, 'rgba(180,200,255,0)');
      ctx.fillStyle = colGrad;
      ctx.beginPath();
      ctx.moveTo(moonX - 8, moonY);
      ctx.lineTo(moonX + 8, moonY);
      ctx.lineTo(moonX + 35, riverY);
      ctx.lineTo(moonX - 35, riverY);
      ctx.closePath();
      ctx.fill();
      // River reflection: shimmering horizontal band
      const reflW = 120;
      for (let row = 0; row < 8; row++) {
        const ry = riverY + row * 6;
        const rowAlpha = mbAlpha * (1 - row / 8) * 0.5;
        const rowW = reflW * (1 - row * 0.05);
        const wave = Math.sin(animFrame * 0.04 + row * 0.7) * 6;
        const rowGrad = ctx.createLinearGradient(moonX - rowW * 0.5, ry, moonX + rowW * 0.5, ry);
        rowGrad.addColorStop(0, 'rgba(200,215,255,0)');
        rowGrad.addColorStop(0.5, 'rgba(230,240,255,' + rowAlpha.toFixed(3) + ')');
        rowGrad.addColorStop(1, 'rgba(200,215,255,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = rowGrad;
        ctx.beginPath();
        ctx.ellipse(moonX + wave, ry + 2, rowW * 0.5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Moon orb
      ctx.globalAlpha = mbAlpha * 0.9;
      const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 22);
      moonGlow.addColorStop(0, 'rgba(255,255,240,0.95)');
      moonGlow.addColorStop(0.3, 'rgba(230,235,255,0.5)');
      moonGlow.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = moonGlow;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,245,0.95)';
      ctx.beginPath();
      ctx.arc(moonX, moonY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── バラナシ: 子供の凧揚げ ──
  if (loc === 'varanasi') {
    const elapsedKite = animFrame - fieldEnterFrame;
    const kiteAlpha = Math.min(1, elapsedKite / 220) * 0.82;
    if (kiteAlpha > 0) {
      ctx.save();
      // Two kites in the sky, each with a string
      const kites = [
        { handX: 0.22, handY: 0.85, kx0: 0.3, ky0: 0.15, color1: '#e04020', color2: '#f8c030', speed: 0.022, phase: 0 },
        { handX: 0.7,  handY: 0.83, kx0: 0.6, ky0: 0.08, color1: '#3060d0', color2: '#40d0a0', speed: 0.018, phase: 1.2 },
      ];
      for (const kt of kites) {
        const hx = canvas.width * kt.handX;
        const hy = canvas.height * kt.handY;
        const kx = canvas.width * kt.kx0 + Math.sin(animFrame * kt.speed + kt.phase) * 22;
        const ky = canvas.height * kt.ky0 + Math.sin(animFrame * kt.speed * 0.7 + kt.phase + 1) * 12;
        ctx.globalAlpha = kiteAlpha * 0.55;
        // String (catenary-like curve)
        ctx.strokeStyle = 'rgba(180,160,120,0.6)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        const midX = (hx + kx) / 2 + Math.sin(animFrame * 0.015 + kt.phase) * 10;
        const midY = (hy + ky) / 2 + 25;
        ctx.quadraticCurveTo(midX, midY, kx, ky);
        ctx.stroke();
        // Kite diamond
        ctx.globalAlpha = kiteAlpha;
        const ks = 12;
        ctx.fillStyle = kt.color1;
        ctx.beginPath();
        ctx.moveTo(kx, ky - ks);
        ctx.lineTo(kx + ks * 0.7, ky);
        ctx.lineTo(kx, ky + ks);
        ctx.lineTo(kx - ks * 0.7, ky);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = kt.color2;
        ctx.beginPath();
        ctx.moveTo(kx, ky - ks);
        ctx.lineTo(kx + ks * 0.7, ky);
        ctx.lineTo(kx, ky);
        ctx.closePath();
        ctx.fill();
        // Kite tail
        ctx.strokeStyle = kt.color1;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(kx, ky + ks);
        for (let t = 1; t <= 5; t++) {
          const tx = kx + Math.sin(animFrame * 0.08 + kt.phase + t * 0.6) * t * 3;
          const ty = ky + ks + t * 5;
          ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        // Child figure
        ctx.globalAlpha = kiteAlpha * 0.75;
        ctx.fillStyle = '#3a2a20';
        ctx.beginPath();
        ctx.arc(hx, hy - 14, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hx, hy - 7, 3, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3a2a20';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx + 2, hy - 9);
        ctx.lineTo(hx + 7, hy - 5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 対岸の灯火 ──
  if (loc === 'varanasi') {
    const elapsedFarLight = animFrame - fieldEnterFrame;
    if (elapsedFarLight >= 1500) {
      const farAlpha = Math.min(1, (elapsedFarLight - 1500) / 350) * 0.7;
      ctx.save();
      // Row of small flickering lights on the far bank (near horizon)
      const lightCount = 16;
      for (let fi = 0; fi < lightCount; fi++) {
        const fx = canvas.width * (0.04 + fi * 0.062);
        const fy = canvas.height * (0.32 + (fi % 3) * 0.025);
        const flicker = 0.7 + Math.sin(animFrame * 0.11 + fi * 1.4) * 0.3;
        ctx.globalAlpha = farAlpha * flicker * 0.75;
        const lightColor = fi % 3 === 0 ? 'rgba(255,160,40,' : fi % 3 === 1 ? 'rgba(255,200,80,' : 'rgba(200,140,60,';
        const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7);
        glow.addColorStop(0, lightColor + '0.9)');
        glow.addColorStop(0.4, lightColor + '0.35)');
        glow.addColorStop(1, lightColor + '0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(fx, fy, 7, 0, Math.PI * 2);
        ctx.fill();
        // Reflection in water below
        ctx.globalAlpha = farAlpha * flicker * 0.25;
        const refLen = 8 + Math.sin(animFrame * 0.04 + fi) * 3;
        const refGrad = ctx.createLinearGradient(fx, fy + 2, fx, fy + 2 + refLen);
        refGrad.addColorStop(0, lightColor + '0.6)');
        refGrad.addColorStop(1, lightColor + '0)');
        ctx.fillStyle = refGrad;
        ctx.beginPath();
        ctx.ellipse(fx, fy + 2 + refLen * 0.5, 1.5, refLen * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 寺院の旗のはためき ──
  if (loc === 'varanasi') {
    const elapsedFlag = animFrame - fieldEnterFrame;
    const flagAlpha = Math.min(1, elapsedFlag / 200) * 0.8;
    if (flagAlpha > 0) {
      ctx.save();
      // 4 temple flags on tall poles at the top of the screen
      const flags = [
        { x: 0.08, color: '#e05020', color2: '#c03010' },
        { x: 0.28, color: '#e8c030', color2: '#c0a020' },
        { x: 0.68, color: '#d04040', color2: '#b02020' },
        { x: 0.9,  color: '#30a050', color2: '#208040' },
      ];
      for (const fl of flags) {
        const px = canvas.width * fl.x;
        const poleTop = canvas.height * 0.03;
        const poleBot = canvas.height * 0.35;
        // Pole
        ctx.globalAlpha = flagAlpha * 0.85;
        ctx.strokeStyle = '#a08060';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, poleTop);
        ctx.lineTo(px, poleBot);
        ctx.stroke();
        // Flag waving
        const waveAmp = 8;
        const waveFreq = 0.06;
        const wavePhase = fl.x * 10;
        const flagW = 22, flagH = 14;
        ctx.globalAlpha = flagAlpha * 0.85;
        ctx.fillStyle = fl.color;
        ctx.beginPath();
        ctx.moveTo(px, poleTop + 4);
        for (let wx = 0; wx <= flagW; wx += 2) {
          const wy = Math.sin(animFrame * waveFreq + wavePhase + wx * 0.3) * waveAmp * (wx / flagW);
          ctx.lineTo(px + wx, poleTop + 4 + wy);
        }
        for (let wx = flagW; wx >= 0; wx -= 2) {
          const wy = Math.sin(animFrame * waveFreq + wavePhase + wx * 0.3) * waveAmp * (wx / flagW);
          ctx.lineTo(px + wx, poleTop + 4 + flagH + wy * 0.7);
        }
        ctx.closePath();
        ctx.fill();
        // Flag stripe
        ctx.fillStyle = fl.color2;
        ctx.beginPath();
        ctx.moveTo(px, poleTop + 4 + flagH * 0.4);
        for (let wx = 0; wx <= flagW; wx += 2) {
          const wy = Math.sin(animFrame * waveFreq + wavePhase + wx * 0.3) * waveAmp * (wx / flagW);
          ctx.lineTo(px + wx, poleTop + 4 + flagH * 0.4 + wy);
        }
        for (let wx = flagW; wx >= 0; wx -= 2) {
          const wy = Math.sin(animFrame * waveFreq + wavePhase + wx * 0.3) * waveAmp * (wx / flagW);
          ctx.lineTo(px + wx, poleTop + 4 + flagH * 0.6 + wy * 0.7);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 沐浴者のさざ波 ──
  if (loc === 'varanasi') {
    const elapsedRipple = animFrame - fieldEnterFrame;
    const rippleAlpha = Math.min(1, elapsedRipple / 200) * 0.65;
    if (rippleAlpha > 0.01) {
      ctx.save();
      // 4 bather positions each generating ripple rings
      const batherPositions = [0.18, 0.38, 0.6, 0.79];
      for (let bi = 0; bi < batherPositions.length; bi++) {
        const bx = canvas.width * batherPositions[bi];
        const by = canvas.height * (0.65 + (bi % 2) * 0.04);
        // Concentric ripple rings expanding over time
        for (let ring = 0; ring < 4; ring++) {
          const ringPhase = (animFrame * 0.7 + bi * 55 + ring * 18) % 60;
          const ringR = ringPhase * 2.5;
          const ringAlpha = rippleAlpha * (1 - ringPhase / 60) * 0.5;
          if (ringAlpha < 0.01) continue;
          ctx.globalAlpha = ringAlpha;
          ctx.strokeStyle = 'rgba(100,160,200,0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(bx, by, ringR, ringR * 0.38, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Bather silhouette (waist-deep)
        ctx.globalAlpha = rippleAlpha * 0.7;
        ctx.fillStyle = '#2a3040';
        // Shoulders/head above water
        ctx.beginPath();
        ctx.ellipse(bx, by - 10, 5, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by - 18, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 川面の金の光粒 ──
  if (loc === 'varanasi') {
    const elapsedSparkle = animFrame - fieldEnterFrame;
    const sparkIn = Math.min(1, elapsedSparkle / 180);
    const sparkOut = Math.max(0, 1 - (elapsedSparkle - 1200) / 500);
    const sparkAlpha = sparkIn * sparkOut * 0.7;
    if (sparkAlpha > 0.01) {
      ctx.save();
      const sparkCount = 30;
      for (let si = 0; si < sparkCount; si++) {
        const baseX = canvas.width * (0.04 + (si % 10) * 0.1);
        const baseY = canvas.height * (0.6 + (si % 5) * 0.06);
        const drift = Math.sin(animFrame * 0.025 + si * 0.7) * 18;
        const sx = baseX + drift;
        const sy = baseY + Math.cos(animFrame * 0.018 + si * 0.5) * 5;
        const twinkle = Math.pow((Math.sin(animFrame * 0.09 + si * 1.2) + 1) / 2, 2);
        if (twinkle < 0.15) continue;
        ctx.globalAlpha = sparkAlpha * twinkle;
        // Star-shaped sparkle
        const sr2 = 2.5 + twinkle * 2;
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr2 * 2.5);
        grad.addColorStop(0, 'rgba(255,230,100,1)');
        grad.addColorStop(0.3, 'rgba(255,200,60,0.6)');
        grad.addColorStop(1, 'rgba(255,160,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, sr2 * 2.5, 0, Math.PI * 2);
        ctx.fill();
        // Cross gleam
        ctx.strokeStyle = 'rgba(255,245,180,0.9)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - sr2 * 2, sy);
        ctx.lineTo(sx + sr2 * 2, sy);
        ctx.moveTo(sx, sy - sr2 * 2);
        ctx.lineTo(sx, sy + sr2 * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 川辺のマリーゴールド ──
  if (loc === 'varanasi') {
    const elapsedMari = animFrame - fieldEnterFrame;
    const mariAlpha = Math.min(1, elapsedMari / 200) * 0.85;
    if (mariAlpha > 0) {
      ctx.save();
      const petalCount = 22;
      for (let mi = 0; mi < petalCount; mi++) {
        const mx = canvas.width * (0.03 + (mi % 8) * 0.13 + Math.sin(mi * 1.7) * 0.03);
        const my = canvas.height * (0.82 + (mi % 4) * 0.04 + Math.cos(mi * 0.9) * 0.01);
        const mr = 4 + (mi % 3) * 1.5;
        // Gentle bob
        const bob = Math.sin(animFrame * 0.03 + mi * 0.8) * 1.5;
        // Orange-yellow marigold
        const hue = 35 + (mi % 3) * 8;
        ctx.globalAlpha = mariAlpha * (0.75 + Math.sin(mi * 0.7) * 0.15);
        // Petal ring
        const petalN = 10;
        for (let p = 0; p < petalN; p++) {
          const pAngle = (p / petalN) * Math.PI * 2 + animFrame * 0.005 + mi * 0.2;
          const px = mx + Math.cos(pAngle) * mr;
          const py = my + bob + Math.sin(pAngle) * mr * 0.7;
          ctx.fillStyle = 'hsl(' + hue + ',100%,55%)';
          ctx.beginPath();
          ctx.ellipse(px, py + bob, mr * 0.45, mr * 0.6, pAngle, 0, Math.PI * 2);
          ctx.fill();
        }
        // Center
        ctx.fillStyle = 'hsl(' + (hue - 10) + ',80%,35%)';
        ctx.beginPath();
        ctx.arc(mx, my + bob, mr * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの灯籠流し ──
  if (loc === 'varanasi') {
    const elapsedLantern = animFrame - fieldEnterFrame;
    if (elapsedLantern >= 1400) {
      const lanternAlpha = Math.min(1, (elapsedLantern - 1400) / 300) * 0.9;
      ctx.save();
      const lanternCount = 10;
      for (let li = 0; li < lanternCount; li++) {
        const cycle = 900 + li * 60;
        const progress = ((animFrame + li * 90) % cycle) / cycle;
        const lx = canvas.width * 0.05 + progress * canvas.width * 0.85;
        const ly = canvas.height * (0.68 + (li % 5) * 0.04) + Math.sin(animFrame * 0.04 + li * 0.8) * 3;
        const flicker = 0.85 + Math.sin(animFrame * 0.13 + li * 1.7) * 0.15;
        ctx.globalAlpha = lanternAlpha * flicker;
        const glowGrad = ctx.createRadialGradient(lx, ly - 3, 0, lx, ly, 12);
        glowGrad.addColorStop(0, 'rgba(255,200,50,0.9)');
        glowGrad.addColorStop(0.4, 'rgba(255,140,20,0.4)');
        glowGrad.addColorStop(1, 'rgba(255,100,0,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(180,120,60,0.9)';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 3, 6, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,230,80,0.95)';
        ctx.beginPath();
        ctx.ellipse(lx, ly - 1, 2, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,200,0.9)';
        ctx.beginPath();
        ctx.arc(lx, ly - 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 川霧のたなびき ──
  if (loc === 'varanasi') {
    const elapsedMist = animFrame - fieldEnterFrame;
    const mistBase = Math.min(1, elapsedMist / 200);
    const mistFade = Math.max(0, 1 - (elapsedMist - 800) / 400);
    const mistAlpha = mistBase * mistFade * 0.55;
    if (mistAlpha > 0.01) {
      ctx.save();
      const mistLayers = 5;
      for (let mi = 0; mi < mistLayers; mi++) {
        const driftSpeed = 0.18 + mi * 0.07;
        const driftOffset = (animFrame * driftSpeed + mi * 120) % (canvas.width + 200);
        const bandY = canvas.height * (0.55 + mi * 0.06);
        const bandH = 18 + mi * 8;
        const grad = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
        grad.addColorStop(0, 'rgba(220,230,240,0)');
        grad.addColorStop(0.5, 'rgba(220,230,240,' + (mistAlpha * (0.6 + mi * 0.08)).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(220,230,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        const startX = driftOffset - canvas.width * 0.3;
        ctx.moveTo(startX, bandY - bandH);
        for (let wx = startX; wx < startX + canvas.width * 1.6; wx += 20) {
          const wy = bandY + Math.sin((wx + animFrame * driftSpeed) * 0.03 + mi) * 6;
          ctx.lineTo(wx, wy);
        }
        ctx.lineTo(startX + canvas.width * 1.6, bandY + bandH * 2);
        ctx.lineTo(startX, bandY + bandH * 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 川岸の葦 ──
  if (loc === 'varanasi') {
    // 川の水際（tileRow=9付近）に葦が茂り、風に揺れている
    const reedGroups = [
      { x: canvas.width * 0.02, count: 8, phase: 0   },
      { x: canvas.width * 0.88, count: 9, phase: 1.5 },
      { x: canvas.width * 0.48, count: 5, phase: 3.0 },
    ];
    ctx.save();
    for (const group of reedGroups) {
      for (let ri = 0; ri < group.count; ri++) {
        const rx = group.x + ri * 8 - group.count * 4;
        const rBaseY = tileSize * 9.2;
        const rH = 30 + (ri % 3) * 12;
        const sway = Math.sin(animFrame * 0.022 + group.phase + ri * 0.6) * 5;
        const sway2 = Math.sin(animFrame * 0.035 + group.phase + ri * 0.4) * 3;
        ctx.globalAlpha = 0.50;
        ctx.strokeStyle = '#5a7a30';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(rx, rBaseY);
        ctx.quadraticCurveTo(rx + sway * 0.5, rBaseY - rH * 0.5, rx + sway, rBaseY - rH);
        ctx.stroke();
        // 穂（葦の穂先）
        ctx.fillStyle = '#8a6a30';
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.ellipse(rx + sway + sway2 * 0.3, rBaseY - rH - 6, 2, 7, sway * 0.02, 0, Math.PI * 2);
        ctx.fill();
        // 葉（茎から出る細い葉）
        if (ri % 2 === 0) {
          ctx.strokeStyle = '#4a6a20';
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.40;
          ctx.beginPath();
          ctx.moveTo(rx + sway * 0.4, rBaseY - rH * 0.45);
          ctx.quadraticCurveTo(
            rx + sway * 0.4 + 12, rBaseY - rH * 0.45 - 6,
            rx + sway * 0.4 + 18, rBaseY - rH * 0.45 - 3
          );
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── バラナシ: 沐浴後の祈り ──
  if (loc === 'varanasi') {
    // 水から上がった巡礼者が川に向かって手を合わせ、太陽に祈りを捧げる
    const prayerLine = [
      { x: canvas.width * 0.18, y: tileSize * 8.9, facing: 1 },
      { x: canvas.width * 0.34, y: tileSize * 8.7, facing: 1 },
      { x: canvas.width * 0.55, y: tileSize * 8.8, facing: 1 },
      { x: canvas.width * 0.72, y: tileSize * 8.9, facing: 1 },
    ];
    ctx.save();
    for (let pi = 0; pi < prayerLine.length; pi++) {
      const { x, y, facing } = prayerLine[pi];
      const breathe = Math.sin(animFrame * 0.020 + pi * 1.1) * 1.5;
      const sariColors = ['#ff6699','#ffaa22','#4488ff','#22aa44'];
      ctx.globalAlpha = 0.58;
      // 濡れたサリー（体の下半分）
      ctx.fillStyle = sariColors[pi];
      ctx.globalAlpha = 0.48;
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // 胴体（白い上衣）
      ctx.fillStyle = '#e8e0d8';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.rect(x - 5, y - 10, 10, 16);
      ctx.fill();
      // 頭
      ctx.fillStyle = '#2a1808';
      ctx.globalAlpha = 0.58;
      ctx.beginPath();
      ctx.arc(x, y - 16 + breathe, 5.5, 0, Math.PI * 2);
      ctx.fill();
      // 腕（合掌：胸の前で手を合わせる）
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#2a1808';
      // 左腕
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 6);
      ctx.lineTo(x - 2 + facing * 2, y - 12 + breathe * 0.5);
      ctx.stroke();
      // 右腕
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 6);
      ctx.lineTo(x + 2 - facing * 2, y - 12 + breathe * 0.5);
      ctx.stroke();
      // 合掌した手
      ctx.fillStyle = '#3a2818';
      ctx.beginPath();
      ctx.ellipse(x, y - 13 + breathe * 0.5, 4, 3, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // 祈りの光（手から放射）
      const prayerGlow = (Math.sin(animFrame * 0.03 + pi) + 1) / 2 * 0.20;
      ctx.globalAlpha = prayerGlow;
      const pgGrad = ctx.createRadialGradient(x, y - 13, 0, x, y - 13, 14);
      pgGrad.addColorStop(0, 'rgba(255,220,100,0.6)');
      pgGrad.addColorStop(1, 'rgba(255,180,0,0)');
      ctx.fillStyle = pgGrad;
      ctx.beginPath();
      ctx.arc(x, y - 13, 14, 0, Math.PI * 2);
      ctx.fill();
      // 水の滴（体から）
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#6699cc';
      for (let di = 0; di < 3; di++) {
        const dx = x - 4 + di * 4;
        const dy = y + 5 + Math.sin(animFrame * 0.08 + di * 1.5) * 2;
        ctx.beginPath();
        ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── バラナシ: ガートを登る象 ──
  if (loc === 'varanasi') {
    // 寺院の象がガートの広い石段をゆっくり登っていく
    const elephantCycle = 780;
    const ep = animFrame % elephantCycle;
    const et = ep / elephantCycle;
    const eX = -60 + et * (canvas.width + 120);
    const eY = tileSize * 7.5;
    const stepBob = Math.sin(animFrame * 0.08) * 2;
    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#4a4848';
    // 後脚（背景）
    const legStep = Math.sin(animFrame * 0.08) * 5;
    ctx.beginPath();
    ctx.rect(eX - 12, eY + 14, 10, 16 + Math.abs(legStep) * 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(eX + 8, eY + 14, 10, 16 - Math.abs(legStep) * 0.5);
    ctx.fill();
    // 胴体
    ctx.beginPath();
    ctx.ellipse(eX, eY + stepBob, 30, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.ellipse(eX + 28, eY - 4 + stepBob, 18, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // 額の盛り上がり
    ctx.fillStyle = '#3a3838';
    ctx.beginPath();
    ctx.ellipse(eX + 30, eY - 14 + stepBob, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 鼻（象鼻、揺れる）
    ctx.fillStyle = '#4a4848';
    const trunkSway = Math.sin(animFrame * 0.025) * 8;
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#4a4848';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(eX + 45, eY + 2 + stepBob);
    ctx.quadraticCurveTo(eX + 56, eY + 12 + stepBob, eX + 52 + trunkSway, eY + 24 + stepBob);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 耳（大きな扇形）
    ctx.fillStyle = '#3a3838';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(eX + 22, eY - 2 + stepBob, 12, 16, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // 牙（白）
    ctx.fillStyle = '#e8e0d0';
    ctx.globalAlpha = 0.50;
    ctx.beginPath();
    ctx.moveTo(eX + 42, eY + 6 + stepBob);
    ctx.quadraticCurveTo(eX + 52, eY + 8 + stepBob, eX + 50, eY + 16 + stepBob);
    ctx.lineTo(eX + 46, eY + 14 + stepBob);
    ctx.closePath();
    ctx.fill();
    // 前脚
    ctx.fillStyle = '#4a4848';
    ctx.globalAlpha = 0.58;
    ctx.beginPath();
    ctx.rect(eX + 14, eY + 14, 10, 16 + legStep * 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(eX + 26, eY + 14, 10, 16 - legStep * 0.5);
    ctx.fill();
    // 背中に乗るマハウト（象使い）
    ctx.fillStyle = '#cc6010';
    ctx.beginPath();
    ctx.rect(eX - 4, eY - 18 + stepBob, 8, 12);
    ctx.fill();
    ctx.fillStyle = '#2a1808';
    ctx.beginPath();
    ctx.arc(eX, eY - 23 + stepBob, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // しっぽ
    ctx.strokeStyle = '#4a4848';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const tailSwing102 = Math.sin(animFrame * 0.04) * 8;
    ctx.beginPath();
    ctx.moveTo(eX - 28, eY + stepBob);
    ctx.quadraticCurveTo(eX - 36, eY + 10 + stepBob, eX - 34 + tailSwing102, eY + 20 + stepBob);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── バラナシ: 洗濯する女性たち ──
  if (loc === 'varanasi') {
    // ガートの石段で女性たちが鮮やかなサリーを洗い、広げて干す
    const washers = [
      { x: canvas.width * 0.12, y: tileSize * 8.8, sariColor: '#ff4488', phase:  0   },
      { x: canvas.width * 0.30, y: tileSize * 8.6, sariColor: '#44aaff', phase:  1.2 },
      { x: canvas.width * 0.48, y: tileSize * 8.7, sariColor: '#ffaa00', phase:  2.4 },
    ];
    ctx.save();
    for (let wi = 0; wi < washers.length; wi++) {
      const { x, y, sariColor, phase } = washers[wi];
      const wash = Math.sin(animFrame * 0.04 + phase) * 5; // 洗濯の上下動作
      const washUp = wash > 0;
      ctx.globalAlpha = 0.60;
      // 足（しゃがんでいる）
      ctx.fillStyle = '#2a1808';
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // サリーを着た体（前傾み）
      ctx.fillStyle = sariColor;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.rect(x - 6, y - 10, 12, 14);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y - 10, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.fillStyle = '#2a1808';
      ctx.globalAlpha = 0.60;
      ctx.beginPath();
      ctx.arc(x, y - 17, 5, 0, Math.PI * 2);
      ctx.fill();
      // 腕（衣を水に叩く動作）
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2a1808';
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 10);
      ctx.lineTo(x + 12, y - 4 + wash);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 10);
      ctx.lineTo(x - 12, y - 4 + wash * 0.8);
      ctx.stroke();
      // 濡れたサリー（水面に広がる）
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = sariColor;
      ctx.beginPath();
      ctx.ellipse(x - 5, y + 6, 16, 5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // 干したサリー（石段の上に広げてある）
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = sariColor;
      const sariWave = Math.sin(animFrame * 0.03 + phase) * 2;
      ctx.beginPath();
      ctx.moveTo(x - 22, y - 28);
      ctx.lineTo(x + 22, y - 28);
      ctx.quadraticCurveTo(x + 24, y - 18 + sariWave, x + 20, y - 10);
      ctx.lineTo(x - 20, y - 10);
      ctx.quadraticCurveTo(x - 24, y - 18 + sariWave, x - 22, y - 28);
      ctx.closePath();
      ctx.fill();
      // 石段の水溜まり（反射）
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = '#4488cc';
      ctx.beginPath();
      ctx.ellipse(x, y + 8, 12, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── バラナシ: バラナシの夜景（v100記念） ──
  if (loc === 'varanasi') {
    // elapsed > 1400: 対岸に無数の灯りが灯るバラナシの夜景と川面への反射
    const elapsedNight = animFrame - fieldEnterFrame;
    if (elapsedNight > 1300) {
      const nightAlpha = Math.min(1, (elapsedNight - 1300) / 400) * 0.75;
      ctx.save();
      // 夜空（上部をより暗く）
      const skyDark = ctx.createLinearGradient(0, 0, 0, tileSize * 9);
      skyDark.addColorStop(0,   `rgba(10,8,25,${nightAlpha * 0.7})`);
      skyDark.addColorStop(0.6, `rgba(20,15,40,${nightAlpha * 0.4})`);
      skyDark.addColorStop(1,   'rgba(10,8,25,0)');
      ctx.fillStyle = skyDark;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, tileSize * 9);
      ctx.fill();
      // 対岸の建物シルエット
      ctx.fillStyle = '#0a0818';
      ctx.globalAlpha = nightAlpha * 0.85;
      for (let bi = 0; bi < 16; bi++) {
        const bx = bi * 42 - 8;
        const bh = 22 + (bi * 7 % 18);
        const bw = 30 + (bi * 5 % 14);
        ctx.beginPath();
        ctx.rect(bx, tileSize * 8.8 - bh, bw, bh);
        ctx.fill();
      }
      // 建物の窓の灯り
      const warmColors = ['#ffcc44','#ffaa22','#ff8811','#ffdd66','#ffe088'];
      for (let wi = 0; wi < 35; wi++) {
        const wx = (wi * 19 + 5) % canvas.width;
        const wy = tileSize * 8.8 - 5 - (wi * 7 % 20);
        const flicker = (Math.sin(animFrame * 0.04 + wi * 1.7) + 1) / 2;
        ctx.globalAlpha = nightAlpha * (0.5 + flicker * 0.4);
        ctx.fillStyle = warmColors[wi % warmColors.length];
        ctx.beginPath();
        ctx.rect(wx, wy, 4, 3);
        ctx.fill();
      }
      // 川面への反射（縦方向の揺らぎ）
      for (let ri = 0; ri < 20; ri++) {
        const rx = (ri * 32 + 10) % canvas.width;
        const refGrad = ctx.createLinearGradient(rx, tileSize * 9, rx, tileSize * 14);
        const col = warmColors[ri % warmColors.length];
        const r = parseInt(col.slice(1,3), 16);
        const g = parseInt(col.slice(3,5), 16);
        const b = parseInt(col.slice(5,7), 16);
        refGrad.addColorStop(0,   `rgba(${r},${g},${b},${nightAlpha * 0.55})`);
        refGrad.addColorStop(0.5, `rgba(${r},${g},${b},${nightAlpha * 0.20})`);
        refGrad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = refGrad;
        const shimmerX = Math.sin(animFrame * 0.04 + ri * 0.8) * 4;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(rx + shimmerX, tileSize * 11, 3, tileSize * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 星（夜空）
      ctx.fillStyle = '#e8e0f8';
      for (let si = 0; si < 25; si++) {
        const sx = (si * 27 + 8) % canvas.width;
        const sy = tileSize * (0.2 + (si % 5) * 0.5);
        const sBlink = (Math.sin(animFrame * 0.04 + si * 1.3) + 1) / 2;
        ctx.globalAlpha = nightAlpha * sBlink * 0.65;
        ctx.beginPath();
        ctx.arc(sx, sy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 上空のカラス ──
  if (loc === 'varanasi') {
    // カラスが数羽、ガートの上空を旋回したり石段に止まったりする
    const crows = [
      { bx: canvas.width * 0.20, by: tileSize * 3.5, orbitR: 30, orbitY: 12, speed: 0.018, phase:  0    },
      { bx: canvas.width * 0.55, by: tileSize * 2.8, orbitR: 40, orbitY: 10, speed: 0.014, phase:  2.1  },
      { bx: canvas.width * 0.78, by: tileSize * 3.2, orbitR: 25, orbitY: 8,  speed: 0.022, phase:  4.3  },
    ];
    // 石段に止まっているカラス
    const perchedCrows = [
      { x: canvas.width * 0.08, y: tileSize * 7.6 },
      { x: canvas.width * 0.92, y: tileSize * 7.8 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1a1a1a';
    // 止まっているカラス
    for (const pc of perchedCrows) {
      const headBob = Math.sin(animFrame * 0.05 + pc.x) * 1;
      ctx.beginPath();
      ctx.arc(pc.x, pc.y - 6 + headBob, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(pc.x, pc.y, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // くちばし
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(pc.x + 4, pc.y - 6 + headBob);
      ctx.lineTo(pc.x + 9, pc.y - 5 + headBob);
      ctx.lineTo(pc.x + 4, pc.y - 4 + headBob);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      // 足
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pc.x - 2, pc.y + 4);
      ctx.lineTo(pc.x - 2, pc.y + 8);
      ctx.moveTo(pc.x + 2, pc.y + 4);
      ctx.lineTo(pc.x + 2, pc.y + 8);
      ctx.stroke();
    }
    // 旋回するカラス
    for (let ci = 0; ci < crows.length; ci++) {
      const c = crows[ci];
      const angle = animFrame * c.speed + c.phase;
      const cx = c.bx + Math.cos(angle) * c.orbitR;
      const cy = c.by + Math.sin(angle) * c.orbitY;
      const bankAngle = Math.cos(angle) * 0.2;
      // 翼の羽ばたき
      const wingFlap = Math.sin(animFrame * 0.18 + ci * 0.7) * 5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(bankAngle - Math.atan2(Math.sin(angle + 0.1) * c.orbitY, Math.cos(angle + 0.1) * c.orbitR));
      ctx.fillStyle = '#1a1a1a';
      ctx.globalAlpha = 0.55;
      // 体
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.arc(7, -1, 3, 0, Math.PI * 2);
      ctx.fill();
      // 翼（左右）
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-4, -6 + wingFlap, -18, -4 + wingFlap);
      ctx.quadraticCurveTo(-12, 0, -4, 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-4, 6 - wingFlap, -18, 4 - wingFlap);
      ctx.quadraticCurveTo(-12, 0, -4, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── バラナシ: ガートの人力車 ──
  if (loc === 'varanasi') {
    // 石段の上の道を三輪人力車（サイクルリキシャ）が走り抜ける
    const rickCycle = 580;
    const rp = animFrame % rickCycle;
    const rt = rp / rickCycle;
    // 右から左へ
    const rikX = canvas.width + 60 - rt * (canvas.width + 120);
    const rikY = tileSize * 7.2;
    const wheelRot = animFrame * 0.18; // 車輪の回転
    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#2a1808';
    ctx.strokeStyle = '#2a1808';
    // 車体（箱形の客席）
    ctx.fillStyle = '#3366aa';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.rect(rikX - 22, rikY - 22, 28, 18);
    ctx.fill();
    // 屋根
    ctx.fillStyle = '#2244aa';
    ctx.beginPath();
    ctx.rect(rikX - 24, rikY - 24, 32, 5);
    ctx.fill();
    // 幌の支柱
    ctx.strokeStyle = '#1a2a6a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(rikX - 22, rikY - 22);
    ctx.lineTo(rikX - 24, rikY - 24);
    ctx.moveTo(rikX + 6, rikY - 22);
    ctx.lineTo(rikX + 8, rikY - 24);
    ctx.stroke();
    // 客（頭だけ見える）
    ctx.fillStyle = '#2a1808';
    ctx.globalAlpha = 0.58;
    ctx.beginPath();
    ctx.arc(rikX - 8, rikY - 16, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // フレーム
    ctx.strokeStyle = '#1a1008';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rikX + 6, rikY - 4);
    ctx.lineTo(rikX + 30, rikY - 4);
    ctx.stroke();
    // 後輪（大きい）
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a1008';
    ctx.beginPath();
    ctx.arc(rikX - 8, rikY, 11, 0, Math.PI * 2);
    ctx.stroke();
    // 後輪スポーク
    ctx.lineWidth = 0.8;
    for (let sp = 0; sp < 8; sp++) {
      const spa = wheelRot + (sp / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(rikX - 8, rikY);
      ctx.lineTo(rikX - 8 + Math.cos(spa) * 10, rikY + Math.sin(spa) * 10);
      ctx.stroke();
    }
    // 前輪（小さい）
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rikX + 30, rikY + 2, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    for (let sp = 0; sp < 6; sp++) {
      const spa = wheelRot * 1.2 + (sp / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(rikX + 30, rikY + 2);
      ctx.lineTo(rikX + 30 + Math.cos(spa) * 7, rikY + 2 + Math.sin(spa) * 7);
      ctx.stroke();
    }
    // こぐ人（ペダリング動作）
    ctx.lineWidth = 2;
    ctx.fillStyle = '#2a1808';
    ctx.globalAlpha = 0.55;
    const pedalAngle = animFrame * 0.14;
    ctx.beginPath();
    ctx.arc(rikX + 22, rikY - 12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(rikX + 19, rikY - 8, 6, 10);
    ctx.fill();
    // 脚（ペダルをこぐ）
    ctx.strokeStyle = '#2a1808';
    ctx.beginPath();
    ctx.moveTo(rikX + 22, rikY + 2);
    ctx.lineTo(rikX + 22 + Math.cos(pedalAngle) * 9, rikY + 2 + Math.sin(pedalAngle) * 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rikX + 22, rikY + 2);
    ctx.lineTo(rikX + 22 + Math.cos(pedalAngle + Math.PI) * 9, rikY + 2 + Math.sin(pedalAngle + Math.PI) * 6);
    ctx.stroke();
    ctx.restore();
  }

  // ── バラナシ: 川面の朝の光 ──
  if (loc === 'varanasi') {
    // elapsed < 600: 朝日が水平線から昇り、ガンジスの川面に光の帯を引く
    const elapsedMorn = animFrame - fieldEnterFrame;
    if (elapsedMorn < 700) {
      const mornAlpha = Math.min(1, elapsedMorn / 150) * Math.max(0, 1 - (elapsedMorn - 500) / 200) * 0.55;
      ctx.save();
      // 対岸から差し込む光の帯（横長のグラデーション帯）
      const sunX = canvas.width * 0.15; // 対岸の朝日位置
      const sunY = tileSize * 9; // 川との境目
      // 扇形の光条（6本）
      for (let ri = 0; ri < 6; ri++) {
        const angle = 0.05 + ri * 0.09;
        const rayLen = canvas.width * 0.9;
        const endX = sunX + Math.cos(angle) * rayLen;
        const endY = sunY - Math.sin(angle) * tileSize * 1.5;
        const rayGrad = ctx.createLinearGradient(sunX, sunY, endX, endY);
        rayGrad.addColorStop(0,   `rgba(255,220,100,${mornAlpha * 0.8})`);
        rayGrad.addColorStop(0.4, `rgba(255,200,60,${mornAlpha * 0.3})`);
        rayGrad.addColorStop(1,   'rgba(255,180,20,0)');
        ctx.fillStyle = rayGrad;
        ctx.globalAlpha = 1;
        const perpX = Math.sin(angle);
        const perpY = Math.cos(angle);
        const halfW = (8 + ri * 4);
        ctx.beginPath();
        ctx.moveTo(sunX + perpX * 2, sunY - perpY * 2);
        ctx.lineTo(sunX - perpX * 2, sunY + perpY * 2);
        ctx.lineTo(endX - perpX * halfW, endY + perpY * halfW);
        ctx.lineTo(endX + perpX * halfW, endY - perpY * halfW);
        ctx.closePath();
        ctx.fill();
      }
      // 川面の金色の揺らぎ
      ctx.globalAlpha = mornAlpha * 0.50;
      for (let si = 0; si < 8; si++) {
        const shimX = canvas.width * (0.1 + si * 0.11);
        const shimY = tileSize * (9.5 + si % 3 * 0.8);
        const shimW = 20 + si * 8;
        const shimmer = Math.sin(animFrame * 0.04 + si * 1.1) * 5;
        const sGrad = ctx.createLinearGradient(shimX + shimmer, shimY, shimX + shimW + shimmer, shimY);
        sGrad.addColorStop(0,   'rgba(255,200,50,0)');
        sGrad.addColorStop(0.5, `rgba(255,220,80,${mornAlpha})`);
        sGrad.addColorStop(1,   'rgba(255,200,50,0)');
        ctx.fillStyle = sGrad;
        ctx.beginPath();
        ctx.ellipse(shimX + shimW / 2 + shimmer, shimY, shimW / 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 太陽（対岸の上）
      ctx.globalAlpha = mornAlpha * 0.6;
      const sunGrad = ctx.createRadialGradient(sunX, sunY - 20, 0, sunX, sunY - 20, 22);
      sunGrad.addColorStop(0,   'rgba(255,240,180,0.9)');
      sunGrad.addColorStop(0.5, 'rgba(255,200,80,0.5)');
      sunGrad.addColorStop(1,   'rgba(255,160,0,0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(sunX, sunY - 20, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── バラナシ: ガートのシタール奏者 ──
  if (loc === 'varanasi') {
    // 石段の一角でシタールを奏でる音楽家
    const sX = canvas.width * 0.22;
    const sY = tileSize * 8.3;
    const musicAnim = animFrame * 0.03;
    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#2a1808';
    // 足（あぐらをかいて座る）
    ctx.beginPath();
    ctx.ellipse(sX, sY + 5, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // 胴体
    ctx.beginPath();
    ctx.rect(sX - 6, sY - 10, 12, 16);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.arc(sX, sY - 15, 5.5, 0, Math.PI * 2);
    ctx.fill();
    // シタール（長い棹と丸い胴部）
    // 胴（ひょうたん）
    ctx.fillStyle = '#8a5520';
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.ellipse(sX + 10, sY + 2, 9, 7, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // 棹（細長い）
    ctx.strokeStyle = '#6a4010';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sX + 14, sY - 3);
    ctx.lineTo(sX + 2, sY - 28);
    ctx.stroke();
    // 棹の先端（ペグボックス）
    ctx.fillStyle = '#5a3008';
    ctx.beginPath();
    ctx.rect(sX - 1, sY - 30, 6, 8);
    ctx.fill();
    // 弦（3本の主弦）
    ctx.strokeStyle = '#ccaa66';
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = 0.55;
    for (let si = 0; si < 3; si++) {
      const stringOff = si * 1.2;
      const vibrate = Math.sin(musicAnim * (4 + si) + si) * 1.2;
      ctx.beginPath();
      ctx.moveTo(sX + 14 + stringOff, sY - 3);
      ctx.quadraticCurveTo(
        sX + 8 + stringOff, sY - 15 + vibrate,
        sX + 2 + stringOff, sY - 28
      );
      ctx.stroke();
    }
    // 演奏する手（右手が弦をはじく）
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#2a1808';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(sX + 6, sY - 5);
    ctx.lineTo(sX + 14, sY - 2);
    ctx.stroke();
    // 左手（棹を押さえる）
    ctx.beginPath();
    ctx.moveTo(sX - 2, sY - 8);
    ctx.lineTo(sX + 4, sY - 18);
    ctx.stroke();
    // 音符のエフェクト（音楽が流れるイメージ）
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = '#ddcc88';
    ctx.lineWidth = 1;
    for (let ni = 0; ni < 3; ni++) {
      const noteT = (animFrame * 0.025 + ni * 1.0) % 3.0;
      const nx = sX + 20 + noteT * 15;
      const ny = sY - 20 - noteT * 8;
      const noteAlpha = Math.min(1, noteT) * (1 - noteT / 3);
      ctx.globalAlpha = 0.25 * noteAlpha;
      ctx.beginPath();
      ctx.arc(nx, ny, 3, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.fillStyle = '#ddcc88';
      ctx.beginPath();
      ctx.arc(nx, ny + 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── バラナシ: 染色布を干す職人 ──
  if (loc === 'varanasi') {
    // ガートの手すりに鮮やかな染色布が干してある
    // 布は風でひらひらとなびく
    const cloths = [
      { x: canvas.width * 0.05, y: tileSize * 5.5, w: 28, color: '#cc2244' },
      { x: canvas.width * 0.18, y: tileSize * 5.2, w: 34, color: '#dd8800' },
      { x: canvas.width * 0.36, y: tileSize * 5.6, w: 24, color: '#2244cc' },
      { x: canvas.width * 0.55, y: tileSize * 5.3, w: 30, color: '#228833' },
      { x: canvas.width * 0.72, y: tileSize * 5.5, w: 26, color: '#cc44aa' },
      { x: canvas.width * 0.88, y: tileSize * 5.2, w: 32, color: '#ddcc00' },
    ];
    // 物干し綱
    ctx.save();
    ctx.strokeStyle = 'rgba(120,100,60,0.40)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, tileSize * 5.0);
    ctx.lineTo(canvas.width, tileSize * 5.0);
    ctx.stroke();
    // 各布
    for (let ci = 0; ci < cloths.length; ci++) {
      const { x, y, w, color } = cloths[ci];
      const wave1 = Math.sin(animFrame * 0.03 + ci * 1.2) * 4;
      const wave2 = Math.sin(animFrame * 0.045 + ci * 0.7 + 1) * 2;
      const h = 24;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.60;
      // 上端は固定、下端がなびく
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.quadraticCurveTo(x + w + wave1, y + h * 0.5, x + w + wave1 + wave2, y + h);
      ctx.lineTo(x + wave2, y + h);
      ctx.quadraticCurveTo(x + wave1 * 0.3, y + h * 0.5, x, y);
      ctx.closePath();
      ctx.fill();
      // 布の端の縞模様
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 2);
      ctx.quadraticCurveTo(x + 3 + wave1 * 0.3, y + h * 0.5, x + 3 + wave2, y + h - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w - 3, y + 2);
      ctx.quadraticCurveTo(x + w - 3 + wave1 * 0.7, y + h * 0.5, x + w - 3 + wave1 + wave2 * 0.7, y + h - 2);
      ctx.stroke();
      // 洗濯ばさみ
      ctx.fillStyle = '#aa7722';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.rect(x - 1, y - 2, 4, 5);
      ctx.rect(x + w - 2, y - 2, 4, 5);
      ctx.fill();
    }
    // 職人（布をかけている）
    const dyerX = canvas.width * 0.62;
    const dyerY = tileSize * 5.8;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#2a1808';
    ctx.beginPath();
    ctx.arc(dyerX, dyerY - 10, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(dyerX - 4, dyerY - 6, 8, 14);
    ctx.fill();
    // 布を持ち上げる腕
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a1808';
    ctx.beginPath();
    ctx.moveTo(dyerX + 4, dyerY - 4);
    ctx.lineTo(dyerX + 14, dyerY - 8);
    ctx.stroke();
    ctx.restore();
  }

  // ── バラナシ: 花輪売りの少女 ──
  if (loc === 'varanasi') {
    // 石段の上で花輪（マーラー）を売る少女のシルエット
    const gX = canvas.width * 0.38;
    const gY = tileSize * 8.2;
    const bob = Math.sin(animFrame * 0.025) * 1.5;
    ctx.save();
    ctx.globalAlpha = 0.60;
    // バスケット（頭に載せた花籠）
    ctx.fillStyle = '#8a6030';
    ctx.beginPath();
    ctx.ellipse(gX, gY - 26 + bob, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 花輪の色（籠の中）
    const malaColors = ['#ff8844','#ffcc00','#ff4488','#ffffff','#ff6622'];
    for (let mi = 0; mi < 5; mi++) {
      ctx.fillStyle = malaColors[mi];
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(gX - 7 + mi * 3.5, gY - 29 + bob, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 頭
    ctx.globalAlpha = 0.60;
    ctx.fillStyle = '#3a2010';
    ctx.beginPath();
    ctx.arc(gX, gY - 18 + bob, 5, 0, Math.PI * 2);
    ctx.fill();
    // 三つ編み（後ろ）
    ctx.strokeStyle = '#1a0a00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gX + 3, gY - 14 + bob);
    ctx.quadraticCurveTo(gX + 6, gY - 8 + bob, gX + 4, gY - 3 + bob);
    ctx.stroke();
    // サリー（体）
    ctx.fillStyle = '#cc4488';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.rect(gX - 5, gY - 14 + bob, 10, 16);
    ctx.fill();
    // サリーの裾の広がり
    ctx.beginPath();
    ctx.ellipse(gX, gY + 4 + bob, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 腕（花輪を差し出す）
    ctx.strokeStyle = '#3a2010';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.58;
    ctx.beginPath();
    ctx.moveTo(gX + 5, gY - 10 + bob);
    ctx.lineTo(gX + 14, gY - 5 + bob);
    ctx.stroke();
    // 手に持つ花輪
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#ff8822';
    ctx.beginPath();
    ctx.arc(gX + 15, gY - 5 + bob, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(gX + 15, gY - 5 + bob, 2, 0, Math.PI * 2);
    ctx.fill();
    // 足
    ctx.strokeStyle = '#3a2010';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(gX - 3, gY + 8 + bob);
    ctx.lineTo(gX - 3, gY + 14 + bob);
    ctx.moveTo(gX + 3, gY + 8 + bob);
    ctx.lineTo(gX + 3, gY + 14 + bob);
    ctx.stroke();
    ctx.restore();
  }

  // ── バラナシ: 白装束の老巡礼者 ──
  if (loc === 'varanasi') {
    // ガートの石段に白装束の老人が座り、川を眺めながら静かに祈る
    const elder = { x: canvas.width * 0.73, y: tileSize * 8.5 };
    ctx.save();
    ctx.globalAlpha = 0.58;
    // 白いローブ（下半身の広がり）
    ctx.fillStyle = '#e8e0d0';
    ctx.beginPath();
    ctx.ellipse(elder.x, elder.y + 6, 14, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // 胴体
    ctx.fillStyle = '#d8d0c0';
    ctx.beginPath();
    ctx.rect(elder.x - 7, elder.y - 8, 14, 16);
    ctx.fill();
    // ショール（肩に巻く）
    ctx.fillStyle = '#f0e8d8';
    ctx.beginPath();
    ctx.ellipse(elder.x, elder.y - 4, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭（白い頭巾）
    ctx.fillStyle = '#e0d8c8';
    ctx.beginPath();
    ctx.arc(elder.x, elder.y - 14, 6, 0, Math.PI * 2);
    ctx.fill();
    // 頭巾の布が垂れる
    ctx.beginPath();
    ctx.moveTo(elder.x - 6, elder.y - 12);
    ctx.quadraticCurveTo(elder.x - 10, elder.y - 5, elder.x - 8, elder.y);
    ctx.lineTo(elder.x - 5, elder.y);
    ctx.quadraticCurveTo(elder.x - 7, elder.y - 5, elder.x - 4, elder.y - 12);
    ctx.closePath();
    ctx.fill();
    // 数珠（右手）
    ctx.strokeStyle = '#cc8840';
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.45;
    const beadCount = 12;
    for (let bi = 0; bi < beadCount; bi++) {
      const ba = (bi / beadCount) * Math.PI + Math.PI * 0.1;
      ctx.beginPath();
      ctx.arc(
        elder.x + 9 + Math.cos(ba) * 5,
        elder.y - 4 + Math.sin(ba) * 5,
        1, 0, Math.PI * 2
      );
      ctx.fillStyle = '#cc8840';
      ctx.fill();
    }
    // 前方の川を眺める（小さなお辞儀の動作）
    const nod = Math.sin(animFrame * 0.012) * 2;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#3a2a18';
    ctx.beginPath();
    ctx.arc(elder.x + 1, elder.y - 14 + nod, 3, 0, Math.PI * 2);
    ctx.fill(); // 顔の輪郭
    ctx.restore();
  }

  // ── バラナシ: 川縁のディヤー（灯篭）の光 ──
  if (loc === 'varanasi') {
    // 川岸（water tile 境界）に並んだ素焼きの灯篭が水面に光を落とす
    const diyaPositions = [
      canvas.width * 0.15, canvas.width * 0.27, canvas.width * 0.42,
      canvas.width * 0.56, canvas.width * 0.68, canvas.width * 0.80,
    ];
    const diyaY = tileSize * 9.05;
    ctx.save();
    for (let di = 0; di < diyaPositions.length; di++) {
      const dx = diyaPositions[di];
      const dy = diyaY;
      const flicker = Math.sin(animFrame * 0.11 + di * 1.7) * 0.25 + 0.75; // 0.5〜1.0
      // 素焼き皿
      ctx.globalAlpha = 0.70;
      ctx.fillStyle = '#c06020';
      ctx.beginPath();
      ctx.ellipse(dx, dy, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 炎
      ctx.globalAlpha = 0.85 * flicker;
      const flameGrad = ctx.createRadialGradient(dx, dy - 5, 0, dx, dy - 5, 8);
      flameGrad.addColorStop(0,   'rgba(255,255,200,1)');
      flameGrad.addColorStop(0.3, 'rgba(255,180,30,0.9)');
      flameGrad.addColorStop(1,   'rgba(255,80,0,0)');
      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.ellipse(dx, dy - 5, 3 * flicker, 5 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();
      // 炎の先端（尖り）
      ctx.fillStyle = 'rgba(255,255,180,0.8)';
      ctx.beginPath();
      ctx.moveTo(dx - 1.5, dy - 7);
      ctx.lineTo(dx, dy - 12 - flicker * 3);
      ctx.lineTo(dx + 1.5, dy - 7);
      ctx.closePath();
      ctx.fill();
      // 水面への映り込み
      ctx.globalAlpha = 0.30 * flicker;
      const reflectGrad = ctx.createLinearGradient(dx, dy, dx, dy + 20);
      reflectGrad.addColorStop(0, 'rgba(255,160,20,0.6)');
      reflectGrad.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = reflectGrad;
      const shimmer = Math.sin(animFrame * 0.06 + di * 0.9) * 3;
      ctx.beginPath();
      ctx.ellipse(dx + shimmer, dy + 10, 5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // 周囲のグロー
      ctx.globalAlpha = 0.12 * flicker;
      const gGrad = ctx.createRadialGradient(dx, dy - 4, 0, dx, dy - 4, 18);
      gGrad.addColorStop(0, 'rgba(255,200,50,0.5)');
      gGrad.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = gGrad;
      ctx.beginPath();
      ctx.arc(dx, dy - 4, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── バラナシ: 早朝の托鉢僧 ──
  if (loc === 'varanasi') {
    // 夜明け（elapsed < 600）: 僧侶たちがガートを歩きながら托鉢する
    const elapsedMonk = animFrame - fieldEnterFrame;
    if (elapsedMonk < 700) {
      const mAlpha = Math.min(1, elapsedMonk / 100) * Math.max(0, 1 - (elapsedMonk - 550) / 150) * 0.65;
      const monks = [
        { baseX: canvas.width * 0.15, speed: 0.5,  phase: 0,   row: 8.0 },
        { baseX: canvas.width * 0.30, speed: 0.4,  phase: 40,  row: 8.3 },
        { baseX: canvas.width * 0.55, speed: 0.55, phase: 80,  row: 8.0 },
      ];
      ctx.save();
      ctx.globalAlpha = mAlpha;
      ctx.fillStyle = '#5a2a08'; // 橙色の袈裟
      ctx.strokeStyle = '#5a2a08';
      for (let mi = 0; mi < monks.length; mi++) {
        const m = monks[mi];
        const mx = (m.baseX + animFrame * m.speed + m.phase) % (canvas.width + 40) - 20;
        const my = tileSize * m.row;
        const step = animFrame * 0.18 + m.phase * 0.1;
        const bobY = Math.sin(step) * 1.5;
        // 袈裟（ローブ）
        ctx.fillStyle = '#cc6010';
        ctx.globalAlpha = mAlpha * 0.7;
        ctx.beginPath();
        ctx.ellipse(mx, my + 8, 7, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        // 胴体
        ctx.globalAlpha = mAlpha;
        ctx.fillStyle = '#5a2a08';
        ctx.beginPath();
        ctx.rect(mx - 4, my - 2 + bobY, 8, 12);
        ctx.fill();
        // 頭（剃頭）
        ctx.beginPath();
        ctx.arc(mx, my - 5 + bobY, 4.5, 0, Math.PI * 2);
        ctx.fill();
        // 托鉢鉢（片手で持つ）
        ctx.fillStyle = '#4a3018';
        ctx.globalAlpha = mAlpha * 0.9;
        ctx.beginPath();
        ctx.ellipse(mx + 7, my + 2 + bobY, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // 歩行の足
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#5a2a08';
        const stepL = Math.sin(step) * 5;
        const stepR = -stepL;
        ctx.beginPath();
        ctx.moveTo(mx - 2, my + 10 + bobY);
        ctx.lineTo(mx - 2 + stepL, my + 16 + bobY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx + 2, my + 10 + bobY);
        ctx.lineTo(mx + 2 + stepR, my + 16 + bobY);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: ガートの物乞い ──
  if (loc === 'varanasi') {
    // 石段の隅に座る巡礼者と物乞いのシルエット。物を乞う動作
    const beggars = [
      { x: canvas.width * 0.13, y: tileSize * 8.4, facing:  1 },
      { x: canvas.width * 0.87, y: tileSize * 8.7, facing: -1 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.52;
    ctx.fillStyle = '#2a1a10';
    ctx.strokeStyle = '#2a1a10';
    for (let bi = 0; bi < beggars.length; bi++) {
      const { x, y, facing } = beggars[bi];
      // 体の前後揺れ（礼拝動作）
      const sway = Math.sin(animFrame * 0.02 + bi * 1.3) * 3;
      // 座った体（くの字）
      ctx.save();
      ctx.translate(x, y);
      // 腰〜足（折り曲げた足）
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(facing * 8, 5);
      ctx.lineTo(facing * 14, 2);
      ctx.stroke();
      // 胴体
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sway, -12);
      ctx.stroke();
      // 頭
      ctx.beginPath();
      ctx.arc(sway, -16, 4, 0, Math.PI * 2);
      ctx.fill();
      // 手を伸ばす動作（布施を乞う）
      const armReach = Math.abs(Math.sin(animFrame * 0.015 + bi * 2.1)) * 8;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sway * 0.5, -10);
      ctx.lineTo(facing * (12 + armReach), -8);
      ctx.stroke();
      // 椀（施し物入れ）
      ctx.fillStyle = '#6a4a20';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(facing * (13 + armReach), -7.5, 3, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      // 衣の裾
      ctx.fillStyle = '#4a3060';
      ctx.globalAlpha = 0.38;
      ctx.beginPath();
      ctx.ellipse(0, 2, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#2a1a10';
      ctx.globalAlpha = 0.52;
    }
    ctx.restore();
  }

  // ── バラナシ: ガンジス川の渡し船 ──
  if (loc === 'varanasi') {
    // 大きな木造の渡し船（ナウ）が川を横断する
    const ferryCycle = 680;
    const fp = animFrame % ferryCycle;
    // 画面右から左へ、川タイル中央を横断
    const ferryT = fp / ferryCycle;
    const fx = canvas.width + 60 - ferryT * (canvas.width + 120);
    const fy = tileSize * 11.5 + Math.sin(animFrame * 0.018) * 3;
    ctx.save();
    ctx.globalAlpha = 0.62;
    // 船体
    ctx.fillStyle = '#3a2510';
    ctx.beginPath();
    ctx.moveTo(fx - 40, fy + 2);
    ctx.lineTo(fx + 40, fy + 2);
    ctx.lineTo(fx + 45, fy + 8);
    ctx.lineTo(fx - 45, fy + 8);
    ctx.closePath();
    ctx.fill();
    // 船首
    ctx.beginPath();
    ctx.moveTo(fx + 38, fy + 2);
    ctx.lineTo(fx + 52, fy + 5);
    ctx.lineTo(fx + 40, fy + 8);
    ctx.closePath();
    ctx.fill();
    // 上部フレーム（よしずの屋根）
    ctx.fillStyle = '#7a5530';
    ctx.beginPath();
    ctx.rect(fx - 28, fy - 12, 56, 14);
    ctx.fill();
    // 屋根（かまぼこ型）
    ctx.fillStyle = '#8a6538';
    ctx.beginPath();
    ctx.ellipse(fx, fy - 12, 30, 7, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // 屋根の縦ストライプ
    ctx.strokeStyle = '#5a3510';
    ctx.lineWidth = 1.2;
    for (let ri = -3; ri <= 3; ri++) {
      ctx.beginPath();
      ctx.moveTo(fx + ri * 8, fy - 12);
      ctx.lineTo(fx + ri * 8, fy + 2);
      ctx.stroke();
    }
    // 乗客シルエット（4人）
    ctx.fillStyle = '#1a1008';
    const passengers = [-22, -8, 8, 22];
    for (const px of passengers) {
      ctx.beginPath();
      ctx.arc(fx + px, fy - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(fx + px - 2, fy - 2, 4, 5);
      ctx.fill();
    }
    // 漕ぎ手（船尾）
    ctx.beginPath();
    ctx.arc(fx - 36, fy - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1a1008';
    ctx.beginPath();
    ctx.moveTo(fx - 36, fy - 1);
    ctx.lineTo(fx - 36, fy + 3);
    ctx.stroke();
    // 竿
    const poleAngle = Math.sin(animFrame * 0.025) * 0.15 - 0.4;
    ctx.beginPath();
    ctx.moveTo(fx - 34, fy - 4);
    ctx.lineTo(fx - 34 + Math.sin(poleAngle) * 22, fy - 4 + Math.cos(poleAngle) * 22);
    ctx.stroke();
    // 水面の航跡
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#8899bb';
    ctx.lineWidth = 1;
    for (let wi = 1; wi <= 4; wi++) {
      ctx.beginPath();
      ctx.ellipse(fx + 50 + wi * 15, fy + 4, wi * 8, 2.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── バラナシ: ガートの濡れた足跡 ──
  if (loc === 'varanasi') {
    // 沐浴を終えた巡礼者の足跡が石段に残っている
    // 水際（tileRow=9近く）から上方向へ続く点列
    const footprintPairs = [
      { startX: canvas.width * 0.32, startY: tileSize * 9.0, angle: -0.15, count: 7 },
      { startX: canvas.width * 0.52, startY: tileSize * 9.0, angle:  0.05, count: 6 },
      { startX: canvas.width * 0.68, startY: tileSize * 9.0, angle: -0.08, count: 5 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#8899bb';
    for (const pair of footprintPairs) {
      for (let si = 0; si < pair.count; si++) {
        const stepDist = 14;
        // 左右交互に少しオフセット
        const sideOffset = (si % 2 === 0 ? -3.5 : 3.5);
        const sx = pair.startX
          + Math.sin(pair.angle) * si * stepDist
          + Math.cos(pair.angle) * sideOffset;
        const sy = pair.startY - Math.cos(pair.angle) * si * stepDist
          + Math.sin(pair.angle) * sideOffset;
        // 足跡の形（前部楕円＋後部楕円）
        const footAngle = pair.angle + (si % 2 === 0 ? 0.1 : -0.1);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(footAngle);
        // かかと
        ctx.beginPath();
        ctx.ellipse(0, 0, 3, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // 土踏まず〜つま先
        ctx.beginPath();
        ctx.ellipse(0, -5, 2.5, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // つま先の丸み
        for (let ti = 0; ti < 4; ti++) {
          const tx = -3 + ti * 2;
          ctx.beginPath();
          ctx.arc(tx, -8.5, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // ── バラナシ: 川に流す花の供物 ──
  if (loc === 'varanasi') {
    // 川面に小さな葉舟（ディヤー）が花と蝋燭を載せて漂う
    const offeringCount = 7;
    ctx.save();
    for (let oi = 0; oi < offeringCount; oi++) {
      // 川タイル（y=9〜14）を漂う
      const speed = 0.4 + (oi * 0.11);
      const startX = (oi * 93 + 20) % (canvas.width + 40);
      const ox = ((startX + animFrame * speed) % (canvas.width + 60)) - 20;
      const baseY = tileSize * (9.5 + (oi % 3) * 1.2);
      const oy = baseY + Math.sin(animFrame * 0.018 + oi * 1.4) * 4;

      // 葉の舟
      ctx.save();
      ctx.globalAlpha = 0.60;
      ctx.fillStyle = '#3a7a2a';
      ctx.beginPath();
      ctx.ellipse(ox, oy + 3, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // 花（白〜ピンク）
      const flowerColors = ['#ffaacc','#ffddaa','#ffffff','#ffcc88','#ffbbdd'];
      ctx.fillStyle = flowerColors[oi % flowerColors.length];
      ctx.globalAlpha = 0.75;
      for (let pi = 0; pi < 5; pi++) {
        const pa = (pi / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(ox + Math.cos(pa) * 3.5, oy + Math.sin(pa) * 2.5, 2.5, 1.8, pa, 0, Math.PI * 2);
        ctx.fill();
      }
      // 花芯
      ctx.fillStyle = '#ffee00';
      ctx.beginPath();
      ctx.arc(ox, oy, 2, 0, Math.PI * 2);
      ctx.fill();

      // 蝋燭の炎
      const flicker = Math.sin(animFrame * 0.12 + oi * 2.1) * 1.5;
      ctx.globalAlpha = 0.80;
      ctx.fillStyle = '#ffcc44';
      ctx.beginPath();
      ctx.ellipse(ox + 1, oy - 4 + flicker * 0.3, 1.5, 3 + flicker * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(ox + 1, oy - 5, 1, 0, Math.PI * 2);
      ctx.fill();

      // 水面の映り込み（揺らぐ光）
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ffcc44';
      ctx.beginPath();
      ctx.ellipse(ox + 1, oy + 6 + Math.sin(animFrame * 0.05 + oi) * 1, 3, 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── バラナシ: アーティを見守る群衆 ──
  if (loc === 'varanasi') {
    const elapsedAud = animFrame - fieldEnterFrame;
    if (elapsedAud >= 500) {
      const audStr = Math.min(1, (elapsedAud - 500) / 300);
      // 石段に座る観客シルエット（横一列）
      const audRows = [
        { y: tileSize * 5.2, count: 9, offset: 0 },
        { y: tileSize * 5.6, count: 7, offset: 20 },
      ];
      ctx.save();
      for (const ar of audRows) {
        for (let p = 0; p < ar.count; p++) {
          const ax = ar.offset + p * (canvas.width * 0.85 / ar.count) + canvas.width * 0.07;
          const ay = ar.y;
          const bob = Math.sin(animFrame * 0.03 + p * 0.5) * 0.8;  // 体を揺らす
          ctx.globalAlpha = audStr * (0.22 + (p % 3) * 0.04);
          ctx.fillStyle   = '#1A1008';
          // 頭
          ctx.beginPath();
          ctx.arc(ax, ay - 5 + bob, 2.2, 0, Math.PI * 2);
          ctx.fill();
          // 座った体
          ctx.beginPath();
          ctx.ellipse(ax, ay + 1, 2.5, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 前列に子供たち（より小さいシルエット）
      for (let c = 0; c < 5; c++) {
        const cx2 = canvas.width * 0.15 + c * (canvas.width * 0.70 / 4);
        const cy2 = tileSize * 4.9;
        ctx.globalAlpha = audStr * 0.18;
        ctx.fillStyle   = '#1A1008';
        ctx.beginPath();
        ctx.arc(cx2, cy2 - 3, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx2, cy2 + 1.5, 1.8, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 絹織りの職人 ──
  if (loc === 'varanasi') {
    // 部屋の一角（画面左）で機を織る職人
    const loomX = canvas.width * 0.10;
    const loomY = tileSize * 4.0;
    const shuttle = Math.sin(animFrame * 0.14) * 10;  // 杼（ひ）が往復
    ctx.save();
    // 機（はた）の枠
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#3A2010';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.rect(loomX - 18, loomY - 20, 36, 20);
    ctx.stroke();
    // 縦糸（垂直な線）
    ctx.lineWidth = 0.5;
    for (let w = 0; w < 7; w++) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = w % 2 === 0 ? '#C84090' : '#F0A820';
      ctx.beginPath();
      ctx.moveTo(loomX - 15 + w * 5, loomY - 18);
      ctx.lineTo(loomX - 15 + w * 5, loomY - 2);
      ctx.stroke();
    }
    // 横糸（織り上がった部分）
    ctx.globalAlpha = 0.22;
    for (let h = 0; h < 4; h++) {
      ctx.strokeStyle = h % 2 === 0 ? '#E02060' : '#D09020';
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.moveTo(loomX - 15, loomY - 4 - h * 3);
      ctx.lineTo(loomX + 15, loomY - 4 - h * 3);
      ctx.stroke();
    }
    // 杼（シャトル）が動く
    ctx.globalAlpha = 0.30;
    ctx.fillStyle   = '#5A3010';
    ctx.beginPath();
    ctx.ellipse(loomX + shuttle, loomY - 8, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 職人シルエット
    ctx.globalAlpha = 0.28;
    ctx.fillStyle   = '#1A0808';
    // 頭
    ctx.beginPath();
    ctx.arc(loomX - 22, loomY - 14, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // 体
    ctx.beginPath();
    ctx.ellipse(loomX - 22, loomY - 7, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 腕（前に伸ばす）
    ctx.strokeStyle = '#1A0808';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(loomX - 20, loomY - 10);
    ctx.lineTo(loomX - 15 + shuttle * 0.3, loomY - 8);
    ctx.stroke();
    ctx.restore();
  }

  // ── バラナシ: バラタナティヤムのダンサー ──
  if (loc === 'varanasi') {
    // 石段の上でポーズをとる舞踊家（黄金時間帯）
    const elapsedDn = animFrame - fieldEnterFrame;
    if (elapsedDn >= 600 && elapsedDn <= 1600) {
      const dnStr = Math.min(1, (elapsedDn - 600) / 200) * (1 - Math.max(0, (elapsedDn - 1400) / 200));
      const dnx = canvas.width * 0.38;
      const dny = tileSize * 4.3;
      // ポーズのサイクル（3つのムドラを切り替え）
      const pCycle = 200;
      const pPhase = Math.floor((elapsedDn / pCycle) % 3);
      const pT = (elapsedDn % pCycle) / pCycle;
      ctx.save();
      ctx.globalAlpha = dnStr * 0.38;
      ctx.fillStyle   = '#200808';
      ctx.strokeStyle = '#200808';
      // 頭
      ctx.beginPath();
      ctx.arc(dnx, dny - 18, 3, 0, Math.PI * 2);
      ctx.fill();
      // 体（半腰を落とした姿勢）
      const kneeAngle = Math.sin(pT * Math.PI) * 0.3;
      ctx.beginPath();
      ctx.ellipse(dnx, dny - 9, 3.5, 6, kneeAngle, 0, Math.PI * 2);
      ctx.fill();
      // 腕のムドラ（3種類）
      ctx.lineWidth = 2;
      if (pPhase === 0) {
        // 両腕を横に広げたポーズ
        ctx.beginPath();
        ctx.moveTo(dnx - 3.5, dny - 12);
        ctx.lineTo(dnx - 14, dny - 16);
        ctx.moveTo(dnx + 3.5, dny - 12);
        ctx.lineTo(dnx + 14, dny - 8);
        ctx.stroke();
      } else if (pPhase === 1) {
        // 片腕を上げたポーズ
        ctx.beginPath();
        ctx.moveTo(dnx - 3.5, dny - 12);
        ctx.lineTo(dnx - 10, dny - 20);
        ctx.moveTo(dnx + 3.5, dny - 12);
        ctx.lineTo(dnx + 12, dny - 9);
        ctx.stroke();
      } else {
        // 両腕を前に
        ctx.beginPath();
        ctx.moveTo(dnx - 3.5, dny - 12);
        ctx.lineTo(dnx - 12, dny - 12);
        ctx.moveTo(dnx + 3.5, dny - 12);
        ctx.lineTo(dnx + 12, dny - 12);
        ctx.stroke();
      }
      // 脚（アラマンディ：腰を落とした）
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(dnx - 2, dny - 3);
      ctx.lineTo(dnx - 8, dny + 3);
      ctx.lineTo(dnx - 8, dny + 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dnx + 2, dny - 3);
      ctx.lineTo(dnx + 8, dny + 3);
      ctx.lineTo(dnx + 8, dny + 8);
      ctx.stroke();
      // 頭飾り（小さな光の点）
      ctx.globalAlpha = dnStr * 0.60;
      ctx.fillStyle   = '#D4A840';
      ctx.beginPath();
      ctx.arc(dnx, dny - 21, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── バラナシ: 蛇使い ──
  if (loc === 'varanasi') {
    // 石段の片隅に座る蛇使いと籠から出たコブラ
    const charmerX = canvas.width * 0.78;
    const charmerY = tileSize * 4.0;
    const fluteWave = Math.sin(animFrame * 0.06);  // 笛の音に合わせた揺れ
    const snakeSway = Math.sin(animFrame * 0.045) * 5;
    ctx.save();
    ctx.globalAlpha = 0.33;
    ctx.fillStyle   = '#1A0C06';
    ctx.strokeStyle = '#1A0C06';
    // 蛇使い（あぐらをかいた人物）
    ctx.beginPath();
    ctx.ellipse(charmerX, charmerY + 3, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.arc(charmerX, charmerY - 5, 3, 0, Math.PI * 2);
    ctx.fill();
    // ターバン
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(charmerX, charmerY - 5.5, 3.5, Math.PI, 0);
    ctx.stroke();
    // 腕（笛を吹く）
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(charmerX - 5, charmerY - 1);
    ctx.lineTo(charmerX - 8, charmerY - 5 + fluteWave * 0.5);
    ctx.moveTo(charmerX + 5, charmerY - 1);
    ctx.lineTo(charmerX + 8, charmerY - 5);
    ctx.stroke();
    // 笛
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(charmerX + 4, charmerY - 5);
    ctx.lineTo(charmerX + 12, charmerY - 7 + fluteWave * 0.3);
    ctx.stroke();
    // 籠（円形の土台）
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(charmerX, charmerY + 8, 7, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(charmerX, charmerY + 6, 6, 3, 0, 0, Math.PI);
    ctx.fill();
    // コブラ（立ち上がった蛇）
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(charmerX, charmerY + 6);
    ctx.quadraticCurveTo(charmerX - 4, charmerY - 2, charmerX + snakeSway, charmerY - 10);
    ctx.stroke();
    // フード
    ctx.globalAlpha = 0.40;
    ctx.fillStyle   = '#3A1808';
    const hoodA = 0.6 + 0.4 * Math.abs(Math.sin(animFrame * 0.045));
    ctx.beginPath();
    ctx.ellipse(charmerX + snakeSway, charmerY - 12, 5 * hoodA, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── バラナシ: チャイ売りの屋台 ──
  if (loc === 'varanasi') {
    // 石段の脇に小さな屋台
    const chaiX = canvas.width * 0.48;
    const chaiY = tileSize * 3.5;
    ctx.save();
    // 屋台の枠（木製）
    ctx.globalAlpha = 0.35;
    ctx.fillStyle   = '#3A2010';
    ctx.fillRect(chaiX - 10, chaiY - 12, 20, 12);
    // 屋根（三角）
    ctx.beginPath();
    ctx.moveTo(chaiX - 13, chaiY - 12);
    ctx.lineTo(chaiX, chaiY - 20);
    ctx.lineTo(chaiX + 13, chaiY - 12);
    ctx.closePath();
    ctx.fill();
    // チャイのやかん（丸い）
    ctx.beginPath();
    ctx.arc(chaiX, chaiY - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    // 店主シルエット
    ctx.beginPath();
    ctx.arc(chaiX + 14, chaiY - 18, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3A2010';
    ctx.beginPath();
    ctx.moveTo(chaiX + 14, chaiY - 15.5);
    ctx.lineTo(chaiX + 14, chaiY - 9);
    ctx.stroke();
    // 湯気（上昇する煙）
    for (let s = 0; s < 5; s++) {
      const age  = (animFrame * 0.55 + s * 18) % 70;
      const t    = age / 70;
      const sx   = chaiX + Math.sin(t * Math.PI * 2.2 + s * 0.9) * 4;
      const sy   = chaiY - 8 - t * 28;
      const sa   = (1 - t) * 0.22;
      ctx.globalAlpha = sa;
      ctx.fillStyle   = '#E8D8C0';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5 + t * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // カップ（小さな四角形）
    ctx.globalAlpha = 0.30;
    ctx.fillStyle   = '#C87020';
    ctx.fillRect(chaiX - 16, chaiY - 4, 4, 4);
    ctx.fillRect(chaiX - 10, chaiY - 4, 4, 4);
    ctx.restore();
  }

  // ── バラナシ: 夕暮れの都市の霞 ──
  if (loc === 'varanasi') {
    const elapsedHz = animFrame - fieldEnterFrame;
    // 黄金時間帯に霞が濃くなる
    const hzStr = elapsedHz < 400 ? 0 :
                  elapsedHz < 700 ? (elapsedHz - 400) / 300 :
                  elapsedHz < 1400 ? 1 :
                  elapsedHz < 1800 ? 1 - (elapsedHz - 1400) / 400 : 0;
    if (hzStr > 0.01) {
      ctx.save();
      // 地平線から漂うオレンジ色の霞
      const hzGrad = ctx.createLinearGradient(0, tileSize * 1.5, 0, tileSize * 5);
      hzGrad.addColorStop(0, 'rgba(255,120,30,0)');
      hzGrad.addColorStop(0.3, `rgba(220,100,20,${hzStr * 0.08})`);
      hzGrad.addColorStop(0.7, `rgba(200,80,10,${hzStr * 0.12})`);
      hzGrad.addColorStop(1, 'rgba(180,60,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = hzGrad;
      ctx.fillRect(0, tileSize * 1.5, canvas.width, tileSize * 3.5);
      // ランダムに浮かぶ粒子状の煤煙
      for (let s = 0; s < 12; s++) {
        const sx = (animFrame * (0.12 + s * 0.03) + s * 53) % (canvas.width + 20);
        const sy = tileSize * 2.0 + (animFrame * 0.06 + s * 11) % (tileSize * 2.5);
        const sa = hzStr * (0.06 + (s % 3) * 0.02) * Math.sin(animFrame * 0.03 + s);
        if (sa < 0.005) continue;
        ctx.globalAlpha = Math.abs(sa);
        ctx.fillStyle = 'rgba(220,140,40,1)';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5 + s % 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 対岸の寺院シルエット ──
  if (loc === 'varanasi') {
    // 水タイルの奥（行0の下端）に対岸の寺院スカイライン
    const shrineY = tileSize * 1.85;  // 対岸
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle   = '#1A1428';
    // 5本の寺院塔（シカラ）
    const shiraDefs = [
      { x: 0.08, w: 8, h: 28 },
      { x: 0.20, w: 6, h: 20 },
      { x: 0.35, w: 10, h: 35 },
      { x: 0.58, w: 7, h: 24 },
      { x: 0.75, w: 9, h: 30 },
      { x: 0.88, w: 5, h: 18 },
    ];
    for (const sd of shiraDefs) {
      const sx = canvas.width * sd.x;
      const sy = shrineY - sd.h;
      // 塔の基部
      ctx.beginPath();
      ctx.moveTo(sx - sd.w, shrineY);
      ctx.lineTo(sx + sd.w, shrineY);
      ctx.lineTo(sx + sd.w * 0.7, sy + sd.h * 0.4);
      ctx.lineTo(sx, sy);  // 頂点
      ctx.lineTo(sx - sd.w * 0.7, sy + sd.h * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    // 水面の反射（揺れる細い線）
    ctx.globalAlpha = 0.10;
    for (let r = 0; r < shiraDefs.length; r++) {
      const sd = shiraDefs[r];
      const sx = canvas.width * sd.x;
      const refH = sd.h * 0.4;
      for (let line = 0; line < 4; line++) {
        const ry = shrineY + line * (refH / 4);
        const wave = Math.sin(animFrame * 0.05 + r * 0.7 + line * 0.3) * 3;
        const alpha = (1 - line / 4) * 0.12;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#1A1428';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(sx - sd.w * (1 - line * 0.2) + wave, ry);
        ctx.lineTo(sx + sd.w * (1 - line * 0.2) + wave, ry);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── バラナシ: 野良犬 ──
  if (loc === 'varanasi') {
    const dogCycle = 440;
    const dp = animFrame % dogCycle;
    const dx2 = (dp / dogCycle) * (canvas.width + 50) - 25;
    const dy2 = tileSize * 3.8 + Math.sin(animFrame * 0.022) * 1;
    const trot = Math.sin(animFrame * 0.16) * 2;
    const sniff = Math.sin(animFrame * 0.09) * 3;  // 時々立ち止まって嗅ぐ
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle   = '#2A1A0C';
    ctx.strokeStyle = '#2A1A0C';
    // 胴体
    ctx.beginPath();
    ctx.ellipse(dx2, dy2, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.ellipse(dx2 + 11, dy2 - 2 + sniff * 0.3, 4, 3.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // 鼻
    ctx.beginPath();
    ctx.arc(dx2 + 15, dy2 - 1.5 + sniff * 0.3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // 耳（垂れた耳）
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dx2 + 9, dy2 - 5);
    ctx.quadraticCurveTo(dx2 + 8, dy2 - 2, dx2 + 10, dy2);
    ctx.stroke();
    // しっぽ（クルリと上）
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(dx2 - 10, dy2 - 1);
    ctx.quadraticCurveTo(dx2 - 15, dy2 - 5, dx2 - 13, dy2 - 10);
    ctx.stroke();
    // 4本の脚
    ctx.lineWidth = 2;
    const dogLegs = [dx2 - 4, dx2, dx2 + 5, dx2 + 8];
    for (let l = 0; l < 4; l++) {
      const lo = Math.sin(animFrame * 0.18 + l * 0.8) * 2;
      ctx.beginPath();
      ctx.moveTo(dogLegs[l], dy2 + 3);
      ctx.lineTo(dogLegs[l] + (l < 2 ? -1 : 1), dy2 + 9 + lo);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── バラナシ: オートリキシャ ──
  if (loc === 'varanasi') {
    const rickCycle = 520;
    const rickPhase = animFrame % rickCycle;
    const rx = (rickPhase / rickCycle) * (canvas.width + 60) - 30;
    const ry = tileSize * 3.4;  // 石段の上の道
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle   = '#251508';
    ctx.strokeStyle = '#251508';
    // 車体（三輪車型）
    ctx.beginPath();
    ctx.moveTo(rx - 14, ry);
    ctx.lineTo(rx + 14, ry);
    ctx.lineTo(rx + 14, ry - 10);
    ctx.lineTo(rx + 8, ry - 16);
    ctx.lineTo(rx - 6, ry - 16);
    ctx.lineTo(rx - 14, ry - 8);
    ctx.closePath();
    ctx.fill();
    // 窓
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#5A7A8A';
    ctx.fillRect(rx - 4, ry - 15, 10, 7);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle   = '#251508';
    // 前輪（1個）
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rx + 10, ry + 3, 4, 0, Math.PI * 2);
    ctx.stroke();
    // 後輪（2個）
    ctx.beginPath();
    ctx.arc(rx - 8, ry + 3, 4, 0, Math.PI * 2);
    ctx.stroke();
    // エンジン音の排気（小さな点）
    for (let ex = 0; ex < 3; ex++) {
      const ea = (animFrame * 0.6 + ex * 11) % 28;
      ctx.globalAlpha = (1 - ea / 28) * 0.15;
      ctx.beginPath();
      ctx.arc(rx - 16 - ea, ry - 5, 2 + ea * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── バラナシ: 風にはためくサフラン色の布 ──
  if (loc === 'varanasi') {
    const clothDefs = [
      { x: 3.5, y: 4.5, len: 28, color: '#E87010' },
      { x: 9.0, y: 4.2, len: 22, color: '#CC3020' },
      { x: 15.0, y: 4.6, len: 30, color: '#E0A020' },
    ];
    ctx.save();
    for (const cd of clothDefs) {
      const cx = cd.x * tileSize;
      const cy = cd.y * tileSize;
      const seg = 10;
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = cd.color;
      ctx.lineWidth   = 4;
      ctx.beginPath();
      for (let s = 0; s <= seg; s++) {
        const t   = s / seg;
        const wx  = cx + t * cd.len;
        const wave = Math.sin(t * Math.PI * 2.5 + animFrame * 0.05) * 5
                   + Math.sin(t * Math.PI * 4 + animFrame * 0.08) * 2;
        const wy  = cy + wave;
        s === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      // 布の影（薄い下線）
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let s = 0; s <= seg; s++) {
        const t   = s / seg;
        const wx  = cx + t * cd.len;
        const wave = Math.sin(t * Math.PI * 2.5 + animFrame * 0.05) * 5
                   + Math.sin(t * Math.PI * 4 + animFrame * 0.08) * 2;
        const wy  = cy + wave + 3;
        s === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── バラナシ: ガンジス川で沐浴する人々 ──
  if (loc === 'varanasi') {
    const bathPos = [
      { x: 3.5, t: 0 }, { x: 8.2, t: 0.22 }, { x: 14.5, t: 0.45 },
      { x: 10.8, t: 0.67 }, { x: 5.8, t: 0.83 },
    ];
    ctx.save();
    for (let b = 0; b < bathPos.length; b++) {
      const bp = bathPos[b];
      const bx = bp.x * tileSize;
      // 水タイルの中（行0か行1）
      const row = b % 2;
      const by  = row * tileSize + tileSize * 0.60;
      const bob = Math.sin(animFrame * 0.028 + bp.t * Math.PI * 2 + b) * 2;
      // 水中に半身が浸かっている（下半身は水面以下=不透明度で表現）
      ctx.globalAlpha = 0.28 + 0.08 * Math.sin(animFrame * 0.03 + b * 0.5);
      ctx.fillStyle   = '#1A0808';
      // 頭部
      ctx.beginPath();
      ctx.arc(bx, by - 5 + bob, 2.8, 0, Math.PI * 2);
      ctx.fill();
      // 肩〜水面まで
      ctx.beginPath();
      ctx.ellipse(bx, by + bob, 3.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 水しぶき（腕を動かして）
      const splashT = (animFrame * 0.08 + b * 0.4) % (Math.PI * 2);
      ctx.globalAlpha = 0.18 * Math.abs(Math.sin(splashT));
      ctx.strokeStyle = 'rgba(180,220,255,1)';
      ctx.lineWidth   = 0.7;
      for (let sp = 0; sp < 3; sp++) {
        const sx = bx - 5 + sp * 5 + Math.cos(splashT) * 3;
        const sy = by + bob + 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 2, sy - 3, sx + 4, sy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── バラナシ: アーティを行う祭司 ──
  if (loc === 'varanasi') {
    const elapsedPr = animFrame - fieldEnterFrame;
    if (elapsedPr >= 500) {
      const prStr = Math.min(1, (elapsedPr - 500) / 300);
      // 祠の位置に祭司を配置（最初の2つ）
      const priestPos = [{x: 1.5, y: 5}, {x: 12.5, y: 5}];
      ctx.save();
      for (let p = 0; p < priestPos.length; p++) {
        const sh  = priestPos[p];
        const shx = sh.x * tileSize;
        const shy = sh.y * tileSize;
        // 灯台を円弧で振り回す（高速回転）
        const lampAngle = animFrame * 0.12 + p * Math.PI;
        const lampR = tileSize * 0.9;
        const lampX = shx + Math.cos(lampAngle) * lampR;
        const lampY = shy + Math.sin(lampAngle) * lampR * 0.4;
        // 残像（軌跡）
        for (let tr = 0; tr < 5; tr++) {
          const trAngle = lampAngle - tr * 0.18;
          const trX = shx + Math.cos(trAngle) * lampR;
          const trY = shy + Math.sin(trAngle) * lampR * 0.4;
          const trA = prStr * (0.25 - tr * 0.04) * (0.7 + 0.3 * Math.sin(animFrame * 0.08));
          if (trA < 0.005) continue;
          ctx.globalAlpha = trA;
          const tg = ctx.createRadialGradient(trX, trY, 0, trX, trY, 6);
          tg.addColorStop(0, 'rgba(255,200,50,1)');
          tg.addColorStop(1, 'rgba(255,80,0,0)');
          ctx.fillStyle = tg;
          ctx.beginPath();
          ctx.arc(trX, trY, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        // 灯台本体
        ctx.globalAlpha = prStr * 0.90;
        const lg2 = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, 8);
        lg2.addColorStop(0, 'rgba(255,230,80,1)');
        lg2.addColorStop(0.5, 'rgba(255,140,20,0.7)');
        lg2.addColorStop(1, 'rgba(255,50,0,0)');
        ctx.fillStyle = lg2;
        ctx.beginPath();
        ctx.arc(lampX, lampY, 8, 0, Math.PI * 2);
        ctx.fill();
        // 祭司のシルエット（祠の前に立つ）
        ctx.globalAlpha = prStr * 0.35;
        ctx.fillStyle   = '#1A0C06';
        // 体
        ctx.beginPath();
        ctx.ellipse(shx, shy + tileSize * 0.5, 3, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 頭
        ctx.beginPath();
        ctx.arc(shx, shy + tileSize * 0.5 - 7, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 暁の川霧 ──
  if (loc === 'varanasi') {
    const elapsedMist = animFrame - fieldEnterFrame;
    const mistStr = elapsedMist < 200 ? Math.min(1, elapsedMist / 80) :
                    elapsedMist < 600 ? 1 - (elapsedMist - 200) / 400 : 0;
    if (mistStr > 0.01) {
      ctx.save();
      // 川面から立ち上がる霞（水タイル行付近）
      for (let m = 0; m < 5; m++) {
        const mx0  = (m * 143 + animFrame * 0.18) % (canvas.width + 80) - 40;
        const mRow = m % 2;
        const my   = mRow * tileSize + tileSize * 0.6 - (animFrame * 0.08 + m * 7) % (tileSize * 3);
        if (my < -20 || my > tileSize * 3) continue;
        const fade = (1 - Math.abs(my - tileSize * 0.5) / (tileSize * 2.5)) * mistStr;
        if (fade < 0.005) continue;
        const mg2 = ctx.createRadialGradient(mx0, my, 0, mx0, my, 40 + m * 12);
        mg2.addColorStop(0, `rgba(230,225,215,${fade * 0.22})`);
        mg2.addColorStop(1, 'rgba(200,195,185,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = mg2;
        ctx.beginPath();
        ctx.ellipse(mx0, my, 50 + m * 10, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 聖なる牛 ──
  if (loc === 'varanasi') {
    const cowCycle = 600;
    const cowActive = 250;
    const cowPhase = animFrame % cowCycle;
    if (cowPhase < cowActive) {
      const t   = cowPhase / cowActive;
      const cwx = t * canvas.width * 0.82 + canvas.width * 0.04;
      const cwy = tileSize * 4.8 + Math.sin(animFrame * 0.025 + 0.5) * 1.5;
      const fade = t < 0.05 ? t / 0.05 : t > 0.92 ? (1 - t) / 0.08 : 1;
      const step = Math.sin(animFrame * 0.13) * 2;
      ctx.save();
      ctx.globalAlpha = fade * 0.36;
      ctx.fillStyle   = '#1A1008';
      ctx.strokeStyle = '#1A1008';
      // 体（大きな楕円）
      ctx.beginPath();
      ctx.ellipse(cwx, cwy - 1, 13, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭（前方）
      ctx.beginPath();
      ctx.ellipse(cwx + 14, cwy - 3, 5, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // 鼻先
      ctx.beginPath();
      ctx.ellipse(cwx + 19, cwy - 2, 2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // こぶ（背中）
      ctx.beginPath();
      ctx.ellipse(cwx + 2, cwy - 8, 5, 4, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // 角
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cwx + 13, cwy - 7);
      ctx.lineTo(cwx + 11, cwy - 13);
      ctx.moveTo(cwx + 16, cwy - 6);
      ctx.lineTo(cwx + 18, cwy - 12);
      ctx.stroke();
      // 尻尾
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cwx - 12, cwy - 2);
      ctx.quadraticCurveTo(cwx - 17, cwy + 2, cwx - 15, cwy + 8);
      ctx.stroke();
      // 4本の脚
      ctx.lineWidth = 2.5;
      const cowLegs = [
        [cwx - 6, step], [cwx - 1, -step], [cwx + 5, step], [cwx + 10, -step]
      ];
      for (const [lx, lo] of cowLegs) {
        ctx.beginPath();
        ctx.moveTo(lx, cwy + 5);
        ctx.lineTo(lx, cwy + 13 + lo);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 空に舞う灯籠 ──
  if (loc === 'varanasi') {
    const elapsedLan = animFrame - fieldEnterFrame;
    if (elapsedLan >= 400) {
      const lanCycle = 340;
      ctx.save();
      for (let l = 0; l < 3; l++) {
        const age = (animFrame * 0.7 + l * (lanCycle / 3)) % lanCycle;
        const t   = age / lanCycle;
        // 石段の位置から浮かび上がる
        const lx = (canvas.width * (0.20 + l * 0.28)) + Math.sin(t * Math.PI * 2.2 + l) * 9;
        const ly = canvas.height * 0.88 - t * canvas.height * 0.82;
        if (ly < 0) continue;
        const fade = t < 0.06 ? t / 0.06 : t > 0.80 ? (1 - t) / 0.20 : 1;
        const glow = 0.65 + 0.35 * Math.sin(animFrame * 0.06 + l * 1.4);
        // 灯籠本体
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 8);
        lg.addColorStop(0, `rgba(255,220,80,${glow * 0.90})`);
        lg.addColorStop(0.5, `rgba(255,140,20,${glow * 0.55})`);
        lg.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.globalAlpha = fade * 0.80;
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 7, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        // 紙の枠（薄いアウトライン）
        ctx.globalAlpha = fade * 0.25;
        ctx.strokeStyle = 'rgba(255,200,60,1)';
        ctx.lineWidth   = 0.8;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 7, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
        // 光のひも
        ctx.globalAlpha = fade * glow * 0.30;
        ctx.strokeStyle = 'rgba(255,200,80,1)';
        ctx.lineWidth   = 0.6;
        ctx.beginPath();
        ctx.moveTo(lx - 3, ly + 9);
        ctx.lineTo(lx,     ly + 15);
        ctx.lineTo(lx + 3, ly + 9);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── バラナシ: 寺院の鐘の波紋 ──
  if (loc === 'varanasi') {
    const bellPeriod = 180;
    const shrinesB = [{x: 1.5, y: 5}, {x: 6.5, y: 5}, {x: 12.5, y: 5}, {x: 17.5, y: 5}];
    ctx.save();
    for (let s = 0; s < shrinesB.length; s++) {
      const sh = shrinesB[s];
      const shx = sh.x * tileSize;
      const shy = sh.y * tileSize;
      // 各祠が少しずらしたタイミングで鐘を打つ
      const bOffset = (animFrame + s * 44) % bellPeriod;
      const t = bOffset / bellPeriod;
      // 外側に広がる波紋 × 2
      for (let ring = 0; ring < 2; ring++) {
        const rt = (t + ring * 0.45) % 1;
        const rr = rt * tileSize * 2.2;
        const ra = (1 - rt) * 0.18;
        if (ra < 0.005) continue;
        ctx.globalAlpha = ra;
        ctx.strokeStyle = 'rgba(220,180,60,1)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.ellipse(shx, shy, rr, rr * 0.38, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── バラナシ: アーティの火の粉 ──
  if (loc === 'varanasi') {
    const elapsedEmb = animFrame - fieldEnterFrame;
    if (elapsedEmb >= 700) {
      const rise = Math.min(1, (elapsedEmb - 700) / 300);
      const shrinesE = [{x: 1.5, y: 5}, {x: 6.5, y: 5}, {x: 12.5, y: 5}, {x: 17.5, y: 5}];
      ctx.save();
      for (const sh of shrinesE) {
        const ox = sh.x * tileSize;
        const oy = sh.y * tileSize;
        for (let p = 0; p < 8; p++) {
          const age    = (animFrame * 0.65 + p * 19 + sh.x * 7) % 90;
          const t      = age / 90;
          const drift  = Math.sin(t * Math.PI * 2.1 + p * 1.2) * (5 + t * 8);
          const px     = ox + drift;
          const py     = oy - t * 55 - 4;
          const fade   = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
          const glow   = 0.7 + 0.3 * Math.sin(animFrame * 0.18 + p * 0.7);
          ctx.globalAlpha = rise * fade * glow * 0.70;
          // 火の粉のグラデーション
          const eg = ctx.createRadialGradient(px, py, 0, px, py, 2.5);
          eg.addColorStop(0, 'rgba(255,230,120,1)');
          eg.addColorStop(0.5, 'rgba(255,100,20,0.7)');
          eg.addColorStop(1, 'rgba(200,30,0,0)');
          ctx.fillStyle = eg;
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── バラナシ: お香の煙 ──
  if (loc === 'varanasi') {
    const smokePos = [{x: 1.5, y: 5}, {x: 6.5, y: 5}, {x: 12.5, y: 5}, {x: 17.5, y: 5}];
    ctx.save();
    ctx.fillStyle = '#EAE0D2';
    for (const sp of smokePos) {
      const ox = sp.x * tileSize;
      const oy = sp.y * tileSize - 2;
      for (let seg = 0; seg < 8; seg++) {
        const age   = (animFrame * 0.75 + seg * 13) % 104;
        const t     = age / 104;
        const alpha = t < 0.2 ? (t / 0.2) * 0.16 : (1 - t) * 0.16;
        if (alpha < 0.005) continue;
        const wx = ox + Math.sin(t * Math.PI * 2.6 + seg * 1.0) * (4 + t * 7);
        const wy = oy - t * 42;
        const r  = 2 + t * 4.5;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(wx, wy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── ハンピ: チタル（斑鹿） ──
  if (loc === 'hampi') {
    const chitalCycle = 600;
    const chitalActive = 180;
    const cp = animFrame % chitalCycle;
    if (cp < chitalActive) {
      const t   = cp / chitalActive;
      const chx = t * canvas.width * 0.72 + canvas.width * 0.08;
      const chy = tileSize * 7.5 + Math.sin(animFrame * 0.022) * 1.5;
      const fade = t < 0.04 ? t / 0.04 : t > 0.92 ? (1 - t) / 0.08 : 1;
      const step = Math.sin(animFrame * 0.16) * 2;
      ctx.save();
      ctx.globalAlpha = fade * 0.36;
      ctx.fillStyle   = '#3A2010';
      ctx.strokeStyle = '#3A2010';
      // 胴体（楕円）
      ctx.beginPath();
      ctx.ellipse(chx, chy - 3, 10, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 首
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(chx + 9, chy - 5);
      ctx.quadraticCurveTo(chx + 12, chy - 9, chx + 13, chy - 14);
      ctx.stroke();
      // 頭
      ctx.beginPath();
      ctx.ellipse(chx + 14, chy - 16, 4, 3, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // 角（雄の場合）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(chx + 12, chy - 19);
      ctx.lineTo(chx + 9, chy - 26);
      ctx.lineTo(chx + 6, chy - 22);
      ctx.moveTo(chx + 13, chy - 19);
      ctx.lineTo(chx + 17, chy - 26);
      ctx.lineTo(chx + 20, chy - 22);
      ctx.stroke();
      // 白い班点（斑鹿の特徴）
      ctx.globalAlpha = fade * 0.20;
      ctx.fillStyle   = '#D8C8A0';
      for (let sp = 0; sp < 8; sp++) {
        const sx = chx - 6 + (sp % 4) * 4 + (Math.floor(sp / 4)) * 2;
        const sy = chy - 6 + Math.floor(sp / 4) * 4;
        ctx.beginPath();
        ctx.arc(sx, sy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = fade * 0.36;
      ctx.fillStyle   = '#3A2010';
      // 4本の脚
      ctx.lineWidth   = 2;
      const cLegs = [chx - 4, chx, chx + 5, chx + 8];
      for (let l = 0; l < 4; l++) {
        const lo = Math.sin(animFrame * 0.18 + l * 0.8) * 2.5;
        ctx.beginPath();
        ctx.moveTo(cLegs[l], chy + 2);
        ctx.lineTo(cLegs[l] + (l < 2 ? -0.5 : 0.5), chy + 9 + lo);
        ctx.stroke();
      }
      // しっぽ（白い）
      ctx.globalAlpha = fade * 0.30;
      ctx.fillStyle = '#E8E0D0';
      ctx.beginPath();
      ctx.ellipse(chx - 9, chy - 5, 2.5, 1.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ハンピ: 岩山のハヌマーン像 ──
  if (loc === 'hampi') {
    const elapsedHanu = animFrame - fieldEnterFrame;
    const hanuAlpha = Math.min(1, elapsedHanu / 350) * 0.80;
    if (hanuAlpha > 0) {
      ctx.save();
      // Hanuman statue silhouette on a boulder pedestal
      const hx = canvas.width  * 0.82;
      const hy = canvas.height * 0.30;
      const s  = 18; // base unit
      ctx.globalAlpha = hanuAlpha * 0.82;
      // Boulder/pedestal
      ctx.fillStyle = 'rgba(110,85,60,1)';
      ctx.beginPath();
      ctx.ellipse(hx, hy + s * 2.8, s * 2.2, s * 1.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx, hy + s * 2.0, s * 1.6, s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body — standing figure
      ctx.fillStyle = 'rgba(80,55,35,1)';
      ctx.beginPath();
      ctx.ellipse(hx, hy + s * 0.8, s * 0.7, s * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head with crown
      ctx.fillStyle = 'rgba(85,58,38,1)';
      ctx.beginPath();
      ctx.arc(hx, hy - s * 0.5, s * 0.6, 0, Math.PI * 2);
      ctx.fill();
      // Crown points
      ctx.fillStyle = 'rgba(200,160,30,1)';
      for (let ci = 0; ci < 5; ci++) {
        const ca = (ci / 5) * Math.PI - Math.PI * 0.1;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(ca) * s * 0.55, hy - s * 0.5 + Math.sin(ca) * s * 0.55);
        ctx.lineTo(hx + Math.cos(ca) * s * 0.85, hy - s * 0.5 + Math.sin(ca) * s * 0.85);
        ctx.lineTo(hx + Math.cos(ca + 0.32) * s * 0.6, hy - s * 0.5 + Math.sin(ca + 0.32) * s * 0.6);
        ctx.closePath();
        ctx.fill();
      }
      // Right arm raised holding mace
      ctx.fillStyle = 'rgba(78,52,32,1)';
      ctx.beginPath();
      ctx.moveTo(hx + s * 0.55, hy + s * 0.3);
      ctx.quadraticCurveTo(hx + s * 1.5, hy - s * 0.8, hx + s * 1.3, hy - s * 1.6);
      ctx.lineWidth = s * 0.3;
      ctx.strokeStyle = 'rgba(78,52,32,1)';
      ctx.stroke();
      // Mace head
      ctx.fillStyle = 'rgba(180,140,30,1)';
      ctx.globalAlpha = hanuAlpha * 0.85;
      ctx.beginPath();
      ctx.ellipse(hx + s * 1.35, hy - s * 1.85, s * 0.4, s * 0.55, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Left arm — chest mudra
      ctx.strokeStyle = 'rgba(78,52,32,1)';
      ctx.lineWidth = s * 0.28;
      ctx.beginPath();
      ctx.moveTo(hx - s * 0.55, hy + s * 0.2);
      ctx.quadraticCurveTo(hx - s * 1.0, hy - s * 0.2, hx - s * 0.4, hy - s * 0.6);
      ctx.stroke();
      // Tail curling up
      ctx.strokeStyle = 'rgba(80,55,35,1)';
      ctx.lineWidth = s * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy + s * 1.8);
      ctx.bezierCurveTo(hx + s * 1.8, hy + s * 2.2, hx + s * 2.5, hy + s * 0.8, hx + s * 1.8, hy - s * 0.5);
      ctx.stroke();
      // Vermilion glow — holy light
      const glowPulse = 0.7 + Math.sin(animFrame * 0.025) * 0.3;
      ctx.globalAlpha = hanuAlpha * glowPulse * 0.18;
      const hGlow = ctx.createRadialGradient(hx, hy, 0, hx, hy, s * 3.5);
      hGlow.addColorStop(0, 'rgba(255,80,20,0.7)');
      hGlow.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = hGlow;
      ctx.beginPath();
      ctx.arc(hx, hy, s * 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ハンピ: ヴィルパクシャ寺院の黄金の旗 ──
  if (loc === 'hampi') {
    const elapsedFlag = animFrame - fieldEnterFrame;
    const flagAlpha = Math.min(1, elapsedFlag / 240) * 0.82;
    if (flagAlpha > 0) {
      ctx.save();
      // Tall flagpoles with rippling saffron/gold temple flags
      const poles = [
        { x: 0.28, y: 0.06, poleH: 0.30, flagW: 28, flagH: 16, windPhase: 0.0  },
        { x: 0.48, y: 0.04, poleH: 0.34, flagW: 34, flagH: 19, windPhase: 1.3  },
        { x: 0.68, y: 0.07, poleH: 0.28, flagW: 26, flagH: 15, windPhase: 0.7  },
        { x: 0.85, y: 0.05, poleH: 0.29, flagW: 22, flagH: 13, windPhase: 2.1  },
      ];
      const windStrength = 0.6 + Math.sin(animFrame * 0.011) * 0.4;
      for (const fp of poles) {
        const px = canvas.width  * fp.x;
        const py = canvas.height * fp.y;
        const poleBottom = py + canvas.height * fp.poleH;
        // Pole
        ctx.globalAlpha = flagAlpha * 0.90;
        ctx.strokeStyle = 'rgba(80,60,30,1)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, poleBottom);
        ctx.lineTo(px, py);
        ctx.stroke();
        // Gold finial at top
        ctx.fillStyle = 'rgba(255,210,30,1)';
        ctx.globalAlpha = flagAlpha * 0.95;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
        // Rippling flag — drawn as a curved quad
        const ww = fp.flagW;
        const wh = fp.flagH;
        const steps = 10;
        // Gradient saffron-gold
        const flagGrad = ctx.createLinearGradient(px, py, px + ww, py);
        flagGrad.addColorStop(0,   'rgba(240,100,20,1)');
        flagGrad.addColorStop(0.5, 'rgba(255,160,20,1)');
        flagGrad.addColorStop(1,   'rgba(255,210,40,0.8)');
        ctx.fillStyle = flagGrad;
        ctx.globalAlpha = flagAlpha * 0.88;
        ctx.beginPath();
        // Top edge (waves with wind)
        for (let si = 0; si <= steps; si++) {
          const xf = px + (si / steps) * ww;
          const wave = Math.sin(si / steps * Math.PI * 2.5 + animFrame * 0.055 + fp.windPhase) * wh * 0.22 * windStrength;
          if (si === 0) ctx.moveTo(xf, py + wave);
          else          ctx.lineTo(xf, py + wave);
        }
        // Bottom edge (opposite phase)
        for (let si = steps; si >= 0; si--) {
          const xf = px + (si / steps) * ww;
          const wave = Math.sin(si / steps * Math.PI * 2.5 + animFrame * 0.055 + fp.windPhase + 0.8) * wh * 0.18 * windStrength;
          ctx.lineTo(xf, py + wh + wave);
        }
        ctx.closePath();
        ctx.fill();
        // OM symbol hint in center
        ctx.globalAlpha = flagAlpha * 0.35;
        ctx.fillStyle = 'rgba(120,40,0,1)';
        ctx.font = 'bold ' + Math.round(wh * 0.65) + 'px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ॐ', px + ww * 0.45, py + wh * 0.52);
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 岩山を渡るハヤブサ ──
  if (loc === 'hampi') {
    const elapsedFalc = animFrame - fieldEnterFrame;
    const falcAlpha = Math.min(1, elapsedFalc / 300) * 0.85;
    if (falcAlpha > 0) {
      ctx.save();
      // Falcons on looping flight paths across the boulder skyline
      const falcons = [
        { loopW: 0.70, loopH: 0.10, cx: 0.50, cy: 0.20, period: 420, phaseOff: 0,   size: 5.5, bank: 1  },
        { loopW: 0.55, loopH: 0.08, cx: 0.38, cy: 0.15, period: 360, phaseOff: 150, size: 4.5, bank: -1 },
        { loopW: 0.45, loopH: 0.07, cx: 0.65, cy: 0.24, period: 500, phaseOff: 80,  size: 4.0, bank: 1  },
      ];
      for (const fl of falcons) {
        const t = ((animFrame + fl.phaseOff) % fl.period) / fl.period;
        // Elliptical orbit
        const angle = t * Math.PI * 2;
        const fx = canvas.width  * (fl.cx + Math.cos(angle) * fl.loopW * 0.5);
        const fy = canvas.height * (fl.cy + Math.sin(angle) * fl.loopH * 0.5);
        // Direction of flight determines wing and body tilt
        const dx = -Math.sin(angle);
        const dy =  Math.cos(angle) * (fl.loopH / fl.loopW);
        const bodyAngle = Math.atan2(dy, dx);
        const bankAngle = Math.sin(angle) * 0.35 * fl.bank;
        const s = fl.size;
        // Wing flap
        const flap = Math.sin(animFrame * 0.22 + fl.phaseOff * 0.01) * 0.6 + 0.4;
        ctx.globalAlpha = falcAlpha * 0.88;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(bodyAngle + bankAngle);
        // Body
        ctx.fillStyle = 'rgba(40,30,20,1)';
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.6, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        // Wings
        ctx.fillStyle = 'rgba(55,40,25,1)';
        for (const side of [-1, 1]) {
          const wTip = s * 2.8 * side;
          const wDrop = s * 1.2 * flap * side * fl.bank;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(wTip * 0.5, wDrop * 0.5, wTip, wDrop * 0.8);
          ctx.quadraticCurveTo(wTip * 0.6, wDrop * 0.3, 0, s * 0.3);
          ctx.closePath();
          ctx.fill();
        }
        // Tail
        ctx.fillStyle = 'rgba(70,50,30,1)';
        ctx.beginPath();
        ctx.moveTo(-s * 1.2, 0);
        ctx.lineTo(-s * 2.2, -s * 0.3);
        ctx.lineTo(-s * 2.0,  s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 石柱の影の格子模様 ──
  if (loc === 'hampi') {
    const elapsedLatt = animFrame - fieldEnterFrame;
    const lattFadeIn  = Math.min(1, elapsedLatt / 320);
    const lattAlpha   = lattFadeIn * 0.48;
    if (lattAlpha > 0.005) {
      ctx.save();
      // Sun angle slowly shifts — shadow angle drifts over time
      const sunShift = Math.sin(animFrame * 0.0008) * 0.18;
      const shadowAngle = 0.55 + sunShift; // radians from vertical
      const shadowLen = 180;
      // Column positions (fixed architectural grid)
      const cols = [
        { x: 0.08 }, { x: 0.20 }, { x: 0.32 },
        { x: 0.55 }, { x: 0.67 }, { x: 0.80 }, { x: 0.92 },
      ];
      const colWidth = 7;
      ctx.globalAlpha = lattAlpha;
      ctx.fillStyle = 'rgba(30,18,8,1)';
      for (const col of cols) {
        const cx = canvas.width * col.x;
        const topY = canvas.height * 0.18;
        // Shadow stripe cast onto ground
        const shadowDx = Math.tan(shadowAngle) * shadowLen;
        ctx.beginPath();
        // Shadow parallelogram
        ctx.moveTo(cx - colWidth * 0.5,           topY + shadowLen);
        ctx.lineTo(cx + colWidth * 0.5,           topY + shadowLen);
        ctx.lineTo(cx + colWidth * 0.5 + shadowDx, topY);
        ctx.lineTo(cx - colWidth * 0.5 + shadowDx, topY);
        ctx.closePath();
        ctx.fill();
      }
      // Horizontal beam shadows (architrave bands)
      const beamRows = [0.28, 0.46, 0.64];
      const beamHeight = 6;
      for (const by of beamRows) {
        const rowY = canvas.height * by;
        const bShadowDy = Math.tan(shadowAngle) * beamHeight * 2.5;
        ctx.globalAlpha = lattAlpha * 0.6;
        ctx.beginPath();
        ctx.rect(0, rowY + bShadowDy, canvas.width, beamHeight);
        ctx.fill();
      }
      // Light shafts between columns — bright dust-mote bands
      ctx.globalAlpha = lattAlpha * 0.22;
      ctx.fillStyle = 'rgba(255,220,140,1)';
      for (let li = 0; li < cols.length - 1; li++) {
        const lx = canvas.width * ((cols[li].x + cols[li + 1].x) * 0.5);
        const shaftW = canvas.width * (cols[li + 1].x - cols[li].x) * 0.55;
        const shaftBright = 0.7 + Math.sin(animFrame * 0.012 + li * 1.3) * 0.3;
        ctx.globalAlpha = lattAlpha * 0.20 * shaftBright;
        const shaftGrad = ctx.createLinearGradient(lx - shaftW * 0.5, 0, lx + shaftW * 0.5, 0);
        shaftGrad.addColorStop(0,   'rgba(255,220,140,0)');
        shaftGrad.addColorStop(0.5, 'rgba(255,220,140,0.6)');
        shaftGrad.addColorStop(1,   'rgba(255,220,140,0)');
        ctx.fillStyle = shaftGrad;
        ctx.fillRect(lx - shaftW * 0.5, canvas.height * 0.18, shaftW, canvas.height * 0.6);
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の燃える夕焼け空 ──
  if (loc === 'hampi') {
    const elapsedSunset = animFrame - fieldEnterFrame;
    const sunsetIn = Math.min(1, Math.max(0, (elapsedSunset - 1100) / 350));
    const sunsetOut = Math.max(0, 1 - (elapsedSunset - 2100) / 400);
    const sunsetAlpha = sunsetIn * sunsetOut * 0.55;
    if (sunsetAlpha > 0.005) {
      ctx.save();
      // Vivid layered sunset sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.5);
      skyGrad.addColorStop(0, 'rgba(20,30,80,' + (sunsetAlpha * 0.5).toFixed(3) + ')');
      skyGrad.addColorStop(0.25, 'rgba(80,30,100,' + (sunsetAlpha * 0.4).toFixed(3) + ')');
      skyGrad.addColorStop(0.5, 'rgba(200,60,20,' + (sunsetAlpha * 0.35).toFixed(3) + ')');
      skyGrad.addColorStop(0.75, 'rgba(240,120,20,' + (sunsetAlpha * 0.25).toFixed(3) + ')');
      skyGrad.addColorStop(1, 'rgba(255,180,40,0)');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.5);
      // Horizontal cloud streaks (cirrus)
      for (let cs = 0; cs < 5; cs++) {
        const csY = canvas.height * (0.04 + cs * 0.07);
        const csLen = canvas.width * (0.4 + cs * 0.1);
        const csX = canvas.width * (0.05 + cs * 0.12) + Math.sin(animFrame * 0.006 + cs) * 8;
        const csAlpha = sunsetAlpha * (0.25 + Math.sin(cs * 0.9) * 0.1);
        const r = 200 + cs * 10, g = 80 - cs * 10, b = 20;
        const csGrad = ctx.createLinearGradient(csX, csY, csX + csLen, csY);
        csGrad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0)');
        csGrad.addColorStop(0.5, 'rgba(' + r + ',' + g + ',' + b + ',' + csAlpha.toFixed(3) + ')');
        csGrad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
        ctx.fillStyle = csGrad;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(csX + csLen * 0.5, csY, csLen * 0.5, 4 + cs, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の嵐前の暗雲 ──
  if (loc === 'hampi') {
    const elapsedStormCloud = animFrame - fieldEnterFrame;
    if (elapsedStormCloud >= 1200) {
      const scIn = Math.min(1, (elapsedStormCloud - 1200) / 500);
      const scOut = Math.max(0, 1 - (elapsedStormCloud - 2400) / 400);
      const scAlpha = scIn * scOut * 0.55;
      if (scAlpha > 0.005) {
        ctx.save();
        // Dark cumulonimbus clouds building on horizon
        const cloudBases = [
          { x: 0.08, y: 0.12, w: 85, h: 40, speed: 0.008 },
          { x: 0.52, y: 0.08, w: 100, h: 50, speed: 0.006 },
          { x: 0.85, y: 0.11, w: 75, h: 35, speed: 0.01 },
        ];
        for (const cb of cloudBases) {
          const cx = canvas.width * cb.x + Math.sin(animFrame * cb.speed) * 8;
          const cy = canvas.height * cb.y;
          // Dark anvil top
          ctx.globalAlpha = scAlpha * 0.65;
          ctx.fillStyle = 'rgba(30,25,40,0.7)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, cb.w * 0.6, cb.h * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
          // Billowing sides
          for (let puff = 0; puff < 5; puff++) {
            const px = cx + (puff - 2) * cb.w * 0.22;
            const py = cy + cb.h * 0.2;
            const pr = cb.h * (0.35 + puff * 0.04);
            ctx.globalAlpha = scAlpha * (0.5 + Math.sin(puff * 0.8) * 0.15);
            ctx.fillStyle = 'rgba(40,35,55,0.65)';
            ctx.beginPath();
            ctx.ellipse(px, py, pr * 0.8, pr, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          // Base flat bottom
          ctx.globalAlpha = scAlpha * 0.4;
          ctx.fillStyle = 'rgba(20,15,30,0.5)';
          ctx.beginPath();
          ctx.ellipse(cx, cy + cb.h * 0.5, cb.w * 0.55, cb.h * 0.15, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Overall sky darkening gradient
        ctx.globalAlpha = scAlpha * 0.25;
        const darkGrad = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.4);
        darkGrad.addColorStop(0, 'rgba(20,15,35,0.5)');
        darkGrad.addColorStop(1, 'rgba(20,15,35,0)');
        ctx.fillStyle = darkGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height * 0.4);
        ctx.restore();
      }
    }
  }

  // ── ハンピ: 廃墟上の天の川 ──
  if (loc === 'hampi') {
    const elapsedMilkyWay = animFrame - fieldEnterFrame;
    if (elapsedMilkyWay >= 1700) {
      const mwAlpha = Math.min(1, (elapsedMilkyWay - 1700) / 400) * 0.55;
      ctx.save();
      // Milky Way band arcing across the night sky
      const mwCX = canvas.width * 0.35;
      const mwCY = canvas.height * 1.8;
      const mwR = canvas.height * 1.6;
      const mwW = 55;
      // Glow band
      const mwGrad = ctx.createRadialGradient(mwCX, mwCY, mwR - mwW, mwCX, mwCY, mwR + mwW);
      mwGrad.addColorStop(0, 'rgba(180,180,220,0)');
      mwGrad.addColorStop(0.5, 'rgba(200,195,235,' + (mwAlpha * 0.35).toFixed(3) + ')');
      mwGrad.addColorStop(1, 'rgba(170,170,210,0)');
      ctx.strokeStyle = mwGrad;
      ctx.lineWidth = mwW * 2;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(mwCX, mwCY, mwR, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      // Star density inside band
      const starCount = 80;
      for (let si = 0; si < starCount; si++) {
        const starAngle = Math.PI * (1.1 + (si / starCount) * 0.8);
        const starR = mwR + (Math.sin(si * 1.7) * mwW * 0.7);
        const sx = mwCX + Math.cos(starAngle) * starR;
        const sy = mwCY + Math.sin(starAngle) * starR;
        if (sy < 0 || sy > canvas.height * 0.52) continue;
        const starTwinkle = (Math.sin(animFrame * 0.07 + si * 0.9) + 1) / 2;
        ctx.globalAlpha = mwAlpha * (0.3 + starTwinkle * 0.5);
        ctx.fillStyle = si % 5 === 0 ? 'rgba(255,240,200,0.9)' : 'rgba(220,220,255,0.8)';
        const sr = 0.8 + (si % 3) * 0.4;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
      // Extra bright stars scattered
      for (let bs = 0; bs < 20; bs++) {
        const bx = canvas.width * (0.05 + (bs % 10) * 0.1);
        const by = canvas.height * (0.04 + (bs % 5) * 0.08);
        const bTwinkle = (Math.sin(animFrame * 0.06 + bs * 1.1) + 1) / 2;
        ctx.globalAlpha = mwAlpha * bTwinkle * 0.7;
        ctx.fillStyle = 'rgba(255,250,230,0.9)';
        ctx.beginPath();
        ctx.arc(bx, by, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 遠方の砂嵐 ──
  if (loc === 'hampi') {
    const elapsedDust = animFrame - fieldEnterFrame;
    if (elapsedDust >= 800) {
      const dustIn = Math.min(1, (elapsedDust - 800) / 400);
      const dustOut = Math.max(0, 1 - (elapsedDust - 1800) / 500);
      const dustAlpha = dustIn * dustOut * 0.45;
      if (dustAlpha > 0.005) {
        ctx.save();
        // Dust wall approaching from the right
        const dustX = canvas.width * (0.95 - dustIn * 0.3);
        const dustW = canvas.width * 0.35;
        // Wall of dust
        const dustGrad = ctx.createLinearGradient(dustX, 0, dustX + dustW, 0);
        dustGrad.addColorStop(0, 'rgba(180,140,80,' + (dustAlpha * 0.6).toFixed(3) + ')');
        dustGrad.addColorStop(0.4, 'rgba(200,165,100,' + (dustAlpha * 0.35).toFixed(3) + ')');
        dustGrad.addColorStop(1, 'rgba(200,165,100,0)');
        ctx.fillStyle = dustGrad;
        ctx.fillRect(dustX, 0, dustW, canvas.height * 0.65);
        // Dust tendrils curling at leading edge
        for (let dt = 0; dt < 8; dt++) {
          const tenY = canvas.height * (0.05 + dt * 0.08);
          const tenX = dustX + Math.sin(animFrame * 0.025 + dt * 1.2) * 12;
          const tenGrad = ctx.createLinearGradient(tenX, tenY, tenX + 40, tenY);
          tenGrad.addColorStop(0, 'rgba(190,150,90,' + (dustAlpha * 0.5).toFixed(3) + ')');
          tenGrad.addColorStop(1, 'rgba(200,160,100,0)');
          ctx.globalAlpha = dustAlpha * (0.5 + Math.sin(dt * 0.8) * 0.3);
          ctx.fillStyle = tenGrad;
          ctx.beginPath();
          ctx.ellipse(tenX + 20, tenY + 12, 30, 8 + dt, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Sky color tint from dust
        const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.35);
        skyGrad.addColorStop(0, 'rgba(180,140,70,' + (dustAlpha * 0.2).toFixed(3) + ')');
        skyGrad.addColorStop(1, 'rgba(180,140,70,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = skyGrad;
        ctx.fillRect(dustX - 30, 0, dustW + 60, canvas.height * 0.35);
        ctx.restore();
      }
    }
  }

  // ── ハンピ: 廃墟に降る落ち葉 ──
  if (loc === 'hampi') {
    const elapsedFallingLeaf = animFrame - fieldEnterFrame;
    const flAlpha = Math.min(1, elapsedFallingLeaf / 250) * 0.72;
    if (flAlpha > 0) {
      ctx.save();
      const leafFallCount = 12;
      for (let li = 0; li < leafFallCount; li++) {
        const fallCycle = 260 + li * 18;
        const fallT = ((animFrame * 0.6 + li * 40) % fallCycle) / fallCycle;
        const lx = canvas.width * (0.06 + (li % 6) * 0.17) + Math.sin(animFrame * 0.03 + li) * 18;
        const ly = fallT * (canvas.height * 0.95);
        const lRot = fallT * Math.PI * 5 + li * 0.4;
        const swayX = Math.sin(animFrame * 0.04 + li * 1.2) * 12 * fallT;
        // Autumn leaf colors
        const hue = 20 + (li % 4) * 10;
        ctx.globalAlpha = flAlpha * (1 - fallT * 0.5) * (0.7 + Math.sin(li * 0.8) * 0.2);
        ctx.save();
        ctx.translate(lx + swayX, ly);
        ctx.rotate(lRot);
        const leafSize = 5 + (li % 3) * 2;
        // Leaf shape (5-pointed)
        ctx.fillStyle = 'hsl(' + hue + ',75%,42%)';
        ctx.beginPath();
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * Math.PI * 2 - Math.PI / 2;
          const outerPt = leafSize;
          const innerPt = leafSize * 0.42;
          const oax = Math.cos(pa) * outerPt;
          const oay = Math.sin(pa) * outerPt;
          const iax = Math.cos(pa + Math.PI / 5) * innerPt;
          const iay = Math.sin(pa + Math.PI / 5) * innerPt;
          p === 0 ? ctx.moveTo(oax, oay) : ctx.lineTo(oax, oay);
          ctx.lineTo(iax, iay);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の朽ちた布旗 ──
  if (loc === 'hampi') {
    const elapsedRag = animFrame - fieldEnterFrame;
    const ragAlpha = Math.min(1, elapsedRag / 240) * 0.7;
    if (ragAlpha > 0) {
      ctx.save();
      // Tattered cloth banners hanging from ruined stone pillars
      const banners = [
        { x: 0.1,  y: 0.25, w: 18, h: 30, hue: 20,  rot: 0.05 },
        { x: 0.35, y: 0.22, w: 22, h: 25, hue: 200, rot: -0.04 },
        { x: 0.6,  y: 0.26, w: 16, h: 28, hue: 340, rot: 0.06 },
        { x: 0.84, y: 0.23, w: 20, h: 26, hue: 60,  rot: -0.03 },
      ];
      for (const bn of banners) {
        const bx = canvas.width * bn.x;
        const by = canvas.height * bn.y;
        const wind = Math.sin(animFrame * 0.035 + bn.x * 6) * 8;
        const windSlow = Math.sin(animFrame * 0.02 + bn.x * 4) * 4;
        ctx.globalAlpha = ragAlpha * 0.7;
        // Main cloth piece (quadrilateral with ragged bottom)
        ctx.fillStyle = 'hsl(' + bn.hue + ',55%,35%)';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + bn.w, by);
        ctx.lineTo(bx + bn.w + wind, by + bn.h * 0.6);
        // Ragged torn bottom edge
        ctx.lineTo(bx + bn.w - 3 + wind, by + bn.h + windSlow);
        ctx.lineTo(bx + bn.w * 0.65 + wind, by + bn.h * 0.85 + windSlow);
        ctx.lineTo(bx + bn.w * 0.35 + wind, by + bn.h + windSlow);
        ctx.lineTo(bx + wind * 0.5, by + bn.h * 0.95 + windSlow);
        ctx.closePath();
        ctx.fill();
        // Faded color overlay
        ctx.fillStyle = 'hsl(' + bn.hue + ',30%,55%)';
        ctx.globalAlpha = ragAlpha * 0.3;
        ctx.beginPath();
        ctx.moveTo(bx + 2, by + 2);
        ctx.lineTo(bx + bn.w - 2, by + 2);
        ctx.lineTo(bx + bn.w + wind * 0.5 - 2, by + bn.h * 0.4);
        ctx.lineTo(bx + wind * 0.3 + 2, by + bn.h * 0.4);
        ctx.closePath();
        ctx.fill();
        // Rope/attachment line
        ctx.globalAlpha = ragAlpha * 0.4;
        ctx.strokeStyle = '#8a7050';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx - 4, by - 2);
        ctx.lineTo(bx + bn.w + 4, by - 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の光のスリット ──
  if (loc === 'hampi') {
    const elapsedSlit = animFrame - fieldEnterFrame;
    const slitIn = Math.min(1, Math.max(0, (elapsedSlit - 150) / 250));
    const slitOut = Math.max(0, 1 - (elapsedSlit - 1500) / 400);
    const slitAlpha = slitIn * slitOut * 0.5;
    if (slitAlpha > 0.005) {
      ctx.save();
      // Thin beams of sunlight through narrow gaps between stone blocks
      const slitPositions = [0.14, 0.31, 0.49, 0.65, 0.81];
      for (let si = 0; si < slitPositions.length; si++) {
        const sx = canvas.width * slitPositions[si];
        const sway = Math.sin(animFrame * 0.01 + si * 0.7) * 3;
        const slitH = canvas.height * 0.55;
        const slitW = 3 + Math.sin(si * 1.1) * 1.5;
        const slitGrad = ctx.createLinearGradient(sx, 0, sx, slitH);
        slitGrad.addColorStop(0, 'rgba(255,230,150,' + (slitAlpha * 0.7).toFixed(3) + ')');
        slitGrad.addColorStop(0.6, 'rgba(255,210,120,' + (slitAlpha * 0.35).toFixed(3) + ')');
        slitGrad.addColorStop(1, 'rgba(255,190,80,0)');
        ctx.fillStyle = slitGrad;
        // Narrow beam with slight fan
        ctx.beginPath();
        ctx.moveTo(sx - slitW * 0.3 + sway, 0);
        ctx.lineTo(sx + slitW * 0.3 + sway, 0);
        ctx.lineTo(sx + slitW * 1.5 + sway * 1.5, slitH);
        ctx.lineTo(sx - slitW * 1.5 + sway * 1.5, slitH);
        ctx.closePath();
        ctx.fill();
        // Bright core
        ctx.globalAlpha = slitAlpha * 0.5;
        const coreGrad = ctx.createLinearGradient(sx, 0, sx, slitH * 0.4);
        coreGrad.addColorStop(0, 'rgba(255,250,200,0.6)');
        coreGrad.addColorStop(1, 'rgba(255,240,160,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.moveTo(sx - slitW * 0.15 + sway, 0);
        ctx.lineTo(sx + slitW * 0.15 + sway, 0);
        ctx.lineTo(sx + slitW * 0.5 + sway, slitH * 0.4);
        ctx.lineTo(sx - slitW * 0.5 + sway, slitH * 0.4);
        ctx.closePath();
        ctx.fill();
        // Dust motes
        for (let dm = 0; dm < 5; dm++) {
          const dmT = ((animFrame * 0.25 + si * 30 + dm * 18) % 55) / 55;
          const dmX = sx + sway + Math.sin(animFrame * 0.08 + dm + si) * slitW;
          const dmY = dmT * slitH;
          ctx.globalAlpha = slitAlpha * (1 - dmT) * 0.5;
          ctx.fillStyle = 'rgba(255,240,180,0.7)';
          ctx.beginPath();
          ctx.arc(dmX, dmY, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 石の馬のフリーズ ──
  if (loc === 'hampi') {
    const elapsedHorse = animFrame - fieldEnterFrame;
    const horseAlpha = Math.min(1, elapsedHorse / 280) * 0.65;
    if (horseAlpha > 0) {
      ctx.save();
      // Row of carved stone horses as a frieze on a wall
      const friezeY = canvas.height * 0.38;
      const friezeH = 34;
      // Background frieze panel
      ctx.globalAlpha = horseAlpha * 0.25;
      ctx.fillStyle = '#b09868';
      ctx.fillRect(0, friezeY - 2, canvas.width, friezeH + 4);
      ctx.globalAlpha = horseAlpha * 0.15;
      ctx.fillStyle = 'rgba(60,40,20,0.4)';
      ctx.fillRect(0, friezeY - 2, canvas.width, 2);
      ctx.fillRect(0, friezeY + friezeH + 2, canvas.width, 2);
      // Carved horses (4 visible)
      const horseSpacing = canvas.width / 5;
      for (let h = 0; h < 5; h++) {
        const hx = horseSpacing * (h + 0.5);
        const hy = friezeY + friezeH * 0.5;
        const hs = 0.65; // scale
        // Shadow highlight effect: slight animation to simulate light angle change
        const lightShift = Math.sin(animFrame * 0.007) * 2;
        ctx.globalAlpha = horseAlpha * 0.55;
        // Horse silhouette (relief carving)
        ctx.fillStyle = '#c0a870';
        // Body
        ctx.beginPath();
        ctx.ellipse(hx, hy, 13 * hs, 8 * hs, -0.1, 0, Math.PI * 2);
        ctx.fill();
        // Neck
        ctx.beginPath();
        ctx.ellipse(hx + 10 * hs, hy - 6 * hs, 6 * hs, 4 * hs, 0.4, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.beginPath();
        ctx.ellipse(hx + 16 * hs, hy - 10 * hs, 7 * hs, 4.5 * hs, 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Mane
        ctx.strokeStyle = '#a88850';
        ctx.lineWidth = 2 * hs;
        ctx.beginPath();
        ctx.moveTo(hx + 8 * hs, hy - 8 * hs);
        ctx.quadraticCurveTo(hx + 12 * hs, hy - 16 * hs, hx + 16 * hs, hy - 14 * hs);
        ctx.stroke();
        // Legs
        ctx.strokeStyle = '#b09860';
        ctx.lineWidth = 2 * hs;
        [[-7, 1], [-3, -1], [3, 1], [7, -1]].forEach(([lx, dir]) => {
          ctx.beginPath();
          ctx.moveTo(hx + lx * hs, hy + 7 * hs);
          ctx.lineTo(hx + lx * hs + dir, hy + 16 * hs);
          ctx.stroke();
        });
        // Carved shadow on right side (3D relief effect)
        ctx.globalAlpha = horseAlpha * 0.15;
        ctx.fillStyle = 'rgba(40,25,10,0.5)';
        ctx.beginPath();
        ctx.ellipse(hx + lightShift, hy + 1, 14 * hs, 9 * hs, -0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の石段を流れる雨 ──
  if (loc === 'hampi') {
    const elapsedRainStep = animFrame - fieldEnterFrame;
    if (elapsedRainStep >= 1300) {
      const rsAlpha = Math.min(1, (elapsedRainStep - 1300) / 350) * 0.6;
      ctx.save();
      // Thin trickles of rainwater flowing down stone steps
      const trickleCount = 7;
      for (let ti = 0; ti < trickleCount; ti++) {
        const tx = canvas.width * (0.06 + ti * 0.135);
        const speed = 0.8 + ti * 0.15;
        // Water stream down steps
        for (let step = 0; step < 6; step++) {
          const stepY = canvas.height * (0.5 + step * 0.07);
          const stepH = canvas.height * 0.065;
          const flowOffset = (animFrame * speed + ti * 30 + step * 20) % stepH;
          const ty = stepY + flowOffset;
          const trickleW = 1.5 + Math.sin(animFrame * 0.08 + ti + step) * 0.5;
          const trickleAlpha = rsAlpha * (1 - flowOffset / stepH) * 0.7;
          if (trickleAlpha < 0.01) continue;
          ctx.globalAlpha = trickleAlpha;
          const tGrad = ctx.createLinearGradient(tx, ty, tx, ty + 8);
          tGrad.addColorStop(0, 'rgba(160,190,220,0.8)');
          tGrad.addColorStop(1, 'rgba(140,175,210,0)');
          ctx.fillStyle = tGrad;
          ctx.beginPath();
          ctx.ellipse(tx, ty + 4, trickleW, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Splash pool at the bottom of each step
        for (let step = 0; step < 6; step++) {
          const poolY = canvas.height * (0.5 + step * 0.07 + 0.06);
          const poolW = 4 + Math.sin(animFrame * 0.05 + ti * 0.7) * 1;
          ctx.globalAlpha = rsAlpha * 0.35;
          ctx.fillStyle = 'rgba(140,180,220,0.5)';
          ctx.beginPath();
          ctx.ellipse(tx, poolY, poolW, poolW * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟に舞うスズメ ──
  if (loc === 'hampi') {
    const elapsedSparrow = animFrame - fieldEnterFrame;
    const spAlpha = Math.min(1, elapsedSparrow / 200) * 0.8;
    if (spAlpha > 0) {
      ctx.save();
      const sparrowCount = 15;
      for (let si = 0; si < sparrowCount; si++) {
        // Each sparrow has a home perch and occasionally flies
        const perchX = canvas.width * (0.06 + (si % 7) * 0.14);
        const perchY = canvas.height * (0.32 + (si % 4) * 0.1);
        // Fly cycle: mostly perched, brief flight burst
        const flyCycle = 120 + si * 17;
        const flyPhase = (animFrame + si * 40) % flyCycle;
        const isFlying = flyPhase < 30;
        let sx, sy;
        if (isFlying) {
          const ft = flyPhase / 30;
          const orbitR = 18 + si * 3;
          sx = perchX + Math.cos(ft * Math.PI * 2) * orbitR;
          sy = perchY + Math.sin(ft * Math.PI * 2) * orbitR * 0.5;
        } else {
          sx = perchX + Math.sin(animFrame * 0.015 + si) * 2;
          sy = perchY;
        }
        ctx.globalAlpha = spAlpha * (0.65 + Math.sin(si * 0.8) * 0.2);
        if (isFlying) {
          // Flapping wings
          const flapAmt = Math.sin(flyPhase * 0.4) * 5;
          ctx.strokeStyle = '#5a4028';
          ctx.lineWidth = 1.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx - 5, sy - flapAmt, sx - 9, sy - 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx + 5, sy - flapAmt, sx + 9, sy - 2);
          ctx.stroke();
          ctx.fillStyle = '#6a5030';
          ctx.beginPath();
          ctx.ellipse(sx, sy, 3.5, 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Perched bird
          ctx.fillStyle = '#7a5a30';
          ctx.beginPath();
          ctx.ellipse(sx, sy, 4.5, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#4a3018';
          ctx.beginPath();
          ctx.arc(sx + 3.5, sy - 2, 2.5, 0, Math.PI * 2);
          ctx.fill();
          // Tail
          ctx.fillStyle = '#5a4025';
          ctx.beginPath();
          ctx.moveTo(sx - 4, sy);
          ctx.lineTo(sx - 9, sy + 3);
          ctx.lineTo(sx - 9, sy - 1);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の壁のレリーフ ──
  if (loc === 'hampi') {
    const elapsedRelief = animFrame - fieldEnterFrame;
    const relAlpha = Math.min(1, elapsedRelief / 280) * 0.6;
    if (relAlpha > 0) {
      ctx.save();
      // Stone wall relief showing repeated elephant/lotus pattern
      const wallY = canvas.height * 0.46;
      const wallH = 28;
      const wallX0 = canvas.width * 0.03;
      const wallW = canvas.width * 0.94;
      // Background wall stone
      ctx.globalAlpha = relAlpha * 0.3;
      ctx.fillStyle = '#b8a070';
      ctx.fillRect(wallX0, wallY, wallW, wallH);
      // Shadow line top
      ctx.globalAlpha = relAlpha * 0.25;
      ctx.fillStyle = 'rgba(60,40,20,0.5)';
      ctx.fillRect(wallX0, wallY, wallW, 2);
      // Repeating carved pattern units
      const unitW = 36;
      const units = Math.floor(wallW / unitW);
      for (let u = 0; u < units; u++) {
        const ux = wallX0 + u * unitW + 2;
        const uy = wallY + 3;
        const shadow = Math.sin(animFrame * 0.008 + u * 0.3) * 1;
        // Lotus medallion
        ctx.globalAlpha = relAlpha * 0.55;
        ctx.fillStyle = '#c8aa78';
        ctx.beginPath();
        ctx.arc(ux + unitW * 0.5, uy + wallH * 0.45 + shadow, 8, 0, Math.PI * 2);
        ctx.fill();
        // Petals
        for (let p = 0; p < 6; p++) {
          const pa = (p / 6) * Math.PI * 2;
          ctx.fillStyle = '#d8ba88';
          ctx.beginPath();
          ctx.ellipse(
            ux + unitW * 0.5 + Math.cos(pa) * 7,
            uy + wallH * 0.45 + shadow + Math.sin(pa) * 7,
            3, 5, pa, 0, Math.PI * 2
          );
          ctx.fill();
        }
        // Highlight
        ctx.globalAlpha = relAlpha * 0.2;
        ctx.fillStyle = '#ffe8b0';
        ctx.beginPath();
        ctx.arc(ux + unitW * 0.5 - 2, uy + wallH * 0.4 + shadow - 2, 3, 0, Math.PI * 2);
        ctx.fill();
        // Dividing pilaster
        if (u < units - 1) {
          ctx.globalAlpha = relAlpha * 0.2;
          ctx.fillStyle = '#a09060';
          ctx.fillRect(ux + unitW - 3, uy, 3, wallH - 6);
        }
      }
      // Bottom ledge shadow
      ctx.globalAlpha = relAlpha * 0.3;
      ctx.fillStyle = 'rgba(40,30,10,0.4)';
      ctx.fillRect(wallX0, wallY + wallH - 4, wallW, 4);
      ctx.restore();
    }
  }

  // ── ハンピ: 巨岩の上の日向ぼっこトカゲ ──
  if (loc === 'hampi') {
    const elapsedLizard = animFrame - fieldEnterFrame;
    const lizAlpha = Math.min(1, elapsedLizard / 260) * 0.85;
    if (lizAlpha > 0) {
      ctx.save();
      // Monitor lizard basking on a large boulder
      const liz = { bx: canvas.width * 0.55, by: canvas.height * 0.56 };
      // Slow breathing movement
      const breathe = Math.sin(animFrame * 0.018) * 1.5;
      ctx.globalAlpha = lizAlpha;
      // Tail
      ctx.strokeStyle = '#6a4a20';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(liz.bx - 8, liz.by + 4);
      ctx.quadraticCurveTo(liz.bx - 22, liz.by + 8, liz.bx - 36, liz.by + 3);
      ctx.stroke();
      // Hindquarters
      ctx.fillStyle = '#7a5a28';
      ctx.beginPath();
      ctx.ellipse(liz.bx - 6, liz.by + 2 + breathe, 10, 6, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.fillStyle = '#8a6a30';
      ctx.beginPath();
      ctx.ellipse(liz.bx + 6, liz.by + breathe, 14, 7, -0.05, 0, Math.PI * 2);
      ctx.fill();
      // Body pattern (spots)
      ctx.fillStyle = 'rgba(200,180,80,0.35)';
      for (let sp = 0; sp < 5; sp++) {
        ctx.beginPath();
        ctx.ellipse(liz.bx + (sp - 2) * 5, liz.by - 2 + breathe, 2.5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Neck
      ctx.fillStyle = '#7a5a28';
      ctx.beginPath();
      ctx.ellipse(liz.bx + 18, liz.by - 3 + breathe, 7, 4.5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = '#6a4a20';
      ctx.beginPath();
      ctx.ellipse(liz.bx + 27, liz.by - 5 + breathe, 8, 4, -0.15, 0, Math.PI * 2);
      ctx.fill();
      // Eye
      ctx.fillStyle = '#ffdd00';
      ctx.beginPath();
      ctx.arc(liz.bx + 30, liz.by - 7 + breathe, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(liz.bx + 30, liz.by - 7 + breathe, 1, 0, Math.PI * 2);
      ctx.fill();
      // Front legs
      ctx.strokeStyle = '#6a4a20';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(liz.bx + 14, liz.by + 5 + breathe);
      ctx.lineTo(liz.bx + 18, liz.by + 14 + breathe);
      ctx.moveTo(liz.bx - 2, liz.by + 6 + breathe);
      ctx.lineTo(liz.bx - 4, liz.by + 15 + breathe);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 石の亀裂から湧く野草 ──
  if (loc === 'hampi') {
    const elapsedCrack = animFrame - fieldEnterFrame;
    const crackAlpha = Math.min(1, elapsedCrack / 300) * 0.8;
    if (crackAlpha > 0) {
      ctx.save();
      // Tufts of grass/weeds growing from cracks in stone
      const tufts = [
        { x: 0.08, y: 0.82, count: 5, hue: 90 },
        { x: 0.33, y: 0.79, count: 4, hue: 100 },
        { x: 0.52, y: 0.84, count: 6, hue: 85 },
        { x: 0.71, y: 0.81, count: 3, hue: 95 },
        { x: 0.88, y: 0.78, count: 5, hue: 88 },
      ];
      for (const tu of tufts) {
        const tx = canvas.width * tu.x;
        const ty = canvas.height * tu.y;
        // Crack line in stone
        ctx.globalAlpha = crackAlpha * 0.4;
        ctx.strokeStyle = '#5a4a38';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx - 8, ty + 2);
        ctx.lineTo(tx + 8, ty + 2);
        ctx.stroke();
        // Grass blades
        for (let blade = 0; blade < tu.count; blade++) {
          const bx = tx + (blade - (tu.count - 1) / 2) * 4;
          const bladeLen = 10 + blade * 2.5 + Math.sin(blade * 1.1) * 3;
          const sway = Math.sin(animFrame * 0.04 + blade * 0.7 + tu.x * 5) * 4;
          const tipX = bx + sway;
          const tipY = ty + 2 - bladeLen;
          ctx.globalAlpha = crackAlpha * (0.7 + Math.sin(blade * 0.8) * 0.2);
          ctx.strokeStyle = 'hsl(' + tu.hue + ',' + (60 + blade * 5) + '%,' + (35 + blade * 4) + '%)';
          ctx.lineWidth = 1.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(bx, ty + 2);
          ctx.quadraticCurveTo(bx + sway * 0.5, ty + 2 - bladeLen * 0.5, tipX, tipY);
          ctx.stroke();
          // Seed head for some
          if (blade % 2 === 0) {
            ctx.fillStyle = 'hsl(' + (tu.hue + 20) + ',50%,60%)';
            ctx.globalAlpha = crackAlpha * 0.5;
            ctx.beginPath();
            ctx.ellipse(tipX, tipY, 1.5, 3, sway * 0.1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の蓮池 ──
  if (loc === 'hampi') {
    const elapsedLotus = animFrame - fieldEnterFrame;
    const lotusAlpha = Math.min(1, elapsedLotus / 280) * 0.8;
    if (lotusAlpha > 0) {
      ctx.save();
      // Lotus pond in lower-right area of ruins
      const pondCX = canvas.width * 0.76;
      const pondCY = canvas.height * 0.72;
      const pondRX = 55, pondRY = 20;
      // Water surface
      ctx.globalAlpha = lotusAlpha * 0.45;
      const pondGrad = ctx.createRadialGradient(pondCX, pondCY, 0, pondCX, pondCY, pondRX);
      pondGrad.addColorStop(0, 'rgba(40,80,100,0.8)');
      pondGrad.addColorStop(0.7, 'rgba(30,60,80,0.6)');
      pondGrad.addColorStop(1, 'rgba(20,40,60,0)');
      ctx.fillStyle = pondGrad;
      ctx.beginPath();
      ctx.ellipse(pondCX, pondCY, pondRX, pondRY, 0, 0, Math.PI * 2);
      ctx.fill();
      // Lotus flowers (5)
      const lotuses = [
        { ox: 0, oy: 0, r: 7, open: 1.0, hue: 330 },
        { ox: -22, oy: -5, r: 5.5, open: 0.7, hue: 340 },
        { ox: 20, oy: 5, r: 6, open: 0.85, hue: 320 },
        { ox: -10, oy: 8, r: 4.5, open: 0.5, hue: 350 },
        { ox: 28, oy: -6, r: 4, open: 0.4, hue: 10 },
      ];
      for (const lt of lotuses) {
        const lx = pondCX + lt.ox;
        const ly = pondCY + lt.oy;
        const sway = Math.sin(animFrame * 0.02 + lt.ox * 0.1) * 1.5;
        // Lily pad
        ctx.globalAlpha = lotusAlpha * 0.7;
        ctx.fillStyle = 'rgba(30,100,40,0.75)';
        ctx.beginPath();
        ctx.ellipse(lx + sway, ly, lt.r * 1.4, lt.r * 0.8, 0.2, 0, Math.PI * 1.85);
        ctx.fill();
        // Petals
        const petalCount = 6;
        for (let p = 0; p < petalCount; p++) {
          const pA = (p / petalCount) * Math.PI * 2;
          const openR = lt.r * lt.open;
          const px = lx + sway + Math.cos(pA) * openR;
          const py = ly - lt.r * 0.4 + Math.sin(pA) * openR * 0.5;
          ctx.globalAlpha = lotusAlpha * 0.85;
          ctx.fillStyle = 'hsl(' + lt.hue + ',70%,75%)';
          ctx.beginPath();
          ctx.ellipse(px, py, lt.r * 0.38, lt.r * 0.65, pA, 0, Math.PI * 2);
          ctx.fill();
        }
        // Center stamen
        ctx.globalAlpha = lotusAlpha;
        ctx.fillStyle = 'rgba(255,220,60,0.9)';
        ctx.beginPath();
        ctx.arc(lx + sway, ly - lt.r * 0.15, lt.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟の孔雀 ──
  if (loc === 'hampi') {
    const elapsedPeacock = animFrame - fieldEnterFrame;
    const pcAlpha = Math.min(1, elapsedPeacock / 250) * 0.85;
    if (pcAlpha > 0) {
      ctx.save();
      // Peacock walks slowly left to right on a stone ledge
      const walkCycle = 280;
      const walkT = (animFrame % walkCycle) / walkCycle;
      const pcX = canvas.width * (0.1 + walkT * 0.55);
      const pcY = canvas.height * 0.62;
      const bobY = Math.sin(animFrame * 0.18) * 2;
      ctx.globalAlpha = pcAlpha;
      // Tail fan (displayed when walking slowly)
      const fanSpread = Math.min(1, elapsedPeacock / 400);
      const fanFeathers = 9;
      for (let f = 0; f < fanFeathers; f++) {
        const fanAngle = Math.PI * (0.65 + (f / (fanFeathers - 1)) * 0.7);
        const fanLen = 28 * fanSpread;
        const fx = pcX + Math.cos(fanAngle) * fanLen;
        const fy = pcY + bobY + Math.sin(fanAngle) * fanLen * 0.6 - 6;
        // Feather stem
        ctx.strokeStyle = 'rgba(20,120,80,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pcX, pcY + bobY - 4);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        // Eye spot
        const eyeHue = 180 + f * 8;
        ctx.fillStyle = 'hsl(' + eyeHue + ',70%,45%)';
        ctx.beginPath();
        ctx.arc(fx, fy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(10,60,40,0.8)';
        ctx.beginPath();
        ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Body
      ctx.fillStyle = '#1a6040';
      ctx.beginPath();
      ctx.ellipse(pcX, pcY + bobY, 10, 6, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Neck/head
      ctx.fillStyle = '#1a4080';
      ctx.beginPath();
      ctx.ellipse(pcX + 8, pcY + bobY - 10, 4, 7, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pcX + 10, pcY + bobY - 17, 4, 0, Math.PI * 2);
      ctx.fill();
      // Crest
      ctx.strokeStyle = '#40c0ff';
      ctx.lineWidth = 1;
      for (let cr = 0; cr < 3; cr++) {
        ctx.beginPath();
        ctx.moveTo(pcX + 10, pcY + bobY - 21);
        ctx.lineTo(pcX + 10 + (cr - 1) * 3, pcY + bobY - 27);
        ctx.stroke();
        ctx.fillStyle = '#40c0ff';
        ctx.beginPath();
        ctx.arc(pcX + 10 + (cr - 1) * 3, pcY + bobY - 27, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Legs
      const legSwing = Math.sin(animFrame * 0.18) * 3;
      ctx.strokeStyle = '#2a4030';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pcX - 3, pcY + bobY + 5);
      ctx.lineTo(pcX - 3 + legSwing, pcY + bobY + 13);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pcX + 3, pcY + bobY + 5);
      ctx.lineTo(pcX + 3 - legSwing, pcY + bobY + 13);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 巨石の夕影 ──
  if (loc === 'hampi') {
    const elapsedBldShadow = animFrame - fieldEnterFrame;
    const bsIn = Math.min(1, Math.max(0, (elapsedBldShadow - 1000) / 300));
    const bsOut = Math.max(0, 1 - (elapsedBldShadow - 2200) / 400);
    const bsAlpha = bsIn * bsOut * 0.5;
    if (bsAlpha > 0.005) {
      ctx.save();
      // Sun angle determines shadow direction and length
      const sunProgress = Math.min(1, (elapsedBldShadow - 1000) / 1200);
      const shadowAngle = Math.PI * (0.6 + sunProgress * 0.35); // sweeping eastward
      const shadowLen = 60 + sunProgress * 80;
      // 3 boulder shadow shapes
      const boulders = [
        { x: 0.18, y: 0.55, r: 22 },
        { x: 0.62, y: 0.48, r: 30 },
        { x: 0.85, y: 0.58, r: 18 },
      ];
      for (const bd of boulders) {
        const bx = canvas.width * bd.x;
        const by = canvas.height * bd.y;
        const shadowEndX = bx + Math.cos(shadowAngle) * shadowLen;
        const shadowEndY = by + Math.sin(shadowAngle) * shadowLen * 0.4;
        const grad = ctx.createLinearGradient(bx, by, shadowEndX, shadowEndY);
        grad.addColorStop(0, 'rgba(20,15,10,' + bsAlpha.toFixed(3) + ')');
        grad.addColorStop(0.7, 'rgba(20,15,10,' + (bsAlpha * 0.3).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(20,15,10,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(bx - bd.r * 0.4, by);
        ctx.lineTo(bx + bd.r * 0.4, by);
        ctx.lineTo(shadowEndX + bd.r * 0.15, shadowEndY);
        ctx.lineTo(shadowEndX - bd.r * 0.15, shadowEndY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 石柱の光条 ──
  if (loc === 'hampi') {
    const elapsedRay = animFrame - fieldEnterFrame;
    const rayIn = Math.min(1, Math.max(0, (elapsedRay - 200) / 300));
    const rayOut = Math.max(0, 1 - (elapsedRay - 1600) / 400);
    const rayAlpha = rayIn * rayOut * 0.45;
    if (rayAlpha > 0.005) {
      ctx.save();
      // 5 light rays streaming between stone pillars
      const rayCount = 5;
      for (let ri = 0; ri < rayCount; ri++) {
        const rayX = canvas.width * (0.12 + ri * 0.18);
        const rayTopY = 0;
        const rayBotY = canvas.height * 0.65;
        const rayW = 12 + ri * 3;
        const sway = Math.sin(animFrame * 0.012 + ri * 0.9) * 6;
        const grad = ctx.createLinearGradient(rayX, rayTopY, rayX, rayBotY);
        grad.addColorStop(0, 'rgba(255,230,160,' + (rayAlpha * 0.6).toFixed(3) + ')');
        grad.addColorStop(0.4, 'rgba(255,220,140,' + (rayAlpha * 0.35).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(rayX + sway - rayW * 0.3, rayTopY);
        ctx.lineTo(rayX + sway + rayW * 0.3, rayTopY);
        ctx.lineTo(rayX + sway * 1.4 + rayW, rayBotY);
        ctx.lineTo(rayX + sway * 1.4 - rayW, rayBotY);
        ctx.closePath();
        ctx.fill();
        // Dust motes floating in the ray
        for (let dm = 0; dm < 4; dm++) {
          const dmProgress = ((animFrame * 0.3 + ri * 40 + dm * 25) % 80) / 80;
          const dmX = rayX + sway + (Math.sin(animFrame * 0.07 + dm * 1.3) * rayW * 0.4);
          const dmY = rayTopY + dmProgress * (rayBotY - rayTopY);
          ctx.globalAlpha = rayAlpha * (1 - dmProgress) * 0.6;
          ctx.fillStyle = 'rgba(255,240,180,0.8)';
          ctx.beginPath();
          ctx.arc(dmX, dmY, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 遺跡の熱波シマー ──
  if (loc === 'hampi') {
    const elapsedShimmer = animFrame - fieldEnterFrame;
    const shimIn = Math.min(1, Math.max(0, (elapsedShimmer - 300) / 200));
    const shimOut = Math.max(0, 1 - (elapsedShimmer - 1100) / 300);
    const shimAlpha = shimIn * shimOut * 0.35;
    if (shimAlpha > 0.005) {
      ctx.save();
      const columnCount = 6;
      for (let sc = 0; sc < columnCount; sc++) {
        const colX = canvas.width * (0.1 + sc * 0.15);
        const colW = 20 + sc * 5;
        const riseSpeed = 0.5 + sc * 0.1;
        for (let row = 0; row < 5; row++) {
          const riseOffset = (animFrame * riseSpeed + row * 30 + sc * 20) % 90;
          const shimY = canvas.height * 0.75 - riseOffset * 2.5;
          const shimH = 25;
          const waviness = Math.sin(animFrame * 0.08 + sc * 0.7 + row * 0.4) * 3;
          const sGrad = ctx.createLinearGradient(0, shimY, 0, shimY - shimH);
          sGrad.addColorStop(0, 'rgba(255,220,180,0)');
          sGrad.addColorStop(0.5, 'rgba(255,235,200,' + shimAlpha.toFixed(3) + ')');
          sGrad.addColorStop(1, 'rgba(255,220,180,0)');
          ctx.fillStyle = sGrad;
          ctx.beginPath();
          ctx.ellipse(colX + waviness, shimY - shimH * 0.5, colW * 0.5, shimH * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟のコウモリ ──
  if (loc === 'hampi') {
    const elapsedBat = animFrame - fieldEnterFrame;
    if (elapsedBat >= 1000) {
      const batAlpha = Math.min(1, (elapsedBat - 1000) / 300) * 0.9;
      ctx.save();
      const batCount = 8;
      for (let bi = 0; bi < batCount; bi++) {
        const originX = canvas.width * (0.15 + (bi % 4) * 0.22);
        const originY = canvas.height * (0.25 + (bi % 3) * 0.12);
        const orbitRx = 35 + bi * 8;
        const orbitRy = 22 + bi * 5;
        const orbitSpeed = 0.022 + bi * 0.004;
        const phaseOff = bi * 1.1;
        const bx = originX + Math.cos(animFrame * orbitSpeed + phaseOff) * orbitRx
                           + Math.sin(animFrame * orbitSpeed * 0.7 + phaseOff) * orbitRx * 0.4;
        const by = originY + Math.sin(animFrame * orbitSpeed + phaseOff) * orbitRy
                           + Math.cos(animFrame * orbitSpeed * 1.3 + phaseOff * 0.5) * orbitRy * 0.5;
        const flapT = Math.sin(animFrame * 0.22 + bi * 0.8);
        const wingSpan = 8 + bi * 0.5;
        const wingDip = flapT * 6;
        ctx.globalAlpha = batAlpha * 0.85;
        ctx.fillStyle = '#2a1a3a';
        ctx.beginPath();
        ctx.ellipse(bx, by, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx - wingSpan * 0.6, by + wingDip - 2, bx - wingSpan, by + wingDip);
        ctx.quadraticCurveTo(bx - wingSpan * 0.5, by + wingDip + 4, bx, by + 3);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + wingSpan * 0.6, by + wingDip - 2, bx + wingSpan, by + wingDip);
        ctx.quadraticCurveTo(bx + wingSpan * 0.5, by + wingDip + 4, bx, by + 3);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 上空のハゲタカ ──
  if (loc === 'hampi') {
    // 廃墟の上空を2〜3羽のハゲタカが気流に乗って旋回している
    const vultures = [
      { cx: canvas.width * 0.40, cy: tileSize * 1.4, r: 55, speed: 0.010, phase: 0.0 },
      { cx: canvas.width * 0.60, cy: tileSize * 1.8, r: 45, speed: 0.013, phase: 2.1 },
      { cx: canvas.width * 0.30, cy: tileSize * 2.2, r: 35, speed: 0.016, phase: 4.2 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.52;
    for (let vi = 0; vi < vultures.length; vi++) {
      const v = vultures[vi];
      const angle = animFrame * v.speed + v.phase;
      const vx = v.cx + Math.cos(angle) * v.r;
      const vy = v.cy + Math.sin(angle) * v.r * 0.45;
      const bankAngle = Math.cos(angle) * 0.25;
      ctx.save();
      ctx.translate(vx, vy);
      ctx.rotate(bankAngle - Math.atan2(
        Math.sin(angle + 0.05) * v.r * 0.45,
        Math.cos(angle + 0.05) * v.r
      ));
      // 体（ずんぐり）
      ctx.fillStyle = '#2a1a0a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 小さな頭（ハゲタカ特有の裸の頭）
      ctx.fillStyle = '#cc4422';
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(10, -2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1a0a';
      ctx.globalAlpha = 0.52;
      // 翼（広く、指状に広がる）— 上昇気流に乗って平らに
      const tiltWing = Math.sin(angle * 2) * 0.06;
      // 左翼
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8, -12 + tiltWing * 10, -35, -8 + tiltWing * 15);
      ctx.quadraticCurveTo(-26, -2, -14, 3);
      ctx.closePath();
      ctx.fill();
      // 右翼
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8, 12 - tiltWing * 10, -35, 8 - tiltWing * 15);
      ctx.quadraticCurveTo(-26, 2, -14, 3);
      ctx.closePath();
      ctx.fill();
      // 翼端の羽根（3〜4本）
      ctx.strokeStyle = '#1a1008';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.38;
      for (let fi = 0; fi < 4; fi++) {
        const ft = fi / 3;
        ctx.beginPath();
        ctx.moveTo(-28 - ft * 7, -7 + tiltWing * 12 + ft * 1.5);
        ctx.lineTo(-30 - ft * 9, -10 + tiltWing * 14 + ft * 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-28 - ft * 7, 7 - tiltWing * 12 + ft * 1.5);
        ctx.lineTo(-30 - ft * 9, 10 - tiltWing * 14 + ft * 3);
        ctx.stroke();
      }
      // 尾羽（扇型）
      ctx.fillStyle = '#2a1a0a';
      ctx.globalAlpha = 0.50;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-20, -5);
      ctx.lineTo(-22, 0);
      ctx.lineTo(-20, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── ハンピ: 黄金の廊下 ──
  if (loc === 'hampi') {
    // ゴールデンアワー（elapsed 500-1400）: 石柱が作る廊下に黄金色の影が交互に並ぶ
    const elapsedHall = animFrame - fieldEnterFrame;
    if (elapsedHall >= 400 && elapsedHall <= 1500) {
      const hallT = elapsedHall < 900
        ? (elapsedHall - 400) / 500
        : 1 - (elapsedHall - 900) / 600;
      const hallAlpha = Math.max(0, hallT) * 0.38;
      // 石柱の影（床に斜めに伸びる）
      const columns103 = [
        canvas.width * 0.14, canvas.width * 0.30,
        canvas.width * 0.46, canvas.width * 0.62,
        canvas.width * 0.78,
      ];
      ctx.save();
      // 床の黄金色の光（廊下全体）
      const hallGrad = ctx.createLinearGradient(0, tileSize * 7, 0, tileSize * 9);
      hallGrad.addColorStop(0, `rgba(255,200,80,${hallAlpha * 0.6})`);
      hallGrad.addColorStop(1, `rgba(255,160,20,${hallAlpha * 0.2})`);
      ctx.fillStyle = hallGrad;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.rect(0, tileSize * 7, canvas.width, tileSize * 2);
      ctx.fill();
      // 各柱の影
      for (let ci = 0; ci < columns103.length; ci++) {
        const cx = columns103[ci];
        const colW = 10;
        const shadowLen = 70 * hallT;
        // 影（右斜め下へ伸びる台形）
        ctx.globalAlpha = hallAlpha * 0.60;
        ctx.fillStyle = 'rgba(40,25,10,0.5)';
        ctx.beginPath();
        ctx.moveTo(cx - colW / 2, tileSize * 8.5);
        ctx.lineTo(cx + colW / 2, tileSize * 8.5);
        ctx.lineTo(cx + colW / 2 + shadowLen * 0.4, tileSize * 8.5 + shadowLen * 0.4);
        ctx.lineTo(cx - colW / 2 + shadowLen * 0.4, tileSize * 8.5 + shadowLen * 0.4);
        ctx.closePath();
        ctx.fill();
        // 光の筋（柱と柱の間）
        if (ci < columns103.length - 1) {
          const nextCx = columns103[ci + 1];
          const lightGrad = ctx.createLinearGradient(cx + colW / 2, tileSize * 7, nextCx - colW / 2, tileSize * 9);
          lightGrad.addColorStop(0, `rgba(255,210,100,${hallAlpha * 0.35})`);
          lightGrad.addColorStop(1, `rgba(255,180,50,${hallAlpha * 0.10})`);
          ctx.fillStyle = lightGrad;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.rect(cx + colW / 2, tileSize * 7, nextCx - cx - colW, tileSize * 2);
          ctx.fill();
        }
      }
      // 床の石畳の反射（水平線）
      ctx.globalAlpha = hallAlpha * 0.25;
      ctx.strokeStyle = 'rgba(255,200,80,0.5)';
      ctx.lineWidth = 0.8;
      for (let row = 0; row < 4; row++) {
        const ry = tileSize * 7.5 + row * tileSize * 0.35;
        ctx.beginPath();
        ctx.moveTo(0, ry);
        ctx.lineTo(canvas.width, ry);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 夜の松明 ──
  if (loc === 'hampi') {
    // elapsed > 1500: 石柱の基部に松明が灯り、暗闇を照らす
    const elapsedTorch = animFrame - fieldEnterFrame;
    if (elapsedTorch > 1400) {
      const torchAlpha = Math.min(1, (elapsedTorch - 1400) / 300) * 0.75;
      const torchPositions = [
        canvas.width * 0.18, canvas.width * 0.38,
        canvas.width * 0.58, canvas.width * 0.78,
      ];
      ctx.save();
      for (let ti = 0; ti < torchPositions.length; ti++) {
        const tx = torchPositions[ti];
        const ty = tileSize * 8.0;
        const fFlicker = Math.sin(animFrame * 0.12 + ti * 1.8) * 2;
        const fFlicker2 = Math.sin(animFrame * 0.09 + ti * 1.1) * 1.5;
        // 松明の棒
        ctx.globalAlpha = torchAlpha * 0.70;
        ctx.strokeStyle = '#5a3010';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + 2, ty - 20);
        ctx.stroke();
        // 松明の頭（燃える部分）
        ctx.fillStyle = '#4a2808';
        ctx.beginPath();
        ctx.rect(tx - 3, ty - 26, 10, 8);
        ctx.fill();
        // 炎のグロー
        ctx.globalAlpha = torchAlpha * 0.30;
        const glowGrad = ctx.createRadialGradient(tx + 2, ty - 28, 0, tx + 2, ty - 28, 25);
        glowGrad.addColorStop(0, 'rgba(255,160,30,0.8)');
        glowGrad.addColorStop(0.4, 'rgba(255,100,0,0.4)');
        glowGrad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(tx + 2, ty - 28, 25, 0, Math.PI * 2);
        ctx.fill();
        // 炎
        ctx.globalAlpha = torchAlpha * 0.85;
        ctx.fillStyle = '#ff8800';
        ctx.beginPath();
        ctx.moveTo(tx - 1, ty - 26);
        ctx.lineTo(tx + 2 + fFlicker, ty - 38 - fFlicker2);
        ctx.lineTo(tx + 8, ty - 26);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffcc44';
        ctx.globalAlpha = torchAlpha * 0.70;
        ctx.beginPath();
        ctx.moveTo(tx + 1, ty - 26);
        ctx.lineTo(tx + 2 + fFlicker * 0.5, ty - 34 - fFlicker2 * 0.6);
        ctx.lineTo(tx + 6, ty - 26);
        ctx.closePath();
        ctx.fill();
        // 地面への光の投影
        ctx.globalAlpha = torchAlpha * 0.12;
        const groundGrad = ctx.createRadialGradient(tx + 2, ty, 0, tx + 2, ty, 20);
        groundGrad.addColorStop(0, 'rgba(255,140,20,0.6)');
        groundGrad.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = groundGrad;
        ctx.beginPath();
        ctx.ellipse(tx + 2, ty + 2, 20, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // 煙（炎の上）
        ctx.globalAlpha = torchAlpha * 0.15;
        ctx.fillStyle = '#886644';
        for (let si = 0; si < 3; si++) {
          const smokeAge = (animFrame * 0.6 + ti * 20 + si * 12) % 40;
          const sx = tx + 2 + Math.sin(smokeAge * 0.2 + ti * 1.1) * 4;
          const sy2 = ty - 40 - smokeAge * 0.8;
          ctx.beginPath();
          ctx.arc(sx, sy2, 2 + smokeAge * 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.lineCap = 'butt';
      ctx.restore();
    }
  }

  // ── ハンピ: ナンディ像 ──
  if (loc === 'hampi') {
    // 寺院の正面に鎮座するナンディ（聖なる雄牛）の石像
    const nX = canvas.width * 0.48;
    const nY = tileSize * 7.2;
    ctx.save();
    ctx.globalAlpha = 0.55;
    // 台座（石の基壇）
    ctx.fillStyle = '#7a6a50';
    ctx.beginPath();
    ctx.rect(nX - 24, nY + 8, 48, 12);
    ctx.fill();
    ctx.fillStyle = '#5a5040';
    ctx.beginPath();
    ctx.rect(nX - 20, nY + 4, 40, 6);
    ctx.fill();
    // 台座の装飾（縦の溝）
    ctx.strokeStyle = '#4a4030';
    ctx.lineWidth = 0.8;
    for (let gi = -2; gi <= 2; gi++) {
      ctx.beginPath();
      ctx.moveTo(nX + gi * 9, nY + 4);
      ctx.lineTo(nX + gi * 9, nY + 20);
      ctx.stroke();
    }
    // 胴体（大きな横長の体）
    ctx.fillStyle = '#8a7a60';
    ctx.beginPath();
    ctx.ellipse(nX, nY - 4, 20, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // こぶ（ゼブのこぶ）
    ctx.fillStyle = '#9a8a70';
    ctx.beginPath();
    ctx.ellipse(nX - 5, nY - 14, 9, 7, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 首
    ctx.beginPath();
    ctx.ellipse(nX + 14, nY - 8, 10, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // 頭（横を向いている）
    ctx.beginPath();
    ctx.ellipse(nX + 23, nY - 10, 10, 8, -0.1, 0, Math.PI * 2);
    ctx.fill();
    // 鼻面
    ctx.fillStyle = '#7a6a50';
    ctx.beginPath();
    ctx.ellipse(nX + 32, nY - 8, 7, 5, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // 角（後ろへ曲がる）
    ctx.strokeStyle = '#5a5040';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(nX + 20, nY - 16);
    ctx.quadraticCurveTo(nX + 14, nY - 26, nX + 8, nY - 22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nX + 24, nY - 16);
    ctx.quadraticCurveTo(nX + 18, nY - 27, nX + 12, nY - 24);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 耳
    ctx.fillStyle = '#8a7a60';
    ctx.beginPath();
    ctx.ellipse(nX + 17, nY - 18, 5, 4, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // 目
    ctx.fillStyle = '#2a2018';
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(nX + 26, nY - 12, 2, 0, Math.PI * 2);
    ctx.fill();
    // 脚（4本、折り曲げて座っている）
    ctx.fillStyle = '#8a7a60';
    ctx.globalAlpha = 0.50;
    const legs101 = [-14, -4, 6, 16];
    for (const lx of legs101) {
      ctx.beginPath();
      ctx.rect(nX + lx, nY + 8, 7, 8);
      ctx.fill();
      ctx.fillStyle = '#6a5a40';
      ctx.beginPath();
      ctx.ellipse(nX + lx + 3.5, nY + 15, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a7a60';
    }
    // しっぽ（右側に巻く）
    ctx.strokeStyle = '#7a6a50';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(nX - 19, nY - 2);
    ctx.quadraticCurveTo(nX - 28, nY + 4, nX - 26, nY + 12);
    ctx.stroke();
    // 首のカウベル（飾り）
    ctx.fillStyle = '#cc9930';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(nX + 18, nY - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6010';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── ハンピ: サギの飛行編隊（v100記念） ──
  if (loc === 'hampi') {
    // V字編隊を組んだサギの群れが廃墟の上空を渡っていく
    const flockCycle = 700;
    const fp = animFrame % flockCycle;
    const ft = fp / flockCycle;
    // 右から左へ弧を描いて渡る
    const leadX = canvas.width * 1.1 - ft * (canvas.width * 1.4);
    const leadY = tileSize * 2.2 + Math.sin(ft * Math.PI) * tileSize * 0.8;
    // V字編隊（リーダー+左右各4羽）
    const formation = [
      { offX:  0, offY:  0, delay:  0 }, // リーダー
      { offX: -20, offY: 10, delay: 4 },  { offX:  20, offY: 10, delay: 4 },
      { offX: -40, offY: 20, delay: 8 },  { offX:  40, offY: 20, delay: 8 },
      { offX: -60, offY: 30, delay: 12 }, { offX:  60, offY: 30, delay: 12 },
      { offX: -80, offY: 40, delay: 16 }, { offX:  80, offY: 40, delay: 16 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.60;
    for (let bi = 0; bi < formation.length; bi++) {
      const { offX, offY, delay } = formation[bi];
      const bx = leadX + offX;
      const by = leadY + offY;
      // 翼ばたき（各羽がわずかにずれる）
      const wingFlap = Math.sin(animFrame * 0.15 + delay * 0.1) * 7;
      ctx.save();
      ctx.translate(bx, by);
      ctx.fillStyle = '#2a3020';
      ctx.strokeStyle = '#1a2010';
      // 体（細長い楕円）
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // 首と頭
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.quadraticCurveTo(14, -4, 18, -2);
      ctx.lineTo(17, 1);
      ctx.quadraticCurveTo(13, 0, 9, 2);
      ctx.closePath();
      ctx.fill();
      // くちばし（細長い）
      ctx.fillStyle = '#aa8820';
      ctx.beginPath();
      ctx.moveTo(18, -1);
      ctx.lineTo(26, -0.5);
      ctx.lineTo(18, 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a3020';
      // 左翼
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8, -10 + wingFlap, -26, -7 + wingFlap);
      ctx.quadraticCurveTo(-18, -2, -8, 2);
      ctx.closePath();
      ctx.fill();
      // 右翼
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8, 10 - wingFlap, -26, 7 - wingFlap);
      ctx.quadraticCurveTo(-18, 2, -8, 2);
      ctx.closePath();
      ctx.fill();
      // 尾羽
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-18, -2);
      ctx.lineTo(-18, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── ハンピ: 石段を流れる砂 ──
  if (loc === 'hampi') {
    // 古代の石段の縁から砂がさらさらと流れ落ちる
    const sandStreams = [
      { x: canvas.width * 0.22, startY: tileSize * 5.0, endY: tileSize * 8.5 },
      { x: canvas.width * 0.42, startY: tileSize * 4.5, endY: tileSize * 8.5 },
      { x: canvas.width * 0.62, startY: tileSize * 5.2, endY: tileSize * 8.5 },
    ];
    ctx.save();
    for (let si = 0; si < sandStreams.length; si++) {
      const { x, startY, endY } = sandStreams[si];
      const streamLen = endY - startY;
      // 砂の流れ（細いグラデーション帯）
      const sandGrad = ctx.createLinearGradient(x, startY, x, endY);
      sandGrad.addColorStop(0, 'rgba(200,180,120,0)');
      sandGrad.addColorStop(0.2, `rgba(200,180,120,0.30)`);
      sandGrad.addColorStop(0.8, `rgba(180,150,90,0.25)`);
      sandGrad.addColorStop(1, 'rgba(180,150,90,0)');
      ctx.fillStyle = sandGrad;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.rect(x - 2, startY, 4, streamLen);
      ctx.fill();
      // 流れる砂粒（パーティクル）
      ctx.fillStyle = '#c8a860';
      for (let pi = 0; pi < 10; pi++) {
        const particleOffset = (animFrame * 1.4 + si * 20 + pi * 24) % streamLen;
        const px = x + Math.sin(pi * 1.1 + animFrame * 0.02) * 3;
        const py = startY + particleOffset;
        const particleAlpha = Math.sin(particleOffset / streamLen * Math.PI) * 0.6;
        ctx.globalAlpha = particleAlpha;
        ctx.beginPath();
        ctx.arc(px, py, 1 + (pi % 2) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // 堆積した砂（下端）
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#c8a060';
      ctx.beginPath();
      ctx.ellipse(x, endY, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 石段の横の砂の線（横方向の積もり）
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#b89050';
    ctx.lineWidth = 1.5;
    for (let row = 5; row <= 8; row++) {
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.15, tileSize * row + tileSize - 2);
      ctx.lineTo(canvas.width * 0.75, tileSize * row + tileSize - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: 廃墟の満月 ──
  if (loc === 'hampi') {
    // elapsed > 1600: 夜に満月が廃墟の上空に浮かぶ
    const elapsedMoon = animFrame - fieldEnterFrame;
    if (elapsedMoon > 1500) {
      const moonAlpha = Math.min(1, (elapsedMoon - 1500) / 300) * 0.65;
      const moonX = canvas.width * 0.75;
      const moonY = tileSize * 1.0 + Math.sin(animFrame * 0.003) * 3;
      ctx.save();
      ctx.globalAlpha = moonAlpha;
      // 月のグロー
      const glowGrad = ctx.createRadialGradient(moonX, moonY, 12, moonX, moonY, 45);
      glowGrad.addColorStop(0,   'rgba(240,235,200,0.5)');
      glowGrad.addColorStop(0.4, 'rgba(220,215,180,0.2)');
      glowGrad.addColorStop(1,   'rgba(200,195,160,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 45, 0, Math.PI * 2);
      ctx.fill();
      // 月本体
      const moonGrad = ctx.createRadialGradient(moonX - 4, moonY - 4, 2, moonX, moonY, 16);
      moonGrad.addColorStop(0,   'rgba(255,252,220,0.95)');
      moonGrad.addColorStop(0.6, 'rgba(240,235,190,0.90)');
      moonGrad.addColorStop(1,   'rgba(220,210,160,0.85)');
      ctx.fillStyle = moonGrad;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 16, 0, Math.PI * 2);
      ctx.fill();
      // クレーター
      ctx.fillStyle = 'rgba(180,170,130,0.25)';
      ctx.beginPath();
      ctx.arc(moonX + 5, moonY - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(moonX - 5, moonY + 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(moonX + 2, moonY + 8, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // 廃墟の石柱への月光投影（白い縦シャドウ）
      const colPositions = [
        canvas.width * 0.18, canvas.width * 0.38, canvas.width * 0.58
      ];
      ctx.globalAlpha = moonAlpha * 0.18;
      for (const cx of colPositions) {
        const moonLightGrad = ctx.createLinearGradient(cx, tileSize * 3, cx, tileSize * 9);
        moonLightGrad.addColorStop(0, 'rgba(240,235,200,0.6)');
        moonLightGrad.addColorStop(1, 'rgba(240,235,200,0)');
        ctx.fillStyle = moonLightGrad;
        ctx.beginPath();
        ctx.rect(cx - 5, tileSize * 3, 10, tileSize * 6);
        ctx.fill();
      }
      // 星（月に近い明るい星）
      ctx.globalAlpha = moonAlpha * 0.60;
      ctx.fillStyle = '#e8e4d0';
      const stars98 = [[moonX + 35, moonY - 20], [moonX - 40, moonY + 15],
                       [moonX + 55, moonY + 10], [moonX - 25, moonY - 35]];
      for (const [sx, sy] of stars98) {
        const starBlink = (Math.sin(animFrame * 0.05 + sx * 0.1) + 1) / 2;
        ctx.globalAlpha = moonAlpha * 0.50 * starBlink;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 石の間から湧く泉 ──
  if (loc === 'hampi') {
    // 古代の石組みの合間から清水が湧き出し、小さな水溜まりを作る
    const springX = canvas.width * 0.30;
    const springY = tileSize * 8.8;
    ctx.save();
    // 石組み（泉を囲む）
    ctx.fillStyle = '#6a5a40';
    ctx.globalAlpha = 0.55;
    const stones = [
      { x: -18, y: -4, w: 14, h: 8 }, { x:  5, y: -5, w: 16, h: 9 },
      { x: -12, y:  5, w: 10, h: 7 }, { x:  2, y:  5, w: 12, h: 7 },
    ];
    for (const s of stones) {
      ctx.beginPath();
      ctx.rect(springX + s.x, springY + s.y, s.w, s.h);
      ctx.fill();
      ctx.strokeStyle = '#4a3a28';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    // 水溜まり（楕円形）
    const rippleT = (animFrame % 80) / 80;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#4488cc';
    ctx.beginPath();
    ctx.ellipse(springX, springY + 2, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // 水面の揺らめき
    ctx.strokeStyle = '#88bbee';
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.40;
    for (let ri = 1; ri <= 3; ri++) {
      const rr = ri * 3 + rippleT * 5;
      ctx.beginPath();
      ctx.ellipse(springX, springY + 2, rr, rr * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 湧き出る気泡
    ctx.fillStyle = '#aaddff';
    ctx.globalAlpha = 0.60;
    for (let bi = 0; bi < 5; bi++) {
      const bubT = (animFrame * 0.8 + bi * 16) % 40;
      const bx = springX + (bi % 3 - 1) * 3;
      const by = springY + 2 - bubT * 0.2;
      if (bubT < 35) {
        ctx.beginPath();
        ctx.arc(bx, by, 1.2 + (bi % 2) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 水の流れ（小川として広がる）
    ctx.strokeStyle = '#4488cc';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.30;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(springX, springY + 8);
    ctx.quadraticCurveTo(springX + 15, springY + 14, springX + 28, springY + 12);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(springX, springY + 8);
    ctx.quadraticCurveTo(springX - 12, springY + 13, springX - 20, springY + 11);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── ハンピ: 廃墟の虹 ──
  if (loc === 'hampi') {
    // 雨上がり（elapsed 600-1100）: 廃墟の上空に7色の虹が現れる
    const elapsedRain = animFrame - fieldEnterFrame;
    if (elapsedRain >= 500 && elapsedRain <= 1200) {
      const rainT = elapsedRain < 800
        ? (elapsedRain - 500) / 300
        : 1 - (elapsedRain - 800) / 400;
      const rainAlpha = Math.max(0, rainT) * 0.40;
      // 虹の中心（画面左中央あたりに半円）
      const rcX = canvas.width * 0.40;
      const rcY = tileSize * 9; // 地平線
      const rainbowColors = [
        '#ff2200', '#ff8800', '#ffee00',
        '#00cc22', '#0066ff', '#4400cc', '#8800cc'
      ];
      ctx.save();
      for (let ri = 0; ri < 7; ri++) {
        const radius = 120 + ri * 14;
        const grad = ctx.createRadialGradient(rcX, rcY, radius - 7, rcX, rcY, radius + 7);
        grad.addColorStop(0,   'rgba(0,0,0,0)');
        grad.addColorStop(0.3, rainbowColors[ri].replace('#', 'rgba(').split('rgba(').join('rgba(') + '00');
        // parse hex color to rgba
        const hex = rainbowColors[ri];
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        grad.addColorStop(0,   `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.35, `rgba(${r},${g},${b},${rainAlpha * 0.8})`);
        grad.addColorStop(0.5,  `rgba(${r},${g},${b},${rainAlpha})`);
        grad.addColorStop(0.65, `rgba(${r},${g},${b},${rainAlpha * 0.8})`);
        grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.globalAlpha = 1;
        // 上半円のみ描画
        ctx.beginPath();
        ctx.arc(rcX, rcY, radius, Math.PI, Math.PI * 2);
        ctx.lineTo(rcX + radius, rcY);
        ctx.lineTo(rcX - radius, rcY);
        ctx.closePath();
        ctx.fill();
      }
      // 霧雨の名残（細かい粒）
      ctx.globalAlpha = rainAlpha * 0.3;
      ctx.fillStyle = '#aaccee';
      for (let di = 0; di < 15; di++) {
        const driftX = ((di * 47 + animFrame * 1.2) % canvas.width);
        const driftY = ((di * 31 + animFrame * 2.5) % (tileSize * 5)) + tileSize * 4;
        ctx.beginPath();
        ctx.arc(driftX, driftY, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 石段のオオトカゲ ──
  if (loc === 'hampi') {
    // 古代の石段を大きなオオトカゲ（モニターリザード）がゆっくり横切る
    const lizCycle = 600;
    const lp = animFrame % lizCycle;
    const lt = lp / lizCycle;
    const lizX = -40 + lt * (canvas.width + 80);
    const lizY = tileSize * 7.2;
    const bodyWave = Math.sin(animFrame * 0.08) * 4; // 体の横揺れ
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#3a4a28';
    ctx.strokeStyle = '#2a3a18';
    // しっぽ（細長い、体の後ろ1/2）
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lizX - 25, lizY + bodyWave);
    ctx.quadraticCurveTo(lizX - 50, lizY + bodyWave * 0.5, lizX - 70, lizY - bodyWave * 0.5);
    ctx.stroke();
    // 胴体
    ctx.beginPath();
    ctx.ellipse(lizX, lizY + bodyWave * 0.3, 22, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // 首
    ctx.beginPath();
    ctx.ellipse(lizX + 20, lizY - 2 + bodyWave * 0.2, 10, 5.5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // 頭（三角形気味）
    ctx.beginPath();
    ctx.moveTo(lizX + 28, lizY - 5);
    ctx.lineTo(lizX + 44, lizY - 2);
    ctx.lineTo(lizX + 44, lizY + 2);
    ctx.lineTo(lizX + 28, lizY + 2);
    ctx.closePath();
    ctx.fill();
    // 目
    ctx.fillStyle = '#aacc00';
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(lizX + 40, lizY - 2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(lizX + 40.5, lizY - 2, 1, 0, Math.PI * 2);
    ctx.fill();
    // 舌（二股）
    ctx.strokeStyle = '#cc2222';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.60;
    const tongueDart = Math.sin(animFrame * 0.12) * 2;
    ctx.beginPath();
    ctx.moveTo(lizX + 44, lizY);
    ctx.lineTo(lizX + 50 + tongueDart, lizY - 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lizX + 50 + tongueDart, lizY - 1);
    ctx.lineTo(lizX + 54 + tongueDart, lizY - 3);
    ctx.moveTo(lizX + 50 + tongueDart, lizY - 1);
    ctx.lineTo(lizX + 54 + tongueDart, lizY + 1);
    ctx.stroke();
    // 脚（4本、歩行アニメ）
    ctx.fillStyle = '#3a4a28';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#3a4a28';
    const legPairs = [
      { x: lizX - 12, side: 1 },
      { x: lizX + 6,  side: -1 },
    ];
    for (const leg of legPairs) {
      const legSwing = Math.sin(animFrame * 0.08 + leg.x * 0.1) * 8;
      // 前脚
      ctx.beginPath();
      ctx.moveTo(leg.x, lizY + 5);
      ctx.lineTo(leg.x + leg.side * 8 + legSwing, lizY + 14);
      ctx.stroke();
      // 後脚
      ctx.beginPath();
      ctx.moveTo(leg.x, lizY + 5);
      ctx.lineTo(leg.x - leg.side * 8 - legSwing, lizY + 14);
      ctx.stroke();
    }
    // 体の模様（黄色い斑点）
    ctx.fillStyle = '#aa9930';
    ctx.globalAlpha = 0.40;
    for (let si = 0; si < 5; si++) {
      ctx.beginPath();
      ctx.arc(lizX - 14 + si * 7, lizY + bodyWave * 0.3 + (si % 2) * 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ハンピ: 遺跡で休む水牛 ──
  if (loc === 'hampi') {
    // 廃墟の日陰で大きな水牛が休んでいる
    const bufX = canvas.width * 0.72;
    const bufY = tileSize * 7.8;
    const breathe = Math.sin(animFrame * 0.018) * 1.5; // 呼吸
    const earFlick = Math.sin(animFrame * 0.045) * 0.15;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1a1008';
    // 胴体（大きな横長楕円）
    ctx.beginPath();
    ctx.ellipse(bufX, bufY + breathe * 0.5, 36, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // 首
    ctx.beginPath();
    ctx.ellipse(bufX + 30, bufY - 8 + breathe * 0.3, 14, 12, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.ellipse(bufX + 42, bufY - 5, 12, 10, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // 鼻面
    ctx.fillStyle = '#2a2018';
    ctx.beginPath();
    ctx.ellipse(bufX + 53, bufY - 2, 8, 6, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // 鼻孔
    ctx.fillStyle = '#3a3028';
    ctx.globalAlpha = 0.50;
    ctx.beginPath();
    ctx.arc(bufX + 56, bufY - 4, 1.5, 0, Math.PI * 2);
    ctx.arc(bufX + 56, bufY, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // 角（大きく反り返った黒い角）
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#0a0a00';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bufX + 38, bufY - 13);
    ctx.quadraticCurveTo(bufX + 28, bufY - 30, bufX + 18, bufY - 22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bufX + 44, bufY - 13);
    ctx.quadraticCurveTo(bufX + 54, bufY - 30, bufX + 62, bufY - 22);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 耳
    ctx.fillStyle = '#1a1008';
    ctx.save();
    ctx.translate(bufX + 38, bufY - 8);
    ctx.rotate(earFlick);
    ctx.beginPath();
    ctx.ellipse(-5, -8, 5, 8, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 足（4本）
    ctx.fillStyle = '#1a1008';
    ctx.globalAlpha = 0.50;
    const legs = [-22, -8, 8, 22];
    for (const lx of legs) {
      ctx.beginPath();
      ctx.rect(bufX + lx - 4, bufY + 16, 8, 14);
      ctx.fill();
      // 蹄
      ctx.fillStyle = '#0a0a00';
      ctx.beginPath();
      ctx.rect(bufX + lx - 4, bufY + 28, 8, 4);
      ctx.fill();
      ctx.fillStyle = '#1a1008';
    }
    // しっぽ（振る）
    ctx.strokeStyle = '#1a1008';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.50;
    const tailSwing = Math.sin(animFrame * 0.035) * 12;
    ctx.beginPath();
    ctx.moveTo(bufX - 35, bufY - 2);
    ctx.quadraticCurveTo(bufX - 44, bufY + 5, bufX - 42 + tailSwing, bufY + 14);
    ctx.stroke();
    // しっぽの先の房
    ctx.fillStyle = '#2a1808';
    ctx.beginPath();
    ctx.ellipse(bufX - 42 + tailSwing, bufY + 16, 4, 3, tailSwing * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // 地面の影
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(bufX, bufY + 28, 40, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── ハンピ: 蓮池のカエル ──
  if (loc === 'hampi') {
    // 寺院の蓮池（池はrow=11付近）にカエルが1匹、荷葉の上で鳴く
    const frogX = canvas.width * 0.52;
    const frogY = tileSize * 11.5;
    const croakCycle = 300;
    const fp = animFrame % croakCycle;
    const isCroaking = fp < 50;
    const croak = isCroaking ? Math.sin((fp / 50) * Math.PI) : 0;
    ctx.save();
    ctx.globalAlpha = 0.62;
    // 荷葉（大きな円形の葉）
    ctx.fillStyle = '#2a8a28';
    ctx.beginPath();
    ctx.ellipse(frogX + 3, frogY + 4, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // 荷葉の葉脈
    ctx.strokeStyle = '#1a6a18';
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.45;
    for (let vein = 0; vein < 7; vein++) {
      const va = -Math.PI * 0.5 + (vein / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(frogX + 3, frogY + 4);
      ctx.lineTo(frogX + 3 + Math.cos(va) * 18, frogY + 4 + Math.sin(va) * 12);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.62;
    // カエルの体（緑の丸い体）
    ctx.fillStyle = '#3aaa28';
    ctx.beginPath();
    ctx.ellipse(frogX, frogY - 1, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // お腹（白っぽい）
    ctx.fillStyle = '#cceeaa';
    ctx.globalAlpha = 0.50;
    ctx.beginPath();
    ctx.ellipse(frogX, frogY + 1, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.62;
    // 目（大きく出っ張った目）
    ctx.fillStyle = '#1a5a10';
    ctx.beginPath();
    ctx.arc(frogX - 4, frogY - 5, 3.5, 0, Math.PI * 2);
    ctx.arc(frogX + 4, frogY - 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(frogX - 4, frogY - 5, 1.8, 0, Math.PI * 2);
    ctx.arc(frogX + 4, frogY - 5, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(frogX - 3.2, frogY - 5.8, 0.7, 0, Math.PI * 2);
    ctx.arc(frogX + 4.8, frogY - 5.8, 0.7, 0, Math.PI * 2);
    ctx.fill();
    // 鳴き袋（鳴くとき膨らむ）
    if (isCroaking) {
      ctx.fillStyle = '#5acc38';
      ctx.globalAlpha = 0.55 * croak;
      ctx.beginPath();
      ctx.ellipse(frogX, frogY + 3, 7 + croak * 4, 6 + croak * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 後ろ足
    ctx.strokeStyle = '#2a8818';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.58;
    ctx.beginPath();
    ctx.moveTo(frogX - 7, frogY + 2);
    ctx.lineTo(frogX - 12, frogY + 7);
    ctx.lineTo(frogX - 16, frogY + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(frogX + 7, frogY + 2);
    ctx.lineTo(frogX + 12, frogY + 7);
    ctx.lineTo(frogX + 16, frogY + 5);
    ctx.stroke();
    // 波紋（鳴くとき）
    if (isCroaking) {
      ctx.globalAlpha = 0.20 * croak;
      ctx.strokeStyle = '#88cc88';
      ctx.lineWidth = 0.8;
      for (let ri = 1; ri <= 2; ri++) {
        ctx.beginPath();
        ctx.ellipse(frogX, frogY + 6, ri * 10, ri * 4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── ハンピ: 砂埃の竜巻 ──
  if (loc === 'hampi') {
    // 廃墟の広場に小さな砂埃の竜巻（ダストデビル）が発生する
    const dustCycle = 480;
    const dp = animFrame % dustCycle;
    const dustAlive = dp < 380;
    if (dustAlive) {
      const growT = dp < 80  ? dp / 80  : 1;
      const fadeT = dp > 300 ? 1 - (dp - 300) / 80 : 1;
      const life  = growT * fadeT;
      // 中心位置（ゆっくり左に流れる）
      const dCenterX = canvas.width * 0.60 - dp * 0.15;
      const dCenterY = tileSize * 6.5;
      ctx.save();
      // 砂埃の螺旋（複数の楕円を積み上げる）
      for (let layer = 0; layer < 8; layer++) {
        const t = layer / 7;
        const layerY = dCenterY - t * 55 * life;
        const width  = (1 - t * 0.6) * 14 * life;
        const height = 6 * life;
        const spin   = animFrame * 0.12 + layer * 0.4;
        const offX   = Math.sin(spin) * width * 0.3;
        ctx.globalAlpha = (1 - t) * 0.30 * life;
        ctx.fillStyle = '#c8a060';
        ctx.beginPath();
        ctx.ellipse(dCenterX + offX, layerY, width, height, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 地面の埃（根元の広がり）
      ctx.globalAlpha = 0.25 * life;
      ctx.fillStyle = '#b89050';
      ctx.beginPath();
      ctx.ellipse(dCenterX, dCenterY + 4, 20 * life, 6 * life, 0, 0, Math.PI * 2);
      ctx.fill();
      // 砂粒パーティクル
      ctx.fillStyle = '#ddbb70';
      for (let pi = 0; pi < 12; pi++) {
        const pAngle = (animFrame * 0.15 + pi * 0.52) % (Math.PI * 2);
        const pR = (8 + pi % 4 * 5) * life;
        const pY = dCenterY - (pi % 5) * 10 * life;
        const px = dCenterX + Math.cos(pAngle) * pR;
        ctx.globalAlpha = 0.40 * life * (1 - pi / 12 * 0.5);
        ctx.beginPath();
        ctx.arc(px, pY, 1.2 + (pi % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 夕日の光条 ──
  if (loc === 'hampi') {
    // ゴールデンアワー（elapsed 400-1800）: 石柱の隙間から差し込む光の帯
    const elapsedGod = animFrame - fieldEnterFrame;
    if (elapsedGod >= 400 && elapsedGod <= 1800) {
      const godT = elapsedGod < 1000
        ? (elapsedGod - 400) / 600
        : 1 - (elapsedGod - 1000) / 800;
      const godAlpha = godT * 0.22;
      // 光源は画面右上（夕日）
      const sunX = canvas.width * 0.88;
      const sunY = tileSize * 1.5;
      // 5本の光条
      const rayAngles = [0.55, 0.68, 0.80, 0.95, 1.10]; // ラジアン（下左方向）
      ctx.save();
      for (let ri = 0; ri < rayAngles.length; ri++) {
        const ang = rayAngles[ri];
        const rayLen = canvas.width * 1.2;
        const rayWidth = 20 + ri * 8;
        const endX = sunX + Math.cos(Math.PI * 0.5 + ang) * rayLen;
        const endY = sunY + Math.sin(Math.PI * 0.5 + ang) * rayLen;
        // 光条のグラデーション（根元ほど明るい）
        const rayGrad = ctx.createLinearGradient(sunX, sunY, endX, endY);
        const col = `rgba(255,200,80,${godAlpha})`;
        rayGrad.addColorStop(0,   col);
        rayGrad.addColorStop(0.4, `rgba(255,200,80,${godAlpha * 0.5})`);
        rayGrad.addColorStop(1,   'rgba(255,200,80,0)');
        ctx.fillStyle = rayGrad;
        // 台形の帯
        const perpX = Math.cos(Math.PI * 0.5 + ang + Math.PI / 2);
        const perpY = Math.sin(Math.PI * 0.5 + ang + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(sunX + perpX * 2,       sunY + perpY * 2);
        ctx.lineTo(sunX - perpX * 2,       sunY - perpY * 2);
        ctx.lineTo(endX - perpX * rayWidth, endY - perpY * rayWidth);
        ctx.lineTo(endX + perpX * rayWidth, endY + perpY * rayWidth);
        ctx.closePath();
        ctx.fill();
      }
      // 光の揺らぎ（ごく薄い円形グロー）
      const glowGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 80);
      glowGrad.addColorStop(0,   `rgba(255,220,100,${godAlpha * 2})`);
      glowGrad.addColorStop(0.5, `rgba(255,200,60,${godAlpha * 0.8})`);
      glowGrad.addColorStop(1,   'rgba(255,180,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── ハンピ: 廃墟のブーゲンビリア ──
  if (loc === 'hampi') {
    // 石の壁面や倒れた柱にブーゲンビリアの鮮やかな花が咲いている
    const clusters = [
      { cx: canvas.width * 0.08, cy: tileSize * 5.5, color: '#cc2244', petals: 14 },
      { cx: canvas.width * 0.45, cy: tileSize * 4.8, color: '#ee6622', petals: 12 },
      { cx: canvas.width * 0.82, cy: tileSize * 5.2, color: '#dd1155', petals: 16 },
      { cx: canvas.width * 0.25, cy: tileSize * 6.8, color: '#ff4488', petals: 10 },
    ];
    ctx.save();
    for (let ci = 0; ci < clusters.length; ci++) {
      const { cx, cy, color, petals } = clusters[ci];
      // 茎と枝の広がり
      ctx.strokeStyle = '#3a6a18';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.40;
      for (let bi = 0; bi < 5; bi++) {
        const ang = (bi / 5) * Math.PI - Math.PI * 0.3;
        const len = 18 + bi * 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(
          cx + Math.cos(ang + 0.4) * len * 0.5,
          cy + Math.sin(ang + 0.4) * len * 0.5 - 5,
          cx + Math.cos(ang) * len,
          cy + Math.sin(ang) * len
        );
        ctx.stroke();
      }
      // ブーゲンビリアの花びら（薄い苞葉）
      ctx.globalAlpha = 0.55;
      for (let pi = 0; pi < petals; pi++) {
        const pAngle = (pi / petals) * Math.PI * 2 + Math.sin(animFrame * 0.008 + ci * 1.2) * 0.03;
        const pDist = 6 + (pi % 3) * 4;
        const px = cx + Math.cos(pAngle) * pDist;
        const py = cy + Math.sin(pAngle) * pDist;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.45 + (pi % 3) * 0.1;
        ctx.beginPath();
        ctx.ellipse(px, py, 4, 2.5, pAngle + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // 中心の小花
      ctx.fillStyle = '#ffeeaa';
      ctx.globalAlpha = 0.70;
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
      // 葉（緑）
      ctx.fillStyle = '#2a7a18';
      ctx.globalAlpha = 0.38;
      for (let li = 0; li < 6; li++) {
        const la = (li / 6) * Math.PI * 2 + 0.5;
        const ld = 16 + li * 3;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(la) * ld, cy + Math.sin(la) * ld, 5, 3, la + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── ハンピ: 石柱に絡む蔦 ──
  if (loc === 'hampi') {
    // 廃墟の石柱（列柱）にツタが這い上がっている静的装飾
    const columns = [
      canvas.width * 0.18,
      canvas.width * 0.38,
      canvas.width * 0.58,
      canvas.width * 0.78,
    ];
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (let ci = 0; ci < columns.length; ci++) {
      const cx = columns[ci];
      const colBottom = tileSize * 8.5;
      const colTop    = tileSize * 2.8;
      // 主茎
      ctx.strokeStyle = '#2a6a18';
      ctx.lineWidth = 1.8;
      const stemSway = Math.sin(ci * 2.1) * 6; // 各柱で違う曲がり方
      ctx.beginPath();
      ctx.moveTo(cx + 3, colBottom);
      ctx.quadraticCurveTo(cx + stemSway, (colBottom + colTop) / 2, cx - stemSway * 0.5, colTop);
      ctx.stroke();
      // 側枝と葉
      const branchCount = 7 + ci;
      for (let bi = 0; bi < branchCount; bi++) {
        const t = (bi + 1) / (branchCount + 1);
        const bx = cx + 3 + stemSway * t * (1 - t) * 4;
        const by = colBottom + (colTop - colBottom) * t;
        const side = bi % 2 === 0 ? 1 : -1;
        const branchLen = 10 + (bi % 3) * 5;
        const branchAngle = side * (0.5 + (bi % 3) * 0.15);
        const endBx = bx + Math.sin(branchAngle) * branchLen;
        const endBy = by - Math.cos(branchAngle) * branchLen * 0.5;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#2a6a18';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(endBx, endBy);
        ctx.stroke();
        // 葉（小さいハート形近似）
        ctx.fillStyle = '#3a8a20';
        ctx.globalAlpha = 0.42;
        ctx.save();
        ctx.translate(endBx, endBy);
        ctx.rotate(branchAngle + Math.PI * 0.1);
        ctx.beginPath();
        ctx.ellipse(0, -3, 4, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 0.45;
      }
      // 根元の地面の蔓
      ctx.strokeStyle = '#2a6a18';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(cx + 3, colBottom);
      ctx.quadraticCurveTo(cx + 20, colBottom + 4, cx + 32, colBottom + 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: 巨岩の上の猿の群れ ──
  if (loc === 'hampi') {
    // ハンピ名物の巨岩地帯、岩の頂上部に猿たちが座ったり動き回ったりする
    const monkeys = [
      { bx: canvas.width * 0.10, by: tileSize * 2.4, cycle: 380, phase: 0    },
      { bx: canvas.width * 0.28, by: tileSize * 1.9, cycle: 420, phase: 130  },
      { bx: canvas.width * 0.55, by: tileSize * 2.1, cycle: 350, phase: 60   },
      { bx: canvas.width * 0.72, by: tileSize * 1.7, cycle: 460, phase: 200  },
      { bx: canvas.width * 0.88, by: tileSize * 2.3, cycle: 310, phase: 90   },
    ];
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#3a2a18';
    ctx.strokeStyle = '#3a2a18';
    for (let mi = 0; mi < monkeys.length; mi++) {
      const m = monkeys[mi];
      const cp = (animFrame + m.phase) % m.cycle;
      // 0-80: 静止、80-160: 頭を動かす、160-240: 横に移動、240+: 静止
      const phase = cp;
      let mx = m.bx;
      let scratch = 0; // 頭掻き動作
      if (phase >= 80 && phase < 160) {
        scratch = Math.sin((phase - 80) / 80 * Math.PI) * 4;
      } else if (phase >= 160 && phase < 240) {
        const walkT = (phase - 160) / 80;
        mx = m.bx + Math.sin(walkT * Math.PI) * 14;
      }
      const my = m.by;
      ctx.lineWidth = 1;
      // 胴体
      ctx.beginPath();
      ctx.ellipse(mx, my, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      const headBob = Math.sin(animFrame * 0.022 + mi * 1.1) * 1.2;
      ctx.beginPath();
      ctx.arc(mx, my - 9 + headBob, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // 顔の白い部分
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#c8b090';
      ctx.beginPath();
      ctx.ellipse(mx, my - 8.5 + headBob, 2.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#3a2a18';
      // 尻尾
      ctx.lineWidth = 1.5;
      const tailCurl = Math.sin(animFrame * 0.03 + mi * 0.7) * 8;
      ctx.beginPath();
      ctx.moveTo(mx + 4, my + 2);
      ctx.quadraticCurveTo(mx + 14 + tailCurl * 0.3, my + 5, mx + 12 + tailCurl * 0.5, my - 4 + tailCurl * 0.4);
      ctx.stroke();
      // 腕（頭掻きの場合は片腕を上げる）
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(mx - 4, my - 4);
      ctx.lineTo(mx - 9, my + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx + 4, my - 4);
      ctx.lineTo(mx + 6, my - 4 + scratch); // 引っ掻き動作
      ctx.stroke();
      // 足
      ctx.beginPath();
      ctx.moveTo(mx - 3, my + 5);
      ctx.lineTo(mx - 4, my + 11);
      ctx.moveTo(mx + 3, my + 5);
      ctx.lineTo(mx + 4, my + 11);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: 廃墟の蛍 ──
  if (loc === 'hampi') {
    // 夕暮れ以降（elapsed>=1200）、石柱の隙間に蛍が舞い始める
    const elapsedFF = animFrame - fieldEnterFrame;
    if (elapsedFF >= 1200) {
      const ffAlpha = Math.min(1, (elapsedFF - 1200) / 300) * 0.9;
      const fireflyCount = 14;
      ctx.save();
      for (let fi = 0; fi < fireflyCount; fi++) {
        // それぞれ異なるリサジュー軌道で飛び回る
        const freqX = 0.013 + fi * 0.003;
        const freqY = 0.017 + fi * 0.002;
        const phaseX = fi * 1.13;
        const phaseY = fi * 0.77;
        const cx = canvas.width * (0.2 + (fi % 5) * 0.13);
        const cy = tileSize * (3.5 + (fi % 4) * 1.4);
        const rx = 18 + (fi % 3) * 8;
        const ry = 12 + (fi % 4) * 5;
        const fx = cx + Math.sin(animFrame * freqX + phaseX) * rx;
        const fy = cy + Math.cos(animFrame * freqY + phaseY) * ry;
        // 明滅
        const blink = Math.sin(animFrame * 0.08 + fi * 1.9);
        const glow = (blink + 1) / 2; // 0〜1
        if (glow < 0.25) continue;   // 消灯中はスキップ

        // 発光コア
        ctx.globalAlpha = ffAlpha * glow * 0.9;
        const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, 5);
        grad.addColorStop(0, 'rgba(200,255,120,1)');
        grad.addColorStop(0.4, 'rgba(160,230,60,0.6)');
        grad.addColorStop(1, 'rgba(100,200,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fill();

        // 中心の輝点
        ctx.globalAlpha = ffAlpha * glow;
        ctx.fillStyle = '#eeffaa';
        ctx.beginPath();
        ctx.arc(fx, fy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: ヴィルーパークシャ寺院の塔門 ──
  if (loc === 'hampi') {
    // 画面奥（空の領域）に大きな階段状の塔門シルエット
    const gopX = canvas.width * 0.50;
    const gopY = tileSize * 2.0;  // 空の下端
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle   = '#2A1C10';
    // 塔の各層（下から上に向かって幅が狭くなる）
    const tiers = [
      { w: 40, h: 8 },
      { w: 34, h: 7 },
      { w: 28, h: 6 },
      { w: 22, h: 6 },
      { w: 16, h: 5 },
      { w: 12, h: 4 },
      { w: 8,  h: 4 },
      { w: 5,  h: 5 },  // 頂点のカラシャ
    ];
    let ty = gopY;
    for (const tier of tiers) {
      ty -= tier.h;
      ctx.beginPath();
      ctx.rect(gopX - tier.w, ty, tier.w * 2, tier.h);
      ctx.fill();
      // 各層に装飾ライン
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = '#3A2C18';
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      ctx.moveTo(gopX - tier.w + 2, ty + tier.h - 1);
      ctx.lineTo(gopX + tier.w - 2, ty + tier.h - 1);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
    }
    // 入口（アーチ型の門）
    ctx.globalAlpha = 0.22;
    ctx.fillStyle   = '#1A0C06';
    ctx.beginPath();
    ctx.rect(gopX - 8, gopY - 18, 16, 18);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(gopX, gopY - 18, 8, Math.PI, 0);
    ctx.fill();
    // 蜃気楼による揺らぎ（熱い日はわずかに揺れる）
    const elapsedGp = animFrame - fieldEnterFrame;
    if (elapsedGp >= 400 && elapsedGp <= 1400) {
      ctx.globalAlpha = 0.04 * Math.sin(animFrame * 0.035);
      ctx.fillStyle   = '#3A2810';
      ctx.beginPath();
      ctx.rect(gopX - 42, gopY - 72, 84, 72);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ハンピ: 廃墟を横切るイノシシ ──
  if (loc === 'hampi') {
    const boarCycle = 500;
    const boarActive = 130;
    const bp2 = animFrame % boarCycle;
    if (bp2 < boarActive) {
      const t   = bp2 / boarActive;
      const bx2 = t * canvas.width * 0.85 + canvas.width * 0.05;
      const by2 = tileSize * 6.5 + Math.sin(animFrame * 0.20) * 1.5;
      const fade = t < 0.05 ? t / 0.05 : t > 0.90 ? (1 - t) / 0.10 : 1;
      const trot = Math.sin(animFrame * 0.22) * 2.5;
      ctx.save();
      ctx.globalAlpha = fade * 0.38;
      ctx.fillStyle   = '#2A1808';
      ctx.strokeStyle = '#2A1808';
      // 胴体（ずんぐりした楕円）
      ctx.beginPath();
      ctx.ellipse(bx2, by2 - 2, 14, 7, -0.1, 0, Math.PI * 2);
      ctx.fill();
      // 頭（大きい）
      ctx.beginPath();
      ctx.ellipse(bx2 + 15, by2 - 2, 7, 6, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // 鼻先（鼻ツラが突き出た円盤）
      ctx.beginPath();
      ctx.ellipse(bx2 + 22, by2 - 1, 3, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // きば（二本の白い牙）
      ctx.globalAlpha = fade * 0.55;
      ctx.fillStyle = '#D8C8A0';
      ctx.beginPath();
      ctx.moveTo(bx2 + 21, by2 + 1);
      ctx.lineTo(bx2 + 26, by2 + 3);
      ctx.lineTo(bx2 + 22, by2 + 3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = fade * 0.38;
      ctx.fillStyle   = '#2A1808';
      // 背中のたて毛（剛毛の列）
      ctx.lineWidth = 1.5;
      for (let b = 0; b < 5; b++) {
        const hx = bx2 - 8 + b * 5;
        ctx.beginPath();
        ctx.moveTo(hx, by2 - 8);
        ctx.lineTo(hx + 1, by2 - 14);
        ctx.stroke();
      }
      // 4本の脚
      ctx.lineWidth = 3;
      const bLegs = [bx2 - 7, bx2 - 2, bx2 + 5, bx2 + 10];
      for (let l = 0; l < 4; l++) {
        const lo = Math.sin(animFrame * 0.22 + l * 0.8) * 2.5;
        ctx.beginPath();
        ctx.moveTo(bLegs[l], by2 + 4);
        ctx.lineTo(bLegs[l], by2 + 10 + lo);
        ctx.stroke();
      }
      // しっぽ（短い）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx2 - 13, by2 - 3);
      ctx.quadraticCurveTo(bx2 - 17, by2 - 6, bx2 - 16, by2 - 9);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 寺院の蓮池 ──
  if (loc === 'hampi') {
    // 画面左側に小さな蓮池（静止した水面の反射）
    const poolX = canvas.width * 0.08;
    const poolY = tileSize * 5.8;
    const poolW = 45, poolH = 18;
    ctx.save();
    // 池の水（濃い青緑）
    ctx.globalAlpha = 0.28;
    ctx.fillStyle   = '#1A3828';
    ctx.beginPath();
    ctx.ellipse(poolX, poolY, poolW * 0.5, poolH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 水面の反射（空の色を薄く）
    ctx.globalAlpha = 0.15;
    const poolRefl = ctx.createRadialGradient(poolX, poolY, 0, poolX, poolY, poolW * 0.45);
    poolRefl.addColorStop(0, 'rgba(180,220,240,0.4)');
    poolRefl.addColorStop(1, 'rgba(100,160,180,0)');
    ctx.fillStyle = poolRefl;
    ctx.beginPath();
    ctx.ellipse(poolX, poolY, poolW * 0.5, poolH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 蓮の葉（3枚）
    ctx.globalAlpha = 0.32;
    ctx.fillStyle   = '#2A5020';
    const leafPos = [
      { x: poolX - 8, y: poolY - 4 },
      { x: poolX + 6, y: poolY - 2 },
      { x: poolX - 2, y: poolY + 5 },
    ];
    for (const lp of leafPos) {
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 蓮の花（2輪）
    const lotPos = [
      { x: poolX - 10, y: poolY - 6, col: '#D060A0' },
      { x: poolX + 8,  y: poolY + 2, col: '#E08080' },
    ];
    for (const lf of lotPos) {
      for (let p = 0; p < 6; p++) {
        const pa = p * Math.PI / 3 + animFrame * 0.003;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle   = lf.col;
        ctx.beginPath();
        ctx.ellipse(
          lf.x + Math.cos(pa) * 3,
          lf.y + Math.sin(pa) * 3,
          2, 3.5, pa, 0, Math.PI * 2
        );
        ctx.fill();
      }
      // 花芯
      ctx.globalAlpha = 0.50;
      ctx.fillStyle   = '#FFEE80';
      ctx.beginPath();
      ctx.arc(lf.x, lf.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // さざ波
    for (let r = 0; r < 2; r++) {
      const rAge = (animFrame * 0.4 + r * 60) % 80;
      const rR   = rAge * 0.28;
      const ra   = (1 - rAge / 80) * 0.12;
      ctx.globalAlpha = ra;
      ctx.strokeStyle = 'rgba(160,210,200,1)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.ellipse(poolX, poolY, rR * poolW / 22, rR * poolH / 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: 石の上のコブラ ──
  if (loc === 'hampi') {
    // 石柱のそば（固定位置）に巻いたコブラ
    const cobraX = tileSize * 7;
    const cobraY = tileSize * 4.2;
    const sway = Math.sin(animFrame * 0.028) * 3;
    const hood  = 0.6 + 0.4 * Math.sin(animFrame * 0.028);  // フードの開き具合
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle   = '#2A1808';
    ctx.strokeStyle = '#2A1808';
    // とぐろ（螺旋）
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cobraX, cobraY + 4, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cobraX, cobraY + 4, 3, 0, Math.PI * 2);
    ctx.stroke();
    // 首（上に伸びる S字）
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cobraX, cobraY + 1);
    ctx.quadraticCurveTo(cobraX - 5, cobraY - 5, cobraX + sway, cobraY - 12);
    ctx.quadraticCurveTo(cobraX + sway + 4, cobraY - 16, cobraX + sway, cobraY - 22);
    ctx.stroke();
    // フード（特徴的な広がった首）
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cobraX + sway, cobraY - 22, 6 * hood, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.ellipse(cobraX + sway, cobraY - 26, 3, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 目（光る点）
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = '#E8C020';
    ctx.beginPath();
    ctx.arc(cobraX + sway - 1.5, cobraY - 26.5, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cobraX + sway + 1.5, cobraY - 26.5, 0.8, 0, Math.PI * 2);
    ctx.fill();
    // 舌（チロチロ）
    if (Math.sin(animFrame * 0.08) > 0.7) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#C03030';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.moveTo(cobraX + sway, cobraY - 24);
      ctx.lineTo(cobraX + sway - 3, cobraY - 22);
      ctx.moveTo(cobraX + sway, cobraY - 24);
      ctx.lineTo(cobraX + sway + 3, cobraY - 22);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: タングバドラ川のコラクル ──
  if (loc === 'hampi') {
    // コラクル（丸いかご船）が川の水タイルをゆっくり横切る
    const corCycle = 480;
    const corSpeed = 0.055;
    const corX = ((animFrame * corSpeed) % (canvas.width + 50)) - 25;
    const corY = tileSize * 5.5 + Math.sin(animFrame * 0.025) * 2;
    const bob = Math.sin(animFrame * 0.04) * 1.5;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle   = '#3A2010';
    ctx.strokeStyle = '#3A2010';
    // コラクル本体（楕円の皿型）
    ctx.beginPath();
    ctx.ellipse(corX, corY + bob, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 船の縁（わずかに明るく）
    ctx.globalAlpha = 0.20;
    ctx.fillStyle   = '#5A3A18';
    ctx.beginPath();
    ctx.ellipse(corX, corY + bob, 12, 5, 0, 0, Math.PI);  // 上半分のみ
    ctx.fill();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle   = '#3A2010';
    // 乗っている人（一人）
    ctx.beginPath();
    ctx.arc(corX, corY + bob - 6, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(corX, corY + bob - 4);
    ctx.lineTo(corX, corY + bob - 1);
    ctx.stroke();
    // 竿（長い棒で川底を突く）
    ctx.lineWidth = 1.2;
    const poleAngle = 0.4 + Math.sin(animFrame * 0.04) * 0.15;
    ctx.beginPath();
    ctx.moveTo(corX + 2, corY + bob - 3);
    ctx.lineTo(corX + 2 + Math.cos(poleAngle) * 14, corY + bob - 3 + Math.sin(poleAngle) * 14);
    ctx.stroke();
    // 水の波紋（コラクルが通った後）
    for (let r = 0; r < 2; r++) {
      const rAge = (animFrame * 0.6 + r * 35) % 70;
      const rR   = rAge * 0.5;
      const rA   = (1 - rAge / 70) * 0.15;
      ctx.globalAlpha = rA;
      ctx.strokeStyle = 'rgba(180,220,255,1)';
      ctx.lineWidth   = 0.7;
      ctx.beginPath();
      ctx.ellipse(corX - rR * 0.8, corY + bob + 4, rR, rR * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: ヴィッタラ寺院の石の戦車 ──
  if (loc === 'hampi') {
    // 画面右側の石の戦車シルエット（有名なVittala Temple stone chariot）
    const charX = canvas.width * 0.72;
    const charY = tileSize * 4.0;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle   = '#3C2810';
    ctx.strokeStyle = '#3C2810';
    // 屋根（層を重ねた寺院型）
    for (let tier = 0; tier < 3; tier++) {
      const tw = 28 - tier * 6;
      const th = 8;
      const ty = charY - 20 - tier * (th + 2);
      ctx.beginPath();
      ctx.moveTo(charX - tw, ty + th);
      ctx.lineTo(charX + tw, ty + th);
      ctx.lineTo(charX + tw * 0.7, ty);
      ctx.lineTo(charX, ty - 4);
      ctx.lineTo(charX - tw * 0.7, ty);
      ctx.closePath();
      ctx.fill();
    }
    // 本体（戦車の箱型）
    ctx.beginPath();
    ctx.rect(charX - 22, charY - 20, 44, 20);
    ctx.fill();
    // 装飾の横線
    ctx.globalAlpha = 0.12;
    ctx.lineWidth   = 1;
    for (let line = 0; line < 3; line++) {
      ctx.beginPath();
      ctx.moveTo(charX - 22, charY - 14 + line * 4);
      ctx.lineTo(charX + 22, charY - 14 + line * 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.25;
    // 巨大な車輪（2個）
    ctx.lineWidth = 3;
    const wheelY = charY + 6;
    for (let w = 0; w < 2; w++) {
      const wx = charX - 12 + w * 24;
      ctx.beginPath();
      ctx.arc(wx, wheelY, 10, 0, Math.PI * 2);
      ctx.stroke();
      // スポーク（8本）
      ctx.lineWidth = 1;
      for (let sp = 0; sp < 8; sp++) {
        const sa = sp * Math.PI * 0.25;
        ctx.beginPath();
        ctx.moveTo(wx, wheelY);
        ctx.lineTo(wx + Math.cos(sa) * 10, wheelY + Math.sin(sa) * 10);
        ctx.stroke();
      }
      ctx.lineWidth = 3;
    }
    // 引っ張る馬（2頭の簡略シルエット）
    ctx.globalAlpha = 0.18;
    for (let h = 0; h < 2; h++) {
      const hx = charX + 30 + h * 18;
      const hy = charY - 5;
      // 馬体
      ctx.beginPath();
      ctx.ellipse(hx, hy, 7, 4, -0.1, 0, Math.PI * 2);
      ctx.fill();
      // 頭・首
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx + 7, hy - 1);
      ctx.lineTo(hx + 12, hy - 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: 石柱を駆けるリス ──
  if (loc === 'hampi') {
    const sqCycle = 240;
    const sqActive = 60;
    const sq = animFrame % sqCycle;
    if (sq < sqActive) {
      const t   = sq / sqActive;
      // 柱の上を素早く走る（垂直方向）
      const colIdx = Math.floor((animFrame / sqCycle) % 5);
      const colX   = [2, 5, 9, 13, 17][colIdx] * tileSize + tileSize * 0.5;
      // 上から下、または下から上
      const goingDown = Math.floor(animFrame / sqCycle) % 2 === 0;
      const sqY = goingDown
        ? tileSize * 0.5 + t * tileSize * 3
        : tileSize * 3.5 - t * tileSize * 3;
      const fade = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
      const bushy = Math.sin(animFrame * 0.35) * 1.5;  // フワフワしっぽ
      ctx.save();
      ctx.globalAlpha = fade * 0.40;
      ctx.fillStyle   = '#4A2C10';
      ctx.strokeStyle = '#4A2C10';
      // 胴体（小さな楕円）
      ctx.beginPath();
      ctx.ellipse(colX + 4, sqY, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭（丸い）
      ctx.beginPath();
      ctx.arc(colX + 7, sqY - 1, 2, 0, Math.PI * 2);
      ctx.fill();
      // 耳（小さな三角）
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX + 6, sqY - 3);
      ctx.lineTo(colX + 5, sqY - 5.5);
      ctx.lineTo(colX + 7, sqY - 3);
      ctx.stroke();
      // ふさふさのしっぽ（後方に大きくカール）
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(colX + 1, sqY);
      ctx.quadraticCurveTo(colX - 5, sqY - 3 + bushy, colX - 6, sqY - 8 + bushy * 0.5);
      ctx.stroke();
      // 前脚（柱に張り付く）
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX + 4, sqY - 1);
      ctx.lineTo(colX + 1, sqY - 3);
      ctx.moveTo(colX + 4, sqY + 1);
      ctx.lineTo(colX + 1, sqY + 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 石の間を走るマングース ──
  if (loc === 'hampi') {
    const mgCycle = 320;
    const mgActive = 90;
    const mp = animFrame % mgCycle;
    if (mp < mgActive) {
      const t   = mp / mgActive;
      // 素早く横切る
      const mx  = t * canvas.width * 0.80 + canvas.width * 0.05;
      const row = Math.floor((animFrame / mgCycle) % 2);
      const my  = tileSize * (3.5 + row * 1.0) + Math.sin(animFrame * 0.35) * 1.5;
      const fade = t < 0.05 ? t / 0.05 : t > 0.90 ? (1 - t) / 0.10 : 1;
      const scurry = Math.sin(animFrame * 0.35) * 2;  // 素早い動き
      ctx.save();
      ctx.globalAlpha = fade * 0.38;
      ctx.fillStyle   = '#2A1808';
      ctx.strokeStyle = '#2A1808';
      // 細長い胴体
      ctx.beginPath();
      ctx.ellipse(mx, my, 8, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭（尖った先端）
      ctx.beginPath();
      ctx.ellipse(mx + 9, my - 0.5, 3.5, 2.5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // しっぽ（背中に沿って立つ）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx - 8, my);
      ctx.quadraticCurveTo(mx - 14, my - 4, mx - 16, my - 8);
      ctx.stroke();
      // 4本の脚（素早く動く）
      ctx.lineWidth = 1.2;
      const legX = [mx - 4, mx - 1, mx + 3, mx + 6];
      for (let l = 0; l < 4; l++) {
        const lo = Math.sin(animFrame * 0.40 + l * 0.7) * 2.5;
        ctx.beginPath();
        ctx.moveTo(legX[l], my + 2);
        ctx.lineTo(legX[l] + (l < 2 ? -1 : 1), my + 5 + lo);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 象の行列（古代彫刻フリーズ） ──
  if (loc === 'hampi') {
    // 石の壁のタイル行（y=3 付近）を横断する象の行列
    const friezeY = tileSize * 2.85;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle   = '#3A2818';
    for (let e = 0; e < 6; e++) {
      const ew = 12;  // 象の幅
      const ex = ((animFrame * 0.18 + e * (canvas.width / 5)) % (canvas.width + ew * 2)) - ew;
      const ey = friezeY;
      // 胴体（低いアーチ型）
      ctx.beginPath();
      ctx.ellipse(ex, ey, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.ellipse(ex + 8, ey - 1, 4.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 鼻（長い鼻）
      ctx.strokeStyle = '#3A2818';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(ex + 12, ey + 1);
      ctx.quadraticCurveTo(ex + 16, ey + 5, ex + 13, ey + 9);
      ctx.stroke();
      // 牙
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ex + 11, ey + 2);
      ctx.lineTo(ex + 15, ey - 1);
      ctx.stroke();
      // 耳
      ctx.beginPath();
      ctx.ellipse(ex + 7, ey - 3, 3.5, 4, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // 4本の柱状の脚
      ctx.lineWidth = 2.5;
      for (let leg = 0; leg < 4; leg++) {
        const lx = ex - 5 + leg * 3.5;
        ctx.beginPath();
        ctx.moveTo(lx, ey + 4);
        ctx.lineTo(lx, ey + 10);
        ctx.stroke();
      }
      // しっぽ
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ex - 7, ey - 1);
      ctx.quadraticCurveTo(ex - 11, ey, ex - 10, ey + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── ハンピ: 古代石柱から落ちる石の粉 ──
  if (loc === 'hampi') {
    const colPositions = [2, 5, 9, 13, 17];
    ctx.save();
    for (let c = 0; c < colPositions.length; c++) {
      const baseX = colPositions[c] * tileSize + tileSize * 0.5;
      // 各柱から断続的にほこりが落ちる
      for (let p = 0; p < 5; p++) {
        const age   = (animFrame * 0.45 + p * 23 + c * 37) % 80;
        const t     = age / 80;
        const px    = baseX + (p % 3 - 1) * 3 + Math.sin(t * Math.PI * 1.5 + p) * 2;
        const py    = tileSize * 3 - t * tileSize * 1.5;  // 柱の上から落ちてくる
        const fade  = t < 0.1 ? t / 0.1 : (1 - t);
        const sz    = 1 + (p % 2) * 0.6;
        if (fade < 0.01) continue;
        ctx.globalAlpha = fade * 0.30;
        ctx.fillStyle   = '#C4A264';
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── ハンピ: 夕陽に伸びる石柱の影 ──
  if (loc === 'hampi') {
    const elapsedShad = animFrame - fieldEnterFrame;
    if (elapsedShad >= 400 && elapsedShad <= 1600) {
      const noon = elapsedShad >= 800 && elapsedShad <= 1200;
      const t    = noon ? 0 : elapsedShad < 800
                   ? (800 - elapsedShad) / 400
                   : (elapsedShad - 1200) / 400;
      const shadowLen = t * tileSize * 3.5;
      if (shadowLen > 1) {
        const cols = [2, 5, 9, 13, 17];
        ctx.save();
        ctx.globalAlpha = t * 0.15;
        ctx.fillStyle   = 'rgba(20,12,5,1)';
        const angle = elapsedShad < 1000 ? -Math.PI * 0.18 : Math.PI * 0.18;
        for (const col of cols) {
          const baseX = col * tileSize + tileSize * 0.5;
          const baseY = 3 * tileSize;   // 柱の根本（地面）
          const tipX  = baseX + Math.cos(angle + Math.PI * 0.5) * shadowLen;
          const tipY  = baseY + shadowLen * 0.25;
          ctx.beginPath();
          ctx.moveTo(baseX - 2, baseY);
          ctx.lineTo(baseX + 2, baseY);
          ctx.lineTo(tipX + 3,  tipY);
          ctx.lineTo(tipX - 3,  tipY);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ── ハンピ: 古代石柱のスカイライン ──
  if (loc === 'hampi') {
    const columns = [
      {cx: 2,  row: 3, h: 30}, {cx: 8,  row: 3, h: 38},
      {cx: 12, row: 4, h: 24}, {cx: 17, row: 3, h: 32},
    ];
    ctx.save();
    ctx.fillStyle = '#261A0E';
    ctx.globalAlpha = 0.52;
    for (const c of columns) {
      const px = c.cx * tileSize + tileSize * 0.5;
      const py = c.row * tileSize;
      const w  = 5;
      // 柱本体
      ctx.fillRect(px - w / 2, py - c.h, w, c.h);
      // ゴープラム風の台形頭部
      ctx.beginPath();
      ctx.moveTo(px - w,       py - c.h);
      ctx.lineTo(px - w * 1.9, py - c.h - 9);
      ctx.lineTo(px + w * 1.9, py - c.h - 9);
      ctx.lineTo(px + w,       py - c.h);
      ctx.closePath();
      ctx.fill();
      // 頂部三角
      ctx.beginPath();
      ctx.moveTo(px - w * 1.6, py - c.h - 9);
      ctx.lineTo(px,            py - c.h - 20);
      ctx.lineTo(px + w * 1.6, py - c.h - 9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ハンピ: 石タイルの岩面フラッシュ（陽光のきらめき） ──
  if (loc === 'hampi') {
    // 石タイルが時折きらっと光る（周期的に数か所）
    const flashSlots = [[4,3],[9,4],[3,9],[14,5],[7,12],[16,13],[5,6]];
    for (let fi = 0; fi < flashSlots.length; fi++) {
      const [fc, fr] = flashSlots[fi];
      const flashCycle = 280 + fi * 47;
      const flashPhase = (animFrame + fi * 113) % flashCycle;
      if (flashPhase < 18) {
        const fa = Math.sin((flashPhase / 18) * Math.PI) * 0.55;
        const fx = fc * tileSize + tileSize * 0.6;
        const fy = fr * tileSize + tileSize * 0.4;
        ctx.save();
        ctx.globalAlpha = fa;
        ctx.fillStyle = '#FFFAE0';
        // 小さな十字フラッシュ
        ctx.fillRect(fx - 4, fy - 0.5, 8, 1);
        ctx.fillRect(fx - 0.5, fy - 4, 1, 8);
        ctx.restore();
      }
    }
  }

  if (loc === 'hampi') {
    const shimmerRows = [3, 4, 5, 9, 12, 13];
    ctx.save();
    for (const row of shimmerRows) {
      const baseY = row * tileSize;
      for (let line = 0; line < 3; line++) {
        const speed  = 0.055 + line * 0.022;
        const phase  = animFrame * speed + row * 2.3 + line * 4.1;
        const offset = Math.sin(phase) * 6;
        const lx     = (animFrame * (0.4 + line * 0.15) + row * 31 + line * 53) % canvas.width;
        const ly     = baseY + tileSize * 0.35 + offset;
        const alpha  = (0.04 + 0.03 * Math.sin(phase * 0.7)) * (0.5 + 0.5 * Math.sin(phase));
        if (alpha < 0.005) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFE0A0';
        ctx.fillRect(lx, ly, 18 + line * 8, 1);
      }
    }
    ctx.restore();
  }

  // ── ハンピ: 黄金時間帯の石柱陽炎 ──
  if (loc === 'hampi') {
    const elapsedHm = animFrame - fieldEnterFrame;
    if (elapsedHm >= 400 && elapsedHm < 1400) {
      const rise = Math.min(1, (elapsedHm - 400) / 300);
      const fall = Math.max(0, 1 - (elapsedHm - 1100) / 300);
      const intensity = rise * fall;
      const pillars = [{x: 4, y: 3}, {x: 9, y: 4}, {x: 16, y: 5}];
      for (const p of pillars) {
        const px2    = p.x * tileSize + tileSize / 2;
        const py2    = p.y * tileSize;
        const flicker = 0.7 + 0.3 * Math.sin(animFrame * 0.06 + p.x * 0.9);
        for (let seg = 0; seg < 7; seg++) {
          const sy  = py2 - seg * 9;
          const wob = Math.sin(animFrame * 0.042 + seg * 1.1 + p.x * 0.8) * 3.5;
          const a   = intensity * flicker * (0.065 - seg * 0.0085);
          if (a < 0.004) continue;
          ctx.save();
          ctx.globalAlpha = a;
          const hg = ctx.createLinearGradient(px2 + wob - 5, sy, px2 + wob + 5, sy);
          hg.addColorStop(0, 'rgba(255,224,140,0)');
          hg.addColorStop(0.5, 'rgba(255,224,140,1)');
          hg.addColorStop(1, 'rgba(255,224,140,0)');
          ctx.fillStyle = hg;
          ctx.fillRect(px2 + wob - 5, sy - 9, 10, 10);
          ctx.restore();
        }
      }
    }
  }

  // ── ハンピ: 猿のシルエットが石の上を駆け抜ける ──
  if (loc === 'hampi') {
    const monkeyPeriod = 240;
    const mp = animFrame % monkeyPeriod;
    if (mp < 90) {
      const t    = mp / 90;
      const mx   = t * (canvas.width + 40) - 20;
      const my   = (3.5 + Math.sin(t * Math.PI * 4) * 0.25) * tileSize;
      const fade = t < 0.1 ? t * 10 : t > 0.88 ? (1 - t) * 8.3 : 1;
      const leg  = Math.sin(animFrame * 0.40) * 5;
      ctx.save();
      ctx.globalAlpha = fade * 0.52;
      ctx.fillStyle = '#2E1A08';
      // 胴体
      ctx.beginPath();
      ctx.ellipse(mx, my, 6, 4.5, 0.25, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.ellipse(mx + 5.5, my - 3.5, 3.5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 尻尾
      ctx.strokeStyle = '#2E1A08';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(mx - 5, my);
      ctx.quadraticCurveTo(mx - 11, my - 7, mx - 7, my - 13);
      ctx.stroke();
      // 足 (走るアニメ)
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(mx - 2, my + 3);
      ctx.lineTo(mx - 2 + leg, my + 8);
      ctx.moveTo(mx + 2, my + 3);
      ctx.lineTo(mx + 2 - leg, my + 8);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 象のシルエットがゆっくり歩く ──
  if (loc === 'hampi') {
    const elephantPeriod = 500;
    const ep   = animFrame % elephantPeriod;
    if (ep < 210) {
      const t    = ep / 210;
      const ex   = t * (canvas.width + 80) - 40;
      const ey   = 10 * tileSize - 4;
      const fade = t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1;
      const sway = Math.sin(animFrame * 0.16) * 1.8;
      ctx.save();
      ctx.fillStyle   = '#1C1208';
      ctx.strokeStyle = '#1C1208';
      ctx.lineCap     = 'round';
      ctx.globalAlpha = fade * 0.58;
      // 体
      ctx.beginPath();
      ctx.ellipse(ex, ey - 10 + sway * 0.3, 22, 13, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.ellipse(ex + 21, ey - 15 + sway * 0.2, 12, 10, -0.18, 0, Math.PI * 2);
      ctx.fill();
      // 耳
      ctx.beginPath();
      ctx.ellipse(ex + 13, ey - 15, 7, 9, -0.35, 0, Math.PI * 2);
      ctx.fill();
      // 鼻
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(ex + 30, ey - 10);
      ctx.quadraticCurveTo(ex + 38, ey - 2, ex + 33, ey + 5 + sway);
      ctx.stroke();
      // 足 (4本)
      ctx.lineWidth = 5;
      const legPhase = animFrame * 0.20;
      for (let li = 0; li < 4; li++) {
        const lx   = ex - 13 + li * 9;
        const lOff = Math.sin(legPhase + li * Math.PI * 0.5) * 3.5;
        ctx.beginPath();
        ctx.moveTo(lx, ey - 1);
        ctx.lineTo(lx + lOff * 0.25, ey + 10);
        ctx.stroke();
      }
      // 尻尾
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex - 20, ey - 11);
      ctx.quadraticCurveTo(ex - 28, ey - 5, ex - 25, ey + 2 + sway * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 砂塵の風 ──
  if (loc === 'hampi') {
    const elapsedHw = animFrame - fieldEnterFrame;
    const windCycle = 520;
    const windPhase = elapsedHw % windCycle;
    if (windPhase < 160) {
      const intensity = Math.sin((windPhase / 160) * Math.PI);
      const streakCount = Math.floor(9 * intensity) + 1;
      ctx.save();
      for (let s = 0; s < streakCount; s++) {
        const sy  = ((s * 53 + windPhase * 5) % canvas.height);
        const len = 28 + s * 9 + windPhase * 0.6;
        const sx  = (windPhase * (3.2 + s * 0.35) + s * 97) % (canvas.width + len) - len;
        const a   = intensity * (0.055 + (s % 3) * 0.018);
        ctx.globalAlpha = a;
        ctx.strokeStyle = 'rgba(210,168,88,1)';
        ctx.lineWidth   = 0.5 + (s % 3) * 0.25;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + len, sy - 1 + s % 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── ハンピ: 水面に浮かぶトンボ ──
  if (loc === 'hampi') {
    ctx.save();
    for (let d = 0; d < 4; d++) {
      const dSpeed  = 0.035 + d * 0.013;
      const dPhase  = d * 113;
      const dx = ((animFrame * dSpeed + dPhase) % (canvas.width + 40)) - 20;
      const dy = tileSize * (2.8 + (d % 2) * 0.8) + Math.sin(animFrame * 0.11 + d * 1.2) * 5;
      const hover = Math.sin(animFrame * 0.18 + d * 0.7) * 1.5;
      const wingFlap = Math.sin(animFrame * 0.42 + d * 0.5);
      const a = 0.28 + 0.10 * Math.sin(animFrame * 0.05 + d);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#203810';
      ctx.fillStyle   = '#203810';
      ctx.lineWidth   = 1;
      // 細長い体
      ctx.beginPath();
      ctx.moveTo(dx - 7, dy + hover);
      ctx.lineTo(dx + 7, dy + hover);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      // 頭（前）
      ctx.beginPath();
      ctx.arc(dx + 8, dy + hover, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // 翼（4枚：上下×左右）
      const wLen = 8;
      const wAng = 0.35 + wingFlap * 0.25;
      // 上翼
      ctx.globalAlpha = a * 0.55;
      ctx.beginPath();
      ctx.moveTo(dx, dy + hover);
      ctx.lineTo(dx - wLen * Math.cos(wAng), dy + hover - wLen * Math.sin(wAng));
      ctx.lineTo(dx + 2, dy + hover);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(dx, dy + hover);
      ctx.lineTo(dx + wLen * Math.cos(wAng), dy + hover - wLen * Math.sin(wAng));
      ctx.lineTo(dx - 2, dy + hover);
      ctx.closePath();
      ctx.fill();
      // 下翼（少し小さめ）
      ctx.beginPath();
      ctx.moveTo(dx, dy + hover);
      ctx.lineTo(dx - wLen * 0.75 * Math.cos(wAng + 0.3), dy + hover + wLen * 0.5 * Math.sin(wAng));
      ctx.lineTo(dx + 2, dy + hover);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(dx, dy + hover);
      ctx.lineTo(dx + wLen * 0.75 * Math.cos(wAng + 0.3), dy + hover + wLen * 0.5 * Math.sin(wAng));
      ctx.lineTo(dx - 2, dy + hover);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ハンピ: クジャクのシルエット ──
  if (loc === 'hampi') {
    const pcCycle = 680;
    const pcActive = 200;
    const pcPhase = animFrame % pcCycle;
    if (pcPhase < pcActive) {
      const t  = pcPhase / pcActive;
      const px = t * canvas.width * 0.78 + canvas.width * 0.06;
      const py = tileSize * (4.5 + Math.floor((animFrame / pcCycle) % 2) * 1.5);
      const fade = t < 0.06 ? t / 0.06 : t > 0.92 ? (1 - t) / 0.08 : 1;
      const step = Math.sin(animFrame * 0.14) * 1.5;
      ctx.save();
      ctx.globalAlpha = fade * 0.40;
      ctx.fillStyle   = '#1C1408';
      ctx.strokeStyle = '#1C1408';
      // 体
      ctx.beginPath();
      ctx.ellipse(px, py, 6, 4, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // 首・頭
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 5, py - 2);
      ctx.quadraticCurveTo(px + 9, py - 8, px + 11, py - 14 + step * 0.3);
      ctx.stroke();
      // くちばし
      ctx.beginPath();
      ctx.ellipse(px + 11.5, py - 15 + step * 0.3, 2.5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 尾羽（広げた扇形の羽根 5本）
      for (let f = 0; f < 5; f++) {
        const fa = Math.PI * 0.85 + f * (Math.PI * 0.28 / 4);
        const fl = 16 + f % 2 * 4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 4, py);
        ctx.lineTo(px - 4 + Math.cos(fa) * fl, py + Math.sin(fa) * fl + step * 0.2);
        ctx.stroke();
        // 羽の先の「目玉模様」
        const fex = px - 4 + Math.cos(fa) * fl;
        const fey = py + Math.sin(fa) * fl + step * 0.2;
        ctx.globalAlpha = fade * 0.28;
        ctx.beginPath();
        ctx.arc(fex, fey, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade * 0.40;
      }
      // 脚（歩行アニメ）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 1, py + 3);
      ctx.lineTo(px - 1, py + 9 + step);
      ctx.moveTo(px + 3, py + 3);
      ctx.lineTo(px + 3, py + 9 - step);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── ハンピ: 夕暮れの蝙蝠 ──
  if (loc === 'hampi') {
    const elapsedBat = animFrame - fieldEnterFrame;
    if (elapsedBat >= 1200) {
      const mt = Math.min(1, (elapsedBat - 1200) / 400);
      ctx.save();
      for (let b = 0; b < 6; b++) {
        const bSpeed = 0.031 + b * 0.011;
        const bPhase = b * 107;
        const bx = ((animFrame * bSpeed + bPhase) % (canvas.width + 40)) - 20;
        const by = tileSize * (0.4 + (b % 3) * 0.45) +
                   Math.sin(animFrame * 0.072 + b * 1.3) * 6 +
                   Math.sin(animFrame * 0.031 + b * 0.7) * 4;
        const wing = Math.sin(animFrame * 0.28 + b * 0.9) * 5;
        const a = mt * (0.30 + 0.12 * Math.sin(animFrame * 0.04 + b));
        ctx.globalAlpha = a;
        ctx.fillStyle   = '#1A0C08';
        ctx.strokeStyle = '#1A0C08';
        ctx.lineWidth   = 1.2;
        // 体
        ctx.beginPath();
        ctx.ellipse(bx, by, 3, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // 翼（鋭角な三角）
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 12, by - 1 + wing);
        ctx.lineTo(bx - 7, by + 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 12, by - 1 + wing);
        ctx.lineTo(bx + 7, by + 4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 岩山のヤギ ──
  if (loc === 'rishikesh') {
    // 背景の岩（空の下端）の上に山岳ヤギ
    const goatX = canvas.width * 0.78;
    const goatY = tileSize * 2.05;
    const balance = Math.sin(animFrame * 0.025) * 1;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle   = '#2A2418';
    ctx.strokeStyle = '#2A2418';
    // 胴体
    ctx.beginPath();
    ctx.ellipse(goatX, goatY - 3, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 首・頭
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(goatX + 6, goatY - 4);
    ctx.lineTo(goatX + 10, goatY - 10 + balance * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(goatX + 10.5, goatY - 12 + balance * 0.3, 3.5, 2.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 鼻と顎ひげ
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(goatX + 13, goatY - 10 + balance * 0.3);
    ctx.lineTo(goatX + 12, goatY - 7 + balance * 0.3);
    ctx.stroke();
    // 角（長い弧を描く）
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(goatX + 8, goatY - 14 + balance * 0.3);
    ctx.quadraticCurveTo(goatX + 5, goatY - 22, goatX + 10, goatY - 24 + balance * 0.2);
    ctx.moveTo(goatX + 10, goatY - 14 + balance * 0.3);
    ctx.quadraticCurveTo(goatX + 13, goatY - 22, goatX + 8, goatY - 24 + balance * 0.2);
    ctx.stroke();
    // 4本の短い太い脚（岩に立つ）
    ctx.lineWidth = 2.5;
    const gLegs = [goatX - 3, goatX, goatX + 4, goatX + 7];
    for (let l = 0; l < 4; l++) {
      const lo = Math.sin(animFrame * 0.025 + l * 0.9) * 0.5;
      ctx.beginPath();
      ctx.moveTo(gLegs[l], goatY + 1);
      ctx.lineTo(gLegs[l], goatY + 7 + lo);
      ctx.stroke();
    }
    // 蹄（小さな三角）
    ctx.fillStyle = '#1A1010';
    for (const lx of gLegs) {
      ctx.beginPath();
      ctx.moveTo(lx - 2, goatY + 7);
      ctx.lineTo(lx + 2, goatY + 7);
      ctx.lineTo(lx, goatY + 10);
      ctx.closePath();
      ctx.fill();
    }
    // しっぽ（短い）
    ctx.globalAlpha = 0.25;
    ctx.fillStyle   = '#E8E0D0';
    ctx.beginPath();
    ctx.ellipse(goatX - 7, goatY - 5, 2, 1.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── リシケシュ: ラフティングの白波 ──
  if (loc === 'rishikesh') {
    const elapsedRaft = animFrame - fieldEnterFrame;
    const raftFadeIn  = Math.min(1, Math.max(0, (elapsedRaft - 500) / 300));
    const raftFadeOut = Math.max(0, 1 - Math.max(0, (elapsedRaft - 2700) / 350));
    const raftAlpha   = raftFadeIn * raftFadeOut * 0.78;
    if (raftAlpha > 0.005) {
      ctx.save();
      // Turbulent white-water rapids in river zone
      const rapidZones = [
        { x: 0.15, y: 0.67, r: 22, phase: 0.0  },
        { x: 0.38, y: 0.72, r: 18, phase: 1.5  },
        { x: 0.58, y: 0.64, r: 25, phase: 0.7  },
        { x: 0.76, y: 0.70, r: 20, phase: 2.2  },
        { x: 0.92, y: 0.68, r: 16, phase: 1.0  },
      ];
      for (const rz of rapidZones) {
        const rx = canvas.width  * rz.x;
        const ry = canvas.height * rz.y;
        // Churn — multiple overlapping foam spots
        const churnT = Math.sin(animFrame * 0.08 + rz.phase) * 0.5 + 0.5;
        for (let ci = 0; ci < 6; ci++) {
          const angle = (ci / 6) * Math.PI * 2 + animFrame * 0.04 + rz.phase;
          const spread = rz.r * (0.3 + ci * 0.12);
          const fx = rx + Math.cos(angle) * spread * 0.7;
          const fy = ry + Math.sin(angle) * spread * 0.35;
          const fr = 4 + ci * 1.5 + churnT * 3;
          const foamA = raftAlpha * (0.5 + churnT * 0.5) * (1 - ci * 0.1);
          ctx.globalAlpha = foamA;
          const foamGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
          foamGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
          foamGrad.addColorStop(0.5, 'rgba(230,245,255,0.6)');
          foamGrad.addColorStop(1, 'rgba(200,230,255,0)');
          ctx.fillStyle = foamGrad;
          ctx.beginPath();
          ctx.ellipse(fx, fy, fr * 1.4, fr * 0.7, angle, 0, Math.PI * 2);
          ctx.fill();
        }
        // Central turbulence core
        ctx.globalAlpha = raftAlpha * churnT * 0.6;
        const coreGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rz.r * 0.7);
        coreGrad.addColorStop(0, 'rgba(255,255,255,0.8)');
        coreGrad.addColorStop(0.5, 'rgba(220,240,255,0.4)');
        coreGrad.addColorStop(1, 'rgba(180,220,255,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(rx, ry, rz.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      // Raft silhouette drifting downstream
      const raftPeriod = 600;
      const raftT = (animFrame % raftPeriod) / raftPeriod;
      const raftX = canvas.width  * (raftT * 1.2 - 0.1);
      const raftY = canvas.height * (0.69 + Math.sin(animFrame * 0.035) * 0.03);
      const raftW = 36;
      const raftH = 10;
      ctx.globalAlpha = raftAlpha * 0.82;
      // Raft body
      ctx.fillStyle = 'rgba(50,120,80,1)';
      ctx.beginPath();
      ctx.ellipse(raftX, raftY, raftW, raftH, 0, 0, Math.PI * 2);
      ctx.fill();
      // Paddlers (tiny silhouettes)
      ctx.fillStyle = 'rgba(30,20,15,1)';
      for (let pi = 0; pi < 3; pi++) {
        const px = raftX - raftW * 0.5 + pi * raftW * 0.42 + raftW * 0.15;
        ctx.beginPath();
        ctx.arc(px, raftY - raftH * 0.8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.rect(px - 1, raftY - raftH * 0.7, 2, 6);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: ガンジスを渡る蝶 ──
  if (loc === 'rishikesh') {
    const elapsedButt = animFrame - fieldEnterFrame;
    const buttFadeIn  = Math.min(1, Math.max(0, (elapsedButt - 400) / 320));
    const buttFadeOut = Math.max(0, 1 - Math.max(0, (elapsedButt - 2600) / 380));
    const buttAlpha   = buttFadeIn * buttFadeOut * 0.80;
    if (buttAlpha > 0.005) {
      ctx.save();
      // Several butterflies crossing the river
      const butterflies = [
        { pathCx: 0.50, pathCy: 0.55, pathRx: 0.38, pathRy: 0.12, period: 340, phaseOff: 0,   wSize: 7, hue: 28  },
        { pathCx: 0.45, pathCy: 0.62, pathRx: 0.30, pathRy: 0.09, period: 280, phaseOff: 100, wSize: 5, hue: 45  },
        { pathCx: 0.55, pathCy: 0.50, pathRx: 0.25, pathRy: 0.10, period: 410, phaseOff: 60,  wSize: 6, hue: 35  },
        { pathCx: 0.40, pathCy: 0.58, pathRx: 0.20, pathRy: 0.07, period: 260, phaseOff: 180, wSize: 4, hue: 55  },
      ];
      for (const bu of butterflies) {
        const t = ((animFrame + bu.phaseOff) % bu.period) / bu.period;
        const angle = t * Math.PI * 2;
        const bx = canvas.width  * (bu.pathCx + Math.cos(angle) * bu.pathRx);
        const by = canvas.height * (bu.pathCy + Math.sin(angle) * bu.pathRy);
        // Body direction
        const dx = -Math.sin(angle) * bu.pathRx;
        const dy =  Math.cos(angle) * bu.pathRy;
        const bodyAng = Math.atan2(dy, dx);
        // Wing flap
        const flapT = Math.sin(animFrame * 0.18 + bu.phaseOff * 0.02);
        const flapOpen = Math.abs(flapT); // 0=closed, 1=open
        const s = bu.wSize;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(bodyAng);
        ctx.globalAlpha = buttAlpha * 0.88;
        // Upper wings
        for (const side of [-1, 1]) {
          const wx = side * s * flapOpen * 1.6;
          const wy = -s * 0.5;
          ctx.fillStyle = 'hsl(' + bu.hue + ',80%,55%)';
          ctx.beginPath();
          ctx.ellipse(wx, wy, s * flapOpen * 1.4, s * 1.0, side * 0.5, 0, Math.PI * 2);
          ctx.fill();
          // Wing pattern dot
          ctx.fillStyle = 'hsl(' + (bu.hue - 10) + ',60%,30%)';
          ctx.globalAlpha = buttAlpha * 0.65;
          ctx.beginPath();
          ctx.ellipse(wx * 0.7, wy - s * 0.2, s * 0.3 * flapOpen, s * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = buttAlpha * 0.88;
        }
        // Lower wings
        for (const side of [-1, 1]) {
          const wx = side * s * flapOpen * 1.1;
          const wy = s * 0.4;
          ctx.fillStyle = 'hsl(' + (bu.hue + 15) + ',75%,60%)';
          ctx.beginPath();
          ctx.ellipse(wx, wy, s * flapOpen * 1.0, s * 0.75, side * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        // Body
        ctx.fillStyle = 'rgba(30,20,10,1)';
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.2, s * 1.0, 0, 0, Math.PI * 2);
        ctx.fill();
        // Antennae
        ctx.strokeStyle = 'rgba(40,25,10,0.8)';
        ctx.lineWidth = 0.8;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side * 1, -s * 0.9);
          ctx.quadraticCurveTo(side * 4, -s * 1.8, side * 6, -s * 2.2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(side * 6, -s * 2.2, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(40,25,10,0.9)';
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 瞑想者の白い息 ──
  if (loc === 'rishikesh') {
    const elapsedBreath = animFrame - fieldEnterFrame;
    const breathFadeIn  = Math.min(1, elapsedBreath / 280);
    const breathFadeOut = Math.max(0, 1 - Math.max(0, (elapsedBreath - 2200) / 380));
    const breathAlpha   = breathFadeIn * breathFadeOut * 0.72;
    if (breathAlpha > 0.005) {
      ctx.save();
      // Two meditators exhaling visible breath puffs
      const sitters = [
        { x: 0.22, y: 0.76, breathCycle: 130, phaseOff: 0   },
        { x: 0.75, y: 0.79, breathCycle: 145, phaseOff: 55  },
      ];
      for (const sit of sitters) {
        const cp = (animFrame + sit.phaseOff) % sit.breathCycle;
        const bt = cp / sit.breathCycle;
        // Only active in exhale phase (first 0.45 of cycle)
        if (bt > 0.45) continue;
        const exhaleT = bt / 0.45; // 0..1 within exhale
        const puffAlpha = (1 - exhaleT * exhaleT) * breathAlpha * 0.7;
        if (puffAlpha < 0.005) continue;
        const originX = canvas.width  * sit.x;
        const originY = canvas.height * sit.y - 12;
        // Puff drifts upward and spreads
        const driftY = exhaleT * 28;
        const puffR  = 4 + exhaleT * 16;
        const puffX  = originX + Math.sin(exhaleT * 3.5 + sit.phaseOff) * 5;
        const puffY  = originY - driftY;
        ctx.globalAlpha = puffAlpha;
        const puffGrad = ctx.createRadialGradient(puffX, puffY, 0, puffX, puffY, puffR);
        puffGrad.addColorStop(0,   'rgba(235,245,255,0.9)');
        puffGrad.addColorStop(0.5, 'rgba(220,235,250,0.5)');
        puffGrad.addColorStop(1,   'rgba(200,220,245,0)');
        ctx.fillStyle = puffGrad;
        ctx.beginPath();
        ctx.ellipse(puffX, puffY, puffR * 1.3, puffR * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        // Secondary smaller trailing puff
        const trail2T = Math.max(0, exhaleT - 0.2);
        if (trail2T > 0) {
          const t2Alpha = puffAlpha * 0.5;
          const t2R     = 3 + trail2T * 10;
          const t2Y     = originY - trail2T * 18;
          ctx.globalAlpha = t2Alpha;
          ctx.beginPath();
          ctx.ellipse(puffX + 3, t2Y, t2R, t2R * 0.75, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 朝靄の川面 ──
  if (loc === 'rishikesh') {
    const elapsedMist = animFrame - fieldEnterFrame;
    const mistFadeIn  = Math.min(1, Math.max(0, (elapsedMist - 0) / 350));
    const mistFadeOut = Math.max(0, 1 - Math.max(0, (elapsedMist - 1800) / 400));
    const mistAlpha   = mistFadeIn * mistFadeOut * 0.72;
    if (mistAlpha > 0.005) {
      ctx.save();
      // Layered mist bands drifting slowly across the river surface
      const mistBands = [
        { y: 0.60, vy: 0.02,  thickness: 0.07, speed: 0.00012, phase: 0.0  },
        { y: 0.67, vy: 0.015, thickness: 0.09, speed: 0.00009, phase: 2.1  },
        { y: 0.74, vy: 0.025, thickness: 0.06, speed: 0.00015, phase: 1.1  },
        { y: 0.80, vy: 0.018, thickness: 0.08, speed: 0.00011, phase: 3.4  },
        { y: 0.87, vy: 0.022, thickness: 0.05, speed: 0.00013, phase: 0.6  },
      ];
      for (const mb of mistBands) {
        // Drift horizontally
        const driftX = (animFrame * mb.speed * canvas.width) % canvas.width;
        const undulate = Math.sin(animFrame * 0.018 + mb.phase) * canvas.height * 0.012;
        const bandY = canvas.height * mb.y + undulate;
        const bandH = canvas.height * mb.thickness;
        // Soft mist layer — two passes for depth
        for (let pass = 0; pass < 2; pass++) {
          const offX = pass === 0 ? -driftX : canvas.width - driftX;
          const mistGrad = ctx.createLinearGradient(0, bandY - bandH * 0.5, 0, bandY + bandH * 0.5);
          mistGrad.addColorStop(0,   'rgba(210,225,235,0)');
          mistGrad.addColorStop(0.35,'rgba(210,225,235,' + (mistAlpha * 0.55).toFixed(3) + ')');
          mistGrad.addColorStop(0.5, 'rgba(220,232,240,' + (mistAlpha * 0.70).toFixed(3) + ')');
          mistGrad.addColorStop(0.65,'rgba(210,225,235,' + (mistAlpha * 0.55).toFixed(3) + ')');
          mistGrad.addColorStop(1,   'rgba(210,225,235,0)');
          ctx.fillStyle = mistGrad;
          ctx.globalAlpha = 1;
          // Wavy edge using a clipping path
          ctx.beginPath();
          const waveAmp = bandH * 0.18;
          const steps   = 16;
          for (let xi = 0; xi <= steps; xi++) {
            const xf = (xi / steps) * canvas.width;
            const wyTop = bandY - bandH * 0.5 + Math.sin(xf * 0.022 + animFrame * 0.015 + mb.phase) * waveAmp;
            if (xi === 0) ctx.moveTo(xf, wyTop);
            else          ctx.lineTo(xf, wyTop);
          }
          for (let xi = steps; xi >= 0; xi--) {
            const xf = (xi / steps) * canvas.width;
            const wyBot = bandY + bandH * 0.5 + Math.sin(xf * 0.019 + animFrame * 0.013 + mb.phase + 1.5) * waveAmp;
            ctx.lineTo(xf, wyBot);
          }
          ctx.closePath();
          ctx.save();
          ctx.clip();
          ctx.fillRect(offX, bandY - bandH, canvas.width, bandH * 2);
          ctx.restore();
        }
      }
      // Soft cool sky reflection tint on river
      ctx.globalAlpha = mistAlpha * 0.25;
      const riverGrad = ctx.createLinearGradient(0, canvas.height * 0.58, 0, canvas.height);
      riverGrad.addColorStop(0, 'rgba(180,210,230,0.6)');
      riverGrad.addColorStop(1, 'rgba(160,195,220,0.2)');
      ctx.fillStyle = riverGrad;
      ctx.fillRect(0, canvas.height * 0.58, canvas.width, canvas.height * 0.42);
      ctx.restore();
    }
  }

  // ── リシケシュ: 渓谷の夜の流星群 ──
  if (loc === 'rishikesh') {
    const elapsedMeteor = animFrame - fieldEnterFrame;
    const meteorFadeIn = Math.min(1, Math.max(0, (elapsedMeteor - 900) / 300));
    const meteorFadeOut = Math.max(0, 1 - Math.max(0, (elapsedMeteor - 2800) / 350));
    const meteorAlpha = meteorFadeIn * meteorFadeOut;
    if (meteorAlpha > 0.005) {
      ctx.save();
      // Night sky deepening gradient
      const nightGrad = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.55);
      nightGrad.addColorStop(0, 'rgba(4,8,28,' + (meteorAlpha * 0.45).toFixed(3) + ')');
      nightGrad.addColorStop(0.6, 'rgba(10,20,50,' + (meteorAlpha * 0.25).toFixed(3) + ')');
      nightGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = nightGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.55);
      // Stars scattered in upper sky
      const starSeeds = [
        { x: 0.08, y: 0.04, r: 0.9 }, { x: 0.21, y: 0.07, r: 1.1 }, { x: 0.35, y: 0.03, r: 0.8 },
        { x: 0.47, y: 0.09, r: 1.2 }, { x: 0.61, y: 0.05, r: 0.9 }, { x: 0.73, y: 0.02, r: 1.0 },
        { x: 0.85, y: 0.08, r: 0.7 }, { x: 0.94, y: 0.04, r: 1.1 }, { x: 0.14, y: 0.14, r: 0.8 },
        { x: 0.29, y: 0.17, r: 0.9 }, { x: 0.53, y: 0.13, r: 1.0 }, { x: 0.68, y: 0.16, r: 0.8 },
        { x: 0.80, y: 0.12, r: 1.1 }, { x: 0.92, y: 0.18, r: 0.7 }, { x: 0.04, y: 0.22, r: 0.9 },
        { x: 0.42, y: 0.20, r: 1.0 }, { x: 0.58, y: 0.23, r: 0.8 }, { x: 0.76, y: 0.19, r: 1.2 }
      ];
      for (const st of starSeeds) {
        const twinkle = 0.6 + Math.sin(animFrame * 0.06 + st.x * 17 + st.y * 11) * 0.4;
        ctx.globalAlpha = meteorAlpha * twinkle * 0.85;
        ctx.fillStyle = 'rgba(220,230,255,1)';
        ctx.beginPath();
        ctx.arc(canvas.width * st.x, canvas.height * st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Meteors — triggered in bursts based on cycle
      const meteorDefs = [
        { cycle: 310, offset: 0,   sx: 0.85, sy: 0.03, angle: 2.4, len: 70, width: 1.4 },
        { cycle: 310, offset: 80,  sx: 0.62, sy: 0.01, angle: 2.6, len: 55, width: 1.1 },
        { cycle: 310, offset: 140, sx: 0.40, sy: 0.06, angle: 2.3, len: 80, width: 1.6 },
        { cycle: 460, offset: 30,  sx: 0.91, sy: 0.02, angle: 2.5, len: 60, width: 1.2 },
        { cycle: 460, offset: 200, sx: 0.72, sy: 0.08, angle: 2.7, len: 45, width: 1.0 },
      ];
      for (const m of meteorDefs) {
        const cp = (animFrame + m.offset) % m.cycle;
        const mt = cp / 24; // duration 24 frames
        if (mt < 1) {
          const mSx = canvas.width * m.sx;
          const mSy = canvas.height * m.sy;
          const mEx = mSx + Math.cos(m.angle) * m.len * mt;
          const mEy = mSy + Math.sin(m.angle) * m.len * mt;
          const trailAlpha = (1 - mt) * meteorAlpha * 0.9;
          ctx.globalAlpha = trailAlpha;
          const mGrad = ctx.createLinearGradient(mSx, mSy, mEx, mEy);
          mGrad.addColorStop(0, 'rgba(255,255,255,0)');
          mGrad.addColorStop(0.3, 'rgba(200,220,255,0.5)');
          mGrad.addColorStop(1, 'rgba(255,255,255,1)');
          ctx.strokeStyle = mGrad;
          ctx.lineWidth = m.width;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(mSx, mSy);
          ctx.lineTo(mEx, mEy);
          ctx.stroke();
          // Bright head
          ctx.globalAlpha = (1 - mt * 0.5) * meteorAlpha * 0.95;
          const headGrad = ctx.createRadialGradient(mEx, mEy, 0, mEx, mEy, 3);
          headGrad.addColorStop(0, 'rgba(255,255,255,1)');
          headGrad.addColorStop(0.5, 'rgba(180,210,255,0.6)');
          headGrad.addColorStop(1, 'rgba(120,160,255,0)');
          ctx.fillStyle = headGrad;
          ctx.beginPath();
          ctx.arc(mEx, mEy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 川岸の竹の茂み ──
  if (loc === 'rishikesh') {
    const elapsedBamboo = animFrame - fieldEnterFrame;
    const bambooAlpha = Math.min(1, elapsedBamboo / 260) * 0.78;
    if (bambooAlpha > 0) {
      ctx.save();
      // Cluster of bamboo stalks by the river bank
      const clusterX = canvas.width * 0.06;
      const clusterY = canvas.height * 0.82;
      const stalkCount = 9;
      for (let si = 0; si < stalkCount; si++) {
        const sx = clusterX + si * 7 + Math.sin(si * 0.8) * 5;
        const sHeight = canvas.height * (0.35 + (si % 3) * 0.04);
        const sway = Math.sin(animFrame * 0.022 + si * 0.6) * (4 + si * 0.5);
        const stalkH = 2.5 - si * 0.1;
        // Draw segmented stalk
        const segments = 7;
        ctx.strokeStyle = si % 3 === 0 ? '#5a8a30' : si % 3 === 1 ? '#6a9a38' : '#4a7828';
        ctx.lineWidth = Math.max(1, stalkH);
        ctx.lineCap = 'round';
        for (let seg = 0; seg < segments; seg++) {
          const segT0 = seg / segments;
          const segT1 = (seg + 1) / segments;
          const x0 = sx + sway * segT0 * segT0;
          const y0 = clusterY - sHeight * segT0;
          const x1 = sx + sway * segT1 * segT1;
          const y1 = clusterY - sHeight * segT1;
          ctx.globalAlpha = bambooAlpha * (0.7 + Math.sin(si * 0.6) * 0.2);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          // Segment node (joint)
          ctx.strokeStyle = si % 3 === 0 ? '#487020' : '#386018';
          ctx.lineWidth = Math.max(1, stalkH + 0.5);
          ctx.beginPath();
          ctx.moveTo(x1 - 2, y1);
          ctx.lineTo(x1 + 2, y1);
          ctx.stroke();
          ctx.strokeStyle = si % 3 === 0 ? '#5a8a30' : '#6a9a38';
          ctx.lineWidth = Math.max(1, stalkH);
        }
        // Leaf clusters at top
        const leafT = sway * 1.5;
        const leafTip = { x: sx + sway, y: clusterY - sHeight };
        for (let li = 0; li < 3; li++) {
          const la = -Math.PI * 0.5 + (li - 1) * 0.45;
          const leafLen = 18 + li * 4;
          const leafEndX = leafTip.x + Math.cos(la) * leafLen + leafT * 0.5;
          const leafEndY = leafTip.y + Math.sin(la) * leafLen * 0.4;
          ctx.globalAlpha = bambooAlpha * 0.65;
          ctx.strokeStyle = '#3a7020';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(leafTip.x, leafTip.y);
          ctx.quadraticCurveTo(
            (leafTip.x + leafEndX) / 2 + leafT * 0.3,
            (leafTip.y + leafEndY) / 2 - 5,
            leafEndX, leafEndY
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 急流の白波 ──
  if (loc === 'rishikesh') {
    const elapsedRapid = animFrame - fieldEnterFrame;
    const rapidAlpha = Math.min(1, elapsedRapid / 200) * 0.7;
    if (rapidAlpha > 0) {
      ctx.save();
      // Whitewater rapids: churning foam and standing waves
      const rapidZones = [
        { x: 0.12, y: 0.66, w: 0.15, speed: 1.2 },
        { x: 0.45, y: 0.64, w: 0.18, speed: 1.5 },
        { x: 0.75, y: 0.67, w: 0.13, speed: 1.1 },
      ];
      for (const rz of rapidZones) {
        const rx0 = canvas.width * rz.x;
        const ry = canvas.height * rz.y;
        const rw = canvas.width * rz.w;
        // Standing wave crests
        for (let wc = 0; wc < 4; wc++) {
          const wcX = rx0 + wc * (rw / 4);
          const wcY = ry + Math.sin(animFrame * rz.speed * 0.08 + wc * 0.9) * 4;
          ctx.globalAlpha = rapidAlpha * 0.5;
          ctx.fillStyle = 'rgba(200,230,245,0.7)';
          ctx.beginPath();
          ctx.ellipse(wcX, wcY, rw * 0.08, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Foam blobs churning
        const foamCount = 12;
        for (let fm = 0; fm < foamCount; fm++) {
          const fmPhase = ((animFrame * rz.speed * 0.5 + fm * 18) % 40) / 40;
          const fmX = rx0 + (fmPhase * rw * 1.3) + Math.sin(animFrame * 0.1 + fm) * 6;
          const fmY = ry + Math.sin(animFrame * 0.12 + fm * 0.8) * 6;
          const fmR = 3 + (fm % 3) * 1.5;
          ctx.globalAlpha = rapidAlpha * (1 - fmPhase) * 0.55;
          ctx.fillStyle = 'rgba(240,248,255,0.8)';
          ctx.beginPath();
          ctx.arc(fmX, fmY, fmR, 0, Math.PI * 2);
          ctx.fill();
        }
        // Spray mist above rapid
        ctx.globalAlpha = rapidAlpha * 0.2;
        const sprayGrad = ctx.createLinearGradient(0, ry - 15, 0, ry + 5);
        sprayGrad.addColorStop(0, 'rgba(220,235,245,0)');
        sprayGrad.addColorStop(1, 'rgba(220,235,245,' + (rapidAlpha * 0.3).toFixed(3) + ')');
        ctx.fillStyle = sprayGrad;
        ctx.beginPath();
        ctx.ellipse(rx0 + rw * 0.5, ry - 8, rw * 0.6, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 朝霧の樹木 ──
  if (loc === 'rishikesh') {
    const elapsedMistyTree = animFrame - fieldEnterFrame;
    const mtIn = Math.min(1, elapsedMistyTree / 200);
    const mtOut = Math.max(0, 1 - (elapsedMistyTree - 900) / 400);
    const mtAlpha = mtIn * mtOut * 0.55;
    if (mtAlpha > 0.005) {
      ctx.save();
      // Misty silhouettes of trees on the far bank, partially obscured
      const trees = [
        { x: 0.05, y: 0.5,  h: 0.18, w: 0.04 },
        { x: 0.14, y: 0.47, h: 0.22, w: 0.05 },
        { x: 0.26, y: 0.51, h: 0.15, w: 0.035 },
        { x: 0.38, y: 0.48, h: 0.20, w: 0.045 },
        { x: 0.52, y: 0.52, h: 0.16, w: 0.038 },
        { x: 0.64, y: 0.49, h: 0.19, w: 0.042 },
        { x: 0.75, y: 0.5,  h: 0.14, w: 0.032 },
        { x: 0.86, y: 0.47, h: 0.21, w: 0.048 },
        { x: 0.95, y: 0.51, h: 0.16, w: 0.036 },
      ];
      for (const tr of trees) {
        const tx = canvas.width * tr.x;
        const ty = canvas.height * tr.y;
        const th = canvas.height * tr.h;
        const tw = canvas.width * tr.w;
        // Mist-blurred trunk
        ctx.globalAlpha = mtAlpha * 0.5;
        const trGrad = ctx.createLinearGradient(tx, ty, tx, ty - th);
        trGrad.addColorStop(0, 'rgba(50,55,65,0.3)');
        trGrad.addColorStop(0.6, 'rgba(60,65,75,0.5)');
        trGrad.addColorStop(1, 'rgba(70,75,85,0)');
        ctx.fillStyle = trGrad;
        ctx.beginPath();
        ctx.ellipse(tx, ty - th * 0.5, tw * 0.3, th * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Crown
        ctx.globalAlpha = mtAlpha * 0.45;
        ctx.fillStyle = 'rgba(50,65,55,0.4)';
        ctx.beginPath();
        ctx.ellipse(tx, ty - th, tw, th * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Mist layer over trees
      ctx.globalAlpha = mtAlpha * 0.5;
      const mistLayer = ctx.createLinearGradient(0, canvas.height * 0.42, 0, canvas.height * 0.58);
      mistLayer.addColorStop(0, 'rgba(200,210,215,0)');
      mistLayer.addColorStop(0.5, 'rgba(200,210,215,' + (mtAlpha * 0.5).toFixed(3) + ')');
      mistLayer.addColorStop(1, 'rgba(200,210,215,0)');
      ctx.fillStyle = mistLayer;
      ctx.fillRect(0, canvas.height * 0.42, canvas.width, canvas.height * 0.16);
      ctx.restore();
    }
  }

  // ── リシケシュ: 川のカワセミ ──
  if (loc === 'rishikesh') {
    const elapsedKF = animFrame - fieldEnterFrame;
    const kfAlpha = Math.min(1, elapsedKF / 220) * 0.85;
    if (kfAlpha > 0) {
      ctx.save();
      // Kingfisher on a branch, periodically diving into the river
      const diveCycle = 200;
      const divePhase = animFrame % diveCycle;
      const isPerched = divePhase > 40;
      const perchX = canvas.width * 0.58;
      const perchY = canvas.height * 0.52;
      const riverY = canvas.height * 0.72;
      if (isPerched) {
        // Perch branch
        ctx.globalAlpha = kfAlpha * 0.5;
        ctx.strokeStyle = '#6a4a20';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(perchX - 18, perchY + 6);
        ctx.lineTo(perchX + 18, perchY + 6);
        ctx.stroke();
        // Kingfisher body (perched)
        ctx.globalAlpha = kfAlpha;
        ctx.fillStyle = '#1860c0'; // Blue back
        ctx.beginPath();
        ctx.ellipse(perchX, perchY, 7, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e08030'; // Orange breast
        ctx.beginPath();
        ctx.ellipse(perchX, perchY + 1, 5, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#102080'; // Dark wing
        ctx.beginPath();
        ctx.ellipse(perchX - 1, perchY - 2, 6, 4, -0.2, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.fillStyle = '#102080';
        ctx.beginPath();
        ctx.arc(perchX + 5, perchY - 3, 4.5, 0, Math.PI * 2);
        ctx.fill();
        // Bill
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.moveTo(perchX + 8, perchY - 3);
        ctx.lineTo(perchX + 16, perchY - 3.5);
        ctx.lineTo(perchX + 8, perchY - 2);
        ctx.closePath();
        ctx.fill();
        // Eye
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(perchX + 6.5, perchY - 4, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Diving: arc from perch down to river
        const diveT = divePhase / 40;
        const diveX = perchX + Math.sin(diveT * Math.PI * 0.5) * 20;
        const diveY = perchY + diveT * diveT * (riverY - perchY);
        const diveAngle = Math.atan2(riverY - perchY, 20) * diveT;
        ctx.globalAlpha = kfAlpha * 0.9;
        ctx.save();
        ctx.translate(diveX, diveY);
        ctx.rotate(diveAngle);
        // Body as ellipse in dive orientation
        ctx.fillStyle = '#1860c0';
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e08030';
        ctx.beginPath();
        ctx.ellipse(0, 1, 5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Bill pointing down
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(14, 0);
        ctx.lineTo(7, 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Splash if hitting water
        if (diveT > 0.85) {
          const splashIntensity = (diveT - 0.85) / 0.15;
          ctx.globalAlpha = kfAlpha * splashIntensity * 0.6;
          ctx.fillStyle = 'rgba(160,200,220,0.5)';
          for (let sp = 0; sp < 5; sp++) {
            const sa = (sp / 5) * Math.PI;
            ctx.beginPath();
            ctx.ellipse(diveX + Math.cos(sa) * 8 * splashIntensity, riverY - 3 + Math.sin(sa) * 4 * splashIntensity, 2, 2, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 谷の風に舞う葉 ──
  if (loc === 'rishikesh') {
    const elapsedWindLeaf = animFrame - fieldEnterFrame;
    const wlAlpha = Math.min(1, elapsedWindLeaf / 200) * 0.75;
    if (wlAlpha > 0) {
      ctx.save();
      // Leaves blown by valley wind, tumbling across the scene
      const leafCount = 14;
      for (let li = 0; li < leafCount; li++) {
        const windCycle = 300 + li * 22;
        const progress = ((animFrame * (0.4 + li * 0.03) + li * 60) % windCycle) / windCycle;
        const lx = canvas.width * (1.1 - progress * 1.25);
        const ly = canvas.height * (0.4 + (li % 6) * 0.07) + Math.sin(animFrame * 0.05 + li * 0.8) * 12;
        const lRot = progress * Math.PI * 8 + li * 0.5;
        const hue = li % 4 === 0 ? 30 : li % 4 === 1 ? 40 : li % 4 === 2 ? 100 : 50;
        const saturation = 60 + (li % 3) * 10;
        const lightness = 38 + (li % 4) * 7;
        ctx.globalAlpha = wlAlpha * (0.6 + Math.sin(li * 0.8) * 0.3) * (1 - progress * 0.3);
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(lRot);
        // Leaf shape
        ctx.fillStyle = 'hsl(' + hue + ',' + saturation + '%,' + lightness + '%)';
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.quadraticCurveTo(5, -2, 4, 4);
        ctx.quadraticCurveTo(0, 6, -4, 4);
        ctx.quadraticCurveTo(-5, -2, 0, -5);
        ctx.fill();
        // Center vein
        ctx.strokeStyle = 'hsla(' + hue + ',40%,25%,0.4)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.lineTo(0, 5);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 菩提樹の葉の揺れ ──
  if (loc === 'rishikesh') {
    const elapsedBodhi = animFrame - fieldEnterFrame;
    const bodhiAlpha = Math.min(1, elapsedBodhi / 280) * 0.75;
    if (bodhiAlpha > 0) {
      ctx.save();
      // Sacred Bodhi tree with heart-shaped leaves trembling
      const treeX = canvas.width * 0.84;
      const treeY = canvas.height * 0.68;
      // Trunk
      ctx.globalAlpha = bodhiAlpha * 0.8;
      ctx.fillStyle = '#5a3a18';
      ctx.beginPath();
      ctx.moveTo(treeX - 6, treeY);
      ctx.quadraticCurveTo(treeX - 4, treeY - 20, treeX - 2, treeY - 35);
      ctx.quadraticCurveTo(treeX + 2, treeY - 35, treeX + 4, treeY - 20);
      ctx.quadraticCurveTo(treeX + 6, treeY, treeX - 6, treeY);
      ctx.fill();
      // Branches and leaves (canopy)
      const leafCount = 24;
      for (let li = 0; li < leafCount; li++) {
        const branchAngle = (li / leafCount) * Math.PI * 2;
        const branchLen = 18 + (li % 4) * 5;
        const leafX = treeX + Math.cos(branchAngle) * branchLen * 0.5;
        const leafY = treeY - 35 + Math.sin(branchAngle) * branchLen * 0.4 - branchLen * 0.3;
        const leafSway = Math.sin(animFrame * 0.04 + li * 0.7) * 4;
        const leafRot = branchAngle + leafSway * 0.1;
        const leafW = 5 + (li % 3) * 2;
        const leafH = 8 + (li % 3) * 2;
        // Leaf (heart-shaped approximation with ellipse + point)
        ctx.globalAlpha = bodhiAlpha * (0.6 + Math.sin(li * 0.5) * 0.2);
        ctx.fillStyle = li % 5 === 0 ? '#3a8030' : li % 4 === 0 ? '#508040' : '#407035';
        ctx.save();
        ctx.translate(leafX + leafSway, leafY);
        ctx.rotate(leafRot);
        ctx.beginPath();
        ctx.ellipse(0, 0, leafW * 0.5, leafH * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Drip tip
        ctx.beginPath();
        ctx.moveTo(-leafW * 0.2, leafH * 0.4);
        ctx.lineTo(0, leafH * 0.75);
        ctx.lineTo(leafW * 0.2, leafH * 0.4);
        ctx.closePath();
        ctx.fill();
        // Leaf vein
        ctx.strokeStyle = 'rgba(60,100,50,0.4)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, -leafH * 0.4);
        ctx.lineTo(0, leafH * 0.7);
        ctx.stroke();
        ctx.restore();
      }
      // Sacred dot of light at crown
      ctx.globalAlpha = bodhiAlpha * 0.4;
      const auraGrad = ctx.createRadialGradient(treeX, treeY - 50, 0, treeX, treeY - 50, 18);
      auraGrad.addColorStop(0, 'rgba(255,240,180,0.5)');
      auraGrad.addColorStop(1, 'rgba(255,220,100,0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(treeX, treeY - 50, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── リシケシュ: 川向こうの山のシルエット ──
  if (loc === 'rishikesh') {
    const elapsedMtn = animFrame - fieldEnterFrame;
    const mtnAlpha = Math.min(1, elapsedMtn / 300) * 0.55;
    if (mtnAlpha > 0) {
      ctx.save();
      // Layered mountain silhouettes visible across the Ganges
      const layers = [
        { y: 0.28, peaks: [0.05, 0.18, 0.32, 0.48, 0.62, 0.78, 0.92, 1.02], h: 0.12, color: 'rgba(40,50,70,0.6)' },
        { y: 0.22, peaks: [0.10, 0.28, 0.45, 0.65, 0.82, 1.05], h: 0.10, color: 'rgba(55,65,85,0.45)' },
        { y: 0.16, peaks: [0.15, 0.38, 0.58, 0.80, 1.0], h: 0.09, color: 'rgba(70,80,100,0.3)' },
      ];
      for (const layer of layers) {
        const baseY = canvas.height * layer.y;
        const layerH = canvas.height * layer.h;
        ctx.globalAlpha = mtnAlpha;
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.moveTo(0, baseY + layerH);
        // Draw mountain ridge line through peaks
        let lastX = 0, lastY = baseY + layerH;
        for (let pi = 0; pi < layer.peaks.length; pi++) {
          const peakX = canvas.width * layer.peaks[pi];
          const peakY = baseY - layerH * (0.4 + Math.sin(pi * 1.1 + layer.y * 10) * 0.3);
          const valX = (lastX + peakX) / 2;
          const valY = baseY + layerH * 0.1;
          ctx.quadraticCurveTo(valX, valY, peakX, peakY);
          lastX = peakX; lastY = peakY;
        }
        ctx.lineTo(canvas.width, baseY + layerH);
        ctx.closePath();
        ctx.fill();
        // Snow caps on tallest peaks
        if (layer.y < 0.2) {
          ctx.fillStyle = 'rgba(240,245,255,' + (mtnAlpha * 0.4).toFixed(3) + ')';
          for (const peakX of layer.peaks.slice(0, 4)) {
            const px = canvas.width * peakX;
            const py = baseY - layerH * 0.7;
            ctx.beginPath();
            ctx.ellipse(px, py, 8, 4, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 川を漂う花弁 ──
  if (loc === 'rishikesh') {
    const elapsedPetal = animFrame - fieldEnterFrame;
    const petalAlpha = Math.min(1, elapsedPetal / 200) * 0.8;
    if (petalAlpha > 0) {
      ctx.save();
      const petalCount = 16;
      for (let pi = 0; pi < petalCount; pi++) {
        // Each petal drifts downstream at a different speed
        const driftSpeed = 0.35 + (pi % 5) * 0.08;
        const startOffset = pi * 70;
        const progress = ((animFrame * driftSpeed + startOffset) % (canvas.width + 40)) / (canvas.width + 40);
        const px = canvas.width * (1.05 - progress * 1.15);
        const py = canvas.height * (0.65 + (pi % 5) * 0.04) + Math.sin(animFrame * 0.025 + pi * 0.8) * 4;
        // Petal rotation as it spins in the current
        const rot = animFrame * 0.02 + pi * 0.6;
        // Color: pink/white/yellow
        const hue = pi % 3 === 0 ? 340 : pi % 3 === 1 ? 50 : 320;
        ctx.globalAlpha = petalAlpha * (0.6 + Math.sin(pi * 0.7) * 0.3);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.fillStyle = 'hsl(' + hue + ',70%,80%)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // Vein
        ctx.strokeStyle = 'hsla(' + hue + ',50%,65%,0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.stroke();
        // Reflection ripple under petal
        ctx.restore();
        ctx.globalAlpha = petalAlpha * 0.2;
        ctx.strokeStyle = 'rgba(120,170,200,0.5)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(px, py + 3, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 川面の水スケーター ──
  if (loc === 'rishikesh') {
    const elapsedStrider = animFrame - fieldEnterFrame;
    const striderAlpha = Math.min(1, elapsedStrider / 220) * 0.75;
    if (striderAlpha > 0) {
      ctx.save();
      const striderCount = 8;
      for (let wi = 0; wi < striderCount; wi++) {
        const homeX = canvas.width * (0.08 + wi * 0.11);
        const homeY = canvas.height * (0.68 + (wi % 3) * 0.035);
        const driftX = Math.sin(animFrame * 0.016 + wi * 1.2) * 18;
        const driftY = Math.cos(animFrame * 0.011 + wi * 0.9) * 5;
        const wx = homeX + driftX;
        const wy = homeY + driftY;
        ctx.globalAlpha = striderAlpha * 0.8;
        // Dimple reflections on water (4 leg contact points)
        const dimpleR = 3.5 + Math.sin(animFrame * 0.05 + wi) * 0.5;
        const legSpread = 9 + wi * 0.5;
        ctx.strokeStyle = 'rgba(80,140,180,0.5)';
        ctx.lineWidth = 0.8;
        const legPositions = [
          { ox: -legSpread, oy: -3 },
          { ox: -legSpread, oy: 3 },
          { ox: legSpread,  oy: -3 },
          { ox: legSpread,  oy: 3 },
        ];
        for (const lp of legPositions) {
          const dimX = wx + lp.ox;
          const dimY = wy + lp.oy;
          // Shadow dimple ring
          ctx.beginPath();
          ctx.ellipse(dimX, dimY, dimpleR, dimpleR * 0.4, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(60,120,160,0.15)';
          ctx.beginPath();
          ctx.ellipse(dimX, dimY, dimpleR * 0.6, dimpleR * 0.25, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Strider body
        ctx.fillStyle = '#2a2a20';
        ctx.beginPath();
        ctx.ellipse(wx, wy, 6, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Front & back legs (thin lines)
        ctx.strokeStyle = '#1a1a15';
        ctx.lineWidth = 0.8;
        for (const lp of legPositions) {
          ctx.beginPath();
          ctx.moveTo(wx + lp.ox * 0.3, wy + lp.oy * 0.5);
          ctx.lineTo(wx + lp.ox, wy + lp.oy);
          ctx.stroke();
        }
        // Antennae
        ctx.beginPath();
        ctx.moveTo(wx + 6, wy - 1);
        ctx.lineTo(wx + 11, wy - 4);
        ctx.moveTo(wx + 6, wy + 1);
        ctx.lineTo(wx + 11, wy + 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 遠くの稲妻 ──
  if (loc === 'rishikesh') {
    const elapsedLightning = animFrame - fieldEnterFrame;
    if (elapsedLightning >= 1800) {
      const ltAlpha = Math.min(1, (elapsedLightning - 1800) / 300) * 0.7;
      ctx.save();
      // Lightning bolt flashes randomly over distant mountains
      const ltCycle = 180;
      const ltPhase = animFrame % ltCycle;
      // Flash happens in a narrow window each cycle
      if (ltPhase < 8 || (ltPhase > 90 && ltPhase < 95)) {
        const flashIntensity = ltPhase < 8 ?
          Math.sin(ltPhase / 8 * Math.PI) :
          Math.sin((ltPhase - 90) / 5 * Math.PI);
        ctx.globalAlpha = ltAlpha * flashIntensity * 0.6;
        // Sky flash
        const flashGrad = ctx.createRadialGradient(canvas.width * 0.25, 0, 0, canvas.width * 0.25, 0, canvas.width * 0.6);
        flashGrad.addColorStop(0, 'rgba(200,210,255,0.5)');
        flashGrad.addColorStop(1, 'rgba(180,190,240,0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height * 0.45);
        // Lightning bolt
        ctx.globalAlpha = ltAlpha * flashIntensity * 0.9;
        ctx.strokeStyle = 'rgba(200,215,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const boltX = canvas.width * 0.22;
        ctx.moveTo(boltX, canvas.height * 0.04);
        ctx.lineTo(boltX - 5, canvas.height * 0.14);
        ctx.lineTo(boltX + 3, canvas.height * 0.14);
        ctx.lineTo(boltX - 4, canvas.height * 0.26);
        ctx.stroke();
        // Glow around bolt
        ctx.strokeStyle = 'rgba(180,200,255,0.3)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(boltX, canvas.height * 0.04);
        ctx.lineTo(boltX - 5, canvas.height * 0.14);
        ctx.lineTo(boltX + 3, canvas.height * 0.14);
        ctx.lineTo(boltX - 4, canvas.height * 0.26);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 木漏れ日 ──
  if (loc === 'rishikesh') {
    const elapsedKomorebi = animFrame - fieldEnterFrame;
    const komIn = Math.min(1, Math.max(0, (elapsedKomorebi - 100) / 300));
    const komOut = Math.max(0, 1 - (elapsedKomorebi - 1800) / 400);
    const komAlpha = komIn * komOut * 0.5;
    if (komAlpha > 0.005) {
      ctx.save();
      // Dappled sunlight patches moving slowly on the ground
      const patches = 14;
      for (let pi = 0; pi < patches; pi++) {
        const baseX = canvas.width * (0.04 + (pi % 7) * 0.14);
        const baseY = canvas.height * (0.6 + Math.floor(pi / 7) * 0.15);
        const drift = Math.sin(animFrame * 0.02 + pi * 1.1) * 10;
        const driftY = Math.cos(animFrame * 0.015 + pi * 0.8) * 6;
        const px = baseX + drift;
        const py = baseY + driftY;
        const pr = 8 + (pi % 3) * 4;
        const twinkle = (Math.sin(animFrame * 0.04 + pi * 0.9) + 1) / 2;
        ctx.globalAlpha = komAlpha * (0.5 + twinkle * 0.4);
        const pGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
        pGrad.addColorStop(0, 'rgba(255,240,180,0.8)');
        pGrad.addColorStop(0.5, 'rgba(255,220,140,0.4)');
        pGrad.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.ellipse(px, py, pr, pr * 0.7, Math.sin(pi * 0.5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Leaf shadow silhouettes (dark patches between light)
      for (let ls = 0; ls < 8; ls++) {
        const lsx = canvas.width * (0.1 + ls * 0.12);
        const lsy = canvas.height * (0.55 + (ls % 3) * 0.08);
        const lsDrift = Math.sin(animFrame * 0.022 + ls * 1.3) * 8;
        ctx.globalAlpha = komAlpha * 0.25;
        ctx.fillStyle = 'rgba(20,40,20,0.4)';
        ctx.beginPath();
        ctx.ellipse(lsx + lsDrift, lsy, 12, 6, ls * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 川面の飛び石 ──
  if (loc === 'rishikesh') {
    const elapsedStone = animFrame - fieldEnterFrame;
    const stoneAlpha = Math.min(1, elapsedStone / 250) * 0.8;
    if (stoneAlpha > 0) {
      ctx.save();
      // Row of stepping stones across the river
      const stoneCount = 7;
      for (let si = 0; si < stoneCount; si++) {
        const sx = canvas.width * (0.15 + si * 0.11);
        const sy = canvas.height * (0.7 + Math.sin(si * 0.7) * 0.025);
        const stoneW = 10 + (si % 3) * 4;
        const stoneH = 5 + (si % 2) * 2;
        // Water ripple around each stone
        for (let ring = 0; ring < 3; ring++) {
          const ringT = ((animFrame * 0.5 + si * 20 + ring * 15) % 40) / 40;
          const ringR = ringT * 14;
          const ringA = stoneAlpha * (1 - ringT) * 0.3;
          if (ringA < 0.01) continue;
          ctx.globalAlpha = ringA;
          ctx.strokeStyle = 'rgba(120,170,200,0.7)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.ellipse(sx, sy + stoneH * 0.5, ringR, ringR * 0.4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Stone body
        ctx.globalAlpha = stoneAlpha;
        const stGrad = ctx.createRadialGradient(sx - stoneW * 0.2, sy - stoneH * 0.2, 0, sx, sy, stoneW);
        stGrad.addColorStop(0, '#a09080');
        stGrad.addColorStop(0.6, '#7a6858');
        stGrad.addColorStop(1, '#5a4840');
        ctx.fillStyle = stGrad;
        ctx.beginPath();
        ctx.ellipse(sx, sy, stoneW, stoneH, (si % 3 - 1) * 0.15, 0, Math.PI * 2);
        ctx.fill();
        // Wet mossy highlight
        ctx.globalAlpha = stoneAlpha * 0.35;
        ctx.fillStyle = '#60a070';
        ctx.beginPath();
        ctx.ellipse(sx, sy - stoneH * 0.15, stoneW * 0.5, stoneH * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 渓谷の朝日 ──
  if (loc === 'rishikesh') {
    const elapsedMorSun = animFrame - fieldEnterFrame;
    const sunIn = Math.min(1, Math.max(0, (elapsedMorSun - 80) / 250));
    const sunOut = Math.max(0, 1 - (elapsedMorSun - 700) / 350);
    const sunAlpha = sunIn * sunOut * 0.55;
    if (sunAlpha > 0.005) {
      ctx.save();
      // Morning sun breaking over the canyon ridge (top-right)
      const sunSourceX = canvas.width * 0.92;
      const sunSourceY = canvas.height * 0.05;
      // Fan of light rays spreading into the valley
      const rayCount = 7;
      for (let ri = 0; ri < rayCount; ri++) {
        const rayAngle = Math.PI * (0.55 + ri * 0.065);
        const rayLen = canvas.height * (0.7 + ri * 0.04);
        const rayW = 0.04 + Math.sin(animFrame * 0.018 + ri * 0.7) * 0.015;
        const endX = sunSourceX + Math.cos(rayAngle) * rayLen;
        const endY = sunSourceY + Math.sin(rayAngle) * rayLen;
        const grad = ctx.createLinearGradient(sunSourceX, sunSourceY, endX, endY);
        grad.addColorStop(0, 'rgba(255,230,140,' + (sunAlpha * 0.7).toFixed(3) + ')');
        grad.addColorStop(0.3, 'rgba(255,210,100,' + (sunAlpha * 0.35).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(255,190,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        const halfAngle = rayW;
        ctx.moveTo(sunSourceX, sunSourceY);
        ctx.lineTo(
          sunSourceX + Math.cos(rayAngle - halfAngle) * rayLen,
          sunSourceY + Math.sin(rayAngle - halfAngle) * rayLen
        );
        ctx.lineTo(
          sunSourceX + Math.cos(rayAngle + halfAngle) * rayLen,
          sunSourceY + Math.sin(rayAngle + halfAngle) * rayLen
        );
        ctx.closePath();
        ctx.fill();
      }
      // Sun orb glow
      ctx.globalAlpha = sunAlpha * 0.8;
      const sunGlow = ctx.createRadialGradient(sunSourceX, sunSourceY, 0, sunSourceX, sunSourceY, 35);
      sunGlow.addColorStop(0, 'rgba(255,250,200,0.95)');
      sunGlow.addColorStop(0.3, 'rgba(255,230,120,0.6)');
      sunGlow.addColorStop(1, 'rgba(255,200,60,0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(sunSourceX, sunSourceY, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── リシケシュ: 川岸の鹿 ──
  if (loc === 'rishikesh') {
    const elapsedDeer = animFrame - fieldEnterFrame;
    const deerAlpha = Math.min(1, elapsedDeer / 220) * 0.85;
    if (deerAlpha > 0) {
      ctx.save();
      // Two deer grazing by the river bank
      const deer = [
        { x: 0.22, y: 0.71, scale: 1.0, phase: 0 },
        { x: 0.34, y: 0.74, scale: 0.82, phase: 0.8 },
      ];
      for (const d of deer) {
        const dx = canvas.width * d.x + Math.sin(animFrame * 0.008 + d.phase) * 5;
        const dy = canvas.height * d.y;
        const s = d.scale;
        // Head alternates grazing (down) and alert (up)
        const graze = Math.sin(animFrame * 0.035 + d.phase) * 0.5 + 0.5;
        const neckAngle = -Math.PI * 0.35 + graze * Math.PI * 0.4;
        ctx.globalAlpha = deerAlpha;
        ctx.fillStyle = '#8b5a2a';
        // Body
        ctx.beginPath();
        ctx.ellipse(dx, dy, 16 * s, 9 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        // Neck
        const neckLen = 12 * s;
        const neckX = dx + 12 * s;
        const neckY = dy - 6 * s;
        const headX = neckX + Math.cos(neckAngle) * neckLen;
        const headY = neckY + Math.sin(neckAngle) * neckLen;
        ctx.strokeStyle = '#8b5a2a';
        ctx.lineWidth = 5 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(neckX, neckY);
        ctx.lineTo(headX, headY);
        ctx.stroke();
        // Head
        ctx.fillStyle = '#7a4a20';
        ctx.beginPath();
        ctx.ellipse(headX, headY, 6 * s, 4.5 * s, neckAngle - 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Ear
        ctx.fillStyle = '#c87040';
        ctx.beginPath();
        ctx.ellipse(headX - 2 * s, headY - 6 * s, 2.5 * s, 4 * s, -0.3, 0, Math.PI * 2);
        ctx.fill();
        // Legs
        ctx.strokeStyle = '#6a3a18';
        ctx.lineWidth = 2.5 * s;
        ctx.lineCap = 'round';
        const legSwingD = Math.sin(animFrame * 0.05 + d.phase) * 4 * s;
        [[-8, 1], [-4, -1], [4, 1], [8, -1]].forEach(([lx, phase]) => {
          ctx.beginPath();
          ctx.moveTo(dx + lx * s, dy + 8 * s);
          ctx.lineTo(dx + lx * s + legSwingD * phase, dy + 20 * s);
          ctx.stroke();
        });
        // White belly patch
        ctx.fillStyle = 'rgba(255,240,220,0.5)';
        ctx.beginPath();
        ctx.ellipse(dx - 2 * s, dy + 3 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        // Antlers (for larger deer)
        if (s > 0.9) {
          ctx.strokeStyle = '#5a3010';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(headX - 1, headY - 4);
          ctx.lineTo(headX - 5, headY - 14);
          ctx.lineTo(headX - 9, headY - 10);
          ctx.moveTo(headX - 5, headY - 14);
          ctx.lineTo(headX - 2, headY - 18);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 瞑想する人影 ──
  if (loc === 'rishikesh') {
    const elapsedMed = animFrame - fieldEnterFrame;
    const medAlpha = Math.min(1, elapsedMed / 300) * 0.8;
    if (medAlpha > 0) {
      ctx.save();
      // Meditating figure seated by the river
      const mx = canvas.width * 0.78;
      const my = canvas.height * 0.74;
      // Aura glow that pulses with breath
      const breathe = (Math.sin(animFrame * 0.025) + 1) / 2;
      const auraR = 22 + breathe * 8;
      ctx.globalAlpha = medAlpha * (0.25 + breathe * 0.15);
      const auraGrad = ctx.createRadialGradient(mx, my - 10, 0, mx, my - 10, auraR);
      auraGrad.addColorStop(0, 'rgba(220,200,255,0.9)');
      auraGrad.addColorStop(0.5, 'rgba(180,160,240,0.4)');
      auraGrad.addColorStop(1, 'rgba(150,130,220,0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(mx, my - 10, auraR, 0, Math.PI * 2);
      ctx.fill();
      // Silhouette of seated figure
      ctx.globalAlpha = medAlpha * 0.85;
      ctx.fillStyle = '#1a1525';
      // Legs (lotus position)
      ctx.beginPath();
      ctx.ellipse(mx, my + 2, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body torso upright
      ctx.beginPath();
      ctx.ellipse(mx, my - 8, 7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.beginPath();
      ctx.arc(mx, my - 20, 5, 0, Math.PI * 2);
      ctx.fill();
      // Hands in dhyana mudra (resting on knees)
      ctx.beginPath();
      ctx.ellipse(mx - 9, my - 2, 3, 2, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(mx + 9, my - 2, 3, 2, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // Subtle reflection in river
      ctx.globalAlpha = medAlpha * 0.18;
      ctx.save();
      ctx.scale(1, -0.4);
      ctx.translate(0, -(my + 12) * 2 - (canvas.height * 0.82 - my - 12) * 2);
      ctx.fillStyle = '#1a1525';
      ctx.beginPath();
      ctx.ellipse(mx, my + 2, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(mx, my - 8, 7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx, my - 20, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
  }

  // ── リシケシュ: 雲の流れ影 ──
  if (loc === 'rishikesh') {
    const elapsedShadow = animFrame - fieldEnterFrame;
    const shadowAlpha = Math.min(1, elapsedShadow / 250) * 0.28;
    if (shadowAlpha > 0.01) {
      ctx.save();
      // 3 large soft cloud shadow patches drifting slowly
      const patches = [
        { speedX: 0.22, speedY: 0.04, size: 160, startOffset: 0 },
        { speedX: 0.15, speedY: 0.03, size: 200, startOffset: 300 },
        { speedX: 0.29, speedY: 0.05, size: 130, startOffset: 600 },
      ];
      for (const patch of patches) {
        const px = ((animFrame * patch.speedX + patch.startOffset) % (canvas.width + patch.size * 2)) - patch.size;
        const py = canvas.height * 0.55 + Math.sin(animFrame * patch.speedY + patch.startOffset * 0.01) * 30;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, patch.size);
        grad.addColorStop(0, 'rgba(30,40,60,' + shadowAlpha.toFixed(3) + ')');
        grad.addColorStop(0.6, 'rgba(30,40,60,' + (shadowAlpha * 0.4).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(30,40,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(px, py, patch.size, patch.size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 渓谷の霧虹 ──
  if (loc === 'rishikesh') {
    const elapsedFogbow = animFrame - fieldEnterFrame;
    const fbIn = Math.min(1, Math.max(0, (elapsedFogbow - 100) / 250));
    const fbOut = Math.max(0, 1 - (elapsedFogbow - 700) / 400);
    const fbAlpha = fbIn * fbOut * 0.6;
    if (fbAlpha > 0.005) {
      ctx.save();
      const arcCX = canvas.width * 0.5;
      const arcCY = canvas.height * 0.92;
      const arcR = 160;
      const arcW = 22;
      const fogColors = [
        [220, 230, 255],
        [240, 245, 255],
        [255, 250, 240],
        [240, 240, 255],
        [210, 225, 255],
      ];
      for (let fc = 0; fc < fogColors.length; fc++) {
        const [fr, fg, fb2] = fogColors[fc];
        const offset = (fc - 2) * (arcW / fogColors.length);
        const rr = arcR + offset;
        ctx.globalAlpha = fbAlpha * (0.4 + Math.sin(fc * 0.6) * 0.2);
        ctx.strokeStyle = 'rgb(' + fr + ',' + fg + ',' + fb2 + ')';
        ctx.lineWidth = arcW / fogColors.length + 1;
        ctx.beginPath();
        ctx.arc(arcCX, arcCY, rr, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      ctx.globalAlpha = fbAlpha * 0.35;
      const glowGrad = ctx.createRadialGradient(arcCX, arcCY, arcR - arcW, arcCX, arcCY, arcR + arcW);
      glowGrad.addColorStop(0, 'rgba(200,215,255,0)');
      glowGrad.addColorStop(0.5, 'rgba(230,240,255,0.8)');
      glowGrad.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.strokeStyle = glowGrad;
      ctx.lineWidth = arcW * 2;
      ctx.beginPath();
      ctx.arc(arcCX, arcCY, arcR, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── リシケシュ: 森の朝露 ──
  if (loc === 'rishikesh') {
    const elapsedDew = animFrame - fieldEnterFrame;
    const dewIn = Math.min(1, elapsedDew / 150);
    const dewOut = Math.max(0, 1 - (elapsedDew - 600) / 300);
    const dewAlpha = dewIn * dewOut * 0.9;
    if (dewAlpha > 0.01) {
      ctx.save();
      const dewCount = 18;
      for (let di = 0; di < dewCount; di++) {
        const lx = canvas.width * (0.05 + (di % 6) * 0.17 + Math.sin(di * 1.3) * 0.04);
        const ly = canvas.height * (0.35 + (di % 5) * 0.1 + Math.cos(di * 0.9) * 0.03);
        const dr = 2.5 + (di % 3) * 1.2;
        const twinkle = (Math.sin(animFrame * 0.07 + di * 1.4) + 1) / 2;
        const glow = ctx.createRadialGradient(lx - dr * 0.3, ly - dr * 0.3, 0, lx, ly, dr * 1.8);
        glow.addColorStop(0, 'rgba(255,255,255,' + (dewAlpha * (0.6 + twinkle * 0.4)).toFixed(3) + ')');
        glow.addColorStop(0.4, 'rgba(180,220,255,' + (dewAlpha * (0.4 + twinkle * 0.3)).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(140,200,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, ly, dr * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(210,235,255,' + (dewAlpha * 0.7).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(lx, ly, dr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,' + (dewAlpha * (0.5 + twinkle * 0.5)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(lx - dr * 0.3, ly - dr * 0.3, dr * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 渡り鳥の編隊 ──
  if (loc === 'rishikesh') {
    // 空高くV字編隊の渡り鳥が南へ移動していく
    const migCycle = 480;
    const mp = animFrame % migCycle;
    const mt = mp / migCycle;
    // 右上から左下へ対角線上に渡る
    const leadX = canvas.width * 1.1 - mt * (canvas.width * 1.3);
    const leadY = tileSize * 0.5 + mt * tileSize * 1.5;
    // V字編隊（21羽）
    const vFormation = [];
    vFormation.push({ ox: 0, oy: 0, delay: 0 });
    for (let arm = 1; arm <= 5; arm++) {
      vFormation.push({ ox: -arm * 16, oy: arm * 10, delay: arm * 3 });
      vFormation.push({ ox:  arm * 16, oy: arm * 10, delay: arm * 3 });
    }
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (let bi = 0; bi < vFormation.length; bi++) {
      const { ox, oy, delay } = vFormation[bi];
      const bx = leadX + ox;
      const by = leadY + oy;
      if (bx < -20 || bx > canvas.width + 20) continue;
      const wingFlap = Math.sin(animFrame * 0.20 + delay * 0.15) * 5;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(-0.35); // 斜め方向
      ctx.fillStyle = '#1a1818';
      // 体
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 首と頭
      ctx.beginPath();
      ctx.ellipse(6, -1, 4, 2, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // 左翼
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-5, -8 + wingFlap, -18, -5 + wingFlap);
      ctx.quadraticCurveTo(-12, -1, -6, 1);
      ctx.closePath();
      ctx.fill();
      // 右翼
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-5, 8 - wingFlap, -18, 5 - wingFlap);
      ctx.quadraticCurveTo(-12, 1, -6, 1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── リシケシュ: 川の亀 ──
  if (loc === 'rishikesh') {
    // 川の岩の上でガンジスカメが甲羅干しをしている
    const turtles = [
      { x: canvas.width * 0.32, y: tileSize * 9.3, size: 1.0, phase: 0   },
      { x: canvas.width * 0.50, y: tileSize * 9.1, size: 0.8, phase: 1.5 },
      { x: canvas.width * 0.65, y: tileSize * 9.4, size: 0.9, phase: 3.0 },
    ];
    ctx.save();
    for (let ti = 0; ti < turtles.length; ti++) {
      const { x, y, size: s, phase } = turtles[ti];
      const breathe = Math.sin(animFrame * 0.016 + phase) * 0.8;
      const headNod = Math.sin(animFrame * 0.025 + phase) * 2;
      ctx.globalAlpha = 0.60;
      // 岩（亀が乗っている）
      ctx.fillStyle = '#5a4a38';
      ctx.beginPath();
      ctx.ellipse(x, y + 6 * s, 16 * s, 6 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // 甲羅（ドーム状）
      ctx.fillStyle = '#3a5a28';
      ctx.beginPath();
      ctx.ellipse(x, y + breathe, 13 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // 甲羅の六角形模様
      ctx.strokeStyle = '#2a4a18';
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.45;
      for (let hi = -1; hi <= 1; hi++) {
        for (let hj = -1; hj <= 1; hj++) {
          const hx = x + hi * 7 * s;
          const hy = y + breathe + hj * 4 * s;
          if (Math.abs(hi) + Math.abs(hj) <= 1.5) {
            ctx.beginPath();
            for (let hv = 0; hv < 6; hv++) {
              const ha = (hv / 6) * Math.PI * 2;
              const px = hx + Math.cos(ha) * 3.5 * s;
              const py = hy + Math.sin(ha) * 2.5 * s;
              hv === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 0.60;
      // 頭
      ctx.fillStyle = '#2a4a18';
      ctx.beginPath();
      ctx.ellipse(x + 12 * s, y - 2 + headNod + breathe, 5 * s, 4 * s, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // 目（黄色い）
      ctx.fillStyle = '#ddcc44';
      ctx.globalAlpha = 0.70;
      ctx.beginPath();
      ctx.arc(x + 14 * s, y - 4 + headNod + breathe, 1.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x + 14.3 * s, y - 4 + headNod + breathe, 0.7 * s, 0, Math.PI * 2);
      ctx.fill();
      // 前脚
      ctx.fillStyle = '#2a4a18';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(x + 8 * s, y + 6 + breathe, 4 * s, 2.5 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x - 2 * s, y + 6 + breathe, 4 * s, 2.5 * s, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // 後脚（引っ込み気味）
      ctx.globalAlpha = 0.40;
      ctx.beginPath();
      ctx.ellipse(x - 8 * s, y + 4 + breathe, 3.5 * s, 2 * s, 0.5, 0, Math.PI * 2);
      ctx.fill();
      // しっぽ
      ctx.strokeStyle = '#2a4a18';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.50;
      ctx.beginPath();
      ctx.moveTo(x - 12 * s, y + 2 + breathe);
      ctx.lineTo(x - 16 * s, y + 4 + breathe);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.restore();
  }

  // ── リシケシュ: 森の鬼火 ──
  if (loc === 'rishikesh') {
    // 夜の森（elapsed > 1600）に青白い鬼火（山霊の光）が漂う
    const elapsedWisp = animFrame - fieldEnterFrame;
    if (elapsedWisp > 1500) {
      const wispAlpha = Math.min(1, (elapsedWisp - 1500) / 300) * 0.65;
      const wisps = [
        { cx: canvas.width * 0.12, cy: tileSize * 4.0, freqX: 0.012, freqY: 0.018, rx: 22, ry: 14, phase: 0.0 },
        { cx: canvas.width * 0.22, cy: tileSize * 3.5, freqX: 0.016, freqY: 0.011, rx: 18, ry: 20, phase: 1.4 },
        { cx: canvas.width * 0.35, cy: tileSize * 4.2, freqX: 0.010, freqY: 0.020, rx: 26, ry: 12, phase: 2.8 },
        { cx: canvas.width * 0.08, cy: tileSize * 5.0, freqX: 0.014, freqY: 0.015, rx: 14, ry: 18, phase: 4.2 },
      ];
      ctx.save();
      for (let wi = 0; wi < wisps.length; wi++) {
        const { cx, cy, freqX, freqY, rx, ry, phase } = wisps[wi];
        const wx = cx + Math.sin(animFrame * freqX + phase) * rx;
        const wy = cy + Math.cos(animFrame * freqY + phase * 0.7) * ry;
        // 明滅
        const blink = (Math.sin(animFrame * 0.06 + wi * 1.9) + 1) / 2;
        const pulse = 0.4 + blink * 0.6;
        // 外側グロー
        ctx.globalAlpha = wispAlpha * pulse * 0.40;
        const outerGrad = ctx.createRadialGradient(wx, wy, 0, wx, wy, 16);
        outerGrad.addColorStop(0, 'rgba(120,200,255,0.8)');
        outerGrad.addColorStop(0.5, 'rgba(80,160,255,0.4)');
        outerGrad.addColorStop(1, 'rgba(40,100,220,0)');
        ctx.fillStyle = outerGrad;
        ctx.beginPath();
        ctx.arc(wx, wy, 16, 0, Math.PI * 2);
        ctx.fill();
        // 中心の輝き
        ctx.globalAlpha = wispAlpha * pulse * 0.80;
        const innerGrad = ctx.createRadialGradient(wx, wy, 0, wx, wy, 5);
        innerGrad.addColorStop(0, 'rgba(200,240,255,1)');
        innerGrad.addColorStop(0.5, 'rgba(100,180,255,0.8)');
        innerGrad.addColorStop(1, 'rgba(60,120,240,0)');
        ctx.fillStyle = innerGrad;
        ctx.beginPath();
        ctx.arc(wx, wy, 5, 0, Math.PI * 2);
        ctx.fill();
        // 尾（移動の軌跡）
        ctx.globalAlpha = wispAlpha * pulse * 0.25;
        ctx.strokeStyle = 'rgba(100,180,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        const prevWx = cx + Math.sin(animFrame * freqX + phase - 0.3) * rx;
        const prevWy = cy + Math.cos(animFrame * freqY + phase * 0.7 - 0.3) * ry;
        ctx.beginPath();
        ctx.moveTo(prevWx, prevWy);
        ctx.lineTo(wx, wy);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 橋を渡る聖牛 ──
  if (loc === 'rishikesh') {
    // ラクシュマン・ジューラーの吊橋を牛が悠々と渡る
    const cowCycle = 520;
    const cp101 = animFrame % cowCycle;
    const ct101 = cp101 / cowCycle;
    // 橋の描画（背景として常時表示）
    const bridgeY = tileSize * 5.2;
    const bridgeLeft = 0;
    const bridgeRight = canvas.width;
    ctx.save();
    // 橋床
    ctx.strokeStyle = '#8a6a40';
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(bridgeLeft, bridgeY);
    ctx.lineTo(bridgeRight, bridgeY);
    ctx.stroke();
    // 橋の支柱（2本）
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#6a5030';
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.30, bridgeY - 30);
    ctx.lineTo(canvas.width * 0.30, bridgeY + 10);
    ctx.moveTo(canvas.width * 0.70, bridgeY - 30);
    ctx.lineTo(canvas.width * 0.70, bridgeY + 10);
    ctx.stroke();
    // 主ケーブル（カテナリー曲線）
    ctx.strokeStyle = '#5a4020';
    ctx.lineWidth = 1.5;
    for (let cable = 0; cable < 2; cable++) {
      const cOff = cable * 8 - 4;
      ctx.beginPath();
      ctx.moveTo(bridgeLeft, bridgeY - 28 + cOff);
      ctx.quadraticCurveTo(canvas.width / 2, bridgeY + 10 + cOff, bridgeRight, bridgeY - 28 + cOff);
      ctx.stroke();
    }
    // ハンガーロープ
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = '#7a6040';
    for (let hi = 0; hi < 12; hi++) {
      const hx = bridgeLeft + (hi + 0.5) * (canvas.width / 12);
      const hyCable = bridgeY - 28 + Math.pow((hx / canvas.width - 0.5) * 2, 2) * 38;
      ctx.beginPath();
      ctx.moveTo(hx, hyCable);
      ctx.lineTo(hx, bridgeY);
      ctx.stroke();
    }
    // 橋を渡る牛
    const cowX = -40 + ct101 * (canvas.width + 80);
    const cowY = bridgeY - 8;
    const cowStep = Math.sin(animFrame * 0.10) * 1.5;
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#cc8830'; // 茶色い牛
    // 胴体
    ctx.beginPath();
    ctx.ellipse(cowX, cowY, 18, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.ellipse(cowX + 16, cowY - 4, 9, 7, -0.15, 0, Math.PI * 2);
    ctx.fill();
    // 鼻
    ctx.fillStyle = '#aa6820';
    ctx.beginPath();
    ctx.ellipse(cowX + 24, cowY - 2, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // こぶ
    ctx.fillStyle = '#cc8830';
    ctx.beginPath();
    ctx.ellipse(cowX - 4, cowY - 12, 7, 5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // 角
    ctx.strokeStyle = '#5a3008';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cowX + 14, cowY - 9);
    ctx.quadraticCurveTo(cowX + 10, cowY - 18, cowX + 6, cowY - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cowX + 18, cowY - 9);
    ctx.quadraticCurveTo(cowX + 22, cowY - 17, cowX + 26, cowY - 13);
    ctx.stroke();
    // 脚（歩行）
    const legPairs101 = [-10, -2, 6, 14];
    ctx.fillStyle = '#cc8830';
    for (let li = 0; li < 4; li++) {
      const legSwing = Math.sin(animFrame * 0.10 + li * 1.6) * 4;
      ctx.beginPath();
      ctx.rect(cowX + legPairs101[li] - 2, cowY + 6, 4, 10 + legSwing);
      ctx.fill();
    }
    // しっぽ
    ctx.strokeStyle = '#aa7020';
    ctx.lineWidth = 2;
    const tailSwing101 = Math.sin(animFrame * 0.04) * 8;
    ctx.beginPath();
    ctx.moveTo(cowX - 17, cowY - 2);
    ctx.quadraticCurveTo(cowX - 24, cowY + 5, cowX - 22 + tailSwing101, cowY + 14);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── リシケシュ: 川岸のアーティ（v100記念） ──
  if (loc === 'rishikesh') {
    // 夕暮れ（elapsed 1000-1800）: 川岸でアーティの祭祀が行われる
    const elapsedAarti = animFrame - fieldEnterFrame;
    if (elapsedAarti >= 900 && elapsedAarti <= 2000) {
      const aaT = elapsedAarti < 1200
        ? (elapsedAarti - 900) / 300
        : 1;
      const aaAlpha = aaT * 0.72;
      const aaX = canvas.width * 0.52;
      const aaY = tileSize * 8.6;
      ctx.save();
      ctx.globalAlpha = aaAlpha;
      // 祭壇の台（石の台座）
      ctx.fillStyle = '#6a5a40';
      ctx.beginPath();
      ctx.rect(aaX - 20, aaY - 4, 40, 12);
      ctx.fill();
      // 祭壇の飾り
      ctx.strokeStyle = '#cc9930';
      ctx.lineWidth = 1;
      ctx.strokeRect(aaX - 20, aaY - 4, 40, 12);
      // 祭司（中央に立つ）
      ctx.fillStyle = '#cc6010';
      ctx.beginPath();
      ctx.rect(aaX - 5, aaY - 22, 10, 18);
      ctx.fill();
      ctx.fillStyle = '#2a1808';
      ctx.beginPath();
      ctx.arc(aaX, aaY - 27, 5.5, 0, Math.PI * 2);
      ctx.fill();
      // ランプ（大きな炎）— 両手で持って回す
      const lampAngle = animFrame * 0.04;
      const lampR = 18;
      const lampX = aaX + Math.cos(lampAngle) * lampR;
      const lampY = aaY - 18 + Math.sin(lampAngle) * 6;
      // ランプ台
      ctx.fillStyle = '#ddaa30';
      ctx.globalAlpha = aaAlpha * 0.80;
      ctx.beginPath();
      ctx.arc(lampX, lampY, 5, 0, Math.PI * 2);
      ctx.fill();
      // 炎（5本の芯）
      for (let fi = -2; fi <= 2; fi++) {
        const fx = lampX + fi * 2;
        const fFlicker = Math.sin(animFrame * 0.14 + fi * 0.7) * 2;
        const fGrad = ctx.createRadialGradient(fx, lampY - 5, 0, fx, lampY - 5, 10);
        fGrad.addColorStop(0, 'rgba(255,240,150,0.95)');
        fGrad.addColorStop(0.4, 'rgba(255,160,20,0.7)');
        fGrad.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = fGrad;
        ctx.globalAlpha = aaAlpha * 0.85;
        ctx.beginPath();
        ctx.ellipse(fx, lampY - 4, 3, 6 + fFlicker, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 腕（ランプを回す）
      ctx.strokeStyle = '#2a1808';
      ctx.lineWidth = 2;
      ctx.globalAlpha = aaAlpha * 0.65;
      ctx.beginPath();
      ctx.moveTo(aaX + 3, aaY - 18);
      ctx.lineTo(lampX, lampY);
      ctx.stroke();
      // 祈りの群衆（3列）
      const crowdRows = [
        { y: aaY + 10, count: 8, scale: 0.9 },
        { y: aaY + 22, count: 10, scale: 0.75 },
        { y: aaY + 32, count: 12, scale: 0.6 },
      ];
      ctx.fillStyle = '#1a1008';
      for (const row of crowdRows) {
        ctx.globalAlpha = aaAlpha * row.scale * 0.65;
        for (let ci = 0; ci < row.count; ci++) {
          const cx = aaX - (row.count * 9) / 2 + ci * 9 + Math.sin(animFrame * 0.015 + ci) * 1.5;
          const cy = row.y;
          const sway = Math.sin(animFrame * 0.018 + ci * 0.8) * 2;
          // 頭（揺れ）
          ctx.beginPath();
          ctx.arc(cx, cy - 8 * row.scale + sway, 3.5 * row.scale, 0, Math.PI * 2);
          ctx.fill();
          // 体
          ctx.beginPath();
          ctx.rect(cx - 3 * row.scale, cy - 4 * row.scale + sway * 0.3, 6 * row.scale, 10 * row.scale);
          ctx.fill();
          // 手を合わせて礼拝
          ctx.strokeStyle = '#1a1008';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 2 * row.scale + sway * 0.3);
          ctx.lineTo(cx + 4 * row.scale, cy + 1 * row.scale + sway * 0.2);
          ctx.stroke();
        }
      }
      // アーティの光のグロー（全体的な暖かい光）
      ctx.globalAlpha = aaAlpha * 0.15;
      const aaGlow = ctx.createRadialGradient(aaX, aaY - 5, 0, aaX, aaY - 5, 70);
      aaGlow.addColorStop(0, 'rgba(255,200,50,0.8)');
      aaGlow.addColorStop(0.5, 'rgba(255,150,20,0.3)');
      aaGlow.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = aaGlow;
      ctx.beginPath();
      ctx.arc(aaX, aaY - 5, 70, 0, Math.PI * 2);
      ctx.fill();
      // 鐘の音の波紋（川に広がる）
      const bellPhase = (animFrame % 120) / 120;
      if (bellPhase < 0.6) {
        ctx.globalAlpha = aaAlpha * (1 - bellPhase / 0.6) * 0.25;
        ctx.strokeStyle = '#ddcc66';
        ctx.lineWidth = 1;
        for (let ri = 1; ri <= 3; ri++) {
          const rr = bellPhase * (25 + ri * 15);
          ctx.beginPath();
          ctx.ellipse(aaX, aaY + 5, rr, rr * 0.4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 雪解けの小滝 ──
  if (loc === 'rishikesh') {
    // 背景の崖面（左上）から雪解け水の小さな滝が流れ落ちる
    const fallX = canvas.width * 0.08;
    const fallTopY = tileSize * 0.5;
    const fallBotY = tileSize * 5.5;
    const fallHeight = fallBotY - fallTopY;
    ctx.save();
    ctx.globalAlpha = 0.55;
    // 崖の輪郭（岩）
    ctx.fillStyle = '#4a4038';
    ctx.beginPath();
    ctx.moveTo(fallX - 18, fallTopY);
    ctx.lineTo(fallX - 10, fallTopY + 20);
    ctx.lineTo(fallX - 5, fallTopY + 60);
    ctx.lineTo(fallX, fallBotY);
    ctx.lineTo(fallX + 12, fallBotY);
    ctx.lineTo(fallX + 8, fallBotY - 40);
    ctx.lineTo(fallX + 14, fallTopY + 30);
    ctx.lineTo(fallX + 6, fallTopY);
    ctx.closePath();
    ctx.fill();
    // 滝の流れ（波打つ白いグラデーション）
    for (let layer = 0; layer < 3; layer++) {
      const lOffset = (animFrame * (1.5 + layer * 0.3) + layer * 30) % fallHeight;
      const wx = fallX + Math.sin(lOffset * 0.04 + layer * 1.1) * 3;
      const fallGrad = ctx.createLinearGradient(wx, fallTopY, wx, fallBotY);
      fallGrad.addColorStop(0,   'rgba(200,230,255,0)');
      fallGrad.addColorStop(0.1, `rgba(220,240,255,${0.55 - layer * 0.1})`);
      fallGrad.addColorStop(0.8, `rgba(200,225,255,${0.40 - layer * 0.08})`);
      fallGrad.addColorStop(1,   'rgba(200,225,255,0)');
      ctx.fillStyle = fallGrad;
      ctx.beginPath();
      ctx.rect(wx - 2, fallTopY, 5, fallHeight);
      ctx.fill();
    }
    // 流れの粒
    ctx.fillStyle = '#ddeeff';
    for (let pi = 0; pi < 12; pi++) {
      const dropAge = (animFrame * 2.2 + pi * 18) % fallHeight;
      const dropX = fallX + Math.sin(dropAge * 0.03 + pi * 1.3) * 4;
      const dropY = fallTopY + dropAge;
      const dropAlpha = Math.sin(dropAge / fallHeight * Math.PI) * 0.7;
      ctx.globalAlpha = dropAlpha;
      ctx.beginPath();
      ctx.ellipse(dropX, dropY, 1.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 水しぶき（滝壺）
    ctx.globalAlpha = 0.40;
    const mist = ctx.createRadialGradient(fallX + 2, fallBotY, 0, fallX + 2, fallBotY, 18);
    mist.addColorStop(0, 'rgba(220,240,255,0.7)');
    mist.addColorStop(1, 'rgba(200,230,255,0)');
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.ellipse(fallX + 2, fallBotY, 18, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 飛沫パーティクル
    for (let si = 0; si < 8; si++) {
      const splashAge = (animFrame * 0.8 + si * 10) % 30;
      const sx = fallX + Math.cos(si * 0.8) * splashAge * 0.6;
      const sy = fallBotY - splashAge * 0.4;
      ctx.globalAlpha = 0.40 * (1 - splashAge / 30);
      ctx.fillStyle = '#eef5ff';
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── リシケシュ: 川岸の旅人キャンプ ──
  if (loc === 'rishikesh') {
    // 夕暮れ（elapsed 1000-2000）: 旅人たちが川岸に焚き火を囲む
    const elapsedCamp = animFrame - fieldEnterFrame;
    if (elapsedCamp >= 900) {
      const campAlpha = Math.min(1, (elapsedCamp - 900) / 300) * 0.65;
      const campX = canvas.width * 0.75;
      const campY = tileSize * 8.8;
      ctx.save();
      ctx.globalAlpha = campAlpha;
      // テント（三角形）
      ctx.fillStyle = '#8a4418';
      ctx.beginPath();
      ctx.moveTo(campX + 25, campY);
      ctx.lineTo(campX + 55, campY);
      ctx.lineTo(campX + 40, campY - 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#aa6628';
      ctx.beginPath();
      ctx.moveTo(campX + 35, campY);
      ctx.lineTo(campX + 45, campY);
      ctx.lineTo(campX + 40, campY - 12);
      ctx.closePath();
      ctx.fill();
      // テントのペグ&ロープ
      ctx.strokeStyle = '#6a3408';
      ctx.lineWidth = 1;
      ctx.globalAlpha = campAlpha * 0.5;
      ctx.beginPath();
      ctx.moveTo(campX + 40, campY - 22);
      ctx.lineTo(campX + 20, campY - 5);
      ctx.moveTo(campX + 40, campY - 22);
      ctx.lineTo(campX + 62, campY - 4);
      ctx.stroke();
      ctx.globalAlpha = campAlpha;
      // 焚き火
      const fFlicker = Math.sin(animFrame * 0.13) * 2;
      const fGrad = ctx.createRadialGradient(campX + 10, campY - 6, 0, campX + 10, campY - 6, 14);
      fGrad.addColorStop(0, 'rgba(255,220,80,0.9)');
      fGrad.addColorStop(0.5, 'rgba(255,100,20,0.5)');
      fGrad.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.fillStyle = fGrad;
      ctx.beginPath();
      ctx.arc(campX + 10, campY - 6, 14, 0, Math.PI * 2);
      ctx.fill();
      // 炎
      ctx.fillStyle = '#ff6600';
      ctx.globalAlpha = campAlpha * 0.85;
      ctx.beginPath();
      ctx.moveTo(campX + 6, campY);
      ctx.lineTo(campX + 10 + fFlicker * 0.5, campY - 16 - fFlicker);
      ctx.lineTo(campX + 14, campY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffcc00';
      ctx.globalAlpha = campAlpha * 0.70;
      ctx.beginPath();
      ctx.moveTo(campX + 8, campY);
      ctx.lineTo(campX + 10 + fFlicker * 0.3, campY - 10);
      ctx.lineTo(campX + 12, campY);
      ctx.closePath();
      ctx.fill();
      // 薪
      ctx.strokeStyle = '#4a2808';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.globalAlpha = campAlpha * 0.65;
      ctx.beginPath();
      ctx.moveTo(campX + 3, campY + 1);
      ctx.lineTo(campX + 18, campY - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(campX + 18, campY + 1);
      ctx.lineTo(campX + 3, campY - 2);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // 焚き火を囲む人々（3人）
      ctx.fillStyle = '#2a1808';
      ctx.globalAlpha = campAlpha * 0.60;
      const campers = [
        { x: campX - 12, y: campY + 2 },
        { x: campX + 10, y: campY + 6 },
        { x: campX + 22, y: campY + 2 },
      ];
      for (const cp of campers) {
        // 座った体
        ctx.beginPath();
        ctx.arc(cp.x, cp.y - 8, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cp.x, cp.y, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 地面グロー
      ctx.globalAlpha = campAlpha * 0.20;
      const groundGlow = ctx.createRadialGradient(campX + 10, campY, 0, campX + 10, campY, 30);
      groundGlow.addColorStop(0, 'rgba(255,140,0,0.6)');
      groundGlow.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = groundGlow;
      ctx.beginPath();
      ctx.ellipse(campX + 10, campY + 2, 30, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── リシケシュ: 高山の花畑 ──
  if (loc === 'rishikesh') {
    // 山の斜面（sky〜地面タイルの上部）に高山植物の花が群生している
    const meadowFlowers = [];
    for (let mi = 0; mi < 22; mi++) {
      meadowFlowers.push({
        x: (mi * 29 + 8) % canvas.width,
        y: tileSize * (2.2 + (mi % 4) * 0.5),
        size: 3 + (mi % 3),
        color: ['#ff6688','#ffee44','#cc44ff','#ff8844','#88ddff','#ff44aa','#aaff44'][mi % 7],
        phase: mi * 0.7,
      });
    }
    ctx.save();
    // 草の緑の帯
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#3a8a28';
    ctx.beginPath();
    ctx.rect(0, tileSize * 2.5, canvas.width, tileSize * 1.0);
    ctx.fill();
    // 花々
    for (let fi = 0; fi < meadowFlowers.length; fi++) {
      const { x, y, size, color, phase } = meadowFlowers[fi];
      const sway = Math.sin(animFrame * 0.025 + phase) * 2;
      ctx.save();
      ctx.translate(x, y);
      // 茎
      ctx.strokeStyle = '#2a7018';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(sway, -size * 1.8);
      ctx.stroke();
      // 花弁（6弁）
      ctx.globalAlpha = 0.55;
      for (let pi = 0; pi < 6; pi++) {
        const pa = (pi / 6) * Math.PI * 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(
          sway + Math.cos(pa) * size * 0.6,
          -size * 1.8 + Math.sin(pa) * size * 0.6,
          size * 0.5, size * 0.3, pa, 0, Math.PI * 2
        );
        ctx.fill();
      }
      // 花芯
      ctx.fillStyle = '#ffee88';
      ctx.globalAlpha = 0.70;
      ctx.beginPath();
      ctx.arc(sway, -size * 1.8, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 蝶（1〜2匹）
    for (let bi = 0; bi < 2; bi++) {
      const bAngle = animFrame * 0.018 + bi * Math.PI;
      const bx = canvas.width * 0.4 + Math.cos(bAngle) * canvas.width * 0.2;
      const by = tileSize * 2.8 + Math.sin(bAngle * 1.3) * tileSize * 0.4;
      const wingFlap = Math.abs(Math.sin(animFrame * 0.12 + bi * 1.1));
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = bi === 0 ? '#ffcc44' : '#ff88aa';
      ctx.save();
      ctx.translate(bx, by);
      ctx.beginPath();
      ctx.ellipse(-5 * wingFlap, -2, 7 * wingFlap, 5, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(5 * wingFlap, -2, 7 * wingFlap, 5, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── リシケシュ: 薬草を摘む聖者 ──
  if (loc === 'rishikesh') {
    // 山の斜面に一人の聖者（ムニ）が薬草を摘んでいる
    const herbX = canvas.width * 0.68;
    const herbY = tileSize * 5.8;
    const bendT = (Math.sin(animFrame * 0.02) + 1) / 2; // 0〜1（身をかがめる動作）
    const bendAngle = bendT * 0.5; // 前かがみの角度
    ctx.save();
    ctx.globalAlpha = 0.55;
    // 周囲の薬草（低木）
    const herbs = [
      { x: -20, y: 8, color: '#2a8a18' }, { x: -8, y: 12, color: '#3a9a28' },
      { x:  10, y: 9, color: '#229918' }, { x:  22, y: 11, color: '#2a7a18' },
      { x: -15, y: 14, color: '#1a7810' }, { x:   5, y: 15, color: '#3a8820' },
    ];
    for (const h of herbs) {
      ctx.fillStyle = h.color;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(herbX + h.x, herbY + h.y, 5 + Math.abs(h.x) % 3, 0, Math.PI * 2);
      ctx.fill();
      // 小さな白い花
      ctx.fillStyle = '#eeffcc';
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(herbX + h.x + 2, herbY + h.y - 4, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.55;
    // 聖者の体
    ctx.fillStyle = '#cc8830'; // オレンジ色の衣
    ctx.save();
    ctx.translate(herbX, herbY);
    ctx.rotate(bendAngle);
    ctx.beginPath();
    ctx.rect(-5, -12, 10, 16);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 6, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 頭（布を巻いた）
    ctx.fillStyle = '#2a1808';
    ctx.beginPath();
    ctx.arc(0, -16, 5, 0, Math.PI * 2);
    ctx.fill();
    // 頭の巻き布
    ctx.fillStyle = '#cc6622';
    ctx.globalAlpha = 0.50;
    ctx.beginPath();
    ctx.ellipse(0, -17, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 腕（植物を摘む）
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#2a1808';
    ctx.lineWidth = 2;
    // 前傾み方向に腕を伸ばす
    ctx.beginPath();
    ctx.moveTo(5, -6);
    ctx.lineTo(18, 4 + bendT * 8);
    ctx.stroke();
    // 手に持つ薬草の束
    ctx.strokeStyle = '#2a7a18';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(18, 4 + bendT * 8);
    ctx.lineTo(22, -2 + bendT * 6);
    ctx.moveTo(18, 4 + bendT * 8);
    ctx.lineTo(24, 2 + bendT * 6);
    ctx.moveTo(18, 4 + bendT * 8);
    ctx.lineTo(20, -4 + bendT * 5);
    ctx.stroke();
    // 杖
    ctx.strokeStyle = '#7a5028';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, -8);
    ctx.lineTo(-12, 16);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // ── リシケシュ: 竹林の風 ──
  if (loc === 'rishikesh') {
    // 画面左端の斜面に竹が群生し、山風に揺れている
    const bamboos = [
      { bx: canvas.width * 0.03, h: 110, thick: 5, phase:  0  },
      { bx: canvas.width * 0.07, h: 130, thick: 6, phase:  0.5 },
      { bx: canvas.width * 0.11, h: 100, thick: 4, phase:  1.0 },
      { bx: canvas.width * 0.15, h: 120, thick: 5, phase:  0.3 },
      { bx: canvas.width * 0.19, h: 95,  thick: 4, phase:  1.5 },
    ];
    ctx.save();
    for (let bi = 0; bi < bamboos.length; bi++) {
      const { bx, h, thick, phase } = bamboos[bi];
      const by = tileSize * 9.5; // 地面
      const sway = Math.sin(animFrame * 0.022 + phase) * 8 + Math.sin(animFrame * 0.037 + phase * 1.3) * 4;
      const topX = bx + sway;
      const topY = by - h;
      const midX = bx + sway * 0.5;
      const midY = by - h * 0.5;
      // 茎（緑のベジェ曲線）
      ctx.strokeStyle = '#3a7a28';
      ctx.lineWidth = thick;
      ctx.globalAlpha = 0.55;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(midX, midY, topX, topY);
      ctx.stroke();
      // 節（横線）
      ctx.strokeStyle = '#2a5a18';
      ctx.lineWidth = thick * 1.2;
      ctx.globalAlpha = 0.50;
      for (let ni = 1; ni < 5; ni++) {
        const nt = ni / 5;
        const nx = bx + (topX - bx) * nt;
        const ny = by + (topY - by) * nt;
        ctx.beginPath();
        ctx.moveTo(nx - thick, ny);
        ctx.lineTo(nx + thick, ny);
        ctx.stroke();
      }
      // 葉（先端付近に広がる葉）
      ctx.strokeStyle = '#4a9a30';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.50;
      const leafAngles = [-0.6, -0.2, 0.2, 0.6];
      for (const la of leafAngles) {
        const leafSway = sway * 0.2;
        const lx = topX + Math.cos(la + leafSway * 0.05) * 18;
        const ly = topY + Math.sin(la + leafSway * 0.05) * 18;
        ctx.beginPath();
        ctx.moveTo(topX, topY);
        ctx.quadraticCurveTo(
          topX + Math.cos(la) * 10 + leafSway * 0.3,
          topY + Math.sin(la) * 8,
          lx, ly
        );
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // ── リシケシュ: 夜明けのプラナヤマ ──
  if (loc === 'rishikesh') {
    // elapsed < 500: 川岸に3人が並んで呼吸法（プラナヤマ）を実践する
    const elapsedPrana = animFrame - fieldEnterFrame;
    if (elapsedPrana < 650) {
      const pAlpha = Math.min(1, elapsedPrana / 100) * Math.max(0, 1 - (elapsedPrana - 500) / 150) * 0.65;
      const practitioners = [
        { x: canvas.width * 0.26, y: tileSize * 8.6 },
        { x: canvas.width * 0.40, y: tileSize * 8.5 },
        { x: canvas.width * 0.54, y: tileSize * 8.6 },
      ];
      // 呼吸サイクル（吸う4拍、止める2拍、吐く4拍）
      const breathCycle = 160;
      const bp = animFrame % breathCycle;
      const breathPhase = bp < 60  ? bp / 60        // 吸う（0→1）
                        : bp < 90  ? 1               // 止める
                        : bp < 150 ? 1 - (bp - 90) / 60  // 吐く（1→0）
                        : 0;
      ctx.save();
      ctx.globalAlpha = pAlpha;
      for (let pi = 0; pi < practitioners.length; pi++) {
        const { x, y } = practitioners[pi];
        const phaseOffset = pi * 0.1; // 少しずらす
        const localBreath = Math.sin((animFrame * 0.04 + phaseOffset) * Math.PI) * 0.5 + 0.5;
        ctx.fillStyle = '#2a1808';
        ctx.strokeStyle = '#2a1808';
        // 座った体（蓮座 — 足を組んで座る）
        ctx.beginPath();
        ctx.ellipse(x, y + 3, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 胴体（呼吸で膨らむ）
        const chestW = 5 + localBreath * 1.5;
        ctx.beginPath();
        ctx.ellipse(x, y - 6, chestW, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        // 頭
        ctx.beginPath();
        ctx.arc(x, y - 17, 5, 0, Math.PI * 2);
        ctx.fill();
        // 両手を膝に（ジニャーナムドラ）
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 4);
        ctx.lineTo(x - 9, y + 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 5, y - 4);
        ctx.lineTo(x + 9, y + 2);
        ctx.stroke();
        // 手の印（丸）
        ctx.fillStyle = '#3a2818';
        ctx.beginPath();
        ctx.arc(x - 9, y + 2, 2.5, 0, Math.PI * 2);
        ctx.arc(x + 9, y + 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // プラーナのオーラ（呼吸に合わせて広がる光）
        const auraR = 18 + localBreath * 10;
        const aGrad = ctx.createRadialGradient(x, y - 5, 0, x, y - 5, auraR);
        aGrad.addColorStop(0,   `rgba(180,220,255,${pAlpha * localBreath * 0.4})`);
        aGrad.addColorStop(0.6, `rgba(140,200,255,${pAlpha * localBreath * 0.15})`);
        aGrad.addColorStop(1,   'rgba(100,180,255,0)');
        ctx.fillStyle = aGrad;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y - 5, auraR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = pAlpha;
        ctx.fillStyle = '#2a1808';
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 渓谷を舞う鷲 ──
  if (loc === 'rishikesh') {
    // 山の上空を大きな鷲が旋回している
    const eagleCycle = 520;
    const ep = animFrame % eagleCycle;
    const et = ep / eagleCycle;
    // 楕円軌道で旋回
    const eX = canvas.width * 0.5 + Math.cos(et * Math.PI * 2) * canvas.width * 0.32;
    const eY = tileSize * 1.8 + Math.sin(et * Math.PI * 2) * tileSize * 0.7;
    const bankAngle = Math.cos(et * Math.PI * 2) * 0.3; // バンク角
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(eX, eY);
    ctx.rotate(bankAngle);
    ctx.fillStyle = '#2a1a08';
    ctx.strokeStyle = '#2a1a08';
    // 体
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 尾羽
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-16, -1.5);
    ctx.lineTo(-16, 1.5);
    ctx.closePath();
    ctx.fill();
    // 頭（白っぽい：白頭鷲風）
    ctx.fillStyle = '#e8e0d0';
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(7, -1, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // くちばし
    ctx.fillStyle = '#cc9920';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(10, -0.5);
    ctx.lineTo(14, 0.5);
    ctx.lineTo(10, 1.5);
    ctx.closePath();
    ctx.fill();
    // 翼（大きく広げた左右）
    ctx.fillStyle = '#2a1a08';
    ctx.globalAlpha = 0.55;
    // 翼の羽ばたき（ゆっくり）
    const wingBeat = Math.sin(animFrame * 0.04) * 0.08; // 非常にゆるやか（旋回中はほぼ静止）
    const wingDip = Math.sin(animFrame * 0.04) * 3;
    // 右翼
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(20, -8 + wingDip, 38, -4 + wingDip * 1.5);
    ctx.quadraticCurveTo(32, 0, 22, 3);
    ctx.quadraticCurveTo(12, 4, 0, 2);
    ctx.closePath();
    ctx.fill();
    // 左翼
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-20, -8 + wingDip, -38, -4 + wingDip * 1.5);
    ctx.quadraticCurveTo(-32, 0, -22, 3);
    ctx.quadraticCurveTo(-12, 4, 0, 2);
    ctx.closePath();
    ctx.fill();
    // 翼端の指状羽根
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1a0a00';
    ctx.globalAlpha = 0.40;
    for (let fi = 0; fi < 4; fi++) {
      const ft = fi / 3;
      ctx.beginPath();
      ctx.moveTo(28 + ft * 10, -5 + wingDip + ft * 1.5);
      ctx.lineTo(30 + ft * 12, -8 + wingDip + ft * 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-28 - ft * 10, -5 + wingDip + ft * 1.5);
      ctx.lineTo(-30 - ft * 12, -8 + wingDip + ft * 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── リシケシュ: ヒマラヤの雪峰のアルペングロー ──
  if (loc === 'rishikesh') {
    // 夕暮れ（elapsed 1000-1800）: 背景の山々の頂上がピンクに染まる
    const elapsedGlow = animFrame - fieldEnterFrame;
    if (elapsedGlow >= 800 && elapsedGlow <= 2000) {
      const gt = elapsedGlow < 1400
        ? (elapsedGlow - 800) / 600
        : 1 - (elapsedGlow - 1400) / 600;
      const glowAlpha = Math.max(0, gt) * 0.45;
      // 雪峰の頂点（空タイルとの境界付近）
      const peaks = [
        { x: canvas.width * 0.10, y: tileSize * 0.8,  w: 40, h: 28 },
        { x: canvas.width * 0.30, y: tileSize * 0.3,  w: 55, h: 38 },
        { x: canvas.width * 0.52, y: tileSize * 0.6,  w: 48, h: 32 },
        { x: canvas.width * 0.72, y: tileSize * 0.4,  w: 60, h: 42 },
        { x: canvas.width * 0.90, y: tileSize * 0.9,  w: 38, h: 25 },
      ];
      ctx.save();
      for (let pi = 0; pi < peaks.length; pi++) {
        const { x, y, w, h } = peaks[pi];
        // アルペングローのグラデーション（頂上が最も赤く）
        const alpGrad = ctx.createRadialGradient(x, y, 0, x, y, h * 1.2);
        alpGrad.addColorStop(0,   `rgba(255,150,120,${glowAlpha * 0.9})`);
        alpGrad.addColorStop(0.4, `rgba(255,100,80,${glowAlpha * 0.6})`);
        alpGrad.addColorStop(0.7, `rgba(220,80,60,${glowAlpha * 0.3})`);
        alpGrad.addColorStop(1,   'rgba(200,60,40,0)');
        ctx.fillStyle = alpGrad;
        ctx.globalAlpha = 1;
        // 山のシルエット（三角形＋雪のグラデーション）
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - w, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fill();
        // 雪の白いグラデーション（頂上3分の1）
        const snowGrad = ctx.createLinearGradient(x, y, x, y + h * 0.4);
        snowGrad.addColorStop(0, `rgba(255,240,240,${glowAlpha * 1.5})`);
        snowGrad.addColorStop(1, 'rgba(255,240,240,0)');
        ctx.fillStyle = snowGrad;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - w * 0.4, y + h * 0.4);
        ctx.lineTo(x + w * 0.4, y + h * 0.4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: アシュラムの鐘 ──
  if (loc === 'rishikesh') {
    // 木の上部（row=1〜2）に吊るされた鐘。定期的に鳴り響き、音の波紋が広がる
    const bellX = canvas.width * 0.35;
    const bellY = tileSize * 1.8;
    const bellCycle = 240; // 鐘一打の周期
    const bp = animFrame % bellCycle;
    const isRinging = bp < 60;
    const swing = isRinging ? Math.sin(bp / 60 * Math.PI) * 18 : 0;
    ctx.save();
    // 鐘の吊り木（梁）
    ctx.globalAlpha = 0.60;
    ctx.strokeStyle = '#5a3a18';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bellX - 22, bellY - 18);
    ctx.lineTo(bellX + 22, bellY - 18);
    ctx.stroke();
    // 吊り紐
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#8a6030';
    ctx.beginPath();
    ctx.moveTo(bellX, bellY - 18);
    ctx.lineTo(bellX + Math.sin(swing * 0.017) * 8, bellY - 5);
    ctx.stroke();
    // 鐘本体
    ctx.save();
    ctx.translate(bellX + Math.sin(swing * 0.017) * 8, bellY);
    ctx.rotate(swing * 0.017);
    ctx.fillStyle = '#c8a030';
    ctx.strokeStyle = '#8a6010';
    ctx.lineWidth = 1;
    // 鐘の形（台形＋丸底）
    ctx.beginPath();
    ctx.moveTo(-8, -12);
    ctx.lineTo(8,  -12);
    ctx.lineTo(11,  0);
    ctx.quadraticCurveTo(11, 10, 0, 12);
    ctx.quadraticCurveTo(-11, 10, -11, 0);
    ctx.lineTo(-8, -12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 鐘の装飾帯
    ctx.strokeStyle = '#8a6010';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-10, -5);
    ctx.lineTo(10,  -5);
    ctx.stroke();
    // 舌（打ち棒）
    ctx.strokeStyle = '#6a4010';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-swing * 0.2, 8);
    ctx.stroke();
    ctx.fillStyle = '#5a3008';
    ctx.beginPath();
    ctx.arc(-swing * 0.2, 9, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 音の波紋（鳴っているとき）
    if (isRinging) {
      const rippleT = bp / 60;
      ctx.globalAlpha = 0.30 * (1 - rippleT);
      ctx.strokeStyle = '#ddcc66';
      for (let ri = 1; ri <= 3; ri++) {
        const rippleR = rippleT * (30 + ri * 20);
        ctx.lineWidth = 1.2 - ri * 0.3;
        ctx.beginPath();
        ctx.arc(bellX, bellY + 5, rippleR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── リシケシュ: ラフティングボート ──
  if (loc === 'rishikesh') {
    // 急流（川タイル中段）を黄色いラフティングボートが下る
    const raftCycle = 540;
    const rp = animFrame % raftCycle;
    const raftT = rp / raftCycle;
    // 右から左へ急流を下る。波に乗って上下に揺れる
    const raftX = canvas.width + 50 - raftT * (canvas.width + 100);
    const raftY = tileSize * 10.2
      + Math.sin(animFrame * 0.06) * 5
      + Math.sin(animFrame * 0.041 + 1.2) * 3;
    const raftTilt = Math.sin(animFrame * 0.05) * 0.15;
    ctx.save();
    ctx.globalAlpha = 0.70;
    ctx.translate(raftX, raftY);
    ctx.rotate(raftTilt);
    // ゴムボート本体（楕円）
    ctx.fillStyle = '#ddbb00';
    ctx.strokeStyle = '#aa8800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // ボートの内側（凹み）
    ctx.fillStyle = '#224488';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // パドラー（3人）
    ctx.fillStyle = '#1a1a1a';
    const paddlers = [-14, 0, 14];
    for (let pi = 0; pi < paddlers.length; pi++) {
      const px = paddlers[pi];
      // 体
      ctx.globalAlpha = 0.70;
      ctx.beginPath();
      ctx.arc(px, -4, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(px - 2.5, -1, 5, 6);
      ctx.fill();
      // パドル
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#cc6600';
      ctx.globalAlpha = 0.65;
      const paddleSide = pi % 2 === 0 ? 1 : -1;
      const paddleSwing = Math.sin(animFrame * 0.08 + pi * 1.5) * 0.4;
      const paddleAngle = paddleSide * (0.8 + paddleSwing);
      ctx.beginPath();
      ctx.moveTo(px, -2);
      ctx.lineTo(px + Math.cos(paddleAngle) * 18, -2 + Math.sin(paddleAngle) * 12);
      ctx.stroke();
      // パドルの水かき部分
      ctx.fillStyle = '#cc6600';
      ctx.beginPath();
      ctx.ellipse(
        px + Math.cos(paddleAngle) * 18,
        -2 + Math.sin(paddleAngle) * 12,
        4, 2.5, paddleAngle, 0, Math.PI * 2
      );
      ctx.fill();
    }
    // ライフジャケット（明るいオレンジ）
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ff6600';
    for (let pi = 0; pi < paddlers.length; pi++) {
      ctx.beginPath();
      ctx.ellipse(paddlers[pi], 0, 4, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 飛沫
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = '#ddeeff';
    for (let si = 0; si < 6; si++) {
      const sx = -30 + si * 10 + Math.sin(animFrame * 0.12 + si) * 3;
      const sy = 8 + Math.sin(animFrame * 0.09 + si * 0.7) * 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + (si % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── リシケシュ: 星空の川面への映り込み ──
  if (loc === 'rishikesh') {
    // elapsed > 1600: 夜の川面が星空を映す。揺らぐ光の帯
    const elapsedRef = animFrame - fieldEnterFrame;
    if (elapsedRef > 1600) {
      const refAlpha = Math.min(1, (elapsedRef - 1600) / 300) * 0.55;
      ctx.save();
      // 川タイル（row 9〜14）全体に星の反射
      const starReflections = 30;
      ctx.globalAlpha = refAlpha;
      for (let si = 0; si < starReflections; si++) {
        const sx = (si * 73 + 17) % canvas.width;
        const rowBase = 9 + (si % 5);
        const sy = rowBase * tileSize + (si * 19 % tileSize);
        // 揺らぎ
        const wobble = Math.sin(animFrame * 0.04 + si * 1.3) * 3;
        const rx = sx + wobble;
        const ry = sy + Math.sin(animFrame * 0.025 + si * 0.7) * 2;
        // 星の輝き（縦に伸びた光の柱）
        const brightness = (Math.sin(animFrame * 0.06 + si * 2.3) + 1) / 2;
        const grad = ctx.createLinearGradient(rx, ry - 6, rx, ry + 6);
        grad.addColorStop(0,   'rgba(200,220,255,0)');
        grad.addColorStop(0.5, `rgba(220,235,255,${brightness * 0.8})`);
        grad.addColorStop(1,   'rgba(200,220,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(rx, ry, 1.2, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        // 中心輝点
        ctx.fillStyle = `rgba(255,255,255,${brightness * 0.9})`;
        ctx.beginPath();
        ctx.arc(rx, ry, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // 月光の水面反射（中央縦帯）
      const moonGrad = ctx.createLinearGradient(canvas.width / 2, tileSize * 9, canvas.width / 2, tileSize * 14);
      moonGrad.addColorStop(0,   `rgba(220,230,255,${refAlpha * 0.25})`);
      moonGrad.addColorStop(0.5, `rgba(200,215,250,${refAlpha * 0.12})`);
      moonGrad.addColorStop(1,   'rgba(200,215,250,0)');
      ctx.fillStyle = moonGrad;
      const moonShimmer = Math.sin(animFrame * 0.015) * 10;
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2 + moonShimmer, tileSize * 11, 30, tileSize * 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── リシケシュ: 朝靄 ──
  if (loc === 'rishikesh') {
    // elapsed < 600: 山間の谷に朝靄が漂う。川面から白い霧が立ち上る
    const elapsedMist = animFrame - fieldEnterFrame;
    const mistAlpha = elapsedMist < 400
      ? Math.min(1, elapsedMist / 100) * 0.38
      : Math.max(0, 0.38 - (elapsedMist - 400) / 300 * 0.38);
    if (mistAlpha > 0.005) {
      ctx.save();
      // 横長の霧帯を複数層、川タイルより少し上の高度に配置
      const mistBands = [
        { y: tileSize * 7.2, scaleY: 1.0, speed: 0.22, width: canvas.width * 1.1 },
        { y: tileSize * 6.5, scaleY: 0.7, speed: 0.15, width: canvas.width * 0.9 },
        { y: tileSize * 8.0, scaleY: 0.8, speed: 0.28, width: canvas.width * 1.2 },
        { y: tileSize * 5.8, scaleY: 0.5, speed: 0.10, width: canvas.width * 0.7 },
      ];
      for (let bi = 0; bi < mistBands.length; bi++) {
        const band = mistBands[bi];
        const drift = Math.sin(animFrame * 0.008 + bi * 1.5) * 15;
        const cx = canvas.width / 2 + drift;
        const cy = band.y + Math.sin(animFrame * 0.005 + bi * 0.9) * 5;
        const rx = band.width / 2;
        const ry = 18 * band.scaleY;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        grad.addColorStop(0,   `rgba(230,240,255,${mistAlpha * 0.8})`);
        grad.addColorStop(0.5, `rgba(210,225,245,${mistAlpha * 0.5})`);
        grad.addColorStop(1,   'rgba(200,220,240,0)');
        ctx.fillStyle = grad;
        ctx.save();
        ctx.scale(1, ry / rx);
        ctx.beginPath();
        ctx.arc(cx, cy * (rx / ry), rx, 0, Math.PI * 2);
        ctx.restore();
        ctx.fill();
      }
      // 川面から立ち上る細い霧柱
      for (let vi = 0; vi < 6; vi++) {
        const vx = canvas.width * (0.1 + vi * 0.16) + Math.sin(animFrame * 0.01 + vi * 2.1) * 6;
        const vy0 = tileSize * 9;
        const vy1 = tileSize * (6 - vi % 3 * 0.5);
        const vGrad = ctx.createLinearGradient(vx, vy0, vx, vy1);
        vGrad.addColorStop(0, `rgba(230,240,255,${mistAlpha * 0.55})`);
        vGrad.addColorStop(1, 'rgba(230,240,255,0)');
        ctx.fillStyle = vGrad;
        ctx.beginPath();
        ctx.ellipse(vx, (vy0 + vy1) / 2, 8 + vi * 2, (vy0 - vy1) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 祈りの旗（タルチョ） ──
  if (loc === 'rishikesh') {
    // 山頂付近に張られたカラフルな5色の祈りの旗が山風になびく
    // ロープが画面上端から右に斜めに渡されている
    const ropeX0 = canvas.width * 0.12;
    const ropeY0 = tileSize * 0.6;
    const ropeX1 = canvas.width * 0.88;
    const ropeY1 = tileSize * 1.8;
    const flagColors = ['#3366cc','#ffffff','#dd3322','#33aa44','#ffbb00'];
    const flagCount = 10;
    ctx.save();
    ctx.globalAlpha = 0.70;

    // ロープ
    ctx.strokeStyle = 'rgba(180,160,120,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(ropeX0, ropeY0);
    ctx.lineTo(ropeX1, ropeY1);
    ctx.stroke();

    // 旗
    for (let fi = 0; fi < flagCount; fi++) {
      const t = fi / (flagCount - 1);
      const rx = ropeX0 + (ropeX1 - ropeX0) * t;
      const ry = ropeY0 + (ropeY1 - ropeY0) * t;
      const color = flagColors[fi % flagColors.length];
      // 旗のなびき（サイン波で旗の右端がゆれる）
      const windPhase = animFrame * 0.04 + fi * 0.8;
      const flutter = Math.sin(windPhase) * 4;
      const flutter2 = Math.sin(windPhase * 1.3 + 0.5) * 2;
      const flagW = 14;
      const flagH = 11;
      // 旗の形（四角形＋なびき変形）
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + flagW + flutter * 0.3, ry + 2 + flutter2);
      ctx.lineTo(rx + flagW + flutter, ry + flagH + flutter2 * 0.5);
      ctx.lineTo(rx, ry + flagH - 1);
      ctx.closePath();
      ctx.fill();
      // 輪郭
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // 旗に書かれたマントラの象徴（細い十字線）
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(rx + 4, ry + 3);
      ctx.lineTo(rx + 4 + flutter * 0.5, ry + flagH - 3);
      ctx.moveTo(rx + 2, ry + flagH / 2);
      ctx.lineTo(rx + flagW - 2 + flutter * 0.7, ry + flagH / 2 + flutter2 * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── リシケシュ: 魚を狙うサギ ──
  if (loc === 'rishikesh') {
    // 川の浅瀬（水タイルの縁）に静止するサギ
    const heronX = canvas.width * 0.44;
    const heronY = tileSize * 9.2;
    const vigilance = Math.sin(animFrame * 0.016);  // 頭を動かす
    const strike = animFrame % 200;  // 180-190でくちばしを水に突く
    const peckDown = strike >= 180 && strike <= 195
      ? Math.sin(((strike - 180) / 15) * Math.PI) * 12 : 0;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle   = '#1A2028';
    ctx.strokeStyle = '#1A2028';
    // 胴体（卵型）
    ctx.beginPath();
    ctx.ellipse(heronX, heronY - 6, 5, 8, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // 首（長い S 字）
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(heronX + 3, heronY - 12);
    ctx.quadraticCurveTo(heronX - 3, heronY - 18, heronX + vigilance * 4, heronY - 26 + peckDown);
    ctx.stroke();
    // 頭（小さな円）
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(heronX + vigilance * 4, heronY - 28 + peckDown, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // くちばし（長い）
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(heronX + vigilance * 4 + 2, heronY - 28 + peckDown);
    ctx.lineTo(heronX + vigilance * 4 + 10, heronY - 25 + peckDown * 0.8);
    ctx.stroke();
    // 冠羽（黒い飾り羽）
    ctx.globalAlpha = 0.30;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(heronX + vigilance * 4 - 1, heronY - 30 + peckDown);
    ctx.lineTo(heronX + vigilance * 4 - 5, heronY - 36 + peckDown);
    ctx.stroke();
    // 2本の長い脚
    ctx.globalAlpha = 0.38;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(heronX - 2, heronY + 1);
    ctx.lineTo(heronX - 2, heronY + 12);
    ctx.moveTo(heronX + 2, heronY + 1);
    ctx.lineTo(heronX + 2, heronY + 12);
    ctx.stroke();
    // 足指
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(heronX - 2, heronY + 12);
    ctx.lineTo(heronX - 6, heronY + 14);
    ctx.moveTo(heronX - 2, heronY + 12);
    ctx.lineTo(heronX + 2, heronY + 14);
    ctx.moveTo(heronX + 2, heronY + 12);
    ctx.lineTo(heronX - 2, heronY + 14);
    ctx.moveTo(heronX + 2, heronY + 12);
    ctx.lineTo(heronX + 6, heronY + 14);
    ctx.stroke();
    // 魚を捕まえた時の水しぶき
    if (peckDown > 5) {
      ctx.globalAlpha = (peckDown / 12) * 0.30;
      ctx.strokeStyle = 'rgba(180,220,255,1)';
      ctx.lineWidth   = 0.7;
      for (let s = 0; s < 4; s++) {
        const sa = (s / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(heronX + vigilance * 4 + 10, heronY - 24 + peckDown);
        ctx.lineTo(heronX + vigilance * 4 + 10 + Math.cos(sa) * 6,
                   heronY - 24 + peckDown + Math.sin(sa) * 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── リシケシュ: パラグライダー ──
  if (loc === 'rishikesh') {
    // 空（上部タイル）をゆっくりと滑空するパラグライダー
    const pgX = canvas.width * 0.35 + Math.sin(animFrame * 0.011) * 60
                + Math.sin(animFrame * 0.026) * 20;
    const pgY = tileSize * 1.2 + Math.sin(animFrame * 0.015) * 12;
    const bank = Math.sin(animFrame * 0.018) * 0.2;  // 機体の傾き
    ctx.save();
    ctx.translate(pgX, pgY);
    ctx.rotate(bank);
    // 翼（大きな半楕円）
    ctx.globalAlpha = 0.38;
    ctx.fillStyle   = '#C03020';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 5, 0, Math.PI, 0);  // 上半分
    ctx.closePath();
    ctx.fill();
    // 翼のセル（色分け）
    const cells = ['#C03020','#E06020','#E8C020','#E06020','#C03020'];
    for (let c = 0; c < 5; c++) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle   = cells[c];
      ctx.beginPath();
      ctx.moveTo(-20 + c * 8, 0);
      ctx.arc(-20 + c * 8 + 4, 0, 4, Math.PI, 0);
      ctx.lineTo(-20 + c * 8 + 8, 0);
      ctx.closePath();
      ctx.fill();
    }
    // ライン（翼から人へ）
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#3A2010';
    ctx.lineWidth   = 0.7;
    for (let l = 0; l < 5; l++) {
      ctx.beginPath();
      ctx.moveTo(-16 + l * 8, 2);
      ctx.lineTo(0, 14);
      ctx.stroke();
    }
    // パイロットのシルエット（ハーネス）
    ctx.globalAlpha = 0.35;
    ctx.fillStyle   = '#1A1808';
    ctx.beginPath();
    ctx.ellipse(0, 16, 3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 10, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── リシケシュ: 山の温泉 ──
  if (loc === 'rishikesh') {
    // 画面右下の岩場（川の近く）に小さな温泉
    const hotX = canvas.width * 0.84;
    const hotY = tileSize * 10.5;
    ctx.save();
    // 温泉の水面（青白い楕円）
    ctx.globalAlpha = 0.25;
    const hotGrad = ctx.createRadialGradient(hotX, hotY, 0, hotX, hotY, 18);
    hotGrad.addColorStop(0, 'rgba(180,240,255,0.5)');
    hotGrad.addColorStop(0.6, 'rgba(120,200,230,0.3)');
    hotGrad.addColorStop(1, 'rgba(80,160,200,0)');
    ctx.fillStyle = hotGrad;
    ctx.beginPath();
    ctx.ellipse(hotX, hotY, 18, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // 湯気（もわもわと上昇）
    for (let s = 0; s < 6; s++) {
      const age  = (animFrame * 0.45 + s * 22) % 80;
      const t    = age / 80;
      const sx   = hotX + Math.sin(t * Math.PI * 2.5 + s * 1.2) * 8;
      const sy   = hotY - 4 - t * 35;
      const sa   = (1 - t) * 0.18;
      ctx.globalAlpha = sa;
      ctx.fillStyle   = '#D0E8F0';
      ctx.beginPath();
      ctx.arc(sx, sy, 3 + t * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 岩（池の周り）
    ctx.globalAlpha = 0.30;
    ctx.fillStyle   = '#4A3C28';
    for (let r = 0; r < 5; r++) {
      const ra = (r / 5) * Math.PI * 2;
      const rx = hotX + Math.cos(ra) * 20;
      const ry = hotY + Math.sin(ra) * 10;
      const rw = 5 + r % 2 * 2;
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rw * 0.55, ra, 0, Math.PI * 2);
      ctx.fill();
    }
    // 水面の泡（ぽこぽこ）
    for (let b = 0; b < 4; b++) {
      const bAge = (animFrame * 0.35 + b * 25) % 60;
      const bt   = bAge / 60;
      const bx2  = hotX - 6 + b * 4;
      const by2  = hotY - 2 + Math.sin(bt * Math.PI) * (-5);
      const ba   = Math.sin(bt * Math.PI) * 0.25;
      ctx.globalAlpha = ba;
      ctx.strokeStyle = 'rgba(180,230,250,1)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.arc(bx2, by2, 2 + bt * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── リシケシュ: 森から散る落ち葉 ──
  if (loc === 'rishikesh') {
    const leafColors = ['#C84010', '#E06820', '#D0A020', '#805010', '#B03820'];
    ctx.save();
    for (let l = 0; l < 10; l++) {
      const lSpeed = 0.16 + l * 0.04;
      const lDrift = Math.sin(animFrame * 0.04 + l * 0.9) * 18;
      // 画面上部（木の高さ）から落ちてくる
      const lx = ((l * 67 + animFrame * (0.05 + l * 0.008)) % (canvas.width + 20)) - 10 + lDrift;
      const ly = (animFrame * lSpeed + l * 47) % (canvas.height + 10) - 5;
      const lAngle = animFrame * (0.04 + l * 0.01) + l * 0.8;
      const lA = 0.30 + 0.15 * Math.sin(animFrame * 0.03 + l * 0.5);
      ctx.save();
      ctx.globalAlpha = lA;
      ctx.translate(lx, ly);
      ctx.rotate(lAngle);
      ctx.fillStyle = leafColors[l % leafColors.length];
      // 葉（楕円 + 軸）
      ctx.beginPath();
      ctx.ellipse(0, 0, 3, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = lA * 0.6;
      ctx.strokeStyle = leafColors[(l + 2) % leafColors.length];
      ctx.lineWidth   = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(0, 4.5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── リシケシュ: ガンジス川の急流 ──
  if (loc === 'rishikesh') {
    // 急流エリア（水タイル）に白波と泡を追加
    const rapidRows = [7, 8, 9];  // 川のタイル行
    ctx.save();
    for (const row of rapidRows) {
      const ry = row * tileSize;
      for (let w = 0; w < 8; w++) {
        // 白波（V字形の波頭）
        const wx = (animFrame * (1.8 + w * 0.3) + w * 83) % (canvas.width + 20) - 10;
        const wa = 0.25 + 0.15 * Math.sin(animFrame * 0.12 + w * 0.7);
        ctx.globalAlpha = wa;
        ctx.strokeStyle = '#DDEEFF';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(wx - 5, ry + tileSize * 0.5);
        ctx.lineTo(wx, ry + tileSize * 0.3);
        ctx.lineTo(wx + 5, ry + tileSize * 0.5);
        ctx.stroke();
        // 泡（小さな白い点）
        const bx = (animFrame * (1.5 + w * 0.2) + w * 61 + 20) % (canvas.width + 10) - 5;
        const ba = 0.18 + 0.10 * Math.sin(animFrame * 0.08 + w * 0.5);
        ctx.globalAlpha = ba;
        ctx.fillStyle = '#E8F4FF';
        ctx.beginPath();
        ctx.arc(bx, ry + tileSize * (0.2 + (w % 3) * 0.25), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── リシケシュ: ハチドリ ──
  if (loc === 'rishikesh') {
    // ハスの花付近を猛スピードで飛び回る（高速羽ばたき）
    const hbX = canvas.width * 0.55 + Math.sin(animFrame * 0.08) * 30
                + Math.sin(animFrame * 0.035) * 15;
    const hbY = tileSize * 5.5 + Math.cos(animFrame * 0.06) * 18
                + Math.cos(animFrame * 0.025) * 8;
    const wFlap = Math.sin(animFrame * 0.55) * 6;  // 非常に速い羽ばたき
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle   = '#1A3010';
    ctx.strokeStyle = '#1A3010';
    // 細長い体
    ctx.beginPath();
    ctx.ellipse(hbX, hbY, 4, 1.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // 長いくちばし
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hbX + 4, hbY - 0.5);
    ctx.lineTo(hbX + 10, hbY - 1);
    ctx.stroke();
    // 羽（高速でブレた形に）
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#28501A';
    ctx.beginPath();
    ctx.ellipse(hbX - 1, hbY - 3 + wFlap, 6, 2, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hbX - 1, hbY + 3 - wFlap, 6, 2, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // 速度の残像（前の位置に薄くもう一つ）
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#1A3010';
    const prevX = hbX - Math.cos(animFrame * 0.08) * 8;
    const prevY = hbY - Math.sin(animFrame * 0.06) * 5;
    ctx.beginPath();
    ctx.ellipse(prevX, prevY, 4, 1.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── リシケシュ: 詠唱の振動波紋 ──
  if (loc === 'rishikesh') {
    // アシュラム（左下）から広がる音の波紋
    const mantCx = canvas.width * 0.15;
    const mantCy = tileSize * 4.0;
    const mantPeriod = 100;
    ctx.save();
    for (let ring = 0; ring < 4; ring++) {
      const age = (animFrame + ring * (mantPeriod / 4)) % mantPeriod;
      const t   = age / mantPeriod;
      const r   = t * tileSize * 3.5;
      const a   = (1 - t) * 0.14;
      if (a < 0.005) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(180,220,200,1)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.ellipse(mantCx, mantCy, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 「OM」シンボルの微かな残像（非常に薄く）
    const omPulse = 0.35 + 0.15 * Math.sin(animFrame * 0.03);
    ctx.globalAlpha = omPulse * 0.08;
    ctx.font = '14px serif';
    ctx.fillStyle = 'rgba(200,240,200,1)';
    ctx.textAlign = 'center';
    ctx.fillText('ॐ', mantCx, mantCy + 4);
    ctx.restore();
  }

  // ── リシケシュ: 林冠のラングール猿 ──
  if (loc === 'rishikesh') {
    // 木の上部（空との境界付近）に3匹のラングールが揺れる
    const langurPos = [
      { x: 0.12, speed: 0.012, phase: 0   },
      { x: 0.38, speed: 0.009, phase: 70  },
      { x: 0.65, speed: 0.014, phase: 140 },
    ];
    ctx.save();
    for (let l = 0; l < langurPos.length; l++) {
      const ld = langurPos[l];
      const lx = canvas.width * ld.x + Math.sin(animFrame * ld.speed + ld.phase) * 12;
      const ly = tileSize * 1.8 + Math.cos(animFrame * ld.speed * 1.3 + ld.phase) * 7;
      const swing = Math.sin(animFrame * 0.045 + ld.phase) * 0.4;
      const a = 0.30 + 0.08 * Math.sin(animFrame * 0.03 + l * 0.7);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(lx, ly);
      ctx.rotate(swing);
      ctx.fillStyle   = '#1A1008';
      ctx.strokeStyle = '#1A1008';
      // 胴体
      ctx.beginPath();
      ctx.ellipse(0, 0, 3, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭（白い顔のラングール）
      ctx.beginPath();
      ctx.arc(0, -5.5, 3, 0, Math.PI * 2);
      ctx.fill();
      // 顔の白い部分
      ctx.globalAlpha = a * 0.45;
      ctx.fillStyle = '#D8CCA8';
      ctx.beginPath();
      ctx.arc(0, -5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#1A1008';
      // 長い尻尾（ラングールの特徴）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 4.5);
      ctx.quadraticCurveTo(4, 10, 2, 18);
      ctx.quadraticCurveTo(1, 22, -2, 20);
      ctx.stroke();
      // 腕（木の枝を掴む）
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.lineTo(-8, -6);
      ctx.moveTo(3, -2);
      ctx.lineTo(8, -6);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── リシケシュ: カワウソ ──
  if (loc === 'rishikesh') {
    const otterCycle = 380;
    const otterActive = 130;
    const op = animFrame % otterCycle;
    if (op < otterActive) {
      const t  = op / otterActive;
      // 川辺（水面タイル行の縁）を横切る
      const ox = t * canvas.width * 0.65 + canvas.width * 0.08;
      const oy = tileSize * 9.5;  // 川のそば
      const fade = t < 0.06 ? t / 0.06 : t > 0.90 ? (1 - t) / 0.10 : 1;
      const wave = Math.sin(animFrame * 0.22) * 1.2;  // 体のうねり
      ctx.save();
      ctx.globalAlpha = fade * 0.40;
      ctx.fillStyle   = '#1E1008';
      ctx.strokeStyle = '#1E1008';
      // 胴体（細長い、曲がった）
      ctx.beginPath();
      ctx.ellipse(ox, oy + wave, 8, 3, wave * 0.15, 0, Math.PI * 2);
      ctx.fill();
      // 頭（丸い）
      ctx.beginPath();
      ctx.arc(ox + 9, oy + wave * 0.8, 3, 0, Math.PI * 2);
      ctx.fill();
      // 鼻
      ctx.beginPath();
      ctx.arc(ox + 12, oy + wave * 0.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
      // 耳（小さな半円）
      ctx.beginPath();
      ctx.arc(ox + 8, oy + wave * 0.8 - 3.5, 1.5, Math.PI, 0);
      ctx.fill();
      // しっぽ（特徴的に太くて長い）
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ox - 8, oy + wave);
      ctx.quadraticCurveTo(ox - 14, oy + wave + 2, ox - 18, oy + wave - 2);
      ctx.stroke();
      // 4本の短い脚
      ctx.lineWidth = 1.5;
      const legPositions = [ox - 4, ox, ox + 4, ox + 7];
      for (let l = 0; l < 4; l++) {
        const lo = Math.sin(animFrame * 0.20 + l * 0.8) * 1.5;
        ctx.beginPath();
        ctx.moveTo(legPositions[l], oy + 2 + wave * 0.3);
        ctx.lineTo(legPositions[l], oy + 6 + lo);
        ctx.stroke();
      }
      // 水しぶき
      if (t < 0.12 || t > 0.85) {
        ctx.globalAlpha = fade * 0.25;
        ctx.strokeStyle = 'rgba(180,220,255,1)';
        ctx.lineWidth   = 0.7;
        for (let s = 0; s < 3; s++) {
          ctx.beginPath();
          ctx.moveTo(ox - 5 + s * 5, oy + 6);
          ctx.quadraticCurveTo(ox - 3 + s * 5, oy + 3, ox - 1 + s * 5, oy + 6);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 夜明けのヨガ修行者 ──
  if (loc === 'rishikesh') {
    const elapsedYg = animFrame - fieldEnterFrame;
    // 夜明け（elapsed < 400）と黄金時間帯
    const ygStr = elapsedYg < 50 ? elapsedYg / 50 :
                  elapsedYg < 600 ? 1 :
                  elapsedYg < 800 ? 1 - (elapsedYg - 600) / 200 : 0;
    if (ygStr > 0.01) {
      // 右側の岸辺でヨガをする人
      const yx = canvas.width * 0.68;
      const yy = tileSize * 3.8;
      // 呼吸（ゆっくり）
      const breath = Math.sin(animFrame * 0.018) * 0.5;
      ctx.save();
      ctx.globalAlpha = ygStr * 0.38;
      ctx.fillStyle   = '#0C1408';
      ctx.strokeStyle = '#0C1408';
      // 戦士のポーズ（ウォリアー2）: 腕を水平に広げ、足を広げて立つ
      // 胴体
      ctx.beginPath();
      ctx.ellipse(yx, yy - 6, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.arc(yx, yy - 14 + breath, 2.8, 0, Math.PI * 2);
      ctx.fill();
      // 腕（水平に広げる）
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(yx - 3, yy - 8);
      ctx.lineTo(yx - 14, yy - 8 + breath * 0.3);
      ctx.moveTo(yx + 3, yy - 8);
      ctx.lineTo(yx + 14, yy - 8 - breath * 0.3);
      ctx.stroke();
      // 脚（広げて立つ）
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(yx, yy - 1);
      ctx.lineTo(yx - 10, yy + 10);  // 前足（曲げる）
      ctx.lineTo(yx - 10, yy + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(yx, yy - 1);
      ctx.lineTo(yx + 10, yy + 10);  // 後ろ足（まっすぐ）
      ctx.lineTo(yx + 12, yy + 14);
      ctx.stroke();
      // 朝の光のオーラ
      ctx.globalAlpha = ygStr * 0.15;
      const ygAura = ctx.createRadialGradient(yx, yy - 6, 0, yx, yy - 6, 25);
      ygAura.addColorStop(0, 'rgba(255,220,120,0.6)');
      ygAura.addColorStop(1, 'rgba(255,180,50,0)');
      ctx.fillStyle = ygAura;
      ctx.beginPath();
      ctx.arc(yx, yy - 6, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── リシケシュ: アシュラムの焚き火 ──
  if (loc === 'rishikesh') {
    // 川辺の岩のそば（左端）に小さな焚き火
    const fireX = canvas.width * 0.14;
    const fireY = tileSize * 3.5;
    ctx.save();
    // 焚き火の炎（複数の揺れる三角）
    for (let f = 0; f < 4; f++) {
      const flicker = 0.6 + 0.4 * Math.sin(animFrame * 0.14 + f * 0.9);
      const fh = (10 + f * 3) * flicker;
      const fw2 = 3 + f;
      const fxOff = (f % 2 === 0 ? -2 : 2) * Math.sin(animFrame * 0.09 + f);
      const col = f % 2 === 0 ? `rgba(255,${160 + f * 20},20,` : `rgba(255,${80 + f * 10},0,`;
      ctx.globalAlpha = flicker * (0.55 - f * 0.08);
      const fg = ctx.createLinearGradient(fireX + fxOff, fireY, fireX + fxOff, fireY - fh);
      fg.addColorStop(0, col + '0.90)');
      fg.addColorStop(0.5, col + '0.60)');
      fg.addColorStop(1, col + '0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(fireX + fxOff - fw2, fireY);
      ctx.quadraticCurveTo(fireX + fxOff, fireY - fh * 0.6, fireX + fxOff + fw2, fireY);
      ctx.lineTo(fireX + fxOff, fireY - fh);
      ctx.closePath();
      ctx.fill();
    }
    // 薪（水平の棒）
    ctx.globalAlpha = 0.50;
    ctx.strokeStyle = '#2A1808';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.moveTo(fireX - 8, fireY);
    ctx.lineTo(fireX + 8, fireY);
    ctx.stroke();
    // 焚き火の明かりの地面グロー
    const groundGlow = ctx.createRadialGradient(fireX, fireY + 2, 0, fireX, fireY + 2, 20);
    const gPulse = 0.55 + 0.45 * Math.sin(animFrame * 0.11);
    groundGlow.addColorStop(0, `rgba(255,140,20,${gPulse * 0.22})`);
    groundGlow.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = groundGlow;
    ctx.beginPath();
    ctx.ellipse(fireX, fireY + 2, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 火の粉が上昇
    for (let sp = 0; sp < 6; sp++) {
      const sage = (animFrame * 0.55 + sp * 17) % 55;
      const st   = sage / 55;
      const sx   = fireX + Math.sin(st * Math.PI * 1.8 + sp * 0.7) * 6;
      const sy   = fireY - st * 32;
      const sa   = (1 - st) * 0.60;
      ctx.globalAlpha = sa;
      ctx.fillStyle   = st < 0.4 ? '#FFD040' : '#FF6010';
      ctx.beginPath();
      ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── リシケシュ: つり橋を渡るシルエット ──
  if (loc === 'rishikesh') {
    const bridgeCycle = 480;
    const bridgeActive = 180;
    const bp = animFrame % bridgeCycle;
    if (bp < bridgeActive) {
      const t   = bp / bridgeActive;
      const fig = t * canvas.width * 0.72 + canvas.width * 0.09;
      const by  = tileSize * 4.5;  // 橋の高さ（川の上）
      const fade = t < 0.04 ? t / 0.04 : t > 0.92 ? (1 - t) / 0.08 : 1;
      const step = Math.sin(animFrame * 0.20) * 1.5;
      ctx.save();
      // 橋の木板（横断する部分のみ）
      ctx.globalAlpha = fade * 0.25;
      ctx.strokeStyle = '#3A2810';
      ctx.lineWidth   = 1;
      for (let board = 0; board < 25; board++) {
        const bx = canvas.width * 0.08 + board * (canvas.width * 0.85 / 24);
        ctx.beginPath();
        ctx.moveTo(bx, by - 2);
        ctx.lineTo(bx, by + 2);
        ctx.stroke();
      }
      // 橋の鎖・ロープ（カテナリー曲線）
      ctx.globalAlpha = fade * 0.30;
      ctx.strokeStyle = '#5A4020';
      ctx.lineWidth   = 0.8;
      for (let rope = 0; rope < 2; rope++) {
        const ry = rope === 0 ? by - 6 : by + 6;
        ctx.beginPath();
        ctx.moveTo(canvas.width * 0.08, ry - 8);
        for (let rx = canvas.width * 0.08; rx <= canvas.width * 0.92; rx += 4) {
          const sag = Math.sin(((rx - canvas.width * 0.08) / (canvas.width * 0.84)) * Math.PI) * 6;
          ctx.lineTo(rx, ry + sag);
        }
        ctx.stroke();
      }
      // 人物シルエット
      ctx.globalAlpha = fade * 0.42;
      ctx.fillStyle   = '#0A0C10';
      // 体
      ctx.beginPath();
      ctx.ellipse(fig, by - 8, 2.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 頭
      ctx.beginPath();
      ctx.arc(fig, by - 14, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // 腕（揺れる）
      ctx.strokeStyle = '#0A0C10';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(fig - 2.5, by - 10);
      ctx.lineTo(fig - 7, by - 7 + step * 0.5);
      ctx.moveTo(fig + 2.5, by - 10);
      ctx.lineTo(fig + 7, by - 7 - step * 0.5);
      ctx.stroke();
      // 脚
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fig, by - 4);
      ctx.lineTo(fig - 3, by + 2 + step);
      ctx.moveTo(fig, by - 4);
      ctx.lineTo(fig + 3, by + 2 - step);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── リシケシュ: 山の滝しぶき ──
  if (loc === 'rishikesh') {
    // 画面左上の山の方向から霧状の水しぶきが広がる
    ctx.save();
    for (let w = 0; w < 18; w++) {
      const wx = (animFrame * (0.22 + w * 0.06) + w * 59) % (canvas.width * 0.55);
      const wy = (animFrame * (0.28 + w * 0.04) + w * 43) % (tileSize * 2.8);
      const twinkle = 0.35 + 0.65 * Math.sin(animFrame * 0.09 + w * 0.6);
      const alpha   = twinkle * (0.08 + (w % 4) * 0.022);
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#D8EEFF';
      const sz = 1 + (w % 3) * 0.8;
      ctx.beginPath();
      ctx.arc(wx, wy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── リシケシュ: 川辺の鹿 ──
  if (loc === 'rishikesh') {
    const deerCycle = 720;
    const deerActive = 220;
    const deerPhase = animFrame % deerCycle;
    if (deerPhase < deerActive) {
      const t  = deerPhase / deerActive;
      // 右から左へ歩いて川辺で立ち止まり、また去る
      const walkX = canvas.width * 0.75 - t * canvas.width * 0.55;
      const deerY = tileSize * 3.6;
      const fade  = t < 0.05 ? t / 0.05 : t > 0.88 ? (1 - t) / 0.12 : 1;
      const isStill = t > 0.38 && t < 0.68;  // 川辺で静止して水を飲む
      const leg = isStill ? 0 : Math.sin(animFrame * 0.18) * 2.5;
      const headBow = isStill ? Math.min(1, (t - 0.38) / 0.08) * 6 : 0; // 頭を下げる
      ctx.save();
      ctx.globalAlpha = fade * 0.38;
      ctx.fillStyle   = '#1A2408';
      ctx.strokeStyle = '#1A2408';
      // 胴体
      ctx.beginPath();
      ctx.ellipse(walkX, deerY - 3, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 首
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(walkX + 7, deerY - 5);
      ctx.quadraticCurveTo(walkX + 10, deerY - 10, walkX + 10, deerY - 14 + headBow);
      ctx.stroke();
      // 頭
      ctx.beginPath();
      ctx.ellipse(walkX + 10, deerY - 16 + headBow, 3.5, 2.5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // 耳
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(walkX + 8, deerY - 18 + headBow);
      ctx.lineTo(walkX + 6, deerY - 23 + headBow);
      ctx.moveTo(walkX + 11, deerY - 18 + headBow);
      ctx.lineTo(walkX + 13, deerY - 23 + headBow);
      ctx.stroke();
      // 4本の脚
      ctx.lineWidth = 2;
      const legPairs = [
        [walkX - 4, leg],
        [walkX - 1, -leg],
        [walkX + 3, leg],
        [walkX + 6, -leg],
      ];
      for (const [lx, lo] of legPairs) {
        ctx.beginPath();
        ctx.moveTo(lx, deerY + 2);
        ctx.lineTo(lx, deerY + 9 + lo);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 瞑想するサドゥーのシルエット ──
  if (loc === 'rishikesh') {
    const elapsedSad = animFrame - fieldEnterFrame;
    const sadFade = elapsedSad < 80 ? elapsedSad / 80 : 1;
    // 川辺の岩の上（画面右寄り）に座る修行者
    const sadX = canvas.width * 0.80;
    const sadY = tileSize * 3.1;
    const breathe = Math.sin(animFrame * 0.022) * 0.8;
    ctx.save();
    ctx.globalAlpha = sadFade * 0.32;
    ctx.fillStyle   = '#0F1A10';
    ctx.strokeStyle = '#0F1A10';
    // 体（三角形の体勢・結跏趺坐）
    ctx.beginPath();
    ctx.moveTo(sadX - 7, sadY + 8);
    ctx.lineTo(sadX + 7, sadY + 8);
    ctx.lineTo(sadX, sadY - 4 + breathe);
    ctx.closePath();
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.arc(sadX, sadY - 8 + breathe * 0.4, 4, 0, Math.PI * 2);
    ctx.fill();
    // 腕（横に広げた手）
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sadX - 7, sadY + 2 + breathe * 0.3);
    ctx.lineTo(sadX - 14, sadY + 5 + breathe * 0.3);
    ctx.moveTo(sadX + 7, sadY + 2 + breathe * 0.3);
    ctx.lineTo(sadX + 14, sadY + 5 + breathe * 0.3);
    ctx.stroke();
    // オーラ（淡い光輪）
    const aura = ctx.createRadialGradient(sadX, sadY, 2, sadX, sadY, 22);
    const aPulse = 0.5 + 0.5 * Math.sin(animFrame * 0.035);
    aura.addColorStop(0, `rgba(180,220,180,${aPulse * 0.12})`);
    aura.addColorStop(1, 'rgba(180,220,180,0)');
    ctx.globalAlpha = sadFade * 0.60;
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(sadX, sadY, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── リシケシュ: ヒマラヤの雪しぶき ──
  if (loc === 'rishikesh') {
    const elapsedSn = animFrame - fieldEnterFrame;
    if (elapsedSn >= 1500) {
      const mt = Math.min(1, (elapsedSn - 1500) / 600);
      ctx.save();
      for (let s = 0; s < 20; s++) {
        const drift  = (animFrame * (0.30 + s * 0.07) + s * 73) % (canvas.width + 20) - 10;
        const fall   = (animFrame * (0.18 + s * 0.04) + s * 41) % (tileSize * 2.5);
        const sy     = fall;
        const twinkle = 0.5 + 0.5 * Math.sin(animFrame * 0.11 + s * 0.8);
        ctx.globalAlpha = mt * twinkle * 0.55;
        ctx.fillStyle   = '#EEF4FF';
        const sz = 1 + (s % 3) * 0.5;
        ctx.fillRect(drift - sz * 0.5, sy - sz * 0.5, sz, sz);
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: 山のワシが大きく旋回する ──
  if (loc === 'rishikesh') {
    const eagleAngle = animFrame * 0.0075;
    const ecx  = canvas.width * 0.44;
    const ecy  = tileSize * 1.15;
    const eRx  = 68, eRy = 26;
    const ex   = ecx + Math.cos(eagleAngle) * eRx;
    const ey   = ecy + Math.sin(eagleAngle) * eRy;
    const wing = Math.sin(animFrame * 0.068) * 5;
    const a    = 0.25 + 0.10 * Math.sin(animFrame * 0.025);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#1A2A18';
    ctx.fillStyle   = '#1A2A18';
    // 翼 (大きなV)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex - 20, ey + wing);
    ctx.quadraticCurveTo(ex - 8, ey - 5, ex, ey);
    ctx.quadraticCurveTo(ex + 8, ey - 5, ex + 20, ey + wing);
    ctx.stroke();
    // 体
    ctx.beginPath();
    ctx.ellipse(ex, ey, 4, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 尾羽
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ex, ey + 2.5);
    ctx.lineTo(ex - 4, ey + 8);
    ctx.moveTo(ex, ey + 2.5);
    ctx.lineTo(ex + 4, ey + 8);
    ctx.stroke();
    ctx.restore();
  }

  // ── リシケシュ: ガンジス川の夜明けのきらめき ──
  if (loc === 'rishikesh') {
    const elapsedRs = animFrame - fieldEnterFrame;
    if (elapsedRs < 300) {
      const intensity = Math.sin((elapsedRs / 300) * Math.PI) * 0.85;
      const riverRows = [10, 11];
      ctx.save();
      for (const row of riverRows) {
        const ry = row * tileSize;
        const rg = ctx.createLinearGradient(0, ry, 0, ry + tileSize);
        rg.addColorStop(0,   `rgba(255,148,72,${intensity * 0.14})`);
        rg.addColorStop(0.5, `rgba(255,148,72,${intensity * 0.07})`);
        rg.addColorStop(1,   'rgba(255,148,72,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, ry, canvas.width, tileSize);
      }
      for (let i = 0; i < 14; i++) {
        const sx    = ((i * 53 + Math.floor(animFrame * 0.45)) % canvas.width + canvas.width) % canvas.width;
        const sy    = riverRows[i % 2] * tileSize + tileSize * (0.2 + 0.6 * ((i * 37) % 100) / 100);
        const blink = Math.pow(Math.abs(Math.sin(animFrame * 0.065 + i * 1.8)), 2);
        if (blink < 0.28) continue;
        ctx.globalAlpha = intensity * blink * 0.52;
        ctx.fillStyle = '#FFE0A0';
        ctx.fillRect(sx - 1.5, sy, 3, 1);
        ctx.fillRect(sx, sy - 1.5, 1, 3);
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: ヒマラヤの雪峰 ──
  if (loc === 'rishikesh') {
    const peaks = [
      {rx: 0.05, h: 1.35}, {rx: 0.20, h: 1.80}, {rx: 0.38, h: 1.50},
      {rx: 0.57, h: 2.00}, {rx: 0.74, h: 1.65}, {rx: 0.90, h: 1.30},
    ];
    const skyH = 2 * tileSize;
    ctx.save();
    // 山体
    ctx.fillStyle = '#3A4858';
    ctx.globalAlpha = 0.26;
    ctx.beginPath();
    ctx.moveTo(0, skyH);
    const pw = canvas.width * 0.20;
    for (const p of peaks) {
      const px = p.rx * canvas.width;
      const py = skyH - p.h * tileSize * 0.52;
      ctx.lineTo(px - pw * 0.45, skyH);
      ctx.lineTo(px, py);
      ctx.lineTo(px + pw * 0.45, skyH);
    }
    ctx.lineTo(canvas.width, skyH);
    ctx.closePath();
    ctx.fill();
    // 雪冠
    ctx.fillStyle = '#E4ECF8';
    ctx.globalAlpha = 0.42;
    for (const p of peaks) {
      const px  = p.rx * canvas.width;
      const py  = skyH - p.h * tileSize * 0.52;
      const snw = tileSize * 0.17 * p.h;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - snw * 1.5, py + snw * 1.3);
      ctx.lineTo(px + snw * 1.5, py + snw * 1.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── リシケシュ: 山麓から朝霧が漂う ──
  if (loc === 'rishikesh') {
    const mistCount = 9;
    ctx.save();
    for (let i = 0; i < mistCount; i++) {
      const cx   = (i * 73 + animFrame * 0.18 + i * 17) % (canvas.width + 60) - 30;
      const cy   = 3 * tileSize - 8 + Math.sin(animFrame * 0.025 + i * 1.1) * 5;
      const r    = 30 + (i % 4) * 14;
      const a    = 0.055 + 0.025 * Math.sin(animFrame * 0.03 + i * 0.8);
      const mg   = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      mg.addColorStop(0, `rgba(210,230,255,${a * 2})`);
      mg.addColorStop(1, 'rgba(210,230,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── リシケシュ: タルチョのそばを舞うチョウ ──
  if (loc === 'rishikesh') {
    const elapsedBf = animFrame - fieldEnterFrame;
    if (elapsedBf >= 300 && elapsedBf <= 1800) {
      const bfStr = Math.min(1, (elapsedBf - 300) / 200) * (1 - Math.max(0, (elapsedBf - 1600) / 200));
      const bfColors = ['#E04040','#FF8800','#EEE020','#30B030','#3070CC'];
      ctx.save();
      for (let b = 0; b < 6; b++) {
        const bSpeed = 0.022 + b * 0.009;
        const bPhase = b * 101;
        const bx = ((animFrame * bSpeed + bPhase) % (canvas.width + 40)) - 20;
        const by = tileSize * (0.3 + (b % 3) * 0.5) + Math.sin(animFrame * 0.07 + b * 1.2) * 7
                   + Math.sin(animFrame * 0.031 + b * 0.5) * 4;
        const wingPhase = Math.sin(animFrame * 0.22 + b * 0.8);
        const wOpen = Math.abs(wingPhase);   // 0=閉じ, 1=開き
        const bCol = bfColors[b % bfColors.length];
        ctx.globalAlpha = bfStr * (0.32 + 0.12 * wOpen);
        ctx.fillStyle   = bCol;
        // 上翼（大きめ三角形）
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 7 * wOpen, by - 6);
        ctx.lineTo(bx - 3 * wOpen, by + 2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 7 * wOpen, by - 6);
        ctx.lineTo(bx + 3 * wOpen, by + 2);
        ctx.closePath();
        ctx.fill();
        // 下翼（小さめ）
        ctx.globalAlpha = bfStr * 0.22;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 5 * wOpen, by + 5);
        ctx.lineTo(bx - 1, by + 2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 5 * wOpen, by + 5);
        ctx.lineTo(bx + 1, by + 2);
        ctx.closePath();
        ctx.fill();
        // 触角
        ctx.globalAlpha = bfStr * 0.30;
        ctx.strokeStyle = '#1A0808';
        ctx.lineWidth   = 0.7;
        ctx.beginPath();
        ctx.moveTo(bx, by - 1);
        ctx.lineTo(bx - 3, by - 7);
        ctx.moveTo(bx, by - 1);
        ctx.lineTo(bx + 3, by - 7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── リシケシュ: ガンジス川のハスの花 ──
  if (loc === 'rishikesh') {
    for (let i = 0; i < 5; i++) {
      const speed = 0.10 + (i % 3) * 0.06;
      const lx    = ((animFrame * speed + i * 131) % (canvas.width + 30) + canvas.width + 30) % (canvas.width + 30) - 15;
      const row   = 10 + i % 2;
      const ly    = row * tileSize + tileSize * 0.44 + Math.sin(animFrame * 0.027 + i * 1.3) * 2;
      const pulse = 0.58 + 0.42 * Math.sin(animFrame * 0.034 + i * 0.85);
      ctx.save();
      // 花びら 4枚
      for (let p = 0; p < 4; p++) {
        const pa = p * Math.PI * 0.5 + animFrame * 0.005 + i * 0.35;
        ctx.globalAlpha = 0.52 * pulse;
        ctx.fillStyle   = p % 2 === 0 ? '#FFB8D0' : '#FF90A8';
        ctx.beginPath();
        ctx.ellipse(lx + Math.cos(pa) * 3.5, ly + Math.sin(pa) * 2.0, 3.5, 2.0, pa, 0, Math.PI * 2);
        ctx.fill();
      }
      // 中心
      ctx.globalAlpha = 0.68 * pulse;
      ctx.fillStyle   = '#FFE060';
      ctx.beginPath();
      ctx.arc(lx, ly, 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── リシケシュ: 夜の蛍 ──
  if (loc === 'rishikesh') {
    const elapsedFf = animFrame - fieldEnterFrame;
    if (elapsedFf >= 1600) {
      const mt = Math.min(1, (elapsedFf - 1600) / 500);
      ctx.save();
      for (let i = 0; i < 10; i++) {
        const bx    = ((i * 67 + 29) % (canvas.width - 50)) + 25;
        const by    = ((i * 41 + 73) % (canvas.height - 3 * tileSize - 24)) + 3 * tileSize + 12;
        const drift = Math.sin(animFrame * 0.018 + i * 1.4) * 9;
        const rise  = Math.sin(animFrame * 0.024 + i * 0.6) * 6;
        const blink = Math.pow(Math.abs(Math.sin(animFrame * 0.038 + i * 2.3)), 1.5);
        ctx.globalAlpha = mt * blink * 0.72;
        const fg = ctx.createRadialGradient(bx + drift, by + rise, 0, bx + drift, by + rise, 5);
        fg.addColorStop(0,    'rgba(160,255,100,1)');
        fg.addColorStop(0.45, 'rgba(100,220,60,0.55)');
        fg.addColorStop(1,    'rgba(60,160,30,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(bx + drift, by + rise, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// ===== プレイヤー方向影 (時間帯で影の向きが変わる) =====
function renderPlayerShadow() {
  const elapsed = animFrame - fieldEnterFrame;
  let offsetX, shadowA, scaleX;

  if (elapsed < 200) {
    const t = elapsed / 200;
    offsetX = (1 - t) * tileSize * 0.65;
    shadowA = 0.14 + t * 0.08;
    scaleX  = 1 + (1 - t) * 0.6;
  } else if (elapsed < 700) {
    const t = (elapsed - 200) / 500;
    offsetX = (1 - t) * tileSize * 0.3;
    shadowA = 0.22;
    scaleX  = 1 + (1 - t) * 0.15;
  } else if (elapsed < 1400) {
    const t = (elapsed - 700) / 700;
    offsetX = -t * tileSize * 0.55;
    shadowA = 0.22;
    scaleX  = 1 + t * 0.3;
  } else {
    const t = Math.min(1, (elapsed - 1400) / 600);
    offsetX = -tileSize * (0.55 + t * 0.35);
    shadowA = Math.max(0.04, 0.20 - t * 0.16);
    scaleX  = 1.3 + t * 0.2;
  }

  const px = Player.x * tileSize + tileSize / 2 + offsetX;
  const py = Player.y * tileSize + tileSize - 3;
  ctx.save();
  ctx.globalAlpha = shadowA;
  ctx.fillStyle = 'rgba(10,8,5,1)';
  ctx.beginPath();
  ctx.ellipse(px, py, tileSize * 0.28 * scaleX, tileSize * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ===== ゴーカルナ水面リプル =====
const waterRipples = [];

function spawnWaterRipple() {
  if (GameState.location !== 'gokarna') return;
  const waterRowH = 3 * tileSize;
  waterRipples.push({
    x:    Math.random() * canvas.width,
    y:    Math.random() * waterRowH,
    r:    0,
    maxR: 14 + Math.random() * 14,
    life: 1.0,
  });
}

function updateWaterRipples() {
  for (let i = waterRipples.length - 1; i >= 0; i--) {
    const rp = waterRipples[i];
    rp.r   += 0.38;
    rp.life = 1 - rp.r / rp.maxR;
    if (rp.life <= 0) waterRipples.splice(i, 1);
  }
}

function renderWaterRipples() {
  if (waterRipples.length === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(180,220,255,1)';
  ctx.lineWidth = 0.8;
  for (const rp of waterRipples) {
    ctx.globalAlpha = rp.life * 0.28;
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ===== NPC近接オーラリング =====
function renderNPCAuraRings() {
  const map = MapSystem.getMap(GameState.location);
  if (!map) return;
  for (const npc of map.npcs) {
    const dx   = npc.x - Player.x;
    const dy   = npc.y - Player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 3.2) continue;
    const prox  = Math.max(0, 1 - dist / 3.2);
    const pulse = 0.4 + 0.6 * Math.sin(animFrame * 0.055);
    const nx    = npc.x * tileSize + tileSize / 2;
    const ny    = npc.y * tileSize + tileSize / 2;
    const r     = tileSize * (0.62 + 0.14 * pulse);
    ctx.save();
    ctx.globalAlpha = prox * 0.22 * pulse;
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.stroke();
    // 二重リング（より近いと出現）
    if (prox > 0.55) {
      ctx.globalAlpha = (prox - 0.55) * 0.45 * pulse;
      ctx.beginPath();
      ctx.arc(nx, ny, r * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// パーティクルシステム
const particles = [];

function spawnParticles(wx, wy, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 0.8 + Math.random() * 1.2;
    particles.push({
      x: wx, y: wy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 1.0,
      decay: 0.04 + Math.random() * 0.03,
      size: 2 + Math.random() * 3,
      color,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.08; // gravity
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function renderParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life * 0.9;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function renderField() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateFootprints();
  const npcState = {
    hasChai: (GameState.inventory.chai || 0) > 0,
    playerStillFrames: Player.stillFrames || 0,
    footprints,
    npcs: Object.fromEntries(
      ['amma','sandeep','raju','saraswati'].map(id => [
        id, {
          chaiGiven:    GameState.chaiGiven[id] || null,
          progress:     GameState.npcProgress[id] || 0,
          farewellSeen: !!(GameState._farewellSeen?.[id]),
        }
      ])
    ),
  };
  MapSystem.render(
    ctx,
    GameState.location,
    GameState.currentMapItems,
    animFrame,
    Player.x, Player.y, Player.dir,
    tileSize,
    npcState
  );
  renderPlayerShadow();
  renderChaiAura();
  renderPlayerStatusIcon();
  if (animFrame % 13 === 0) spawnAmbientParticle(GameState.location);
  if (GameState.location === 'varanasi' && animFrame % 4 === 0) spawnAmbientParticle(GameState.location);
  updateAmbientParticles();
  renderAmbientParticles();
  spawnNatureParticle(GameState.location);
  updateNatureParticles();
  renderNatureParticles();
  updateParticles();
  renderParticles();
  renderMeditationRing();
  renderVivekaAura();
  spawnStarfall();
  updateStarfall();
  renderStarfall();
  updateGroundSparkles();
  renderGroundSparkles();
  renderHorizonGlow();
  if (animFrame % 55 === 0) spawnWaterRipple();
  if (animFrame % 37 === 18) spawnWaterRipple();
  updateWaterRipples();
  renderWaterRipples();
  renderNPCAuraRings();
  renderLocationMagic();
  updateFloatingTexts();
  renderFloatingTexts();
  renderChittaEffect();
  renderCanvasFlash();
  renderPranaFatigue();
  renderLocationTitle();
  renderEntranceRings();
  renderTransitionRipple();
  renderItemBeacons();
  renderNPCRelationDots();
  renderNPCFarewellMurmurs();
  renderDaytimeShift();
  renderSkyBand();
  renderVignette();
  renderHUD();
}

// チッタ依存キャンバスエフェクト
function renderChittaEffect() {
  const chitta = GameState.status.chitta || 50;
  if (chitta < 25) {
    const t = (25 - chitta) / 25;
    const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.022);
    ctx.fillStyle = `rgba(15,20,55,${t * 0.20 + pulse * t * 0.07})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (chitta > 75) {
    const t = (chitta - 75) / 25;
    const px = Player.x * tileSize + tileSize / 2;
    const py = Player.y * tileSize + tileSize / 2;
    const g = ctx.createRadialGradient(px, py, 0, px, py, tileSize * 2.8);
    const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.028);
    g.addColorStop(0, `rgba(255,210,100,${t * 0.10 * pulse})`);
    g.addColorStop(1, 'rgba(255,210,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 陽光: chitta>80のとき、周期的に光芒が斜めに走る
    if (chitta > 80) {
      const beamCycle = 260;
      const beamPhase = animFrame % beamCycle;
      if (beamPhase < 90) {
        const progress = beamPhase / 90;
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const alpha = Math.sin(Math.PI * progress) * (t * 0.09);
        if (alpha > 0.004) {
          const bx = -80 + ease * (canvas.width + 160);
          const bw = 55 + t * 30;
          ctx.save();
          ctx.globalAlpha = alpha;
          const bg = ctx.createLinearGradient(bx - bw, 0, bx + bw, canvas.height);
          bg.addColorStop(0, 'rgba(255,248,200,0)');
          bg.addColorStop(0.5, 'rgba(255,248,200,1)');
          bg.addColorStop(1, 'rgba(255,248,200,0)');
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.moveTo(bx - bw, 0);
          ctx.lineTo(bx + bw, 0);
          ctx.lineTo(bx + bw - 60, canvas.height);
          ctx.lineTo(bx - bw - 60, canvas.height);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
}

// ===== プラーナ低下疲労エフェクト =====
function renderPranaFatigue() {
  const prana = GameState.status.prana ?? 100;
  if (prana >= 30) return;
  const t = (30 - prana) / 30;
  const pulse = 0.5 + 0.5 * Math.sin(animFrame * (0.018 + t * 0.025));
  const alpha = t * 0.22 * pulse;
  if (alpha < 0.005) return;
  // 画面四辺から赤いグラデーション
  ctx.save();
  const gw = canvas.width;
  const gh = canvas.height;
  const spread = Math.min(gw, gh) * (0.35 + t * 0.2);
  const grad = ctx.createRadialGradient(gw / 2, gh / 2, spread * 0.4, gw / 2, gh / 2, spread * 1.4);
  grad.addColorStop(0, 'rgba(180,20,20,0)');
  grad.addColorStop(1, `rgba(180,20,20,${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, gw, gh);
  ctx.restore();
}

// ===== チャイ所持中スパイスオーラ =====
function renderChaiAura() {
  if ((GameState.inventory.chai || 0) <= 0) return;
  const spiceColors = {
    cardamom: '#80C880', ginger: '#E89040', cinnamon: '#C06030', turmeric: '#E8C000',
  };
  const col = spiceColors[GameState.lastChaiSpice] || '#FFD700';
  const px  = Player.x * tileSize + tileSize / 2;
  const py  = Player.y * tileSize + tileSize / 2;
  const orbitR = tileSize * 0.9;
  const dotCount = 6;
  ctx.save();
  for (let i = 0; i < dotCount; i++) {
    const angle = (animFrame * 0.038 + (i / dotCount) * Math.PI * 2);
    const ox    = px + Math.cos(angle) * orbitR;
    const oy    = py + Math.sin(angle) * orbitR * 0.55; // 楕円軌道
    const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.12 + i * 1.1);
    ctx.globalAlpha = 0.55 * pulse;
    ctx.fillStyle   = col;
    ctx.beginPath();
    ctx.arc(ox, oy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ===== プレイヤー感情アイコン =====
function renderPlayerStatusIcon() {
  const chitta  = GameState.status.chitta  || 50;
  const viveka  = GameState.status.viveka  || 0;
  const still   = Player.stillFrames       || 0;
  let icon = null;
  if      (chitta < 20)    icon = '💧';
  else if (viveka >= 80)   icon = '✨';
  else if (still > 240)    icon = '🧘';
  else if (chitta > 80)    icon = '☀';
  if (!icon) return;
  const px = Player.x * tileSize + tileSize / 2;
  const py = Player.y * tileSize - 4;
  const bob = Math.sin(animFrame * 0.06) * 2;
  const fade = Math.min(1, (still > 240 ? (still - 240) : 60) / 60);
  ctx.save();
  ctx.globalAlpha = 0.80 * fade;
  ctx.font = '11px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(icon, px, py + bob);
  ctx.restore();
}

// ===== アイテム光ビーコン =====
function renderItemBeacons() {
  const items = GameState.currentMapItems;
  if (!items) return;
  for (const item of items) {
    if (item.collected) continue;
    const cx = item.x * tileSize + tileSize / 2;
    const cy = item.y * tileSize + tileSize / 2;
    const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.06 + item.x * 0.4 + item.y * 0.7);
    const beamH = tileSize * 2.8;
    const alpha = 0.10 + 0.06 * pulse;
    ctx.save();
    const bg = ctx.createLinearGradient(cx, cy - beamH, cx, cy);
    bg.addColorStop(0, `rgba(255,240,160,0)`);
    bg.addColorStop(0.5, `rgba(255,220,100,${alpha})`);
    bg.addColorStop(1, `rgba(255,200,60,${alpha * 0.6})`);
    ctx.fillStyle = bg;
    ctx.fillRect(cx - 2, cy - beamH, 4, beamH);
    ctx.restore();
  }
}

// 別れたNPCの囁き吹き出し
const npcMurmurState = {};

function renderNPCFarewellMurmurs() {
  const mapData = MapSystem.getMap(GameState.location);
  if (!mapData || UI.screen !== 'field') return;
  for (const npc of mapData.npcs) {
    if (!GameState._farewellSeen?.[npc.id]) continue;
    const dx = Math.abs(npc.x - Player.x);
    const dy = Math.abs(npc.y - Player.y);
    const isNear = dx <= 2.5 && dy <= 2.5;
    let ms = npcMurmurState[npc.id];
    if (isNear && (!ms || animFrame > ms.end + 320)) {
      if (animFrame % 300 < 4) {
        const murmurs = Story.npcs[npc.id]?.farewell_murmur || [];
        if (murmurs.length > 0) {
          const text = murmurs[Math.floor(Math.random() * murmurs.length)];
          npcMurmurState[npc.id] = ms = { text, start: animFrame, end: animFrame + 110 };
        }
      }
    }
    if (!ms || animFrame > ms.end || !isNear) continue;
    const age = animFrame - ms.start;
    const dur = 110;
    const alpha = age < 20 ? age / 20 : age > dur - 25 ? (dur - age) / 25 : 1;
    const bx = npc.x * tileSize + tileSize / 2;
    const by = (npc.y - 1.2) * tileSize;
    ctx.save();
    ctx.globalAlpha = alpha * 0.88;
    ctx.font = '10px monospace';
    const tw = ctx.measureText(ms.text).width;
    const bw = tw + 18; const bh = 20;
    ctx.fillStyle = 'rgba(12,10,25,0.90)';
    ctx.fillRect(bx - bw / 2, by - bh, bw, bh);
    ctx.strokeStyle = 'rgba(212,168,75,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - bw / 2 + 0.5, by - bh + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = '#DDD0A8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ms.text, bx, by - bh / 2);
    ctx.restore();
  }
}

// 時間帯ライティング（場所滞在時間に応じてキャンバス色調を微変化）
function renderDaytimeShift() {
  const elapsed = animFrame - fieldEnterFrame;

  // 夜明け：入場直後0〜200フレーム、地平線から朝焼けが広がる
  if (elapsed < 200) {
    const dawnT   = elapsed / 200; // 0→1
    const dawnA   = Math.sin(dawnT * Math.PI) * 0.10; // ゆっくり上がってゆっくり消える
    const horizY  = (HORIZON_CFG[GameState.location]?.row ?? 3) * tileSize;
    const dawnCol = GameState.location === 'rishikesh' ? '80,200,160' : '255,160,60';
    const dg = ctx.createLinearGradient(0, horizY - tileSize * 2, 0, horizY + tileSize * 3);
    dg.addColorStop(0, `rgba(${dawnCol},0)`);
    dg.addColorStop(0.4, `rgba(${dawnCol},${dawnA})`);
    dg.addColorStop(1, `rgba(${dawnCol},0)`);
    ctx.save();
    ctx.fillStyle = dg;
    ctx.fillRect(0, horizY - tileSize * 2, canvas.width, tileSize * 5);
    ctx.restore();
  }

  // 黄金時間帯：400〜1400フレーム
  if (elapsed >= 400 && elapsed < 1400) {
    const rise  = Math.min(1, (elapsed - 400) / 500);
    const fall  = Math.max(0, 1 - (elapsed - 900) / 500);
    const alpha = rise * fall * 0.048;
    if (alpha > 0.001) {
      ctx.fillStyle = `rgba(255,175,55,${alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // ゴーカルナ限定: 水面をオレンジ〜ピンクに染める夕焼け反射
    if (GameState.location === 'gokarna' && alpha > 0.005) {
      const waterH = 3 * tileSize;
      const wg = ctx.createLinearGradient(0, 0, 0, waterH);
      wg.addColorStop(0, `rgba(255,100,40,${alpha * 1.8})`);
      wg.addColorStop(0.5, `rgba(255,150,60,${alpha * 1.2})`);
      wg.addColorStop(1, `rgba(255,180,80,${alpha * 0.4})`);
      ctx.save();
      ctx.fillStyle = wg;
      ctx.fillRect(0, 0, canvas.width, waterH);
      ctx.restore();
    }
  // 夕暮れ青：1400フレーム以降
  } else if (elapsed >= 1400) {
    const t = Math.min(1, (elapsed - 1400) / 900);
    ctx.fillStyle = `rgba(50,75,180,${t * 0.038})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 三日月＋夜空の星（1800フレーム以降）
    if (elapsed >= 1800) {
      const mt = Math.min(1, (elapsed - 1800) / 600);
      const mx = canvas.width - 22;
      const my = 18;
      const mr = 9;
      ctx.save();
      ctx.globalAlpha = mt * 0.55;
      ctx.fillStyle = '#E8E0C0';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1A1830';
      ctx.beginPath();
      ctx.arc(mx + 4, my - 2, mr - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ゴーカルナ: 水面への月光反射
      if (GameState.location === 'gokarna') {
        const refAlpha = mt * (0.12 + 0.08 * Math.sin(animFrame * 0.04));
        const refX     = canvas.width - 38; // 三日月のX位置に合わせる
        const refW     = 12 + 6 * Math.sin(animFrame * 0.03);
        const waterH   = 3 * tileSize; // 水タイル3行分
        const rg = ctx.createLinearGradient(0, 0, 0, waterH);
        rg.addColorStop(0,   `rgba(240,240,200,${refAlpha})`);
        rg.addColorStop(0.6, `rgba(255,255,220,${refAlpha * 0.5})`);
        rg.addColorStop(1,   'rgba(255,255,220,0)');
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = rg;
        // 揺れる水面反射の柱
        for (let rl = 0; rl < 6; rl++) {
          const rx = refX - refW / 2 + Math.sin(animFrame * 0.055 + rl * 0.9) * (refW * 0.4);
          ctx.globalAlpha = refAlpha * (1 - rl / 7);
          ctx.fillRect(rx - 2 + rl % 2, rl * (waterH / 6), 4 - rl % 2, waterH / 6 + 1);
        }
        ctx.restore();
      }

      // 夜の星（空エリアの上部3行にランダム固定位置で瞬く）
      const skyH = SKY_BAND[GameState.location]?.rows ?? 3;
      const starCount = 28;
      ctx.save();
      for (let i = 0; i < starCount; i++) {
        // 疑似ランダムな固定位置（iベースの決定論的ハッシュ）
        const sx = ((i * 137 + 41) % canvas.width);
        const sy = ((i * 97 + 13) % (skyH * tileSize - 4)) + 2;
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(animFrame * 0.03 + i * 0.74));
        ctx.globalAlpha = mt * twinkle * 0.75;
        ctx.fillStyle = i % 5 === 0 ? '#FFE8C0' : '#FFFFFF';
        const r = i % 7 === 0 ? 1.4 : 0.9;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }
}

// ===== 空帯グロー (水面・遠景行にロケーション別の色を重ねる) =====
const SKY_BAND = {
  gokarna:   { rows: 3, color0: 'rgba(60,130,220,', color1: 'rgba(30,80,170,',  baseA: 0.10 },
  hampi:     { rows: 2, color0: 'rgba(180,120,60,',  color1: 'rgba(130,80,30,',  baseA: 0.08 },
  varanasi:  { rows: 2, color0: 'rgba(220,130,60,',  color1: 'rgba(180,80,30,',  baseA: 0.10 },
  rishikesh: { rows: 2, color0: 'rgba(80,200,140,',  color1: 'rgba(40,140,90,',  baseA: 0.07 },
};

function renderSkyBand() {
  const cfg = SKY_BAND[GameState.location];
  if (!cfg) return;
  const h = cfg.rows * tileSize;
  const pulse = 0.85 + 0.15 * Math.sin(animFrame * 0.018);
  const a = cfg.baseA * pulse;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, cfg.color1 + (a * 1.4) + ')');
  g.addColorStop(0.5, cfg.color0 + a + ')');
  g.addColorStop(1, cfg.color0 + '0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, h);
  ctx.restore();
}

function renderVivekaAura() {
  const viveka = GameState.status.viveka || 0;
  if (viveka < 70) return;
  const vNorm = (viveka - 70) / 30; // 0→1 as viveka goes 70→100
  const px = Player.x * tileSize + tileSize / 2;
  const py = Player.y * tileSize + tileSize / 2;

  // 散発的な金色パーティクル（約150フレームに1回）
  if (animFrame % 90 === 0) {
    const count = Math.floor(1 + vNorm * 2);
    for (let i = 0; i < count; i++) spawnParticles(px, py, '#FFD700', 1);
  }

  // プレイヤー周囲の微細な光の輪
  const auraAlpha = 0.06 + 0.04 * vNorm * Math.sin(animFrame * 0.06);
  const auraR = tileSize * (1.2 + 0.4 * vNorm);
  const auraGrad = ctx.createRadialGradient(px, py, tileSize * 0.3, px, py, auraR);
  auraGrad.addColorStop(0, `rgba(255,240,160,${auraAlpha * 2})`);
  auraGrad.addColorStop(0.5, `rgba(255,210,80,${auraAlpha})`);
  auraGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.fillStyle = auraGrad;
  ctx.beginPath();
  ctx.arc(px, py, auraR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderVignette() {
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height * 0.28,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.78
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ロケーション別雰囲気エフェクト
  if (GameState.location === 'varanasi')  renderVaranasiFireGlow();
  if (GameState.location === 'rishikesh') renderRishikeshShimmer();
  if (GameState.location === 'hampi')     renderHampiDustHaze();
  if (GameState.location === 'gokarna')   renderGokarnaWaveGlow();
}

function renderVaranasiFireGlow() {
  // 火葬場の炎：shrine(wall)タイルの中央に大きめの輝き
  // バラナシマップ: row5にx=1-2, 6-7, 12-13, 17-18 のWALL
  const shrines = [
    {x: 1.5, y: 5}, {x: 6.5, y: 5}, {x: 12.5, y: 5}, {x: 17.5, y: 5},
  ];
  const flicker  = 0.55 + 0.45 * Math.sin(animFrame * 0.18 + 1.0);
  const flicker2 = 0.55 + 0.45 * Math.sin(animFrame * 0.24 + 2.5);
  shrines.forEach((s, i) => {
    const f = i % 2 === 0 ? flicker : flicker2;
    const px = s.x * tileSize;
    const py = s.y * tileSize + tileSize * 0.5;
    const r = tileSize * 2.2;
    const grad = ctx.createRadialGradient(px, py, 2, px, py, r);
    grad.addColorStop(0, `rgba(255,180,40,${0.5 * f})`);
    grad.addColorStop(0.4, `rgba(255,100,10,${0.28 * f})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  });
  // 上部（川）方向への炎の明かり反射
  const reflectAlpha = 0.08 + 0.04 * Math.sin(animFrame * 0.07);
  const reflectGrad = ctx.createLinearGradient(0, 0, 0, 3 * tileSize);
  reflectGrad.addColorStop(0, `rgba(200,80,10,${reflectAlpha})`);
  reflectGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = reflectGrad;
  ctx.fillRect(0, 0, canvas.width, 3 * tileSize);
  // ガンジス川を流れるディーヤ（灯篭）
  for (let d = 0; d < 6; d++) {
    const speed = 0.35 + d * 0.06;
    const dx = ((animFrame * speed * 0.6 + d * (canvas.width / 6) + d * 30) % (canvas.width + 20)) - 10;
    const row = d % 2;
    const dy = row * tileSize + tileSize * (0.4 + 0.1 * Math.sin(animFrame * 0.05 + d * 1.2));
    const glow = 0.5 + 0.5 * Math.sin(animFrame * 0.11 + d * 1.7);
    const alpha = 0.25 + 0.2 * glow;
    const r = tileSize * 0.55;
    const dGrad = ctx.createRadialGradient(dx, dy, 1, dx, dy, r);
    dGrad.addColorStop(0,   `rgba(255,210,80,${alpha})`);
    dGrad.addColorStop(0.35,`rgba(255,130,30,${alpha * 0.55})`);
    dGrad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = dGrad;
    ctx.fillRect(dx - r, dy - r, r * 2, r * 2);
    // 灯篭の中心点
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#FFEE99';
    ctx.fillRect(dx - 1, dy - 1, 2, 2);
    ctx.restore();
  }

  // 全体的なオレンジ色ムード
  const moodAlpha = 0.07 + 0.03 * Math.sin(animFrame * 0.05);
  ctx.fillStyle = `rgba(180,60,0,${moodAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderRishikeshShimmer() {
  // ガンジス川の水面の光の揺らぎ
  const waterRows = [10, 11];
  waterRows.forEach(row => {
    for (let col = 0; col < 20; col++) {
      const t = animFrame * 0.08 + col * 0.4 + row * 0.9;
      const shimmer = 0.5 + 0.5 * Math.sin(t);
      if (shimmer > 0.7) {
        const px = col * tileSize + tileSize * Math.random() * 0.5;
        const py = row * tileSize + tileSize * 0.3 + Math.sin(t * 2) * 4;
        ctx.save();
        ctx.globalAlpha = (shimmer - 0.7) * 0.5;
        ctx.fillStyle = '#AADDFF';
        ctx.fillRect(px, py, 3 + Math.random() * 4, 1);
        ctx.restore();
      }
    }
  });

  // ヴィヴェーカに連動した夜空の深さ
  const vivekaNorm = Math.min(1, (GameState.status.viveka || 0) / 80);
  const starCount = Math.floor(40 + 70 * vivekaNorm); // viveka 0→80: 40→110 stars
  const fireflyCount = Math.floor(6 + 10 * vivekaNorm); // 6→16 fireflies

  // 夜空の星（山の上 rows 0-2）
  for (let s = 0; s < starCount; s++) {
    const sx = (s * 73 + 17) % canvas.width;
    const sy = (s * 37 + 11) % (2.8 * tileSize);
    const twinkle = 0.5 + 0.5 * Math.sin(animFrame * 0.05 + s * 1.3);
    if (twinkle > 0.52) {
      ctx.save();
      ctx.globalAlpha = (twinkle - 0.52) * (1.0 + 0.5 * vivekaNorm);
      ctx.fillStyle = s % 5 === 0 ? '#FFE8A0' : s % 7 === 0 ? '#C0E0FF' : '#FFFFFF';
      const sz = twinkle > 0.88 ? 2 : 1;
      ctx.fillRect(sx, sy, sz, sz);
      ctx.restore();
    }
  }

  // 蛍（草原・木の周辺 rows 3-5）
  for (let f = 0; f < fireflyCount; f++) {
    const baseX = (f * 83 + 23) % canvas.width;
    const baseY = (3.5 + (f % 4) * 0.7) * tileSize;
    const fx = baseX + Math.sin(animFrame * 0.04 + f * 2.1) * 22;
    const fy = baseY + Math.cos(animFrame * 0.03 + f * 1.5) * 14;
    const glow = 0.5 + 0.5 * Math.sin(animFrame * 0.14 + f * 2.7);
    if (glow > 0.52) {
      ctx.save();
      ctx.globalAlpha = (glow - 0.52) * (0.8 + 0.4 * vivekaNorm);
      ctx.fillStyle = '#BBFF77';
      ctx.beginPath();
      ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha *= 0.28;
      ctx.fillStyle = '#AAFFAA';
      ctx.beginPath();
      ctx.arc(fx, fy, 7 + 3 * vivekaNorm, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 夜の紺色ムード（より濃い夜空感）
  const moodAlpha = 0.07 + 0.02 * Math.sin(animFrame * 0.03);
  ctx.fillStyle = `rgba(20,30,90,${moodAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderHampiDustHaze() {
  // 廃墟の砂塵：地平線近くに揺らぐ熱気と砂埃
  const t = animFrame * 0.015;
  const hazeY = canvas.height * 0.55;
  const hazeAlpha = 0.04 + 0.02 * Math.sin(t);
  const hazeGrad = ctx.createLinearGradient(0, hazeY - 20, 0, hazeY + 40);
  hazeGrad.addColorStop(0, 'rgba(0,0,0,0)');
  hazeGrad.addColorStop(0.5, `rgba(180,120,60,${hazeAlpha})`);
  hazeGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, hazeY - 20, canvas.width, 60);

  // 岩の遺跡からの陽炎パーティクル（実際のWALLタイルに合わせた位置）
  const ruins = [{x:6,y:5},{x:9,y:5},{x:6,y:8},{x:9,y:8}];
  ruins.forEach((r, i) => {
    const phase = animFrame * 0.06 + i * 1.3;
    const drift = Math.sin(phase) * 6;
    const px = r.x * tileSize + tileSize / 2 + drift;
    const py = r.y * tileSize;
    const alpha = (0.3 + 0.2 * Math.sin(phase * 1.7)) * 0.4;
    const grad = ctx.createRadialGradient(px, py, 1, px, py - 10, tileSize * 1.2);
    grad.addColorStop(0, `rgba(200,150,80,${alpha})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(px - tileSize, py - tileSize * 1.5, tileSize * 2, tileSize * 2);
  });

  // 舞い上がる砂の微粒子
  for (let d = 0; d < 14; d++) {
    const col = (d * 61 + d * 20) % canvas.width;
    const progress = ((animFrame * 0.007 + d * 0.14) % 1);
    const dx = col + Math.sin(animFrame * 0.02 + d * 1.3) * 12;
    const dy = canvas.height * (1 - progress) - 16;
    if (dy < 0 || dy > canvas.height) continue;
    const alpha = Math.sin(progress * Math.PI) * 0.18;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#E8C080';
    ctx.fillRect(dx, dy, 2, 2);
    ctx.restore();
  }

  // 全体の暖色ムード（乾いた赤土）
  const moodAlpha = 0.05 + 0.02 * Math.sin(animFrame * 0.04);
  ctx.fillStyle = `rgba(160,90,30,${moodAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderGokarnaWaveGlow() {
  // 海辺の波光：上部の水エリア（rows 0-2）に波紋
  const seaRows = [0, 1, 2];
  seaRows.forEach(row => {
    for (let col = 0; col < 20; col++) {
      const t = animFrame * 0.05 + col * 0.6 + row * 1.1;
      const wave = 0.5 + 0.5 * Math.sin(t);
      if (wave > 0.65) {
        const px = col * tileSize + tileSize * 0.3;
        const py = row * tileSize + tileSize * 0.5 + Math.sin(t * 1.5) * 5;
        ctx.save();
        ctx.globalAlpha = (wave - 0.65) * 0.6;
        ctx.fillStyle = '#88CCEE';
        ctx.fillRect(px, py, 5 + Math.sin(t) * 3, 2);
        ctx.restore();
      }
    }
  });
  // 水平線の光：砂浜と海の境目に金色の輝き
  const horizonY = 3 * tileSize;
  const sunPhase = animFrame * 0.02;
  const sunAlpha = 0.06 + 0.03 * Math.sin(sunPhase);
  const sunGrad = ctx.createLinearGradient(0, horizonY - 10, 0, horizonY + 20);
  sunGrad.addColorStop(0, 'rgba(0,0,0,0)');
  sunGrad.addColorStop(0.5, `rgba(220,200,120,${sunAlpha})`);
  sunGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, horizonY - 10, canvas.width, 30);

  // 朝日：右側の水平線から昇る太陽の輝き
  const riseX = canvas.width * 0.78;
  const riseY = horizonY - 4;
  const riseAlpha = 0.12 + 0.06 * Math.sin(animFrame * 0.012);
  const riseGrad = ctx.createRadialGradient(riseX, riseY, 4, riseX, riseY, tileSize * 2.8);
  riseGrad.addColorStop(0, `rgba(255,230,140,${riseAlpha * 2.5})`);
  riseGrad.addColorStop(0.25, `rgba(255,170,60,${riseAlpha * 1.5})`);
  riseGrad.addColorStop(0.6, `rgba(255,100,20,${riseAlpha * 0.5})`);
  riseGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = riseGrad;
  ctx.fillRect(riseX - tileSize * 3, 0, tileSize * 6, horizonY + tileSize);

  // 全体の暖かい夜明けムード
  const moodAlpha = 0.04 + 0.015 * Math.sin(animFrame * 0.035);
  ctx.fillStyle = `rgba(40,80,140,${moodAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const dawnAlpha = 0.025 + 0.01 * Math.sin(animFrame * 0.018);
  ctx.fillStyle = `rgba(200,120,40,${dawnAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderNPCRelationDots() {
  const map = MapSystem.getMap(GameState.location);
  if (!map) return;
  for (const npc of map.npcs) {
    const prog = GameState.npcProgress[npc.id] || 0;
    const chaiGiven = GameState.chaiGiven[npc.id];
    const cx = npc.x * tileSize + tileSize / 2;
    const cy = npc.y * tileSize - 32;

    // 近接時: 足元の地面グロウ
    {
      const pdx = Math.abs(npc.x - Player.x);
      const pdy = Math.abs(npc.y - Player.y);
      if (pdx <= 2.5 && pdy <= 2.5) {
        const gx = npc.x * tileSize + tileSize / 2;
        const gy = npc.y * tileSize + tileSize - 6;
        const npcInfo = NPC_COLORS[npc.id];
        const pulse = 0.35 + 0.2 * Math.sin(animFrame * 0.08);
        const gGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, tileSize * 0.9);
        const col = npcInfo ? npcInfo.color : '#FFD700';
        const _h = col.replace('#', '');
        const _cr = parseInt(_h.slice(0,2),16), _cg = parseInt(_h.slice(2,4),16), _cb = parseInt(_h.slice(4,6),16);
        gGrad.addColorStop(0, `rgba(${_cr},${_cg},${_cb},${pulse * 0.55})`);
        gGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.fillStyle = gGrad;
        ctx.fillRect(gx - tileSize, gy - tileSize * 0.5, tileSize * 2, tileSize);
        ctx.restore();
      }
    }

    if (prog <= 0) {
      // 未接触NPC: 点滅する「！」バッジ
      const pulse = 0.6 + 0.4 * Math.sin(animFrame * 0.1);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('！', cx, cy + 1);
      ctx.restore();

      // 未接触NPC: 近くにいる時に独り言を表示
      const npcData = Story.npcs[npc.id];
      if (npcData?.idle) {
        const dx = Math.abs(npc.x - Player.x);
        const dy = Math.abs(npc.y - Player.y);
        if (dx <= 3 && dy <= 3) {
          const idleLines = npcData.idle;
          const period = 300;
          const lineIdx = Math.floor(animFrame / period) % idleLines.length;
          const lineT = animFrame % period;
          const fadeAlpha = lineT < 30 ? lineT / 30 : lineT > period - 30 ? (period - lineT) / 30 : 1;
          const murmur = idleLines[lineIdx];
          const tx = cx;
          const ty = npc.y * tileSize - 52;
          ctx.save();
          ctx.globalAlpha = fadeAlpha * 0.65;
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(murmur).width;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(tx - tw / 2 - 5, ty - 14, tw + 10, 16);
          ctx.fillStyle = 'rgba(200,185,160,1)';
          ctx.fillText(murmur, tx, ty);
          ctx.restore();
        }
      }
      continue;
    }

    // チャイを渡したNPCには持続するスパイスオーラ
    if (chaiGiven) {
      const spiceRGB = {
        cardamom: [80, 200, 100], ginger: [230, 140, 55],
        cinnamon: [200, 95, 45],  turmeric: [235, 200, 45],
      };
      const sc = spiceRGB[chaiGiven] || [212, 168, 75];
      const pulse = 0.30 + 0.12 * Math.sin(animFrame * 0.038);
      const gx = npc.x * tileSize + tileSize / 2;
      const gy = npc.y * tileSize + tileSize / 2;
      const aR = tileSize * 2.0;
      const aGrad = ctx.createRadialGradient(gx, gy, tileSize * 0.3, gx, gy, aR);
      aGrad.addColorStop(0, `rgba(${sc[0]},${sc[1]},${sc[2]},${pulse * 0.55})`);
      aGrad.addColorStop(0.5, `rgba(${sc[0]},${sc[1]},${sc[2]},${pulse * 0.22})`);
      aGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.fillStyle = aGrad;
      ctx.beginPath();
      ctx.arc(gx, gy, aR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 関係ドット（prog >= 1）
    const dots = Math.min(prog, 4);
    const spacing = 8;
    const totalW = (dots - 1) * spacing;
    const color = prog >= 4 ? '#FFD700' : chaiGiven ? '#88CCFF' : '#FFFFFF';
    for (let i = 0; i < dots; i++) {
      const x = cx - totalW / 2 + i * spacing;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    // 別れ済み（prog >= 4）: 近くにいる時に別れ後のむせびを表示
    if (prog >= 4) {
      const npcData = Story.npcs[npc.id];
      const farewellLines = npcData?.farewell_murmur;
      if (farewellLines) {
        const dx = Math.abs(npc.x - Player.x);
        const dy = Math.abs(npc.y - Player.y);
        if (dx <= 3 && dy <= 3) {
          const period = 420;
          const lineIdx = Math.floor(animFrame / period) % farewellLines.length;
          const lineT = animFrame % period;
          const fadeAlpha = lineT < 30 ? lineT / 30 : lineT > period - 30 ? (period - lineT) / 30 : 1;
          const murmur = farewellLines[lineIdx];
          const tx = cx;
          const ty = npc.y * tileSize - 52;
          const npcInfo = NPC_COLORS[npc.id];
          ctx.save();
          ctx.globalAlpha = fadeAlpha * 0.45;
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(murmur).width;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(tx - tw / 2 - 5, ty - 14, tw + 10, 16);
          ctx.fillStyle = npcInfo ? npcInfo.color : 'rgba(212,168,75,1)';
          ctx.fillText(murmur, tx, ty);
          ctx.restore();
        }
      }
    }

    // 出会い済み（prog 1-3）: 近くにいる時に独り言を表示
    if (prog >= 1 && prog < 4) {
      const npcData = Story.npcs[npc.id];
      const murmurLines = npcData?.idle_met;
      if (murmurLines) {
        const dx = Math.abs(npc.x - Player.x);
        const dy = Math.abs(npc.y - Player.y);
        if (dx <= 3 && dy <= 3) {
          const period = 360;
          const lineIdx = Math.floor(animFrame / period) % murmurLines.length;
          const lineT = animFrame % period;
          const fadeAlpha = lineT < 30 ? lineT / 30 : lineT > period - 30 ? (period - lineT) / 30 : 1;
          const murmur = murmurLines[lineIdx];
          const tx = cx;
          const ty = npc.y * tileSize - 52;
          const npcInfo = NPC_COLORS[npc.id];
          ctx.save();
          ctx.globalAlpha = fadeAlpha * 0.6;
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(murmur).width;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(tx - tw / 2 - 5, ty - 14, tw + 10, 16);
          ctx.fillStyle = npcInfo ? npcInfo.color : 'rgba(210,190,160,1)';
          ctx.fillText(murmur, tx, ty);
          ctx.restore();
        }
      }
    }
  }
}

function renderHUD() {
  const map = MapSystem.getMap(GameState.location);
  if (!map) return;

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const talkVerb = isTouch ? 'タップ' : 'クリック';

  // プレイヤーと各NPCの距離を測り、近ければヒント＆近接チャイム
  for (const npc of map.npcs) {
    const dx = Math.abs(npc.x - Player.x);
    const dy = Math.abs(npc.y - Player.y);
    const isNear = dx <= 2 && dy <= 2;
    if (isNear) {
      const npcData = Story.npcs[npc.id];
      const npcLabel = npcData ? npcData.name : npc.name;
      drawHint(npc.x * tileSize + tileSize / 2, (npc.y - 1) * tileSize, `${talkVerb}で${npcLabel}に話す`);
    }
    // 近接チャイム + アプローチ輝き（初回進入時のみ）
    if (isNear && !npcProximityState[npc.id]) {
      npcProximityState[npc.id] = true;
      if (animFrame > 60) AudioSystem.sfxNpcNear();
      // NPC位置から淡い輝きパーティクル
      const npcColors = { amma:'#D4884B', sandeep:'#8BA8D9', raju:'#7BC87A', saraswati:'#FFD700' };
      const col = npcColors[npc.id] || '#FFD700';
      const nx = npc.x * tileSize + tileSize / 2;
      const ny = npc.y * tileSize + tileSize / 2;
      spawnParticles(nx, ny, col, 5);
      spawnParticles(nx, ny, '#FFFFFF', 3);
    } else if (!isNear) {
      npcProximityState[npc.id] = false;
    }
    // 近接中は継続的に微細な輝き（60フレームに1回）
    if (isNear && animFrame % 60 === 0 && !GameState._farewellSeen?.[npc.id]) {
      const nx = npc.x * tileSize + tileSize / 2;
      const ny = npc.y * tileSize + tileSize / 2;
      spawnParticles(nx, ny, '#FFE8A0', 1);
    }
    if (isNear) break;
  }

  // アイテムヒント
  for (const item of (GameState.currentMapItems || [])) {
    if (item.collected) continue;
    const dx = Math.abs(item.x - Player.x);
    const dy = Math.abs(item.y - Player.y);
    if (dx <= 1 && dy <= 1) {
      const info = Story.items[item.id];
      drawHint(item.x * tileSize + tileSize / 2, (item.y - 1) * tileSize, `${talkVerb}で${info?.name || item.name}を拾う`);
      break;
    }
  }

  // 出口ヒント
  for (const exit of map.exits) {
    const midY = Math.floor((exit.y + (exit.y2 || exit.y)) / 2);
    if (Math.abs(exit.x - Player.x) <= 3 && Math.abs(midY - Player.y) <= 3) {
      drawHint(exit.x * tileSize - tileSize, midY * tileSize, exit.label);
      break;
    }
  }

  // リシュケーシュ: 川のほとりへのヒント
  if (GameState.location === 'rishikesh' && GameState.visitedLocations.length >= 4) {
    const row = Math.floor(Player.y);
    if (row >= 7 && row < 9) {
      drawHint(canvas.width / 2, 9 * tileSize - tileSize, '川のほとりへ ↓');
    }
  }

  // 場所の雰囲気テキスト + テーマ（入場後しばらく表示）
  {
    const elapsedFrames = animFrame - fieldEnterFrame;
    if (elapsedFrames < 420) {
      const mapData = MapSystem.getMap(GameState.location);
      const locData = Story.locations[GameState.location];
      const t = elapsedFrames;
      const alpha = t < 90 ? (t / 90) * 0.6 : t > 330 ? ((420 - t) / 90) * 0.6 : 0.6;
      ctx.save();
      ctx.globalAlpha = alpha;
      // 左上に雰囲気テキスト（複数行をゆっくり切り替え）
      const locData2 = Story.locations[GameState.location];
      const ambiLines = (locData2 && locData2.ambienceLines) || (mapData && mapData.ambience ? [mapData.ambience] : []);
      if (ambiLines.length > 0) {
        const period = 280; // フレーム/1行
        const lineIdx = Math.floor(elapsedFrames / period) % ambiLines.length;
        const lineT = elapsedFrames % period;
        const lineAlpha2 = lineT < 40 ? lineT / 40 : lineT > period - 40 ? (period - lineT) / 40 : 1;
        ctx.globalAlpha = alpha * lineAlpha2;
        ctx.fillStyle = 'rgba(255,245,220,1)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(ambiLines[lineIdx], 8, 8);
        ctx.globalAlpha = alpha; // テーマテキスト用にリセット
      }
      // 右上にロケーションテーマ
      if (locData && locData.theme) {
        ctx.fillStyle = 'rgba(212,168,75,1)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`〈 ${locData.theme} 〉`, canvas.width - 8, 8);
      }
      ctx.restore();
    }
  }

  // 定期的な環境テキスト（入場後の初期表示が終わった後）
  {
    const elapsedFrames = animFrame - fieldEnterFrame;
    const locData2 = Story.locations[GameState.location];
    const ambiLines = locData2?.ambienceLines;
    if (ambiLines?.length > 0 && elapsedFrames >= 420) {
      const period = 900;       // 900フレームごとに1行
      const displayDur = 150;   // 150フレーム表示
      const cyclePos = elapsedFrames % period;
      if (cyclePos < displayDur) {
        const lineIdx = Math.floor(elapsedFrames / period) % ambiLines.length;
        const alpha = cyclePos < 40 ? cyclePos / 40 : cyclePos > displayDur - 40 ? (displayDur - cyclePos) / 40 : 1;
        ctx.save();
        ctx.globalAlpha = alpha * 0.42;
        ctx.fillStyle = 'rgba(255,245,220,1)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(ambiLines[lineIdx], 8, 8);
        ctx.restore();
      }
    }
  }

  // 内なるモノローグ（パーソナリティ別・1350フレーム周期）
  {
    const elapsedFrames = animFrame - fieldEnterFrame;
    const personalityThoughts = Story.personalityThoughts?.[GameState.personality];
    if (personalityThoughts && elapsedFrames >= 600) {
      const thoughtPeriod = 1350;
      const thoughtDur = 120;
      const thoughtPos = (elapsedFrames + 450) % thoughtPeriod;
      if (thoughtPos < thoughtDur) {
        const tidx = Math.floor((elapsedFrames + 450) / thoughtPeriod) % personalityThoughts.length;
        const talpha = thoughtPos < 30 ? thoughtPos / 30 : thoughtPos > thoughtDur - 30 ? (thoughtDur - thoughtPos) / 30 : 1;
        ctx.save();
        ctx.globalAlpha = talpha * 0.35;
        ctx.fillStyle = 'rgba(240,230,210,1)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(personalityThoughts[tidx], canvas.width - 8, canvas.height - 52);
        ctx.restore();
      }
    }
  }

  // ヴィヴェーカ高値時の画面エフェクト（金色の微光）
  const viveka = GameState.status.viveka || 0;
  if (viveka >= 50) {
    const intensity = (viveka - 50) / 50; // 0→1 as viveka 50→100
    const pulse = 0.5 + 0.5 * Math.sin(animFrame * 0.025);
    const gAlpha = 0.03 + 0.04 * intensity * pulse;
    const vGrad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, canvas.width * 0.6
    );
    vGrad.addColorStop(0, `rgba(212,168,75,${gAlpha * 0.5})`);
    vGrad.addColorStop(0.6, `rgba(212,168,75,${gAlpha})`);
    vGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // チャイ所持インジケーター（画面左下）
  {
    const chaiCount = GameState.inventory.chai || 0;
    if (chaiCount > 0) {
      const pulse = 0.88 + 0.12 * Math.sin(animFrame * 0.07);
      const ix = 8, iy = canvas.height - 50;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(10,5,0,0.72)';
      ctx.fillRect(ix - 4, iy - 4, 54, 28);
      ctx.strokeStyle = 'rgba(212,168,75,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ix - 3.5, iy - 3.5, 53, 27);
      // カップ本体（シンプルなピクセルドロー）
      ctx.fillStyle = '#D4A84B';
      ctx.fillRect(ix, iy + 4, 12, 9);       // 胴
      ctx.fillRect(ix + 1, iy + 2, 10, 3);   // 上縁
      ctx.fillRect(ix + 2, iy + 13, 8, 2);   // 底
      ctx.fillStyle = '#A07030';
      ctx.fillRect(ix + 12, iy + 5, 3, 5);   // 取っ手
      // 湯気（2本の波線）
      ctx.fillStyle = 'rgba(255,230,180,0.6)';
      for (let s = 0; s < 2; s++) {
        const sx = ix + 3 + s * 5;
        const phase = animFrame * 0.055 + s * 1.4;
        const sy = iy + 1 - Math.sin(phase) * 1.5;
        ctx.fillRect(sx, sy, 1, 3);
      }
      // 個数テキスト
      ctx.fillStyle = '#F0D898';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${chaiCount}`, ix + 16, iy + 10);
      ctx.restore();
    }
  }

  // チュートリアルヒント（ゴーカルナ最初の入場のみ）
  if (GameState.location === 'gokarna' && GameState.visitedLocations.length === 1) {
    const t = animFrame - fieldEnterFrame;
    if (t > 60 && t < 420) {
      const alpha = t < 120 ? (t - 60) / 60 : t > 360 ? (420 - t) / 60 : 1;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      const bx = canvas.width / 2 - 140, by = canvas.height - 90;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(bx, by, 280, 44);
      ctx.strokeStyle = 'rgba(212,168,75,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, 279, 43);
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      ctx.fillStyle = '#F0E0C0';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NPCに近づいて話しかけよう', canvas.width / 2, by + 14);
      ctx.fillStyle = '#A09070';
      ctx.font = '10px monospace';
      const hint2 = isTouch
        ? '左下のDパッドで移動　「話」で話しかける'
        : '矢印キー / WASD で移動　　M / Esc でメニュー';
      ctx.fillText(hint2, canvas.width / 2, by + 30);
      ctx.restore();
    }
  }
}

function drawHint(cx, cy, text) {
  ctx.save();
  ctx.font = 'bold 13px monospace';
  const tw = ctx.measureText(text).width;
  const pw = tw + 16, ph = 22;
  const bx = Math.max(2, Math.min(canvas.width - pw - 2, cx - pw / 2));
  const by = Math.max(2, cy - ph - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(bx, by, pw, ph);
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx + 0.5, by + 0.5, pw - 1, ph - 1);
  ctx.fillStyle = '#FFD700';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 8, by + ph / 2);
  ctx.restore();
}

// ===== クリック / タッチ処理 =====
function setupCanvasClick() {
  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      col: Math.floor((clientX - rect.left) * scaleX / tileSize),
      row: Math.floor((clientY - rect.top)  * scaleY / tileSize),
    };
  }

  canvas.addEventListener('click', e => {
    if (UI.screen !== 'field') return;
    const { col, row } = getCanvasCoords(e.clientX, e.clientY);
    handleFieldClick(col, row);
  });

  // タッチ対応: touchend でフィールドタップ移動
  canvas.addEventListener('touchend', e => {
    if (UI.screen !== 'field') return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const { col, row } = getCanvasCoords(t.clientX, t.clientY);
    handleFieldClick(col, row);
  }, { passive: false });
}

function handleFieldClick(col, row) {
  const map = MapSystem.getMap(GameState.location);
  if (!map) return;

  // NPC クリック判定
  for (const npc of map.npcs) {
    if (Math.abs(npc.x - col) <= 1 && Math.abs(npc.y - row) <= 1) {
      interactWithNPC(npc.id);
      return;
    }
  }

  // アイテム クリック判定
  for (const item of (GameState.currentMapItems || [])) {
    if (!item.collected && item.x === col && item.y === row) {
      collectItem(item);
      return;
    }
  }

  // 出口 クリック判定
  for (const exit of map.exits) {
    if (exit.x === col && row >= exit.y && row <= (exit.y2 || exit.y)) {
      // 出口に近づいたら移動
      movePlayerTo(exit.x - 1, Math.floor((exit.y + (exit.y2 || exit.y)) / 2));
      setTimeout(() => triggerExit(exit), 800);
      return;
    }
  }

  // 移動
  if (MapSystem.isWalkable(GameState.location, col, row)) {
    movePlayerTo(col, row);
  }
}

function movePlayerTo(col, row) {
  if (MapSystem.isWalkable(GameState.location, col, row)) {
    Player.targetX = col;
    Player.targetY = row;
  }
}

// ===== NPC インタラクション =====
function interactWithNPC(npcId) {
  UI.screen = 'dialogue';
  UI.currentNpc = npcId;

  const conv = NPCSystem.startConversation(npcId, GameState);
  if (conv) showDialogue(conv);
}

// NPCカラー定義
const NPC_COLORS = {
  amma:      { color: '#D4884B', icon: '👵' },
  sandeep:   { color: '#8B7040', icon: '🧘' },
  raju:      { color: '#C08040', icon: '👦' },
  saraswati: { color: '#80B0C8', icon: '🙏' },
};

function showDialogue(conv) {
  const overlay = $('dialogue-overlay');
  overlay.classList.add('active');

  // NPCアバター + ダイアログボックスのカラー
  const speakerEl = $('dialogue-speaker');
  const dialogueBox = $('dialogue-box');
  const npcInfo = UI.currentNpc ? NPC_COLORS[UI.currentNpc] : null;
  const isNarrator = !conv.speaker || conv.speaker.includes('ナレーション') || conv.speaker === '';
  if (npcInfo && !isNarrator) {
    // 会話進捗ドット（●=済, ○=未, ★=別れ済み）
    const prog = UI.currentNpc ? (GameState.npcProgress[UI.currentNpc] || 0) : 0;
    const farewellDone = UI.currentNpc ? !!(GameState._farewellSeen?.[UI.currentNpc]) : false;
    const MAX_DOTS = 4;
    let dotsHtml = '';
    if (prog > 0 || farewellDone) {
      const dots = Array.from({ length: MAX_DOTS }, (_, i) => {
        if (farewellDone && i === MAX_DOTS - 1) return `<span style="color:${npcInfo.color};font-size:9px;">★</span>`;
        return i < prog
          ? `<span style="color:${npcInfo.color};opacity:0.9;font-size:8px;">●</span>`
          : `<span style="color:${npcInfo.color};opacity:0.28;font-size:8px;">○</span>`;
      }).join('');
      dotsHtml = `<span style="margin-left:6px;letter-spacing:2px;">${dots}</span>`;
    }
    speakerEl.innerHTML =
      `<span style="font-size:14px;margin-right:5px;vertical-align:middle">${npcInfo.icon}</span>`+
      `<span style="color:${npcInfo.color}">${conv.speaker}</span>${dotsHtml}`;
    dialogueBox.style.borderColor = npcInfo.color + '88';
    dialogueBox.style.borderLeftColor = npcInfo.color;
    dialogueBox.style.borderLeftWidth = '3px';
    dialogueBox.style.background = `linear-gradient(to right, ${npcInfo.color}14, transparent 40%), var(--panel-bg)`;
    dialogueBox.style.boxShadow = `0 0 18px ${npcInfo.color}30, inset 0 0 20px rgba(0,0,0,0.3)`;
  } else {
    speakerEl.textContent = conv.speaker || '';
    speakerEl.style.color = isNarrator ? 'var(--text-dim)' : 'var(--gold)';
    dialogueBox.style.borderColor = '';
    dialogueBox.style.borderLeftColor = '';
    dialogueBox.style.borderLeftWidth = '';
    dialogueBox.style.background = '';
    dialogueBox.style.boxShadow = '';
  }
  $('dialogue-text').textContent = '';
  $('dialogue-continue').style.display = 'none';
  $('dialogue-choices').innerHTML = '';

  // クリックでテキストスキップ
  $('dialogue-box').onclick = skipText;

  const typeDelay = GameState.personality === 'A' ? 18 : GameState.personality === 'C' ? 44 : 30;
  typeText($('dialogue-text'), conv.text, typeDelay, () => {
    if (conv.choices && conv.choices.length > 0) {
      $('dialogue-box').onclick = null;
      buildChoices(conv.choices, conv);
    } else {
      $('dialogue-continue').style.display = 'block';
      $('dialogue-box').onclick = () => closeDialogue();
    }
  }, true);
}

function buildChoices(choices, conv) {
  const container = $('dialogue-choices');
  container.innerHTML = '';
  choices.forEach((choice, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice.label;
    btn.style.opacity = '0';
    btn.style.transform = 'translateY(5px)';
    btn.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    btn.onclick = () => { AudioSystem.sfxDecide(); handleNPCChoice(choice.action, choice, conv); };
    container.appendChild(btn);
    setTimeout(() => {
      btn.style.opacity = '1';
      btn.style.transform = 'translateY(0)';
    }, 55 + idx * 75);
  });
}

async function handleNPCChoice(action, choice, conv) {
  // ボタン無効化
  $('dialogue-choices').querySelectorAll('button').forEach(b => b.disabled = true);

  if (action === 'exit') {
    AudioSystem.sfxCancel();
    closeDialogue();
    return;
  }

  if (action === 'make_chai') {
    const npcId = UI.currentNpc;
    closeDialogue();
    showChaiMaking(npcId);
    return;
  }

  // 沈黙選択時：ダイアログに呼吸アニメーションを一瞬表示
  if (action === 'silent' || action === 'silent_deep') {
    const box = $('dialogue-box');
    const breathEl = document.createElement('div');
    breathEl.className = 'dialogue-breathe';
    box.appendChild(breathEl);
    $('dialogue-text').textContent = '';
    setTimeout(() => breathEl.remove(), 1800);
  }

  const extraData = action === 'give_chai' ? { spice: GameState.lastChaiSpice } : null;
  const result = await NPCSystem.handleAction(action, extraData, update => {
    if (update.loading) {
      $('dialogue-text').textContent = '……';
    }
  });

  if (!result) { closeDialogue(); return; }
  if (result.done) {
    if (result.updateGame) result.updateGame(GameState);
    updateStatusBar();
    closeDialogue();
    return;
  }
  if (result.needMakeChai) {
    const npcId = UI.currentNpc;
    closeDialogue();
    showChaiMaking(npcId);
    return;
  }

  if (result.updateGame) result.updateGame(GameState);
  updateStatusBar();

  if (action === 'farewell') {
    AudioSystem.sfxFarewell();
    // 別れフラッシュ（NPC固有カラー）
    const farewellColors = { amma:'#E8954A', sandeep:'#7BA8D9', raju:'#7BC87A', saraswati:'#FFD700' };
    const flashColor = farewellColors[UI.currentNpc] || '#FFFFFF';
    setTimeout(() => triggerCanvasFlash(flashColor, 700), 300);
    // 別れのアイテム通知
    const farewellGifts = { amma:'wooden_doll', sandeep:'spice_from_sandeep', raju:'stone_from_raju' };
    const giftKey = farewellGifts[UI.currentNpc];
    if (giftKey && (GameState.inventory[giftKey] || 0) > 0) {
      const info = Story.items[giftKey];
      setTimeout(() => notify(`${info.icon} ${info.name} を　もらった`), 600);
    }
    // 全NPCとの別れを完了した場合の特別メッセージ
    const allFarewells = ['amma','sandeep','raju','saraswati']
      .every(id => (GameState.npcProgress[id] || 0) >= 4);
    if (allFarewells) {
      setTimeout(() => notify('✨ すべての旅人と　別れを告げた', 3000), 1400);
    }
    // 別れ時点でオートセーブ
    setTimeout(() => SaveSystem.autoSave(GameState), 800);

    // NPC固有パーティクルバースト（全NPC統一）
    const farewellBursts = {
      amma:      { palettes: ['#E8954A','#FFB870','#C07030','#F0D0A0'], counts: [16,10,7,5],
                   notify: 'アンマーが　手を振っていた' },
      sandeep:   { palettes: ['#7BA8D9','#AADDFF','#5580BB','#FFFFFF'], counts: [18,10,6,5],
                   notify: 'サンディープが　静かに　合掌した' },
      raju:      { palettes: ['#7BC87A','#AAEEBB','#44AA44','#FFEE88'], counts: [22,12,8,6],
                   notify: 'ラジュが　走って　手を振った' },
      saraswati: { palettes: ['#FFD700','#FFFFFF','#FFE8A0','#C0A040'], counts: [24,12,8,6],
                   notify: 'サラスワティが　静かに　なった' },
    };
    const burstCfg = farewellBursts[UI.currentNpc];
    if (burstCfg) {
      setTimeout(() => {
        const _npcId = UI.currentNpc;
        const _map = MapSystem.getMap(GameState.location);
        const _npc = _map?.npcs.find(n => n.id === _npcId);
        if (_npc && canvas) {
          const cx = _npc.x * tileSize + tileSize / 2;
          const cy = _npc.y * tileSize + tileSize / 2;
          burstCfg.palettes.forEach((col, i) => {
            for (let j = 0; j < burstCfg.counts[i]; j++) spawnParticles(cx, cy, col, 1);
          });
        }
        notify(burstCfg.notify, 2500);
      }, 500);
    }
  }

  if (result.dialogue) {
    showDialogue(result.dialogue);
  }
}

function closeDialogue() {
  $('dialogue-overlay').classList.remove('active');
  const box = $('dialogue-box');
  box.onclick = null;
  box.style.borderColor = '';
  box.style.borderLeftColor = '';
  box.style.borderLeftWidth = '';
  box.style.background = '';
  box.style.boxShadow = '';
  $('dialogue-choices').innerHTML = '';
  UI.screen = 'field';
  UI.currentNpc = null;
  NPCSystem.clearConversation();
}

// ===== アイテム収集 =====
function collectItem(item) {
  item.collected = true;
  const key = `${GameState.location}_${item.id}_${item.x}_${item.y}`;
  GameState.collectedItems[key] = true;

  if (GameState.inventory[item.id] !== undefined) {
    GameState.inventory[item.id]++;
  } else {
    GameState.inventory[item.id] = 1;
  }

  const itemData = Story.items[item.id];
  AudioSystem.sfxGetItem();
  notify(`${itemData?.icon || '✨'} ${itemData?.name || item.name} を　手に入れた`);

  // アイテム収集パーティクル＋浮遊テキスト
  const wx = item.x * tileSize + tileSize / 2;
  const wy = item.y * tileSize + tileSize / 2;
  spawnParticles(wx, wy, '#FFD700', 10);
  spawnParticles(wx, wy, '#FFFFFF', 6);
  spawnFloatingText(`${itemData?.icon || '✨'} ${itemData?.name || item.name}`, '#FFE880');

  updateStatusBar();
}

// NPCごとにおすすめスパイス
const NPC_SPICE_HINTS = {
  amma:      { cardamom: '心を開く' },
  sandeep:   { cinnamon: '師の記憶に', cardamom: '深い対話に' },
  raju:      { ginger: '体を温める', cardamom: '話しやすくなる' },
  saraswati: { cardamom: '心を開く', ginger: '体に栄養を' },
};

// ===== チャイを作る =====
function showChaiMaking(forNpc) {
  UI.screen = 'chai';
  const overlay = $('chai-overlay');
  overlay.classList.add('active');

  const content = $('chai-content');
  const npcName = forNpc ? Story.npcs[forNpc]?.name : null;
  content.innerHTML = `
    <h3>☕ チャイを作る</h3>
    <p>スパイスを選んでください<br><small>ミルク × 1 + スパイス × 1</small></p>
  `;

  const hasMilk = (GameState.inventory.milk || 0) >= 1;
  const spices = ['cardamom','ginger','cinnamon','turmeric'];
  const hints = forNpc ? (NPC_SPICE_HINTS[forNpc] || {}) : {};

  spices.forEach(spice => {
    const count = GameState.inventory[spice] || 0;
    const info = Story.items[spice];
    const hint = hints[spice];
    const btn = document.createElement('button');
    btn.className = `spice-btn spice-${spice}` + (hint ? ' spice-recommended' : '');
    btn.disabled = !hasMilk || count <= 0;
    const hintHtml = hint
      ? `<span class="spice-hint">✦ ${hint}</span>`
      : '';
    btn.innerHTML = `${info.icon} ${info.name} (×${count})${hintHtml}<span class="spice-effect">${info.desc}</span>`;
    btn.onclick = () => makeChaiWith(spice, forNpc);
    content.appendChild(btn);
  });

  const cancel = document.createElement('button');
  cancel.id = 'chai-cancel';
  cancel.textContent = 'やめる';
  cancel.onclick = () => {
    overlay.classList.remove('active');
    if (forNpc) {
      UI.screen = 'dialogue';
      interactWithNPC(forNpc);
    } else {
      UI.screen = 'field';
    }
  };
  content.appendChild(cancel);
}

function makeChaiWith(spice, forNpc) {
  GameState.inventory.milk = Math.max(0, (GameState.inventory.milk || 0) - 1);
  GameState.inventory[spice] = Math.max(0, (GameState.inventory[spice] || 0) - 1);
  GameState.inventory.chai = (GameState.inventory.chai || 0) + 1;
  GameState.lastChaiSpice = spice;

  const info = Story.items[spice];
  const spiceColors = {
    cardamom: '#A8D8A0', ginger: '#E8A060',
    cinnamon: '#C06830', turmeric: '#E8C820',
  };

  // チャイ完成アニメーション
  const overlay = $('chai-overlay');
  const content = $('chai-content');
  const spiceGlowColors = {
    cardamom: '#3A8A36', ginger: '#C06820', cinnamon: '#802A10', turmeric: '#C0A000',
  };
  const glowColor = spiceGlowColors[spice] || '#8A6020';
  content.innerHTML = `
    <div style="position:relative;padding:16px 24px;text-align:center">
      <div style="position:absolute;inset:0;border-radius:12px;background:radial-gradient(ellipse at 50% 40%, ${glowColor}44 0%, transparent 70%);animation:brewPulse 1.4s ease-out both"></div>
      <div style="font-size:52px;margin-bottom:10px;animation:chaiSteam 0.6s ease-out;position:relative">☕</div>
      <div style="color:var(--gold);font-size:15px;letter-spacing:2px;margin-bottom:6px;position:relative">${info.name} のチャイ</div>
      <div style="color:var(--text-dim);font-size:12px;position:relative">${info.desc}</div>
    </div>
  `;
  // steam particles on field canvas if visible
  if (UI.screen === 'chai' && canvas) {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const col = spiceColors[spice] || '#FFD700';
    for (let i = 0; i < 16; i++) spawnParticles(cx + (Math.random()-0.5)*60, cy, col, 1);
    for (let i = 0; i < 10; i++) spawnParticles(cx + (Math.random()-0.5)*40, cy, '#FFFFFF', 1);
  }
  AudioSystem.sfxChai();

  setTimeout(() => {
    overlay.classList.remove('active');
    notify(`${info.icon} ${info.name} のチャイを　作った`);

    if (forNpc) {
      // チャイをNPCに渡す
      AudioSystem.sfxChaiGiven();
      GameState.inventory.chai = Math.max(0, GameState.inventory.chai - 1);
      GameState.chaiGiven[forNpc] = spice;

      // ウォームバースト: NPCの位置から温かい光波
      const _npcMap = MapSystem.getMap(GameState.location);
      const _npcObj = _npcMap?.npcs.find(n => n.id === forNpc);
      if (_npcObj && canvas) {
        const nx = _npcObj.x * tileSize + tileSize / 2;
        const ny = _npcObj.y * tileSize + tileSize / 2;
        const warmColors = ['#FFD700','#FF9040','#FFFFFF','#FFB860','#FF7030'];
        warmColors.forEach((col, wi) => {
          setTimeout(() => spawnParticles(nx, ny, col, wi === 2 ? 5 : 8), wi * 90);
        });
        setTimeout(() => triggerCanvasFlash('rgba(255,180,60,0.18)', 900), 80);
        setTimeout(() => spawnFloatingText('🍵 ありがとう', '#FFD06A'), 300);
      }
      GameState.npcProgress[forNpc] = Math.max(GameState.npcProgress[forNpc] || 0, 3);

      const npc = Story.npcs[forNpc];
      UI.screen = 'dialogue';
      showDialogue({
        speaker: npc.name,
        text: npc.chai_response[spice] || '「……ありがとう。」',
        choices: [
          { label: 'もっと話す', action: 'dynamic' },
          { label: '別れを告げる', action: 'farewell' },
        ],
      });
      UI.currentNpc = forNpc;
      NPCSystem.startConversation(forNpc, GameState);
      updateStatusBar();
    } else {
      // 自分でチャイを飲む: プラーナ＋チッタ回復
      const pranaGain  = { cardamom: 12, ginger: 20, cinnamon: 15, turmeric: 10 }[spice] || 12;
      const chittaGain = { cardamom: 8,  ginger: 5,  cinnamon: 6,  turmeric: 10 }[spice] || 6;
      GameState.status.prana  = Math.min(100, (GameState.status.prana  || 0) + pranaGain);
      GameState.status.chitta = Math.min(100, (GameState.status.chitta || 0) + chittaGain);
      GameState.inventory.chai = Math.max(0, (GameState.inventory.chai || 0) - 1);
      UI.screen = 'field';
      updateStatusBar();
      // 飲んだ演出
      setTimeout(() => {
        const px = Player.x * tileSize + tileSize / 2;
        const py = Player.y * tileSize + tileSize / 2;
        const col = { cardamom:'#80C880', ginger:'#E89040', cinnamon:'#C06030', turmeric:'#E8C000' }[spice] || '#FFD700';
        spawnParticles(px, py, col, 10);
        spawnParticles(px, py, '#FFFFFF', 6);
        spawnFloatingText(`🍵 +${pranaGain} プラーナ`, '#88FFAA');
        triggerCanvasFlash(`rgba(${col.slice(1).match(/../g).map(h=>parseInt(h,16)).join(',')},0.12)`, 600);
      }, 100);
    }
  }, 900);
}

// ===== 出口・場所移動 =====
function triggerExit(exit) {
  AudioSystem.sfxDoor();
  const eventKey = exit.eventKey;
  const events = Story.fieldEvents[eventKey] || [];

  // 未見イベントをフィルタ
  const unseen = events.filter(e => !GameState.fieldEventsSeen.includes(e.id));

  if (unseen.length > 0) {
    startFieldEvents(unseen, 0, () => {
      SaveSystem.autoSave(GameState);
      transitionToLocation(exit.nextMap);
    });
  } else {
    transitionToLocation(exit.nextMap);
  }
}

// フィールドイベントの雰囲気演出（雨・星空など）
function applyFieldEventAtmosphere(eventId, overlayEl) {
  // 既存のエフェクト要素をクリア
  overlayEl.querySelectorAll('.field-event-rain-drop, .field-event-star').forEach(e => e.remove());

  if (eventId === 'rain') {
    // 雨の演出：対角線の雨滴を動的に生成
    for (let i = 0; i < 28; i++) {
      const drop = document.createElement('div');
      drop.className = 'field-event-rain-drop';
      drop.style.left   = `${Math.random() * 100}%`;
      drop.style.top    = `${Math.random() * 30}%`;
      drop.style.animationDuration  = `${0.45 + Math.random() * 0.35}s`;
      drop.style.animationDelay     = `${Math.random() * 0.5}s`;
      drop.style.opacity = `${0.3 + Math.random() * 0.4}`;
      overlayEl.appendChild(drop);
    }
    // 背景を暗めのグレー雨空に
    overlayEl.style.background =
      'radial-gradient(ellipse at 50% 20%, #1a2030 0%, #070810 70%)';
  }

  if (eventId === 'stars' || eventId === 'ganges-dawn') {
    // 星空の演出
    const count = eventId === 'stars' ? 60 : 30;
    for (let i = 0; i < count; i++) {
      const star = document.createElement('div');
      star.className = 'field-event-star';
      star.style.left = `${Math.random() * 100}%`;
      star.style.top  = `${Math.random() * 65}%`;
      const dur = 1.5 + Math.random() * 3;
      star.style.animationDuration = `${dur}s`;
      star.style.animationDelay    = `${Math.random() * dur}s`;
      if (Math.random() < 0.15) { star.style.width = '3px'; star.style.height = '3px'; }
      overlayEl.appendChild(star);
    }
    if (eventId === 'ganges-dawn') {
      overlayEl.style.background =
        'radial-gradient(ellipse at 50% 90%, #3a1e08 0%, #060308 65%)';
    }
  }
}

// ===== フィールドイベント =====
function startFieldEvents(events, idx, onComplete) {
  if (idx >= events.length) {
    AudioSystem.unduckBgm(1.5);
    onComplete();
    return;
  }

  // 最初のイベント開始時にBGMをダッキング + フィールドイベントSFX
  if (idx === 0) {
    AudioSystem.duckBgm(0.22, 1.2);
    // ロケーション別カラーリング
    const evColors = { gokarna:'rgba(120,190,220,0.22)', hampi:'rgba(210,148,60,0.22)', varanasi:'rgba(220,110,60,0.22)', rishikesh:'rgba(80,200,140,0.20)' };
    triggerCanvasFlash(evColors[GameState.location] || 'rgba(180,160,255,0.18)', 1000);
    // 画面中心から広がる薄いリング
    spawnEntranceRings();
  }
  setTimeout(() => AudioSystem.sfxFieldEvent(), idx === 0 ? 400 : 0);

  const event = events[idx];
  GameState.fieldEventsSeen.push(event.id);
  UI.screen = 'fieldEvent';

  const overlay = $('field-event-overlay');
  overlay.classList.add('active');

  // ルート別のオーバーレイ背景テーマ
  const routeThemes = {
    gokarna:  'radial-gradient(ellipse at 50% 25%, #1a3a5c 0%, #060f1a 70%)',
    hampi:    'radial-gradient(ellipse at 50% 60%, #3a2008 0%, #160800 70%)',
    varanasi: 'radial-gradient(ellipse at 50% 40%, #2a120a 0%, #080308 70%)',
  };
  overlay.style.background = routeThemes[GameState.location] || 'rgba(5,3,15,0.95)';

  const accentColors = { gokarna: '#7ABADD', hampi: '#D0943A', varanasi: '#DD7040' };
  $('field-event-scene').style.color = accentColors[GameState.location] || 'var(--text-dim)';

  $('field-event-scene').textContent = event.scene;
  $('field-event-result').textContent = '';
  $('field-event-next').style.display = 'none';
  $('field-event-choices').innerHTML = '';

  // イベント別の演出エフェクト
  applyFieldEventAtmosphere(event.id, overlay);

  $('field-event-content').onclick = skipText;
  typeText($('field-event-text'), event.text, 40, () => {
    $('field-event-content').onclick = null;
    if (event.noChoice || event.choices.length === 0) {
      // 選択肢なし → すぐ次へ
      $('field-event-next').style.display = 'block';
      $('field-event-next').onclick = () => {
        AudioSystem.sfxDecide();
        overlay.classList.remove('active');
        startFieldEvents(events, idx + 1, onComplete);
      };
      return;
    }

    event.choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'field-choice';
      // アイテムが必要な選択肢で足りない場合はグレーアウト
      if (choice.cost && choice.spice && choice.spice !== 'lose') {
        const hasSpice = (GameState.inventory[choice.spice] || 0) > 0;
        const hasMilk  = (GameState.inventory.milk || 0) > 0;
        if (!hasSpice || !hasMilk) {
          btn.disabled = true;
          btn.title = 'ミルクとスパイスが必要';
        }
      }
      btn.textContent = choice.label;
      btn.onclick = () => { AudioSystem.sfxDecide(); handleFieldChoice(event, choice, events, idx, onComplete); };
      $('field-event-choices').appendChild(btn);
    });
  }, true);
}

function handleFieldChoice(event, choice, events, idx, onComplete) {
  $('field-event-choices').querySelectorAll('button').forEach(b => b.disabled = true);

  GameState.fieldChoices[event.id] = choice.key;

  // スパイス効果
  if (choice.spice === 'lose') {
    const spices = ['cardamom','ginger','cinnamon','turmeric'];
    for (const s of spices) {
      if ((GameState.inventory[s] || 0) > 0) {
        GameState.inventory[s]--;
        notify(`${Story.items[s].icon} ${Story.items[s].name} が　なくなった`);
        break;
      }
    }
  } else if (choice.spice && choice.spice.startsWith('gain_')) {
    const gainSpice = choice.spice.replace('gain_', '');
    if (GameState.inventory[gainSpice] !== undefined) {
      GameState.inventory[gainSpice]++;
      const info = Story.items[gainSpice];
      if (info) setTimeout(() => notify(`${info.icon} ${info.name} を　手に入れた`), 300);
    }
  } else if (choice.cost && choice.spice) {
    if ((GameState.inventory[choice.spice] || 0) > 0 &&
        (GameState.inventory.milk || 0) > 0) {
      GameState.inventory.milk--;
      GameState.inventory[choice.spice]--;
    }
  }

  // 結果テキスト
  const resultText = typeof event.results === 'object'
    ? (event.results[choice.key] || event.result || '')
    : (event.result || '');

  $('field-event-choices').innerHTML = '';

  $('field-event-content').onclick = skipText;
  typeText($('field-event-result'), resultText, 50, () => {
    $('field-event-content').onclick = null;
    $('field-event-next').style.display = 'block';
    $('field-event-next').onclick = () => {
      AudioSystem.sfxDecide();
      $('field-event-overlay').classList.remove('active');
      startFieldEvents(events, idx + 1, onComplete);
    };
  }, true);

  // 選択と性格に応じたステータス変化
  applyFieldChoiceEffect(choice.key, GameState.personality);
  updateStatusBar();
}

function applyFieldChoiceEffect(choiceKey, personality) {
  const s = GameState.status;
  // C（しずか）が観察・沈黙を選ぶとヴィヴェーカ多め
  // B（やさしい）が行動を選ぶとチッタ+
  // A（やんちゃ）が行動を選ぶとプラーナ+
  const base = { viveka: 2 };
  const bonus = {
    A: { A: { prana: 3 },   B: { chitta: 2 },  C: { viveka: 3 } },
    B: { A: { chitta: 3 },  B: { chitta: 4 },  C: { viveka: 2 } },
    C: { A: { viveka: 2 },  B: { viveka: 3 },  C: { viveka: 5 } },
  };
  const effect = (bonus[personality] || {})[choiceKey] || {};
  const total = { ...base, ...effect };

  for (const [stat, val] of Object.entries(total)) {
    if (stat === 'chitta')  s.chitta  = Math.min(100, (s.chitta  || 50) + val);
    if (stat === 'prana')   s.prana   = Math.min(100, (s.prana   || 100) + val);
    if (stat === 'viveka')  s.viveka  = Math.min(100, (s.viveka  || 0)  + val);
  }

  if (total.viveka) spawnFloatingText(`＋ヴィヴェーカ ${total.viveka}`, '#A8D8FF');
  if (total.prana)  spawnFloatingText(`＋プラーナ ${total.prana}`, '#88FF88');
  if (total.chitta) spawnFloatingText(`＋チッタ ${total.chitta}`, '#FFB888');
}

// ===== 場所遷移 =====
function transitionToLocation(nextMapId) {
  startTransitionRipple();
  AudioSystem.sfxLocationBridge();
  const overlay = $('transition-overlay');
  overlay.classList.add('fade-out');

  setTimeout(() => {
    GameState.location = nextMapId;
    GameState.currentMapItems = null;

    if (!GameState.visitedLocations.includes(nextMapId)) {
      GameState.visitedLocations.push(nextMapId);
    }

    // オートセーブ
    SaveSystem.autoSave(GameState);
    notify('💾 自動保存しました', 1800);

    AudioSystem.playBgm(nextMapId, 2.0); // フェードイン2秒

    Player.moving = false;
    UI.endingTriggered = false;

    showLocationIntro(nextMapId, () => {
      startField();
      overlay.classList.remove('fade-out');

      // リシケシュ初回到達 + 全NPC訪問済み → 特別メッセージ
      if (nextMapId === 'rishikesh') {
        const allMet = ['amma','sandeep','raju'].every(id => (GameState.npcProgress[id] || 0) >= 1);
        if (allMet) {
          setTimeout(() => notify('✨ すべての旅を経て　ここへ来た', 3000), 1200);
        }
      }
    });
  }, 500);
}

// ===== NPCメモリーカード（エンディング用）=====
function showNPCMemories() {
  return new Promise(resolve => {
    // チャイを渡したかどうかで記憶テキストが変わる
    const memData = {
      amma: {
        icon: '👵',
        text:     'アンマーは　手紙を待っていた。',
        textChai: 'アンマーは　チャイを飲んで　少し笑った。',
      },
      sandeep: {
        icon: '🧘',
        text:     'サンディープは　師の声を待っていた。',
        textChai: 'サンディープは　チャイの香りに　目を開けた。',
      },
      raju: {
        icon: '👦',
        text:     'ラジュは　夜が怖かった。',
        textChai: 'ラジュは　チャイで　少し　あったかくなった。',
      },
      saraswati: {
        icon: '🙏',
        text:     'サラスワティは　悟りを探していた。',
        textChai: 'サラスワティは　チャイを受け取って　黙っていた。',
      },
    };
    const met = ['amma', 'sandeep', 'raju', 'saraswati']
      .filter(id => (GameState.npcProgress[id] || 0) >= 1);

    if (met.length === 0) { resolve(); return; }

    const container = document.createElement('div');
    container.id = 'ending-memories';
    container.style.cssText = 'margin:12px 0;display:flex;flex-direction:column;gap:6px;align-items:center;';
    $('ending-content').insertBefore(container, $('ending-title-reveal'));

    let i = 0;
    function showNext() {
      if (i >= met.length) {
        setTimeout(resolve, 600);
        return;
      }
      const id = met[i];
      const m = memData[id];
      const spice = GameState.chaiGiven[id];
      const hadChai = !!spice;
      // スパイス別の記憶テキスト：chai_responseの第1行を使う
      let text = m.text;
      if (hadChai) {
        const chaiResp = Story.npcs[id]?.chai_response?.[spice];
        text = chaiResp ? chaiResp.split('\n')[0] : m.textChai;
      }
      const color = hadChai ? 'rgba(212,168,75,0.75)' : 'rgba(180,160,130,0.65)';
      const el = document.createElement('div');
      el.style.cssText = `font-size:12px;color:${color};letter-spacing:1px;opacity:0;transition:opacity 1.2s;white-space:pre;`;
      el.textContent = `${m.icon}  ${text}`;
      container.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
      i++;
      setTimeout(showNext, 1400);
    }
    showNext();
  });
}

// ===== エンディング =====
async function triggerEnding() {
  // BGMを静かにフェードアウト（川辺の静寂）
  AudioSystem.fadeBgm(3.0);

  await new Promise(r => setTimeout(r, 1500));

  UI.screen = 'ending';
  const overlay = $('ending-overlay');
  overlay.classList.add('active');

  // クリック / スペース でテキストスキップ
  $('ending-content').onclick = skipText;

  const personality = GameState.personality;
  const loc = Story.locations['rishikesh'];

  const endingBg = $('ending-bg');
  endingBg.style.background =
    'radial-gradient(ellipse at 50% 80%, #1a3a2a 0%, #050f10 70%)';
  endingBg.innerHTML = '';
  for (let i = 0; i < 120; i++) {
    const s = document.createElement('div');
    const size = Math.random() * 2 + 0.5;
    const delay = Math.random() * 4;
    const dur = 2 + Math.random() * 3;
    s.style.cssText = `position:absolute;border-radius:50%;background:white;width:${size}px;height:${size}px;top:${Math.random()*100}%;left:${Math.random()*100}%;opacity:${0.2+Math.random()*0.5};animation:twinkle ${dur}s ${delay}s ease-in-out infinite alternate;`;
    endingBg.appendChild(s);
  }
  $('ending-location').textContent = `— ${loc.name} —`;
  $('ending-title-reveal').style.opacity = '0';
  $('ending-to-title').style.display = 'none';

  // 共通テキスト
  let text = '';
  for (const line of Story.ending.common) {
    text += line + '\n\n';
  }
  typeText($('ending-text'), text, 60, async () => {
    // 出会った人々の記憶を1行ずつ表示
    await showNPCMemories();

    // Claude API でエンディング生成 or フォールバック
    let ending = await API.generateEnding(personality, GameState);
    if (!ending) {
      const viveka = GameState.status.viveka || 0;
      const tier = viveka >= 70 ? 'high' : viveka >= 30 ? 'mid' : 'low';
      const fb = Story.ending.fallback[personality] || Story.ending.fallback['A'];
      ending = (typeof fb === 'object' ? fb[tier] : fb) || fb.mid || fb;
    }

    setTimeout(() => {
      typeText($('ending-text'), $('ending-text').textContent + '\n' + ending, 40, () => {
        setTimeout(() => {
          $('ending-title-reveal').style.opacity = '1';
          setTimeout(() => {
            // 集めた記念品を表示（アイコン + 短い説明）
            const keepsakes = [
              { key: 'wooden_doll',        label: 'アンマーの人形' },
              { key: 'spice_from_sandeep', label: 'サンディープのスパイス' },
              { key: 'stone_from_raju',    label: 'ラジュの石' },
            ];
            const collected = keepsakes.filter(k => (GameState.inventory[k.key] || 0) > 0);
            if (collected.length > 0) {
              const keepsakeEl = document.createElement('div');
              keepsakeEl.id = 'ending-keepsakes';
              keepsakeEl.style.cssText = 'margin-top:16px;opacity:0;transition:opacity 2s;display:flex;flex-direction:column;gap:6px;align-items:center;';
              collected.forEach(k => {
                const info = Story.items[k.key];
                const row = document.createElement('div');
                row.style.cssText = 'font-size:13px;color:rgba(212,168,75,0.8);letter-spacing:1px;';
                row.textContent = `${info.icon}　${k.label}`;
                keepsakeEl.appendChild(row);
              });
              $('ending-content').insertBefore(keepsakeEl, $('ending-to-title'));
              requestAnimationFrame(() => { keepsakeEl.style.opacity = '1'; });
            }
            setTimeout(() => { $('ending-to-title').style.display = 'block'; }, collected.length > 0 ? 2200 : 1500);
          }, 2000);
        }, 1500);
      }, true);
    }, 500);
  }, true);
}

// ===== メニュー =====
function showMenuOverlay(tab) {
  UI.menuLoadMode = (tab === 'load');
  UI.screen = 'menu';
  const overlay = $('menu-overlay');
  overlay.classList.add('active');
  renderMenuContent();
}

function renderMenuContent(tab) {
  const overlay = $('menu-overlay');
  overlay.innerHTML = `
    <button id="menu-close-btn" onclick="closeMenu()">とじる</button>
    <div class="menu-panel" style="min-width:220px">
      <h3>🎒 もちもの</h3>
      <div id="inv-list"></div>
      <button id="make-chai-btn" onclick="closeMenu();showChaiMaking(null)">☕ チャイを作る</button>
    </div>
    <div class="menu-panel">
      <h3>📖 旅日記</h3>
      <div id="diary-list"></div>
    </div>
    <div class="menu-panel">
      <h3>🔊 サウンド</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button onclick="toggleBgm()" id="bgm-toggle-btn" style="flex:1;background:none;border:1px solid rgba(212,168,75,0.4);color:var(--gold);font-family:var(--font);font-size:12px;padding:5px;cursor:pointer">BGM: ${AudioSystem.getBgmEnabled() ? 'ON' : 'OFF'}</button>
        <button onclick="toggleSfx()" id="sfx-toggle-btn" style="flex:1;background:none;border:1px solid rgba(212,168,75,0.4);color:var(--gold);font-family:var(--font);font-size:12px;padding:5px;cursor:pointer">SFX: ${AudioSystem.getSfxEnabled() ? 'ON' : 'OFF'}</button>
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px">BGM音量</label>
        <input type="range" min="0" max="100" value="${Math.round(AudioSystem.getBgmVolume() * 100)}" oninput="AudioSystem.setBgmVolume(this.value/100)" style="width:100%;accent-color:var(--gold);cursor:pointer">
        <label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:3px;margin-top:6px">効果音音量</label>
        <input type="range" min="0" max="100" value="${Math.round(AudioSystem.getSfxVolume() * 100)}" oninput="AudioSystem.setSfxVolume(this.value/100)" style="width:100%;accent-color:var(--gold);cursor:pointer">
      </div>
      <h3>💾 セーブ</h3>
      <div id="save-slots"></div>
    </div>
  `;

  // インベントリ
  const invList = $('inv-list');
  let hasMilk = false, hasSpice = false;
  const allItems = [...Object.entries(GameState.inventory)].filter(([k,v]) => v > 0);
  if (allItems.length === 0) {
    invList.innerHTML = '<div class="inv-item" style="color:var(--text-dim)">（なにもない）</div>';
  } else {
    allItems.forEach(([key, count]) => {
      const info = Story.items[key];
      if (!info) return;
      const div = document.createElement('div');
      div.className = 'inv-item';
      div.innerHTML = `${info.icon} ${info.name}<span class="inv-item-count">×${count}</span>`;
      invList.appendChild(div);
      if (key === 'milk') hasMilk = true;
      if (['cardamom','ginger','cinnamon','turmeric'].includes(key)) hasSpice = true;
    });
  }
  const chaiBtn = $('make-chai-btn');
  if (chaiBtn) chaiBtn.disabled = !(hasMilk && hasSpice);

  // 旅日記
  const diaryList = $('diary-list');
  const npcLocMap = {};
  Object.entries(Story.npcs).forEach(([npcId, npc]) => {
    Object.entries(Story.locations).forEach(([locId, loc]) => {
      if (npc.location === loc.name) npcLocMap[locId] = { npcId, npc };
    });
  });
  Object.entries(Story.locations).forEach(([locId, loc]) => {
    const visited = GameState.visitedLocations.includes(locId);
    const npcEntry = npcLocMap[locId];
    const div = document.createElement('div');
    div.className = 'diary-entry' + (visited ? ' visited' : '');

    if (!visited) {
      div.textContent = `　${loc.name}`;
    } else if (npcEntry) {
      const { npcId, npc } = npcEntry;
      const prog = GameState.npcProgress[npcId] || 0;
      const chai = GameState.chaiGiven[npcId];
      const dots = prog >= 4 ? '●●●●' : (chai || prog >= 3) ? '●●●○' : prog >= 2 ? '●●○○' : prog >= 1 ? '●○○○' : '○○○○';
      const chaiIcon = chai ? ` ☕${Story.items[chai]?.icon || ''}` : '';
      // チャイを渡した時の記憶セリフ（1行目だけ）
      let memoryHtml = '';
      if (chai && npc.chai_response?.[chai]) {
        const firstLine = npc.chai_response[chai].split('\n')[0];
        memoryHtml = `<div style="color:rgba(180,160,130,0.7);font-size:10px;margin-top:3px;font-style:italic;line-height:1.4">${firstLine}</div>`;
      }
      const philosophyHtml = prog >= 4 && npc.philosophy
        ? `<div style="color:var(--gold-dim);font-size:10px;margin-top:3px;line-height:1.5;opacity:0.75">${npc.philosophy.replace(/\n/g,'　')}</div>`
        : '';
      div.innerHTML = `✓ <b>${loc.name}</b> <span style="color:var(--text-dim);font-size:11px">${npc.name}${chaiIcon} ${dots}</span>${memoryHtml}${philosophyHtml}`;
    } else {
      div.textContent = `✓ ${loc.name}`;
    }
    diaryList.appendChild(div);
  });

  // フィールドイベント記録（旅日記パネル下部）
  const diaryList2 = $('diary-list');
  const seenEvents = GameState.fieldEventsSeen || [];
  if (seenEvents.length > 0) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.07);margin:10px 0 6px;';
    diaryList2.appendChild(sep);
    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:var(--text-dim);margin-bottom:5px;letter-spacing:1px';
    label.textContent = '— 道中のできごと —';
    diaryList2.appendChild(label);
    // 全ルートのイベントを走査して見たものを表示
    const allEvents = Object.values(Story.fieldEvents).flat();
    const eventLabels = {
      shell:'貝を見つけた', elephant:'象に出会った', pilgrim:'巡礼者に会った',
      temple_bells:'鐘の音を聞いた', market:'市場を通った',
      blind_musician:'盲目の楽士', ruins:'廃墟の碑文', rain:'雨に降られた',
      monkey:'猿に会った', holy_man:'聖者のそばに座った',
      'ganges-dawn':'夜明けのガンジス川', 'crying-woman':'泣いている女の人',
      stars:'満天の星空を見た', child_question:'子供に道を聞かれた',
      boat_crossing:'渡し船に乗った',
    };
    seenEvents.slice().reverse().forEach(id => {
      const lbl = eventLabels[id];
      if (!lbl) return;
      const d = document.createElement('div');
      d.style.cssText = 'font-size:11px;color:rgba(180,165,140,0.7);padding:2px 0;';
      d.textContent = `・${lbl}`;
      diaryList2.appendChild(d);
    });
  }

  // セーブ/ロードスロット
  const isLoad = UI.menuLoadMode;
  const slots = SaveSystem.listSlots();
  const saveDiv = $('save-slots');
  if (isLoad) {
    saveDiv.insertAdjacentHTML('beforebegin',
      '<p style="font-size:11px;color:var(--gold-dim);margin-bottom:6px;">どのデータから続けますか？</p>');
  }
  slots.forEach(slot => {
    const div = document.createElement('div');
    div.className = 'save-slot' + (slot.empty && isLoad ? ' disabled' : '');
    if (slot.empty) {
      div.innerHTML = `<div class="save-slot-title">スロット ${slot.slot + 1}</div><div class="save-slot-info">（空）</div>`;
    } else {
      div.innerHTML = `<div class="save-slot-title">スロット ${slot.slot + 1} — ${esc(slot.personality)}</div><div class="save-slot-info">${esc(slot.location)} / ${esc(slot.dateStr)}</div>`;
    }
    if (isLoad) {
      // ロードモード: クリックでロード
      div.onclick = () => {
        if (slot.empty) return;
        loadFromSave(slot.data);
        $('menu-overlay').classList.remove('active');
        AudioSystem.sfxDecide();
        startField();
      };
    } else {
      // セーブモード: クリックで上書き
      div.onclick = () => {
        if (confirm(`スロット${slot.slot + 1}に上書きセーブしますか？`)) {
          SaveSystem.save(slot.slot, GameState);
          AudioSystem.sfxSave();
          notify('💾 セーブしました');
        }
      };
    }
    saveDiv.appendChild(div);
  });
}


function closeMenu() {
  $('menu-overlay').classList.remove('active');
  if (UI.menuLoadMode) {
    // ロードモードでメニューを閉じたらタイトルへ
    window.location.href = 'index.html';
  } else {
    UI.screen = 'field';
  }
  UI.menuLoadMode = false;
}

function toggleBgm() {
  AudioSystem.setBgmEnabled(!AudioSystem.getBgmEnabled());
  const btn = $('bgm-toggle-btn');
  if (btn) btn.textContent = `BGM: ${AudioSystem.getBgmEnabled() ? 'ON' : 'OFF'}`;
}

function toggleSfx() {
  AudioSystem.setSfxEnabled(!AudioSystem.getSfxEnabled());
  const btn = $('sfx-toggle-btn');
  if (btn) btn.textContent = `SFX: ${AudioSystem.getSfxEnabled() ? 'ON' : 'OFF'}`;
}

// ===== フィールド移動判定 =====
function checkTileInteraction() {
  const map = MapSystem.getMap(GameState.location);
  if (!map) return;

  // 出口に到達したか
  for (const exit of map.exits) {
    if (Player.x === exit.x &&
        Player.y >= exit.y &&
        Player.y <= (exit.y2 || exit.y)) {
      triggerExit(exit);
      return;
    }
  }

  // リシケシュで川のほとり（エンディング判定）
  if (GameState.location === 'rishikesh' && !UI.endingTriggered) {
    const row = Math.floor(Player.y);
    if (row >= 9 && GameState.visitedLocations.length >= 4) {
      UI.endingTriggered = true;
      triggerEnding();
    }
  }
}

// ===== ステータス変化通知 =====
const prevStatus = { chitta: 50, prana: 100, viveka: 0 };

function checkStatusChanges(newStatus) {
  const labels = { chitta: 'チッタ', prana: 'プラーナ', viveka: 'ヴィヴェーカ' };
  const msgs = [];
  for (const [key, label] of Object.entries(labels)) {
    const prev = prevStatus[key] || 0;
    const next = newStatus[key] || 0;
    const diff = next - prev;
    if (diff > 0) msgs.push(`${label} +${diff}`);
    else if (diff < 0) msgs.push(`${label} ${diff}`);

    // ヴィヴェーカ達成マイルストーン
    if (key === 'viveka') {
      if (prev < 25 && next >= 25) {
        setTimeout(() => notify('🌿 ヴィヴェーカ　25 — 何かが　見え始めた', 3000), 600);
      } else if (prev < 50 && next >= 50) {
        setTimeout(() => notify('✨ ヴィヴェーカ　50 — 洞察が　深まっている', 3500), 600);
      } else if (prev < 75 && next >= 75) {
        setTimeout(() => notify('🌙 ヴィヴェーカ　75 — 静けさの中に　答えがある', 3500), 600);
      } else if (prev < 100 && next >= 100) {
        setTimeout(() => notify('🌟 ヴィヴェーカ　満ちた — チャイは　何かを　知った', 4000), 600);
        setTimeout(() => {
          const cx = canvas.width / 2, cy = canvas.height * 0.55;
          for (let i = 0; i < 30; i++) spawnParticles(cx + (Math.random()-0.5)*80, cy, '#FFD700', 1);
          for (let i = 0; i < 20; i++) spawnParticles(cx + (Math.random()-0.5)*60, cy, '#FFFFFF', 1);
          for (let i = 0; i < 10; i++) spawnParticles(cx + (Math.random()-0.5)*40, cy, '#A8D8FF', 1);
          triggerCanvasFlash('#FFD700', 800);
          AudioSystem.sfxMeditate();
        }, 800);
      }
    }
    prevStatus[key] = next;
  }
  if (msgs.length > 0) notify(msgs.join('　'), 2000);
}

// ヴィヴェーカ節目エフェクト（25 / 50 / 75）
function triggerVivekaBloom() {
  // 全画面ゴールデンブルーム: 3段階のフラッシュ
  triggerCanvasFlash('rgba(255,220,100,0.55)', 400);
  setTimeout(() => triggerCanvasFlash('rgba(255,240,180,0.35)', 800), 420);
  setTimeout(() => triggerCanvasFlash('rgba(200,168,80,0.20)', 1600), 1300);
  // キャンバス中心から大量の金パーティクル
  setTimeout(() => {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const colors = ['#FFD700','#FFFFFF','#FFE880','#FFA040','#C8A030'];
    colors.forEach((col, i) => {
      const cnt = [22, 14, 10, 8, 6][i];
      spawnParticles(cx, cy, col, cnt);
    });
    // 四隅からも放射
    [[0,0],[canvas.width,0],[0,canvas.height],[canvas.width,canvas.height]].forEach(([ex, ey]) => {
      spawnParticles(ex, ey, '#FFD700', 8);
    });
  }, 200);
}

function checkVivekaMilestones(viveka) {
  if (!GameState._vivekaNotified) GameState._vivekaNotified = 0;
  const milestones = [
    { val:  25, bit: 1,  text: '気づきが　芽生えた',     color: '#A8D8FF' },
    { val:  50, bit: 2,  text: '光が　見え始めた',       color: '#C0E8FF' },
    { val:  75, bit: 4,  text: 'こころが　静かになった',  color: '#D4A84B' },
    { val: 100, bit: 8,  text: '旅の光が　満ちた',       color: '#FFD700' },
  ];
  for (const m of milestones) {
    if (viveka >= m.val && !(GameState._vivekaNotified & m.bit)) {
      GameState._vivekaNotified |= m.bit;
      AudioSystem.sfxMeditate();
      if (m.bit === 2) AudioSystem.sfxVivekaOvertone();
      if (m.bit === 8) {
        triggerVivekaBloom();
        AudioSystem.sfxVivekaOvertone();
        setTimeout(() => AudioSystem.sfxVivekaOvertone(), 900);
      } else {
        triggerCanvasFlash('rgba(168,216,255,0.25)', 1200);
      }
      spawnFloatingText(m.text, m.color);
    }
  }
}

// ===== ステータスバー更新 =====
function updateStatusBar() {
  const s = GameState.status;
  checkStatusChanges(s);
  checkVivekaMilestones(s.viveka || 0);
  updateBar('chitta', s.chitta);
  updateBar('prana', s.prana);
  updateBar('viveka', s.viveka);

  const loc = Story.locations[GameState.location];
  $('location-name').textContent = loc ? loc.name : '';

  // 性格バッジ
  const badge = $('personality-badge');
  if (badge && GameState.personality) {
    const labels = { A: 'やんちゃ', B: 'やさしい', C: 'しずか' };
    badge.textContent = labels[GameState.personality] || '';
    badge.style.display = 'inline';
  }
}

function updateBar(name, value) {
  const el = document.querySelector(`.fill-${name}`);
  if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

// ===== キーボード =====
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (UI.screen !== 'field') return;
    const map = MapSystem.getMap(GameState.location);
    const speed = 1;
    let nx = Player.targetX, ny = Player.targetY;

    switch (e.key) {
      case 'ArrowUp': case 'w':  case 'W':  ny -= speed; break;
      case 'ArrowDown': case 's': case 'S': ny += speed; break;
      case 'ArrowLeft': case 'a': case 'A': nx -= speed; break;
      case 'ArrowRight': case 'd': case 'D': nx += speed; break;
      case 'Escape': case 'm': case 'M': showMenuOverlay(); break;
      default: return;
    }

    if (MapSystem.isWalkable(GameState.location, nx, ny)) {
      Player.targetX = nx;
      Player.targetY = ny;
    }
    e.preventDefault();
  });
}

// ===== モバイル Dパッド =====
function setupDpad() {
  // タッチデバイスのみ表示
  const hasTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!hasTouchScreen) return;

  const dpad = $('dpad');
  if (dpad) dpad.style.display = 'block';

  const directions = {
    'dpad-up':    { dx: 0,  dy: -1 },
    'dpad-down':  { dx: 0,  dy:  1 },
    'dpad-left':  { dx: -1, dy:  0 },
    'dpad-right': { dx:  1, dy:  0 },
  };

  let heldInterval = null;

  function moveInDirection(dx, dy) {
    if (UI.screen !== 'field') return;
    const nx = Player.targetX + dx;
    const ny = Player.targetY + dy;
    if (MapSystem.isWalkable(GameState.location, nx, ny)) {
      Player.targetX = nx;
      Player.targetY = ny;
    }
  }

  function startMove(id) {
    const { dx, dy } = directions[id];
    moveInDirection(dx, dy);
    heldInterval = setInterval(() => moveInDirection(dx, dy), 160);
  }

  function stopMove() {
    if (heldInterval) { clearInterval(heldInterval); heldInterval = null; }
  }

  for (const [id, { dx, dy }] of Object.entries(directions)) {
    const btn = $(id);
    if (!btn) continue;
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      startMove(id);
    }, { passive: false });
    btn.addEventListener('touchend',   e => { e.preventDefault(); stopMove(); }, { passive: false });
    btn.addEventListener('touchcancel',e => { e.preventDefault(); stopMove(); }, { passive: false });
  }

  // 「話」ボタン：近くのNPCに話しかけ or テキストスキップ
  const interactBtn = $('dpad-interact');
  if (interactBtn) {
    interactBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (skipText()) return;
      if (UI.screen === 'field') {
        const map = MapSystem.getMap(GameState.location);
        if (map) {
          for (const npc of map.npcs) {
            if (Math.abs(npc.x - Player.x) <= 1.5 && Math.abs(npc.y - Player.y) <= 1.5) {
              interactWithNPC(npc.id);
              return;
            }
          }
        }
      }
    }, { passive: false });
  }
}

// ===== セーブからロード =====
function loadFromSave(data) {
  Object.assign(GameState, {
    personality: data.personality,
    location: data.location,
    inventory: { ...GameState.inventory, ...data.inventory },
    status: { ...GameState.status, ...data.status },
    dreamChoices: data.dreamChoices || [],
    fieldChoices: data.fieldChoices || {},
    npcProgress: { ...GameState.npcProgress, ...data.npcProgress },
    chaiGiven: { ...GameState.chaiGiven, ...data.chaiGiven },
    visitedLocations: data.visitedLocations || [],
    fieldEventsSeen: data.fieldEventsSeen || [],
    npcHistory: { ...GameState.npcHistory, ...data.npcHistory },
    collectedItems: data.collectedItems || {},
    currentMapItems: null,
    _vivekaNotified: data._vivekaNotified || 0,
  });
}

// ===== 通知キュー =====
const notifyQueue = [];
let notifyRunning = false;

function notify(msg, duration) {
  notifyQueue.push({ msg, duration: duration || 2500 });
  if (!notifyRunning) processNotifyQueue();
}

function processNotifyQueue() {
  if (notifyQueue.length === 0) { notifyRunning = false; return; }
  notifyRunning = true;
  const { msg, duration } = notifyQueue.shift();
  const el = $('notification');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(processNotifyQueue, 380);
  }, duration);
}

// ===== テキストタイプ効果 =====
function typeText(el, text, speed, callback, withSfx) {
  el.textContent = '';
  typeTextSkip = false;
  typeTextRunning = true;
  let i = 0;
  function next() {
    if (typeTextSkip) {
      el.textContent = text;
      typeTextSkip = false;
      typeTextRunning = false;
      if (callback) callback();
      return;
    }
    if (i < text.length) {
      const ch = text[i++];
      el.textContent += ch;
      if (withSfx && i % 3 === 0 && !/[\s\n。、「」…]/.test(ch)) {
        AudioSystem.sfxText();
      }
      setTimeout(next, speed);
    } else {
      typeTextRunning = false;
      if (callback) callback();
    }
  }
  next();
}

function skipText() {
  if (typeTextRunning) { typeTextSkip = true; return true; }
  // テキスト終了後はフィールドイベントの「つぎへ」またはダイアログの「続き」を進める
  const nextBtn = $('field-event-next');
  if (nextBtn && nextBtn.style.display !== 'none') { nextBtn.click(); return true; }
  const contBtn = $('dialogue-continue');
  if (contBtn && contBtn.style.display !== 'none') { closeDialogue(); return true; }
  return false;
}

// ===== エントリーポイント =====
document.addEventListener('DOMContentLoaded', init);
