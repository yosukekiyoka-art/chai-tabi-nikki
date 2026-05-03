// js/audio.js - Web Audio API チップチューン BGM + SFX
'use strict';

const AudioSystem = (() => {
  let ctx = null;
  let masterGain = null;
  let bgmNodes = [];
  let currentBgm = null;
  let bgmEnabled = true;
  let sfxEnabled = true;
  let bgmVolume = 0.4;
  let sfxVolume = 0.5;

  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not available');
    }
  }

  function ensureCtx() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return !!ctx;
  }

  // ---- oscillator helpers ----

  function makeOsc(type, freq, gainVal, startTime, duration, detune = 0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
    return { osc, g };
  }

  function makeEnvOsc(type, freq, gainVal, startTime, attack, sustain, release) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gainVal, startTime + attack);
    g.gain.setValueAtTime(gainVal, startTime + attack + sustain);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + sustain + release);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + attack + sustain + release + 0.1);
    return { osc, g };
  }

  // ---- BGM patterns ----

  // インドっぽいスケール (ラーガ風): D E F# A B (ヤマン風)
  const RAGA_NOTES = {
    D4: 293.66, E4: 329.63, Fs4: 369.99, A4: 440.00, B4: 493.88,
    D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880.00,
    D3: 146.83, A3: 220.00,
  };

  // ゴーカルナ: 海辺の穏やかな夕暮れ
  function bgmGokarna(startTime, loop) {
    const tempo = 0.55; // 秒/拍
    const nodes = [];

    // ドローン (タンプーラ風)
    const droneFreqs = [RAGA_NOTES.D3, RAGA_NOTES.A3, RAGA_NOTES.D4];
    droneFreqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = i * 3;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.04 * bgmVolume, startTime + 1.5);
      g.gain.setValueAtTime(0.04 * bgmVolume, startTime + loop - 1.5);
      g.gain.linearRampToValueAtTime(0, startTime + loop);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + loop);
      nodes.push(osc, g);
    });

    // メロディ (シタール風 triangle)
    const melody = [
      [RAGA_NOTES.D4, 0, 0.9],
      [RAGA_NOTES.E4, 2, 0.7],
      [RAGA_NOTES.Fs4, 4, 1.1],
      [RAGA_NOTES.A4, 6, 0.8],
      [RAGA_NOTES.B4, 8, 1.3],
      [RAGA_NOTES.A4, 10, 0.7],
      [RAGA_NOTES.Fs4, 12, 0.9],
      [RAGA_NOTES.E4, 14, 0.6],
      [RAGA_NOTES.D4, 16, 1.2],
      [RAGA_NOTES.A4, 18, 0.8],
      [RAGA_NOTES.B4, 20, 1.0],
      [RAGA_NOTES.D5, 22, 1.4],
      [RAGA_NOTES.A4, 24, 0.7],
      [RAGA_NOTES.Fs4, 26, 0.9],
      [RAGA_NOTES.E4, 28, 0.8],
      [RAGA_NOTES.D4, 30, 1.5],
    ];
    melody.forEach(([freq, beat, dur]) => {
      const t = startTime + beat * tempo;
      const n = makeEnvOsc('triangle', freq, 0.12 * bgmVolume, t, 0.02, dur * tempo - 0.05, 0.15);
      nodes.push(n.osc, n.g);
    });

    // タブラ風パーカッション
    const tabla = [0, 3, 5, 8, 10, 13, 16, 19, 21, 24, 26, 29];
    tabla.forEach(beat => {
      const t = startTime + beat * tempo;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      g.gain.setValueAtTime(0.15 * bgmVolume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(masterGain);
      o.start(t); o.stop(t + 0.15);
      nodes.push(o, g);
    });

    return nodes;
  }

  // ハンピ: 廃墟の神秘的な静寂
  function bgmHampi(startTime, loop) {
    const tempo = 0.65;
    const nodes = [];

    // 低いドローン
    [RAGA_NOTES.D3, RAGA_NOTES.D4].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.detune.value = i * 5 - 2;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.025 * bgmVolume, startTime + 2);
      g.gain.setValueAtTime(0.025 * bgmVolume, startTime + loop - 2);
      g.gain.linearRampToValueAtTime(0, startTime + loop);
      osc.connect(g); g.connect(masterGain);
      osc.start(startTime); osc.stop(startTime + loop);
      nodes.push(osc, g);
    });

    // 荘厳なメロディ
    const melody = [
      [RAGA_NOTES.D4, 0, 2.0],
      [RAGA_NOTES.Fs4, 3, 1.5],
      [RAGA_NOTES.A4, 5, 2.0],
      [RAGA_NOTES.D5, 8, 3.0],
      [RAGA_NOTES.A4, 12, 1.5],
      [RAGA_NOTES.Fs4, 14, 1.5],
      [RAGA_NOTES.E4, 16, 2.5],
      [RAGA_NOTES.D4, 20, 4.0],
    ];
    melody.forEach(([freq, beat, dur]) => {
      const t = startTime + beat * tempo;
      const n = makeEnvOsc('square', freq, 0.08 * bgmVolume, t, 0.05, dur * tempo - 0.1, 0.3);
      // ハーモニー
      const n2 = makeEnvOsc('triangle', freq * 1.5, 0.04 * bgmVolume, t, 0.05, dur * tempo - 0.1, 0.3);
      nodes.push(n.osc, n.g, n2.osc, n2.g);
    });

    return nodes;
  }

  // ヴァーラーナシー: ガンジスのざわめき、祈り
  function bgmVaranasi(startTime, loop) {
    const tempo = 0.45;
    const nodes = [];

    // 複数ドローン (賑やか)
    [RAGA_NOTES.D3, RAGA_NOTES.A3, RAGA_NOTES.D4, RAGA_NOTES.A4].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 4;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.03 * bgmVolume, startTime + 1);
      g.gain.setValueAtTime(0.03 * bgmVolume, startTime + loop - 1);
      g.gain.linearRampToValueAtTime(0, startTime + loop);
      osc.connect(g); g.connect(masterGain);
      osc.start(startTime); osc.stop(startTime + loop);
      nodes.push(osc, g);
    });

    // 速いメロディ
    const melody = [
      [RAGA_NOTES.D4,0,0.6],[RAGA_NOTES.E4,1,0.5],[RAGA_NOTES.Fs4,2,0.6],
      [RAGA_NOTES.A4,3,0.7],[RAGA_NOTES.B4,4,0.5],[RAGA_NOTES.A4,5,0.6],
      [RAGA_NOTES.Fs4,6,0.5],[RAGA_NOTES.E4,7,0.7],[RAGA_NOTES.D4,8,0.8],
      [RAGA_NOTES.D5,9,0.6],[RAGA_NOTES.B4,10,0.5],[RAGA_NOTES.A4,11,0.6],
      [RAGA_NOTES.Fs4,12,0.7],[RAGA_NOTES.E4,13,0.5],[RAGA_NOTES.D4,14,0.6],
      [RAGA_NOTES.A4,15,0.8],[RAGA_NOTES.D5,16,1.2],
    ];
    melody.forEach(([freq, beat, dur]) => {
      const t = startTime + beat * tempo;
      const n = makeEnvOsc('sawtooth', freq, 0.09 * bgmVolume, t, 0.01, dur * tempo - 0.03, 0.08);
      nodes.push(n.osc, n.g);
    });

    // 鐘 (ガン)
    [0, 8, 16].forEach(beat => {
      const t = startTime + beat * tempo;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = RAGA_NOTES.A5;
      g.gain.setValueAtTime(0.18 * bgmVolume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g); g.connect(masterGain);
      o.start(t); o.stop(t + 1.6);
      nodes.push(o, g);
    });

    return nodes;
  }

  // リシュケーシュ: ヒマラヤの静寂と清澄
  function bgmRishikesh(startTime, loop) {
    const tempo = 0.8;
    const nodes = [];

    // 澄んだドローン
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = RAGA_NOTES.D4;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(0.06 * bgmVolume, startTime + 3);
    g.gain.setValueAtTime(0.06 * bgmVolume, startTime + loop - 3);
    g.gain.linearRampToValueAtTime(0, startTime + loop);
    osc.connect(g); g.connect(masterGain);
    osc.start(startTime); osc.stop(startTime + loop);
    nodes.push(osc, g);

    // シンプルで瞑想的なメロディ
    const melody = [
      [RAGA_NOTES.D4, 0, 3.5],
      [RAGA_NOTES.E4, 4, 2.5],
      [RAGA_NOTES.Fs4, 7, 3.0],
      [RAGA_NOTES.A4, 11, 4.0],
      [RAGA_NOTES.Fs4, 16, 2.5],
      [RAGA_NOTES.E4, 19, 3.0],
      [RAGA_NOTES.D4, 23, 5.0],
    ];
    melody.forEach(([freq, beat, dur]) => {
      const t = startTime + beat * tempo;
      const n = makeEnvOsc('sine', freq, 0.1 * bgmVolume, t, 0.1, dur * tempo - 0.2, 0.6);
      const n2 = makeEnvOsc('triangle', freq * 2, 0.03 * bgmVolume, t, 0.1, dur * tempo - 0.2, 0.6);
      nodes.push(n.osc, n.g, n2.osc, n2.g);
    });

    return nodes;
  }

  // 夢のシーン: 星空の静寂、浮遊感
  function bgmDream(startTime, loop) {
    const nodes = [];

    // 超低音ドローン（宇宙的）
    [RAGA_NOTES.D3 / 2, RAGA_NOTES.A3 / 2].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.detune.value = i * 6;
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.05 * bgmVolume, startTime + 4);
      g.gain.setValueAtTime(0.05 * bgmVolume, startTime + loop - 4);
      g.gain.linearRampToValueAtTime(0, startTime + loop);
      osc.connect(g); g.connect(masterGain);
      osc.start(startTime); osc.stop(startTime + loop);
      nodes.push(osc, g);
    });

    // きらめくハーモニクス（星の瞬き）
    const sparkle = [
      [RAGA_NOTES.D5,  0,   5.0],
      [RAGA_NOTES.A5,  6,   4.0],
      [RAGA_NOTES.Fs5, 12,  5.5],
      [RAGA_NOTES.E5,  18,  4.5],
      [RAGA_NOTES.D5,  24,  6.0],
      [RAGA_NOTES.B4,  30,  5.0],
    ];
    sparkle.forEach(([freq, beat, dur]) => {
      const t = startTime + beat;
      const n = makeEnvOsc('sine', freq, 0.06 * bgmVolume, t, 0.5, dur - 1, 2.0);
      const n2 = makeEnvOsc('triangle', freq * 2, 0.02 * bgmVolume, t + 0.1, 0.3, dur - 0.5, 1.5);
      nodes.push(n.osc, n.g, n2.osc, n2.g);
    });

    // 風鈴のような高音（ランダム）
    for (let i = 0; i < 5; i++) {
      const chimeFreqs = [RAGA_NOTES.D5, RAGA_NOTES.Fs5, RAGA_NOTES.A5, RAGA_NOTES.D5 * 2];
      const freq = chimeFreqs[Math.floor(i * 1.3) % chimeFreqs.length];
      const beat = i * 7.2 + 3;
      const t = startTime + beat;
      const o = ctx.createOscillator();
      const g2 = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g2.gain.setValueAtTime(0.07 * bgmVolume, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      o.connect(g2); g2.connect(masterGain);
      o.start(t); o.stop(t + 4);
      nodes.push(o, g2);
    }

    return nodes;
  }

  // BGM生成関数マップ
  const BGM_MAKERS = {
    dream:     { fn: bgmDream,    loopBars: 36, tempo: 1.00 },
    gokarna:   { fn: bgmGokarna,  loopBars: 32, tempo: 0.55 },
    hampi:     { fn: bgmHampi,    loopBars: 24, tempo: 0.65 },
    varanasi:  { fn: bgmVaranasi, loopBars: 18, tempo: 0.45 },
    rishikesh: { fn: bgmRishikesh,loopBars: 28, tempo: 0.80 },
  };

  function calcLoopDuration(id) {
    const b = BGM_MAKERS[id];
    return b ? b.loopBars * b.tempo : 20;
  }

  let loopTimer = null;

  function scheduleBgmLoop(id, startTime) {
    if (!BGM_MAKERS[id]) return;
    const duration = calcLoopDuration(id);
    const nodes = BGM_MAKERS[id].fn(startTime, duration);
    bgmNodes.push(...nodes);

    // 次のループをスケジュール (フェード重複なし)
    const msUntilNext = (duration - 0.1) * 1000;
    loopTimer = setTimeout(() => {
      if (currentBgm === id && bgmEnabled) {
        scheduleBgmLoop(id, ctx.currentTime);
      }
    }, msUntilNext);
  }

  function stopAllBgmNodes() {
    clearTimeout(loopTimer);
    bgmNodes.forEach(n => {
      try { n.stop ? n.stop() : n.disconnect(); } catch (e) {}
    });
    bgmNodes = [];
  }

  function playBgm(id, fadeInDuration) {
    if (!ensureCtx()) return;
    if (currentBgm === id) return;
    stopAllBgmNodes();
    currentBgm = id;
    if (!bgmEnabled || !BGM_MAKERS[id]) return;
    const startT = ctx.currentTime + 0.1;
    // フェードイン（ロケーション切り替え時）
    if (fadeInDuration && masterGain) {
      masterGain.gain.setValueAtTime(0.0, startT);
      masterGain.gain.linearRampToValueAtTime(1.0, startT + fadeInDuration);
    }
    scheduleBgmLoop(id, startT);
  }

  function stopBgm() {
    stopAllBgmNodes();
    currentBgm = null;
  }

  function fadeBgm(duration) {
    if (!ensureCtx() || !masterGain) return;
    const t = ctx.currentTime;
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(0, t + duration);
    setTimeout(() => {
      stopAllBgmNodes();
      currentBgm = null;
      masterGain.gain.setValueAtTime(1.0, ctx.currentTime);
    }, duration * 1000 + 100);
  }

  // ---- SFX ----

  function sfxStep() { sfxStepTile(2); }

  function sfxStepTile(tileType) {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    const configs = {
      0: { freq:160, type:'sine',     vol:0.050, dur:0.10 }, // 水
      1: { freq:200, type:'triangle', vol:0.030, dur:0.08 }, // 砂
      2: { freq: 90, type:'square',   vol:0.028, dur:0.07 }, // 草
      3: { freq:130, type:'square',   vol:0.040, dur:0.07 }, // 道
      5: { freq:155, type:'square',   vol:0.048, dur:0.065}, // 石
      7: { freq:140, type:'square',   vol:0.038, dur:0.07 }, // 床
      8: { freq:145, type:'square',   vol:0.040, dur:0.07 }, // 床2
    };
    const cfg = configs[tileType] || { freq:85+Math.random()*35, type:'square', vol:0.038, dur:0.065 };
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = cfg.type;
    o.frequency.value = cfg.freq + (Math.random() - 0.5) * 14;
    g.gain.setValueAtTime(cfg.vol * sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + cfg.dur + 0.02);
  }

  function sfxDecide() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    [[440, 0], [550, 0.06], [660, 0.12]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.1 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.08);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.1);
    });
  }

  function sfxCancel() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    [[330, 0], [220, 0.08]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.1);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.12);
    });
  }

  function sfxGetItem() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.24]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.15 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.18);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.2);
    });
  }

  function sfxChai() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // 温かみのある上昇音 + スパイスのジュワッ
    for (let i = 0; i < 8; i++) {
      const freq = 300 + i * 60;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08 * sfxVolume, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.12);
      o.connect(g); g.connect(masterGain);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.15);
    }
    // ノイズっぽい沸騰音
    const bufSize = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
    const src = ctx.createBufferSource();
    const gn = ctx.createGain();
    src.buffer = buf;
    gn.gain.setValueAtTime(sfxVolume * 0.12, t + 0.3);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(gn); gn.connect(masterGain);
    src.start(t + 0.3); src.stop(t + 0.85);
  }

  function sfxDoor() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.25);
    g.gain.setValueAtTime(0.12 * sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.35);
  }

  function sfxText() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 440 + Math.random() * 100;
    g.gain.setValueAtTime(0.03 * sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.05);
  }

  function sfxFarewell() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // 静かで哀愁のある下降音
    [[880,0],[660,0.2],[523,0.4],[440,0.65],[330,0.9]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.3);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.35);
    });
  }

  function sfxSave() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    [[392,0],[523,0.07],[659,0.14],[784,0.21]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.12);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.15);
    });
  }

  function sfxNpcNear() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    [[880, 0], [1100, 0.1]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.05 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.4);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.45);
    });
  }

  function sfxFieldEvent() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // 静かな3音の上昇和音（旅路の扉が開く感じ）
    [[349.23, 0, 0.06], [440, 0.1, 0.05], [523.25, 0.22, 0.04]].forEach(([freq, dt, vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(vol * sfxVolume, t + dt + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.6);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.65);
    });
  }

  function sfxChaiGiven() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // 温かく上昇する5音チャイム（チャイを渡す喜び）
    [[220,0,0.06],[330,0.10,0.05],[440,0.22,0.05],[550,0.36,0.04],[660,0.52,0.03]].forEach(([freq,dt,vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(vol * sfxVolume, t + dt + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.9);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.95);
    });
  }

  function sfxLocationBridge() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // 旅立ちの和音: Dメジャー 4音 + 高音の余韻
    [[293.66,0.00,0.055],[369.99,0.08,0.042],[440.00,0.18,0.035],[587.33,0.32,0.028]].forEach(([freq,dt,vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(vol * sfxVolume, t + dt + 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.1);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 1.2);
    });
    // 高音のきらめき
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = 1174.66;
    g2.gain.setValueAtTime(0, t + 0.5);
    g2.gain.linearRampToValueAtTime(0.018 * sfxVolume, t + 0.65);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o2.connect(g2); g2.connect(masterGain);
    o2.start(t + 0.5); o2.stop(t + 2.0);
  }

  function sfxVivekaOvertone() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // シンギングボウル風: ゆっくり広がる倍音の重なり
    [[293.66, 0.00, 0.055], [587.33, 0.25, 0.038], [880.00, 0.65, 0.022], [1174.66, 1.20, 0.012]].forEach(([freq, dt, vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(vol * sfxVolume, t + dt + 1.0);
      g.gain.setValueAtTime(vol * sfxVolume, t + dt + 2.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 5.5);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 5.8);
    });
  }

  function sfxMeditate() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    // 澄んだシンバル風：高周波サイン波をゆっくりフェードアウト
    [[660, 0, 0.06], [990, 0.05, 0.04], [1320, 0.12, 0.03]].forEach(([freq, dt, vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.8);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 2.0);
    });
  }

  function sfxError() {
    if (!ensureCtx() || !sfxEnabled) return;
    const t = ctx.currentTime;
    [[180, 0],[120, 0.1]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.1 * sfxVolume, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.12);
      o.connect(g); g.connect(masterGain);
      o.start(t + dt); o.stop(t + dt + 0.15);
    });
  }

  // ---- settings ----

  function setBgmEnabled(v) {
    bgmEnabled = v;
    if (!v) {
      stopAllBgmNodes();
    } else if (currentBgm) {
      const toPlay = currentBgm;
      currentBgm = null; // allow playBgm to not skip
      playBgm(toPlay);
    }
  }

  function setSfxEnabled(v) { sfxEnabled = v; }
  function setBgmVolume(v) { bgmVolume = Math.max(0, Math.min(1, v)); }
  function setSfxVolume(v) { sfxVolume = Math.max(0, Math.min(1, v)); }
  function getBgmEnabled() { return bgmEnabled; }
  function getSfxEnabled() { return sfxEnabled; }
  function getBgmVolume()  { return bgmVolume; }
  function getSfxVolume()  { return sfxVolume; }

  function duckBgm(factor, fadeTime) {
    if (!ensureCtx() || !masterGain) return;
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(factor, t + (fadeTime || 1.0));
  }

  function unduckBgm(fadeTime) {
    if (!ensureCtx() || !masterGain) return;
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(1.0, t + (fadeTime || 1.5));
  }

  return {
    init, playBgm, stopBgm, fadeBgm, duckBgm, unduckBgm,
    sfxStep, sfxStepTile, sfxDecide, sfxCancel, sfxGetItem, sfxChai, sfxChaiGiven,
    sfxDoor, sfxText, sfxFarewell, sfxSave, sfxError, sfxNpcNear, sfxMeditate, sfxFieldEvent, sfxLocationBridge, sfxVivekaOvertone,
    setBgmEnabled, setSfxEnabled, setBgmVolume, setSfxVolume,
    getBgmEnabled, getSfxEnabled, getBgmVolume, getSfxVolume,
  };
})();
