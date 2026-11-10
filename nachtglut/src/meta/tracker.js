// Run tracker: listens to the event bus and keeps the save's codex, lifetime stats, history and
// unlocks up to date; finalises runs (ash reward, unlock toasts). DOM-free at import time.
import { bus as globalBus } from '../core/events.js';
import { biomeForFloor } from '../data/biomes.js';
import { persistSave, ensureSaveShape, HISTORY_MAX, MAX_DIFFICULTY } from './save.js';
import { computeAshReward, checkUnlocks, getDifficulty, setDisplayNames, WEAPON_UNLOCKS, CHARACTER_UNLOCKS } from './progression.js';

/** Minimum time between automatic saves while playing (ms). */
export const PERSIST_INTERVAL = 20000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const idOf = (e) => (e && ((e.def && e.def.id) || e.id)) || null;
const isBoss = (e) => !!(e && (e.boss || (e.def && e.def.boss)));
const inc = (obj, key, by = 1) => { obj[key] = num(obj[key]) + by; };

function difficultyLevel(run, summary) {
  const d = (run && run.difficulty != null) ? run.difficulty : summary && summary.difficulty;
  if (d && typeof d === 'object') return Math.max(0, Math.min(MAX_DIFFICULTY, Math.floor(num(d.level))));
  return Math.max(0, Math.min(MAX_DIFFICULTY, Math.floor(num(Number(d)))));
}

function killerName(k) {
  if (!k) return null;
  if (typeof k === 'string') return k;
  if (typeof k === 'object') return k.name || (k.def && k.def.name) || k.id || null;
  return null;
}

/** Toast payload for an unlock entry from `checkUnlocks`. */
export function unlockToast(u) {
  switch (u.type) {
    case 'character':
      return { kind: 'unlock', text: `Neuer Glutträger freigeschaltet: ${u.name}`, icon: { glyph: 'mask', color: '#ffd35a' } };
    case 'weapon':
      return { kind: 'unlock', text: `Neue Waffe im Schacht: ${u.name}`, icon: { glyph: 'sword', color: '#ffb347' } };
    case 'difficulty':
      return { kind: 'unlock', text: `Glutstufe ${u.id} freigeschaltet: ${u.name}`, icon: { glyph: 'flame', color: '#ff8a3c' } };
    default:
      return { kind: 'unlock', text: `Freigeschaltet: ${u.name}`, icon: { glyph: 'star', color: '#ffd35a' } };
  }
}

/**
 * Finalise a finished run on the save (pure apart from mutating `save` and `summary`).
 * Writes `summary.ash`, `summary.ashParts`, `summary.unlocks`; credits ash; updates lifetime stats,
 * per-character stats, history and unlocks. Does not persist or emit.
 * Lifetime kills/eliteKills/relics etc. are counted live by the tracker and are NOT added here.
 * @param {object} save
 * @param {{ run?: object, victory?: boolean, summary?: object }} payload
 * @returns {{ reward: { total: number, parts: object[] }, unlocks: object[] }}
 */
export function applyRunEnd(save, payload = {}) {
  ensureSaveShape(save);
  const run = payload.run || null;
  const summary = payload.summary || {};
  const victory = payload.victory === true || summary.victory === true;
  const rs = (summary.stats && typeof summary.stats === 'object') ? summary.stats : (run && run.stats) || {};
  const floor = Math.max(1, Math.min(5, Math.floor(num(summary.floor) || num(run && run.floorIndex) || 1)));
  const level = difficultyLevel(run, summary);
  const ashGain = run && run.player && run.player.stats && Number.isFinite(run.player.stats.ashGain) ? run.player.stats.ashGain : 1;
  const time = num(summary.time) || num(run && run.time);
  const character = summary.character || (run && run.character) || 'bearer';
  const abandoned = !victory && !!(summary.abandoned || (run && run.abandoned) || payload.abandoned);

  const reward = computeAshReward({
    floor, victory, stats: rs, difficulty: getDifficulty(level), ashGain, ashPickedUp: num(rs.ashPickedUp),
  });
  summary.ash = reward.total;
  summary.ashParts = reward.parts;
  save.ash = num(save.ash) + reward.total;
  save.totalAsh = num(save.totalAsh) + reward.total;

  // lifetime stats
  const st = save.stats;
  if (victory) inc(st, 'wins');
  else if (abandoned) inc(st, 'abandons');
  else inc(st, 'deaths');
  const reached = victory ? 5 : floor;
  st.bestFloor = Math.max(num(st.bestFloor), reached);
  inc(st, 'playTime', time);
  st.longestRun = Math.max(num(st.longestRun), time);
  if (victory && time > 0) st.fastestWin = st.fastestWin > 0 ? Math.min(st.fastestWin, time) : time;
  if (victory) st.highestDifficultyWon = Math.max(Number.isFinite(st.highestDifficultyWon) ? st.highestDifficultyWon : -1, level);
  st.totalSparks = num(st.totalSparks) + (num(rs.sparksCollected) || num(payload.sparksTally));
  for (const k of ['damageDealt', 'damageTaken', 'healed', 'critHits', 'dashes', 'roomsCleared']) inc(st, k, num(rs[k]));
  inc(st, 'floorsCleared', Number.isFinite(rs.floorsCleared) ? rs.floorsCleared : (victory ? 5 : floor - 1));
  st.bestKills = Math.max(num(st.bestKills), num(rs.kills));
  st.bestHit = Math.max(num(st.bestHit), num(rs.bestHit));
  const playerLevel = num(run && run.player && run.player.level) || num(summary.level);
  st.bestLevel = Math.max(num(st.bestLevel), playerLevel);

  // per character
  const cs = save.characterStats[character] || (save.characterStats[character] = {
    runs: 0, wins: 0, deaths: 0, kills: 0, bestFloor: 0, bestDifficulty: -1, fastestWin: 0,
  });
  if (!payload.runCounted) inc(cs, 'runs');
  if (victory) inc(cs, 'wins'); else if (!abandoned) inc(cs, 'deaths');
  inc(cs, 'kills', num(rs.kills));
  cs.bestFloor = Math.max(num(cs.bestFloor), reached);
  if (victory) {
    cs.bestDifficulty = Math.max(Number.isFinite(cs.bestDifficulty) ? cs.bestDifficulty : -1, level);
    if (time > 0) cs.fastestWin = cs.fastestWin > 0 ? Math.min(cs.fastestWin, time) : time;
  }

  // history (newest first)
  const biome = summary.biome || (biomeForFloor(floor) || {}).id || null;
  const entry = {
    date: Date.now(), victory, abandoned, character, difficulty: level, floor: reached, biome,
    time: Math.round(time * 10) / 10, kills: num(rs.kills), level: playerLevel, ash: reward.total,
    seedLabel: summary.seedLabel != null ? String(summary.seedLabel) : (run && run.seedLabel != null ? String(run.seedLabel) : ''),
  };
  const killedBy = killerName(summary.killedBy);
  if (killedBy && !victory) entry.killedBy = killedBy;
  if (Array.isArray(summary.relics)) entry.relics = summary.relics.filter((r) => typeof r === 'string').slice(0, 40);
  if (Array.isArray(summary.weapons)) {
    entry.weapons = summary.weapons.filter((w) => w && typeof w.id === 'string').slice(0, 4).map((w) => ({ id: w.id, level: num(w.level) || 1 }));
  }
  save.history.unshift(entry);
  if (save.history.length > HISTORY_MAX) save.history.length = HISTORY_MAX;

  const unlocks = checkUnlocks(save);
  summary.unlocks = unlocks;
  return { reward, unlocks };
}

/**
 * Subscribe the tracker to the bus.
 * @param {object} game  `game.save` (save object) and `game.run` (current run or null) are read at event time.
 * @param {{ bus?: object, now?: () => number, persistInterval?: number,
 *           registries?: { characters?: object, weapons?: object } }} [opts]
 * @returns {() => void} dispose
 */
export function initTracker(game, opts = {}) {
  const bus = opts.bus || globalBus;
  const now = opts.now || (() => Date.now());
  const interval = opts.persistInterval ?? PERSIST_INTERVAL;
  if (opts.registries) setDisplayNames(opts.registries);

  let dirty = false;
  let lastPersist = now();
  // per-run bookkeeping
  let cur = null; // { run, weapons: Set, sparks, bossStart: Map, counted }
  const finished = new WeakSet();

  const save = () => {
    const s = game && game.save;
    if (!s || typeof s !== 'object') return null;
    return ensureSaveShape(s);
  };
  const run = () => (game && game.run) || null;
  const runTime = () => { const r = run(); return r ? num(r.time) : 0; };

  function flush() {
    const s = game && game.save;
    if (!s) return;
    persistSave(s);
    dirty = false;
    lastPersist = now();
  }
  function touch() {
    dirty = true;
    if (now() - lastPersist >= interval) flush();
  }
  function changed(s) {
    flush();
    bus.emit('meta:change', { save: s });
  }
  function runState() {
    const r = run();
    if (!cur || (r && cur.run !== r)) cur = { run: r, weapons: new Set(), sparks: 0, bossStart: new Map(), counted: false };
    return cur;
  }
  function countWeapon(s, id) {
    if (!id) return;
    const st = runState();
    if (st.weapons.has(id)) return;
    st.weapons.add(id);
    inc(s.codex.weapons, id);
    inc(s.stats, 'weaponsFound');
  }

  const handlers = {
    'run:start'(p) {
      const s = save(); if (!s) return;
      const r = (p && p.run) || run();
      cur = { run: r, weapons: new Set(), sparks: 0, bossStart: new Map(), counted: true };
      inc(s.stats, 'runs');
      const ch = r && r.character;
      if (typeof ch === 'string') {
        const cs = s.characterStats[ch] || (s.characterStats[ch] = { runs: 0, wins: 0, deaths: 0, kills: 0, bestFloor: 0, bestDifficulty: -1, fastestWin: 0 });
        inc(cs, 'runs');
      }
      const ws = r && r.player && Array.isArray(r.player.weapons) ? r.player.weapons : [];
      for (const w of ws) if (w) countWeapon(s, w.id || (w.def && w.def.id));
      flush();
    },

    'run:end'(p) {
      const s = save(); if (!s || !p) return;
      const key = p.run || p.summary;
      if (key && typeof key === 'object') {
        if (finished.has(key)) return;
        finished.add(key);
      }
      const st = cur && (!p.run || cur.run === p.run) ? cur : null;
      const { unlocks } = applyRunEnd(s, { ...p, runCounted: !!(st && st.counted), sparksTally: st ? st.sparks : 0 });
      cur = null;
      for (const u of unlocks) bus.emit('ui:toast', unlockToast(u));
      changed(s);
    },

    'enemy:spawn'(p) {
      const s = save(); const e = p && p.enemy; const id = idOf(e);
      if (!s || !id) return;
      if (isBoss(e)) {
        const b = s.codex.bosses[id] || (s.codex.bosses[id] = { seen: false, kills: 0, bestTime: 0 });
        if (!b.seen) { b.seen = true; touch(); }
      } else {
        const en = s.codex.enemies[id] || (s.codex.enemies[id] = { seen: false, kills: 0 });
        if (!en.seen) { en.seen = true; touch(); }
      }
    },

    'boss:start'(p) {
      const id = idOf(p && p.boss);
      if (!id) return;
      const st = runState();
      if (!st.bossStart.has(id)) st.bossStart.set(id, runTime());
    },

    'enemy:death'(p) {
      const s = save(); const e = p && p.enemy;
      if (!s || !e) return;
      inc(s.stats, 'kills');
      if (p.elite || (Array.isArray(e.elite) && e.elite.length)) inc(s.stats, 'eliteKills');
      const id = idOf(e);
      if (id && !isBoss(e)) {
        const en = s.codex.enemies[id] || (s.codex.enemies[id] = { seen: true, kills: 0 });
        en.seen = true;
        inc(en, 'kills');
      }
      touch();
    },

    'boss:death'(p) {
      const s = save(); const id = idOf(p && p.boss);
      if (!s || !id) return;
      const b = s.codex.bosses[id] || (s.codex.bosses[id] = { seen: true, kills: 0, bestTime: 0 });
      b.seen = true;
      inc(b, 'kills');
      inc(s.stats, 'bossKills');
      const st = runState();
      const start = st.bossStart.has(id) ? st.bossStart.get(id) : null;
      st.bossStart.clear();
      if (start != null) {
        const dur = Math.round(Math.max(0, runTime() - start) * 10) / 10;
        if (dur > 0) b.bestTime = b.bestTime > 0 ? Math.min(b.bestTime, dur) : dur;
      }
      flush(); // boss kills feed unlocks: never lose them
    },

    'floor:enter'() { touch(); },

    'relic:gain'(p) {
      const s = save(); const id = p && (p.id || (p.def && p.def.id));
      if (!s || !id) return;
      inc(s.codex.relics, id);
      inc(s.stats, 'relicsFound');
      touch();
    },
    'curse:gain'(p) {
      const s = save(); const id = p && (p.id || (p.def && p.def.id));
      if (!s || !id) return;
      inc(s.codex.relics, id);
      inc(s.stats, 'cursesTaken');
      touch();
    },
    'boon:gain'(p) {
      const s = save(); const id = p && (p.id || (p.def && p.def.id));
      if (!s || !id) return;
      inc(s.codex.boons, id);
      inc(s.stats, 'boonsChosen');
      touch();
    },
    'weapon:gain'(p) {
      const s = save(); if (!s || !p) return;
      countWeapon(s, p.id);
      touch();
    },

    'pickup:collect'(p) {
      if (p && p.kind === 'spark') runState().sparks += num(p.amount);
    },
    'shop:buy'(p) {
      const s = save(); if (!s) return;
      inc(s.stats, 'purchases');
      inc(s.stats, 'sparksSpent', num(p && p.price));
      touch();
    },
    'player:levelup'(p) {
      const s = save(); if (!s) return;
      inc(s.stats, 'levelUps');
      s.stats.bestLevel = Math.max(num(s.stats.bestLevel), num(p && p.level));
    },
    'player:fall'() { const s = save(); if (s) { inc(s.stats, 'falls'); touch(); } },
    'player:revive'() { const s = save(); if (s) { inc(s.stats, 'revives'); touch(); } },
    'prop:open'(p) {
      const s = save(); if (!s || !p) return;
      if (p.kind === 'barrel') inc(s.stats, 'barrels');
      else if (p.kind === 'chest') inc(s.stats, 'chests');
      else if (p.kind === 'shrine') inc(s.stats, 'shrines');
      touch();
    },

    'settings:change'() { if (game && game.save) flush(); },
    'state:change'(p) {
      const to = p && p.to;
      if (dirty && (to === 'paused' || to === 'menu' || to === 'dead' || to === 'victory')) flush();
    },
  };

  const offs = Object.keys(handlers).map((evt) => bus.on(evt, handlers[evt]));

  // flush pending changes when the tab is hidden/closed (browser only)
  let removeDom = null;
  try {
    const win = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (win && typeof win.addEventListener === 'function') {
      const onHide = () => { if (dirty) flush(); };
      const onVis = () => { if (doc && doc.visibilityState === 'hidden' && dirty) flush(); };
      win.addEventListener('pagehide', onHide);
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVis);
      removeDom = () => {
        try { win.removeEventListener('pagehide', onHide); } catch { /* ignore */ }
        try { if (doc) doc.removeEventListener('visibilitychange', onVis); } catch { /* ignore */ }
      };
    }
  } catch { /* no DOM */ }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of offs) off();
    if (removeDom) removeDom();
    if (dirty) flush();
  }
  dispose.flush = flush;
  return dispose;
}

// re-exported for UI convenience (unlock screens)
export { WEAPON_UNLOCKS, CHARACTER_UNLOCKS };
