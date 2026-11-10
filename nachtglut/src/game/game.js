// Game: top-level state machine (menu / playing / paused / choice / transition / dead / victory).
// DOM-free. See docs/ARCHITECTURE.md §8 and §11.1.
import { bus } from '../core/events.js';
import { NULL_FX } from './world.js';
import { Run } from './run.js';
import { generateFallbackFloor } from './fallbackgen.js';

/** Neutral meta used when none is injected (tests, sim without src/meta). */
export const DEFAULT_META = Object.freeze({
  DIFFICULTIES: Object.freeze([Object.freeze({ level: 0, name: 'Erste Glut', desc: 'Der Schacht, wie er ist.', mods: Object.freeze({}) })]),
  getMetaMods() { return []; },
  getRunBonuses() {
    return {
      startSparks: 0, rerolls: 0, revives: 0, relicChoices: 0, startRelics: 0, startRelicRarity: 'common',
      shopDiscount: 0, healOnFloor: 0, startShield: 0,
    };
  },
});

/** Minimal in-memory save (same shape as meta/save.js `defaultSave()`, without the extras). */
export function defaultSaveLite() {
  return {
    version: 1,
    ash: 0, totalAsh: 0,
    upgrades: {},
    unlocks: { characters: ['bearer'], weapons: [], difficulties: 0 },
    codex: { enemies: {}, relics: {}, weapons: {}, bosses: {}, boons: {} },
    achievements: {},
    stats: { runs: 0, wins: 0, deaths: 0, kills: 0, bestFloor: 0, playTime: 0, fastestWin: 0, totalSparks: 0 },
    history: [],
    settings: {
      master: 0.8, music: 0.6, sfx: 0.8, shake: 1, flashes: true, damageNumbers: true,
      autoAim: false, autoFire: false, touchSide: 'right', showTimer: true, reducedMotion: false,
    },
    tutorialSeen: false,
  };
}

/**
 * Input-like stub for headless use (tests, sim). Same surface as core/input.js plus helpers:
 * `hold(name, down)`, `press(name)`, `setMove(x, y)`.
 */
export function makeStubInput() {
  const held = new Set();
  const pressed = new Set();
  return {
    move: { x: 0, y: 0 },
    vmove: { x: 0, y: 0 },
    vaim: { x: 0, y: 0, active: false },
    padAim: { x: 0, y: 0, active: false },
    mouse: { x: 0, y: 0, moved: false, inside: false },
    aimMode: 'auto',
    lastDevice: 'gamepad',
    isTouch: false,
    enabled: true,
    init() {}, poll() {}, releaseAll() { held.clear(); },
    down(name) { return this.enabled && held.has(name); },
    pressed(name) { return this.enabled && pressed.has(name); },
    take(name) { const had = pressed.has(name); pressed.delete(name); return this.enabled && had; },
    consume() { pressed.clear(); },
    hold(name, down = true) { if (down) { if (!held.has(name)) pressed.add(name); held.add(name); } else held.delete(name); },
    press(name) { pressed.add(name); },
    setMove(x, y) { this.move.x = x; this.move.y = y; },
    setVirtualMove(x, y) { this.move.x = x; this.move.y = y; },
    setVirtualAim(x, y, active) { this.vaim.x = x; this.vaim.y = y; this.vaim.active = !!active; },
    setVirtualButton(name, down) { this.hold(name, down); },
  };
}

const HITSTOP_GUARD = 0.3; // s: never freeze the simulation longer than this, even if fx.hitstopT is stuck

export class Game {
  constructor(opts = {}) {
    this.input = opts.input || makeStubInput();
    this.fx = opts.fx || NULL_FX;
    this.meta = { ...DEFAULT_META, ...(opts.meta || {}) };
    this.generateFloor = opts.generateFloor || generateFallbackFloor;
    this.save = opts.save || defaultSaveLite();
    if (!this.save.settings) this.save.settings = defaultSaveLite().settings;
    this.state = 'menu';
    this.run = null;
    this.time = 0;
    this.view = { x: 0, y: 0, w: 480, h: 270, scale: 1 };
    this.fade = 0;
    this.choice = null;
    this.choiceQueue = [];
    this.trans = null;
    this._hsSkip = 0;
  }

  get settings() { return this.save.settings; }
  set settings(v) { this.save.settings = v; }

  setState(to) {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    bus.emit('state:change', { from, to });
  }

  worldToScreen(x, y) {
    const v = this.view, s = v.scale || 1;
    return { x: (x - v.x) * s, y: (y - v.y) * s };
  }

  screenToWorld(cssX, cssY) {
    const v = this.view, s = v.scale || 1;
    return { x: cssX / s + v.x, y: cssY / s + v.y };
  }

  // -------------------------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------------------------
  startRun(opts = {}) {
    if (this.run && !this.run.ended) this.run.finish(false, { abandoned: true });
    this.clearChoices();
    this.trans = null;
    this.fade = 0;
    const run = new Run(this, opts);
    this.run = run;
    this.setState('playing');
    run.start();
    return run;
  }

  pause() { if (this.state === 'playing') this.setState('paused'); }
  resume() { if (this.state === 'paused') this.setState('playing'); }

  /** Ends the current run without a death (emits run:end with summary.abandoned) and returns to the menu. */
  abandonRun() {
    const run = this.run;
    if (run && !run.finished) run.finish(false, { abandoned: true });
    this.toMenu();
  }

  toMenu() {
    const run = this.run;
    if (run && !run.finished) run.finish(false, { abandoned: true });
    this.clearChoices();
    this.trans = null;
    this.fade = 0;
    this.run = null;
    if (this.fx.clear) this.fx.clear();
    this.setState('menu');
  }

  // -------------------------------------------------------------------------------------------
  // Choices (modal)
  // -------------------------------------------------------------------------------------------
  /** Shows a Choice (§8). Queues it if another choice is open or the game is not in 'playing'. */
  openChoice(choice) {
    if (!choice || !Array.isArray(choice.options)) return null;
    if (this.choice || (this.state !== 'playing' && this.state !== 'choice')) {
      if (this.state === 'menu' || this.state === 'dead' || this.state === 'victory') return null;
      this.choiceQueue.push(choice);
      return choice;
    }
    this._showChoice(choice);
    return choice;
  }

  _wrapOptions(choice) {
    for (const opt of choice.options) {
      if (!opt || opt._wrapped) continue;
      const orig = opt.pick;
      opt._wrapped = true;
      opt.pick = () => {
        if (this.choice !== choice || choice._resolved || opt.disabled) return false;
        choice._resolved = true;
        try { if (typeof orig === 'function') orig.call(opt); } catch (err) { console.error('[choice] pick failed', err); }
        this.resolveChoice(choice);
        return true;
      };
    }
  }

  _showChoice(choice) {
    this._wrapOptions(choice);
    if (typeof choice.reroll === 'function' && !choice._rerollWrapped) {
      const orig = choice.reroll;
      choice._rerollWrapped = true;
      choice.reroll = () => {
        if (this.choice !== choice || choice._resolved || !(choice.rerolls > 0)) return false;
        try { orig.call(choice); } catch (err) { console.error('[choice] reroll failed', err); }
        this._wrapOptions(choice);
        bus.emit('ui:choice', choice);
        return true;
      };
    }
    if (typeof choice.skip === 'function' && !choice._skipWrapped) {
      const orig = choice.skip;
      choice._skipWrapped = true;
      choice.skip = () => {
        if (this.choice !== choice || choice._resolved) return false;
        choice._resolved = true;
        try { orig.call(choice); } catch (err) { console.error('[choice] skip failed', err); }
        this.resolveChoice(choice);
        return true;
      };
    }
    if (choice.rerolls == null) choice.rerolls = 0;
    this.choice = choice;
    this.setState('choice');
    bus.emit('ui:choice', choice);
  }

  /** Closes the current choice; shows the next queued one or returns to 'playing'. */
  resolveChoice(choice) {
    if (choice && this.choice !== choice) return;
    if (this.choice) this.choice._resolved = true;
    this.choice = null;
    if (this.state !== 'choice') return; // a pick may have started a transition or ended the run
    const next = this.choiceQueue.shift();
    if (next && this.run && !this.run.finished) this._showChoice(next);
    else this.setState('playing');
  }

  clearChoices() {
    if (this.choice) this.choice._resolved = true;
    this.choice = null;
    this.choiceQueue.length = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Transitions (fade out → fn → fade in)
  // -------------------------------------------------------------------------------------------
  transition(fn, duration = 0.3) {
    if (this.trans) {
      if (!this.trans.done) this.trans.fns.push(fn);
      else this._safeCall(fn);
      return;
    }
    this.trans = { t: 0, dur: Math.max(0.02, duration), fns: [fn], done: false };
    this.setState('transition');
  }

  _safeCall(fn) {
    try { if (typeof fn === 'function') fn(); } catch (err) { console.error('[game] transition callback failed', err); }
  }

  _updateTransition(dt) {
    const tr = this.trans;
    tr.t += dt;
    const half = tr.dur / 2;
    if (!tr.done && tr.t >= half) {
      tr.done = true;
      this.fade = 1;
      const fns = tr.fns; tr.fns = [];
      for (const fn of fns) this._safeCall(fn);
    }
    if (tr.t >= tr.dur) {
      this.fade = 0;
      this.trans = null;
      if (this.state === 'transition') {
        this.setState('playing');
        const next = this.choiceQueue.shift();
        if (next && this.run && !this.run.finished) this._showChoice(next);
      }
      return;
    }
    this.fade = tr.t < half ? tr.t / half : Math.max(0, 1 - (tr.t - half) / half);
  }

  // -------------------------------------------------------------------------------------------
  // Main step (fixed 1/60 s)
  // -------------------------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const input = this.input;
    if (this.state === 'playing' || this.state === 'paused') {
      if (input.take && input.take('pause')) {
        if (this.state === 'playing') this.pause(); else this.resume();
      }
    }
    switch (this.state) {
      case 'playing': {
        const run = this.run;
        if (!run) break;
        if (this.fx.hitstopT > 0 && this._hsSkip < HITSTOP_GUARD) {
          this._hsSkip += dt;
          break;
        }
        if (!(this.fx.hitstopT > 0)) this._hsSkip = 0;
        run.update(dt);
        if (this.state === 'playing' && !this.choice && this.choiceQueue.length && !run.finished) {
          this._showChoice(this.choiceQueue.shift());
        }
        break;
      }
      case 'transition':
        if (this.trans) this._updateTransition(dt);
        else this.setState(this.run ? 'playing' : 'menu');
        break;
      default:
        break;
    }
    if (input.consume) input.consume();
  }
}
