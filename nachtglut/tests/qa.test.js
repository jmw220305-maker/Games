// QA regression tests (owner: qa). Run: node --test tests/qa.test.js
// Each test pins a bug found while play-testing the real game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, makeStubInput } from '../src/game/game.js';
import { TS, TILE } from '../src/game/constants.js';
import { BIOMES, biomeForFloor } from '../src/data/biomes.js';
import { generateFloor } from '../src/gen/floorgen.js';
import { flood, doorCells, doorEntrances } from '../src/gen/util.js';

const DT = 1 / 60;
const steps = (g, n) => { for (let i = 0; i < n; i++) g.update(DT); };

function newGame() {
  const g = new Game({ input: makeStubInput(), generateFloor });
  g.startRun({ seed: 'qa', character: 'bearer' });
  return g;
}

function makeRoom(w, h, paint) {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? TILE.WALL : TILE.FLOOR;
  const room = { id: -1, gx: 9, gy: 9, type: 'combat', depth: 1, w, h, tiles, doors: {}, spawns: [], props: [], variant: 0, visited: false, seen: false, cleared: false };
  if (paint) paint(room);
  return room;
}

function enterRoom(g, room) {
  const run = g.run;
  room.id = run.floor.rooms.length;
  run.floor.rooms.push(room);
  run.enterRoom(room.id);
  return run.world;
}

test('generator: solid props never cut one door off from another (shrine statues sealed a door)', () => {
  // seeds that produced split rooms before the fix (+ a sweep); every prop counts as blocking, like the placer
  const cases = [[1, 1798614], [1, 5417597], [1, 8909876], [1, 12259613]];
  for (let index = 1; index <= 5; index++) for (let s = 0; s < 30; s++) cases.push([index, 9000 + s * 31 + index]);
  let rooms = 0;
  for (const [index, seed] of cases) {
    {
      const s = seed;
      const floor = generateFloor({ index, biome: biomeForFloor(index), seed, difficulty: {}, luck: 0 });
      for (const room of floor.rooms) {
        const sides = Object.keys(room.doors);
        if (sides.length < 2) continue;
        const occ = new Uint8Array(room.w * room.h);
        for (const p of room.props) occ[p.ty * room.w + p.tx] = 1;
        const counts = sides.map((side) => {
          const d = room.doors[side];
          const ent = doorEntrances(side, d, room.w, room.h).filter(([x, y]) => doorCells(side, d).some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1));
          return flood(room.tiles, room.w, room.h, ent.length ? ent : doorEntrances(side, d, room.w, room.h), occ).count;
        });
        rooms++;
        assert.ok(counts.every((c) => c === counts[0]), `floor ${index} seed ${s} room ${room.id} (${room.type}): doors reach ${counts.join('/')} tiles`);
      }
    }
  }
  assert.ok(rooms > 100);
});

test('hazard tiles: short contact is free, hazard status refreshes but never stacks', () => {
  const g = newGame();
  const fungal = BIOMES.find ? BIOMES.find((b) => b.id === 'fungal') : BIOMES.fungal;
  const w = enterRoom(g, makeRoom(20, 9, (r) => { for (let x = 3; x < 9; x++) for (let y = 3; y < 6; y++) r.tiles[y * 20 + x] = TILE.HAZARD; }));
  w.biome = fungal; // poison moss
  const p = w.player;
  p.x = 5.5 * TS; p.y = 4.5 * TS;
  const hp0 = p.hp;
  steps(g, 14);
  assert.equal(p.hp, hp0, 'no damage during the grace window');
  for (let i = 0; i < 360; i++) { p.iframes = 0; g.update(DT); }
  const st = p.statuses[fungal.hazardStatus];
  assert.ok(st, 'hazard applies its status');
  assert.equal(st.stacks, 1, 'standing on spore moss does not stack poison');
  assert.ok(p.alive);
});
