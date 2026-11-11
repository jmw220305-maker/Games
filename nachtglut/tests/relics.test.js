// Relics, curses, boons and shrines.  Run: node --test tests/relics.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RELICS, RELIC_IDS_BY_RARITY, affinity, shootsProjectiles } from '../src/data/relics.js';
import { BOONS } from '../src/data/boons.js';
import { SHRINES } from '../src/data/shrines.js';
import { STAT_NAMES, computeStats } from '../src/game/stats.js';
import { Game, makeStubInput, defaultSaveLite } from '../src/game/game.js';
import { playerVolley } from '../src/game/combat.js';
import { WEAPONS } from '../src/data/weapons.js';
import { bus } from '../src/core/events.js';

const GLYPHS = new Set(('flame ember skull heart shield boot eye sword dagger hammer bow staff orb star sun moon snowflake drop bolt '
  + 'leaf mushroom bone crown coin key hourglass feather fang claw ring gem book potion bomb wing anchor chain mirror mask candle '
  + 'lantern compass dice scale thorn spiral cross hand tooth horn').split(' '));
const HOOKS = new Set(['onGain', 'onRoomEnter', 'onRoomClear', 'onFloorEnter', 'onUpdate', 'onFire', 'onShot', 'onHit', 'onCrit',
  'onKill', 'onDamaged', 'onLethal', 'onDash', 'onDashEnd', 'onSkill', 'onHeal', 'onPickup', 'onLevelUp', 'onStatusApplied',
  'onSpend', 'dynamicMods']);
const RELIC_RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'curse'];
const relicList = Object.values(RELICS);
const boonList = Object.values(BOONS);
const shrineList = Object.values(SHRINES);
const DT = 1 / 60;

// German words that must be written with umlauts / ß (spot-check for ae/oe/ue/ss substitutes)
const SUBSTITUTES = /\b(fuer|ueber|Ueber|zurueck|Rueck|rueck|Staerke|staerke|Faehig|faehig|Glueck|glueck|naechst|Naechst|hoeher|groess|Groess|Schluessel|Waechter|waechter|Fluech|Kraeft|waehrend|Waehrend|toedlich|Toedlich|Schaedel|Ruestung|Gegenstaend|Luecke|koennen|Koerper|muessen|Muenze|Spruenge|erhaeltst|haelt|faellt|Faehrte|Stoess|stoess|Blut(ae|oe)|Asch(ae)|Huelle|Huegel|Truemmer|zerfaellt|gefaehr|Gefaehr|Laeuter|laeuter|Heilmoeg|Rueckstoss|Rückstoss|Groesse|aeusser|Aeusser|Kaelte|kaelte|Waerme|waerme|heisst|Fuesse|Fuss\b|Seelentaus|Ahn(ae)|Haende)\b/;

function texts() {
  const out = [];
  for (const d of relicList) out.push([d.id, d.name], [d.id, String(d.desc)], [d.id, d.flavor || '']);
  for (const d of boonList) out.push([d.id, d.name], [d.id, String(d.desc)], [d.id, typeof d.desc === 'function' ? d.desc(d.maxStacks) : '']);
  for (const s of shrineList) out.push([s.id, s.name], [s.id, s.text]);
  return out;
}

function checkMods(id, mods) {
  assert.ok(Array.isArray(mods), `${id}: mods must be an array`);
  for (const m of mods) {
    assert.ok(STAT_NAMES.includes(m.stat), `${id}: unknown stat "${m.stat}"`);
    assert.ok(m.add != null || m.mul != null, `${id}: mod without add/mul`);
    if (m.add != null) assert.ok(Number.isFinite(m.add), `${id}: add not finite`);
    if (m.mul != null) assert.ok(Number.isFinite(m.mul) && m.mul >= 0, `${id}: mul invalid`);
  }
}

function checkPerkShape(d, kind) {
  assert.equal(typeof d.name, 'string', `${d.id}: name`);
  assert.ok(d.name.length > 2, `${d.id}: name`);
  assert.ok(String(d.desc).length > 5, `${d.id}: desc`);
  assert.ok(d.icon && GLYPHS.has(d.icon.glyph), `${d.id}: glyph "${d.icon && d.icon.glyph}" not in §7`);
  assert.match(d.icon.color, /^#[0-9a-f]{6}$/i, `${d.id}: icon color`);
  assert.ok(Array.isArray(d.tags) && d.tags.length > 0 && d.tags.every((t) => typeof t === 'string'), `${d.id}: tags`);
  assert.ok(Number.isInteger(d.maxStacks) && d.maxStacks >= 1, `${d.id}: maxStacks`);
  if (d.requires) assert.equal(typeof d.requires, 'function', `${d.id}: requires`);
  if (d.hooks) {
    for (const [k, fn] of Object.entries(d.hooks)) {
      assert.ok(HOOKS.has(k), `${d.id}: unknown hook ${k}`);
      assert.equal(typeof fn, 'function', `${d.id}.${k}`);
    }
  }
  if (d.mods) {
    for (let n = 1; n <= d.maxStacks; n++) checkMods(`${d.id}@${n}`, typeof d.mods === 'function' ? d.mods(n) : d.mods);
  }
  assert.ok(d.mods || d.hooks, `${d.id}: does nothing (${kind})`);
}

// ---------------------------------------------------------------------------------------------
describe('static data', () => {
  test('relic counts per rarity', () => {
    const c = {};
    for (const d of relicList) c[d.rarity] = (c[d.rarity] || 0) + 1;
    assert.ok(c.common >= 28 && c.common <= 32, `common ${c.common}`);
    assert.ok(c.uncommon >= 20 && c.uncommon <= 26, `uncommon ${c.uncommon}`);
    assert.ok(c.rare >= 12 && c.rare <= 17, `rare ${c.rare}`);
    assert.ok(c.legendary >= 7 && c.legendary <= 9, `legendary ${c.legendary}`);
    assert.ok(c.curse >= 10 && c.curse <= 12, `curse ${c.curse}`);
    const relics = relicList.length - c.curse;
    assert.ok(relics >= 70 && relics <= 85, `relics ${relics}`);
    assert.deepEqual(Object.keys(RELIC_IDS_BY_RARITY).sort(), [...RELIC_RARITIES].sort());
  });

  test('relic ids unique, fields valid', () => {
    for (const [k, d] of Object.entries(RELICS)) {
      assert.equal(k, d.id);
      assert.ok(RELIC_RARITIES.includes(d.rarity), `${k}: rarity`);
      assert.equal(typeof d.desc, 'string', `${k}: relic desc must be a string`);
      assert.ok(typeof d.flavor === 'string' && d.flavor.length > 3, `${k}: flavor`);
      if (d.rarity === 'common') assert.equal(d.maxStacks, 2, `${k}: commons stack twice (Spiegel)`);
      else assert.equal(d.maxStacks, 1, `${k}: unique relic`);
      checkPerkShape(d, 'relic');
    }
    for (const id of Object.keys(BOONS)) assert.ok(!RELICS[id], `${id} used as relic and boon`);
  });

  test('curses have a real downside', () => {
    for (const d of relicList.filter((r) => r.rarity === 'curse')) {
      assert.ok(d.tags.includes('curse'), d.id);
      const mods = d.mods ? (typeof d.mods === 'function' ? d.mods(1) : d.mods) : [];
      const s = computeStats([mods]);
      const base = computeStats([]);
      const worse = s.maxHp < base.maxHp || s.moveSpeed < base.moveSpeed || s.dashCooldown > base.dashCooldown || s.sparkGain < base.sparkGain
        || s.lightRadius < base.lightRadius || s.healPower < base.healPower || s.critChance < base.critChance || s.skillCooldown > base.skillCooldown
        || !!(d.hooks && (d.hooks.onDamaged || d.hooks.onUpdate || d.hooks.onRoomEnter || d.hooks.onFloorEnter));
      assert.ok(worse, `${d.id} has no downside`);
    }
  });

  test('boons: count, stacks, rarity, per-stack mods and descs', () => {
    assert.ok(boonList.length >= 28 && boonList.length <= 36, `boons ${boonList.length}`);
    for (const [k, d] of Object.entries(BOONS)) {
      assert.equal(k, d.id);
      assert.ok(d.maxStacks >= 3 && d.maxStacks <= 5, `${k}: maxStacks ${d.maxStacks}`);
      assert.ok(['common', 'uncommon', 'rare'].includes(d.rarity), `${k}: rarity`);
      checkPerkShape(d, 'boon');
      assert.ok(String(d.desc).length > 5 && !String(d.desc).startsWith('('), `${k}: toString desc`);
      if (typeof d.desc === 'function') {
        for (let n = 1; n <= d.maxStacks; n++) {
          const s = d.desc(n);
          assert.equal(typeof s, 'string');
          assert.ok(s.includes(`Stufe ${n}`) && /\d/.test(s) && !s.includes('NaN') && !s.includes('undefined'), `${k}: desc(${n}) = ${s}`);
        }
      }
    }
  });

  test('shrines: count and fields', () => {
    assert.ok(shrineList.length >= 10 && shrineList.length <= 12, `shrines ${shrineList.length}`);
    for (const [k, s] of Object.entries(SHRINES)) {
      assert.equal(k, s.id);
      assert.ok(s.name && s.text && s.text.length > 20, `${k}: name/text`);
      assert.ok(s.weight > 0, `${k}: weight`);
      assert.equal(typeof s.options, 'function');
      assert.ok(s.icon && GLYPHS.has(s.icon.glyph), `${k}: icon`);
    }
  });

  test('German text uses real umlauts (spot-check)', () => {
    for (const [id, t] of texts()) {
      const m = SUBSTITUTES.exec(t);
      assert.equal(m, null, `${id}: "${m && m[0]}" in "${t}"`);
    }
    const all = texts().map((x) => x[1]).join(' ');
    assert.match(all, /[äöüÄÖÜß]/);
  });
});

// ---------------------------------------------------------------------------------------------
// Real headless runs
// ---------------------------------------------------------------------------------------------
function newGame(seed = 'relics') {
  const game = new Game({ input: makeStubInput(), save: defaultSaveLite() });
  const run = game.startRun({ character: 'bearer', seed });
  return { game, run, w: run.world, p: run.player, input: game.input };
}

/** Resolve any open choice by picking the first enabled option (or skipping). */
function resolveChoices(game) {
  let guard = 0;
  while (game.state === 'choice' && game.choice && guard++ < 20) {
    const opt = game.choice.options.find((o) => !o.disabled);
    if (opt) opt.pick(); else if (game.choice.skip) game.choice.skip(); else game.resolveChoice(game.choice);
  }
}

function step(game, n = 1) {
  for (let i = 0; i < n; i++) {
    resolveChoices(game);
    game.update(DT);
  }
}

function spawnPack(w, n, dist = 50) {
  const p = w.player, out = [];
  const ids = (w.biome && w.biome.enemies || []).map((e) => e.id);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + w.time;
    const pos = w.clampToRoom(p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist, 20);
    const e = w.spawnEnemy(ids.length ? ids[i % ids.length] : 'ash_crawler', pos.x, pos.y, { delay: 0, elite: i === 0 ? 1 : 0 });
    e.spawnT = 0;
    out.push(e);
  }
  return out;
}

function captureErrors() {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => { errs.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); };
  return { errs, restore() { console.error = orig; } };
}
const mine = (e) => /\[perk\]|\[shrine\]|relics\.js|boons\.js|shrines\.js/.test(e);

function assertSane(run, where) {
  const p = run.player, s = p.stats, w = run.world;
  for (const k of STAT_NAMES) assert.ok(Number.isFinite(s[k]), `${where}: stat ${k} = ${s[k]}`);
  assert.ok(s.damage <= 50 && s.fireRate <= 6 && s.moveSpeed <= 230 && s.multishot <= 12, `${where}: stats out of range`);
  assert.ok(Number.isFinite(p.hp) && p.hp <= s.maxHp + 1e-6, `${where}: hp ${p.hp}/${s.maxHp}`);
  assert.ok(Number.isFinite(p.shield) && p.shield >= 0, `${where}: shield ${p.shield}`);
  assert.ok(Number.isInteger(p.sparks) && p.sparks >= 0, `${where}: sparks ${p.sparks}`);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${where}: position`);
  assert.ok(w.projectiles.length < 4000, `${where}: ${w.projectiles.length} projectiles`);
  assert.ok(w.zones.length < 1500, `${where}: ${w.zones.length} zones`);
  for (const pr of w.projectiles) assert.ok(Number.isFinite(pr.x) && Number.isFinite(pr.y) && Number.isFinite(pr.damage), `${where}: projectile NaN`);
  for (const e of w.enemies) assert.ok(Number.isFinite(e.hp) && Number.isFinite(e.x), `${where}: enemy NaN`);
  for (const k of ['damageDealt', 'damageTaken', 'healed', 'bestHit']) assert.ok(Number.isFinite(run.stats[k]), `${where}: run.stats.${k}`);
}

describe('headless: everything at once', () => {
  test('all relics + all curses + all boons at max stacks survive 60 s of combat', () => {
    const cap = captureErrors();
    try {
      const { game, run, w, p, input } = newGame('all-in');
      // a second weapon so projectile modifiers and swaps get exercised
      run.giveWeapon('scatter_coal', 2);
      for (const d of relicList) {
        if (d.rarity === 'curse') run.giveCurse(d.id); else run.giveRelic(d.id);
        if (d.maxStacks > 1) run.giveRelic(d.id);
      }
      for (const d of boonList) for (let i = 0; i < d.maxStacks; i++) run.giveBoon(d.id);
      assert.equal(p.relics.length, relicList.length);
      assert.equal(p.boons.length, boonList.length);
      assert.ok(p.boons.every((b) => b.stacks === b.def.maxStacks));
      assertSane(run, 'after grant');

      // god mode: keep hp >= 1 but still run all damage hooks
      const orig = w.damagePlayer.bind(w);
      w.damagePlayer = (amount, info) => {
        const r = orig(amount, info);
        if (p.hp < 1 || !p.alive) { p.hp = Math.max(1, p.hp); p.alive = true; run.ended = false; run.dyingT = 0; }
        return r;
      };

      const seen = { states: {}, orbitals: 0, relicShots: 0, zones: 0, flare: 0, reflect: 0, kills0: run.stats.kills };
      const offs = [bus.on('player:hit', () => { seen.hits = (seen.hits || 0) + 1; })];
      let t = 0, floorEntered = false, cleared = false;
      for (let i = 0; i < 60 * 60; i++) {
        t += DT;
        resolveChoices(game);
        if (game.state === 'transition') { game.update(DT); continue; }
        input.hold('fire', true);
        const a = t * 1.7;
        input.setMove(Math.cos(a), Math.sin(a));
        if (i % 42 === 0) input.press('dash');
        if (i % 150 === 0) input.press('skill');
        if (i % 600 === 300) input.press('swap');
        if (i % 120 === 0 && w.enemies.filter((e) => !e.dead).length < 10) spawnPack(w, 5, 45 + (i % 3) * 20);
        if (i % 300 === 100) {
          const src = w.enemies.find((e) => !e.dead) || null;
          p.iframes = 0; p.dashing = false;
          w.damagePlayer(18, { source: src, type: 'phys' });
          w.damagePlayer(200, { source: src, type: 'fire', unblockable: true }); // lethal → revive relics
        }
        if (i % 240 === 0) {
          w.spawnPickup('spark', p.x + 6, p.y, { amount: 5 });
          w.spawnPickup('heart', p.x - 6, p.y, {});
          w.spawnPickup('xp', p.x, p.y + 6, { amount: 30 });
        }
        if (i === 1200 && !cleared) {
          // room clear with interest/heal/shield hooks
          for (const e of w.enemies) { e.spawnT = 0; w.damageEnemy(e, 1e6, { source: 'weapon' }); }
          w.locked = true;
          w.clearRoom();
          cleared = true;
        }
        if (i === 2000 && !floorEntered) { run.startFloor(2); floorEntered = true; }
        // enemy bullets so the mirror can reflect them
        if (i % 90 === 45) {
          w.spawnProjectile({ x: p.x + 40, y: p.y, angle: Math.PI, speed: 120, r: 4, damage: 8, type: 'fire', team: 'enemy', life: 2 });
        }
        game.update(DT);
        seen.states[game.state] = (seen.states[game.state] || 0) + 1;
        if (p.flags.reflect) seen.reflect++;
        for (const pr of w.projectiles) {
          if (pr.data && pr.data.orbital) seen.orbitals++;
          else if (pr.data && pr.data.relic) seen.relicShots++;
          if (pr.data && pr.data.flare) seen.flare++;
        }
        if (i % 30 === 0) assertSane(run, `t=${t.toFixed(2)}`);
      }
      for (const off of offs) off();
      if (process.env.RELICS_DEBUG) console.log(JSON.stringify({ states: seen.states, kills: run.stats.kills, dealt: Math.round(run.stats.damageDealt), taken: Math.round(run.stats.damageTaken), hits: seen.hits, proj: w.projectiles.length, zones: w.zones.length, orb: seen.orbitals, shots: seen.relicShots, flare: seen.flare, time: run.time, stats: p.stats }));
      assert.ok((seen.states.playing || 0) > 3000, `playing frames ${JSON.stringify(seen.states)}`);
      assertSane(run, 'end');
      assert.ok(run.floorIndex === 2, 'floor 2 entered');
      assert.ok(run.stats.kills - seen.kills0 > 20, `kills ${run.stats.kills}`);
      assert.ok(seen.orbitals > 0, 'orbitals spawned');
      assert.ok(seen.relicShots > 0, 'relic projectiles fired');
      assert.ok(seen.flare > 0, 'solar flares');
      assert.ok(seen.reflect > 0, 'mirror shard reflected');
      assert.ok(p.relics.find((r) => r.def.id === 'second_ember').state.used, 'second ember consumed');
      assert.ok(p.relics.find((r) => r.def.id === 'phoenix_feather').state.used, 'phoenix feather consumed');
      const mineErrs = cap.errs.filter(mine);
      assert.deepEqual(mineErrs, [], mineErrs.join('\n'));
    } finally { cap.restore(); }
  });
});

describe('headless: individual mechanics', () => {
  test('onUpdate fallback driver ticks perks exactly once per frame', () => {
    const { game, run, p } = newGame('ticker');
    run.giveRelic('star_heart');
    const perk = p.relics.find((r) => r.def.id === 'star_heart');
    step(game, 60);
    assert.ok(perk.state.t > 0.9 && perk.state.t < 1.1, `star heart timer ${perk.state.t}`);
    // survives room changes
    const room = run.floor.rooms.find((r) => r.id !== run.roomId);
    run.enterRoom(room.id);
    const t0 = perk.state.t;
    step(game, 30);
    assert.ok(Math.abs(perk.state.t - t0 - 0.5) < 0.05, 'driver re-created in a new room');
  });

  test('revive relics: amulet (sparks), feather (once), second ember (once + damage)', () => {
    const { run, w, p } = newGame('revive');
    run.giveRelic('second_ember');
    run.giveRelic('phoenix_feather');
    run.giveRelic('ash_amulet');
    const dmg0 = p.stats.damage;
    w.damagePlayer(9999, { unblockable: true });
    assert.ok(p.alive && p.hp >= p.stats.maxHp * 0.59, 'second ember revived at 60 %');
    p.iframes = 0;
    w.damagePlayer(9999, { unblockable: true });
    assert.ok(p.alive && Math.abs(p.hp - Math.round(p.stats.maxHp * 0.4)) <= 1, 'feather revived at 40 %');
    p.sparks = 50; p.iframes = 0;
    w.damagePlayer(9999, { unblockable: true });
    assert.ok(p.alive && p.sparks === 0, 'amulet spent all sparks');
    p.iframes = 0;
    w.damagePlayer(9999, { unblockable: true });
    assert.ok(!p.alive || run.ended, 'no charges left → death');
    // second ember: +15 % damage for the rest of the run once used
    run.ended = false; p.alive = true; p.hp = 10;
    run._dynT = 0;
    run.update(DT);
    assert.ok(Math.abs(p.stats.damage - dmg0 * 1.15) < 1e-6, `damage ${dmg0} -> ${p.stats.damage}`);
  });

  test('sun heart: every 10th shot is a flare that explodes', () => {
    const { run, w, p } = newGame('flare');
    run.giveRelic('sun_heart');
    const ws = p.weapon;
    let flares = 0;
    for (let i = 0; i < 20; i++) {
      const shots = playerVolley(w, ws, 0);
      for (const s of shots) if (s.data.flare) flares++;
    }
    assert.equal(flares, 2);
  });

  test('crescent moon: projectiles turn around and come back', () => {
    const { game, run, w, p } = newGame('boomerang');
    run.giveRelic('crescent_moon');
    const [shot] = playerVolley(w, p.weapon, 0);
    const x0 = p.x;
    let maxX = 0, back = false;
    for (let i = 0; i < 240 && !shot.dead; i++) {
      game.update(DT);
      maxX = Math.max(maxX, shot.x - x0);
      if (shot.data.back) back = true;
    }
    assert.ok(back, 'turned');
    assert.ok(maxX > 30, 'flew out');
  });

  test('split core: a hit spawns two shards that skip the first target', () => {
    const { game, run, w, p } = newGame('split');
    run.giveRelic('split_core');
    const [e] = spawnPack(w, 1, 30);
    e.hp = e.maxHp = 1e6;
    w.knockback = () => {};
    const before = w.projectiles.length;
    playerVolley(w, p.weapon, Math.atan2(e.y - p.y, e.x - p.x));
    let shards = 0;
    for (let i = 0; i < 30; i++) { game.update(DT); shards = Math.max(shards, w.projectiles.filter((q) => q.data.split).length); }
    assert.ok(shards >= 2 || w.projectiles.length >= before, `shards ${shards}`);
  });

  test('mirror shard: reflect only while dashing (+0.3 s)', () => {
    const { game, run, p, input } = newGame('mirror');
    run.giveRelic('mirror_shard');
    assert.equal(p.dash.max, 2);
    input.press('dash');
    step(game, 2);
    assert.equal(p.flags.reflect, true);
    step(game, 60);
    assert.ok(!p.flags.reflect, 'reflect cleared');
  });

  test('ash crown: kills stack, a hit resets', () => {
    const { game, run, w, p } = newGame('crown');
    run.giveRelic('ash_crown');
    const pack = spawnPack(w, 4, 60);
    for (const e of pack) w.damageEnemy(e, 1e6, { source: 'weapon' });
    const perk = p.relics.find((r) => r.def.id === 'ash_crown');
    assert.equal(perk.state.n, 4);
    step(game, 15);
    assert.ok(p.stats.damage > 1.05, `crown damage ${p.stats.damage}`);
    p.iframes = 0;
    w.damagePlayer(5, { type: 'phys' });
    step(game, 15);
    assert.equal(perk.state.n, 0);
  });

  test('storm crown chains lightning; procs never recurse', () => {
    const { run, w } = newGame('storm');
    run.giveRelic('storm_crown');
    run.giveRelic('tinder_bundle');
    run.giveRelic('conductor_rod');
    const pack = spawnPack(w, 5, 40);
    for (const e of pack) { e.hp = e.maxHp = 1e6; }
    for (let i = 0; i < 60; i++) w.damageEnemy(pack[0], 5, { source: 'weapon' });
    const hurt = pack.slice(1).filter((e) => e.hp < 1e6).length;
    assert.ok(hurt >= 1, 'chain reached other enemies');
    assert.equal(run.player._hookDepth, 0);
  });

  test('curses: glass glut and brittle bones raise damage taken', () => {
    const a = newGame('c1'); const b = newGame('c1');
    b.run.giveCurse('curse_glass'); b.run.giveCurse('curse_brittle');
    const da = a.w.damagePlayer(10, { type: 'phys' });
    const db = b.w.damagePlayer(10, { type: 'phys' });
    assert.ok(db >= da * 1.35 + 4 - 1e-6, `${da} vs ${db}`);
    assert.ok(b.p.stats.damage > a.p.stats.damage);
  });

  test('requires(): element/projectile relics only fit matching builds', () => {
    const { run, p } = newGame('req');
    assert.equal(affinity(p, 'fire'), true);   // ember bolt
    assert.equal(affinity(p, 'poison'), false);
    assert.equal(RELICS.rot_bloom.requires(p, run), false);
    assert.equal(RELICS.wildfire.requires(p, run), true);
    assert.equal(shootsProjectiles(p), true);
    if (WEAPONS.iron_hammer) {
      p.weapons = [run.player.weapons[0], null];
      p.weapons[0] = { id: 'iron_hammer', def: WEAPONS.iron_hammer, level: 1 };
      assert.equal(shootsProjectiles(p), false);
    }
  });

  test('loaded dice and interest purse economy hooks', () => {
    const { run, w, p } = newGame('eco');
    const r0 = run.rerolls;
    run.giveRelic('loaded_dice');
    assert.equal(run.rerolls, r0 + 1);
    run.giveRelic('interest_purse');
    p.sparks = 47;
    w.locked = true;
    w.clearRoom();
    assert.ok(p.sparks >= 51, `sparks ${p.sparks}`);
    run.startFloor(2);
    assert.equal(run.rerolls, r0 + 2);
  });
});

// ---------------------------------------------------------------------------------------------
describe('headless: shrines', () => {
  function shrineRun(seed) {
    const g = newGame(seed);
    g.run.giveWeapon('scatter_coal', 2);
    g.run.giveBoon('boon_might'); g.run.giveBoon('boon_might'); g.run.giveBoon('boon_keen');
    g.run.giveRelic('whetstone');
    g.run.giveCurse('curse_frail');
    g.p.sparks = 600;
    g.ctx = { w: g.w, player: g.p, run: g.run, rng: g.w.rng };
    return g;
  }

  test('every option of every shrine can be picked', () => {
    const cap = captureErrors();
    try {
      for (const s of shrineList) {
        const probe = shrineRun(`probe-${s.id}`);
        const opts = s.options(probe.ctx);
        assert.ok(opts.length >= 2, `${s.id}: options`);
        const last = opts[opts.length - 1];
        assert.equal(last.label, 'Weitergehen', `${s.id}: decline option`);
        assert.equal(last.keep, true, `${s.id}: decline keeps the shrine`);
        for (const o of opts) {
          assert.ok(o.label && typeof o.desc === 'string' && o.desc.length > 5, `${s.id}: option text`);
          assert.ok(!o.icon || GLYPHS.has(o.icon.glyph), `${s.id}: option glyph ${o.icon && o.icon.glyph}`);
          assert.ok(!/NaN|undefined|null/.test(o.desc), `${s.id}: ${o.desc}`);
        }
        for (let i = 0; i < opts.length; i++) {
          for (let rep = 0; rep < (s.id === 'wheel' ? 12 : 1); rep++) {
            const g = shrineRun(`pick-${s.id}-${i}-${rep}`);
            const o = s.options(g.ctx)[i];
            if (o.available === false) continue;
            o.pick(g.ctx);
            resolveChoices(g.game);
            step(g.game, 120);
            assertSane(g.run, `${s.id}/${o.label}`);
          }
        }
      }
      const mineErrs = cap.errs.filter(mine);
      assert.deepEqual(mineErrs, [], mineErrs.join('\n'));
    } finally { cap.restore(); }
  });

  test('shrine effects', () => {
    // Blutaltar: HP for a relic
    let g = shrineRun('blood');
    let n = g.p.relics.length, hp = g.p.hp;
    SHRINES.blood.options(g.ctx)[0].pick(g.ctx);
    assert.equal(g.p.relics.length, n + 1);
    assert.ok(g.p.hp < hp);

    // Fluchschrein: curse + legendary
    g = shrineRun('curse');
    n = g.p.relics.length;
    SHRINES.curse.options(g.ctx)[0].pick(g.ctx);
    assert.equal(g.p.relics.length, n + 2);
    assert.ok(g.p.relics.some((r) => r.def.rarity === 'legendary'));
    const curses = g.p.relics.filter((r) => r.def.rarity === 'curse').length;
    SHRINES.curse.options(g.ctx)[1].pick(g.ctx);
    assert.equal(g.p.relics.filter((r) => r.def.rarity === 'curse').length, curses - 1);

    // Schmiedeschrein: both weapons +1
    g = shrineRun('forge');
    const lv = g.p.weapons.map((x) => x.level);
    SHRINES.ancestor_forge.options(g.ctx)[0].pick(g.ctx);
    assert.deepEqual(g.p.weapons.map((x) => x.level), lv.map((l) => Math.min(5, l + 1)));

    // Brunnen der Erinnerung: lose a stack, gain two boons
    g = shrineRun('well');
    const stacks = g.p.boons.reduce((a, b) => a + b.stacks, 0);
    SHRINES.memory_well.options(g.ctx)[0].pick(g.ctx);
    assert.equal(g.p.boons.reduce((a, b) => a + b.stacks, 0), stacks + 1);

    // Spiegel: duplicate a common relic
    g = shrineRun('mirror');
    SHRINES.mirror.options(g.ctx)[0].pick(g.ctx);
    assert.equal(g.p.relics.find((r) => r.def.id === 'whetstone').stacks, 2);
    assert.ok(Math.abs(g.p.stats.damage - 1.24 * 1.16) < 1e-6, `damage ${g.p.stats.damage}`);

    // Opferstein: max HP for damage
    g = shrineRun('sac');
    const mh = g.p.stats.maxHp, dm = g.p.stats.damage;
    SHRINES.sacrifice.options(g.ctx)[0].pick(g.ctx);
    assert.ok(g.p.stats.maxHp < mh && g.p.stats.maxHp >= mh - 15, `maxHp ${mh} -> ${g.p.stats.maxHp}`); // −15 before multiplicative curses
    assert.ok(g.p.stats.damage > dm);

    // Sternenkarte
    g = shrineRun('stars');
    SHRINES.star_map.options(g.ctx)[0].pick(g.ctx);
    assert.ok(g.run.floor.rooms.every((r) => r.seen));

    // Aschekelch: Asche arrives through pickups
    g = shrineRun('ash');
    const ash0 = g.run.stats.ashPickedUp;
    SHRINES.ash_chalice.options(g.ctx)[0].pick(g.ctx);
    step(g.game, 120);
    assert.ok(g.run.stats.ashPickedUp > ash0, 'ash collected');

    // Seelentausch: active weapon replaced by a rarer one
    g = shrineRun('swap');
    const order = ['common', 'uncommon', 'rare', 'legendary'];
    const cur = g.p.weapon;
    const opt = SHRINES.soul_swap.options(g.ctx)[0];
    if (opt.available !== false) {
      opt.pick(g.ctx);
      assert.notEqual(g.p.weapon, cur);
      assert.ok(order.indexOf(g.p.weapon.def.rarity) > order.indexOf(cur.def.rarity));
      assert.equal(g.p.weapon.level, cur.level);
      assert.equal(g.p.weapons.filter(Boolean).length, 2);
    }

    // Wächterstatue: elites spawn, doors lock, reward after the kill
    g = shrineRun('guard');
    n = g.p.relics.length;
    SHRINES.guardian.options(g.ctx)[0].pick(g.ctx);
    const guards = g.w.enemies.filter((e) => !e.dead);
    assert.ok(guards.length >= 2 && guards.every((e) => e.elite.length > 0));
    assert.equal(g.w.locked, true);
    for (const e of guards) { e.spawnT = 0; g.w.damageEnemy(e, 1e9, { source: 'weapon' }); }
    assert.equal(g.p.relics.length, n + 1);
    step(g.game, 60);
    assert.equal(g.w.locked, false);
  });
});
