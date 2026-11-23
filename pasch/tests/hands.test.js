import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHands, HANDS, contains, handBase } from '../src/game/hands.js';
import { makeStream, int } from '../src/core/rng.js';

const ids = (vals, wild, opts) => detectHands(vals, wild, opts).map((h) => h.handId);
const find = (vals, id, wild, opts) => detectHands(vals, wild, opts).find((h) => h.handId === id);

test('Grundhände, ranghöchste zuerst', () => {
  assert.deepEqual(ids([1, 1, 3, 4, 6]), ['pair', 'scatter']);
  assert.deepEqual(ids([2, 2, 5, 5, 1]), ['twopair', 'pair', 'scatter']);
  assert.deepEqual(ids([3, 3, 3, 5, 6]), ['triple', 'pair', 'scatter']);
  assert.deepEqual(ids([4, 4, 4, 2, 2]), ['fullhouse', 'parity', 'triple', 'twopair', 'pair', 'scatter']);
  assert.deepEqual(ids([1, 2, 3, 4, 6]), ['smallrun', 'scatter']);
  assert.deepEqual(ids([2, 3, 4, 5, 6]), ['bigrun', 'smallrun', 'scatter']);
  assert.deepEqual(ids([6, 6, 6, 6, 1]), ['quad', 'triple', 'pair', 'scatter']);
  assert.deepEqual(ids([5, 5, 5, 5, 5]), ['pasch', 'quad', 'parity', 'triple', 'pair', 'scatter']);
  assert.deepEqual(ids([1, 3, 5, 1, 3]), ['parity', 'twopair', 'pair', 'scatter']);
  assert.deepEqual(ids([1, 2, 4, 5, 6]).slice(0, 1), ['scatter']);
});

test('Würfelindizes und beste Auswahl', () => {
  assert.deepEqual(find([2, 6, 2, 6, 1], 'pair').dice, [1, 3]); // höheres Paar
  assert.deepEqual(find([2, 6, 2, 6, 1], 'twopair').dice, [0, 1, 2, 3]);
  assert.deepEqual(find([1, 3, 2, 6, 4], 'smallrun').dice, [0, 1, 2, 4]);
  assert.deepEqual(find([1, 3, 2, 6, 4], 'scatter').dice, [3]);
  const fh = find([3, 3, 3, 6, 6, 6], 'fullhouse');
  assert.equal(fh.dice.length, 5);
  assert.equal(fh.dice.filter((i) => [3, 4, 5].includes(i)).length, 3, 'Drilling aus den Sechsen');
});

test('6 Würfel: Sechsling, Himmelsleiter, Gleichklang mit Auswahl', () => {
  assert.equal(ids([4, 4, 4, 4, 4, 4])[0], 'sixer');
  assert.equal(ids([1, 2, 3, 4, 5, 6])[0], 'skyladder');
  const par = find([2, 4, 6, 6, 2, 1], 'parity');
  assert.deepEqual(par.dice, [0, 1, 2, 3, 4]);
  assert.equal(find([1, 1, 1, 1, 1, 2], 'pasch').dice.length, 5);
});

test('Straßen mit W8', () => {
  assert.equal(ids([4, 5, 6, 7, 8])[0], 'bigrun');
  assert.deepEqual(find([8, 7, 6, 5, 1], 'smallrun').dice, [0, 1, 2, 3]);
  assert.equal(ids([3, 5, 6, 7, 8])[0], 'smallrun');
});

test('leere Flächen (0) bilden keine Hände', () => {
  assert.deepEqual(ids([0, 0, 3, 3, 5]), ['pair', 'scatter']);
  assert.deepEqual(ids([0, 0, 0, 0, 0]), ['scatter']);
  assert.deepEqual(find([0, 0, 0, 0, 0], 'scatter').dice, []);
  assert.ok(!ids([0, 2, 3, 4, 0]).includes('smallrun'));
});

test('Wild (Stern) sucht die beste Belegung', () => {
  const wild = [false, false, false, false, true];
  assert.equal(ids([6, 6, 6, 6, 0], wild)[0], 'pasch');
  const p = find([6, 6, 6, 6, 0], 'pasch', wild);
  assert.equal(p.values[4], 6);
  assert.equal(ids([2, 3, 4, 5, 0], wild)[0], 'bigrun');
  assert.equal(find([2, 3, 4, 5, 0], 'bigrun', wild).values[4], 6, 'höchste Straße');
  assert.equal(ids([0, 0, 0, 0, 0], [true, true, true, true, true])[0], 'pasch');
  // W8 erlaubt Wild bis 8
  assert.equal(find([0, 1, 1, 1, 1], 'scatter', [true, false, false, false, false], { wildMax: 8 }).values[0], 8);
});

test('Enthaltensein und Stufen', () => {
  assert.ok(contains('fullhouse', 'pair'));
  assert.ok(contains('fullhouse', 'triple'));
  assert.ok(contains('bigrun', 'smallrun'));
  assert.ok(contains('sixer', 'pasch'));
  assert.ok(!contains('parity', 'pair'));
  assert.ok(contains('pair', 'pair'));
  const h = HANDS.pair;
  assert.deepEqual(handBase('pair', 1), { chips: h.chips, mult: h.mult });
  assert.deepEqual(handBase('pair', 3), { chips: h.chips + 2 * h.perLevel.chips, mult: h.mult + 2 * h.perLevel.mult });
});

test('Monte Carlo: Paar oder besser im ersten Wurf ≈ 90,7 %', () => {
  const s = makeStream(12345);
  const N = 40000;
  let pairPlus = 0;
  let pasch = 0;
  let bigrun = 0;
  for (let i = 0; i < N; i++) {
    const v = Array.from({ length: 5 }, () => int(s, 1, 6));
    const found = detectHands(v).map((h) => h.handId);
    if (found.includes('pair')) pairPlus++;
    if (found.includes('pasch')) pasch++;
    if (found.includes('bigrun')) bigrun++;
  }
  const p = pairPlus / N;
  assert.ok(Math.abs(p - 0.907) < 0.01, `Paar+ = ${p}`);
  assert.ok(Math.abs(bigrun / N - 0.0309) < 0.006, `Große Straße = ${bigrun / N}`);
  assert.ok(pasch / N < 0.003);
});
