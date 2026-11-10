// Pure helpers for the UI's "Chronik" screens (codex, lifetime stats) and the character sheet.
// No imports from content modules: the UI passes the registries in. DOM-free.
import { FLOOR_ORDER } from '../data/biomes.js';
import { isWeaponUnlocked, weaponUnlockText } from './progression.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'curse'];
const biomeRank = (b) => { const i = FLOOR_ORDER.indexOf(b); return i < 0 ? 99 : i; };
const byName = (a, b) => String(a.def.name || a.id).localeCompare(String(b.def.name || b.id), 'de');
const codexOf = (save) => (save && save.codex) || {};

/** Locale-aware German number: 1234.5 -> "1.234,5" */
export function formatNumber(n, digits = 0) {
  const v = num(n);
  const fixed = Math.abs(v).toFixed(digits);
  let [int, frac] = fixed.split('.');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (frac) frac = frac.replace(/0+$/, '');
  return `${v < 0 ? '−' : ''}${int}${frac ? `,${frac}` : ''}`;
}

/** Seconds -> "m:ss" or "h:mm:ss". */
export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(num(sec)));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (x) => (x < 10 ? `0${x}` : String(x));
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Seconds -> "3 Std. 12 Min." / "12 Min." / "45 Sek." (for total play time). */
export function formatPlayTime(sec) {
  const s = Math.max(0, Math.floor(num(sec)));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} Std. ${m} Min.`;
  if (m > 0) return `${m} Min.`;
  return `${s} Sek.`;
}

// ---------------------------------------------------------------------------------------------
// Codex lists
// ---------------------------------------------------------------------------------------------
/**
 * Regular enemies (bosses are skipped), sorted by biome. Undiscovered entries have `seen: false`
 * and `name: '???'` — the UI should hide sprite/description for them.
 * @returns {Array<{ id, def, seen, kills, name, desc, biome }>}
 */
export function codexEnemies(save, ENEMIES = {}) {
  const c = codexOf(save).enemies || {};
  return Object.keys(ENEMIES || {})
    .map((id) => ({ id, def: ENEMIES[id] }))
    .filter((e) => e.def && !e.def.boss && !e.def.hidden && !e.def.noCodex)
    .map(({ id, def }) => {
      const entry = c[id] || {};
      const kills = num(entry.kills);
      const seen = !!entry.seen || kills > 0;
      return { id, def, seen, kills, name: seen ? def.name || id : '???', desc: seen ? def.desc || '' : '', biome: def.biome || null };
    })
    .sort((a, b) => biomeRank(a.biome) - biomeRank(b.biome) || ((a.def.hp || 0) - (b.def.hp || 0)) || a.id.localeCompare(b.id));
}

/** @returns {Array<{ id, def, seen, kills, bestTime, name, title, desc, biome }>} sorted by floor */
export function codexBosses(save, BOSSES = {}) {
  const c = codexOf(save).bosses || {};
  return Object.keys(BOSSES || {})
    .map((id) => {
      const def = BOSSES[id] || {};
      const entry = c[id] || {};
      const kills = num(entry.kills);
      const seen = !!entry.seen || kills > 0;
      return {
        id, def, seen, kills, bestTime: num(entry.bestTime),
        name: seen ? def.name || id : '???', title: seen ? def.title || '' : '', desc: seen ? def.desc || '' : '', biome: def.biome || null,
      };
    })
    .sort((a, b) => biomeRank(a.biome) - biomeRank(b.biome) || a.id.localeCompare(b.id));
}

/** Relics incl. curses (listed last). @returns {Array<{ id, def, seen, count, name, desc, rarity, curse }>} */
export function codexRelics(save, RELICS = {}) {
  const c = codexOf(save).relics || {};
  return Object.keys(RELICS || {})
    .map((id) => {
      const def = RELICS[id] || {};
      const count = num(c[id]);
      const seen = count > 0;
      return { id, def, seen, count, name: seen ? def.name || id : '???', desc: seen ? def.desc || '' : '', rarity: def.rarity || 'common', curse: def.rarity === 'curse' };
    })
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || byName(a, b));
}

/** Boons (Segen). @returns {Array<{ id, def, seen, count, name, desc }>} */
export function codexBoons(save, BOONS = {}) {
  const c = codexOf(save).boons || {};
  return Object.keys(BOONS || {})
    .map((id) => {
      const def = BOONS[id] || {};
      const count = num(c[id]);
      const seen = count > 0;
      return { id, def, seen, count, name: seen ? def.name || id : '???', desc: seen ? def.desc || '' : '' };
    })
    .sort(byName);
}

/**
 * Weapons. `count` = runs in which the weapon was carried. Locked weapons (not yet in the loot pool)
 * carry their unlock condition in `unlockText`.
 * @returns {Array<{ id, def, seen, count, unlocked, unlockText, name, desc }>}
 */
export function codexWeapons(save, WEAPONS = {}) {
  const c = codexOf(save).weapons || {};
  return Object.keys(WEAPONS || {})
    .map((id) => {
      const def = WEAPONS[id] || {};
      const count = num(c[id]);
      const seen = count > 0;
      const unlocked = isWeaponUnlocked(save, id);
      return {
        id, def, seen, count, unlocked, unlockText: unlocked ? '' : weaponUnlockText(id),
        name: seen || unlocked ? def.name || id : '???', desc: seen ? def.desc || '' : '',
      };
    })
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || RARITY_ORDER.indexOf(a.def.rarity || 'common') - RARITY_ORDER.indexOf(b.def.rarity || 'common') || byName(a, b));
}

const pick = (reg, ...keys) => { for (const k of keys) if (reg && reg[k]) return reg[k]; return null; };
const part = (list) => {
  const total = list.length, found = list.filter((e) => e.seen).length;
  return { found, total, pct: total ? Math.round((found / total) * 100) : 0 };
};

/**
 * Discovery percentages. `registries` keys (either case): enemies, bosses, relics, weapons, boons.
 * @returns {{ enemies?, bosses?, relics?, weapons?, boons?, total: { found, total, pct } }}
 */
export function codexCompletion(save, registries = {}) {
  const out = {};
  const sections = {
    enemies: [pick(registries, 'enemies', 'ENEMIES'), codexEnemies],
    bosses: [pick(registries, 'bosses', 'BOSSES'), codexBosses],
    relics: [pick(registries, 'relics', 'RELICS'), codexRelics],
    weapons: [pick(registries, 'weapons', 'WEAPONS'), codexWeapons],
    boons: [pick(registries, 'boons', 'BOONS'), codexBoons],
  };
  let found = 0, total = 0;
  for (const [key, [reg, fn]] of Object.entries(sections)) {
    if (!reg) continue;
    out[key] = part(fn(save, reg));
    found += out[key].found;
    total += out[key].total;
  }
  out.total = { found, total, pct: total ? Math.round((found / total) * 100) : 0 };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lifetime stats
// ---------------------------------------------------------------------------------------------
/** Lifetime stat labels (save.stats) in display order. fmt: int | time | duration | floor | difficulty */
export const LIFETIME_STAT_LABELS = Object.freeze({
  runs: { name: 'Abstiege', fmt: 'int' },
  wins: { name: 'Siege', fmt: 'int' },
  deaths: { name: 'Gefallen', fmt: 'int' },
  abandons: { name: 'Aufgegeben', fmt: 'int' },
  bestFloor: { name: 'Tiefste Ebene', fmt: 'floor' },
  highestDifficultyWon: { name: 'Höchste besiegte Glutstufe', fmt: 'difficulty' },
  fastestWin: { name: 'Schnellster Sieg', fmt: 'duration' },
  longestRun: { name: 'Längster Abstieg', fmt: 'duration' },
  playTime: { name: 'Spielzeit', fmt: 'time' },
  kills: { name: 'Besiegte Gegner', fmt: 'int' },
  eliteKills: { name: 'Besiegte Elitegegner', fmt: 'int' },
  bossKills: { name: 'Besiegte Bosse', fmt: 'int' },
  bestKills: { name: 'Meiste Siege in einem Abstieg', fmt: 'int' },
  bestLevel: { name: 'Höchste Stufe', fmt: 'int' },
  bestHit: { name: 'Stärkster Treffer', fmt: 'int' },
  damageDealt: { name: 'Verursachter Schaden', fmt: 'int' },
  damageTaken: { name: 'Erlittener Schaden', fmt: 'int' },
  healed: { name: 'Geheilt', fmt: 'int' },
  critHits: { name: 'Kritische Treffer', fmt: 'int' },
  dashes: { name: 'Sprints', fmt: 'int' },
  roomsCleared: { name: 'Gesäuberte Räume', fmt: 'int' },
  floorsCleared: { name: 'Bezwungene Ebenen', fmt: 'int' },
  totalSparks: { name: 'Gesammelte Funken', fmt: 'int' },
  sparksSpent: { name: 'Ausgegebene Funken', fmt: 'int' },
  purchases: { name: 'Einkäufe', fmt: 'int' },
  relicsFound: { name: 'Gefundene Relikte', fmt: 'int' },
  cursesTaken: { name: 'Erlittene Flüche', fmt: 'int' },
  boonsChosen: { name: 'Gewählte Segen', fmt: 'int' },
  weaponsFound: { name: 'Geführte Waffen', fmt: 'int' },
  levelUps: { name: 'Stufenaufstiege', fmt: 'int' },
  revives: { name: 'Wiedererweckungen', fmt: 'int' },
  falls: { name: 'Stürze in Gruben', fmt: 'int' },
  barrels: { name: 'Zerschlagene Fässer', fmt: 'int' },
  chests: { name: 'Geöffnete Truhen', fmt: 'int' },
  shrines: { name: 'Besuchte Schreine', fmt: 'int' },
  ashSpent: { name: 'Am Altar geopferte Asche', fmt: 'int' },
});

/**
 * Format one lifetime stat.
 * @returns {{ key: string, label: string, text: string, value: number }}
 */
export function formatStat(key, value) {
  const info = LIFETIME_STAT_LABELS[key] || { name: key, fmt: 'int' };
  const v = num(value);
  let text;
  switch (info.fmt) {
    case 'time': text = formatPlayTime(v); break;
    case 'duration': text = v > 0 ? formatDuration(v) : '–'; break;
    case 'floor': text = v > 0 ? `Ebene ${Math.floor(v)}` : '–'; break;
    case 'difficulty': text = value != null && Number.isFinite(value) && value >= 0 ? `Glutstufe ${Math.floor(value)}` : '–'; break;
    default: text = formatNumber(Math.round(v));
  }
  return { key, label: info.name, text, value: v };
}

/** All lifetime stats of a save in display order (plus total ash). */
export function lifetimeStats(save) {
  const st = (save && save.stats) || {};
  const out = Object.keys(LIFETIME_STAT_LABELS).map((k) => formatStat(k, st[k] ?? (k === 'highestDifficultyWon' ? -1 : 0)));
  out.splice(1, 0, { key: 'totalAsh', label: 'Gesammelte Asche', text: formatNumber(num(save && save.totalAsh)), value: num(save && save.totalAsh) });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Player stat sheet (§6.2)
// ---------------------------------------------------------------------------------------------
/** Stat groups for the character sheet, in display order. */
export const STAT_GROUPS = Object.freeze({
  survival: 'Überleben',
  offense: 'Angriff',
  projectiles: 'Geschosse',
  mobility: 'Bewegung',
  status: 'Zustände',
  elements: 'Elemente',
  fortune: 'Glück & Beute',
});

/**
 * German labels + format hints for every player stat.
 * fmt: int (plain number) | dec (1 decimal) | pct (multiplier, 1 -> "100 %") | chance (fraction, .05 -> "5 %")
 *      | mult ("×1,75") | sec ("1,1 s") | px ("110 px") | persec ("0,5/s")
 * `lowerIsBetter` marks stats where smaller values are an improvement (cooldowns).
 */
export const STAT_LABELS = Object.freeze({
  maxHp: { name: 'Max. Leben', fmt: 'int', group: 'survival' },
  regen: { name: 'Regeneration', fmt: 'persec', group: 'survival' },
  armor: { name: 'Rüstung', fmt: 'int', group: 'survival' },
  dodge: { name: 'Ausweichen', fmt: 'chance', group: 'survival' },
  iframes: { name: 'Unverwundbarkeit nach Treffer', fmt: 'sec', group: 'survival' },
  lifesteal: { name: 'Lebensraub', fmt: 'chance', group: 'survival' },
  thorns: { name: 'Dornen', fmt: 'int', group: 'survival' },
  healPower: { name: 'Heilkraft', fmt: 'pct', group: 'survival' },

  damage: { name: 'Schaden', fmt: 'pct', group: 'offense' },
  fireRate: { name: 'Feuerrate', fmt: 'pct', group: 'offense' },
  critChance: { name: 'Kritische Trefferchance', fmt: 'chance', group: 'offense' },
  critMult: { name: 'Kritischer Schaden', fmt: 'mult', group: 'offense' },
  bossDamage: { name: 'Schaden gegen Bosse', fmt: 'pct', group: 'offense' },
  eliteDamage: { name: 'Schaden gegen Elitegegner', fmt: 'pct', group: 'offense' },
  skillPower: { name: 'Fertigkeitsstärke', fmt: 'pct', group: 'offense' },
  skillCooldown: { name: 'Fertigkeitsabklingzeit', fmt: 'pct', group: 'offense', lowerIsBetter: true },
  knockback: { name: 'Rückstoß', fmt: 'pct', group: 'offense' },

  projSpeed: { name: 'Geschosstempo', fmt: 'pct', group: 'projectiles' },
  range: { name: 'Reichweite', fmt: 'pct', group: 'projectiles' },
  projSize: { name: 'Geschossgröße', fmt: 'pct', group: 'projectiles' },
  pierce: { name: 'Durchschlag', fmt: 'int', group: 'projectiles' },
  bounce: { name: 'Abpraller', fmt: 'int', group: 'projectiles' },
  multishot: { name: 'Zusätzliche Geschosse', fmt: 'int', group: 'projectiles' },
  homing: { name: 'Zielsuche', fmt: 'dec', group: 'projectiles' },

  moveSpeed: { name: 'Lauftempo', fmt: 'int', group: 'mobility' },
  dashCooldown: { name: 'Sprintabklingzeit', fmt: 'sec', group: 'mobility', lowerIsBetter: true },
  dashCharges: { name: 'Sprintladungen', fmt: 'int', group: 'mobility' },
  dashDistance: { name: 'Sprintweite', fmt: 'pct', group: 'mobility' },
  pickupRadius: { name: 'Sammelradius', fmt: 'px', group: 'mobility' },
  lightRadius: { name: 'Lichtradius', fmt: 'px', group: 'mobility' },

  burnChance: { name: 'Brandchance', fmt: 'chance', group: 'status' },
  chillChance: { name: 'Frostchance', fmt: 'chance', group: 'status' },
  poisonChance: { name: 'Giftchance', fmt: 'chance', group: 'status' },
  shockChance: { name: 'Schockchance', fmt: 'chance', group: 'status' },
  statusPower: { name: 'Zustandsstärke', fmt: 'pct', group: 'status' },
  statusDuration: { name: 'Zustandsdauer', fmt: 'pct', group: 'status' },

  physDamage: { name: 'Physischer Schaden', fmt: 'pct', group: 'elements' },
  fireDamage: { name: 'Feuerschaden', fmt: 'pct', group: 'elements' },
  frostDamage: { name: 'Frostschaden', fmt: 'pct', group: 'elements' },
  poisonDamage: { name: 'Giftschaden', fmt: 'pct', group: 'elements' },
  shockDamage: { name: 'Blitzschaden', fmt: 'pct', group: 'elements' },
  shadowDamage: { name: 'Schattenschaden', fmt: 'pct', group: 'elements' },
  lightDamage: { name: 'Lichtschaden', fmt: 'pct', group: 'elements' },

  luck: { name: 'Glück', fmt: 'dec', group: 'fortune' },
  xpGain: { name: 'Erfahrungsgewinn', fmt: 'pct', group: 'fortune' },
  sparkGain: { name: 'Funkengewinn', fmt: 'pct', group: 'fortune' },
  ashGain: { name: 'Aschegewinn', fmt: 'pct', group: 'fortune' },
  shopDiscount: { name: 'Händlerrabatt', fmt: 'chance', group: 'fortune' },
});

/** Format a player stat value for display ("120 %", "×1,75", "1,1 s", "92"). */
export function formatStatValue(stat, value) {
  const info = STAT_LABELS[stat];
  const v = num(value);
  switch (info ? info.fmt : 'dec') {
    case 'int': return formatNumber(Math.round(v));
    case 'pct': return `${formatNumber(v * 100)} %`;
    case 'chance': return `${formatNumber(v * 100, 1)} %`;
    case 'mult': return `×${formatNumber(v, 2)}`;
    case 'sec': return `${formatNumber(v, 2)} s`;
    case 'px': return `${formatNumber(Math.round(v))} px`;
    case 'persec': return `${formatNumber(v, 1)}/s`;
    default: return formatNumber(v, 2);
  }
}

/**
 * Character-sheet rows grouped by STAT_GROUPS.
 * @param {Record<string, number>} stats computed player stats
 * @param {Record<string, number>} [base] baseline stats (e.g. BASE_STATS) to flag changes
 * @returns {Array<{ group, name, rows: Array<{ stat, name, text, value, changed, better }> }>}
 */
export function statSheet(stats, base = null) {
  const groups = Object.keys(STAT_GROUPS).map((g) => ({ group: g, name: STAT_GROUPS[g], rows: [] }));
  const byGroup = Object.fromEntries(groups.map((g) => [g.group, g]));
  for (const stat of Object.keys(STAT_LABELS)) {
    if (!stats || !(stat in stats)) continue;
    const info = STAT_LABELS[stat];
    const value = num(stats[stat]);
    const b = base && stat in base ? num(base[stat]) : null;
    const changed = b != null && Math.abs(value - b) > 1e-6;
    const better = changed ? (info.lowerIsBetter ? value < b : value > b) : null;
    byGroup[info.group].rows.push({ stat, name: info.name, text: formatStatValue(stat, value), value, changed, better });
  }
  return groups.filter((g) => g.rows.length);
}
