// Offline rendering hooks for verification (tools/audio-test.html, Playwright checks). Browser only: uses
// OfflineAudioContext. Renders the exact same patches / music code as the live engine, through the same mixer.

import { SFX, startSfx } from './sfx.js';
import { MusicEngine, TRACKS } from './music.js';
import { buildMixer } from './mixer.js';
import { measure } from './synth.js';

function OAC() {
  const C = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!C) throw new Error('OfflineAudioContext not available');
  return C;
}

function stats(buf) {
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  return measure(chans, buf.sampleRate);
}

/**
 * Render one sound effect.
 * Returns { name, peak, rms, nan, duration (dry, s), wetPeak (with reverb), limitedPeak (through the master chain) }.
 */
export async function renderSfx(name, opts = {}) {
  if (!SFX[name]) throw new Error(`unknown sfx ${name}`);
  const sr = opts.sampleRate || 44100;
  const seconds = opts.seconds || 8;
  const C = OAC();
  const run = async (reverb, limiter) => {
    const ctx = new C(2, Math.ceil(sr * seconds), sr);
    const mix = buildMixer(ctx, { reverb, limiter });
    startSfx(ctx, mix.sfx, reverb ? mix.sfxWet : null, name, 0.01, { pitch: opts.pitch ?? 1, volume: opts.volume ?? 1, seed: 1234 });
    return stats(await ctx.startRendering());
  };
  const dry = await run(false, false);
  const wet = await run(true, false);
  const lim = opts.limited ? await run(true, true) : null;
  return {
    name, peak: dry.peak, rms: dry.rms, nan: dry.nan || wet.nan, duration: dry.duration,
    wetPeak: wet.peak, limitedPeak: lim ? lim.peak : undefined,
  };
}

/**
 * Render `seconds` of a music track at a fixed intensity.
 * Returns { id, peak, rms, nan, duration, limitedPeak? }. `from`: measure only from this time on (e.g. skip an intro).
 */
export async function renderMusic(id, opts = {}) {
  if (!TRACKS[id]) throw new Error(`unknown track ${id}`);
  const sr = opts.sampleRate || 44100;
  const seconds = opts.seconds || 8;
  const C = OAC();
  const run = async (limiter) => {
    const ctx = new C(2, Math.ceil(sr * seconds), sr);
    const mix = buildMixer(ctx, { limiter });
    const eng = new MusicEngine(ctx, mix.music, mix.musicWet, { offline: true });
    eng.setIntensity(opts.intensity ?? 0, true);
    eng.play(id, { fade: 0.01 });
    eng.scheduleUntil(seconds);
    const buf = await ctx.startRendering();
    if (opts.from) {
      const start = Math.floor(opts.from * sr);
      const chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(start));
      return measure(chans, sr);
    }
    return stats(buf);
  };
  const raw = await run(false);
  const lim = opts.limited ? await run(true) : null;
  return { id, intensity: opts.intensity ?? 0, ...raw, limitedPeak: lim ? lim.peak : undefined };
}

/**
 * Worst case: a music track at full intensity plus a pile of simultaneous effects, through the full master chain.
 * Returns { rawPeak (before limiter), peak (after limiter + soft clip) }.
 */
export async function renderStress(opts = {}) {
  const sr = opts.sampleRate || 44100;
  const seconds = opts.seconds || 4;
  const names = opts.names || ['explosion', 'player_hit', 'enemy_crit', 'enemy_death', 'elite_death', 'boss_phase', 'enemy_slam', 'shoot_fire', 'levelup', 'relic_gain'];
  const C = OAC();
  const run = async (limiter) => {
    const ctx = new C(2, Math.ceil(sr * seconds), sr);
    const mix = buildMixer(ctx, { limiter });
    const eng = new MusicEngine(ctx, mix.music, mix.musicWet, { offline: true });
    eng.setIntensity(1, true);
    eng.play(opts.track || 'final', { fade: 0.01 });
    eng.scheduleUntil(seconds);
    // 24 voices piled into the first second
    for (let i = 0; i < 24; i++) startSfx(ctx, mix.sfx, mix.sfxWet, names[i % names.length], 0.2 + (i % 6) * 0.04, { seed: i + 1 });
    return stats(await ctx.startRendering());
  };
  const raw = await run(false);
  const lim = await run(true);
  return { rawPeak: raw.peak, peak: lim.peak, nan: raw.nan || lim.nan };
}
