// Art owner tests (node --test). Node has no canvas: everything here exercises the DOM-free
// parts — the sprite registry, the software pixel buffers, and the room tile builder.
import test from 'node:test';
import assert from 'node:assert/strict';

import { sprites, SPRITE_KEYS, GLYPH_NAMES } from '../src/render/sprites.js';
import { renderRoomStatic, drawRoomDynamic, buildRoomLayers, roomLights } from '../src/render/tiles.js';
import { DEFS } from '../src/render/art/index.js';
import { BIOMES, FLOOR_ORDER } from '../src/data/biomes.js';
import { TILE, TS } from '../src/game/constants.js';

const CHARACTERS = ['bearer', 'shadow', 'warden', 'weaver', 'revenant'];
const PROPS = ['prop_chest', 'prop_chest_rare', 'prop_chest_cursed', 'prop_chest_open', 'prop_pedestal', 'prop_shrine', 'prop_forge',
  'prop_fountain', 'prop_fountain_empty', 'prop_portal', 'prop_barrel', 'prop_barrel_explosive', 'prop_crystal', 'prop_torch',
  'prop_statue', 'prop_bones', 'prop_stalagmite', 'prop_mushroom'];
const PICKUPS = ['pickup_spark', 'pickup_xp', 'pickup_heart', 'pickup_ash', 'pickup_shield'];
const PROJECTILES = ['proj_orb', 'proj_bolt', 'proj_shard', 'proj_dagger', 'proj_disc', 'proj_spore', 'proj_blob', 'proj_needle',
  'proj_wave', 'proj_star', 'proj_skull', 'proj_beam', 'proj_hammer', 'proj_blade'];
const GLYPHS = ['flame', 'ember', 'skull', 'heart', 'shield', 'boot', 'eye', 'sword', 'dagger', 'hammer', 'bow', 'staff', 'orb', 'star',
  'sun', 'moon', 'snowflake', 'drop', 'bolt', 'leaf', 'mushroom', 'bone', 'crown', 'coin', 'key', 'hourglass', 'feather', 'fang', 'claw',
  'ring', 'gem', 'book', 'potion', 'bomb', 'wing', 'anchor', 'chain', 'mirror', 'mask', 'candle', 'lantern', 'compass', 'dice', 'scale',
  'thorn', 'spiral', 'cross', 'hand', 'tooth', 'horn'];
const ENEMIES = [...new Set(FLOOR_ORDER.flatMap((b) => BIOMES[b].enemies.map((e) => e.id)).concat('glacier_slime_small'))];
const BOSSES = FLOOR_ORDER.map((b) => BIOMES[b].boss).concat(['boss_rime_segment', 'boss_umbra_twin', 'boss_sun_core']);

test('modules import without a DOM', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof sprites.draw, 'function');
  assert.equal(typeof sprites.icon, 'function');
  assert.equal(typeof renderRoomStatic, 'function');
  assert.equal(typeof drawRoomDynamic, 'function');
  assert.equal(sprites.init(), false, 'init is a no-op without a DOM');
});

test('registry contains every required key', () => {
  const keys = new Set(SPRITE_KEYS);
  const required = [
    ...CHARACTERS.map((c) => 'char_' + c), ...ENEMIES, ...BOSSES, ...PROPS, ...PICKUPS, ...PROJECTILES, ...GLYPHS.map((g) => 'glyph_' + g),
  ];
  const missing = required.filter((k) => !keys.has(k) || !sprites.has(k));
  assert.deepEqual(missing, []);
  assert.deepEqual([...sprites.keys()].sort(), [...SPRITE_KEYS].sort());
});

test('exactly the 50 contract glyphs, all tintable', () => {
  assert.equal(GLYPH_NAMES.length, 50);
  assert.deepEqual([...GLYPH_NAMES].sort(), [...GLYPHS].sort());
  for (const g of GLYPHS) assert.ok(sprites.info('glyph_' + g).tint, g);
  for (const p of PROJECTILES) assert.ok(sprites.info(p).tint, p);
});

test('animation sets per category', () => {
  for (const c of CHARACTERS) {
    const a = sprites.info('char_' + c).anims;
    for (const n of ['idle', 'walk', 'dash', 'hurt']) assert.ok(a[n], `char_${c}.${n}`);
    assert.ok(a.walk.n >= 4, `char_${c} walk has 4 frames`);
  }
  for (const e of ENEMIES) {
    const a = sprites.info(e).anims;
    for (const n of ['idle', 'attack', 'hurt']) assert.ok(a[n], `${e}.${n}`);
  }
  for (const b of FLOOR_ORDER.map((x) => BIOMES[x].boss)) {
    const a = sprites.info(b).anims;
    for (const n of ['idle', 'walk', 'attack', 'cast', 'special', 'hurt']) assert.ok(a[n], `${b}.${n}`);
  }
  assert.ok(sprites.info('mire_stalker').anims.special, 'burrowed mound');
  assert.ok(sprites.info('boss_sun').anims.special, 'reignited sun');
});

test('every frame of every sprite renders a non-empty, correctly sized buffer', () => {
  let frames = 0;
  for (const [key, def] of DEFS) {
    for (const [name, an] of Object.entries(def.anims)) {
      assert.ok(an.n >= 1 && an.fps > 0, `${key}.${name}`);
      for (let i = 0; i < an.n; i++) {
        const b = an.render(i);
        assert.equal(b.w, def.w, key);
        assert.equal(b.h, def.h, key);
        assert.ok(b.count() > 4, `${key}.${name}[${i}] is empty`);
        frames++;
      }
    }
  }
  assert.ok(frames > 300);
});

test('sprite sizes are in the expected ranges', () => {
  for (const c of CHARACTERS) {
    const s = sprites.size('char_' + c);
    assert.ok(s.w >= 14 && s.w <= 20 && s.h >= 16 && s.h <= 22, c);
  }
  for (const b of FLOOR_ORDER.map((x) => BIOMES[x].boss)) {
    const s = sprites.size(b);
    assert.ok(Math.max(s.w, s.h) >= 36 && Math.max(s.w, s.h) <= 64, b);
  }
  assert.deepEqual(sprites.size('proj_beam'), { w: 16, h: 6 });
  assert.deepEqual(sprites.size('no_such_key'), { w: 10, h: 10 });
});

test('unknown keys and anims never throw (fallback disc)', () => {
  const calls = [];
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(t, k) { return k in t ? t[k] : (...args) => calls.push([k, ...args]); },
    set(t, k, v) { t[k] = v; return true; },
  });
  sprites.draw(ctx, 'definitely_missing', 10, 10, { color: '#f00', alpha: 0.5 });
  sprites.draw(ctx, 'definitely_missing', 10, 10);
  assert.ok(calls.some((c) => c[0] === 'arc'));
  assert.equal(ctx.globalAlpha, 1, 'alpha restored');
  assert.equal(sprites.has('definitely_missing'), false);
  assert.equal(typeof sprites.icon({ glyph: 'flame', color: '#f80' }, 32), 'string');
  assert.equal(typeof sprites.icon('missing', 32), 'string');
});

test('pixel buffer helpers: tint, white flash silhouette', () => {
  const b = DEFS.get('glyph_flame').anims.idle.render(0);
  const t = b.tinted(255, 0, 0);
  const w = b.whitened();
  assert.equal(t.count(), b.count());
  assert.equal(w.count(), b.count());
  for (let i = 0; i < w.d.length; i++) if (w.d[i]) assert.equal(w.d[i] & 0xffffff, 0xffffff);
  // a mid-grey pixel must become pure red when tinted red
  let sawRed = false;
  for (let i = 0; i < t.d.length; i++) {
    const c = t.d[i];
    if (c >>> 24 && (c & 255) > 180 && ((c >>> 8) & 255) < 40) sawRed = true;
  }
  assert.ok(sawRed);
});

function sampleRoom(variant = 1) {
  const w = 20, h = 14;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? TILE.WALL : TILE.FLOOR;
  for (let y = 11; y < h; y++) for (let x = 17; x < w; x++) tiles[y * w + x] = TILE.VOID;
  tiles[5 * w + 5] = TILE.PIT; tiles[5 * w + 6] = TILE.PIT; tiles[6 * w + 5] = TILE.PIT;
  tiles[3 * w + 10] = TILE.HAZARD; tiles[3 * w + 11] = TILE.HAZARD; tiles[4 * w + 11] = TILE.HAZARD;
  tiles[8 * w + 8] = TILE.SPIKES; tiles[9 * w + 12] = TILE.ICE; tiles[9 * w + 13] = TILE.ICE;
  tiles[0 * w + 8] = TILE.DOOR; tiles[0 * w + 9] = TILE.DOOR;
  tiles[6 * w + 0] = TILE.DOOR; tiles[7 * w + 0] = TILE.DOOR;
  return { id: 3, w, h, tiles, doors: { n: { to: 1, tx: 8, ty: 0 }, w: { to: 2, tx: 0, ty: 6 } }, spawns: [], props: [], variant, visited: false, seen: false, cleared: false };
}

test('room layers build DOM-free for every biome, deterministic per variant', () => {
  for (const id of FLOOR_ORDER) {
    const room = sampleRoom(42);
    const a = buildRoomLayers(room, BIOMES[id]);
    const b = buildRoomLayers(sampleRoom(42), BIOMES[id]);
    const c = buildRoomLayers(sampleRoom(43), BIOMES[id]);
    assert.equal(a.base.w, room.w * TS);
    assert.equal(a.base.h, room.h * TS);
    assert.deepEqual(a.base.d, b.base.d, `${id}: same variant → same pixels`);
    assert.notDeepEqual(a.base.d, c.base.d, `${id}: variant changes decoration`);
    // VOID stays transparent, floor is opaque
    assert.equal(a.base.get(18 * TS + 4, 12 * TS + 4), 0, `${id}: void transparent`);
    assert.equal(a.base.get(3 * TS + 8, 9 * TS + 8) >>> 24, 255, `${id}: floor opaque`);
    // hazard tiles produce glow pixels
    assert.ok(a.glow[0].count() + a.glow[1].count() > 0, `${id}: hazard glow`);
  }
  const lights = roomLights(sampleRoom(), BIOMES.ash);
  assert.equal(lights.length, 3);
  assert.ok(lights.every((l) => l.r > 0 && /^#/.test(l.color)));
});

test('tile functions are safe without a DOM', () => {
  const room = sampleRoom();
  assert.equal(renderRoomStatic(room, BIOMES.frost), null);
  assert.doesNotThrow(() => drawRoomDynamic({}, room, BIOMES.frost, 1.2, { locked: true, view: { x: 0, y: 0, w: 100, h: 100 } }));
  assert.doesNotThrow(() => drawRoomDynamic(null, room, BIOMES.frost, 1.2));
});

test('glyphs referenced by game data exist (diagnostic)', async (t) => {
  const missing = new Set();
  for (const mod of ['weapons', 'characters', 'relics', 'boons', 'shrines', 'enemies']) {
    let m;
    try { m = await import(`../src/data/${mod}.js`); } catch { continue; }
    const seen = new WeakSet();
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return;
      seen.add(o);
      if (typeof o.glyph === 'string' && !sprites.has('glyph_' + o.glyph)) missing.add(`${mod}: glyph ${o.glyph}`);
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(m, 0);
  }
  if (missing.size) t.diagnostic('unknown glyphs (render as fallback discs): ' + [...missing].join(', '));
});
