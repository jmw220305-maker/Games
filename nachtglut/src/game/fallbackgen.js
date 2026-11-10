// Tiny, always-valid floor (docs/ARCHITECTURE.md §4) used when no generator is injected:
// start → combat → combat → boss, plain rectangles in a west-to-east row. Contains one of every
// interactable prop for testing. DOM-free.
import { RNG } from '../core/rng.js';
import { TILE } from './constants.js';
import { BIOMES } from '../data/biomes.js';

function makeRoom(id, gx, type, w, h) {
  const tiles = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      tiles[ty * w + tx] = (tx === 0 || ty === 0 || tx === w - 1 || ty === h - 1) ? TILE.WALL : TILE.FLOOR;
    }
  }
  return {
    id, gx, gy: 0, type, depth: id, w, h, tiles, doors: {}, spawns: [], props: [],
    variant: 0, visited: false, seen: false, cleared: false,
  };
}

function setTile(room, tx, ty, t) { room.tiles[ty * room.w + tx] = t; }

function fill(room, x0, y0, w, h, t) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setTile(room, x, y, t);
}

/** Connect a (west) with b (east) through 2-tile doors in the middle of their shared walls. */
function link(a, b) {
  const ay = Math.floor(a.h / 2) - 1, by = Math.floor(b.h / 2) - 1;
  a.doors.e = { to: b.id, tx: a.w - 1, ty: ay };
  b.doors.w = { to: a.id, tx: 0, ty: by };
  setTile(a, a.w - 1, ay, TILE.DOOR); setTile(a, a.w - 1, ay + 1, TILE.DOOR);
  setTile(b, 0, by, TILE.DOOR); setTile(b, 0, by + 1, TILE.DOOR);
}

function rosterIds(biome) {
  const list = (biome && biome.enemies) || [];
  const ids = list.map((e) => e.id);
  return ids.length ? ids : ['ash_crawler'];
}

/**
 * @param {{ index?: number, biome?: object|string, seed?: number, difficulty?: object, luck?: number }} opts
 */
export function generateFallbackFloor(opts = {}) {
  const index = opts.index || 1;
  const biome = typeof opts.biome === 'string' ? BIOMES[opts.biome] : (opts.biome || BIOMES.ash);
  const seed = (opts.seed ?? 1) >>> 0;
  const rng = new RNG(seed ^ 0x5eed);
  const diff = opts.difficulty || {};
  const budget = diff.spawnBudget ?? 1;
  const ids = rosterIds(biome);
  const pick = () => rng.pick(ids);

  const start = makeRoom(0, 0, 'start', 17, 13);
  const c1 = makeRoom(1, 1, 'combat', 21, 15);
  const c2 = makeRoom(2, 2, 'combat', 21, 15);
  const boss = makeRoom(3, 3, 'boss', 27, 21);
  link(start, c1); link(c1, c2); link(c2, boss);

  // start room: one of every interactable (kept ≥ 3 tiles from the door at x = 16)
  start.playerStart = { tx: 3, ty: 6 };
  start.props.push(
    { kind: 'chest', tx: 6, ty: 3, tier: 'common' },
    { kind: 'pedestal', tx: 9, ty: 3, offer: 'relic', price: 'auto' },
    { kind: 'pedestal', tx: 11, ty: 3, offer: 'heal', price: 0 },
    { kind: 'shrine', tx: 6, ty: 9 },
    { kind: 'forge', tx: 9, ty: 9 },
    { kind: 'fountain', tx: 11, ty: 9 },
    { kind: 'torch', tx: 1, ty: 2 },
    { kind: 'torch', tx: 1, ty: 10 },
  );

  // combat 1: two waves
  const n1 = Math.max(2, Math.round((2 + index * 0.5) * budget));
  const spots1 = [[6, 3], [10, 4], [14, 3], [6, 11], [10, 10], [14, 11], [16, 7], [12, 7]];
  c1.spawns.push({ delay: 0.6, entries: rng.sample(spots1, n1).map(([tx, ty]) => ({ id: pick(), tx, ty })) });
  c1.spawns.push({ delay: 0.8, entries: rng.sample(spots1, n1).map(([tx, ty]) => ({ id: pick(), tx, ty })) });
  c1.props.push(
    { kind: 'barrel', tx: 4, ty: 2 }, { kind: 'barrel', tx: 4, ty: 12 },
    { kind: 'crystal', tx: 16, ty: 2 }, { kind: 'bones', tx: 12, ty: 12 },
    { kind: 'chest', tx: 10, ty: 2, tier: 'rare', locked: true },
  );

  // combat 2: pit, hazard and spikes; one wave with an elite
  fill(c2, 9, 6, 3, 3, TILE.PIT);
  fill(c2, 5, 11, 2, 2, TILE.HAZARD);
  fill(c2, 14, 2, 2, 1, TILE.SPIKES);
  const spots2 = [[5, 3], [15, 4], [15, 11], [12, 12], [6, 8], [16, 8]];
  const n2 = Math.max(3, Math.round((3 + index * 0.5) * budget));
  const e2 = rng.sample(spots2, Math.min(spots2.length, n2)).map(([tx, ty]) => ({ id: pick(), tx, ty }));
  if (e2.length) e2[0].elite = 1;
  c2.spawns.push({ delay: 0.6, entries: e2 });
  c2.props.push({ kind: 'barrel', tx: 17, ty: 12, explosive: true }, { kind: 'statue', tx: 4, ty: 2 }, { kind: 'mushroom', tx: 17, ty: 2 });

  // boss arena
  boss.spawns.push({ delay: 1.2, entries: [{ id: biome.boss || 'boss_cinder', tx: 18, ty: 10 }] });
  boss.props.push({ kind: 'torch', tx: 1, ty: 2 }, { kind: 'torch', tx: 25, ty: 2 }, { kind: 'torch', tx: 1, ty: 18 }, { kind: 'torch', tx: 25, ty: 18 });

  const rooms = [start, c1, c2, boss];
  for (const r of rooms) r.variant = rng.int(0, 0xffff);
  return { index, biome: biome.id, seed, rooms, startRoomId: 0, bossRoomId: 3 };
}
