// Persistent save data: schema, defaults, migration, localStorage persistence, export/import.
// DOM-free at import time. `localStorage` is only touched inside functions and may be missing or throw;
// in that case the save lives in memory for the session and the game keeps working.

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'nachtglut.save.v1';
export const HISTORY_MAX = 20;
export const MAX_DIFFICULTY = 10;

const MAX_ASH = 1e9;
const MAX_COUNT = 1e12;
const MAX_KEYS = 4000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// In-memory copy of the last persisted JSON. Used when localStorage is unavailable.
let memoryStore = null;

// ---------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------
export function defaultSettings() {
  return {
    master: 0.8, music: 0.6, sfx: 0.8,
    shake: 1, flashes: true, damageNumbers: true,
    autoAim: false, autoFire: false, touchSide: 'right',
    showTimer: true, reducedMotion: false,
  };
}

export function defaultStats() {
  return {
    runs: 0, wins: 0, deaths: 0, abandons: 0,
    kills: 0, eliteKills: 0, bossKills: 0,
    bestFloor: 0, bestKills: 0, bestLevel: 0, bestHit: 0,
    playTime: 0, fastestWin: 0, longestRun: 0,
    highestDifficultyWon: -1,
    totalSparks: 0, sparksSpent: 0, purchases: 0, ashSpent: 0,
    damageDealt: 0, damageTaken: 0, healed: 0, critHits: 0, dashes: 0,
    roomsCleared: 0, floorsCleared: 0,
    relicsFound: 0, cursesTaken: 0, boonsChosen: 0, weaponsFound: 0, levelUps: 0,
    falls: 0, barrels: 0, chests: 0, shrines: 0, revives: 0,
  };
}

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    updatedAt: 0,
    ash: 0,
    totalAsh: 0,
    upgrades: {},
    unlocks: { characters: ['bearer'], weapons: [], difficulties: 0 },
    codex: { enemies: {}, relics: {}, weapons: {}, bosses: {}, boons: {} },
    achievements: {},
    counters: {},
    stats: defaultStats(),
    characterStats: {},
    history: [],
    settings: defaultSettings(),
    tutorialSeen: false,
    seenHints: {},
    runSnapshot: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Sanitising helpers
// ---------------------------------------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const okKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 64 && !FORBIDDEN_KEYS.has(k);

function num(v, def, min = 0, max = MAX_COUNT, int = false) {
  let n = v;
  if (typeof n === 'string' && n.trim() !== '') n = Number(n);
  if (typeof n !== 'number' || !Number.isFinite(n)) return def;
  if (int) n = Math.floor(n);
  return n < min ? min : n > max ? max : n;
}

function bool(v, def) {
  return typeof v === 'boolean' ? v : def;
}

/** JSON-safe deep clone that drops functions, cycles, forbidden keys and absurdly deep nesting. */
function cloneJson(v, depth = 0) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') return Number.isFinite(v) ? v : 0;
  if (t !== 'object' || depth > 8) return undefined;
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length && i < 500; i++) {
      const c = cloneJson(v[i], depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (!okKey(k) || ++n > MAX_KEYS) continue;
    const c = cloneJson(v[k], depth + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

function mapOf(raw, fn) {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (!okKey(k) || ++n > MAX_KEYS) continue;
    const v = fn(raw[k], k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function idList(raw, max = 200) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (okKey(v) && !out.includes(v) && out.length < max) out.push(v);
  }
  return out;
}

export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const out = {};
  // keep unknown primitive settings (the UI may add its own)
  for (const k of Object.keys(raw)) {
    if (!okKey(k) || k in d) continue;
    const v = raw[k];
    if (typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  out.master = num(raw.master, d.master, 0, 1);
  out.music = num(raw.music, d.music, 0, 1);
  out.sfx = num(raw.sfx, d.sfx, 0, 1);
  out.shake = num(raw.shake, d.shake, 0, 2);
  out.flashes = bool(raw.flashes, d.flashes);
  out.damageNumbers = bool(raw.damageNumbers, d.damageNumbers);
  out.autoAim = bool(raw.autoAim, d.autoAim);
  out.autoFire = bool(raw.autoFire, d.autoFire);
  out.touchSide = raw.touchSide === 'left' || raw.touchSide === 'right' ? raw.touchSide : d.touchSide;
  out.showTimer = bool(raw.showTimer, d.showTimer);
  out.reducedMotion = bool(raw.reducedMotion, d.reducedMotion);
  return out;
}

function sanitizeStats(raw) {
  const d = defaultStats();
  if (!isObj(raw)) return d;
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!okKey(k) || k in d) continue;
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v; // unknown numeric stats survive
  }
  for (const k of Object.keys(d)) out[k] = num(raw[k], d[k], 0, MAX_COUNT);
  for (const k of ['runs', 'wins', 'deaths', 'abandons', 'kills', 'eliteKills', 'bossKills', 'bestKills', 'bestLevel',
    'purchases', 'roomsCleared', 'floorsCleared', 'relicsFound', 'cursesTaken', 'boonsChosen', 'weaponsFound',
    'levelUps', 'falls', 'barrels', 'chests', 'shrines', 'revives', 'critHits', 'dashes']) out[k] = Math.floor(out[k]);
  out.bestFloor = num(raw.bestFloor, 0, 0, 5, true);
  out.highestDifficultyWon = num(raw.highestDifficultyWon, -1, -1, MAX_DIFFICULTY, true);
  return out;
}

function sanitizeHistoryEntry(e) {
  if (!isObj(e)) return undefined;
  const c = cloneJson(e);
  if (!isObj(c)) return undefined;
  c.victory = c.victory === true;
  c.floor = num(c.floor, 1, 1, 5, true);
  c.time = num(c.time, 0, 0, MAX_COUNT);
  c.ash = num(c.ash, 0, 0, MAX_ASH, true);
  c.difficulty = num(c.difficulty, 0, 0, MAX_DIFFICULTY, true);
  c.date = num(c.date, 0, 0, 1e15, true);
  if (typeof c.character !== 'string') c.character = 'bearer';
  return c;
}

/** Version upgrade steps. Each entry upgrades a raw object from version `v` to `v + 1`. */
const UPGRADE_STEPS = {
  // 0 -> 1: pre-release saves had no version field and stored the meta currency as `asche`.
  0(raw) {
    if (raw.ash === undefined && raw.asche !== undefined) raw.ash = raw.asche;
    delete raw.asche;
    return raw;
  },
};

function sanitize(input) {
  const out = defaultSave();
  if (!isObj(input)) return out;
  let raw = input;
  let v = num(raw.version, 0, 0, 9999, true);
  if (v < SAVE_VERSION) {
    raw = { ...raw };
    for (; v < SAVE_VERSION; v++) if (UPGRADE_STEPS[v]) raw = UPGRADE_STEPS[v](raw) || raw;
  }

  // unknown top-level fields are preserved (other modules may park data in the save)
  for (const k of Object.keys(raw)) {
    if (!okKey(k) || k in out) continue;
    const c = cloneJson(raw[k]);
    if (c !== undefined) out[k] = c;
  }

  out.version = SAVE_VERSION;
  out.createdAt = num(raw.createdAt, out.createdAt, 0, 1e15, true);
  out.updatedAt = num(raw.updatedAt, 0, 0, 1e15, true);
  out.ash = num(raw.ash, 0, 0, MAX_ASH, true);
  out.totalAsh = Math.max(out.ash, num(raw.totalAsh, 0, 0, MAX_ASH, true));
  out.upgrades = mapOf(raw.upgrades, (lv) => {
    const n = num(lv, 0, 0, 99, true);
    return n > 0 ? n : undefined;
  });

  const u = isObj(raw.unlocks) ? raw.unlocks : {};
  out.unlocks = {
    characters: idList(u.characters),
    weapons: idList(u.weapons),
    difficulties: num(u.difficulties, 0, 0, MAX_DIFFICULTY, true),
  };
  if (!out.unlocks.characters.includes('bearer')) out.unlocks.characters.unshift('bearer');
  for (const k of Object.keys(u)) {
    if (!okKey(k) || k in out.unlocks) continue;
    const c = cloneJson(u[k]);
    if (c !== undefined) out.unlocks[k] = c;
  }

  const c = isObj(raw.codex) ? raw.codex : {};
  out.codex = {
    enemies: mapOf(c.enemies, (e) => {
      if (typeof e === 'number') return { seen: true, kills: num(e, 0, 0, MAX_COUNT, true) };
      if (!isObj(e)) return e === true ? { seen: true, kills: 0 } : undefined;
      const kills = num(e.kills, 0, 0, MAX_COUNT, true);
      return { seen: bool(e.seen, false) || kills > 0, kills };
    }),
    relics: mapOf(c.relics, (n) => {
      const v2 = num(n === true ? 1 : n, 0, 0, MAX_COUNT, true);
      return v2 > 0 ? v2 : undefined;
    }),
    weapons: mapOf(c.weapons, (n) => {
      const v2 = num(n === true ? 1 : n, 0, 0, MAX_COUNT, true);
      return v2 > 0 ? v2 : undefined;
    }),
    bosses: mapOf(c.bosses, (b) => {
      if (!isObj(b)) return undefined;
      const kills = num(b.kills, 0, 0, MAX_COUNT, true);
      return { seen: bool(b.seen, false) || kills > 0, kills, bestTime: num(b.bestTime, 0, 0, MAX_COUNT) };
    }),
    boons: mapOf(c.boons, (n) => {
      const v2 = num(n === true ? 1 : n, 0, 0, MAX_COUNT, true);
      return v2 > 0 ? v2 : undefined;
    }),
  };

  out.achievements = mapOf(raw.achievements, (t) => {
    if (t === true) return 1;
    const n = num(t, 0, 0, 1e15, true);
    return n > 0 ? n : undefined;
  });
  out.counters = mapOf(raw.counters, (n) => {
    const v2 = num(n, 0, 0, MAX_COUNT);
    return v2 > 0 ? v2 : undefined;
  });
  out.stats = sanitizeStats(raw.stats);
  out.characterStats = mapOf(raw.characterStats, (s) => {
    if (!isObj(s)) return undefined;
    return {
      runs: num(s.runs, 0, 0, MAX_COUNT, true),
      wins: num(s.wins, 0, 0, MAX_COUNT, true),
      deaths: num(s.deaths, 0, 0, MAX_COUNT, true),
      kills: num(s.kills, 0, 0, MAX_COUNT, true),
      bestFloor: num(s.bestFloor, 0, 0, 5, true),
      bestDifficulty: num(s.bestDifficulty, -1, -1, MAX_DIFFICULTY, true),
      fastestWin: num(s.fastestWin, 0, 0, MAX_COUNT),
    };
  });

  out.history = [];
  if (Array.isArray(raw.history)) {
    for (const e of raw.history) {
      const h = sanitizeHistoryEntry(e);
      if (h && out.history.length < HISTORY_MAX) out.history.push(h);
    }
  }

  out.settings = sanitizeSettings(raw.settings);
  out.tutorialSeen = bool(raw.tutorialSeen, false);
  out.seenHints = mapOf(raw.seenHints, (v2) => (v2 ? true : undefined));
  out.runSnapshot = isObj(raw.runSnapshot) ? (cloneJson(raw.runSnapshot) ?? null) : null;

  // a won run implies the next Glutstufe is selectable
  if (out.stats.highestDifficultyWon >= 0) {
    out.unlocks.difficulties = Math.max(out.unlocks.difficulties, Math.min(MAX_DIFFICULTY, out.stats.highestDifficultyWon + 1));
  }
  return out;
}

/**
 * Turn anything (old save, partial save, garbage) into a valid save. Never throws.
 * @param {*} raw
 * @returns {object} save
 */
export function migrate(raw) {
  try {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { return defaultSave(); }
    }
    return sanitize(raw);
  } catch {
    return defaultSave();
  }
}

/**
 * Make sure a (possibly hand-built or partial) save object has every container the meta modules
 * write to. Mutates and returns `save`; existing values are left alone.
 */
export function ensureSaveShape(save) {
  if (!isObj(save)) return save;
  const d = defaultSave();
  for (const k of Object.keys(d)) {
    const want = d[k];
    const have = save[k];
    if (have === undefined) save[k] = want;
    else if (Array.isArray(want)) { if (!Array.isArray(have)) save[k] = want; }
    else if (isObj(want)) { if (!isObj(have)) save[k] = want; }
    else if (typeof want === 'number') { if (typeof have !== 'number' || !Number.isFinite(have)) save[k] = want; }
  }
  for (const k of Object.keys(d.codex)) if (!isObj(save.codex[k])) save.codex[k] = {};
  for (const k of Object.keys(d.stats)) {
    if (typeof save.stats[k] !== 'number' || !Number.isFinite(save.stats[k])) save.stats[k] = d.stats[k];
  }
  if (!Array.isArray(save.unlocks.characters)) save.unlocks.characters = ['bearer'];
  if (!Array.isArray(save.unlocks.weapons)) save.unlocks.weapons = [];
  if (typeof save.unlocks.difficulties !== 'number' || !Number.isFinite(save.unlocks.difficulties)) save.unlocks.difficulties = 0;
  for (const k of Object.keys(d.settings)) if (save.settings[k] === undefined) save.settings[k] = d.settings[k];
  return save;
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------
function storage() {
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
  } catch { /* access denied (privacy mode, sandboxed iframe, …) */ }
  return null;
}

function readStored() {
  const ls = storage();
  if (ls) {
    try {
      const raw = ls.getItem(SAVE_KEY);
      if (typeof raw === 'string' && raw.length) return raw;
    } catch { /* fall through to memory */ }
  }
  return memoryStore;
}

/** Load the save (localStorage → in-memory copy → fresh default). Never throws. */
export function loadSave() {
  const raw = readStored();
  if (typeof raw !== 'string') return defaultSave();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // keep the broken data around for manual recovery, then start fresh
    const ls = storage();
    if (ls) { try { ls.setItem(`${SAVE_KEY}.corrupt`, raw.slice(0, 200000)); } catch { /* ignore */ } }
    return defaultSave();
  }
  return migrate(parsed);
}

/**
 * Write the save. Cheap and synchronous; safe to call when localStorage is missing or full.
 * @returns {boolean} true when it reached localStorage, false when it only lives in memory
 */
export function persistSave(save) {
  if (!isObj(save)) return false;
  let json;
  try {
    save.updatedAt = Date.now();
    json = JSON.stringify(save);
  } catch {
    return false;
  }
  memoryStore = json;
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(SAVE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace the contents of `target` with `source` while keeping object identity
 * (`game.save` and `game.settings` stay the same objects). Returns `target`.
 */
export function assignSave(target, source) {
  if (!isObj(target) || !isObj(source) || target === source) return target;
  const settings = isObj(target.settings) ? target.settings : null;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
  if (settings && isObj(source.settings) && settings !== source.settings) {
    for (const k of Object.keys(settings)) delete settings[k];
    Object.assign(settings, source.settings);
    target.settings = settings;
  }
  return target;
}

/**
 * Wipe all progress. Persists and returns a fresh save.
 * @param {{ keepSettings?: object|boolean, into?: object }} [opts]
 *   keepSettings: a settings object (or a save's `settings`) to carry over;
 *   into: an existing save object to overwrite in place (keeps `game.save` identity).
 */
export function resetSave(opts = {}) {
  const fresh = defaultSave();
  const into = isObj(opts.into) ? opts.into : null;
  const keep = opts.keepSettings === true ? (into && into.settings) : opts.keepSettings;
  if (isObj(keep)) {
    fresh.settings = sanitizeSettings(keep);
    fresh.tutorialSeen = !!(into && into.tutorialSeen);
  }
  const ls = storage();
  if (ls) { try { ls.removeItem(SAVE_KEY); } catch { /* ignore */ } }
  memoryStore = null;
  const result = into ? assignSave(into, fresh) : fresh;
  persistSave(result);
  return result;
}

/** Forget the in-memory fallback copy (tests). */
export function clearMemorySave() {
  memoryStore = null;
}

// ---------------------------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------------------------
function utf8ToBase64(str) {
  if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  throw new Error('base64 unavailable');
}

function base64ToUtf8(b64) {
  if (typeof TextDecoder !== 'undefined' && typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
  throw new Error('base64 unavailable');
}

/** Serialise a save into a copy-pasteable base64 string. */
export function exportSave(save) {
  const clean = migrate(save);
  clean.runSnapshot = null;
  return utf8ToBase64(JSON.stringify({ game: 'nachtglut', version: SAVE_VERSION, exportedAt: Date.now(), save: clean }));
}

const ERR_EMPTY = 'Kein Spielstand-Code eingegeben.';
const ERR_INVALID = 'Der Spielstand-Code ist ungültig oder beschädigt.';
const ERR_FOREIGN = 'Dieser Code enthält keinen Nachtglut-Spielstand.';
const ERR_NEWER = 'Dieser Spielstand stammt aus einer neueren Spielversion und kann nicht geladen werden.';

function looksLikeSave(o) {
  return isObj(o) && (typeof o.ash === 'number' || isObj(o.upgrades) || isObj(o.stats) || isObj(o.settings) || isObj(o.codex));
}

/**
 * Parse and validate an exported save string. Throws an Error with a German message on garbage.
 * The imported save is persisted (so "import, then reload" works) unless `opts.persist === false`.
 * @param {string} str
 * @param {{ persist?: boolean }} [opts]
 * @returns {object} save
 */
export function importSave(str, opts = {}) {
  if (typeof str !== 'string' || !str.trim()) throw new Error(ERR_EMPTY);
  let text = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  let obj;
  if (text[0] === '{') {
    // plain JSON is accepted too (hand-edited backups)
    try { obj = JSON.parse(str); } catch { throw new Error(ERR_INVALID); }
  } else {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error(ERR_INVALID);
    while (text.length % 4) text += '=';
    try { obj = JSON.parse(base64ToUtf8(text)); } catch { throw new Error(ERR_INVALID); }
  }
  if (!isObj(obj)) throw new Error(ERR_INVALID);
  let raw;
  if (obj.game !== undefined || obj.save !== undefined) {
    if (obj.game !== 'nachtglut' || !looksLikeSave(obj.save)) throw new Error(ERR_FOREIGN);
    raw = obj.save;
  } else if (looksLikeSave(obj)) {
    raw = obj;
  } else {
    throw new Error(ERR_FOREIGN);
  }
  if (typeof raw.version === 'number' && raw.version > SAVE_VERSION) throw new Error(ERR_NEWER);
  const save = migrate(raw);
  if (opts.persist !== false) persistSave(save);
  return save;
}
