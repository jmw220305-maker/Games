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
