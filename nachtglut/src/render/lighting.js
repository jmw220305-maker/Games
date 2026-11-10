// Lighting: a darkness overlay with soft punched-out lights plus additive coloured glows.
// Also hosts the shared cached gradient sprites (glow, light, shadow, vignette) used by fx.js,
// renderer.js and menubg.js. DOM-free at import time: canvases are created lazily on first use,
// gradients are only ever created once per cached sprite (never per frame).
import { TS, TILE } from '../game/constants.js';

export const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

export function makeCanvas(w, h) {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Colour helpers (cached)
// ---------------------------------------------------------------------------------------------
const rgbCache = new Map();
let normCtx = null;

/** css colour → [r, g, b] (hex fast path; other formats normalised through a 1×1 canvas when available). */
export function parseRGB(color) {
  let v = rgbCache.get(color);
  if (v) return v;
  let s = String(color == null ? '#ffffff' : color).trim();
  v = null;
  for (let pass = 0; pass < 2 && !v; pass++) {
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h.slice(0, 6), 16);
      if (h.length >= 6 && !Number.isNaN(n)) v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
      const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
      if (m) v = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    }
    if (!v && pass === 0 && hasDom()) {
      if (!normCtx) normCtx = makeCanvas(1, 1).getContext('2d');
      normCtx.fillStyle = '#ffffff';
      normCtx.fillStyle = s;
      s = String(normCtx.fillStyle);
    }
  }
  if (!v) v = [255, 255, 255];
  if (rgbCache.size > 1024) rgbCache.clear();
  rgbCache.set(color, v);
  return v;
}

const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16);
export const toHex = (r, g, b) => '#' + hex2(r & 255) + hex2(g & 255) + hex2(b & 255);

const shadeCache = new Map();
/** Mix a colour toward white (t > 0) or black (t < 0). Returns '#rrggbb'. Cached. */
export function shade(color, t) {
  const key = color + '|' + t;
  let out = shadeCache.get(key);
  if (out) return out;
  const [r, g, b] = parseRGB(color);
  const tgt = t >= 0 ? 255 : 0, k = Math.min(1, Math.abs(t));
  out = toHex(Math.round(r + (tgt - r) * k), Math.round(g + (tgt - g) * k), Math.round(b + (tgt - b) * k));
  if (shadeCache.size > 2048) shadeCache.clear();
  shadeCache.set(key, out);
  return out;
}

const rgbaStr = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

// ---------------------------------------------------------------------------------------------
// Cached sprites
// ---------------------------------------------------------------------------------------------
const GLOW_CAP = 160;
const glowCache = new Map();

/** Soft radial blob in `color` (opaque centre → transparent edge), 64×64. Cached per colour (LRU-ish). */
export function glowSprite(color) {
  let c = glowCache.get(color);
  if (c !== undefined) return c;
  c = makeCanvas(64, 64);
  if (c) {
    const g = c.getContext('2d');
    const rgb = parseRGB(color);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgbaStr(rgb, 1));
    grad.addColorStop(0.22, rgbaStr(rgb, 0.62));
    grad.addColorStop(0.55, rgbaStr(rgb, 0.2));
    grad.addColorStop(1, rgbaStr(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  if (glowCache.size >= GLOW_CAP) glowCache.delete(glowCache.keys().next().value);
  glowCache.set(color, c);
  return c;
}

let _light = null;
/** White soft light used with destination-out to punch holes into the darkness. */
export function lightSprite() {
  if (_light) return _light;
  const c = makeCanvas(128, 128);
  if (!c) return null;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.94)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _light = c;
  return c;
}

let _shadow = null;
/** Soft black disc; draw it squashed for ellipse shadows. */
export function shadowSprite() {
  if (_shadow) return _shadow;
  const c = makeCanvas(32, 32);
  if (!c) return null;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  _shadow = c;
  return c;
}

const vigCache = new Map();
/** Vignette: transparent centre → `color` at the edges, 128×128, stretched over the view. */
export function vignetteSprite(color = '#000000', strength = 1) {
  const key = color + '|' + strength;
  let c = vigCache.get(key);
  if (c !== undefined) return c;
  c = makeCanvas(128, 128);
  if (c) {
    const g = c.getContext('2d');
    const rgb = parseRGB(color);
    const grad = g.createRadialGradient(64, 64, 18, 64, 64, 92);
    grad.addColorStop(0, rgbaStr(rgb, 0));
    grad.addColorStop(0.55, rgbaStr(rgb, 0.18 * strength));
    grad.addColorStop(1, rgbaStr(rgb, Math.min(1, 0.85 * strength)));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  vigCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Lighting pass
// ---------------------------------------------------------------------------------------------
const MAX_LIGHTS = 192;
const MAX_HAZARD_LIGHTS = 24;
const LIGHT_RES = 0.5;          // darkness buffer resolution relative to the logical view (soft anyway)
const PLAYER_LIGHT = '#ffb066';
const PICKUP_LIGHT = { spark: '#ffd35a', xp: '#8fd8ff', heart: '#ff6a7a', ash: '#c9c2b8', shield: '#9ad0ff' };

export class Lighting {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.w = 0; this.h = 0;
    this.enabled = true;
    this.lx = new Float32Array(MAX_LIGHTS);
    this.ly = new Float32Array(MAX_LIGHTS);
    this.lr = new Float32Array(MAX_LIGHTS);
    this.li = new Float32Array(MAX_LIGHTS);   // punch intensity 0..1
    this.lg = new Float32Array(MAX_LIGHTS);   // additive glow alpha
    this.lc = new Array(MAX_LIGHTS).fill('#ffffff');
    this.n = 0;
    this.hazards = new WeakMap();             // room → Float32Array [x, y, r, 0, …] of hazard lights
    this._hzCols = new WeakMap();             // room → colour per hazard light (or empty → biome accent)
    this._hz = new Int32Array(1024);
    this.roomLights = null;                   // optional art helper: roomLights(room, biome) → [{ x, y, r, color }]
    // view rect used for culling while gathering
    this.vx = 0; this.vy = 0; this.vw = 0; this.vh = 0;
  }

  resize(w, h) {
    const bw = Math.max(1, Math.ceil(w * LIGHT_RES)), bh = Math.max(1, Math.ceil(h * LIGHT_RES));
    if (!this.canvas) {
      this.canvas = makeCanvas(bw, bh);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
    } else if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw; this.canvas.height = bh;
    }
    this.w = w; this.h = h;
    this.ctx.imageSmoothingEnabled = true;
  }

  /** Add a light (world px). Culled against the current view. */
  add(x, y, r, color, intensity = 1, glow = 0) {
    if (this.n >= MAX_LIGHTS || !(r > 0)) return;
    if (x + r < this.vx || y + r < this.vy || x - r > this.vx + this.vw || y - r > this.vy + this.vh) return;
    const i = this.n++;
    this.lx[i] = x; this.ly[i] = y; this.lr[i] = r;
    this.li[i] = intensity > 1 ? 1 : intensity; this.lg[i] = glow; this.lc[i] = color;
  }

  /** Collect every light of the frame. */
  gather(world, fx, camX, camY, vw, vh, time) {
    this.n = 0;
    this.vx = camX; this.vy = camY; this.vw = vw; this.vh = vh;
    const p = world.player;
    // player
    if (p) {
      let r = (p.stats && p.stats.lightRadius) || 110;
      r *= 1 + Math.sin(time * 7.3) * 0.022 + Math.sin(time * 13.1 + 1.7) * 0.014;
      if (p.alive === false) r *= 0.75;
      this.add(p.x, p.y - 2, r, PLAYER_LIGHT, 1, 0.16);
    }
    // fx lights (explosions, skills)
    fx = fx || world.fx;
    if (fx && fx.lightPool) {
      const pool = fx.lightPool;
      for (let i = 0; i < pool.length; i++) {
        const L = pool[i];
        if (L.t <= 0) continue;
        const k = L.dur > 0 ? L.t / L.dur : 1;
        this.add(L.x, L.y, L.r * (0.75 + 0.25 * k), L.color, k, 0.55 * k);
      }
    }
    // props
    const props = world.props;
    if (props) {
      for (let i = 0; i < props.length; i++) {
        const pr = props[i];
        if (pr.removed || !pr.light) continue;
        let r = pr.light.r || 40, inten = 0.95;
        if (pr.kind === 'torch') {
          const ph = pr.x * 0.37 + pr.y * 0.11;
          const f = Math.sin(time * 9.1 + ph) * 0.05 + Math.sin(time * 23.7 + ph * 2) * 0.035 + Math.sin(time * 3.1 + ph) * 0.03;
          r *= 1 + f; inten = 0.88 + f;
        } else if (pr.kind === 'crystal' || pr.kind === 'portal') {
          r *= 1 + Math.sin(time * 2.2 + pr.x) * 0.06;
        }
        this.add(pr.x, pr.y - 4, r, pr.light.color || '#ffb066', inten, 0.3);
      }
    }
    // enemies with own lights; everything else gets a faint rim so it never vanishes in the dark
    const es = world.enemies;
    if (es) {
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        if (e.dead || e.hidden) continue;
        const L = e.def && e.def.light;
        const sp = e.spawnT > 0 ? 0.5 : 1;
        if (L) this.add(e.x, e.y, (L.r || 30) * sp, L.color || e.def.color || '#ffffff', 0.9 * sp, 0.3 * sp);
        else this.add(e.x, e.y, (e.r || 6) * (e.boss ? 3.4 : 2.8), '#ffffff', 0.2 * sp, 0);
      }
    }
    // zones: telegraphs glow faintly so they read in the dark, active zones a bit more
    const zs = world.zones;
    if (zs) {
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.dead) continue;
        let x = z.x, y = z.y, r = z.r || 16;
        if (z.shape === 'line') {
          x = (z.x + z.x2) / 2; y = (z.y + z.y2) / 2;
          r = Math.hypot(z.x2 - z.x, z.y2 - z.y) / 2 + (z.width || 8);
        }
        if (z.active) this.add(x, y, r * 1.25, z.color || '#ff5a3c', 0.35, 0.18);
        else if (z.team !== 'player') {
          const k = z.delay > 0 ? Math.min(1, z.age / z.delay) : 1;
          this.add(x, y, r * 1.15, z.color || '#ff5a3c', 0.22 + 0.3 * k, 0.06 + 0.1 * k);
        }
      }
    }
    // projectiles
    const ps = world.projectiles;
    if (ps) {
      for (let i = 0; i < ps.length; i++) {
        const q = ps[i];
        if (q.dead || !q.light) continue;
        this.add(q.x, q.y - (q.z || 0), q.light.r || 20, q.light.color || q.color || '#ffb347', 0.9, 0.22);
      }
    }
    // pickups (tiny)
    const pk = world.pickups;
    if (pk) {
      for (let i = 0; i < pk.length; i++) {
        const k = pk[i];
        if (k.dead) continue;
        this.add(k.x, k.y, k.kind === 'heart' ? 16 : 12, PICKUP_LIGHT[k.kind] || '#ffd35a', 0.55, 0.25);
      }
    }
    // hazard tiles: capped, culled sample of the ones in view
    const room = world.room, biome = world.biome;
    if (room && room.tiles) {
      const list = this.hazardLights(room, biome);
      const nl = list.length / 4;
      if (nl) {
        let m = 0;
        const hz = this._hz;
        const x0 = camX - 32, y0 = camY - 32, x1 = camX + vw + 32, y1 = camY + vh + 32;
        for (let i = 0; i < nl && m < hz.length; i++) {
          const x = list[i * 4], y = list[i * 4 + 1];
          if (x < x0 || y < y0 || x > x1 || y > y1) continue;
          hz[m++] = i;
        }
        if (m) {
          const stride = Math.max(1, Math.ceil(m / MAX_HAZARD_LIGHTS));
          const cols = this._hzCols.get(room) || [];
          for (let k = 0; k < m; k += stride) {
            const i = hz[k];
            const f = Math.sin(time * 2.6 + i * 1.7) * 0.12;
            const r = list[i * 4 + 2] + (stride - 1) * 4;
            this.add(list[i * 4], list[i * 4 + 1], r, cols[i] || (biome && biome.accent) || '#ff7a2f', 0.45 + f, 0.2 + f * 0.5);
          }
        }
      }
    }
  }

  /** Flat [x, y, r, 0, …] list of hazard lights for a room: art's roomLights() when available, else every HAZARD tile. */
  hazardLights(room, biome) {
    let list = this.hazards.get(room);
    if (list) return list;
    let src = null;
    if (this.roomLights) {
      try { src = this.roomLights(room, biome); } catch (err) { console.warn('[lighting] roomLights failed', err); src = null; }
    }
    const cols = [];
    if (Array.isArray(src)) {
      list = new Float32Array(src.length * 4);
      src.forEach((L, i) => { list[i * 4] = L.x; list[i * 4 + 1] = L.y; list[i * 4 + 2] = L.r || 22; cols.push(L.color || null); });
    } else {
      const out = [];
      const t = room.tiles, W = room.w;
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== TILE.HAZARD) continue;
        const tx = i % W, ty = (i - tx) / W;
        out.push((tx + 0.5) * TS, (ty + 0.5) * TS, 24, 0);
      }
      list = Float32Array.from(out);
    }
    this.hazards.set(room, list);
    this._hzCols.set(room, cols);
    return list;
  }

  /**
   * Glow pass + darkness composite. `ctx` is the logical game canvas (any transform; it is reset here).
   * fx: the Fx instance whose temporary lights are included.
   * darkness: 0..1 alpha of the unlit areas; fog: colour of the darkness.
   */
  render(ctx, world, fx, camX, camY, vw, vh, time, darkness, fog) {
    if (!this.enabled) return;
    if (!this.canvas || this.w !== vw || this.h !== vh) this.resize(vw, vh);
    if (!this.canvas) return;
    this.gather(world, fx, camX, camY, vw, vh, time);
    const n = this.n, lx = this.lx, ly = this.ly, lr = this.lr, li = this.li, lg = this.lg, lc = this.lc;

    // 1) additive coloured glows on the scene
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = lg[i] * li[i];
      if (a < 0.01) continue;
      const spr = glowSprite(lc[i]);
      if (!spr) continue;
      const r = lr[i] * 0.72;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(spr, lx[i] - camX - r, ly[i] - camY - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 2) darkness with punched-out lights (half resolution, smoothed when composited)
    if (!(darkness > 0.01)) return;
    const d = this.ctx, s = LIGHT_RES;
    const bw = this.canvas.width, bh = this.canvas.height;
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    d.clearRect(0, 0, bw, bh);
    d.globalAlpha = darkness > 1 ? 1 : darkness;
    d.fillStyle = fog || '#000';
    d.fillRect(0, 0, bw, bh);
    const ls = lightSprite();
    if (ls) {
      d.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < n; i++) {
        const r = lr[i] * s;
        d.globalAlpha = li[i] > 0 ? li[i] : 0;
        d.drawImage(ls, (lx[i] - camX) * s - r, (ly[i] - camY) * s - r, r * 2, r * 2);
      }
      d.globalCompositeOperation = 'source-over';
      d.globalAlpha = 1;
    }
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, bw, bh, 0, 0, bw / s, bh / s);
    ctx.imageSmoothingEnabled = prevSmooth;
  }
}
