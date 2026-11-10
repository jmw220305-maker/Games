// Audio entry point (see docs/ARCHITECTURE.md §10). All sound is synthesized at runtime: sfx.js holds the
// effect patches, music.js the generative music engine, mixer.js the bus graph.
// Import-safe in Node: no window / AudioContext access until init(). Before init every call is a silent no-op.

import { SFX, SFX_NAMES, startSfx, DEFAULT_GAP, DEFAULT_VARY } from './sfx.js';
import { MusicEngine, MUSIC_TRACKS } from './music.js';
import { buildMixer } from './mixer.js';

export { SFX_NAMES, MUSIC_TRACKS };

const MAX_VOICES = 24;
const MAX_SAME = 4;          // simultaneous voices of one sound
const PAUSE_DUCK = 0.5;
const COMBO_WINDOW = 0.6;    // s between pickups to keep the pitch combo going
const COMBO_SEMIS = [0, 2, 4, 5, 7, 9, 11, 12];

let ctx = null;
let mix = null;
let engine = null;
let voices = [];
const lastPlay = new Map();
const volumes = { master: 1, music: 1, sfx: 1 };
const st = {
  pendingTrack: null,
  intensity: 0,
  duck: 1,
  hidden: false,
  userSuspended: false,
  warned: false,
  biomeTrack: null,
  lastBossDeath: -10,
  lastHeal: -10,
  combo: { spark: { n: -1, t: -10 }, xp: { n: -1, t: -10 } },
  unbind: null,
};

function warnOnce(msg, err) {
  if (st.warned) return;
  st.warned = true;
  try { console.warn(`[audio] ${msg}`, err); } catch (_) { /* no console */ }
}

function now() {
  if (ctx) return ctx.currentTime;
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function syncRunning() {
  if (!ctx) return;
  const shouldRun = !st.hidden && !st.userSuspended;
  try {
    if (shouldRun) {
      if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
      if (engine) engine.resume();
    } else {
      if (engine) engine.pause();
      if (ctx.state === 'running') ctx.suspend().catch(() => {});
    }
  } catch (err) { warnOnce('state change failed', err); }
}

function create() {
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AC) return false;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch (_) {
    try { ctx = new AC(); } catch (err) { warnOnce('AudioContext unavailable', err); ctx = null; return false; }
  }
  mix = buildMixer(ctx);
  Object.assign(mix.vol, volumes, { duck: st.duck });
  mix.apply(0);
  engine = new MusicEngine(ctx, mix.music, mix.musicWet);
  engine.silent = volumes.music <= 0 || volumes.master <= 0;
  engine.setIntensity(st.intensity, true);
  // iOS unlock: play one silent sample inside the gesture
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (_) { /* ignore */ }
  if (typeof document !== 'undefined' && document.addEventListener) {
    st.hidden = !!document.hidden;
    document.addEventListener('visibilitychange', () => { st.hidden = !!document.hidden; syncRunning(); });
  }
  if (st.pendingTrack) engine.play(st.pendingTrack, { fade: 1.2 });
  return true;
}

function pruneVoices(t) {
  if (!voices.length) return;
  voices = voices.filter((v) => !v.done && v.end > t);
}

function play(name, opts) {
  try {
    if (!ctx || !mix || ctx.state !== 'running') return false;
    const def = SFX[name];
    if (!def) return false;
    if (volumes.sfx <= 0 || volumes.master <= 0) return false;
    const t = ctx.currentTime;
    const gap = Math.max(DEFAULT_GAP, def.gap ?? 0);
    const last = lastPlay.get(name);
    if (last !== undefined && t - last < gap) return false;
    pruneVoices(t);
    const prio = def.prio ?? 1;
    // per-sound cap: retire the oldest instance of the same sound
    let same = 0, oldestSame = null;
    for (const v of voices) if (v.name === name) { same++; if (!oldestSame || v.start < oldestSame.start) oldestSame = v; }
    if (same >= (def.max ?? MAX_SAME) && oldestSame) {
      oldestSame.stop(t);
      voices.splice(voices.indexOf(oldestSame), 1);
    }
    // global cap: steal the least important, oldest voice — never a more important one
    if (voices.length >= MAX_VOICES) {
      let victim = null;
      for (const v of voices) {
        if (v.prio > prio) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
      }
      if (!victim) return false;
      victim.stop(t);
      voices.splice(voices.indexOf(victim), 1);
    }
    const o = opts || {};
    const vary = def.vary ?? DEFAULT_VARY;
    const pitch = (Number.isFinite(o.pitch) ? o.pitch : 1) * (1 + (Math.random() * 2 - 1) * vary);
    const v = startSfx(ctx, mix.sfx, mix.sfxWet, name, t + 0.004, {
      volume: Number.isFinite(o.volume) ? o.volume : 1,
      pitch,
      pan: Number.isFinite(o.pan) ? o.pan : 0,
    });
    if (!v) return false;
    voices.push(v);
    lastPlay.set(name, t);
    return true;
  } catch (err) {
    warnOnce(`play(${name}) failed`, err);
    return false;
  }
}

function setVolumes(v) {
  if (!v || typeof v !== 'object') return;
  for (const k of ['master', 'music', 'sfx']) {
    let x = v[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    if (x > 1.001) x /= 100; // tolerate percent values
    volumes[k] = Math.max(0, Math.min(1, x));
  }
  if (mix) {
    Object.assign(mix.vol, volumes);
    mix.apply();
  }
  if (engine) engine.silent = volumes.music <= 0 || volumes.master <= 0;
}

function setDuck(d) {
  st.duck = d;
  if (mix) { mix.vol.duck = d; mix.apply(0.25); }
}

const music = {
  /** Crossfade to a track id (see MUSIC_TRACKS). Before init the request is remembered and starts on init. */
  play(trackId) {
    try {
      if (!MUSIC_TRACKS.includes(trackId)) return false;
      st.pendingTrack = trackId;
      if (!engine) return false;
      return engine.play(trackId);
    } catch (err) { warnOnce('music.play failed', err); return false; }
  },
  /** 0 = calm exploration, 1 = full combat layers (~0.8 s ramps). */
  setIntensity(x) {
    try {
      st.intensity = Math.max(0, Math.min(1, +x || 0));
      if (engine) engine.setIntensity(st.intensity);
    } catch (err) { warnOnce('music.setIntensity failed', err); }
  },
  stop(fade = 1.5) {
    st.pendingTrack = null;
    try { if (engine) engine.stop(fade); } catch (err) { warnOnce('music.stop failed', err); }
  },
  get track() { return engine ? engine.trackId : st.pendingTrack; },
  get intensity() { return st.intensity; },
  tracks: MUSIC_TRACKS,
};

const isElite = (x) => (Array.isArray(x) ? x.length > 0 : !!x);
const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);

const ATTACK_SFX = {
  shoot: 'enemy_shoot', melee: 'enemy_melee', charge: 'enemy_charge', slam: 'enemy_slam', cast: 'enemy_cast',
  explode: 'enemy_fuse', summon: 'enemy_summon', beam: 'enemy_beam', teleport: 'enemy_teleport',
};
const STATUS_SFX = {
  burn: 'status_burn', poison: 'status_poison', chill: 'status_freeze', freeze: 'status_freeze', shock: 'status_shock',
  mark: 'status_dark', weak: 'status_dark', slow: 'status_dark', stun: 'status_shock',
};
const PROP_SFX = {
  chest: 'chest_open', barrel: 'barrel_break', crystal: 'crystal_break', fountain: 'fountain', forge: 'forge',
  shrine: 'shrine', portal: 'portal',
};

function trackForBiome(biome) {
  if (!biome) return null;
  if (typeof biome === 'string') return MUSIC_TRACKS.includes(biome) ? biome : null;
  const id = biome.music || biome.id;
  return MUSIC_TRACKS.includes(id) ? id : null;
}

function comboPlay(name, kind) {
  const c = st.combo[kind];
  const t = now();
  const n = t - c.t <= COMBO_WINDOW ? Math.min(c.n + 1, COMBO_SEMIS.length - 1) : 0;
  if (play(name, { pitch: Math.pow(2, COMBO_SEMIS[n] / 12) })) { c.n = n; c.t = t; }
}

function bindEvents(bus, game) {
  if (st.unbind) st.unbind();
  if (!bus || typeof bus.on !== 'function') { st.unbind = null; return () => {}; }
  const unsubs = [];
  const on = (evt, fn) => {
    const off = bus.on(evt, (payload) => {
      try { fn(payload && typeof payload === 'object' ? payload : {}); } catch (err) { warnOnce(`handler ${evt} failed`, err); }
    });
    unsubs.push(typeof off === 'function' ? off : () => { try { bus.off(evt, fn); } catch (_) { /* ignore */ } });
  };
  const applySettings = (s) => { if (s && typeof s === 'object') setVolumes(s); };
  applySettings(game && (game.save && game.save.settings ? game.save.settings : game.settings));

  // --- music ------------------------------------------------------------------------------------
  on('state:change', ({ to, from }) => {
    if (to === 'menu') { music.setIntensity(0); music.play('menu'); }
    if (to === 'paused') setDuck(PAUSE_DUCK);
    else if (from === 'paused' || st.duck !== 1) setDuck(1);
  });
  on('floor:enter', (p) => {
    const tr = trackForBiome(p.biome) || trackForBiome(p.floor && p.floor.biome);
    if (tr) { st.biomeTrack = tr; music.setIntensity(0); music.play(tr); }
  });
  on('room:lock', () => music.setIntensity(1));
  on('room:clear', () => {
    music.setIntensity(0);
    if (now() - st.lastBossDeath > 3) play('room_clear');
  });
  on('boss:start', ({ boss }) => {
    const id = boss && ((boss.def && boss.def.id) || boss.id);
    play('boss_intro');
    music.play(id === 'boss_sun' ? 'final' : 'boss');
    music.setIntensity(1);
  });
  on('boss:phase', () => play('boss_phase'));
  on('boss:death', ({ boss }) => {
    st.lastBossDeath = now();
    play('boss_death');
    music.setIntensity(0);
    const id = boss && ((boss.def && boss.def.id) || boss.id);
    if (id === 'boss_sun') return; // run:end -> victory follows
    const tr = st.biomeTrack
      || trackForBiome(game && game.run && game.run.world && game.run.world.biome)
      || trackForBiome(game && game.run && game.run.floor && game.run.floor.biome);
    if (tr) music.play(tr);
  });
  on('run:end', ({ victory }) => { music.setIntensity(0); music.play(victory ? 'victory' : 'death'); });

  // --- settings ---------------------------------------------------------------------------------
  on('settings:change', ({ settings }) => applySettings(settings));
  on('meta:change', ({ save }) => applySettings(save && save.settings));

  // --- player -----------------------------------------------------------------------------------
  on('weapon:fire', ({ type }) => { if (!play(`shoot_${type}`)) { if (!SFX[`shoot_${type}`]) play('shoot_phys'); } });
  on('weapon:swap', () => play('weapon_swap'));
  on('weapon:gain', () => play('weapon_gain'));
  on('weapon:upgrade', () => play('weapon_upgrade'));
  on('player:hit', ({ amount, maxHp }) => {
    const frac = Number.isFinite(amount) && Number.isFinite(maxHp) && maxHp > 0 ? amount / maxHp : 0.1;
    play('player_hit', { volume: clampN(0.75 + frac * 2.5, 0.75, 1.3) });
  });
  on('player:heal', ({ amount }) => {
    if (Number.isFinite(amount) && amount < 1) return;
    const t = now();
    if (t - st.lastHeal < 0.5) return;
    if (play('player_heal')) st.lastHeal = t;
  });
  on('player:shield', () => play('player_shield'));
  on('player:dash', () => play('dash'));
  on('player:skill', () => play('skill'));
  on('player:levelup', () => play('levelup'));
  on('player:death', () => { play('player_death'); music.setIntensity(0); });
  on('player:revive', () => play('revive'));
  on('player:fall', () => play('fall'));
  on('player:status', ({ id }) => { if (STATUS_SFX[id]) play(STATUS_SFX[id], { volume: 0.6, pitch: 0.9 }); });

  // --- enemies ----------------------------------------------------------------------------------
  on('enemy:spawn', ({ enemy }) => { if (!(enemy && enemy.boss)) play('enemy_spawn'); });
  on('enemy:hit', ({ crit, killed, enemy }) => {
    if (killed) return; // the death sound carries the impact
    const boss = enemy && enemy.boss;
    play(crit ? 'enemy_crit' : 'enemy_hit', boss ? { pitch: 0.8, volume: 1.1 } : undefined);
  });
  on('enemy:death', ({ enemy, elite, boss }) => {
    if (boss || (enemy && enemy.boss)) return; // boss:death handles it
    if (isElite(elite) || isElite(enemy && enemy.elite)) play('elite_death');
    else play('enemy_death', { pitch: enemy && enemy.r > 9 ? 0.8 : 1 });
  });
  on('enemy:attack', ({ kind, enemy }) => {
    const name = ATTACK_SFX[kind];
    if (name) play(name, enemy && enemy.boss ? { volume: 1.4, pitch: 0.85 } : undefined);
  });
  on('enemy:telegraph', ({ enemy }) => play('telegraph', enemy && enemy.boss ? { pitch: 0.8, volume: 1.2 } : undefined));
  on('explosion', ({ radius, team }) => {
    const r = Number.isFinite(radius) ? radius : 40;
    play('explosion', {
      volume: clampN(r / 50, 0.5, 1.2) * (team === 'player' ? 0.85 : 1),
      pitch: clampN(1.25 - r / 160, 0.75, 1.2),
    });
  });
  on('status:apply', ({ id }) => { if (STATUS_SFX[id]) play(STATUS_SFX[id], { volume: id === 'freeze' ? 1.3 : 1 }); });

  // --- world ------------------------------------------------------------------------------------
  on('pickup:collect', ({ kind }) => {
    if (kind === 'spark') comboPlay('pickup_spark', 'spark');
    else if (kind === 'xp') comboPlay('pickup_xp', 'xp');
    else if (kind === 'heart') play('pickup_heart');
    else if (kind === 'ash') play('pickup_ash');
    else if (kind === 'shield') play('pickup_shield');
  });
  on('prop:open', ({ kind, prop }) => {
    const name = PROP_SFX[kind];
    if (!name) return;
    play(name, kind === 'chest' && prop && prop.tier === 'cursed' ? { pitch: 0.8 } : kind === 'chest' && prop && prop.tier === 'rare' ? { pitch: 1.12, volume: 1.15 } : undefined);
  });
  on('shop:buy', () => play('shop_buy'));
  on('shop:fail', () => play('shop_fail'));
  on('door:open', () => play('door_open'));
  on('door:close', () => play('door_close'));
  on('portal:enter', () => play('portal'));
  on('relic:gain', ({ def }) => play(def && def.rarity === 'curse' ? 'curse_gain' : 'relic_gain'));
  on('boon:gain', () => play('boon_gain'));
  on('curse:gain', () => play('curse_gain'));

  // --- UI ---------------------------------------------------------------------------------------
  for (const k of ['click', 'hover', 'open', 'close', 'confirm', 'deny']) on(`ui:${k}`, () => play(`ui_${k}`));
  on('ui:toast', ({ kind }) => {
    if (kind === 'achievement' || kind === 'unlock') play('achievement');
    else play('toast', kind === 'bad' ? { pitch: 0.75 } : kind === 'good' ? { pitch: 1.12 } : undefined);
  });
  on('achievement:unlock', () => play('achievement'));
  on('ui:banner', ({ kind }) => {
    if (kind === 'victory' || kind === 'death') return; // the music stinger carries these
    play('banner', kind === 'clear' ? { pitch: 1.19, volume: 0.8 } : undefined);
  });

  // Fallback unlock: the first gesture anywhere initialises/resumes the context (init is idempotent).
  let gestureOff = null;
  if (typeof window !== 'undefined' && window.addEventListener) {
    const unlock = () => { audio.init(); };
    const evts = ['pointerdown', 'keydown', 'touchend'];
    for (const e of evts) window.addEventListener(e, unlock, { capture: true, passive: true });
    gestureOff = () => { for (const e of evts) window.removeEventListener(e, unlock, { capture: true }); };
  }

  st.unbind = () => {
    for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
    if (gestureOff) gestureOff();
    st.unbind = null;
  };
  return st.unbind;
}

export const audio = {
  /** True once the AudioContext exists and is running. */
  get ready() { return !!ctx && ctx.state === 'running'; },

  /** Create (first call) and/or resume the AudioContext. Call from a user gesture. Safe to call repeatedly. */
  init() {
    try {
      if (!ctx && !create()) return false;
      if (ctx.state !== 'running' && !st.hidden && !st.userSuspended) ctx.resume().then(() => { if (engine) engine.resume(); }).catch(() => {});
      return true;
    } catch (err) { warnOnce('init failed', err); return false; }
  },

  setVolumes,
  play,
  music,
  bindEvents,

  /** Suspend all audio (e.g. tab hidden / app backgrounded). Stops the music scheduler. */
  suspend() { st.userSuspended = true; syncRunning(); },
  /** Resume after suspend(). */
  resume() { st.userSuspended = false; syncRunning(); },

  /** Debug info. */
  stats() {
    return {
      state: ctx ? ctx.state : 'uninitialised',
      voices: voices.length,
      track: music.track,
      intensity: st.intensity,
      volumes: { ...volumes },
      time: ctx ? ctx.currentTime : 0,
    };
  },

  get context() { return ctx; },
  sfxNames: SFX_NAMES,
};

export default audio;
