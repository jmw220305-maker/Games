// Browser implementation of the fx interface (docs/ARCHITECTURE.md §5): particles, floating combat text,
// rings, beams, lightning, screen shake, flashes, temporary lights and hitstop. Everything is pooled
// (no allocations per particle/text), so it is safe to call from hot gameplay code. DOM-free at import
// time; `update` works without any canvas (Node tests), drawing helpers are called by the renderer.
import { glowSprite, shade } from './lighting.js';

const TAU = Math.PI * 2;
const MAX_PARTICLES = 700;
const MAX_TEXTS = 60;
const MAX_RINGS = 48;
const MAX_BEAMS = 32;
const MAX_BOLTS = 24;
const MAX_LIGHTS = 48;
const BOLT_PTS = 14;
const MAX_BURST = 90;

// shape: 0 square · 1 streak (velocity-aligned line) · 2 twinkle (plus when big) · 3 soft blob
const SQ = 0, STREAK = 1, TWINKLE = 2, SOFT = 3;

/**
 * Particle presets. speed/life/size are [min, max]. gravity in px/s² (negative rises), drag per second.
 * add: additive blending · glow: extra soft halo · shrink: size → 0 over life · grow: size multiplier at death
 * tint: how opts.color is used ('mix' adds it to the palette, 'replace' derives the palette from it, 'none' ignores it)
 * up: initial upward bias (px/s) · jitter: spawn position spread (px) · flicker: random alpha flicker
 */
const PRESETS = {
  hit: { count: 5, colors: ['#ffffff', '#fff1d6'], tint: 'mix', speed: [55, 140], life: [0.1, 0.24], size: [1, 2], gravity: 0, drag: 8, add: true, shrink: true, shape: STREAK, jitter: 2 },
  spark: { count: 8, colors: ['#fff6c8', '#ffd35a', '#ff9a3c'], tint: 'mix', speed: [60, 190], life: [0.18, 0.45], size: [1, 1], gravity: 160, drag: 2.2, add: true, shrink: false, shape: STREAK, glow: true },
  ember: { count: 6, colors: ['#ffd35a', '#ff8a3c', '#ff5a1f', '#ffb347'], tint: 'mix', speed: [8, 55], life: [0.5, 1.2], size: [1, 2], gravity: -36, drag: 1.6, add: true, shrink: true, shape: SQ, glow: true, flicker: true, up: 10, jitter: 3 },
  smoke: { count: 6, colors: ['#3a3330', '#2a2523', '#4a423c'], tint: 'none', speed: [6, 26], life: [0.8, 1.7], size: [3, 6], gravity: -14, drag: 1.4, add: false, alpha: 0.42, grow: 2.2, shape: SOFT, jitter: 4 },
  blood: { count: 8, colors: ['#d23030', '#8f1b1b', '#ff4a4a'], tint: 'none', speed: [40, 125], life: [0.3, 0.65], size: [1, 2], gravity: 240, drag: 3, add: false, shrink: false, shape: SQ, up: 30 },
  frost: { count: 9, colors: ['#ffffff', '#dff4ff', '#8fd8ff', '#bfeaff'], tint: 'mix', speed: [20, 85], life: [0.4, 0.85], size: [1, 2], gravity: 40, drag: 3, add: true, shrink: true, shape: TWINKLE, glow: true },
  poison: { count: 7, colors: ['#9be35a', '#6fbf3a', '#c8ff7a'], tint: 'mix', speed: [8, 36], life: [0.5, 1.1], size: [2, 3], gravity: -26, drag: 2, add: false, alpha: 0.85, shrink: true, shape: SQ, jitter: 5 },
  shock: { count: 6, colors: ['#ffffff', '#fff8b0', '#ffe75a'], tint: 'mix', speed: [90, 220], life: [0.08, 0.22], size: [1, 1], gravity: 0, drag: 9, add: true, shrink: false, shape: STREAK, glow: true },
  shadow: { count: 8, colors: ['#b07cff', '#6a44b0', '#2a1a4a', '#140c26'], tint: 'mix', speed: [12, 50], life: [0.5, 1.1], size: [2, 3], gravity: -16, drag: 2, add: false, alpha: 0.8, grow: 1.5, shape: SOFT, jitter: 4 },
  light: { count: 10, colors: ['#ffffff', '#fff3b0', '#ffd35a'], tint: 'mix', speed: [40, 140], life: [0.35, 0.9], size: [1, 2], gravity: -10, drag: 3, add: true, shrink: true, shape: TWINKLE, glow: true },
  dust: { count: 6, colors: ['#8a7a6a', '#6b5e52', '#a89580'], tint: 'mix', speed: [10, 38], life: [0.3, 0.65], size: [1, 2], gravity: -6, drag: 4, add: false, alpha: 0.6, grow: 1.6, shape: SQ, jitter: 3 },
  heal: { count: 10, colors: ['#7dff9a', '#c8ffd0', '#3fd16a'], tint: 'mix', speed: [6, 28], life: [0.6, 1.1], size: [1, 2], gravity: -55, drag: 1.2, add: true, shrink: true, shape: TWINKLE, glow: true, jitter: 9 },
  explosion: { count: 24, colors: ['#fff6c8', '#ffd35a', '#ff8a3c', '#ff5a1f'], tint: 'mix', speed: [50, 230], life: [0.25, 0.7], size: [2, 4], gravity: 30, drag: 4.5, add: true, shrink: true, shape: SQ, glow: true, extra: [['smoke', 0.4], ['spark', 0.35]] },
  death: { count: 12, colors: ['#ffffff'], tint: 'replace', speed: [30, 135], life: [0.35, 0.8], size: [1, 3], gravity: 70, drag: 3, add: false, shrink: true, shape: SQ, up: 25, extra: [['smoke', 0.3], ['ember', 0.4]] },
  spawn: { count: 8, colors: ['#ffffff'], tint: 'replace', speed: [15, 55], life: [0.35, 0.7], size: [1, 2], gravity: -60, drag: 2, add: true, shrink: true, shape: TWINKLE, glow: true, jitter: 8 },
  gold: { count: 7, colors: ['#ffe27a', '#ffd35a', '#fff6c8', '#ffb347'], tint: 'mix', speed: [30, 95], life: [0.3, 0.65], size: [1, 1], gravity: 90, drag: 2, add: true, shrink: false, shape: TWINKLE, glow: true, up: 30 },
  // §12 status payoffs
  // Aderlass: a heavy spray of dark blood whose droplets arc up and rain down, plus a dark mist
  hemorrhage: { count: 24, colors: ['#5a0810', '#8f0f1c', '#c41e2e', '#e8323f', '#ff4a56'], tint: 'none', speed: [60, 210], life: [0.4, 0.9], size: [1, 3], gravity: 330, drag: 2.2, add: false, shrink: false, shape: SQ, up: 80, jitter: 3, extra: [['bloodmist', 0.25]] },
  bloodmist: { count: 6, colors: ['#5a0810', '#3a0408', '#7a0c18'], tint: 'none', speed: [10, 42], life: [0.6, 1.2], size: [3, 6], gravity: -8, drag: 2, add: false, alpha: 0.55, grow: 2, shape: SOFT, jitter: 5 },
  // single droplet falling off a bleeding unit (throttled by the renderer)
  blood_drip: { count: 1, colors: ['#a3121f', '#7a0c18', '#d42434'], tint: 'none', speed: [2, 9], life: [0.3, 0.55], size: [1, 1], gravity: 190, drag: 1, add: false, shrink: false, shape: SQ, jitter: 3 },
  // Gifteruption: toxic puffs flung outward that brake into a ring around the spread radius
  eruption: { count: 18, colors: ['#5fae2a', '#8fe04a', '#3f7a1e', '#b8f070'], tint: 'mix', speed: [105, 160], life: [0.55, 1.05], size: [3, 5], gravity: -10, drag: 3, add: false, alpha: 0.72, grow: 2.2, shape: SOFT, jitter: 3, extra: [['poison', 0.6]] },
};
export const FX_PRESETS = Object.freeze(Object.keys(PRESETS));

const MAX_MOTES = 64;
const DRAIN_DUR = 0.35;
const BURST_LOOK = {
  bleed: { label: 'Aderlass', color: '#ff5a64', ring: '#d01c2c', light: '#ff2a3a' },
  poison: { label: 'Gifteruption', color: '#b8f070', ring: '#8fe04a', light: '#7ad83a' },
  shock: { label: 'Entladung', color: '#fff3a0', ring: '#fff6c8', light: '#ffe75a' },
};
const ERUPT_RADIUS = 48;
const CHAIN_RANGE = 80;
const CHAIN_MAX = 4;

const rand = Math.random;
const rr = (a, b) => a + (b - a) * rand();
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

function makeParticle() {
  return { t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, size: 1, size1: 1, color: '#fff', gravity: 0, drag: 0, add: false, glow: false, flicker: false, shape: 0, alpha: 1 };
}
function makeText() {
  return { alive: false, x: 0, y: 0, ox: 0, oy: 0, vx: 0, age: 0, life: 1, str: '', color: '#fff', size: 1, crit: false, damage: false, small: false, player: false, value: 0, pop: 0 };
}

function fmtNum(v) { // same format as world.dmgLabel: whole numbers, German decimal comma for tiny hits
  return v < 1.95 ? (Math.round(v * 10) / 10).toString().replace('.', ',') : Math.round(v).toString();
}

export class Fx {
  /** @param {() => object|null} [getSettings] returns the live settings object ({ shake, flashes, damageNumbers, reducedMotion }) */
  constructor(getSettings) {
    this.getSettings = typeof getSettings === 'function' ? getSettings : () => null;
    this.time = 0;
    this.hitstopT = 0;
    // particles: fixed ring buffer — writing over the oldest slot when full
    this.parts = new Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this.parts[i] = makeParticle();
    this.head = 0;
    this.liveParticles = 0;
    this.texts = new Array(MAX_TEXTS);
    for (let i = 0; i < MAX_TEXTS; i++) this.texts[i] = makeText();
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ t: 0, dur: 1, x: 0, y: 0, r: 0, color: '#fff' });
    this.beams = [];
    for (let i = 0; i < MAX_BEAMS; i++) this.beams.push({ t: 0, dur: 1, x0: 0, y0: 0, x1: 0, y1: 0, color: '#fff', width: 2 });
    this.bolts = [];
    for (let i = 0; i < MAX_BOLTS; i++) this.bolts.push({ t: 0, dur: 1, x0: 0, y0: 0, x1: 0, y1: 0, color: '#fff', n: 0, pts: new Float32Array(BOLT_PTS * 2), jt: 0 });
    this.lightPool = [];
    for (let i = 0; i < MAX_LIGHTS; i++) this.lightPool.push({ t: 0, dur: 1, x: 0, y: 0, r: 0, color: '#fff' });
    // life-drain motes (fx.drain): fly from a point and home onto a moving target
    this.motes = [];
    for (let i = 0; i < MAX_MOTES; i++) this.motes.push({ t: 0, dur: 1, delay: 0, x0: 0, y0: 0, cx: 0, cy: 0, tx: 0, ty: 0, x: 0, y: 0, px: 0, py: 0, target: null, color: '#fff', size: 1, arrived: false });
    this.liveMotes = 0;
    /** optional (amount, target) callback per drain — the renderer forwards it to the bus as `fx:drain` (audio) */
    this.onDrain = null;
    // shake
    this.shakeAmp = 0; this.shakeT = 0; this.shakeDur = 0;
    this.shakeX = 0; this.shakeY = 0;
    // flash
    this.flashColor = '#ffffff'; this.flashT = 0; this.flashDur = 0; this.flashMax = 0.32;
    this._palettes = new Map();
    this._pools = [this.rings, this.beams, this.bolts, this.lightPool];
  }

  // ------------------------------------------------------------------------------------------
  // settings
  // ------------------------------------------------------------------------------------------
  _s() {
    let s = null;
    try { s = this.getSettings(); } catch { s = null; }
    return s || null;
  }

  // ------------------------------------------------------------------------------------------
  // particles
  // ------------------------------------------------------------------------------------------
  _palette(P, name, color) {
    if (!color || P.tint === 'none') return P.colors;
    const key = name + '|' + color;
    let pal = this._palettes.get(key);
    if (pal) return pal;
    if (P.tint === 'replace') pal = [color, shade(color, 0.35), color, shade(color, -0.3), shade(color, 0.7)];
    else pal = [color, shade(color, 0.45), color, ...P.colors];
    if (this._palettes.size > 400) this._palettes.clear();
    this._palettes.set(key, pal);
    return pal;
  }

  _alloc() {
    const p = this.parts[this.head];
    this.head = (this.head + 1) % MAX_PARTICLES;
    return p;
  }

  /** burst(preset, x, y, { count, color, speed, life, size, angle, spread }) */
  burst(preset, x, y, opts) {
    const P = PRESETS[preset] || PRESETS.spark;
    if (!(x === x) || !(y === y)) return; // NaN guard
    const s = this._s();
    let count = opts && opts.count != null ? opts.count : P.count;
    if (s && s.reducedMotion) count *= 0.6;
    count = Math.min(MAX_BURST, Math.round(count));
    if (count <= 0) return;
    const color = opts && opts.color;
    const pal = this._palette(P, preset, color);
    const np = pal.length;
    let sMin = P.speed[0], sMax = P.speed[1];
    if (opts && opts.speed != null) { sMax = opts.speed; sMin = opts.speed * (P.speed[0] / P.speed[1]); }
    let lMin = P.life[0], lMax = P.life[1];
    if (opts && opts.life != null) { lMax = opts.life; lMin = opts.life * 0.6; }
    let zMin = P.size[0], zMax = P.size[1];
    if (opts && opts.size != null) { zMax = opts.size; zMin = Math.max(1, opts.size * 0.6); }
    const hasAngle = opts && opts.angle != null;
    const angle = hasAngle ? opts.angle : 0;
    const spread = opts && opts.spread != null ? opts.spread : hasAngle ? 0.9 : TAU;
    const jit = P.jitter || 0;
    const up = P.up || 0;
    for (let i = 0; i < count; i++) {
      const p = this._alloc();
      const a = hasAngle ? angle + (rand() - 0.5) * spread : rand() * TAU;
      const sp = rr(sMin, sMax);
      p.x = x + (jit ? (rand() - 0.5) * jit * 2 : 0);
      p.y = y + (jit ? (rand() - 0.5) * jit * 2 : 0);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - up * rand();
      p.life = p.t = rr(lMin, lMax);
      p.size = rr(zMin, zMax);
      p.size1 = P.shrink ? 0 : p.size * (P.grow || 1);
      p.color = pal[(rand() * np) | 0];
      p.gravity = P.gravity;
      p.drag = P.drag;
      p.add = !!P.add;
      p.glow = !!P.glow;
      p.flicker = !!P.flicker;
      p.shape = P.shape;
      p.alpha = P.alpha != null ? P.alpha : 1;
    }
    if (P.extra) {
      for (let i = 0; i < P.extra.length; i++) {
        const [sub, f] = P.extra[i];
        const n = Math.round(count * f);
        if (n > 0) this.burst(sub, x, y, { count: n, color: sub === 'smoke' ? undefined : color });
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // floating combat text
  // ------------------------------------------------------------------------------------------
  /** text(x, y, str, color, { crit, small, damage, player }) */
  text(x, y, str, color, opts) {
    if (!(x === x) || !(y === y)) return;
    const o = opts || {};
    const s = this._s();
    if (o.damage && s && s.damageNumbers === false) return;
    str = String(str);
    color = color || '#ffffff';
    const crit = !!o.crit, small = !!o.small;
    // merge rapid damage numbers on nearly the same spot
    if (o.damage) {
      const v = parseFloat(str.replace(',', '.'));
      if (Number.isFinite(v)) {
        const win = small ? 0.5 : 0.2, dx = small ? 18 : 12, dy = small ? 16 : 12;
        for (let i = 0; i < MAX_TEXTS; i++) {
          const t = this.texts[i];
          if (!t.alive || !t.damage || t.crit !== crit || t.color !== color || t.age > win) continue;
          if (Math.abs(t.ox - x) > dx || Math.abs(t.oy - y) > dy) continue;
          t.value += v;
          t.str = fmtNum(t.value);
          t.age = Math.min(t.age, 0.06);
          t.pop = 1;
          if (t.small && !small) t.small = false;
          return;
        }
      }
    }
    // allocate: free slot, else the oldest (relative to its life)
    let slot = null, worst = -1;
    for (let i = 0; i < MAX_TEXTS; i++) {
      const t = this.texts[i];
      if (!t.alive) { slot = t; break; }
      const k = t.age / t.life;
      if (k > worst) { worst = k; slot = t; }
    }
    const t = slot;
    t.alive = true;
    t.x = t.ox = x; t.y = t.oy = y;
    t.vx = (rand() - 0.5) * (small ? 14 : 10);
    t.age = 0;
    t.life = crit ? 1.0 : small ? 0.6 : o.player ? 1.0 : 0.8;
    t.str = str;
    t.color = color;
    t.crit = crit; t.small = small; t.damage = !!o.damage; t.player = !!o.player;
    t.value = o.damage ? (parseFloat(str) || 0) : 0;
    t.size = crit ? 1.45 : small ? 0.78 : o.player ? 1.15 : 1;
    t.pop = crit ? 1 : 0.4;
  }

  // ------------------------------------------------------------------------------------------
  // shapes, screen effects, lights
  // ------------------------------------------------------------------------------------------
  _slot(pool) {
    let best = pool[0];
    for (let i = 0; i < pool.length; i++) {
      const it = pool[i];
      if (it.t <= 0) return it;
      if (it.t < best.t) best = it;
    }
    return best;
  }

  ring(x, y, radius, color, duration) {
    const r = this._slot(this.rings);
    r.x = x; r.y = y; r.r = radius > 0 ? radius : 16; r.color = color || '#ffffff';
    r.dur = r.t = duration > 0 ? duration : 0.35;
  }

  beam(x0, y0, x1, y1, color, width, duration) {
    const b = this._slot(this.beams);
    b.x0 = x0; b.y0 = y0; b.x1 = x1; b.y1 = y1; b.color = color || '#ffffff';
    b.width = width > 0 ? width : 3;
    b.dur = b.t = duration > 0 ? duration : 0.12;
  }

  /** Jagged bolt; `duration` (optional, s) defaults to 0.2. */
  lightning(x0, y0, x1, y1, color, duration) {
    const b = this._slot(this.bolts);
    b.x0 = x0; b.y0 = y0; b.x1 = x1; b.y1 = y1; b.color = color || '#ffe75a';
    b.dur = b.t = duration > 0 ? Math.min(1, duration) : 0.2;
    b.jt = 0;
    this._jag(b);
    this.light((x0 + x1) / 2, (y0 + y1) / 2, Math.min(90, 24 + Math.hypot(x1 - x0, y1 - y0) * 0.5), b.color, 0.18);
    this.burst('shock', x1, y1, { count: 3, color: b.color });
  }

  _jag(b) {
    const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(3, Math.min(BOLT_PTS - 1, Math.round(len / 9)));
    const nx = -dy / len, ny = dx / len;
    const amp = Math.min(9, 2 + len * 0.08);
    const pts = b.pts;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = i === 0 || i === n ? 0 : (rand() - 0.5) * 2 * amp * Math.sin(t * Math.PI);
      pts[i * 2] = b.x0 + dx * t + nx * off;
      pts[i * 2 + 1] = b.y0 + dy * t + ny * off;
    }
    b.n = n + 1;
  }

  shake(amount, duration) {
    const s = this._s();
    let mul = s && s.shake != null ? +s.shake : 1;
    if (!(mul >= 0)) mul = 1;
    if (s && s.reducedMotion) mul *= 0.3;
    const amp = Math.min(12, (amount || 0) * mul);
    if (!(amp > 0)) return;
    const dur = duration > 0 ? duration : 0.25;
    const cur = this.shakeDur > 0 ? this.shakeAmp * (this.shakeT / this.shakeDur) : 0;
    if (amp >= cur) { this.shakeAmp = amp; this.shakeT = this.shakeDur = Math.max(dur, cur > 0 ? this.shakeT : 0); }
  }

  flash(color, duration) {
    const s = this._s();
    if (s && s.flashes === false) return;
    this.flashColor = color || '#ffffff';
    this.flashDur = this.flashT = duration > 0 ? duration : 0.15;
    this.flashMax = s && s.reducedMotion ? 0.14 : 0.3;
  }

  light(x, y, radius, color, duration) {
    const L = this._slot(this.lightPool);
    L.x = x; L.y = y; L.r = radius > 0 ? radius : 40; L.color = color || '#ffb066';
    L.dur = L.t = duration > 0 ? duration : 0.3;
  }

  hitstop(seconds) {
    if (!(seconds > 0)) return;
    this.hitstopT = Math.max(this.hitstopT, Math.min(0.3, seconds));
  }

  /**
   * Life drain (lifesteal / vampirism feedback): a few glowing motes leave (x0, y0) on a curved path and home onto
   * the moving `target` (usually the player) over ~0.35 s. Pooled; the oldest mote is reused when the pool is full.
   */
  drain(x0, y0, target, color, amount) {
    if (!(x0 === x0) || !(y0 === y0)) return;
    if (this.onDrain) { try { this.onDrain(amount, target); } catch { /* listeners never break gameplay */ } }
    const s = this._s();
    let n = Math.round(1.5 + Math.min(4.5, (amount > 0 ? amount : 1) * 0.45));
    if (s && s.reducedMotion) n = Math.max(1, Math.round(n * 0.6));
    const tgt = target && target.x === target.x ? target : null;
    const tx = tgt ? tgt.x : x0, ty = tgt ? tgt.y - 3 : y0 - 12;
    const dx = tx - x0, dy = ty - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i < n; i++) {
      const m = this._slot(this.motes);
      const side = (i & 1 ? 1 : -1) * (0.35 + rand() * 0.45);
      const bulge = Math.min(36, 10 + len * 0.3);
      m.x0 = m.x = m.px = x0 + (rand() - 0.5) * 6;
      m.y0 = m.y = m.py = y0 + (rand() - 0.5) * 6 - 2;
      // control point: sideways + a little upward, so each mote arcs before diving in
      m.cx = x0 + dx * 0.25 + nx * bulge * side;
      m.cy = y0 + dy * 0.25 + ny * bulge * side - 8 - rand() * 6;
      m.tx = tx; m.ty = ty;
      m.target = tgt;
      m.color = color || '#ff3a4a';
      m.size = amount >= 6 && i === 0 ? 2 : 1;
      m.arrived = false;
      m.delay = i * 0.035 + rand() * 0.03;
      m.dur = m.t = DRAIN_DUR * (0.85 + rand() * 0.3) + m.delay;
    }
  }

  /**
   * Visual payoff for `status:burst` { target, id, x, y, damage, radius?, chain? }. `world` (optional) supplies nearby
   * enemies for the discharge chain when the payload does not list the chained targets.
   */
  statusBurst(p, world) {
    if (!p) return;
    const tg = p.target || null;
    const x = Number.isFinite(p.x) ? p.x : tg ? tg.x : NaN;
    const y = Number.isFinite(p.y) ? p.y : tg ? tg.y : NaN;
    if (!(x === x) || !(y === y)) return;
    const look = BURST_LOOK[p.id];
    if (!look) return;
    const r = (tg && tg.r) || 6;
    const big = tg && tg.boss ? 1.6 : 1;
    if (p.id === 'bleed') {
      this.ring(x, y, (r + 20) * big, look.ring, 0.42);
      this.ring(x, y, (r + 9) * big, '#ff8a8e', 0.22);
      this.burst('hemorrhage', x, y - 3, { count: 26 });
      this.burst('blood', x, y - 2, { count: 10, angle: -Math.PI / 2, spread: 2.4, speed: 150 });
      this.light(x, y, 58 * big, look.light, 0.32);
      this.shake(2.6, 0.2);
    } else if (p.id === 'poison') {
      const R = p.radius > 0 ? p.radius : ERUPT_RADIUS;
      this.ring(x, y, R, look.ring, 0.55);
      this.ring(x, y, R * 0.5, '#d8ff9a', 0.3);
      this.burst('eruption', x, y, { count: 20 });
      this.light(x, y, R + 14, look.light, 0.45);
      this.shake(1.6, 0.14);
    } else {
      // Entladung: bright flash at the origin, then the bolt jumps along the chain
      this.light(x, y, 74 * big, '#fff6c8', 0.26);
      this.ring(x, y, (r + 13) * big, look.ring, 0.24);
      this.burst('light', x, y, { count: 10, color: '#fffbe0', speed: 120 });
      this.burst('shock', x, y, { count: 12 });
      const chain = this._chain(p, tg, x, y, world);
      let px = x, py = y;
      for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        this.lightning(px, py, c.x, c.y, i === 0 ? '#fff3a0' : '#ffe75a', 0.32);
        px = c.x; py = c.y;
      }
      this.shake(2, 0.14);
    }
    this.text(x, y - r - 13, look.label, look.color, { small: true });
  }

  /** Points the discharge jumps through: payload.chain/targets when given, else the nearest enemies hop by hop. */
  _chain(p, origin, x, y, world) {
    const given = Array.isArray(p.chain) ? p.chain : Array.isArray(p.targets) ? p.targets : Array.isArray(p.hits) ? p.hits : null;
    const out = [];
    if (given) {
      for (let i = 0; i < given.length && out.length < 8; i++) {
        const c = given[i];
        if (c && c !== origin && Number.isFinite(c.x) && Number.isFinite(c.y)) out.push(c);
      }
      return out;
    }
    const es = world && Array.isArray(world.enemies) ? world.enemies : null;
    if (!es) return out;
    let cx = x, cy = y;
    const used = new Set();
    if (origin) used.add(origin);
    while (out.length < CHAIN_MAX) {
      let best = null, bd = CHAIN_RANGE * CHAIN_RANGE;
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        if (!e || e.dead || e.hidden || e.untargetable || e.spawnT > 0 || used.has(e)) continue;
        const d = (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      used.add(best);
      out.push(best);
      cx = best.x; cy = best.y;
    }
    return out;
  }

  /** Current flash overlay alpha (0 when none). */
  get flashAlpha() {
    return this.flashT > 0 && this.flashDur > 0 ? this.flashMax * (this.flashT / this.flashDur) : 0;
  }

  // ------------------------------------------------------------------------------------------
  // simulation
  // ------------------------------------------------------------------------------------------
  update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    if (this.hitstopT > 0) this.hitstopT = Math.max(0, this.hitstopT - dt);
    // shake
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeDur > 0 ? this.shakeT / this.shakeDur : 0;
      const a = this.shakeAmp * k * k;
      const t = this.time;
      this.shakeX = a * (Math.sin(t * 67.3) * 0.62 + Math.sin(t * 121.7 + 1.3) * 0.38);
      this.shakeY = a * (Math.cos(t * 59.1) * 0.62 + Math.sin(t * 97.3 + 0.7) * 0.38);
    } else { this.shakeX = 0; this.shakeY = 0; this.shakeAmp = 0; }
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);

    // particles (slowed during hitstop for a freeze-frame feel)
    const pdt = this.hitstopT > 0 ? dt * 0.15 : dt;
    let live = 0;
    const parts = this.parts;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = parts[i];
      if (p.t <= 0) continue;
      p.t -= pdt;
      if (p.t <= 0) continue;
      live++;
      const dr = 1 / (1 + p.drag * pdt);
      p.vx *= dr;
      p.vy = p.vy * dr + p.gravity * pdt;
      p.x += p.vx * pdt;
      p.y += p.vy * pdt;
    }
    this.liveParticles = live;

    // texts
    for (let i = 0; i < MAX_TEXTS; i++) {
      const t = this.texts[i];
      if (!t.alive) continue;
      t.age += dt;
      if (t.age >= t.life) { t.alive = false; continue; }
      if (t.pop > 0) t.pop = Math.max(0, t.pop - dt * 7);
      const u = t.age / t.life;
      t.x = t.ox + t.vx * u;
      t.y = t.oy - (t.small ? 10 : 16) * easeOut(Math.min(1, u * 1.6));
    }
    // pools
    const pools = this._pools;
    for (let k = 0; k < pools.length; k++) {
      const pool = pools[k];
      for (let i = 0; i < pool.length; i++) if (pool[i].t > 0) pool[i].t -= dt;
    }
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = this.bolts[i];
      if (b.t <= 0) continue;
      b.jt -= dt;
      if (b.jt <= 0) { b.jt = 0.045; this._jag(b); }
    }
    // drain motes: quadratic curve from the source via the control point onto the (moving) target
    let lm = 0;
    for (let i = 0; i < MAX_MOTES; i++) {
      const m = this.motes[i];
      if (m.t <= 0) continue;
      if (m.arrived) { // it was drawn on the target last frame: free the slot
        if (m.target && (m.size > 1 || rand() < 0.4)) this.burst('heal', m.tx, m.ty, { count: 1, color: m.color });
        m.t = 0; m.target = null; m.arrived = false;
        continue;
      }
      m.t -= dt;
      lm++;
      const el = m.dur - m.t;
      if (el < m.delay) continue;
      const tg = m.target;
      if (tg && tg.x === tg.x && tg.y === tg.y) { m.tx = tg.x; m.ty = tg.y - 3; }
      const u = Math.min(1, (el - m.delay) / Math.max(0.01, m.dur - m.delay));
      const e = 0.25 * u + 0.75 * u * u;
      const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e;
      m.px = m.x; m.py = m.y;
      m.x = a * m.x0 + b * m.cx + c * m.tx;
      m.y = a * m.y0 + b * m.cy + c * m.ty;
      // the step that reaches the end lands exactly on the target and stays drawable for that frame
      if (u >= 1 || m.t <= 0) { m.arrived = true; m.t = Math.max(m.t, 1e-4); }
    }
    this.liveMotes = lm;
  }

  /** Remove everything (room change). */
  clear() {
    for (let i = 0; i < MAX_PARTICLES; i++) this.parts[i].t = 0;
    for (let i = 0; i < MAX_TEXTS; i++) this.texts[i].alive = false;
    for (const pool of this._pools) for (const it of pool) it.t = 0;
    for (const m of this.motes) { m.t = 0; m.target = null; m.arrived = false; }
    this.liveParticles = 0;
    this.liveMotes = 0;
    this.hitstopT = 0;
    this.shakeT = 0; this.shakeX = 0; this.shakeY = 0; this.shakeAmp = 0;
  }

  /** Counts for debugging / perf overlays. */
  stats() {
    let texts = 0;
    for (const t of this.texts) if (t.alive) texts++;
    let motes = 0;
    for (const m of this.motes) if (m.t > 0) motes++;
    return { particles: this.liveParticles, texts, motes };
  }

  // ------------------------------------------------------------------------------------------
  // drawing (called by the renderer; ctx is in world space)
  // ------------------------------------------------------------------------------------------
  drawRings(ctx) {
    let any = false;
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = this.rings[i];
      if (r.t <= 0) continue;
      if (!any) { any = true; ctx.globalCompositeOperation = 'lighter'; }
      const u = 1 - r.t / r.dur;
      const rad = r.r * (0.12 + 0.88 * easeOut(u));
      const a = (1 - u);
      ctx.strokeStyle = r.color;
      ctx.fillStyle = r.color;
      ctx.globalAlpha = 0.1 * a;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.85 * a;
      ctx.lineWidth = Math.max(1, 3 * (1 - u));
      ctx.stroke();
    }
    if (any) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }

  /** Particles, beams and lightning. (vx, vy, vw, vh) = view rect in world px for culling. */
  drawParticles(ctx, vx, vy, vw, vh) {
    const parts = this.parts;
    const x0 = vx - 8, y0 = vy - 8, x1 = vx + vw + 8, y1 = vy + vh + 8;
    // pass 1: normal blending
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = parts[i];
      if (p.t <= 0 || p.add) continue;
      if (p.x < x0 || p.y < y0 || p.x > x1 || p.y > y1) continue;
      const k = p.t / p.life;
      const size = p.size1 + (p.size - p.size1) * k;
      if (size < 0.35) continue;
      ctx.globalAlpha = p.alpha * (k < 0.4 ? k / 0.4 : 1);
      if (p.shape === SOFT) {
        const spr = glowSprite(p.color);
        if (spr) { const d = size * 2.2; ctx.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d); continue; }
      }
      ctx.fillStyle = p.color;
      const s = size < 1 ? 1 : Math.round(size);
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    // pass 2: additive
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = parts[i];
      if (p.t <= 0 || !p.add) continue;
      if (p.x < x0 || p.y < y0 || p.x > x1 || p.y > y1) continue;
      const k = p.t / p.life;
      const size = p.size1 + (p.size - p.size1) * k;
      let a = p.alpha * (k < 0.5 ? k / 0.5 : 1);
      if (p.flicker) a *= 0.65 + 0.35 * Math.sin(this.time * 31 + i);
      if (a <= 0.01) continue;
      if (p.glow) {
        const spr = glowSprite(p.color);
        if (spr) {
          const d = 3 + size * 3.2;
          ctx.globalAlpha = a * 0.32;
          ctx.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d);
        }
      }
      ctx.globalAlpha = a;
      if (p.shape === STREAK) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = size < 1 ? 1 : size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = p.color;
      const s = size < 1 ? 1 : Math.round(size);
      const px = Math.round(p.x - s / 2), py = Math.round(p.y - s / 2);
      if (p.shape === TWINKLE && s >= 2) {
        ctx.fillRect(px - 1, py + (s >> 1) - 0, s + 2, 1);
        ctx.fillRect(px + (s >> 1), py - 1, 1, s + 2);
      } else ctx.fillRect(px, py, s, s);
    }
    // drain motes (additive): soft halo, short streak, hot core
    if (this.liveMotes > 0) {
      for (let i = 0; i < MAX_MOTES; i++) {
        const m = this.motes[i];
        if (m.t <= 0 || m.dur - m.t < m.delay) continue;
        const k = m.t / m.dur;
        const a = k > 0.85 ? (1 - k) / 0.15 : 1;
        const spr = glowSprite(m.color);
        if (spr) {
          const d = 6 + m.size * 3;
          ctx.globalAlpha = 0.55 * a;
          ctx.drawImage(spr, m.x - d / 2, m.y - d / 2, d, d);
        }
        ctx.globalAlpha = 0.85 * a;
        ctx.strokeStyle = m.color;
        ctx.lineWidth = m.size;
        ctx.beginPath(); ctx.moveTo(m.px, m.py); ctx.lineTo(m.x, m.y); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffd6da';
        ctx.fillRect(Math.round(m.x - m.size / 2), Math.round(m.y - m.size / 2), m.size, m.size);
      }
    }
    // beams
    ctx.lineCap = 'round';
    for (let i = 0; i < MAX_BEAMS; i++) {
      const b = this.beams[i];
      if (b.t <= 0) continue;
      const k = b.t / b.dur;
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.35 * k;
      ctx.lineWidth = b.width * 2.2;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.globalAlpha = 0.9 * k;
      ctx.lineWidth = b.width * (0.7 + 0.3 * k);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = k;
      ctx.lineWidth = Math.max(1, b.width * 0.35);
      ctx.stroke();
    }
    // lightning
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = this.bolts[i];
      if (b.t <= 0) continue;
      const k = b.t / b.dur;
      const pts = b.pts;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let j = 1; j < b.n; j++) ctx.lineTo(pts[j * 2], pts[j * 2 + 1]);
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.45 * k;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = k;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Combat texts on the crisp overlay canvas. ox/oy: camera top-left in world px, k: device px per world px,
   * minPx: minimum base font size in device px.
   */
  drawTexts(ctx, ox, oy, k, minPx) {
    let any = false;
    let lastFont = '';
    for (let i = 0; i < MAX_TEXTS; i++) {
      const t = this.texts[i];
      if (!t.alive) continue;
      if (!any) {
        any = true;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(12,6,10,0.92)';
      }
      const u = t.age / t.life;
      const base = Math.max(minPx || 10, 5.2 * k);
      const px = Math.round(base * t.size * (1 + 0.55 * t.pop));
      const font = (t.crit ? '900 ' : '700 ') + px + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      ctx.globalAlpha = u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1;
      const sx = Math.round((t.x - ox) * k), sy = Math.round((t.y - oy) * k);
      ctx.lineWidth = Math.max(2, px * 0.24);
      ctx.strokeText(t.str, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, sx, sy);
    }
    if (any) ctx.globalAlpha = 1;
    return any;
  }
}

export default Fx;
