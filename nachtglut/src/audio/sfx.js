// Procedural sound effect library. Every effect is a small synth patch built from oscillators, noise and
// filters. Patches only talk to a `Kit`, which is bound to an (Offline)AudioContext + destination, so the
// exact same code renders live and offline (see offline.js).
//
// Patch options (all times in seconds, relative to the start of the sound):
//   t      start offset                a     attack (linear)           dur   total length incl. attack
//   hold   time at full level          g     peak gain                 lin   linear instead of exponential decay
//   f/f1   start / end frequency       sweep time for f -> f1 (default dur)
//   lp/hp/bp  filter: Hz or [from, to, sweepTime?]      q   filter resonance
//   drive  tanh distortion amount      fm    [ratio, index, decay]     vib   [rateHz, depthCents]
// Registry entries: g = voice gain (loudness balance lives here), prio 0 = droppable / 2 = important,
// gap = min seconds between two plays of the same name, rev = reverb send, vary = random pitch spread.

import { clamp, mtof, noiseBuffer, driveCurve, prng } from './synth.js';

const N = mtof;
const fq = (f) => clamp(f, 16, 18000);

class Kit {
  constructor(ctx, out, t0, pitch, rnd) {
    this.ctx = ctx;
    this.out = out;
    this.t0 = t0;
    this.p = pitch;
    this.rnd = rnd;
    this.end = t0;
    this.srcs = [];
    this.live = 0;
    this.onDone = null;
  }

  _track(src, chain, stopAt) {
    this.srcs.push(src);
    this.live++;
    if (stopAt > this.end) this.end = stopAt;
    src.onended = () => {
      for (const n of chain) { try { n.disconnect(); } catch (_) { /* already gone */ } }
      if (--this.live <= 0 && this.onDone) this.onDone();
    };
  }

  _env(g, ts, o) {
    const peak = o.g ?? 0.5;
    const dur = Math.max(0.01, o.dur ?? 0.2);
    const a = Math.min(o.a ?? 0.004, dur * 0.9);
    const te = ts + dur;
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(peak, ts + a);
    if (o.hold) g.gain.setValueAtTime(peak, Math.min(ts + a + o.hold, te - 0.005));
    if (o.lin) {
      g.gain.linearRampToValueAtTime(0, te);
    } else {
      g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-5), te);
      g.gain.linearRampToValueAtTime(0, te + 0.01);
    }
    return te + 0.02;
  }

  _filter(o, ts, dur) {
    let type = null, v;
    if (o.lp !== undefined) { type = 'lowpass'; v = o.lp; } else if (o.hp !== undefined) { type = 'highpass'; v = o.hp; } else if (o.bp !== undefined) { type = 'bandpass'; v = o.bp; }
    if (!type) return null;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    const sweep = Array.isArray(v);
    f.frequency.setValueAtTime(fq((sweep ? v[0] : v) * this.p), ts);
    if (sweep) f.frequency.exponentialRampToValueAtTime(fq(v[1] * this.p), ts + (v[2] ?? dur));
    f.Q.value = o.q ?? (type === 'bandpass' ? 1 : 0.7);
    return f;
  }

  /** Oscillator voice with pitch sweep, optional FM, vibrato, drive and filter. */
  tone(o) {
    const ctx = this.ctx;
    const ts = this.t0 + (o.t || 0);
    const dur = o.dur ?? 0.2;
    const f0 = fq(o.f * this.p);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f0, ts);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(fq(o.f1 * this.p), ts + (o.sweep ?? dur));
    const chain = [osc];
    let node = osc;
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(o.drive);
      node.connect(ws); node = ws; chain.push(ws);
    }
    const flt = this._filter(o, ts, dur);
    if (flt) { node.connect(flt); node = flt; chain.push(flt); }
    const g = ctx.createGain();
    node.connect(g); g.connect(this.out); chain.push(g);
    const stopAt = this._env(g, ts, o);
    const extra = [];
    if (o.fm) {
      const [ratio, index, decay = 0.1] = o.fm;
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      mod.frequency.setValueAtTime(f0 * ratio, ts);
      mg.gain.setValueAtTime(f0 * index, ts);
      mg.gain.exponentialRampToValueAtTime(Math.max(f0 * index * 0.02, 0.01), ts + Math.min(decay * 4, dur));
      mod.connect(mg); mg.connect(osc.frequency);
      extra.push(mod); chain.push(mod, mg);
    }
    if (o.vib) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = o.vib[0];
      lg.gain.value = o.vib[1];
      lfo.connect(lg); lg.connect(osc.detune);
      extra.push(lfo); chain.push(lfo, lg);
    }
    for (const e of extra) { e.start(ts); e.stop(stopAt); }
    osc.start(ts);
    osc.stop(stopAt);
    this._track(osc, chain, stopAt);
    return this;
  }

  /** Filtered noise burst. color: 'white' | 'pink' | 'brown'. */
  noise(o) {
    const ctx = this.ctx;
    const ts = this.t0 + (o.t || 0);
    const dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, o.color || 'white');
    src.loop = true;
    const chain = [src];
    let node = src;
    const flt = this._filter(o, ts, dur);
    if (flt) { node.connect(flt); node = flt; chain.push(flt); }
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(o.drive);
      node.connect(ws); node = ws; chain.push(ws);
    }
    const g = ctx.createGain();
    node.connect(g); g.connect(this.out); chain.push(g);
    const stopAt = this._env(g, ts, o);
    src.start(ts, this.rnd() * 1.5);
    src.stop(stopAt);
    this._track(src, chain, stopAt);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// The patches

export const SFX = {
  // ---- player weapons: fire many times per second -> short, soft, quiet ----------------------
  shoot_fire: { g: 0.17, prio: 0, gap: 0.05, rev: 0.05, fn(k) {
    k.noise({ bp: [2200, 500], q: 0.9, dur: 0.09, g: 0.7 });
    k.tone({ type: 'sawtooth', f: 420, f1: 150, dur: 0.08, lp: [2400, 600], g: 0.45 });
    k.tone({ f: 190, f1: 80, dur: 0.07, g: 0.6 });
  } },
  shoot_frost: { g: 0.15, prio: 0, gap: 0.05, rev: 0.08, fn(k) {
    k.tone({ f: 1900, f1: 1250, dur: 0.07, g: 0.5 });
    k.tone({ type: 'triangle', f: 2850, f1: 2500, dur: 0.045, g: 0.22 });
    k.noise({ hp: 6000, dur: 0.03, g: 0.3 });
    k.tone({ f: 420, f1: 260, dur: 0.05, g: 0.35 });
  } },
  shoot_shock: { g: 0.15, prio: 0, gap: 0.05, rev: 0.05, fn(k) {
    k.tone({ type: 'square', f: 1100, f1: 150, sweep: 0.06, dur: 0.08, bp: 1600, q: 1.2, g: 0.7 });
    k.noise({ hp: 3500, dur: 0.025, g: 0.45 });
    k.noise({ hp: 4500, t: 0.035, dur: 0.02, g: 0.28 });
    k.tone({ f: 220, f1: 90, dur: 0.06, g: 0.4 });
  } },
  shoot_poison: { g: 0.17, prio: 0, gap: 0.05, rev: 0.06, fn(k) {
    k.tone({ f: 260, f1: 620, sweep: 0.05, dur: 0.09, g: 0.7 });
    k.tone({ type: 'triangle', f: 150, f1: 90, dur: 0.07, g: 0.4 });
    k.noise({ lp: 1200, dur: 0.035, g: 0.4 });
  } },
  shoot_shadow: { g: 0.18, prio: 0, gap: 0.05, rev: 0.1, fn(k) {
    k.tone({ f: 380, f1: 105, dur: 0.12, g: 0.7 });
    k.tone({ type: 'triangle', f: 386, f1: 96, dur: 0.12, g: 0.35 });
    k.noise({ color: 'pink', lp: [900, 300], dur: 0.1, g: 0.5 });
  } },
  shoot_phys: { g: 0.16, prio: 0, gap: 0.05, rev: 0.04, fn(k) {
    k.noise({ bp: [3200, 1000], q: 1.1, dur: 0.055, g: 0.8 });
    k.tone({ type: 'triangle', f: 340, f1: 150, dur: 0.05, g: 0.6 });
  } },
  shoot_light: { g: 0.14, prio: 0, gap: 0.05, rev: 0.1, fn(k) {
    k.tone({ f: 1320, f1: 1980, sweep: 0.05, dur: 0.1, g: 0.5 });
    k.tone({ f: 2640, dur: 0.06, g: 0.16 });
    k.tone({ type: 'triangle', f: 660, f1: 880, dur: 0.06, g: 0.3 });
    k.noise({ hp: 7000, dur: 0.03, g: 0.18 });
  } },

  // ---- player ---------------------------------------------------------------------------------
  dash: { g: 0.22, gap: 0.08, rev: 0.08, fn(k) {
    k.noise({ bp: [500, 3400, 0.09], q: 1.1, a: 0.02, dur: 0.2, g: 0.8 });
    k.noise({ color: 'pink', lp: [1800, 400], a: 0.01, dur: 0.16, g: 0.4 });
    k.tone({ f: 240, f1: 70, dur: 0.14, g: 0.35 });
  } },
  skill: { g: 0.34, gap: 0.1, rev: 0.2, fn(k) {
    k.noise({ bp: [400, 4200, 0.25], q: 1.4, a: 0.05, dur: 0.4, g: 0.5 });
    k.tone({ type: 'sawtooth', f: 180, f1: 720, sweep: 0.22, a: 0.02, dur: 0.32, lp: [800, 3200], g: 0.35 });
    k.tone({ f: 120, f1: 50, t: 0.2, dur: 0.3, g: 0.6 });
    [74, 81, 86].forEach((m, i) => k.tone({ f: N(m), t: 0.2 + i * 0.035, dur: 0.4, g: 0.2, fm: [2, 1.2, 0.1] }));
  } },
  player_hit: { g: 0.4, prio: 2, gap: 0.1, rev: 0.08, fn(k) {
    k.noise({ bp: 1700, q: 0.6, dur: 0.11, g: 0.9, drive: 3 });
    k.tone({ type: 'square', f: 170, f1: 55, dur: 0.16, lp: 900, g: 0.7, drive: 2 });
    k.tone({ f: 95, f1: 40, dur: 0.22, g: 0.8 });
    k.tone({ type: 'sawtooth', f: 620, f1: 250, dur: 0.14, lp: 2400, g: 0.3 });
  } },
  player_heal: { g: 0.3, gap: 0.25, rev: 0.25, vary: 0.01, fn(k) {
    [72, 76, 79].forEach((m, i) => k.tone({ f: N(m), t: i * 0.065, a: 0.01, dur: 0.38, g: 0.4 }));
    k.tone({ type: 'triangle', f: N(84), t: 0.19, a: 0.02, dur: 0.45, g: 0.2 });
    k.noise({ hp: 5000, t: 0.05, a: 0.08, dur: 0.4, g: 0.08 });
  } },
  player_shield: { g: 0.3, gap: 0.15, rev: 0.15, fn(k) {
    k.tone({ f: 520, dur: 0.4, g: 0.5, fm: [2.4, 2.2, 0.1] });
    k.tone({ f: 1040, f1: 1100, dur: 0.25, g: 0.2 });
    k.noise({ hp: 4000, dur: 0.04, g: 0.35 });
    k.tone({ type: 'triangle', f: 260, f1: 300, a: 0.01, dur: 0.3, g: 0.3 });
  } },
  player_death: { g: 0.45, prio: 2, gap: 1, rev: 0.35, vary: 0, fn(k) {
    k.noise({ bp: 2500, q: 0.8, dur: 0.12, g: 0.7, drive: 3 });
    k.tone({ type: 'sawtooth', f: 392, f1: 49, sweep: 1.7, dur: 1.9, lp: [2200, 200], g: 0.45, vib: [5.5, 25] });
    k.tone({ type: 'sawtooth', f: 370, f1: 46, sweep: 1.7, dur: 1.9, lp: [1800, 180], g: 0.32 });
    k.tone({ f: 110, f1: 30, dur: 1.2, g: 0.9 });
    k.noise({ color: 'brown', lp: [900, 100], dur: 1.6, g: 0.8 });
    // the last ember going out
    k.tone({ f: N(62), t: 1.3, a: 0.05, dur: 1.3, g: 0.3, fm: [2.01, 1.2, 0.3] });
    k.tone({ f: N(57), t: 1.3, a: 0.05, dur: 1.3, g: 0.2 });
  } },
  levelup: { g: 0.6, prio: 2, gap: 0.3, rev: 0.3, vary: 0, fn(k) {
    [74, 78, 81, 86].forEach((m, i) => k.tone({ f: N(m), t: i * 0.07, dur: 0.35, g: 0.45, fm: [2, 1.5, 0.08] }));
    k.tone({ type: 'triangle', f: N(86), t: 0.28, a: 0.02, dur: 0.8, g: 0.3 });
    k.tone({ f: N(93), t: 0.28, a: 0.02, dur: 0.7, g: 0.16 });
    k.tone({ type: 'triangle', f: N(62), a: 0.01, dur: 0.6, g: 0.3 });
    k.noise({ hp: 6000, t: 0.26, a: 0.03, dur: 0.5, g: 0.1 });
  } },
  revive: { g: 0.5, prio: 2, gap: 1, rev: 0.35, vary: 0, fn(k) {
    k.noise({ bp: [300, 5000, 0.8], q: 1.2, a: 0.75, dur: 0.95, g: 0.5 });
    k.tone({ type: 'sawtooth', f: 110, f1: 440, sweep: 0.8, a: 0.7, dur: 0.9, lp: [400, 3000], g: 0.35 });
    k.tone({ f: 80, f1: 40, t: 0.8, dur: 0.5, g: 0.8 });
    [62, 69, 74, 76, 81].forEach((m, i) => k.tone({ type: i & 1 ? 'triangle' : 'sine', f: N(m), t: 0.8 + i * 0.02, a: 0.01, dur: 1.1, g: 0.2, fm: i === 4 ? [2, 1, 0.2] : undefined }));
    k.noise({ hp: 6000, t: 0.8, dur: 0.6, g: 0.14 });
  } },
  fall: { g: 0.32, gap: 0.3, rev: 0.25, fn(k) {
    k.tone({ f: 880, f1: 130, sweep: 0.5, a: 0.02, dur: 0.55, g: 0.5, vib: [11, 30] });
    k.tone({ type: 'triangle', f: 440, f1: 65, sweep: 0.5, a: 0.02, dur: 0.55, g: 0.2 });
    k.tone({ f: 100, f1: 38, t: 0.5, dur: 0.25, g: 0.9 });
    k.noise({ color: 'pink', lp: 700, t: 0.5, dur: 0.18, g: 0.7 });
  } },
  footstep: { g: 0.09, prio: 0, gap: 0.12, rev: 0.05, vary: 0.1, fn(k) {
    k.noise({ color: 'pink', lp: [900, 300], dur: 0.05, g: 0.9 });
    k.tone({ f: 110, f1: 60, dur: 0.04, g: 0.4 });
  } },
  weapon_swap: { g: 0.24, gap: 0.08, rev: 0.06, fn(k) {
    k.noise({ hp: 3500, dur: 0.02, g: 0.6 });
    k.tone({ type: 'square', f: 1300, f1: 900, dur: 0.03, lp: 3000, g: 0.3 });
    k.noise({ bp: 2200, q: 2, t: 0.07, dur: 0.035, g: 0.7 });
    k.tone({ type: 'triangle', f: 700, f1: 520, t: 0.07, dur: 0.07, g: 0.45 });
  } },
  weapon_gain: { g: 0.46, gap: 0.2, rev: 0.25, vary: 0, fn(k) {
    k.tone({ f: 660, dur: 0.5, g: 0.35, fm: [2.76, 2.5, 0.12] });
    k.noise({ hp: [3000, 8000], dur: 0.25, g: 0.22 });
    k.tone({ type: 'triangle', f: N(69), t: 0.08, dur: 0.3, g: 0.4 });
    k.tone({ type: 'triangle', f: N(76), t: 0.2, dur: 0.5, g: 0.45 });
    k.tone({ f: N(88), t: 0.2, dur: 0.4, g: 0.12 });
  } },
  weapon_upgrade: { g: 0.46, gap: 0.2, rev: 0.25, vary: 0, fn(k) {
    k.tone({ f: 880, dur: 0.6, g: 0.4, fm: [1.41, 3, 0.15] });
    k.tone({ f: 2217, dur: 0.3, g: 0.1 });
    k.noise({ bp: 3000, q: 1, dur: 0.04, g: 0.6 });
    k.tone({ f: 140, f1: 70, dur: 0.12, g: 0.5 });
    [74, 78, 81, 86].forEach((m, i) => k.tone({ type: 'triangle', f: N(m), t: 0.14 + i * 0.07, dur: 0.3, g: 0.3 }));
    k.noise({ hp: 6500, t: 0.35, a: 0.05, dur: 0.45, g: 0.09 });
  } },

  // ---- enemies --------------------------------------------------------------------------------
  enemy_hit: { g: 0.17, prio: 0, gap: 0.04, rev: 0.04, vary: 0.07, fn(k) {
    k.noise({ bp: 2200, q: 0.7, dur: 0.05, g: 0.9, drive: 2 });
    k.tone({ type: 'square', f: 200, f1: 90, dur: 0.06, lp: 1400, g: 0.5 });
    k.noise({ hp: 5000, dur: 0.012, g: 0.4 });
  } },
  enemy_crit: { g: 0.3, gap: 0.05, rev: 0.1, vary: 0.05, fn(k) {
    k.noise({ bp: 2600, q: 0.6, dur: 0.09, g: 1, drive: 3 });
    k.tone({ type: 'sawtooth', f: 380, f1: 70, dur: 0.1, lp: 2400, g: 0.7, drive: 2 });
    k.tone({ f: 150, f1: 50, dur: 0.12, g: 0.7 });
    k.tone({ f: 2900, f1: 2300, dur: 0.16, g: 0.22 });
    k.tone({ f: 4350, dur: 0.1, g: 0.1 });
  } },
  enemy_death: { g: 0.27, gap: 0.05, rev: 0.12, vary: 0.08, fn(k) {
    k.noise({ lp: [3200, 250], dur: 0.2, g: 0.8, drive: 2 });
    k.tone({ f: 210, f1: 48, dur: 0.18, g: 0.8 });
    k.tone({ type: 'sawtooth', f: 330, f1: 90, dur: 0.14, lp: 1500, g: 0.3 });
    k.noise({ bp: 900, q: 3, t: 0.03, dur: 0.1, g: 0.3 });
  } },
  elite_death: { g: 0.45, prio: 2, gap: 0.12, rev: 0.25, fn(k) {
    k.tone({ f: 130, f1: 34, sweep: 0.3, dur: 0.6, g: 0.9 });
    k.noise({ color: 'brown', lp: [3000, 180], dur: 0.6, g: 0.8, drive: 2.5 });
    k.noise({ hp: 3000, dur: 0.06, g: 0.5 });
    [81, 77, 74, 69].forEach((m, i) => k.tone({ f: N(m), t: 0.08 + i * 0.07, dur: 0.5, g: 0.18, fm: [3, 1.5, 0.1] }));
    k.noise({ bp: [2400, 600], q: 0.8, t: 0.1, a: 0.05, dur: 0.7, g: 0.25 });
  } },
  enemy_spawn: { g: 0.16, prio: 0, gap: 0.09, rev: 0.2, vary: 0.1, fn(k) {
    k.tone({ f: 70, f1: 230, sweep: 0.18, a: 0.03, dur: 0.24, g: 0.7 });
    k.tone({ type: 'triangle', f: 141, f1: 466, sweep: 0.18, a: 0.03, dur: 0.2, g: 0.25 });
    k.noise({ color: 'pink', bp: [300, 1400], q: 1.2, a: 0.06, dur: 0.22, g: 0.5 });
  } },
  enemy_shoot: { g: 0.15, prio: 0, gap: 0.06, rev: 0.08, vary: 0.08, fn(k) {
    k.tone({ type: 'square', f: 560, f1: 230, dur: 0.09, lp: 1700, g: 0.6 });
    k.tone({ f: 280, f1: 120, dur: 0.08, g: 0.5 });
    k.noise({ bp: 1500, q: 1, dur: 0.03, g: 0.4 });
  } },
  enemy_melee: { g: 0.2, prio: 0, gap: 0.06, rev: 0.06, vary: 0.08, fn(k) {
    k.noise({ bp: [1500, 380], q: 1.3, a: 0.012, dur: 0.11, g: 0.9 });
    k.tone({ f: 150, f1: 70, t: 0.03, dur: 0.09, g: 0.5 });
  } },
  enemy_charge: { g: 0.25, gap: 0.1, rev: 0.12, fn(k) {
    k.tone({ type: 'sawtooth', f: 65, f1: 150, sweep: 0.32, a: 0.05, dur: 0.38, lp: [300, 1100], g: 0.6, drive: 2 });
    k.tone({ type: 'sawtooth', f: 67.5, f1: 157, sweep: 0.32, a: 0.05, dur: 0.38, lp: [300, 1000], g: 0.5 });
    k.noise({ color: 'pink', bp: [400, 1800], q: 0.8, a: 0.2, dur: 0.38, g: 0.4 });
  } },
  enemy_slam: { g: 0.36, gap: 0.1, rev: 0.2, fn(k) {
    k.tone({ f: 120, f1: 30, sweep: 0.18, dur: 0.4, g: 1 });
    k.noise({ color: 'brown', lp: [1800, 150], dur: 0.35, g: 0.9, drive: 2 });
    k.noise({ bp: 2500, q: 0.7, dur: 0.03, g: 0.4 });
    k.noise({ color: 'pink', bp: 500, q: 0.6, t: 0.05, a: 0.03, dur: 0.4, g: 0.25 });
  } },
  enemy_cast: { g: 0.2, gap: 0.08, rev: 0.25, fn(k) {
    k.tone({ f: 380, f1: 950, sweep: 0.26, a: 0.04, dur: 0.32, g: 0.45, vib: [14, 40] });
    k.tone({ type: 'triangle', f: 570, f1: 1430, sweep: 0.26, a: 0.06, dur: 0.3, g: 0.2 });
    k.noise({ hp: [2500, 6000], a: 0.1, dur: 0.3, g: 0.15 });
  } },
  enemy_summon: { g: 0.24, gap: 0.1, rev: 0.25, fn(k) {
    [0, 1, 2].forEach((i) => k.tone({ f: 520 - i * 110, f1: 250 - i * 50, t: i * 0.09, dur: 0.14, g: 0.5 }));
    k.tone({ type: 'sawtooth', f: 82, f1: 60, a: 0.05, dur: 0.45, lp: 500, g: 0.5 });
    k.noise({ color: 'pink', lp: [400, 1500], a: 0.25, dur: 0.4, g: 0.4 });
  } },
  enemy_beam: { g: 0.22, gap: 0.15, rev: 0.12, fn(k) {
    k.tone({ type: 'sawtooth', f: 110, a: 0.03, hold: 0.3, dur: 0.55, bp: [500, 2600], q: 3, g: 0.6 });
    k.tone({ type: 'sawtooth', f: 221, a: 0.03, hold: 0.3, dur: 0.55, bp: [700, 3200], q: 3, g: 0.4 });
    k.noise({ hp: 4500, a: 0.05, hold: 0.3, dur: 0.5, g: 0.18 });
    k.tone({ f: 55, a: 0.02, hold: 0.3, dur: 0.5, g: 0.5 });
  } },
  enemy_teleport: { g: 0.2, gap: 0.08, rev: 0.25, fn(k) {
    k.tone({ f: 1500, f1: 180, sweep: 0.08, dur: 0.1, g: 0.5 });
    k.tone({ f: 180, f1: 1700, sweep: 0.09, t: 0.1, dur: 0.14, g: 0.45 });
    k.noise({ hp: 5000, t: 0.08, dur: 0.12, g: 0.25 });
  } },
  enemy_fuse: { g: 0.14, prio: 0, gap: 0.1, rev: 0.05, fn(k) {
    k.noise({ hp: [2500, 7500], a: 0.1, dur: 0.3, g: 0.6 });
    k.tone({ type: 'square', f: 300, f1: 900, a: 0.05, dur: 0.28, lp: 3000, g: 0.25 });
  } },
  telegraph: { g: 0.14, prio: 0, gap: 0.12, rev: 0.1, vary: 0.02, fn(k) {
    k.tone({ type: 'square', f: 880, dur: 0.05, lp: 2500, g: 0.5 });
    k.tone({ type: 'square', f: 880, t: 0.085, dur: 0.07, lp: 2500, g: 0.6 });
    k.tone({ f: 1760, t: 0.085, dur: 0.05, g: 0.15 });
  } },
  explosion: { g: 0.42, gap: 0.07, rev: 0.25, vary: 0.1, fn(k) {
    k.tone({ f: 150, f1: 27, sweep: 0.3, dur: 0.55, g: 1, drive: 1.5 });
    k.noise({ color: 'brown', lp: [2800, 120], dur: 0.6, g: 1, drive: 3 });
    k.noise({ hp: 2200, dur: 0.03, g: 0.6 });
    k.noise({ color: 'pink', bp: [1200, 300], q: 0.5, t: 0.04, a: 0.03, dur: 0.7, g: 0.35 });
  } },
  status_burn: { g: 0.13, prio: 0, gap: 0.2, rev: 0.05, vary: 0.1, fn(k) {
    k.noise({ hp: 3800, dur: 0.05, g: 0.6 });
    k.noise({ hp: 5000, t: 0.06, dur: 0.04, g: 0.4 });
    k.noise({ bp: [1200, 3000], q: 1.5, t: 0.02, a: 0.03, dur: 0.16, g: 0.5 });
    k.tone({ type: 'sawtooth', f: 300, f1: 600, dur: 0.12, lp: 1600, g: 0.2 });
  } },
  status_freeze: { g: 0.13, prio: 0, gap: 0.2, rev: 0.15, vary: 0.06, fn(k) {
    [2637, 3136, 3951].forEach((f, i) => k.tone({ f, t: i * 0.03, dur: 0.12, g: 0.35 }));
    k.noise({ hp: 7000, dur: 0.03, g: 0.3 });
    k.tone({ type: 'triangle', f: 1318, f1: 1100, dur: 0.1, g: 0.25 });
  } },
  status_poison: { g: 0.14, prio: 0, gap: 0.2, rev: 0.1, vary: 0.1, fn(k) {
    k.tone({ f: 230, f1: 480, sweep: 0.05, dur: 0.08, g: 0.6 });
    k.tone({ f: 300, f1: 590, sweep: 0.05, t: 0.07, dur: 0.08, g: 0.5 });
    k.noise({ lp: 900, dur: 0.05, g: 0.3 });
  } },
  status_shock: { g: 0.13, prio: 0, gap: 0.2, rev: 0.06, vary: 0.1, fn(k) {
    k.tone({ type: 'sawtooth', f: 110, dur: 0.04, bp: 2400, q: 4, g: 0.8 });
    k.tone({ type: 'sawtooth', f: 123, t: 0.05, dur: 0.035, bp: 3000, q: 4, g: 0.7 });
    k.tone({ type: 'sawtooth', f: 98, t: 0.095, dur: 0.05, bp: 2000, q: 4, g: 0.7 });
    k.noise({ hp: 5000, dur: 0.02, g: 0.4 });
    k.noise({ hp: 5000, t: 0.05, dur: 0.02, g: 0.3 });
  } },
  status_dark: { g: 0.14, prio: 0, gap: 0.2, rev: 0.15, vary: 0.08, fn(k) {
    k.tone({ f: 520, f1: 190, dur: 0.2, g: 0.5 });
    k.tone({ f: 541, f1: 181, dur: 0.2, g: 0.4 });
    k.noise({ color: 'pink', lp: [1200, 300], dur: 0.15, g: 0.3 });
  } },

  // ---- bosses ---------------------------------------------------------------------------------
  boss_intro: { g: 0.5, prio: 2, gap: 2, rev: 0.4, vary: 0, fn(k) {
    // ominous swell ...
    k.tone({ type: 'sawtooth', f: 55, a: 2.5, dur: 2.9, lp: [120, 1300, 2.5], g: 0.5 });
    k.tone({ type: 'sawtooth', f: 58.27, a: 2.5, dur: 2.9, lp: [120, 1100, 2.5], g: 0.4 });
    k.tone({ type: 'sawtooth', f: 82.4, f1: 87.3, a: 2.5, dur: 2.9, lp: [150, 1600, 2.5], g: 0.3 });
    k.noise({ color: 'pink', bp: [300, 2400, 2.5], q: 0.7, a: 2.5, dur: 2.8, g: 0.45 });
    // ... into the impact
    k.tone({ f: 95, f1: 26, sweep: 0.5, t: 2.6, dur: 2.2, g: 1 });
    k.noise({ color: 'brown', lp: [2600, 150], t: 2.6, dur: 2, g: 0.9, drive: 2 });
    k.noise({ hp: 3000, t: 2.6, dur: 0.9, g: 0.22 });
    k.tone({ type: 'sawtooth', f: N(38), t: 2.6, a: 0.02, dur: 2.4, lp: [1500, 250], g: 0.5 });
    k.tone({ type: 'sawtooth', f: N(45), t: 2.6, a: 0.02, dur: 2.4, lp: [1300, 250], g: 0.35 });
    k.tone({ type: 'sawtooth', f: N(39), t: 2.6, a: 0.02, dur: 2, lp: [1000, 200], g: 0.2 });
  } },
  boss_phase: { g: 0.45, prio: 2, gap: 0.5, rev: 0.3, vary: 0, fn(k) {
    k.noise({ bp: [300, 3000, 0.3], q: 1, a: 0.28, dur: 0.34, g: 0.5 });
    k.tone({ f: 130, f1: 28, sweep: 0.35, t: 0.3, dur: 0.9, g: 1 });
    k.noise({ color: 'brown', lp: [2600, 160], t: 0.3, dur: 0.9, g: 0.9, drive: 2.5 });
    k.tone({ type: 'sawtooth', f: 98, f1: 392, sweep: 0.5, t: 0.3, a: 0.05, dur: 0.9, lp: [600, 2600], g: 0.4, drive: 2, vib: [9, 35] });
    k.tone({ type: 'sawtooth', f: 104, f1: 415, sweep: 0.5, t: 0.3, a: 0.05, dur: 0.9, lp: [600, 2200], g: 0.3 });
    k.noise({ hp: 3000, t: 0.3, dur: 0.5, g: 0.2 });
  } },
  boss_death: { g: 0.62, prio: 2, gap: 2, rev: 0.4, vary: 0, fn(k) {
    // three staggered blasts
    [0, 0.22, 0.5].forEach((t, i) => {
      k.tone({ f: 150 - i * 20, f1: 28, sweep: 0.35, t, dur: 0.7, g: 0.9 });
      k.noise({ color: 'brown', lp: [3000, 200], t, dur: 0.6, g: 0.8, drive: 2.5 });
      k.noise({ hp: 2500, t, dur: 0.05, g: 0.45 });
    });
    // the dying roar
    k.tone({ type: 'sawtooth', f: 196, f1: 30, sweep: 2.4, t: 0.1, a: 0.05, dur: 2.6, lp: [1800, 150], g: 0.45, drive: 2, vib: [7, 40] });
    k.tone({ type: 'sawtooth', f: 185, f1: 28, sweep: 2.4, t: 0.1, a: 0.05, dur: 2.6, lp: [1500, 150], g: 0.3 });
    k.noise({ color: 'pink', bp: [1800, 200], q: 0.6, t: 0.5, a: 0.1, dur: 3.2, g: 0.45 });
    // light returning: a D major bloom with sparkles
    [62, 69, 74, 78, 86].forEach((m, i) => k.tone({ type: i & 1 ? 'triangle' : 'sine', f: N(m), t: 1.3 + i * 0.09, a: 0.5, dur: 3.4 - i * 0.1, g: 0.2 }));
    [0, 4, 7, 12, 16, 19, 24].forEach((st, i) => k.tone({ f: N(86 + st), t: 1.7 + i * 0.16 + k.rnd() * 0.05, dur: 0.6, g: 0.09, fm: [2, 1.2, 0.1] }));
  } },

  // ---- world ----------------------------------------------------------------------------------
  door_open: { g: 0.3, gap: 0.2, rev: 0.2, fn(k) {
    k.noise({ color: 'brown', bp: [220, 600], q: 1.2, a: 0.05, dur: 0.32, g: 1 });
    k.tone({ type: 'sawtooth', f: 48, f1: 62, a: 0.04, dur: 0.3, lp: 300, g: 0.5 });
    k.tone({ f: 130, f1: 70, t: 0.3, dur: 0.12, g: 0.8 });
    k.noise({ bp: 1800, q: 2, t: 0.3, dur: 0.04, g: 0.4 });
  } },
  door_close: { g: 0.38, gap: 0.2, rev: 0.25, fn(k) {
    k.tone({ f: 105, f1: 38, dur: 0.25, g: 1 });
    k.noise({ color: 'brown', lp: [1400, 200], dur: 0.2, g: 0.9, drive: 2 });
    k.tone({ f: 1250, dur: 0.15, g: 0.12, fm: [1.7, 2, 0.05] });
    k.noise({ bp: 2600, q: 2, t: 0.02, dur: 0.03, g: 0.4 });
  } },
  room_clear: { g: 0.42, prio: 2, gap: 0.5, rev: 0.35, vary: 0, fn(k) {
    [69, 74, 77, 81].forEach((m, i) => k.tone({ f: N(m), t: i * 0.085, dur: i === 3 ? 0.9 : 0.4, g: 0.4, fm: [2, 1.4, 0.1] }));
    k.tone({ type: 'triangle', f: N(62), a: 0.03, dur: 0.9, g: 0.25 });
    k.tone({ type: 'triangle', f: N(69), t: 0.25, a: 0.05, dur: 0.8, g: 0.18 });
    k.noise({ hp: 6000, t: 0.25, a: 0.05, dur: 0.5, g: 0.06 });
  } },
  pickup_spark: { g: 0.13, prio: 0, gap: 0.03, rev: 0.1, vary: 0.015, fn(k) {
    k.tone({ f: 1320, f1: 1760, sweep: 0.03, dur: 0.07, g: 0.6 });
    k.tone({ type: 'triangle', f: 2640, dur: 0.04, g: 0.2 });
  } },
  pickup_xp: { g: 0.12, prio: 0, gap: 0.03, rev: 0.12, vary: 0.015, fn(k) {
    k.tone({ f: 880, f1: 1108, sweep: 0.04, dur: 0.09, g: 0.6, fm: [3, 0.8, 0.02] });
    k.tone({ f: 1760, t: 0.02, dur: 0.06, g: 0.15 });
  } },
  pickup_heart: { g: 0.3, gap: 0.08, rev: 0.25, vary: 0.01, fn(k) {
    k.tone({ f: N(72), a: 0.008, dur: 0.22, g: 0.5 });
    k.tone({ f: N(79), t: 0.09, a: 0.008, dur: 0.4, g: 0.5 });
    k.tone({ type: 'triangle', f: N(60), a: 0.01, dur: 0.3, g: 0.25 });
    k.tone({ f: N(91), t: 0.09, dur: 0.25, g: 0.1 });
  } },
  pickup_ash: { g: 0.22, gap: 0.06, rev: 0.3, vary: 0.03, fn(k) {
    k.noise({ bp: [1600, 3200], q: 1.5, a: 0.04, dur: 0.2, g: 0.4 });
    k.tone({ f: N(67), f1: N(64), sweep: 0.15, a: 0.01, dur: 0.35, g: 0.5, fm: [2, 0.8, 0.1] });
    k.tone({ f: N(55), a: 0.02, dur: 0.3, g: 0.3 });
  } },
  pickup_shield: { g: 0.24, gap: 0.08, rev: 0.15, fn(k) {
    k.tone({ f: 700, dur: 0.22, g: 0.5, fm: [2.4, 1.8, 0.05] });
    k.tone({ type: 'triangle', f: 350, f1: 420, dur: 0.15, g: 0.3 });
    k.noise({ hp: 5000, dur: 0.025, g: 0.3 });
  } },
  chest_open: { g: 0.4, gap: 0.2, rev: 0.3, vary: 0.01, fn(k) {
    k.noise({ bp: 1900, q: 2, dur: 0.035, g: 0.6 });
    k.tone({ f: 160, f1: 80, dur: 0.08, g: 0.6 });
    k.tone({ type: 'sawtooth', f: 85, f1: 150, sweep: 0.22, t: 0.05, a: 0.03, dur: 0.26, lp: 700, q: 4, g: 0.35, vib: [23, 60] });
    [76, 80, 83, 88].forEach((m, i) => k.tone({ f: N(m), t: 0.26 + i * 0.06, dur: 0.5, g: 0.28, fm: [2, 1.2, 0.08] }));
    k.noise({ hp: 6000, t: 0.26, a: 0.04, dur: 0.5, g: 0.1 });
  } },
  barrel_break: { g: 0.3, gap: 0.06, rev: 0.12, vary: 0.08, fn(k) {
    k.noise({ bp: 950, q: 0.9, dur: 0.09, g: 1, drive: 3 });
    k.tone({ f: 130, f1: 55, dur: 0.1, g: 0.7 });
    k.tone({ type: 'square', f: 320, f1: 180, dur: 0.05, lp: 1200, g: 0.4 });
    for (let i = 0; i < 3; i++) k.noise({ bp: 1400 + k.rnd() * 1400, q: 3, t: 0.06 + i * 0.045 + k.rnd() * 0.02, dur: 0.04, g: 0.4 - i * 0.08 });
  } },
  crystal_break: { g: 0.26, gap: 0.06, rev: 0.3, vary: 0.06, fn(k) {
    k.noise({ hp: 4000, dur: 0.06, g: 0.7 });
    k.noise({ bp: 6000, q: 2, t: 0.03, a: 0.01, dur: 0.25, g: 0.3 });
    k.tone({ f: 1568, dur: 0.3, g: 0.25, fm: [3.5, 1.5, 0.06] });
    for (let i = 0; i < 6; i++) k.tone({ f: 2400 + k.rnd() * 3600, t: i * 0.03 + k.rnd() * 0.02, dur: 0.12 + k.rnd() * 0.15, g: 0.2 });
  } },
  fountain: { g: 0.32, gap: 0.3, rev: 0.35, vary: 0.02, fn(k) {
    k.noise({ bp: [900, 2200], q: 2.5, a: 0.1, dur: 0.9, g: 0.5 });
    k.noise({ color: 'pink', lp: 1200, a: 0.2, dur: 1, g: 0.3 });
    for (let i = 0; i < 5; i++) { const f = 500 + k.rnd() * 700; k.tone({ f, f1: f * 1.6, sweep: 0.04, t: 0.05 + i * 0.11 + k.rnd() * 0.05, dur: 0.07, g: 0.3 }); }
    [72, 76, 79, 84].forEach((m, i) => k.tone({ f: N(m), t: 0.35 + i * 0.09, a: 0.01, dur: 0.6, g: 0.25 }));
  } },
  forge: { g: 0.4, gap: 0.3, rev: 0.3, vary: 0.02, fn(k) {
    [0, 0.24].forEach((t, i) => {
      k.tone({ f: i ? 1180 : 1050, t, dur: 0.45, g: 0.4, fm: [1.41, 3.2, 0.1] });
      k.tone({ f: i ? 2960 : 2640, t, dur: 0.2, g: 0.1 });
      k.noise({ bp: 3200, q: 1, t, dur: 0.035, g: 0.6 });
      k.tone({ f: 150, f1: 75, t, dur: 0.1, g: 0.5 });
    });
    k.noise({ color: 'pink', bp: [500, 1800], q: 0.7, t: 0.3, a: 0.12, dur: 0.6, g: 0.4 });
  } },
  shrine: { g: 0.4, gap: 0.3, rev: 0.45, vary: 0.01, fn(k) {
    k.tone({ f: 110, a: 0.01, dur: 2.2, g: 0.6, fm: [1.5, 1.2, 0.5] });
    k.tone({ f: 277, a: 0.01, dur: 1.6, g: 0.2 });
    k.tone({ f: 415.3, a: 0.01, dur: 1.2, g: 0.12 });
    k.tone({ f: 164.8, a: 0.4, dur: 2, g: 0.2 });
    k.noise({ bp: [800, 2400], q: 3, a: 0.6, dur: 1.6, g: 0.18 });
  } },
  portal: { g: 0.42, prio: 2, gap: 0.5, rev: 0.4, vary: 0, fn(k) {
    k.tone({ type: 'sawtooth', f: 82, f1: 660, sweep: 1.25, a: 0.5, dur: 1.4, lp: [400, 4000], g: 0.3, vib: [9, 45] });
    k.tone({ f: 164, f1: 1320, sweep: 1.25, a: 0.5, dur: 1.4, g: 0.3, vib: [9, 45] });
    k.noise({ bp: [300, 5000, 1.25], q: 1.5, a: 1.1, dur: 1.4, g: 0.45 });
    k.tone({ f: 90, f1: 35, t: 1.25, dur: 0.5, g: 0.8 });
    [74, 81, 86, 93].forEach((m, i) => k.tone({ f: N(m), t: 1.25 + i * 0.03, dur: 0.6, g: 0.16, fm: [2, 1, 0.1] }));
  } },
  relic_gain: { g: 0.6, prio: 2, gap: 0.3, rev: 0.45, vary: 0, fn(k) {
    [74, 77, 81, 84, 86, 89].forEach((m, i) => k.tone({ f: N(m), t: i * 0.06, dur: 0.7, g: 0.3, fm: [3.01, 1.6, 0.1] }));
    k.tone({ type: 'triangle', f: N(62), a: 0.05, dur: 1.4, g: 0.25 });
    k.tone({ type: 'triangle', f: N(69), a: 0.1, dur: 1.4, g: 0.2 });
    k.tone({ f: N(93), t: 0.36, a: 0.02, dur: 1, g: 0.12, vib: [6, 12] });
    k.noise({ hp: 7000, a: 0.3, dur: 1.2, g: 0.08 });
  } },
  boon_gain: { g: 0.5, prio: 2, gap: 0.3, rev: 0.35, vary: 0, fn(k) {
    [57, 62, 66, 69, 74].forEach((m, i) => k.tone({ type: i < 2 ? 'triangle' : 'sine', f: N(m), t: i * 0.04, a: 0.01, dur: 0.9 - i * 0.05, g: 0.28 }));
    k.tone({ f: N(86), t: 0.2, dur: 0.6, g: 0.15, fm: [2, 1.2, 0.1] });
    k.noise({ hp: 5500, t: 0.1, a: 0.1, dur: 0.6, g: 0.07 });
  } },
  curse_gain: { g: 0.42, prio: 2, gap: 0.3, rev: 0.4, vary: 0, fn(k) {
    k.tone({ type: 'sawtooth', f: 220, f1: 155.6, sweep: 0.5, a: 0.03, dur: 1.3, lp: [1400, 300], g: 0.4, vib: [5, 20] });
    k.tone({ type: 'sawtooth', f: 226, f1: 152, sweep: 0.5, a: 0.03, dur: 1.3, lp: [1200, 300], g: 0.3 });
    k.tone({ f: N(38), a: 0.02, dur: 1.4, g: 0.6 });
    k.tone({ f: N(39), a: 0.3, dur: 1.4, g: 0.4 });
    k.noise({ color: 'pink', bp: [2500, 300], q: 1.5, a: 0.02, dur: 0.9, g: 0.3 });
    k.tone({ f: N(80), f1: N(79), t: 0.05, dur: 0.8, g: 0.12, fm: [1.41, 2.5, 0.2] });
  } },
  shop_buy: { g: 0.3, gap: 0.1, rev: 0.2, vary: 0.02, fn(k) {
    k.tone({ f: 2093, dur: 0.18, g: 0.4, fm: [2.7, 1.2, 0.03] });
    k.tone({ f: 2794, t: 0.07, dur: 0.3, g: 0.4, fm: [2.7, 1.2, 0.04] });
    k.noise({ hp: 6000, dur: 0.02, g: 0.3 });
    k.tone({ type: 'triangle', f: 523, t: 0.07, dur: 0.12, g: 0.2 });
  } },
  shop_fail: { g: 0.26, gap: 0.15, rev: 0.05, vary: 0, fn(k) {
    k.tone({ type: 'square', f: 150, dur: 0.09, lp: 700, g: 0.7 });
    k.tone({ type: 'square', f: 132, t: 0.12, dur: 0.14, lp: 600, g: 0.7 });
  } },

  // ---- UI: subtle -----------------------------------------------------------------------------
  ui_click: { g: 0.15, gap: 0.03, rev: 0.03, vary: 0.02, fn(k) {
    k.tone({ f: 720, f1: 480, dur: 0.045, g: 0.7 });
    k.noise({ hp: 3000, dur: 0.01, g: 0.4 });
  } },
  ui_hover: { g: 0.06, prio: 0, gap: 0.05, rev: 0.03, vary: 0.02, fn(k) {
    k.tone({ f: 1150, dur: 0.03, g: 0.7 });
  } },
  ui_open: { g: 0.17, gap: 0.08, rev: 0.12, vary: 0.01, fn(k) {
    k.tone({ f: 392, f1: 660, sweep: 0.08, dur: 0.14, g: 0.6 });
    k.noise({ bp: [800, 3000], q: 1.5, a: 0.03, dur: 0.12, g: 0.25 });
  } },
  ui_close: { g: 0.17, gap: 0.08, rev: 0.12, vary: 0.01, fn(k) {
    k.tone({ f: 660, f1: 370, sweep: 0.08, dur: 0.13, g: 0.6 });
    k.noise({ bp: [3000, 800], q: 1.5, a: 0.01, dur: 0.1, g: 0.2 });
  } },
  ui_confirm: { g: 0.22, gap: 0.08, rev: 0.15, vary: 0, fn(k) {
    k.tone({ type: 'triangle', f: N(69), dur: 0.1, g: 0.6 });
    k.tone({ type: 'triangle', f: N(74), t: 0.07, dur: 0.22, g: 0.6 });
    k.tone({ f: N(86), t: 0.07, dur: 0.15, g: 0.15 });
  } },
  ui_deny: { g: 0.2, gap: 0.08, rev: 0.05, vary: 0, fn(k) {
    k.tone({ type: 'square', f: N(52), dur: 0.08, lp: 900, g: 0.7 });
    k.tone({ type: 'square', f: N(51), t: 0.08, dur: 0.14, lp: 800, g: 0.7 });
  } },
  toast: { g: 0.2, gap: 0.15, rev: 0.25, vary: 0.01, fn(k) {
    k.tone({ f: 988, dur: 0.3, g: 0.5, fm: [2, 0.8, 0.05] });
    k.tone({ f: 1482, t: 0.01, dur: 0.2, g: 0.2 });
  } },
  achievement: { g: 0.5, prio: 2, gap: 0.5, rev: 0.4, vary: 0, fn(k) {
    [81, 86, 90].forEach((m, i) => k.tone({ f: N(m), t: i * 0.09, dur: 0.45, g: 0.35, fm: [2, 1.5, 0.08] }));
    k.tone({ f: N(93), t: 0.27, dur: 0.8, g: 0.3, fm: [2, 1.2, 0.12] });
    k.tone({ type: 'triangle', f: N(62), a: 0.02, dur: 0.9, g: 0.3 });
    k.tone({ type: 'triangle', f: N(69), t: 0.27, a: 0.02, dur: 0.7, g: 0.2 });
    k.noise({ hp: 6500, t: 0.27, a: 0.05, dur: 0.6, g: 0.1 });
  } },
  banner: { g: 0.34, gap: 0.4, rev: 0.4, vary: 0, fn(k) {
    k.tone({ f: 98, f1: 73.4, sweep: 0.5, a: 0.03, dur: 1.2, g: 0.8 });
    k.noise({ color: 'pink', bp: [1500, 300], q: 0.8, a: 0.08, dur: 0.9, g: 0.4 });
    k.tone({ type: 'triangle', f: N(50), a: 0.15, dur: 1.4, g: 0.35 });
    k.tone({ type: 'triangle', f: N(57), a: 0.2, dur: 1.4, g: 0.3 });
    k.tone({ f: N(74), t: 0.1, dur: 0.9, g: 0.12, fm: [2, 1, 0.2] });
  } },
};

export const SFX_NAMES = Object.freeze(Object.keys(SFX));

export const DEFAULT_GAP = 0.035;
export const DEFAULT_VARY = 0.04;

/**
 * Build one sound effect voice on `ctx`, starting at time `when`.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dry   destination for the dry signal
 * @param {AudioNode|null} wet  reverb send destination (optional)
 * @param {string} name
 * @param {number} when     context time
 * @param {{volume?: number, pitch?: number, pan?: number, seed?: number}} [opts]
 * @returns {{name, prio, start, end, done, stop(t)}|null}
 */
export function startSfx(ctx, dry, wet, name, when, opts = {}) {
  const def = SFX[name];
  if (!def) return null;
  const volume = clamp(opts.volume ?? 1, 0, 2) * def.g;
  const pitch = clamp(opts.pitch ?? 1, 0.25, 4);
  const out = ctx.createGain();
  out.gain.value = volume;
  const nodes = [out];
  let tail = out;
  const pan = opts.pan ? clamp(opts.pan, -1, 1) : 0;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p); tail = p; nodes.push(p);
  }
  tail.connect(dry);
  if (wet && def.rev) {
    const send = ctx.createGain();
    send.gain.value = def.rev;
    tail.connect(send); send.connect(wet); nodes.push(send);
  }
  const kit = new Kit(ctx, out, when, pitch, prng(opts.seed ?? ((Math.random() * 0x7fffffff) | 1)));
  const voice = {
    name, prio: def.prio ?? 1, start: when, end: when, done: false,
    stop(t) {
      try {
        out.gain.setTargetAtTime(0, t, 0.008);
        for (const s of kit.srcs) s.stop(t + 0.05);
      } catch (_) { /* already stopped */ }
      voice.end = Math.min(voice.end, t + 0.06);
    },
  };
  kit.onDone = () => {
    voice.done = true;
    for (const n of nodes) { try { n.disconnect(); } catch (_) { /* gone */ } }
  };
  try {
    def.fn(kit);
  } catch (err) {
    // a broken patch must never take the game down: silence whatever was already started
    for (const s of kit.srcs) { try { s.stop(); } catch (_) { /* not started */ } }
    kit.onDone();
    return null;
  }
  voice.end = kit.end;
  if (kit.live === 0) kit.onDone();
  return voice;
}
