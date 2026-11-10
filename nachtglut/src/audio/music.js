// Generative music engine: one step-sequenced "track player" per active track, driven by a small lookahead
// scheduler on the AudioContext clock. Tracks are code: each step they decide (deterministically, via hashed
// seeds) which notes to play on two layers:
//   calm   — exploration layer, always audible
//   combat — percussion, driving bass, extra parts; its gain follows music intensity (0..1, ~0.8 s ramps)
// Import-safe in Node: nothing here touches an AudioContext until a MusicEngine is constructed with one.
// Works on OfflineAudioContext too: construct with { offline: true } and call scheduleUntil(seconds).

import { mtof, hash, clamp01, noiseBuffer, driveCurve } from './synth.js';

const LOOKAHEAD = 0.14;   // seconds scheduled ahead of the audio clock
const TICK_MS = 25;
const INTENSITY_TAU = 0.27; // setTargetAtTime constant: ~95 % of the way after 0.8 s

// ---------------------------------------------------------------------------------------------
// Theory

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENT_MINOR = [0, 3, 5, 7, 10];
const PENT_MAJOR = [0, 2, 4, 7, 9];

/** The game's recurring main motif ("Glutmotiv"): scale degrees + rhythm in 16th steps (one bar). */
export const MOTIF = Object.freeze([0, 2, 4, 3, 2, 1]);
export const MOTIF_RHYTHM = Object.freeze([2, 2, 4, 2, 2, 4]);

function degMidi(root, scale, deg) {
  const n = scale.length;
  return root + scale[((deg % n) + n) % n] + 12 * Math.floor(deg / n);
}

const ch = (b, n) => ({ b, n });
// 8-bar phrase form: bars sharing a number repeat the same cell; cells >= 2 evolve every 16 bars.
const FORM = [0, 1, 0, 2, 0, 1, 3, 4];

// ---------------------------------------------------------------------------------------------
// Instruments. Signature: (p = TrackPlayer, dst = AudioNode, t = start time, ...). Each note builds a handful of
// nodes and disconnects them itself once its sources end.

function off(nodes) {
  for (const n of nodes) { try { n.disconnect(); } catch (_) { /* already gone */ } }
}
function done(src, nodes) { src.onended = () => off(nodes); }

function env(ctx, t, a, hold, r, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.setTargetAtTime(0, t + a + hold, r / 5);
  return g;
}
function perc(ctx, t, peak, decay, a = 0.002) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 0.0015), t + a + decay);
  return g;
}
function panned(p, node, dst, pan, nodes) {
  if (pan && p.ctx.createStereoPanner) {
    const sp = p.ctx.createStereoPanner();
    sp.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(sp); sp.connect(dst); nodes.push(sp);
  } else node.connect(dst);
}
function noiseSrc(p, salt = 0) {
  const src = p.ctx.createBufferSource();
  src.buffer = noiseBuffer(p.ctx, 'white');
  src.loop = true;
  src._offset = p.r(50 + salt) * 1.8;
  return src;
}

export const I = {
  /** Detuned oscillator pad through a breathing lowpass. */
  pad(p, dst, t, notes, dur, o = {}) {
    const ctx = p.ctx;
    const a = o.a ?? 1.2, r = o.r ?? 1.6, det = o.det ?? 7, cut = o.cut ?? 900;
    const hold = Math.max(0, dur - a);
    const end = t + a + hold + r;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = o.q ?? 0.5;
    f.frequency.setValueAtTime(cut * 0.55, t);
    f.frequency.linearRampToValueAtTime(cut, t + Math.max(a, dur * 0.5));
    f.frequency.linearRampToValueAtTime(cut * 0.5, end);
    const voices = notes.length * (det ? 2 : 1);
    const g = env(ctx, t, a, hold, r, (o.g ?? 0.1) / Math.sqrt(voices));
    f.connect(g); g.connect(dst);
    const nodes = [f, g];
    let lA = null, lB = null;
    if (o.drift) { // slow opposed detune drift: beating that never settles (void)
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.drift[0];
      lA = ctx.createGain(); lA.gain.value = o.drift[1];
      lB = ctx.createGain(); lB.gain.value = -o.drift[1];
      lfo.connect(lA); lfo.connect(lB);
      lfo.start(t); lfo.stop(end);
      nodes.push(lfo, lA, lB);
    }
    let first = null;
    for (const m of notes) {
      for (const d of det ? [-det, det] : [0]) {
        const osc = ctx.createOscillator();
        osc.type = o.type || 'sawtooth';
        osc.frequency.value = mtof(m);
        osc.detune.value = d;
        if (lA) (d < 0 ? lA : lB).connect(osc.detune);
        osc.connect(f);
        osc.start(t); osc.stop(end);
        nodes.push(osc);
        if (!first) first = osc;
      }
    }
    done(first, nodes);
  },

  /** Choir-like pad: detuned saws through vowel formant bandpasses with a shared vibrato. */
  choir(p, dst, t, notes, dur, o = {}) {
    const ctx = p.ctx;
    const a = o.a ?? 1.4, r = o.r ?? 2;
    const hold = Math.max(0, dur - a);
    const end = t + a + hold + r;
    const voices = notes.length * 2;
    const g = env(ctx, t, a, hold, r, (o.g ?? 0.12) / Math.sqrt(voices));
    g.connect(dst);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const nodes = [g, mix];
    const forms = o.vowel === 'o' ? [[420, 4, 'bandpass'], [820, 5, 'bandpass'], [330, 0.4, 'lowpass']]
      : [[720, 3.5, 'bandpass'], [1180, 4.5, 'bandpass'], [2650, 7, 'bandpass'], [380, 0.4, 'lowpass']];
    for (const [fr, q, type] of forms) {
      const bp = ctx.createBiquadFilter();
      bp.type = type; bp.frequency.value = fr; bp.Q.value = q;
      mix.connect(bp); bp.connect(g); nodes.push(bp);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibRate ?? 4.6;
    const lg = ctx.createGain();
    lg.gain.value = o.vib ?? 9;
    lfo.connect(lg);
    lfo.start(t); lfo.stop(end);
    nodes.push(lfo, lg);
    let first = null;
    for (const m of notes) {
      for (const d of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = mtof(m);
        osc.detune.value = d;
        lg.connect(osc.detune);
        osc.connect(mix);
        osc.start(t); osc.stop(end);
        nodes.push(osc);
        if (!first) first = osc;
      }
    }
    done(first, nodes);
  },

  /** Long drone with a slowly sweeping filter. */
  drone(p, dst, t, notes, dur, o = {}) {
    const ctx = p.ctx;
    const a = o.a ?? 2.5, r = o.r ?? 3;
    const hold = Math.max(0, dur - a);
    const end = t + a + hold + r;
    const cut = o.cut ?? 400;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = o.q ?? 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.lfo ?? 0.08;
    const lg = ctx.createGain();
    lg.gain.value = o.depth ?? cut * 0.5;
    lfo.connect(lg); lg.connect(f.frequency);
    const g = env(ctx, t, a, hold, r, (o.g ?? 0.15) / Math.sqrt(notes.length));
    f.connect(g); g.connect(dst);
    const nodes = [f, lfo, lg, g];
    lfo.start(t); lfo.stop(end);
    let first = null;
    notes.forEach((m, i) => {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = i % 2 ? 5 : -4;
      osc.connect(f);
      osc.start(t); osc.stop(end);
      nodes.push(osc);
      if (!first) first = osc;
    });
    done(first, nodes);
  },

  /** Filtered bass note with a short filter envelope. */
  bass(p, dst, t, m, dur, o = {}) {
    const ctx = p.ctx;
    const r = o.r ?? 0.08;
    const end = t + dur + r;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sawtooth';
    osc.frequency.value = mtof(m);
    const nodes = [osc];
    let node = osc;
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(o.drive);
      osc.connect(ws); node = ws; nodes.push(ws);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = o.q ?? 2;
    const cut = o.cut ?? 600;
    f.frequency.setValueAtTime(cut * (o.env ?? 2.5), t);
    f.frequency.exponentialRampToValueAtTime(cut, t + (o.decay ?? 0.14));
    const g = env(ctx, t, o.a ?? 0.005, Math.max(0, dur - 0.005), r, o.g ?? 0.2);
    node.connect(f); f.connect(g); g.connect(dst);
    nodes.push(f, g);
    osc.start(t); osc.stop(end);
    done(osc, nodes);
  },

  /** Plucked string / felt piano; `bubble` turns it into a wet resonant blip. */
  pluck(p, dst, t, m, dur, o = {}) {
    const ctx = p.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sawtooth';
    osc.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    if (o.bubble) {
      f.Q.value = o.q ?? 11;
      f.frequency.setValueAtTime(220, t);
      f.frequency.exponentialRampToValueAtTime(o.cut ?? 2600, t + 0.045);
      f.frequency.exponentialRampToValueAtTime(380, t + dur);
    } else {
      f.Q.value = o.q ?? 1;
      const cut = o.cut ?? 2000;
      f.frequency.setValueAtTime(cut, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(80, cut * 0.12), t + dur * 0.8);
    }
    const g = perc(ctx, t, o.g ?? 0.12, dur, o.a ?? 0.003);
    osc.connect(f); f.connect(g);
    const nodes = [osc, f, g];
    panned(p, g, dst, o.pan, nodes);
    osc.start(t); osc.stop(t + dur + 0.03);
    done(osc, nodes);
  },

  /** FM bell / glass. ratio 2 = warm, 3.5 = glassy, 1.41 = metallic clang. */
  bell(p, dst, t, m, dur, o = {}) {
    const ctx = p.ctx;
    const fr = mtof(m);
    const car = ctx.createOscillator();
    car.frequency.value = fr;
    const mod = ctx.createOscillator();
    mod.frequency.value = fr * (o.ratio ?? 3.5);
    const mg = ctx.createGain();
    const idx = o.idx ?? 1.5;
    mg.gain.setValueAtTime(fr * idx, t);
    mg.gain.exponentialRampToValueAtTime(fr * idx * 0.04 + 0.01, t + dur * 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = perc(ctx, t, o.g ?? 0.08, dur, o.a ?? 0.003);
    car.connect(g);
    const nodes = [car, mod, mg, g];
    panned(p, g, dst, o.pan, nodes);
    const end = t + dur + 0.05;
    car.start(t); mod.start(t);
    car.stop(end); mod.stop(end);
    done(car, nodes);
  },

  /** Expressive lead with delayed vibrato; brightness follows intensity when `bright` is set. */
  lead(p, dst, t, m, dur, o = {}) {
    const ctx = p.ctx;
    const a = o.a ?? 0.03, r = o.r ?? 0.3;
    const hold = Math.max(0, dur - a);
    const end = t + a + hold + r;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = o.q ?? 1;
    const cut = (o.cut ?? 1400) * (1 + (o.bright ?? 0) * p.ci);
    f.frequency.setValueAtTime(cut * 0.6, t);
    f.frequency.linearRampToValueAtTime(cut, t + Math.min(0.12, dur));
    const g = env(ctx, t, a, hold, r, o.g ?? 0.1);
    f.connect(g);
    const nodes = [f, g];
    panned(p, g, dst, o.pan, nodes);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibRate ?? 5.3;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + Math.min(0.2, dur * 0.4));
    lg.gain.linearRampToValueAtTime(o.vib ?? 12, t + Math.min(0.6, dur));
    lfo.connect(lg);
    lfo.start(t); lfo.stop(end);
    nodes.push(lfo, lg);
    let first = null;
    for (const d of o.det ? [-o.det, o.det] : [0]) {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = d;
      lg.connect(osc.detune);
      osc.connect(f);
      osc.start(t); osc.stop(end);
      nodes.push(osc);
      if (!first) first = osc;
    }
    done(first, nodes);
  },

  /** Sub pulse (a heartbeat in the dark) with its octave so small speakers still hear it. */
  sub(p, dst, t, m, dur, o = {}) {
    const ctx = p.ctx;
    const fr = mtof(m);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(fr * 1.3, t);
    osc.frequency.exponentialRampToValueAtTime(fr, t + 0.06);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = fr * 2;
    const g2 = ctx.createGain();
    g2.gain.value = o.oct ?? 0.35;
    const g = perc(ctx, t, o.g ?? 0.3, dur, 0.012);
    osc.connect(g); o2.connect(g2); g2.connect(g); g.connect(dst);
    const end = t + dur + 0.05;
    osc.start(t); o2.start(t); osc.stop(end); o2.stop(end);
    done(osc, [osc, o2, g2, g]);
  },

  kick(p, dst, t, o = {}) {
    const ctx = p.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(o.f ?? 140, t);
    osc.frequency.exponentialRampToValueAtTime(o.f1 ?? 44, t + (o.sweep ?? 0.08));
    const d = o.d ?? 0.32;
    const g = perc(ctx, t, o.g ?? 0.6, d, 0.002);
    osc.connect(g); g.connect(dst);
    osc.start(t); osc.stop(t + d + 0.03);
    done(osc, [osc, g]);
  },

  snare(p, dst, t, o = {}) {
    const ctx = p.ctx;
    const d = o.d ?? 0.16;
    const src = noiseSrc(p, 1);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = o.f ?? 1900; f.Q.value = o.q ?? 0.8;
    const g = perc(ctx, t, o.g ?? 0.3, d, 0.0015);
    src.connect(f); f.connect(g); g.connect(dst);
    const nodes = [src, f, g];
    if ((o.body ?? 1) > 0) {
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.setValueAtTime(o.tone ?? 200, t);
      tri.frequency.exponentialRampToValueAtTime((o.tone ?? 200) * 0.75, t + 0.06);
      const tg = perc(ctx, t, (o.g ?? 0.3) * 0.9 * (o.body ?? 1), 0.08, 0.0015);
      tri.connect(tg); tg.connect(dst);
      tri.start(t); tri.stop(t + 0.1);
      done(tri, [tri, tg]);
    }
    src.start(t, src._offset); src.stop(t + d + 0.02);
    done(src, nodes);
  },

  hat(p, dst, t, o = {}) {
    const ctx = p.ctx;
    const d = o.d ?? 0.04;
    const src = noiseSrc(p, 2);
    const f = ctx.createBiquadFilter();
    f.type = o.bp ? 'bandpass' : 'highpass';
    f.frequency.value = o.f ?? 7500;
    f.Q.value = o.bp ? 1.5 : 0.7;
    const g = perc(ctx, t, o.g ?? 0.08, d, 0.001);
    src.connect(f); f.connect(g);
    const nodes = [src, f, g];
    panned(p, g, dst, o.pan, nodes);
    src.start(t, src._offset); src.stop(t + d + 0.02);
    done(src, nodes);
  },

  tom(p, dst, t, fr, o = {}) {
    const ctx = p.ctx;
    const d = o.d ?? 0.35;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(fr * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(fr, t + 0.05);
    const g = perc(ctx, t, o.g ?? 0.3, d, 0.002);
    osc.connect(g); g.connect(dst);
    osc.start(t); osc.stop(t + d + 0.03);
    done(osc, [osc, g]);
  },

  /** Filtered noise swell: wind, whispers, risers. */
  swell(p, dst, t, dur, o = {}) {
    const ctx = p.ctx;
    const src = noiseSrc(p, 3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = o.q ?? 2;
    f.frequency.setValueAtTime(o.f0 ?? 400, t);
    f.frequency.exponentialRampToValueAtTime(o.f1 ?? 1600, t + dur);
    const g = ctx.createGain();
    const pk = t + dur * (o.peakAt ?? 0.6);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.g ?? 0.05, pk);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f); f.connect(g);
    const nodes = [src, f, g];
    panned(p, g, dst, o.pan, nodes);
    src.start(t, src._offset); src.stop(t + dur + 0.02);
    done(src, nodes);
  },

  /** Hearth crackle: a tiny bright click. */
  crackle(p, dst, t, o = {}) {
    const ctx = p.ctx;
    const src = noiseSrc(p, 4);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = o.f ?? 1800;
    const g = perc(ctx, t, o.g ?? 0.03, o.d ?? 0.015, 0.0008);
    src.connect(f); f.connect(g);
    const nodes = [src, f, g];
    panned(p, g, dst, o.pan, nodes);
    src.start(t, src._offset); src.stop(t + (o.d ?? 0.015) + 0.02);
    done(src, nodes);
  },

  /** Water drop: sine with a fast downward pitch blip. */
  drop(p, dst, t, fr, o = {}) {
    const ctx = p.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(fr, t);
    osc.frequency.exponentialRampToValueAtTime(fr * 1.9, t + 0.05);
    const g = perc(ctx, t, o.g ?? 0.05, 0.1, 0.002);
    osc.connect(g);
    const nodes = [osc, g];
    panned(p, g, dst, o.pan, nodes);
    osc.start(t); osc.stop(t + 0.13);
    done(osc, nodes);
  },
};

/** Play the main motif starting at time t. o: { root, scale, deg0, end, stretch, oct, legato, opt } */
function motif(p, dst, t, inst, o = {}) {
  const sc = o.scale || p.def.scale;
  const root = o.root ?? p.def.root;
  const stretch = o.stretch ?? 1;
  const degs = o.degs || MOTIF;
  const rhythm = o.rhythm || MOTIF_RHYTHM;
  let at = 0;
  for (let i = 0; i < degs.length; i++) {
    const last = i === degs.length - 1;
    const deg = (o.deg0 ?? 0) + (last && o.end != null ? o.end : degs[i]);
    const len = rhythm[i] * stretch;
    const dur = len * p.sd * (last ? (o.lastLen ?? 1.3) : (o.legato ?? 0.92));
    inst(p, dst, t + at * p.sd, degMidi(root, sc, deg) + (o.oct ?? 0) * 12, dur, o.opt || {});
    at += len;
  }
}

/** Pattern drums: k/s/h strings, one char per step. x = hit, X = accent, o = 50 % ghost, g = ghost snare, O = open hat. */
function drums(p, dst, t, pat, o = {}) {
  const s = p.s, n = p.steps, gm = o.g ?? 1;
  const fillLen = o.fillLen ?? 4;
  if (o.fill && p.lb % 8 === 7 && s >= n - fillLen) {
    const k = s - (n - fillLen);
    if (o.fill === 'tom') I.tom(p, dst, t, [190, 160, 128, 98, 82, 70][k % 6], { g: 0.32 * gm });
    else I.snare(p, dst, t, { g: (0.1 + 0.05 * k) * gm, ...o.snare });
    if (k === 0) I.kick(p, dst, t, { g: 0.5 * gm, ...o.kick });
    return;
  }
  const kc = pat.k[s], sc = pat.s[s], hc = pat.h[s];
  if (kc === 'x' || kc === 'X' || (kc === 'o' && p.r(11) < 0.5)) I.kick(p, dst, t, { g: (kc === 'o' ? 0.35 : 0.55) * gm, ...o.kick });
  if (sc === 'x' || sc === 'X') I.snare(p, dst, t, { g: (sc === 'X' ? 0.34 : 0.26) * gm, ...o.snare });
  else if (sc === 'g' && p.r(12) < 0.55) I.snare(p, dst, t, { g: 0.06 * gm, ...o.snare });
  if (hc === 'x' || hc === 'X' || (hc === 'o' && p.r(13) < 0.45)) I.hat(p, dst, t, { g: (hc === 'X' ? 0.1 : 0.055) * gm, ...o.hat });
  else if (hc === 'O') I.hat(p, dst, t, { g: 0.07 * gm, d: 0.22, ...o.hat });
  if (o.crash && s === 0 && p.lb % 8 === 0) I.hat(p, dst, t, { g: 0.08 * gm, d: 1.3, f: 4200 });
}

/** Random walk on a scale, seeded per phrase cell (so cells repeat exactly). Returns the new degree. */
function walk(p, key, lo, hi, salt) {
  const r = p.rf(salt);
  const stepTbl = [-2, -1, -1, 0, 1, 1, 2, -3, 3];
  let d = (p.mel[key] ?? 0) + stepTbl[Math.floor(r * stepTbl.length)];
  if (d < lo) d = lo + (lo - d);
  if (d > hi) d = hi - (d - hi);
  p.mel[key] = d;
  return d;
}

// ---------------------------------------------------------------------------------------------
// Tracks. Fields: bpm, steps (16ths per bar), root (MIDI), scale, prog (chords: b = bass, n = voicing),
// bpc (bars per chord), intro (bars played once before the loop; introPlay), send [calm, combat] reverb,
// level (track gain), duck (calm layer reduction at full intensity), fadeIn (s).

const D = {
  Dm: ch(38, [50, 57, 62, 65]), Bb: ch(34, [50, 53, 58, 62]), C: ch(36, [52, 55, 60, 64]), Am: ch(33, [48, 52, 57, 60]),
  Gm: ch(43, [50, 55, 58, 62]), A: ch(33, [49, 52, 57, 61]), F: ch(41, [48, 53, 57, 60]),
};

export const TRACKS = {
  // The hearth: warm, slow, hopeful-melancholic. The motif in a music-box bell, a crackling fire.
  menu: {
    bpm: 64, root: 62, scale: AEOLIAN, send: [0.5, 0.2], level: 0.95, fadeIn: 2,
    prog: [ch(38, [50, 57, 64, 65]), ch(34, [50, 53, 57, 62]), ch(41, [48, 53, 57, 60]), ch(36, [48, 52, 55, 62]),
      ch(43, [50, 53, 58, 62]), ch(34, [50, 53, 58, 65]), ch(33, [50, 52, 57, 62]), ch(33, [49, 52, 57, 61])],
    play(p, t) {
      const { s, lb, chord } = p;
      const m8 = lb % 8;
      if (s === 0) {
        I.pad(p, p.calm, t, chord.n, p.bd, { type: 'triangle', det: 5, cut: 1500, a: 1.6, r: 2.4, g: 0.2 });
        I.pad(p, p.calm, t, [chord.n[1] + 12, chord.n[3] + 12], p.bd, { type: 'sawtooth', det: 9, cut: 900, a: 2.2, r: 2.5, g: 0.035 });
        I.bass(p, p.calm, t, chord.b, p.bd * 0.9, { type: 'triangle', cut: 420, env: 1.2, q: 0.3, g: 0.26, r: 1.5 });
      }
      const motifBar = m8 === 0 || m8 === 4;
      if (s === 0 && motifBar) {
        const second = m8 === 4;
        const cyc = Math.floor(lb / 8);
        motif(p, p.calm, t, I.bell, {
          root: 74, deg0: second ? 3 : 0, end: second && cyc % 2 ? 2 : undefined,
          opt: { ratio: 2, idx: 1.3, g: 0.075 },
        });
      }
      if (s % 2 === 0 && p.rf(3) < (motifBar ? 0.22 : 0.55)) {
        const tones = chord.n.map((x) => x + 12);
        const idx = [0, 2, 1, 3, 2, 1, 3, 2][(s >> 1) % 8];
        I.pluck(p, p.calm, t + p.r(4) * 0.012, tones[idx], 1.7, { type: 'triangle', cut: 2200, q: 0.4, g: 0.085, pan: (idx - 1.5) * 0.25 });
      }
      if (p.r(9) < 0.32) I.crackle(p, p.calm, t + p.r(10) * p.sd, { g: 0.012 + p.r(11) * 0.03, pan: p.r(12) - 0.5, d: 0.008 + p.r(14) * 0.02 });
      if (p.ci > 0.01 && (s === 0 || s === 3)) I.sub(p, p.combat, t, 38, 0.5, { g: s ? 0.12 : 0.18 });
    },
  },

  // Ash pits: low drones, sparse plucks in D minor, a distant anvil.
  ash: {
    bpm: 76, root: 50, scale: AEOLIAN, send: [0.45, 0.12], level: 0.95,
    prog: [D.Dm, D.Dm, ch(34, [50, 58, 62, 65]), ch(36, [50, 55, 60, 64]), D.Dm, D.Dm, ch(43, [50, 55, 58, 62]), ch(45, [50, 57, 61, 64])],
    play(p, t) {
      const { s, lb, chord } = p;
      if (s === 0 && lb % 4 === 0) I.drone(p, p.calm, t, [26, 38, 45], p.bd * 4, { cut: 340, lfo: 0.07, depth: 200, g: 0.2, a: 2.5, r: 3 });
      if (s === 0) I.pad(p, p.calm, t, chord.n, p.bd, { type: 'sawtooth', det: 8, cut: 600, a: 1.5, r: 2, g: 0.08 });
      if (s % 2 === 0) {
        if (s === 0) p.mel.d = [0, 2, 3][Math.floor(p.rf(1) * 3)];
        if (p.rf(2) < (s % 8 === 0 ? 0.45 : 0.22)) {
          const d = walk(p, 'd', -2, 7, 3);
          I.pluck(p, p.calm, t + p.r(4) * 0.015, degMidi(62, PENT_MINOR, d), 1.2,
            { cut: 1300 * (1 + 1.4 * p.ci), q: 2, g: 0.11, pan: (p.r(5) - 0.5) * 0.8 });
        }
      }
      if (s === 8 && lb % 2 === 1 && p.rb(3) < 0.6) I.bell(p, p.calm, t, p.rb(4) < 0.5 ? 50 : 45, 1.8, { ratio: 1.41, idx: 2.2, g: 0.05, pan: p.rb(5) - 0.5 });
      if (p.r(9) < 0.06) I.crackle(p, p.calm, t, { g: 0.02, f: 2500, pan: p.r(10) - 0.5 });
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x......x..x.....', s: '....x...g...x...', h: 'x.x.X.x.x.x.X.xo' }, { fill: 'tom', crash: true });
        if (s % 2 === 0) {
          const oct = s % 8 === 6 ? 12 : 0;
          I.bass(p, p.combat, t, chord.b + oct, p.sd * 1.5, { cut: 260, env: 3.2, q: 4, g: 0.22, drive: 1.6 });
        }
      }
    },
  },

  // Spore grottos: 7/8, lydian colour, wet bubbling arps and drips.
  fungal: {
    bpm: 104, steps: 14, root: 48, scale: LYDIAN, send: [0.5, 0.15], level: 0.95,
    prog: [ch(36, [48, 55, 59, 66]), ch(36, [48, 54, 57, 62]), ch(40, [52, 55, 59, 62]), ch(38, [50, 54, 59, 62]),
      ch(33, [45, 52, 55, 59]), ch(36, [48, 55, 59, 66]), ch(36, [48, 54, 57, 62]), ch(35, [47, 54, 57, 64])],
    play(p, t) {
      const { s, lb, chord } = p;
      if (s === 0) {
        I.pad(p, p.calm, t, chord.n, p.bd, { type: 'triangle', det: 14, cut: 1300, a: 0.9, r: 1.8, g: 0.17, drift: [0.35, 8] });
        I.bass(p, p.calm, t, chord.b, p.bd * 0.85, { type: 'triangle', cut: 320, env: 1.3, q: 0.5, g: 0.24, r: 1 });
      }
      if (s % 2 === 0) {
        const strong = s === 0 || s === 4 || s === 8;
        if (p.rf(4) < (strong ? 0.95 : 0.6)) {
          const tones = chord.n.concat(chord.n.map((x) => x + 12));
          const idx = ((s >> 1) * 3 + (lb % 2) * 2 + Math.floor(p.rf(5) * 2)) % tones.length;
          I.pluck(p, p.calm, t, tones[idx] + 12, 0.34, { bubble: true, cut: 2400 + 1400 * p.ci, g: 0.08, pan: ((s >> 1) % 3 - 1) * 0.45 });
        }
      }
      if (p.r(7) < 0.035) I.drop(p, p.calm, t + p.r(8) * p.sd, 900 + p.r(9) * 900, { g: 0.05, pan: p.r(10) * 1.4 - 0.7 });
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x.......x.....', s: '....x......x..', h: 'x.xox.x.X.x.xo' },
          { fill: 'snare', fillLen: 3, hat: { bp: true, f: 6000 }, snare: { f: 1400, tone: 170 } });
        const bpat = { 0: 0, 4: 0, 8: 7, 11: 12 };
        if (bpat[s] !== undefined) I.bass(p, p.combat, t, chord.b + bpat[s], p.sd * 2.2, { cut: 380, env: 3, q: 6, g: 0.2 });
      }
    },
  },

  // Frost veins: glassy bells, wide and slow, wind.
  frost: {
    bpm: 66, root: 52, scale: AEOLIAN, send: [0.65, 0.2], level: 0.95, bpc: 2,
    prog: [ch(40, [52, 59, 66, 67]), ch(36, [48, 55, 59, 64]), ch(33, [45, 55, 59, 60]), ch(35, [47, 54, 59, 64])],
    play(p, t) {
      const { s, lb, chord } = p;
      if (s === 0 && lb % 2 === 0) {
        I.pad(p, p.calm, t, chord.n, p.bd * 2, { type: 'triangle', det: 10, cut: 1800, a: 2.5, r: 3, g: 0.18 });
        I.pad(p, p.calm, t, [chord.n[3] + 12], p.bd * 2, { type: 'sine', det: 4, cut: 4000, a: 3, r: 3, g: 0.03 });
        I.bass(p, p.calm, t, chord.b, p.bd * 1.9, { type: 'triangle', cut: 300, env: 1, q: 0.3, g: 0.22, r: 2 });
      }
      if (s % 2 === 0) {
        if (s === 0) p.mel.d = p.mel.d ?? 4;
        if (p.rf(3) < (s % 8 === 0 ? 0.4 : 0.18)) {
          const d = walk(p, 'd', 0, 10, 4);
          I.bell(p, p.calm, t + p.r(5) * 0.02, degMidi(76, PENT_MINOR, d), 2.6,
            { ratio: 3.5, idx: 1.1 + 0.8 * p.ci, g: 0.055, pan: (p.r(6) - 0.5) * 1.4 });
        }
      }
      if (s === 0 && lb % 4 === 2) I.swell(p, p.calm, t, p.bd * 2, { f0: 350, f1: 1500, q: 3, g: 0.045, pan: p.rb(7) - 0.5 });
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x.....x...x.....', s: '....x.......x...', h: 'xoxoXoxoxoxoXoxo' },
          { fill: 'snare', snare: { f: 3800, q: 1.2, tone: 260, body: 0.5 }, hat: { f: 9000 }, kick: { f: 120, d: 0.28 } });
        if (s % 2 === 0) I.bass(p, p.combat, t, chord.b + (s === 6 || s === 14 ? 12 : 0), p.sd * 1.5, { type: 'sawtooth', cut: 420, env: 2.5, q: 3, g: 0.18 });
      }
    },
  },

  // Shadow core: dissonant detuned clusters, sub pulses like a heartbeat, whispers.
  void: {
    bpm: 72, root: 49, scale: PHRYGIAN, send: [0.55, 0.15], level: 0.95, bpc: 2,
    prog: [ch(37, [49, 56, 61, 62]), ch(37, [49, 55, 60, 64]), ch(35, [47, 54, 59, 60]), ch(34, [46, 53, 58, 59])],
    play(p, t) {
      const { s, lb, chord } = p;
      if (s === 0 && lb % 2 === 0) I.pad(p, p.calm, t, chord.n, p.bd * 2, { type: 'sawtooth', det: 18, cut: 760, a: 2.5, r: 3, g: 0.12, drift: [0.11, 16] });
      if (s === 0) I.sub(p, p.calm, t, chord.b - 12, 0.9, { g: 0.32 });
      if (s === 3) I.sub(p, p.calm, t, chord.b - 12, 0.7, { g: 0.18 });
      if (s === 8 && p.rb(5) < 0.45) {
        const f0 = 300 + p.rb(6) * 900;
        I.swell(p, p.calm, t, p.bd * 0.7, { f0, f1: f0 * (p.rb(7) < 0.5 ? 0.5 : 2), q: 9, g: 0.06, pan: p.rb(8) - 0.5 });
      }
      if (p.r(6) < 0.025) I.bell(p, p.calm, t, p.r(7) < 0.5 ? 85 : 86, 2.2, { ratio: 1.41, idx: 2, g: 0.03, pan: p.r(8) - 0.5 });
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x.....x.x.....o.', s: '....x.......x...', h: 'xoXoxoXoxoXoxoXo' },
          { fill: 'tom', snare: { f: 1200, q: 1.5, tone: 150 }, kick: { f1: 38, d: 0.4 } });
        if (s === 4 || s === 12) I.bell(p, p.combat, t, 61, 0.35, { ratio: 1.41, idx: 3, g: 0.06 });
        const ost = [0, 0, 1, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 7, 6, 1];
        I.bass(p, p.combat, t, chord.b + ost[s], p.sd * 0.8, { type: 'square', cut: 300 + 400 * p.ci, env: 2.5, q: 5, g: 0.13 });
      }
    },
  },

  // The dead sun's heart: solemn choir, the main motif, builds over 32-bar arcs.
  core: {
    bpm: 80, root: 62, scale: AEOLIAN, send: [0.55, 0.22], level: 0.95,
    prog: [D.Dm, D.Bb, D.C, D.Am, D.Dm, D.Gm, ch(34, [50, 53, 58, 65]), D.A],
    play(p, t) {
      const { s, lb, chord } = p;
      const sec = Math.floor(lb / 8) % 4;
      if (s === 0) {
        I.choir(p, p.calm, t, chord.n, p.bd, { a: 1.2, r: 1.8, g: 0.3 });
        I.bass(p, p.calm, t, chord.b, p.bd * 0.95, { type: 'triangle', cut: 360, env: 1, q: 0.4, g: 0.24, r: 1.2 });
      }
      if (s === 0 && (lb % 8 === 0 || lb % 8 === 4)) {
        motif(p, p.calm, t, I.lead, {
          deg0: lb % 8 === 4 ? 2 : 0, oct: sec === 3 ? 1 : 0,
          opt: { type: 'sawtooth', det: 6, cut: 1100, bright: 1, g: 0.075, a: 0.06, r: 0.5, vib: 10 },
        });
      }
      if (sec >= 1 && s % 2 === 0) {
        const tones = chord.n.map((x) => x + 12);
        I.bell(p, p.calm, t, tones[[0, 1, 2, 3, 2, 1, 3, 2][(s >> 1)]], 1.2, { ratio: 2, idx: 0.9, g: 0.03 + 0.012 * sec, pan: ((s >> 1) % 4 - 1.5) * 0.3 });
      }
      if (sec >= 2) {
        if (s === 0 || s === 8) I.tom(p, p.calm, t, 73, { g: 0.2, d: 0.6 });
        if (lb % 8 === 7 && s >= 12) I.tom(p, p.calm, t, 73, { g: 0.08 + 0.04 * (s - 12), d: 0.3 });
      }
      if (sec === 3 && s % 4 === 0 && p.rf(6) < 0.6) {
        const d = walk(p, 'c', 4, 11, 7);
        I.lead(p, p.calm, t, degMidi(62, AEOLIAN, d), p.sd * 3.5, { type: 'triangle', cut: 2200, g: 0.045, a: 0.15, r: 0.6, pan: 0.35 });
      }
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x.......x.x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.xo' }, { fill: 'tom', crash: true, kick: { f1: 40, d: 0.4 } });
        if (s % 2 === 0) I.bass(p, p.combat, t, chord.b + (s % 8 === 4 ? 12 : 0), p.sd * 1.6, { cut: 300, env: 3, q: 3, g: 0.2, drive: 1.3 });
        if (s % 4 === 2) I.tom(p, p.combat, t, 98, { g: 0.12, d: 0.25 });
      }
    },
  },

  // Boss: driving, tense, D phrygian ostinato; drums and riff on the combat layer.
  boss: {
    bpm: 132, root: 50, scale: PHRYGIAN, send: [0.25, 0.14], level: 0.9, duck: 0, fadeIn: 0.6,
    prog: [ch(38, []), ch(39, []), ch(38, []), ch(36, []), ch(38, []), ch(39, []), ch(41, []), ch(40, [])],
    play(p, t) {
      const { s, lb, chord } = p;
      const ost = [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 0, 1];
      I.bass(p, p.calm, t, chord.b + ost[s], p.sd * 0.75, { cut: 420 + 500 * p.ci, env: 2.2, q: 3, g: 0.17, drive: 1.4 });
      if (s === 0) {
        const tens = lb % 2 ? 13 : 12;
        I.pad(p, p.calm, t, [chord.b + 12, chord.b + 19, chord.b + 12 + tens], p.bd, { type: 'sawtooth', det: 10, cut: 1100, a: 0.5, r: 0.8, g: 0.09 });
      }
      if (s === 8 && lb % 2 === 1) I.bell(p, p.calm, t, chord.b + 30, 1.2, { ratio: 3.5, idx: 1.5, g: 0.035, pan: 0.4 });
      if (lb % 8 === 7 && s === 0) I.swell(p, p.calm, t, p.bd, { f0: 300, f1: 4500, q: 1.5, g: 0.06, peakAt: 0.97 });
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x..x....x.x...o.', s: '....X.......X..g', h: 'xxXxxxXxxxXxxxXO' }, { fill: 'tom', crash: true, kick: { f1: 42 } });
        if (s === 0) { p.mel.d = Math.floor(p.rf(20) * 3); }
        if (s % 2 === 0 && p.rf(21) < (s % 4 === 0 ? 0.85 : 0.4)) {
          const d = walk(p, 'd', -1, 7, 22);
          I.lead(p, p.combat, t, degMidi(62, PHRYGIAN, d), p.sd * 1.7, { type: 'sawtooth', cut: 1500, bright: 0.8, g: 0.06, a: 0.01, r: 0.12, vib: 8, det: 7 });
        }
      }
    },
  },

  // The extinguished sun: epic, fast, the main motif as a brass call over choir and drums.
  final: {
    bpm: 148, root: 62, scale: HARMONIC, send: [0.3, 0.15], level: 0.88, duck: 0, fadeIn: 0.6,
    prog: [D.Dm, D.Bb, D.Gm, D.A, D.Dm, D.Bb, ch(43, [50, 55, 58, 64]), ch(45, [49, 52, 57, 61])],
    play(p, t) {
      const { s, lb, chord } = p;
      if (s === 0) {
        I.choir(p, p.calm, t, chord.n, p.bd, { a: 0.25, r: 0.8, g: 0.3 });
        I.pad(p, p.calm, t, [chord.b + 12, chord.b + 19], p.bd, { type: 'sawtooth', det: 8, cut: 700, a: 0.1, r: 0.6, g: 0.07 });
      }
      if (s % 2 === 0) I.bass(p, p.calm, t, chord.b + (s % 8 === 6 ? 12 : 0), p.sd * 1.4, { cut: 360 + 400 * p.ci, env: 2.6, q: 3, g: 0.17, drive: 1.5 });
      if (s === 0 && lb % 4 === 0) {
        const second = lb % 8 === 4;
        motif(p, p.calm, t, I.lead, {
          stretch: 2, deg0: second ? 2 : 0,
          opt: { type: 'sawtooth', det: 8, cut: 1700, bright: 0.7, g: 0.08, a: 0.04, r: 0.35, vib: 14 },
        });
      }
      if (p.ci > 0.01) {
        drums(p, p.combat, t, { k: 'x.....x.x.....x.', s: '....X.......X..g', h: 'x.X.x.X.xoX.x.XO' }, { fill: 'snare', fillLen: 6, crash: true, kick: { f1: 40 } });
        if (lb % 8 >= 4 || s % 2 === 0) {
          const tones = chord.n.concat(chord.n.map((x) => x + 12));
          I.bell(p, p.combat, t, tones[s % tones.length] + 12, 0.5, { ratio: 2, idx: 1.2, g: 0.028, pan: (s % 4 - 1.5) * 0.3 });
        }
      }
    },
  },

  // Victory: a short triumphant fanfare on the main motif (now in major), then a calm, warm loop.
  victory: {
    bpm: 92, root: 62, scale: MAJOR, send: [0.5, 0.15], level: 0.9, intro: 4, bpc: 2, fadeIn: 0.3,
    prog: [ch(38, [50, 57, 64, 66]), ch(43, [50, 55, 59, 66]), ch(35, [50, 54, 57, 62]), ch(45, [50, 52, 57, 64])],
    introPlay(p, t) {
      const { s, bar } = p;
      const ic = [ch(38, [50, 57, 62, 66]), ch(43, [50, 55, 59, 62]), ch(45, [49, 52, 57, 64]), ch(38, [50, 57, 62, 66, 69])][bar];
      if (s === 0) {
        I.choir(p, p.calm, t, ic.n, bar === 3 ? p.bd * 2 : p.bd, { a: 0.08, r: bar === 3 ? 3 : 0.8, g: 0.3 });
        I.pad(p, p.calm, t, ic.n.map((x) => x + 12), bar === 3 ? p.bd * 2 : p.bd, { type: 'sawtooth', det: 8, cut: 2200, a: 0.05, r: 1.5, g: 0.06 });
        I.bass(p, p.calm, t, ic.b, bar === 3 ? p.bd * 2 : p.bd * 0.95, { cut: 400, env: 2, q: 1, g: 0.24, r: 1 });
        if (bar === 0 || bar === 3) { I.kick(p, p.calm, t, { g: 0.55, d: 0.5 }); I.hat(p, p.calm, t, { g: 0.09, d: 1.6, f: 4000 }); }
      }
      if (bar === 0 && s === 0) motif(p, p.calm, t, I.lead, { stretch: 2, scale: MAJOR, end: 4, opt: { type: 'sawtooth', det: 8, cut: 2400, g: 0.08, a: 0.03, r: 0.4, vib: 14 } });
      if (bar === 2 && s === 0) motif(p, p.calm, t, I.lead, { degs: [4, 6, 7], rhythm: [4, 4, 24], opt: { type: 'sawtooth', det: 8, cut: 2600, g: 0.085, a: 0.03, r: 1.2, vib: 16 } });
      if (bar < 3 && s % 2 === 0) I.tom(p, p.calm, t, 73, { g: 0.06 + 0.012 * (s >> 1) + 0.03 * bar, d: 0.3 });
      if (bar === 2 && s >= 8) I.snare(p, p.calm, t, { g: 0.05 + 0.025 * (s - 8), f: 2200 });
    },
    play(p, t) {
      const { s, lb, chord } = p;
      if (s === 0 && lb % 2 === 0) {
        I.pad(p, p.calm, t, chord.n, p.bd * 2, { type: 'triangle', det: 6, cut: 1800, a: 2, r: 2.5, g: 0.19 });
        I.bass(p, p.calm, t, chord.b, p.bd * 1.9, { type: 'triangle', cut: 380, env: 1, q: 0.3, g: 0.22, r: 1.5 });
      }
      if (s === 0 && lb % 8 === 4) motif(p, p.calm, t, I.bell, { root: 74, scale: MAJOR, end: 0, opt: { ratio: 2, idx: 1.2, g: 0.06 } });
      else if (s % 4 === 0 && p.rf(3) < 0.4) {
        const d = walk(p, 'd', 0, 8, 4);
        I.bell(p, p.calm, t, degMidi(74, PENT_MAJOR, d), 2, { ratio: 2, idx: 0.9, g: 0.04, pan: (p.r(5) - 0.5) * 0.9 });
      }
      if (p.r(9) < 0.12) I.crackle(p, p.calm, t + p.r(10) * p.sd, { g: 0.012 + p.r(11) * 0.02, pan: p.r(12) - 0.5 });
    },
  },

  // Death: a short lament on the motif, then near-silence — embers cooling.
  death: {
    bpm: 56, root: 62, scale: AEOLIAN, send: [0.6, 0.1], level: 0.9, intro: 3, fadeIn: 0.8,
    prog: [ch(38, [45, 50, 53])],
    introPlay(p, t) {
      const { s, bar } = p;
      if (s === 0 && bar === 0) {
        I.pad(p, p.calm, t, [45, 50, 53, 57], p.bd * 2, { type: 'sawtooth', det: 8, cut: 650, a: 1.2, r: 2.5, g: 0.14 });
        I.bass(p, p.calm, t, 38, p.bd * 2, { type: 'triangle', cut: 300, env: 1, q: 0.3, g: 0.24, r: 2 });
        motif(p, p.calm, t, I.lead, { stretch: 2, end: 0, lastLen: 1.6, // the lament resolves home to D opt: { type: 'sawtooth', cut: 900, g: 0.085, a: 0.18, r: 1, vib: 16, vibRate: 4.8 } });
      }
      if (s === 0 && bar === 2) {
        I.pad(p, p.calm, t, [46, 50, 53, 58], p.bd, { type: 'sawtooth', det: 8, cut: 550, a: 0.8, r: 3.5, g: 0.11 });
        I.bass(p, p.calm, t, 34, p.bd, { type: 'triangle', cut: 280, env: 1, q: 0.3, g: 0.2, r: 3 });
        I.bell(p, p.calm, t + p.sd * 4, 62, 4, { ratio: 2, idx: 0.8, g: 0.05 });
      }
    },
    play(p, t) {
      const { s, lb } = p;
      if (s === 0 && lb % 4 === 0) I.drone(p, p.calm, t, [38, 45], p.bd * 4, { cut: 240, lfo: 0.05, depth: 90, g: 0.08, a: 3, r: 4, q: 1 });
      if (s === 0 && lb % 8 === 6 && p.rb(2) < 0.75) I.bell(p, p.calm, t, p.rb(3) < 0.5 ? 74 : 69, 3.5, { ratio: 2, idx: 0.7, g: 0.025, pan: p.rb(4) - 0.5 });
      if (s === 8 && lb % 4 === 1) I.swell(p, p.calm, t, p.bd * 1.5, { f0: 300, f1: 700, q: 2, g: 0.018 });
    },
  },
};

export const MUSIC_TRACKS = Object.freeze(Object.keys(TRACKS));

function seedOf(id, n) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h ^ Math.imul(n + 1, 0x9e3779b1)) | 0;
}

// ---------------------------------------------------------------------------------------------

class TrackPlayer {
  constructor(engine, id, def, start, fade, n) {
    const ctx = engine.ctx;
    this.engine = engine;
    this.ctx = ctx;
    this.id = id;
    this.def = def;
    this.seed = seedOf(id, n);
    this.steps = def.steps || 16;
    this.sd = 60 / def.bpm / 4;
    this.bd = this.sd * this.steps;
    this.bar = 0;
    this.s = 0;
    this.lb = 0;
    this.ci = 0;
    this.chord = def.prog ? def.prog[0] : null;
    this.next = start;
    this.mel = {};
    this.stopping = false;
    this.stopAt = Infinity;
    this.dead = false;

    const level = def.level ?? 1;
    const send = def.send || [0.4, 0.15];
    this.out = ctx.createGain();
    this.wetOut = ctx.createGain();
    for (const g of [this.out, this.wetOut]) {
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(level, start + Math.max(0.01, fade));
    }
    this.out.connect(engine.out);
    if (engine.wet) this.wetOut.connect(engine.wet);
    this.calm = ctx.createGain();
    this.combat = ctx.createGain();
    this.calmWet = ctx.createGain();
    this.calmWet.gain.value = send[0];
    this.combatWet = ctx.createGain();
    this.combatWet.gain.value = send[1];
    this.calm.connect(this.out); this.calm.connect(this.calmWet); this.calmWet.connect(this.wetOut);
    this.combat.connect(this.out); this.combat.connect(this.combatWet); this.combatWet.connect(this.wetOut);
    this.applyIntensity(ctx.currentTime, true);
  }

  applyIntensity(now, immediate) {
    const e = this.engine;
    const x = e.iTo;
    const duck = this.def.duck ?? 0.18;
    const set = (param, v) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(v, now);
      else { param.setValueAtTime(param.value, now); param.setTargetAtTime(v, now, INTENSITY_TAU); }
    };
    set(this.combat.gain, x);
    set(this.calm.gain, 1 - duck * x);
  }

  /** Hash-based deterministic randomness. r: per step; rb: per bar; rf: per phrase cell (repeats with the form). */
  r(salt) { return hash(this.seed, this.bar, this.s, salt); }
  rb(salt) { return hash(this.seed, this.bar, 977, salt); }
  rf(salt) {
    const lb = Math.max(0, this.lb);
    const cell = FORM[lb % 8];
    const cid = cell < 2 ? cell : cell + 8 * Math.floor(lb / 16);
    return hash(this.seed ^ 0x5bd1e995, cid, this.s, salt);
  }

  fadeOut(now, fade) {
    if (this.stopping) return;
    this.stopping = true;
    this.stopAt = now + fade;
    for (const g of [this.out.gain, this.wetOut.gain]) {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else { const v = g.value; g.cancelScheduledValues(now); g.setValueAtTime(v, now); }
      g.linearRampToValueAtTime(0, now + fade);
    }
  }

  schedule(until) {
    if (this.dead) return;
    const now = this.ctx.currentTime;
    if (this.stopping && now >= this.stopAt + 0.05) { this.dispose(); return; }
    // after a stall (suspended context, throttled timer) skip missed steps instead of bursting them out
    while (this.next < now - 0.02) this._advance();
    while (this.next < until && this.next < this.stopAt) {
      const t = this.next;
      if (!this.engine.silent) {
        const def = this.def;
        this.lb = this.bar - (def.intro || 0);
        if (this.lb >= 0 && def.prog) this.chord = def.prog[Math.floor(this.lb / (def.bpc || 1)) % def.prog.length];
        this.ci = this.engine.level(t);
        if (this.s === 0) this.mel._bar = this.bar;
        try {
          if (this.lb < 0) def.introPlay(this, t); else def.play(this, t);
        } catch (err) {
          if (!this.engine._warned) { this.engine._warned = true; console.warn('[audio] music step failed', err); }
        }
      }
      this._advance();
    }
  }

  _advance() {
    this.next += this.sd;
    if (++this.s >= this.steps) { this.s = 0; this.bar++; }
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    off([this.out, this.wetOut, this.calm, this.combat, this.calmWet, this.combatWet]);
  }
}

export class MusicEngine {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} out   music bus input
   * @param {AudioNode|null} wet  reverb send input
   * @param {{offline?: boolean}} [opts]  offline: no timers; drive with scheduleUntil()
   */
  constructor(ctx, out, wet, opts = {}) {
    this.ctx = ctx;
    this.out = out;
    this.wet = wet || null;
    this.offline = !!opts.offline;
    this.players = [];
    this.current = null;
    this.timer = null;
    this.paused = false;
    this.silent = false;
    this.plays = 0;
    this.iFrom = 0; this.iTo = 0; this.iT0 = 0;
  }

  get trackId() { return this.current && !this.current.stopping ? this.current.id : null; }
  get intensity() { return this.iTo; }

  /** Estimated combat-layer level at context time t (mirrors the setTargetAtTime ramp). */
  level(t) {
    const dt = t - this.iT0;
    if (dt <= 0) return this.iFrom;
    return this.iTo + (this.iFrom - this.iTo) * Math.exp(-dt / INTENSITY_TAU);
  }

  setIntensity(x, immediate = false) {
    x = clamp01(+x || 0);
    const now = this.ctx.currentTime;
    if (!immediate && Math.abs(x - this.iTo) < 1e-4) return;
    this.iFrom = immediate ? x : this.level(now);
    this.iTo = x;
    this.iT0 = now;
    for (const p of this.players) if (!p.dead) p.applyIntensity(now, immediate);
  }

  /** Crossfade to a track. opts: { fade, fadeOut, restart } */
  play(id, opts = {}) {
    const def = TRACKS[id];
    if (!def) return false;
    const cur = this.current;
    if (cur && cur.id === id && !cur.stopping && !opts.restart) return true;
    const now = this.ctx.currentTime;
    const fade = opts.fade ?? def.fadeIn ?? 1.5;
    if (cur) cur.fadeOut(now, opts.fadeOut ?? Math.max(0.6, Math.min(1.5, fade * 1.5)));
    const p = new TrackPlayer(this, id, def, now + 0.05, fade, this.plays++);
    this.players.push(p);
    this.current = p;
    this._ensureTimer();
    this.tick();
    return true;
  }

  stop(fade = 1.5) {
    if (this.current) this.current.fadeOut(this.ctx.currentTime, fade);
    this.current = null;
  }

  tick() {
    if (this.paused || this.offline) return;
    this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD);
  }

  scheduleUntil(until) {
    for (const p of this.players) p.schedule(until);
    if (this.players.some((p) => p.dead)) this.players = this.players.filter((p) => !p.dead);
    if (!this.players.length) this._stopTimer();
  }

  pause() { this.paused = true; this._stopTimer(); }
  resume() { this.paused = false; this._ensureTimer(); this.tick(); }

  dispose() {
    this._stopTimer();
    for (const p of this.players) p.dispose();
    this.players = [];
    this.current = null;
  }

  _ensureTimer() {
    if (this.offline || this.paused || this.timer || typeof setInterval !== 'function') return;
    this.timer = setInterval(() => {
      try { this.tick(); } catch (err) { console.warn('[audio] music tick failed', err); }
    }, TICK_MS);
  }

  _stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
