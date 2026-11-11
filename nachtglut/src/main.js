// Bootstrap: loads the optional modules (art, generator, meta, audio, UI) with graceful fallbacks, creates
// Fx / Input / Game / Renderer and runs the main loop (fixed 1/60 s simulation, rendering every frame).
// URL flags for testing: ?autostart=1 ?seed=abc ?god=1 ?floor=3 ?char=bearer ?diff=0 ?autopause=0 ?fps=1
import { bus } from './core/events.js';
import { input } from './core/input.js';
import { Fx } from './render/fx.js';
import { Renderer } from './render/renderer.js';
import { createFallbackUI } from './render/fallbackui.js';

const STEP = 1 / 60;
const MAX_STEPS = 5;

const errCounts = Object.create(null);
function logErr(where, err) {
  const n = (errCounts[where] = (errCounts[where] || 0) + 1);
  if (n <= 3 || n % 600 === 0) console.error(`[main] ${where} failed (${n}×)`, err);
}

/** Optional module: resolves to the module namespace or null (with a console.warn). */
async function optional(label, loader) {
  try {
    return await loader();
  } catch (err) {
    console.warn(`[boot] optional module "${label}" unavailable – using fallback.`, err && err.message ? err.message : err);
    return null;
  }
}

function params() {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(''); }
}

function showFatal(msg) {
  const ui = document.getElementById('ui') || document.body;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);max-width:90vw;padding:14px 18px;border-radius:8px;'
    + 'background:rgba(20,8,8,.92);border:1px solid #803030;color:#ffd0c0;font:15px system-ui,sans-serif;text-align:center;pointer-events:auto;';
  d.textContent = msg;
  ui.appendChild(d);
}

function lsGet(key) { try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch { return null; } }
function lsSet(key, v) { try { if (window.localStorage) window.localStorage.setItem(key, v); } catch { /* ignore */ } }

async function boot() {
  const q = params();
  const canvas = document.getElementById('game');
  const overlay = document.getElementById('overlay');
  const uiRoot = document.getElementById('ui');
  if (!canvas) { console.error('[boot] #game canvas missing'); return; }

  let game = null;
  let ui = null;
  const fx = new Fx(() => (game ? game.settings : null));
  input.init(canvas);
  const renderer = new Renderer(canvas, overlay, null, fx);
  renderer.resize();
  const app = { game: null, bus, input, renderer, fx, ui: null, modules: {} };
  window.__nachtglut = app;

  // ------------------------------------------------------------------ main loop (starts right away: menu backdrop)
  let last = performance.now();
  let acc = 0;
  let resizePending = false;
  let fpsAcc = 0, fpsN = 0;
  app.fps = 0;
  const god = q.get('god') === '1';
  const frame = (now) => {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) { app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (resizePending) { resizePending = false; try { renderer.resize(); } catch (err) { logErr('resize', err); } }
    try { input.poll(); } catch (err) { logErr('input', err); }
    if (game) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        try { game.update(STEP); } catch (err) { logErr('game.update', err); }
        acc -= STEP;
        steps++;
      }
      if (acc > STEP * MAX_STEPS) acc = 0; // too slow: drop time instead of spiralling
      if (god && game.run && !(game.run.revives >= 999)) game.run.revives = 999;
    }
    const frozen = game && (game.state === 'paused' || game.state === 'choice');
    if (!frozen) { try { fx.update(dt); } catch (err) { logErr('fx.update', err); } }
    try { renderer.draw(frozen ? 0 : dt); } catch (err) { logErr('renderer.draw', err); }
    if (ui && ui.update) { try { ui.update(dt); } catch (err) { logErr('ui.update', err); } }
  };
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------ resize / dpr / orientation
  const requestResize = () => { resizePending = true; };
  window.addEventListener('resize', requestResize);
  window.addEventListener('orientationchange', requestResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', requestResize);
  const watchDpr = () => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const on = () => { requestResize(); watchDpr(); };
    if (mq.addEventListener) mq.addEventListener('change', on, { once: true });
  };
  watchDpr();

  // ------------------------------------------------------------------ modules
  const [gameMod, registry, spritesMod, tilesMod, genMod, saveMod, progMod, trackerMod, achMod, audioMod, uiMod] = await Promise.all([
    optional('game', () => import('./game/game.js')),
    optional('registry', () => import('./game/registry.js')),
    optional('sprites', () => import('./render/sprites.js')),
    optional('tiles', () => import('./render/tiles.js')),
    optional('floorgen', () => import('./gen/floorgen.js')),
    optional('save', () => import('./meta/save.js')),
    optional('progression', () => import('./meta/progression.js')),
    optional('tracker', () => import('./meta/tracker.js')),
    optional('achievements', () => import('./meta/achievements.js')),
    optional('audio', () => import('./audio/audio.js')),
    optional('ui', () => import('./ui/ui.js')),
  ]);
  app.modules = { gameMod, registry, spritesMod, tilesMod, genMod, saveMod, progMod, trackerMod, achMod, audioMod, uiMod };

  // art
  const sprites = spritesMod && (spritesMod.sprites || spritesMod.default);
  if (sprites) { try { sprites.init(); } catch (err) { console.warn('[boot] sprites.init failed', err); } }
  renderer.setArt({
    sprites,
    renderRoomStatic: tilesMod && tilesMod.renderRoomStatic,
    drawRoomDynamic: tilesMod && tilesMod.drawRoomDynamic,
    roomLights: tilesMod && tilesMod.roomLights,
  });

  if (!gameMod || !gameMod.Game) {
    showFatal('Nachtglut konnte nicht geladen werden (Spielkern fehlt).');
    return;
  }

  // save + meta
  let save;
  if (saveMod && saveMod.loadSave) { try { save = saveMod.loadSave(); } catch (err) { console.warn('[boot] loadSave failed', err); } }
  const meta = {};
  if (progMod) {
    for (const k of ['DIFFICULTIES', 'getMetaMods', 'getRunBonuses', 'isCharacterUnlocked', 'isWeaponUnlocked', 'unlockedWeapons']) {
      if (progMod[k] != null) meta[k] = progMod[k];
    }
  }
  // touch devices: auto-aim + auto-fire by default, once (unless the player configures it later)
  if (save && save.settings && input.isTouch && !lsGet('nachtglut.touchDefaults')) {
    save.settings.autoAim = true;
    save.settings.autoFire = true;
    lsSet('nachtglut.touchDefaults', '1');
    if (saveMod && saveMod.persistSave) { try { saveMod.persistSave(save); } catch { /* ignore */ } }
  }

  try {
    game = new gameMod.Game({ input, fx, meta, generateFloor: genMod && genMod.generateFloor, save });
  } catch (err) {
    console.error('[boot] new Game failed', err);
    showFatal('Nachtglut konnte nicht gestartet werden.');
    return;
  }
  app.game = game;
  renderer.game = game;
  renderer.resize();

  if (trackerMod && trackerMod.initTracker) {
    try {
      const reg = registry || {};
      trackerMod.initTracker(game, { registries: { characters: reg.CHARACTERS, weapons: reg.WEAPONS, enemies: reg.ENEMIES, bosses: reg.BOSSES, relics: reg.RELICS } });
    } catch (err) { console.warn('[boot] initTracker failed', err); }
  }
  if (achMod && achMod.initAchievements) { try { achMod.initAchievements(game); } catch (err) { console.warn('[boot] initAchievements failed', err); } }

  // audio
  const audio = audioMod && (audioMod.audio || audioMod.default);
  if (audio) {
    try { if (audio.bindEvents) audio.bindEvents(bus, game); } catch (err) { console.warn('[boot] audio.bindEvents failed', err); }
    const unlock = () => { try { audio.init(); } catch (err) { console.warn('[boot] audio.init failed', err); } };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
  }
  app.audio = audio || null;

  // auto-pause when hidden / unfocused
  const autopause = q.get('autopause') !== '0';
  const pauseGame = () => { if (autopause && game.state === 'playing') game.pause(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseGame();
      if (audio && audio.suspend) { try { audio.suspend(); } catch { /* ignore */ } }
    } else if (audio && audio.resume) { try { audio.resume(); } catch { /* ignore */ } }
  });
  window.addEventListener('blur', pauseGame);

  // UI
  const startOpts = {};
  if (q.get('seed')) startOpts.seed = q.get('seed');
  if (q.get('char')) startOpts.character = q.get('char');
  if (q.get('diff')) startOpts.difficulty = Math.max(0, parseInt(q.get('diff'), 10) || 0);
  const realUi = uiMod && (uiMod.ui || uiMod.default);
  if (realUi && typeof realUi.init === 'function') {
    try {
      realUi.init(game);
      ui = realUi;
    } catch (err) {
      console.warn('[boot] ui.init failed – using the fallback UI', err);
      ui = null;
    }
  }
  if (!ui) {
    try { ui = createFallbackUI({ game, bus, input, renderer, root: uiRoot, startOpts }); } catch (err) { console.error('[boot] fallback UI failed', err); }
  }
  app.ui = ui;

  // test flags
  if (q.get('autostart') === '1') {
    try {
      game.startRun({ character: 'bearer', difficulty: 0, ...startOpts });
      const floor = parseInt(q.get('floor'), 10);
      if (floor > 1 && game.run && game.run.startFloor) game.run.startFloor(Math.min(5, floor));
    } catch (err) { console.error('[boot] autostart failed', err); }
  }
  bus.emit('boot:ready', { game });
}

function start() {
  boot().catch((err) => console.error('[boot] failed', err));
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
