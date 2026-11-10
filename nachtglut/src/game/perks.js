// Perk engine: relics, boons, curses and character passives share one hook system.
import { bus } from '../core/events.js';
import { RARITY_INFO } from './constants.js';
import { RELICS, BOONS } from './registry.js';

function ctxFor(run, perk) {
  return { w: run.world, player: run.player, run, rng: run.world ? run.world.rng : run.rng, stacks: perk.stacks, state: perk.state, perk };
}

function allPerks(player) {
  const out = [];
  if (player.passive) out.push(player.passive);
  for (const p of player.relics) out.push(p);
  for (const p of player.boons) out.push(p);
  return out;
}

/**
 * Run a hook on every perk the player owns.
 * For `onLethal` returns true if any perk returned true (first one wins).
 */
export function runHooks(run, name, arg) {
  if (!run || !run.player) return false;
  const player = run.player;
  if (player._hookDepth > 6) return false; // guard against relics triggering each other endlessly
  player._hookDepth = (player._hookDepth || 0) + 1;
  let result = false;
  try {
    const perks = allPerks(player);
    for (let i = 0; i < perks.length; i++) {
      const perk = perks[i];
      const fn = perk.def.hooks && perk.def.hooks[name];
      if (!fn) continue;
      try {
        const r = fn(ctxFor(run, perk), arg);
        if (name === 'onLethal' && r === true) { result = true; break; }
      } catch (err) {
        console.error(`[perk] ${perk.def.id}.${name} failed`, err);
      }
    }
  } finally {
    player._hookDepth--;
  }
  return result;
}

function staticMods(perk) {
  const m = perk.def.mods;
  if (!m) return null;
  return typeof m === 'function' ? m(perk.stacks) : m;
}

export function refreshPerkMods(player, perk) {
  const key = `${perk.kind}:${perk.def.id}`;
  const mods = staticMods(perk);
  if (mods && mods.length) player.addMod(key, mods);
  else player.removeMods(key);
}

/** Re-evaluate `dynamicMods` hooks (conditional stats). Called ~5x per second. */
export function refreshDynamicMods(run) {
  const player = run.player;
  let changed = false;
  for (const perk of allPerks(player)) {
    const fn = perk.def.hooks && perk.def.hooks.dynamicMods;
    if (!fn) continue;
    let mods = null;
    try { mods = fn(ctxFor(run, perk)); } catch (err) { console.error(`[perk] ${perk.def.id}.dynamicMods failed`, err); }
    const key = `dyn:${perk.kind}:${perk.def.id}`;
    const sig = mods && mods.length ? JSON.stringify(mods) : '';
    if (perk._dynSig !== sig) {
      perk._dynSig = sig;
      if (sig) player.mods.set(key, mods); else player.mods.delete(key);
      changed = true;
    }
  }
  if (changed) player.recalc();
}

export function makePerk(def, kind) {
  return { id: def.id, def, kind, stacks: 1, state: {} };
}

/** Give a relic/curse/boon by id. Returns the perk or null. */
export function addPerk(run, kind, id) {
  const reg = kind === 'boon' ? BOONS : RELICS;
  const def = reg[id];
  if (!def) { console.warn(`[perk] unknown ${kind} "${id}"`); return null; }
  const player = run.player;
  const list = kind === 'boon' ? player.boons : player.relics;
  let perk = list.find((p) => p.def.id === id);
  if (perk) {
    const max = def.maxStacks ?? 1;
    if (perk.stacks >= max) return perk;
    perk.stacks++;
  } else {
    perk = makePerk(def, kind);
    list.push(perk);
  }
  refreshPerkMods(player, perk);
  player.recalc();
  try { def.hooks && def.hooks.onGain && def.hooks.onGain(ctxFor(run, perk)); } catch (err) { console.error(`[perk] ${id}.onGain failed`, err); }
  if (kind === 'boon') bus.emit('boon:gain', { id, def, stacks: perk.stacks });
  else if (def.rarity === 'curse') bus.emit('curse:gain', { id, def });
  else { run.stats.relicsFound++; bus.emit('relic:gain', { id, def }); }
  return perk;
}

export function removePerk(run, kind, id) {
  const player = run.player;
  const list = kind === 'boon' ? player.boons : player.relics;
  const i = list.findIndex((p) => p.def.id === id);
  if (i < 0) return false;
  const perk = list[i];
  list.splice(i, 1);
  player.removeMods(`${perk.kind}:${id}`);
  player.mods.delete(`dyn:${perk.kind}:${id}`);
  player.recalc();
  return true;
}

function rarityWeight(rarity, luck, boost) {
  const l = Math.max(-5, Math.min(20, luck)) + boost * 4;
  switch (rarity) {
    case 'common': return Math.max(12, 60 - l * 4);
    case 'uncommon': return 28 + l * 2;
    case 'rare': return Math.max(1, 10 + l * 1.6);
    case 'legendary': return Math.max(0.3, 2 + l * 0.7);
    default: return 0;
  }
}

function eligible(def, run) {
  if (!def.requires) return true;
  try { return !!def.requires(run.player, run); } catch { return false; }
}

/**
 * Roll `n` distinct relic defs the player does not own yet.
 * opts: { boost = 0 (rarity boost steps), minRarity?, exclude?: Set<string>, rng? }
 */
export function rollRelics(run, n, opts = {}) {
  const rng = opts.rng || run.rng;
  const luck = run.player.stats.luck;
  const owned = new Set(run.player.relics.map((p) => p.def.id));
  const exclude = opts.exclude || new Set();
  const order = ['common', 'uncommon', 'rare', 'legendary'];
  const minIdx = opts.minRarity ? order.indexOf(opts.minRarity) : 0;
  let pool = Object.values(RELICS).filter((d) => d.rarity !== 'curse' && !owned.has(d.id) && !exclude.has(d.id)
    && !(run.offeredOut && run.offeredOut.has(d.id)) && order.indexOf(d.rarity) >= minIdx && eligible(d, run));
  if (pool.length < n) {
    pool = Object.values(RELICS).filter((d) => d.rarity !== 'curse' && !owned.has(d.id) && !exclude.has(d.id) && eligible(d, run));
  }
  const out = [];
  while (out.length < n && pool.length) {
    const pick = rng.weighted(pool, (d) => rarityWeight(d.rarity, luck, opts.boost || 0) * (d.weight ?? 1));
    out.push(pick);
    pool = pool.filter((d) => d !== pick);
  }
  return out;
}

export function rollCurse(run, rng = run.rng) {
  const owned = new Set(run.player.relics.map((p) => p.def.id));
  const pool = Object.values(RELICS).filter((d) => d.rarity === 'curse' && !owned.has(d.id));
  return pool.length ? rng.pick(pool) : null;
}

/** Roll `n` distinct boons that can still be stacked. */
export function rollBoons(run, n, opts = {}) {
  const rng = opts.rng || run.rng;
  const luck = run.player.stats.luck;
  const have = new Map(run.player.boons.map((p) => [p.def.id, p.stacks]));
  let pool = Object.values(BOONS).filter((d) => (have.get(d.id) || 0) < (d.maxStacks ?? 1) && eligible(d, run) && !(opts.exclude && opts.exclude.has(d.id)));
  const out = [];
  while (out.length < n && pool.length) {
    // owned boons are slightly more likely to show up again so builds can focus
    const pick = rng.weighted(pool, (d) => rarityWeight(d.rarity || 'common', luck, 0) * (d.weight ?? 1) * (have.has(d.id) ? 1.35 : 1));
    out.push(pick);
    pool = pool.filter((d) => d !== pick);
  }
  return out;
}

export function rarityColor(rarity) { return (RARITY_INFO[rarity] || RARITY_INFO.common).color; }
export function rarityName(rarity) { return (RARITY_INFO[rarity] || RARITY_INFO.common).name; }
