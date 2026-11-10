// Permanent progression: Aschealtar upgrades, Glutstufen (difficulty), unlock rules and the ash reward.
// DOM-free. Everything here is pure data + functions on the save object.
import { bus } from '../core/events.js';
import { biomeForFloor } from '../data/biomes.js';
import { persistSave, MAX_DIFFICULTY } from './save.js';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const r4 = (n) => Math.round(n * 10000) / 10000;
const clampInt = (n, a, b) => Math.max(a, Math.min(b, Math.floor(Number.isFinite(n) ? n : a)));
/** 0.125 -> "12,5" (German decimal comma, no trailing zeros) */
const pct = (frac) => String(Math.round(frac * 1000) / 10).replace('.', ',');
const de = (n, digits = 2) => String(Math.round(n * 10 ** digits) / 10 ** digits).replace('.', ',');

/**
 * Build a description that works both as `desc(level)` and as a plain string
 * (`String(desc)` / template literals / textContent give the general text).
 */
function describe(general, atLevel) {
  const fn = (level) => (level > 0 ? atLevel(level) : general);
  fn.toString = () => general;
  return fn;
}

function emitChange(save) {
  persistSave(save);
  bus.emit('meta:change', { save });
}

// ---------------------------------------------------------------------------------------------
// Aschealtar upgrades
// ---------------------------------------------------------------------------------------------
function branch(id, name, desc, glyph, color) {
  return Object.freeze({ id, name, desc, color, icon: Object.freeze({ glyph, color }), toString() { return name; } });
}

/** Branch id -> display info. `String(UPGRADE_BRANCHES[id])` is the German name. */
export const UPGRADE_BRANCHES = Object.freeze({
  'körper': branch('körper', 'Körper', 'Leben, Schutz und Heilung.', 'heart', '#ff6a5a'),
  glut: branch('glut', 'Glut', 'Schaden, Treffer und Fertigkeiten.', 'flame', '#ff8a3c'),
  geschick: branch('geschick', 'Geschick', 'Tempo, Ausweichen und Wahrnehmung.', 'feather', '#8fd8ff'),
  schicksal: branch('schicksal', 'Schicksal', 'Glück, Reichtum und Vorsehung.', 'dice', '#c9a0ff'),
});
export const UPGRADE_BRANCH_ORDER = Object.freeze(['körper', 'glut', 'geschick', 'schicksal']);

const C = { 'körper': '#ff6a5a', glut: '#ff8a3c', geschick: '#8fd8ff', schicksal: '#c9a0ff' };

// `costs[i]` = ash for buying level i + 1. `mods(level)` = total stat modifiers at that level.
// `effect` = non-stat run bonus PER LEVEL (aggregated by getRunBonuses).
const UPGRADE_DEFS = [
  // --- Körper ---------------------------------------------------------------------------------
  {
    id: 'vitality', name: 'Herzfeuer', branch: 'körper', glyph: 'heart', maxLevel: 5, costs: [20, 50, 110, 200, 340],
    desc: describe('+10 maximales Leben pro Stufe.', (l) => `+${10 * l} maximales Leben.`),
    mods: (l) => [{ stat: 'maxHp', add: 10 * l }],
  },
  {
    id: 'slag_skin', name: 'Schlackenhaut', branch: 'körper', glyph: 'shield', maxLevel: 3, costs: [80, 200, 400],
    requires: { id: 'vitality', level: 2 },
    desc: describe('Jeder Treffer verursacht 1 Schaden weniger pro Stufe.', (l) => `Jeder Treffer verursacht ${l} Schaden weniger.`),
    mods: (l) => [{ stat: 'armor', add: l }],
  },
  {
    id: 'mending', name: 'Heilende Wärme', branch: 'körper', glyph: 'potion', maxLevel: 3, costs: [50, 120, 260],
    desc: describe('Jede Heilung wirkt 8 % stärker pro Stufe.', (l) => `Jede Heilung wirkt ${pct(0.08 * l)} % stärker.`),
    mods: (l) => [{ stat: 'healPower', add: r4(0.08 * l) }],
  },
  {
    id: 'descent_rest', name: 'Rast am Abstieg', branch: 'körper', glyph: 'candle', maxLevel: 3, costs: [60, 140, 300],
    desc: describe('Beim Betreten einer neuen Ebene heilst du 10 % deines maximalen Lebens pro Stufe.',
      (l) => `Beim Betreten einer neuen Ebene heilst du ${10 * l} % deines maximalen Lebens.`),
    effect: { healOnFloor: 0.1 },
  },
  {
    id: 'ash_shield', name: 'Aschepanzer', branch: 'körper', glyph: 'shield', maxLevel: 3, costs: [45, 110, 240],
    desc: describe('Beginne jeden Abstieg mit 15 Schild pro Stufe.', (l) => `Beginne jeden Abstieg mit ${15 * l} Schild.`),
    effect: { startShield: 15 },
  },
  {
    id: 'second_ember', name: 'Zweite Glut', branch: 'körper', glyph: 'ember', maxLevel: 1, costs: [1000],
    requires: { id: 'vitality', level: 3 },
    desc: describe('Einmal pro Abstieg: Statt zu fallen, erhebst du dich mit 30 % Leben aus der Asche.',
      () => 'Einmal pro Abstieg erhebst du dich mit 30 % Leben aus der Asche, statt zu fallen.'),
    effect: { revives: 1 },
  },
  // --- Glut -----------------------------------------------------------------------------------
  {
    id: 'might', name: 'Glühender Zorn', branch: 'glut', glyph: 'flame', maxLevel: 5, costs: [25, 60, 120, 220, 360],
    desc: describe('+4 % Schaden pro Stufe.', (l) => `+${pct(0.04 * l)} % Schaden.`),
    mods: (l) => [{ stat: 'damage', add: r4(0.04 * l) }],
  },
  {
    id: 'precision', name: 'Scharfes Auge', branch: 'glut', glyph: 'eye', maxLevel: 5, costs: [30, 65, 130, 230, 370],
    desc: describe('+2 % kritische Trefferchance pro Stufe.', (l) => `+${pct(0.02 * l)} % kritische Trefferchance.`),
    mods: (l) => [{ stat: 'critChance', add: r4(0.02 * l) }],
  },
  {
    id: 'white_heat', name: 'Weißglut', branch: 'glut', glyph: 'star', maxLevel: 3, costs: [90, 210, 420],
    requires: { id: 'precision', level: 2 },
    desc: describe('Kritische Treffer verursachen 10 % mehr Schaden pro Stufe.', (l) => `Kritische Treffer verursachen ${pct(0.1 * l)} % mehr Schaden.`),
    mods: (l) => [{ stat: 'critMult', add: r4(0.1 * l) }],
  },
  {
    id: 'quick_flame', name: 'Flinke Flamme', branch: 'glut', glyph: 'bolt', maxLevel: 5, costs: [30, 65, 130, 230, 370],
    desc: describe('+3 % Feuerrate pro Stufe.', (l) => `+${pct(0.03 * l)} % Feuerrate.`),
    mods: (l) => [{ stat: 'fireRate', add: r4(0.03 * l) }],
  },
  {
    id: 'giant_slayer', name: 'Riesentöter', branch: 'glut', glyph: 'crown', maxLevel: 3, costs: [60, 150, 320],
    requires: { id: 'might', level: 2 },
    desc: describe('+5 % Schaden gegen Bosse und Elitegegner pro Stufe.', (l) => `+${pct(0.05 * l)} % Schaden gegen Bosse und Elitegegner.`),
    mods: (l) => [{ stat: 'bossDamage', add: r4(0.05 * l) }, { stat: 'eliteDamage', add: r4(0.05 * l) }],
  },
  {
    id: 'inner_fire', name: 'Inneres Feuer', branch: 'glut', glyph: 'sun', maxLevel: 3, costs: [50, 130, 280],
    desc: describe('Deine Fertigkeit wirkt 8 % stärker pro Stufe.', (l) => `Deine Fertigkeit wirkt ${pct(0.08 * l)} % stärker.`),
    mods: (l) => [{ stat: 'skillPower', add: r4(0.08 * l) }],
  },
  // --- Geschick -------------------------------------------------------------------------------
  {
    id: 'swiftness', name: 'Leichtfuß', branch: 'geschick', glyph: 'boot', maxLevel: 4, costs: [25, 60, 130, 250],
    desc: describe('+3 % Lauftempo pro Stufe.', (l) => `+${pct(0.03 * l)} % Lauftempo.`),
    mods: (l) => [{ stat: 'moveSpeed', mul: r4(1 + 0.03 * l) }],
  },
  {
    id: 'slipstream', name: 'Windschatten', branch: 'geschick', glyph: 'wing', maxLevel: 3, costs: [40, 100, 220],
    desc: describe('Der Sprint lädt 6 % schneller auf pro Stufe.', (l) => `Der Sprint lädt ${pct(0.06 * l)} % schneller auf.`),
    mods: (l) => [{ stat: 'dashCooldown', mul: r4(1 - 0.06 * l) }],
  },
  {
    id: 'double_step', name: 'Doppelschritt', branch: 'geschick', glyph: 'feather', maxLevel: 1, costs: [800],
    requires: { id: 'slipstream', level: 2 },
    desc: describe('+1 Sprintladung.', () => '+1 Sprintladung.'),
    mods: (l) => [{ stat: 'dashCharges', add: l }],
  },
  {
    id: 'spark_pull', name: 'Funkensog', branch: 'geschick', glyph: 'spiral', maxLevel: 3, costs: [15, 40, 90],
    desc: describe('+15 % Sammelradius pro Stufe.', (l) => `+${pct(0.15 * l)} % Sammelradius.`),
    mods: (l) => [{ stat: 'pickupRadius', mul: r4(1 + 0.15 * l) }],
  },
  {
    id: 'bright_lantern', name: 'Helle Laterne', branch: 'geschick', glyph: 'lantern', maxLevel: 3, costs: [15, 40, 90],
    desc: describe('+8 % Lichtradius pro Stufe.', (l) => `+${pct(0.08 * l)} % Lichtradius.`),
    mods: (l) => [{ stat: 'lightRadius', mul: r4(1 + 0.08 * l) }],
  },
  {
    id: 'quick_spark', name: 'Rascher Funke', branch: 'geschick', glyph: 'hourglass', maxLevel: 3, costs: [50, 130, 280],
    desc: describe('Deine Fertigkeit lädt 5 % schneller auf pro Stufe.', (l) => `Deine Fertigkeit lädt ${pct(0.05 * l)} % schneller auf.`),
    mods: (l) => [{ stat: 'skillCooldown', mul: r4(1 - 0.05 * l) }],
  },
  // --- Schicksal ------------------------------------------------------------------------------
  {
    id: 'spark_pouch', name: 'Funkenbeutel', branch: 'schicksal', glyph: 'coin', maxLevel: 4, costs: [20, 50, 110, 220],
    desc: describe('Beginne jeden Abstieg mit 25 Funken pro Stufe.', (l) => `Beginne jeden Abstieg mit ${25 * l} Funken.`),
    effect: { startSparks: 25 },
  },
  {
    id: 'ash_sense', name: 'Aschegespür', branch: 'schicksal', glyph: 'ember', maxLevel: 5, costs: [30, 70, 140, 240, 380],
    desc: describe('+6 % Asche am Ende jedes Abstiegs pro Stufe.', (l) => `+${pct(0.06 * l)} % Asche am Ende jedes Abstiegs.`),
    mods: (l) => [{ stat: 'ashGain', add: r4(0.06 * l) }],
  },
  {
    id: 'old_lore', name: 'Alte Lehren', branch: 'schicksal', glyph: 'book', maxLevel: 4, costs: [30, 70, 150, 290],
    desc: describe('+5 % Erfahrung pro Stufe.', (l) => `+${pct(0.05 * l)} % Erfahrung.`),
    mods: (l) => [{ stat: 'xpGain', add: r4(0.05 * l) }],
  },
  {
    id: 'lucky_coal', name: 'Glückskohle', branch: 'schicksal', glyph: 'gem', maxLevel: 3, costs: [50, 130, 280],
    desc: describe('+1 Glück pro Stufe. Seltene Relikte und Segen erscheinen häufiger.', (l) => `+${l} Glück. Seltene Relikte und Segen erscheinen häufiger.`),
    mods: (l) => [{ stat: 'luck', add: l }],
  },
  {
    id: 'haggler', name: 'Feilscher', branch: 'schicksal', glyph: 'scale', maxLevel: 3, costs: [45, 110, 240],
    desc: describe('Händler verlangen 4 % weniger Funken pro Stufe.', (l) => `Händler verlangen ${pct(0.04 * l)} % weniger Funken.`),
    mods: (l) => [{ stat: 'shopDiscount', add: r4(0.04 * l) }],
  },
  {
    id: 'fate_dice', name: 'Schicksalswürfel', branch: 'schicksal', glyph: 'dice', maxLevel: 3, costs: [70, 180, 380],
    desc: describe('+1 Neuwurf pro Abstieg und Stufe.', (l) => (l === 1 ? '+1 Neuwurf pro Abstieg.' : `+${l} Neuwürfe pro Abstieg.`)),
    effect: { rerolls: 1 },
  },
  {
    id: 'foresight', name: 'Weitblick', branch: 'schicksal', glyph: 'compass', maxLevel: 1, costs: [750],
    requires: { id: 'fate_dice', level: 1 },
    desc: describe('Reliktauswahlen bieten eine zusätzliche Option.', () => 'Reliktauswahlen bieten eine zusätzliche Option.'),
    effect: { relicChoices: 1 },
  },
  {
    id: 'heirloom', name: 'Erbstück', branch: 'schicksal', glyph: 'ring', maxLevel: 1, costs: [500],
    requires: { id: 'spark_pouch', level: 2 },
    desc: describe('Beginne jeden Abstieg mit einem zufälligen gewöhnlichen Relikt.', () => 'Beginne jeden Abstieg mit einem zufälligen gewöhnlichen Relikt.'),
    effect: { startRelics: 1 },
  },
];

function buildUpgrade(d) {
  const costs = Object.freeze(d.costs.slice());
  return Object.freeze({
    id: d.id, name: d.name, desc: d.desc, branch: d.branch,
    icon: Object.freeze({ glyph: d.glyph, color: C[d.branch] }),
    maxLevel: d.maxLevel, costs,
    /** ash for buying level `level` (1-based); Infinity outside 1..maxLevel */
    cost: (level) => (Number.isInteger(level) && level >= 1 && level <= costs.length ? costs[level - 1] : Infinity),
    mods: d.mods ? (level) => (level > 0 ? d.mods(Math.min(level, d.maxLevel)) : []) : undefined,
    effect: d.effect ? Object.freeze({ ...d.effect }) : undefined,
    requires: d.requires ? Object.freeze({ ...d.requires }) : undefined,
  });
}

/** All upgrades in display order (grouped by branch). */
export const UPGRADE_LIST = Object.freeze(UPGRADE_DEFS.map(buildUpgrade));
/** { [id]: upgrade } */
export const META_UPGRADES = Object.freeze(Object.fromEntries(UPGRADE_LIST.map((u) => [u.id, u])));

/** Purchased level of an upgrade (0 when unknown/unbought; clamped to maxLevel). */
export function upgradeLevel(save, id) {
  const def = META_UPGRADES[id];
  if (!def || !save || !save.upgrades) return 0;
  return clampInt(save.upgrades[id], 0, def.maxLevel);
}

/** Ash for the next level, or null when maxed/unknown. */
export function upgradeCost(save, id) {
  const def = META_UPGRADES[id];
  if (!def) return null;
  const level = upgradeLevel(save, id);
  return level >= def.maxLevel ? null : def.cost(level + 1);
}

/** @returns {{ ok: boolean, reason?: string, code?: 'unknown'|'max'|'requires'|'ash', cost?: number }} */
export function canBuyUpgrade(save, id) {
  const def = META_UPGRADES[id];
  if (!def || !save) return { ok: false, code: 'unknown', reason: 'Unbekannte Verbesserung.' };
  const level = upgradeLevel(save, id);
  if (level >= def.maxLevel) return { ok: false, code: 'max', reason: 'Bereits vollständig ausgebaut.' };
  const cost = def.cost(level + 1);
  if (def.requires && upgradeLevel(save, def.requires.id) < def.requires.level) {
    const req = META_UPGRADES[def.requires.id];
    return { ok: false, code: 'requires', cost, reason: `Benötigt „${req ? req.name : def.requires.id}“ auf Stufe ${def.requires.level}.` };
  }
  const ash = Number.isFinite(save.ash) ? save.ash : 0;
  if (ash < cost) return { ok: false, code: 'ash', cost, reason: `Nicht genug Asche – es fehlen ${cost - ash}.` };
  return { ok: true, cost };
}

/** Buy the next level. Deducts ash, persists, emits `meta:change`. */
export function buyUpgrade(save, id) {
  const check = canBuyUpgrade(save, id);
  if (!check.ok) return false;
  if (!save.upgrades || typeof save.upgrades !== 'object') save.upgrades = {};
  save.ash -= check.cost;
  save.upgrades[id] = upgradeLevel(save, id) + 1;
  if (save.stats) save.stats.ashSpent = (save.stats.ashSpent || 0) + check.cost;
  emitChange(save);
  return true;
}

/** Ash currently invested in the altar (by the current cost table). */
export function spentAsh(save) {
  let total = 0;
  for (const def of UPGRADE_LIST) {
    const level = upgradeLevel(save, def.id);
    for (let l = 1; l <= level; l++) total += def.cost(l);
  }
  return total;
}

/** Ash needed to buy everything from scratch. */
export function totalUpgradeCost() {
  let total = 0;
  for (const def of UPGRADE_LIST) for (let l = 1; l <= def.maxLevel; l++) total += def.cost(l);
  return total;
}

/** Full respec: returns all invested ash. @returns {number} refunded ash */
export function refundAll(save) {
  if (!save) return 0;
  const refund = spentAsh(save);
  save.upgrades = {};
  save.ash = (Number.isFinite(save.ash) ? save.ash : 0) + refund;
  if (save.stats) save.stats.ashSpent = Math.max(0, (save.stats.ashSpent || 0) - refund);
  emitChange(save);
  return refund;
}

/** All stat modifiers from purchased upgrades, flattened. */
export function getMetaMods(save) {
  const out = [];
  for (const def of UPGRADE_LIST) {
    if (!def.mods) continue;
    const level = upgradeLevel(save, def.id);
    if (level > 0) for (const m of def.mods(level)) out.push({ ...m });
  }
  return out;
}

/** Baseline run bonuses (nothing purchased). */
export function defaultRunBonuses() {
  return {
    startSparks: 0,              // Funken granted at run start
    rerolls: 0,                  // choice rerolls available per run
    revives: 0,                  // free revives per run
    reviveHp: 0.3,               // fraction of max HP restored by a revive
    relicChoices: 0,             // extra options in relic choices
    startRelics: 0,              // random relics granted at run start
    startRelicRarity: 'common',  // rarity of those relics
    healOnFloor: 0,              // fraction of max HP healed when entering floors 2..5
    startShield: 0,              // flat shield points at run start
    shopDiscount: 0,             // always 0: the discount is a stat mod (see getMetaMods)
  };
}

/** Non-stat effects of all purchased upgrades, aggregated. */
export function getRunBonuses(save) {
  const out = defaultRunBonuses();
  for (const def of UPGRADE_LIST) {
    if (!def.effect) continue;
    const level = upgradeLevel(save, def.id);
    if (level <= 0) continue;
    for (const k of Object.keys(def.effect)) out[k] = r4((out[k] || 0) + def.effect[k] * level);
  }
  return out;
}

/** Everything the altar UI needs for one upgrade. */
export function upgradeInfo(save, id) {
  const def = META_UPGRADES[id];
  if (!def) return null;
  const level = upgradeLevel(save, id);
  const maxed = level >= def.maxLevel;
  const check = canBuyUpgrade(save, id);
  const req = def.requires ? META_UPGRADES[def.requires.id] : null;
  const locked = !!def.requires && upgradeLevel(save, def.requires.id) < def.requires.level;
  return {
    id, def, level, maxLevel: def.maxLevel, maxed,
    cost: maxed ? null : def.cost(level + 1),
    canBuy: check.ok, reason: check.reason || '', code: check.code || null,
    locked,
    requiresText: def.requires ? `Benötigt „${req ? req.name : def.requires.id}“ auf Stufe ${def.requires.level}.` : '',
    text: String(def.desc),
    current: level > 0 ? def.desc(level) : '',
    next: maxed ? '' : def.desc(level + 1),
  };
}

/** Upgrades of one branch as `upgradeInfo` objects. */
export function upgradesByBranch(save, branchId) {
  return UPGRADE_LIST.filter((u) => u.branch === branchId).map((u) => upgradeInfo(save, u.id));
}

// ---------------------------------------------------------------------------------------------
// Glutstufen (difficulty)
// ---------------------------------------------------------------------------------------------
const BASE_DIFFICULTY_MODS = Object.freeze({
  enemyHp: 1, enemyDamage: 1, enemySpeed: 1, eliteChance: 0, extraAffixes: 0,
  spawnBudget: 1, ashMult: 1, healMult: 1, shopPrice: 1, bossHp: 1,
});

/** Fresh baseline DifficultyMods object. */
export function defaultDifficultyMods() {
  return { ...BASE_DIFFICULTY_MODS };
}

const DIFFICULTY_STEPS = [
  { name: 'Erste Glut', desc: 'Der Schacht, wie er ist. Keine Erschwernisse.', apply() {} },
  { name: 'Schwelbrand', desc: 'Gegner haben 20 % mehr Leben.', apply(m) { m.enemyHp *= 1.2; } },
  { name: 'Glimmende Wut', desc: 'Gegner verursachen 15 % mehr Schaden.', apply(m) { m.enemyDamage *= 1.15; } },
  { name: 'Unruhige Schatten', desc: 'Elitegegner erscheinen deutlich häufiger.', apply(m) { m.eliteChance += 0.08; } },
  { name: 'Karge Zeiten', desc: 'Händler verlangen 25 % mehr Funken.', apply(m) { m.shopPrice *= 1.25; } },
  { name: 'Wachsende Horde', desc: 'In jedem Raum lauern 20 % mehr Gegner.', apply(m) { m.spawnBudget += 0.2; } },
  { name: 'Hastige Brut', desc: 'Gegner bewegen sich 10 % schneller.', apply(m) { m.enemySpeed *= 1.1; } },
  { name: 'Erwachte Wächter', desc: 'Bosse haben 30 % mehr Leben.', apply(m) { m.bossHp *= 1.3; } },
  { name: 'Versiegte Quellen', desc: 'Jede Heilung wirkt 25 % schwächer.', apply(m) { m.healMult *= 0.75; } },
  { name: 'Gezeichnete Elite', desc: 'Elitegegner tragen eine zusätzliche Eigenschaft und erscheinen noch häufiger.', apply(m) { m.extraAffixes += 1; m.eliteChance += 0.06; } },
  { name: 'Ewige Nacht', desc: 'Alles wird härter: Gegner haben 25 % mehr Leben und verursachen 15 % mehr Schaden, Bosse haben weitere 20 % mehr Leben.',
    apply(m) { m.enemyHp *= 1.25; m.enemyDamage *= 1.15; m.bossHp *= 1.2; } },
];

const signedPct = (frac) => `${frac >= 0 ? '+' : '−'}${pct(Math.abs(frac))} %`;

/** German one-liners describing a DifficultyMods object relative to the baseline. */
export function describeDifficultyMods(mods) {
  const m = { ...BASE_DIFFICULTY_MODS, ...(mods || {}) };
  const out = [];
  if (m.enemyHp !== 1) out.push(`Gegnerleben ${signedPct(m.enemyHp - 1)}`);
  if (m.enemyDamage !== 1) out.push(`Gegnerschaden ${signedPct(m.enemyDamage - 1)}`);
  if (m.enemySpeed !== 1) out.push(`Gegnertempo ${signedPct(m.enemySpeed - 1)}`);
  if (m.spawnBudget !== 1) out.push(`Gegnerzahl ${signedPct(m.spawnBudget - 1)}`);
  if (m.eliteChance !== 0) out.push(`Elitechance ${signedPct(m.eliteChance)}`);
  if (m.extraAffixes !== 0) out.push(`+${m.extraAffixes} Elite-Eigenschaft${m.extraAffixes === 1 ? '' : 'en'}`);
  if (m.bossHp !== 1) out.push(`Bossleben ${signedPct(m.bossHp - 1)}`);
  if (m.shopPrice !== 1) out.push(`Händlerpreise ${signedPct(m.shopPrice - 1)}`);
  if (m.healMult !== 1) out.push(`Heilung ${signedPct(m.healMult - 1)}`);
  if (m.ashMult !== 1) out.push(`Asche ${signedPct(m.ashMult - 1)}`);
  return out;
}

function buildDifficulties() {
  const out = [];
  const m = defaultDifficultyMods();
  DIFFICULTY_STEPS.forEach((step, level) => {
    step.apply(m);
    m.ashMult = 1 + 0.15 * level;
    const mods = {};
    for (const k of Object.keys(m)) mods[k] = r4(m[k]);
    Object.freeze(mods);
    out.push(Object.freeze({
      level, name: step.name, desc: step.desc, mods,
      /** cumulative effects of this Glutstufe as German one-liners */
      effects: Object.freeze(describeDifficultyMods(mods)),
      icon: Object.freeze({ glyph: level === 0 ? 'candle' : level >= 10 ? 'moon' : 'flame', color: level === 0 ? '#ffd9a0' : level >= 10 ? '#b07cff' : '#ff8a3c' }),
    }));
  });
  return Object.freeze(out);
}

/** Glutstufen 0..10. `DIFFICULTIES[level]`. */
export const DIFFICULTIES = buildDifficulties();

/** Difficulty def for a level (clamped), or the def itself when one is passed. */
export function getDifficulty(level) {
  if (level && typeof level === 'object') return level.mods ? level : DIFFICULTIES[clampInt(level.level, 0, MAX_DIFFICULTY)];
  return DIFFICULTIES[clampInt(Number(level), 0, MAX_DIFFICULTY)];
}

/** Highest selectable Glutstufe (winning at N unlocks N + 1). */
export function difficultyUnlocked(save) {
  const u = save && save.unlocks ? save.unlocks.difficulties : 0;
  return clampInt(u, 0, MAX_DIFFICULTY);
}

// ---------------------------------------------------------------------------------------------
// Unlock rules
// ---------------------------------------------------------------------------------------------
const stat = (save, key) => {
  const v = save && save.stats ? save.stats[key] : 0;
  return Number.isFinite(v) ? v : 0;
};
const bossKills = (save, id) => {
  const b = save && save.codex && save.codex.bosses ? save.codex.bosses[id] : null;
  return b && Number.isFinite(b.kills) ? b.kills : 0;
};
const wonAt = (save) => {
  const v = save && save.stats ? save.stats.highestDifficultyWon : -1;
  return Number.isFinite(v) ? v : -1;
};

/**
 * Character unlock rules. `progress(save)` -> [current, target]; `price` = may be bought with ash.
 * The display names mirror data/characters.js (fallback for toasts).
 */
export const CHARACTER_UNLOCKS = Object.freeze({
  bearer: { id: 'bearer', name: 'Glutträger', default: true, text: 'Von Beginn an verfügbar.', progress: () => [1, 1] },
  shadow: { id: 'shadow', name: 'Schattenläuferin', text: 'Besiege den Schlackenkönig.', progress: (s) => [bossKills(s, 'boss_cinder'), 1] },
  warden: { id: 'warden', name: 'Eisenwächter', text: 'Erreiche die Frostadern (Ebene 3).', progress: (s) => [stat(s, 'bestFloor'), 3] },
  weaver: { id: 'weaver', name: 'Frostweberin', text: 'Besiege den Reifwyrm – oder opfere 400 Asche.', price: 400, progress: (s) => [bossKills(s, 'boss_rime'), 1] },
  revenant: { id: 'revenant', name: 'Aschenkind', text: 'Entzünde das Sonnenherz neu (gewinne einen Abstieg).', progress: (s) => [stat(s, 'wins'), 1] },
});

/** Weapon ids in roster order (ARCHITECTURE §6.3). */
export const WEAPON_IDS = Object.freeze(['ember_bolt', 'scatter_coal', 'flame_lance', 'spark_chain', 'magma_mortar', 'frost_needle',
  'shadow_daggers', 'sun_disc', 'spore_launcher', 'rift_orb', 'iron_hammer', 'glaive_orbit', 'soul_siphon', 'star_bow', 'ice_staff']);

const START = { default: true, text: 'Von Beginn an im Schacht zu finden.', progress: () => [1, 1] };

/** Weapon loot-pool unlock rules. Fallback display names; data/weapons.js is authoritative. */
export const WEAPON_UNLOCKS = Object.freeze({
  ember_bolt: { id: 'ember_bolt', name: 'Glutbolzen', ...START },
  scatter_coal: { id: 'scatter_coal', name: 'Streukohle', ...START },
  flame_lance: { id: 'flame_lance', name: 'Flammenlanze', ...START },
  frost_needle: { id: 'frost_needle', name: 'Frostnadel', ...START },
  sun_disc: { id: 'sun_disc', name: 'Sonnenscheibe', ...START },
  iron_hammer: { id: 'iron_hammer', name: 'Eisenhammer', ...START },
  shadow_daggers: { id: 'shadow_daggers', name: 'Schattendolche', ...START },
  ice_staff: { id: 'ice_staff', name: 'Eisstab', ...START },
  spore_launcher: { id: 'spore_launcher', name: 'Sporenwerfer', ...START },
  spark_chain: { id: 'spark_chain', name: 'Funkenkette', text: 'Besiege insgesamt 200 Gegner.', progress: (s) => [stat(s, 'kills'), 200] },
  magma_mortar: { id: 'magma_mortar', name: 'Magmamörser', text: 'Besiege den Schlackenkönig dreimal.', progress: (s) => [bossKills(s, 'boss_cinder'), 3] },
  rift_orb: { id: 'rift_orb', name: 'Risskugel', text: 'Erreiche den Schattenkern (Ebene 4).', progress: (s) => [stat(s, 'bestFloor'), 4] },
  glaive_orbit: { id: 'glaive_orbit', name: 'Klingenkreis', text: 'Gewinne einen Abstieg auf Glutstufe 1 oder höher.', progress: (s) => [Math.max(0, wonAt(s)), 1] },
  soul_siphon: { id: 'soul_siphon', name: 'Seelensauger', text: 'Falle zehnmal im Schacht.', progress: (s) => [stat(s, 'deaths'), 10] },
  star_bow: { id: 'star_bow', name: 'Sternenbogen', text: 'Gewinne einen Abstieg.', progress: (s) => [stat(s, 'wins'), 1] },
});

// Optional authoritative display names (filled from the content registries by the tracker).
const displayNames = { character: {}, weapon: {} };

/**
 * Register display names for unlock toasts.
 * @param {{ characters?: Record<string, {name:string}|string>, weapons?: Record<string, {name:string}|string> }} reg
 */
export function setDisplayNames(reg = {}) {
  for (const [type, src] of [['character', reg.characters], ['weapon', reg.weapons]]) {
    if (!src || typeof src !== 'object') continue;
    for (const id of Object.keys(src)) {
      const v = src[id];
      const name = typeof v === 'string' ? v : v && v.name;
      if (typeof name === 'string' && name) displayNames[type][id] = name;
    }
  }
}

function displayName(type, id) {
  if (displayNames[type] && displayNames[type][id]) return displayNames[type][id];
  const rule = type === 'character' ? CHARACTER_UNLOCKS[id] : WEAPON_UNLOCKS[id];
  return rule ? rule.name : String(id);
}

function ruleMet(rule, save) {
  if (rule.default) return true;
  const [cur, target] = rule.progress(save);
  return cur >= target;
}

const listed = (save, key, id) => !!(save && save.unlocks && Array.isArray(save.unlocks[key]) && save.unlocks[key].includes(id));

export function isCharacterUnlocked(save, id) {
  const rule = CHARACTER_UNLOCKS[id];
  if (!rule) return false;
  return rule.default === true || listed(save, 'characters', id) || ruleMet(rule, save);
}

/** German unlock condition for a character. */
export function characterUnlockText(id) {
  const rule = CHARACTER_UNLOCKS[id];
  return rule ? rule.text : 'Noch nicht verfügbar.';
}

/** @returns {{ unlocked, current, target, ratio, text, price: number|null, canBuy: boolean }} */
export function characterUnlockProgress(save, id) {
  const rule = CHARACTER_UNLOCKS[id];
  if (!rule) return { unlocked: false, current: 0, target: 1, ratio: 0, text: characterUnlockText(id), price: null, canBuy: false };
  const unlocked = isCharacterUnlocked(save, id);
  const [cur, target] = rule.progress(save);
  const current = unlocked ? target : Math.max(0, Math.min(target, cur));
  return {
    unlocked, current, target, ratio: target > 0 ? current / target : 1, text: rule.text,
    price: rule.price ?? null,
    canBuy: !unlocked && rule.price != null && !!save && save.ash >= rule.price,
  };
}

/** @returns {{ ok: boolean, reason?: string, cost?: number }} */
export function canBuyCharacter(save, id) {
  const rule = CHARACTER_UNLOCKS[id];
  if (!rule || !save) return { ok: false, reason: 'Unbekannter Glutträger.' };
  if (isCharacterUnlocked(save, id)) return { ok: false, reason: 'Bereits freigeschaltet.' };
  if (rule.price == null) return { ok: false, reason: 'Kann nicht mit Asche erworben werden.' };
  const ash = Number.isFinite(save.ash) ? save.ash : 0;
  if (ash < rule.price) return { ok: false, cost: rule.price, reason: `Nicht genug Asche – es fehlen ${rule.price - ash}.` };
  return { ok: true, cost: rule.price };
}

function ensureUnlocks(save) {
  if (!save.unlocks || typeof save.unlocks !== 'object') save.unlocks = {};
  if (!Array.isArray(save.unlocks.characters)) save.unlocks.characters = ['bearer'];
  if (!Array.isArray(save.unlocks.weapons)) save.unlocks.weapons = [];
  if (!Number.isFinite(save.unlocks.difficulties)) save.unlocks.difficulties = 0;
  return save.unlocks;
}

/** Buy a purchasable character (weaver). Deducts ash, persists, emits `meta:change`. */
export function buyCharacter(save, id) {
  const check = canBuyCharacter(save, id);
  if (!check.ok) return false;
  const u = ensureUnlocks(save);
  save.ash -= check.cost;
  if (save.stats) save.stats.ashSpent = (save.stats.ashSpent || 0) + check.cost;
  if (!u.characters.includes(id)) u.characters.push(id);
  emitChange(save);
  return true;
}

/** Is the weapon in the loot pool? Ids without a rule are always available. */
export function isWeaponUnlocked(save, id) {
  const rule = WEAPON_UNLOCKS[id];
  if (!rule) return true;
  return rule.default === true || listed(save, 'weapons', id) || ruleMet(rule, save);
}

/** All roster weapon ids currently in the loot pool. */
export function unlockedWeapons(save) {
  return WEAPON_IDS.filter((id) => isWeaponUnlocked(save, id));
}

/** German unlock condition for a weapon. */
export function weaponUnlockText(id) {
  const rule = WEAPON_UNLOCKS[id];
  return rule ? rule.text : 'Von Beginn an im Schacht zu finden.';
}

/** @returns {{ unlocked, current, target, ratio, text }} */
export function weaponUnlockProgress(save, id) {
  const rule = WEAPON_UNLOCKS[id];
  if (!rule) return { unlocked: true, current: 1, target: 1, ratio: 1, text: weaponUnlockText(id) };
  const unlocked = isWeaponUnlocked(save, id);
  const [cur, target] = rule.progress(save);
  const current = unlocked ? target : Math.max(0, Math.min(target, cur));
  return { unlocked, current, target, ratio: target > 0 ? current / target : 1, text: rule.text };
}

/**
 * Evaluate all unlock rules against the save and record what is new. Idempotent.
 * @returns {Array<{ type: 'character'|'weapon'|'difficulty', id: string|number, name: string }>}
 */
export function checkUnlocks(save) {
  const out = [];
  if (!save || typeof save !== 'object') return out;
  const u = ensureUnlocks(save);
  for (const id of Object.keys(CHARACTER_UNLOCKS)) {
    const rule = CHARACTER_UNLOCKS[id];
    if (u.characters.includes(id)) continue;
    if (!ruleMet(rule, save)) continue;
    u.characters.push(id);
    if (!rule.default) out.push({ type: 'character', id, name: displayName('character', id) });
  }
  for (const id of WEAPON_IDS) {
    const rule = WEAPON_UNLOCKS[id];
    if (!rule || rule.default || u.weapons.includes(id)) continue;
    if (!ruleMet(rule, save)) continue;
    u.weapons.push(id);
    out.push({ type: 'weapon', id, name: displayName('weapon', id) });
  }
  const target = Math.min(MAX_DIFFICULTY, wonAt(save) + 1);
  const have = difficultyUnlocked(save);
  if (target > have) {
    for (let level = have + 1; level <= target; level++) out.push({ type: 'difficulty', id: level, name: DIFFICULTIES[level].name });
    u.difficulties = target;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ash reward
// ---------------------------------------------------------------------------------------------
/** Tuning table for the end-of-run ash reward. */
export const ASH_RULES = Object.freeze({
  floor: Object.freeze([0, 24, 32, 44, 60, 80]),   // cumulative, by deepest floor reached (1..5)
  floorOneKills: 20,                               // floor-1 ash is prorated until this many kills (no instant-abandon farming)
  bossBase: 10, bossStep: 4,                       // n-th boss: bossBase + bossStep * n  (14, 18, 22, 26, 30)
  elite: 2, eliteCap: 40,                          // per elite kill, capped
  killsPerAsh: 12, killCap: 720,                   // 1 ash per 12 kills, capped
  victory: 120,
});

const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * End-of-run ash. Base parts (depth, bosses, elites, kills, victory) are multiplied by the Glutstufe
 * and by the player's `ashGain` stat; ash picked up during the run is added as-is on top.
 * `parts` always sum up to `total`.
 * @param {{ floor?: number, victory?: boolean, stats?: object, difficulty?: object|number, ashGain?: number, ashPickedUp?: number }} o
 * @returns {{ total: number, parts: Array<{ label: string, amount: number, kind: string }> }}
 */
export function computeAshReward(o = {}) {
  const stats = o.stats && typeof o.stats === 'object' ? o.stats : {};
  const floorRaw = o.floor && typeof o.floor === 'object' ? o.floor.index : o.floor;
  const floor = clampInt(Number(floorRaw) || 1, 1, 5);
  const victory = o.victory === true;
  const kills = Math.floor(n0(stats.kills));
  const elites = Math.floor(n0(stats.eliteKills));
  const bosses = Math.min(victory ? 5 : floor, Math.floor(n0(stats.bossKills)));
  const diff = getDifficulty(o.difficulty ?? 0) || DIFFICULTIES[0];
  const mult = n0(diff.mods && diff.mods.ashMult) || 1;
  const gain = Math.max(0.1, Math.min(10, typeof o.ashGain === 'number' && Number.isFinite(o.ashGain) ? o.ashGain : 1));
  const picked = Math.round(n0(o.ashPickedUp ?? stats.ashPickedUp));

  const parts = [];
  const push = (kind, label, amount) => { if (amount !== 0) parts.push({ kind, label, amount }); };

  let floorAsh = ASH_RULES.floor[floor];
  if (floor === 1 && !victory) floorAsh = Math.round(floorAsh * Math.min(1, kills / ASH_RULES.floorOneKills));
  const biome = biomeForFloor(floor);
  push('floor', `Ebene ${floor} erreicht – ${biome ? biome.name : ''}`.replace(/ – $/, ''), floorAsh);

  let bossAsh = 0;
  for (let i = 1; i <= bosses; i++) bossAsh += ASH_RULES.bossBase + ASH_RULES.bossStep * i;
  push('bosses', bosses === 1 ? 'Boss besiegt' : `Bosse besiegt (${bosses})`, bossAsh);
  push('elites', `Elitegegner besiegt (${elites})`, Math.min(elites, ASH_RULES.eliteCap) * ASH_RULES.elite);
  push('kills', `Gegner besiegt (${kills})`, Math.round(Math.min(kills, ASH_RULES.killCap) / ASH_RULES.killsPerAsh));
  if (victory) push('victory', 'Sonnenherz neu entzündet', ASH_RULES.victory);

  const base = parts.reduce((s, p) => s + p.amount, 0);
  const afterDiff = Math.round(base * mult);
  if (mult !== 1) push('difficulty', `Glutstufe ${diff.level} (×${de(mult)})`, afterDiff - base);
  const afterGain = Math.round(afterDiff * gain);
  if (gain !== 1) push('ashGain', `Aschegewinn (${signedPct(gain - 1)})`, afterGain - afterDiff);
  push('pickup', 'Aufgesammelte Asche', picked);

  return { total: Math.max(0, afterGain + picked), parts };
}
