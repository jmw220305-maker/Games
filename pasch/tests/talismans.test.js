import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { roundRun, giveTalisman, setRolled } from './helpers.js';

const SCENARIOS = [
  { values: [1, 1, 3, 4, 6] },
  { values: [6, 6, 6, 6, 6] },
  { values: [2, 3, 4, 5, 6] },
  { values: [1, 2, 1, 2, 1] },
  { values: [2, 2, 4, 4, 6], marks: ['gold', 'ruby'] },
  { values: [5, 5, 3, 2, 1], marks: ['clover', 'clover', 'echo'] },
];

// Talismane, die nicht direkt in der Wertung Schritte erzeugen
const PASSIVE = new Set(['stocking', 'hoard', 'rebate', 'tower', 'stamina', 'second_wind', 'sixth_sense', 'fate', 'fairy', 'copycat', 'spirit', 'patience']);

test('Sammeltest: jeder Talisman wertet in mehreren Würfen ohne Fehler und löst aus', () => {
  for (const id of G.TALISMAN_IDS) {
    let fired = 0;
    for (const sc of SCENARIOS) {
      const run = roundRun({ talismans: [id, 'cup'], values: sc.values, marks: sc.marks });
      run.money = 30;
      G.toggleHold(run, 0);
      const hands = G.availableHands(run);
      for (const h of hands) {
        const pv = G.previewScore(run, h.handId);
        assert.ok(pv && Number.isFinite(pv.total), `${id}/${h.handId}`);
        if (pv.steps.some((s) => s.source.kind === 'talisman' && s.source.index === 0)) fired++;
      }
      const res = G.scoreThrow(run);
      assert.ok(res.ok, `${id}: ${res.reason}`);
      assert.ok(Number.isFinite(res.result.total));
      // describe liefert Text
      const t = run.talismans.find((x) => x.id === id);
      if (t) assert.ok(G.describeTalisman(t, run).length > 5);
    }
    if (!PASSIVE.has(id)) assert.ok(fired > 0, `${id} hat nie ausgelöst`);
  }
});

test('alle Talismane haben Daten für die Darstellung', () => {
  assert.equal(G.TALISMAN_IDS.length, 48);
  for (const id of G.TALISMAN_IDS) {
    const t = G.TALISMANS[id];
    assert.ok(t.name && t.desc && t.glyph && t.glyph.length <= 3, id);
    assert.ok(t.hue >= 0 && t.hue <= 360, id);
    assert.ok(['common', 'uncommon', 'rare', 'legendary'].includes(t.rarity), id);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t.glyph) || /^[☀-➿⬀-⯿]+$/u.test(t.glyph), `${id}: Emoji?`);
  }
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const id of G.TALISMAN_IDS) counts[G.TALISMANS[id].rarity]++;
  assert.deepEqual(counts, { common: 20, uncommon: 15, rare: 9, legendary: 4 });
});

const mults = (res, i) => res.result.steps.filter((s) => s.source.kind === 'talisman' && s.source.index === i);

test('Bedingungen einzelner gewöhnlicher Talismane', () => {
  const check = (id, values, hand, expect) => {
    const run = roundRun({ talismans: [id], values });
    const res = G.scoreThrow(run, hand);
    const st = mults(res, 0);
    expect(st, res);
  };
  check('snake_eye', [1, 1, 3, 4, 6], 'pair', (st) => assert.deepEqual(st.map((s) => s.amount), [8, 8]));
  check('sixpack', [6, 6, 3, 4, 1], 'pair', (st) => assert.deepEqual(st.map((s) => s.amount), [40, 40]));
  check('even_line', [2, 2, 4, 1, 3], 'pair', (st) => assert.equal(st[0].amount, 10));
  check('even_line', [3, 3, 4, 1, 2], 'pair', (st) => assert.equal(st.length, 0));
  check('odd_bird', [3, 3, 4, 1, 2], 'pair', (st) => assert.equal(st[0].amount, 10));
  check('twin_bell', [4, 4, 4, 2, 2], 'fullhouse', (st) => assert.equal(st[0].amount, 8));
  check('twin_bell', [1, 2, 3, 4, 6], 'smallrun', (st) => assert.equal(st.length, 0));
  check('triad', [4, 4, 4, 2, 2], 'fullhouse', (st) => assert.equal(st[0].amount, 12));
  check('ladder', [2, 3, 4, 5, 6], 'bigrun', (st) => assert.equal(st[0].amount, 12));
  check('pip_counter', [1, 1, 3, 4, 6], 'pair', (st) => assert.equal(st[0].amount, 3 * 15));
  check('deep_dive', [1, 1, 3, 2, 2], 'twopair', (st) => assert.equal(st[0].amount, 15));
  check('high_tide', [6, 6, 6, 5, 1], 'triple', (st) => assert.equal(st[0].amount, 80));
  check('lucky_seven', [1, 6, 6, 3, 4], 'pair', (st) => assert.equal(st[0].amount, 7 * 3));
  check('prime', [2, 2, 3, 1, 6], 'pair', (st) => assert.deepEqual(st.map((s) => s.amount), [5, 5]));
  check('cup', [2, 2, 3, 1, 6], 'pair', (st) => assert.equal(st[0].amount, 4));
  check('high_roller', [5, 5, 3, 1, 6], 'pair', (st) => assert.deepEqual(st.map((s) => s.amount), [30, 30]));
  check('lucky_penny', [6, 6, 3, 1, 2], 'pair', (st) => assert.deepEqual(st.map((s) => s.type), ['money', 'money']));
  check('domino', [3, 5, 5, 1, 2], 'pair', (st) => assert.deepEqual(st.map((s) => s.amount), [3, 5]));
  check('collector', [3, 5, 5, 1, 2], 'pair', (st) => assert.equal(st[0].amount, 12));
  check('modesty', [3, 5, 5, 1, 2], 'pair', (st) => assert.equal(st[0].factor, 2));
  check('modesty', [5, 5, 5, 1, 2], 'triple', (st) => assert.equal(st.length, 0));
  check('pentagram', [5, 5, 5, 5, 5], 'pasch', (st) => assert.equal(st[0].factor, 4));
  check('philosopher', [6, 6, 1, 2, 4], 'pair', (st) => assert.deepEqual(st.map((s) => s.factor), [1.25, 1.25]));
  check('loaded', [6, 6, 1, 2, 4], 'pair', (st) => assert.equal(st[0].factor, 1.5));
  check('crown', [6, 6, 1, 2, 4], 'pair', (st) => assert.equal(st[0].factor, 3));
  check('hollow_king', [6, 6, 1, 2, 4], 'pair', (st) => assert.equal(st[0].factor, 5));
  check('croupier', [6, 6, 1, 2, 4], 'pair', (st) => assert.equal(st.length, 0));
});

test('Geduld, Erster Wurf, Uhrwerk, Würfelgeist, Rabatt hängen an Nachwürfen', () => {
  const run = roundRun({ talismans: ['patience', 'first_throw', 'clockwork', 'spirit', 'rebate'], target: 1e9 });
  setRolled(run, [6, 6, 1, 2, 3]);
  let pv = G.previewScore(run, 'pair');
  const by = (i) => pv.steps.filter((s) => s.source.kind === 'talisman' && s.source.index === i);
  assert.equal(by(0)[0].amount, 4 * run.round.rerollsLeft);
  assert.equal(by(1)[0].factor, 2);
  assert.equal(pv.steps.filter((s) => s.type === 'retrigger').length, 2);
  const m0 = run.money;
  for (let k = 0; k < 3; k++) assert.ok(G.reroll(run).ok);
  assert.equal(run.money, m0 + 3, 'Rabatt');
  assert.equal(run.talismans[3].state.n, 3, 'Würfelgeist');
  setRolled(run, [6, 6, 1, 2, 3]);
  pv = G.previewScore(run, 'pair');
  assert.equal(by(0).length, 0);
  assert.equal(by(1).length, 0);
  assert.equal(pv.steps.filter((s) => s.type === 'retrigger').length, 0);
  assert.equal(by(3)[0].amount, 3);
  assert.equal(G.reroll(run).ok, false);
});

test('Kerbholz, Schwung, Kerbbrett wachsen', () => {
  const run = roundRun({ talismans: ['tally', 'momentum', 'tally_board'], values: [6, 6, 1, 2, 3], target: 1e9 });
  let res = G.scoreThrow(run, 'pair');
  assert.equal(run.talismans[0].state.n, 5);
  assert.equal(run.talismans[1].state.n, 1);
  assert.ok(res.result.steps.some((s) => s.type === 'grow'));
  assert.ok(res.events.some((e) => e.type === 'talismanGrow'));
  G.beginThrow(run);
  setRolled(run, [6, 6, 6, 6, 3]);
  res = G.scoreThrow(run, 'quad');
  assert.equal(run.talismans[0].state.n, 10);
  assert.equal(run.talismans[1].state.n, 2);
  assert.equal(run.talismans[2].state.n, 1);
  G.beginThrow(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  G.scoreThrow(run, 'pair');
  assert.equal(run.talismans[1].state.n, 0, 'Schwung zurückgesetzt');
});

test('Echokammer, Kettenreaktion, Unendlichkeit, Klebrige Finger, Goldrausch, Croupier', () => {
  let run = roundRun({ talismans: ['echo_chamber'], values: [4, 4, 4, 2, 2] });
  let res = G.scoreThrow(run, 'fullhouse');
  assert.equal(res.result.steps.filter((s) => s.type === 'retrigger').length, 3);
  run = roundRun({ talismans: ['chain'], values: [2, 3, 4, 5, 1] });
  res = G.scoreThrow(run, 'bigrun');
  assert.equal(res.result.steps.filter((s) => s.type === 'retrigger').length, 5);
  run = roundRun({ talismans: ['infinity'], values: [6, 6, 1, 2, 3] });
  res = G.scoreThrow(run, 'pair');
  assert.equal(res.result.steps.filter((s) => s.type === 'retrigger').length, 5);
  run = roundRun({ talismans: ['sticky'], values: [6, 6, 1, 2, 3] });
  G.toggleHold(run, 0);
  res = G.scoreThrow(run, 'pair');
  assert.equal(res.result.steps.filter((s) => s.source.kind === 'talisman').length, 1);
  run = roundRun({ talismans: ['gold_rush', 'croupier'], values: [6, 6, 1, 2, 3], marks: ['gold'] });
  const m0 = run.money;
  res = G.scoreThrow(run, 'pair');
  assert.equal(run.money, m0 + 2);
  assert.ok(res.result.steps.some((s) => s.type === 'xmult' && s.factor === 1.25));
});

test('Nachahmer kopiert den rechten Nachbarn', () => {
  const run = roundRun({ talismans: ['copycat', 'cup'], values: [6, 6, 1, 2, 3] });
  const res = G.scoreThrow(run, 'pair');
  const t = res.result.steps.filter((s) => s.source.kind === 'talisman');
  assert.deepEqual(t.map((s) => [s.source.index, s.amount]), [[0, 4], [1, 4]]);
  assert.match(G.describeTalisman(run.talismans[0], run), /Lederbecher/);
  // nicht kopierbar
  const run2 = roundRun({ talismans: ['copycat', 'tower'], values: [6, 6, 1, 2, 3] });
  const r2 = G.scoreThrow(run2, 'pair');
  assert.equal(r2.result.steps.filter((s) => s.source.kind === 'talisman').length, 0);
});

test('Hauptbuch, Hohler König', () => {
  const run = roundRun({ talismans: ['ledger', 'hollow_king'], values: [6, 6, 1, 2, 3] });
  run.money = 25;
  run.limits.talismans = 5;
  const res = G.scoreThrow(run, 'pair');
  const x = res.result.steps.filter((s) => s.type === 'xmult').map((s) => s.factor);
  assert.deepEqual(x, [1.5, 4]);
});

test('Regel-Talismane: Würfelturm, Ausdauer, Gezinkt, Hamsterbecher', () => {
  const run = G.newRun({ seed: 'rules' });
  giveTalisman(run, 'tower');
  giveTalisman(run, 'stamina');
  let rules = G.getRoundRules(run);
  assert.equal(rules.rerolls, run.base.rerolls + 1);
  assert.equal(rules.throws, run.base.throws + 1);
  giveTalisman(run, 'loaded');
  assert.equal(G.getRoundRules(run).rerolls, run.base.rerolls);
  const h = giveTalisman(run, 'hoard');
  h.state.carry = 2;
  assert.equal(G.getRoundRules(run).rerolls, run.base.rerolls + 2);
  // Übertrag am Partieende
  const r2 = roundRun({ talismans: ['hoard'], values: [6, 6, 6, 6, 6], target: 1 });
  G.scoreThrow(r2);
  assert.equal(r2.talismans[0].state.carry, 3);
});

test('Bröckelnde Krone verliert ×0,25 je Partie und zerbricht', () => {
  const run = roundRun({ talismans: ['crown'], values: [6, 6, 6, 6, 6], target: 1 });
  run.talismans[0].state.x = 1.25;
  const res = G.scoreThrow(run);
  assert.ok(res.events.some((e) => e.type === 'talismanBreak'));
  assert.equal(run.talismans.length, 0);
});

test('Sparstrumpf zahlt in der Abrechnung', () => {
  const run = roundRun({ talismans: ['stocking'], values: [6, 6, 6, 6, 6], target: 1 });
  G.scoreThrow(run);
  const bd = G.previewCashOut(run);
  assert.ok(bd.some((b) => b.label === 'Sparstrumpf' && b.amount === 2));
});

test('Zweiter Atem gibt einmal einen weiteren Wurf', () => {
  const run = roundRun({ talismans: ['second_wind'], target: 1e9 });
  run.round.throwsLeft = 1;
  let res = G.scoreThrow(run);
  assert.ok(res.events.some((e) => e.type === 'extraThrow'));
  assert.equal(run.round.throwsLeft, 1);
  assert.equal(run.phase, 'round');
  G.beginThrow(run);
  res = G.scoreThrow(run);
  assert.equal(run.phase, 'lost');
});

test('Sechster Sinn: zusätzlicher W6, beim Verkauf wieder weg', () => {
  const run = G.newRun({ seed: 'six' });
  const t = giveTalisman(run, 'sixth_sense');
  assert.equal(run.dice.length, 6);
  assert.equal(run.dice[5].src, t.uid);
  assert.ok(G.sell(run, { kind: 'talisman', uid: t.uid }).ok);
  assert.equal(run.dice.length, 5);
});

test('Schicksalsweber: Einsen sind wild; Glücksfee verdoppelt Klee', () => {
  const run = roundRun({ talismans: ['fate'], values: [1, 6, 6, 6, 6] });
  assert.equal(G.availableHands(run)[0].handId, 'pasch');
  let boosts = 0;
  for (let k = 0; k < 40; k++) {
    const r = roundRun({ seed: `fee${k}`, talismans: ['fairy'], values: [4, 4, 1, 2, 6], marks: ['clover', 'clover'] });
    const out = G.scoreThrow(r, 'pair');
    if (out.result.steps.some((s) => s.source.kind === 'talisman' && s.type === 'xmult')) boosts++;
  }
  assert.ok(boosts >= 10, `Glücksfee ${boosts}/40`);
});
