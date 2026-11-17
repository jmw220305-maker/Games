// Shell tests: render modules import without a DOM, Fx works headless, renderer tolerates a fake game.
import test from 'node:test';
import assert from 'node:assert/strict';

test('render modules import without DOM access', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const fx = await import('../src/render/fx.js');
  const lighting = await import('../src/render/lighting.js');
  const renderer = await import('../src/render/renderer.js');
  const menubg = await import('../src/render/menubg.js');
  assert.equal(typeof fx.Fx, 'function');
  assert.equal(typeof lighting.Lighting, 'function');
  assert.equal(typeof renderer.Renderer, 'function');
  assert.equal(typeof menubg.MenuBg, 'function');
  // cached sprite helpers return null without a DOM instead of throwing
  assert.equal(lighting.glowSprite('#ff8800'), null);
  assert.equal(lighting.lightSprite(), null);
});

test('Fx implements the world fx interface (same method set as NULL_FX)', async () => {
  const { Fx, FX_PRESETS } = await import('../src/render/fx.js');
  const { NULL_FX } = await import('../src/game/world.js');
  const fx = new Fx();
  for (const k of Object.keys(NULL_FX)) {
    if (typeof NULL_FX[k] === 'function') assert.equal(typeof fx[k], 'function', `missing fx.${k}`);
  }
  assert.equal(typeof fx.hitstopT, 'number');
  for (const m of ['burst', 'text', 'ring', 'beam', 'lightning', 'shake', 'flash', 'light', 'hitstop', 'update', 'clear']) {
    assert.equal(typeof fx[m], 'function', m);
  }
  for (const p of ['hit', 'spark', 'ember', 'smoke', 'blood', 'frost', 'poison', 'shock', 'shadow', 'light', 'dust', 'heal', 'explosion', 'death', 'spawn', 'gold']) {
    assert.ok(FX_PRESETS.includes(p), `preset ${p}`);
  }
});

test('Fx update/clear work without a canvas; caps and merging hold', async () => {
  const { Fx, FX_PRESETS } = await import('../src/render/fx.js');
  const settings = { shake: 1, flashes: true, damageNumbers: true, reducedMotion: false };
  const fx = new Fx(() => settings);
  for (const p of FX_PRESETS) fx.burst(p, 10, 20, { color: '#ff8800', count: 30 });
  fx.burst('nope', 0, 0); // unknown preset falls back
  fx.burst('spark', NaN, 0); // ignored
  for (let i = 0; i < 100; i++) fx.burst('explosion', i, i, { count: 80 });
  fx.update(1 / 60);
  assert.ok(fx.stats().particles <= 700, 'particle cap');
  // damage numbers merge on nearly the same spot
  fx.text(100, 100, '5', '#fff', { damage: true });
  fx.text(102, 101, '7', '#fff', { damage: true });
  assert.equal(fx.stats().texts, 1);
  assert.equal(fx.texts.find((t) => t.alive).str, '12');
  for (let i = 0; i < 200; i++) fx.text(i * 50, 0, 'x', '#fff');
  assert.ok(fx.stats().texts <= 60, 'text cap');
  // settings
  settings.damageNumbers = false;
  const before = fx.stats().texts;
  fx.text(9999, 9999, '3', '#fff', { damage: true });
  assert.equal(fx.stats().texts, before);
  settings.flashes = false;
  fx.flash('#f00', 0.2);
  assert.equal(fx.flashAlpha, 0);
  settings.flashes = true;
  fx.flash('#f00', 0.2);
  assert.ok(fx.flashAlpha > 0);
  settings.shake = 0;
  fx.shake(5, 0.3);
  fx.update(0.05);
  assert.equal(fx.shakeX, 0);
  settings.shake = 1;
  fx.shake(5, 0.3);
  fx.update(0.05);
  assert.ok(Math.abs(fx.shakeX) + Math.abs(fx.shakeY) > 0);
  // shapes, lights, hitstop
  fx.ring(0, 0, 20, '#fff', 0.3);
  fx.beam(0, 0, 50, 0, '#fff', 3, 0.2);
  fx.lightning(0, 0, 60, 30, '#ffe75a');
  fx.light(0, 0, 40, '#fff', 0.3);
  fx.hitstop(0.1);
  assert.ok(fx.hitstopT > 0);
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  assert.equal(fx.hitstopT, 0);
  fx.update(0); fx.update(-1); fx.update(NaN); // ignored
  fx.clear();
  assert.equal(fx.stats().particles, 0);
  assert.equal(fx.stats().texts, 0);
});

test('Renderer and Lighting construct headless and tolerate missing canvases', async () => {
  const { Renderer } = await import('../src/render/renderer.js');
  const { Lighting } = await import('../src/render/lighting.js');
  const { Fx } = await import('../src/render/fx.js');
  const game = { state: 'menu', run: null, view: { x: 0, y: 0, w: 0, h: 0, scale: 1 } };
  const r = new Renderer(null, null, game, new Fx());
  r.setArt({});
  r.setArt({ sprites: { has: () => false, draw() {} } });
  r.resize();
  r.draw(1 / 60);
  const l = new Lighting();
  l.resize(100, 100);
  assert.equal(l.canvas, null);
});

test('§12 fx presets exist and burst headless', async () => {
  const { Fx, FX_PRESETS } = await import('../src/render/fx.js');
  for (const p of ['hemorrhage', 'bloodmist', 'blood_drip', 'eruption']) assert.ok(FX_PRESETS.includes(p), `preset ${p}`);
  const fx = new Fx();
  fx.burst('hemorrhage', 50, 50);
  fx.burst('eruption', 50, 50);
  fx.update(1 / 60);
  // hemorrhage pulls in its mist, eruption its poison bubbles
  assert.ok(fx.stats().particles > 24 + 18);
});

test('fx.drain: pooled motes home onto a moving target and expire', async () => {
  const { Fx } = await import('../src/render/fx.js');
  const fx = new Fx(() => ({ reducedMotion: false }));
  const target = { x: 200, y: 100 };
  const drained = [];
  fx.onDrain = (amount, t) => drained.push([amount, t]);
  fx.drain(0, 0, target, '#d6304a', 5);
  assert.deepEqual(drained, [[5, target]]);
  const n = fx.stats().motes;
  assert.ok(n >= 2 && n <= 6, `motes ${n}`);
  // the target walks away; the motes must still land on it
  for (let i = 0; i < 12; i++) { target.x += 3; fx.update(1 / 60); }
  const live = fx.motes.filter((m) => m.t > 0 && m.dur - m.t >= m.delay);
  assert.ok(live.length > 0);
  for (const m of live) assert.equal(m.tx, target.x);
  const closest = new Map();
  for (let i = 0; i < 40; i++) {
    target.x += 1;
    fx.update(1 / 60);
    for (const m of fx.motes) {
      if (m.t <= 0 || m.dur - m.t < m.delay) continue;
      const d = Math.hypot(m.x - target.x, m.y - (target.y - 3));
      closest.set(m, Math.min(closest.get(m) ?? Infinity, d));
    }
  }
  assert.equal(fx.stats().motes, 0, 'all motes expire within ~0.5 s');
  assert.ok(closest.size >= 2 && [...closest.values()].every((d) => d < 8), `every mote reaches the target (${[...closest.values()].map((d) => d.toFixed(1))})`);
  assert.ok(fx.motes.every((m) => m.target === null), 'no target references kept');
  // pool cap + junk input
  for (let i = 0; i < 100; i++) fx.drain(i, i, target, '#f00', 50);
  assert.ok(fx.stats().motes <= 64);
  fx.drain(NaN, 0, target);
  fx.drain(0, 0, null, null, undefined);
  fx.clear();
  assert.equal(fx.stats().motes, 0);
});

test('fx.statusBurst: Aderlass / Gifteruption / Entladung visuals, chain from payload or nearby enemies', async () => {
  const { Fx } = await import('../src/render/fx.js');
  const fx = new Fx();
  const target = { x: 100, y: 100, r: 6 };
  const ringR = () => fx.rings.filter((r) => r.t > 0).map((r) => r.r);
  fx.statusBurst({ target, id: 'bleed', x: 100, y: 100, damage: 30 });
  fx.update(0.001);
  assert.ok(ringR().length >= 1 && fx.stats().particles > 20 && fx.stats().texts === 1);
  assert.ok(fx.shakeAmp > 0);
  fx.clear();
  fx.statusBurst({ target, id: 'poison', x: 100, y: 100, damage: 12, radius: 60 });
  assert.ok(ringR().includes(60), 'green ring expands to the spread radius');
  fx.clear();
  const bolts = () => fx.bolts.filter((b) => b.t > 0);
  fx.statusBurst({ target, id: 'shock', x: 100, y: 100, damage: 14, chain: [{ x: 150, y: 100, target: {} }, { x: 190, y: 120, target: {} }] });
  assert.equal(bolts().length, 2);
  assert.deepEqual([bolts()[0].x0, bolts()[0].x1, bolts()[1].x0, bolts()[1].x1], [100, 150, 150, 190]);
  fx.clear();
  // no chain in the payload: hop to the nearest live enemies within range
  const world = { enemies: [target, { x: 160, y: 100, r: 6 }, { x: 220, y: 100, r: 6 }, { x: 400, y: 100, r: 6 }, { x: 120, y: 110, r: 6, dead: true }] };
  fx.statusBurst({ target, id: 'shock', x: 100, y: 100 }, world);
  assert.equal(bolts().length, 2, 'out-of-range and dead enemies are skipped');
  // tolerant of junk
  fx.statusBurst(null);
  fx.statusBurst({ id: 'nope', x: 1, y: 1 });
  fx.statusBurst({ id: 'bleed' });
  fx.statusBurst({ id: 'shock', target: { x: 5, y: 5 } }, { enemies: null });
});

test('Renderer turns status:burst events into fx and forwards drains to the bus', async () => {
  const { Renderer } = await import('../src/render/renderer.js');
  const { Fx } = await import('../src/render/fx.js');
  const { Bus } = await import('../src/core/events.js');
  const bus = new Bus();
  const fx = new Fx();
  const r = new Renderer(null, null, { state: 'playing', run: { world: { enemies: [] } } }, fx);
  r.bindEvents(bus);
  r.bindEvents(bus); // idempotent
  bus.emit('status:burst', { target: { x: 10, y: 10, r: 5 }, id: 'bleed', x: 10, y: 10, damage: 5 });
  fx.update(0.001);
  assert.ok(fx.stats().particles > 0);
  const got = [];
  bus.on('fx:drain', (p) => got.push(p.amount));
  fx.drain(0, 0, { x: 5, y: 5 }, '#f00', 3);
  assert.deepEqual(got, [3]);
  r.unbindEvents();
  assert.equal(fx.onDrain, null);
  const before = fx.stats().particles;
  bus.emit('status:burst', { target: { x: 10, y: 10 }, id: 'bleed', x: 10, y: 10 });
  fx.update(0.001);
  assert.ok(fx.stats().particles <= before);
});
