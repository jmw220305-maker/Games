import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { roundRun, setRolled, stepsOf, giveTalisman } from './helpers.js';

const P = G.HANDS.pair;

test('Paar: Basis + Augen, laufende Werte je Schritt', () => {
  const run = roundRun({ values: [6, 6, 3, 2, 1] });
  const res = G.scoreThrow(run, 'pair');
  assert.ok(res.ok);
  const r = res.result;
  assert.equal(r.handId, 'pair');
  assert.equal(r.handName, 'Paar');
  assert.deepEqual(stepsOf(res), ['hand', 'chips', 'chips']);
  assert.deepEqual(r.steps[0], { type: 'hand', source: { kind: 'hand', index: -1 }, chips: P.chips, mult: P.mult });
  assert.equal(r.steps[1].dieIndex, 0);
  assert.equal(r.steps[1].chips, P.chips + 6);
  assert.equal(r.steps[2].dieIndex, 1);
  assert.equal(r.steps[2].chips, P.chips + 12);
  assert.equal(r.total, (P.chips + 12) * P.mult);
  assert.equal(r.scoreBefore, 0);
  assert.equal(r.scoreAfter, r.total);
  assert.equal(run.round.score, r.total);
  assert.equal(run.round.throwsLeft, run.base.throws - 1);
  assert.equal(run.round.rolled, null, 'Würfel werden freigegeben');
});

test('Standardwahl ist die ranghöchste Hand; enthaltene Hand wählbar', () => {
  const run = roundRun({ values: [4, 4, 4, 2, 2] });
  const hands = G.availableHands(run);
  assert.equal(hands[0].handId, 'fullhouse');
  assert.ok(hands.every((h, i) => i === 0 || h.rank <= hands[i - 1].rank));
  assert.deepEqual(hands[0].base, G.handBase('fullhouse', 1));
  assert.equal(hands[0].level, 1);
  const pv = G.previewHand(run);
  assert.equal(pv.handId, 'fullhouse');
  const res = G.scoreThrow(run, 'triple');
  assert.equal(res.result.handId, 'triple');
  assert.deepEqual(res.result.dice, [0, 1, 2]);
  assert.equal(G.scoreThrow(run, 'pair').ok, false, 'nach dem Werten liegen keine Würfel');
});

test('Reihenfolge: Augen → Material → Prägung → Talisman je Würfel, dann Talismane auf die Hand', () => {
  const run = roundRun({ talismans: ['snake_eye', 'cup'], values: [1, 1, 3, 4, 6], marks: ['ruby'] });
  run.dice[0].material = 'bone';
  const res = G.scoreThrow(run, 'pair');
  const st = res.result.steps;
  const compact = st.map((s) => `${s.type}:${s.source.kind}${s.dieIndex !== undefined ? '@' + s.dieIndex : ''}`);
  assert.deepEqual(compact, [
    'hand:hand',
    'chips:die@0', // Augen
    'chips:die@0', // Knochen
    'mult:face@0', // Rubin
    'mult:talisman@0', // Schlangenauge
    'chips:die@1',
    'mult:talisman@1',
    'mult:talisman', // Lederbecher
  ]);
  const last = st[st.length - 1];
  assert.equal(last.chips, P.chips + 1 + 2 + 1);
  assert.equal(last.mult, P.mult + 4 + 8 + 8 + 4);
  assert.equal(st[4].source.index, 0);
  assert.equal(st[4].source.uid, run.talismans[0].uid);
  assert.equal(res.result.total, last.chips * last.mult);
});

test('Wiederholung: retrigger-Schritt vor der Wiederholung (Echo-Prägung und Talisman)', () => {
  const run = roundRun({ talismans: ['sixpack'], values: [6, 6, 2, 3, 1], marks: ['echo'] });
  const res = G.scoreThrow(run, 'pair');
  const compact = res.result.steps.map((s) => `${s.type}@${s.dieIndex ?? '-'}`);
  assert.deepEqual(compact, ['hand@-', 'chips@0', 'chips@0', 'retrigger@0', 'chips@0', 'chips@0', 'chips@1', 'chips@1']);
  const rt = res.result.steps[3];
  assert.deepEqual(rt.source, { kind: 'face', index: 0 });
  assert.equal(res.result.total, (P.chips + 3 * 6 + 3 * 40) * P.mult);

  const run2 = roundRun({ talismans: ['center'], values: [1, 2, 5, 5, 6] });
  const r2 = G.scoreThrow(run2, 'pair');
  const rts = r2.result.steps.filter((s) => s.type === 'retrigger');
  assert.equal(rts.length, 1);
  assert.equal(rts[0].dieIndex, 2);
  assert.equal(rts[0].source.kind, 'talisman');
});

test('Stein wertet immer mit, Glas ×2 und zerspringt manchmal, Kristall rundet erst am Ende', () => {
  const run = roundRun({ values: [5, 5, 1, 2, 3], marks: [undefined, undefined, undefined, undefined, 'stone'] });
  const res = G.scoreThrow(run, 'pair');
  assert.deepEqual(res.result.dice, [0, 1, 4]);
  assert.equal(res.result.total, (P.chips + 10 + 50) * P.mult);

  let shattered = 0;
  for (let k = 0; k < 40; k++) {
    const r = roundRun({ seed: `glass${k}`, values: [5, 5, 1, 2, 3], marks: ['glass'] });
    const out = G.scoreThrow(r, 'pair');
    assert.ok(out.result.steps.some((s) => s.type === 'xmult' && s.factor === 2));
    if (out.result.steps.some((s) => s.type === 'shatter')) {
      shattered++;
      assert.deepEqual(r.dice[0].faces[4], { v: 0, mark: null });
      assert.ok(out.events.some((e) => e.type === 'faceShatter'));
    }
  }
  assert.ok(shattered > 2 && shattered < 25, `zersprungen: ${shattered}`);

  const c = roundRun({ values: [3, 3, 1, 2, 6] });
  c.dice[0].material = 'crystal';
  c.dice[1].material = 'crystal';
  const out = G.scoreThrow(c, 'pair');
  assert.equal(out.result.total, Math.floor((P.chips + 6) * P.mult * 2.25));
});

test('Klee, Gold, Azur, Prisma', () => {
  const run = roundRun({ values: [4, 4, 1, 2, 6], marks: ['gold', 'azure'] });
  run.dice[1].material = 'prism';
  const m0 = run.money;
  const res = G.scoreThrow(run, 'pair');
  const types = stepsOf(res);
  assert.deepEqual(types, ['hand', 'chips', 'money', 'chips', 'mult', 'chips']);
  assert.equal(run.money, m0 + 1);
  assert.equal(res.result.total, (P.chips + 8 + 30) * (P.mult + 10));
  let lucky = 0;
  for (let k = 0; k < 60; k++) {
    const r = roundRun({ seed: `clover${k}`, values: [4, 4, 1, 2, 6], marks: ['clover'] });
    const out = G.scoreThrow(r, 'pair');
    if (out.result.steps.some((s) => s.type === 'mult' && s.amount === 20)) lucky++;
  }
  assert.ok(lucky > 3 && lucky < 25, `Klee-Glück ${lucky}/60`);
});

test('Stern (wild) wertet mit gewähltem Wert', () => {
  const run = roundRun({ values: [6, 6, 6, 6, 1], marks: [undefined, undefined, undefined, undefined, 'star'] });
  const hands = G.availableHands(run);
  assert.equal(hands[0].handId, 'pasch');
  const res = G.scoreThrow(run);
  const H = G.HANDS.pasch;
  assert.equal(res.result.total, (H.chips + 30) * H.mult);
});

test('große Zahlen bleiben endlich', () => {
  const run = roundRun({ values: [6, 6, 6, 6, 6] });
  for (const d of run.dice) d.material = 'crystal';
  for (let i = 0; i < 6; i++) giveTalisman(run, 'philosopher');
  run.handLevels.pasch = 200;
  const res = G.scoreThrow(run);
  assert.ok(Number.isFinite(res.result.total));
  assert.ok(res.result.total > 1e8);
});

test('Sieg bei Ziel, $ je übrigem Wurf in der Abrechnung', () => {
  const run = roundRun({ values: [6, 6, 6, 6, 6], target: 100 });
  const res = G.scoreThrow(run);
  assert.ok(res.result.cleared);
  assert.ok(res.events.some((e) => e.type === 'roundWon'));
  assert.equal(run.phase, 'cashout');
  const bd = G.previewCashOut(run);
  assert.ok(bd.some((b) => b.kind === 'throws' && b.amount === 3));
});

test('Niederlage, wenn die Würfe ausgehen', () => {
  const run = roundRun({ target: 1e9 });
  for (let k = 0; k < run.base.throws; k++) {
    if (!run.round.rolled) G.beginThrow(run);
    const res = G.scoreThrow(run);
    assert.ok(res.ok);
  }
  assert.equal(run.phase, 'lost');
  assert.equal(run.stats.lostTo.blind, 'small');
  assert.equal(G.beginThrow(run).ok, false);
});
