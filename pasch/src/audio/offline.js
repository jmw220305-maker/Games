// Offline rendering helpers for tests (tools/audio-test.html, Playwright): render one sound or a stretch of
// music into an OfflineAudioContext and measure peak / RMS. Not used by the game itself.
import { Engine } from './engine.js';
import { SFX } from './sfx.js';
import { Music } from './music.js';

const SR = 44100;

function stats(buf) {
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      n++;
    }
  }
  // active length: last sample above -60 dB
  const d0 = buf.getChannelData(0);
  let last = 0;
  for (let i = d0.length - 1; i >= 0; i--) if (Math.abs(d0[i]) > 0.001) { last = i; break; }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { peak, peakDb: db(peak), rms, rmsDb: db(rms), length: last / buf.sampleRate };
}

/** Render a sound effect with the real sfx chain (compressor + limiter). */
export async function renderSound(name, opts = {}, seconds = 3.5) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const eng = new Engine(ctx);
  const def = SFX[name];
  if (!def) throw new Error('unknown sound ' + name);
  const t = 0.01;
  const v = eng.voice(name, t, opts, def.jitter == null ? 0.04 : def.jitter, def.level || 1);
  def.fn(v, t, opts);
  const buf = await ctx.startRendering();
  return stats(buf);
}

/** Render a sequence [[name, opts, time], …] */
export async function renderSequence(seq, seconds = 4) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const eng = new Engine(ctx);
  for (const [name, opts = {}, time = 0] of seq) {
    const def = SFX[name];
    const v = eng.voice(name, time + 0.01, opts, def.jitter == null ? 0.04 : def.jitter, def.level || 1);
    def.fn(v, time + 0.01, opts);
  }
  return stats(await ctx.startRendering());
}

/** Render `seconds` of music in a mood (scoring = lowpass open). */
export async function renderMusic(mood = 'round', seconds = 20, scoring = false) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const eng = new Engine(ctx);
  const m = new Music(eng);
  m.setMood(mood);
  m.start();
  if (scoring) m.scoringOpen(true);
  m.scheduleUntil(seconds - 0.5);
  return stats(await ctx.startRendering());
}
