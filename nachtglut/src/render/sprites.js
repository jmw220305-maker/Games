// Sprite service: every sprite is pre-rendered into small offscreen canvases (one per
// animation frame) from the procedural definitions in ./art/. `draw` is a plain drawImage.
// Import-safe in Node: nothing touches the DOM until a frame is actually needed.
import { DEFS, SPRITE_KEYS, GLYPH_NAMES } from './art/index.js';

export { SPRITE_KEYS, GLYPH_NAMES };

const TINT_CAP = 300;
const ICON_CAP = 600;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const FALLBACK_COLOR = '#ff3df2';
const TAU = Math.PI * 2;

const entries = new Map();    // key → entry | null
const tintCache = new Map();  // key|color → { [anim]: canvas[] }   (LRU)
const iconCache = new Map();  // key|color|px → data URL
const colorCache = new Map(); // css colour → [r, g, b]
let scratch = null;           // 1×1 canvas used to normalise exotic css colours

const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function toCanvas(buf) {
  const c = document.createElement('canvas');
  c.width = buf.w;
  c.height = buf.h;
  const g = c.getContext('2d');
  const img = g.createImageData(buf.w, buf.h);
  img.data.set(buf.bytes());
  g.putImageData(img, 0, 0);
  return c;
}

function entry(key) {
  let e = entries.get(key);
  if (e !== undefined) return e;
  const def = DEFS.get(key);
  if (!def) {
    if (entries.size < 4096) entries.set(key, null);
    return null;
  }
  e = { key, w: def.w, h: def.h, hw: def.w / 2, hh: def.h / 2, tint: !!def.tint, size: Object.freeze({ w: def.w, h: def.h }), anims: {} };
  for (const name of Object.keys(def.anims)) {
    const a = def.anims[name];
    e.anims[name] = { name, fps: a.fps, n: a.n, src: a, bufs: new Array(a.n), frames: new Array(a.n), white: new Array(a.n) };
  }
  entries.set(key, e);
  return e;
}

const frameBuf = (an, i) => an.bufs[i] || (an.bufs[i] = an.src.render(i));
const frame = (an, i) => an.frames[i] || (an.frames[i] = toCanvas(frameBuf(an, i)));
const whiteFrame = (an, i) => an.white[i] || (an.white[i] = toCanvas(frameBuf(an, i).whitened()));

function parseColor(css) {
  let rgb = colorCache.get(css);
  if (rgb) return rgb;
  rgb = null;
  let s = String(css).trim();
  for (let pass = 0; pass < 2 && !rgb; pass++) {
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map((ch) => ch + ch).join('');
      if (h.length >= 6) {
        const n = parseInt(h.slice(0, 6), 16);
        if (!Number.isNaN(n)) rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
    } else {
      const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
      if (m) rgb = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    }
    if (!rgb && pass === 0 && hasDom()) {
      // let the browser normalise named colours / hsl() etc.
      if (!scratch) scratch = document.createElement('canvas').getContext('2d');
      scratch.fillStyle = '#000';
      scratch.fillStyle = s;
      s = String(scratch.fillStyle);
    }
  }
  if (!rgb) rgb = [255, 255, 255];
  if (colorCache.size > 2000) colorCache.clear();
  colorCache.set(css, rgb);
  return rgb;
}

function tintedFrame(e, an, i, color) {
  const ck = e.key + '|' + color;
  let t = tintCache.get(ck);
  if (t) {
    tintCache.delete(ck); // refresh LRU position
    tintCache.set(ck, t);
  } else {
    t = {};
    tintCache.set(ck, t);
    if (tintCache.size > TINT_CAP) tintCache.delete(tintCache.keys().next().value);
  }
  const arr = t[an.name] || (t[an.name] = new Array(an.n));
  let c = arr[i];
  if (!c) {
    const rgb = parseColor(color);
    c = arr[i] = toCanvas(frameBuf(an, i).tinted(rgb[0], rgb[1], rgb[2]));
  }
  return c;
}

function fallback(ctx, x, y, opts) {
  const a = opts && opts.alpha !== undefined ? opts.alpha : 1;
  const prev = ctx.globalAlpha;
  if (a !== 1) ctx.globalAlpha = prev * a;
  ctx.fillStyle = (opts && opts.color) || FALLBACK_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, 5 * ((opts && opts.scale) || 1), 0, TAU);
  ctx.fill();
  if (a !== 1) ctx.globalAlpha = prev;
}

function resolveIconKey(spec) {
  if (typeof spec === 'string') {
    if (DEFS.has(spec)) return [spec, null];
    if (DEFS.has('glyph_' + spec)) return ['glyph_' + spec, null];
    return [spec, null];
  }
  if (spec && typeof spec === 'object') {
    const color = spec.color || null;
    if (spec.glyph) return [DEFS.has('glyph_' + spec.glyph) ? 'glyph_' + spec.glyph : String(spec.glyph), color];
    if (spec.sprite || spec.key) return [String(spec.sprite || spec.key), color];
    return ['', color];
  }
  return ['', null];
}

export const sprites = {
  /** Pre-build every base frame so nothing hitches mid-game. No-op without a DOM. */
  init() {
    if (!hasDom()) return false;
    for (const key of SPRITE_KEYS) {
      const e = entry(key);
      if (!e) continue;
      for (const name of Object.keys(e.anims)) {
        const an = e.anims[name];
        for (let i = 0; i < an.n; i++) frame(an, i);
      }
    }
    return true;
  },

  has(key) {
    return DEFS.has(key);
  },

  /** All registered sprite keys. */
  keys() {
    return SPRITE_KEYS.slice();
  },

  size(key) {
    const e = entry(key);
    return e ? e.size : { w: 10, h: 10 };
  },

  /** { w, h, tint, anims: { name: { fps, n } } } or null — for tools/debugging. */
  info(key) {
    const e = entry(key);
    if (!e) return null;
    const anims = {};
    for (const name of Object.keys(e.anims)) anims[name] = { fps: e.anims[name].fps, n: e.anims[name].n };
    return { w: e.w, h: e.h, tint: e.tint, anims };
  },

  /** Duration in seconds of one loop of an animation (0 for single-frame anims). */
  duration(key, anim = 'idle') {
    const e = entry(key);
    const an = e && (e.anims[anim] || e.anims.idle);
    return an && an.n > 1 ? an.n / an.fps : 0;
  },

  /**
   * Draw a sprite centred on (x, y).
   * opts: { anim='idle', t=0, flipX, flash (0..1), alpha, scale, rot, color (tintable keys only) }
   */
  draw(ctx, key, x, y, opts) {
    const e = entry(key);
    if (!e) {
      fallback(ctx, x, y, opts);
      return;
    }
    if (!opts) {
      ctx.drawImage(frame(e.anims.idle, 0), Math.round(x - e.hw), Math.round(y - e.hh));
      return;
    }
    const an = (opts.anim && e.anims[opts.anim]) || e.anims.idle;
    let i = 0;
    if (an.n > 1) {
      i = Math.floor((opts.t || 0) * an.fps) % an.n;
      if (!(i >= 0)) i = i < 0 ? i + an.n : 0;
    }
    const img = e.tint && opts.color ? tintedFrame(e, an, i, opts.color) : frame(an, i);
    const flash = opts.flash > 0 ? (opts.flash > 1 ? 1 : opts.flash) : 0;
    const a = opts.alpha;
    const base = ctx.globalAlpha;
    if (a !== undefined && a !== 1) ctx.globalAlpha = base * (a < 0 ? 0 : a);
    const s = opts.scale === undefined ? 1 : opts.scale;
    if (opts.flipX || opts.rot || s !== 1) {
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (opts.rot) ctx.rotate(opts.rot);
      ctx.scale(opts.flipX ? -s : s, s);
      ctx.drawImage(img, -e.hw, -e.hh);
      if (flash) {
        ctx.globalAlpha *= flash;
        ctx.drawImage(whiteFrame(an, i), -e.hw, -e.hh);
      }
      ctx.restore();
    } else {
      const dx = Math.round(x - e.hw), dy = Math.round(y - e.hh);
      ctx.drawImage(img, dx, dy);
      if (flash) {
        ctx.globalAlpha *= flash;
        ctx.drawImage(whiteFrame(an, i), dx, dy);
      }
    }
    ctx.globalAlpha = base;
  },

  /**
   * Data URL for DOM <img>. spec: sprite key | glyph name | { glyph, color } | { sprite, color }.
   * The low-res source is nearest-neighbour upscaled by an integer factor and centred.
   */
  icon(spec, px = 32) {
    px = Math.max(1, Math.round(px) || 32);
    const [key, color] = resolveIconKey(spec);
    const ck = key + '|' + (color || '') + '|' + px;
    const hit = iconCache.get(ck);
    if (hit) return hit;
    if (!hasDom()) return BLANK;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const e = entry(key);
    if (!e) {
      g.fillStyle = color || FALLBACK_COLOR;
      g.beginPath();
      g.arc(px / 2, px / 2, px * 0.3, 0, TAU);
      g.fill();
    } else {
      const an = e.anims.idle;
      const img = e.tint && color ? toCanvas(frameBuf(an, 0).tinted(...parseColor(color))) : frame(an, 0);
      let s = px / Math.max(e.w, e.h);
      if (s >= 1) s = Math.floor(s);
      const dw = Math.max(1, Math.round(e.w * s)), dh = Math.max(1, Math.round(e.h * s));
      g.drawImage(img, Math.round((px - dw) / 2), Math.round((px - dh) / 2), dw, dh);
    }
    let url = BLANK;
    try {
      url = c.toDataURL('image/png');
    } catch (err) {
      url = BLANK;
    }
    if (iconCache.size > ICON_CAP) iconCache.clear();
    iconCache.set(ck, url);
    return url;
  },
};

export default sprites;
