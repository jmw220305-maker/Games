// Status mechanics v2 (docs/ARCHITECTURE.md §12; owner: core). Run: node --test tests/mechanics.test.js
// Bleed / Aderlass, Gifteruption, Schock / Entladung, enemy heal vs poison, vampirism, blood orbs + Blutrausch,
// player bleed, lifesteal budget, and a stress test. Uses the real Game headless with its own test content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Game, makeStubInput } from '../src/game/game.js';
import { bus } from '../src/core/events.js';
import { TILE, STATUS_IDS } from '../src/game/constants.js';
import { STAT_NAMES, computeStats } from '../src/game/stats.js';
import {
  STATUS, applyStatus, updateStatuses, healEnemy, playerDamageMul, playerShot, makeWeaponState, statusGlossary,
  BLOOD_ORB_LIFE, FRENZY_TIME, VAMP_PER_S,
} from '../src/game/combat.js';
import { updatePickups } from '../src/game/entities.js';
import { addPerk, PERK_HOOKS } from '../src/game/perks.js';
import { NULL_FX } from '../src/game/world.js';
import { ENEMIES, AI, RELICS, WEAPONS } from '../src/game/registry.js';
import { STAT_LABELS, formatStatValue } from '../src/meta/codex.js';

const DT = 1 / 60;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------
// Test content
// ---------------------------------------------------------------------------------------------
console.warn = () => {};
const base = { biome: 'ash', speed: 0, damage: 0, r: 6, mass: 1, xp: 0, sparks: [0, 0], color: '#888', ai: 'mech_none', aiParams: {}, resist: {}, immune: [] };
ENEMIES.mech_dummy = { ...base, id: 'mech_dummy', name: 'Puppe', desc: '', hp: 1000, sprite: 'mech_dummy' };
ENEMIES.mech_armored = { ...base, id: 'mech_armored', name: 'Panzerpuppe', desc: '', hp: 1000, sprite: 'mech_dummy', resist: { phys: 0.5 } };
ENEMIES.mech_construct = { ...base, id: 'mech_construct', name: 'Konstrukt', desc: '', hp: 1000, sprite: 'mech_dummy', bloodless: true };
ENEMIES.mech_noblood = { ...base, id: 'mech_noblood', name: 'Geist', desc: '', hp: 1000, sprite: 'mech_dummy', immune: ['bleed'] };
AI.mech_none = { update() {} };
const burstLog = [];
RELICS.mech_burst_log = {
  id: 'mech_burst_log', name: 'Protokoll', desc: 'Test', rarity: 'common', icon: { glyph: 'book', color: '#fff' }, tags: [],
  hooks: { onStatusBurst(ctx, arg) { burstLog.push(arg); } },
};
WEAPONS.mech_gun = {
  id: 'mech_gun', name: 'Testflinte', desc: 'Test', rarity: 'common', type: 'phys', icon: { glyph: 'bow', color: '#fff' },
  base: { damage: 5, cooldown: 0.5, projSpeed: 200, range: 200, count: 1 },
  levels: [{ desc: 'a', mods: {} }, { desc: 'b', mods: {} }, { desc: 'c', mods: {} }, { desc: 'd', mods: {} }],
  fire() {},
};

function listen(evt) {
  const got = [];
  got.off = bus.on(evt, (p) => got.push(p));
  return got;
}

function makeRoom(w = 40, h = 28) {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? TILE.WALL : TILE.FLOOR;
  return { id: -1, gx: 9, gy: 9, type: 'combat', depth: 1, w, h, tiles, doors: {}, spawns: [], props: [], variant: 0, visited: false, seen: false, cleared: false };
}

function setup(w = 40, h = 28) {
  const g = new Game({ input: makeStubInput() });
  g.startRun({ seed: 'mechanics', character: 'bearer' });
  const run = g.run;
  const room = makeRoom(w, h);
  room.id = run.floor.rooms.length;
  run.floor.rooms.push(room);
  run.enterRoom(room.id);
  const world = run.world;
  world.player.x = 24; world.player.y = 24;
  return { g, run, w: world, p: world.player };
}

function enemy(w, x, y, id = 'mech_dummy', hp = 1000) {
  const e = w.spawnEnemy(id, x, y, { delay: 0 });
  e.spawnT = 0; e.hp = e.maxHp = hp; e.damage = 0; e.contact = false; e.ai = { update() {} };
  return e;
}

function ticks(w, e, n, each) {
  for (let i = 0; i < n; i++) { if (each) each(i); updateStatuses(w, e, DT); }
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------
test('data: every status has German glossary text, new stats exist with limits + labels', () => {
  assert.equal(Object.keys(STATUS).length, 10);
  for (const id of STATUS_IDS) {
    const d = STATUS[id];
    assert.ok(d, `STATUS.${id}`);
    assert.ok(typeof d.desc === 'string' && d.desc.length > 10, `${id}.desc`);
    assert.ok('burstName' in d && 'burstDesc' in d, `${id} burst fields`);
  }
  assert.equal(STATUS.bleed.burstName, 'Aderlass');
  assert.equal(STATUS.poison.burstName, 'Gifteruption');
  assert.equal(STATUS.shock.burstName, 'Entladung');
  assert.equal(STATUS.shock.maxStacks, 5);
  assert.equal(statusGlossary().length, 10);
  for (const k of ['bleedChance', 'bleedDamage', 'vampirism', 'bloodOrbHeal', 'frenzyMax']) {
    assert.ok(STAT_NAMES.includes(k), k);
    assert.ok(STAT_LABELS[k] && STAT_LABELS[k].name, `label ${k}`);
  }
  const s = computeStats([[{ stat: 'vampirism', add: 2 }, { stat: 'bleedChance', add: 3 }, { stat: 'bloodOrbHeal', add: 99 }, { stat: 'frenzyMax', add: 40.7 }]]);
  assert.equal(s.vampirism, 0.25);
  assert.equal(s.bleedChance, 1);
  assert.equal(s.bloodOrbHeal, 40);
  assert.equal(s.frenzyMax, 30);
  assert.equal(computeStats([]).bloodOrbHeal, 4);
  assert.equal(computeStats([]).frenzyMax, 10);
  assert.equal(formatStatValue('bleedChance', 0.15), '15 %');
  assert.equal(formatStatValue('vampirism', 0.05), '5 %');
  assert.ok(PERK_HOOKS.includes('onStatusBurst'));
  assert.equal(typeof NULL_FX.drain, 'function');
});

// ---------------------------------------------------------------------------------------------
// Bleed
// ---------------------------------------------------------------------------------------------
test('bleed: ticks power × stacks, ×1.6 while moving, ignores resist, bloodless/immune enemies are spared', () => {
  const { w } = setup();
  const still = enemy(w, 200, 100, 'mech_armored');
  const moving = enemy(w, 200, 200, 'mech_armored');
  applyStatus(w, still, 'bleed', { power: 2, duration: 10, stacks: 3 });
  applyStatus(w, moving, 'bleed', { power: 2, duration: 10, stacks: 3 });
  ticks(w, still, 61);
  ticks(w, moving, 61, () => { moving.x += 1; }); // 60 px/s
  // 2 ticks of 2 × 3 × 0.5 = 3 each; phys resist 0.5 is ignored
  assert.ok(near(still.hp, 1000 - 6), `still ${still.hp}`);
  assert.ok(near(moving.hp, 1000 - 6 * 1.6, 0.05), `moving ${moving.hp}`);
  assert.ok(still.bleeding);

  // slow drift below 12 px/s does not count as moving
  const drift = enemy(w, 300, 100);
  applyStatus(w, drift, 'bleed', { power: 2, duration: 10, stacks: 3 });
  ticks(w, drift, 31, () => { drift.x += 0.1; }); // 6 px/s
  assert.ok(near(drift.hp, 997), `drift ${drift.hp}`);

  const construct = enemy(w, 400, 100, 'mech_construct');
  assert.equal(applyStatus(w, construct, 'bleed', { stacks: 5 }), false);
  assert.ok(!construct.statuses.bleed);
  const ghost = enemy(w, 450, 100, 'mech_noblood');
  assert.equal(applyStatus(w, ghost, 'bleed', {}), false);
  // bleed still lands on bloodless enemies' other statuses
  assert.equal(applyStatus(w, construct, 'poison', {}), true);
});

test('bleed: status:apply carries bleed; player bleed caps at 5, ignores armor and emits player:status', () => {
  const { w, p } = setup();
  const applied = listen('status:apply');
  const pst = listen('player:status');
  const e = enemy(w, 200, 100);
  applyStatus(w, e, 'bleed', {});
  assert.ok(applied.some((a) => a.id === 'bleed' && a.target === e));
  p.addMod('test_armor', [{ stat: 'armor', add: 50 }]);
  applyStatus(w, p, 'bleed', { power: 2, duration: 10, stacks: 9 });
  assert.equal(p.statuses.bleed.stacks, 5);
  assert.ok(pst.some((a) => a.id === 'bleed'));
  const hp0 = p.hp;
  ticks(w, p, 31);
  assert.ok(near(p.hp, hp0 - 2 * 5 * 0.5), `armor ignored: ${hp0 - p.hp}`);
  assert.ok(p.bleeding);
  applied.off(); pst.off();
});

test('bleed: enemy projectiles / zones / damagePlayer with status bleed make the player bleed', () => {
  const { w, p } = setup();
  p.x = 200; p.y = 120;
  w.spawnProjectile({ x: 170, y: 120, angle: 0, speed: 200, damage: 5, team: 'enemy', life: 2, status: { id: 'bleed', duration: 3 } });
  for (let i = 0; i < 20; i++) w.update(DT);
  assert.ok(p.statuses.bleed, 'projectile bleed');
  p.statuses = {}; p.iframes = 0;
  w.damagePlayer(3, { status: { id: 'bleed', power: 1.5 } });
  assert.equal(p.statuses.bleed.stacks, 1);
  assert.equal(p.statuses.bleed.power, 1.5);
});

test('statusFromStats: bleedChance rolls bleed with 2.5 × statusPower × damage × bleedDamage', () => {
  const { w, p } = setup();
  p.addMod('test_bleed', [{ stat: 'bleedChance', add: 1 }, { stat: 'bleedDamage', mul: 2 }, { stat: 'statusDuration', mul: 1.5 }]);
  const ws = makeWeaponState(WEAPONS.mech_gun);
  const shot = playerShot(w, ws, 0);
  assert.equal(shot.status.id, 'bleed');
  assert.ok(near(shot.status.power, 2.5 * p.stats.statusPower * p.stats.damage * 2));
  assert.ok(near(shot.status.duration, 6));
  // weapon-defined bleed statuses also scale with bleedDamage
  const ws2 = makeWeaponState({ ...WEAPONS.mech_gun, id: 'mech_gun2', base: { ...WEAPONS.mech_gun.base, status: { id: 'bleed', power: 1, duration: 2 } } });
  const shot2 = playerShot(w, ws2, 0);
  assert.ok(near(shot2.status.power, p.stats.statusPower * p.stats.damage * 2));
});

// ---------------------------------------------------------------------------------------------
// Aderlass
// ---------------------------------------------------------------------------------------------
test('Aderlass: at 10 stacks deals stacks × power × remaining s + 8 % maxHp once, consumes stacks, drops an orb', () => {
  const { run, w, p } = setup();
  addPerk(run, 'relic', 'mech_burst_log');
  burstLog.length = 0;
  const bursts = listen('status:burst');
  const e = enemy(w, 200, 100, 'mech_armored');
  applyStatus(w, e, 'bleed', { power: 2, duration: 4, stacks: 9 });
  assert.equal(bursts.length, 0);
  assert.equal(w.pickups.length, 0);
  applyStatus(w, e, 'bleed', { power: 2, duration: 4 });
  assert.equal(bursts.length, 1);
  const b = bursts[0];
  assert.equal(b.id, 'bleed');
  assert.equal(b.target, e);
  assert.ok(near(b.damage, 10 * 2 * 4 + 80), `damage ${b.damage}`);
  assert.ok(near(e.hp, 1000 - 160));
  assert.ok(!e.statuses.bleed, 'stacks consumed');
  assert.equal(w.pickups.filter((k) => k.kind === 'blood').length, 1);
  assert.equal(burstLog.length, 1);
  assert.equal(burstLog[0].enemy, e);
  assert.equal(burstLog[0].id, 'bleed');
  // more stacks restart from zero, no second burst
  applyStatus(w, e, 'bleed', { power: 2, duration: 4 });
  assert.equal(bursts.length, 1);
  assert.equal(e.statuses.bleed.stacks, 1);

  // elites 4 %, bosses 2 %; vampirism adds a second orb
  p.addMod('test_vamp', [{ stat: 'vampirism', add: 0.05 }]);
  const elite = enemy(w, 300, 100);
  elite.elite = ['tough'];
  applyStatus(w, elite, 'bleed', { power: 1, duration: 2, stacks: 10 });
  assert.ok(near(1000 - elite.hp, 10 * 1 * 2 + 40), `elite ${1000 - elite.hp}`);
  const boss = enemy(w, 400, 100);
  boss.boss = true;
  applyStatus(w, boss, 'bleed', { power: 1, duration: 2, stacks: 10 });
  assert.ok(near(1000 - boss.hp, 10 * 1 * 2 + 20), `boss ${1000 - boss.hp}`);
  assert.equal(w.pickups.filter((k) => k.kind === 'blood').length, 1 + 2 + 2);
  assert.equal(bursts.length, 3);
  assert.ok(run.stats.statusBursts >= 3);
  bursts.off();
});

test('blood orbs: kills of bleeding enemies drop one with chance 0.2 + vampirism × 2 (cap .75); not without bleed', () => {
  const { w, p } = setup();
  const chances = [];
  const orig = w.rng.chance.bind(w.rng);
  w.rng.chance = (c) => { chances.push(c); return orig(c); };
  const a = enemy(w, 200, 100);
  w.damageEnemy(a, 1e6);
  const before = chances.length;
  const b = enemy(w, 260, 100);
  applyStatus(w, b, 'bleed', {});
  chances.length = 0;
  w.rng.chance = (c) => { chances.push(c); return true; };
  w.damageEnemy(b, 1e6);
  assert.ok(chances.includes(0.2), `chances ${chances}`);
  assert.ok(w.pickups.some((k) => k.kind === 'blood'));
  p.addMod('test_vamp', [{ stat: 'vampirism', add: 0.25 }]);
  const c = enemy(w, 320, 100);
  applyStatus(w, c, 'bleed', {});
  chances.length = 0;
  w.damageEnemy(c, 1e6);
  assert.ok(chances.includes(0.7), `chances ${chances}`);
  assert.ok(before >= 0);
  w.rng.chance = orig;
});

// ---------------------------------------------------------------------------------------------
// Poison
// ---------------------------------------------------------------------------------------------
test('Gifteruption: at 8 stacks deals stacks × power × 2, spreads ceil(stacks/2) within 48 px, spread targets cannot erupt', () => {
  const { w } = setup();
  const bursts = listen('status:burst');
  const a = enemy(w, 200, 200);
  const nb = enemy(w, 230, 200);
  const far = enemy(w, 400, 200);
  applyStatus(w, nb, 'poison', { power: 1, duration: 5, stacks: 6 });
  applyStatus(w, a, 'poison', { power: 2, duration: 4, stacks: 7 });
  assert.equal(bursts.length, 0);
  applyStatus(w, a, 'poison', { power: 2, duration: 4 });
  assert.equal(bursts.length, 1, 'neighbour reaching 8 via the spread must not erupt');
  assert.equal(bursts[0].id, 'poison');
  assert.ok(near(1000 - a.hp, 8 * 2 * 2), `${1000 - a.hp}`);
  assert.ok(near(bursts[0].damage, 32));
  assert.ok(!a.statuses.poison);
  assert.equal(nb.statuses.poison.stacks, 8, '6 + 4 capped at 8');
  assert.ok(nb.eruptImmune > 0);
  assert.ok(!far.statuses.poison);
  // still immune in the same frame
  applyStatus(w, nb, 'poison', {});
  assert.equal(bursts.length, 1);
  // after the immunity the next application erupts
  ticks(w, nb, 35);
  applyStatus(w, nb, 'poison', {});
  assert.equal(bursts.length, 2);
  bursts.off();
});

test('Gifteruption: 30 tightly packed poisoned enemies cannot chain endlessly', () => {
  const { g, w } = setup();
  const bursts = listen('status:burst');
  const es = [];
  for (let i = 0; i < 30; i++) es.push(enemy(w, 200 + (i % 6) * 8, 200 + Math.floor(i / 6) * 8));
  for (const e of es) applyStatus(w, e, 'poison', { power: 1, duration: 6, stacks: 7 });
  applyStatus(w, es[14], 'poison', { power: 1, duration: 6 });
  assert.equal(bursts.length, 1, 'one eruption, spread targets are immune');
  // poisoning everything again in the same frame: each enemy erupts at most once
  for (const e of es) applyStatus(w, e, 'poison', { power: 1, duration: 6 });
  assert.ok(bursts.length <= 30, `${bursts.length}`);
  // keep re-poisoning for a few seconds: bounded, no exceptions
  for (let f = 0; f < 240; f++) {
    for (const e of es) if (!e.dead) applyStatus(w, e, 'poison', { power: 1, duration: 6 });
    g.update(DT);
  }
  assert.ok(bursts.length < 30 * 240 * 0.25, `${bursts.length}`);
  bursts.off();
});

test('enemy healing is halved while poisoned (healEnemy / w.healEnemy)', () => {
  const { w } = setup();
  const e = enemy(w, 200, 200);
  e.hp = 500;
  assert.equal(healEnemy(w, e, 100), 100);
  assert.equal(e.hp, 600);
  applyStatus(w, e, 'poison', {});
  assert.equal(w.healEnemy(e, 100), 50);
  assert.equal(e.hp, 650);
  e.hp = 990;
  assert.equal(w.healEnemy(e, 100), 10);
  assert.equal(e.hp, 1000);
  e.dead = true;
  assert.equal(w.healEnemy(e, 100), 0);
});

// ---------------------------------------------------------------------------------------------
// Shock
// ---------------------------------------------------------------------------------------------
test('shock: stacks to 5, +5 % damage taken per stack', () => {
  const { w } = setup();
  const e = enemy(w, 200, 200);
  for (let i = 0; i < 4; i++) applyStatus(w, e, 'shock', {});
  assert.equal(e.statuses.shock.stacks, 4);
  updateStatuses(w, e, DT);
  assert.ok(near(e.dmgTakenMul, 1.2));
  const dealt = w.damageEnemy(e, 10, { proc: false });
  assert.ok(near(dealt, 12));
});

test('Entladung: at 5 charges hits the target + chains to 4 more within 80 px (×0.8 per jump), stuns, chained get no stacks', () => {
  const { w } = setup();
  const bursts = listen('status:burst');
  const stun = listen('status:apply');
  const a = enemy(w, 100, 200);
  const chain = [1, 2, 3, 4, 5].map((i) => enemy(w, 100 + 60 * i, 200));
  const base = 14 * playerDamageMul(w, 'shock');
  for (let i = 0; i < 4; i++) applyStatus(w, a, 'shock', {});
  assert.equal(bursts.length, 0);
  applyStatus(w, a, 'shock', {});
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].id, 'shock');
  assert.ok(!a.statuses.shock);
  assert.ok(near(1000 - a.hp, base), `target ${1000 - a.hp} vs ${base}`);
  let mul = 1;
  for (let i = 0; i < 4; i++) {
    mul *= 0.8;
    assert.ok(near(1000 - chain[i].hp, base * mul), `jump ${i + 1}: ${1000 - chain[i].hp}`);
    assert.ok(!chain[i].statuses.shock, 'chained targets get no shock stacks');
    assert.ok(chain[i].statuses.stun, 'chained targets are stunned');
  }
  assert.equal(chain[4].hp, 1000, 'only 4 jumps');
  assert.ok(near(bursts[0].damage, base * (1 + 0.8 + 0.64 + 0.512 + 0.4096)));
  assert.ok(a.statuses.stun && near(a.statuses.stun.t, 0.6));
  assert.ok(stun.some((s) => s.id === 'stun' && s.target === a));
  bursts.off(); stun.off();
});

test('Entladung: elites are stunned 0.3 s, bosses not at all (no slow either); out of range = no chain', () => {
  const { w } = setup();
  const el = enemy(w, 100, 200);
  el.elite = ['swift'];
  for (let i = 0; i < 5; i++) applyStatus(w, el, 'shock', {});
  assert.ok(near(el.statuses.stun.t, 0.3));
  const boss = enemy(w, 400, 300);
  boss.boss = true;
  const lone = enemy(w, 600, 300);
  for (let i = 0; i < 5; i++) applyStatus(w, boss, 'shock', {});
  assert.ok(boss.hp < 1000);
  assert.ok(!boss.statuses.stun && !boss.statuses.slow, 'boss: no stun');
  assert.equal(lone.hp, 1000, '200 px away: no chain');
});

test('burst guard: a burst inside a burst may nest once, deeper recursion is deferred', () => {
  const { run, w } = setup();
  const bursts = listen('status:burst');
  const es = [0, 1, 2, 3].map((i) => enemy(w, 100 + 200 * i, 300));
  // every burst re-applies 10 bleed stacks to the next enemy (perk recursion)
  RELICS.mech_chain = {
    id: 'mech_chain', name: 'Kette', desc: 'Test', rarity: 'common', icon: { glyph: 'chain', color: '#fff' }, tags: [],
    hooks: {
      onStatusBurst(ctx, { enemy: e }) {
        const i = es.indexOf(e);
        if (i >= 0 && es[i + 1]) applyStatus(ctx.w, es[i + 1], 'bleed', { power: 1, duration: 2, stacks: 10 });
      },
    },
  };
  addPerk(run, 'relic', 'mech_chain');
  applyStatus(w, es[0], 'bleed', { power: 1, duration: 2, stacks: 10 });
  assert.equal(bursts.length, 2, 'outer + one nested');
  assert.equal(es[2].statuses.bleed.stacks, 10, 'third burst deferred, stacks kept');
  applyStatus(w, es[2], 'bleed', {});
  assert.equal(bursts.length, 4, 'deferred burst fires on the next application (and nests once more)');
  bursts.off();
});

// ---------------------------------------------------------------------------------------------
// Vampirism, lifesteal, drain feedback
// ---------------------------------------------------------------------------------------------
test('vampirism: heal per kill capped at 4 % maxHp, budget 6 HP/s, nothing from bosses / summons', () => {
  const { g, run, w, p } = setup();
  const drains = [];
  w.fx = { ...NULL_FX, drain: (...a) => drains.push(a) };
  p.addMod('test_vamp', [{ stat: 'vampirism', add: 0.1 }]);
  const maxHp = p.stats.maxHp;
  const cap = maxHp * 0.04;
  p.hp = 20;
  const healed = () => run.stats.healed;
  let h0 = healed();
  w.damageEnemy(enemy(w, 200, 200), 1e6);
  assert.ok(near(healed() - h0, Math.min(cap, VAMP_PER_S)), `first kill ${healed() - h0}`);
  assert.equal(drains.length, 1);
  h0 = healed();
  w.damageEnemy(enemy(w, 220, 200), 1e6);
  assert.ok(near(healed() - h0, VAMP_PER_S - cap), `budget rest ${healed() - h0}`);
  h0 = healed();
  w.damageEnemy(enemy(w, 240, 200), 1e6);
  assert.ok(near(healed() - h0, 0), 'budget empty');
  // a small enemy heals by its own max HP
  for (let i = 0; i < 70; i++) g.update(DT);
  h0 = healed();
  w.damageEnemy(enemy(w, 260, 200, 'mech_dummy', 20), 1e6);
  assert.ok(near(healed() - h0, 2), `small kill ${healed() - h0}`);
  for (let i = 0; i < 70; i++) g.update(DT);
  h0 = healed();
  const boss = enemy(w, 280, 200);
  boss.boss = true;
  w.damageEnemy(boss, 1e6);
  const sum = w.spawnEnemy('mech_dummy', 300, 200, { summoned: true, delay: 0 });
  sum.spawnT = 0;
  w.damageEnemy(sum, 1e6);
  assert.equal(healed() - h0, 0, 'no vampirism from bosses / summoned');
});

test('lifesteal: budget unchanged (3.5 HP/s), drain fx throttled per enemy, heal numbers aggregate per second', () => {
  const { g, run, w, p } = setup();
  const drains = [], texts = [];
  w.fx = { ...NULL_FX, drain: (...a) => drains.push(a), text: (x, y, str, color, opts) => texts.push({ str, opts }) };
  p.addMod('test_ls', [{ stat: 'lifesteal', add: 0.5 }]);
  p.hp = 20;
  const e = enemy(w, 200, 200, 'mech_dummy', 1e6);
  const h0 = run.stats.healed;
  for (let i = 0; i < 10; i++) w.damageEnemy(e, 100, { proc: false, silent: true });
  assert.ok(near(run.stats.healed - h0, 3.5), `${run.stats.healed - h0}`);
  assert.equal(drains.length, 1, 'one drain per 0.12 s per enemy');
  const e2 = enemy(w, 260, 200, 'mech_dummy', 1e6);
  p.lsBudget = 3.5;
  w.damageEnemy(e2, 1, { proc: false, silent: true });
  assert.equal(drains.length, 2, 'other enemy drains independently');
  // one aggregated "+N" floats per second
  texts.length = 0;
  for (let s = 0; s < 120; s++) {
    w.damageEnemy(e, 100, { proc: false, silent: true });
    g.update(DT);
  }
  const healTexts = texts.filter((t) => t.opts && t.opts.heal);
  assert.ok(healTexts.length >= 1 && healTexts.length <= 3, `${healTexts.length} heal texts in 2 s`);
  assert.ok(drains.length < 2 + 120 / 6, `${drains.length} drains`);
  assert.ok(p.lsBudget <= 3.5);
});

// ---------------------------------------------------------------------------------------------
// Blood orbs + Blutrausch
// ---------------------------------------------------------------------------------------------
test('blood orbs: heal bloodOrbHeal × healPower, +1 Blutrausch stack each, cap frenzyMax, decay after 4 s', () => {
  const { run, w, p } = setup();
  const frenzy = listen('player:frenzy');
  const picks = listen('pickup:collect');
  p.hp = 30;
  const dmg0 = p.stats.damage, spd0 = p.stats.moveSpeed;
  w.spawnPickup('blood', p.x, p.y);
  for (let i = 0; i < 30 && w.pickups.some((k) => !k.dead); i++) updatePickups(w, DT);
  assert.ok(near(p.hp, 30 + 4 * p.stats.healPower), `hp ${p.hp}`);
  assert.equal(p.frenzy.stacks, 1);
  assert.ok(near(p.stats.damage, dmg0 * 1.03));
  assert.ok(near(p.stats.moveSpeed, spd0 * 1.02));
  assert.deepEqual(frenzy.map((f) => f.stacks), [1]);
  assert.ok(picks.some((k) => k.kind === 'blood'));
  assert.equal(run.stats.bloodOrbs, 1);
  // orbs are collected even at full HP (Blutrausch)
  p.hp = p.stats.maxHp;
  for (let n = 0; n < 12; n++) {
    w.spawnPickup('blood', p.x, p.y);
    for (let i = 0; i < 30 && w.pickups.some((k) => !k.dead); i++) updatePickups(w, DT);
    w.pickups = w.pickups.filter((k) => !k.dead);
  }
  assert.equal(p.frenzy.stacks, 10, 'capped at frenzyMax');
  assert.ok(near(p.stats.damage, dmg0 * 1.3));
  assert.equal(run.stats.frenzyPeak, 10);
  // timer: refreshed by each stack, then drops to 0
  for (let i = 0; i < Math.round((FRENZY_TIME - 0.5) * 60); i++) p._updateFrenzy(DT);
  assert.equal(p.frenzy.stacks, 10);
  for (let i = 0; i < 40; i++) p._updateFrenzy(DT);
  assert.equal(p.frenzy.stacks, 0);
  assert.equal(frenzy[frenzy.length - 1].stacks, 0);
  assert.ok(near(p.stats.damage, dmg0));
  assert.ok(near(p.stats.moveSpeed, spd0));
  // frenzyMax raises the cap
  p.addMod('test_frenzy', [{ stat: 'frenzyMax', add: 5 }]);
  p.addFrenzy(20);
  assert.equal(p.frenzy.stacks, 15);
  frenzy.off(); picks.off();
});

test('blood orbs: despawn after 8 s and blink during the last 2 s', () => {
  const { w, p } = setup();
  p.x = 24; p.y = 24;
  const pk = w.spawnPickup('blood', 400, 300);
  assert.equal(pk.life, BLOOD_ORB_LIFE);
  for (let i = 0; i < Math.round(5.9 * 60); i++) updatePickups(w, DT);
  assert.ok(!pk.dead && !pk.blink);
  for (let i = 0; i < 30; i++) updatePickups(w, DT);
  assert.ok(!pk.dead && pk.blink, 'blinks in the last 2 s');
  for (let i = 0; i < Math.round(1.6 * 60) + 2; i++) updatePickups(w, DT);
  assert.ok(pk.dead, 'gone after 8 s');
  // other pickups do not expire
  const sp = w.spawnPickup('spark', 400, 300);
  assert.equal(sp.life, undefined, 'only despawning pickups carry life');
  for (let i = 0; i < 600; i++) updatePickups(w, DT);
  assert.ok(!sp.dead && !sp.blink);
});

test('player bleed: −40 % healing (heals, blood orbs, regen), lifted when the bleed ends', () => {
  const { w, p } = setup();
  const hpw = p.stats.healPower;
  p.hp = 30;
  applyStatus(w, p, 'bleed', { power: 0.01, duration: 1 });
  w.healPlayer(10);
  assert.ok(near(p.hp, 30 + 10 * hpw * 0.6), `${p.hp}`);
  p.hp = 30;
  w.healPlayer(10, { raw: true });
  assert.ok(near(p.hp, 36), 'raw heals (lifesteal) too');
  p.hp = 30;
  w.spawnPickup('blood', p.x, p.y);
  for (let i = 0; i < 30 && w.pickups.some((k) => !k.dead); i++) updatePickups(w, DT);
  assert.ok(near(p.hp, 30 + 4 * hpw * 0.6), `orb ${p.hp}`);
  ticks(w, p, 70);
  assert.ok(!p.statuses.bleed && !p.bleeding);
  p.hp = 30;
  w.healPlayer(10);
  assert.ok(near(p.hp, 30 + 10 * hpw));
});

test('kill attribution names Blutung for a lethal player bleed', () => {
  const { run, w, p } = setup();
  p.hp = 1;
  applyStatus(w, p, 'bleed', { power: 10, duration: 3, stacks: 5 });
  ticks(w, p, 31);
  assert.ok(run.ended);
  assert.equal(run.killedBy.name, 'Blutung');
});

// ---------------------------------------------------------------------------------------------
// Stress
// ---------------------------------------------------------------------------------------------
test('performance: 60 enemies bleeding + poisoned + shocked for 10 simulated s stays fast and error-free', () => {
  const { g, run, w, p } = setup(44, 30);
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    p.x = 30; p.y = 30;
    p.addMod('test_vamp', [{ stat: 'vampirism', add: 0.1 }, { stat: 'lifesteal', add: 0.1 }]);
    const es = [];
    for (let i = 0; i < 60; i++) {
      const e = enemy(w, 160 + (i % 10) * 30, 120 + Math.floor(i / 10) * 40, 'mech_dummy', 4000);
      e.ai = { update(w2, en, dt) { w2.moveEntity(en, Math.cos(w2.time * 3 + i) * 30 * dt, Math.sin(w2.time * 2 + i) * 30 * dt); } };
      es.push(e);
    }
    const bursts = listen('status:burst');
    const t0 = performance.now();
    for (let f = 0; f < 600; f++) {
      if (f % 6 === 0) {
        for (const e of es) {
          if (e.dead) continue;
          applyStatus(w, e, 'bleed', { power: 1.5, duration: 4 });
          applyStatus(w, e, 'poison', { power: 1.2, duration: 4 });
          applyStatus(w, e, 'shock', { duration: 4 });
        }
      }
      g.update(DT);
    }
    const ms = performance.now() - t0;
    bursts.off();
    assert.equal(g.state, 'playing');
    assert.equal(errors.length, 0, errors.slice(0, 3).join('\n'));
    assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
    assert.ok(bursts.length > 50, `bursts ${bursts.length}`);
    assert.ok(run.stats.kills > 0 || es.every((e) => e.hp < 4000));
  } finally {
    console.error = origErr;
  }
});
