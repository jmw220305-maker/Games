// UI unit tests: pure helpers must import and work without a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtInt, fmtDec, fmtPct, fmtSignedPct, fmtTime, fmtDuration, plural, text, descAt, rarityInfo,
  statLabel, formatStat, statTrend, describeMod, mapLayout, pickDirectional, approach, statProfile,
  completion, LIFETIME_STATS, formatLifetime, STAT_INFO, STAT_GROUPS, clamp01, MINUS,
} from '../src/ui/format.js';

test('number formatting is German', () => {
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(1234567), '1.234.567');
  assert.equal(fmtInt(-42), `${MINUS}42`);
  assert.equal(fmtInt(NaN), '0');
  assert.equal(fmtDec(1.25, 2), '1,25');
  assert.equal(fmtDec(1.5), '1,5');
  assert.equal(fmtDec(2), '2');
  assert.equal(fmtDec(12345.6, 1), '12.345,6');
  assert.equal(fmtPct(0.125), '12,5 %');
  assert.equal(fmtSignedPct(0.2), '+20 %');
  assert.equal(fmtSignedPct(-0.1), `${MINUS}10 %`);
});

test('time formatting', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(65.9), '1:05');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTime(-5), '0:00');
  assert.equal(fmtDuration(42), '42 Sek.');
  assert.equal(fmtDuration(125), '2 Min. 5 Sek.');
  assert.equal(fmtDuration(7322), '2 Std. 2 Min.');
  assert.equal(plural(1, 'Sieg', 'Siege'), '1 Sieg');
  assert.equal(plural(3, 'Sieg', 'Siege'), '3 Siege');
});

test('text/desc helpers accept strings, numbers and desc functions', () => {
  assert.equal(text(null, 'x'), 'x');
  assert.equal(text(5), '5');
  const d = (l) => `+${l * 10} Leben`;
  d.toString = () => '+10 Leben pro Stufe';
  assert.equal(text(d), '+10 Leben pro Stufe');
  assert.equal(descAt(d, 3), '+30 Leben');
  assert.equal(descAt('fest', 3), 'fest');
  assert.equal(descAt(() => { throw new Error('x'); }, 1), '');
});

test('rarity lookup falls back to common', () => {
  assert.equal(rarityInfo('legendary').name, 'Legendär');
  assert.equal(rarityInfo('nope').name, 'Gewöhnlich');
  assert.equal(rarityInfo('rare', { rare: { name: 'R', color: '#000' } }).name, 'R');
});

test('stat labels and formatting', () => {
  for (const g of STAT_GROUPS) for (const k of g.keys) assert.ok(STAT_INFO[k], `missing STAT_INFO for ${k}`);
  assert.equal(statLabel('maxHp'), 'Max. Leben');
  assert.equal(statLabel('maxHp', { maxHp: { name: 'X', label: 'Leben max.' } }), 'Leben max.');
  assert.equal(formatStat('maxHp', 120.4), '120');
  assert.equal(formatStat('critChance', 0.05), '5 %');
  assert.equal(formatStat('damage', 1.25), '125 %');
  assert.equal(formatStat('dashCooldown', 1.1), '1,1 s');
  assert.equal(statTrend('damage', 1.2, 1), 1);
  assert.equal(statTrend('dashCooldown', 1.2, 1.1), -1);
  assert.equal(statTrend('damage', 1, 1), 0);
  assert.equal(describeMod({ stat: 'maxHp', add: 20 }), '+20 Max. Leben');
  assert.equal(describeMod({ stat: 'damage', mul: 1.12 }), '+12 % Schaden');
  assert.equal(describeMod({ stat: 'critChance', add: 0.05 }), '+5 % Krit. Chance');
});

test('lifetime stat formatting', () => {
  const byKey = Object.fromEntries(LIFETIME_STATS.map((e) => [e.key, e]));
  assert.equal(formatLifetime(byKey.fastestWin, 0), '–');
  assert.equal(formatLifetime(byKey.fastestWin, 754), '12:34');
  assert.equal(formatLifetime(byKey.highestDifficultyWon, -1), '–');
  assert.equal(formatLifetime(byKey.kills, 12345), '12.345');
});

test('minimap layout only shows seen rooms and links them', () => {
  const rooms = [
    { id: 0, gx: 5, gy: 5, type: 'start', seen: true, visited: true, doors: { e: { to: 1 } } },
    { id: 1, gx: 6, gy: 5, type: 'combat', seen: true, visited: false, doors: { w: { to: 0 }, s: { to: 2 } } },
    { id: 2, gx: 6, gy: 6, type: 'boss', seen: false, visited: false, doors: { n: { to: 1 } } },
  ];
  const lay = mapLayout(rooms, 0);
  assert.equal(lay.cells.length, 2);
  assert.equal(lay.cols, 2);
  assert.equal(lay.rows, 1);
  assert.deepEqual(lay.cells.map((c) => [c.col, c.row]), [[0, 0], [1, 0]]);
  assert.ok(lay.cells[0].current);
  assert.equal(lay.links.length, 1);
  rooms[2].seen = true;
  const lay2 = mapLayout(rooms, 1);
  assert.equal(lay2.cells.length, 3);
  assert.equal(lay2.links.length, 2);
  assert.deepEqual(mapLayout(null, 0).cells, []);
});

test('directional focus picking', () => {
  const from = { x: 0, y: 0, w: 100, h: 40 };
  const rects = [
    { x: 0, y: 60, w: 100, h: 40 },     // below
    { x: 140, y: 0, w: 100, h: 40 },    // right
    { x: 300, y: 70, w: 100, h: 40 },   // far right-below
    { x: 0, y: -60, w: 100, h: 40 },    // above
  ];
  assert.equal(pickDirectional(from, rects, 'down'), 0);
  assert.equal(pickDirectional(from, rects, 'right'), 1);
  assert.equal(pickDirectional(from, rects, 'up'), 3);
  assert.equal(pickDirectional(from, rects, 'left'), -1);
  // grid: prefer the aligned column
  const grid = [{ x: 0, y: 60, w: 50, h: 50 }, { x: 60, y: 60, w: 50, h: 50 }];
  assert.equal(pickDirectional({ x: 60, y: 0, w: 50, h: 50 }, grid, 'down'), 1);
});

test('counter animation and misc', () => {
  assert.equal(approach(0, 0.3, 0.016), 0.3);
  const v = approach(0, 100, 0.016);
  assert.ok(v > 0 && v < 100);
  assert.equal(approach(NaN, 5, 0.1), 5);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(NaN), 0);
  assert.deepEqual(completion(3, 4), { have: 3, total: 4, pct: 75 });
  assert.deepEqual(completion(5, 0), { have: 0, total: 0, pct: 0 });
  const prof = statProfile({ maxHp: 120, damage: 1, fireRate: 1, moveSpeed: 92, armor: 0, dodge: 0 }, { maxHp: 100, damage: 1, fireRate: 1, moveSpeed: 92 });
  assert.equal(prof.length, 5);
  assert.ok(prof[0].value > 0.5);
  assert.equal(prof[1].value, 0.5);
});

test('DOM-dependent UI modules import without a DOM', async () => {
  const content = await import('../src/ui/content.js');
  assert.equal(typeof content.loadContent, 'function');
  const mm = await import('../src/ui/minimap.js');
  assert.equal(typeof mm.drawMap, 'function');
  assert.equal(mm.mapSignature({ rooms: [{ seen: true }, { visited: true, seen: true }], index: 1, seed: 7 }, 0), '1|7|0|2|1');
  const ui = await import('../src/ui/ui.js');
  assert.equal(typeof ui.ui.init, 'function');
  assert.equal(typeof ui.ui.update, 'function');
  // init without a document is a harmless no-op
  assert.equal(ui.ui.init({}), ui.ui);
  ui.ui.update(0.016);
});
