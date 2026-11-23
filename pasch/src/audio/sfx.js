// Sound-effect recipes. Every recipe gets a Voice `v` (see engine.js) and the start time `t`.
// Frequencies are multiplied by v.p (opts.pitch + random jitter). Peak values are pre-compressor;
// the sfx compressor and the master limiter keep the sum below 0 dBFS.
import { rand, pick, pentatonic, clamp } from './engine.js';

const C5 = 523.25;

// ---------------------------------------------------------------- building blocks

/** Oscillator → [filter] → gain envelope → dest. */
function tone(v, t, type, f, peak, a, d, o = {}) {
  const osc = v.osc(type, f, t, t + a + (o.hold || 0) + d + 0.05, o.detune || 0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + (o.glide != null ? o.glide : a + d));
  const g = v.gain();
  if (o.hold != null) v.ahr(g.gain, t, a, peak, o.hold, d);
  else v.env(g.gain, t, a, peak, d);
  let node = osc;
  if (o.filter) { osc.connect(o.filter); node = o.filter; }
  node.connect(g);
  g.connect(o.dest || v.out);
  if (o.verb) v.send(g, o.verb);
  return { osc, g };
}

/** Noise → filter → gain envelope → dest. */
function noiseHit(v, t, type, f, Q, peak, a, d, o = {}) {
  const n = v.noise(t, a + (o.hold || 0) + d + 0.05, o.color || 'white', o.rate || 1);
  const fl = v.filter(type, f, Q);
  if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide != null ? o.glide : a + d));
  const g = v.gain();
  if (o.hold != null) v.ahr(g.gain, t, a, peak, o.hold, d);
  else v.env(g.gain, t, a, peak, d);
  n.connect(fl);
  fl.connect(g);
  g.connect(o.dest || v.out);
  if (o.verb) v.send(g, o.verb);
  return { n, fl, g };
}

/**
 * One die impact: bandpassed noise click + resonant body + optional table thud.
 * Every call randomises filter frequencies, Q, body pitch and decay → no two hits identical.
 */
function clack(v, t, vel = 1, o = {}) {
  const p = v.p * (o.p || 1);
  const dest = o.dest || v.out;
  const bright = o.bright || 1;
  // click (the "tock" of hard plastic/bone)
  noiseHit(v, t, 'bandpass', rand(2200, 3800) * p * bright, rand(4, 8), 0.55 * vel, 0.0008, rand(0.025, 0.045), { dest });
  // high tick transient
  noiseHit(v, t, 'highpass', 5500 * bright, 0.7, 0.18 * vel, 0.0005, 0.008, { dest });
  // body resonance (pitch drops ~15 %)
  const bf = rand(700, 1100) * p * (o.body || 1);
  tone(v, t, 'triangle', bf, 0.25 * vel, 0.001, rand(0.03, 0.05), { to: bf * 0.85, glide: 0.03, dest });
  // inharmonic partial – makes it sound like a solid object, not a beep
  tone(v, t, 'sine', bf * rand(2.6, 2.9), 0.07 * vel, 0.0008, rand(0.015, 0.03), { dest });
  // table thud
  const thud = o.thud == null ? 1 : o.thud;
  if (thud > 0) {
    const tf = rand(125, 155) * (o.p || 1);
    tone(v, t, 'sine', tf, 0.2 * vel * thud, 0.002, rand(0.05, 0.08), { to: tf * 0.57, glide: 0.06, dest });
  }
}

function coinBlip(v, t, f, peak = 1) {
  tone(v, t, 'triangle', f * v.p, 0.14 * peak, 0.002, 0.12);
  const lp = v.filter('lowpass', 5000, 0.5);
  tone(v, t, 'square', f * v.p, 0.05 * peak, 0.002, 0.1, { filter: lp });
}

function bell(v, t, f, peak, d, verb = 0.2) {
  tone(v, t, 'sine', f, peak, 0.002, d, { verb });
  tone(v, t, 'sine', f * 1.5, peak * 0.5, 0.002, d * 0.7, { verb });
  tone(v, t, 'sine', f * 2.76, peak * 0.15, 0.001, d * 0.3);
}

function sparkle(v, t, n, spread, fLo, fHi, peak) {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.pow(Math.random(), 1.3) * spread;
    tone(v, tt, 'sine', rand(fLo, fHi) * v.p, peak * rand(0.5, 1), 0.001, rand(0.05, 0.18), { verb: 0.3 });
  }
}

function crackle(v, t, n, spread, peak, dest) {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.random() * spread;
    noiseHit(v, tt, 'highpass', rand(1500, 4500), 0.7, peak * rand(0.3, 1), 0.0005, rand(0.002, 0.008), { dest });
  }
}

/** A small LFO (vibrato) into an AudioParam (cents). */
function vibrato(v, param, t0, t1, rate, depthCents) {
  const l = v.osc('sine', rate, t0, t1);
  const g = v.gain(depthCents);
  l.connect(g);
  g.connect(param);
  (v.extra || (v.extra = [])).push(g);
}

// ---------------------------------------------------------------- recipes

/**
 * Registry. Each entry: fn(v, t, opts), jitter (relative pitch randomisation), gap (minimum seconds between
 * two plays of the same name; extra calls are dropped).
 */
export const SFX = {
  // ---------------- UI
  hover: {
    level: 4,
    jitter: 0.05, gap: 0.035,
    fn(v, t) { tone(v, t, 'sine', rand(1200, 1500) * v.p, 0.05, 0.002, 0.03); },
  },
  click: {
    level: 3.5,
    gap: 0.02,
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 3000 * v.p, 2, 0.28, 0.001, 0.012);
      tone(v, t, 'sine', 800 * v.p, 0.15, 0.002, 0.035, { to: 680 * v.p });
    },
  },
  press: {
    level: 3.5,
    gap: 0.02,
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 1800 * v.p, 2, 0.18, 0.001, 0.015);
      tone(v, t, 'sine', 600 * v.p, 0.17, 0.002, 0.055, { to: 520 * v.p });
      tone(v, t, 'triangle', 1200 * v.p, 0.03, 0.001, 0.02);
    },
  },
  release: {
    level: 3.5,
    gap: 0.02,
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 3200 * v.p, 2, 0.12, 0.001, 0.01);
      tone(v, t, 'sine', 900 * v.p, 0.14, 0.002, 0.06, { to: 990 * v.p });
    },
  },
  deny: {
    level: 0.6,
    gap: 0.08,
    fn(v, t) {
      const lp = v.filter('lowpass', 1400, 0.7);
      lp.connect(v.out);
      tone(v, t, 'triangle', 330 * v.p, 0.2, 0.004, 0.08, { to: 300 * v.p, dest: lp });
      tone(v, t, 'square', 165 * v.p, 0.04, 0.004, 0.07, { dest: lp });
      tone(v, t + 0.1, 'triangle', 262 * v.p, 0.2, 0.004, 0.12, { to: 235 * v.p, dest: lp });
      tone(v, t + 0.1, 'square', 131 * v.p, 0.04, 0.004, 0.1, { dest: lp });
    },
  },
  error: {
    level: 0.8,
    gap: 0.12,
    fn(v, t) {
      const lp = v.filter('lowpass', 1100, 1);
      lp.connect(v.out);
      for (let i = 0; i < 2; i++) {
        const tt = t + i * 0.11;
        tone(v, tt, 'sawtooth', 140 * v.p, 0.16, 0.003, 0.09, { dest: lp });
        tone(v, tt, 'sawtooth', 147 * v.p, 0.14, 0.003, 0.09, { dest: lp });
        tone(v, tt, 'square', 220 * v.p, 0.05, 0.003, 0.08, { to: 180 * v.p, dest: lp });
      }
    },
  },

  // ---------------- dice
  roll_start: {
    fn(v, t) {
      // cup tipped: airy swoosh up + a few dice sliding out
      noiseHit(v, t, 'bandpass', 500 * v.p, 1.4, 0.22, 0.08, 0.16, { to: 2600 * v.p, glide: 0.22 });
      noiseHit(v, t, 'lowpass', 300, 0.7, 0.12, 0.05, 0.12, { color: 'pink' });
      let tt = t + 0.02;
      for (let i = 0; i < 3; i++) {
        clack(v, tt, rand(0.25, 0.4), { bright: 0.7, thud: 0 });
        tt += rand(0.03, 0.06);
      }
    },
  },
  dice_rattle: {
    level: 0.75,
    fn(v, t, o) {
      // cup shaking: muffled clacks + hollow cup resonance + cloth/cup scrape
      const cup = v.filter('bandpass', rand(780, 950) * v.p, 9);
      const cupG = v.gain(0.9);
      cup.connect(cupG);
      cupG.connect(v.out);
      const muffle = v.filter('lowpass', 3200, 0.6);
      muffle.connect(v.out);
      const dur = o.dur || rand(0.45, 0.6);
      let tt = t;
      let i = 0;
      while (tt < t + dur) {
        const env = 1 - 0.45 * ((tt - t) / dur);
        const vel = rand(0.45, 1) * env;
        clack(v, tt, vel * 0.75, { dest: muffle, bright: rand(0.55, 0.8), thud: 0, body: rand(0.8, 1.1) });
        clack(v, tt + 0.0015, vel * 0.5, { dest: cup, bright: 0.5, thud: 0 });
        // shakes come in pairs (back-and-forth strokes)
        tt += (i % 3 === 2) ? rand(0.06, 0.09) : rand(0.025, 0.05);
        i++;
      }
      // cup wall bumps on the stroke turns
      for (let k = 0; k < 3; k++) {
        tone(v, t + k * dur / 3 + 0.02, 'sine', rand(160, 200), 0.12, 0.003, 0.07, { to: 110 });
      }
      noiseHit(v, t, 'bandpass', 1200, 0.8, 0.05, 0.08, 0.2, { hold: dur * 0.6, color: 'pink' });
    },
  },
  dice_clack: {
    level: 1.6,
    gap: 0.006,
    fn(v, t) {
      clack(v, t, 1); // velocity = opts.gain (applied on the voice output)
      // little bounces with random spacing (dice never land identically)
      if (Math.random() < 0.75) {
        const t2 = t + rand(0.045, 0.1);
        clack(v, t2, rand(0.22, 0.38), { thud: 0.6, bright: rand(0.9, 1.15) });
        if (Math.random() < 0.45) clack(v, t2 + rand(0.03, 0.06), rand(0.08, 0.16), { thud: 0.3 });
      }
      if (Math.random() < 0.3) {
        // short roll on an edge – rapid micro taps
        let tt = t + rand(0.12, 0.16);
        for (let k = 0; k < 3; k++) { clack(v, tt, 0.06 + Math.random() * 0.05, { thud: 0 }); tt += rand(0.015, 0.03); }
      }
    },
  },
  dice_land: {
    level: 2,
    fn(v, t) {
      tone(v, t, 'sine', 120 * v.p, 0.45, 0.003, 0.16, { to: 55, glide: 0.1 });
      noiseHit(v, t, 'lowpass', 420, 0.8, 0.32, 0.002, 0.07, { color: 'pink' }); // felt
      clack(v, t + 0.004, 0.35, { thud: 0 });
      clack(v, t + rand(0.05, 0.07), 0.08, { thud: 0 });
      clack(v, t + rand(0.09, 0.12), 0.05, { thud: 0 });
    },
  },
  hold: {
    level: 3,
    gap: 0.02,
    fn(v, t) {
      const f = 2500 * v.p;
      tone(v, t, 'sine', f, 0.12, 0.001, 0.25, { verb: 0.15 });
      tone(v, t, 'sine', f * 2.76, 0.035, 0.001, 0.08);
      tone(v, t, 'sine', f * 1.5, 0.03, 0.001, 0.15);
      tone(v, t, 'triangle', 660 * v.p, 0.12, 0.003, 0.08, { to: 880 * v.p, glide: 0.04 });
      noiseHit(v, t, 'bandpass', 5000, 2, 0.08, 0.0005, 0.006);
    },
  },
  unhold: {
    level: 2.5,
    gap: 0.02,
    fn(v, t) {
      const f = 1800 * v.p;
      tone(v, t, 'sine', f, 0.08, 0.001, 0.16, { verb: 0.1 });
      tone(v, t, 'sine', f * 2.76, 0.02, 0.001, 0.05);
      tone(v, t, 'triangle', 880 * v.p, 0.1, 0.003, 0.08, { to: 660 * v.p, glide: 0.04 });
      clack(v, t + 0.03, 0.18, { thud: 0.8 });
    },
  },

  // ---------------- scoring
  chip: {
    level: 4.5,
    jitter: 0.006,
    fn(v, t, o) {
      const step = Math.max(0, Math.floor(o.step || 0));
      const over = Math.max(0, step - 12);
      const f = C5 * Math.pow(2, pentatonic(Math.min(step, 12)) / 12) * v.p;
      const lp = v.filter('lowpass', 4000, 0.5);
      lp.connect(v.out);
      tone(v, t, 'triangle', f, 0.2, 0.002, 0.11, { dest: lp, verb: 0.12 });
      tone(v, t, 'square', f, 0.05, 0.002, 0.07, { dest: lp });
      tone(v, t, 'sine', f * 2, 0.06, 0.002, 0.08, { verb: 0.1 });
      noiseHit(v, t, 'highpass', 6000, 0.7, 0.06, 0.0005, 0.008);
      // past the cap the pitch stops rising but it keeps getting more sparkly
      if (over > 0) tone(v, t + 0.01, 'sine', f * 3, Math.min(0.06, 0.012 * over), 0.002, 0.12, { verb: 0.2 });
    },
  },
  mult: {
    level: 1.4,
    jitter: 0.006,
    fn(v, t, o) {
      const step = Math.max(0, Math.floor(o.step || 0));
      const semis = pentatonic(Math.min(step, 12));
      const k = Math.pow(2, semis / 12) * v.p;
      const kk = Math.pow(2, semis / 48); // thump climbs a little
      // deep thump
      tone(v, t, 'sine', 180 * kk, 0.65, 0.002, 0.18, { to: 60 * kk, glide: 0.12 });
      noiseHit(v, t, 'lowpass', 800, 0.7, 0.3, 0.001, 0.04);
      // body "whomp": saw with closing lowpass
      const lp = v.filter('lowpass', 2000, 2);
      lp.frequency.setValueAtTime(2000, t);
      lp.frequency.exponentialRampToValueAtTime(300, t + 0.2);
      lp.connect(v.out);
      tone(v, t, 'sawtooth', 130.81 * k, 0.2, 0.003, 0.2, { dest: lp });
      tone(v, t, 'sawtooth', 130.81 * k, 0.12, 0.003, 0.18, { dest: lp, detune: 9 });
      // pitched ping so the rising step is clearly audible
      tone(v, t, 'triangle', 261.63 * k, 0.14, 0.002, 0.16, { verb: 0.15 });
      tone(v, t, 'sine', 523.25 * k, 0.05, 0.002, 0.1);
    },
  },
  xmult: {
    jitter: 0.01,
    fn(v, t) {
      const hp = v.filter('highpass', 300, 0.7);
      const shaper = v.ctx.createWaveShaper();
      shaper.curve = driveCurve(2.2);
      hp.connect(shaper);
      shaper.connect(v.out);
      (v.extra || (v.extra = [])).push(shaper);
      v.echo(shaper, 0.06, 0.3, 0.35);
      for (const det of [0, 7]) {
        const { g } = tone(v, t, 'sawtooth', 440 * v.p, 0.13, 0.002, 0.27, { to: 1760 * v.p, glide: 0.08, detune: det, dest: hp });
        void g;
      }
      bell(v, t + 0.02, 1760 * v.p, 0.1, 0.45, 0.25);
      tone(v, t, 'sine', 95, 0.5, 0.002, 0.2, { to: 45, glide: 0.15 }); // weight
      noiseHit(v, t, 'highpass', 4000, 0.7, 0.15, 0.001, 0.05);
    },
  },
  retrigger: {
    jitter: 0.01,
    fn(v, t) {
      const bus = v.gain(1);
      bus.connect(v.out);
      v.echo(bus, 0.09, 0.35, 0.4);
      const notes = [783.99, 1046.5, 1567.98];
      notes.forEach((f, i) => {
        tone(v, t + i * 0.055, 'triangle', f * v.p, 0.15, 0.002, 0.09, { dest: bus });
        tone(v, t + i * 0.055, 'square', f * v.p, 0.025, 0.002, 0.06, { dest: bus });
      });
      tone(v, t, 'sine', 300 * v.p, 0.12, 0.005, 0.15, { to: 620 * v.p, glide: 0.12 }); // "boing" up
    },
  },
  hand_reveal: {
    level: 1.3,
    jitter: 0.01,
    fn(v, t) {
      tone(v, t, 'sine', 120, 0.4, 0.003, 0.15, { to: 60, glide: 0.12 });
      noiseHit(v, t, 'bandpass', 1200, 1, 0.15, 0.02, 0.13, { to: 4000, glide: 0.15 });
      const lp = v.filter('lowpass', 2500, 0.6);
      lp.connect(v.out);
      for (const f of [523.25, 659.25, 783.99]) {
        tone(v, t + 0.01, 'triangle', f * v.p, 0.08, 0.004, 0.35, { verb: 0.2 });
        tone(v, t + 0.01, 'square', f * 0.5 * v.p, 0.025, 0.004, 0.25, { dest: lp });
      }
    },
  },
  tick: {
    level: 4.5,
    jitter: 0.004, gap: 0.03,
    fn(v, t, o) {
      let semis;
      if (o.progress != null) semis = clamp(o.progress, 0, 1) * 24;
      else semis = pentatonic(Math.min(Math.max(0, Math.floor(o.step || 0)), 10));
      const f = 880 * Math.pow(2, semis / 12) * v.p;
      tone(v, t, 'sine', f, 0.1, 0.001, 0.025);
      tone(v, t, 'triangle', f * 0.5, 0.04, 0.001, 0.02);
    },
  },
  target_cross: {
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 400, 1.5, 0.3, 0.4, 0.3, { to: 3000, glide: 0.6, hold: 0.1, verb: 0.2 });
      tone(v, t, 'sine', 55, 0.4, 0.4, 0.5, { hold: 0.2 });
      crackle(v, t + 0.1, 16, 0.8, 0.25);
      for (const f of [1046.5, 1567.98, 2637]) {
        tone(v, t + 0.45, 'sine', f * v.p, 0.06, 0.005, 0.8, { verb: 0.35 });
      }
      tone(v, t + 0.45, 'sine', 90, 0.45, 0.003, 0.3, { to: 45, glide: 0.2 });
    },
  },
  // Spannungs-Anstieg (letzter Würfel / letzter Wurf): Rauschen öffnet sich, Ton steigt, leiser Herzschlag
  tension: {
    gap: 0.4,
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 250 * v.p, 3, 0.16, 0.5, 0.18, { to: 1800 * v.p, glide: 0.6, hold: 0.05 });
      tone(v, t, 'triangle', 196 * v.p, 0.08, 0.45, 0.15, { to: 392 * v.p, glide: 0.62, hold: 0.05 });
      tone(v, t, 'sine', 293.66 * v.p, 0.05, 0.45, 0.15, { to: 587.33 * v.p, glide: 0.62, hold: 0.05, detune: 6 });
      tone(v, t, 'sine', 62, 0.3, 0.005, 0.12, { to: 42, glide: 0.1 });
      tone(v, t + 0.22, 'sine', 58, 0.22, 0.005, 0.12, { to: 40, glide: 0.1 });
    },
  },
  flame: {
    fn(v, t) {
      noiseHit(v, t, 'lowpass', 380, 0.7, 0.35, 0.15, 0.5, { hold: 0.7, color: 'pink' });
      noiseHit(v, t, 'bandpass', 1500, 0.5, 0.07, 0.2, 0.4, { hold: 0.6 });
      crackle(v, t + 0.05, 26, 1.3, 0.22);
    },
  },

  // ---------------- money & effects
  coin: {
    level: 1.3,
    jitter: 0.01, gap: 0.03,
    fn(v, t) {
      coinBlip(v, t, 987.77);
      coinBlip(v, t + 0.07, 1318.51);
    },
  },
  money: {
    jitter: 0.01, gap: 0.04,
    fn(v, t) {
      coinBlip(v, t, 987.77);
      coinBlip(v, t + 0.07, 1318.51);
      noiseHit(v, t + 0.07, 'highpass', 5000, 0.7, 0.15, 0.001, 0.05);
      tone(v, t + 0.07, 'sine', 2637 * v.p, 0.07, 0.001, 0.5, { verb: 0.2 });
      tone(v, t + 0.07, 'sine', 3951 * v.p, 0.035, 0.001, 0.4);
    },
  },
  buy: {
    jitter: 0.01,
    fn(v, t) {
      // drawer thud + ka-ching
      tone(v, t, 'sine', 160, 0.35, 0.003, 0.12, { to: 70, glide: 0.1 });
      noiseHit(v, t, 'bandpass', 900, 1, 0.15, 0.002, 0.05);
      coinBlip(v, t + 0.04, 987.77);
      coinBlip(v, t + 0.11, 1318.51);
      noiseHit(v, t + 0.11, 'highpass', 5000, 0.7, 0.18, 0.001, 0.06);
      bell(v, t + 0.11, 2637 * v.p, 0.07, 0.6, 0.25);
    },
  },
  sell: {
    level: 1.4,
    jitter: 0.01,
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 2400, 1, 0.12, 0.01, 0.12, { to: 900, glide: 0.13 });
      coinBlip(v, t, 1318.51, 0.9);
      coinBlip(v, t + 0.07, 987.77, 0.9);
      [2093, 1760, 1568].forEach((f, i) => tone(v, t + 0.15 + i * 0.05, 'sine', f * v.p, 0.05, 0.001, 0.12, { verb: 0.2 }));
    },
  },
  reroll_shop: {
    level: 1.4,
    fn(v, t) {
      let tt = t;
      let gap = 0.03;
      for (let i = 0; i < 9; i++) {
        noiseHit(v, tt, 'bandpass', 2500, 3, 0.16, 0.0005, 0.012);
        tone(v, tt, 'triangle', (900 + i * 40) * v.p, 0.05, 0.001, 0.02);
        tt += gap;
        gap *= i < 4 ? 0.95 : 1.18;
      }
      noiseHit(v, t, 'bandpass', 700, 1, 0.08, 0.1, 0.2, { to: 2200, glide: 0.3 });
      tone(v, tt, 'triangle', 660 * v.p, 0.14, 0.003, 0.12, { to: 990 * v.p, glide: 0.05, verb: 0.15 });
    },
  },
  pack_open: {
    fn(v, t) {
      // tearing foil: amplitude-modulated noise with a rising band
      const { g } = noiseHit(v, t, 'bandpass', 800, 1.2, 0.3, 0.01, 0.06, { to: 3200, glide: 0.28, hold: 0.22 });
      // granular rip: random gain steps on top of the envelope
      const am = v.gain(1);
      g.disconnect();
      g.connect(am);
      am.connect(v.out);
      for (let k = 0, tt = t; tt < t + 0.28; k++, tt += rand(0.006, 0.014)) am.gain.setValueAtTime(rand(0.2, 1), tt);
      am.gain.setValueAtTime(1, t + 0.29);
      // shimmer reveal
      const bus = v.gain(1);
      bus.connect(v.out);
      v.echo(bus, 0.11, 0.35, 0.35);
      [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093].forEach((f, i) =>
        tone(v, t + 0.28 + i * 0.04, 'sine', f * v.p, 0.07, 0.002, 0.25, { dest: bus, verb: 0.3 }));
      tone(v, t + 0.27, 'sine', 140, 0.25, 0.003, 0.12, { to: 70, glide: 0.1 });
    },
  },
  card_flip: {
    level: 4,
    gap: 0.025,
    fn(v, t) {
      noiseHit(v, t, 'bandpass', 1500 * v.p, 1.2, 0.25, 0.004, 0.05, { to: 4000 * v.p, glide: 0.05 });
      tone(v, t + 0.01, 'sine', 1800 * v.p, 0.04, 0.001, 0.015);
    },
  },
  card_pick: {
    level: 2.8,
    gap: 0.03,
    fn(v, t) {
      tone(v, t, 'triangle', 660 * v.p, 0.16, 0.003, 0.1, { to: 880 * v.p, glide: 0.04 });
      tone(v, t, 'sine', 200, 0.15, 0.002, 0.06, { to: 120, glide: 0.05 });
      noiseHit(v, t, 'bandpass', 3000, 1.5, 0.1, 0.002, 0.03);
    },
  },
  shatter: {
    fn(v, t) {
      noiseHit(v, t, 'highpass', 3000, 0.7, 0.35, 0.001, 0.25, { verb: 0.25 });
      noiseHit(v, t, 'bandpass', 6000, 1, 0.2, 0.001, 0.08);
      noiseHit(v, t, 'lowpass', 900, 0.7, 0.25, 0.001, 0.05);
      sparkle(v, t, 14, 0.4, 2500, 7000, 0.07);
    },
  },
  grow: {
    level: 0.7,
    jitter: 0.02,
    fn(v, t) {
      const { osc } = tone(v, t, 'sine', 300 * v.p, 0.15, 0.05, 0.2, { to: 900 * v.p, glide: 0.35, hold: 0.2 });
      vibrato(v, osc.detune, t, t + 0.5, 12, 30);
      tone(v, t, 'triangle', 150 * v.p, 0.08, 0.05, 0.2, { to: 450 * v.p, glide: 0.35, hold: 0.1 });
      [1046.5, 1318.51, 1567.98].forEach((f, i) => tone(v, t + 0.22 + i * 0.07, 'triangle', f * v.p, 0.08, 0.002, 0.15, { verb: 0.25 }));
    },
  },
  whoosh: {
    gap: 0.05,
    fn(v, t) {
      const { fl } = noiseHit(v, t, 'bandpass', 300 * v.p, 1.2, 0.3, 0.15, 0.22, { hold: 0.02 });
      fl.frequency.setValueAtTime(300 * v.p, t);
      fl.frequency.exponentialRampToValueAtTime(2200 * v.p, t + 0.18);
      fl.frequency.exponentialRampToValueAtTime(700 * v.p, t + 0.4);
      noiseHit(v, t, 'lowpass', 500, 0.7, 0.12, 0.15, 0.2, { color: 'pink' });
    },
  },
  level_up: {
    jitter: 0.01,
    fn(v, t) {
      const bus = v.gain(1);
      bus.connect(v.out);
      v.echo(bus, 0.12, 0.3, 0.3);
      [523.25, 587.33, 659.25, 783.99, 880, 1046.5].forEach((f, i) => {
        tone(v, t + i * 0.045, 'triangle', f * v.p, 0.13, 0.002, 0.12, { dest: bus });
        tone(v, t + i * 0.045, 'square', f * v.p, 0.02, 0.002, 0.08, { dest: bus });
      });
      const t2 = t + 0.3;
      for (const f of [1046.5, 1318.51, 1567.98]) {
        const { osc } = tone(v, t2, 'sine', f * v.p, 0.06, 0.02, 0.5, { hold: 0.2, verb: 0.35 });
        vibrato(v, osc.detune, t2, t2 + 0.8, 6, 8);
      }
      noiseHit(v, t, 'bandpass', 600, 1, 0.1, 0.25, 0.15, { to: 4000, glide: 0.35 });
    },
  },
  tag: {
    jitter: 0.01,
    fn(v, t) {
      bell(v, t, 1567.98 * v.p, 0.1, 0.4, 0.25);
      bell(v, t + 0.08, 2093 * v.p, 0.08, 0.5, 0.25);
      noiseHit(v, t, 'highpass', 6000, 0.7, 0.06, 0.0005, 0.01);
    },
  },

  // ---------------- round / run events
  round_won: {
    jitter: 0.008,
    fn(v, t) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const last = i === notes.length - 1;
        const tt = t + i * 0.09;
        const d = last ? 0.35 : 0.14;
        const h = last ? 0.5 : 0;
        const a = tone(v, tt, 'triangle', f * v.p, 0.16, 0.003, d, { hold: h, verb: 0.25 });
        const b = tone(v, tt, 'square', f * v.p, 0.045, 0.003, d, { hold: h });
        if (last) { vibrato(v, a.osc.detune, tt, tt + 1, 6, 8); vibrato(v, b.osc.detune, tt, tt + 1, 6, 8); }
      });
      const lp = v.filter('lowpass', 1500, 0.7);
      lp.connect(v.out);
      for (const f of [261.63, 329.63, 392]) {
        for (const det of [-6, 6]) tone(v, t + 0.27, 'sawtooth', f * v.p, 0.035, 0.08, 0.6, { hold: 0.4, detune: det, dest: lp });
      }
      v.send(lp, 0.3);
      tone(v, t + 0.27, 'sine', 130.81 * v.p, 0.2, 0.01, 0.6, { hold: 0.2 });
      sparkle(v, t + 0.3, 6, 0.6, 2000, 4500, 0.04);
    },
  },
  run_won: {
    jitter: 0.004,
    fn(v, t) {
      const arp = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093];
      const bus = v.gain(1);
      bus.connect(v.out);
      v.echo(bus, 0.14, 0.3, 0.25);
      arp.forEach((f, i) => {
        tone(v, t + i * 0.07, 'triangle', f * v.p, 0.13, 0.003, 0.16, { dest: bus, verb: 0.2 });
        tone(v, t + i * 0.07, 'square', f * v.p, 0.03, 0.003, 0.1, { dest: bus });
      });
      tone(v, t, 'sine', 110, 0.5, 0.003, 0.3, { to: 50, glide: 0.2 });
      const lp = v.filter('lowpass', 1800, 0.7);
      lp.connect(v.out);
      v.send(lp, 0.35);
      const t1 = t + 0.55;
      for (const f of [349.23, 440, 523.25]) for (const det of [-7, 7]) tone(v, t1, 'sawtooth', f * v.p, 0.03, 0.06, 0.25, { hold: 0.35, detune: det, dest: lp });
      tone(v, t1, 'sine', 174.61 * v.p, 0.18, 0.02, 0.25, { hold: 0.35 });
      const t2 = t + 1.1;
      for (const f of [261.63, 329.63, 392, 523.25]) for (const det of [-7, 7]) tone(v, t2, 'sawtooth', f * v.p, 0.03, 0.05, 1.1, { hold: 0.9, detune: det, dest: lp });
      tone(v, t2, 'sine', 130.81 * v.p, 0.25, 0.01, 1.0, { hold: 0.6 });
      tone(v, t2, 'sine', 65, 0.5, 0.003, 0.4, { to: 40, glide: 0.3 });
      const lead = tone(v, t2, 'triangle', 1046.5 * v.p, 0.13, 0.01, 0.9, { hold: 0.8, verb: 0.3 });
      vibrato(v, lead.osc.detune, t2 + 0.2, t2 + 2, 6, 10);
      sparkle(v, t2, 18, 1.6, 2000, 6000, 0.05);
      crackle(v, t2, 10, 0.8, 0.15);
    },
  },
  round_lost: {
    jitter: 0.008,
    fn(v, t) {
      const lp = v.filter('lowpass', 2000, 1);
      lp.frequency.setValueAtTime(2000, t);
      lp.frequency.exponentialRampToValueAtTime(300, t + 0.9);
      lp.connect(v.out);
      v.send(lp, 0.25);
      [392, 369.99, 349.23, 329.63].forEach((f, i) => {
        const tt = t + i * 0.18;
        const last = i === 3;
        const d = last ? 0.55 : 0.17;
        for (const [type, pk] of [['sawtooth', 0.08], ['triangle', 0.13]]) {
          const { osc } = tone(v, tt, type, f * v.p, pk, 0.01, d, { dest: lp, hold: last ? 0.15 : 0.02 });
          osc.detune.setValueAtTime(0, tt);
          osc.detune.linearRampToValueAtTime(-100, tt + (last ? 0.7 : 0.18));
        }
      });
      tone(v, t + 0.72, 'sine', 80, 0.4, 0.003, 0.4, { to: 50, glide: 0.3 });
    },
  },
  warden_reveal: {
    jitter: 0.01,
    fn(v, t) {
      // boom
      tone(v, t, 'sine', 62, 0.6, 0.003, 0.7, { to: 33, glide: 0.5 });
      noiseHit(v, t, 'lowpass', 1500, 0.7, 0.3, 0.002, 0.3, { verb: 0.3 });
      // gong (inharmonic partials)
      const base = 98 * v.p;
      [[1, 0.1, 2.6], [2.32, 0.06, 1.8], [2.85, 0.05, 1.4], [3.9, 0.035, 1.0], [5.4, 0.02, 0.6]].forEach(([r, pk, d]) =>
        tone(v, t + 0.01, 'sine', base * r, pk, 0.004, d, { verb: 0.35 }));
      // dark drone opening up
      const lp = v.filter('lowpass', 150, 3);
      lp.frequency.setValueAtTime(150, t);
      lp.frequency.exponentialRampToValueAtTime(800, t + 1.2);
      lp.frequency.exponentialRampToValueAtTime(200, t + 2.6);
      lp.connect(v.out);
      v.send(lp, 0.3);
      for (const f of [55, 55.4, 82.4]) tone(v, t, 'sawtooth', f * v.p, 0.12, 0.6, 1.2, { hold: 0.8, dest: lp });
      // uneasy tritone sting
      tone(v, t + 0.6, 'triangle', 659.25 * v.p, 0.06, 0.05, 0.9, { verb: 0.4 });
      tone(v, t + 0.6, 'triangle', 466.16 * v.p, 0.06, 0.05, 0.9, { verb: 0.4 });
    },
  },
};

function driveCurve(k) {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm * 0.8;
  }
  return c;
}

export const SOUND_NAMES = Object.keys(SFX);
export { pick };
