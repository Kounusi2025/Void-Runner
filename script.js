/* ==========================================================
   Void Runner - script.js
   ・ゲーム画面は 360×640 の「論理サイズ」で計算し、画面に合わせて拡大縮小
   ・PC:矢印キー / WASD   スマホ:画面のどこでも指をスライド
   ========================================================== */
(() => {
  "use strict";

  const W = 360, H = 640;
  const LEVEL_TIME = 15;      // 何秒ごとにレベルアップするか
  const COMBO_TIME = 2.2;     // コンボが続く秒数
  const SENS = 1.2;           // ドラッグ操作の感度(大きいほど少しの動きで大きく動く)
  const PLAYER_MIN_Y = 118;   // 自機が動ける上限(HUDにかぶらない位置)

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage"), cv = $("#game"), ctx = cv.getContext("2d");
  const reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);

  const el = {
    hud: $("#hud"), hudBtns: $("#hud-buttons"), lvbar: $("#levelbar"), lvfill: $("#levelbar-fill"),
    score: $("#hud-score"), best: $("#hud-best"), level: $("#hud-level"), coins: $("#hud-coins"),
    combo: $("#combo"), comboPill: $("#combo-pill"), comboText: $("#combo-text"), comboBar: $("#combo-bar"),
    btnPause: $("#btn-pause"), btnSound: $("#btn-sound"),
    title: $("#screen-title"), pause: $("#screen-pause"), over: $("#screen-over"),
    titleBest: $("#title-best"), overScore: $("#over-score"), overBest: $("#over-best"), newRecord: $("#newrecord"),
    stTime: $("#st-time"), stCoins: $("#st-coins"), stCombo: $("#st-combo"), stLevel: $("#st-level"),
    countdown: $("#countdown"), hint: $("#start-hint"),
    banner: $("#banner"), bannerMain: $("#banner-main"), bannerSub: $("#banner-sub"), flash: $("#flash"),
    btnStart: $("#btn-start"), btnResume: $("#btn-resume"), btnQuit: $("#btn-quit"),
    btnRetry: $("#btn-retry"), btnTitle: $("#btn-title")
  };

  // ---------- 小さな道具 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  function restartAnim(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- 画面サイズ ----------
  let u = 1, dpr = 1;
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const sw = Math.max(1, Math.floor(Math.min(vw, vh * W / H)));
    const sh = Math.floor(sw * H / W);
    stage.style.width = sw + "px";
    stage.style.height = sh + "px";
    u = sw / W;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(sw * dpr);
    cv.height = Math.round(sh * dpr);
    document.documentElement.style.fontSize = (u * 10) + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- 保存(ハイスコア・ミュート) ----------
  let best = 0, muted = false;
  try {
    best = parseInt(localStorage.getItem("voidrunner.best") || "0", 10) || 0;
    muted = localStorage.getItem("voidrunner.muted") === "1";
  } catch (e) {}
  const saveBest = () => { try { localStorage.setItem("voidrunner.best", String(best)); } catch (e) {} };
  const saveMuted = () => { try { localStorage.setItem("voidrunner.muted", muted ? "1" : "0"); } catch (e) {} };

  // ---------- 効果音(WebAudio) ----------
  let actx = null;
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
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = actx.createBufferSource(), g = actx.createGain();
    s.buffer = buf; g.gain.value = vol;
    s.connect(g); g.connect(actx.destination);
    s.start();
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
    click: () => beep(600, 0.05, "square", 0.04),
    pause: () => beep(330, 0.08, "triangle", 0.07)
  };

  // ---------- ゲームの状態 ----------
  // title | countdown | play | paused | over
  let state = "title", prevState = "play";
  let player, objs, warns, parts, rings, texts;
  let time, score, coins, level, spawnT, combo, comboT, maxCombo, newBest, finalScore;
  let target, targetY, shake, clock = 0, shownScore = -1;
  let cdT = 0, cdIdx = -1, overAt = 0, overShown = false, overCountT = 1;
  let demoT = 0, thrustT = 0, bgHue = 240, bgHueTarget = 240;
  const keys = { left: false, right: false, up: false, down: false };

  // 背景の星(3層の視差)
  const LAYERS = [
    { n: 30, v: 14, s: 0.9, a: 0.35 },
    { n: 22, v: 34, s: 1.4, a: 0.55 },
    { n: 12, v: 70, s: 2.0, a: 0.85 }
  ];
  const stars = [];
  LAYERS.forEach((l, i) => { for (let k = 0; k < l.n; k++) stars.push({ x: rand(0, W), y: rand(0, H), l: i }); });

  function resetWorld() {
    player = { x: W / 2, y: H - 90, w: 28, h: 28, vx: 0, tilt: 0, spawn: 1 };
    target = W / 2; targetY = H - 90;
    objs = []; warns = []; parts = []; rings = []; texts = [];
    time = 0; score = 0; coins = 0; level = 1; spawnT = 0.5;
    combo = 0; comboT = 0; maxCombo = 0; newBest = false; finalScore = 0;
    shake = 0; shownScore = -1;
    bgHueTarget = 240;
  }
  resetWorld();

  // ---------- 画面の表示切り替え ----------
  const showScreen = (s) => s.classList.add("show");
  const hideScreen = (s) => s.classList.remove("show");
  function setHud(on) { [el.hud, el.hudBtns, el.lvbar].forEach((n) => n.classList.toggle("hidden", !on)); }
  function refreshBest() { el.titleBest.textContent = best; el.best.textContent = best; }
  function refreshSoundBtn() { el.btnSound.classList.toggle("off", muted); }

  // ---------- 演出の部品 ----------
  function burst(x, y, color, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, speed);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.4, 0.9), color, size: rand(size * 0.6, size * 1.4), drag: 0.95, shrink: true });
    }
    if (parts.length > 700) parts.splice(0, parts.length - 700);
  }
  function ring(x, y, color, maxR, dur, width) { rings.push({ x, y, color, maxR, life: 0, max: dur, width }); }
  function floatText(str, x, y, color, size) { texts.push({ str, x, y, color, size, life: 0, max: 0.9 }); }
  function flash(color, alpha) {
    if (reduceMotion) return;
    el.flash.style.background = color;
    el.flash.style.setProperty("--fa", alpha);
    restartAnim(el.flash, "on");
  }
  function thrust(dt) {
    thrustT -= dt;
    while (thrustT <= 0) {
      thrustT += 0.02;
      parts.push({
        x: player.x + rand(-6, 6), y: player.y + player.h / 2 - 2,
        vx: rand(-15, 15), vy: rand(80, 170), life: 0, max: rand(0.2, 0.42),
        color: Math.random() < 0.5 ? "#3df5ff" : "#7b61ff", size: rand(2, 4.2), drag: 0.96, shrink: true
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
    el.best.textContent = best; el.lvfill.style.width = "0%";
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
    if (finalScore > best) { best = finalScore; newBest = true; saveBest(); }
    warns.length = 0; combo = 0;
    el.combo.classList.remove("on");
    sfx.hit();
    burst(player.x, player.y, "#3df5ff", 40, 320, 4);
    burst(player.x, player.y, "#ffffff", 24, 260, 3);
    burst(player.x, player.y, "#ff2d55", 20, 200, 4);
    ring(player.x, player.y, "#ff2d55", 150, 0.7, 5);
    ring(player.x, player.y, "#ffffff", 90, 0.5, 3);
    shake = reduceMotion ? 0 : 16;
    flash("#ff2d55", 0.5);
  }

  function showOver() {
    overShown = true;
    setHud(false);
    el.overBest.textContent = best;
    el.stTime.textContent = time.toFixed(1) + "秒";
    el.stCoins.textContent = coins;
    el.stCombo.textContent = maxCombo;
    el.stLevel.textContent = level;
    el.newRecord.classList.toggle("show", newBest);
    el.overScore.textContent = "0";
    overCountT = 0;
    showScreen(el.over);
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
      if (state === "title") startGame();
      else if (state === "over" && overShown) startGame();
      else if (state === "paused") resume();
    } else if (k === "p" || k === "P" || k === "Escape") {
      if (e.repeat) return;
      if (state === "paused") resume(); else pause();
    } else if (k === "m" || k === "M") {
      if (e.repeat) return;
      muted = !muted; saveMuted(); refreshSoundBtn();
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

  // ---------- ボタン ----------
  el.btnStart.addEventListener("click", () => { startGame(); });
  el.btnRetry.addEventListener("click", () => { if (overShown) startGame(); });
  el.btnTitle.addEventListener("click", () => { sfx.click(); toTitle(); });
  el.btnQuit.addEventListener("click", () => { sfx.click(); toTitle(); });
  el.btnResume.addEventListener("click", resume);
  el.btnPause.addEventListener("click", pause);
  el.btnSound.addEventListener("click", () => {
    ensureAudio(); muted = !muted; saveMuted(); refreshSoundBtn(); sfx.click();
  });

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
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const d = Math.pow(p.drag, dt * 60);
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
    if (state === "paused") return;
    clock += dt;
    const speedMul = state === "play" ? 1 + time / 30 : 1;
    for (const s of stars) {
      s.y += LAYERS[s.l].v * dt * speedMul;
      if (s.y > H + 10) { s.y = -10; s.x = rand(0, W); }
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
      else { const w = rand(30, 90); objs.push({ type: "block", x: rand(0, W - w), y: -40, w, h: rand(22, 34), vy: rand(80, 150) }); }
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

    const lv = 1 + Math.floor(time / LEVEL_TIME);
    if (lv !== level) { level = lv; levelUp(); }
    el.lvfill.style.width = ((time % LEVEL_TIME) / LEVEL_TIME * 100) + "%";
    const s = Math.floor(score);
    if (s !== shownScore) { shownScore = s; el.score.textContent = s; }

    movePlayer(dt);
    thrust(dt);

    // 出現(ブロックは出る少し前に上端で警告を出す)
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = Math.max(0.22, 0.75 - time * 0.009) * rand(0.7, 1.3);
      const speed = Math.min(150 + time * 6 + rand(0, 60), 560);
      if (Math.random() < 0.2) {
        objs.push({ type: "coin", x: rand(20, W - 20), y: -20, r: 11, vy: speed * 0.8, phase: rand(0, 6) });
      } else {
        const w = rand(30, 100);
        warns.push({ t: 0.45, max: 0.45, o: { type: "block", x: rand(0, W - w), y: -40, w, h: rand(22, 36), vy: speed } });
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
        const m = 3; // 少し甘めの判定
        if (px + m < o.x + o.w && px + player.w - m > o.x && py + m < o.y + o.h && py + player.h - m > o.y) {
          gameOver(); return;
        }
      } else {
        const cx = clamp(o.x, px, px + player.w), cy = clamp(o.y, py, py + player.h);
        if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (o.r + 2) ** 2) { onCoin(o); objs.splice(i, 1); }
      }
    }

    // コンボの残り時間
    if (combo > 0) {
      comboT -= dt;
      el.comboBar.firstElementChild.style.transform = "scaleX(" + Math.max(0, comboT / COMBO_TIME) + ")";
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
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "hsl(" + bgHue + ",55%,5%)");
    g.addColorStop(1, "hsl(" + (bgHue + 20) + ",50%,10%)");
    ctx.fillStyle = g;
    ctx.fillRect(-30, -30, W + 60, H + 60);

    // ゆっくり動くぼんやりした光
    const blobs = [
      { x: W * 0.3 + Math.sin(clock * 0.2) * 60, y: H * 0.3 + Math.cos(clock * 0.17) * 50, r: 220, h: bgHue + 30 },
      { x: W * 0.75 + Math.cos(clock * 0.15) * 50, y: H * 0.7 + Math.sin(clock * 0.22) * 60, r: 240, h: bgHue - 40 }
    ];
    for (const b of blobs) {
      const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      rg.addColorStop(0, "hsla(" + b.h + ",80%,50%,.14)");
      rg.addColorStop(1, "hsla(" + b.h + ",80%,50%,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    const speedMul = state === "play" ? 1 + time / 30 : 1;
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      const l = LAYERS[s.l];
      ctx.globalAlpha = l.a;
      if (s.l === 2 && state === "play") ctx.fillRect(s.x, s.y, l.s, 2 + speedMul * 5);
      else ctx.fillRect(s.x, s.y, l.s, l.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawWarns() {
    for (const w of warns) {
      const p = 1 - w.t / w.max;
      const a = 0.35 + 0.45 * Math.abs(Math.sin(p * Math.PI * 4));
      const lg = ctx.createLinearGradient(0, 0, 0, 110);
      lg.addColorStop(0, "rgba(255,45,85," + (a * 0.45) + ")");
      lg.addColorStop(1, "rgba(255,45,85,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(w.o.x, 0, w.o.w, 110);
      ctx.fillStyle = "rgba(255,45,85," + a + ")";
      ctx.fillRect(w.o.x, 0, w.o.w, 6);
      ctx.fillStyle = "rgba(255,255,255," + a + ")";
      ctx.font = "800 18px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", w.o.x + w.o.w / 2, 28);
    }
  }

  function drawObjs() {
    for (const o of objs) {
      if (o.type === "block") {
        const len = Math.min(o.vy * 0.09, 50);
        const sg = ctx.createLinearGradient(0, o.y - len, 0, o.y);
        sg.addColorStop(0, "rgba(255,45,85,0)");
        sg.addColorStop(1, "rgba(255,45,85,.35)");
        ctx.fillStyle = sg;
        ctx.fillRect(o.x + 4, o.y - len, o.w - 8, len);

        ctx.shadowColor = "#ff2d55";
        ctx.shadowBlur = 10 + 4 * Math.sin(clock * 8 + o.x);
        const bg = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
        bg.addColorStop(0, "#ff5d7a"); bg.addColorStop(1, "#d90f3a");
        ctx.fillStyle = bg;
        rr(o.x, o.y, o.w, o.h, 5); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,.28)";
        rr(o.x + 3, o.y + 3, o.w - 6, 3, 2); ctx.fill();
      } else {
        const sxs = Math.max(0.15, Math.abs(Math.cos(clock * 5 + o.phase)));
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.scale(sxs, 1);
        ctx.shadowColor = "#ffd23f";
        ctx.shadowBlur = 14 + 4 * Math.sin(clock * 6 + o.phase);
        const cg = ctx.createRadialGradient(-3, -3, 1, 0, 0, o.r);
        cg.addColorStop(0, "#fff6c2"); cg.addColorStop(0.6, "#ffd23f"); cg.addColorStop(1, "#d99a00");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(139,94,0,.7)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, o.r * 0.55, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        // きらっと光る
        if (Math.sin(clock * 7 + o.phase * 3) > 0.85) {
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
          const sx2 = o.x + o.r * 0.7, sy2 = o.y - o.r * 0.7;
          ctx.beginPath();
          ctx.moveTo(sx2 - 5, sy2); ctx.lineTo(sx2 + 5, sy2);
          ctx.moveTo(sx2, sy2 - 5); ctx.lineTo(sx2, sy2 + 5);
          ctx.stroke();
        }
      }
    }
  }

  function drawParticles() {
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = p.color;
      const sz = p.shrink ? p.size * (0.4 + 0.6 * k) : p.size;
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
    ctx.save();
    ctx.translate(player.x, player.y + (state === "title" ? Math.sin(clock * 3) * 2 : 0));
    ctx.rotate(player.tilt);
    ctx.scale(Math.max(0.001, k * (1 - stretch)), Math.max(0.001, k * (1 + stretch)));
    ctx.shadowColor = "#3df5ff"; ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(0, -14, 0, 14);
    g.addColorStop(0, "#8ffaff"); g.addColorStop(1, "#18c8e0");
    ctx.fillStyle = g;
    rr(-14, -14, 28, 28, 7); ctx.fill();
    ctx.shadowBlur = 0;
    const look = clamp(player.vx / 400, -1, 1) * 2;
    const blink = (clock % 3.2) < 0.12 ? 0.15 : 1;
    ctx.fillStyle = "#012a30";
    ctx.fillRect(-8 + look, -3.5 * blink, 4, 7 * blink);
    ctx.fillRect(4 + look, -3.5 * blink, 4, 7 * blink);
    ctx.restore();
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
    const s = cv.width / W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cv.width, cv.height);
    const ox = shake > 0 ? rand(-shake, shake) : 0, oy = shake > 0 ? rand(-shake, shake) : 0;
    ctx.setTransform(s, 0, 0, s, ox * s, oy * s);

    drawBackground();
    drawWarns();
    drawObjs();
    if (state !== "over") drawPlayer();
    drawParticles();
    drawTexts();
  }

  // ---------- メインループ ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
