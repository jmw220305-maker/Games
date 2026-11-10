// Weapons + characters tests (owner: weapons). Run: node --test tests/weapons.test.js
// Static validation of src/data/weapons.js + src/data/characters.js, then headless runs on the real Game:
// every weapon at level 1 and 5 fires for 10 s at dummies (prints a DPS table), every character skill is used once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/data/weapons.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TILE, DAMAGE_TYPES, RARITIES } from '../src/game/constants.js';
import { STAT_NAMES } from '../src/game/stats.js';
import { makeWeaponState } from '../src/game/combat.js';
import { ENEMIES, AI } from '../src/game/registry.js';
import { bus } from '../src/core/events.js';

const DT = 1 / 60;

const WEAPON_IDS = ['ember_bolt', 'scatter_coal', 'flame_lance', 'spark_chain', 'magma_mortar', 'frost_needle', 'shadow_daggers', 'sun_disc',
  'spore_launcher', 'rift_orb', 'iron_hammer', 'glaive_orbit', 'soul_siphon', 'star_bow', 'ice_staff'];
const CHARACTER_IDS = ['bearer', 'shadow', 'warden', 'weaver', 'revenant'];
const GLYPHS = new Set(('flame ember skull heart shield boot eye sword dagger hammer bow staff orb star sun moon snowflake drop bolt leaf mushroom '
  + 'bone crown coin key hourglass feather fang claw ring gem book potion bomb wing anchor chain mirror mask candle lantern compass dice scale '
  + 'thorn spiral cross hand tooth horn').split(' '));
const PROJ_SPRITES = new Set(['proj_orb', 'proj_bolt', 'proj_shard', 'proj_dagger', 'proj_disc', 'proj_spore', 'proj_blob', 'proj_needle',
  'proj_wave', 'proj_star', 'proj_skull', 'proj_beam', 'proj_hammer', 'proj_blade']);
const HEX = /^#[0-9a-f]{6}$/i;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

// ---------------------------------------------------------------------------------------------
// Static validation
// ---------------------------------------------------------------------------------------------
test('weapons: roster is exactly the 15 authoritative ids', () => {
  assert.deepEqual(Object.keys(WEAPONS).sort(), [...WEAPON_IDS].sort());
});

test('weapons: definitions are well-formed', () => {
  for (const id of WEAPON_IDS) {
    const d = WEAPONS[id];
    const where = `weapon ${id}`;
    assert.equal(d.id, id, where);
    assert.ok(nonEmpty(d.name) && nonEmpty(d.desc), `${where}: name/desc`);
    assert.ok(RARITIES.includes(d.rarity) && d.rarity !== 'curse', `${where}: rarity`);
    assert.ok(DAMAGE_TYPES.includes(d.type), `${where}: type`);
    assert.ok(d.icon && GLYPHS.has(d.icon.glyph) && HEX.test(d.icon.color), `${where}: icon`);
    assert.ok(PROJ_SPRITES.has(d.projSprite), `${where}: projSprite`);
    assert.ok(HEX.test(d.color), `${where}: color`);
    assert.ok(Array.isArray(d.tags) && d.tags.length > 0 && d.tags.every(nonEmpty), `${where}: tags`);
    assert.ok(d.base && typeof d.base === 'object', `${where}: base`);
    for (const [k, v] of Object.entries(d.base)) assert.ok(Number.isFinite(v), `${where}: base.${k} must be a finite number`);
    assert.ok(d.base.range > 0, `${where}: base.range (auto-aim uses it)`);
    if (d.manual) assert.equal(typeof d.update, 'function', `${where}: manual weapons need update()`);
    else assert.equal(typeof d.fire, 'function', `${where}: fire()`);
    assert.equal(d.levels.length, 4, `${where}: exactly 4 levels`);
    for (const lv of d.levels) {
      assert.ok(nonEmpty(lv.desc), `${where}: level desc`);
      assert.ok(lv.mods && Object.keys(lv.mods).length > 0, `${where}: level mods`);
      for (const [k, v] of Object.entries(lv.mods)) {
        assert.ok(Number.isFinite(v), `${where}: level mod ${k}`);
        const key = k[0] === '+' ? k.slice(1) : k;
        assert.ok(key in d.base, `${where}: level mod ${k} refers to unknown base stat`);
        if (k[0] !== '+') assert.ok(v > 0, `${where}: multiplier ${k} must be positive`);
      }
    }
    for (let lvl = 1; lvl <= 5; lvl++) {
      const ws = makeWeaponState(d, lvl);
      for (const [k, v] of Object.entries(ws.stats)) assert.ok(Number.isFinite(v), `${where} L${lvl}: stats.${k}`);
    }
  }
});

test('characters: roster, fields, starting weapons, skills, passives', () => {
  assert.deepEqual(Object.keys(CHARACTERS).sort(), [...CHARACTER_IDS].sort());
  const starts = { bearer: 'ember_bolt', shadow: 'shadow_daggers', warden: 'iron_hammer', weaver: 'ice_staff', revenant: 'soul_siphon' };
  for (const id of CHARACTER_IDS) {
    const c = CHARACTERS[id];
    const where = `character ${id}`;
    assert.equal(c.id, id, where);
    assert.ok(nonEmpty(c.name) && nonEmpty(c.title) && nonEmpty(c.desc), `${where}: texts`);
    assert.equal(c.sprite, `char_${id}`, `${where}: sprite`);
    assert.ok(HEX.test(c.color), `${where}: color`);
    assert.ok(Array.isArray(c.baseMods), `${where}: baseMods`);
    for (const m of c.baseMods) {
      assert.ok(STAT_NAMES.includes(m.stat), `${where}: baseMods stat ${m.stat}`);
      assert.ok(Number.isFinite(m.add ?? m.mul), `${where}: baseMods value`);
    }
    assert.equal(c.weapon, starts[id], `${where}: starting weapon`);
    assert.ok(WEAPONS[c.weapon], `${where}: starting weapon exists`);
    const sk = c.skill;
    assert.ok(sk && nonEmpty(sk.id) && nonEmpty(sk.name) && nonEmpty(sk.desc), `${where}: skill texts`);
    assert.ok(sk.cooldown >= 7 && sk.cooldown <= 14, `${where}: skill cooldown 7..14`);
    assert.ok(sk.icon && GLYPHS.has(sk.icon.glyph) && HEX.test(sk.icon.color), `${where}: skill icon`);
    assert.equal(typeof sk.use, 'function', `${where}: skill.use`);
    const pa = c.passive;
    assert.ok(pa && nonEmpty(pa.name) && nonEmpty(pa.desc) && pa.hooks, `${where}: passive`);
    for (const fn of Object.values(pa.hooks)) assert.equal(typeof fn, 'function', `${where}: passive hook`);
    assert.ok(c.unlock && nonEmpty(c.unlock.text), `${where}: unlock.text`);
    assert.equal(!!c.unlock.default, id === 'bearer', `${where}: only bearer is unlocked by default`);
  }
});

// ---------------------------------------------------------------------------------------------
// Headless harness (real Game)
// ---------------------------------------------------------------------------------------------
ENEMIES.wtest_dummy = {
  id: 'wtest_dummy', name: 'Übungspuppe', desc: '', biome: 'ash', hp: 1e7, speed: 0, damage: 0, r: 6, mass: 0,
  xp: 0, sparks: [0, 0], sprite: 'wtest_dummy', color: '#888888', ai: 'wtest_none', aiParams: {},
};
AI.wtest_none = { update() {} };

function makeRoom(w, h) {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? TILE.WALL : TILE.FLOOR;
  return { id: -1, gx: 40, gy: 40, type: 'combat', depth: 1, w, h, tiles, doors: {}, spawns: [], props: [], variant: 0, visited: false, seen: false, cleared: true };
}

function enterRoom(g, room) {
  const run = g.run;
  room.id = run.floor.rooms.length;
  run.floor.rooms.push(room);
  run.enterRoom(room.id);
  return run.world;
}

function dummy(w, x, y, opts = {}) {
  const e = w.spawnEnemy('wtest_dummy', x, y, { delay: 0 });
  e.spawnT = 0; e.hp = e.maxHp = 1e7; e.damage = 0; e.contact = false; e.mass = opts.mass ?? 0; e.ai = { update() {} };
  return e;
}

/** Captures console.error while `fn` runs (the core logs content exceptions instead of throwing). */
async function captureErrors(fn) {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => { errs.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); };
  try { await fn(); } finally { console.error = orig; }
  return errs;
}

let gameMod = null;
async function newGame(character = 'bearer') {
  gameMod = gameMod || await import('../src/game/game.js');
  const g = new gameMod.Game({ input: gameMod.makeStubInput() });
  g.startRun({ seed: 'weapons-test', character });
  g.save.settings.autoAim = true;
  return g;
}

/** Neutral player (no character mods / passive / perks) holding `wid` at `level`. */
function equip(g, wid, level) {
  const p = g.run.player;
  p.mods.set('character', []);
  p.mods.set('meta', []);
  p.passive = null;
  p.relics = []; p.boons = [];
  p.recalc();
  p.hp = p.stats.maxHp; p.flags = {}; p.statuses = {};
  const old = p.weapon;
  if (old) p._unequip(old);
  const ws = makeWeaponState(WEAPONS[wid], level);
  p.weapons = [ws, null]; p.weaponIndex = 0;
  p._equip(ws);
  return ws;
}

const SINGLE_DIST = { iron_hammer: 30 };

/** Sustained damage per second over `seconds` with the trigger held. mode: 'single' | 'cluster'. */
function measure(g, wid, level, mode, seconds = 10) {
  const w = enterRoom(g, makeRoom(36, 24));
  const ws = equip(g, wid, level);
  const p = g.run.player;
  const dist = SINGLE_DIST[wid] ?? 56;
  const dummies = [];
  if (mode === 'single') dummies.push(dummy(w, p.x + dist, p.y));
  else {
    const near = Math.min(dist, 40);
    for (let i = 0; i < 10; i++) {
      const ring = i < 4 ? 0 : i < 7 ? 1 : 2, idx = i < 4 ? i : i < 7 ? i - 4 : i - 7, cnt = ring === 0 ? 4 : 3;
      const a = (idx / (cnt - 1) - 0.5) * (ring === 0 ? 1.1 : 0.8);
      const r = near + ring * 22;
      dummies.push(dummy(w, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r));
    }
  }
  const input = g.input;
  input.hold('fire', true);
  let fires = 0;
  const off = bus.on('weapon:fire', (e) => { if (e.id === wid) fires++; });
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    g.update(DT);
    p.hp = p.stats.maxHp;
  }
  off();
  input.hold('fire', false);
  const dmg = dummies.reduce((s, e) => s + (e.maxHp - Math.max(0, e.hp)), 0);
  return { dps: dmg / seconds, fires, ws };
}

test('weapons: every weapon fires on the real Game (L1 + L5, single target + cluster); prints DPS table', async () => {
  const g = await newGame('bearer');
  const rows = [];
  const errs = await captureErrors(() => {
    for (const id of WEAPON_IDS) {
      const r = { id };
      for (const lvl of [1, 5]) {
        const s = measure(g, id, lvl, 'single');
        const c = measure(g, id, lvl, 'cluster');
        r[`s${lvl}`] = s.dps; r[`c${lvl}`] = c.dps; r[`f${lvl}`] = s.fires;
      }
      rows.push(r);
    }
  });
  assert.deepEqual(errs, [], 'no content exceptions');
  const f = (v) => v.toFixed(1).padStart(7);
  const lines = ['', 'Waffe            Ziel L1  Ziel L5  ×L5   Gruppe L1  Gruppe L5   (DPS, 10 s, Grundwerte)'];
  for (const r of rows) {
    lines.push(`${r.id.padEnd(16)} ${f(r.s1)}  ${f(r.s5)}  ${(r.s5 / r.s1).toFixed(2).padStart(4)}  ${f(r.c1)}    ${f(r.c5)}`);
  }
  console.log(lines.join('\n'));
  for (const r of rows) {
    assert.ok(r.s1 > 0 && r.s5 > 0 && r.c1 > 0 && r.c5 > 0, `${r.id}: deals damage`);
    assert.ok(r.f1 > 0, `${r.id}: emits weapon:fire`);
    assert.ok(r.s1 >= 12 && r.s1 <= 36, `${r.id}: L1 single-target DPS ${r.s1.toFixed(1)} within sane band`);
    assert.ok(r.s5 > r.s1 * 1.4, `${r.id}: levels add power (L5 ${r.s5.toFixed(1)} vs L1 ${r.s1.toFixed(1)})`);
  }
});

test('weapons: swapping / room changes clean up persistent attacks', async () => {
  const g = await newGame('bearer');
  const errs = await captureErrors(() => {
    const w = enterRoom(g, makeRoom(30, 20));
    const ws = equip(g, 'glaive_orbit', 5);
    const p = g.run.player;
    dummy(w, p.x + 40, p.y);
    for (let i = 0; i < 30; i++) g.update(DT);
    assert.equal(w.projectiles.filter((q) => q.weaponId === 'glaive_orbit' && !q.dead).length, 5, 'L5: 5 blades');
    p._unequip(ws);
    g.update(DT);
    assert.equal(w.projectiles.filter((q) => q.weaponId === 'glaive_orbit' && !q.dead).length, 0, 'blades removed on unequip');
    p._equip(ws);
    const w2 = enterRoom(g, makeRoom(30, 20));
    for (let i = 0; i < 5; i++) g.update(DT);
    assert.equal(w2.projectiles.filter((q) => q.weaponId === 'glaive_orbit' && !q.dead).length, 5, 'blades respawn after a room change');
  });
  assert.deepEqual(errs, []);
});

// ---------------------------------------------------------------------------------------------
// Characters on the real Game
// ---------------------------------------------------------------------------------------------
test('characters: each skill hits enemies around the player and leaves no stuck state', async () => {
  for (const id of CHARACTER_IDS) {
    const g = await newGame(id);
    const run = g.run, p = run.player;
    assert.equal(p.weapon && p.weapon.id, CHARACTERS[id].weapon, `${id}: starts with its weapon`);
    let errs = await captureErrors(() => {
      const w = enterRoom(g, makeRoom(30, 20));
      const ds = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ds.push(dummy(w, p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40, { mass: 1 }));
      }
      // aim at the first dummy, then use the skill
      g.input.press('skill');
      g.update(DT);
      assert.ok(p.skill.cd > 0, `${id}: skill went on cooldown`);
      for (let i = 0; i < 60 * 5; i++) g.update(DT);
      const dealt = ds.reduce((s, e) => s + (e.maxHp - e.hp), 0);
      assert.ok(dealt > 0, `${id}: skill dealt damage (${dealt})`);
      assert.ok(!p.flags.reflect, `${id}: reflect flag cleared`);
      assert.ok(!p.mods.has('skill:bulwark') && !p.mods.has('skill:shadow_step') || p.flags.shadowCrits > 0, `${id}: temporary mods cleared`);
    });
    assert.deepEqual(errs, [], `${id}: no exceptions`);
    // passive runs during normal fighting
    errs = await captureErrors(() => {
      const w = enterRoom(g, makeRoom(30, 20));
      for (let i = 0; i < 5; i++) dummy(w, p.x + 50, p.y - 20 + i * 10);
      g.input.hold('fire', true);
      for (let i = 0; i < 60 * 3; i++) { if (i % 40 === 0) g.input.press('dash'); g.update(DT); }
      g.input.hold('fire', false);
    });
    assert.deepEqual(errs, [], `${id}: passive/weapon run without exceptions`);
  }
});

test('characters: Bollwerk reflects for its duration and resets on expiry and on room change', async () => {
  const g = await newGame('warden');
  const p = g.run.player;
  enterRoom(g, makeRoom(30, 20));
  g.input.press('skill');
  g.update(DT);
  assert.equal(p.flags.reflect, true);
  const armor = p.stats.armor;
  for (let i = 0; i < 60; i++) g.update(DT);
  assert.equal(p.flags.reflect, true, 'still active after 1 s');
  for (let i = 0; i < 60 * 3; i++) g.update(DT);
  assert.ok(!p.flags.reflect, 'expired');
  assert.ok(p.stats.armor < armor, 'armor bonus removed');
  // room change mid-effect
  p.skill.cd = 0;
  g.input.press('skill');
  g.update(DT);
  assert.equal(p.flags.reflect, true);
  enterRoom(g, makeRoom(30, 20));
  assert.ok(!p.flags.reflect, 'cleared by a room change');
});

test('characters: Schattenschritt blinks, grants 3 crits, then crit chance returns to normal', async () => {
  const g = await newGame('shadow');
  const p = g.run.player;
  const w = enterRoom(g, makeRoom(34, 20));
  dummy(w, p.x + 140, p.y);
  const x0 = p.x;
  for (let i = 0; i < 10; i++) g.update(DT); // acquire the auto-aim target
  g.input.press('skill');
  g.update(DT);
  assert.ok(p.x > x0 + 40, 'blinked toward the target');
  assert.ok(p.stats.critChance >= 1, 'next hits crit');
  g.input.hold('fire', true);
  for (let i = 0; i < 60 && p.flags.shadowCrits > 0; i++) g.update(DT);
  g.input.hold('fire', false);
  assert.ok(!(p.flags.shadowCrits > 0));
  assert.ok(p.stats.critChance < 1, 'crit chance restored');
});
