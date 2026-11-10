// Mixer graph, shared by the live engine (audio.js) and the offline verification renderer (offline.js):
//
//   sfx voices ──► sfxBus ───────────────┐
//        └─send─► sfxWet ──┐              │
//   music ─────► musicBus ─┼──────────────┼──► master ──► compressor (gentle limiter) ──► soft clip ──► destination
//        └─send─► musicWet ┴─► convolver ─► reverb return ┘
//
// Slider values (0..1) map to gain with a squared (perceptual) curve. musicBus/musicWet also carry the pause duck.

import { impulseResponse, softClipCurve } from './synth.js';

export const MIX = Object.freeze({
  master: 0.85,   // headroom into the limiter
  sfx: 1.0,
  music: 0.5,     // music sits under the sound effects
  reverb: 0.55,   // reverb return level
});

const curve = (v) => {
  v = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  return v * v;
};

/**
 * @param {BaseAudioContext} ctx
 * @param {{limiter?: boolean, reverb?: boolean}} [opts]
 */
export function buildMixer(ctx, opts = {}) {
  const limiter = opts.limiter !== false;
  const master = ctx.createGain();
  const sfx = ctx.createGain();
  const music = ctx.createGain();
  const sfxWet = ctx.createGain();
  const musicWet = ctx.createGain();
  sfx.connect(master);
  music.connect(master);

  let conv = null, revReturn = null, revTone = null;
  if (opts.reverb !== false) {
    conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = impulseResponse(ctx);
    revTone = ctx.createBiquadFilter();
    revTone.type = 'lowpass';
    revTone.frequency.value = 5200;
    revReturn = ctx.createGain();
    revReturn.gain.value = MIX.reverb;
    sfxWet.connect(conv);
    musicWet.connect(conv);
    conv.connect(revTone); revTone.connect(revReturn); revReturn.connect(master);
  }

  let comp = null, clip = null;
  if (limiter) {
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -9;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    master.connect(comp); comp.connect(clip); clip.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }

  const vol = { master: 1, music: 1, sfx: 1, duck: 1 };
  const mixer = {
    ctx, master, sfx, music, sfxWet, musicWet, comp, clip, conv,
    vol,
    /** Apply volumes. smooth: seconds for the ramp (0 = immediate). */
    apply(smooth = 0.04) {
      const now = ctx.currentTime;
      const set = (param, v) => {
        if (smooth > 0) { param.cancelScheduledValues(now); param.setTargetAtTime(v, now, smooth); } else param.setValueAtTime(v, now);
      };
      set(master.gain, curve(vol.master) * MIX.master);
      set(sfx.gain, curve(vol.sfx) * MIX.sfx);
      set(sfxWet.gain, curve(vol.sfx));
      const m = curve(vol.music) * MIX.music * vol.duck;
      set(music.gain, m);
      set(musicWet.gain, m);
    },
    disconnect() {
      for (const n of [master, sfx, music, sfxWet, musicWet, conv, revTone, revReturn, comp, clip]) {
        if (n) { try { n.disconnect(); } catch (_) { /* gone */ } }
      }
    },
  };
  mixer.apply(0);
  return mixer;
}
