// Dungeon generation tests (owner: dungeon). Run: node --test tests/dungeon.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFloor } from '../src/gen/floorgen.js';
import { validateFloor, validateRoom } from '../src/gen/validate.js';
import { LAYOUTS } from '../src/gen/layouts.js';
import { BIOMES, FLOOR_ORDER, biomeForFloor } from '../src/data/biomes.js';
import { TILE, ROOM_TYPES } from '../src/game/constants.js';

const SEEDS = 200;
const seedFor = (s, index) => (Math.imul(s + 1, 2654435761) ^ (index * 0x9e3779b9)) >>> 0;
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const DELTA = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const WALKABLE = new Set([TILE.FLOOR, TILE.SPIKES, TILE.HAZARD, TILE.ICE]);
const DANGER = new Set([TILE.SPIKES, TILE.HAZARD, TILE.ICE]);

// --- independent re-implementations of the key §4 checks (do not reuse generator helpers) -------

function doorTiles(side, d) {
  return side === 'n' || side === 's' ? [[d.tx, d.ty], [d.tx + 1, d.ty]] : [[d.tx, d.ty], [d.tx, d.ty + 1]];
}

function checkRoomIndependently(room, biome) {
  const { w, h, tiles } = room;
  assert.ok(tiles instanceof Uint8Array && tiles.length === w * h, 'tiles length');
  assert.ok(w >= 13 && w <= 40 && h >= 11 && h <= 28, `size ${w}x${h}`);
  assert.ok(ROOM_TYPES.includes(room.type));
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? TILE.VOID : tiles[y * w + x]);

  // doors on the border, 2 DOOR tiles, inner approach 2x3 FLOOR
  const doorPts = [];
  const entries = [];
  for (const [side, d] of Object.entries(room.doors)) {
    if (side === 'n') assert.equal(d.ty, 0);
    if (side === 's') assert.equal(d.ty, h - 1);
    if (side === 'w') assert.equal(d.tx, 0);
    if (side === 'e') assert.equal(d.tx, w - 1);
    for (const [x, y] of doorTiles(side, d)) {
      assert.equal(at(x, y), TILE.DOOR, `door tile ${side}`);
      doorPts.push([x, y]);
      const [dx, dy] = DELTA[OPP[side]];
      for (let k = 1; k <= 3; k++) assert.equal(at(x + dx * k, y + dy * k), TILE.FLOOR, `approach ${side} ${k}`);
      entries.push([x + dx, y + dy]);
    }
  }
  let doorCount = 0;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE.DOOR) doorCount++;
  assert.equal(doorCount, doorPts.length, 'stray DOOR tiles');

  // flood fill from each door separately (props block)
  const blocked = new Set(room.props.map((p) => p.ty * w + p.tx));
  const fill = (starts, useProps) => {
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (const [x, y] of starts) { const i = y * w + x; if (!seen[i]) { seen[i] = 1; stack.push(i); } }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || !WALKABLE.has(tiles[j]) || (useProps && blocked.has(j))) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    return seen;
  };
  for (let k = 0; k < entries.length; k += 2) {
    const seen = fill(entries.slice(k, k + 2), false);
    for (let i = 0; i < tiles.length; i++) if (WALKABLE.has(tiles[i])) assert.ok(seen[i], `tile ${i % w},${(i / w) | 0} unreachable`);
  }
  const reach = fill(entries, true);
  for (let i = 0; i < tiles.length; i++) {
    if (WALKABLE.has(tiles[i]) && !blocked.has(i)) assert.ok(reach[i], 'props cut off part of the room');
  }

  // enclosure: no walkable tile next to VOID or on the border
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!WALKABLE.has(at(x, y))) continue;
    assert.ok(x > 0 && y > 0 && x < w - 1 && y < h - 1, 'walkable on border');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.notEqual(at(x + dx, y + dy), TILE.VOID, 'not enclosed');
  }

  const doorDist = (x, y) => Math.min(...doorPts.map(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y))));
  // hazards away from doors and the player start
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!DANGER.has(at(x, y))) continue;
    assert.ok(doorDist(x, y) > 2, 'hazard near door');
    if (room.playerStart) assert.ok(Math.max(Math.abs(x - room.playerStart.tx), Math.abs(y - room.playerStart.ty)) > 2, 'hazard near start');
  }
  // props + spawns
  for (const p of room.props) {
    assert.equal(at(p.tx, p.ty), TILE.FLOOR, `prop ${p.kind} on ${at(p.tx, p.ty)}`);
    assert.ok(doorDist(p.tx, p.ty) > 3, `prop ${p.kind} near door`);
  }
  assert.equal(blocked.size, room.props.length, 'props share a tile');
  const ids = new Set(biome.enemies.map((e) => e.id));
  for (const wave of room.spawns) {
    assert.ok(wave.delay >= 0.5 && wave.delay <= 1.2, `wave delay ${wave.delay}`);
    for (const e of wave.entries) {
      assert.equal(at(e.tx, e.ty), TILE.FLOOR, 'spawn not on FLOOR');
      assert.ok(doorDist(e.tx, e.ty) > 3, 'spawn near door');
      assert.ok(!blocked.has(e.ty * w + e.tx), 'spawn on prop');
      assert.ok(reach[e.ty * w + e.tx], 'spawn unreachable');
      if (room.type === 'boss') assert.equal(e.id, biome.boss);
      else assert.ok(ids.has(e.id), `unknown enemy ${e.id}`);
    }
  }
}

function checkFloorIndependently(floor, biome, index) {
  const { rooms } = floor;
  assert.equal(floor.index, index);
  assert.equal(floor.biome, biome.id);
  const cells = new Set();
  rooms.forEach((r, i) => {
    assert.equal(r.id, i);
    const k = r.gx + ',' + r.gy;
    assert.ok(!cells.has(k), 'duplicate grid cell');
    cells.add(k);
    for (const [side, d] of Object.entries(r.doors)) {
      const o = rooms[d.to];
      assert.ok(o, 'door target exists');
      assert.equal(o.doors[OPP[side]]?.to, r.id, 'doors symmetric');
      assert.equal(o.gx - r.gx, DELTA[side][0]);
      assert.equal(o.gy - r.gy, DELTA[side][1]);
    }
  });
  // BFS depth + connectivity
  const depth = new Array(rooms.length).fill(-1);
  depth[floor.startRoomId] = 0;
  const q = [floor.startRoomId];
  for (let k = 0; k < q.length; k++) {
    for (const d of Object.values(rooms[q[k]].doors)) if (depth[d.to] < 0) { depth[d.to] = depth[q[k]] + 1; q.push(d.to); }
  }
  for (const r of rooms) { assert.ok(depth[r.id] >= 0, 'connected'); assert.equal(r.depth, depth[r.id], 'depth'); }

  const by = {};
  for (const r of rooms) (by[r.type] ||= []).push(r);
  const n = (t) => (by[t] || []).length;
  assert.equal(n('start'), 1);
  assert.equal(n('boss'), 1);
  assert.equal(n('shop'), 1);
  assert.ok(n('treasure') >= 1 && n('treasure') <= 2, 'treasure 1-2');
  assert.equal(n('rest'), 1);
  assert.ok(n('elite') >= 1 && n('elite') <= 2, 'elite 1-2');
  assert.ok(n('challenge') <= 1 && n('secret') <= 1 && n('forge') <= 1);
  if (index <= 4) {
    assert.ok(n('shrine') >= 1 && n('shrine') <= 2, 'shrine 1-2');
    if (index >= 2) assert.equal(n('forge'), 1);
    assert.ok(rooms.length >= 9 && rooms.length <= 16, `room count ${rooms.length}`);
  } else {
    const hard = n('combat') + n('elite');
    assert.ok(hard >= 3 && hard <= 4, `gauntlet hard rooms ${hard}`);
    assert.ok(rooms.length <= 9);
  }
  const start = rooms[floor.startRoomId];
  assert.equal(start.type, 'start');
  assert.ok(start.playerStart && start.tiles[start.playerStart.ty * start.w + start.playerStart.tx] === TILE.FLOOR);
  assert.equal(start.spawns.length, 0);
  for (const d of Object.values(start.doors)) assert.equal(rooms[d.to].type, 'combat', 'start neighbour is combat');
  if (index === 1) assert.ok(start.props.every((p) => p.kind === 'torch'), 'floor 1 start room is safe');

  const boss = rooms[floor.bossRoomId];
  assert.equal(boss.type, 'boss');
  assert.ok(boss.w >= 25 && boss.h >= 19 && boss.w <= 31 && boss.h <= 23, 'boss arena size');
  assert.equal(Object.keys(boss.doors).length, 1, 'boss single door');
  assert.equal(boss.depth, Math.max(...depth), 'boss is farthest');
  assert.equal(boss.spawns.length, 1);
  assert.deepEqual(boss.spawns[0].entries.map((e) => e.id), [biome.boss]);
  const be = boss.spawns[0].entries[0];
  assert.ok(be.ty < boss.h / 2, 'boss spawns in the upper part');
  const t = boss.props.filter((p) => p.kind === 'torch').length;
  assert.ok(t >= 4 && t <= 8 && t === boss.props.length, 'boss torches');

  for (const r of rooms) {
    if (['combat', 'elite', 'challenge'].includes(r.type)) assert.ok(r.spawns.length >= 1, 'fight room has waves');
    else if (r.type !== 'boss') assert.equal(r.spawns.length, 0);
    if (r.type === 'challenge') {
      assert.ok(r.spawns.length >= 3 && r.spawns.length <= 4, 'challenge waves');
      assert.ok(r.props.some((p) => p.kind === 'chest' && p.tier === 'rare' && p.locked));
    }
    if (r.type === 'elite') {
      assert.ok(r.spawns.flatMap((wv) => wv.entries).some((e) => e.elite >= 1), 'elite room has elites');
      assert.ok(r.props.some((p) => p.kind === 'chest' && p.locked));
    }
    if (r.type === 'combat') assert.ok(r.spawns.length <= 3);
    if (r.type === 'secret') { assert.equal(r.secret, true); assert.equal(Object.keys(r.doors).length, 1); }
    if (r.type === 'shop') {
      const peds = r.props.filter((p) => p.kind === 'pedestal');
      assert.ok(peds.length >= 5 && peds.length <= 6, 'shop pedestals');
      assert.equal(peds.filter((p) => p.offer === 'relic').length, 3);
      assert.ok(peds.every((p) => p.price === 'auto' && p.group === undefined));
      assert.ok(r.props.some((p) => p.kind === 'statue' && p.role === 'merchant' && p.solid === true));
    }
    if (r.type === 'treasure') {
      const chest = r.props.filter((p) => p.kind === 'chest');
      const peds = r.props.filter((p) => p.kind === 'pedestal');
      assert.ok((chest.length === 1 && peds.length === 0) || (chest.length === 0 && peds.length === 3 && peds.every((p) => p.group === 'treasure' && p.price === 0)));
    }
    if (r.type === 'shrine') assert.equal(r.props.filter((p) => p.kind === 'shrine').length, 1);
    if (r.type === 'forge') assert.equal(r.props.filter((p) => p.kind === 'forge').length, 1);
    if (r.type === 'rest') assert.equal(r.props.filter((p) => p.kind === 'fountain').length, 1);
    const torches = r.props.filter((p) => p.kind === 'torch').length;
    assert.ok(torches >= 2 && torches <= 8, `room ${r.type} torches ${torches}`);
    checkRoomIndependently(r, biome);
  }
}

// --- tests --------------------------------------------------------------------------------------

for (let index = 1; index <= 5; index++) {
  const biome = biomeForFloor(index);
  test(`floor ${index} (${biome.id}): ${SEEDS} seeds are valid and deterministic`, () => {
    for (let s = 0; s < SEEDS; s++) {
      const seed = seedFor(s, index);
      let floor;
      assert.doesNotThrow(() => { floor = generateFloor({ index, biome, seed }); }, `seed ${seed}`);
      const errs = validateFloor(floor, biome);
      assert.deepEqual(errs, [], `floor ${index} seed ${seed}:\n${errs.join('\n')}`);
      try {
        checkFloorIndependently(floor, biome, index);
      } catch (err) {
        err.message = `floor ${index} seed ${seed}: ${err.message}`;
        throw err;
      }
      const again = generateFloor({ index, biome, seed });
      assert.deepStrictEqual(again, floor, `floor ${index} seed ${seed} not deterministic`);
    }
  });
}

test('difficulty mods and luck are honoured and keep floors valid', () => {
  let base = 0, harder = 0, elitesBase = 0, elitesHard = 0, rare = 0, rareLucky = 0, chests = 0, chestsLucky = 0;
  const count = (f) => f.rooms.filter((r) => r.type === 'combat').flatMap((r) => r.spawns.flatMap((w) => w.entries));
  for (let s = 0; s < 60; s++) {
    for (const index of [1, 3]) {
      const biome = biomeForFloor(index);
      const seed = seedFor(s, 100 + index);
      const a = generateFloor({ index, biome, seed });
      const b = generateFloor({ index, biome, seed, difficulty: { spawnBudget: 1.6, eliteChance: 0.3, extraAffixes: 1 }, luck: 10 });
      assert.deepEqual(validateFloor(b, biome), []);
      base += count(a).length; harder += count(b).length;
      elitesBase += count(a).filter((e) => e.elite).length;
      elitesHard += count(b).filter((e) => e.elite).length;
      assert.ok(count(b).filter((e) => e.elite).every((e) => e.elite >= 2), 'extraAffixes adds affixes');
      for (const [f, lucky] of [[a, false], [b, true]]) {
        for (const p of f.rooms.filter((r) => r.type === 'treasure').flatMap((r) => r.props)) {
          if (p.kind !== 'chest') continue;
          if (lucky) { chestsLucky++; if (p.tier === 'rare') rareLucky++; } else { chests++; if (p.tier === 'rare') rare++; }
        }
      }
    }
  }
  assert.ok(harder > base * 1.3, `spawnBudget raises enemy count (${base} -> ${harder})`);
  assert.ok(elitesHard > elitesBase * 2, `eliteChance raises elites (${elitesBase} -> ${elitesHard})`);
  assert.ok(rareLucky / chestsLucky > rare / chests, 'luck raises rare chest odds');
});

test('accepts a biome id string and the full BIOMES entries', () => {
  for (const id of FLOOR_ORDER) {
    const index = BIOMES[id].floor;
    const a = generateFloor({ index, biome: id, seed: 1234 });
    const b = generateFloor({ index, biome: BIOMES[id], seed: 1234 });
    assert.deepStrictEqual(a, b);
    assert.deepEqual(validateFloor(a, BIOMES[id]), []);
  }
});

test('layouts are varied: many generators, shapes and graphs across seeds', () => {
  const layouts = new Set(), shapes = new Set(), graphs = new Set();
  const hazards = { 1: 0, 4: 0 }, rooms = { 1: 0, 4: 0 };
  let frostIce = 0, frostRooms = 0;
  for (let s = 0; s < 80; s++) {
    for (let index = 1; index <= 5; index++) {
      const f = generateFloor({ index, biome: biomeForFloor(index), seed: seedFor(s, 7 * index) });
      graphs.add(f.rooms.map((r) => `${r.type[0]}${r.gx},${r.gy}`).join('|'));
      for (const r of f.rooms) {
        layouts.add(r.layout); shapes.add(r.shape);
        if (!['combat', 'elite', 'challenge'].includes(r.type)) continue;
        const hz = r.tiles.filter((t) => t === TILE.HAZARD || t === TILE.SPIKES).length;
        if (index in hazards) { hazards[index] += hz; rooms[index] += r.w * r.h; }
        if (index === 3) { frostRooms++; if (r.tiles.some((t) => t === TILE.ICE)) frostIce++; }
      }
    }
  }
  assert.ok(Object.keys(LAYOUTS).length >= 14, 'at least 14 layout generators');
  assert.ok(layouts.size >= 14, `layouts used: ${[...layouts].join(', ')}`);
  for (const s of ['rect', 'L', 'plus', 'octagon', 'donut', 'chambers']) assert.ok(shapes.has(s), `shape ${s} used`);
  assert.ok(graphs.size >= 395, `distinct floor graphs ${graphs.size}/400`);
  assert.ok(hazards[4] / rooms[4] > hazards[1] / rooms[1], 'hazard density grows with the floor');
  assert.ok(frostIce / frostRooms > 0.4, 'frost uses ice patches');
});

test('validator catches broken rooms', () => {
  const biome = biomeForFloor(1);
  const f = generateFloor({ index: 1, biome, seed: 77 });
  const room = f.rooms.find((r) => r.type === 'combat');
  const copy = { ...room, tiles: room.tiles.slice() };
  const [side, d] = Object.entries(copy.doors)[0];
  const [dx, dy] = DELTA[OPP[side]];
  copy.tiles[(d.ty + dy) * copy.w + d.tx + dx] = TILE.WALL; // block a door approach
  assert.ok(validateRoom(copy, { biome }).length > 0);
});

test('performance: < 50 ms per floor on average', () => {
  const n = 60;
  const t0 = performance.now();
  for (let s = 0; s < n; s++) {
    const index = (s % 5) + 1;
    generateFloor({ index, biome: biomeForFloor(index), seed: seedFor(s, 999) });
  }
  const avg = (performance.now() - t0) / n;
  assert.ok(avg < 50, `average ${avg.toFixed(1)} ms`);
});
