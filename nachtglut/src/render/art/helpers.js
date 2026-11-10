// Tiny software pixel-art toolkit. Pure JS (no DOM) so all art definitions can be
// imported and exercised in Node. Colours are packed 0xAABBGGRR (the byte order
// of ImageData on little-endian machines); 0 = fully transparent.

const hexCache = new Map();

/** Parse '#rgb' | '#rrggbb' | '#rrggbbaa' (or pass a packed number through). */
export function C(v) {
  if (typeof v === 'number') return v >>> 0;
  let c = hexCache.get(v);
  if (c !== undefined) return c;
  let s = v[0] === '#' ? v.slice(1) : v;
  if (s.length === 3 || s.length === 4) s = s.split('').map((ch) => ch + ch).join('');
  const r = parseInt(s.slice(0, 2), 16) || 0;
  const g = parseInt(s.slice(2, 4), 16) || 0;
  const b = parseInt(s.slice(4, 6), 16) || 0;
  const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255;
  c = pack(r, g, b, a);
  hexCache.set(v, c);
  return c;
}

export function pack(r, g, b, a = 255) {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}
export const cr = (c) => c & 255;
export const cg = (c) => (c >>> 8) & 255;
export const cb = (c) => (c >>> 16) & 255;
export const ca = (c) => c >>> 24;

/** Linear mix of two colours (strings or packed), t = 0 → a, 1 → b. */
export function mix(a, b, t) {
  a = C(a); b = C(b);
  const u = 1 - t;
  return pack(
    Math.round(cr(a) * u + cr(b) * t),
    Math.round(cg(a) * u + cg(b) * t),
    Math.round(cb(a) * u + cb(b) * t),
    Math.round(ca(a) * u + ca(b) * t),
  );
}
export function alpha(c, a) {
  c = C(c);
  return ((c & 0x00ffffff) | ((Math.round(a * 255) & 255) << 24)) >>> 0;
}
export const lighten = (c, t) => mix(c, alpha('#fff4dc', ca(C(c)) / 255), t);
export const darken = (c, t) => mix(c, alpha('#07040c', ca(C(c)) / 255), t);

/** 3-step ramp [dark, mid, light] with a slight hue shift (cool shadows, warm lights). */
export function ramp(base, dk = 0.42, lt = 0.3) {
  return [darken(base, dk), C(base), lighten(base, lt)];
}
/** 4-step ramp [dark, mid, light, highlight]. */
export function ramp4(base, dk = 0.42, lt = 0.28, hi = 0.6) {
  return [darken(base, dk), C(base), lighten(base, lt), lighten(base, hi)];
}
/** 5-step ramp for large volumes. */
export function ramp5(base, dk = 0.6, lt = 0.5) {
  return [darken(base, dk), darken(base, dk * 0.5), C(base), lighten(base, lt * 0.5), lighten(base, lt)];
}

export function toHex(c) {
  c = C(c);
  const h = (n) => n.toString(16).padStart(2, '0');
  return '#' + h(cr(c)) + h(cg(c)) + h(cb(c));
}

/** Deterministic integer hash → uint32. */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Hash → float in [0, 1). */
export const rnd2 = (x, y, seed = 0) => hash2(x, y, seed) / 4294967296;

export const OUTLINE = '#0b0709';
const SOLID = 200; // alpha above which a pixel counts as solid for outlines

export class Buf {
  constructor(w, h) {
    this.w = w | 0;
    this.h = h | 0;
    this.d = new Uint32Array(this.w * this.h);
  }

  clone() {
    const b = new Buf(this.w, this.h);
    b.d.set(this.d);
    return b;
  }

  get(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[y * this.w + x];
  }

  /** Is there a (mostly) opaque pixel here? */
  on(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[y * this.w + x] >>> 24 > 0;
  }

  px(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = C(c);
    return this;
  }

  /** Alpha-blend a colour over the existing pixel. */
  blend(x, y, c, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    c = C(c);
    const sa = (ca(c) / 255) * a;
    if (sa <= 0) return this;
    const i = y * this.w + x;
    const o = this.d[i];
    const oa = ca(o) / 255;
    const na = sa + oa * (1 - sa);
    if (na <= 0) return this;
    const f = (s, d) => Math.round((s * sa + d * oa * (1 - sa)) / na);
    this.d[i] = pack(f(cr(c), cr(o)), f(cg(c), cg(o)), f(cb(c), cb(o)), Math.round(na * 255));
    return this;
  }

  rect(x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    c = C(c);
    const x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) this.d[yy * this.w + xx] = c;
    }
    return this;
  }

  blendRect(x, y, w, h, c, a = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blend(xx, yy, c, a);
    return this;
  }

  hl(x, y, len, c) { return this.rect(x, y, len, 1, c); }
  vl(x, y, len, c) { return this.rect(x, y, 1, len, c); }

  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4096; guard++) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Thick line: stamps wd×wd squares along the path. */
  stroke(x0, y0, x1, y1, c, wd = 2) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    const o = Math.floor((wd - 1) / 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.rect(Math.round(x0 + (x1 - x0) * t) - o, Math.round(y0 + (y1 - y0) * t) - o, wd, wd, c);
    }
    return this;
  }

  /** Quadratic bezier, optionally tapering from width w0 to w1. */
  bez(x0, y0, cx, cy, x1, y1, c, w0 = 1, w1 = w0) {
    const n = Math.max(4, Math.ceil((Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)) * 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const wd = Math.max(1, Math.round(w0 + (w1 - w0) * t));
      const o = Math.floor((wd - 1) / 2);
      this.rect(Math.round(x) - o, Math.round(y) - o, wd, wd, c);
    }
    return this;
  }

  /** Filled ellipse inscribed in the box (x, y, w, h). */
  oval(x, y, w, h, c) {
    c = C(c);
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(this.w, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      const ny = (yy + 0.5 - cy) / ry;
      for (let xx = x0; xx < x1; xx++) {
        const nx = (xx + 0.5 - cx) / rx;
        if (nx * nx + ny * ny <= 1.0001) this.d[yy * this.w + xx] = c;
      }
    }
    return this;
  }

  /** Filled disc centred on the pixel (cx, cy) with radius r (r=0 → 1px, r=1 → plus-ish 3px …). */
  disc(cx, cy, r, c) {
    return this.oval(cx - r, cy - r, r * 2 + 1, r * 2 + 1, c);
  }

  /** 1px ellipse outline inscribed in the box. */
  ring(x, y, w, h, c) {
    const m = new Buf(this.w, this.h);
    m.oval(x, y, w, h, 1);
    c = C(c);
    for (let yy = 0; yy < this.h; yy++) {
      for (let xx = 0; xx < this.w; xx++) {
        if (!m.d[yy * this.w + xx]) continue;
        if (!m.get(xx - 1, yy) || !m.get(xx + 1, yy) || !m.get(xx, yy - 1) || !m.get(xx, yy + 1)) this.d[yy * this.w + xx] = c;
      }
    }
    return this;
  }

  /** Filled polygon; vertices are pixel coordinates and are always included. */
  poly(pts, c) {
    c = C(c);
    const n = pts.length;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k] - 0.001), xb = Math.floor(xs[k + 1] + 0.001);
        for (let x = Math.max(0, xa); x <= Math.min(this.w - 1, xb); x++) this.d[y * this.w + x] = c;
      }
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.line(a[0], a[1], b[0], b[1], c);
    }
    return this;
  }

  /** Draw an ASCII pixel map. '.' and ' ' are transparent; other chars index `pal`. */
  map(rows, pal, ox = 0, oy = 0, flip = false) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      const len = row.length;
      for (let x = 0; x < len; x++) {
        const ch = row[flip ? len - 1 - x : x];
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch];
        if (col === undefined || col === null) continue;
        this.px(ox + x, oy + y, col);
      }
    }
    return this;
  }

  /** Copy another buffer on top (alpha aware). opts: { flipX, flipY, alpha } */
  blit(src, ox = 0, oy = 0, opts = {}) {
    ox = Math.round(ox); oy = Math.round(oy);
    const a = opts.alpha === undefined ? 1 : opts.alpha;
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.d[(opts.flipY ? src.h - 1 - y : y) * src.w + (opts.flipX ? src.w - 1 - x : x)];
        if (!c) continue;
        if (a >= 1 && c >>> 24 === 255) this.px(ox + x, oy + y, c);
        else this.blend(ox + x, oy + y, c, a);
      }
    }
    return this;
  }

  /**
   * Draw a shaded volume: `drawMask(m)` paints the silhouette into a scratch buffer
   * (any colour), which is then filled with `rmp` using top-left lighting.
   * rmp: [dark, mid, light] (or longer). opts:
   *   lw / dw  rim widths for the lit / shadowed edge (default 1)
   *   grad     0..1 strength of a diagonal gradient over the bounding box (for big volumes)
   *   sep      darken pixels of existing art right next to the new shape (part separation)
   *   hi       colour for the corner specular pixels on the lit side
   */
  vol(rmp, drawMask, opts = {}) {
    const m = new Buf(this.w, this.h);
    drawMask(m);
    const cols = rmp.map(C);
    const n = cols.length;
    const lw = opts.lw === undefined ? 1 : opts.lw;
    const dw = opts.dw === undefined ? 1 : opts.dw;
    const grad = opts.grad || 0;
    const mid = (n - 1) / 2;
    let x0 = this.w, x1 = -1, y0 = this.h, y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (m.d[y * this.w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return this;
    const hw = Math.max(1, (x1 - x0 + 1) / 2), hh = Math.max(1, (y1 - y0 + 1) / 2);
    const bcx = x0 + hw, bcy = y0 + hh;
    const sep = opts.sep ? (opts.sep === true ? 0.5 : opts.sep) : 0;
    const hi = opts.hi ? C(opts.hi) : 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!m.d[y * this.w + x]) continue;
        let tl = 99, br = 99;
        for (let k = 1; k <= lw; k++) {
          if (!m.get(x, y - k) || !m.get(x - k, y)) { tl = k; break; }
        }
        for (let k = 1; k <= dw; k++) {
          if (!m.get(x, y + k) || !m.get(x + k, y)) { br = k; break; }
        }
        let lvl = mid;
        if (grad) {
          const v = -(((x + 0.5 - bcx) / hw) * 0.5 + ((y + 0.5 - bcy) / hh) * 0.8);
          lvl = mid + v * grad * mid * 1.15;
        }
        lvl = Math.round(lvl);
        const lit = tl <= lw, shd = br <= dw;
        if (shd && !lit) lvl -= 1;
        else if (lit && !shd) lvl += 1;
        lvl = Math.max(0, Math.min(n - 1, lvl));
        let col = cols[lvl];
        if (hi && lit && !shd && !m.get(x, y - 1) && !m.get(x - 1, y)) col = hi;
        this.d[y * this.w + x] = col;
      }
    }
    if (sep) {
      for (let y = Math.max(0, y0 - 1); y <= Math.min(this.h - 1, y1 + 1); y++) {
        for (let x = Math.max(0, x0 - 1); x <= Math.min(this.w - 1, x1 + 1); x++) {
          const i = y * this.w + x;
          if (m.d[i] || !this.d[i]) continue;
          if (m.get(x - 1, y) || m.get(x + 1, y) || m.get(x, y - 1) || m.get(x, y + 1)) {
            this.d[i] = mix(this.d[i], alpha(OUTLINE, ca(this.d[i]) / 255), sep);
          }
        }
      }
    }
    return this;
  }

  /** Shaded ellipse in the box (x, y, w, h). */
  ball(x, y, w, h, rmp, opts) {
    return this.vol(rmp, (m) => m.oval(x, y, w, h, 1), opts);
  }

  /** Shaded rectangle. */
  slab(x, y, w, h, rmp, opts) {
    return this.vol(rmp, (m) => m.rect(x, y, w, h, 1), opts);
  }

  /** Add a 1px outline around all solid pixels (4-neighbourhood; `diag` adds corners). */
  outline(c = OUTLINE, diag = false) {
    c = C(c);
    const src = this.d.slice();
    const w = this.w, h = this.h;
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[y * w + x] >>> 24 >= SOLID;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (src[y * w + x] >>> 24 >= SOLID) continue;
        let hit = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
        if (!hit && diag) hit = solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1);
        if (hit) this.d[y * w + x] = c;
      }
    }
    return this;
  }

  /** Replace colours through fn(packed, x, y) → packed. */
  recolor(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.d[i]) this.d[i] = C(fn(this.d[i], x, y));
      }
    }
    return this;
  }

  /** New buffer with the content moved by (dx, dy). */
  shifted(dx, dy) {
    const b = new Buf(this.w, this.h);
    b.blit(this, Math.round(dx), Math.round(dy));
    return b;
  }

  /** New buffer, nearest-neighbour scaled around the bottom-centre ('bottom') or centre. */
  scaled(sx, sy, anchor = 'bottom') {
    const b = new Buf(this.w, this.h);
    const ax = this.w / 2;
    const ay = anchor === 'bottom' ? this.h - 1 : this.h / 2;
    for (let y = 0; y < this.h; y++) {
      const syp = Math.floor(ay + (y + 0.5 - ay) / sy);
      if (syp < 0 || syp >= this.h) continue;
      for (let x = 0; x < this.w; x++) {
        const sxp = Math.floor(ax + (x + 0.5 - ax) / sx);
        if (sxp < 0 || sxp >= this.w) continue;
        b.d[y * this.w + x] = this.d[syp * this.w + sxp];
      }
    }
    return b;
  }

  /** New buffer with rows shifted horizontally: k > 0 leans the top to the right. */
  sheared(k) {
    const b = new Buf(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      const off = Math.round((this.h - 2 - y) * k);
      for (let x = 0; x < this.w; x++) {
        const sx = x - off;
        if (sx < 0 || sx >= this.w) continue;
        b.d[y * this.w + x] = this.d[y * this.w + sx];
      }
    }
    return b;
  }

  /** New buffer mirrored horizontally. */
  flipped() {
    const b = new Buf(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.d[y * this.w + x] = this.d[y * this.w + (this.w - 1 - x)];
    return b;
  }

  /** New buffer with every visible pixel turned white (hit flash silhouette). */
  whitened() {
    const b = new Buf(this.w, this.h);
    for (let i = 0; i < this.d.length; i++) {
      const a = this.d[i] >>> 24;
      if (a) b.d[i] = ((a << 24) | 0xffffff) >>> 0;
    }
    return b;
  }

  /**
   * New buffer tinted for "tintable" (greyscale) art: luminance 0..0.75 maps black→colour,
   * 0.75..1 maps colour→white, so authored highlights stay hot.
   */
  tinted(r, g, b) {
    const out = new Buf(this.w, this.h);
    for (let i = 0; i < this.d.length; i++) {
      const c = this.d[i];
      const a = c >>> 24;
      if (!a) continue;
      const lum = Math.max(cr(c), cg(c), cb(c)) / 255;
      let rr, gg, bb;
      if (lum <= 0.75) {
        const f = lum / 0.75;
        rr = r * f; gg = g * f; bb = b * f;
      } else {
        const f = (lum - 0.75) / 0.25;
        rr = r + (255 - r) * f; gg = g + (255 - g) * f; bb = b + (255 - b) * f;
      }
      out.d[i] = pack(Math.round(rr), Math.round(gg), Math.round(bb), a);
    }
    return out;
  }

  /** Count of non-transparent pixels (used by tests). */
  count() {
    let n = 0;
    for (let i = 0; i < this.d.length; i++) if (this.d[i] >>> 24) n++;
    return n;
  }

  /** View as RGBA bytes (for ImageData). */
  bytes() {
    return new Uint8ClampedArray(this.d.buffer, this.d.byteOffset, this.d.byteLength);
  }
}

// ---------------------------------------------------------------------------
// Sprite registry
// ---------------------------------------------------------------------------

/** key → { w, h, tint, anims: { name: { fps, n, render(i) → Buf } } } */
export const DEFS = new Map();

export function define(key, def) {
  DEFS.set(key, def);
  return def;
}

function renderPose(w, h, draw, pose, o) {
  let b = new Buf(w, h);
  draw(b, pose);
  if (pose.sx || pose.sy) b = b.scaled(pose.sx || 1, pose.sy || 1, o.anchor);
  if (pose.shear) b = b.sheared(pose.shear);
  if (pose.dx || pose.dy) b = b.shifted(pose.dx || 0, pose.dy || 0);
  if (o.outline) b.outline(o.outline, !!o.diag);
  if (o.post) o.post(b, pose);
  return b;
}

/**
 * Define an animated sprite from one pose-driven draw function.
 *   draw(buf, pose)   paints one frame WITHOUT outline (keep a 1px margin)
 *   anims             { idle: [fps, pose, pose, …], walk: [...], … }
 * Generic pose keys handled here: dx, dy (shift), sx, sy (squash/stretch), shear.
 * opts: { outline = OUTLINE | false, anchor = 'bottom' | 'center', tint, post(buf, pose) }
 */
export function sprite(key, w, h, draw, anims, opts = {}) {
  const o = { outline: OUTLINE, anchor: 'bottom', ...opts };
  const A = {};
  for (const name of Object.keys(anims)) {
    const [fps, ...poses] = anims[name];
    A[name] = { fps, n: poses.length, render: (i) => renderPose(w, h, draw, poses[i % poses.length], o) };
  }
  if (!A.idle) {
    const first = Object.keys(A)[0];
    A.idle = A[first];
  }
  if (!A.hurt && !o.noHurt) {
    const base = anims.idle ? anims.idle[1] : {};
    A.hurt = { fps: 1, n: 1, render: () => renderPose(w, h, draw, { ...base, hurt: 1 }, o) };
  }
  return define(key, { w, h, tint: !!o.tint, anims: A });
}

/** Static single-frame sprite. */
export function still(key, w, h, draw, opts = {}) {
  return sprite(key, w, h, draw, { idle: [1, {}] }, { noHurt: true, ...opts });
}
