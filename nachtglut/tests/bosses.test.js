// Boss tests (owner: bosses). Run: node --test tests/bosses.test.js
// Static checks of the boss roster + one headless fight per boss in the real Game (boss room of its floor,
// god-mode player on a scripted circling path, plus scripted DPS) at 1/60 s for up to 240 simulated seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Game, makeStubInput } from '../src/game/game.js';
import { bus } from '../src/core/events.js';
import { TS, DIRS } from '../src/game/constants.js';
import { BIOMES, FLOOR_ORDER } from '../src/data/biomes.js';
import { BOSSES, BOSS_AI, BOSS_IDS, BOSS_PARTS, BOSS_PHASES } from '../src/game/bosses.js';
import { installGodMode } from '../tools/sim.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const EXPECTED_HP = { boss_cinder: 1400, boss_mycel: 2300, boss_rime: 3900, boss_umbra: 4300, boss_sun: 5600 };

let generateFloor;
if (existsSync(resolve(ROOT, 'src/gen/floorgen.js'))) {
  try { ({ generateFloor } = await import('../src/gen/floorgen.js')); } catch { generateFloor = undefined; }
}

// ---------------------------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------------------------
test('roster: every biome boss exists with AI and sane stats', () => {
  for (const id of FLOOR_ORDER) {
    const bossId = BIOMES[id].boss;
    assert.ok(BOSS_IDS.includes(bossId), `${bossId} listed`);
    const d = BOSSES[bossId];
    assert.ok(d, `${bossId} defined`);
    assert.equal(d.id, bossId);
    assert.equal(d.boss, true);
    assert.equal(d.mass, 0);
    assert.equal(d.biome, id);
    assert.equal(d.sprite, bossId);
    for (const k of ['name', 'title', 'desc']) assert.ok(typeof d[k] === 'string' && d[k].length > 3, `${bossId}.${k}`);
    assert.equal(d.hp, EXPECTED_HP[bossId]);
    assert.ok(d.damage >= 14 && d.damage <= 28, `${bossId} contact damage`);
    assert.ok(d.r >= 14 && d.r <= 24, `${bossId} radius`);
    assert.ok(d.light && d.light.r > 0 && typeof d.color === 'string');
    const ai = BOSS_AI[d.ai];
    assert.ok(ai && typeof ai.update === 'function' && typeof ai.init === 'function', `${bossId} AI`);
  }
  for (const parts of Object.values(BOSS_PARTS)) {
    for (const pid of parts) {
      assert.ok(BOSSES[pid], `${pid} defined`);
      assert.ok(BOSS_AI[BOSSES[pid].ai], `${pid} AI`);
    }
  }
  assert.equal(BOSSES.boss_umbra_twin.boss, true);
  assert.equal(BOSSES.boss_rime_segment.boss, false);
  assert.equal(BOSSES.boss_sun_core.boss, false);
});

// ---------------------------------------------------------------------------------------------
// Headless fights
// ---------------------------------------------------------------------------------------------
function pickAny(g) {
  if (g.state === 'choice' && g.choice) {
    const o = g.choice.options.find((x) => !x.disabled);
    if (o) o.pick(); else if (g.choice.skip) g.choice.skip();
  }
}

function enterBossRoom(run) {
  const room = run.floor.rooms[run.floor.bossRoomId];
  const side = Object.keys(room.doors)[0];
  run.enterRoom(room.id, side ? DIRS[side].opp : undefined);
  return room;
}

const parts = new Set(Object.values(BOSS_PARTS).flat());

function fight(bossId, floor) {
  const errors = [];
  const origError = console.error, origWarn = console.warn;
  console.error = (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
  console.warn = () => {};
  const ev = { phase: [], start: 0, death: 0, hits: 0, telegraph: 0, attack: 0, partHits: 0, partHitsDealt: 0 };
  const offs = [
    bus.on('boss:phase', (p) => ev.phase.push(p.phase)),
    bus.on('boss:start', (p) => { if (p.boss.id === bossId) ev.start++; }),
    bus.on('boss:death', (p) => { if (p.boss.id === bossId) ev.death++; }),
    bus.on('player:hit', (p) => { if (p.amount > 0 && !p.dot) ev.hits++; }),
    bus.on('enemy:telegraph', () => ev.telegraph++),
    bus.on('enemy:attack', () => ev.attack++),
  ];
  try {
    const g = new Game({ input: makeStubInput(), generateFloor });
    g.startRun({ seed: `boss-${bossId}`, character: 'bearer' });
    const run = g.run;
    if (floor > 1) run.startFloor(floor);
    const room = enterBossRoom(run);
    assert.ok(room.w >= 25 && room.h >= 19, `boss arena ${room.w}×${room.h}`);
    const w = run.world;
    installGodMode(run);
    run.player.hp = run.player.stats.maxHp;
    const p = run.player;
    let orbit = 0;

    let boss = null, t = 0, dpsT = 0, tick = 0, deadAt = -1, maxShots = 0, maxMinions = 0, introChecked = false;
    let phaseInvuln = true;
    const offPhase = bus.on('boss:phase', (p) => { if (!p.boss.invuln) phaseInvuln = false; });
    offs.push(offPhase);
    for (let i = 0; i < 240 / DT; i++) {
      pickAny(g);
      if (g.state === 'playing' && p.alive) {
        // an average, non-dodging player: circles the arena centre (radius 90) at 65 px/s
        orbit += (65 / 90) * DT;
        const cx = (room.w * TS) / 2 + Math.cos(orbit) * 90, cy = (room.h * TS) / 2 + Math.sin(orbit) * 90;
        const dx = cx - p.x, dy = cy - p.y, l = Math.hypot(dx, dy);
        if (l > 1) w.moveEntity(p, (dx / l) * Math.min(l, 92 * DT), (dy / l) * Math.min(l, 92 * DT));
      }
      g.update(DT);
      t += DT;
      if (g.state === 'victory' || g.state === 'dead' || g.state === 'menu') break;
      if (!boss) boss = w.enemies.find((e) => e.id === bossId) || null;
      if (boss && !introChecked && boss.spawnT <= 0) {
        introChecked = true;
        assert.equal(boss.invuln, true, 'boss is invulnerable during its intro');
      }
      maxShots = Math.max(maxShots, w.projectiles.length);
      for (const pr of w.projectiles) assert.ok(Number.isFinite(pr.x) && Number.isFinite(pr.y), 'finite projectile');
      maxMinions = Math.max(maxMinions, w.enemies.filter((e) => !e.dead && e.summoned && !parts.has(e.id)).length);
      if (boss && !boss.dead) {
        assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y) && Number.isFinite(boss.hp), 'finite boss');
        // scripted DPS: ~maxHp / 80 per second, alternating between the boss and its parts
        dpsT += DT;
        if (dpsT >= 0.25) {
          dpsT -= 0.25;
          tick++;
          const amount = (boss.maxHp / 80) * 0.25;
          const others = w.enemies.filter((e) => !e.dead && !e.hidden && e.spawnT <= 0 && e !== boss);
          const bodyParts = others.filter((e) => parts.has(e.id) && e.id !== 'boss_sun_core');
          if (tick % 2 === 0 && bodyParts.length) {
            const target = bodyParts[tick % bodyParts.length];
            const before = boss.hp;
            w.damageEnemy(target, amount, { type: 'phys', source: 'weapon' });
            ev.partHits++;
            if (boss.hp < before) ev.partHitsDealt++;
          } else {
            w.damageEnemy(boss, amount, { type: 'phys', source: 'weapon' });
          }
          for (const o of others) if (!parts.has(o.id) || o.id === 'boss_sun_core') w.damageEnemy(o, 25, { type: 'phys', source: 'weapon' });
        }
      }
      const twin = w.enemies.find((e) => e.id === 'boss_umbra_twin' && !e.dead);
      if (twin && boss && !boss.dead) {
        ev.twinSeen = true;
        assert.ok(Math.abs(twin.hp - boss.hp) <= boss.maxHp * 0.05 && twin.maxHp === boss.maxHp, 'twin shares the HP pool');
      }
      if (boss && boss.dead && deadAt < 0) deadAt = t;
      if (deadAt >= 0 && t - deadAt > 1.5 && bossId !== 'boss_sun') break;
    }
    return { g, run, w, boss, t, deadAt, maxShots, maxMinions, errors, ev, phaseInvuln };
  } finally {
    console.error = origError;
    console.warn = origWarn;
    for (const off of offs) off();
  }
}

for (const [i, bossId] of BOSS_IDS.entries()) {
  const floor = i + 1;
  test(`fight: ${bossId} (floor ${floor}) — all phases, dies once, parts cleaned up, attacks connect`, () => {
    const r = fight(bossId, floor);
    const bossErrors = r.errors.filter((m) => /boss/i.test(m));
    assert.deepEqual(bossErrors, [], 'no boss errors');
    assert.ok(r.boss, 'boss spawned');
    assert.equal(r.ev.start, 1, 'boss:start once');
    const want = [];
    for (let p = 2; p <= BOSS_PHASES[bossId]; p++) want.push(p);
    assert.deepEqual(r.ev.phase, want, 'all phases reached in order');
    assert.ok(r.phaseInvuln, 'invulnerable when a phase starts');
    assert.ok(r.deadAt > 0, `boss died within 240 s (hp ${r.boss && Math.round(r.boss.hp)}/${r.boss && r.boss.maxHp})`);
    assert.equal(r.ev.death, 1, 'boss:death exactly once');
    assert.ok(r.w.boss === null || r.w.boss.dead, 'world boss cleared');
    const leftovers = r.w.enemies.filter((e) => !e.dead && (parts.has(e.id) || e.id === bossId));
    assert.deepEqual(leftovers.map((e) => e.id), [], 'segments / twin / cores removed');
    assert.ok(r.maxShots < 600, `projectiles bounded (max ${r.maxShots})`);
    assert.ok(r.maxMinions <= 8, `summons capped (max ${r.maxMinions})`);
    assert.ok(r.ev.hits >= 3, `the player took hits (${r.ev.hits})`);
    assert.ok(r.ev.telegraph >= 5 && r.ev.attack >= 5, 'telegraph + attack events');
    if (bossId === 'boss_umbra') assert.ok(r.ev.twinSeen, 'the twin appeared');
    if (bossId === 'boss_rime' || bossId === 'boss_umbra') {
      assert.ok(r.ev.partHits > 0 && r.ev.partHitsDealt > 0, 'damage on parts is forwarded to the boss');
    }
    if (bossId === 'boss_sun') {
      for (let k = 0; k < 400 && r.g.state !== 'victory'; k++) { pickAny(r.g); r.g.update(DT); }
      assert.equal(r.g.state, 'victory', 'the dead sun ends the run in victory');
    }
    console.log(`  ${bossId}: dead after ${r.deadAt.toFixed(1)} s, player hits ${r.ev.hits}, max shots ${r.maxShots}, ` +
      `telegraphs ${r.ev.telegraph}, other errors ${r.errors.length - bossErrors.length}`);
  });
}

test('sun: cores shield the sun (−70 % damage) while they live', () => {
  const g = new Game({ input: makeStubInput(), generateFloor });
  g.startRun({ seed: 'sun-shield', character: 'bearer' });
  const run = g.run;
  run.startFloor(5);
  enterBossRoom(run);
  installGodMode(run);
  const w = run.world;
  let sun = null;
  for (let i = 0; i < 6 / DT; i++) {
    pickAny(g); g.update(DT);
    sun = w.enemies.find((e) => e.id === 'boss_sun');
    if (sun && !sun.invuln && sun.spawnT <= 0 && w.enemies.some((e) => e.id === 'boss_sun_core' && e.spawnT <= 0)) break;
  }
  assert.ok(sun && !sun.invuln, 'sun active');
  const shielded = w.damageEnemy(sun, 100, { type: 'phys', source: 'weapon' });
  assert.ok(Math.abs(shielded - 30 * run.player.stats.bossDamage) < 1, `shielded hit ${shielded}`);
  for (const c of w.enemies.filter((e) => e.id === 'boss_sun_core')) w.killEnemy(c);
  const open = w.damageEnemy(sun, 100, { type: 'phys', source: 'weapon' });
  assert.ok(open > shielded * 3, `unshielded hit ${open}`);
});

test('phase gate: one huge hit cannot skip a phase', () => {
  const g = new Game({ input: makeStubInput(), generateFloor });
  g.startRun({ seed: 'gate', character: 'bearer' });
  const run = g.run;
  enterBossRoom(run);
  installGodMode(run);
  const w = run.world;
  let boss = null;
  for (let i = 0; i < 5 / DT; i++) {
    g.update(DT);
    boss = w.enemies.find((e) => e.id === 'boss_cinder');
    if (boss && !boss.invuln && boss.spawnT <= 0) break;
  }
  assert.ok(boss && !boss.invuln);
  w.damageEnemy(boss, 1e6, { type: 'phys', source: 'weapon' });
  assert.ok(!boss.dead && boss.hp > 0 && boss.hp <= boss.maxHp * 0.5, `hp ${boss.hp}`);
  const phases = [];
  const off = bus.on('boss:phase', (p) => phases.push(p.phase));
  g.update(DT);
  off();
  assert.deepEqual(phases, [2]);
  assert.equal(boss.invuln, true);
});
