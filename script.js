/* ==========================================================
   Void Runner v1.1 - script.js
   ・ゲーム画面は 360×640 の「論理サイズ」で計算し、画面に合わせて拡大縮小
   ・PC:矢印キー / WASD   スマホ:画面のどこでも指をスライド
   ・v1.1:シェア機能 / 軽量化(スプライトのキャッシュ) / シールド / ランク
   ========================================================== */
(() => {
  "use strict";

  const W = 360, H = 640;
  const LEVEL_TIME = 15;      // 何秒ごとにレベルアップするか
  const COMBO_TIME = 2.2;     // コンボが続く秒数
  const SENS = 1.2;           // ドラッグ操作の感度(大きいほど少しの動きで大きく動く)
  const PLAYER_MIN_Y = 118;   // 自機が動ける上限(HUDにかぶらない位置)
  const SHIELD_FROM = 8;      // 何秒目からシールドが出るか
  const SHIELD_RATE = 0.03;   // シールドの出やすさ(出現のたびの確率)
  const INVULN_TIME = 1.0;    // シールドが割れたあとの無敵時間(秒)
  const SPR = 2;              // スプライト(事前に描いておく絵)の解像度

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage"), cv = $("#game");
  const ctx = cv.getContext("2d", { alpha: false });
  const bgc = document.createElement("canvas"), bgx = bgc.getContext("2d");
  const reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);

  const el = {
    hud: $("#hud"), hudBtns: $("#hud-buttons"), lvbar: $("#levelbar"), lvfill: $("#levelbar-fill"),
    score: $("#hud-score"), best: $("#hud-best"), level: $("#hud-level"), coins: $("#hud-coins"),
    combo: $("#combo"), comboPill: $("#combo-pill"), comboText: $("#combo-text"), comboBar: $("#combo-bar"),
    shieldInd: $("#shield-ind"),
    btnPause: $("#btn-pause"), btnSound: $("#btn-sound"),
    title: $("#screen-title"), pause: $("#screen-pause"), over: $("#screen-over"),
    titleBest: $("#title-best"), titlePlays: $("#title-plays"),
    overScore: $("#over-score"), overBest: $("#over-best"), overRank: $("#over-rank"), newRecord: $("#newrecord"),
    stTime: $("#st-time"), stCoins: $("#st-coins"), stCombo: $("#st-combo"), stLevel: $("#st-level"),
    countdown: $("#countdown"), hint: $("#start-hint"),
    banner: $("#banner"), bannerMain: $("#banner-main"), bannerSub: $("#banner-sub"), flash: $("#flash"),
    btnStart: $("#btn-start"), btnResume: $("#btn-resume"), btnQuit: $("#btn-quit"),
    btnRetry: $("#btn-retry"), btnTitle: $("#btn-title"), btnLite: $("#btn-lite"),
    btnX: $("#btn-x"), btnLine: $("#btn-line"), btnImg: $("#btn-img"), btnCopy: $("#btn-copy"),
    toast: $("#toast")
  };

  // ---------- 小さな道具 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  function restartAnim(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  const vib = (p) => { if (!reduceMotion && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } };

  // ---------- 保存(ハイスコア・ミュート・軽量モード・プレイ回数) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("voidrunner." + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("voidrunner." + k, String(v)); } catch (e) {} }
  };
  let best = parseInt(store.get("best", "0"), 10) || 0;
  let muted = store.get("muted", "0") === "1";
  let lite = store.get("lite", "0") === "1";       // 自分で切り替えた軽量モード
  let plays = parseInt(store.get("plays", "0"), 10) || 0;
  let liteAuto = false;                             // 重い端末で自動的に切り替わった軽量モード
  const isLite = () => lite || liteAuto;

  // ---------- 画面サイズ ----------
  let u = 1, dpr = 1, bgKey = -1, dirty = true;
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const sw = Math.max(1, Math.floor(Math.min(vw, vh * W / H)));
    const sh = Math.floor(sw * H / W);
    stage.style.width = sw + "px";
    stage.style.height = sh + "px";
    u = sw / W;
    dpr = Math.min(window.devicePixelRatio || 1, isLite() ? 1.5 : 2);
    cv.width = bgc.width = Math.round(sw * dpr);
    cv.height = bgc.height = Math.round(sh * dpr);
    bgKey = -1; dirty = true;
    document.documentElement.style.fontSize = (u * 10) + "px";
  }
  window.addEventListener("resize", resize);

  // ---------- 効果音(WebAudio) ----------
  let actx = null, noiseBuf = null;
  function ensureAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === "suspended") actx.resume();
  }
  function beep(freq, dur, type, vol, slide) {
    if (muted || !actx) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol) {
    if (muted || !actx) return;
    if (!noiseBuf) { // ノイズは1回だけ作って使い回す
      const n = Math.floor(actx.sampleRate * 0.6);
      noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = actx.currentTime;
    const s = actx.createBufferSource(), g = actx.createGain();
    s.buffer = noiseBuf;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(g); g.connect(actx.destination);
    s.start(t); s.stop(t + dur);
  }
  const sfx = {
    tick: () => beep(440, 0.1, "triangle", 0.09),
    go: () => { beep(660, 0.12, "triangle", 0.1); setTimeout(() => beep(990, 0.2, "triangle", 0.1), 100); },
    coin: (c) => {
      const f = 880 * Math.pow(1.06, Math.min(c, 10));
      beep(f, 0.08, "square", 0.06);
      setTimeout(() => beep(f * 1.5, 0.1, "square", 0.06), 60);
    },
    hit: () => { beep(220, 0.6, "sawtooth", 0.12, 35); noise(0.5, 0.25); },
    level: () => { beep(520, 0.12, "triangle", 0.09, 780); setTimeout(() => beep(780, 0.18, "triangle", 0.09, 1040), 110); },
    shield: () => { beep(660, 0.1, "triangle", 0.09, 990); setTimeout(() => beep(990, 0.16, "triangle", 0.09, 1320), 90); },
    shieldBreak: () => { beep(300, 0.25, "sawtooth", 0.1, 90); noise(0.2, 0.15); },
    click: () => beep(600, 0.05, "square", 0.04),
    pause: () => beep(330, 0.08, "triangle", 0.07)
  };

  // ---------- スプライト(重い光の効果を、最初に1回だけ描いて使い回す) ----------
  function mk(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * SPR); c.height = Math.ceil(h * SPR);
    const g = c.getContext("2d");
    g.scale(SPR, SPR);
    return [c, g];
  }
  const COIN_S = 54;   // コイン/シールドのスプライト一辺(論理px)
  const coinSpr = (() => {
    const [c, g] = mk(COIN_S, COIN_S);
    g.translate(COIN_S / 2, COIN_S / 2);
    g.shadowColor = "#ffd23f"; g.shadowBlur = 14 * SPR;
    const cg = g.createRadialGradient(-3, -3, 1, 0, 0, 11);
    cg.addColorStop(0, "#fff6c2"); cg.addColorStop(0.6, "#ffd23f"); cg.addColorStop(1, "#d99a00");
    g.fillStyle = cg;
    g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(139,94,0,.7)"; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.stroke();
    return c;
  })();
  const shieldSpr = (() => {
    const [c, g] = mk(COIN_S, COIN_S);
    g.translate(COIN_S / 2, COIN_S / 2);
    g.shadowColor = "#3df5ff"; g.shadowBlur = 14 * SPR;
    g.fillStyle = "rgba(61,245,255,.2)"; g.strokeStyle = "#3df5ff"; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fill(); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = "#c9fdff";
    g.beginPath();
    g.moveTo(0, -6.5); g.lineTo(5.5, -4); g.lineTo(5, 2);
    g.quadraticCurveTo(3.5, 6, 0, 8); g.quadraticCurveTo(-3.5, 6, -5, 2); g.lineTo(-5.5, -4);
    g.closePath(); g.fill();
    return c;
  })();
  const PL_S = 72;
  const playerSpr = (() => {
    const [c, g] = mk(PL_S, PL_S);
    g.translate(PL_S / 2, PL_S / 2);
    g.shadowColor = "#3df5ff"; g.shadowBlur = 18 * SPR;
    const gr = g.createLinearGradient(0, -14, 0, 14);
    gr.addColorStop(0, "#8ffaff"); gr.addColorStop(1, "#18c8e0");
    g.fillStyle = gr;
    rr(g, -14, -14, 28, 28, 7); g.fill();
    return c;
  })();
  const BPAD = 12;
  function newBlock(x, y, w, h, vy) {
    const len = Math.min(vy * 0.09, 50);       // 落ちてくる残像の長さ
    const [c, g] = mk(w + BPAD * 2, len + h + BPAD * 2);
    const by = BPAD + len;
    const sg = g.createLinearGradient(0, BPAD, 0, by);
    sg.addColorStop(0, "rgba(255,45,85,0)"); sg.addColorStop(1, "rgba(255,45,85,.35)");
    g.fillStyle = sg; g.fillRect(BPAD + 4, BPAD, w - 8, len);
    g.shadowColor = "#ff2d55"; g.shadowBlur = 12 * SPR;
    const bg = g.createLinearGradient(0, by, 0, by + h);
    bg.addColorStop(0, "#ff5d7a"); bg.addColorStop(1, "#d90f3a");
    g.fillStyle = bg; rr(g, BPAD, by, w, h, 5); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,.28)"; rr(g, BPAD + 3, by + 3, w - 6, 3, 2); g.fill();
    return { type: "block", x, y, w, h, vy, len, spr: c, sw: c.width / SPR, sh: c.height / SPR };
  }
  const warnGrad = (() => {
    const g = ctx.createLinearGradient(0, 0, 0, 110);
    g.addColorStop(0, "rgba(255,45,85,.45)"); g.addColorStop(1, "rgba(255,45,85,0)");
    return g;
  })();

  // 背景(グラデーションと光)は色が変わったときだけ描き直す
  function renderBg() {
    const s = cv.width / W;
    bgx.setTransform(s, 0, 0, s, 0, 0);
    const g = bgx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "hsl(" + bgHue + ",55%,5%)");
    g.addColorStop(1, "hsl(" + (bgHue + 20) + ",50%,10%)");
    bgx.fillStyle = g;
    bgx.fillRect(0, 0, W, H);
    if (isLite()) return;
    const blobs = [
      { x: W * 0.3, y: H * 0.3, r: 220, h: bgHue + 30 },
      { x: W * 0.75, y: H * 0.7, r: 240, h: bgHue - 40 }
    ];
    for (const b of blobs) {
      const rg = bgx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      rg.addColorStop(0, "hsla(" + b.h + ",80%,50%,.14)");
      rg.addColorStop(1, "hsla(" + b.h + ",80%,50%,0)");
      bgx.fillStyle = rg;
      bgx.fillRect(0, 0, W, H);
    }
  }

  // ---------- ゲームの状態 ----------
  // title | countdown | play | paused | over
  let state = "title", prevState = "play";
  let player, objs, warns, parts, rings, texts;
  let time, score, coins, level, spawnT, combo, comboT, maxCombo, newBest, finalScore;
  let shield = false, invuln = 0;
  let target, targetY, shake, clock = 0, shownScore = -1, lvP = -1, cbP = -1;
  let cdT = 0, cdIdx = -1, overAt = 0, overShown = false, overCountT = 1;
  let demoT = 0, thrustT = 0, bgHue = 240, bgHueTarget = 240;
  let cardBlob = null, autoChecked = false, fpsAcc = 0, fpsN = 0;
  const keys = { left: false, right: false, up: false, down: false };

  // 背景の星(3層の視差)
  const LAYERS = [
    { n: 30, v: 14, s: 0.9, a: 0.35 },
    { n: 22, v: 34, s: 1.4, a: 0.55 },
    { n: 12, v: 70, s: 2.0, a: 0.85 }
  ];
  const starL = LAYERS.map((l) => Array.from({ length: l.n }, () => ({ x: rand(0, W), y: rand(0, H) })));

  function setShield(v) { shield = v; el.shieldInd.classList.toggle("on", v); }

  function resetWorld() {
    player = { x: W / 2, y: H - 90, w: 28, h: 28, vx: 0, tilt: 0, spawn: 1 };
    target = W / 2; targetY = H - 90;
    objs = []; warns = []; parts = []; rings = []; texts = [];
    time = 0; score = 0; coins = 0; level = 1; spawnT = 0.5;
    combo = 0; comboT = 0; maxCombo = 0; newBest = false; finalScore = 0;
    shake = 0; shownScore = -1; lvP = -1; cbP = -1; invuln = 0;
    setShield(false);
    bgHueTarget = 240;
  }

  resize();
  resetWorld();

  // ---------- 画面の表示切り替え ----------
  const showScreen = (s) => s.classList.add("show");
  const hideScreen = (s) => s.classList.remove("show");
  function setHud(on) { [el.hud, el.hudBtns, el.lvbar].forEach((n) => n.classList.toggle("hidden", !on)); }
  function refreshBest() { el.titleBest.textContent = best; el.best.textContent = best; el.titlePlays.textContent = plays; }
  function refreshSoundBtn() { el.btnSound.classList.toggle("off", muted); }
  function refreshLiteBtn() {
    el.btnLite.classList.toggle("on", isLite());
    el.btnLite.textContent = lite ? "⚡ LITE ON" : (liteAuto ? "⚡ LITE AUTO" : "⚡ LITE OFF");
  }
  function toast(msg) { el.toast.textContent = msg; restartAnim(el.toast, "show"); }

  // ---------- 演出の部品 ----------
  function burst(x, y, color, n, speed, size) {
    const lt = isLite();
    n = Math.max(1, Math.round(n * (lt ? 0.4 : 1)));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, speed);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.4, 0.9), color, size: rand(size * 0.6, size * 1.4), drag: 0.95 });
    }
    const cap = lt ? 150 : 400;
    if (parts.length > cap) parts.splice(0, parts.length - cap);
  }
  function ring(x, y, color, maxR, dur, width) { rings.push({ x, y, color, maxR, life: 0, max: dur, width }); }
  function floatText(str, x, y, color, size) { texts.push({ str, x, y, color, size, life: 0, max: 0.9 }); }
  function flash(color, alpha) {
    if (reduceMotion || isLite()) return;
    el.flash.style.background = color;
    el.flash.style.setProperty("--fa", alpha);
    restartAnim(el.flash, "on");
  }
  function thrust(dt) {
    thrustT -= dt;
    const step = isLite() ? 0.045 : 0.02;
    while (thrustT <= 0) {
      thrustT += step;
      parts.push({
        x: player.x + rand(-6, 6), y: player.y + player.h / 2 - 2,
        vx: rand(-15, 15), vy: rand(80, 170), life: 0, max: rand(0.2, 0.42),
        color: Math.random() < 0.5 ? "#3df5ff" : "#7b61ff", size: rand(2, 4.2), drag: 0.96
      });
    }
  }

  // ---------- コンボ ----------
  const mult = () => Math.min(5, 1 + Math.floor((combo - 1) / 3));
  function updateComboUI() {
    if (combo >= 2) {
      el.comboText.textContent = "COMBO " + combo + (mult() > 1 ? "  ×" + mult() : "");
      el.combo.classList.add("on");
      restartAnim(el.comboPill, "bump");
    } else {
      el.combo.classList.remove("on");
    }
  }

  // ---------- ランク ----------
  const RANKS = [[0, "ROOKIE"], [300, "RUNNER"], [800, "DASHER"], [1500, "PILOT"], [2500, "ACE"], [4000, "VOID MASTER"]];
  function rankOf(s) { let r = RANKS[0][1]; for (const [m, n] of RANKS) if (s >= m) r = n; return r; }

  // ---------- ゲームの流れ ----------
  function startGame() {
    ensureAudio();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    resetWorld();
    player.spawn = 0;
    state = "countdown"; cdT = 0; cdIdx = -1; overShown = false;
    hideScreen(el.title); hideScreen(el.over); hideScreen(el.pause);
    setHud(true);
    el.score.textContent = "0"; el.level.textContent = "1"; el.coins.textContent = "0";
    el.best.textContent = best; el.lvfill.style.transform = "scaleX(0)";
    el.combo.classList.remove("on");
    el.hint.textContent = coarse ? "画面のどこでも指をスライドして動かそう" : "← ↑ ↓ → / W A S D で動かそう";
    restartAnim(el.hint, "show");
  }

  function toTitle() {
    state = "title";
    resetWorld();
    hideScreen(el.over); hideScreen(el.pause);
    setHud(false);
    el.combo.classList.remove("on");
    refreshBest();
    showScreen(el.title);
  }

  function pause() {
    if (state !== "play" && state !== "countdown") return;
    prevState = state; state = "paused";
    dragging = false; dragId = null;
    keys.left = keys.right = keys.up = keys.down = false;
    showScreen(el.pause);
    sfx.pause();
  }
  function resume() {
    if (state !== "paused") return;
    state = prevState;
    hideScreen(el.pause);
    sfx.click();
  }

  function gameOver() {
    state = "over"; overAt = performance.now(); overShown = false;
    dragging = false; dragId = null;
    finalScore = Math.floor(score);
    if (finalScore > best) { best = finalScore; newBest = true; store.set("best", best); }
    plays++; store.set("plays", plays);
    warns.length = 0; combo = 0;
    el.combo.classList.remove("on");
    sfx.hit();
    vib(120);
    burst(player.x, player.y, "#3df5ff", 40, 320, 4);
    burst(player.x, player.y, "#ffffff", 24, 260, 3);
    burst(player.x, player.y, "#ff2d55", 20, 200, 4);
    ring(player.x, player.y, "#ff2d55", 150, 0.7, 5);
    ring(player.x, player.y, "#ffffff", 90, 0.5, 3);
    shake = (reduceMotion || isLite()) ? 0 : 16;
    flash("#ff2d55", 0.5);
  }

  function showOver() {
    overShown = true;
    setHud(false);
    el.overBest.textContent = best;
    el.overRank.textContent = "RANK  " + rankOf(finalScore);
    el.stTime.textContent = time.toFixed(1) + "秒";
    el.stCoins.textContent = coins;
    el.stCombo.textContent = maxCombo;
    el.stLevel.textContent = level;
    el.newRecord.classList.toggle("show", newBest);
    el.overScore.textContent = "0";
    overCountT = 0;
    showScreen(el.over);
    // シェア用の画像を、ボタンが押される前に作っておく
    cardBlob = null;
    try { drawCard().toBlob((b) => { cardBlob = b; }, "image/png"); } catch (e) {}
  }

  function levelUp() {
    el.level.textContent = level;
    restartAnim(el.level.parentElement, "pop");
    el.bannerMain.textContent = "LEVEL " + level;
    el.bannerSub.textContent = "SPEED UP!";
    restartAnim(el.banner, "show");
    ring(player.x, player.y, "#3df5ff", 220, 0.8, 4);
    ring(player.x, player.y, "#7b61ff", 140, 0.6, 3);
    flash("#3df5ff", 0.22);
    sfx.level();
    vib(30);
    bgHueTarget = 240 + ((level - 1) * 35) % 360;
  }

  function onCoin(o) {
    combo++; comboT = COMBO_TIME; maxCombo = Math.max(maxCombo, combo);
    const m = mult(), pts = 50 * m;
    score += pts; coins++;
    sfx.coin(combo);
    burst(o.x, o.y, "#ffd23f", 14, 220, 3);
    ring(o.x, o.y, "#ffd23f", 34, 0.4, 2);
    floatText("+" + pts + (m > 1 ? " ×" + m : ""), o.x, o.y - 8, m > 1 ? "#fff08a" : "#ffd23f", m > 1 ? 20 : 17);
    if (combo > 1 && (combo - 1) % 3 === 0) {
      floatText("COMBO ×" + m + "!", player.x, player.y - 44, "#ffffff", 22);
      ring(player.x, player.y, "#ffd23f", 90, 0.55, 3);
    }
    el.coins.textContent = coins;
    restartAnim(el.coins.parentElement, "pop");
    restartAnim(el.score, "pop");
    updateComboUI();
  }

  function onShield(o) {
    setShield(true);
    sfx.shield();
    vib(15);
    burst(o.x, o.y, "#3df5ff", 14, 220, 3);
    ring(o.x, o.y, "#3df5ff", 50, 0.45, 2);
    floatText("SHIELD!", o.x, o.y - 8, "#3df5ff", 18);
  }

  function breakShield(o) {
    setShield(false);
    invuln = INVULN_TIME;
    sfx.shieldBreak();
    vib(40);
    burst(o.x + o.w / 2, o.y + o.h / 2, "#ff2d55", 16, 240, 3);
    burst(player.x, player.y, "#3df5ff", 20, 260, 3);
    ring(player.x, player.y, "#3df5ff", 110, 0.5, 4);
    floatText("SHIELD BREAK!", player.x, player.y - 44, "#3df5ff", 18);
    flash("#3df5ff", 0.2);
    shake = (reduceMotion || isLite()) ? 0 : 6;
  }

  // ---------- 入力:キーボード ----------
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    let handled = true;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = true;
    else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = true;
    else if (k === "ArrowUp" || k === "w" || k === "W") keys.up = true;
    else if (k === "ArrowDown" || k === "s" || k === "S") keys.down = true;
    else if (k === " " || k === "Enter") {
      // ボタンにフォーカスがあるときは、そのボタン自身の動作に任せる
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      if (state === "title") startGame();
      else if (state === "over" && overShown) startGame();
      else if (state === "paused") resume();
    } else if (k === "p" || k === "P" || k === "Escape") {
      if (e.repeat) return;
      if (state === "paused") resume(); else pause();
    } else if (k === "m" || k === "M") {
      if (e.repeat) return;
      muted = !muted; store.set("muted", muted ? 1 : 0); refreshSoundBtn();
    } else handled = false;
    if (handled) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    if (k === "ArrowUp" || k === "w" || k === "W") keys.up = false;
    if (k === "ArrowDown" || k === "s" || k === "S") keys.down = false;
  });
  window.addEventListener("blur", () => { keys.left = keys.right = keys.up = keys.down = false; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  // ---------- 入力:指/マウス(画面のどこでもスライド) ----------
  let dragging = false, dragId = null, sx = 0, sy = 0, tx0 = 0, ty0 = 0;
  function beginDrag(e) {
    dragging = true; dragId = e.pointerId;
    sx = e.clientX; sy = e.clientY; tx0 = target; ty0 = targetY;
  }
  document.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (e.target.closest && e.target.closest("button")) return;
    if ((state === "play" || state === "countdown") && !dragging) beginDrag(e);
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragId) return;
    if (state !== "play" && state !== "countdown") return;
    target = tx0 + (e.clientX - sx) / u * SENS;
    targetY = ty0 + (e.clientY - sy) / u * SENS;
  });
  const endDrag = (e) => { if (e.pointerId === dragId) { dragging = false; dragId = null; } };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  // ---------- シェア ----------
  const pageUrl = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : "";

  function shareText() {
    return "Void Runner で " + finalScore + " 点!" + (newBest ? "(自己ベスト更新!)" : "") + "\n" +
      "ランク「" + rankOf(finalScore) + "」 / LV" + level + " / コイン" + coins + "枚 / 最大コンボ" + maxCombo + "\n#VoidRunner";
  }
  function openUrl(url) {
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText = "position:fixed;left:-999px;top:0;opacity:0;-webkit-user-select:text;user-select:text";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function downloadBlob(blob) {
    const a = document.createElement("a");
    const href = URL.createObjectURL(blob);
    a.href = href; a.download = "void-runner-score.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  }
  async function shareImage() {
    if (!cardBlob) { toast("画像を準備中…もう一度押してね"); return; }
    const file = new File([cardBlob], "void-runner-score.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: shareText() + (pageUrl ? "\n" + pageUrl : "") });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // 共有をキャンセルしたとき
      }
    }
    downloadBlob(cardBlob);
    toast("画像を保存しました");
  }

  // スコア画像(1200×630)を作る
  function drawCard() {
    const CW = 1200, CH = 630;
    const c = document.createElement("canvas");
    c.width = CW; c.height = CH;
    const g = c.getContext("2d");
    const FONT = "system-ui,-apple-system,'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif";
    const ls = (px) => { if ("letterSpacing" in g) g.letterSpacing = px + "px"; };

    const bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#05050f"); bg.addColorStop(1, "#12123a");
    g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
    [[260, 170, 420, "61,245,255"], [1020, 500, 460, "123,97,255"]].forEach((b) => {
      const rg = g.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
      rg.addColorStop(0, "rgba(" + b[3] + ",.22)"); rg.addColorStop(1, "rgba(" + b[3] + ",0)");
      g.fillStyle = rg; g.fillRect(0, 0, CW, CH);
    });
    // 星(スコアごとに配置が変わる)
    let seed = (finalScore * 9301 + 49297) % 233280;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    g.fillStyle = "#fff";
    for (let i = 0; i < 90; i++) { g.globalAlpha = 0.25 + rnd() * 0.6; const s = 1 + rnd() * 2.2; g.fillRect(rnd() * CW, rnd() * CH, s, s); }
    g.globalAlpha = 1;

    // 右側の飾り(ブロック・コイン・自機)
    const blk = (x, y, w, h) => {
      const t = g.createLinearGradient(0, y - 70, 0, y);
      t.addColorStop(0, "rgba(255,45,85,0)"); t.addColorStop(1, "rgba(255,45,85,.3)");
      g.fillStyle = t; g.fillRect(x + 8, y - 70, w - 16, 70);
      g.shadowColor = "#ff2d55"; g.shadowBlur = 24;
      const b = g.createLinearGradient(0, y, 0, y + h);
      b.addColorStop(0, "#ff5d7a"); b.addColorStop(1, "#d90f3a");
      g.fillStyle = b; rr(g, x, y, w, h, 10); g.fill();
      g.shadowBlur = 0;
    };
    [[860, 90, 110, 40], [1030, 190, 80, 36], [1100, 70, 70, 32], [900, 300, 120, 42], [1060, 380, 76, 34]].forEach((b) => blk(b[0], b[1], b[2], b[3]));
    [[1000, 130], [1130, 300], [900, 440]].forEach((p) => {
      g.shadowColor = "#ffd23f"; g.shadowBlur = 24;
      const cg = g.createRadialGradient(p[0] - 6, p[1] - 6, 2, p[0], p[1], 24);
      cg.addColorStop(0, "#fff6c2"); cg.addColorStop(0.6, "#ffd23f"); cg.addColorStop(1, "#d99a00");
      g.fillStyle = cg; g.beginPath(); g.arc(p[0], p[1], 24, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0; g.strokeStyle = "rgba(139,94,0,.7)"; g.lineWidth = 4;
      g.beginPath(); g.arc(p[0], p[1], 13, 0, Math.PI * 2); g.stroke();
    });
    g.shadowColor = "#3df5ff"; g.shadowBlur = 40;
    const pg = g.createLinearGradient(0, 470, 0, 560);
    pg.addColorStop(0, "#8ffaff"); pg.addColorStop(1, "#18c8e0");
    g.fillStyle = pg; rr(g, 1000, 470, 90, 90, 22); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#012a30"; g.fillRect(1022, 503, 13, 24); g.fillRect(1055, 503, 13, 24);

    // 文字
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = "900 46px " + FONT; ls(14);
    g.fillStyle = "#3df5ff"; g.shadowColor = "#3df5ff"; g.shadowBlur = 24;
    g.fillText("VOID RUNNER", 70, 110);
    g.shadowBlur = 0;

    g.font = "800 26px " + FONT; ls(8); g.fillStyle = "#9a9ab0";
    g.fillText("SCORE", 74, 225);

    ls(0);
    const sTxt = String(finalScore);
    let fs = 190;
    g.font = "900 " + fs + "px " + FONT;
    while (g.measureText(sTxt).width > 720 && fs > 80) { fs -= 10; g.font = "900 " + fs + "px " + FONT; }
    g.fillStyle = "#fff"; g.shadowColor = "rgba(61,245,255,.7)"; g.shadowBlur = 40;
    g.fillText(sTxt, 66, 385);
    g.shadowBlur = 0;

    // ランクと NEW RECORD
    const rk = rankOf(finalScore);
    g.font = "900 32px " + FONT; ls(6);
    const rw = g.measureText(rk).width + 64;
    const rg2 = g.createLinearGradient(70, 0, 70 + rw, 0);
    rg2.addColorStop(0, "#fff08a"); rg2.addColorStop(1, "#ffd23f");
    g.fillStyle = rg2; rr(g, 70, 418, rw, 58, 29); g.fill();
    g.fillStyle = "#2a1d00"; g.fillText(rk, 70 + 32, 459);
    if (newBest) {
      g.fillStyle = "#ffd23f"; g.font = "900 30px " + FONT; ls(4);
      g.fillText("★ NEW RECORD ★", 70 + rw + 30, 459);
    }

    // 成績
    ls(0);
    const items = [["生存", time.toFixed(1) + "秒"], ["コイン", String(coins)], ["最大コンボ", String(maxCombo)], ["LEVEL", String(level)]];
    let x = 70;
    items.forEach((it) => {
      g.font = "700 24px " + FONT; g.fillStyle = "#9a9ab0"; g.fillText(it[0], x, 524);
      g.font = "900 40px " + FONT; g.fillStyle = "#fff"; g.fillText(it[1], x, 568);
      x += Math.max(g.measureText(it[1]).width, 24 * (it[0].length + 1)) + 56;
    });

    // フッター
    g.font = "700 22px " + FONT; g.fillStyle = "#6d6d88";
    let foot = "#VoidRunner";
    if (pageUrl) foot += "   " + pageUrl.replace(/^https?:\/\//, "");
    g.fillText(foot, 70, 612);
    return c;
  }

  // ---------- ボタン ----------
  el.btnStart.addEventListener("click", () => { startGame(); });
  el.btnRetry.addEventListener("click", () => { if (overShown) startGame(); });
  el.btnTitle.addEventListener("click", () => { sfx.click(); toTitle(); });
  el.btnQuit.addEventListener("click", () => { sfx.click(); toTitle(); });
  el.btnResume.addEventListener("click", resume);
  el.btnPause.addEventListener("click", pause);
  el.btnSound.addEventListener("click", () => {
    ensureAudio(); muted = !muted; store.set("muted", muted ? 1 : 0); refreshSoundBtn(); sfx.click();
  });
  el.btnLite.addEventListener("click", (e) => {
    e.currentTarget.blur(); ensureAudio();
    if (lite || liteAuto) { lite = false; liteAuto = false; } else lite = true;
    store.set("lite", lite ? 1 : 0);
    resize(); refreshLiteBtn(); sfx.click();
    toast(isLite() ? "軽量モード ON(エフェクトを減らします)" : "軽量モード OFF");
  });

  el.btnX.addEventListener("click", (e) => {
    e.currentTarget.blur(); sfx.click();
    openUrl("https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText()) +
      (pageUrl ? "&url=" + encodeURIComponent(pageUrl) : ""));
  });
  el.btnLine.addEventListener("click", (e) => {
    e.currentTarget.blur(); sfx.click();
    openUrl("https://line.me/R/share?text=" + encodeURIComponent(shareText() + (pageUrl ? "\n" + pageUrl : "")));
  });
  el.btnImg.addEventListener("click", (e) => { e.currentTarget.blur(); sfx.click(); shareImage(); });
  el.btnCopy.addEventListener("click", async (e) => {
    e.currentTarget.blur(); sfx.click();
    const ok = await copyText(shareText() + (pageUrl ? "\n" + pageUrl : ""));
    toast(ok ? "コピーしました" : "コピーできませんでした");
  });

  // 画像を直接共有できる端末(主にスマホ)ではボタンの文言を変える
  (function () {
    let can = false;
    try { can = !!(navigator.canShare && navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] })); } catch (e) {}
    el.btnImg.textContent = can ? "画像共有" : "画像保存";
  })();

  // ルール・操作説明を、タイトルとポーズ画面に差し込む
  const tpl = $("#tpl-howto");
  ["#slot-title", "#slot-pause"].forEach((sel) => {
    const slot = $(sel);
    slot.appendChild(tpl.content.cloneNode(true));
    // 使っている端末側のカードを光らせる
    const card = slot.querySelector(coarse ? ".ctrl-mobile" : ".ctrl-pc");
    if (card) card.classList.add("active");
  });
  refreshBest();
  refreshSoundBtn();
  refreshLiteBtn();

  // ---------- 更新 ----------
  function smoothPlayer(dt) {
    const ox = player.x;
    player.x += (target - player.x) * Math.min(1, dt * 20);
    player.y += (targetY - player.y) * Math.min(1, dt * 20);
    player.vx = (player.x - ox) / Math.max(dt, 0.001);
    player.tilt += (clamp(player.vx / 700, -1, 1) * 0.4 - player.tilt) * Math.min(1, dt * 12);
    if (player.spawn < 1) player.spawn = Math.min(1, player.spawn + dt * 2.2);
  }

  function movePlayer(dt) {
    const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      target += dx / len * 340 * dt;
      targetY += dy / len * 340 * dt;
    }
    target = clamp(target, player.w / 2, W - player.w / 2);
    targetY = clamp(targetY, PLAYER_MIN_Y, H - player.h / 2 - 6);
    smoothPlayer(dt);
  }

  function updateFx(dt) {
    const d95 = Math.pow(0.95, dt * 60), d96 = Math.pow(0.96, dt * 60);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { const l = parts.pop(); if (i < parts.length) parts[i] = l; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const d = p.drag > 0.955 ? d96 : d95;
      p.vx *= d; p.vy *= d;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].life += dt;
      if (rings[i].life >= rings[i].max) rings.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life += dt; t.y -= 38 * dt;
      if (t.life >= t.max) texts.splice(i, 1);
    }
  }

  function update(dt) {
    clock += dt;
    const speedMul = state === "play" ? 1 + time / 30 : 1;
    for (let li = 0; li < LAYERS.length; li++) {
      const arr = starL[li], v = LAYERS[li].v * dt * speedMul;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        s.y += v;
        if (s.y > H + 10) { s.y = -10; s.x = rand(0, W); }
      }
    }
    bgHue += (bgHueTarget - bgHue) * Math.min(1, dt * 1.5);
    shake = Math.max(0, shake - dt * 40);
    updateFx(dt);

    if (state === "title") demo(dt);
    else if (state === "countdown") countdown(dt);
    else if (state === "play") play(dt);
    else if (state === "over") overUpdate(dt);
  }

  // タイトル画面の背景デモ(ただ落ちてくるだけ・当たり判定なし)
  function demo(dt) {
    demoT -= dt;
    if (demoT <= 0) {
      demoT = rand(0.45, 0.95);
      if (Math.random() < 0.25) objs.push({ type: "coin", x: rand(20, W - 20), y: -20, r: 11, vy: rand(70, 120), phase: rand(0, 6) });
      else { const w = rand(30, 90); objs.push(newBlock(rand(0, W - w), -40, w, rand(22, 34), rand(80, 150))); }
    }
    for (let i = objs.length - 1; i >= 0; i--) { objs[i].y += objs[i].vy * dt; if (objs[i].y > H + 60) objs.splice(i, 1); }
    target = W / 2 + Math.sin(clock * 1.1) * 100;
    targetY = H - 90;
    smoothPlayer(dt);
    thrust(dt);
  }

  function countdown(dt) {
    movePlayer(dt);
    thrust(dt);
    cdT += dt;
    const idx = Math.min(3, Math.floor(cdT / 0.6));
    if (idx !== cdIdx) {
      cdIdx = idx;
      const go = idx === 3;
      el.countdown.textContent = go ? "GO!" : String(3 - idx);
      el.countdown.classList.toggle("go", go);
      restartAnim(el.countdown, "tick");
      if (go) { sfx.go(); state = "play"; } else sfx.tick();
    }
  }

  function play(dt) {
    time += dt;
    score += dt * 10;
    if (invuln > 0) invuln = Math.max(0, invuln - dt);

    const lv = 1 + Math.floor(time / LEVEL_TIME);
    if (lv !== level) { level = lv; levelUp(); }
    const lp = Math.round((time % LEVEL_TIME) / LEVEL_TIME * 200);
    if (lp !== lvP) { lvP = lp; el.lvfill.style.transform = "scaleX(" + (lp / 200) + ")"; }
    const s = Math.floor(score);
    if (s !== shownScore) { shownScore = s; el.score.textContent = s; }

    movePlayer(dt);
    thrust(dt);

    // 出現(ブロックは出る少し前に上端で警告を出す)
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = Math.max(0.22, 0.75 - time * 0.009) * rand(0.7, 1.3);
      const speed = Math.min(150 + time * 6 + rand(0, 60), 560);
      if (!shield && time > SHIELD_FROM && Math.random() < SHIELD_RATE && !objs.some((o) => o.type === "shield")) {
        objs.push({ type: "shield", x: rand(20, W - 20), y: -20, r: 12, vy: speed * 0.8, phase: rand(0, 6) });
      } else if (Math.random() < 0.2) {
        objs.push({ type: "coin", x: rand(20, W - 20), y: -20, r: 11, vy: speed * 0.8, phase: rand(0, 6) });
      } else {
        const w = rand(30, 100);
        warns.push({ t: 0.45, max: 0.45, o: newBlock(rand(0, W - w), -40, w, rand(22, 36), speed) });
      }
    }
    for (let i = warns.length - 1; i >= 0; i--) {
      warns[i].t -= dt;
      if (warns[i].t <= 0) { objs.push(warns[i].o); warns.splice(i, 1); }
    }

    // 移動と当たり判定
    const px = player.x - player.w / 2, py = player.y - player.h / 2;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      o.y += o.vy * dt;
      if (o.y > H + 60) { objs.splice(i, 1); continue; }
      if (o.type === "block") {
        if (invuln > 0) continue;
        const m = 3; // 少し甘めの判定
        if (px + m < o.x + o.w && px + player.w - m > o.x && py + m < o.y + o.h && py + player.h - m > o.y) {
          if (shield) { breakShield(o); objs.splice(i, 1); continue; }
          gameOver(); return;
        }
      } else {
        const cx = clamp(o.x, px, px + player.w), cy = clamp(o.y, py, py + player.h);
        if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (o.r + 2) ** 2) {
          if (o.type === "coin") onCoin(o); else onShield(o);
          objs.splice(i, 1);
        }
      }
    }

    // コンボの残り時間
    if (combo > 0) {
      comboT -= dt;
      const cb = Math.round(Math.max(0, comboT / COMBO_TIME) * 60);
      if (cb !== cbP) { cbP = cb; el.comboBar.firstElementChild.style.transform = "scaleX(" + (cb / 60) + ")"; }
      if (comboT <= 0) { combo = 0; updateComboUI(); }
    }
  }

  function overUpdate(dt) {
    for (let i = objs.length - 1; i >= 0; i--) { objs[i].y += objs[i].vy * dt; if (objs[i].y > H + 60) objs.splice(i, 1); }
    if (!overShown && performance.now() - overAt > 800) showOver();
    if (overShown && overCountT < 1) {
      overCountT = Math.min(1, overCountT + dt / 0.9);
      el.overScore.textContent = Math.floor(finalScore * easeOutCubic(overCountT));
    }
  }

  // ---------- 描画 ----------
  function drawStars() {
    const streak = state === "play" && !isLite();
    const speedMul = state === "play" ? 1 + time / 30 : 1;
    ctx.fillStyle = "#fff";
    for (let li = 0; li < LAYERS.length; li++) {
      const l = LAYERS[li], arr = starL[li];
      ctx.globalAlpha = l.a;
      if (li === 2 && streak) {
        const hh = 2 + speedMul * 5;
        for (let i = 0; i < arr.length; i++) ctx.fillRect(arr[i].x, arr[i].y, l.s, hh);
      } else {
        for (let i = 0; i < arr.length; i++) ctx.fillRect(arr[i].x, arr[i].y, l.s, l.s);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWarns() {
    for (const w of warns) {
      const p = 1 - w.t / w.max;
      const a = 0.35 + 0.45 * Math.abs(Math.sin(p * Math.PI * 4));
      ctx.globalAlpha = a;
      ctx.fillStyle = warnGrad;
      ctx.fillRect(w.o.x, 0, w.o.w, 110);
      ctx.fillStyle = "#ff2d55";
      ctx.fillRect(w.o.x, 0, w.o.w, 6);
      ctx.fillStyle = "#fff";
      ctx.font = "800 18px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", w.o.x + w.o.w / 2, 28);
    }
    ctx.globalAlpha = 1;
  }

  function drawObjs() {
    for (const o of objs) {
      if (o.type === "block") {
        ctx.drawImage(o.spr, o.x - BPAD, o.y - o.len - BPAD, o.sw, o.sh);
      } else if (o.type === "coin") {
        const sxs = Math.max(0.15, Math.abs(Math.cos(clock * 5 + o.phase)));
        ctx.drawImage(coinSpr, o.x - COIN_S / 2 * sxs, o.y - COIN_S / 2, COIN_S * sxs, COIN_S);
        // きらっと光る
        if (Math.sin(clock * 7 + o.phase * 3) > 0.85) {
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
          const sx2 = o.x + o.r * 0.7, sy2 = o.y - o.r * 0.7;
          ctx.beginPath();
          ctx.moveTo(sx2 - 5, sy2); ctx.lineTo(sx2 + 5, sy2);
          ctx.moveTo(sx2, sy2 - 5); ctx.lineTo(sx2, sy2 + 5);
          ctx.stroke();
        }
      } else {
        const pu = 1 + 0.08 * Math.sin(clock * 6 + o.phase);
        ctx.drawImage(shieldSpr, o.x - COIN_S / 2 * pu, o.y - COIN_S / 2 * pu, COIN_S * pu, COIN_S * pu);
      }
    }
  }

  function drawParticles() {
    if (!parts.length && !rings.length) return;
    ctx.globalCompositeOperation = isLite() ? "source-over" : "lighter";
    for (const p of parts) {
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = k > 0 ? k : 0;
      ctx.fillStyle = p.color;
      const sz = p.size * (0.4 + 0.6 * k);
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    for (const r of rings) {
      const t = r.life / r.max;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath(); ctx.arc(r.x, r.y, r.maxR * easeOutCubic(t), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawPlayer() {
    const k = player.spawn < 1 ? easeOutBack(player.spawn) : 1;
    const stretch = Math.min(Math.abs(player.vx) / 2500, 0.15);
    const py = player.y + (state === "title" ? Math.sin(clock * 3) * 2 : 0);
    ctx.save();
    if (invuln > 0 && Math.floor(clock * 14) % 2) ctx.globalAlpha = 0.35; // 無敵中は点滅
    ctx.translate(player.x, py);
    ctx.rotate(player.tilt);
    ctx.scale(Math.max(0.001, k * (1 - stretch)), Math.max(0.001, k * (1 + stretch)));
    ctx.drawImage(playerSpr, -PL_S / 2, -PL_S / 2, PL_S, PL_S);
    const look = clamp(player.vx / 400, -1, 1) * 2;
    const blink = (clock % 3.2) < 0.12 ? 0.15 : 1;
    ctx.fillStyle = "#012a30";
    ctx.fillRect(-8 + look, -3.5 * blink, 4, 7 * blink);
    ctx.fillRect(4 + look, -3.5 * blink, 4, 7 * blink);
    ctx.restore();
    if (shield) {
      ctx.fillStyle = "rgba(61,245,255,.1)";
      ctx.strokeStyle = "rgba(61,245,255," + (0.6 + 0.25 * Math.sin(clock * 8)) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(player.x, py, 25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawTexts() {
    for (const t of texts) {
      const p = t.life / t.max;
      const s = easeOutBack(Math.min(1, t.life / 0.18));
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, p - 0.55) / 0.45);
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      ctx.font = "900 " + t.size + "px system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.strokeText(t.str, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, 0, 0);
      ctx.restore();
    }
  }

  function draw() {
    const k = Math.round(bgHue * 2) + (isLite() ? 100000 : 0);
    if (k !== bgKey) { bgKey = k; renderBg(); }
    const s = cv.width / W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgc, 0, 0);                         // 背景はキャッシュを貼るだけ
    const ox = shake > 0 ? rand(-shake, shake) : 0, oy = shake > 0 ? rand(-shake, shake) : 0;
    ctx.setTransform(s, 0, 0, s, ox * s, oy * s);

    drawStars();
    drawWarns();
    drawObjs();
    if (state !== "over") drawPlayer();
    drawParticles();
    drawTexts();
  }

  // ---------- メインループ ----------
  let last = performance.now();
  function frame(now) {
    const raw = Math.min(100, now - last);
    last = now;
    const dt = Math.min(0.05, raw / 1000);

    // 動作が重い端末では、自動で軽量モードに切り替える(最初の数秒だけ計測)
    if (!autoChecked && state === "play" && time > 0.6) {
      fpsAcc += raw; fpsN++;
      if (time > 3.6 && fpsN > 20) {
        autoChecked = true;
        if (!lite && fpsAcc / fpsN > 25) {
          liteAuto = true; resize(); refreshLiteBtn();
          toast("軽量モードに切り替えました");
        }
      }
    }

    if (state === "paused") {
      if (dirty) { draw(); dirty = false; }           // ポーズ中は描き直さない(省電力)
    } else {
      update(dt);
      draw();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
