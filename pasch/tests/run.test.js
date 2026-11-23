import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { playRun } from '../tools/sim.mjs';
import { save, load } from '../src/core/storage.js';

/** Deterministische, zufallsfreie Strategie für Wiederholbarkeitstests. */
function step(run) {
  switch (run.phase) {
    case 'blinds':
      return G.startBlind(run);
    case 'round':
      if (!run.round.rolled) return G.beginThrow(run);
      if (run.round.rerollsLeft > 0 && run.round.rerollsUsedThisThrow === 0) {
        const top = G.availableHands(run)[0];
        run.round.rolled.forEach((r, i) => {
          if (top.dice.includes(i) !== !!r.held && !r.shackled) G.toggleHold(run, i);
        });
        if (run.round.rolled.some((r) => !r.held)) return G.reroll(run);
      }
      return G.scoreThrow(run);
    case 'cashout':
      return G.cashOut(run);
    case 'shop': {
      const i = run.shop.offers.findIndex((o) => !o.sold && o.price <= run.money && o.kind === 'talisman' && run.talismans.length < run.limits.talismans);
      if (i >= 0) return G.buy(run, i);
      return G.leaveShop(run);
    }
    case 'pack':
      return G.pickFromPack(run, 0, undefined).ok ? { ok: true } : G.skipPack(run);
    default:
      return { ok: false };
  }
}

test('Run-State ist reines JSON und spielt nach Kopie identisch weiter', () => {
  const a = G.newRun({ seed: 'json', cup: 'wood' });
  for (let k = 0; k < 40; k++) step(a);
  const b = JSON.parse(JSON.stringify(a));
  const c = G.loadRun(G.serializeRun(a));
  for (let k = 0; k < 400 && !G.isOver(a); k++) {
    step(a);
    step(b);
    step(c);
  }
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
});

test('gleicher Seed → gleicher Lauf; anderer Seed → anderer', () => {
  const x = G.newRun({ seed: 'same' });
  const y = G.newRun({ seed: 'same' });
  for (let k = 0; k < 100; k++) {
    step(x);
    step(y);
  }
  assert.deepEqual(x, y);
  const z = G.newRun({ seed: 'other' });
  for (let k = 0; k < 100; k++) step(z);
  assert.notDeepEqual(x, z);
});

test('Speichern/Laden über storage', () => {
  const run = G.newRun({ seed: 'store' });
  for (let k = 0; k < 30; k++) step(run);
  save(G.meta.RUN_KEY, run);
  const back = G.loadRun(load(G.meta.RUN_KEY, null));
  assert.deepEqual(back, run);
  assert.equal(G.loadRun('kaputt'), null);
  assert.equal(G.loadRun({ version: 999 }), null);
});

test('Aktionen melden Fehler auf Deutsch statt zu werfen', () => {
  const run = G.newRun({ seed: 'err' });
  for (const [fn, args] of [
    [G.beginThrow, []], [G.reroll, []], [G.toggleHold, [0]], [G.scoreThrow, []], [G.cashOut, []], [G.shopReroll, []],
    [G.buy, [0]], [G.leaveShop, []], [G.pickFromPack, [0]], [G.skipPack, []], [G.continueEndless, []], [G.useConsumable, ['x']],
  ]) {
    const r = fn(run, ...args);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 3);
  }
  G.startBlind(run);
  assert.equal(G.startBlind(run).ok, false);
  assert.equal(G.reroll(run).reason, 'Es liegen keine Würfel');
  G.beginThrow(run);
  assert.equal(G.beginThrow(run).reason, 'Die Würfel liegen schon');
  run.round.rolled.forEach((r, i) => G.toggleHold(run, i));
  assert.equal(G.reroll(run).reason, 'Alle Würfel sind gehalten');
  assert.equal(G.scoreThrow(run, 'pasch').ok || G.availableHands(run).some((h) => h.handId === 'pasch'), G.availableHands(run).some((h) => h.handId === 'pasch'));
});

test('Sieg in Einsatz 8 und Endlos', () => {
  const run = G.newRun({ seed: 'win' });
  run.ante = 8;
  run.blindIndex = 2;
  run.blinds[2].state = 'current';
  run.blinds[2].target = 1;
  G.startBlind(run);
  G.beginThrow(run);
  const res = G.scoreThrow(run);
  assert.ok(res.events.some((e) => e.type === 'runWon'));
  assert.equal(run.phase, 'won');
  assert.ok(G.isOver(run));
  assert.ok(G.continueEndless(run).ok);
  assert.equal(run.phase, 'cashout');
  G.cashOut(run);
  G.leaveShop(run);
  assert.equal(run.ante, 9);
  assert.equal(run.blinds[0].target, G.anteBase(9));
});

test('Bot spielt 200 Läufe ohne Fehler bis Sieg oder Niederlage', () => {
  let wins = 0;
  let maxAnte = 0;
  for (let i = 0; i < 200; i++) {
    const cups = G.CUP_IDS;
    const r = playRun(`bot-${i}`, { fast: true, cup: cups[i % cups.length], stake: 1 + (i % 5) });
    assert.ok(r.run.phase === 'won' || r.run.phase === 'lost');
    JSON.stringify(r.run);
    if (r.won) wins++;
    maxAnte = Math.max(maxAnte, r.ante);
  }
  assert.ok(maxAnte >= 4, `max. Einsatz ${maxAnte}`);
});
