import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { roundRun, setRolled, giveTalisman } from './helpers.js';

test('15 Wächter mit Daten; Pool nach Einsatz', () => {
  assert.equal(G.WARDEN_IDS.length, 15);
  for (const id of G.WARDEN_IDS) {
    const w = G.WARDENS[id];
    assert.ok(w.name && w.desc && w.glyph && w.hue >= 0, id);
  }
  // Finale nur in Einsatz 8
  for (let s = 0; s < 30; s++) {
    const run = G.newRun({ seed: `w${s}` });
    assert.ok(!G.WARDENS[run.wardens.current].finale);
    assert.ok(G.WARDENS[run.wardens.current].minAnte <= 1);
  }
});

test('Der Bleierne: 1 und 2 zählen nicht', () => {
  const run = roundRun({ warden: 'leaden', values: [1, 1, 2, 2, 5] });
  assert.deepEqual(G.availableHands(run).map((h) => h.handId), ['scatter']);
  setRolled(run, [3, 3, 1, 1, 5]);
  const res = G.scoreThrow(run);
  assert.equal(res.result.handId, 'pair');
});

test('Der Geizhals / Der Einsame / Die Mauer / Der Abgrund: Regeln und Ziele', () => {
  let run = roundRun({ warden: 'miser' });
  assert.equal(run.round.rerollsLeft, 0);
  assert.equal(G.reroll(run).reason, 'Keine Nachwürfe mehr');
  run = roundRun({ warden: 'lonely' });
  assert.equal(run.round.throwsLeft, 1);
  assert.equal(run.round.target, G.anteBase(1));
  run = roundRun({ warden: 'wall' });
  assert.equal(run.round.target, 4 * G.anteBase(1));
  run = roundRun({ warden: 'abyss' });
  assert.equal(run.round.target, 6 * G.anteBase(1));
});

test('Das Echo: keine Hand zweimal; Fehlwurf wenn nichts erlaubt', () => {
  const run = roundRun({ warden: 'echo', values: [3, 3, 1, 2, 6], target: 1e9 });
  G.scoreThrow(run, 'pair');
  G.beginThrow(run);
  setRolled(run, [3, 3, 1, 2, 6]);
  const hands = G.availableHands(run);
  assert.equal(hands.find((h) => h.handId === 'pair').allowed, false);
  assert.equal(G.scoreThrow(run, 'pair').ok, false);
  assert.ok(G.scoreThrow(run).ok, 'Streuung ist noch erlaubt');
  G.beginThrow(run);
  setRolled(run, [3, 3, 1, 2, 6]);
  assert.ok(G.mustFizzle(run));
  const res = G.scoreThrow(run);
  assert.ok(res.ok);
  assert.equal(res.result.fizzle, true);
  assert.equal(res.result.total, 0);
});

test('Die Fixierung: nur Hände, die die erste Hand enthalten', () => {
  const run = roundRun({ warden: 'fixation', values: [3, 3, 1, 2, 6], target: 1e9 });
  G.scoreThrow(run, 'pair');
  G.beginThrow(run);
  setRolled(run, [4, 4, 4, 2, 2]);
  const hands = G.availableHands(run);
  assert.ok(hands.find((h) => h.handId === 'fullhouse').allowed);
  assert.equal(hands.find((h) => h.handId === 'parity').allowed, false);
  assert.equal(hands.find((h) => h.handId === 'scatter').allowed, false);
});

test('Der Nebel: 2 verdeckte Würfel bis zum Werten, Werte zählen trotzdem', () => {
  const run = roundRun({ warden: 'fog' });
  const hidden = run.round.rolled.filter((r) => r.hidden).length;
  assert.equal(hidden, 2);
  G.reroll(run);
  assert.equal(run.round.rolled.filter((r) => r.hidden).length, 2);
  const res = G.beginThrow(run);
  assert.equal(res.ok, false);
  const ev = G.scoreThrow(run);
  assert.ok(ev.ok);
  G.beginThrow(run);
  assert.equal(run.round.rolled.filter((r) => r.hidden).length, 2);
});

test('Die Finsternis: alles verdeckt, Nachwurf deckt auf', () => {
  const run = roundRun({ warden: 'eclipse' });
  assert.ok(run.round.rolled.every((r) => r.hidden));
  G.toggleHold(run, 0);
  G.reroll(run);
  assert.equal(run.round.rolled.filter((r) => r.hidden).length, 1);
});

test('Der Zöllner, Die Fessel, Der Wender', () => {
  let run = roundRun({ warden: 'toll' });
  run.money = 5;
  G.reroll(run);
  assert.equal(run.money, 4);
  run = roundRun({ warden: 'shackle' });
  const i = run.round.rolled.findIndex((r) => r.shackled);
  assert.ok(i >= 0);
  assert.equal(G.toggleHold(run, i).reason, 'Dieser Würfel ist gefesselt');
  run = roundRun({ warden: 'turner' });
  const res = G.reroll(run);
  assert.ok(res.events.some((e) => e.type === 'flip'));
});

test('Der Dieb, Der Groll, Die Kälte', () => {
  const run0 = G.newRun({ seed: 'thief' });
  giveTalisman(run0, 'cup');
  let run = roundRun({ warden: 'thief', talismans: ['cup'], values: [6, 6, 1, 2, 3], target: 1 });
  assert.equal(run.talismans[0].disabled, true);
  let res = G.scoreThrow(run, 'pair');
  assert.equal(res.result.steps.filter((s) => s.source.kind === 'talisman').length, 0);
  assert.equal(run.talismans[0].disabled, false, 'nach der Partie wieder aktiv');

  run = roundRun({ warden: 'grudge', values: [6, 6, 1, 2, 3], target: 1e9 });
  G.scoreThrow(run, 'pair');
  G.beginThrow(run);
  setRolled(run, [6, 6, 1, 2, 3]);
  res = G.scoreThrow(run, 'pair');
  assert.ok(res.result.steps.some((s) => s.type === 'text' && /Groll/.test(s.text)));
  assert.equal(res.result.total, G.HANDS.pair.chips * G.HANDS.pair.mult);

  run = roundRun({ warden: 'chill', values: [6, 6, 1, 2, 3] });
  const h = G.availableHands(run).find((x) => x.handId === 'pair');
  assert.equal(h.base.mult, Math.max(1, Math.floor(G.HANDS.pair.mult / 2)));
});

test('Wächterbann zieht neu, einmal pro Einsatz', () => {
  const run = G.newRun({ seed: 'ban' });
  assert.ok(!G.rerollWarden(run).ok);
  run.vouchers.push('v_ban');
  const before = run.wardens.current;
  const res = G.rerollWarden(run);
  assert.ok(res.ok);
  assert.notEqual(run.wardens.current, before);
  assert.equal(run.blinds[2].wardenId, run.wardens.current);
  assert.equal(G.rerollWarden(run).ok, false);
});
