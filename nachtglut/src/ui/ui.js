// UI entry: `ui.init(game)` once, `ui.update(dt)` every rendered frame.
// Owns all DOM: menus/screens (state-driven), HUD, choice modal, touch controls, banners/toasts,
// tooltips, dialogs, tutorial hints. Keyboard/gamepad navigation and audio cue events (ui:*).
import { bus } from '../core/events.js';
import { input as defaultInput } from '../core/input.js';
import { RARITY_INFO } from '../game/constants.js';
import { persistSave } from '../meta/save.js';
import { h, sfx, focusables, isTextField } from './dom.js';
import { content, loadContent, onContentLoaded } from './content.js';
import { pickDirectional } from './format.js';
import { initTooltip, hideTooltip } from './tooltip.js';
import { createNotify } from './notify.js';
import { createHud } from './hud.js';
import { createTouch } from './touch.js';
import { createChoice } from './choice.js';
import { createTutorial } from './tutorial.js';
import { confirmDialog } from './dialog.js';
import { createTitle } from './screens/title.js';
import { createSetup } from './screens/setup.js';
import { createAltar } from './screens/altar.js';
import { createChronik } from './screens/chronik.js';
import { createSettings } from './screens/settings.js';
import { createPause, createCharsheet } from './screens/pause.js';
import { createEnd } from './screens/end.js';

const SCREENS = {
  title: createTitle, setup: createSetup, altar: createAltar, chronik: createChronik,
  settings: createSettings, pause: createPause, charsheet: createCharsheet, end: createEnd,
};
const HUD_STATES = new Set(['playing', 'paused', 'choice', 'transition']);
const NAV_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const HOVER_SEL = '.btn, .tab, .ctile, .node, .char-card, .ccard, .seg-btn, .set-toggle';

let S = null; // module state (one UI per page)

function ensureStylesheet() {
  try {
    if (document.querySelector('link[rel="stylesheet"][href*="style.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../style.css', import.meta.url).href;
    document.head.appendChild(link);
  } catch { /* ignore */ }
}

function createApi(game) {
  const input = game.input && typeof game.input.setVirtualMove === 'function' ? game.input : defaultInput;
  const existing = document.getElementById('ui');
  const root = h('div.ng-ui', { attrs: { 'data-state': game.state || 'menu' } });
  (existing || document.body).appendChild(root);
  const screenRoot = h('div.screens');
  const dialogRoot = h('div.dialogs');

  const api = {
    game, input, root, dialogRoot, screenRoot,
    RARITY_INFO,
    layers: [],
    stack: [],
    touchMode: false,

    // ---- settings / save ------------------------------------------------------------------
    settings() { return (game.save && game.save.settings) || game.settings || {}; },
    persist() { try { if (game.save) persistSave(game.save); } catch (err) { console.warn('[ui] persist failed', err); } },
    setSetting(key, value, opts = {}) {
      const st = api.settings();
      st[key] = value;
      if (opts.persist !== false) api.persist();
      bus.emit('settings:change', { settings: st });
      applyRootClasses();
    },
    reducedMotion() {
      if (api.settings().reducedMotion) return true;
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    },
    compact() { return window.innerWidth < 720 || window.innerHeight < 480; },
    inputDevice() {
      if (api.touchMode) return 'touch';
      return input.lastDevice === 'gamepad' ? 'gamepad' : 'keyboard';
    },

    // ---- layers + focus -------------------------------------------------------------------
    pushLayer(layer) { api.layers.push(layer); },
    popLayer(layer) {
      const i = api.layers.indexOf(layer);
      if (i >= 0) api.layers.splice(i, 1);
      const top = api.topLayer();
      if (top) {
        const f = top.lastFocus && top.el.contains(top.lastFocus) ? top.lastFocus : null;
        if (f) api.focusEl(f, true);
      }
    },
    topLayer() { return api.layers[api.layers.length - 1] || null; },
    focusEl(el, silent, noScroll) {
      if (!el || typeof el.focus !== 'function') return;
      try { el.focus({ preventScroll: !!noScroll }); } catch { el.focus(); }
      const top = api.topLayer();
      if (top && top.el.contains(el)) top.lastFocus = el;
      if (!silent) sfx.hover();
    },

    // ---- screens --------------------------------------------------------------------------
    openScreen(id, params = {}, opts = {}) {
      const factory = SCREENS[id];
      if (!factory) return null;
      let inst;
      try { inst = factory(api, params); } catch (err) { console.error(`[ui] screen ${id} failed`, err); return null; }
      const prev = api.stack[api.stack.length - 1];
      if (prev) prev.inst.el.classList.add('is-under');
      screenRoot.appendChild(inst.el);
      const layer = { el: inst.el, kind: 'screen', inst, back: () => (inst.back ? inst.back() : api.back()) };
      api.stack.push({ id, inst, layer });
      api.pushLayer(layer);
      if (!opts.silent) sfx.open();
      hideTooltip();
      const f = (inst.focus && inst.focus()) || focusables(inst.el)[0];
      if (f) api.focusEl(f, true, true); // screens open scrolled to the top
      return inst;
    },
    back() {
      if (api.stack.length <= 1) return;
      const top = api.stack.pop();
      top.inst.el.remove();
      if (top.inst.onHide) top.inst.onHide();
      hideTooltip();
      const prev = api.stack[api.stack.length - 1];
      prev.inst.el.classList.remove('is-under');
      if (prev.inst.refresh) prev.inst.refresh();
      api.popLayer(top.layer);
      if (!prev.layer.lastFocus || !prev.inst.el.contains(prev.layer.lastFocus)) {
        const f = (prev.inst.focus && prev.inst.focus()) || focusables(prev.inst.el)[0];
        if (f) api.focusEl(f, true);
      }
      sfx.close();
    },
    clearScreens() {
      while (api.stack.length) {
        const s = api.stack.pop();
        s.inst.el.remove();
        if (s.inst.onHide) s.inst.onHide();
        const i = api.layers.indexOf(s.layer);
        if (i >= 0) api.layers.splice(i, 1);
      }
      hideTooltip();
    },
    resetScreens(ids, params) {
      api.clearScreens();
      ids.forEach((id, i) => api.openScreen(id, i === ids.length - 1 ? params : {}, { silent: i < ids.length - 1 }));
    },
    topScreen() { return api.stack[api.stack.length - 1] || null; },
    refreshScreens() {
      const top = api.topScreen();
      if (top && top.inst.refresh) { try { top.inst.refresh(); } catch (err) { console.error('[ui] refresh failed', err); } }
    },

    // ---- actions --------------------------------------------------------------------------
    confirm(opts) { return confirmDialog(api, opts); },
    toast(p) { S && S.notify.toast(p); },
    banner(p) { S && S.notify.banner(p); },
    startRun(opts) {
      try { game.startRun(opts); } catch (err) {
        console.error('[ui] startRun failed', err);
        api.toast({ text: 'Der Abstieg konnte nicht beginnen.', kind: 'bad' });
      }
    },
    requestPause() { if (game.state === 'playing' && typeof game.pause === 'function') game.pause(); },
    resume() { if (typeof game.resume === 'function') game.resume(); },
    toggleMap(force) {
      if (!S) return;
      const open = force === undefined ? !S.hud.mapOpen : !!force;
      if (open && !game.run) return;
      if (open !== S.hud.mapOpen) (open ? sfx.open : sfx.close)();
      S.hud.setMapOpen(open);
    },
    afterChoice() { /* the next queued choice (if any) is picked up by update() */ },
  };

  function applyRootClasses() {
    root.classList.toggle('reduced-motion', api.reducedMotion());
    root.classList.toggle('touch-mode', api.touchMode);
    root.classList.toggle('compact', api.compact());
    root.classList.toggle('side-left', api.settings().touchSide === 'left');
  }
  api.applyRootClasses = applyRootClasses;
  return api;
}

// ---------------------------------------------------------------------------------------------
// Keyboard + gamepad navigation
// ---------------------------------------------------------------------------------------------
function navigate(api, dir, fromPad) {
  const top = api.topLayer();
  if (!top) return;
  const list = focusables(top.el);
  if (!list.length) return;
  const cur = document.activeElement;
  if (!cur || !top.el.contains(cur) || cur === top.el) {
    const f = (top.inst && top.inst.focus && top.inst.focus()) || list[0];
    api.focusEl(f);
    return;
  }
  if (fromPad && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
    const step = Number(cur.step) || 1;
    cur.value = String(Number(cur.value) + (dir === 'left' ? -step : step));
    cur.dispatchEvent(new Event('input', { bubbles: true }));
    cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const others = list.filter((e) => e !== cur);
  const rects = others.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const r = cur.getBoundingClientRect();
  const i = pickDirectional({ x: r.left, y: r.top, w: r.width, h: r.height }, rects, dir);
  if (i >= 0) api.focusEl(others[i]);
}

function onKeyDown(api, e) {
  const top = api.topLayer();
  if (!top) {
    // gameplay: leave keys to the game input; the map toggle is UI-only (catch quick taps here,
    // the per-frame poll in update() covers gamepad + virtual buttons)
    if (e.code === 'KeyM' && !e.repeat && !isTextField(e.target) && S.vis.hud && api.game.state !== 'paused') {
      S.mapDown = true;
      api.toggleMap();
    }
    return;
  }
  // a modal UI is open: keep the key away from the game input
  e.stopPropagation();
  const t = e.target;
  const typing = isTextField(t);
  if (top.kind === 'choice') {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m && S.choice.pickIndex(Number(m[1]) - 1)) { e.preventDefault(); return; }
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (e.repeat) return;
    if (typing && t.blur && top.kind !== 'dialog') { t.blur(); }
    top.back && top.back();
    return;
  }
  const dir = NAV_KEYS[e.key];
  if (dir) {
    if (typing && (t.tagName === 'TEXTAREA' || dir === 'left' || dir === 'right')) return;
    if (t && t.type === 'range' && (dir === 'left' || dir === 'right')) return;
    e.preventDefault();
    navigate(api, dir, false);
    return;
  }
  if (e.key === 'Tab') {
    const list = focusables(top.el);
    if (!list.length) { e.preventDefault(); return; }
    const i = list.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i >= list.length - 1 ? 0 : i + 1);
    e.preventDefault();
    api.focusEl(list[next]);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    if (typing) {
      if (e.key === 'Enter' && t.tagName === 'INPUT') {
        const go = top.el.querySelector('.btn-go');
        if (go) { e.preventDefault(); go.click(); }
      }
      return;
    }
    if (!top.el.contains(document.activeElement)) {
      e.preventDefault();
      navigate(api, 'down', false);
    }
    // otherwise native activation of the focused button
    return;
  }
  if (top.inst && top.inst.tabStep && (e.key === 'PageUp' || e.key === 'PageDown')) {
    e.preventDefault();
    top.inst.tabStep(e.key === 'PageUp' ? -1 : 1);
  }
}

function pollPad(api, dt) {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  for (const p of pads || []) if (p && p.connected) { pad = p; break; }
  const ps = S.pad;
  if (!pad) { ps.prev = {}; ps.dir = null; return; }
  const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
  const now = { a: b(0), b: b(1), lb: b(4), rb: b(5) };
  const edge = (k) => now[k] && !ps.prev[k];
  const top = api.topLayer();
  if (top) {
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const dir = b(12) || ay < -0.55 ? 'up' : b(13) || ay > 0.55 ? 'down' : b(14) || ax < -0.55 ? 'left' : b(15) || ax > 0.55 ? 'right' : null;
    if (dir) {
      if (dir !== ps.dir) { ps.dir = dir; ps.rep = 0.38; navigate(api, dir, true); }
      else { ps.rep -= dt; if (ps.rep <= 0) { ps.rep = 0.11; navigate(api, dir, true); } }
    } else ps.dir = null;
    if (edge('a')) {
      const el = document.activeElement;
      if (el && top.el.contains(el) && el !== document.body) { if (el.type !== 'range') el.click(); }
      else navigate(api, 'down', true);
    }
    if (edge('b')) top.back && top.back();
    if (top.inst && top.inst.tabStep) {
      if (edge('lb')) top.inst.tabStep(-1);
      if (edge('rb')) top.inst.tabStep(1);
    }
  }
  ps.prev = now;
}

// ---------------------------------------------------------------------------------------------
// State sync
// ---------------------------------------------------------------------------------------------
function syncState(api, force) {
  const game = api.game;
  const st = game.state || 'menu';
  if (st === S.lastState && !force) return;
  S.lastState = st;
  api.root.dataset.state = st;
  hideTooltip();
  switch (st) {
    case 'menu':
      S.choice.hide();
      S.endPending = null;
      S.hud.setMapOpen(false);
      S.notify.clearBanner();
      if (!api.stack.length || api.stack[0].id !== 'title') api.resetScreens(['title']);
      break;
    case 'playing':
    case 'transition':
      if (api.stack.length) api.clearScreens();
      blurActive();
      break;
    case 'paused':
      S.hud.setMapOpen(false);
      api.resetScreens(['pause']);
      break;
    case 'choice':
      if (api.stack.length) api.clearScreens();
      S.hud.setMapOpen(false);
      if (game.choice) S.choice.show(game.choice);
      break;
    case 'dead':
    case 'victory':
      api.clearScreens();
      S.choice.hide();
      S.hud.setMapOpen(false);
      S.endPending = { t: api.reducedMotion() ? 0.9 : 1.9 };
      break;
    default:
      break;
  }
}

function blurActive() {
  const a = document.activeElement;
  if (a && a !== document.body && typeof a.blur === 'function') a.blur();
}

function updateVisibility(api) {
  const game = api.game;
  const st = game.state;
  const hudOn = !!game.run && HUD_STATES.has(st);
  if (S.vis.hud !== hudOn) {
    S.vis.hud = hudOn;
    api.root.classList.toggle('hud-on', hudOn);
    if (!hudOn) S.hud.setMapOpen(false);
  }
  // touch mode follows the last used device
  if (input(api).lastDevice === 'gamepad' && api.touchMode) setTouchMode(api, false);
  const touchOn = api.touchMode && hudOn && (st === 'playing' || st === 'transition');
  S.touch.setVisible(touchOn);
  if (S.vis.touch !== touchOn) { S.vis.touch = touchOn; api.root.classList.toggle('touch-on', touchOn); }
}

const input = (api) => api.input || {};

function setTouchMode(api, on) {
  if (api.touchMode === on) return;
  api.touchMode = on;
  api.applyRootClasses();
  if (S) S.hud.invalidate();
}

// ---------------------------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------------------------
export const ui = {
  /** Build the DOM and subscribe to the bus. Safe to call once per page. */
  init(game) {
    if (S || typeof document === 'undefined') return ui;
    if (!game) throw new Error('ui.init(game): game missing');
    ensureStylesheet();
    const api = createApi(game);
    const root = api.root;
    S = { api, lastState: null, endPending: null, lastEnd: null, runAchievements: [], vis: {}, pad: { prev: {}, dir: null, rep: 0 }, mapDown: false };

    // layers (DOM order = stacking order, see style.css)
    const notifyRoot = h('div.notify-root');
    S.hud = createHud(api);
    S.touch = createTouch(api);
    S.choice = createChoice(api);
    S.tutorial = createTutorial(api);
    root.append(S.hud.el.fxLayer, S.hud.el.root, S.hud.el.bigmap, S.touch.el, S.tutorial.el, api.screenRoot, S.choice.el, notifyRoot, api.dialogRoot);
    S.notify = createNotify(notifyRoot, api);
    initTooltip(root);

    // initial device guess
    let coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { coarse = false; }
    api.touchMode = !!(input(api).isTouch || ('ontouchstart' in window)) && coarse;
    api.applyRootClasses();

    // ---- DOM listeners ----
    window.addEventListener('keydown', (e) => {
      if (!isTextField(e.target) && (e.code in NAV_KEYS || /^Key[WASD]$/.test(e.code)) && api.touchMode) setTouchMode(api, false);
      onKeyDown(api, e);
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouchMode(api, true);
      else if (e.pointerType === 'mouse') setTouchMode(api, false);
    }, true);
    window.addEventListener('resize', () => { api.applyRootClasses(); S.hud.invalidate(); hideTooltip(); });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('focusin', (e) => {
      const top = api.topLayer();
      if (top && top.el.contains(e.target)) top.lastFocus = e.target;
    });
    let lastHoverEl = null;
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest && e.target.closest(HOVER_SEL);
      if (el && el !== lastHoverEl) { lastHoverEl = el; sfx.hover(); }
      if (!el) lastHoverEl = null;
    });

    // ---- bus ----
    bus.on('state:change', () => syncState(api));
    bus.on('ui:toast', (p) => S.notify.toast(p || {}));
    bus.on('ui:banner', (p) => {
      if (!p) return;
      if (game.state === 'menu') return;
      S.notify.banner(p);
    });
    bus.on('ui:choice', (c) => {
      if (!c || !Array.isArray(c.options)) return;
      if (c !== game.choice) c.__orphan = true;
      if (S.choice.current === c) return;
      S.choice.show(c);
    });
    bus.on('run:start', () => { S.hud.reset(); S.runAchievements = []; S.lastEnd = null; S.hud.setMapOpen(false); });
    bus.on('run:end', (p) => { S.lastEnd = p || null; });
    bus.on('achievement:unlock', (p) => { if (p && (game.run || S.endPending)) S.runAchievements.push(p); });
    bus.on('player:hit', () => S.hud.onHit());
    bus.on('meta:change', () => { if (game.state === 'menu') api.refreshScreens(); });
    bus.on('settings:change', () => api.applyRootClasses());

    onContentLoaded(() => {
      S.hud.invalidate();
      api.refreshScreens();
      const top = api.topScreen();
      if (top && top.id === 'title' && top.inst.refresh) top.inst.refresh();
    });
    loadContent();

    try {
      const g = window.__nachtglut;
      if (g && typeof g === 'object') g.ui = ui;
      else window.__nachtglutUI = ui;
    } catch { /* ignore */ }

    syncState(api, true);
    updateVisibility(api);
    return ui;
  },

  /** Per-frame update (dt in seconds). Cheap when nothing changed. */
  update(dt) {
    if (!S) return;
    const api = S.api, game = api.game;
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0.016));
    try {
      syncState(api);
      // choice modal follows game.choice
      if (game.state === 'choice' && game.choice && S.choice.current !== game.choice && !game.choice._resolved) S.choice.show(game.choice);
      const cur = S.choice.current;
      if (cur && !cur.__orphan && (game.state !== 'choice' || game.choice !== cur)) S.choice.hide();
      updateVisibility(api);
      if (S.vis.hud) S.hud.update(dt);
      S.touch.update(dt);
      S.notify.update(dt);
      S.tutorial.update(dt);
      const top = api.topScreen();
      if (top && top.inst.update) top.inst.update(dt);
      if (S.endPending) {
        S.endPending.t -= dt;
        if (S.endPending.t <= 0 && (game.state === 'dead' || game.state === 'victory')) {
          S.endPending = null;
          S.notify.clearBanner();
          S.notify.clearToasts(); // the end screen lists unlocks + achievements itself
          const payload = S.lastEnd || { victory: game.state === 'victory', summary: (game.run && game.run.lastSummary) || {} };
          api.resetScreens(['end'], { payload, achievements: S.runAchievements.slice() });
        }
      }
      // map toggle (M / gamepad back / virtual map button)
      if (S.vis.hud && game.state !== 'paused') {
        const md = !!(input(api).down && input(api).down('map'));
        if (md && !S.mapDown) api.toggleMap();
        S.mapDown = md;
      }
      pollPad(api, dt);
    } catch (err) {
      if (!S.errLogged) { S.errLogged = true; console.error('[ui] update failed', err); }
    }
  },

  /** For tools/tests: the internal API. */
  get api() { return S ? S.api : null; },
  get content() { return content; },
};

export default ui;
