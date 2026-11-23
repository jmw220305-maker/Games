// Audio engine: AudioContext, bus graph, shared noise/IR buffers and the per-sound "Voice" helper.
// Nothing here touches globals at import time, so the module can be imported in Node.
//
// Graph:
//   voice.out → [panner] → sfxIn(volume) → sfxComp → master ─┐
//   voice send → sfxVerb(convolver) → sfxIn                     │
//   music instruments → musicIn(volume) → musicDuck → musicLP → master → muteGain → limiter → destination

export const MAX_VOICES = 6;
/** Music sits well below the effects (bus gain at volume 1). */
const MUSIC_GAIN = 0.25;

export function getAudioContextClass() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Pentatonic step → semitones: 0,2,4,7,9,12,14,16,19,21,24… */
const PENT = [0, 2, 4, 7, 9];
export function pentatonic(step) {
  const s = Math.max(0, Math.floor(step));
  return 12 * Math.floor(s / 5) + PENT[s % 5];
}

export class Engine {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    const c = ctx;

    // ---- master
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.muteGain = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    setComp(this.limiter, -2, 0, 20, 0.001, 0.08);
    this.master.connect(this.muteGain);
    this.muteGain.connect(this.limiter);
    this.limiter.connect(c.destination);

    // ---- sfx bus
    this.sfxIn = c.createGain();
    this.sfxIn.gain.value = 0.8; // bus gain 0.8 × user volume 1
    this.sfxComp = c.createDynamicsCompressor();
    setComp(this.sfxComp, -18, 12, 4, 0.003, 0.15);
    this.sfxIn.connect(this.sfxComp);
    this.sfxComp.connect(this.master);

    // ---- music bus
    this.musicIn = c.createGain();
    this.musicIn.gain.value = MUSIC_GAIN;
    this.musicDuck = c.createGain();
    this.musicLP = c.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 900;
    this.musicLP.Q.value = 0.6;
    this.musicIn.connect(this.musicDuck);
    this.musicDuck.connect(this.musicLP);
    this.musicLP.connect(this.master);

    // ---- shared buffers
    this.white = makeNoise(c, 2, 'white');
    this.pink = makeNoise(c, 3, 'pink');
    this.ir = makeIR(c, 2.2, 2.6);

    // ---- sfx reverb (small room/plate)
    this.sfxVerb = c.createConvolver();
    this.sfxVerb.buffer = makeIR(c, 1.3, 3.2);
    const sfxVerbRet = c.createGain();
    sfxVerbRet.gain.value = 0.55;
    this.sfxVerb.connect(sfxVerbRet);
    sfxVerbRet.connect(this.sfxIn);

    this.active = new Map(); // name → Voice[]
    this.lastPlay = new Map(); // name → ctx time
    this.vol = { master: 0.8, sfx: 1, music: 1 };
    this.muted = false;
  }

  get now() {
    return this.ctx.currentTime;
  }

  setVolume(bus, v) {
    v = clamp(Number(v) || 0, 0, 1);
    const t = this.now;
    if (bus === 'master') {
      this.vol.master = v;
      this.master.gain.setTargetAtTime(v * v * 1.0, t, 0.03); // perceptual curve
    } else if (bus === 'sfx') {
      this.vol.sfx = v;
      this.sfxIn.gain.setTargetAtTime(0.8 * v * v, t, 0.03);
    } else if (bus === 'music') {
      this.vol.music = v;
      this.musicIn.gain.setTargetAtTime(MUSIC_GAIN * v * v, t, 0.05);
    }
  }

  mute(b) {
    this.muted = !!b;
    this.muteGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.now, 0.03);
  }

  /** Create a voice for a named sound, enforcing polyphony. */
  voice(name, t, opts, jitter, level = 1) {
    const list = (this.active.get(name) || []).filter((v) => v.end > this.now);
    while (list.length >= MAX_VOICES) list.shift().steal(this.now);
    const v = new Voice(this, t, opts, jitter, level);
    list.push(v);
    this.active.set(name, list);
    return v;
  }
}

function setComp(c, th, knee, ratio, att, rel) {
  c.threshold.value = th;
  c.knee.value = knee;
  c.ratio.value = ratio;
  c.attack.value = att;
  c.release.value = rel;
}

function makeNoise(c, seconds, color) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  if (color === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

/** Synthetic stereo impulse response: exponentially decaying noise, a bit darker towards the tail. */
function makeIR(c, seconds, decay) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.15 + 0.8 * x; // more smoothing later = darker tail
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      const pre = i < c.sampleRate * 0.012 ? 0 : 1; // short predelay
      d[i] = lp * Math.pow(1 - x, decay) * pre * 0.6;
    }
  }
  return buf;
}

/**
 * One instance of a sound. Recipes create nodes through it so they can be stopped (voice stealing)
 * and disconnected afterwards.
 */
export class Voice {
  constructor(eng, t, opts = {}, jitter = 0.04, level = 1) {
    this.eng = eng;
    this.ctx = eng.ctx;
    this.t = t;
    this.sources = [];
    this.end = t + 0.05;
    this.o = opts;
    const semis = Number(opts.pitch) || 0;
    this.p = Math.pow(2, semis / 12) * (1 + (Math.random() * 2 - 1) * jitter);
    this.g = (opts.gain == null ? 1 : clamp(Number(opts.gain) || 0, 0, 2)) * level;
    this.out = this.ctx.createGain();
    this.out.gain.value = this.g;
    let dest = eng.sfxIn;
    if (opts.pan && this.ctx.createStereoPanner) {
      const pn = this.ctx.createStereoPanner();
      pn.pan.value = clamp(Number(opts.pan) || 0, -1, 1);
      this.out.connect(pn);
      pn.connect(dest);
      this.extra = [pn];
    } else {
      this.out.connect(dest);
    }
  }

  _track(src, t0, t1) {
    src.start(t0);
    src.stop(t1);
    this.sources.push(src);
    if (t1 > this.end) this.end = t1;
    return src;
  }

  /** Oscillator from t0 to t1 (seconds, absolute). */
  osc(type, freq, t0, t1, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (detune) o.detune.value = detune;
    return this._track(o, t0, t1);
  }

  /** Noise source playing `dur` seconds from a random offset of a shared buffer. */
  noise(t0, dur, color = 'white', rate = 1) {
    const s = this.ctx.createBufferSource();
    const buf = color === 'pink' ? this.eng.pink : this.eng.white;
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    const off = Math.random() * (buf.duration - 0.1);
    s.start(t0, off);
    s.stop(t0 + dur);
    this.sources.push(s);
    if (t0 + dur > this.end) this.end = t0 + dur;
    return s;
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type, freq, Q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    return f;
  }

  /** Attack/decay envelope that ends on 0.0001 (no clicks). Returns end time. */
  env(param, t, a, peak, d) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
    param.setValueAtTime(0, t + a + d + 0.001);
    if (t + a + d + 0.02 > this.end) this.end = t + a + d + 0.02;
    return t + a + d;
  }

  /** Attack / hold / release envelope. */
  ahr(param, t, a, peak, h, r) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + h);
    param.exponentialRampToValueAtTime(0.0001, t + a + h + r);
    param.setValueAtTime(0, t + a + h + r + 0.001);
    if (t + a + h + r + 0.02 > this.end) this.end = t + a + h + r + 0.02;
    return t + a + h + r;
  }

  /** Chain nodes a → b → c …, last one into the voice output if `toOut`. */
  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  /** Reverb send from a node. */
  send(node, amount) {
    const g = this.gain(amount * this.g);
    node.connect(g);
    g.connect(this.eng.sfxVerb);
    (this.extra || (this.extra = [])).push(g);
    return g;
  }

  /** Feedback delay (echo) inserted after `node`, output into the voice. */
  echo(node, time, fb, wet, lpHz = 3500) {
    const d = this.ctx.createDelay(1);
    d.delayTime.value = time;
    const f = this.gain(fb);
    const lp = this.filter('lowpass', lpHz, 0.5);
    const w = this.gain(wet);
    node.connect(d);
    d.connect(lp);
    lp.connect(f);
    f.connect(d);
    lp.connect(w);
    w.connect(this.out);
    (this.extra || (this.extra = [])).push(d, f, lp, w);
    // tail: let the echo ring out
    const tail = Math.log(0.001) / Math.log(Math.max(0.01, fb)) * time;
    this.end = Math.max(this.end, this.t + tail);
    return d;
  }

  /** Called after the recipe ran: schedule cleanup. */
  finish() {
    const ms = Math.max(0, (this.end - this.eng.now) * 1000) + 400;
    this._timer = setTimeout(() => this.dispose(), ms);
  }

  dispose() {
    try { this.out.disconnect(); } catch { /* already */ }
    if (this.extra) for (const n of this.extra) { try { n.disconnect(); } catch { /* */ } }
  }

  /** Voice stealing: fade out fast and stop everything. */
  steal(now) {
    const g = this.out.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(0, now, 0.006);
    } catch { /* */ }
    for (const s of this.sources) { try { s.stop(now + 0.05); } catch { /* */ } }
    this.end = now + 0.05;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.dispose(), 120);
  }
}
