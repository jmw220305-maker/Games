// Lazy access to content registries and optional modules (some may be missing or still in progress).
// Everything is loaded with dynamic import() so a broken/missing module never takes the whole UI down.

export const content = {
  CHARACTERS: {}, WEAPONS: {}, RELICS: {}, BOONS: {}, ENEMIES: {}, BOSSES: {}, AFFIXES: {},
  BIOMES: {}, FLOOR_ORDER: ['ash', 'fungal', 'frost', 'void', 'core'],
  BASE_STATS: null, computeStats: null,
  sprites: null,
  ACHIEVEMENTS: null, achievements: null, codex: null,
  STAT_LABELS: null, formatStatValue: null,
  loaded: false,
};

const listeners = new Set();
export function onContentLoaded(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// `loader` is a function with a literal import() so bundlers (esbuild) can resolve it.
async function tryImport(label, loader) {
  try {
    return await loader();
  } catch (err) {
    console.warn(`[ui] optional module ${label} unavailable:`, err && err.message ? err.message : err);
    return null;
  }
}

function pickExport(mods, name) {
  for (const m of mods) if (m && m[name] != null) return m[name];
  return null;
}

let loading = null;
export function loadContent() {
  if (loading) return loading;
  loading = (async () => {
    const [registry, biomes, stats, sprites, achievements, codex, progression, tracker] = await Promise.all([
      tryImport('registry', () => import('../game/registry.js')),
      tryImport('biomes', () => import('../data/biomes.js')),
      tryImport('stats', () => import('../game/stats.js')),
      tryImport('sprites', () => import('../render/sprites.js')),
      tryImport('achievements', () => import('../meta/achievements.js')),
      tryImport('codex', () => import('../meta/codex.js')),
      tryImport('progression', () => import('../meta/progression.js')),
      tryImport('tracker', () => import('../meta/tracker.js')),
    ]);
    if (registry) {
      for (const k of ['CHARACTERS', 'WEAPONS', 'RELICS', 'BOONS', 'ENEMIES', 'BOSSES', 'AFFIXES']) {
        if (registry[k]) content[k] = registry[k];
      }
    }
    if (biomes) {
      content.BIOMES = biomes.BIOMES || {};
      if (Array.isArray(biomes.FLOOR_ORDER)) content.FLOOR_ORDER = biomes.FLOOR_ORDER;
    }
    if (stats) { content.BASE_STATS = stats.BASE_STATS || null; content.computeStats = stats.computeStats || null; }
    if (sprites) content.sprites = sprites.sprites || sprites.default || null;
    content.achievements = achievements;
    content.codex = codex;
    const metaMods = [codex, achievements, progression, tracker];
    content.ACHIEVEMENTS = pickExport(metaMods, 'ACHIEVEMENTS');
    content.STAT_LABELS = pickExport(metaMods, 'STAT_LABELS');
    const fsv = pickExport(metaMods, 'formatStatValue');
    content.formatStatValue = typeof fsv === 'function' ? fsv : null;
    content.loaded = true;
    for (const fn of listeners) { try { fn(content); } catch (err) { console.error('[ui] content listener failed', err); } }
    return content;
  })();
  return loading;
}

/** Biome def for a floor index (1..5) or id. */
export function biomeFor(floorOrId) {
  if (typeof floorOrId === 'string') return content.BIOMES[floorOrId] || null;
  const id = content.FLOOR_ORDER[Math.max(1, Math.min(5, floorOrId | 0)) - 1];
  return content.BIOMES[id] || null;
}

export function enemyName(id) {
  if (!id) return '';
  if (typeof id === 'object') return id.name || (id.def && id.def.name) || '';
  const d = content.ENEMIES[id] || content.BOSSES[id];
  return d ? d.name : String(id);
}
