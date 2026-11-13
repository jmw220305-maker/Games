// Room population: props by room type and enemy waves (spawn budget, packs, elites, spread placement).
import { TILE } from '../game/constants.js';
import { doorInfo, chebField, flood } from './util.js';

const { FLOOR, WALL } = TILE;

export const FIGHT_TYPES = new Set(['combat', 'elite', 'challenge']);

// Balance knobs (owner: balance). Per-floor spawn budget multiplier (index 1..5) and the chance that an elite
// room holds a sealed chest (each chest is a relic choice; elites already drop ×3 sparks).
const FLOOR_BUDGET = [1, 1.22, 1.35, 1.4, 1.35, 1.0];
const ELITE_CHEST_CHANCE = 0.4;

const DECO = {
  ash: [{ kind: 'bones', solid: false, weight: 3 }, { kind: 'stalagmite', solid: true, weight: 2 }, { kind: 'statue', solid: true, weight: 1 }],
  fungal: [{ kind: 'mushroom', solid: false, weight: 3 }, { kind: 'mushroom', solid: true, weight: 2 }, { kind: 'bones', solid: false, weight: 1 }],
  frost: [{ kind: 'stalagmite', solid: true, weight: 3 }, { kind: 'bones', solid: false, weight: 1 }, { kind: 'statue', solid: true, weight: 1 }],
  void: [{ kind: 'statue', solid: true, weight: 2 }, { kind: 'bones', solid: false, weight: 2 }, { kind: 'stalagmite', solid: true, weight: 1 }],
  core: [{ kind: 'statue', solid: true, weight: 2 }, { kind: 'stalagmite', solid: true, weight: 2 }, { kind: 'bones', solid: false, weight: 1 }],
};

/** Prop placement helper that keeps every walkable tile reachable (props are treated as blocking). */
function makePlacer(rng, room, avoidPts) {
  const { w, h, tiles } = room;
  const { cells, entrances } = doorInfo(room);
  const dd = chebField(w, h, cells);
  const occ = new Uint8Array(w * h);
  const avoid = new Uint8Array(w * h);
  for (const [ax, ay, r] of avoidPts) {
    for (let y = ay - r; y <= ay + r; y++) for (let x = ax - r; x <= ax + r; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h) avoid[y * w + x] = 1;
    }
  }
  // Connectivity is checked by flooding from ONE door: flooding from all doors at once would accept a prop row
  // that splits the room into two halves, each reachable from "some" door (QA: shrine statues sealing a door).
  const start = entrances.length ? [entrances[0]] : entrances;
  const totalWalk = flood(tiles, w, h, start).count;
  let occWalk = 0;
  const props = [];
  const P = {
    w, h, tiles, dd, occ, props, entrances,
    tile(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? tiles[y * w + x] : TILE.VOID; },
    wallSide(x, y) {
      if (P.tile(x, y - 1) === WALL) return 'n';
      if (P.tile(x, y + 1) === WALL) return 's';
      if (P.tile(x - 1, y) === WALL) return 'w';
      if (P.tile(x + 1, y) === WALL) return 'e';
      return null;
    },
    /** wall tile that belongs to the room outline (border or next to VOID) */
    isShell(x, y) {
      if (P.tile(x, y) !== WALL) return false;
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (P.tile(x + dx, y + dy) === TILE.VOID) return true;
      return false;
    },
    /** side of an adjacent outline wall, or null */
    shellSide(x, y) {
      if (P.isShell(x, y - 1)) return 'n';
      if (P.isShell(x, y + 1)) return 's';
      if (P.isShell(x - 1, y)) return 'w';
      if (P.isShell(x + 1, y)) return 'e';
      return null;
    },
    free(x, y, adj = false) {
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return false;
      const i = y * w + x;
      if (tiles[i] !== FLOOR || dd[i] < 4 || occ[i] || avoid[i]) return false;
      if (!adj) {
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (occ[yy * w + xx]) return false;
      }
      return true;
    },
    add(kind, x, y, extra = {}, adj = false) {
      if (!P.free(x, y, adj)) return null;
      const i = y * w + x;
      occ[i] = 1;
      if (flood(tiles, w, h, start, occ).count !== totalWalk - occWalk - 1) { occ[i] = 0; return null; }
      occWalk++;
      const p = { kind, tx: x, ty: y, ...extra };
      props.push(p);
      return p;
    },
    remove(p) {
      const k = props.indexOf(p);
      if (k < 0) return;
      props.splice(k, 1);
      occ[p.ty * w + p.tx] = 0;
      occWalk--;
    },
    /** place a set of props atomically */
    group(list) {
      const done = [];
      for (const [kind, x, y, extra] of list) {
        const p = P.add(kind, x, y, extra);
        if (!p) { for (const q of done) P.remove(q); return null; }
        done.push(p);
      }
      return done;
    },
    /** first cell (by distance to x,y) passing fn */
    nearest(x, y, maxR, fn) {
      for (let r = 0; r <= maxR; r++) {
        const ring = [];
        for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
          ring.push([xx, yy, (xx - x) ** 2 + (yy - y) ** 2]);
        }
        ring.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
        for (const [xx, yy] of ring) if (fn(xx, yy)) return [xx, yy];
      }
      return null;
    },
    /** place at the free cell closest to (x, y) */
    addNear(kind, x, y, extra = {}, maxR = 8) {
      let placed = null;
      P.nearest(x, y, maxR, (xx, yy) => {
        if (!P.free(xx, yy)) return false;
        placed = P.add(kind, xx, yy, extra);
        return !!placed;
      });
      return placed;
    },
    cells(filter) {
      const out = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (filter(x, y)) out.push([x, y]);
      return out;
    },
  };
  return P;
}

/** spread-out picks among candidate cells (best of k random samples by distance to already picked) */
function spreadPick(rng, cands, picked, minD = 0, k = 12) {
  if (!cands.length) return null;
  let best = null, bestS = -Infinity;
  for (let t = 0; t < k; t++) {
    const c = cands[rng.int(0, cands.length - 1)];
    let d = 99;
    for (const p of picked) d = Math.min(d, Math.hypot(p[0] - c[0], p[1] - c[1]));
    if (d < minD) continue;
    const s = Math.min(d, 9) + rng.next() * 0.5;
    if (s > bestS) { bestS = s; best = c; }
  }
  return best;
}

function placeTorches(rng, P, n, opts = {}) {
  let cands = P.cells((x, y) => P.free(x, y) && P.shellSide(x, y));
  if (cands.length < n * 3) cands = cands.concat(P.cells((x, y) => P.free(x, y) && !P.shellSide(x, y) && P.wallSide(x, y)));
  const placed = [];
  for (let k = 0; k < n && cands.length; k++) {
    let ok = false;
    for (let t = 0; t < 6 && !ok && cands.length; t++) {
      const c = spreadPick(rng, cands, placed, t < 3 ? (opts.minD ?? 4) : 2, 16);
      if (!c) continue;
      const side = P.shellSide(c[0], c[1]) || P.wallSide(c[0], c[1]);
      if (P.add('torch', c[0], c[1], { wall: side })) { placed.push(c); ok = true; }
      else cands.splice(cands.indexOf(c), 1);
    }
  }
  return placed.length;
}

function placeDeco(rng, P, biomeId, n) {
  const table = DECO[biomeId] || DECO.ash;
  for (let k = 0; k < n; k++) {
    const d = rng.weighted(table);
    const cands = P.cells((x, y) => P.free(x, y) && (!d.solid || P.wallSide(x, y)));
    for (let t = 0; t < 4 && cands.length; t++) {
      const c = cands[rng.int(0, cands.length - 1)];
      if (P.add(d.kind, c[0], c[1], { solid: d.solid })) break;
    }
  }
}

function placeBarrels(rng, P, n, explosiveOk = true) {
  let left = n;
  while (left > 0) {
    const cands = P.cells((x, y) => P.free(x, y) && P.wallSide(x, y));
    if (!cands.length) return;
    const c = cands[rng.int(0, cands.length - 1)];
    const first = P.add('barrel', c[0], c[1], { explosive: explosiveOk && rng.chance(0.15) });
    if (!first) { left--; continue; }
    left--;
    // small cluster
    const extra = Math.min(left, rng.int(0, 2));
    for (let e = 0; e < extra; e++) {
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [c[0] + dx, c[1] + dy]).filter(([x, y]) => P.free(x, y, true) && P.wallSide(x, y));
      if (!nb.length) break;
      const [x, y] = nb[rng.int(0, nb.length - 1)];
      if (P.add('barrel', x, y, { explosive: explosiveOk && rng.chance(0.15) }, true)) left--;
      else break;
    }
  }
}

function placeCrystals(rng, P, n) {
  for (let k = 0; k < n; k++) {
    const cands = P.cells((x, y) => P.free(x, y));
    if (!cands.length) return;
    for (let t = 0; t < 4; t++) {
      const c = cands[rng.int(0, cands.length - 1)];
      if (P.add('crystal', c[0], c[1])) break;
    }
  }
}

function torchCount(room, lo, hi) {
  const area = (room.w - 2) * (room.h - 2);
  return Math.max(lo, Math.min(hi, lo + Math.floor(area / 140)));
}

// -----------------------------------------------------------------------------------------------

function propsFor(rng, room, P, ctx) {
  const cx = Math.floor(room.w / 2), cy = Math.floor(room.h / 2);
  const biomeId = ctx.biome.id;
  switch (room.type) {
    case 'start':
      placeTorches(rng, P, rng.int(2, 4));
      if (ctx.index >= 2) placeDeco(rng, P, biomeId, rng.int(0, 2));
      break;
    case 'treasure': {
      let done = false;
      if (rng.chance(0.25)) {
        for (const dy of [0, 1, -1, 2, -2]) {
          const y = cy + dy;
          const list = [-2, 0, 2].map((dx) => ['pedestal', cx + dx, y, { offer: 'relic', price: 0, group: 'treasure' }]);
          if (P.group(list)) { done = true; break; }
        }
      }
      if (!done) P.addNear('chest', cx, cy, { tier: rng.chance(0.2 + 0.05 * (ctx.luck || 0)) ? 'rare' : 'common' });
      placeTorches(rng, P, rng.int(2, 4));
      break;
    }
    case 'shop': placeShop(rng, room, P); placeTorches(rng, P, rng.int(2, 4)); break;
    case 'shrine': {
      P.addNear('shrine', cx, cy, {});
      const sd = rng.chance(0.5) ? [[-3, -2], [3, -2], [-3, 2], [3, 2]] : [[-3, 0], [3, 0]];
      for (const [dx, dy] of sd) P.add('statue', cx + dx, cy + dy, { solid: true });
      placeTorches(rng, P, rng.int(2, 4));
      break;
    }
    case 'forge':
      P.addNear('forge', cx, cy, {});
      placeBarrels(rng, P, 2, false);
      placeTorches(rng, P, rng.int(2, 4));
      break;
    case 'rest':
      P.addNear('fountain', cx, cy, {});
      placeDeco(rng, P, biomeId, rng.int(2, 3));
      placeTorches(rng, P, rng.int(2, 4));
      break;
    case 'secret':
      P.addNear('chest', cx, cy, { tier: rng.chance(0.5) ? 'cursed' : 'rare' });
      placeCrystals(rng, P, rng.int(2, 3));
      placeTorches(rng, P, 2);
      break;
    case 'challenge':
      P.addNear('chest', cx, cy, { tier: 'rare', locked: true });
      placeTorches(rng, P, torchCount(room, 3, 6));
      placeBarrels(rng, P, rng.int(0, 2));
      break;
    case 'boss': placeBossTorches(rng, room, P); break;
    default: // combat / elite
      if (room.type === 'elite' && rng.chance(ELITE_CHEST_CHANCE)) P.addNear('chest', cx, cy, { tier: 'common', locked: true });
      placeTorches(rng, P, torchCount(room, 2, 6));
      placeBarrels(rng, P, rng.int(0, 4));
      placeCrystals(rng, P, rng.int(0, 2));
      placeDeco(rng, P, biomeId, rng.int(0, 3));
  }
}

function placeShop(rng, room, P) {
  const n = rng.chance(0.5) ? 6 : 5;
  const order = n === 6 ? ['heal', 'relic', 'relic', 'relic', 'weapon', 'boon'] : ['heal', 'relic', 'relic', 'relic', 'weapon'];
  if (rng.chance(0.5)) order.reverse();
  const arc = rng.chance(0.5);
  const cxF = (room.w - 1) / 2;
  const baseY = Math.round((room.h - 1) / 2) + 1;
  for (const dy of [0, -1, 1, 2, -2]) {
    const y = baseY + dy;
    const list = order.map((offer, j) => ['pedestal', Math.round(cxF - (n - 1) + 2 * j), y - (arc && (j === 0 || j === n - 1) ? 1 : 0), { offer, price: 'auto' }]);
    list.push(['statue', Math.round(cxF), y - 2, { solid: true, role: 'merchant' }]);
    if (P.group(list)) return;
    list[list.length - 1] = ['statue', Math.round(cxF), y + 2, { solid: true, role: 'merchant' }];
    if (P.group(list)) return;
  }
  // fallback: cluster around the centre
  const cx = Math.floor(room.w / 2), cy = Math.floor(room.h / 2);
  P.addNear('statue', cx, cy - 2, { solid: true, role: 'merchant' });
  for (const offer of order) P.addNear('pedestal', cx, cy + 1, { offer, price: 'auto' }, 10);
}

function placeBossTorches(rng, room, P) {
  const pairs = rng.int(2, 4);
  const cands = P.cells((x, y) => x < room.w / 2 - 1 && P.free(x, y) && P.shellSide(x, y) && P.free(room.w - 1 - x, y) && P.shellSide(room.w - 1 - x, y));
  const placed = [];
  for (let k = 0; k < pairs && cands.length; k++) {
    const c = spreadPick(rng, cands, placed, 4, 20);
    if (!c) break;
    const m = room.w - 1 - c[0];
    const got = P.group([['torch', c[0], c[1], { wall: P.shellSide(c[0], c[1]) }], ['torch', m, c[1], { wall: P.shellSide(m, c[1]) }]]);
    if (got) placed.push(c, [m, c[1]]);
    cands.splice(cands.indexOf(c), 1);
    k -= got ? 0 : 1;
    if (!cands.length) break;
  }
  if (placed.length < 4) placeTorches(rng, P, 4 - placed.length);
}

// -----------------------------------------------------------------------------------------------

function buyWave(rng, roster, budget, counts, maxEntries) {
  const entries = [];
  const types = new Set();
  let remaining = budget;
  while (entries.length < maxEntries) {
    let afford = roster.filter((e) => {
      if (e.max !== undefined && (counts[e.id] || 0) >= e.max) return false;
      const minN = e.pack ? e.pack[0] : 1;
      return e.cost * minN <= remaining + 1e-9;
    });
    if (!afford.length) break;
    if (types.size === 1) {
      const other = afford.filter((e) => !types.has(e.id));
      if (other.length) afford = other;
    }
    const e = rng.weighted(afford);
    let n = 1;
    if (e.pack) {
      n = rng.int(e.pack[0], e.pack[1]);
      n = Math.min(n, Math.floor((remaining + 1e-9) / e.cost), maxEntries - entries.length);
      if (e.max !== undefined) n = Math.min(n, e.max - (counts[e.id] || 0));
      if (n < Math.min(e.pack[0], 2)) break;
    }
    const group = { id: e.id, n, pack: !!e.pack, cost: e.cost };
    entries.push(group);
    types.add(e.id);
    counts[e.id] = (counts[e.id] || 0) + n;
    remaining -= e.cost * n;
  }
  return { groups: entries, left: Math.max(0, remaining) };
}

function makeSpawns(rng, room, P, ctx) {
  const { index, biome, difficulty } = ctx;
  const { w, h, tiles } = room;
  const roster = biome.enemies.filter((e) => (e.minDepth ?? 0) <= room.depth);
  if (!roster.length) return [];
  // candidate tiles: plain floor, away from doors, not on/next to props
  const strict = P.cells((x, y) => {
    const i = y * w + x;
    if (tiles[i] !== FLOOR || P.dd[i] < 4 || P.occ[i]) return false;
    return !P.occ[i - 1] && !P.occ[i + 1] && !P.occ[i - w] && !P.occ[i + w];
  });
  const cands = strict.length >= 12 ? strict : P.cells((x, y) => tiles[y * w + x] === FLOOR && P.dd[y * w + x] >= 4 && !P.occ[y * w + x]);
  if (!cands.length) return [];

  const area = cands.length;
  const areaF = Math.max(0.75, Math.min(1.4, area / 160));
  let mul = 1;
  if (room.type === 'elite') mul = 1.25;
  else if (room.type === 'challenge') mul = 1.6;
  if (ctx.lowBudget) mul *= ctx.gauntlet ? 0.8 : 0.55;
  else if (ctx.gauntlet) mul *= 1.12;
  const budget = (5 + 2.2 * index + 1.1 * room.depth) * (FLOOR_BUDGET[index] ?? 1) * (difficulty.spawnBudget ?? 1) * areaF * mul;

  let waves;
  if (room.type === 'challenge') waves = rng.int(3, 4);
  else if (room.type === 'elite') waves = rng.chance(0.35 + 0.1 * index) ? 2 : 1;
  else if (ctx.lowBudget) waves = 1;
  else {
    waves = 1;
    if (rng.chance(Math.min(0.85, 0.3 + 0.12 * index + 0.05 * room.depth))) waves++;
    if (rng.chance(Math.min(0.4, 0.05 * index + 0.03 * room.depth))) waves++;
  }
  const shares = [];
  for (let k = 0; k < waves; k++) shares.push(rng.float(0.85, 1.15) * (1 + 0.08 * k));
  const tot = shares.reduce((a, b) => a + b, 0);

  const counts = {};
  const out = [];
  let carry = 0;
  for (let k = 0; k < waves; k++) {
    const { groups, left } = buyWave(rng, roster, (budget * shares[k]) / tot + carry, counts, 18);
    carry = left;
    if (!groups.length) continue;
    const picked = [];
    const used = new Set();
    const entries = [];
    for (const g of groups) {
      const free = cands.filter((c) => !used.has(c[1] * w + c[0]));
      const centre = spreadPick(rng, free, picked, 0, 14);
      if (!centre) break;
      const members = [centre];
      if (g.n > 1) {
        const near = free
          .filter((c) => c !== centre && Math.hypot(c[0] - centre[0], c[1] - centre[1]) <= 3.2)
          .map((c) => [c, Math.hypot(c[0] - centre[0], c[1] - centre[1]) + rng.next() * 0.6])
          .sort((a, b) => a[1] - b[1]);
        for (let m = 0; m < near.length && members.length < g.n; m++) members.push(near[m][0]);
      }
      for (const c of members) {
        used.add(c[1] * w + c[0]);
        picked.push(c);
        entries.push({ id: g.id, tx: c[0], ty: c[1], _pack: g.pack, _cost: g.cost });
      }
    }
    if (!entries.length) continue;
    out.push({ delay: round2(out.length === 0 ? rng.float(0.5, 0.8) : rng.float(0.6, 1.2)), entries });
  }

  // elites
  const extra = difficulty.extraAffixes ?? 0;
  const all = out.flatMap((wv) => wv.entries);
  if (room.type === 'elite' && all.length) {
    const nElite = 1 + (rng.chance(0.35 + 0.1 * index) ? 1 : 0);
    const pool = all.filter((e) => !e._pack);
    const src = (pool.length ? pool : all).map((e) => [e, e._cost + rng.next() * 0.1]).sort((a, b) => b[1] - a[1]);
    for (let k = 0; k < Math.min(nElite, src.length); k++) {
      src[k][0].elite = (index >= 3 && rng.chance(0.3) ? 2 : 1) + extra;
    }
  } else if (!ctx.lowBudget) {
    const p = 0.03 + 0.03 * index + (difficulty.eliteChance ?? 0);
    for (const e of all) if (!e._pack && rng.chance(p)) e.elite = 1 + extra;
  }
  for (const e of all) { delete e._pack; delete e._cost; }
  return out;
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Fill room.props and room.spawns.
 * ctx = { index, biome (object), difficulty, luck, lowBudget, gauntlet, bossSpawn }
 */
export function populateRoom(rng, room, ctx) {
  const avoid = [];
  if (room.playerStart) avoid.push([room.playerStart.tx, room.playerStart.ty, 2]);
  if (ctx.bossSpawn) avoid.push([ctx.bossSpawn.tx, ctx.bossSpawn.ty, 3]);
  const P = makePlacer(rng, room, avoid);
  propsFor(rng.fork('props'), room, P, ctx);
  room.props = P.props;
  if (room.type === 'boss') {
    room.spawns = [{ delay: 0.8, entries: [{ id: ctx.biome.boss, tx: ctx.bossSpawn.tx, ty: ctx.bossSpawn.ty }] }];
  } else if (FIGHT_TYPES.has(room.type)) {
    room.spawns = makeSpawns(rng.fork('spawns'), room, P, ctx);
  } else {
    room.spawns = [];
  }
}
