import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { roundRun } from './helpers.js';

const M = G.meta;

test('neues Profil und Migration', () => {
  const p = M.newProfile();
  assert.deepEqual(p.unlocks.cups, ['wood']);
  assert.equal(M.maxStake(p, 'wood'), 1);
  assert.equal(M.maxStake(p, 'red'), 0);
  const m = M.migrateProfile({ stats: { runs: 3 }, settings: { speed: 2 } });
  assert.equal(m.stats.runs, 3);
  assert.equal(m.settings.speed, 2);
  assert.equal(m.settings.volume.master, 0.8);
  assert.deepEqual(M.migrateProfile(null), M.newProfile());
  assert.ok(G.ACHIEVEMENT_IDS.length >= 20 && G.ACHIEVEMENT_IDS.length <= 30);
  for (const id of G.ACHIEVEMENT_IDS) {
    const a = G.ACHIEVEMENTS[id];
    assert.ok(a.name && a.desc && a.glyph && a.hue >= 0);
  }
  // jeder Becher außer Holz wird von einem Erfolg freigeschaltet
  for (const id of G.CUP_IDS.filter((c) => c !== 'wood')) {
    assert.ok(G.ACHIEVEMENT_IDS.some((a) => G.ACHIEVEMENTS[a].unlocks && G.ACHIEVEMENTS[a].unlocks.id === id), id);
    assert.equal(G.ACHIEVEMENTS[G.CUPS[id].unlock].unlocks.id, id);
  }
});

test('Erfolge während des Laufs, Sammlung, Pasch schaltet Gezinkten Becher frei', () => {
  const p = M.newProfile();
  const run = roundRun({ values: [5, 5, 5, 5, 5], target: 1e9 });
  G.scoreThrow(run);
  const ev = M.syncProfile(p, run);
  assert.ok(ev.some((e) => e.type === 'achievement' && e.id === 'first_throw'));
  assert.ok(ev.some((e) => e.type === 'achievement' && e.id === 'pasch'));
  assert.ok(ev.some((e) => e.type === 'unlock' && e.kind === 'cup' && e.id === 'loaded'));
  assert.ok(M.isCupUnlocked(p, 'loaded'));
  assert.equal(M.syncProfile(p, run).length, 0, 'idempotent');
  assert.equal(p.collection.hands.pasch, 1);
  assert.ok(Object.keys(p.collection.wardens).length >= 1);
});

test('Laufende verbucht Statistik einmal, Sieg schaltet Stufe und Becher frei', () => {
  const p = M.newProfile();
  for (let k = 0; k < 5; k++) {
    const run = roundRun({ seed: `m${k}`, target: 1e9 });
    while (run.phase === 'round') {
      if (!run.round.rolled) G.beginThrow(run);
      G.scoreThrow(run);
    }
    M.finishRun(p, run);
    M.finishRun(p, run);
  }
  assert.equal(p.stats.runs, 5);
  assert.equal(p.stats.losses, 5);
  assert.equal(p.stats.throws, 20);
  assert.ok(M.isCupUnlocked(p, 'tiny'), 'Vierbecher nach 5 Läufen');

  const win = G.newRun({ seed: 'won' });
  win.won = true;
  win.phase = 'won';
  win.ante = 8;
  win.stats.highestAnte = 8;
  const ev = M.finishRun(p, win);
  assert.equal(p.stats.wins, 1);
  assert.equal(M.maxStake(p, 'wood'), 2);
  assert.ok(ev.some((e) => e.type === 'unlock' && e.kind === 'stake'));
  assert.ok(M.isCupUnlocked(p, 'black'));
  assert.ok(M.isCupUnlocked(p, 'red') && M.isCupUnlocked(p, 'blue'));
  const sum = M.collectionSummary(p);
  assert.equal(sum.counts.handsTotal, 12);
  assert.ok(sum.counts.achievements >= 5);
});
