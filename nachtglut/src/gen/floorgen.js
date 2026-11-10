// Floor generator entry point (ARCHITECTURE.md §4). Pure + deterministic: same arguments -> identical floor.
import { RNG } from '../core/rng.js';
import { BIOMES, biomeForFloor } from '../data/biomes.js';
import { planFloor, buildGraph, assignTypes } from './graph.js';
import { buildRoom } from './roomgen.js';
import { populateRoom } from './populate.js';
import { validateRoom } from './validate.js';

function resolveBiome(biome, index) {
  if (biome && typeof biome === 'object') return biome;
  if (typeof biome === 'string' && BIOMES[biome]) return BIOMES[biome];
  return biomeForFloor(index);
}

function sideTo(a, b) {
  if (b.gx > a.gx) return 'e';
  if (b.gx < a.gx) return 'w';
  if (b.gy > a.gy) return 's';
  return 'n';
}

const SIDE_ORDER = ['n', 'e', 's', 'w'];

/**
 * @param {{ index: number, biome: object|string, seed: number, difficulty?: object, luck?: number }} opts
 */
export function generateFloor({ index = 1, biome, seed = 0, difficulty = {}, luck = 0 } = {}) {
  index = Math.max(1, Math.min(5, Math.floor(index) || 1));
  const bio = resolveBiome(biome, index);
  difficulty = difficulty || {};
  const rng = new RNG(seed);
  const gRng = rng.fork('graph');
  const tRng = rng.fork('types');
  const rRng = rng.fork('rooms');

  const plan = planFloor(gRng, index);
  const graph = buildGraph(gRng, plan);
  const { types, lowBudget } = assignTypes(tRng, graph, plan);
  const { nodes, startId, bossId } = graph;
  const secretIds = new Set(nodes.filter((n) => types[n.id] === 'secret').map((n) => n.id));

  const rooms = nodes.map((node) => {
    const type = types[node.id];
    const links = {};
    for (const b of node.adj) links[sideTo(node, nodes[b])] = b;
    const sides = SIDE_ORDER.filter((s) => links[s] !== undefined);
    const roomRng = rRng.fork('room' + node.id);
    const ctx = { index, biome: bio, difficulty, luck, lowBudget: lowBudget.has(node.id), gauntlet: plan.gauntlet };

    let room = null;
    for (let attempt = 0; attempt < 4 && !room; attempt++) {
      const r = attempt === 0 ? roomRng : roomRng.fork('retry' + attempt);
      const built = buildRoom(r.fork('tiles'), { type, index, biome: bio.id, sides, plain: attempt >= 2 });
      const doors = {};
      for (const s of sides) {
        const d = { to: links[s], tx: built.doors[s].tx, ty: built.doors[s].ty };
        if (secretIds.has(node.id) || secretIds.has(links[s])) d.secret = true;
        doors[s] = d;
      }
      const cand = {
        id: node.id, gx: node.gx, gy: node.gy, type, depth: node.depth,
        w: built.w, h: built.h, tiles: built.tiles, doors, spawns: [], props: [],
      };
      if (built.playerStart) cand.playerStart = built.playerStart;
      cand.variant = r.int(0, 0xffff);
      cand.visited = false; cand.seen = false; cand.cleared = false;
      cand.shape = built.shape;
      cand.layout = built.layout;
      cand.main = node.main;
      if (type === 'secret') cand.secret = true;
      populateRoom(r.fork('populate'), cand, { ...ctx, bossSpawn: built.bossSpawn });
      const errs = validateRoom(cand, { biome: bio });
      if (!errs.length || attempt === 3) room = cand;
    }
    return room;
  });

  return {
    index, biome: bio.id, seed, rooms, startRoomId: startId, bossRoomId: bossId,
    gridW: graph.gridW, gridH: graph.gridH,
  };
}
