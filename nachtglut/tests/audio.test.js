// Audio module: Node-side safety + registry checks (the actual sound is verified in a browser, see tools/audio-test.html).
import test from 'node:test';
import assert from 'node:assert/strict';

const REQUIRED_SFX = [
  'shoot_fire', 'shoot_frost', 'shoot_shock', 'shoot_poison', 'shoot_shadow', 'shoot_phys', 'shoot_light',
  'dash', 'skill', 'player_hit', 'player_heal', 'player_shield', 'player_death', 'levelup', 'revive', 'fall', 'footstep',
  'weapon_swap', 'weapon_gain', 'weapon_upgrade',
  'enemy_hit', 'enemy_crit', 'enemy_death', 'elite_death', 'enemy_spawn', 'enemy_shoot', 'enemy_melee', 'enemy_charge',
  'enemy_slam', 'enemy_cast', 'enemy_summon', 'enemy_beam', 'enemy_teleport', 'telegraph', 'explosion',
  'status_burn', 'status_freeze', 'status_poison', 'status_shock',
  'boss_intro', 'boss_phase', 'boss_death',
  'door_open', 'door_close', 'room_clear', 'pickup_spark', 'pickup_xp', 'pickup_heart', 'pickup_ash', 'chest_open',
  'barrel_break', 'fountain', 'forge', 'shrine', 'portal', 'relic_gain', 'boon_gain', 'curse_gain', 'shop_buy', 'shop_fail',
  'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_confirm', 'ui_deny', 'toast', 'achievement', 'banner',
];
const REQUIRED_TRACKS = ['menu', 'ash', 'fungal', 'frost', 'void', 'core', 'boss', 'final', 'victory', 'death'];

test('importing the audio modules in Node does not throw or touch the DOM', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const mod = await import('../src/audio/audio.js');
  assert.ok(mod.audio);
  await import('../src/audio/sfx.js');
  await import('../src/audio/music.js');
  await import('../src/audio/mixer.js');
  await import('../src/audio/synth.js');
  await import('../src/audio/offline.js');
});

test('API surface matches the contract', async () => {
  const { audio } = await import('../src/audio/audio.js');
  for (const fn of ['init', 'setVolumes', 'play', 'bindEvents', 'suspend', 'resume']) assert.equal(typeof audio[fn], 'function', fn);
  assert.equal(typeof audio.music.play, 'function');
  assert.equal(typeof audio.music.setIntensity, 'function');
  assert.equal(audio.ready, false);
});

test('every call before init is a silent no-op', async () => {
  const { audio } = await import('../src/audio/audio.js');
  assert.doesNotThrow(() => audio.play('x'));
  assert.doesNotThrow(() => audio.play('shoot_fire', { volume: 2, pitch: NaN, pan: 5 }));
  assert.doesNotThrow(() => audio.play());
  assert.equal(audio.play('enemy_hit'), false);
  assert.doesNotThrow(() => audio.music.play('ash'));
  assert.doesNotThrow(() => audio.music.play('nope'));
  assert.doesNotThrow(() => audio.music.setIntensity(0.7));
  assert.doesNotThrow(() => audio.music.setIntensity('garbage'));
  assert.doesNotThrow(() => audio.setVolumes({ master: 0.5, music: 0.3, sfx: 0.9 }));
  assert.doesNotThrow(() => audio.setVolumes(undefined));
  assert.doesNotThrow(() => audio.suspend());
  assert.doesNotThrow(() => audio.resume());
  // init in Node: no window -> returns false, no throw
  assert.equal(audio.init(), false);
  assert.equal(audio.ready, false);
});

test('bindEvents tolerates an empty game and missing payload fields', async () => {
  const { audio } = await import('../src/audio/audio.js');
  const { Bus } = await import('../src/core/events.js');
  const bus = new Bus();
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    let unbind;
    assert.doesNotThrow(() => { unbind = audio.bindEvents(bus, {}); });
    assert.doesNotThrow(() => audio.bindEvents(bus, undefined));
    assert.doesNotThrow(() => audio.bindEvents(null, {}));
    unbind = audio.bindEvents(bus, { save: { settings: { master: 0.4, music: 0.2, sfx: 0.8 } } });
    const events = [
      'state:change', 'run:start', 'run:end', 'floor:enter', 'room:enter', 'room:lock', 'room:clear', 'wave:spawn',
      'player:hit', 'player:heal', 'player:shield', 'player:dash', 'player:skill', 'player:levelup', 'player:death',
      'player:revive', 'player:status', 'player:fall', 'weapon:fire', 'weapon:swap', 'weapon:gain', 'weapon:upgrade',
      'enemy:spawn', 'enemy:hit', 'enemy:death', 'enemy:attack', 'enemy:telegraph', 'boss:start', 'boss:phase', 'boss:death',
      'explosion', 'status:apply', 'pickup:collect', 'relic:gain', 'boon:gain', 'curse:gain', 'prop:open', 'shop:buy',
      'shop:fail', 'portal:enter', 'door:open', 'door:close', 'ui:choice', 'ui:toast', 'ui:banner', 'ui:click', 'ui:hover',
      'ui:open', 'ui:close', 'ui:confirm', 'ui:deny', 'meta:change', 'achievement:unlock', 'settings:change',
    ];
    for (const e of events) {
      bus.emit(e, undefined);
      bus.emit(e, {});
      bus.emit(e, null);
    }
    bus.emit('state:change', { from: 'menu', to: 'paused' });
    bus.emit('floor:enter', { biome: { id: 'frost', music: 'frost' } });
    bus.emit('boss:start', { boss: { def: { id: 'boss_sun' } } });
    bus.emit('weapon:fire', { id: 'ember_bolt', type: 'nonsense' });
    bus.emit('settings:change', { settings: { master: 'loud' } });
    bus.emit('pickup:collect', { kind: 'spark', amount: 3 });
    assert.equal(typeof unbind, 'function');
    unbind();
  } finally {
    console.error = origError;
  }
  assert.deepEqual(errors, []);
});

test('SFX registry contains every required name, each a playable patch', async () => {
  const { SFX_NAMES, SFX } = await import('../src/audio/sfx.js');
  const { SFX_NAMES: reexported } = await import('../src/audio/audio.js');
  assert.deepEqual([...reexported], [...SFX_NAMES]);
  for (const n of REQUIRED_SFX) {
    assert.ok(SFX_NAMES.includes(n), `missing sfx ${n}`);
    assert.equal(typeof SFX[n].fn, 'function');
    assert.ok(SFX[n].g > 0 && SFX[n].g <= 1, `${n} gain`);
  }
});

test('MUSIC_TRACKS contains all 10 track ids', async () => {
  const { MUSIC_TRACKS, TRACKS } = await import('../src/audio/music.js');
  const { MUSIC_TRACKS: reexported } = await import('../src/audio/audio.js');
  assert.deepEqual([...reexported], [...MUSIC_TRACKS]);
  for (const id of REQUIRED_TRACKS) {
    assert.ok(MUSIC_TRACKS.includes(id), `missing track ${id}`);
    assert.equal(typeof TRACKS[id].play, 'function');
    assert.ok(TRACKS[id].bpm > 30 && TRACKS[id].bpm < 200);
  }
  assert.equal(MUSIC_TRACKS.length, 10);
});

test('every biome music id has a track', async () => {
  const { BIOMES } = await import('../src/data/biomes.js');
  const { MUSIC_TRACKS } = await import('../src/audio/music.js');
  for (const b of Object.values(BIOMES)) assert.ok(MUSIC_TRACKS.includes(b.music), b.id);
});

test('music engine schedules deterministically against a fake context', async () => {
  // A minimal fake AudioContext that records node creation: proves the scheduler runs headless and stays light.
  const { MusicEngine, MUSIC_TRACKS } = await import('../src/audio/music.js');
  const param = () => ({
    value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
    setTargetAtTime() {}, cancelScheduledValues() {}, cancelAndHoldAtTime() {},
  });
  const mk = (counter) => () => {
    counter.n++;
    return {
      gain: param(), frequency: param(), detune: param(), Q: param(), pan: param(), type: '', buffer: null, loop: false, curve: null,
      connect() {}, disconnect() {}, start() {}, stop() {}, onended: null,
    };
  };
  for (const id of MUSIC_TRACKS) {
    const counter = { n: 0 };
    const node = mk(counter);
    const ctx = {
      currentTime: 0, sampleRate: 44100,
      createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node, createStereoPanner: node,
      createWaveShaper: node, createDynamicsCompressor: node, createConvolver: node,
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    };
    const eng = new MusicEngine(ctx, node(), node(), { offline: true });
    for (const intensity of [0, 1]) {
      counter.n = 0;
      eng.setIntensity(intensity, true);
      eng.play(id, { fade: 0.01, restart: true });
      const before = counter.n;
      ctx.currentTime += 0; // offline: drive directly
      eng.scheduleUntil(ctx.currentTime + 30);
      const perSecond = (counter.n - before) / 30;
      assert.ok(counter.n - before > 0, `${id} produced no notes`);
      assert.ok(perSecond < 130, `${id} @${intensity}: ${perSecond.toFixed(0)} nodes/s is too heavy`);
      ctx.currentTime += 31;
    }
    eng.dispose();
  }
});
