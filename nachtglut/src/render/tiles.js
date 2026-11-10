// Room tile rendering. The static layer (floor, walls, pits, base looks of hazards/ice/spikes,
// doorways) is painted once per room into a software pixel buffer (DOM-free, see buildRoomLayers)
// and uploaded to a canvas. Per frame, drawRoomDynamic adds pulsing hazard glow (one drawImage
// per glow layer), spikes, ice glints, spore motes and door gates.
import { TS, TILE, SPIKE_CYCLE } from '../game/constants.js';
import { Buf, C, pack, hash2, rnd2 } from './art/helpers.js';

const T = TILE;
const FRONT = 9; // px of wall front face shown above an open tile

// ------------------------------------------------------------------------------------------
// colour math on packed 0xAABBGGRR ints (fast paths, no string parsing)
// ------------------------------------------------------------------------------------------
const R = (c) => c & 255, G = (c) => (c >>> 8) & 255, B = (c) => (c >>> 16) & 255;
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v + 0.5) | 0;
function mx(a, b, t) {
  const u = 1 - t;
  return pack(clamp(R(a) * u + R(b) * t), clamp(G(a) * u + G(b) * t), clamp(B(a) * u + B(b) * t), 255);
}
const BLACK = C('#05030a');
const WHITE = C('#fff6e4');
const dk = (c, t) => mx(c, BLACK, t);
const lt = (c, t) => mx(c, WHITE, t);
const withA = (c, a) => ((c & 0x00ffffff) | (clamp(a * 255) << 24)) >>> 0;

// ------------------------------------------------------------------------------------------
// biome style
// ------------------------------------------------------------------------------------------
const styleCache = new Map();
function styleOf(biome) {
  const id = (biome && biome.id) || 'ash';
  let s = styleCache.get(biome || id);
  if (s) return s;
  const p = (biome && biome.palette) || {};
  const col = (v, d) => C(v || d);
  s = {
    id,
    kind: (biome && biome.hazard) || 'lava',
    floor: col(p.floor, '#3b2f2a'),
    floorAlt: col(p.floorAlt, '#443630'),
    wall: col(p.wall, '#1f1715'),
    top: col(p.wallTop, '#5a463c'),
    pit: col(p.pit, '#0d0807'),
    hz: col(p.hazard, '#ff6a1f'),
    det: col(p.detail, '#6b5245'),
    acc: col(biome && biome.accent, '#ff7a2f'),
  };
  s.hzCss = cssOf(s.hz);
  s.accCss = cssOf(s.acc);
  s.detCss = cssOf(s.det);
  styleCache.set(biome || id, s);
  return s;
}
function cssOf(c) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return '#' + h(R(c)) + h(G(c)) + h(B(c));
}

// ------------------------------------------------------------------------------------------
// room helpers
// ------------------------------------------------------------------------------------------
function tileFn(room) {
  const w = room.w, h = room.h, tiles = room.tiles;
  return (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? T.VOID : tiles[y * w + x]);
}
const solid = (t) => t === T.WALL || t === T.VOID;
const open = (t) => !solid(t);
const groundish = (t) => t === T.FLOOR || t === T.HAZARD || t === T.ICE || t === T.SPIKES || t === T.DOOR;

function doorTiles(room) {
  const set = new Map(); // idx -> dir
  const d = room.doors || {};
  for (const dir of ['n', 'e', 's', 'w']) {
    const door = d[dir];
    if (!door) continue;
    const tiles = dir === 'n' || dir === 's' ? [[door.tx, door.ty], [door.tx + 1, door.ty]] : [[door.tx, door.ty], [door.tx, door.ty + 1]];
    tiles.forEach(([x, y], i) => set.set(y * room.w + x, { dir, i }));
  }
  return set;
}

// ------------------------------------------------------------------------------------------
// static painting
// ------------------------------------------------------------------------------------------
function paintFloorTile(buf, S, tx, ty, seed, flat) {
  const ox = tx * TS, oy = ty * TS;
  const v = rnd2(tx, ty, seed) * 0.55 + rnd2(tx >> 1, ty >> 1, seed + 1) * 0.45;
  const base = mx(S.floor, S.floorAlt, v);
  const seamC = dk(base, S.id === 'fungal' ? 0.08 : 0.2);
  const seamL = lt(base, 0.05);
  const goldSeam = S.id === 'core' ? mx(base, S.top, 0.35) : 0;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const n = rnd2(ox + x, oy + y, seed + 7);
      let c = base;
      if (n < 0.07) c = dk(base, 0.1);
      else if (n > 0.95) c = lt(base, 0.05);
      if (!flat) {
        if (x === 0 || y === 0) {
          if (n > 0.12) c = goldSeam && (tx + ty) % 2 === 0 ? goldSeam : seamC;
        } else if (x === 1 || y === 1) c = seamL;
      }
      buf.d[(oy + y) * buf.w + ox + x] = c;
    }
  }
  return base;
}

function setPx(buf, x, y, c) {
  if (x >= 0 && y >= 0 && x < buf.w && y < buf.h) buf.d[y * buf.w + x] = c;
}
function getPx(buf, x, y) {
  return buf.d[y * buf.w + x];
}
function shadePx(buf, x, y, f) {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = y * buf.w + x;
  buf.d[i] = f > 0 ? dk(buf.d[i], f) : lt(buf.d[i], -f);
}

/** Jagged line in pixel space (deterministic). */
function jag(buf, x0, y0, x1, y1, c, seed, rough = 1) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const j = i === n ? 0 : (rnd2(i, seed, 3) - 0.5) * 2 * rough;
    const k = i === n ? 0 : (rnd2(seed, i, 4) - 0.5) * 2 * rough;
    const nx = Math.round(x0 + (x1 - x0) * t + j), ny = Math.round(y0 + (y1 - y0) * t + k);
    lineFn(px, py, nx, ny, (x, y) => setPx(buf, x, y, typeof c === 'function' ? c(x, y) : c));
    px = nx; py = ny;
  }
}
function lineFn(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let g = 0; g < 512; g++) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function floorDetail(buf, S, tx, ty, seed, base) {
  const ox = tx * TS, oy = ty * TS;
  const h = hash2(tx, ty, seed + 11);
  const r = (h & 1023) / 1024;
  const q = ((h >>> 10) & 1023) / 1024;
  const ax = 3 + ((h >>> 20) % 10), ay = 3 + ((h >>> 24) % 10);
  const id = S.id;
  if (id === 'ash' || id === 'core') {
    if (r < 0.14) {
      const ex = 2 + ((h >>> 4) % 12), ey = 2 + ((h >>> 8) % 12);
      jag(buf, ox + ax, oy + ay, ox + ex, oy + ey, dk(base, 0.42), h, 1.2);
      if (q < 0.5) setPx(buf, ox + ax, oy + ay, mx(base, S.hz, id === 'core' ? 0.45 : 0.35));
    } else if (r < 0.3) {
      // pebbles with a little shadow
      const pc = mx(base, S.det, 0.6);
      setPx(buf, ox + ax, oy + ay, lt(pc, 0.15)); setPx(buf, ox + ax + 1, oy + ay, pc); setPx(buf, ox + ax + 1, oy + ay + 1, dk(base, 0.3));
      if (q < 0.5) { setPx(buf, ox + ax - 4, oy + ay + 3, pc); setPx(buf, ox + ax - 4, oy + ay + 4, dk(base, 0.25)); }
    } else if (r < 0.38 && id === 'ash') {
      for (let k = 0; k < 6; k++) setPx(buf, ox + ax + ((h >>> k) & 3) - 1, oy + ay + ((h >>> (k + 3)) & 3) - 1, lt(base, 0.18));
    } else if (r < 0.48 && id === 'core') {
      // golden sun inlay
      const g = mx(base, S.top, 0.75), gl = lt(g, 0.25);
      const cx = ox + 8, cy = oy + 8;
      for (let k = -3; k <= 3; k++) { setPx(buf, cx + k, cy, g); setPx(buf, cx, cy + k, g); }
      setPx(buf, cx - 2, cy - 2, g); setPx(buf, cx + 2, cy - 2, g); setPx(buf, cx - 2, cy + 2, g); setPx(buf, cx + 2, cy + 2, g);
      setPx(buf, cx, cy, gl); setPx(buf, cx - 1, cy, gl);
    }
  } else if (id === 'fungal') {
    if (r < 0.26) {
      const mc = mx(base, C('#3f7a5c'), 0.45), mc2 = mx(base, C('#5a9a5a'), 0.5);
      for (let k = 0; k < 4; k++) {
        const cx = ox + 2 + ((h >>> (k * 4)) % 12), cy = oy + 2 + ((h >>> (k * 4 + 2)) % 12), rr = 1 + ((h >>> (k + 5)) & 1);
        for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr + 0.5) setPx(buf, cx + x, cy + y, (x + y) < 0 ? mc2 : mc);
      }
    } else if (r < 0.37) {
      // tiny glowing mushrooms
      const st = C('#9db39a'), cap = S.det, glow = C('#9be35a');
      setPx(buf, ox + ax, oy + ay, st); setPx(buf, ox + ax, oy + ay + 1, dk(st, 0.3));
      setPx(buf, ox + ax - 1, oy + ay - 1, cap); setPx(buf, ox + ax, oy + ay - 1, lt(cap, 0.2)); setPx(buf, ox + ax + 1, oy + ay - 1, dk(cap, 0.2));
      setPx(buf, ox + ax, oy + ay - 2, glow);
      if (q < 0.5) { setPx(buf, ox + ax + 3, oy + ay + 2, st); setPx(buf, ox + ax + 3, oy + ay + 1, cap); setPx(buf, ox + ax + 2, oy + ay + 1, cap); }
    } else if (r < 0.45) {
      setPx(buf, ox + ax, oy + ay, mx(base, S.det, 0.55)); setPx(buf, ox + ax + 3, oy + ay - 2, mx(base, S.det, 0.4));
    }
  } else if (id === 'frost') {
    if (r < 0.18) {
      const sc = lt(base, 0.16);
      for (let k = 0; k < 7; k++) setPx(buf, ox + ax - 3 + k, oy + ay + 3 - k, sc);
      if (q < 0.5) for (let k = 0; k < 4; k++) setPx(buf, ox + ax + k, oy + ay + 4 - k, sc);
    } else if (r < 0.34) {
      for (let k = 0; k < 5; k++) setPx(buf, ox + 1 + ((h >>> (k * 3)) % 14), oy + 1 + ((h >>> (k * 3 + 9)) % 14), mx(base, S.det, 0.5));
    } else if (r < 0.4) {
      const fc = mx(base, S.det, 0.7);
      setPx(buf, ox + ax, oy + ay, lt(fc, 0.3));
      setPx(buf, ox + ax - 1, oy + ay, fc); setPx(buf, ox + ax + 1, oy + ay, fc); setPx(buf, ox + ax, oy + ay - 1, fc); setPx(buf, ox + ax, oy + ay + 1, fc);
    }
  } else if (id === 'void') {
    if (r < 0.08) {
      // faint rune
      const rc = mx(base, S.det, 0.35);
      const pat = (h >>> 6) & 0x1ffffff;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((pat >>> (y * 3 + x)) & 1) { setPx(buf, ox + 5 + x, oy + 5 + y, rc); setPx(buf, ox + 9 - x, oy + 5 + y, rc); }
    } else if (r < 0.2) {
      jag(buf, ox + ax, oy + ay, ox + 2 + ((h >>> 3) % 12), oy + 2 + ((h >>> 7) % 12), dk(base, 0.45), h, 1.3);
      setPx(buf, ox + ax, oy + ay, mx(base, S.det, 0.5));
    } else if (r < 0.32) {
      setPx(buf, ox + ax, oy + ay, mx(base, S.hz, 0.35));
      if (q < 0.4) setPx(buf, ox + ax + 5, oy + ay - 3, mx(base, S.det, 0.3));
    }
  }
}

/** Organic mask for blob-like tile types (hazard/ice): 1 inside, 0 floor. */
function blobInside(t, tx, ty, x, y, type, seed) {
  const n = rnd2(tx * TS + x, ty * TS + y, seed + 21);
  const edge = 1.6 + n * 1.8;
  const sameL = t(tx - 1, ty) === type, sameR = t(tx + 1, ty) === type, sameU = t(tx, ty - 1) === type, sameD = t(tx, ty + 1) === type;
  if (!sameL && x < edge) return false;
  if (!sameR && TS - 1 - x < edge) return false;
  if (!sameU && y < edge) return false;
  if (!sameD && TS - 1 - y < edge) return false;
  // round off outer corners
  const cr = 4 + n;
  if (!sameL && !sameU && (cr - x) ** 2 + (cr - y) ** 2 > cr * cr && x < cr && y < cr) return false;
  if (!sameR && !sameU && (x - (TS - 1 - cr)) ** 2 + (cr - y) ** 2 > cr * cr && x > TS - 1 - cr && y < cr) return false;
  if (!sameL && !sameD && (cr - x) ** 2 + (y - (TS - 1 - cr)) ** 2 > cr * cr && x < cr && y > TS - 1 - cr) return false;
  if (!sameR && !sameD && (x - (TS - 1 - cr)) ** 2 + (y - (TS - 1 - cr)) ** 2 > cr * cr && x > TS - 1 - cr && y > TS - 1 - cr) return false;
  return true;
}

function paintHazard(buf, glow, S, t, tx, ty, seed, base) {
  const ox = tx * TS, oy = ty * TS;
  const kind = S.kind;
  const h = hash2(tx, ty, seed + 31);
  const layer = glow[(h >>> 3) & 1];
  const gset = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= layer.w || y >= layer.h) return;
    layer.d[y * layer.w + x] = withA(c, a);
  };
  const halo = (x, y, c, a) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = (y + dy) * layer.w + x + dx;
      if (x + dx < 0 || y + dy < 0 || x + dx >= layer.w || y + dy >= layer.h) continue;
      if (!(layer.d[i] >>> 24)) layer.d[i] = withA(c, a);
    }
  };
  const inside = (x, y) => blobInside(t, tx, ty, x, y, T.HAZARD, seed);
  if (kind === 'lava' || kind === 'rift') {
    const isRift = kind === 'rift';
    const crust = isRift ? dk(base, 0.55) : mx(dk(base, 0.35), S.hz, 0.06);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (!inside(x, y)) continue;
      const n = rnd2(ox + x, oy + y, seed + 41);
      setPx(buf, ox + x, oy + y, n < 0.15 ? dk(crust, 0.25) : n > 0.9 ? lt(crust, 0.06) : crust);
    }
    // crack network: centre → neighbouring hazard tiles + a branch
    const cx = ox + 6 + (h % 4), cy = oy + 6 + ((h >>> 2) % 4);
    const targets = [];
    if (t(tx - 1, ty) === T.HAZARD) targets.push([ox - 1, oy + 7 + ((h >>> 5) % 3)]);
    if (t(tx + 1, ty) === T.HAZARD) targets.push([ox + TS, oy + 7 + ((h >>> 7) % 3)]);
    if (t(tx, ty - 1) === T.HAZARD) targets.push([ox + 7 + ((h >>> 9) % 3), oy - 1]);
    if (t(tx, ty + 1) === T.HAZARD) targets.push([ox + 7 + ((h >>> 11) % 3), oy + TS]);
    if (targets.length < 2) targets.push([ox + 3 + ((h >>> 13) % 10), oy + 3 + ((h >>> 17) % 4)], [ox + 3 + ((h >>> 19) % 10), oy + 10 + ((h >>> 23) % 3)]);
    const hot = S.hz, hotL = lt(S.hz, 0.55), dim = dk(S.hz, 0.45);
    const crackPx = [];
    for (const [ex, ey] of targets) jag({ w: buf.w, h: buf.h, d: { set: 0 } }, 0, 0, 0, 0, 0, 0); // no-op keeps signature stable
    for (let k = 0; k < targets.length; k++) {
      const [ex, ey] = targets[k];
      lineJag(cx, cy, ex, ey, h + k * 13, (x, y) => {
        if (x < ox || y < oy || x >= ox + TS || y >= oy + TS) return;
        if (!inside(x - ox, y - oy) && !(x === ox || x === ox + TS - 1 || y === oy || y === oy + TS - 1)) return;
        crackPx.push([x, y]);
      });
    }
    for (const [x, y] of crackPx) {
      setPx(buf, x, y, isRift ? C('#000000') : dim);
      gset(x, y, isRift ? S.hz : hot, 1);
    }
    for (const [x, y] of crackPx) halo(x, y, isRift ? S.det : hot, isRift ? 0.45 : 0.35);
    // molten/rift core blob
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (Math.abs(x) + Math.abs(y) <= 1) {
      setPx(buf, cx + x, cy + y, isRift ? C('#000000') : dim);
      gset(cx + x, cy + y, isRift ? S.det : hotL, 1);
    }
    gset(cx, cy, isRift ? C('#ffffff') : C('#fff6d0'), 1);
    if (isRift) for (const [x, y] of crackPx) if (rnd2(x, y, seed) < 0.12) gset(x, y, C('#ffd0ff'), 1);
  } else if (kind === 'spores') {
    const m0 = mx(base, C('#2f5a36'), 0.7), m1 = mx(base, C('#4f8a3a'), 0.7), m2 = mx(base, S.hz, 0.45);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (!inside(x, y)) continue;
      const n = rnd2(ox + x, oy + y, seed + 51);
      const bump = ((x + (y & 2)) & 3) === 0 && ((y & 3) === 0);
      setPx(buf, ox + x, oy + y, bump ? m2 : n < 0.5 ? m0 : m1);
    }
    // spore bulbs (glow)
    for (let k = 0; k < 4; k++) {
      const bx = ox + 3 + ((h >>> (k * 5)) % 10), by = oy + 3 + ((h >>> (k * 5 + 3)) % 10);
      if (!inside(bx - ox, by - oy)) continue;
      setPx(buf, bx, by, dk(S.hz, 0.4)); setPx(buf, bx + 1, by, dk(S.hz, 0.5));
      gset(bx, by, lt(S.hz, 0.4), 1); gset(bx + 1, by, S.hz, 0.9);
      halo(bx, by, S.hz, 0.3);
    }
  } else {
    // 'ice' hazard (Glatteis): crystalline frost patch
    const i0 = mx(base, S.hz, 0.35), i1 = mx(base, S.hz, 0.5), i2 = mx(base, C('#ffffff'), 0.55);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (!inside(x, y)) continue;
      const n = rnd2(ox + x, oy + y, seed + 61);
      const streak = ((x - y + 64 + (h & 7)) % 7) === 0;
      setPx(buf, ox + x, oy + y, streak ? i2 : n < 0.5 ? i0 : i1);
    }
    for (let k = 0; k < 3; k++) {
      const bx = ox + 3 + ((h >>> (k * 6)) % 10), by = oy + 3 + ((h >>> (k * 6 + 3)) % 10);
      if (!inside(bx - ox, by - oy)) continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { setPx(buf, bx + dx, by + dy, i2); gset(bx + dx, by + dy, dx || dy ? S.hz : C('#ffffff'), dx || dy ? 0.6 : 1); }
    }
  }
}

function lineJag(x0, y0, x1, y1, seed, fn) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const tt = i / n;
    const j = i === n ? 0 : Math.round((rnd2(i, seed, 3) - 0.5) * 2.4);
    const k = i === n ? 0 : Math.round((rnd2(seed, i, 4) - 0.5) * 2.4);
    const nx = Math.round(x0 + (x1 - x0) * tt + j), ny = Math.round(y0 + (y1 - y0) * tt + k);
    lineFn(px, py, nx, ny, fn);
    px = nx; py = ny;
  }
}

function paintIce(buf, S, t, tx, ty, seed, base) {
  const ox = tx * TS, oy = ty * TS;
  const iceA = mx(base, C('#9fd4f0'), 0.42), iceB = mx(base, C('#bfeaff'), 0.5), iceL = mx(base, C('#ffffff'), 0.62);
  const h = hash2(tx, ty, seed + 71);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    if (!blobInside(t, tx, ty, x, y, T.ICE, seed + 5)) continue;
    const d = (x + y + (h & 15)) % 13;
    let c = d < 5 ? iceA : iceB;
    if (((x - y + 40 + ((h >>> 4) & 7)) % 11) === 0) c = iceL;
    const n = rnd2(ox + x, oy + y, seed + 72);
    if (n < 0.04) c = iceL;
    setPx(buf, ox + x, oy + y, c);
  }
  // rim highlight on the top/left edges of the blob
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const i = (oy + y) * buf.w + ox + x;
    const c = buf.d[i];
    if (c !== iceA && c !== iceB && c !== iceL) continue;
    const up = y > 0 ? buf.d[i - buf.w] : (t(tx, ty - 1) === T.ICE ? c : 0);
    const lf = x > 0 ? buf.d[i - 1] : (t(tx - 1, ty) === T.ICE ? c : 0);
    if ((up !== iceA && up !== iceB && up !== iceL) || (lf !== iceA && lf !== iceB && lf !== iceL)) buf.d[i] = iceL;
  }
}

function paintSpikePlate(buf, S, tx, ty, base) {
  const ox = tx * TS, oy = ty * TS;
  const plate = mx(base, C('#5a5e66'), 0.35), rim = dk(plate, 0.35), hi = lt(plate, 0.18);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
    let c = plate;
    if (y === 2 || x === 2) c = hi;
    if (y === 13 || x === 13) c = rim;
    setPx(buf, ox + x, oy + y, c);
  }
  for (const [hx, hy] of SPIKE_HOLES) {
    setPx(buf, ox + hx, oy + hy, C('#07060a')); setPx(buf, ox + hx + 1, oy + hy, C('#07060a'));
    setPx(buf, ox + hx, oy + hy + 1, dk(plate, 0.5)); setPx(buf, ox + hx + 1, oy + hy + 1, dk(plate, 0.5));
  }
}
const SPIKE_HOLES = [[4, 4], [10, 4], [7, 7], [4, 10], [10, 10]];

function paintPit(buf, S, t, tx, ty, seed) {
  const ox = tx * TS, oy = ty * TS;
  const up = t(tx, ty - 1), dn = t(tx, ty + 1), lf = t(tx - 1, ty), rt = t(tx + 1, ty);
  const cliffTop = up !== T.PIT && !solid(up);
  const cliffUnderWall = up === T.WALL;
  const lipC = lt(S.floor, 0.12);
  const cliff0 = dk(S.floor, 0.3), cliff1 = dk(S.floor, 0.55);
  const glowFloor = S.id === 'core' || S.id === 'ash' ? mx(S.pit, S.hz, S.id === 'core' ? 0.12 : 0.07) : S.id === 'void' ? mx(S.pit, S.det, 0.05) : S.pit;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let c = mx(S.pit, glowFloor, Math.min(1, (y + (up === T.PIT ? 16 : 0)) / 24));
      const n = rnd2(ox + x, oy + y, seed + 81);
      if (n < 0.02) c = mx(c, S.det, 0.25);
      if (cliffTop || cliffUnderWall) {
        const ch = cliffUnderWall ? 3 : 6;
        if (y < ch) {
          c = mx(cliff0, cliff1, y / ch);
          if (((x + (y >> 1) * 3 + (tx * 5)) % 6) === 0) c = dk(c, 0.3);
          if (y === 0 && cliffTop) c = lipC;
        } else if (y === ch) c = dk(S.pit, 0.3);
      }
      if (x === 0 && lf !== T.PIT && !solid(lf)) c = y < 6 && cliffTop ? c : dk(mx(S.floor, S.pit, 0.5), 0.2);
      if (x === TS - 1 && rt !== T.PIT && !solid(rt)) c = dk(mx(S.floor, S.pit, 0.4), 0.1);
      if (y === TS - 1 && dn !== T.PIT && !solid(dn)) c = mx(S.floor, S.pit, 0.3);
      setPx(buf, ox + x, oy + y, c);
    }
  }
  // biome specific depth detail
  const h = hash2(tx, ty, seed + 83);
  if (cliffTop && S.id === 'fungal' && (h & 1)) {
    const rx = ox + 3 + (h >>> 3) % 10;
    for (let k = 0; k < 4 + ((h >>> 7) & 3); k++) setPx(buf, rx + ((k >> 1) & 1), oy + 1 + k, mx(S.floor, C('#3f7a5c'), 0.6));
  }
  if (cliffTop && S.id === 'frost') {
    for (let k = 0; k < 3; k++) {
      const ix = ox + 2 + ((h >>> (k * 4)) % 12), len = 2 + ((h >>> (k + 9)) % 3);
      for (let j = 0; j < len; j++) setPx(buf, ix, oy + 6 + j, j === 0 ? C('#dff4ff') : C('#8fc0e0'));
    }
  }
  if (S.id === 'void' && (h % 3 === 0)) setPx(buf, ox + 3 + (h >>> 4) % 10, oy + 8 + (h >>> 8) % 6, mx(S.pit, S.det, 0.6));
}

function paintWall(buf, S, t, tx, ty, seed) {
  const ox = tx * TS, oy = ty * TS;
  const up = t(tx, ty - 1), dn = t(tx, ty + 1), lf = t(tx - 1, ty), rt = t(tx + 1, ty);
  const hasFront = open(dn);
  const topH = hasFront ? TS - FRONT : TS;
  let interior = true;
  for (let y = -1; y <= 1 && interior; y++) for (let x = -1; x <= 1; x++) if (open(t(tx + x, ty + y))) { interior = false; break; }
  // also count tiles two rows below (front faces of the row below make this tile visible)
  const topBase = interior ? mx(S.top, S.wall, 0.62) : S.top;
  const OUTC = C('#020104');
  const h = hash2(tx, ty, seed + 91);
  for (let y = 0; y < topH; y++) {
    for (let x = 0; x < TS; x++) {
      const n = rnd2(ox + x, oy + y, seed + 93);
      let c = n < 0.1 ? dk(topBase, 0.08) : n > 0.93 ? lt(topBase, 0.05) : topBase;
      // subtle stone block pattern on tops
      if (!interior && ((y === 7 && topH > 8) || (x === ((y < 8 ? 0 : 8) + (tx & 1) * 4) % 16))) c = dk(c, 0.1);
      if (y === 0 && open(up)) c = lt(topBase, 0.22);
      if (x === 0 && open(lf)) c = lt(topBase, 0.14);
      if (x === TS - 1 && open(rt)) c = dk(topBase, 0.28);
      if (y === topH - 1 && hasFront) c = lt(topBase, 0.3);
      if (y === TS - 1 && !hasFront && open(dn)) c = dk(topBase, 0.3);
      if (y === 0 && up === T.VOID) c = OUTC;
      if (x === 0 && lf === T.VOID) c = OUTC;
      if (x === TS - 1 && rt === T.VOID) c = OUTC;
      if (y === TS - 1 && dn === T.VOID) c = OUTC;
      setPx(buf, ox + x, oy + y, c);
    }
  }
  // top-face biome details
  if (!interior) {
    if (S.id === 'frost') {
      for (let k = 0; k < 6; k++) setPx(buf, ox + 1 + ((h >>> (k * 3)) % 14), oy + 1 + ((h >>> (k * 3 + 1)) % Math.max(1, topH - 2)), lt(S.top, 0.55));
      if (hasFront) for (let x = 1; x < 15; x++) if (rnd2(ox + x, oy, seed + 95) < 0.6) setPx(buf, ox + x, oy + topH - 2, lt(S.top, 0.6));
    } else if (S.id === 'fungal') {
      if (h & 1) for (let k = 0; k < 5; k++) setPx(buf, ox + 2 + ((h >>> (k * 3)) % 12), oy + 1 + ((h >>> (k * 3 + 2)) % Math.max(1, topH - 2)), mx(S.top, C('#6aa060'), 0.6));
    } else if (S.id === 'core') {
      if (hasFront) for (let x = 0; x < TS; x++) setPx(buf, ox + x, oy + topH - 3, mx(S.top, C('#ffd35a'), 0.35));
    }
  }
  if (!hasFront) return;
  // front face
  const fTop = mx(S.wall, S.top, 0.42), fBot = dk(S.wall, 0.15);
  const mortar = dk(S.wall, 0.45);
  const stagger = (tx & 1) * 4;
  for (let fy = 0; fy < FRONT; fy++) {
    const y = topH + fy;
    const base = mx(fTop, fBot, fy / (FRONT - 1));
    for (let x = 0; x < TS; x++) {
      const n = rnd2(ox + x, oy + y, seed + 97);
      let c = n < 0.12 ? dk(base, 0.08) : base;
      const row = (fy + 1) >> 2;
      if ((fy & 3) === 3) c = mortar;
      else if (((x + stagger + (row & 1) * 4) & 7) === 0) c = mortar;
      else if ((fy & 3) === 0) c = lt(c, 0.07);
      if (fy === FRONT - 1) c = dk(base, 0.55);
      if (x === 0 && open(lf)) c = lt(c, 0.1);
      if (x === TS - 1 && open(rt)) c = dk(c, 0.25);
      if (x === 0 && lf === T.VOID) c = OUTC;
      if (x === TS - 1 && rt === T.VOID) c = OUTC;
      setPx(buf, ox + x, oy + y, c);
    }
  }
  // front-face biome details
  const fy0 = oy + topH;
  if (S.id === 'ash') {
    if ((h & 7) < 3) { const ex = ox + 2 + (h >>> 3) % 12, ey = fy0 + 3 + ((h >>> 7) & 1) * 4; setPx(buf, ex, ey, mx(S.hz, mortar, 0.35)); setPx(buf, ex + 1, ey, mx(S.hz, mortar, 0.6)); }
  } else if (S.id === 'fungal') {
    const moss = mx(S.top, C('#5a9a5a'), 0.5);
    for (let x = 0; x < TS; x++) {
      const len = rnd2(ox + x, oy, seed + 99) < 0.45 ? 1 + (hash2(ox + x, oy, seed) % 3) : 0;
      for (let j = 0; j < len; j++) setPx(buf, ox + x, fy0 + j, j === len - 1 ? dk(moss, 0.2) : moss);
    }
    if ((h & 7) === 1) { setPx(buf, ox + 6, fy0 + 5, C('#59e0b0')); setPx(buf, ox + 7, fy0 + 5, C('#3fae8a')); setPx(buf, ox + 5, fy0 + 5, C('#3fae8a')); }
  } else if (S.id === 'frost') {
    for (let k = 0; k < 3; k++) {
      if (((h >>> (k * 3)) & 3) === 0) continue;
      const ix = ox + 2 + k * 5 + ((h >>> (k + 12)) % 3), len = 2 + ((h >>> (k * 2 + 16)) % 4);
      for (let j = 0; j < len; j++) setPx(buf, ix, fy0 + j, j === 0 ? C('#eef9ff') : j === len - 1 ? C('#8fc0e0') : C('#bfe4f6'));
      if (len > 3) setPx(buf, ix + 1, fy0, C('#bfe4f6'));
    }
  } else if (S.id === 'void') {
    if ((h & 7) < 2) {
      const rc = mx(S.det, S.wall, 0.35);
      const rx = ox + 5, ry = fy0 + 2;
      const pat = (h >>> 4) & 0x7fff;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((pat >>> (y * 3 + x)) & 1) { setPx(buf, rx + x, ry + y, rc); setPx(buf, rx + 6 - x, ry + y, rc); }
    }
  } else if (S.id === 'core') {
    const g = mx(S.top, C('#ffd35a'), 0.5);
    for (let x = 0; x < TS; x++) setPx(buf, ox + x, fy0 + 4, (x + tx * 16) % 8 === 4 ? lt(g, 0.4) : g);
  }
}

function applyShadows(buf, t, room) {
  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      const tt = t(tx, ty);
      if (!groundish(tt)) continue;
      const ox = tx * TS, oy = ty * TS;
      if (t(tx, ty - 1) === T.WALL) {
        const f = [0.5, 0.36, 0.24, 0.14, 0.06];
        for (let y = 0; y < f.length; y++) for (let x = 0; x < TS; x++) shadePx(buf, ox + x, oy + y, f[y]);
      }
      if (t(tx - 1, ty) === T.WALL) {
        const f = [0.34, 0.2, 0.08];
        for (let x = 0; x < f.length; x++) for (let y = 0; y < TS; y++) shadePx(buf, ox + x, oy + y, f[x]);
      } else if (t(tx - 1, ty - 1) === T.WALL && t(tx, ty - 1) !== T.WALL) {
        for (let y = 0; y < 4; y++) for (let x = 0; x < 3 - (y >> 1); x++) shadePx(buf, ox + x, oy + y, 0.25 - y * 0.05);
      }
      if (t(tx + 1, ty) === T.WALL) for (let y = 0; y < TS; y++) shadePx(buf, ox + TS - 1, oy + y, 0.1);
    }
  }
}

function paintDoor(buf, S, tx, ty, info, base) {
  const ox = tx * TS, oy = ty * TS;
  const { dir, i } = info;
  // passage fades into darkness toward the outside
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const out = dir === 'n' ? 1 - y / (TS - 1) : dir === 's' ? y / (TS - 1) : dir === 'w' ? 1 - x / (TS - 1) : x / (TS - 1);
    const f = Math.min(1, Math.max(0, out * 1.15 - 0.05));
    shadePx(buf, ox + x, oy + y, f * f * 0.97);
  }
  // sill on the inner edge
  const sill = lt(base, 0.14), sillD = dk(base, 0.3);
  for (let k = 0; k < TS; k++) {
    if (dir === 'n') { setPx(buf, ox + k, oy + TS - 1, sill); setPx(buf, ox + k, oy + TS - 2, sillD); }
    if (dir === 's') { setPx(buf, ox + k, oy, sillD); setPx(buf, ox + k, oy + 1, sill); }
    if (dir === 'w') { setPx(buf, ox + TS - 1, oy + k, sill); setPx(buf, ox + TS - 2, oy + k, sillD); }
    if (dir === 'e') { setPx(buf, ox, oy + k, sillD); setPx(buf, ox + 1, oy + k, sill); }
  }
  // jambs (stone posts) on the outer sides of the 2-tile opening
  const jamb = lt(S.top, 0.1), jambD = dk(S.top, 0.35);
  const vertical = dir === 'n' || dir === 's';
  for (let k = 0; k < TS; k++) {
    if (vertical) {
      if (i === 0) { setPx(buf, ox, oy + k, jamb); setPx(buf, ox + 1, oy + k, jambD); }
      else { setPx(buf, ox + TS - 1, oy + k, jambD); setPx(buf, ox + TS - 2, oy + k, dk(jambD, 0.4)); }
    } else if (i === 0) { setPx(buf, ox + k, oy, jamb); setPx(buf, ox + k, oy + 1, jambD); }
    else { setPx(buf, ox + k, oy + TS - 1, jambD); setPx(buf, ox + k, oy + TS - 2, dk(jambD, 0.4)); }
  }
}

/**
 * DOM-free core of renderRoomStatic. Returns pixel buffers:
 * { base: Buf (w*TS × h*TS), glow: [Buf, Buf] (additive hazard glow, two phase groups) }
 */
export function buildRoomLayers(room, biome) {
  const S = styleOf(biome);
  const W = room.w * TS, H = room.h * TS;
  const buf = new Buf(W, H);
  const glow = [new Buf(W, H), new Buf(W, H)];
  const t = tileFn(room);
  const seed = ((room.variant >>> 0) ^ Math.imul((room.id | 0) + 1, 0x9e3779b1)) >>> 0;
  const doors = doorTiles(room);
  // pass 1: ground everywhere it is needed
  const bases = new Uint32Array(room.w * room.h);
  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      const tt = t(tx, ty);
      if (groundish(tt)) bases[ty * room.w + tx] = paintFloorTile(buf, S, tx, ty, seed, tt === T.HAZARD || tt === T.ICE);
    }
  }
  // pass 2: tile specific
  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      const tt = t(tx, ty);
      const base = bases[ty * room.w + tx];
      if (tt === T.FLOOR) floorDetail(buf, S, tx, ty, seed, base);
      else if (tt === T.HAZARD) paintHazard(buf, glow, S, t, tx, ty, seed, base);
      else if (tt === T.ICE) paintIce(buf, S, t, tx, ty, seed, base);
      else if (tt === T.SPIKES) paintSpikePlate(buf, S, tx, ty, base);
      else if (tt === T.PIT) paintPit(buf, S, t, tx, ty, seed);
      else if (tt === T.WALL) paintWall(buf, S, t, tx, ty, seed);
    }
  }
  applyShadows(buf, t, room);
  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      if (t(tx, ty) !== T.DOOR) continue;
      const info = doors.get(ty * room.w + tx) || { dir: ty === 0 ? 'n' : ty === room.h - 1 ? 's' : tx === 0 ? 'w' : 'e', i: 0 };
      paintDoor(buf, S, tx, ty, info, bases[ty * room.w + tx] || S.floor);
    }
  }
  return { base: buf, glow };
}

/** Light sources a renderer may add for glowing tiles: [{ x, y, r, color }] (one per hazard tile). */
export function roomLights(room, biome) {
  const S = styleOf(biome);
  const out = [];
  if (!room || !room.tiles) return out;
  for (let ty = 0; ty < room.h; ty++) for (let tx = 0; tx < room.w; tx++) {
    if (room.tiles[ty * room.w + tx] === T.HAZARD) out.push({ x: tx * TS + TS / 2, y: ty * TS + TS / 2, r: S.kind === 'lava' ? 26 : 18, color: S.hzCss });
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// canvas side
// ------------------------------------------------------------------------------------------
const roomCache = new WeakMap(); // room → { canvas, glow: [canvas|null, canvas|null], biomeId, hazards[], ice[], spikes[] }
const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function toCanvas(buf) {
  const c = document.createElement('canvas');
  c.width = buf.w;
  c.height = buf.h;
  if (!buf.w || !buf.h) return c;
  const g = c.getContext('2d');
  const img = g.createImageData(buf.w, buf.h);
  img.data.set(buf.bytes());
  g.putImageData(img, 0, 0);
  return c;
}

function prepare(room, biome) {
  const id = (biome && biome.id) || 'ash';
  let e = roomCache.get(room);
  if (e && e.biomeId === id) return e;
  const layers = buildRoomLayers(room, biome);
  const lists = { hazards: [], ice: [], spikes: [] };
  for (let ty = 0; ty < room.h; ty++) for (let tx = 0; tx < room.w; tx++) {
    const tt = room.tiles[ty * room.w + tx];
    const ph = rnd2(tx, ty, 1234);
    if (tt === T.HAZARD) lists.hazards.push(tx, ty, ph);
    else if (tt === T.ICE) lists.ice.push(tx, ty, ph);
    else if (tt === T.SPIKES) lists.spikes.push(tx, ty, ph);
  }
  e = {
    biomeId: id,
    canvas: hasDom() ? toCanvas(layers.base) : null,
    glow: layers.glow.map((g) => (hasDom() && g.count() ? toCanvas(g) : null)),
    ...lists,
  };
  roomCache.set(room, e);
  return e;
}

export function renderRoomStatic(room, biome) {
  return prepare(room, biome).canvas;
}

// --- small pre-rendered dynamic pieces (spikes, gates) per biome --------------------------
const pieceCache = new Map();
function pieces(S) {
  let p = pieceCache.get(S.id);
  if (p) return p;
  const STEEL = [C('#3a3e48'), C('#8a93a3'), C('#d4dbe6'), C('#ffffff')];
  const warn = new Buf(TS, TS), out = new Buf(TS, TS);
  for (const [hx, hy] of SPIKE_HOLES) {
    warn.px(hx, hy, STEEL[2]); warn.px(hx + 1, hy, STEEL[1]);
    warn.px(hx, hy - 1, STEEL[1]);
    // extended spike: 2px base, 5px tall cone with highlight
    out.rect(hx, hy - 1, 2, 3, STEEL[1]);
    out.px(hx, hy - 2, STEEL[2]); out.px(hx + 1, hy - 2, STEEL[1]);
    out.px(hx, hy - 3, STEEL[3]); out.px(hx, hy - 4, STEEL[2]);
    out.px(hx + 1, hy, STEEL[0]); out.px(hx + 1, hy + 1, STEEL[0]);
    out.px(hx - 1, hy + 2, C('#00000088')); out.px(hx + 2, hy + 2, C('#00000088'));
  }
  out.outline('#0a0a0e');
  // gates: horizontal opening (n/s) 32×16 and vertical (e/w) 16×32
  const IRON = [C('#16181e'), C('#3e4450'), C('#6c7686'), C('#a8b2c0')];
  const gateH = new Buf(TS * 2, TS);
  gateH.rect(0, 3, 32, 2, IRON[1]); gateH.hl(0, 3, 32, IRON[2]);
  gateH.rect(0, 11, 32, 2, IRON[1]); gateH.hl(0, 11, 32, IRON[2]);
  for (let x = 2; x < 32; x += 4) {
    gateH.rect(x, 0, 2, 16, IRON[1]);
    gateH.vl(x, 0, 16, IRON[3]);
    gateH.px(x + 1, 15, IRON[0]);
  }
  gateH.rect(13, 5, 6, 6, IRON[0]); gateH.rect(14, 6, 4, 4, S.acc); gateH.px(14, 6, lt(S.acc, 0.6));
  gateH.outline('#050507');
  const gateV = new Buf(TS, TS * 2);
  gateV.rect(3, 0, 2, 32, IRON[1]); gateV.vl(3, 0, 32, IRON[2]);
  gateV.rect(11, 0, 2, 32, IRON[1]); gateV.vl(11, 0, 32, IRON[2]);
  for (let y = 2; y < 32; y += 4) {
    gateV.rect(0, y, 16, 2, IRON[1]);
    gateV.hl(0, y, 16, IRON[3]);
    gateV.px(15, y + 1, IRON[0]);
  }
  gateV.rect(5, 13, 6, 6, IRON[0]); gateV.rect(6, 14, 4, 4, S.acc); gateV.px(6, 14, lt(S.acc, 0.6));
  gateV.outline('#050507');
  p = { warn: toCanvas(warn), out: toCanvas(out), gateH: toCanvas(gateH), gateV: toCanvas(gateV) };
  pieceCache.set(S.id, p);
  return p;
}

const inView = (v, x, y, w, h) => !v || (x + w > v.x && y + h > v.y && x < v.x + v.w && y < v.y + v.h);
const frac = (v) => v - Math.floor(v);

/**
 * Per-frame animated tiles, drawn in world (room-local) pixel coordinates.
 * state: { locked: bool, view?: { x, y, w, h } }
 */
export function drawRoomDynamic(ctx, room, biome, time, state) {
  if (!ctx || !room || !room.tiles || !hasDom()) return;
  const st = state || {};
  const v = st.view || null;
  const S = styleOf(biome);
  const e = prepare(room, biome);
  const P = pieces(S);
  const tm = time || 0;
  const prevAlpha = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;

  // --- hazard glow: two layers pulsing out of phase (additive) ---
  if (e.glow[0] || e.glow[1]) {
    let sx = 0, sy = 0, sw = room.w * TS, sh = room.h * TS;
    if (v) {
      sx = Math.max(0, Math.floor(v.x)); sy = Math.max(0, Math.floor(v.y));
      sw = Math.min(room.w * TS, Math.ceil(v.x + v.w)) - sx; sh = Math.min(room.h * TS, Math.ceil(v.y + v.h)) - sy;
    }
    if (sw > 0 && sh > 0) {
      const speed = S.kind === 'lava' ? 1.6 : S.kind === 'rift' ? 2.6 : S.kind === 'spores' ? 1.1 : 0.9;
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const g = e.glow[k];
        if (!g) continue;
        const s = Math.sin(tm * speed + k * Math.PI * 0.85);
        ctx.globalAlpha = prevAlpha * (S.kind === 'rift' ? 0.55 + 0.4 * s * s : 0.5 + 0.35 * s);
        ctx.drawImage(g, sx, sy, sw, sh, sx, sy, sw, sh);
      }
      ctx.globalCompositeOperation = prevOp;
      ctx.globalAlpha = prevAlpha;
    }
  }

  // --- per-tile hazard particles (spores drifting / rift sparkles / lava bubbles) ---
  const hz = e.hazards;
  if (hz.length) {
    ctx.fillStyle = S.kind === 'rift' ? '#ffd0ff' : S.kind === 'spores' ? S.hzCss : S.kind === 'lava' ? '#fff0b8' : '#ffffff';
    for (let i = 0; i < hz.length; i += 3) {
      const x = hz[i] * TS, y = hz[i + 1] * TS, ph = hz[i + 2];
      if (!inView(v, x, y - 16, TS, TS + 16)) continue;
      if (S.kind === 'spores') {
        for (let k = 0; k < 2; k++) {
          const f = frac(tm * 0.35 + ph + k * 0.5);
          const px = x + 3 + ((ph * 97 + k * 7) % 10) + Math.sin(tm * 1.7 + ph * 9 + k) * 2;
          const py = y + 12 - f * 20;
          ctx.globalAlpha = prevAlpha * Math.sin(f * Math.PI) * 0.85;
          ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
        }
      } else if (S.kind === 'rift') {
        const f = frac(tm * 0.6 + ph);
        if (f < 0.18) {
          ctx.globalAlpha = prevAlpha * (1 - f / 0.18);
          const px = x + 4 + ((ph * 131) % 8), py = y + 4 + ((ph * 71) % 8) - f * 10;
          ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
          ctx.fillRect(Math.round(px) - 1, Math.round(py) + 1, 3, 1);
        }
      } else if (S.kind === 'lava') {
        const f = frac(tm * 0.45 + ph);
        if (f < 0.25) {
          ctx.globalAlpha = prevAlpha * (1 - f / 0.25);
          ctx.fillRect(x + 4 + ((ph * 113) % 8), Math.round(y + 7 - f * 16), 1, 1);
        }
      } else {
        const f = frac(tm * 0.3 + ph);
        if (f < 0.1) {
          ctx.globalAlpha = prevAlpha * (1 - f / 0.1);
          ctx.fillRect(x + 3 + ((ph * 113) % 10), y + 3 + ((ph * 57) % 10), 1, 1);
        }
      }
    }
    ctx.globalAlpha = prevAlpha;
  }

  // --- ice glints: a short white diagonal sweeping across now and then ---
  const ic = e.ice;
  if (ic.length) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < ic.length; i += 3) {
      const x = ic[i] * TS, y = ic[i + 1] * TS, ph = ic[i + 2];
      if (!inView(v, x, y, TS, TS)) continue;
      const f = frac(tm * 0.22 + ph);
      if (f > 0.14) continue;
      const k = f / 0.14;
      ctx.globalAlpha = prevAlpha * Math.sin(k * Math.PI) * 0.9;
      const gx = x + Math.round(k * 14), gy = y + 14 - Math.round(k * 12);
      ctx.fillRect(gx, gy, 1, 1);
      ctx.fillRect(gx + 1, gy - 1, 1, 1);
      ctx.fillRect(gx - 1, gy + 1, 1, 1);
    }
    ctx.globalAlpha = prevAlpha;
  }

  // --- spikes ---
  const sp = e.spikes;
  if (sp.length) {
    const phase = ((tm % SPIKE_CYCLE.period) + SPIKE_CYCLE.period) % SPIKE_CYCLE.period;
    if (phase >= SPIKE_CYCLE.outAt) {
      for (let i = 0; i < sp.length; i += 3) {
        const x = sp[i] * TS, y = sp[i + 1] * TS;
        if (inView(v, x, y - 4, TS, TS + 4)) ctx.drawImage(P.out, x, y);
      }
    } else if (phase >= SPIKE_CYCLE.warnAt) {
      const k = (phase - SPIKE_CYCLE.warnAt) / Math.max(0.01, SPIKE_CYCLE.outAt - SPIKE_CYCLE.warnAt);
      const shimmer = 0.45 + 0.55 * Math.abs(Math.sin(tm * 18));
      ctx.globalAlpha = prevAlpha * Math.min(1, 0.3 + k * 0.7) * shimmer;
      for (let i = 0; i < sp.length; i += 3) {
        const x = sp[i] * TS, y = sp[i + 1] * TS;
        if (inView(v, x, y, TS, TS)) ctx.drawImage(P.warn, x, y);
      }
      ctx.globalAlpha = prevAlpha;
    }
  }

  // --- doors ---
  const doors = room.doors || {};
  for (const dir of ['n', 'e', 's', 'w']) {
    const d = doors[dir];
    if (!d) continue;
    const horiz = dir === 'n' || dir === 's';
    const x = d.tx * TS, y = d.ty * TS, w = horiz ? TS * 2 : TS, h = horiz ? TS : TS * 2;
    if (!inView(v, x, y, w, h)) continue;
    if (st.locked) {
      ctx.drawImage(horiz ? P.gateH : P.gateV, x, y);
      // pulsing seal glow on the lock plate
      ctx.globalAlpha = prevAlpha * (0.35 + 0.35 * Math.sin(tm * 4));
      ctx.fillStyle = S.accCss;
      if (horiz) ctx.fillRect(x + 14, y + 6, 4, 4); else ctx.fillRect(x + 6, y + 14, 4, 4);
      ctx.globalAlpha = prevAlpha;
    } else {
      // open: faint accent chevrons on the threshold pointing outward
      ctx.globalAlpha = prevAlpha * (0.25 + 0.2 * Math.sin(tm * 2.5));
      ctx.fillStyle = S.accCss;
      if (dir === 'n') { ctx.fillRect(x + 13, y + 9, 6, 1); ctx.fillRect(x + 14, y + 8, 4, 1); ctx.fillRect(x + 15, y + 7, 2, 1); }
      else if (dir === 's') { ctx.fillRect(x + 13, y + 6, 6, 1); ctx.fillRect(x + 14, y + 7, 4, 1); ctx.fillRect(x + 15, y + 8, 2, 1); }
      else if (dir === 'w') { ctx.fillRect(x + 9, y + 13, 1, 6); ctx.fillRect(x + 8, y + 14, 1, 4); ctx.fillRect(x + 7, y + 15, 1, 2); }
      else { ctx.fillRect(x + 6, y + 13, 1, 6); ctx.fillRect(x + 7, y + 14, 1, 4); ctx.fillRect(x + 8, y + 15, 1, 2); }
      ctx.globalAlpha = prevAlpha;
    }
  }
  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevOp;
}

export { styleOf as tileStyle };
