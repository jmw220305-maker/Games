// Procedural lo-fi / synthwave music. Lookahead scheduler (25 ms timer, 100 ms ahead) on a 16th-note grid.
// Form: 8-bar phrases. Each phrase picks a progression, a section (which layers play), drum/bass/arp/comp
// patterns and maybe a lead motif → the loop never repeats exactly. Fills on bar 4/8, crash after fills.
import { mtof, rand, pick, clamp } from './engine.js';

// ---------------------------------------------------------------- harmony
// name: [bass midi, [voicing midi…]]
const CHORDS = {
  Fmaj7: [41, [53, 57, 60, 64]],
  Fmaj9: [41, [55, 57, 60, 64]],
  Em7: [40, [52, 55, 59, 62]],
  Dm7: [38, [50, 53, 57, 60]],
  Dm9: [38, [53, 57, 60, 64]],
  Cmaj7: [36, [55, 59, 60, 64]],
  Cmaj9: [36, [52, 55, 59, 62]],
  Am9: [45, [55, 59, 60, 64]],
  Am7: [45, [55, 57, 60, 64]],
  G13: [43, [53, 57, 59, 64]],
  G6: [43, [52, 55, 59, 62]],
  Fm6: [41, [53, 56, 60, 62]],
  A7: [45, [55, 57, 61, 64]],
  E7: [40, [52, 56, 59, 62]],
  E7sus: [40, [52, 57, 59, 62]],
  Am: [45, [52, 57, 60, 64]],
  Bbmaj7: [46, [53, 57, 58, 62]],
  Fmaj7s11: [41, [57, 59, 60, 64]],
  Dm6: [38, [53, 57, 59, 62]],
};

// progressions: [chord, beats]
const P = (...a) => a.map((x) => (Array.isArray(x) ? x : [x, 4]));

// ---------------------------------------------------------------- rhythm
// drum strings: 16 chars, '.' = rest, 'x' = 1, 'o' = .65, 'g' = ghost .3
const DR = {
  roundA: { k: 'x.........x.....', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' },
  roundB: { k: 'x......x..x.....', s: '....x.......x..g', h: 'x.oox.o.x.oox.o.' },
  roundC: { k: 'x.....o...x..o..', s: '....x....g..x...', h: 'x.o.x.o.x.o.x.oo' },
  roundD: { k: 'x..o......x.....', s: '....x..g....x...', h: 'x.o.x.ooxgo.x.o.', oh: '..............o.' },
  menuA: { k: 'x.........o.....', r: '....o.......o...', h: '..o...o...o...o.' },
  menuB: { k: 'x.......o.......', r: '....o.......o..g', h: 'o.g.o.g.o.g.o.g.' },
  shopA: { k: 'x..o......x.....', r: '....x..o....x...', h: 'x.o.x.o.x.o.x.o.', sh: 'gogogogogogogogo' },
  shopB: { k: 'x.....x...x..o..', r: '....x.......x.o.', h: 'x.oox.o.x.oox.o.', sh: 'g.o.g.o.g.o.g.o.' },
  wardenA: { k: 'x.......x.o.....', s: '........x.......', h: 'x...o...x...o...' },
  wardenB: { k: 'x..x....x.......', s: '........x.....g.', h: 'x.g.o.g.x.g.o.g.', t: '.............o..' },
};
const FILLS = [
  { from: 12, s: '............goxx', k: '................' },
  { from: 10, s: '..........x..ox.', k: '............x...' },
  { from: 8, s: '........x...x.xx', k: '........x..x....', noHat: true },
  { from: 12, s: '............x...', oh: '..............x.', k: '..............x.' },
  { from: 8, t: '........x.o.x.o.', s: '..............xx' },
];
const vel = (ch) => (ch === 'x' ? 1 : ch === 'o' ? 0.65 : ch === 'g' ? 0.3 : 0);

// bass: [step, semitone offset from chord bass, length in 16ths, velocity]
const BASS = {
  roots: [[0, 0, 7, 1], [8, 0, 6, 0.8]],
  boom: [[0, 0, 5, 1], [6, 0, 2, 0.6], [10, 7, 4, 0.8]],
  walk: [[0, 0, 3, 1], [4, 7, 3, 0.7], [8, 12, 3, 0.8], [12, 7, 3, 0.7]],
  long: [[0, 0, 15, 0.9]],
  syncop: [[0, 0, 3, 1], [3, 0, 2, 0.6], [7, 0, 3, 0.8], [11, -5, 2, 0.6], [14, 0, 2, 0.7]],
  pulse: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, 0, 1.6, i % 2 ? 0.6 : 0.9]),
  half: [[0, 0, 7, 1], [8, 7, 3, 0.7], [12, 0, 3, 0.6]],
};

// arp: indices into the chord tone ladder (voicing +12, +24), null = rest
const _ = null;
const ARP = {
  up8: [0, _, 1, _, 2, _, 3, _, 4, _, 5, _, 6, _, 7, _],
  down8: [7, _, 5, _, 3, _, 1, _, 6, _, 4, _, 2, _, 0, _],
  broken: [0, _, _, 2, _, _, 4, _, 1, _, _, 3, _, _, 5, _],
  sparse: [4, _, _, _, _, _, 5, _, _, _, 6, _, _, _, _, _],
  wave: [0, 2, 4, 2, 5, 4, 6, 4, 1, 3, 5, 3, 6, 5, 7, 5],
  triplet: [0, _, _, 2, _, _, 4, _, _, 6, _, _, 4, _, 2, _],
};

// keys comping: [step, length, velocity]
const COMP = {
  whole: [[0, 15, 0.8]],
  push: [[0, 5, 0.8], [6, 2, 0.45], [10, 5, 0.7]],
  anticip: [[0, 7, 0.7], [14, 2, 0.55]],
  offs: [[2, 2, 0.5], [6, 2, 0.6], [10, 2, 0.5], [14, 2, 0.6]],
  charleston: [[0, 3, 0.75], [6, 4, 0.6]],
};

// sections: which layers play. enter: layer → first bar (0–7) it plays in the phrase
const SECTIONS = {
  intro: { pad: 1, keys: 1, bass: 1, kick: 1, hats: 1, snare: 1, arp: 0, lead: 0, enter: { kick: 4, hats: 2, snare: 6, bass: 2 }, bassPat: 'long' },
  full: { pad: 1, keys: 1, bass: 1, kick: 1, hats: 1, snare: 1, arp: 1, lead: 1 },
  groove: { pad: 0.4, keys: 1, bass: 1, kick: 1, hats: 1, snare: 1, arp: 0.6, lead: 0 },
  light: { pad: 1, keys: 1, bass: 1, kick: 0.6, hats: 1, snare: 0, arp: 1, lead: 1 },
  breakdown: { pad: 1, keys: 0.7, bass: 0.6, kick: 0, hats: 0, snare: 0, arp: 0.8, lead: 1, bassPat: 'long', arpPat: 'sparse' },
};

// ---------------------------------------------------------------- moods
const MOODS = {
  menu: {
    bpm: 74, swing: 0.58, closed: 1500,
    progs: [P(['Cmaj7', 8], ['Am9', 8], ['Fmaj9', 8], ['G6', 8]), P(['Fmaj7', 8], ['Em7', 8], ['Dm9', 8], ['Cmaj9', 8]), P('Am9', 'Fmaj7', 'Cmaj9', 'G6')],
    sections: { light: 3, breakdown: 2, full: 2 }, entry: 'light',
    drums: ['menuA', 'menuB'], bass: ['long', 'half', 'roots'], arp: ['sparse', 'broken', 'wave'], comp: ['whole', 'anticip', 'charleston'],
    levels: { pad: 1, keys: 1.1, bass: 0.8, drums: 0.6, arp: 0.7, lead: 1, tex: 1 },
    padWave: 'triangle', arpWave: 'triangle', leadProb: 0.5, scale: [72, 74, 76, 79, 81, 84], chimes: true,
  },
  round: {
    bpm: 82, swing: 0.57, closed: 900,
    progs: [P('Fmaj7', 'Em7', 'Dm7', 'Cmaj7'), P('Am9', 'Dm9', 'G13', 'Cmaj9'), P('Fmaj9', 'G6', 'Em7', 'Am7'), P('Dm9', 'Em7', 'Fmaj7', 'G13')],
    sections: { full: 4, groove: 3, light: 2, breakdown: 1 }, entry: 'groove',
    drums: ['roundA', 'roundB', 'roundC', 'roundD'], bass: ['boom', 'syncop', 'roots', 'walk'], arp: ['up8', 'broken', 'wave', 'down8'], comp: ['push', 'anticip', 'offs', 'charleston'],
    levels: { pad: 1, keys: 1, bass: 1, drums: 1, arp: 1, lead: 1, tex: 1 },
    padWave: 'sawtooth', arpWave: 'square', leadProb: 0.4, scale: [72, 74, 76, 79, 81, 84],
  },
  shop: {
    bpm: 80, swing: 0.6, closed: 1300,
    progs: [P('Dm9', 'G13', 'Cmaj9', 'A7'), P('Fmaj7', 'Fm6', 'Em7', 'A7'), P('Dm9', 'G13', 'Em7', 'Am7'), P(['Fmaj9', 2], ['Fm6', 2], 'Em7', ['Dm9', 2], ['G13', 2], 'Cmaj9')],
    sections: { groove: 4, full: 2, light: 2 }, entry: 'groove',
    drums: ['shopA', 'shopB'], bass: ['walk', 'syncop', 'boom'], arp: ['triplet', 'broken', 'sparse'], comp: ['charleston', 'offs', 'push'],
    levels: { pad: 0.7, keys: 1.2, bass: 1, drums: 0.85, arp: 0.8, lead: 0.9, tex: 1 },
    padWave: 'triangle', arpWave: 'triangle', leadProb: 0.35, scale: [72, 74, 76, 79, 81, 84],
  },
  warden: {
    bpm: 72, swing: 0.55, closed: 800,
    progs: [P('Am', 'Fmaj7', 'Dm7', ['E7sus', 2], ['E7', 2]), P('Am9', 'Bbmaj7', 'Am9', 'E7'), P('Dm9', 'Am9', 'Fmaj7s11', 'E7'), P(['Am9', 8], ['Fmaj7', 4], ['E7', 4])],
    sections: { full: 4, light: 2, breakdown: 2 }, entry: 'full',
    drums: ['wardenA', 'wardenB'], bass: ['pulse', 'roots', 'half'], arp: ['triplet', 'down8', 'sparse'], comp: ['whole', 'anticip'],
    levels: { pad: 1.1, keys: 0.6, bass: 1.15, drums: 1, arp: 0.8, lead: 0.8, tex: 1 },
    padWave: 'sawtooth', arpWave: 'sawtooth', leadProb: 0.35, scale: [69, 72, 74, 76, 79, 81], drone: true, darkBass: true,
  },
};

const BASE = { pad: 0.5, keys: 0.5, bass: 0.6, drums: 0.62, arp: 0.22, lead: 0.2, tex: 0.6 };

function weighted(obj) {
  const entries = Object.entries(obj);
  let sum = 0;
  for (const [, w] of entries) sum += w;
  let r = Math.random() * sum;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

export class Music {
  /** @param {import('./engine.js').Engine} eng */
  constructor(eng) {
    this.eng = eng;
    this.ctx = eng.ctx;
    this.mood = 'menu';
    this.pending = null;
    this.playing = false;
    this.scoring = false;
    this.timer = null;
    this._built = false;
  }

  _build() {
    if (this._built) return;
    this._built = true;
    const c = this.ctx;
    this.fade = c.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(this.eng.musicIn);
    this.bus = {};
    for (const k of Object.keys(BASE)) {
      const g = c.createGain();
      g.gain.value = BASE[k];
      g.connect(this.fade);
      this.bus[k] = g;
    }
    // pad "sidechain" pump
    this.pump = c.createGain();
    this.pump.connect(this.bus.pad);
    // hats a little to the right, shaker left
    this.hatPan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    if (this.hatPan.pan) this.hatPan.pan.value = 0.25;
    this.hatPan.connect(this.bus.drums);
    // reverb
    this.verb = c.createConvolver();
    this.verb.buffer = this.eng.ir;
    const vr = c.createGain();
    vr.gain.value = 0.45;
    this.verb.connect(vr);
    vr.connect(this.fade);
    // arp dotted-8th delay
    const d = c.createDelay(2);
    const fb = c.createGain();
    fb.gain.value = 0.35;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2200;
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.arpIn = c.createGain();
    this.arpIn.connect(this.bus.arp);
    this.arpIn.connect(d);
    d.connect(dl); dl.connect(fb); fb.connect(d); dl.connect(wet); wet.connect(this.bus.arp);
    this.arpDelay = d;
    const as = c.createGain(); as.gain.value = 0.3; this.arpIn.connect(as); as.connect(this.verb);
    // tape wow: slow LFO into oscillator detune
    this.wow = c.createOscillator();
    this.wow.frequency.value = 0.33;
    this.wowDepth = c.createGain();
    this.wowDepth.gain.value = 6;
    this.wow.connect(this.wowDepth);
    this.wow.start();
  }

  // ------------------------------------------------------------ public
  start() {
    this._build();
    const now = this.ctx.currentTime;
    clearTimeout(this._stopTimer);
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.setTargetAtTime(1, now, 0.6);
    if (this.playing) return;
    this.playing = true;
    if (this.pending) { this.mood = this.pending; this.pending = null; }
    const M = MOODS[this.mood];
    this.bpm = M.bpm;
    this._applyMood(now, true);
    this.step = 0;
    this.phraseCount = 0;
    this.next = now + 0.08;
    this._startVinyl(now);
    this._newPhrase(true);
    const offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
    if (!offline) {
      this.timer = setInterval(() => this._tick(), 25);
    }
  }

  stop() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.setTargetAtTime(0, now, 0.35);
    clearTimeout(this._stopTimer);
    this._stopTimer = setTimeout(() => {
      this.playing = false;
      clearInterval(this.timer);
      this.timer = null;
      this._stopVinyl();
    }, 1800);
  }

  setMood(m) {
    if (!MOODS[m]) return;
    if (!this.playing) { this.mood = m; this.pending = null; return; }
    if (m === this.mood) { this.pending = null; return; }
    this.pending = m;
  }

  scoringOpen(b) {
    this.scoring = !!b;
    const lp = this.eng.musicLP.frequency;
    const now = this.ctx.currentTime;
    lp.cancelScheduledValues(now);
    lp.setValueAtTime(lp.value, now);
    if (this.scoring) lp.setTargetAtTime(4000, now, 0.15);
    else lp.setTargetAtTime(MOODS[this.mood].closed, now, 0.6);
  }

  duck(db = -4, ms = 400) {
    const g = this.eng.musicDuck.gain;
    const now = this.ctx.currentTime;
    const target = Math.pow(10, -Math.abs(db) / 20);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(target, now, 0.02);
    g.setTargetAtTime(1, now + Math.max(0.05, ms / 1000), 0.25);
  }

  // ------------------------------------------------------------ scheduler
  _tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    // in background tabs timers run ~1/s: schedule further ahead there
    const hidden = typeof document !== 'undefined' && document.hidden;
    const ahead = hidden ? 1.6 : 0.1;
    if (this.next < now - 0.2) this.next = now + 0.05; // fell behind (suspended/throttled): skip, don't burst
    this.scheduleUntil(now + ahead);
  }

  /** Schedule all 16ths that start before `time` (also used for offline rendering). */
  scheduleUntil(time) {
    let guard = 0;
    while (this.next < time && guard++ < 256) {
      this._step(this.next);
      const sixteenth = 60 / this.bpm / 4;
      this.next += sixteenth;
      this.step++;
      if (this.step % 4 === 0) this.bpm += (MOODS[this.mood].bpm - this.bpm) * 0.3;
    }
  }

  _applyMood(t, instant) {
    const M = MOODS[this.mood];
    for (const k of Object.keys(BASE)) {
      const v = BASE[k] * (M.levels[k] == null ? 1 : M.levels[k]);
      if (instant) this.bus[k].gain.setValueAtTime(v, t);
      else this.bus[k].gain.setTargetAtTime(v, t, 0.8);
    }
    this.arpDelay.delayTime.setTargetAtTime((60 / M.bpm) * 0.75, t, 0.2);
    if (!this.scoring) this.eng.musicLP.frequency.setTargetAtTime(M.closed, t, instant ? 0.05 : 0.8);
  }

  _newPhrase(first) {
    const M = MOODS[this.mood];
    const avoid = this.ph && this.ph.progIdx;
    let progIdx = (Math.random() * M.progs.length) | 0;
    if (progIdx === avoid && Math.random() < 0.7) progIdx = (progIdx + 1) % M.progs.length;
    let section;
    if (first) section = this.phraseCount === 0 && !this._moodSwitched ? 'intro' : M.entry;
    else {
      section = weighted(M.sections);
      if (this.ph && this.ph.section === section && Math.random() < 0.5) section = weighted(M.sections);
      if (this.ph && this.ph.section === 'breakdown' && section === 'breakdown') section = 'full';
    }
    this._moodSwitched = false;
    const S = SECTIONS[section] || SECTIONS.full;
    const prog = M.progs[progIdx];
    const total = prog.reduce((a, c) => a + c[1], 0);
    this.ph = {
      progIdx, prog, total, section, S,
      drums: DR[pick(M.drums)],
      bass: BASS[S.bassPat || pick(M.bass)],
      arp: ARP[S.arpPat || pick(M.arp)],
      comp: COMP[pick(M.comp)],
      fill4: Math.random() < 0.45 ? pick(FILLS) : null,
      fill8: section === 'breakdown' ? null : pick(FILLS),
      lead: S.lead && Math.random() < M.leadProb ? this._motif(M) : null,
      arpOct: Math.random() < 0.5 ? 12 : 0,
      crash: !first && this.ph && this.ph.fill8,
    };
    this.phraseCount++;
    if (M.drone) this._drone(this.next, (60 / M.bpm) * 32);
  }

  _motif(M) {
    // 2-bar call + variation; notes on 8ths with on-beat bias
    const sc = M.scale;
    const ev = [];
    let pos = pick([0, 2, 4]);
    let idx = (Math.random() * 4) | 0;
    while (pos < 28) {
      const len = pick([2, 2, 4, 4, 6]);
      ev.push([pos, sc[idx], len]);
      idx = clamp(idx + pick([-2, -1, -1, 1, 1, 2]), 0, sc.length - 1);
      pos += len + pick([0, 0, 2, 4]);
    }
    // answer phrase: same rhythm, last note resolves to the tonic or the third of the scale
    const answer = ev.map(([p, n, l], i) => [p, i === ev.length - 1 ? sc[Math.random() < 0.5 ? 0 : 2] : n, l]);
    return { a: ev, b: answer, oct: Math.random() < 0.3 ? -12 : 0 };
  }

  _chordAt(beat) {
    const ph = this.ph;
    let b = beat % ph.total;
    for (const [name, beats] of ph.prog) {
      if (b < beats) return { name, start: b === 0 || false, remain: beats - b, c: CHORDS[name] };
      b -= beats;
    }
    return { name: ph.prog[0][0], remain: 4, c: CHORDS[ph.prog[0][0]] };
  }

  _step(t0) {
    let s = this.step;
    const inBar = s % 16;
    if (inBar === 0 && this.pending) {
      this.mood = this.pending;
      this.pending = null;
      this._moodSwitched = true;
      this._applyMood(t0, false);
      this.step = s = 0;
      this._newPhrase(true);
    } else if (s % 128 === 0 && s > 0) {
      this._newPhrase(false);
    }
    const M = MOODS[this.mood];
    const ph = this.ph;
    const S = ph.S;
    const bar = Math.floor((s % 128) / 16);
    const sixteenth = 60 / this.bpm / 4;
    const t = t0 + (s % 2 ? (M.swing * 2 - 1) * sixteenth : 0);
    const on = (layer) => S[layer] > 0 && !(S.enter && S.enter[layer] > bar);
    const beatF = (s % 128) / 4;
    const ch = this._chordAt(Math.floor(beatF));
    const beatStart = s % 4 === 0;
    const chordStart = beatStart && this._isChordStart(Math.floor(beatF));

    // ---- harmony
    if (chordStart) {
      const dur = ch.remain * 4 * sixteenth;
      if (on('pad')) this._pad(t, ch.c[1], dur, S.pad, M);
    }
    if (on('keys')) {
      for (const [st, len, v] of ph.comp) {
        if (st === inBar) {
          const c2 = st === 14 ? this._chordAt(Math.floor(beatF) + 1).c : ch.c; // anticipation
          this._keys(t, c2[1], len * sixteenth, v * S.keys);
        }
      }
    }
    if (on('bass')) {
      for (const [st, off, len, v] of ph.bass) {
        if (st === inBar) {
          let n = ch.c[0] + off;
          if (n > 52) n -= 12;
          this._bass(t, n, len * sixteenth, v * S.bass, M);
        }
      }
    }
    if (on('arp')) {
      const idx = ph.arp[inBar];
      if (idx != null && !(bar === 7 && inBar >= 12)) {
        const v = ch.c[1];
        const ladder = [...v, ...v.map((x) => x + 12)];
        this._arp(t, ladder[idx % ladder.length] + ph.arpOct, S.arp * rand(0.75, 1), M);
      }
    }
    if (ph.lead && on('lead')) {
      const pos = (bar % 4) * 16 + inBar; // 0..63 inside a 4-bar half
      const half = bar >= 4 ? ph.lead.b : ph.lead.a;
      const p2 = pos % 32;
      const useVar = pos >= 32; // bars 2-3 of each half: echo higher/varied
      for (const [p, n, l] of half) {
        if (p === p2 && !(useVar && Math.random() < 0.3)) {
          this._lead(t, n + ph.lead.oct + (useVar && Math.random() < 0.25 ? 12 : 0), l * sixteenth);
        }
      }
    }
    if (M.chimes && inBar === 0 && bar % 2 === 1 && Math.random() < 0.35) {
      this._chime(t + sixteenth * pick([0, 2, 6]), pick(M.scale) + 12);
    }

    // ---- drums
    const dr = ph.drums;
    const isFill = (bar === 7 && ph.fill8 && inBar >= ph.fill8.from) || (bar === 3 && ph.fill4 && inBar >= ph.fill4.from);
    const fill = bar === 7 ? ph.fill8 : ph.fill4;
    const hum = () => t + Math.random() * 0.006;
    if (on('kick')) {
      const kv = vel(((isFill && fill.k) || dr.k)[inBar] || '.');
      if (kv) this._kick(hum(), kv * Math.min(1, S.kick + 0.2), S.kick < 1 && inBar !== 0 ? 0 : 1);
    }
    if (on('snare')) {
      const src = isFill && fill.s ? fill.s : dr.s;
      if (src) { const sv = vel(src[inBar]); if (sv) this._snare(hum(), sv); }
      if (dr.r) { const rv = vel(dr.r[inBar]); if (rv && !isFill) this._rim(hum(), rv); }
      if (isFill && fill.t) { const tv = vel(fill.t[inBar]); if (tv) this._tom(hum(), tv, 140 - inBar * 4); }
      if (dr.t) { const tv = vel(dr.t[inBar]); if (tv) this._tom(hum(), tv, 90); }
    } else if (dr.r && on('hats')) {
      const rv = vel(dr.r[inBar]);
      if (rv) this._rim(hum(), rv * 0.7);
    }
    if (on('hats') && !(isFill && fill.noHat)) {
      const hv = vel(dr.h[inBar]);
      if (hv) this._hat(hum(), hv * rand(0.8, 1), false);
      const oh = (isFill && fill.oh) || dr.oh;
      if (oh && vel(oh[inBar])) this._hat(hum(), 0.8, true);
      if (dr.sh) { const shv = vel(dr.sh[inBar]); if (shv) this._shaker(hum(), shv); }
    }
    if (ph.crash && s % 128 === 0 && on('kick')) this._crash(t);

    // ---- texture
    if (Math.random() < 0.45) this._crackle(t + Math.random() * sixteenth);
  }

  _isChordStart(beat) {
    let b = beat % this.ph.total;
    if (b === 0) return true;
    for (const [, beats] of this.ph.prog) {
      b -= beats;
      if (b === 0) return true;
      if (b < 0) return false;
    }
    return false;
  }

  // ------------------------------------------------------------ instruments
  _osc(type, f, t0, t1, dest, wow) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (wow) {
      this.wowDepth.connect(o.detune);
      o.onended = () => { try { this.wowDepth.disconnect(o.detune); } catch { /* */ } };
    }
    o.connect(dest);
    o.start(t0);
    o.stop(t1);
    return o;
  }

  _env(t, a, peak, h, r, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r);
    g.gain.setValueAtTime(0, t + a + h + r + 0.001);
    g.connect(dest);
    return g;
  }

  _noise(t, dur, color = 'white') {
    const s = this.ctx.createBufferSource();
    s.buffer = color === 'pink' ? this.eng.pink : this.eng.white;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur);
    return s;
  }

  _filter(type, f, Q, dest) {
    const fl = this.ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = Q;
    fl.connect(dest);
    return fl;
  }

  _pad(t, notes, dur, lvl, M) {
    const a = Math.min(0.8, dur * 0.3);
    const r = 1.5;
    const h = Math.max(0.05, dur - a + 0.1);
    const lp = this._filter('lowpass', M.drone ? 650 : 900, 1, this.pump);
    lp.frequency.setValueAtTime(lp.frequency.value * 0.8, t);
    lp.frequency.linearRampToValueAtTime(lp.frequency.value * 1.25, t + dur * 0.6);
    const g = this._env(t, a, 1, h, r, lp);
    const send = this.ctx.createGain();
    send.gain.value = 0.35;
    g.connect(send);
    send.connect(this.verb);
    const pk = (M.padWave === 'sawtooth' ? 0.042 : 0.07) * lvl;
    for (const n of notes) {
      const f = mtof(n);
      for (const det of [-6, 6]) {
        const vg = this.ctx.createGain();
        vg.gain.value = pk;
        vg.connect(g);
        const o = this._osc(M.padWave, f, t, t + a + h + r + 0.05, vg, true);
        o.detune.value = det;
      }
    }
  }

  _keys(t, notes, dur, v) {
    // e-piano: sine fundamental + quickly decaying 2nd/7th partials (tine), short strum
    const d = clamp(dur + 0.4, 0.3, 2.4);
    notes.forEach((n, i) => {
      const tt = t + i * 0.009;
      const f = mtof(n + 12);
      const pk = 0.085 * v * (i === 0 ? 1 : 0.85);
      const g = this._env(tt, 0.006, pk, 0, d, this.bus.keys);
      this._osc('sine', f, tt, tt + d + 0.1, g, true);
      const g2 = this._env(tt, 0.003, pk * 0.35, 0, 0.25, this.bus.keys);
      this._osc('sine', f * 2, tt, tt + 0.35, g2, true);
      const g3 = this._env(tt, 0.001, pk * 0.12, 0, 0.06, this.bus.keys);
      this._osc('sine', f * 7.1, tt, tt + 0.1, g3);
      if (i === 0) {
        const s = this.ctx.createGain(); s.gain.value = 0.25; g.connect(s); s.connect(this.verb);
      }
    });
  }

  _bass(t, n, dur, v, M) {
    const f = mtof(n);
    const r = 0.09;
    const h = Math.max(0.02, dur * 0.85 - 0.01);
    const lp = this._filter('lowpass', M.darkBass ? 420 : 650, M.darkBass ? 4 : 1, this.bus.bass);
    lp.frequency.setValueAtTime(lp.frequency.value * 1.6, t);
    lp.frequency.exponentialRampToValueAtTime(lp.frequency.value, t + 0.12);
    const g = this._env(t, 0.008, 0.42 * v, h, r, lp);
    this._osc(M.darkBass ? 'sawtooth' : 'triangle', f, t, t + h + r + 0.05, g);
    const gs = this._env(t, 0.008, 0.3 * v, h, r, this.bus.bass);
    this._osc('sine', f, t, t + h + r + 0.05, gs);
  }

  _arp(t, n, v, M) {
    const f = mtof(n + 12);
    const lp = this._filter('lowpass', 2600, 2, this.arpIn);
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    const g = this._env(t, 0.003, (M.arpWave === 'triangle' ? 0.16 : 0.09) * v, 0, 0.22, lp);
    this._osc(M.arpWave, f, t, t + 0.3, g, true);
  }

  _lead(t, n, dur) {
    const f = mtof(n);
    const h = Math.max(0.05, dur * 0.7);
    const g = this._env(t, 0.03, 0.12, h, 0.3, this.bus.lead);
    const s = this.ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.verb);
    const o1 = this._osc('triangle', f, t, t + h + 0.4, g, true);
    const g2 = this.ctx.createGain(); g2.gain.value = 0.5; g2.connect(g);
    const o2 = this._osc('sine', f * 2, t, t + h + 0.4, g2);
    // delayed vibrato
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const ld = this.ctx.createGain();
    ld.gain.setValueAtTime(0, t);
    ld.gain.linearRampToValueAtTime(12, t + Math.min(0.4, h));
    lfo.connect(ld); ld.connect(o1.detune); ld.connect(o2.detune);
    lfo.start(t); lfo.stop(t + h + 0.4);
  }

  _chime(t, n) {
    const f = mtof(n);
    const g = this._env(t, 0.002, 0.05, 0, 1.6, this.bus.lead);
    const s = this.ctx.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(this.verb);
    this._osc('sine', f, t, t + 1.7, g);
    const g2 = this._env(t, 0.001, 0.015, 0, 0.5, this.bus.lead);
    this._osc('sine', f * 2.76, t, t + 0.6, g2);
  }

  _drone(t, dur) {
    const lp = this._filter('lowpass', 220, 2, this.bus.pad);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = this.ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg); lg.connect(lp.frequency);
    lfo.start(t); lfo.stop(t + dur + 2.5);
    const g = this._env(t, 2, 0.07, Math.max(0.1, dur - 2), 2.2, lp);
    for (const [f, det] of [[55, -5], [55, 5], [82.41, 0]]) {
      const o = this._osc('sawtooth', f, t, t + dur + 2.5, g);
      o.detune.value = det;
    }
  }

  _kick(t, v, pump) {
    const g = this._env(t, 0.002, 0.95 * v, 0, 0.32, this.bus.drums);
    const o = this._osc('sine', 150, t, t + 0.4, g);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const lp = this._filter('lowpass', 3000, 0.7, this.bus.drums);
    const cg = this._env(t, 0.0005, 0.18 * v, 0, 0.012, lp);
    this._noise(t, 0.03).connect(cg);
    if (pump) {
      const p = this.pump.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(1, t);
      p.linearRampToValueAtTime(0.6, t + 0.015);
      p.setTargetAtTime(1, t + 0.03, 0.12);
    }
  }

  _snare(t, v) {
    const lp = this._filter('lowpass', 6000, 0.7, this.bus.drums);
    const bp = this._filter('bandpass', 1800, 0.8, lp);
    const g = this._env(t, 0.001, 0.42 * v, 0, 0.16, bp);
    this._noise(t, 0.2).connect(g);
    const tg = this._env(t, 0.001, 0.28 * v, 0, 0.09, lp);
    const o = this._osc('triangle', 180, t, t + 0.12, tg);
    o.frequency.exponentialRampToValueAtTime(155, t + 0.08);
    if (v > 0.5) { const s = this.ctx.createGain(); s.gain.value = 0.3; lp.connect(s); s.connect(this.verb); }
  }

  _rim(t, v) {
    const bp = this._filter('bandpass', 2500, 4, this.bus.drums);
    const g = this._env(t, 0.0005, 0.35 * v, 0, 0.018, bp);
    this._noise(t, 0.03).connect(g);
    const tg = this._env(t, 0.0008, 0.18 * v, 0, 0.035, this.bus.drums);
    this._osc('sine', 1650, t, t + 0.05, tg);
  }

  _hat(t, v, open) {
    const hp = this._filter('highpass', 7000, 0.7, this.hatPan);
    const d = open ? 0.18 : 0.03;
    const g = this._env(t, 0.001, 0.2 * v, 0, d, hp);
    this._noise(t, d + 0.03).connect(g);
  }

  _shaker(t, v) {
    const bp = this._filter('bandpass', 6000, 1, this.bus.drums);
    const g = this._env(t, 0.012, 0.07 * v, 0, 0.04, bp);
    this._noise(t, 0.08).connect(g);
  }

  _tom(t, v, f) {
    const g = this._env(t, 0.002, 0.45 * v, 0, 0.22, this.bus.drums);
    const o = this._osc('sine', f, t, t + 0.3, g);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
  }

  _crash(t) {
    const hp = this._filter('highpass', 5000, 0.7, this.bus.drums);
    const g = this._env(t, 0.002, 0.09, 0, 1.4, hp);
    this._noise(t, 1.5).connect(g);
    const s = this.ctx.createGain(); s.gain.value = 0.4; hp.connect(s); s.connect(this.verb);
  }

  _crackle(t) {
    const hp = this._filter('highpass', rand(1200, 3500), 0.7, this.bus.tex);
    const g = this._env(t, 0.0003, rand(0.02, 0.09) * (Math.random() < 0.1 ? 2 : 1), 0, rand(0.002, 0.006), hp);
    this._noise(t, 0.012).connect(g);
  }

  _startVinyl(t) {
    this._stopVinyl();
    const s = this.ctx.createBufferSource();
    s.buffer = this.eng.pink;
    s.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    const g = this.ctx.createGain(); g.gain.value = 0.02;
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.bus.tex);
    s.start(t);
    this.vinyl = { s, g };
  }

  _stopVinyl() {
    if (!this.vinyl) return;
    try { this.vinyl.s.stop(); } catch { /* */ }
    try { this.vinyl.g.disconnect(); } catch { /* */ }
    this.vinyl = null;
  }
}

export const MOOD_NAMES = Object.keys(MOODS);
