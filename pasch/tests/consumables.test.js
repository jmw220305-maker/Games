import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { addConsumable } from '../src/game/inventory.js';
import { roundRun, giveTalisman, setRolled } from './helpers.js';

function withItem(id, run = G.newRun({ seed: 'cons' })) {
  run.limits.consumables = Math.max(run.limits.consumables, run.consumables.length + 1);
  const c = addConsumable(run, id);
  return { run, c };
}

test('alle Sternbilder: Stufe +1', () => {
  for (const id of G.CONSUMABLE_IDS.filter((x) => G.CONSUMABLES[x].kind === 'star')) {
    const { run, c } = withItem(id);
    const hand = G.CONSUMABLES[id].hand;
    const res = G.useConsumable(run, c.uid, null);
    assert.ok(res.ok, id);
    assert.equal(run.handLevels[hand], 2);
    assert.equal(run.consumables.length, 0);
    assert.ok(res.events.some((e) => e.type === 'levelUp' && e.handId === hand));
    assert.equal(run.stats.constellationsUsed, 1);
  }
  assert.equal(G.CONSUMABLE_IDS.filter((x) => G.CONSUMABLES[x].kind === 'star').length, 12);
});

test('Prägungs-Werkzeuge setzen Prägungen, mit Zielprüfung', () => {
  const cases = [['t_gold', 'gold', 1], ['t_ruby', 'ruby', 1], ['t_azure', 'azure', 2], ['t_echo', 'echo', 1], ['t_glass', 'glass', 2], ['t_stone', 'stone', 1], ['t_clover', 'clover', 2], ['m_star', 'star', 1]];
  for (const [id, mark, count] of cases) {
    const { run, c } = withItem(id);
    assert.equal(G.useConsumable(run, c.uid, null).ok, false, `${id} ohne Ziel`);
    if (count === 1) {
      assert.equal(G.useConsumable(run, c.uid, { die: 9, face: 0 }).reason, 'Würfel wählen');
      assert.equal(G.useConsumable(run, c.uid, { die: 0, face: 7 }).reason, 'Fläche wählen');
      const res = G.useConsumable(run, c.uid, { die: 1, face: 5 });
      assert.ok(res.ok, id);
      assert.equal(run.dice[1].faces[5].mark, mark);
    } else {
      assert.equal(G.useConsumable(run, c.uid, { faces: [{ die: 0, face: 0 }, { die: 0, face: 0 }] }).ok, false);
      assert.equal(G.useConsumable(run, c.uid, { faces: [{ die: 0, face: 0 }, { die: 1, face: 1 }, { die: 2, face: 2 }] }).ok, false);
      const res = G.useConsumable(run, c.uid, { faces: [{ die: 0, face: 0 }, { die: 2, face: 3 }] });
      assert.ok(res.ok, id);
      assert.equal(run.dice[0].faces[0].mark, mark);
      assert.equal(run.dice[2].faces[3].mark, mark);
    }
    assert.equal(run.consumables.length, 0);
  }
});

test('Meißel, Spiegel, Bleiguss, Former', () => {
  let { run, c } = withItem('t_chisel');
  assert.equal(G.useConsumable(run, c.uid, { die: 0, face: 0, value: 9 }).ok, false);
  assert.equal(G.useConsumable(run, c.uid, { die: 0, face: 0 }).ok, false);
  assert.ok(G.useConsumable(run, c.uid, { die: 0, face: 0, value: 6 }).ok);
  assert.equal(run.dice[0].faces[0].v, 6);

  ({ run, c } = withItem('t_mirror'));
  run.dice[0].faces[5].mark = 'ruby';
  assert.equal(G.useConsumable(run, c.uid, { faces: [{ die: 0, face: 5 }, { die: 1, face: 0 }] }).ok, false, 'selber Würfel');
  assert.equal(G.useConsumable(run, c.uid, { faces: [{ die: 0, face: 5 }] }).ok, false, 'genau 2');
  assert.ok(G.useConsumable(run, c.uid, { faces: [{ die: 0, face: 5 }, { die: 0, face: 0 }] }).ok);
  assert.deepEqual(run.dice[0].faces[0], { v: 6, mark: 'ruby' });

  ({ run, c } = withItem('t_lead'));
  assert.ok(G.useConsumable(run, c.uid, { die: 3 }).ok);
  assert.equal(run.dice[3].material, 'lead');
  // Blei: höchste Fläche ~ doppelt so oft
  const { faceWeights } = await_import_dice;
  assert.deepEqual(faceWeights(run.dice[3]), [1, 1, 1, 1, 1, 2]);

  ({ run, c } = withItem('t_shaper'));
  assert.ok(G.useConsumable(run, c.uid, { die: 2 }).ok);
  assert.equal(run.dice[2].sides, 8);
  assert.deepEqual(run.dice[2].faces.map((f) => f.v), [1, 2, 3, 4, 5, 6, 7, 8]);
  ({ c } = withItem('t_shaper', run));
  assert.equal(G.useConsumable(run, c.uid, { die: 2 }).reason, 'Nur ein W6 kann geformt werden');
});

import * as diceMod from '../src/game/dice.js';
const await_import_dice = diceMod;

test('Münzwurf, Seher', () => {
  let { run, c } = withItem('t_coin');
  run.money = 13;
  G.useConsumable(run, c.uid, null);
  assert.equal(run.money, 26);
  ({ c } = withItem('t_coin', run));
  run.money = 40;
  G.useConsumable(run, c.uid, null);
  assert.equal(run.money, 60, 'max. +$20');

  ({ run, c } = withItem('t_seer'));
  run.limits.consumables = 2;
  const res = G.useConsumable(run, c.uid, null);
  assert.ok(res.ok);
  assert.equal(run.consumables.length, 2);
  assert.ok(run.consumables.every((x) => G.CONSUMABLES[x.id].kind === 'star'));
});

test('Stupser und Wende nur im Wurf', () => {
  let { run, c } = withItem('t_nudge');
  assert.equal(G.useConsumable(run, c.uid, { rolled: 0, delta: 1 }).reason, 'Nur während eines Wurfs benutzbar');
  run = roundRun({ values: [3, 5, 1, 2, 6] });
  ({ c } = withItem('t_nudge', run));
  assert.equal(G.useConsumable(run, c.uid, { rolled: 4, delta: 1 }).ok, false, 'über 6 hinaus');
  assert.equal(G.useConsumable(run, c.uid, { rolled: 0 }).ok, false, 'Richtung fehlt');
  assert.ok(G.useConsumable(run, c.uid, { rolled: 1, delta: -1 }).ok);
  assert.equal(run.round.rolled[1].v, 4);
  assert.equal(run.round.rolled[1].nudged, -1);
  assert.equal(G.availableHands(run)[0].handId, 'smallrun');
  ({ c } = withItem('t_flip', run));
  assert.ok(G.useConsumable(run, c.uid, { rolled: 1 }).ok);
  assert.equal(run.round.rolled[1].v, 2, 'Gegenseite der 5');
  assert.equal(run.round.rolled[1].nudged, 0);
  // verdeckte Würfel nicht
  run.round.rolled[2].hidden = true;
  ({ c } = withItem('t_flip', run));
  assert.equal(G.useConsumable(run, c.uid, { rolled: 2 }).ok, false);
});

test('Mystik: Prisma, Kristall, Phantom, Doppelgänger, Seelenstein, Wunschbrunnen', () => {
  let { run, c } = withItem('m_prism');
  G.useConsumable(run, c.uid, { die: 0 });
  assert.equal(run.dice[0].material, 'prism');
  ({ c } = withItem('m_crystal', run));
  G.useConsumable(run, c.uid, { die: 1 });
  assert.equal(run.dice[1].material, 'crystal');
  ({ c } = withItem('m_phantom', run));
  G.useConsumable(run, c.uid, null);
  assert.equal(run.dice.length, 6);
  assert.equal(run.dice[5].material, 'phantom');

  ({ run, c } = withItem('m_double'));
  assert.equal(G.useConsumable(run, c.uid, null).reason, 'Du hast keinen Talisman');
  giveTalisman(run, 'cup');
  run.limits.talismans = 5;
  assert.ok(G.useConsumable(run, c.uid, null).ok);
  assert.deepEqual(run.talismans.map((t) => t.id), ['cup', 'cup']);

  ({ run, c } = withItem('m_soul'));
  assert.ok(G.useConsumable(run, c.uid, null).ok);
  assert.equal(G.TALISMANS[run.talismans[0].id].rarity, 'legendary');
  run.limits.talismans = 1;
  ({ c } = withItem('m_soul', run));
  assert.equal(G.useConsumable(run, c.uid, null).reason, 'Kein freier Talismanplatz');
  assert.equal(run.consumables.length, 1, 'bleibt bei Fehler erhalten');

  ({ run, c } = withItem('m_wish'));
  run.money = 17;
  G.useConsumable(run, c.uid, null);
  assert.equal(run.money, 0);
  assert.ok(Object.values(run.handLevels).every((l) => l === 2));
});

test('alle Verbrauchsgüter haben Darstellung und sind benutzbar beschrieben', () => {
  for (const id of G.CONSUMABLE_IDS) {
    const d = G.CONSUMABLES[id];
    assert.ok(d.name && d.desc && d.glyph && d.glyph.length <= 3 && d.hue >= 0 && d.hue <= 360, id);
    assert.ok(['star', 'tool', 'mystic'].includes(d.kind));
    assert.ok(typeof d.use === 'function');
    assert.ok(G.describeConsumable({ id }, G.newRun({ seed: 'x' })).length > 3);
  }
  assert.equal(G.CONSUMABLE_IDS.filter((x) => G.CONSUMABLES[x].kind === 'tool').length, 15);
  assert.equal(G.CONSUMABLE_IDS.filter((x) => G.CONSUMABLES[x].kind === 'mystic').length, 7);
});

test('Werkzeug während eines Wurfs ändert die gezeigte Fläche sofort', () => {
  const run = roundRun({ values: [2, 5, 1, 3, 6] });
  const { c } = withItem('t_chisel', run);
  const fi = run.round.rolled[0].faceIndex;
  assert.ok(G.useConsumable(run, c.uid, { die: 0, face: fi, value: 5 }).ok);
  assert.equal(run.round.rolled[0].v, 5);
  assert.equal(G.availableHands(run)[0].handId, 'pair');
  setRolled(run, [1, 1, 1, 1, 1]);
});
