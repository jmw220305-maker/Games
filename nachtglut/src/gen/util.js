// Shared helpers for the floor generator (pure, DOM-free).
import { TILE } from '../game/constants.js';

export const SIDES = Object.freeze(['n', 'e', 's', 'w']);

const WALK = new Uint8Array(256);
WALK[TILE.FLOOR] = 1; WALK[TILE.SPIKES] = 1; WALK[TILE.HAZARD] = 1; WALK[TILE.ICE] = 1;

/** walkable for ground units (FLOOR/SPIKES/HAZARD/ICE) */
export const isWalkable = (t) => WALK[t] === 1;
/** tiles that hurt or hinder the player and must stay away from doors / the player start */
export const isDanger = (t) => t === TILE.SPIKES || t === TILE.HAZARD || t === TILE.ICE;

/** the two tiles of a door: [[x, y], [x, y]] */
export function doorCells(side, d) {
  return side === 'n' || side === 's'
    ? [[d.tx, d.ty], [d.tx + 1, d.ty]]
    : [[d.tx, d.ty], [d.tx, d.ty + 1]];
}

/**
 * Rectangle (inclusive [x0, y0, x1, y1]) of interior cells in front of a door.
 * depth = how many rows/cols into the room, extra = widening on both sides of the 2-tile door.
 */
export function laneRect(side, d, w, h, depth, extra = 0) {
  switch (side) {
    case 'n': return [d.tx - extra, 1, d.tx + 1 + extra, depth];
    case 's': return [d.tx - extra, h - 1 - depth, d.tx + 1 + extra, h - 2];
    case 'w': return [1, d.ty - extra, depth, d.ty + 1 + extra];
    default: return [w - 1 - depth, d.ty - extra, w - 2, d.ty + 1 + extra]; // 'e'
  }
}

/** inner tiles directly in front of the door tiles (flood-fill entry points) */
export function doorEntrances(side, d, w, h) {
  const [x0, y0, x1, y1] = laneRect(side, d, w, h, 1, 0);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

/** all door tiles + entrance tiles of a room-like object { w, h, doors } */
export function doorInfo(room) {
  const cells = [], entrances = [];
  for (const side of SIDES) {
    const d = room.doors[side];
    if (!d) continue;
    for (const c of doorCells(side, d)) cells.push(c);
    for (const c of doorEntrances(side, d, room.w, room.h)) entrances.push(c);
  }
  return { cells, entrances };
}

/** Chebyshev distance field to a set of points (small point sets only). */
export function chebField(w, h, pts) {
  const g = new Int16Array(w * h).fill(999);
  if (!pts.length) return g;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = 999;
      for (let k = 0; k < pts.length; k++) {
        const dx = Math.abs(x - pts[k][0]), dy = Math.abs(y - pts[k][1]);
        const d = dx > dy ? dx : dy;
        if (d < best) best = d;
      }
      g[y * w + x] = best;
    }
  }
  return g;
}

/**
 * 4-connected flood fill over walkable tiles.
 * starts: [[x, y]], block: optional Uint8Array (1 = treat as blocked, e.g. props).
 * returns { seen: Uint8Array, count }
 */
export function flood(tiles, w, h, starts, block = null) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (const [x, y] of starts) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (seen[i] || !WALK[tiles[i]] || (block && block[i])) continue;
    seen[i] = 1; q[qt++] = i;
  }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < n) visit(i + w);
  }
  function visit(j) {
    if (seen[j] || !WALK[tiles[j]] || (block && block[j])) return;
    seen[j] = 1; q[qt++] = j;
  }
  return { seen, count: qt };
}

/** number of walkable tiles (optionally excluding blocked ones) */
export function countWalkable(tiles, block = null) {
  let c = 0;
  for (let i = 0; i < tiles.length; i++) if (WALK[tiles[i]] && !(block && block[i])) c++;
  return c;
}

export const clampInt = (v, a, b) => (v < a ? a : v > b ? b : v);
