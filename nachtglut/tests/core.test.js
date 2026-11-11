// Core simulation tests (owner: sim). Run: node --test tests/core.test.js
// Content-independent: tests register their own enemy / relic / boon / weapon defs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, makeStubInput } from '../src/game/game.js';
import { bus } from '../src/core/events.js';
import { computeStats } from '../src/game/stats.js';
import { TS, TILE, SPIKE_CYCLE } from '../src/game/constants.js';
import { applyStatus, updateStatuses } from '../src/game/combat.js';
import { updateProjectiles, updateZones, updatePickups, zoneContains } from '../src/game/entities.js';
import { interact, damageProp, instantiateProps, onRoomCleared } from '../src/game/props.js';
import { addPerk, refreshDynamicMods } from '../src/game/perks.js';
import { ENEMIES, AI, RELICS, BOONS, WEAPONS } from '../src/game/registry.js';
import { generateFallbackFloor } from '../src/game/fallbackgen.js';
import { BIOMES } from '../src/data/biomes.js';
import { simulate } from '../tools/sim.mjs';

const DT = 1 / 60;

// ---------------------------------------------------------------------------------------------
// Test content
// ---------------------------------------------------------------------------------------------
const quiet = console.warn;
console.warn = () => {}; // missing-placeholder warnings are expected for stub rosters
ENEMIES.test_dummy = {
  id: 'test_dummy', name: 'Testpuppe', desc: '', biome: 'ash', hp: 1000, speed: 0, damage: 0, r: 6, mass: 1,
  xp: 0, sparks: [0, 0], sprite: 'test_dummy', color: '#888', ai: 'test_none', aiParams: {},
};
AI.test_none = { update() {} };
const hookLog = { hit: 0, kill: 0 };
RELICS.test_rage = {
  id: 'test_rage', name: 'Testzorn', desc: 'Test', rarity: 'common', icon: { glyph: 'flame', color: '#f00' }, tags: [],
  hooks: {
    onHit() { hookLog.hit++; },
    onKill() { hookLog.kill++; },
    dynamicMods(ctx) { return ctx.state.on ? [{ stat: 'moveSpeed', add: 50 }] : null; },
  },
};
BOONS.test_boon = {
  id: 'test_boon', name: 'Testsegen', desc: 'Test', rarity: 'common', icon: { glyph: 'star', color: '#ff0' }, maxStacks: 3,
  mods: (n) => [{ stat: 'damage', mul: 1 + 0.1 * n }],
};
WEAPONS.test_gun = {
  id: 'test_gun', name: 'Testflinte', desc: 'Test', rarity: 'common', type: 'phys', icon: { glyph: 'bow', color: '#fff' },
  base: { damage: 5, cooldown: 0.5, projSpeed: 200, range: 200, count: 1 },
  levels: [{ desc: 'a', mods: { damage: 2 } }, { desc: 'b', mods: {} }, { desc: 'c', mods: {} }, { desc: 'd', mods: {} }],
  fire() {},
};

function listen(evt) {
  const got = [];
  const off = bus.on(evt, (p) => got.push(p));
  got.off = off;
  return got;
}

function newGame(opts = {}) {
  const g = new Game({ input: makeStubInput(), ...opts });
  g.startRun({ seed: 'test', character: 'bearer' });
  return g;
}

/** Plain walled room; `paint(room)` may change tiles / add props. */
function makeRoom(w = 24, h = 15, paint) {
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

function fill(room, x0, y0, w, h, t) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) room.tiles[y * room.w + x] = t;
}

function dummy(w, x, y, hp = 1000) {
  const e = w.spawnEnemy('test_dummy', x, y, { delay: 0 });
  e.spawnT = 0; e.hp = e.maxHp = hp; e.damage = 0; e.contact = false; e.ai = { update() {} };
  return e;
}

function steps(g, n, each) {
  for (let i = 0; i < n; i++) { if (each) each(i); g.update(DT); }
}

// ---------------------------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------------------------
test('stats: (base + Σadd) × Πmul with clamps and integer stats', () => {
  const s = computeStats([[{ stat: 'damage', add: 0.5 }], [{ stat: 'damage', mul: 2 }, { stat: 'maxHp', add: 20 }], [{ stat: 'maxHp', mul: 1.5 }]]);
  assert.equal(s.damage, 3);
  assert.equal(s.maxHp, 180);
  const c = computeStats([[{ stat: 'dodge', add: 2 }, { stat: 'pierce', add: 1.7 }, { stat: 'nonsense', add: 5 }, { stat: 'fireRate', mul: NaN }]]);
  assert.equal(c.dodge, 0.6);
  assert.equal(c.pierce, 1);
  assert.equal(c.fireRate, 1);
  assert.equal(c.nonsense, undefined);
});

// ---------------------------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------------------------
test('statuses: burn ticks every 0.5 s, chill stacks freeze, bosses are immune to freeze/stun', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom());
  const e = dummy(w, 200, 100, 100);
  applyStatus(w, e, 'burn', { duration: 3, power: 4 });
  for (let i = 0; i < 61; i++) updateStatuses(w, e, DT);
  assert.equal(e.hp, 96); // two ticks of 4 × 0.5

  const f = dummy(w, 260, 100);
  applyStatus(w, f, 'chill', { stacks: 2 });
  updateStatuses(w, f, DT);
  assert.ok(f.slowMul < 1 && !f.frozen);
  applyStatus(w, f, 'chill', { stacks: 3 });
  updateStatuses(w, f, DT);
  assert.ok(f.frozen, 'max chill stacks freeze');
  assert.ok(!f.statuses.chill);

  const b = dummy(w, 300, 100);
  b.boss = true;
  applyStatus(w, b, 'freeze', {});
  applyStatus(w, b, 'stun', {});
  applyStatus(w, b, 'chill', { stacks: 9 });
  updateStatuses(w, b, DT);
  assert.ok(!b.frozen && !b.stunned);
  assert.ok(b.statuses.chill && b.statuses.slow);
});

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------
test('projectiles: hit once, pierce, bounce, lifetime; onExpire exactly once', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom(30, 15));
  const e1 = dummy(w, 120, 120), e2 = dummy(w, 160, 120);
  let expired = 0, hits = 0;
  // pierce 0: hits the first enemy only
  const p0 = w.spawnProjectile({ x: 80, y: 120, angle: 0, speed: 300, damage: 10, team: 'player', life: 2, onExpire: () => expired++, onHit: () => hits++ });
  for (let i = 0; i < 30 && !p0.dead; i++) updateProjectiles(w, DT);
  assert.ok(p0.dead);
  assert.equal(e1.hp, 990);
  assert.equal(e2.hp, 1000);
  assert.equal(expired, 1);
  assert.equal(hits, 1);
  // pierce 1: passes the first, hits the second, then dies on the wall
  expired = 0;
  const p1 = w.spawnProjectile({ x: 80, y: 120, angle: 0, speed: 300, damage: 10, team: 'player', pierce: 1, life: 3, onExpire: () => expired++ });
  for (let i = 0; i < 200 && !p1.dead; i++) updateProjectiles(w, DT);
  assert.equal(e1.hp, 980);
  assert.equal(e2.hp, 990);
  assert.ok(p1.dead);
  assert.equal(expired, 1);
  // bounce: reflects off the east wall once, then expires on the west wall
  expired = 0;
  const pb = w.spawnProjectile({ x: 300, y: 40, angle: 0, speed: 300, damage: 1, team: 'enemy', bounce: 1, life: 5, onExpire: () => expired++ });
  let bounced = false;
  for (let i = 0; i < 300 && !pb.dead; i++) { updateProjectiles(w, DT); if (pb.vx < 0) bounced = true; }
  assert.ok(bounced);
  assert.equal(pb.bounce, 0);
  assert.ok(pb.dead);
  assert.equal(expired, 1);
  // lifetime
  expired = 0;
  const pl = w.spawnProjectile({ x: 200, y: 40, angle: Math.PI / 2, speed: 10, team: 'player', damage: 1, life: 0.1, onExpire: () => expired++ });
  for (let i = 0; i < 10; i++) updateProjectiles(w, DT);
  assert.ok(pl.dead);
  assert.equal(expired, 1);
  // direct kill skips onExpire
  expired = 0;
  const pk = w.spawnProjectile({ x: 200, y: 40, angle: 0, speed: 10, team: 'player', damage: 1, life: 1, onExpire: () => expired++ });
  pk.dead = true;
  updateProjectiles(w, DT);
  assert.equal(expired, 0);
});

test('projectiles: enemy shots, dash pass-through, reflect, hitInterval, range → life', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom(30, 15));
  const p = w.player;
  p.x = 200; p.y = 120;
  const hp0 = p.hp;
  const s1 = w.spawnProjectile({ x: 170, y: 120, angle: 0, speed: 200, damage: 10, team: 'enemy', life: 2 });
  for (let i = 0; i < 20 && !s1.dead; i++) updateProjectiles(w, DT);
  assert.ok(s1.dead);
  assert.equal(p.hp, hp0 - 10);
  p.iframes = 0; p.dashing = true;
  const s2 = w.spawnProjectile({ x: 170, y: 120, angle: 0, speed: 200, damage: 10, team: 'enemy', life: 2 });
  for (let i = 0; i < 20; i++) updateProjectiles(w, DT);
  assert.equal(p.hp, hp0 - 10, 'dashing player takes no damage');
  assert.ok(!s2.dead || s2.x > 200, 'shot passes through');
  p.dashing = false; p.iframes = 0;
  p.flags.reflect = true;
  const owner = dummy(w, 100, 120);
  const s3 = w.spawnProjectile({ x: 170, y: 120, angle: 0, speed: 200, damage: 10, team: 'enemy', life: 2, owner });
  for (let i = 0; i < 60 && !s3.dead; i++) updateProjectiles(w, DT);
  assert.equal(s3.team, 'player');
  assert.equal(owner.hp, 980, 'reflected shot deals double damage to its owner');
  p.flags.reflect = false;
  // lingering orb re-hits after hitInterval
  const e = dummy(w, 300, 60);
  const orb = w.spawnProjectile({ x: 300, y: 60, vx: 0, vy: 0, damage: 1, team: 'player', life: 1.05, hitInterval: 0.25 });
  for (let i = 0; i < 66; i++) { w.time += DT; updateProjectiles(w, DT); }
  assert.ok(orb.dead);
  assert.ok(e.hp <= 996 && e.hp >= 994, `hit 4-5 times, hp ${e.hp}`);
  const r = w.spawnProjectile({ x: 50, y: 50, angle: 0, speed: 200, range: 100, team: 'player', damage: 1 });
  assert.equal(r.life, 0.5);
});

// ---------------------------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------------------------
test('zones: shapes', () => {
  assert.ok(zoneContains({ shape: 'circle', x: 0, y: 0, r: 10 }, 14, 0, 5));
  assert.ok(!zoneContains({ shape: 'circle', x: 0, y: 0, r: 10 }, 16, 0, 5));
  const ring = { shape: 'ring', x: 0, y: 0, r: 40, inner: 30 };
  assert.ok(zoneContains(ring, 35, 0, 1));
  assert.ok(!zoneContains(ring, 10, 0, 1));
  assert.ok(!zoneContains(ring, 50, 0, 1));
  const line = { shape: 'line', x: 0, y: 0, x2: 100, y2: 0, width: 10 };
  assert.ok(zoneContains(line, 50, 6, 2));
  assert.ok(!zoneContains(line, 50, 9, 2));
  assert.ok(!zoneContains(line, 110, 0, 2));
  const cone = { shape: 'cone', x: 0, y: 0, r: 50, angle: 0, arc: Math.PI / 2 };
  assert.ok(zoneContains(cone, 30, 10, 0));
  assert.ok(!zoneContains(cone, 0, 30, 0));
  assert.ok(!zoneContains(cone, -30, 0, 0));
  assert.ok(!zoneContains(cone, 60, 0, 0));
});

test('zones: delay, single hit, tick, follow, onStart/onEnd', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom(30, 15));
  const p = w.player;
  p.x = 200; p.y = 120;
  const hp0 = p.hp;
  const calls = [];
  const z = w.spawnZone({ shape: 'circle', x: 200, y: 120, r: 20, delay: 0.5, duration: 0.3, damage: 7, onStart: () => calls.push('start'), onEnd: () => calls.push('end') });
  for (let i = 0; i < 24; i++) { w.time += DT; updateZones(w, DT); }
  assert.equal(p.hp, hp0, 'no damage during the telegraph');
  for (let i = 0; i < 30; i++) { w.time += DT; updateZones(w, DT); p.iframes = 0; }
  assert.equal(p.hp, hp0 - 7, 'hit exactly once');
  assert.ok(z.dead);
  assert.deepEqual(calls, ['start', 'end']);
  // ticking player zone vs enemies
  const e = dummy(w, 300, 120);
  w.spawnZone({ shape: 'circle', x: 300, y: 120, r: 10, delay: 0, duration: 1.0, damage: 2, tick: 0.25, team: 'player' });
  for (let i = 0; i < 61; i++) { w.time += DT; updateZones(w, DT); }
  assert.ok(e.hp <= 992 && e.hp >= 990, `4-5 ticks, hp ${e.hp}`);
  // follow + owner death cancels the telegraph
  const o = dummy(w, 100, 60);
  const fz = w.spawnZone({ shape: 'circle', x: 0, y: 0, r: 10, delay: 1, follow: o });
  updateZones(w, DT);
  assert.equal(fz.x, 100);
  o.dead = true;
  updateZones(w, DT);
  assert.ok(fz.dead);
});

// ---------------------------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------------------------
test('pickups: sparks, xp, hearts only when hurt, magnet', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom(30, 15));
  const p = w.player;
  p.x = 200; p.y = 120;
  const col = listen('pickup:collect');
  const s0 = p.sparks;
  w.spawnPickup('spark', 200, 120, { amount: 5 });
  w.spawnPickup('heart', 200, 120);
  for (let i = 0; i < 20; i++) updatePickups(w, DT);
  assert.equal(p.sparks, s0 + 5);
  assert.equal(w.pickups.filter((k) => !k.dead && k.kind === 'heart').length, 1, 'heart stays at full hp');
  p.hp = 50;
  updatePickups(w, DT);
  assert.equal(p.hp, 65);
  const far = w.spawnPickup('xp', 40, 40, { amount: 3, magnet: true });
  for (let i = 0; i < 90; i++) updatePickups(w, DT);
  assert.ok(far.dead);
  assert.equal(p.xp, 3);
  assert.deepEqual(col.map((c) => c.kind), ['spark', 'heart', 'xp']);
  col.off();
});

// ---------------------------------------------------------------------------------------------
// Perks
// ---------------------------------------------------------------------------------------------
test('perks: stacking mods, hooks fire, dynamicMods', () => {
  const g = newGame();
  const run = g.run;
  const w = enterRoom(g, makeRoom());
  const d0 = run.player.stats.damage;
  run.giveBoon('test_boon');
  run.giveBoon('test_boon');
  assert.ok(Math.abs(run.player.stats.damage - d0 * 1.2) < 1e-9);
  run.giveBoon('test_boon'); run.giveBoon('test_boon');
  assert.equal(run.player.boons.find((b) => b.id === 'test_boon').stacks, 3);
  assert.ok(Math.abs(run.player.stats.damage - d0 * 1.3) < 1e-9);

  hookLog.hit = 0; hookLog.kill = 0;
  const perk = addPerk(run, 'relic', 'test_rage');
  const e = dummy(w, 200, 100, 15);
  w.damageEnemy(e, 10);
  w.damageEnemy(e, 10);
  w.damageEnemy(dummy(w, 220, 100), 5, { proc: false });
  assert.equal(hookLog.hit, 2);
  assert.equal(hookLog.kill, 1);
  const ms = run.player.stats.moveSpeed;
  perk.state.on = true;
  refreshDynamicMods(run);
  assert.equal(run.player.stats.moveSpeed, ms + 50);
  perk.state.on = false;
  refreshDynamicMods(run);
  assert.equal(run.player.stats.moveSpeed, ms);
});

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------
function propRoom() {
  return makeRoom(26, 15, (r) => {
    r.type = 'shop';
    r.props.push(
      { kind: 'chest', tx: 3, ty: 3, tier: 'common' },
      { kind: 'chest', tx: 5, ty: 3, tier: 'rare', locked: true },
      { kind: 'pedestal', tx: 8, ty: 3, offer: 'heal', price: 'auto' },
      { kind: 'pedestal', tx: 10, ty: 3, offer: 'heal', price: 0, group: 'g' },
      { kind: 'pedestal', tx: 12, ty: 3, offer: 'heal', price: 0, group: 'g' },
      { kind: 'forge', tx: 3, ty: 10 },
      { kind: 'fountain', tx: 6, ty: 10 },
      { kind: 'barrel', tx: 15, ty: 10 },
      { kind: 'barrel', tx: 20, ty: 10, explosive: true },
      { kind: 'torch', tx: 1, ty: 1 },
    );
  });
}

test('props: instantiate once, chest, locked chest, pedestal purchase + groups', () => {
  const g = newGame();
  const run = g.run;
  const room = propRoom();
  const w = enterRoom(g, room);
  assert.equal(instantiateProps(w, room), w.props, 'cached on the room');
  const [chest, locked, shopPed, free1, free2] = w.props;
  assert.equal(chest.sprite, 'prop_chest');
  assert.ok(chest.solid && !w.props[9].solid);
  assert.ok(w.blocked[3 * room.w + 3], 'solid prop blocks its tile');
  const opened = listen('prop:open');
  assert.equal(interact(w, chest), true);
  assert.ok(chest.used);
  assert.equal(chest.sprite, 'prop_chest_open');
  assert.ok(w.pickups.some((k) => k.kind === 'spark'));
  assert.equal(opened.length, 1);
  assert.equal(g.choice && g.choice.kind, 'relic');
  g.clearChoices(); g.setState('playing');
  assert.equal(interact(w, locked), false);
  onRoomCleared(w, { ...room, type: 'treasure' });
  assert.equal(locked.locked, false);

  const fail = listen('shop:fail'), buy = listen('shop:buy');
  assert.ok(shopPed.offer.price >= 5 && shopPed.offer.price % 5 === 0);
  run.player.sparks = 0;
  assert.equal(interact(w, shopPed), false);
  assert.equal(fail.length, 1);
  run.player.sparks = 500;
  run.player.hp = 20;
  assert.equal(interact(w, shopPed), true);
  assert.equal(run.player.sparks, 500 - shopPed.offer.price);
  assert.equal(buy.length, 1);
  assert.ok(shopPed.removed && run.player.hp > 20);
  assert.equal(interact(w, free1), true);
  assert.ok(free1.removed && free2.removed, 'group removed');
  fail.off(); buy.off(); opened.off();
  // state survives re-entry
  run.enterRoom(run.floor.startRoomId);
  run.enterRoom(room.id);
  assert.ok(run.world.props[0].used);
});

test('props: forge upgrades, fountain heals once, barrels break and explode', () => {
  const g = newGame();
  const run = g.run, p = run.player;
  const w = enterRoom(g, propRoom());
  const forge = w.props[5], fountain = w.props[6], barrel = w.props[7], boom = w.props[8];
  p.sparks = 1000;
  const ws = p.weapon;
  assert.equal(interact(w, forge), true);
  assert.equal(g.choice.kind, 'forge');
  const opt = g.choice.options[0];
  assert.ok(!opt.disabled);
  opt.pick();
  assert.equal(ws.level, 2);
  assert.ok(p.sparks < 1000);
  assert.equal(forge.usesLeft, 1);
  assert.equal(g.state, 'playing');

  p.hp = 10;
  assert.equal(interact(w, fountain), true);
  assert.equal(p.hp, 10 + p.stats.maxHp * 0.4);
  assert.equal(fountain.sprite, 'prop_fountain_empty');
  assert.equal(interact(w, fountain), false);

  const n0 = w.pickups.length;
  damageProp(w, barrel, 1);
  assert.ok(barrel.removed);
  assert.ok(w.pickups.length > n0);
  assert.equal(w.blocked[barrel.ty * w.w + barrel.tx], 0);
  const e = dummy(w, boom.x + 20, boom.y);
  const shot = w.spawnProjectile({ x: boom.x - 30, y: boom.y, angle: 0, speed: 300, damage: 1, team: 'player', life: 1 });
  for (let i = 0; i < 20 && !shot.dead; i++) updateProjectiles(w, DT);
  assert.ok(boom.removed);
  assert.ok(e.hp < 1000, 'explosion hurts nearby enemies');
});

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------
test('player: dash crosses a pit, landing in a pit falls back to safety', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom(30, 9, (r) => fill(r, 8, 1, 2, 7, TILE.PIT)));
  const p = w.player, input = g.input;
  p.x = 6.5 * TS; p.y = 4.5 * TS; p.safeX = p.x; p.safeY = p.y;
  const falls = listen('player:fall'), dashes = listen('player:dash');
  input.setMove(1, 0);
  input.press('dash');
  g.update(DT);
  input.setMove(0, 0);
  steps(g, 30);
  assert.equal(dashes.length, 1);
  assert.equal(falls.length, 0);
  assert.ok(p.x > 10 * TS, `crossed the pit (x=${p.x})`);
  assert.equal(p.dash.charges, 0);
  steps(g, Math.ceil(p.stats.dashCooldown / DT) + 2);
  assert.equal(p.dash.charges, p.dash.max, 'charge recovers');

  // a wide pit: the dash ends above it
  const w2 = enterRoom(g, makeRoom(30, 9, (r) => fill(r, 8, 1, 20, 7, TILE.PIT)));
  const hp0 = p.hp;
  p.x = 6.5 * TS; p.y = 4.5 * TS; p.safeX = p.x; p.safeY = p.y;
  input.setMove(1, 0); input.press('dash');
  g.update(DT);
  input.setMove(0, 0);
  steps(g, 30);
  assert.equal(falls.length, 1);
  assert.equal(p.hp, hp0 - 8);
  assert.ok(Math.abs(p.x - 6.5 * TS) < 2 && w2.tileAtPx(p.x, p.y) === TILE.FLOOR);
  falls.off(); dashes.off();
});

test('player: hazards and spikes hurt, doors change rooms', () => {
  const g = newGame();
  const w = enterRoom(g, makeRoom(20, 9, (r) => { fill(r, 3, 3, 2, 2, TILE.HAZARD); fill(r, 10, 3, 1, 1, TILE.SPIKES); }));
  const p = w.player;
  p.x = 3.5 * TS; p.y = 3.5 * TS;
  const hits = listen('player:hit');
  steps(g, 15);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, BIOMES.ash.hazardType);
  assert.ok(p.statuses[BIOMES.ash.hazardStatus]);
  p.statuses = {}; p.iframes = 0;
  p.x = 10.5 * TS; p.y = 3.5 * TS;
  w.time = SPIKE_CYCLE.outAt + 0.05;
  g.update(DT);
  assert.equal(hits.length, 2);
  hits.off();

  // walking onto the east door of the start room
  const g2 = newGame();
  const run = g2.run, w2 = run.world;
  const door = w2.room.doors.e;
  w2.player.x = (door.tx + 0.5) * TS; w2.player.y = (door.ty + 0.5) * TS;
  g2.update(DT);
  assert.equal(g2.state, 'transition');
  steps(g2, 30);
  assert.equal(g2.state, 'playing');
  assert.equal(run.roomId, door.to);
  assert.ok(run.world.player.x < 4 * TS, 'enters at the west door');
});

test('player: xp, level-up, boon choice; weapon gain + swap', () => {
  const g = newGame();
  const run = g.run, p = run.player;
  const lv = listen('player:levelup');
  p.gainXp(p.xpNext);
  assert.equal(p.level, 2);
  assert.equal(lv.length, 1);
  assert.equal(run.pendingBoons, 1);
  assert.equal(p.xpNext, Math.round(16 + 18 + 4));
  g.update(DT);
  assert.equal(g.state, 'choice');
  assert.equal(g.choice.kind, 'boon');
  assert.match(g.choice.options[0].detail, /^Stufe \d+\/\d+$/);
  g.choice.options[0].pick();
  assert.equal(g.state, 'playing');
  assert.equal(p.boons.length, 1);
  lv.off();

  const gain = listen('weapon:gain'), swap = listen('weapon:swap');
  const first = p.weapon.id;
  run.giveWeapon('test_gun');
  assert.equal(p.weapon.id, 'test_gun');
  assert.equal(p.weaponIndex, 1);
  assert.ok(p.swapWeapon());
  assert.equal(p.weapon.id, first);
  assert.deepEqual(swap.map((s) => s.id), [first]);
  assert.deepEqual(gain.map((s) => s.id), ['test_gun']);
  assert.ok(p.upgradeWeapon(p.weapons[1]));
  assert.equal(p.weapons[1].stats.damage, 10);
  gain.off(); swap.off();
});

// ---------------------------------------------------------------------------------------------
// Run / game flow
// ---------------------------------------------------------------------------------------------
function killAll(w) {
  for (const e of w.enemies) if (!e.dead && e.spawnT <= 0) w.killEnemy(e);
}

function pickAny(g) {
  if (g.state === 'choice' && g.choice) {
    const o = g.choice.options.find((x) => !x.disabled);
    if (o) o.pick(); else g.choice.skip();
  }
}

test('flow: start → clear room → change room → boss → next floor', () => {
  const g = newGame();
  const run = g.run;
  assert.equal(g.state, 'playing');
  assert.equal(run.floorIndex, 1);
  assert.equal(run.roomId, run.floor.startRoomId);
  assert.ok(run.player.weapon);
  const clears = listen('room:clear'), floors = listen('floor:enter');
  run.changeRoom(1, 'e');
  steps(g, 25, () => pickAny(g));
  assert.equal(run.roomId, 1);
  assert.ok(run.world.locked);
  for (let i = 0; i < 1200 && !clears.length; i++) { pickAny(g); killAll(run.world); g.update(DT); }
  assert.equal(clears.length, 1);
  assert.ok(!run.world.locked);
  assert.equal(run.stats.roomsCleared, 1);

  // boss room
  run.enterRoom(run.floor.bossRoomId);
  for (let i = 0; i < 1200 && clears.length < 2; i++) { pickAny(g); killAll(run.world); g.update(DT); }
  assert.equal(clears.length, 2);
  const w = run.world;
  const portal = w.props.find((pr) => pr.kind === 'portal');
  assert.ok(portal, 'portal appears after the boss');
  assert.equal(w.props.filter((pr) => pr.kind === 'pedestal' && pr.group === 'boss').length, 3);
  const free = w.props.find((pr) => pr.group === 'boss');
  interact(w, free);
  assert.ok(w.props.filter((pr) => pr.group === 'boss').every((pr) => pr.removed));
  pickAny(g);
  assert.equal(interact(w, portal), true);
  for (let i = 0; i < 80 && run.floorIndex === 1; i++) g.update(DT);
  steps(g, 40, () => pickAny(g));
  assert.equal(run.floorIndex, 2);
  assert.equal(run.stats.floorsCleared, 1);
  assert.equal(floors.at(-1).biome.id, 'fungal');
  assert.equal(g.state, 'playing');
  clears.off(); floors.off();
});

test('flow: death → run:end → dead; abandon → summary.abandoned; victory', () => {
  const g = newGame();
  const run = g.run;
  const ends = listen('run:end'), deaths = listen('player:death');
  run.world.damagePlayer(99999, { unblockable: true });
  assert.ok(run.ended && !run.player.alive);
  assert.equal(deaths.length, 1);
  assert.equal(g.state, 'playing', 'dying animation keeps simulating');
  steps(g, 100);
  assert.equal(ends.length, 1);
  assert.equal(g.state, 'dead');
  const s = ends[0].summary;
  assert.equal(s.victory, false);
  assert.equal(s.abandoned, false);
  assert.equal(s.floor, 1);
  assert.equal(s.seedLabel, 'test');
  assert.ok(Array.isArray(s.weapons) && s.weapons.length === 1);
  assert.equal(typeof s.ash, 'number');

  const g2 = newGame();
  g2.abandonRun();
  assert.equal(ends.length, 2);
  assert.equal(ends[1].summary.abandoned, true);
  assert.equal(g2.state, 'menu');
  assert.equal(g2.run, null);

  // victory on the last floor
  const g3 = newGame();
  const r3 = g3.run;
  r3.startFloor(5);
  r3.enterRoom(r3.floor.bossRoomId);
  for (let i = 0; i < 1500 && g3.state !== 'victory'; i++) { pickAny(g3); killAll(r3.world); g3.update(DT); }
  assert.equal(g3.state, 'victory');
  assert.equal(ends.at(-1).victory, true);
  assert.ok(!r3.world.props.some((pr) => pr.kind === 'portal'), 'no portal on the final floor');
  ends.off(); deaths.off();
});

test('game: choice queue, reroll, skip, pause, transition fade', () => {
  const g = newGame();
  const events = listen('ui:choice'), states = listen('state:change');
  const log = [];
  const c1 = { kind: 'relic', title: 'A', options: [{ id: 'a', name: 'A', pick: () => log.push('a') }], rerolls: 1 };
  c1.reroll = () => { c1.rerolls--; c1.options = [{ id: 'b', name: 'B', pick: () => log.push('b') }]; };
  const c2 = { kind: 'boon', title: 'B', options: [{ id: 'x', name: 'X', disabled: true, pick: () => log.push('x') }], skip: () => log.push('skip') };
  g.openChoice(c1);
  g.openChoice(c2);
  assert.equal(g.state, 'choice');
  assert.equal(g.choice, c1);
  assert.equal(g.choiceQueue.length, 1);
  c1.reroll();
  assert.equal(events.length, 2);
  assert.equal(c1.options[0].id, 'b');
  c1.options[0].pick();
  c1.options[0].pick(); // double click is ignored
  assert.deepEqual(log, ['b']);
  assert.equal(g.choice, c2);
  c2.options[0].pick(); // disabled
  assert.equal(g.choice, c2);
  c2.skip();
  assert.deepEqual(log, ['b', 'skip']);
  assert.equal(g.state, 'playing');

  g.input.press('pause'); g.update(DT);
  assert.equal(g.state, 'paused');
  const t0 = g.run.time;
  g.update(DT);
  assert.equal(g.run.time, t0);
  g.input.press('pause'); g.update(DT);
  assert.equal(g.state, 'playing');

  let ran = 0;
  g.transition(() => ran++, 0.4);
  assert.equal(g.state, 'transition');
  steps(g, 6);
  assert.ok(g.fade > 0.3 && g.fade < 1 && ran === 0);
  steps(g, 8);
  assert.equal(ran, 1);
  steps(g, 12);
  assert.equal(g.state, 'playing');
  assert.equal(g.fade, 0);
  assert.ok(states.every((s) => s.from !== s.to));
  events.off(); states.off();
});

test('fallback floor is a valid §4 floor', () => {
  const f = generateFallbackFloor({ index: 2, biome: BIOMES.fungal, seed: 42 });
  assert.equal(f.rooms[f.startRoomId].type, 'start');
  assert.equal(f.rooms[f.bossRoomId].type, 'boss');
  f.rooms.forEach((r, i) => {
    assert.equal(r.id, i);
    assert.equal(r.tiles.length, r.w * r.h);
    for (const dir in r.doors) {
      const d = r.doors[dir];
      const opp = { n: 's', s: 'n', e: 'w', w: 'e' }[dir];
      assert.equal(f.rooms[d.to].doors[opp].to, r.id);
      assert.equal(r.tiles[d.ty * r.w + d.tx], TILE.DOOR);
    }
    for (const wave of r.spawns) for (const e of wave.entries) assert.equal(r.tiles[e.ty * r.w + e.tx], TILE.FLOOR);
  });
  assert.equal(f.rooms[f.bossRoomId].spawns[0].entries[0].id, BIOMES.fungal.boss);
});

test('sim: a --god bot run of ≥ 60 s on the fallback floor runs without exceptions', async () => {
  console.warn = quiet;
  const r = await simulate({ seconds: 70, god: true, quiet: true, fallback: true, seed: 'ci' });
  assert.notEqual(r.outcome, 'crash', r.crash || '');
  assert.ok(r.simSeconds >= 60 || r.outcome === 'victory', `outcome ${r.outcome} after ${r.simSeconds}s`);
  assert.equal(r.errors, 0, r.errorSamples.join('\n'));
  assert.ok(r.stats.kills > 0 && r.stats.roomsCleared > 0);
});
