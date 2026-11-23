// Audio facade – the only audio module the UI imports (ARCHITECTURE §4).
// Safe before init() (everything is a no-op / remembered) and safe to import in Node (no AudioContext → no-op).
import { Engine, getAudioContextClass } from './engine.js';
import { SFX } from './sfx.js';
import { Music } from './music.js';

let eng = null;
let music = null;
let initAt = -1e9; // ms timestamp of the last init() call
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const pre = { vol: { master: 0.8, sfx: 1, music: 1 }, muted: false, mood: 'menu', playing: false, scoring: false };

function ready() {
  return eng !== null;
}

function boot() {
  const AC = getAudioContextClass();
  if (!AC) return false;
  let ctx;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    try { ctx = new AC(); } catch { return false; }
  }
  eng = new Engine(ctx);
  music = new Music(eng);
  for (const k of Object.keys(pre.vol)) eng.setVolume(k, pre.vol[k]);
  eng.mute(pre.muted);
  music.setMood(pre.mood);
  if (pre.playing) music.start();
  if (pre.scoring) music.scoringOpen(true);
  if (typeof document !== 'undefined' && document.addEventListener) {
    // pause everything while the tab is hidden; resume when visible again
    document.addEventListener('visibilitychange', () => {
      if (!eng) return;
      if (document.hidden) { if (eng.ctx.state === 'running') eng.ctx.suspend().catch(() => {}); }
      else eng.ctx.resume().catch(() => {});
    });
  }
  return true;
}

export const audio = {
  /** Create/resume the AudioContext. Call from a user gesture. Idempotent. */
  init() {
    if (!eng && !boot()) return;
    initAt = nowMs();
    if (eng.ctx.state !== 'running') {
      try { eng.ctx.resume().catch(() => {}); } catch { /* */ }
    }
  },

  /** bus: 'master' | 'sfx' | 'music', v: 0..1 */
  setVolume(bus, v) {
    if (!(bus in pre.vol)) return;
    pre.vol[bus] = Math.max(0, Math.min(1, Number(v) || 0));
    if (ready()) eng.setVolume(bus, pre.vol[bus]);
  },

  mute(b) {
    pre.muted = !!b;
    if (ready()) eng.mute(pre.muted);
  },

  /**
   * Play a synthesized sound.
   * opts: { pitch: semitones, step: pentatonic step (chip/mult/tick), gain: 0..2, pan: -1..1, progress: 0..1 (tick) }
   */
  play(name, opts = {}) {
    if (!ready()) return;
    const def = SFX[name];
    if (!def) return;
    const ctx = eng.ctx;
    // suspended (hidden tab / not unlocked): drop, so nothing piles up – except right after init(),
    // where resume() is still pending and the sound should play as soon as it resolves
    if (ctx.state !== 'running' && nowMs() - initAt > 1000) return;
    const now = ctx.currentTime;
    if (def.gap) {
      const last = eng.lastPlay.get(name);
      if (last != null && now - last < def.gap) return;
    }
    eng.lastPlay.set(name, now);
    const t = now + 0.005;
    try {
      const v = eng.voice(name, t, opts || {}, def.jitter == null ? 0.04 : def.jitter, def.level || 1);
      def.fn(v, t, opts || {});
      v.finish();
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[audio] play failed:', name, e);
    }
  },

  music: {
    start() {
      pre.playing = true;
      if (ready()) music.start();
    },
    stop() {
      pre.playing = false;
      if (ready()) music.stop();
    },
    /** 'menu' | 'round' | 'shop' | 'warden' – changes at the next bar with a smooth crossfade */
    setMood(m) {
      pre.mood = m;
      if (ready()) music.setMood(m);
    },
    /** true: music lowpass opens 900 → 4000 Hz (during scoring) */
    scoringOpen(b) {
      pre.scoring = !!b;
      if (ready()) music.scoringOpen(pre.scoring);
    },
    /** Temporarily lower the music by `db` decibels for `ms` milliseconds. */
    duck(db = 4, ms = 400) {
      if (ready()) music.duck(db, ms);
    },
  },
};

/** Debug/test access (not part of the public API). */
export function _internals() {
  return { eng, music, pre };
}

export default audio;
