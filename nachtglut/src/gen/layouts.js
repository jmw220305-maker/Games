// Interior obstacle layouts. Each generator is parametric and uses mirror/rotation symmetry variants.
// Generators only write through L.put(), which respects the room mask, protected door lanes and
// hazard-free zones; connectivity and open-space are checked/repaired by roomgen afterwards.
import { TILE } from '../game/constants.js';

const { FLOOR, WALL, PIT, SPIKES, HAZARD, ICE } = TILE;

/** Build the layout context for a carved room. */
export function makeLayoutContext(rng, room, opts) {
  const { w, h, tiles, mask, noBlock, noHaz } = room;
  const frost = opts.biome === 'frost';
  const L = {
    rng, w, h, tiles,
    x0: 1, y0: 1, x1: w - 2, y1: h - 2, iw: w - 2, ih: h - 2,
    cx: (w - 1) / 2, cy: (h - 1) / 2,
    index: opts.index, biome: opts.biome, frost, safe: !!opts.safe,
    level: Math.min(1, 0.15 + 0.17 * opts.index), // hazard intensity grows with the floor
    hz: frost ? ICE : HAZARD,
    inside(x, y) { return x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1; },
    get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? tiles[y * w + x] : TILE.VOID; },
    put(x, y, t) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const i = y * w + x;
      if (!mask[i]) return false;
      if ((t === WALL || t === PIT) && noBlock[i]) return false;
      if (t === SPIKES || t === HAZARD || t === ICE) {
        if (L.safe || noHaz[i]) return false;
        if (tiles[i] !== FLOOR && tiles[i] !== t) return false;
      }
      tiles[i] = t;
      return true;
    },
    /** mirror images of a cell for a symmetry mode */
    images(x, y, mode) {
      const mx = w - 1 - x, my = h - 1 - y;
      switch (mode) {
        case 'x': return [[x, y], [mx, y]];
        case 'y': return [[x, y], [x, my]];
        case 'r': return [[x, y], [mx, my]];
        case 'xy': return [[x, y], [mx, y], [x, my], [mx, my]];
        default: return [[x, y]];
      }
    },
    sput(x, y, t, mode = 'none') { for (const [a, b] of L.images(x, y, mode)) L.put(a, b, t); },
    rect(ax, ay, bx, by, t, mode = 'none') {
      if (ax > bx) [ax, bx] = [bx, ax];
      if (ay > by) [ay, by] = [by, ay];
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) L.sput(x, y, t, mode);
    },
    disc(cx, cy, rx, ry, t, mode = 'none') {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) L.sput(x, y, t, mode);
        }
      }
    },
    /** integer span of `len` cells centred on c (len adjusted to match c's parity) */
    span(c, len) {
      const whole = Number.isInteger(c);
      if (whole ? len % 2 === 0 : len % 2 === 1) len += 1;
      const a = Math.round(c - (len - 1) / 2);
      return [a, a + len - 1];
    },
    hazardRoll(p) { return !L.safe && rng.chance(p * L.level); },
  };
  return L;
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

export const LAYOUTS = {
  empty: { weight: () => 1, fn() {} },

  fourPillars: {
    weight: () => 3,
    fn(L) {
      const { rng } = L;
      const s = L.iw >= 21 && L.ih >= 15 && rng.chance(0.3) ? 3 : rng.chance(0.7) ? 2 : 1;
      const px = L.x0 + Math.max(2, Math.round(L.iw * rng.float(0.2, 0.3)));
      const py = L.y0 + Math.max(2, Math.round(L.ih * rng.float(0.2, 0.3)));
      L.rect(px, py, px + s - 1, py + Math.min(s, 2) - 1, WALL, 'xy');
      if (L.hazardRoll(0.6)) L.rect(px - 1, py - 1, px + s, py + Math.min(s, 2), L.hz, rng.pick(['xy', 'r']));
    },
  },

  scatteredPillars: {
    weight: () => 3,
    fn(L) {
      const { rng } = L;
      const mode = rng.pick(['x', 'y', 'r', 'xy']);
      const div = mode === 'xy' ? 4 : 2;
      const n = Math.max(2, Math.round((L.iw * L.ih) / (div * rng.float(30, 44))));
      const half = mode !== 'y';
      const xa = L.x0 + 2, ya = L.y0 + 2;
      const xb = half ? Math.floor(L.cx) - 1 : L.x1 - 2;
      const yb = mode === 'y' || mode === 'xy' ? Math.floor(L.cy) - 1 : L.y1 - 2;
      if (xb < xa || yb < ya) return;
      const pts = [];
      for (let tries = 0; pts.length < n && tries < n * 14; tries++) {
        const x = rng.int(xa, xb), y = rng.int(ya, yb);
        if (pts.some((p) => Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) < 3)) continue;
        pts.push([x, y]);
        const r = rng.next();
        const [pw, ph] = r < 0.55 ? [1, 1] : r < 0.75 ? [2, 1] : r < 0.9 ? [1, 2] : [2, 2];
        L.rect(x, y, x + pw - 1, y + ph - 1, WALL, mode);
      }
    },
  },

  centralBlock: {
    weight: () => 2.5,
    fn(L) {
      const { rng } = L;
      const v = rng.weighted([{ v: 'wall', weight: 3 }, { v: 'plus', weight: 2 }, { v: 'pit', weight: 2 }, { v: 'split', weight: 1.5 }]).v;
      const bw = Math.max(2, Math.round(L.iw * rng.float(0.14, 0.26)));
      const bh = Math.max(2, Math.round(L.ih * rng.float(0.16, 0.3)));
      const [xa, xb] = L.span(L.cx, bw), [ya, yb] = L.span(L.cy, bh);
      if (v === 'wall') {
        L.rect(xa, ya, xb, yb, WALL);
        if (L.hazardRoll(0.7)) L.rect(xa - 1, ya - 1, xb + 1, yb + 1, L.hz);
      } else if (v === 'plus') {
        const [ta, tb] = L.span(L.cx, Math.max(1, Math.round(bw / 3)));
        const [ma, mb] = L.span(L.cy, Math.max(1, Math.round(bh / 3)));
        L.rect(ta, ya - 1, tb, yb + 1, WALL);
        L.rect(xa - 1, ma, xb + 1, mb, WALL);
      } else if (v === 'pit') {
        L.rect(xa - 1, ya, xb + 1, yb, PIT);
        L.rect(xa, ya - 1, xb, yb + 1, PIT);
        if (rng.chance(0.5) && xb - xa >= 2 && yb - ya >= 2) L.rect(xa + 1, ya + 1, xb - 1, yb - 1, WALL);
      } else {
        const gap = rng.int(1, 2);
        const [ga] = L.span(L.cx, gap * 2);
        L.rect(Math.max(L.x0 + 2, ga - bw), ya, ga - 1, yb, WALL, 'x');
        if (L.hazardRoll(0.6)) L.rect(ga, ya, L.w - 1 - ga, yb, L.hz);
      }
    },
  },

  coverWalls: {
    weight: () => 3,
    fn(L) {
      const { rng } = L;
      const mode = rng.pick(['xy', 'xy', 'r']);
      const count = L.iw * L.ih > 320 ? 2 : 1;
      const qx1 = Math.floor(L.cx) - 2, qy1 = Math.floor(L.cy) - 1;
      for (let k = 0; k < count; k++) {
        const kind = rng.pick(['h', 'v', 'L']);
        const x = rng.int(L.x0 + 2, Math.max(L.x0 + 2, qx1 - 2));
        const y = rng.int(L.y0 + 2, Math.max(L.y0 + 2, qy1 - 1));
        const len = rng.int(3, 5);
        if (kind === 'h') L.rect(x, y, Math.min(qx1, x + len - 1), y, WALL, mode);
        else if (kind === 'v') L.rect(x, y, x, Math.min(qy1, y + len - 2), WALL, mode);
        else {
          L.rect(x, y, Math.min(qx1, x + len - 1), y, WALL, mode);
          L.rect(x, y, x, Math.min(qy1, y + 2), WALL, mode);
        }
      }
      if (rng.chance(0.45)) {
        const [a, b] = L.span(L.cx, rng.int(2, 4)), [ya, yb] = L.span(L.cy, 1);
        L.rect(a, ya, b, yb, WALL);
      }
    },
  },

  pitLake: {
    weight: () => 2,
    ok: (L) => L.iw >= 15 && L.ih >= 9,
    fn(L) {
      const { rng } = L;
      const rx = Math.max(2.4, L.iw * rng.float(0.16, 0.26)), ry = Math.max(2, L.ih * rng.float(0.18, 0.28));
      L.disc(L.cx, L.cy, rx, ry, PIT);
      const br = rng.pick(['h', 'v', 'hv', 'hv']);
      if (br.includes('h')) { const [a, b] = L.span(L.cy, 2); L.rect(Math.floor(L.cx - rx - 1), a, Math.ceil(L.cx + rx + 1), b, FLOOR); }
      if (br.includes('v')) { const [a, b] = L.span(L.cx, 2); L.rect(a, Math.floor(L.cy - ry - 1), b, Math.ceil(L.cy + ry + 1), FLOOR); }
      if (rx >= 4 && ry >= 3 && rng.chance(0.5)) L.disc(L.cx, L.cy, 1.6, 1.3, FLOOR);
      if (rng.chance(0.5)) {
        const px = Math.round(L.cx - rx - 2), py = Math.round(L.cy - ry - 1);
        if (px >= L.x0 + 2 && py >= L.y0 + 2) L.sput(px, py, WALL, 'xy');
      }
    },
  },

  pitChannels: {
    weight: () => 1.5,
    ok: (L) => L.iw >= 15,
    fn(L) {
      const { rng } = L;
      const vertical = L.iw >= L.ih ? rng.chance(0.8) : rng.chance(0.2);
      const two = rng.chance(0.55);
      const thick = rng.chance(0.6) ? 1 : 2;
      const len = vertical ? L.iw : L.ih;
      const c = vertical ? L.cx : L.cy;
      const pos = two ? [(vertical ? L.x0 : L.y0) + Math.round(len * rng.float(0.26, 0.36))] : [L.span(c, thick)[0]];
      const mode = two ? (vertical ? 'x' : 'y') : 'none';
      const t = two ? thick : L.span(c, thick)[1] - L.span(c, thick)[0] + 1;
      const bridge = rng.chance(0.7);
      for (const p of pos) {
        if (vertical) {
          L.rect(p, L.y0 + 2, p + t - 1, L.y1 - 2, PIT, mode);
          if (bridge) { const [a, b] = L.span(L.cy, rng.int(2, 3)); L.rect(p, a, p + t - 1, b, FLOOR, mode); }
        } else {
          L.rect(L.x0 + 2, p, L.x1 - 2, p + t - 1, PIT, mode);
          if (bridge) { const [a, b] = L.span(L.cx, rng.int(2, 3)); L.rect(a, p, b, p + t - 1, FLOOR, mode); }
        }
      }
      if (L.hazardRoll(0.5)) L.disc(L.cx, L.cy, 1.5, 1.5, L.hz, 'none');
    },
  },

  hazardPools: {
    weight: (L) => 1 + L.index * 0.5,
    hazard: true,
    fn(L) {
      const { rng } = L;
      const tile = L.frost ? (rng.chance(0.15) ? HAZARD : ICE) : HAZARD;
      const mode = rng.pick(['r', 'x', 'y', 'xy']);
      const n = Math.max(1, rng.int(1, 2) + (L.level > 0.75 ? 1 : 0) - (mode === 'xy' ? 1 : 0));
      const xb = mode === 'y' ? L.x1 - 3 : Math.floor(L.cx) - 1;
      const yb = mode === 'y' || mode === 'xy' ? Math.floor(L.cy) - 1 : L.y1 - 3;
      for (let k = 0; k < n; k++) {
        const x = rng.int(L.x0 + 3, Math.max(L.x0 + 3, xb)), y = rng.int(L.y0 + 2, Math.max(L.y0 + 2, yb));
        const r = rng.float(1.2, 1.5 + L.level * 1.1);
        L.disc(x, y, r * rng.float(1, 1.35), r, tile, mode);
        if (rng.chance(0.4)) L.sput(x, y, WALL, mode);
      }
    },
  },

  spikeField: {
    weight: (L) => 0.6 + L.index * 0.45,
    hazard: true,
    fn(L) {
      const { rng } = L;
      const v = rng.pick(['checker', 'strips', 'corridor', 'corners']);
      if (v === 'checker') {
        const [xa, xb] = L.span(L.cx, Math.round(L.iw * rng.float(0.3, 0.45)));
        const [ya, yb] = L.span(L.cy, Math.round(L.ih * rng.float(0.3, 0.45)));
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if ((x + y) % 2 === 0) L.put(x, y, SPIKES);
      } else if (v === 'strips') {
        const rows = rng.int(1, 2);
        for (let k = 0; k < rows; k++) {
          const y = L.y0 + 2 + k * 3;
          const [xa, xb] = L.span(L.cx, Math.round(L.iw * rng.float(0.3, 0.5)));
          L.rect(xa, y, xb, y, SPIKES, 'y');
        }
      } else if (v === 'corridor') {
        const vertical = L.ih > L.iw * 0.8 ? rng.chance(0.6) : rng.chance(0.2);
        if (!vertical) {
          const [xa, xb] = L.span(L.cx, Math.round(L.iw * rng.float(0.35, 0.5)));
          const [ya, yb] = L.span(L.cy, 2);
          L.rect(xa, ya - 1, xb, ya - 1, WALL); L.rect(xa, yb + 1, xb, yb + 1, WALL);
          L.rect(xa + 1, ya, xb - 1, yb, SPIKES);
        } else {
          const [ya, yb] = L.span(L.cy, Math.round(L.ih * rng.float(0.35, 0.5)));
          const [xa, xb] = L.span(L.cx, 2);
          L.rect(xa - 1, ya, xa - 1, yb, WALL); L.rect(xb + 1, ya, xb + 1, yb, WALL);
          L.rect(xa, ya + 1, xb, yb - 1, SPIKES);
        }
      } else {
        const s = rng.int(2, 3);
        L.rect(L.x0 + 2, L.y0 + 2, L.x0 + 1 + s, L.y0 + 1 + s, SPIKES, 'xy');
        if (rng.chance(0.6)) L.rect(L.x0 + 2 + s, L.y0 + 2 + s, L.x0 + 2 + s, L.y0 + 2 + s, WALL, 'xy');
      }
    },
  },

  crossWalls: {
    weight: () => 2,
    ok: (L) => L.iw >= 15 && L.ih >= 11,
    fn(L) {
      const { rng } = L;
      const ax = Math.max(2, Math.round(L.iw * rng.float(0.16, 0.26)));
      const ay = Math.max(2, Math.round(L.ih * rng.float(0.16, 0.26)));
      const gap = rng.int(1, 2);
      const [cxa, cxb] = L.span(L.cx, 1), [cya, cyb] = L.span(L.cy, 1);
      L.rect(cxa - gap - ax, cya, cxa - gap - 1, cyb, WALL, 'x');
      if (rng.chance(0.75)) L.rect(cxa, cya - gap - ay, cxb, cya - gap - 1, WALL, 'y');
      if (L.hazardRoll(0.6)) L.rect(cxa, cya, cxb, cyb, L.hz);
    },
  },

  diagonalPillars: {
    weight: () => 2,
    fn(L) {
      const { rng } = L;
      if (rng.chance(0.55)) {
        const sx = L.iw >= L.ih * 1.4 ? 3 : 2, sy = 2;
        for (let k = 0; ; k++) {
          const x = L.x0 + 2 + k * sx, y = L.y0 + 2 + k * sy;
          if (x >= L.cx - 1.5 || y >= L.cy - 1) break;
          L.sput(x, y, WALL, 'xy');
        }
      } else {
        const n = rng.int(3, 4), off = rng.int(2, 3);
        for (let k = 0; k < n; k++) {
          const x = L.x0 + 2 + k * 2 + off, y = L.y1 - 2 - k * 2;
          if (y < L.y0 + 2) break;
          L.sput(x, y, WALL, 'r');
        }
      }
    },
  },

  pillarRing: {
    weight: () => 2,
    ok: (L) => L.iw >= 15 && L.ih >= 11,
    fn(L) {
      const { rng } = L;
      const n = 2 * rng.int(3, 5);
      const rx = L.iw * rng.float(0.27, 0.34), ry = L.ih * rng.float(0.27, 0.34);
      const phase = rng.chance(0.5) ? 0 : Math.PI / n;
      for (let k = 0; k < n; k++) {
        const a = phase + (k * Math.PI * 2) / n;
        L.put(L.cx + Math.cos(a) * rx, L.cy + Math.sin(a) * ry, WALL);
      }
      if (!L.safe) {
        const c = rng.pick(['none', 'hz', 'spikes', 'pit']);
        const r = Math.max(1.2, Math.min(rx, ry) * 0.38);
        if (c === 'hz' && L.hazardRoll(1)) L.disc(L.cx, L.cy, r, r, L.hz);
        else if (c === 'spikes' && L.hazardRoll(0.8)) L.disc(L.cx, L.cy, r, r * 0.8, SPIKES);
        else if (c === 'pit') L.disc(L.cx, L.cy, r * 0.8, r * 0.7, PIT);
      }
    },
  },

  mazeLite: {
    weight: () => 1.5,
    ok: (L) => L.iw >= 21 && L.ih >= 11,
    fn(L) {
      const { rng } = L;
      const vertical = L.iw >= L.ih;
      const k = rng.int(2, 3);
      const span = vertical ? L.iw : L.ih;
      const cross = vertical ? L.ih : L.iw;
      const gap = Math.max(4, Math.round(cross * rng.float(0.38, 0.5)));
      const len = cross - gap;
      const alt = rng.chance(0.5);
      for (let i = 0; i < k; i++) {
        const p = (vertical ? L.x0 : L.y0) + Math.round(((i + 1) * span) / (k + 1));
        const fromStart = alt ? i % 2 === 0 : rng.chance(0.5);
        if (vertical) {
          const ya = fromStart ? L.y0 : L.y1 - len + 1;
          L.rect(p, ya, p, ya + len - 1, WALL);
        } else {
          const xa = fromStart ? L.x0 : L.x1 - len + 1;
          L.rect(xa, p, xa + len - 1, p, WALL);
        }
      }
    },
  },

  symArena: {
    weight: () => 2,
    ok: (L) => L.iw >= 15 && L.ih >= 11,
    fn(L) {
      const { rng } = L;
      const a = rng.int(2, 4), b = rng.int(2, 3);
      const x = L.x0 + 2, y = L.y0 + 2;
      L.rect(x, y, x + a - 1, y, WALL, 'xy');
      L.rect(x, y, x, y + b - 1, WALL, 'xy');
      const c = L.safe ? 'pillar' : rng.pick(['diamond', 'pillar', 'spikes']);
      if (c === 'diamond' && L.hazardRoll(1.2)) {
        const rx = Math.max(2, Math.round(L.iw * 0.12)), ry = Math.max(1, Math.round(L.ih * 0.12));
        for (let yy = -ry; yy <= ry; yy++) for (let xx = -rx; xx <= rx; xx++) {
          if (Math.abs(xx) / rx + Math.abs(yy) / ry <= 1) L.put(Math.round(L.cx + xx), Math.round(L.cy + yy), L.hz);
        }
      } else if (c === 'spikes' && L.hazardRoll(1)) {
        const [xa, xb] = L.span(L.cx, 3), [ya, yb] = L.span(L.cy, 3);
        L.rect(xa, ya, xb, yb, SPIKES);
      } else {
        const [xa, xb] = L.span(L.cx, 2), [ya, yb] = L.span(L.cy, 2);
        L.rect(xa, ya, xb, yb, WALL);
      }
    },
  },

  edgePits: {
    weight: () => 1.5,
    fn(L) {
      const { rng } = L;
      const horiz = L.iw >= L.ih ? rng.chance(0.75) : rng.chance(0.25);
      const d = rng.int(1, 2);
      const segLen = rng.int(3, 5), gapLen = rng.int(2, 3);
      const len = horiz ? L.iw : L.ih;
      for (let p = 2; p < len - 2; p += segLen + gapLen) {
        const e = Math.min(len - 3, p + segLen - 1);
        if (horiz) L.rect(L.x0 + p, L.y0, L.x0 + e, L.y0 + d - 1, PIT, 'y');
        else L.rect(L.x0, L.y0 + p, L.x0 + d - 1, L.y0 + e, PIT, 'x');
      }
      if (rng.chance(0.6)) {
        const [xa, xb] = L.span(L.cx, horiz ? 1 : 2), [ya, yb] = L.span(L.cy, horiz ? 2 : 1);
        const off = Math.round((horiz ? L.iw : L.ih) * 0.22);
        if (horiz) L.rect(xa - off, ya, xb - off, yb, WALL, 'x');
        else L.rect(xa, ya - off, xb, yb - off, WALL, 'y');
      }
    },
  },

  alcoves: {
    weight: () => 1.5,
    fn(L) {
      const { rng } = L;
      const horiz = L.iw >= L.ih ? rng.chance(0.75) : rng.chance(0.25);
      const step = rng.int(4, 6), depth = rng.int(2, 3);
      const len = horiz ? L.iw : L.ih;
      const start = rng.int(2, 3);
      for (let p = start; p < len - 2; p += step) {
        if (horiz) L.rect(L.x0 + p, L.y0, L.x0 + p, L.y0 + depth - 1, WALL, 'y');
        else L.rect(L.x0, L.y0 + p, L.x0 + depth - 1, L.y0 + p, WALL, 'x');
      }
    },
  },

  iceSheet: {
    weight: (L) => (L.frost ? 3.5 : 0),
    hazard: true,
    fn(L) {
      const { rng } = L;
      const n = rng.int(2, 4);
      const mode = rng.pick(['r', 'none', 'x']);
      for (let k = 0; k < n; k++) {
        const x = L.cx + rng.float(-0.3, 0.3) * L.iw, y = L.cy + rng.float(-0.3, 0.3) * L.ih;
        L.disc(x, y, rng.float(2.5, 4.5), rng.float(1.8, 3.2), ICE, mode);
      }
      if (rng.chance(0.5)) L.sput(Math.round(L.cx - L.iw * 0.25), Math.round(L.cy), WALL, 'x');
    },
  },

  bossArena: {
    weight: () => 0,
    fn(L) {
      const { rng } = L;
      const v = rng.pick([0, 2, 4, 4]);
      const dx = Math.round(L.iw * rng.float(0.25, 0.32));
      if (v === 2) {
        const y = Math.round(L.cy + L.ih * 0.12);
        L.rect(Math.floor(L.cx) - dx, y, Math.floor(L.cx) - dx + 1, y + 1, WALL, 'x');
      } else if (v === 4) {
        const dy = Math.round(L.ih * rng.float(0.2, 0.26));
        const ya = Math.round(L.cy - dy), yb = Math.round(L.cy + dy) - 1;
        L.rect(Math.floor(L.cx) - dx, ya, Math.floor(L.cx) - dx + 1, ya + 1, WALL, 'x');
        L.rect(Math.floor(L.cx) - dx, yb, Math.floor(L.cx) - dx + 1, yb + 1, WALL, 'x');
      }
    },
  },
};

/** Layout names usable by the given room type. */
const SAFE_LAYOUTS = { empty: 3, fourPillars: 2, pillarRing: 1.5, diagonalPillars: 1, alcoves: 1, edgePits: 0.8, symArena: 0.8 };

export function pickLayout(rng, type, L) {
  if (type === 'boss') return 'bossArena';
  let opts;
  if (type === 'shop') opts = [{ id: 'empty', weight: 3 }, { id: 'alcoves', weight: 1 }];
  else if (type === 'start') opts = [{ id: 'empty', weight: 3 }, { id: 'fourPillars', weight: 1.5 }, { id: 'alcoves', weight: 1 }, { id: 'diagonalPillars', weight: 1 }];
  else if (L.safe) opts = Object.entries(SAFE_LAYOUTS).map(([id, weight]) => ({ id, weight }));
  else {
    opts = [];
    for (const [id, def] of Object.entries(LAYOUTS)) {
      if (id === 'bossArena') continue;
      if (def.ok && !def.ok(L)) continue;
      let weight = def.weight(L);
      if (id === 'empty') weight = L.iw * L.ih < 160 ? 1 : 0.4;
      if (weight > 0) opts.push({ id, weight });
    }
  }
  opts = opts.filter((o) => !LAYOUTS[o.id].ok || LAYOUTS[o.id].ok(L));
  return rng.weighted(opts).id;
}

/** Extra hazard pass for fight rooms: ice sheets in frost, hazard blobs elsewhere (scales with the floor). */
export function hazardPass(L, layoutId) {
  if (L.safe) return;
  const { rng } = L;
  const heavy = LAYOUTS[layoutId] && LAYOUTS[layoutId].hazard;
  if (L.frost) {
    if (layoutId !== 'iceSheet' && rng.chance(0.55)) {
      const n = rng.int(1, 3), mode = rng.pick(['r', 'none']);
      for (let k = 0; k < n; k++) {
        L.disc(rng.int(L.x0 + 3, L.x1 - 3), rng.int(L.y0 + 2, L.y1 - 2), rng.float(2, 3.6), rng.float(1.5, 2.6), ICE, mode);
      }
    }
    if (rng.chance(0.08 + 0.02 * L.index)) {
      L.disc(rng.int(L.x0 + 3, L.x1 - 3), rng.int(L.y0 + 3, L.y1 - 3), 1.3, 1.3, HAZARD);
    }
  } else if (!heavy && rng.chance(0.08 + 0.11 * L.index)) {
    const n = rng.int(1, 2), mode = rng.pick(['r', 'x', 'none']);
    for (let k = 0; k < n; k++) {
      const r = rng.float(1.1, 1.4 + 0.25 * L.index);
      L.disc(rng.int(L.x0 + 3, L.x1 - 3), rng.int(L.y0 + 2, L.y1 - 2), r * 1.2, r, HAZARD, mode);
    }
  }
}
