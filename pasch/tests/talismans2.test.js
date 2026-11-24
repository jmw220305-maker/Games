// Gezielte Tests für die 52 Talismane aus content/talismans2.js (je mindestens ein Effekt-Test).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { roundRun, giveTalisman, setRolled } from './helpers.js';
import { makeExtraTalismans } from '../src/game/content/talismans2.js';
import { newTalismanState } from '../src/game/content/talismans.js';

const NEW_IDS = makeExtraTalismans({}).map((t) => t.id);
const tSteps = (res, i = 0) => res.result.steps.filter((s) => s.source.kind === 'talisman' && s.source.index === i);
const of = (st, type) => st.filter((s) => s.type === type);
const amounts = (st, type) => of(st, type).map((s) => (type === 'xmult' ? s.factor : s.amount));
const retrig = (res, i = 0) => res.result.steps.filter((s) => s.type === 'retrigger' && s.source.kind === 'talisman' && s.source.index === i).length;

function toSides(die, sides) {
  die.sides = sides;
  die.faces = [...Array(sides).keys()].map((k) => ({ v: k + 1, mark: null }));
}
const tested = new Set();

// ------------------------------------------------------------------ tabellengetriebene Wertungs-Effekte
const CASES = [
  ['twofold', { values: [2, 2, 5, 6, 1], hand: 'pair' }, (st, res) => { assert.deepEqual(amounts(st, 'mult'), [4, 4, 4, 4]); assert.equal(retrig(res), 2); }],
  ['trefoil', { values: [3, 3, 3, 1, 6], hand: 'triple' }, (st) => assert.deepEqual(amounts(st, 'mult'), [9, 9, 9])],
  ['trefoil', { values: [3, 3, 5, 1, 6], hand: 'pair' }, (st) => assert.deepEqual(amounts(st, 'mult'), [6, 6])],
  ['foursquare', { values: [4, 4, 1, 2, 6], hand: 'pair' }, (st) => assert.deepEqual(amounts(st, 'chips'), [44, 44])],
  ['handful', { values: [5, 5, 1, 2, 6], hand: 'pair' }, (st) => { assert.deepEqual(amounts(st, 'chips'), [15, 15]); assert.deepEqual(amounts(st, 'mult'), [5, 5]); }],
  ['span', { values: [1, 6, 6, 3, 4], hand: 'pair' }, (st) => assert.deepEqual(amounts(st, 'mult'), [10])],
  ['double_decker', { values: [2, 2, 4, 4, 6], hand: 'twopair' }, (st) => assert.deepEqual(amounts(st, 'mult'), [12])],
  ['double_decker', { values: [2, 2, 4, 4, 6], hand: 'pair' }, (st) => assert.equal(st.length, 0)],
  ['footpath', { values: [1, 2, 3, 4, 6], hand: 'smallrun' }, (st) => assert.deepEqual(amounts(st, 'xmult'), [1.5])],
  ['footpath', { values: [2, 3, 4, 5, 6], hand: 'bigrun' }, (st) => assert.equal(st.length, 0)],
  ['cadence', { values: [1, 3, 5, 5, 3], hand: 'parity' }, (st) => assert.deepEqual(amounts(st, 'mult'), [15])],
  ['cadence', { values: [1, 3, 5, 5, 3], hand: 'pair' }, (st) => assert.equal(st.length, 0)],
  ['loner', { values: [1, 2, 4, 5, 6], hand: 'scatter' }, (st) => { assert.deepEqual(amounts(st, 'chips'), [36]); assert.deepEqual(amounts(st, 'mult'), [4]); }],
  ['loner', { values: [6, 6, 4, 5, 1], hand: 'pair' }, (st) => assert.equal(st.length, 0)],
  ['deep_sea', { values: [6, 6, 1, 2, 3], marks: ['azure'], hand: 'pair' }, (st) => { assert.deepEqual(amounts(st, 'chips'), [30]); assert.deepEqual(amounts(st, 'mult'), [3]); }],
  ['quarry', { values: [6, 6, 6, 2, 3], marks: ['stone'], hand: 'pair' }, (st) => { assert.deepEqual(amounts(st, 'chips'), [40]); assert.deepEqual(amounts(st, 'mult'), [4]); }],
  ['leadfoot', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.dice[0].material = 'lead'; } }, (st) => { assert.deepEqual(amounts(st, 'chips'), [40]); assert.deepEqual(amounts(st, 'mult'), [2]); }],
  ['tetra', { values: [4, 4, 1, 2, 3], hand: 'pair', prep: (r) => toSides(r.dice[0], 4) }, (st) => assert.deepEqual(amounts(st, 'mult'), [5])],
  ['octa', { values: [8, 8, 1, 2, 3], hand: 'pair', prep: (r) => toSides(r.dice[0], 8) }, (st) => assert.deepEqual(amounts(st, 'chips'), [40])],
  ['anchor', { values: [5, 5, 1, 2, 3], hand: 'pair' }, (st) => assert.deepEqual(amounts(st, 'mult'), [15])],
  ['anchor', { values: [1, 5, 5, 2, 3], hand: 'pair' }, (st) => assert.equal(st.length, 0)],
  ['stairs', { values: [1, 2, 2, 3, 1], hand: 'pair' }, (st) => assert.deepEqual(amounts(st, 'mult'), [6])],
  ['vacancy', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.limits.talismans = 5; } }, (st) => assert.deepEqual(amounts(st, 'mult'), [12])],
  ['topping_out', { values: [4, 4, 4, 2, 2], hand: 'fullhouse' }, (st) => assert.deepEqual(amounts(st, 'xmult'), [2])],
  ['topping_out', { values: [4, 4, 4, 2, 2], hand: 'triple' }, (st) => assert.equal(st.length, 0)],
  ['highway', { values: [2, 3, 4, 5, 6], hand: 'bigrun' }, (st) => assert.deepEqual(amounts(st, 'xmult'), [2.5])],
  ['highway', { values: [2, 3, 4, 5, 6], hand: 'smallrun' }, (st) => assert.equal(st.length, 0)],
  ['gang_of_four', { values: [3, 3, 3, 3, 6], hand: 'quad' }, (st) => assert.deepEqual(amounts(st, 'mult'), [8, 8, 8, 8])],
  ['gang_of_four', { values: [3, 3, 3, 1, 6], hand: 'triple' }, (st) => assert.equal(st.length, 0)],
  ['wisp', { values: [6, 6, 1, 2, 3], marks: ['star'], hand: 'pair' }, (st) => { assert.deepEqual(amounts(st, 'chips'), [20]); assert.deepEqual(amounts(st, 'mult'), [8]); }],
  ['echo_well', { values: [6, 6, 1, 2, 3], marks: ['echo'], hand: 'pair' }, (st, res) => { assert.equal(res.result.steps.filter((s) => s.type === 'retrigger').length, 2); assert.equal(retrig(res), 1); }],
  ['ossuary', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.dice[0].material = 'bone'; } }, (st, res) => assert.equal(retrig(res), 1)],
  ['burning_glass', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.dice[1].material = 'prism'; } }, (st) => assert.deepEqual(amounts(st, 'xmult'), [1.5])],
  ['tail_light', { values: [1, 2, 3, 6, 6], hand: 'pair' }, (st, res) => assert.equal(retrig(res), 2)],
  ['tail_light', { values: [6, 6, 3, 2, 1], hand: 'pair' }, (st, res) => assert.equal(retrig(res), 0)],
  ['alchemist', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.dice[2].material = 'lead'; r.dice[3].material = 'phantom'; } }, (st) => assert.deepEqual(amounts(st, 'mult'), [15])],
  ['master', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.handLevels.pair = 3; } }, (st) => assert.deepEqual(amounts(st, 'mult'), [8])],
  ['master', { values: [6, 6, 1, 2, 3], hand: 'pair' }, (st) => assert.equal(st.length, 0)],
  ['crystal_ball', { values: [6, 6, 1, 2, 3], hand: 'pair', prep: (r) => { r.dice[0].material = 'crystal'; r.dice[4].material = 'crystal'; } }, (st, res) => { assert.equal(retrig(res), 1); assert.deepEqual(amounts(st, 'xmult'), [1.5]); }],
  ['milestone', { values: [6, 6, 1, 2, 3], hand: 'pair' }, (st, res, run) => { assert.equal(run.talismans[0].state.n, 1); assert.deepEqual(amounts(st, 'xmult'), [1.04]); assert.equal(of(st, 'grow').length, 1); }],
  ['curio', { values: [6, 6, 1, 2, 3], hand: 'pair', extra: ['pentagram'] }, (st) => assert.deepEqual(amounts(st, 'xmult'), [1.69])],
  ['ruby_heart', { values: [6, 6, 1, 2, 3], marks: ['ruby'], hand: 'pair' }, (st) => assert.deepEqual(amounts(st, 'xmult'), [1.5])],
  ['eternal_echo', { values: [6, 6, 1, 2, 3], hand: 'pair' }, (st, res) => { assert.equal(retrig(res), 2); assert.deepEqual(amounts(st, 'xmult'), [1.2, 1.2]); }],
  ['grand_hall', { values: [6, 6, 1, 2, 3], hand: 'pair', extra: ['cup', 'prime'] }, (st) => assert.deepEqual(amounts(st, 'xmult'), [2])],
];

test('Talismane Teil 2: Wertungs-Effekte (tabellengetrieben)', () => {
  for (const [id, c, check] of CASES) {
    const run = roundRun({ talismans: [id, ...(c.extra || [])], values: c.values, marks: c.marks, prep: c.prep, target: 1e12 });
    const res = G.scoreThrow(run, c.hand);
    assert.ok(res.ok, `${id}: ${res.reason}`);
    assert.equal(res.result.handId, c.hand, id);
    try {
      check(tSteps(res, 0), res, run);
    } catch (e) {
      e.message = `${id} ${JSON.stringify(c.values)}: ${e.message}`;
      throw e;
    }
    tested.add(id);
  }
});

test('Sitzfleisch: nur Würfel, die einen Nachwurf lang gehalten wurden', () => {
  const run = roundRun({ talismans: ['sitter'], target: 1e12 });
  G.toggleHold(run, 0);
  G.toggleHold(run, 1);
  assert.ok(G.reroll(run).ok);
  setRolled(run, [6, 6, 6, 2, 3]);
  const res = G.scoreThrow(run, 'triple');
  assert.deepEqual(amounts(tSteps(res), 'mult'), [4, 4]);
  tested.add('sitter');
});

test('Letzte Runde: ×2 nur im letzten Wurf', () => {
  const run = roundRun({ talismans: ['last_call'], values: [6, 6, 1, 2, 3], target: 1e12 });
  let res = G.scoreThrow(run, 'pair');
  assert.equal(tSteps(res).length, 0);
  run.round.throwsLeft = 1;
  G.beginThrow(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [2]);
  tested.add('last_call');
});

test('Hasardeur und Schneeball reagieren auf Nachwürfe', () => {
  let run = roundRun({ talismans: ['gambler'], target: 1e12 });
  G.reroll(run);
  G.reroll(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  let res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [1.5]);
  tested.add('gambler');

  run = roundRun({ talismans: ['snowball'], values: [6, 6, 1, 2, 3], target: 1e12 });
  res = G.scoreThrow(run, 'pair');
  assert.equal(run.talismans[0].state.n, 1);
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [1.1]);
  G.beginThrow(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  G.scoreThrow(run, 'pair');
  assert.equal(run.talismans[0].state.n, 2);
  G.beginThrow(run);
  const r = G.reroll(run);
  assert.ok(r.events.some((e) => e.type === 'talismanGrow'));
  assert.equal(run.talismans[0].state.n, 0, 'geschmolzen');
  setRolled(run, [6, 6, 1, 2, 3]);
  res = G.scoreThrow(run, 'pair');
  assert.equal(tSteps(res).length, 0);
  tested.add('snowball');
});

test('Zündschnur verbraucht Ladungen und verglüht', () => {
  const run = roundRun({ talismans: ['fuse'], values: [6, 6, 1, 2, 3], target: 1e12 });
  let res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [3]);
  assert.equal(run.talismans[0].state.charges, 5);
  run.talismans[0].state.charges = 1;
  G.beginThrow(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [3], 'letzte Ladung wirkt noch');
  assert.ok(res.events.some((e) => e.type === 'talismanBreak'));
  assert.ok(res.result.steps.some((s) => s.type === 'text' && s.text === 'Verglüht!'));
  assert.equal(run.talismans.length, 0);
  // Vorschau zerstört nichts
  const run2 = roundRun({ talismans: ['fuse'], values: [6, 6, 1, 2, 3] });
  run2.talismans[0].state.charges = 1;
  G.previewScore(run2, 'pair');
  assert.equal(run2.talismans.length, 1);
  tested.add('fuse');
});

test('Pechvogel wächst je Klee ohne Glück', () => {
  let grown = 0;
  for (let k = 0; k < 20; k++) {
    const run = roundRun({ seed: `jinx${k}`, talismans: ['jinx'], values: [6, 6, 1, 2, 3], marks: ['clover', 'clover'], target: 1e12 });
    const res = G.scoreThrow(run, 'pair');
    const unlucky = res.result.steps.filter((s) => s.type === 'text' && s.text === 'Kein Glück').length;
    assert.equal(run.talismans[0].state.n, 3 * unlucky);
    if (unlucky) {
      grown++;
      assert.deepEqual(amounts(tSteps(res), 'mult'), [3 * unlucky]);
    }
  }
  assert.ok(grown > 5);
  tested.add('jinx');
});

test('Scherbensammler: doppelte Zerspring-Chance, wächst je Scherbe', () => {
  let shards = 0;
  let total = 0;
  for (let k = 0; k < 40; k++) {
    const run = roundRun({ seed: `shard${k}`, talismans: ['shard_collector'], values: [6, 6, 1, 2, 3], marks: ['glass', 'glass'], target: 1e12 });
    const res = G.scoreThrow(run, 'pair');
    const n = res.result.steps.filter((s) => s.type === 'shatter').length;
    assert.equal(run.talismans[0].state.n, n);
    shards += n;
    total += 2;
  }
  assert.ok(shards / total > 0.35, `Quote ${shards}/${total}`);
  const run = roundRun({ talismans: ['shard_collector'], values: [6, 6, 1, 2, 3], target: 1e12 });
  run.talismans[0].state.n = 2;
  const res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [2]);
  tested.add('shard_collector');
});

test('Dirigent zählt vorher ausgelöste Talismane, Leuchtturm verdoppelt den rechten Nachbarn', () => {
  let run = roundRun({ talismans: ['cup', 'snake_eye', 'conductor', 'prime'], values: [1, 1, 4, 5, 6], target: 1e12 });
  let res = G.scoreThrow(run, 'pair');
  assert.equal(res.result.handId, 'pair');
  assert.deepEqual(amounts(tSteps(res, 2), 'xmult'), [1.4]);
  run = roundRun({ talismans: ['conductor'], values: [1, 1, 4, 6, 6], target: 1e12 });
  res = G.scoreThrow(run, 'pair');
  assert.equal(tSteps(res).length, 0);
  tested.add('conductor');

  run = roundRun({ talismans: ['lighthouse', 'cup'], values: [6, 6, 1, 2, 3], target: 1e12 });
  res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res, 1), 'mult'), [4, 4]);
  assert.equal(retrig(res, 0), 1);
  // rechter Nachbar ohne Hand-Effekt: kein leerer „Nochmal!“-Schritt
  run = roundRun({ talismans: ['lighthouse', 'snake_eye'], values: [6, 6, 1, 2, 3], target: 1e12 });
  res = G.scoreThrow(run, 'pair');
  assert.equal(retrig(res, 0), 0);
  assert.match(G.describeTalisman(run.talismans[0], run), /Schlangenauge/);
  tested.add('lighthouse');
});

test('Recke und Schutzsiegel in Wächter-Partien', () => {
  let run = roundRun({ talismans: ['champion'], values: [6, 6, 1, 2, 3], warden: 'wall' });
  let res = G.scoreThrow(run, 'pair');
  assert.deepEqual(amounts(tSteps(res), 'xmult'), [2]);
  run = roundRun({ talismans: ['champion'], values: [6, 6, 1, 2, 3] });
  res = G.scoreThrow(run, 'pair');
  assert.equal(tSteps(res).length, 0);
  tested.add('champion');

  const base = G.newRun({ seed: 'seal' });
  run = roundRun({ talismans: ['ward_seal'], warden: 'wall' });
  const full = G.blindTarget(base, 'warden', 'wall');
  assert.equal(run.round.target, Math.round(full * 0.8));
  run = roundRun({ talismans: ['ward_seal'] });
  assert.equal(run.round.target, run.blinds[0].target);
  tested.add('ward_seal');
});

test('Zeitschleife: erster Nachwurf jedes Wurfs ist gratis', () => {
  const run = roundRun({ talismans: ['time_loop'], target: 1e12 });
  const n0 = run.round.rerollsLeft;
  assert.ok(G.reroll(run).ok);
  assert.equal(run.round.rerollsLeft, n0);
  assert.ok(G.reroll(run).ok);
  assert.equal(run.round.rerollsLeft, n0 - 1);
  setRolled(run, [6, 6, 1, 2, 3]);
  G.scoreThrow(run, 'pair');
  G.beginThrow(run);
  assert.ok(G.reroll(run).ok);
  assert.equal(run.round.rerollsLeft, n0 - 1);
  // Geizhals: ohne Vorrat geht auch der Gratis-Nachwurf nicht
  const r2 = roundRun({ talismans: ['time_loop'], warden: 'miser' });
  assert.equal(G.reroll(r2).ok, false);
  tested.add('time_loop');
});

function winNow(run, hand) {
  run.round.target = 1;
  G.beginThrow(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  return G.scoreThrow(run, hand);
}

test('Sparschwein, Sternenthron, Goldader am Partieende', () => {
  let run = roundRun({ talismans: ['piggy'], values: [6, 6, 1, 2, 3], target: 1 });
  assert.equal(G.sellPrice(run, { kind: 'talisman', uid: run.talismans[0].uid }), 2);
  let res = G.scoreThrow(run, 'pair');
  assert.ok(res.events.some((e) => e.type === 'talismanGrow'));
  assert.equal(G.sellPrice(run, { kind: 'talisman', uid: run.talismans[0].uid }), 4);
  tested.add('piggy');

  run = roundRun({ talismans: ['star_throne'], values: [6, 6, 1, 2, 3], target: 1 });
  res = G.scoreThrow(run, 'pair');
  assert.equal(run.handLevels.pair, 2);
  assert.ok(res.events.some((e) => e.type === 'levelUp' && e.handId === 'pair'));
  tested.add('star_throne');

  run = roundRun({ talismans: ['gold_vein'], values: [6, 6, 1, 2, 3], target: 1 });
  for (let k = 0; k < 5; k++) run.dice[1].faces[k].mark = 'gold';
  G.scoreThrow(run, 'pair');
  const bd = G.previewCashOut(run);
  assert.ok(bd.some((b) => b.label === 'Goldader' && b.amount === 4), JSON.stringify(bd));
  tested.add('gold_vein');
});

test('Stammkunde, Wühltisch, Zinsfuß, Sterngucker (Laden & Verbrauch)', () => {
  let run = roundRun({ talismans: ['regular'], values: [6, 6, 1, 2, 3], target: 1 });
  G.scoreThrow(run, 'pair');
  G.cashOut(run);
  assert.equal(run.phase, 'shop');
  assert.ok(run.shop.freeRerolls >= 1);
  for (const o of run.shop.offers) if (o.kind === 'talisman') assert.equal(o.price, Math.max(1, G.TALISMANS[o.id].price - 1));
  assert.equal(G.priceFor(run, 6, { kind: 'pack' }), 6);
  assert.equal(G.priceFor(run, 6, { kind: 'talisman' }), 5);
  tested.add('regular');

  run = roundRun({ talismans: ['rummage'], values: [6, 6, 1, 2, 3], target: 1 });
  G.scoreThrow(run, 'pair');
  G.cashOut(run);
  run.money = 50;
  const pi = run.shop.packs.findIndex((p) => G.PACKS[p.id].kind !== 'talisman');
  const pid = run.shop.packs[pi].id;
  const m0 = run.money;
  const r = G.buy(run, { section: 'packs', index: pi });
  assert.ok(r.ok);
  assert.equal(run.pack.choices.length, G.PACKS[pid].size + 1);
  assert.equal(run.money, m0 - run.shop.packs[pi].price + 1);
  tested.add('rummage');

  run = G.newRun({ seed: 'zins' });
  run.money = 20;
  assert.equal(G.interest(run), 4);
  giveTalisman(run, 'compound');
  assert.equal(G.interest(run), 5);
  run.money = 60;
  assert.equal(G.interest(run), 10);
  assert.equal(G.getRoundRules(run).interestCap, 10);
  tested.add('compound');

  run = G.newRun({ seed: 'astro' });
  const t = giveTalisman(run, 'astronomer');
  const c = G.CONSUMABLE_IDS.find((id) => G.CONSUMABLES[id].kind === 'star' && !G.CONSUMABLES[id].target);
  run.consumables.push({ uid: 'c1', id: c }, { uid: 'c2', id: 't_coin' });
  let u = G.useConsumable(run, 'c1', null);
  assert.ok(u.ok, u.reason);
  assert.equal(t.state.n, 3);
  assert.ok(u.events.some((e) => e.type === 'talismanGrow'));
  u = G.useConsumable(run, 'c2', null);
  assert.ok(u.ok, u.reason);
  assert.equal(t.state.n, 4);
  tested.add('astronomer');
});

test('Nachahmer kopiert neue Talismane mit aktuellem Zustand, nicht kopierbare nicht', () => {
  let run = roundRun({ talismans: ['copycat', 'snowball'], values: [6, 6, 1, 2, 3], target: 1e12 });
  run.talismans[1].state.n = 4;
  const res = G.scoreThrow(run, 'pair');
  assert.equal(run.talismans[1].state.n, 5, 'nur das Original wächst');
  assert.deepEqual(amounts(tSteps(res, 0), 'xmult'), [1.4], 'Kopie nutzt den Stand vor dem Wachstum');
  for (const id of NEW_IDS) {
    if (G.TALISMANS[id].copyable !== false) continue;
    run = roundRun({ talismans: ['copycat', id], values: [6, 6, 1, 2, 3], target: 1e12 });
    const r = G.scoreThrow(run, 'pair');
    assert.equal(tSteps(r, 0).length, 0, id);
  }
});

test('Doppelgänger und Seelenstein erreichen neue Talismane', () => {
  const legend = G.TALISMAN_IDS.filter((id) => G.TALISMANS[id].rarity === 'legendary');
  assert.equal(legend.length, 8);
  const got = new Set();
  for (let k = 0; k < 120; k++) {
    const run = G.newRun({ seed: `soul${k}` });
    run.consumables.push({ uid: 'c1', id: 'm_soul' });
    assert.ok(G.useConsumable(run, 'c1', null).ok);
    got.add(run.talismans[0].id);
  }
  for (const id of ['eternal_echo', 'star_throne', 'grand_hall', 'time_loop']) assert.ok(got.has(id), id);
});

test('alle neuen Talismane: getestet, beschreibbar (auch ohne Lauf/Zustand), Badge ohne Fehler', () => {
  assert.equal(NEW_IDS.length, 52);
  const missing = NEW_IDS.filter((id) => !tested.has(id));
  assert.deepEqual(missing, [], 'ohne gezielten Test');
  const run = roundRun({ talismans: NEW_IDS.slice(0, 5), values: [6, 6, 1, 2, 3] });
  for (const id of NEW_IDS) {
    const def = G.TALISMANS[id];
    assert.ok(G.describeTalisman({ id, state: {} }, null).length > 10, id);
    assert.ok(G.describeTalisman({ id, state: {} }, run).length > 10, id);
    const t = { uid: 'x', id, state: newTalismanState(id) };
    assert.ok(G.describeTalisman(t, run).length > 10, id);
    if (def.badge) def.badge(t);
    assert.ok(!/NaN|undefined/.test(G.describeTalisman(t, run)), id);
  }
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const id of NEW_IDS) counts[G.TALISMANS[id].rarity]++;
  assert.deepEqual(counts, { common: 22, uncommon: 17, rare: 9, legendary: 4 });
});
