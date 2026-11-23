// Meta-Profil: Statistik, Sammlung, Freischaltungen, Erfolge. Rein: Funktionen nehmen/geben Profil-Objekte.
// Persistenz macht die UI über core/storage.js, z. B.:
//   const profile = migrateProfile(load(PROFILE_KEY, null));  …  save(PROFILE_KEY, profile);
//   save(RUN_KEY, run) / loadRun(load(RUN_KEY, null))
import { ACHIEVEMENTS, ACHIEVEMENT_IDS } from './content/achievements.js';
import { CUPS, CUP_IDS } from './content/cups.js';
import { MAX_STAKE } from './content/stakes.js';
import { HANDS } from './hands.js';

export const PROFILE_VERSION = 1;
export const PROFILE_KEY = 'pasch.profile';
export const RUN_KEY = 'pasch.run';

const SUM_KEYS = ['throws', 'rerolls', 'moneyEarned', 'constellationsUsed', 'consumablesUsed', 'roundsWon', 'wardensBeaten', 'glassShattered', 'retriggers', 'wardenNoReroll', 'skips', 'talismansBought', 'packsOpened'];
const MAX_KEYS = ['bestThrow', 'highestAnte', 'maxRetriggers', 'maxMoney', 'maxTalismans', 'legendaryOwned', 'maxHandLevel'];

export function newProfile() {
  const stats = { runs: 0, wins: 0, losses: 0, bestWinStake: 0, bestHand: null, skipsInRun: 0, hands: {} };
  for (const k of SUM_KEYS) stats[k] = 0;
  for (const k of MAX_KEYS) stats[k] = 0;
  return {
    version: PROFILE_VERSION,
    settings: {
      speed: 1,
      volume: { master: 0.8, sfx: 0.8, music: 0.5 },
      muted: false,
      shake: 1,
      flashes: true,
      crt: true,
      reducedMotion: null,
      autoThrow: false,
    },
    stats,
    collection: { talismans: {}, consumables: {}, hands: {}, wardens: {} },
    unlocks: { cups: CUP_IDS.filter((id) => !CUPS[id].unlock), stakes: { wood: 1 } },
    achievements: {},
    history: [],
  };
}

/** Fehlende Felder auffüllen (alte/kaputte Profile). */
export function migrateProfile(obj) {
  const fresh = newProfile();
  if (!obj || typeof obj !== 'object') return fresh;
  const p = { ...fresh, ...obj };
  p.settings = { ...fresh.settings, ...(obj.settings || {}), volume: { ...fresh.settings.volume, ...((obj.settings || {}).volume || {}) } };
  p.stats = { ...fresh.stats, ...(obj.stats || {}), hands: { ...((obj.stats || {}).hands || {}) } };
  p.collection = { ...fresh.collection, ...(obj.collection || {}) };
  for (const k of Object.keys(fresh.collection)) p.collection[k] = { ...(p.collection[k] || {}) };
  p.unlocks = { cups: [...new Set([...fresh.unlocks.cups, ...((obj.unlocks || {}).cups || [])])], stakes: { ...fresh.unlocks.stakes, ...((obj.unlocks || {}).stakes || {}) } };
  p.achievements = { ...(obj.achievements || {}) };
  p.history = Array.isArray(obj.history) ? obj.history.slice(-50) : [];
  p.version = PROFILE_VERSION;
  return p;
}

/** Profil-Statistik + (noch nicht verbuchter Teil des) laufenden Laufs → Statistik für Erfolge. */
export function aggregateStats(profile, run) {
  const s = JSON.parse(JSON.stringify(profile.stats));
  if (!run) return s;
  const rs = run.stats;
  const snap = run.metaRecorded ? run.metaRecorded.stats : null;
  for (const k of SUM_KEYS) s[k] = (s[k] || 0) + Math.max(0, (rs[k] || 0) - (snap ? snap[k] || 0 : 0));
  for (const k of MAX_KEYS) s[k] = Math.max(s[k] || 0, rs[k] || 0);
  for (const [h, n] of Object.entries(rs.hands || {})) s.hands[h] = (s.hands[h] || 0) + Math.max(0, n - (snap ? (snap.hands || {})[h] || 0 : 0));
  s.skipsInRun = Math.max(s.skipsInRun || 0, rs.skips || 0);
  if (!run.metaRecorded) {
    if (run.won) {
      s.wins += 1;
      s.bestWinStake = Math.max(s.bestWinStake || 0, run.stake);
    }
  }
  return s;
}

function addAchievements(profile, s, events) {
  for (const id of ACHIEVEMENT_IDS) {
    if (profile.achievements[id]) continue;
    const a = ACHIEVEMENTS[id];
    let done = false;
    try {
      done = !!a.check(s);
    } catch (e) {
      done = false;
    }
    if (!done) continue;
    profile.achievements[id] = true;
    events.push({ type: 'achievement', id });
    if (a.unlocks && a.unlocks.kind === 'cup' && !profile.unlocks.cups.includes(a.unlocks.id)) {
      profile.unlocks.cups.push(a.unlocks.id);
      if (!profile.unlocks.stakes[a.unlocks.id]) profile.unlocks.stakes[a.unlocks.id] = 1;
      events.push({ type: 'unlock', kind: 'cup', id: a.unlocks.id });
    }
  }
}

function syncCollection(profile, run) {
  const c = profile.collection;
  const seen = run.seen || {};
  for (const id of seen.talismans || []) c.talismans[id] = c.talismans[id] || 'seen';
  for (const t of run.talismans) c.talismans[t.id] = 'owned';
  for (const id of seen.consumables || []) c.consumables[id] = c.consumables[id] || 'seen';
  for (const id of seen.wardens || []) c.wardens[id] = c.wardens[id] || 'seen';
  for (const id of run.stats.wardensBeatenIds || []) c.wardens[id] = 'beaten';
  for (const [h, n] of Object.entries(run.handPlays || {})) if (n > 0) c.hands[h] = Math.max(c.hands[h] || 0, 1);
}

/**
 * Während des Laufs aufrufen (z. B. nach jeder Aktion): Sammlung aktualisieren, Erfolge prüfen.
 * Idempotent. → events [{type:'achievement', id}, {type:'unlock', kind:'cup', id}]
 */
export function syncProfile(profile, run) {
  const events = [];
  if (run) syncCollection(profile, run);
  addAchievements(profile, aggregateStats(profile, run), events);
  return events;
}

/**
 * Am Laufende aufrufen (Niederlage, Sieg, oder Ende des Endlosspiels). Verbucht die Statistik genau einmal
 * (bei erneutem Aufruf nach Endlos nur den Zuwachs), schaltet Stufen frei. → events
 */
export function finishRun(profile, run) {
  const events = [];
  syncCollection(profile, run);
  const s = aggregateStats(profile, run);
  const first = !run.metaRecorded;
  const p = profile.stats;
  for (const k of SUM_KEYS) p[k] = s[k];
  for (const k of MAX_KEYS) p[k] = s[k];
  p.hands = s.hands;
  p.skipsInRun = s.skipsInRun;
  if (run.stats.bestThrow >= (p.bestThrowValue || 0) && run.stats.bestHand) {
    p.bestThrowValue = run.stats.bestThrow;
    p.bestHand = run.stats.bestHand;
  }
  if (first) {
    p.runs += 1;
    if (run.won) {
      p.wins += 1;
      p.bestWinStake = Math.max(p.bestWinStake || 0, run.stake);
      const cur = profile.unlocks.stakes[run.cup] || 1;
      if (run.stake >= cur && cur < MAX_STAKE) {
        profile.unlocks.stakes[run.cup] = Math.min(MAX_STAKE, run.stake + 1);
        events.push({ type: 'unlock', kind: 'stake', id: run.cup, stake: profile.unlocks.stakes[run.cup] });
      }
    } else {
      p.losses += 1;
    }
    profile.history.push({ seed: run.seed, cup: run.cup, stake: run.stake, ante: run.ante, won: !!run.won, bestThrow: run.stats.bestThrow });
    if (profile.history.length > 50) profile.history.shift();
  }
  run.metaRecorded = { stats: JSON.parse(JSON.stringify(run.stats)) };
  addAchievements(profile, aggregateStats(profile, run), events);
  return events;
}

export function isCupUnlocked(profile, cupId) {
  return profile.unlocks.cups.includes(cupId);
}

export function maxStake(profile, cupId) {
  return isCupUnlocked(profile, cupId) ? profile.unlocks.stakes[cupId] || 1 : 0;
}

/** Sammlung für die Anzeige: {talismans:{id:'seen'|'owned'}, consumables, hands:{id:1}, wardens:{id:'seen'|'beaten'}} + Zähler. */
export function collectionSummary(profile) {
  const c = profile.collection;
  return {
    ...c,
    counts: {
      talismans: Object.keys(c.talismans).length,
      consumables: Object.keys(c.consumables).length,
      hands: Object.keys(c.hands).length,
      handsTotal: Object.keys(HANDS).length,
      wardens: Object.keys(c.wardens).length,
      achievements: Object.keys(profile.achievements).length,
      achievementsTotal: ACHIEVEMENT_IDS.length,
    },
  };
}
