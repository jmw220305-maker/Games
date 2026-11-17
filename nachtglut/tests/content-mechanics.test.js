// Content for the §12 status mechanics (Blutung/Aderlass, Gifteruption, Entladung, Vampirismus, Blutkugeln, Blutrausch):
// relics, curses, boons, weapons, shrines, enemies, the Aschenkind and achievements.  Run: node --test tests/content-mechanics.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RELICS, bleedAffinity, bloodAffinity } from '../src/data/relics.js';
import { BOONS } from '../src/data/boons.js';
import { SHRINES } from '../src/data/shrines.js';
import { WEAPONS } from '../src/data/weapons.js';
import { CHARACTERS } from '../src/data/characters.js';
import { ENEMIES, AFFIXES, AI, BOSSES } from '../src/game/registry.js';
import { STAT_NAMES } from '../src/game/stats.js';
import { PERK_HOOKS, refreshDynamicMods } from '../src/game/perks.js';
import { makeWeaponState } from '../src/game/combat.js';
import { TILE, STATUS_IDS } from '../src/game/constants.js';
import { Game, makeStubInput, defaultSaveLite } from '../src/game/game.js';
import { bus, Bus } from '../src/core/events.js';
import { ACHIEVEMENTS, initAchievements, BURST_GOAL, BLOOD_FEAST_GOAL } from '../src/meta/achievements.js';
import { WEAPON_IDS as META_WEAPON_IDS, WEAPON_UNLOCKS, isWeaponUnlocked, unlockedWeapons } from '../src/meta/progression.js';
import { defaultSave } from '../src/meta/save.js';

const DT = 1 / 60;
const NEW_RELICS = ['rusty_blade', 'leech_jar', 'blood_vial', 'serrated_edge', 'vein_burst', 'blood_scent', 'virulent_spore', 'wither_bloom',
  'storm_capacitor', 'static_brand', 'storm_heart', 'frenzied_maw', 'blood_torrent', 'blood_rite', 'night_lord', 'plague_heart'];
const NEW_CURSES = ['curse_open_wounds', 'curse_bloodless'];
const NEW_BOONS = ['boon_bleed', 'boon_deep_wounds', 'boon_vampirism', 'boon_virulence', 'boon_overload', 'boon_bloodlust', 'boon_frenzy_crit'];
const NEW_WEAPONS = ['blood_sickle', 'thorn_crossbow'];
const NEW_SHRINES = ['blood_well', 'storm_altar'];
const NEW_ACHIEVEMENTS = ['aderlass_25', 'eruption_25', 'discharge_25', 'frenzy_max', 'blood_feast'];
const BLOODLESS = ['soot_bomber', 'kiln_turret', 'spore_puff', 'myco_shooter', 'brood_pod', 'frost_wisp', 'glacier_slime', 'glacier_slime_small',
  'ice_golem', 'shade', 'void_eye', 'sun_shard'];
const BLOODLESS_BOSS_PARTS = ['boss_sun', 'boss_sun_core', 'boss_rime_segment'];
const FLESH = ['ash_crawler', 'cinder_bat', 'ember_spitter', 'slag_brute', 'rot_swarm', 'vine_lasher', 'mire_stalker', 'rime_wolf', 'shard_archer',
  'snow_caster', 'null_leech', 'rift_mage', 'echo_knight', 'gloom_mother', 'ash_revenant'];
const NEW_STATS = ['bleedChance', 'bleedDamage', 'vampirism', 'bloodOrbHeal', 'frenzyMax'];
const GLYPHS = new Set(('flame ember skull heart shield boot eye sword dagger hammer bow staff orb star sun moon snowflake drop bolt '
  + 'leaf mushroom bone crown coin key hourglass feather fang claw ring gem book potion bomb wing anchor chain mirror mask candle '
  + 'lantern compass dice scale thorn spiral cross hand tooth horn').split(' '));
const HEX = /^#[0-9a-f]{6}$/i;
/** German spot-check: no ae/oe/ue/ss substitutes in the new texts. */
const SUBSTITUTE = /\b(fuer|ueber|Ueber|zurueck|Staerke|staerke|Schaeden|Ruestung|Faehig|naechst|hoeher|groess|Kaelte|Schuetz|Blutungsstaerke|Saegezahn|Welkbluete|Seuchenfuerst|Nachtfuerst|Ueberladung|Waerme|waehrend|toedlich|Faeulnis|Gewitteraltaer)\b/;

const mods = (d, n) => (typeof d.mods === 'function' ? d.mods(n) : d.mods || []);
const perkText = (d) => [d.name, String(d.desc), typeof d.desc === 'function' ? d.desc(d.maxStacks) : '', d.flavor || ''].join(' ');

// ---------------------------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------------------------
describe('static content', () => {
  test('ids exist once, relic/boon names are unique across both registries', () => {
    for (const id of [...NEW_RELICS, ...NEW_CURSES]) assert.ok(RELICS[id], `relic ${id}`);
    for (const id of NEW_BOONS) assert.ok(BOONS[id], `boon ${id}`);
    for (const id of NEW_WEAPONS) assert.ok(WEAPONS[id], `weapon ${id}`);
    for (const id of NEW_SHRINES) assert.ok(SHRINES[id], `shrine ${id}`);
    for (const id of NEW_ACHIEVEMENTS) assert.ok(ACHIEVEMENTS[id], `achievement ${id}`);
    assert.ok(AFFIXES.lacerating, 'affix lacerating');
    const ids = [...Object.keys(RELICS), ...Object.keys(BOONS)];
    assert.equal(new Set(ids).size, ids.length, 'relic/boon ids overlap');
    const names = [...Object.values(RELICS), ...Object.values(BOONS)].map((d) => d.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dup, [], `duplicate perk names: ${dup}`);
    const wn = Object.values(WEAPONS).map((d) => d.name);
    assert.equal(new Set(wn).size, wn.length, 'duplicate weapon names');
    const sn = Object.values(SHRINES).map((d) => d.name);
    assert.equal(new Set(sn).size, sn.length, 'duplicate shrine names');
    const an = Object.values(AFFIXES).map((d) => d.name);
    assert.equal(new Set(an).size, an.length, 'duplicate affix names');
    const achNames = Object.values(ACHIEVEMENTS).map((d) => d.name);
    assert.equal(new Set(achNames).size, achNames.length, 'duplicate achievement names');
  });

  test('§12 stats exist; new perks use only known stats + hooks and are built on the new mechanics', () => {
    for (const s of NEW_STATS) assert.ok(STAT_NAMES.includes(s), `STAT_NAMES lacks ${s}`);
    assert.ok(PERK_HOOKS.includes('onStatusBurst'));
    const hooks = new Set(PERK_HOOKS);
    for (const id of [...NEW_RELICS, ...NEW_CURSES, ...NEW_BOONS]) {
      const d = RELICS[id] || BOONS[id];
      assert.ok(d.icon && GLYPHS.has(d.icon.glyph) && HEX.test(d.icon.color), `${id}: icon`);
      assert.ok(Array.isArray(d.tags) && d.tags.length, `${id}: tags`);
      assert.ok(String(d.desc).length > 10, `${id}: desc`);
      let usesNew = !!(d.hooks && (d.hooks.onStatusBurst || d.hooks.onPickup));
      for (let n = 1; n <= d.maxStacks; n++) {
        for (const m of mods(d, n)) {
          assert.ok(STAT_NAMES.includes(m.stat), `${id}: unknown stat ${m.stat}`);
          assert.ok(Number.isFinite(m.add ?? m.mul), `${id}: mod value`);
          if (NEW_STATS.includes(m.stat)) usesNew = true;
        }
      }
      for (const k of Object.keys(d.hooks || {})) assert.ok(hooks.has(k), `${id}: unknown hook ${k}`);
      const tagged = d.tags.some((t) => ['bleed', 'blood', 'vampirism', 'frenzy', 'poison', 'shock'].includes(t));
      assert.ok(usesNew || tagged, `${id}: not built on the §12 mechanics`);
      assert.equal(SUBSTITUTE.exec(perkText(d)), null, `${id}: umlaut substitute in "${perkText(d)}"`);
      if (BOONS[id]) assert.ok(d.maxStacks >= 3 && d.maxStacks <= 5, `${id}: boon stacks`);
    }
    const rar = {};
    for (const id of NEW_RELICS) rar[RELICS[id].rarity] = (rar[RELICS[id].rarity] || 0) + 1;
    assert.ok(rar.common >= 2 && rar.uncommon >= 4 && rar.rare >= 3 && rar.legendary >= 2, JSON.stringify(rar));
    for (const id of NEW_CURSES) assert.equal(RELICS[id].rarity, 'curse');
    assert.ok(RELICS.night_lord.rarity === 'legendary' && RELICS.night_lord.name === 'Nachtfürst');
  });

  test('weapons: fields, tags, unlock rules (Blutsichel from the start, Dornenarmbrust after 25 Aderlass)', () => {
    for (const id of NEW_WEAPONS) {
      const d = WEAPONS[id];
      assert.ok(d.tags.includes('bleed') && GLYPHS.has(d.icon.glyph) && HEX.test(d.color), id);
      assert.equal(d.levels.length, 4, `${id}: 4 levels`);
      for (const lv of d.levels) for (const k of Object.keys(lv.mods)) assert.ok((k[0] === '+' ? k.slice(1) : k) in d.base, `${id}: ${k}`);
      assert.ok(META_WEAPON_IDS.includes(id) && WEAPON_UNLOCKS[id], `${id}: meta roster`);
    }
    const s = defaultSave();
    assert.ok(isWeaponUnlocked(s, 'blood_sickle'));
    assert.ok(!isWeaponUnlocked(s, 'thorn_crossbow'));
    assert.ok(!unlockedWeapons(s).includes('thorn_crossbow'));
    s.counters.bleedBursts = BURST_GOAL;
    assert.ok(isWeaponUnlocked(s, 'thorn_crossbow'));
  });

  test('enemies: bloodless flags, bleeding attacks, Zerfleischend affix', () => {
    assert.ok(STATUS_IDS.includes('bleed'));
    for (const id of BLOODLESS) assert.equal(ENEMIES[id].bloodless, true, `${id} should be bloodless`);
    for (const id of BLOODLESS_BOSS_PARTS) assert.equal(BOSSES[id].bloodless, true, `${id} should be bloodless`);
    for (const id of FLESH) assert.ok(!ENEMIES[id].bloodless, `${id} should bleed`);
    for (const id of ['boss_cinder', 'boss_mycel', 'boss_rime', 'boss_umbra']) assert.ok(!BOSSES[id].bloodless, `${id} should bleed`);
    for (const id of ['ash_crawler', 'rime_wolf']) {
      const d = ENEMIES[id];
      assert.equal(d.hitStatus.id, 'bleed', id);
      assert.equal(typeof d.hooks.onSpawn, 'function', `${id}: onSpawn registers the hit listener`);
    }
    assert.ok(ENEMIES.mire_stalker.aiParams.biteBleed > 0 && ENEMIES.echo_knight.aiParams.dashBleed > 0);
    assert.equal(AFFIXES.lacerating.name, 'Zerfleischend');
  });
});

// ---------------------------------------------------------------------------------------------
// Headless harness (real Game)
// ---------------------------------------------------------------------------------------------
ENEMIES.cm_dummy = {
  id: 'cm_dummy', name: 'Blutpuppe', desc: '', biome: 'ash', hp: 300, speed: 0, damage: 0, r: 6, mass: 0,
  xp: 0, sparks: [0, 0], sprite: 'cm_dummy', color: '#888888', ai: 'cm_none', aiParams: {},
};
ENEMIES.cm_stone = { ...ENEMIES.cm_dummy, id: 'cm_stone', name: 'Steinpuppe', bloodless: true };
AI.cm_none = { update() {} };

function makeRoom(w, h) {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? TILE.WALL : TILE.FLOOR;
  return { id: -1, gx: 40, gy: 40, type: 'combat', depth: 1, w, h, tiles, doors: {}, spawns: [], props: [], variant: 0, visited: false, seen: false, cleared: true };
}

/** A new run on an empty 40×26 arena; the player keeps the character's start weapon unless `weapon` is given. */
function arena(seed, o = {}) {
  const game = new Game({ input: makeStubInput(), save: defaultSaveLite() });
  const run = game.startRun({ character: o.character || 'bearer', seed });
  game.save.settings.autoAim = true;
  const room = makeRoom(40, 26);
  room.id = run.floor.rooms.length;
  run.floor.rooms.push(room);
  run.enterRoom(room.id);
  const p = run.player;
  if (o.weapon) {
    if (p.weapon) p._unequip(p.weapon);
    const ws = makeWeaponState(WEAPONS[o.weapon], o.level || 1);
    p.weapons = [ws, null]; p.weaponIndex = 0;
    p._equip(ws);
  }
  return { game, run, w: run.world, p, input: game.input };
}

function dummy(h, dx, dy, o = {}) {
  const e = h.w.spawnEnemy(o.id || 'cm_dummy', h.p.x + dx, h.p.y + dy, { delay: 0, elite: o.elite });
  e.spawnT = 0;
  e.maxHp = o.maxHp ?? 300;
  e.hp = o.hp ?? e.maxHp;
  e.contact = false;
  return e;
}

function step(h, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (h.game.state === 'choice' && h.game.choice) {
      const opt = h.game.choice.options.find((x) => !x.disabled);
      if (opt) opt.pick(); else if (h.game.choice.skip) h.game.choice.skip();
    }
    h.game.update(DT);
  }
}

function bursts() {
  const list = [];
  const off = bus.on('status:burst', (b) => list.push(b));
  return { list, off, count: (id) => list.filter((b) => b.id === id).length };
}

const CONTENT_ERR = /\[perk\]|\[shrine\]|\[affix\]|\[enemy\]|\[ai\]|relics\.js|boons\.js|shrines\.js|weapons\.js|enemies\.js|characters\.js|achievements\.js|content-mechanics/;
function captureErrors() {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => { errs.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); };
  return { errs, restore() { console.error = orig; }, mine: () => errs.filter((e) => CONTENT_ERR.test(e)) };
}

function sane(h, where) {
  const { p, w } = h;
  for (const k of STAT_NAMES) assert.ok(Number.isFinite(p.stats[k]), `${where}: stat ${k}`);
  assert.ok(Number.isFinite(p.hp) && p.hp <= p.stats.maxHp + 1e-6 && Number.isFinite(p.shield), `${where}: hp ${p.hp}/${p.stats.maxHp}`);
  for (const e of w.enemies) assert.ok(Number.isFinite(e.hp), `${where}: enemy hp NaN`);
  for (const pr of w.projectiles) assert.ok(Number.isFinite(pr.x) && Number.isFinite(pr.damage), `${where}: projectile NaN`);
}

// ---------------------------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------------------------
describe('headless: enemies', () => {
  test('bloodless enemies never bleed; an Aderlass at 10 stacks drops blood orbs', () => {
    const h = arena('cm-bloodless');
    const stone = dummy(h, 60, 0, { id: 'cm_stone' });
    const turret = h.w.spawnEnemy('kiln_turret', h.p.x - 60, h.p.y, { delay: 0 });
    turret.spawnT = 0;
    assert.equal(h.w.applyStatus(stone, 'bleed', { stacks: 3, power: 2 }), false);
    assert.equal(h.w.applyStatus(turret, 'bleed', { stacks: 3, power: 2 }), false);
    const flesh = dummy(h, 0, 60);
    const b = bursts();
    h.w.applyStatus(flesh, 'bleed', { stacks: 10, power: 1, duration: 4 });
    b.off();
    assert.equal(b.count('bleed'), 1, 'Aderlass');
    assert.ok(flesh.hp < flesh.maxHp - 20, `Aderlass damage ${flesh.maxHp - flesh.hp}`);
    assert.ok(h.w.pickups.some((pk) => pk.kind === 'blood'), 'blood orb dropped');
  });

  test('Zerfleischend elites and bleeding lunges/bites make the player bleed', () => {
    const h = arena('cm-enemy-bleed');
    const { w, p } = h;
    const lac = w.spawnEnemy('ash_crawler', p.x + 80, p.y, { delay: 0, elite: ['lacerating'] });
    lac.spawnT = 0; lac.state = 'chase';
    p.iframes = 0;
    w.damagePlayer(4, { source: lac, type: 'phys' });
    assert.equal(p.statuses.bleed && p.statuses.bleed.stacks, 2, 'lacerating: 2 stacks');

    p.statuses = {}; p.iframes = 0;
    const crawler = w.spawnEnemy('ash_crawler', p.x - 80, p.y, { delay: 0 });
    crawler.spawnT = 0; crawler.state = 'chase';
    w.damagePlayer(4, { source: crawler, type: 'phys' });
    assert.ok(!p.statuses.bleed, 'plain contact does not bleed');
    p.iframes = 0; crawler.state = 'lunge';
    w.damagePlayer(4, { source: crawler, type: 'phys' });
    assert.equal(p.statuses.bleed && p.statuses.bleed.stacks, 1, 'the lunge bleeds');

    // zone attacks (mire stalker bite, echo knight charge) carry a bleed status
    for (const [id, dist] of [['mire_stalker', 70], ['echo_knight', 100]]) {
      const g = arena(`cm-zone-${id}`);
      const e = g.w.spawnEnemy(id, g.p.x + dist, g.p.y, { delay: 0 });
      e.spawnT = 0;
      let seen = false;
      for (let i = 0; i < 60 * 20 && !seen; i++) {
        g.game.update(DT);
        g.p.hp = g.p.stats.maxHp;
        seen = g.w.zones.some((z) => z.owner === e && z.status && z.status.id === 'bleed' && z.damage > 0);
      }
      assert.ok(seen, `${id}: bleeding attack zone`);
    }
  });

  test('vampiric elites heal only half while poisoned (core healEnemy)', () => {
    const heal = (poisoned) => {
      const h = arena('cm-vamp');
      const e = h.w.spawnEnemy('ash_crawler', h.p.x + 80, h.p.y, { delay: 0, elite: ['vampiric'] });
      e.spawnT = 0;
      e.hp = 10;
      if (poisoned) h.w.applyStatus(e, 'poison', { stacks: 1, power: 0.01, duration: 4 });
      h.p.iframes = 0;
      h.w.damagePlayer(6, { source: e, type: 'phys' });
      return e.hp - 10;
    };
    const full = heal(false), half = heal(true);
    assert.ok(full > 0 && Math.abs(half - full * 0.5) < 0.6, `heal ${full} vs poisoned ${half}`);
  });
});

// ---------------------------------------------------------------------------------------------
// Relics + curses: one focused effect check each, all on the real Game
// ---------------------------------------------------------------------------------------------
/** h = arena; returns nothing, asserts. */
const RELIC_CHECKS = {
  rusty_blade(h) { assert.ok(Math.abs(h.p.stats.bleedChance - 0.07) < 1e-9); },
  leech_jar(h) {
    assert.ok(Math.abs(h.p.stats.vampirism - 0.02) < 1e-9);
    h.p.hp = 30;
    const e = dummy(h, 60, 0, { maxHp: 200 });
    h.w.damageEnemy(e, 1e6, { source: 'weapon' });
    assert.ok(h.p.hp > 30, 'vampirism healed on kill');
  },
  blood_vial(h) {
    assert.equal(h.p.stats.bloodOrbHeal, 7);
    h.p.hp = 30;
    h.w.spawnPickup('blood', h.p.x, h.p.y, {});
    step(h, 0.6);
    assert.ok(h.p.hp >= 36.9, `orb healed ${h.p.hp - 30}`);
  },
  serrated_edge(h) {
    const e = dummy(h, 50, 0);
    h.w.damageEnemy(e, 1, { crit: true, source: 'weapon' });
    assert.equal(e.statuses.bleed && e.statuses.bleed.stacks, 2);
  },
  vein_burst(h) {
    const a = dummy(h, 60, 0), b = dummy(h, 85, 0);
    h.w.applyStatus(a, 'bleed', { stacks: 10, power: 2, duration: 4 });
    assert.ok(b.hp < b.maxHp && b.statuses.bleed && b.statuses.bleed.stacks >= 2, 'neighbour torn open');
  },
  blood_scent(h) {
    const e = dummy(h, 60, 0, { maxHp: 1000 });
    h.w.applyStatus(e, 'bleed', { stacks: 1, power: 0.01, duration: 4 });
    const hp0 = e.hp;
    h.w.damageEnemy(e, 10, { crit: true, source: 'weapon' });
    assert.ok(hp0 - e.hp >= 12.9, `crit vs bleeding: ${hp0 - e.hp}`);
  },
  virulent_spore(h) {
    const a = dummy(h, 60, 0), b = dummy(h, 60, 70);
    h.w.applyStatus(a, 'poison', { stacks: 8, power: 2, duration: 4 });
    assert.ok(b.statuses.poison, 'eruption reached 70 px');
  },
  wither_bloom(h) {
    const a = dummy(h, 60, 0), b = dummy(h, 60, 30);
    h.w.applyStatus(a, 'poison', { stacks: 8, power: 1, duration: 4 });
    assert.ok(a.statuses.weak && b.statuses.weak, 'eruption weakened');
  },
  storm_capacitor(h) {
    h.p.dash.charges = 0;
    const a = dummy(h, 60, 0);
    h.w.applyStatus(a, 'shock', { stacks: 5, duration: 4 });
    assert.equal(h.p.dash.charges, 1, 'dash refunded');
    assert.ok(h.p.shield > 0, 'shield');
  },
  static_brand(h) {
    const e = dummy(h, 60, 0);
    h.w.applyStatus(e, 'shock', { stacks: 1, duration: 4 });
    h.w.damageEnemy(e, 1, { source: 'weapon' });
    assert.equal(e.statuses.shock.stacks, 2);
  },
  storm_heart(h) {
    const line = [];
    for (let i = 0; i < 7; i++) line.push(dummy(h, -180 + i * 60, 70));
    h.w.applyStatus(line[0], 'shock', { stacks: 5, duration: 4 });
    assert.ok(line[5].hp < line[5].maxHp && line[6].hp < line[6].maxHp, 'discharge jumped 2 further');
  },
  frenzied_maw(h) {
    assert.equal(h.p.stats.frenzyMax, 14);
    const ls = h.p.stats.lifesteal;
    h.p.addFrenzy(4);
    refreshDynamicMods(h.run);
    assert.ok(Math.abs(h.p.stats.lifesteal - ls - 0.02) < 1e-6, `lifesteal ${ls} -> ${h.p.stats.lifesteal}`);
  },
  blood_torrent(h) {
    assert.ok(Math.abs(h.p.stats.bleedDamage - 1.25) < 1e-9);
    const e = dummy(h, 60, 0);
    h.w.applyStatus(e, 'bleed', { stacks: 10, power: 1, duration: 4 });
    const plain = arena('cm-torrent-plain');
    const f = dummy(plain, 60, 0);
    plain.w.applyStatus(f, 'bleed', { stacks: 10, power: 1, duration: 4 });
    assert.ok(e.maxHp - e.hp > (f.maxHp - f.hp) * 1.45, `Aderlass ${e.maxHp - e.hp} vs ${f.maxHp - f.hp}`);
  },
  blood_rite(h) {
    const orbs = (g) => {
      for (let i = 0; i < 40; i++) {
        const e = dummy(g, 80, 0);
        g.w.applyStatus(e, 'bleed', { stacks: 1, power: 0.01, duration: 4 });
        g.w.damageEnemy(e, 1e6, { source: 'weapon' });
      }
      return g.w.pickups.filter((pk) => pk.kind === 'blood').length;
    };
    const plain = arena('cm-rite');
    const a = orbs(h), b = orbs(plain);
    assert.ok(a >= b + 6, `blood orbs ${a} vs ${b}`);
  },
  night_lord(h) {
    assert.ok(Math.abs(h.p.stats.vampirism - 0.05) < 1e-9 && h.p.stats.frenzyMax === 15);
    const e = dummy(h, 40, 0);
    h.w.spawnPickup('blood', h.p.x, h.p.y, {});
    step(h, 0.6);
    assert.ok(e.hp < e.maxHp && e.statuses.bleed && e.statuses.bleed.stacks >= 2, 'blood wave');
    assert.ok(h.p.frenzy.stacks >= 1, 'Blutrausch');
    let dropped = 0;
    for (let i = 0; i < 60; i++) { const k = dummy(h, -80, 0); h.w.damageEnemy(k, 1e6, { source: 'weapon' }); }
    dropped = h.w.pickups.filter((pk) => pk.kind === 'blood').length;
    assert.ok(dropped >= 2, `orbs from kills ${dropped}`);
  },
  plague_heart(h) {
    const e = dummy(h, 60, 0), n = dummy(h, 60, 80);
    const b = bursts();
    h.w.applyStatus(e, 'poison', { stacks: 5, power: 1, duration: 4 });
    step(h, 0.25);
    b.off();
    assert.equal(b.count('poison'), 1, 'eruption at 5 stacks');
    assert.ok(n.statuses.poison, 'spread to 80 px');
  },
  curse_open_wounds(h) {
    assert.ok(Math.abs(h.p.stats.vampirism - 0.05) < 1e-9);
    h.p.iframes = 0;
    h.w.damagePlayer(5, { type: 'phys' });
    assert.equal(h.p.statuses.bleed && h.p.statuses.bleed.stacks, 2);
  },
  curse_bloodless(h) {
    assert.equal(h.p.stats.bloodOrbHeal, 8);
    assert.ok(h.p.stats.maxHp < 100);
  },
};

describe('headless: every new relic and curse', () => {
  for (const id of [...NEW_RELICS, ...NEW_CURSES]) {
    test(`${id} (${RELICS[id].name})`, () => {
      const cap = captureErrors();
      try {
        const h = arena(`cm-relic-${id}`, { weapon: 'blood_sickle' });
        if (RELICS[id].rarity === 'curse') h.run.giveCurse(id); else h.run.giveRelic(id);
        assert.ok(h.p.relics.some((r) => r.def.id === id), 'owned');
        RELIC_CHECKS[id](h);
        step(h, 0.5);
        sane(h, id);
        assert.deepEqual(cap.mine(), []);
      } finally { cap.restore(); }
    });
  }
  test('every new relic has an effect check', () => {
    for (const id of [...NEW_RELICS, ...NEW_CURSES]) assert.equal(typeof RELIC_CHECKS[id], 'function', id);
  });
});

// ---------------------------------------------------------------------------------------------
// Boons
// ---------------------------------------------------------------------------------------------
function burstDamage(h, id, stacks) {
  const e = dummy(h, 60, 0, { maxHp: 5000 });
  let dmg = 0;
  const off = bus.on('status:burst', (b) => { if (b.target === e) dmg += b.damage; });
  const hp0 = e.hp;
  h.w.applyStatus(e, id, { stacks, power: 1, duration: 4 });
  off();
  return { total: hp0 - e.hp, burst: dmg };
}

const BOON_CHECKS = {
  boon_bleed(h) { assert.ok(Math.abs(h.p.stats.bleedChance - 0.24) < 1e-9); },
  boon_deep_wounds(h) { assert.ok(Math.abs(h.p.stats.bleedDamage - 1.6) < 1e-9); },
  boon_vampirism(h) {
    assert.ok(Math.abs(h.p.stats.vampirism - 0.06) < 1e-9);
    h.p.hp = 40;
    h.w.damageEnemy(dummy(h, 60, 0), 1e6, { source: 'weapon' });
    assert.ok(h.p.hp > 40);
  },
  boon_virulence(h) {
    const a = burstDamage(h, 'poison', 8);
    assert.ok(a.total > a.burst * 1.7, `eruption ${a.burst} + bonus → ${a.total}`);
  },
  boon_overload(h) {
    const a = burstDamage(h, 'shock', 5);
    assert.ok(a.total > a.burst * 1.7, `discharge ${a.burst} + bonus → ${a.total}`);
  },
  boon_bloodlust(h) { assert.equal(h.p.stats.frenzyMax, 18); assert.equal(h.p.stats.bloodOrbHeal, 8); },
  boon_frenzy_crit(h) {
    const c = h.p.stats.critChance;
    h.p.addFrenzy(10);
    refreshDynamicMods(h.run);
    assert.ok(Math.abs(h.p.stats.critChance - c - 0.15) < 1e-6, `crit ${c} -> ${h.p.stats.critChance}`);
  },
};

describe('headless: every new boon at max stacks', () => {
  for (const id of NEW_BOONS) {
    test(`${id} (${BOONS[id].name})`, () => {
      const cap = captureErrors();
      try {
        const h = arena(`cm-boon-${id}`, { weapon: 'blood_sickle' });
        for (let i = 0; i < BOONS[id].maxStacks; i++) h.run.giveBoon(id);
        assert.equal(h.p.boons.find((b) => b.def.id === id).stacks, BOONS[id].maxStacks);
        BOON_CHECKS[id](h);
        step(h, 0.5);
        sane(h, id);
        assert.deepEqual(cap.mine(), []);
      } finally { cap.restore(); }
    });
  }

  test('requires(): bleed/blood perks only for matching builds', () => {
    const h = arena('cm-req');
    assert.equal(bleedAffinity(h.p), false, 'Glutbolzen cannot bleed');
    assert.equal(BOONS.boon_deep_wounds.requires(h.p, h.run), false);
    assert.equal(RELICS.blood_torrent.requires(h.p, h.run), false);
    h.run.giveRelic('rusty_blade');
    assert.equal(bleedAffinity(h.p), true, 'bleed chance');
    const s = arena('cm-req2', { weapon: 'blood_sickle' });
    assert.equal(bleedAffinity(s.p), true, 'bleed weapon');
    const r = arena('cm-req3', { character: 'revenant' });
    assert.equal(bloodAffinity(r.p), true, 'Aschenkind gets blood orbs');
  });
});

// ---------------------------------------------------------------------------------------------
// Everything at once
// ---------------------------------------------------------------------------------------------
test('headless: all new relics, curses and boons together survive 40 s of fighting and trigger every burst', () => {
  const cap = captureErrors();
  try {
    const h = arena('cm-all', { weapon: 'blood_sickle', level: 5 });
    const { run, w, p, input } = h;
    run.giveWeapon('thorn_crossbow', 5);
    for (const id of NEW_RELICS) run.giveRelic(id);
    for (const id of NEW_CURSES) run.giveCurse(id);
    for (const id of NEW_BOONS) for (let i = 0; i < BOONS[id].maxStacks; i++) run.giveBoon(id);
    p.addMod('cm_test', [{ stat: 'poisonChance', add: 0.15 }, { stat: 'shockChance', add: 0.1 }]);
    p.recalc();
    const orig = w.damagePlayer.bind(w);
    w.damagePlayer = (amount, info) => {
      const r = orig(amount, info);
      if (p.hp < 1 || !p.alive) { p.hp = Math.max(1, p.hp); p.alive = true; run.ended = false; run.dyingT = 0; }
      return r;
    };
    const b = bursts();
    let frenzy = 0;
    const offF = bus.on('player:frenzy', (e) => { frenzy = Math.max(frenzy, e.stacks); });
    const roster = ['ash_crawler', 'rime_wolf', 'mire_stalker', 'null_leech', 'ember_spitter', 'kiln_turret'];
    let t = 0;
    for (let i = 0; i < 60 * 40; i++) {
      t += DT;
      if (i % 90 === 0 && w.enemies.filter((e) => !e.dead).length < 12) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + t;
          const pos = w.clampToRoom(p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30, 20);
          const e = w.spawnEnemy(roster[(i / 90 + k) % roster.length | 0], pos.x, pos.y, { delay: 0, elite: k === 0 ? ['lacerating'] : 0 });
          e.spawnT = 0;
          e.hp = e.maxHp = e.maxHp * 10; // tanky, so poison and shock can stack up to their payoffs
        }
      }
      // a toxic, crackling arena: extra poison / shock stacks so every payoff gets exercised alongside the weapons
      if (i % 60 === 30) {
        for (const e of w.enemiesInRadius(p.x, p.y, 90)) {
          w.applyStatus(e, 'poison', { stacks: 2, power: 1, duration: 4 });
          if (!e.dead) w.applyStatus(e, 'shock', { stacks: 1, duration: 4 });
        }
      }
      input.hold('fire', true);
      input.setMove(Math.cos(t * 1.3) * 0.4, Math.sin(t * 1.3) * 0.4);
      if (i % 600 === 300) input.press('swap');
      if (i % 120 === 0) input.press('dash');
      step(h, DT);
      if (i % 60 === 0) sane(h, `t=${t.toFixed(1)}`);
    }
    input.hold('fire', false);
    b.off(); offF();
    for (const id of ['bleed', 'poison', 'shock']) assert.ok(b.count(id) > 0, `${id} bursts: ${b.count(id)}`);
    assert.ok(run.stats.bloodOrbs > 0, 'blood orbs collected');
    assert.ok(frenzy > 0, 'Blutrausch');
    assert.equal(p._hookDepth, 0);
    assert.deepEqual(cap.mine(), [], cap.mine().join('\n'));
    if (process.env.CM_DEBUG) console.log({ bursts: { bleed: b.count('bleed'), poison: b.count('poison'), shock: b.count('shock') }, orbs: run.stats.bloodOrbs, frenzy, kills: run.stats.kills });
  } finally { cap.restore(); }
});

// ---------------------------------------------------------------------------------------------
// Weapons: DPS vs realistic dummies (max HP matters for Aderlass)
// ---------------------------------------------------------------------------------------------
function measure(id, level, seconds = 20, maxHp = 300) {
  const h = arena(`cm-dps-${id}-${level}`, { weapon: id, level });
  const { p, input } = h;
  p.mods.set('character', []); p.mods.set('meta', []); p.passive = null; p.relics = []; p.boons = [];
  p.recalc();
  p.hp = p.stats.maxHp;
  const e = dummy(h, id === 'blood_sickle' ? 28 : 56, 0, { maxHp, hp: 1e7 });
  const b = bursts();
  input.hold('fire', true);
  for (let i = 0; i < Math.round(seconds / DT); i++) { h.game.update(DT); p.hp = p.stats.maxHp; }
  input.hold('fire', false);
  b.off();
  return { dps: (1e7 - e.hp) / seconds, aderlass: b.count('bleed') };
}

describe('headless: weapons', () => {
  test('Blutsichel + Dornenarmbrust: DPS in the band of the roster (≈19–27 at L1), levels add power; prints DPS', () => {
    const cap = captureErrors();
    try {
      const rows = [];
      for (const id of NEW_WEAPONS) {
        const l1 = measure(id, 1), l5 = measure(id, 5);
        rows.push({ id, l1, l5 });
      }
      console.log(['', 'Waffe            DPS L1  DPS L5  Aderlass/10 s (L1 / L5)   (Ziel: 300 max. Leben, 20 s)']
        .concat(rows.map((r) => `${r.id.padEnd(16)} ${r.l1.dps.toFixed(1).padStart(6)}  ${r.l5.dps.toFixed(1).padStart(6)}  `
          + `${(r.l1.aderlass / 2).toFixed(1)} / ${(r.l5.aderlass / 2).toFixed(1)}`)).join('\n'));
      for (const r of rows) {
        assert.ok(r.l1.dps >= 19 && r.l1.dps <= 28, `${r.id}: L1 DPS ${r.l1.dps.toFixed(1)}`);
        assert.ok(r.l5.dps > r.l1.dps * 1.6 && r.l5.dps <= 60, `${r.id}: L5 DPS ${r.l5.dps.toFixed(1)}`);
        assert.ok(r.l1.aderlass >= 2, `${r.id}: Aderlass happens`);
      }
      assert.deepEqual(cap.mine(), []);
    } finally { cap.restore(); }
  });

  test('Blutsichel L5 heals on Aderlass; Dornenarmbrust L5 shatters into thorns; crits bleed twice', () => {
    const h = arena('cm-sickle5', { weapon: 'blood_sickle', level: 5 });
    h.p.mods.set('character', []); h.p.passive = null; h.p.recalc();
    const e = dummy(h, 28, 0, { maxHp: 300, hp: 1e7 });
    h.p.hp = 40;
    const hp0 = h.p.hp;
    h.input.hold('fire', true);
    step(h, 6);
    h.input.hold('fire', false);
    assert.ok(e.hp < 1e7);
    assert.ok(h.p.hp > hp0 + 4, `feast healed ${h.p.hp - hp0}`);

    const c = arena('cm-cross5', { weapon: 'thorn_crossbow', level: 5 });
    dummy(c, 56, 0, { maxHp: 300, hp: 1e7 });
    let thorns = 0;
    c.input.hold('fire', true);
    for (let i = 0; i < 60 * 6; i++) {
      c.game.update(DT);
      thorns = Math.max(thorns, c.w.projectiles.filter((q) => q.weaponId === 'thorn_crossbow' && q.sprite === 'proj_needle' && !q.dead).length);
    }
    assert.ok(thorns >= 3, `thorns ${thorns}`);

    const s = arena('cm-crit', { weapon: 'blood_sickle' });
    s.p.addMod('cm_crit', [{ stat: 'critChance', add: 1 }]);
    s.p.recalc();
    const d = dummy(s, 28, 0, { maxHp: 1000 });
    s.input.press('fire');
    s.input.hold('fire', true);
    for (let i = 0; i < 60 && !(d.statuses.bleed); i++) s.game.update(DT);
    assert.equal(d.statuses.bleed && d.statuses.bleed.stacks, 2, 'crit swing: 2 stacks');
  });
});

// ---------------------------------------------------------------------------------------------
// Shrines
// ---------------------------------------------------------------------------------------------
describe('headless: shrines', () => {
  const ctxOf = (h) => ({ w: h.w, player: h.p, run: h.run, rng: h.w.rng });

  test('every option of the new shrines can be picked', () => {
    const cap = captureErrors();
    try {
      for (const sid of NEW_SHRINES) {
        const opts = SHRINES[sid].options(ctxOf(arena(`cm-probe-${sid}`)));
        assert.ok(opts.length >= 2 && opts[opts.length - 1].keep === true, `${sid}: decline option`);
        for (let i = 0; i < opts.length; i++) {
          const h = arena(`cm-shrine-${sid}-${i}`, { weapon: 'blood_sickle' });
          h.p.sparks = 500;
          const o = SHRINES[sid].options(ctxOf(h))[i];
          assert.ok(o.desc.length > 5 && !/NaN|undefined|null/.test(o.desc) && (!o.icon || GLYPHS.has(o.icon.glyph)), `${sid}/${o.id}: ${o.desc}`);
          assert.notEqual(o.available, false, `${sid}/${o.id} available`);
          o.pick(ctxOf(h));
          step(h, 0.5);
          sane(h, `${sid}/${o.id}`);
        }
      }
      assert.deepEqual(cap.mine(), []);
    } finally { cap.restore(); }
  });

  test('Blutbrunnen and Gewitteraltar effects', () => {
    let h = arena('cm-well');
    const mh = h.p.stats.maxHp;
    SHRINES.blood_well.options(ctxOf(h))[0].pick(ctxOf(h));
    assert.ok(Math.abs(h.p.stats.vampirism - 0.04) < 1e-9 && h.p.stats.frenzyMax === 13 && h.p.stats.maxHp === mh - 15);

    h = arena('cm-well2', { weapon: 'blood_sickle' });
    const n = h.p.relics.length, hp = h.p.hp;
    SHRINES.blood_well.options(ctxOf(h))[1].pick(ctxOf(h));
    assert.equal(h.p.relics.length, n + 1);
    assert.ok(h.p.hp < hp);
    assert.ok(h.p.relics[h.p.relics.length - 1].def.tags.some((t) => ['bleed', 'blood', 'vampirism', 'frenzy'].includes(t)), 'a blood relic');

    h = arena('cm-storm');
    const sc = h.p.stats.shockChance, sd = h.p.stats.shockDamage;
    SHRINES.storm_altar.options(ctxOf(h))[0].pick(ctxOf(h));
    assert.ok(Math.abs(h.p.stats.shockChance - sc - 0.08) < 1e-9 && h.p.stats.shockDamage > sd * 1.14);

    h = arena('cm-storm2');
    h.p.sparks = 200;
    SHRINES.storm_altar.options(ctxOf(h))[1].pick(ctxOf(h));
    assert.equal(h.p.boons.find((b) => b.def.id === 'boon_overload').stacks, 2);
    assert.ok(h.p.sparks < 200);
  });
});

// ---------------------------------------------------------------------------------------------
// Aschenkind
// ---------------------------------------------------------------------------------------------
test('Aschenkind: vampirism instead of lifesteal, kills drop blood orbs, orb overheal becomes shield', () => {
  const c = CHARACTERS.revenant;
  assert.ok(c.baseMods.some((m) => m.stat === 'vampirism' && m.add > 0));
  assert.ok(!c.baseMods.some((m) => m.stat === 'lifesteal'), 'no flat lifesteal any more');
  const h = arena('cm-revenant', { character: 'revenant' });
  assert.ok(h.p.stats.vampirism >= 0.03);
  for (let i = 0; i < 80; i++) h.w.damageEnemy(dummy(h, 90, 0, { maxHp: 40 }), 1e6, { source: 'weapon' });
  const orbs = h.w.pickups.filter((pk) => pk.kind === 'blood').length;
  assert.ok(orbs >= 3 && orbs <= 25, `orbs from 80 kills: ${orbs}`);
  for (const pk of h.w.pickups) pk.dead = true;
  h.p.hp = h.p.stats.maxHp;
  h.p.shield = 0;
  h.w.spawnPickup('blood', h.p.x, h.p.y, {});
  step(h, 0.6);
  assert.ok(h.p.shield > 0, `overheal shield ${h.p.shield}`);
});

// ---------------------------------------------------------------------------------------------
// Achievements from synthetic events
// ---------------------------------------------------------------------------------------------
describe('achievements', () => {
  function setup() {
    const b = new Bus();
    const player = { stats: { frenzyMax: 10 }, relics: [] };
    const game = { save: defaultSave(), run: { time: 5, player, stats: {} } };
    const dispose = initAchievements(game, { bus: b });
    return { b, game, dispose };
  }

  test('burst counters unlock Aderlasser / Seuchenherd / Blitzableiter (and the Dornenarmbrust)', () => {
    const { b, game, dispose } = setup();
    try {
      for (let i = 0; i < BURST_GOAL - 1; i++) b.emit('status:burst', { id: 'bleed', damage: 10 });
      assert.ok(!game.save.achievements.aderlass_25);
      assert.ok(!isWeaponUnlocked(game.save, 'thorn_crossbow'));
      b.emit('status:burst', { id: 'bleed', damage: 10 });
      assert.ok(game.save.achievements.aderlass_25, 'aderlass_25');
      assert.equal(game.save.counters.bleedBursts, BURST_GOAL);
      assert.ok(isWeaponUnlocked(game.save, 'thorn_crossbow'));
      for (let i = 0; i < BURST_GOAL; i++) { b.emit('status:burst', { id: 'poison' }); b.emit('status:burst', { id: 'shock' }); }
      assert.ok(game.save.achievements.eruption_25 && game.save.achievements.discharge_25);
      b.emit('status:burst', { id: 'nonsense' });
      b.emit('status:burst', null);
    } finally { dispose(); }
  });

  test('Im Blutrausch needs full Blutrausch stacks; Nachtmahl counts blood orb heals of one run', () => {
    const { b, game, dispose } = setup();
    try {
      b.emit('player:frenzy', { stacks: 9 });
      assert.ok(!game.save.achievements.frenzy_max);
      b.emit('player:frenzy', { stacks: 10 });
      assert.ok(game.save.achievements.frenzy_max);

      const orbs = Math.ceil(BLOOD_FEAST_GOAL / 6);
      // a heal that is not followed by an orb in the same step does not count
      b.emit('player:heal', { amount: 500 });
      game.run.time += 1;
      b.emit('pickup:collect', { kind: 'blood', amount: 1 });
      assert.ok(!game.save.achievements.blood_feast);
      for (let i = 0; i < orbs - 1; i++) {
        game.run.time += 0.1;
        b.emit('player:heal', { amount: 6 });
        b.emit('pickup:collect', { kind: 'blood', amount: 1 });
      }
      assert.ok(!game.save.achievements.blood_feast);
      game.run.time += 0.1;
      b.emit('player:heal', { amount: 6 });
      b.emit('pickup:collect', { kind: 'blood', amount: 1 });
      assert.ok(game.save.achievements.blood_feast, 'blood_feast');
    } finally { dispose(); }
  });

  test('a real Aderlass reaches the achievement counter through the global bus', () => {
    const h = arena('cm-ach-real');
    const dispose = initAchievements(h.game);
    try {
      const before = h.game.save.counters ? h.game.save.counters.bleedBursts || 0 : 0;
      h.w.applyStatus(dummy(h, 60, 0), 'bleed', { stacks: 10, power: 1, duration: 4 });
      assert.equal(h.game.save.counters.bleedBursts, before + 1);
    } finally { dispose(); }
  });
});
