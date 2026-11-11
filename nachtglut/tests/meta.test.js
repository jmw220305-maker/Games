// Meta-progression tests: save, progression, tracker, achievements, codex.  Run: node --test tests/meta.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Bus, bus as globalBus } from '../src/core/events.js';
import { STAT_NAMES, computeStats } from '../src/game/stats.js';
import {
  SAVE_KEY, SAVE_VERSION, defaultSave, loadSave, persistSave, resetSave, exportSave, importSave, migrate,
  clearMemorySave, ensureSaveShape, HISTORY_MAX,
} from '../src/meta/save.js';
import {
  META_UPGRADES, UPGRADE_LIST, UPGRADE_BRANCHES, upgradeLevel, upgradeCost, canBuyUpgrade, buyUpgrade, refundAll,
  getMetaMods, getRunBonuses, totalUpgradeCost, spentAsh, upgradeInfo, DIFFICULTIES, difficultyUnlocked, getDifficulty,
  CHARACTER_UNLOCKS, isCharacterUnlocked, characterUnlockText, characterUnlockProgress, buyCharacter,
  WEAPON_UNLOCKS, WEAPON_IDS, isWeaponUnlocked, unlockedWeapons, weaponUnlockText, computeAshReward, checkUnlocks,
} from '../src/meta/progression.js';
import { initTracker, applyRunEnd } from '../src/meta/tracker.js';
import { ACHIEVEMENTS, ACHIEVEMENT_LIST, initAchievements, achievementProgress, achievementStatus, ROSTER_ENEMY_IDS } from '../src/meta/achievements.js';
import {
  codexEnemies, codexBosses, codexRelics, codexWeapons, codexCompletion, formatStat, STAT_LABELS, formatStatValue,
  lifetimeStats, statSheet,
} from '../src/meta/codex.js';

// §7 icon glyphs
const GLYPHS = new Set(('flame ember skull heart shield boot eye sword dagger hammer bow staff orb star sun moon snowflake drop bolt leaf '
  + 'mushroom bone crown coin key hourglass feather fang claw ring gem book potion bomb wing anchor chain mirror mask candle lantern compass '
  + 'dice scale thorn spiral cross hand tooth horn').split(' '));
const START_WEAPONS = ['ember_bolt', 'scatter_coal', 'flame_lance', 'frost_needle', 'sun_disc', 'iron_hammer', 'shadow_daggers', 'ice_staff', 'spore_launcher'];

// ---------------------------------------------------------------------------------------------
// localStorage stubs
// ---------------------------------------------------------------------------------------------
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
function setStorage(value) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}
function setThrowingStorageGetter() {
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
}
function removeStorage() {
  delete globalThis.localStorage;
}

let storage;
beforeEach(() => {
  clearMemorySave();
  storage = new MemStorage();
  setStorage(storage);
});
afterEach(() => {
  removeStorage();
  clearMemorySave();
});

const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.updatedAt; return c; };

// ---------------------------------------------------------------------------------------------
// save.js
// ---------------------------------------------------------------------------------------------
describe('save', () => {
  test('defaultSave matches the §9 schema and default settings', () => {
    const s = defaultSave();
    assert.equal(s.version, SAVE_VERSION);
    assert.equal(s.ash, 0);
    assert.equal(s.totalAsh, 0);
    assert.deepEqual(s.upgrades, {});
    assert.deepEqual(s.unlocks, { characters: ['bearer'], weapons: [], difficulties: 0 });
    for (const k of ['enemies', 'relics', 'weapons', 'bosses']) assert.deepEqual(s.codex[k], {});
    assert.deepEqual(s.achievements, {});
    for (const k of ['runs', 'wins', 'deaths', 'kills', 'bestFloor', 'playTime', 'fastestWin', 'totalSparks']) assert.equal(s.stats[k], 0);
    assert.deepEqual(s.history, []);
    assert.deepEqual(s.settings, {
      master: 0.8, music: 0.6, sfx: 0.8, shake: 1, flashes: true, damageNumbers: true, autoAim: false, autoFire: false,
      touchSide: 'right', showTimer: true, reducedMotion: false,
    });
    assert.equal(s.tutorialSeen, false);
    assert.equal(s.runSnapshot, null);
    assert.deepEqual(s.seenHints, {});
    assert.equal(SAVE_KEY, 'nachtglut.save.v1');
  });

  test('persist + load round-trip', () => {
    const s = defaultSave();
    s.ash = 321; s.totalAsh = 999; s.upgrades.vitality = 2;
    s.unlocks.characters.push('shadow'); s.unlocks.difficulties = 3;
    s.codex.enemies.ash_crawler = { seen: true, kills: 12 };
    s.codex.bosses.boss_cinder = { seen: true, kills: 1, bestTime: 84.2 };
    s.codex.relics.whetstone = 2;
    s.achievements.first_death = 1700000000000;
    s.stats.runs = 4; s.stats.highestDifficultyWon = 2;
    s.history.push({ date: 1, victory: false, character: 'bearer', difficulty: 0, floor: 2, time: 300, ash: 40 });
    s.settings.master = 0.25; s.settings.touchSide = 'left';
    s.tutorialSeen = true;
    assert.equal(persistSave(s), true);
    assert.ok(storage.getItem(SAVE_KEY));
    assert.deepEqual(strip(loadSave()), strip(s));
  });

  test('loadSave without stored data returns defaults', () => {
    const s = loadSave();
    assert.deepEqual(strip({ ...s, createdAt: 0 }), strip({ ...defaultSave(), createdAt: 0 }));
  });

  test('corrupt JSON in storage falls back to defaults and keeps a backup', () => {
    storage.setItem(SAVE_KEY, '{"ash": 12, broken');
    const s = loadSave();
    assert.equal(s.ash, 0);
    assert.ok(storage.getItem(`${SAVE_KEY}.corrupt`));
  });

  test('migrate never throws and sanitises garbage', () => {
    for (const raw of [null, undefined, 42, 'abc', '', [], [1, 2], true, () => 1, { ash: 'x' }, '{"ash":5}', { stats: 7, codex: [], unlocks: 'no' }]) {
      const s = migrate(raw);
      assert.equal(s.version, SAVE_VERSION);
      assert.ok(Number.isFinite(s.ash) && s.ash >= 0);
      assert.ok(Array.isArray(s.history));
      assert.ok(s.unlocks.characters.includes('bearer'));
    }
    assert.equal(migrate('{"ash":5}').ash, 5);
  });

  test('migrate clamps numbers and drops invalid entries', () => {
    const s = migrate({
      ash: -50, totalAsh: Infinity,
      upgrades: { vitality: 3.7, might: 'nope', swiftness: -2, '': 1 },
      unlocks: { characters: ['shadow', 5, 'shadow'], weapons: 'x', difficulties: 99 },
      settings: { master: 7, music: -1, sfx: '0.5', shake: 'loud', flashes: 'yes', touchSide: 'top', custom: 'kept' },
      stats: { runs: 3.9, bestFloor: 12, kills: NaN, highestDifficultyWon: 42 },
      history: Array.from({ length: 30 }, (_, i) => ({ floor: i, victory: i === 0 })),
      codex: { enemies: { ash_crawler: 4, cinder_bat: { kills: 2 } }, relics: { whetstone: true, bad: -3 }, bosses: { boss_cinder: { kills: 2, bestTime: -5 } } },
    });
    assert.equal(s.ash, 0);
    assert.ok(Number.isFinite(s.totalAsh));
    assert.deepEqual(s.upgrades, { vitality: 3 });
    assert.deepEqual(s.unlocks.characters, ['bearer', 'shadow']);
    assert.deepEqual(s.unlocks.weapons, []);
    assert.equal(s.unlocks.difficulties, 10);
    assert.equal(s.settings.master, 1);
    assert.equal(s.settings.music, 0);
    assert.equal(s.settings.sfx, 0.5);
    assert.equal(s.settings.shake, 1);
    assert.equal(s.settings.flashes, true);
    assert.equal(s.settings.touchSide, 'right');
    assert.equal(s.settings.custom, 'kept');
    assert.equal(s.stats.runs, 3);
    assert.equal(s.stats.bestFloor, 5);
    assert.equal(s.stats.kills, 0);
    assert.equal(s.stats.highestDifficultyWon, 10);
    assert.equal(s.history.length, HISTORY_MAX);
    assert.ok(s.history.every((h) => h.floor >= 1 && h.floor <= 5));
    assert.deepEqual(s.codex.enemies.ash_crawler, { seen: true, kills: 4 });
    assert.deepEqual(s.codex.enemies.cinder_bat, { seen: true, kills: 2 });
    assert.deepEqual(s.codex.relics, { whetstone: 1 });
    assert.deepEqual(s.codex.bosses.boss_cinder, { seen: true, kills: 2, bestTime: 0 });
  });

  test('migrate keeps unknown fields, ignores prototype pollution', () => {
    const raw = JSON.parse('{"ash": 10, "extraField": {"a": 1}, "__proto__": {"polluted": true}, "upgrades": {"__proto__": 5}}');
    const s = migrate(raw);
    assert.equal(s.ash, 10);
    assert.deepEqual(s.extraField, { a: 1 });
    assert.equal({}.polluted, undefined);
    assert.equal(s.polluted, undefined);
    assert.equal(Object.keys(s.upgrades).length, 0);
  });

  test('migrate upgrades version-0 saves and derives difficulty unlocks', () => {
    const s = migrate({ asche: 77, stats: { wins: 1, highestDifficultyWon: 2 }, settings: { master: 0.3 } });
    assert.equal(s.ash, 77);
    assert.equal(s.asche, undefined);
    assert.equal(s.version, SAVE_VERSION);
    assert.equal(s.settings.master, 0.3);
    assert.equal(s.settings.music, 0.6);
    assert.equal(s.unlocks.difficulties, 3);
  });

  test('export/import round-trip (also with umlauts)', () => {
    const s = defaultSave();
    s.ash = 1234; s.upgrades.might = 3;
    s.history.push({ date: 5, victory: true, character: 'shadow', difficulty: 1, floor: 5, time: 1500, ash: 400, killedBy: 'Schlackenkönig – äöüß' });
    const code = exportSave(s);
    assert.match(code, /^[A-Za-z0-9+/]+=*$/);
    const back = importSave(code);
    assert.equal(back.ash, 1234);
    assert.equal(back.upgrades.might, 3);
    assert.equal(back.history[0].killedBy, 'Schlackenkönig – äöüß');
    assert.equal(loadSave().ash, 1234, 'import persists');
    // whitespace / line breaks in pasted code are tolerated
    assert.equal(importSave(code.replace(/(.{20})/g, '$1\n ')).ash, 1234);
    // plain JSON backups too
    assert.equal(importSave(JSON.stringify({ ash: 9, upgrades: {} }), { persist: false }).ash, 9);
  });

  test('importSave throws German errors on garbage', () => {
    const cases = ['', '   ', 'not base64 !!!', 'aGVsbG8gd2VsdA==', Buffer.from('{"foo":1}').toString('base64'),
      Buffer.from('{"game":"other","save":{"ash":1}}').toString('base64'), '{broken json', 42];
    for (const c of cases) {
      assert.throws(() => importSave(c), (err) => err instanceof Error && /Spielstand|Code|Nachtglut/.test(err.message), `case ${String(c).slice(0, 20)}`);
    }
    const newer = Buffer.from(JSON.stringify({ game: 'nachtglut', save: { version: 99, ash: 1 } })).toString('base64');
    assert.throws(() => importSave(newer), /neueren/);
  });

  test('works in memory when localStorage is missing', () => {
    removeStorage();
    const s = defaultSave();
    s.ash = 55;
    assert.equal(persistSave(s), false);
    assert.equal(loadSave().ash, 55);
  });

  test('works in memory when localStorage throws', () => {
    setThrowingStorageGetter();
    const s = defaultSave();
    s.ash = 66;
    assert.doesNotThrow(() => persistSave(s));
    assert.equal(loadSave().ash, 66);
    assert.doesNotThrow(() => resetSave());
  });

  test('works in memory when setItem/getItem throw (quota, privacy mode)', () => {
    setStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } });
    const s = defaultSave();
    s.ash = 77;
    assert.equal(persistSave(s), false);
    assert.equal(loadSave().ash, 77);
  });

  test('resetSave wipes progress, optionally keeps settings and identity', () => {
    const s = defaultSave();
    s.ash = 500; s.settings.master = 0.1; s.tutorialSeen = true;
    persistSave(s);
    const settingsRef = s.settings;
    const r = resetSave({ into: s, keepSettings: true });
    assert.equal(r, s);
    assert.equal(s.settings, settingsRef);
    assert.equal(s.ash, 0);
    assert.equal(s.settings.master, 0.1);
    assert.equal(loadSave().ash, 0);
    const fresh = resetSave();
    assert.equal(fresh.settings.master, 0.8);
  });

  test('ensureSaveShape repairs partial objects in place', () => {
    const s = { ash: 5, stats: { kills: 3 }, codex: { enemies: {} } };
    ensureSaveShape(s);
    assert.equal(s.ash, 5);
    assert.equal(s.stats.kills, 3);
    assert.equal(s.stats.runs, 0);
    assert.deepEqual(s.codex.bosses, {});
    assert.ok(Array.isArray(s.history));
    assert.ok(Array.isArray(s.unlocks.characters));
  });
});

// ---------------------------------------------------------------------------------------------
// progression.js — upgrades
// ---------------------------------------------------------------------------------------------
describe('upgrades', () => {
  test('22–26 well-formed upgrades in 4 branches', () => {
    assert.ok(UPGRADE_LIST.length >= 22 && UPGRADE_LIST.length <= 26, `count ${UPGRADE_LIST.length}`);
    assert.deepEqual(Object.keys(UPGRADE_BRANCHES).sort(), ['geschick', 'glut', 'körper', 'schicksal'].sort());
    for (const b of Object.keys(UPGRADE_BRANCHES)) {
      assert.ok(UPGRADE_LIST.filter((u) => u.branch === b).length >= 4, `branch ${b}`);
      assert.equal(typeof UPGRADE_BRANCHES[b].name, 'string');
    }
    const ids = new Set();
    for (const u of UPGRADE_LIST) {
      assert.ok(!ids.has(u.id)); ids.add(u.id);
      assert.equal(META_UPGRADES[u.id], u);
      assert.ok(u.name && typeof u.name === 'string');
      assert.ok(u.maxLevel >= 1 && u.maxLevel <= 5);
      assert.ok(GLYPHS.has(u.icon.glyph), `${u.id} glyph ${u.icon.glyph}`);
      assert.match(u.icon.color, /^#[0-9a-f]{6}$/i);
      assert.ok(u.mods || u.effect, `${u.id} has an effect`);
      assert.ok(String(u.desc).length > 5);
      for (let l = 1; l <= u.maxLevel; l++) {
        assert.equal(typeof u.desc(l), 'string');
        assert.ok(u.cost(l) > 0 && Number.isInteger(u.cost(l)));
        if (l > 1) assert.ok(u.cost(l) > u.cost(l - 1), `${u.id} costs increase`);
      }
      assert.equal(u.cost(u.maxLevel + 1), Infinity);
      if (u.requires) {
        const req = META_UPGRADES[u.requires.id];
        assert.ok(req, `${u.id} requires known id`);
        assert.ok(u.requires.level <= req.maxLevel);
        assert.ok(!req.requires || req.requires.id !== u.id, 'no cycles');
      }
    }
  });

  test('cost curve: cheap first steps, total in 15 000–19 000', () => {
    const cheap = UPGRADE_LIST.filter((u) => u.cost(1) <= 40 && !u.requires);
    assert.ok(cheap.length >= 8, `cheap first levels: ${cheap.length}`);
    assert.ok(UPGRADE_LIST.some((u) => u.cost(1) <= 25), 'something affordable after a weak first run');
    const total = totalUpgradeCost();
    assert.ok(total >= 15000 && total <= 19000, `total ${total}`);
  });

  test('getMetaMods only uses §6.2 stat names and stays sane when everything is maxed', () => {
    const s = defaultSave();
    for (const u of UPGRADE_LIST) s.upgrades[u.id] = u.maxLevel;
    const mods = getMetaMods(s);
    assert.ok(mods.length > 0);
    for (const m of mods) {
      assert.ok(STAT_NAMES.includes(m.stat), `unknown stat ${m.stat}`);
      assert.ok(m.add !== undefined || m.mul !== undefined);
      if (m.add !== undefined) assert.ok(Number.isFinite(m.add));
      if (m.mul !== undefined) assert.ok(Number.isFinite(m.mul) && m.mul > 0);
    }
    const st = computeStats([mods]);
    assert.equal(st.maxHp, 150);
    assert.equal(st.dashCharges, 2);
    assert.ok(st.damage > 1.15 && st.damage < 1.25);
    assert.ok(st.dashCooldown < 1.1 && st.dashCooldown > 0.8);
    assert.ok(st.shopDiscount > 0 && st.shopDiscount <= 0.6);
    assert.deepEqual(getMetaMods(defaultSave()), []);
  });

  test('getRunBonuses aggregates non-stat effects', () => {
    const base = getRunBonuses(defaultSave());
    assert.equal(base.startSparks, 0);
    assert.equal(base.revives, 0);
    assert.equal(base.relicChoices, 0);
    const s = defaultSave();
    for (const u of UPGRADE_LIST) s.upgrades[u.id] = u.maxLevel;
    const b = getRunBonuses(s);
    assert.equal(b.startSparks, 100);
    assert.equal(b.rerolls, 3);
    assert.equal(b.revives, 1);
    assert.equal(b.reviveHp, 0.3);
    assert.equal(b.relicChoices, 1);
    assert.equal(b.startRelics, 1);
    assert.equal(b.healOnFloor, 0.3);
    assert.equal(b.startShield, 45);
    assert.equal(b.shopDiscount, 0);
  });

  test('purchase flow: insufficient ash, requirements, max level, events, refund', () => {
    const s = defaultSave();
    const events = [];
    const off = globalBus.on('meta:change', (p) => events.push(p));
    try {
      let r = canBuyUpgrade(s, 'vitality');
      assert.equal(r.ok, false);
      assert.match(r.reason, /Asche/);
      assert.equal(buyUpgrade(s, 'vitality'), false);
      assert.equal(canBuyUpgrade(s, 'nope').ok, false);

      s.ash = 10000;
      assert.equal(upgradeCost(s, 'vitality'), META_UPGRADES.vitality.cost(1));
      r = canBuyUpgrade(s, 'second_ember');
      assert.equal(r.ok, false);
      assert.equal(r.code, 'requires');
      assert.match(r.reason, /Benötigt/);

      const before = s.ash;
      assert.equal(buyUpgrade(s, 'vitality'), true);
      assert.equal(upgradeLevel(s, 'vitality'), 1);
      assert.equal(s.ash, before - META_UPGRADES.vitality.cost(1));
      assert.equal(events.length, 1);
      assert.equal(events[0].save, s);
      assert.equal(loadSave().upgrades.vitality, 1, 'persisted');

      while (buyUpgrade(s, 'vitality'));
      assert.equal(upgradeLevel(s, 'vitality'), 5);
      assert.equal(upgradeCost(s, 'vitality'), null);
      assert.equal(canBuyUpgrade(s, 'vitality').code, 'max');
      assert.equal(buyUpgrade(s, 'second_ember'), true);
      assert.equal(getRunBonuses(s).revives, 1);

      const info = upgradeInfo(s, 'might');
      assert.equal(info.level, 0);
      assert.equal(info.canBuy, true);
      assert.ok(info.next.includes('%'));

      const spent = spentAsh(s);
      const ashBefore = s.ash;
      assert.equal(refundAll(s), spent);
      assert.equal(s.ash, ashBefore + spent);
      assert.equal(s.ash, 10000);
      assert.deepEqual(s.upgrades, {});
      assert.equal(spentAsh(s), 0);
    } finally {
      off();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// progression.js — difficulty, unlocks, ash
// ---------------------------------------------------------------------------------------------
describe('difficulty', () => {
  const HARMFUL_UP = ['enemyHp', 'enemyDamage', 'enemySpeed', 'eliteChance', 'extraAffixes', 'spawnBudget', 'shopPrice', 'bossHp'];
  test('11 Glutstufen, baseline at 0, monotonic, every level adds something', () => {
    assert.equal(DIFFICULTIES.length, 11);
    assert.deepEqual({ ...DIFFICULTIES[0].mods }, {
      enemyHp: 1, enemyDamage: 1, enemySpeed: 1, eliteChance: 0, extraAffixes: 0, spawnBudget: 1, ashMult: 1, healMult: 1, shopPrice: 1, bossHp: 1,
    });
    assert.equal(DIFFICULTIES[0].name, 'Erste Glut');
    for (let i = 0; i < 11; i++) {
      const d = DIFFICULTIES[i];
      assert.equal(d.level, i);
      assert.ok(d.name && d.desc);
      if (i === 0) continue;
      const p = DIFFICULTIES[i - 1].mods, m = d.mods;
      for (const k of HARMFUL_UP) assert.ok(m[k] >= p[k], `${k} at ${i}`);
      assert.ok(m.healMult <= p.healMult);
      assert.ok(m.ashMult > p.ashMult);
      assert.ok(Math.abs(m.ashMult - p.ashMult - 0.15) < 1e-9);
      const harder = HARMFUL_UP.some((k) => m[k] > p[k]) || m.healMult < p.healMult;
      assert.ok(harder, `level ${i} adds a twist`);
    }
    assert.equal(getDifficulty(3), DIFFICULTIES[3]);
    assert.equal(getDifficulty(99), DIFFICULTIES[10]);
    assert.equal(getDifficulty(DIFFICULTIES[4]), DIFFICULTIES[4]);
  });

  test('winning at N unlocks N+1', () => {
    const s = defaultSave();
    assert.equal(difficultyUnlocked(s), 0);
    s.stats.wins = 1; s.stats.highestDifficultyWon = 0;
    const got = checkUnlocks(s);
    assert.ok(got.some((u) => u.type === 'difficulty' && u.id === 1));
    assert.equal(difficultyUnlocked(s), 1);
    s.stats.highestDifficultyWon = 10;
    checkUnlocks(s);
    assert.equal(difficultyUnlocked(s), 10);
  });
});

describe('unlock rules', () => {
  test('characters', () => {
    const s = defaultSave();
    assert.deepEqual(Object.keys(CHARACTER_UNLOCKS).sort(), ['bearer', 'revenant', 'shadow', 'warden', 'weaver']);
    assert.equal(isCharacterUnlocked(s, 'bearer'), true);
    for (const id of ['shadow', 'warden', 'weaver', 'revenant']) {
      assert.equal(isCharacterUnlocked(s, id), false, id);
      assert.ok(characterUnlockText(id).length > 5);
    }
    s.codex.bosses.boss_cinder = { seen: true, kills: 1, bestTime: 0 };
    assert.equal(isCharacterUnlocked(s, 'shadow'), true);
    s.stats.bestFloor = 3;
    assert.equal(isCharacterUnlocked(s, 'warden'), true);
    assert.equal(characterUnlockProgress(s, 'revenant').ratio, 0);
    s.stats.wins = 1;
    assert.equal(isCharacterUnlocked(s, 'revenant'), true);
    assert.equal(isCharacterUnlocked(s, 'nobody'), false);
  });

  test('weaver: boss_rime or 400 ash', () => {
    const s = defaultSave();
    s.ash = 399;
    assert.equal(characterUnlockProgress(s, 'weaver').canBuy, false);
    assert.equal(buyCharacter(s, 'weaver'), false);
    s.ash = 450;
    assert.equal(characterUnlockProgress(s, 'weaver').price, 400);
    assert.equal(buyCharacter(s, 'weaver'), true);
    assert.equal(s.ash, 50);
    assert.equal(isCharacterUnlocked(s, 'weaver'), true);
    assert.equal(buyCharacter(s, 'weaver'), false, 'only once');
    assert.equal(buyCharacter(s, 'shadow'), false, 'not purchasable');
    const t = defaultSave();
    t.codex.bosses.boss_rime = { seen: true, kills: 1, bestTime: 0 };
    assert.equal(isCharacterUnlocked(t, 'weaver'), true);
  });

  test('weapons', () => {
    assert.equal(WEAPON_IDS.length, 15);
    assert.deepEqual(Object.keys(WEAPON_UNLOCKS).sort(), [...WEAPON_IDS].sort());
    const s = defaultSave();
    assert.deepEqual(unlockedWeapons(s).sort(), [...START_WEAPONS].sort());
    for (const id of WEAPON_IDS) assert.ok(weaponUnlockText(id).length > 5);
    s.stats.kills = 200;
    assert.ok(isWeaponUnlocked(s, 'spark_chain'));
    s.codex.bosses.boss_cinder = { seen: true, kills: 2, bestTime: 0 };
    assert.ok(!isWeaponUnlocked(s, 'magma_mortar'));
    s.codex.bosses.boss_cinder.kills = 3;
    assert.ok(isWeaponUnlocked(s, 'magma_mortar'));
    s.stats.bestFloor = 4;
    assert.ok(isWeaponUnlocked(s, 'rift_orb'));
    s.stats.deaths = 10;
    assert.ok(isWeaponUnlocked(s, 'soul_siphon'));
    s.stats.wins = 1; s.stats.highestDifficultyWon = 0;
    assert.ok(isWeaponUnlocked(s, 'star_bow'));
    assert.ok(!isWeaponUnlocked(s, 'glaive_orbit'));
    s.stats.highestDifficultyWon = 1;
    assert.ok(isWeaponUnlocked(s, 'glaive_orbit'));
    assert.equal(unlockedWeapons(s).length, 15);
    assert.ok(isWeaponUnlocked(s, 'some_future_weapon'), 'unknown ids are not gated');
  });

  test('checkUnlocks reports each unlock once and records it', () => {
    const s = defaultSave();
    assert.deepEqual(checkUnlocks(s), []);
    s.codex.bosses.boss_cinder = { seen: true, kills: 3, bestTime: 0 };
    s.stats.kills = 250;
    const got = checkUnlocks(s);
    const keys = got.map((u) => `${u.type}:${u.id}`).sort();
    assert.deepEqual(keys, ['character:shadow', 'weapon:magma_mortar', 'weapon:spark_chain']);
    for (const u of got) assert.ok(u.name && typeof u.name === 'string');
    assert.deepEqual(checkUnlocks(s), [], 'idempotent');
    assert.ok(s.unlocks.characters.includes('shadow'));
    assert.ok(s.unlocks.weapons.includes('spark_chain'));
    // recorded unlocks stay unlocked even if the source data were lost
    s.codex.bosses = {};
    assert.ok(isCharacterUnlocked(s, 'shadow'));
    assert.ok(isWeaponUnlocked(s, 'magma_mortar'));
  });
});

describe('ash reward', () => {
  const sum = (r) => r.parts.reduce((a, p) => a + p.amount, 0);
  test('early failed runs give ~25–60', () => {
    for (const [floor, stats] of [[1, { kills: 25, eliteKills: 1 }], [1, { kills: 45, eliteKills: 2 }], [2, { kills: 80, eliteKills: 3, bossKills: 1 }]]) {
      const r = computeAshReward({ floor, victory: false, stats });
      assert.ok(r.total >= 25 && r.total <= 60, `floor ${floor}: ${r.total}`);
      assert.equal(sum(r), r.total);
      for (const p of r.parts) assert.ok(typeof p.label === 'string' && p.label.length > 2);
    }
    // instant abandon is worth (almost) nothing
    assert.ok(computeAshReward({ floor: 1, stats: { kills: 0 } }).total < 5);
  });

  test('full win at Glutstufe 0 gives ~240–340 (full altar ≈ 60–100 runs)', () => {
    for (const stats of [{ kills: 320, eliteKills: 10, bossKills: 5 }, { kills: 420, eliteKills: 20, bossKills: 5, ashPickedUp: 15 }]) {
      const r = computeAshReward({ floor: 5, victory: true, stats, difficulty: DIFFICULTIES[0], ashPickedUp: stats.ashPickedUp });
      assert.ok(r.total >= 240 && r.total <= 340, `win: ${r.total}`);
      assert.equal(sum(r), r.total);
      assert.ok(r.parts.some((p) => /Sonnenherz/.test(p.label)));
    }
  });

  test('scales with Glutstufe and ashGain, picked-up ash is not multiplied', () => {
    const stats = { kills: 380, eliteKills: 15, bossKills: 5 };
    let prev = 0;
    for (let lv = 0; lv <= 10; lv++) {
      const t = computeAshReward({ floor: 5, victory: true, stats, difficulty: lv }).total;
      assert.ok(t > prev, `level ${lv}`);
      prev = t;
    }
    const base = computeAshReward({ floor: 5, victory: true, stats }).total;
    const lv10 = computeAshReward({ floor: 5, victory: true, stats, difficulty: DIFFICULTIES[10] }).total;
    assert.ok(Math.abs(lv10 / base - 2.5) < 0.02);
    const gain = computeAshReward({ floor: 5, victory: true, stats, ashGain: 1.3 });
    assert.ok(Math.abs(gain.total / base - 1.3) < 0.02);
    assert.ok(gain.parts.some((p) => p.kind === 'ashGain'));
    const picked = computeAshReward({ floor: 5, victory: true, stats, difficulty: 10, ashPickedUp: 20 });
    assert.equal(picked.total, lv10 + 20);
    // garbage input does not throw
    assert.doesNotThrow(() => computeAshReward({ floor: 'x', stats: null, difficulty: {}, ashGain: NaN }));
    assert.doesNotThrow(() => computeAshReward());
  });

  test('deeper is always better', () => {
    let prev = -1;
    for (let f = 1; f <= 5; f++) {
      const t = computeAshReward({ floor: f, stats: { kills: 30 * f, bossKills: f - 1 } }).total;
      assert.ok(t > prev);
      prev = t;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// tracker + achievements (synthetic events on a private bus)
// ---------------------------------------------------------------------------------------------
function fakeRun(over = {}) {
  return {
    seed: 1, seedLabel: 'TEST-1', character: 'bearer', difficulty: DIFFICULTIES[0], floorIndex: 1, time: 0,
    revives: 0,
    stats: { kills: 0, eliteKills: 0, bossKills: 0, damageDealt: 0, damageTaken: 0, roomsCleared: 0, floorsCleared: 0, sparksCollected: 0, relicsFound: 0, critHits: 0, dashes: 0, bestHit: 0, hitsTaken: 0, healed: 0 },
    player: { hp: 100, alive: true, level: 1, sparks: 0, stats: { ashGain: 1, maxHp: 100 }, relics: [], boons: [], weapons: [{ id: 'ember_bolt', level: 1 }, null] },
    flags: {},
    ...over,
  };
}
const enemy = (id, extra = {}) => ({ id, def: { id, name: id }, elite: [], boss: false, ...extra });
const boss = (id) => ({ id, def: { id, name: id, boss: true }, elite: [], boss: true });
function summaryOf(run, victory, extra = {}) {
  return {
    victory, character: run.character, difficulty: run.difficulty.level, floor: run.floorIndex, biome: 'ash', time: run.time,
    seedLabel: run.seedLabel, stats: run.stats, relics: [], boons: [], weapons: [{ id: 'ember_bolt', level: 2 }], ash: 0, ...extra,
  };
}
function collect(b, evt) {
  const list = [];
  b.on(evt, (p) => list.push(p));
  return list;
}
function killMany(b, run, n, id = 'ash_crawler') {
  for (let i = 0; i < n; i++) {
    const e = enemy(id);
    b.emit('enemy:spawn', { enemy: e });
    run.stats.kills++;
    b.emit('enemy:death', { enemy: e, elite: false, boss: false });
  }
}

describe('tracker', () => {
  let b, game, dispose;
  beforeEach(() => {
    b = new Bus();
    game = { save: defaultSave(), run: null, state: 'menu' };
    dispose = initTracker(game, { bus: b });
  });
  afterEach(() => dispose());

  test('run start → kills → boss → death: ash, stats, codex, history, unlock toasts', () => {
    const toasts = collect(b, 'ui:toast');
    const changes = collect(b, 'meta:change');
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    assert.equal(game.save.stats.runs, 1);
    assert.equal(game.save.codex.weapons.ember_bolt, 1, 'starting weapon counted');

    killMany(b, run, 30);
    const elite = enemy('cinder_bat', { elite: ['swift'] });
    b.emit('enemy:spawn', { enemy: elite });
    run.stats.kills++; run.stats.eliteKills++;
    b.emit('enemy:death', { enemy: elite, elite: true, boss: false });
    assert.deepEqual(game.save.codex.enemies.ash_crawler, { seen: true, kills: 30 });
    assert.equal(game.save.codex.enemies.cinder_bat.kills, 1);
    assert.equal(game.save.stats.kills, 31);
    assert.equal(game.save.stats.eliteKills, 1);

    b.emit('relic:gain', { id: 'whetstone', def: { id: 'whetstone', rarity: 'common' } });
    b.emit('curse:gain', { id: 'curse_frail', def: { id: 'curse_frail', rarity: 'curse' } });
    b.emit('weapon:gain', { id: 'flame_lance' });
    b.emit('weapon:gain', { id: 'flame_lance' });
    assert.equal(game.save.codex.relics.whetstone, 1);
    assert.equal(game.save.codex.relics.curse_frail, 1);
    assert.equal(game.save.codex.weapons.flame_lance, 1, 'counted once per run');

    const bz = boss('boss_cinder');
    run.time = 400;
    b.emit('enemy:spawn', { enemy: bz });
    b.emit('boss:start', { boss: bz });
    assert.equal(game.save.codex.bosses.boss_cinder.seen, true);
    assert.equal(game.save.codex.enemies.boss_cinder, undefined, 'bosses are not regular enemies');
    run.time = 475.5;
    run.stats.kills++; run.stats.bossKills++;
    b.emit('enemy:death', { enemy: bz, elite: false, boss: true });
    b.emit('boss:death', { boss: bz });
    assert.equal(game.save.codex.bosses.boss_cinder.kills, 1);
    assert.equal(game.save.codex.bosses.boss_cinder.bestTime, 75.5);

    run.floorIndex = 2;
    killMany(b, run, 10, 'spore_puff');
    run.time = 700;
    run.stats.roomsCleared = 9;
    const summary = summaryOf(run, false, { killedBy: { name: 'Sporenquall' } });
    b.emit('run:end', { run, victory: false, summary });

    assert.ok(summary.ash >= 25 && summary.ash <= 70, `ash ${summary.ash}`);
    assert.ok(Array.isArray(summary.ashParts) && summary.ashParts.length >= 3);
    assert.equal(summary.ashParts.reduce((a, p) => a + p.amount, 0), summary.ash);
    assert.equal(game.save.ash, summary.ash);
    assert.equal(game.save.totalAsh, summary.ash);
    assert.equal(game.save.stats.deaths, 1);
    assert.equal(game.save.stats.wins, 0);
    assert.equal(game.save.stats.bestFloor, 2);
    assert.equal(game.save.stats.playTime, 700);
    assert.equal(game.save.characterStats.bearer.runs, 1);
    assert.equal(game.save.characterStats.bearer.deaths, 1);
    assert.equal(game.save.history.length, 1);
    const h = game.save.history[0];
    assert.equal(h.floor, 2);
    assert.equal(h.victory, false);
    assert.equal(h.ash, summary.ash);
    assert.equal(h.killedBy, 'Sporenquall');
    assert.equal(h.character, 'bearer');
    // unlock: shadow (boss_cinder defeated)
    const unlockToasts = toasts.filter((t) => t.kind === 'unlock');
    assert.ok(unlockToasts.some((t) => /Schattenläuferin/.test(t.text)), JSON.stringify(unlockToasts));
    assert.ok(game.save.unlocks.characters.includes('shadow'));
    assert.deepEqual(summary.unlocks.map((u) => u.id), ['shadow']);
    assert.ok(changes.length >= 1);
    // persisted
    const stored = loadSave();
    assert.equal(stored.ash, summary.ash);
    assert.equal(stored.history.length, 1);

    // a second run:end for the same run is ignored
    b.emit('run:end', { run, victory: false, summary: summaryOf(run, false) });
    assert.equal(game.save.history.length, 1);
    assert.equal(game.save.stats.deaths, 1);
  });

  test('victory: wins, fastest win, Glutstufe + revenant + star_bow unlocks, history cap', () => {
    const toasts = collect(b, 'ui:toast');
    game.save.history = Array.from({ length: HISTORY_MAX }, () => ({ date: 1, victory: false, character: 'bearer', difficulty: 0, floor: 1, time: 10, ash: 1 }));
    const run = fakeRun({ floorIndex: 5, time: 1500, character: 'shadow' });
    run.stats.kills = 380; run.stats.eliteKills = 15; run.stats.bossKills = 5; run.stats.ashPickedUp = 10;
    game.run = run;
    b.emit('run:start', { run });
    const summary = summaryOf(run, true);
    b.emit('run:end', { run, victory: true, summary });
    assert.ok(summary.ash >= 240 && summary.ash <= 350, `ash ${summary.ash}`);
    assert.equal(game.save.stats.wins, 1);
    assert.equal(game.save.stats.fastestWin, 1500);
    assert.equal(game.save.stats.highestDifficultyWon, 0);
    assert.equal(game.save.unlocks.difficulties, 1);
    assert.equal(game.save.characterStats.shadow.wins, 1);
    assert.equal(game.save.history.length, HISTORY_MAX);
    assert.equal(game.save.history[0].victory, true);
    const texts = toasts.map((t) => t.text).join(' | ');
    assert.match(texts, /Glutstufe 1/);
    assert.match(texts, /Aschenkind/);
    assert.ok(game.save.unlocks.weapons.includes('star_bow'));
    assert.ok(toasts.every((t) => t.kind === 'unlock' && t.icon && GLYPHS.has(t.icon.glyph)));
  });

  test('abandoned runs count as abandons, not deaths', () => {
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    b.emit('run:end', { run, victory: false, summary: summaryOf(run, false, { abandoned: true }) });
    assert.equal(game.save.stats.deaths, 0);
    assert.equal(game.save.stats.abandons, 1);
  });

  test('lifetime counters and sparing persistence', () => {
    let t = 0;
    dispose();
    dispose = initTracker(game, { bus: b, now: () => t });
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    storage.clear();
    killMany(b, run, 5);
    assert.equal(storage.getItem(SAVE_KEY), null, 'no write on every kill');
    t = 25000;
    killMany(b, run, 1);
    assert.ok(storage.getItem(SAVE_KEY), 'periodic write after ~20 s');
    b.emit('player:fall', {});
    b.emit('prop:open', { kind: 'barrel', prop: {} });
    b.emit('prop:open', { kind: 'chest', prop: {} });
    b.emit('shop:buy', { offer: {}, price: 40 });
    b.emit('player:levelup', { level: 4 });
    b.emit('boon:gain', { id: 'boon_might', def: { id: 'boon_might' }, stacks: 1 });
    const st = game.save.stats;
    assert.equal(st.falls, 1);
    assert.equal(st.barrels, 1);
    assert.equal(st.chests, 1);
    assert.equal(st.purchases, 1);
    assert.equal(st.sparksSpent, 40);
    assert.equal(st.bestLevel, 4);
    assert.equal(game.save.codex.boons.boon_might, 1);
    storage.clear();
    game.save.settings.master = 0.2;
    b.emit('settings:change', { settings: game.save.settings });
    assert.equal(loadSave().settings.master, 0.2, 'settings persisted immediately');
  });

  test('dispose unsubscribes everything', () => {
    dispose();
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    killMany(b, run, 3);
    b.emit('run:end', { run, victory: false, summary: summaryOf(run, false) });
    assert.equal(game.save.stats.runs, 0);
    assert.equal(game.save.stats.kills, 0);
    assert.equal(game.save.ash, 0);
    let n = 0;
    for (const l of b.map.values()) n += l.length;
    assert.equal(n, 0);
  });

  test('tolerates missing save/run and malformed payloads', () => {
    game.save = null;
    assert.doesNotThrow(() => {
      b.emit('enemy:death', { enemy: enemy('x') });
      b.emit('run:end', {});
    });
    game.save = { ash: 3 };
    b.emit('enemy:death', { enemy: enemy('ash_crawler') });
    b.emit('enemy:spawn', {});
    b.emit('boss:death', {});
    b.emit('run:end', { run: fakeRun(), victory: false, summary: undefined });
    assert.equal(game.save.stats.kills, 1);
    assert.ok(game.save.ash >= 3);
  });

  test('applyRunEnd is usable without the bus', () => {
    const s = defaultSave();
    const run = fakeRun({ floorIndex: 3 });
    run.stats.kills = 120; run.stats.bossKills = 2;
    const summary = summaryOf(run, false);
    const { reward, unlocks } = applyRunEnd(s, { run, victory: false, summary });
    assert.equal(s.ash, reward.total);
    assert.equal(summary.ash, reward.total);
    assert.ok(unlocks.some((u) => u.id === 'warden'));
  });
});

describe('achievements', () => {
  let b, game, disposeT, disposeA;
  beforeEach(() => {
    b = new Bus();
    game = { save: defaultSave(), run: null };
    disposeT = initTracker(game, { bus: b });
    disposeA = initAchievements(game, { bus: b });
  });
  afterEach(() => { disposeA(); disposeT(); });

  test('36–45 well-formed achievements', () => {
    assert.ok(ACHIEVEMENT_LIST.length >= 36 && ACHIEVEMENT_LIST.length <= 45, `count ${ACHIEVEMENT_LIST.length}`);
    const ids = new Set();
    for (const a of ACHIEVEMENT_LIST) {
      assert.ok(!ids.has(a.id)); ids.add(a.id);
      assert.ok(a.name && a.desc);
      assert.ok(GLYPHS.has(a.icon.glyph), `${a.id}: ${a.icon.glyph}`);
      if (a.reward) assert.ok(a.reward.ash > 0);
    }
    assert.ok(ACHIEVEMENT_LIST.filter((a) => a.secret).length >= 3);
    assert.ok(ROSTER_ENEMY_IDS.includes('ash_crawler') && ROSTER_ENEMY_IDS.includes('shade'));
    assert.deepEqual(achievementProgress(defaultSave()), { unlocked: 0, total: ACHIEVEMENT_LIST.length, ratio: 0 });
  });

  test('boss kill without damage unlocks boss + flawless + floor achievements exactly once, with rewards', () => {
    const unlocks = collect(b, 'achievement:unlock');
    const toasts = collect(b, 'ui:toast');
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    b.emit('floor:enter', { run, floor: {}, biome: {} });
    const bz = boss('boss_cinder');
    b.emit('enemy:spawn', { enemy: bz });
    b.emit('boss:start', { boss: bz });
    b.emit('enemy:death', { enemy: bz, elite: false, boss: true });
    b.emit('boss:death', { boss: bz });
    const ids = unlocks.map((u) => u.id).sort();
    assert.deepEqual(ids, ['boss_cinder', 'boss_flawless', 'floor_hitless']);
    const reward = ['boss_cinder', 'boss_flawless', 'floor_hitless'].reduce((a, id) => a + ACHIEVEMENTS[id].reward.ash, 0);
    assert.equal(game.save.ash, reward);
    assert.ok(game.save.achievements.boss_cinder > 0);
    const at = toasts.filter((t) => t.kind === 'achievement');
    assert.equal(at.length, 3);
    assert.ok(at.some((t) => t.text === `Erfolg: ${ACHIEVEMENTS.boss_cinder.name}` && t.icon && t.icon.glyph));
    // again: nothing new
    b.emit('boss:start', { boss: bz });
    b.emit('boss:death', { boss: bz });
    assert.equal(unlocks.length, 3);
    assert.equal(game.save.ash, reward);
    assert.equal(loadSave().achievements.boss_flawless, game.save.achievements.boss_flawless, 'persisted');
  });

  test('taking damage breaks flawless, streak and hitless floor', () => {
    const unlocks = collect(b, 'achievement:unlock');
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    killMany(b, run, 49);
    b.emit('player:hit', { amount: 5, type: 'phys', source: null, hp: 95, maxHp: 100 });
    killMany(b, run, 49);
    assert.ok(!unlocks.some((u) => u.id === 'streak_50'));
    killMany(b, run, 1);
    assert.ok(unlocks.some((u) => u.id === 'streak_50'));
    const bz = boss('boss_mycel');
    b.emit('boss:start', { boss: bz });
    b.emit('player:hit', { amount: 3, type: 'poison', source: null, hp: 92, maxHp: 100, dot: true });
    b.emit('boss:death', { boss: bz });
    const ids = unlocks.map((u) => u.id);
    assert.ok(ids.includes('boss_mycel'));
    assert.ok(!ids.includes('boss_flawless'));
    assert.ok(!ids.includes('floor_hitless'));
  });

  test('fun/secret achievements: falls, barrels, sparks, curses, level, first room death', () => {
    const unlocks = collect(b, 'achievement:unlock');
    const run = fakeRun();
    game.run = run;
    b.emit('run:start', { run });
    for (let i = 0; i < 9; i++) b.emit('player:fall', {});
    assert.ok(!game.save.achievements.falls_10);
    b.emit('player:fall', {});
    assert.ok(game.save.achievements.falls_10);
    for (let i = 0; i < 100; i++) b.emit('prop:open', { kind: 'barrel', prop: {} });
    assert.ok(game.save.achievements.barrels_100);
    run.player.sparks = 520;
    b.emit('pickup:collect', { kind: 'spark', amount: 3 });
    assert.ok(game.save.achievements.sparks_500);
    const curse = (id) => ({ id, def: { id, rarity: 'curse' }, stacks: 1 });
    run.player.relics.push(curse('c1'), curse('c2'));
    b.emit('curse:gain', { id: 'c2', def: { id: 'c2', rarity: 'curse' } });
    assert.ok(!game.save.achievements.curses_3);
    run.player.relics.push(curse('c3'));
    b.emit('curse:gain', { id: 'c3', def: { id: 'c3', rarity: 'curse' } });
    assert.ok(game.save.achievements.curses_3);
    b.emit('player:levelup', { level: 15 });
    assert.ok(game.save.achievements.level_15);
    b.emit('relic:gain', { id: 'sun_crown', def: { id: 'sun_crown', rarity: 'legendary' } });
    assert.ok(game.save.achievements.legendary);
    b.emit('boon:gain', { id: 'boon_might', def: { id: 'boon_might', maxStacks: 5 }, stacks: 5 });
    assert.ok(game.save.achievements.boon_max);
    b.emit('weapon:upgrade', { id: 'ember_bolt', level: 5 });
    assert.ok(game.save.achievements.weapon_max);
    b.emit('enemy:hit', { enemy: enemy('x'), amount: 612, crit: true, type: 'fire', killed: true });
    assert.ok(game.save.achievements.big_hit);
    b.emit('room:enter', { room: { type: 'secret' }, first: true });
    assert.ok(game.save.achievements.secret_room);
    b.emit('player:death', { run });
    assert.ok(game.save.achievements.die_first_room);
    assert.ok(game.save.achievements.first_death);
    const counts = {};
    for (const u of unlocks) counts[u.id] = (counts[u.id] || 0) + 1;
    assert.ok(Object.values(counts).every((n) => n === 1), JSON.stringify(counts));
  });

  test('victory achievements: win, character, Glutstufe, fast, no shop, cursed', () => {
    const run = fakeRun({ character: 'warden', difficulty: DIFFICULTIES[3], floorIndex: 5, time: 1100 });
    run.stats.kills = 300; run.stats.bossKills = 5;
    run.player.relics.push({ id: 'c1', def: { rarity: 'curse' } }, { id: 'c2', def: { rarity: 'curse' } });
    game.run = run;
    b.emit('run:start', { run });
    b.emit('run:end', { run, victory: true, summary: summaryOf(run, true) });
    const a = game.save.achievements;
    for (const id of ['first_win', 'win_warden', 'heat_1', 'heat_3', 'win_fast', 'win_no_shop', 'win_cursed']) assert.ok(a[id], id);
    assert.ok(!a.heat_5);
    assert.ok(!a.win_bearer);
    // tracker unlocks shown, achievements counted via saved state as well
    assert.equal(game.save.unlocks.difficulties, 4);
  });

  test('buying in a shop prevents "Asket"; slow wins are not fast', () => {
    const run = fakeRun({ floorIndex: 5, time: 1900 });
    game.run = run;
    b.emit('run:start', { run });
    b.emit('shop:buy', { offer: {}, price: 30 });
    b.emit('run:end', { run, victory: true, summary: summaryOf(run, true) });
    assert.ok(game.save.achievements.first_win);
    assert.ok(game.save.achievements.win_bearer);
    assert.ok(!game.save.achievements.win_no_shop);
    assert.ok(!game.save.achievements.win_fast);
  });

  test('save-state achievements are retroactive and chain through rewards', () => {
    disposeA();
    const s = game.save;
    s.totalAsh = 990;
    s.ash = 0;
    s.upgrades.vitality = 1;
    for (const id of WEAPON_IDS) s.codex.weapons[id] = 1;
    for (const id of ROSTER_ENEMY_IDS) s.codex.enemies[id] = { seen: true, kills: 1 };
    const unlocks = collect(b, 'achievement:unlock');
    disposeA = initAchievements(game, { bus: b });
    const ids = unlocks.map((u) => u.id);
    for (const id of ['altar_first', 'weapons_all', 'enemies_all', 'ash_1000']) assert.ok(ids.includes(id), id);
    assert.ok(s.totalAsh >= 1000);
    const st = achievementStatus(s);
    assert.equal(st.length, ACHIEVEMENT_LIST.length);
    const hidden = st.find((x) => x.id === 'die_first_room');
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.name, '???');
    const shown = st.find((x) => x.id === 'weapons_all');
    assert.equal(shown.unlocked, true);
    assert.ok(shown.date > 0);
    assert.equal(achievementProgress(s).unlocked, Object.keys(s.achievements).length);
  });
});

// ---------------------------------------------------------------------------------------------
// codex.js
// ---------------------------------------------------------------------------------------------
describe('codex', () => {
  const ENEMIES = {
    ash_crawler: { id: 'ash_crawler', name: 'Aschekriecher', desc: 'Krabbelt.', biome: 'ash', hp: 22 },
    shade: { id: 'shade', name: 'Schemen', desc: 'Huscht.', biome: 'void', hp: 30 },
    spore_puff: { id: 'spore_puff', name: 'Sporenbovist', desc: 'Platzt.', biome: 'fungal', hp: 18 },
  };
  const BOSSES = { boss_cinder: { id: 'boss_cinder', name: 'Schlackenkönig', title: 'Herr der Aschegruben', biome: 'ash', boss: true } };
  const RELICS = {
    whetstone: { id: 'whetstone', name: 'Wetzstein', rarity: 'common' },
    curse_frail: { id: 'curse_frail', name: 'Fluch der Brüchigkeit', rarity: 'curse' },
    sun_crown: { id: 'sun_crown', name: 'Sonnenkrone', rarity: 'legendary' },
  };
  const WEAPONS = { ember_bolt: { id: 'ember_bolt', name: 'Glutbolzen', rarity: 'common' }, star_bow: { id: 'star_bow', name: 'Sternenbogen', rarity: 'rare' } };

  test('lists flag undiscovered entries and sort sensibly', () => {
    const s = defaultSave();
    s.codex.enemies.shade = { seen: true, kills: 4 };
    s.codex.bosses.boss_cinder = { seen: true, kills: 2, bestTime: 61 };
    s.codex.relics.curse_frail = 1;
    s.codex.weapons.ember_bolt = 3;
    const en = codexEnemies(s, ENEMIES);
    assert.deepEqual(en.map((e) => e.id), ['ash_crawler', 'spore_puff', 'shade']);
    assert.equal(en[0].seen, false);
    assert.equal(en[0].name, '???');
    assert.equal(en[2].name, 'Schemen');
    assert.equal(en[2].kills, 4);
    const bo = codexBosses(s, BOSSES);
    assert.equal(bo[0].kills, 2);
    assert.equal(bo[0].bestTime, 61);
    const re = codexRelics(s, RELICS);
    assert.deepEqual(re.map((r) => r.id), ['whetstone', 'sun_crown', 'curse_frail']);
    assert.equal(re[2].curse, true);
    const we = codexWeapons(s, WEAPONS);
    assert.equal(we[0].id, 'ember_bolt');
    assert.equal(we[0].count, 3);
    const bow = we.find((w) => w.id === 'star_bow');
    assert.equal(bow.unlocked, false);
    assert.match(bow.unlockText, /Gewinne/);
    const comp = codexCompletion(s, { ENEMIES, bosses: BOSSES, relics: RELICS, weapons: WEAPONS });
    assert.deepEqual(comp.enemies, { found: 1, total: 3, pct: 33 });
    assert.equal(comp.bosses.pct, 100);
    assert.equal(comp.total.found, 4);
    assert.equal(comp.total.total, 9);
  });

  test('STAT_LABELS cover every §6.2 stat and format German values', () => {
    for (const k of STAT_NAMES) {
      assert.ok(STAT_LABELS[k], `missing label for ${k}`);
      assert.ok(STAT_LABELS[k].name && STAT_LABELS[k].fmt);
    }
    assert.equal(formatStatValue('damage', 1.2), '120 %');
    assert.equal(formatStatValue('critChance', 0.125), '12,5 %');
    assert.equal(formatStatValue('critMult', 1.75), '×1,75');
    assert.equal(formatStatValue('dashCooldown', 1.1), '1,1 s');
    assert.equal(formatStatValue('maxHp', 1234), '1.234');
    assert.equal(formatStatValue('lightRadius', 110), '110 px');
    const sheet = statSheet({ maxHp: 120, damage: 1, dashCooldown: 0.9 }, { maxHp: 100, damage: 1, dashCooldown: 1.1 });
    const rows = sheet.flatMap((g) => g.rows);
    assert.equal(rows.find((r) => r.stat === 'maxHp').better, true);
    assert.equal(rows.find((r) => r.stat === 'dashCooldown').better, true);
    assert.equal(rows.find((r) => r.stat === 'damage').changed, false);
  });

  test('lifetime stat formatting', () => {
    assert.deepEqual(formatStat('kills', 12345), { key: 'kills', label: 'Besiegte Gegner', text: '12.345', value: 12345 });
    assert.equal(formatStat('playTime', 3 * 3600 + 15 * 60).text, '3 Std. 15 Min.');
    assert.equal(formatStat('fastestWin', 0).text, '–');
    assert.equal(formatStat('fastestWin', 1199).text, '19:59');
    assert.equal(formatStat('bestFloor', 3).text, 'Ebene 3');
    assert.equal(formatStat('highestDifficultyWon', -1).text, '–');
    assert.equal(formatStat('highestDifficultyWon', 4).text, 'Glutstufe 4');
    const list = lifetimeStats(defaultSave());
    assert.ok(list.length > 20);
    assert.ok(list.every((r) => typeof r.label === 'string' && typeof r.text === 'string'));
  });
});
