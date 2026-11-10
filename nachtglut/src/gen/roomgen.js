// Room tile generation: size, shape mask (VOID + WALL carving), doors, interior layout, repair.
import { TILE } from '../game/constants.js';
import { laneRect, doorCells, doorEntrances, flood, isWalkable } from './util.js';
import { makeLayoutContext, pickLayout, hazardPass, LAYOUTS } from './layouts.js';

const { FLOOR, WALL, PIT, DOOR, ICE, VOID } = TILE;

export const SAFE_TYPES = new Set(['start', 'shop', 'treasure', 'shrine', 'forge', 'rest', 'secret', 'boss']);
export const MIN_OPEN = 0.56; // FLOOR + ICE share of the interior

const oddInt = (rng, a, b) => {
  const v = rng.int(a, b);
  if (v % 2) return v;
  return v + 1 <= b ? v + 1 : v - 1;
};

const CLASSES = {
  small: (r) => [r.int(15, 19), r.int(11, 13)],
  medium: (r) => [r.int(19, 25), r.int(13, 17)],
  large: (r) => [r.int(25, 33), r.int(15, 21)],
  tall: (r) => [r.int(15, 21), r.int(17, 21)],
  square: (r) => [r.int(19, 23), r.int(17, 19)],
  tallSmall: (r) => [r.int(13, 15), r.int(15, 17)],
};

export function pickSize(rng, type, index) {
  const pickCls = (opts) => rng.weighted(opts.map(([c, weight]) => ({ c, weight }))).c;
  let cls;
  switch (type) {
    case 'boss': return { w: oddInt(rng, 25, 31), h: oddInt(rng, 19, 23) };
    case 'start': return { w: oddInt(rng, 15, 19), h: oddInt(rng, 11, 13) };
    case 'secret': return { w: rng.int(15, 17), h: rng.int(11, 13) };
    case 'shop': return { w: oddInt(rng, 19, 23), h: oddInt(rng, 13, 15) };
    case 'treasure': case 'shrine': case 'forge': case 'rest':
      cls = pickCls([['small', 3], ['medium', 1.5], ['tallSmall', 1]]);
      if (cls === 'medium') { const [w, h] = [rng.int(17, 21), rng.int(13, 15)]; return { w, h }; }
      break;
    case 'elite': cls = pickCls([['medium', 3], ['large', 3], ['square', 2], ['tall', 1]]); break;
    case 'challenge': cls = pickCls([['large', 4], ['square', 2]]); break;
    default:
      cls = pickCls([['small', Math.max(1, 4 - index)], ['medium', 4], ['large', 1 + index * 0.6], ['tall', 1.5], ['square', 1.5]]);
  }
  const [w, h] = CLASSES[cls](rng);
  return { w, h };
}

export function pickShape(rng, type, w, h) {
  if (type === 'boss') return rng.chance(0.4) ? 'octagon' : 'rect';
  if (type === 'start' || type === 'shop' || type === 'secret') return 'rect';
  if (SAFE_TYPES.has(type)) return rng.chance(0.3) ? 'octagon' : 'rect';
  const opts = [{ s: 'rect', weight: 5 }, { s: 'octagon', weight: 2 }];
  if (w >= 17 && h >= 13) opts.push({ s: 'L', weight: 1.6 });
  if (w >= 21 && h >= 15) opts.push({ s: 'plus', weight: 1.3 }, { s: 'donut', weight: 1.1 });
  if (w >= 25 || (h >= 19 && w >= 15)) opts.push({ s: 'chambers', weight: 1.3 });
  return rng.weighted(opts).s;
}

/** Interior mask (1 = playable cell). Border cells are never inside. */
export function makeMask(rng, shape, w, h) {
  const m = new Uint8Array(w * h);
  const x0 = 1, y0 = 1, x1 = w - 2, y1 = h - 2, iw = w - 2, ih = h - 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  const clear = (ax, ay, bx, by) => {
    for (let y = Math.max(y0, ay); y <= Math.min(y1, by); y++) for (let x = Math.max(x0, ax); x <= Math.min(x1, bx); x++) m[y * w + x] = 0;
  };
  switch (shape) {
    case 'L': {
      const cw = Math.round(iw * rng.float(0.34, 0.48)), ch = Math.round(ih * rng.float(0.34, 0.46));
      const c = rng.int(0, 3);
      if (c === 0) clear(x0, y0, x0 + cw - 1, y0 + ch - 1);
      else if (c === 1) clear(x1 - cw + 1, y0, x1, y0 + ch - 1);
      else if (c === 2) clear(x0, y1 - ch + 1, x0 + cw - 1, y1);
      else clear(x1 - cw + 1, y1 - ch + 1, x1, y1);
      break;
    }
    case 'plus': {
      const cw = Math.round(iw * rng.float(0.2, 0.3)), ch = Math.round(ih * rng.float(0.2, 0.3));
      clear(x0, y0, x0 + cw - 1, y0 + ch - 1); clear(x1 - cw + 1, y0, x1, y0 + ch - 1);
      clear(x0, y1 - ch + 1, x0 + cw - 1, y1); clear(x1 - cw + 1, y1 - ch + 1, x1, y1);
      break;
    }
    case 'octagon': {
      const k = rng.int(2, Math.max(2, Math.min(6, Math.floor(Math.min(iw, ih) / 3.2))));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (Math.min(x - x0, x1 - x) + Math.min(y - y0, y1 - y) < k) m[y * w + x] = 0;
      }
      break;
    }
    case 'donut': {
      const rx = Math.max(5, Math.round(iw * rng.float(0.28, 0.34)));
      const ry = Math.max(4, Math.round(ih * rng.float(0.3, 0.36)));
      if (x1 - rx - (x0 + rx) >= 1 && y1 - ry - (y0 + ry) >= 1) clear(x0 + rx, y0 + ry, x1 - rx, y1 - ry);
      break;
    }
    case 'chambers': {
      const horiz = iw >= 23 && (iw >= ih * 1.15 || ih < 17);
      if (horiz) {
        const a = Math.round(iw * rng.float(0.35, 0.41));
        const c = rng.int(1, 2);
        const ya = Math.floor((h - 1) / 2) - c, yb = Math.ceil((h - 1) / 2) + c;
        clear(x0 + a, y0, x1 - a, ya - 1); clear(x0 + a, yb + 1, x1 - a, y1);
        const inset = ih >= 13 ? rng.int(0, 2) : 0;
        if (inset) { const side = rng.chance(0.5); clear(side ? x0 : x1 - a + 1, y0, side ? x0 + a - 1 : x1, y0 + inset - 1); }
      } else {
        const a = Math.round(ih * rng.float(0.35, 0.41));
        const c = rng.int(1, 2);
        const xa = Math.floor((w - 1) / 2) - c, xb = Math.ceil((w - 1) / 2) + c;
        clear(x0, y0 + a, xa - 1, y1 - a); clear(xb + 1, y0 + a, x1, y1 - a);
      }
      break;
    }
    default: break;
  }
  return m;
}

/** Find a door position on `side` (first tile index along the wall) with a 4x4 interior lane, or null. */
function placeDoor(rng, side, w, h, mask, centred) {
  const along = side === 'n' || side === 's';
  const len = along ? w : h;
  const ideal = Math.floor((len - 2) / 2);
  const off = centred ? 0 : rng.chance(0.4) ? rng.int(-3, 3) : 0;
  const target = ideal + off;
  let best = null, bestD = Infinity;
  for (let t = 2; t <= len - 4; t++) {
    const d = along ? { tx: t, ty: side === 'n' ? 0 : h - 1 } : { tx: side === 'w' ? 0 : w - 1, ty: t };
    const [ax, ay, bx, by] = laneRect(side, d, w, h, 4, 1);
    let ok = true;
    for (let y = ay; y <= by && ok; y++) for (let x = ax; x <= bx; x++) {
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2 || !mask[y * w + x]) { ok = false; break; }
    }
    if (!ok) continue;
    const dd = Math.abs(t - target) + Math.abs(t - ideal) * 0.01;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/** Carve tiles from the mask: inside = FLOOR, 8-neighbours of inside = WALL, rest VOID. */
function carve(mask, w, h) {
  const tiles = new Uint8Array(w * h).fill(VOID);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) { tiles[i] = FLOOR; continue; }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) { near = true; break; }
      }
      if (near) tiles[i] = WALL;
    }
  }
  return tiles;
}

/** Re-connect unreachable walkable pockets by carving the shortest path through obstacles. */
export function repairConnectivity(tiles, w, h, mask, starts) {
  for (let iter = 0; iter < 64; iter++) {
    const { seen } = flood(tiles, w, h, starts);
    let missing = -1;
    for (let i = 0; i < tiles.length; i++) if (mask[i] && isWalkable(tiles[i]) && !seen[i]) { missing = i; break; }
    if (missing < 0) return true;
    const prev = new Int32Array(w * h).fill(-2);
    const q = new Int32Array(w * h);
    let qh = 0, qt = 0;
    for (let i = 0; i < tiles.length; i++) if (seen[i]) { prev[i] = -1; q[qt++] = i; }
    let hit = -1;
    while (qh < qt && hit < 0) {
      const i = q[qh++];
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= tiles.length || prev[j] !== -2 || !mask[j]) continue;
        prev[j] = i;
        if (isWalkable(tiles[j]) && !seen[j]) { hit = j; break; }
        q[qt++] = j;
      }
    }
    if (hit < 0) {
      // cannot happen with a connected mask; as a last resort flatten the pocket
      for (let i = 0; i < tiles.length; i++) if (mask[i] && isWalkable(tiles[i]) && !seen[i]) tiles[i] = WALL;
      continue;
    }
    for (let j = hit; j >= 0 && prev[j] !== -1; j = prev[j]) if (!isWalkable(tiles[j])) tiles[j] = FLOOR;
  }
  return false;
}

/** share of FLOOR+ICE among interior cells */
export function openRatio(tiles, mask) {
  let inside = 0, open = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (!mask[i]) continue;
    inside++;
    if (tiles[i] === FLOOR || tiles[i] === ICE) open++;
  }
  return inside ? open / inside : 0;
}

/**
 * Build the static part of a room.
 * spec = { type, index, biome (id), sides: string[] }
 * returns { w, h, tiles, mask, doors: { side: { tx, ty } }, shape, layout, playerStart?, bossSpawn? }
 */
export function buildRoom(rng, spec) {
  const { type, index, biome, sides } = spec;
  const safe = SAFE_TYPES.has(type);
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rng.fork('a' + attempt);
    const plain = attempt >= 8 || spec.plain;
    const { w, h } = pickSize(r, type, index);
    const shape = plain || attempt >= 5 ? 'rect' : pickShape(r, type, w, h);
    const mask = makeMask(r, shape, w, h);
    const doors = {};
    let ok = true;
    for (const side of sides) {
      const d = placeDoor(r, side, w, h, mask, type === 'boss' || plain);
      if (!d) { ok = false; break; }
      doors[side] = d;
    }
    if (!ok) continue;
    const tiles = carve(mask, w, h);
    const noBlock = new Uint8Array(w * h), noHaz = new Uint8Array(w * h);
    const protect = (x, y, rad, blockRad) => {
      for (let yy = y - rad; yy <= y + rad; yy++) for (let xx = x - rad; xx <= x + rad; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        noHaz[yy * w + xx] = 1;
        if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) <= blockRad) noBlock[yy * w + xx] = 1;
      }
    };
    const starts = [];
    for (const side of sides) {
      const d = doors[side];
      for (const [x, y] of doorCells(side, d)) { tiles[y * w + x] = DOOR; protect(x, y, 2, -1); }
      const [ax, ay, bx, by] = laneRect(side, d, w, h, 4, 1);
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { noBlock[y * w + x] = 1; noHaz[y * w + x] = 1; }
      for (const c of doorEntrances(side, d, w, h)) starts.push(c);
    }
    let playerStart, bossSpawn;
    const cxT = Math.floor(w / 2), cyT = Math.floor(h / 2);
    if (type === 'start') { playerStart = { tx: cxT, ty: cyT }; protect(cxT, cyT, 2, 1); }
    if (type === 'boss') { bossSpawn = { tx: cxT, ty: 1 + Math.round((h - 2) * 0.28) }; protect(bossSpawn.tx, bossSpawn.ty, 2, 2); }
    if (safe && type !== 'boss') protect(cxT, cyT, 1, 1); // keep the centre free for the centrepiece

    const L = makeLayoutContext(r, { w, h, tiles, mask, noBlock, noHaz }, { index, biome, safe });
    const layout = plain ? 'empty' : pickLayout(r, type, L);
    LAYOUTS[layout].fn(L);
    if (!plain && !safe) hazardPass(L, layout);

    // approaches: guaranteed FLOOR (2 x 3 in front of each door)
    for (const side of sides) {
      const [ax, ay, bx, by] = laneRect(side, doors[side], w, h, 3, 0);
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) tiles[y * w + x] = FLOOR;
    }
    if (!repairConnectivity(tiles, w, h, mask, starts)) continue;
    if (openRatio(tiles, mask) < MIN_OPEN) continue;
    if (playerStart && tiles[playerStart.ty * w + playerStart.tx] !== FLOOR) continue;
    if (bossSpawn && tiles[bossSpawn.ty * w + bossSpawn.tx] !== FLOOR) continue;
    return { w, h, tiles, mask, doors, shape, layout, playerStart, bossSpawn };
  }
  // guaranteed fallback: plain rectangle, centred doors, no obstacles
  return buildRoom(rng.fork('plain'), { ...spec, plain: true });
}

