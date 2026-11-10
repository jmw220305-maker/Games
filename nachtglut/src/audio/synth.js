// Low-level synthesis helpers shared by the sfx library and the music engine.
// Everything here is import-safe in Node: nothing touches `window` or creates an AudioContext at import time.
// All functions take the (Offline)AudioContext they should work on, so the same code renders live and offline.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic integer hash -> float in [0, 1). Used for "seeded" musical variation. */
export function hash(a = 0, b = 0, c = 0, d = 0) {
  let h = 0x9e3779b9 ^ Math.imul(a | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ Math.imul(b | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) ^ Math.imul(c | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(d | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Small xorshift generator: returns a function yielding floats in [0, 1). */
export function prng(seed = 1) {
  let s = (seed | 0) || 0x1234567;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Noise buffers (shared, generated once per sample rate + colour; 2 s, seamless loop)

const NOISE_SECONDS = 2;
const noiseCache = new Map();

/**
 * @param {BaseAudioContext} ctx
 * @param {'white'|'pink'|'brown'} color
 * @returns {AudioBuffer} mono looping noise buffer, peak roughly within ±1
 */
export function noiseBuffer(ctx, color = 'white') {
  const sr = ctx.sampleRate;
  const key = `${color}@${sr}`;
  let buf = noiseCache.get(key);
  if (buf) return buf;
  const len = Math.floor(sr * NOISE_SECONDS);
  const xf = Math.floor(sr * 0.03); // loop crossfade length
  const raw = new Float32Array(len + xf);
  const rnd = prng(color === 'white' ? 0x51a7e1 : color === 'pink' ? 0x7f4a7c15 : 0x2545f491);
  if (color === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      raw[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
  } else if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rnd() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last * 3.2;
    }
  } else {
    for (let i = 0; i < raw.length; i++) raw[i] = rnd() * 2 - 1;
  }
  buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i];
  // make the loop seamless: blend the continuation past the end into the head
  for (let i = 0; i < xf; i++) {
    const x = i / xf;
    d[i] = raw[i] * x + raw[len + i] * (1 - x);
  }
  for (let i = 0; i < len; i++) d[i] = clamp(d[i], -1, 1);
  noiseCache.set(key, buf);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Reverb impulse response (generated: decaying, progressively darker stereo noise)

const irCache = new Map();

export function impulseResponse(ctx, seconds = 1.9, decay = 3.4) {
  const sr = ctx.sampleRate;
  const key = `${seconds}:${decay}@${sr}`;
  let buf = irCache.get(key);
  if (buf) return buf;
  const len = Math.floor(sr * seconds);
  buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.012); // pre-delay
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = prng(ch ? 0x3c6ef372 : 0x1b873593);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const env = Math.pow(1 - x, decay);
      const k = 0.55 - 0.45 * x; // one-pole coefficient: the tail loses its highs
      lp += (rnd() * 2 - 1 - lp) * k;
      // a few sparse early reflections give the space some definition
      const early = i - pre < sr * 0.08 && rnd() < 0.004 ? (rnd() * 2 - 1) * 0.9 : 0;
      d[i] = (lp + early) * env * Math.min(1, (i - pre) / (sr * 0.004));
    }
  }
  irCache.set(key, buf);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Wave shaper curves

let softClip = null;
/** Transparent below |x| = 0.6, then a smooth knee that never exceeds ~0.9. Used as the final safety stage. */
export function softClipCurve() {
  if (softClip) return softClip;
  const n = 4097, a = 0.6, lim = 0.97;
  softClip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= a ? ax : a + (lim - a) * Math.tanh((ax - a) / (lim - a));
    softClip[i] = Math.sign(x) * y;
  }
  return softClip;
}

const driveCache = new Map();
/** tanh drive curve, normalised to ±1. k ~1.5 = warm, 4+ = crunchy. */
export function driveCurve(k = 2) {
  const key = Math.round(k * 10);
  let c = driveCache.get(key);
  if (c) return c;
  const n = 1025;
  c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  driveCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Signal statistics (used by the offline verification hooks)

/** @param {Float32Array[]} channels */
export function measure(channels, sampleRate, threshold = 0.001) {
  let peak = 0, sum = 0, n = 0, nan = false, last = -1, first = -1;
  for (const d of channels) {
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (v !== v || v === Infinity || v === -Infinity) { nan = true; continue; }
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      if (a > threshold) { if (i > last) last = i; if (first < 0 || i < first) first = i; }
      sum += v * v; n++;
    }
  }
  return {
    peak, rms: n ? Math.sqrt(sum / n) : 0, nan,
    start: first < 0 ? 0 : first / sampleRate,
    duration: last < 0 ? 0 : (last + 1) / sampleRate,
  };
}
