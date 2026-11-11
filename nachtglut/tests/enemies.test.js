// Enemies owner tests: definitions, affixes and a headless behaviour run of every enemy against the real Game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMIES, AFFIXES } from '../src/data/enemies.js';
import { AI, aimAt, fireRing, telegraphLine } from '../src/game/ai.js';
import { BIOMES } from '../src/data/biomes.js';
import { DAMAGE_TYPES, STATUS_IDS, TILE, TS } from '../src/game/constants.js';
import { bus } from '../src/core/events.js';

const rosterIds = () => {
  const ids = new Set(['glacier_slime_small']);
  for (const b of Object.values(BIOMES)) for (const en of b.enemies) ids.add(en.id);
  return [...ids];
};
const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------------------------
test('every roster id has a valid definition with an existing AI', () => {
  for (const id of rosterIds()) {
    const d = ENEMIES[id];
    assert.ok(d, `missing def ${id}`);
    assert.equal(d.id, id);
    assert.ok(typeof d.name === 'string' && d.name.length > 2, `${id} name`);
    assert.ok(typeof d.desc === 'string' && d.desc.length > 10, `${id} desc`);
    assert.ok(BIOMES[d.biome], `${id} biome`);
    assert.ok(d.hp > 0 && d.hp < 1000, `${id} hp`);
    assert.ok(d.speed >= 0 && d.speed <= 90, `${id} speed`);
    assert.ok(d.damage >= 0 && d.damage <= 20, `${id} damage`);
    assert.ok(d.r >= 3 && d.r <= 14, `${id} r`);
    assert.ok(d.mass >= 0, `${id} mass`);
    assert.ok(d.xp >= 1 && d.xp <= 12, `${id} xp`);
    assert.ok(Array.isArray(d.sparks) && d.sparks.length === 2 && d.sparks[0] <= d.sparks[1] && d.sparks[1] <= 8, `${id} sparks`);
    assert.match(d.color, HEX, `${id} color`);
    assert.equal(typeof d.sprite, 'string');
    assert.ok(AI[d.ai] && typeof AI[d.ai].update === 'function', `${id} ai "${d.ai}"`);
    assert.ok(d.light === null || (d.light.r > 0 && HEX.test(d.light.color)), `${id} light`);
    for (const [k, v] of Object.entries(d.resist)) {
      assert.ok(DAMAGE_TYPES.includes(k), `${id} resist type ${k}`);
      assert.ok(v >= -1 && v < 1, `${id} resist value`);
    }
    for (const s of d.immune) assert.ok(STATUS_IDS.includes(s), `${id} immune ${s}`);
    if (d.hooks) for (const fn of Object.values(d.hooks)) assert.equal(typeof fn, 'function');
  }
});

test('every enemy def belongs to the roster (no orphans)', () => {
  const ids = new Set(rosterIds());
  for (const id of Object.keys(ENEMIES)) assert.ok(ids.has(id), `${id} not in a biome roster`);
});

test('every affix has id, German name, colour and apply/update/onDeath/onHit logic', () => {
  const ids = Object.keys(AFFIXES);
  assert.ok(ids.length >= 10 && ids.length <= 12);
  const names = new Set();
  for (const [id, af] of Object.entries(AFFIXES)) {
    assert.equal(af.id, id);
    assert.ok(typeof af.name === 'string' && /^[A-ZÄÖÜ]/.test(af.name), `${id} name`);
    assert.ok(!names.has(af.name), `${id} duplicate name`);
    names.add(af.name);
    assert.match(af.color, HEX, `${id} color`);
    assert.ok(af.apply || af.update || af.onDeath || af.onHit, `${id} has no logic`);
    for (const k of ['apply', 'update', 'onDeath', 'onHit']) if (af[k]) assert.equal(typeof af[k], 'function');
  }
});

test('helper exports exist', () => {
  for (const fn of [aimAt, fireRing, telegraphLine]) assert.equal(typeof fn, 'function');
});

// ---------------------------------------------------------------------------------------------
// Headless behaviour against the real Game
// ---------------------------------------------------------------------------------------------
const DT = 1 / 60;
const RUN_SECONDS = 10;

function openRoom(id) {
  const w = 30, h = 22;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = TILE.WALL;
  }
  for (const [x, y] of [[20, 5], [21, 5], [20, 6], [21, 6]]) tiles[y * w + x] = TILE.WALL;    // pillar
  for (const [x, y] of [[20, 15], [21, 15], [22, 15], [20, 16], [21, 16]]) tiles[y * w + x] = TILE.PIT; // pit
  return {
    id, gx: 99, gy: 99, type: 'combat', depth: 1, w, h, tiles, doors: {}, spawns: [], props: [],
    playerStart: { tx: 10, ty: 11 }, variant: 0, visited: false, seen: false, cleared: false,
  };
}

async function makeGame(floor) {
  const { Game, makeStubInput } = await import('../src/game/game.js');
  const game = new Game({ input: makeStubInput() });
  const run = game.startRun({ character: 'bearer', difficulty: 0, seed: `enemies-${floor}` });
  if (floor > 1) run.startFloor(floor);
  const room = openRoom(run.floor.rooms.length);
  run.floor.rooms.push(room);
  run.enterRoom(room.id);
  const p = run.player;
  p.gainXp = () => {};          // no level-up choices interrupting the simulation
  const w = run.world;
  return { game, run, w, p, room };
}

function standable(w, e) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
  const t = w.tileAtPx(e.x, e.y);
  if (t === TILE.WALL || t === TILE.VOID) return false;
  if (!e.flying && t === TILE.PIT) return false;
  return true;
}

/** Spawn `id` next to the player and simulate. Returns a report; throws on hard failures. */
async function exercise(id, opts = {}) {
  const floor = BIOMES[ENEMIES[id].biome].floor;
  const { game, run, w, p } = await makeGame(floor);
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); };
  const attacks = [], telegraphs = [];
  let hits = 0, activeAt = -1, firstAttackAt = -1, simT = 0, maxProj = 0;
  const ours = new Set();
  const offs = [
    bus.on('enemy:attack', (pl) => { if (ours.has(pl.enemy)) { attacks.push(pl.kind); if (pl.enemy === main && firstAttackAt < 0) firstAttackAt = simT; } }),
    bus.on('enemy:telegraph', (pl) => { if (ours.has(pl.enemy)) telegraphs.push(pl.kind); }),
    bus.on('player:hit', (pl) => { if (pl.amount > 0) hits++; }),
    bus.on('enemy:spawn', (pl) => { ours.add(pl.enemy); }),
  ];
  const main = w.spawnEnemy(id, p.x + 48, p.y, { elite: opts.elite || 0, delay: 0.6 });
  ours.add(main);
  const cx = p.x, cy = p.y;
  const problems = [];
  const step = () => {
    if (game.choice) { const c = game.choice; if (c.skip) c.skip(); else c.options[0].pick(); }
    if (game.state !== 'playing') return;
    // the "player" walks a small circle and dashes every 2.5 s
    const a = simT * 1.6, tx = cx + Math.cos(a) * 26, ty = cy + Math.sin(a) * 26;
    const dx = tx - p.x, dy = ty - p.y, l = Math.hypot(dx, dy) || 1;
    game.input.setMove(l > 3 ? dx / l : 0, l > 3 ? dy / l : 0);
    if (Math.floor((simT + DT) / 2.5) !== Math.floor(simT / 2.5)) game.input.press('dash');
    game.update(DT);
    simT += DT;
    p.hp = p.stats.maxHp; p.alive = true;   // immortal test dummy (hits are still counted)
    if (activeAt < 0 && main.spawnT <= 0) activeAt = simT;
    for (const e of w.enemies) {
      if (e.dead) continue;
      if (!standable(w, e)) problems.push(`${e.id} at bad position (${e.x}, ${e.y}) state=${e.state}`);
      if (!Number.isFinite(e.hp)) problems.push(`${e.id} hp not finite`);
      if (e._aiErr || e._afErr) problems.push(`${e.id} AI/affix error flag`);
    }
    let n = 0;
    for (const pr of w.projectiles) {
      if (pr.team !== 'enemy' || pr.dead) continue;
      n++;
      if (!Number.isFinite(pr.x) || !Number.isFinite(pr.damage)) problems.push('bad projectile');
      if (!pr.arc) {
        const sp = Math.hypot(pr.vx, pr.vy);
        if (sp > 175 || sp < 50) problems.push(`${pr.owner && pr.owner.id} projectile speed ${sp.toFixed(0)}`);
      }
    }
    maxProj = Math.max(maxProj, n);
    for (const z of w.zones) if (!Number.isFinite(z.x) || !Number.isFinite(z.damage) || !Number.isFinite(z.r)) problems.push('bad zone');
  };
  try {
    let poke = 0;
    for (let i = 0; i < RUN_SECONDS / DT; i++) {
      step();
      poke += DT;
      if (poke >= 1.2) {   // chip damage from the player's side: exercises onHit hooks (shields, block)
        poke = 0;
        for (const e of w.enemies) {
          if (e.dead || e.hidden || e.spawnT > 0) continue;
          const ang = Math.atan2(e.y - p.y, e.x - p.x);
          w.damageEnemy(e, Math.max(1, e.maxHp * 0.03), { type: 'phys', source: 'weapon', proj: { vx: Math.cos(ang) * 200, vy: Math.sin(ang) * 200 }, knockback: { x: Math.cos(ang), y: Math.sin(ang), force: 40 } });
        }
      }
    }
    // kill everything (death hooks: splits, clouds, blasts), then keep simulating
    for (let round = 0; round < 3; round++) {
      for (const e of [...w.enemies]) if (!e.dead) w.killEnemy(e, { source: 'weapon' });
      for (let i = 0; i < 2.5 / DT; i++) step();
    }
  } finally {
    console.error = origError;
    for (const off of offs) off();
  }
  return { id, attacks, telegraphs, hits, activeAt, firstAttackAt, problems, errors, maxProj, run, w };
}

function assertReport(r, label) {
  assert.deepEqual(r.errors, [], `${label}: console errors\n${r.errors.slice(0, 3).join('\n')}`);
  assert.deepEqual([...new Set(r.problems)].slice(0, 5), [], `${label}: problems`);
  assert.ok(r.attacks.length > 0 || r.hits > 0, `${label}: never attacked the player`);
  if (r.attacks.length) assert.ok(r.telegraphs.length > 0, `${label}: attacked without any telegraph`);
  if (r.firstAttackAt >= 0) assert.ok(r.firstAttackAt - r.activeAt >= 0.8 - 1e-6, `${label}: first attack ${(r.firstAttackAt - r.activeAt).toFixed(2)} s after activation (< 0.8 s)`);
  assert.ok(r.maxProj <= 60, `${label}: projectile flood (${r.maxProj})`);
}

for (const id of rosterIds()) {
  test(`behaviour: ${id}`, async () => {
    const r = await exercise(id);
    assertReport(r, id);
  });
}

for (const af of Object.keys(AFFIXES)) {
  test(`affix on ash_crawler: ${af}`, async () => {
    const r = await exercise('ash_crawler', { elite: [af] });
    assertReport(r, `ash_crawler+${af}`);
  });
}

test('affixes stack on stationary and burrowing enemies without errors', async () => {
  for (const id of ['kiln_turret', 'mire_stalker', 'null_leech', 'shade']) {
    const r = await exercise(id, { elite: Object.keys(AFFIXES).slice(0, 3) });
    assertReport(r, `${id}+3`);
    const r2 = await exercise(id, { elite: Object.keys(AFFIXES).slice(-3) });
    assertReport(r2, `${id}+3b`);
  }
});

test('glacier_slime splits on death; spore_puff leaves a cloud; soot_bomber blasts', async () => {
  const { w, p } = await makeGame(3);
  const s = w.spawnEnemy('glacier_slime', p.x + 60, p.y, { delay: 0 });
  w.killEnemy(s, {});
  assert.equal(w.enemies.filter((e) => !e.dead && e.id === 'glacier_slime_small').length, 2);
  const g2 = await makeGame(2);
  const puff = g2.w.spawnEnemy('spore_puff', g2.p.x + 60, g2.p.y, { delay: 0 });
  g2.w.killEnemy(puff, {});
  assert.ok(g2.w.zones.some((z) => z.tick > 0 && z.type === 'poison' && z.persist));
  const g1 = await makeGame(1);
  const bomb = g1.w.spawnEnemy('soot_bomber', g1.p.x + 60, g1.p.y, { delay: 0 });
  g1.w.killEnemy(bomb, {});
  assert.ok(g1.w.zones.some((z) => z.persist && z.delay >= 0.35 && typeof z.onStart === 'function'));
});

test('echo_knight shield blocks frontal hits only', async () => {
  const { w, p } = await makeGame(4);
  const k = w.spawnEnemy('echo_knight', p.x + 60, p.y, { delay: 0 });
  k.spawnT = 0;
  k.facing = Math.PI;   // facing the player (who is to the left)
  const front = w.damageEnemy(k, 50, { type: 'phys', source: 'weapon', proj: { vx: 200, vy: 0 } });
  k.facing = 0;          // turned away
  const back = w.damageEnemy(k, 50, { type: 'phys', source: 'weapon', proj: { vx: 200, vy: 0 } });
  assert.ok(front < back * 0.5, `front ${front} vs back ${back}`);
});
