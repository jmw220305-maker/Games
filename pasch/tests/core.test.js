import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, makeStream, next, int, pick, weighted, shuffle, chance, randomSeedString } from '../src/core/rng.js';
import { formatNumber, formatMoney, formatMult } from '../src/core/format.js';
import { clamp, sum, countBy, deepClone } from '../src/core/util.js';
import { load, save, remove } from '../src/core/storage.js';

test('rng: deterministisch und JSON-fähig', () => {
  const a = makeStream(hashSeed('abc'));
  const b = makeStream(hashSeed('abc'));
  const xs = Array.from({ length: 20 }, () => next(a));
  const ys = Array.from({ length: 20 }, () => next(b));
  assert.deepEqual(xs, ys);
  const c = JSON.parse(JSON.stringify(a));
  assert.equal(next(c), next(a));
  for (const x of xs) assert.ok(x >= 0 && x < 1);
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
});

test('rng: int/pick/weighted/shuffle/chance', () => {
  const s = makeStream(42);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) counts[int(s, 1, 6)]++;
  assert.equal(counts[0], 0);
  for (let v = 1; v <= 6; v++) assert.ok(counts[v] > 850 && counts[v] < 1150, `Wert ${v}: ${counts[v]}`);
  assert.ok(['a', 'b'].includes(pick(s, ['a', 'b'])));
  assert.equal(pick(s, []), undefined);
  let w = 0;
  for (let i = 0; i < 1000; i++) if (weighted(s, [['x', 9], ['y', 1], ['z', 0]]) === 'x') w++;
  assert.ok(w > 850 && w < 950);
  const arr = shuffle(s, [1, 2, 3, 4, 5]);
  assert.deepEqual([...arr].sort(), [1, 2, 3, 4, 5]);
  let c = 0;
  for (let i = 0; i < 1000; i++) if (chance(s, 0.25)) c++;
  assert.ok(c > 200 && c < 300);
  assert.match(randomSeedString(), /^[A-Z0-9]{8}$/);
});

test('format: deutsche Zahlen', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(1234), '1.234');
  assert.equal(formatNumber(999999), '999.999');
  assert.equal(formatNumber(1234567), '1,23 Mio.');
  assert.equal(formatNumber(4.5e9), '4,5 Mrd.');
  assert.equal(formatNumber(3.1e14), '3,1e14');
  assert.equal(formatMoney(12), '$12');
  assert.equal(formatMult(1.5), '×1,5');
  assert.equal(formatMult(2), '×2');
});

test('util und storage (In-Memory-Fallback)', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(sum([1, 2, 3]), 6);
  assert.deepEqual(countBy([1, 1, 2]), { 1: 2, 2: 1 });
  const o = { a: [1, { b: 2 }] };
  assert.deepEqual(deepClone(o), o);
  assert.equal(load('pasch.test', 'x'), 'x');
  assert.ok(save('pasch.test', { v: 1 }));
  assert.deepEqual(load('pasch.test', null), { v: 1 });
  remove('pasch.test');
  assert.equal(load('pasch.test', null), null);
});
