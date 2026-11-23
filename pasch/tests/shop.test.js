import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/index.js';
import { roundRun, giveTalisman } from './helpers.js';

/** Lauf bis in den ersten Laden (Kleine Partie sofort gewonnen). */
function shopRun(seed = 'shop', setup) {
  const run = roundRun({ seed, values: [6, 6, 6, 6, 6], target: 1 });
  if (setup) setup(run);
  G.scoreThrow(run);
  const res = G.cashOut(run);
  assert.ok(res.ok, res.reason);
  return { run, res };
}

test('Ziele, Belohnungen, Endlos-Formel', () => {
  const run = G.newRun({ seed: 'eco' });
  assert.deepEqual(run.blinds.map((b) => b.kind), ['small', 'big', 'warden']);
  assert.equal(run.blinds[0].target, G.anteBase(1));
  assert.equal(run.blinds[1].target, G.anteBase(1) * 1.5);
  assert.deepEqual(run.blinds.map((b) => b.reward), [3, 4, 5]);
  assert.equal(G.anteBase(9), 88000);
  assert.ok(G.anteBase(12) > G.anteBase(11) * 2);
  const s2 = G.newRun({ seed: 'eco', stake: 2 });
  assert.equal(s2.blinds[0].reward, 0);
  const s3 = G.newRun({ seed: 'eco', stake: 3 });
  assert.equal(s3.blinds[0].target, Math.round(G.anteBase(1) * 1.2));
  const s5 = G.newRun({ seed: 'eco', stake: 5 });
  const w = G.WARDENS[s5.blinds[2].wardenId];
  assert.equal(s5.blinds[2].target, Math.round(G.anteBase(1) * (w.targetMul ?? 2) * 1.25 * 1.2));
  const s4 = G.newRun({ seed: 'eco', stake: 4 });
  assert.equal(G.getRoundRules(s4).rerolls, s4.base.rerolls - 1);
});

test('Abrechnung: Belohnung, übrige Würfe, Zinsen (max. $5 bzw. $10)', () => {
  const { run, res } = shopRun('cash', (r) => {
    r.money = 23;
  });
  const by = Object.fromEntries(res.breakdown.map((b) => [b.kind, b.amount]));
  assert.equal(by.reward, 3);
  assert.equal(by.throws, 3);
  assert.equal(by.interest, 4);
  assert.equal(run.money, 23 + 3 + 3 + 4);
  assert.equal(run.phase, 'shop');
  const { res: res2 } = shopRun('cash2', (r) => {
    r.money = 80;
  });
  assert.equal(res2.breakdown.find((b) => b.kind === 'interest').amount, 5);
  const { res: res3 } = shopRun('cash3', (r) => {
    r.money = 80;
    r.vouchers.push('v_interest');
    r.base.interestCap = 10;
  });
  assert.equal(res3.breakdown.find((b) => b.kind === 'interest').amount, 10);
});

test('Laden: Angebote, Beutel, Privileg, Preise', () => {
  const { run } = shopRun('offers');
  const s = run.shop;
  assert.equal(s.offers.length, 2);
  assert.equal(s.packs.length, 2);
  assert.ok(s.voucher && s.voucher.kind === 'voucher' && s.voucher.price === 10);
  for (const o of s.offers) {
    assert.ok(['talisman', 'consumable'].includes(o.kind));
    const base = o.kind === 'talisman' ? G.TALISMANS[o.id].price : G.CONSUMABLES[o.id].price;
    assert.equal(o.price, base);
  }
  // Seltenheitsverteilung grob
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  let kinds = { talisman: 0, star: 0, tool: 0 };
  for (let k = 0; k < 150; k++) {
    const r = shopRun(`dist${k}`).run;
    for (const o of r.shop.offers) {
      if (o.kind === 'talisman') {
        counts[G.TALISMANS[o.id].rarity]++;
        kinds.talisman++;
      } else kinds[G.CONSUMABLES[o.id].kind]++;
    }
  }
  assert.equal(counts.legendary, 0);
  assert.ok(counts.common > counts.uncommon && counts.uncommon > counts.rare);
  assert.ok(kinds.talisman > kinds.star && kinds.star > kinds.tool, JSON.stringify(kinds));
});

test('Kaufen und Verkaufen mit Prüfungen', () => {
  const { run } = shopRun('buy');
  run.shop.offers[0] = { kind: 'talisman', id: 'cup', price: 4, basePrice: 4, sold: false };
  run.shop.offers[1] = { kind: 'consumable', id: 'c_pair', price: 3, basePrice: 3, sold: false };
  run.money = 3;
  assert.equal(G.buy(run, 0).reason, 'Nicht genug Geld');
  run.money = 20;
  assert.ok(G.buy(run, 0).ok);
  assert.equal(run.money, 16);
  assert.equal(G.buy(run, 0).reason, 'Schon verkauft');
  assert.ok(G.buy(run, { section: 'offers', index: 1 }).ok);
  assert.equal(run.consumables[0].id, 'c_pair');
  // Platz voll
  run.limits.consumables = 1;
  run.shop.offers.push({ kind: 'consumable', id: 'c_triple', price: 3, basePrice: 3, sold: false });
  assert.equal(G.buy(run, 2).reason, 'Keine freien Verbrauchsplätze');
  run.limits.talismans = 1;
  run.shop.offers.push({ kind: 'talisman', id: 'prime', price: 5, basePrice: 5, sold: false });
  assert.equal(G.buy(run, 3).reason, 'Keine freien Talismanplätze');
  // Verkaufen: halber Preis
  const m = run.money;
  assert.ok(G.sell(run, { kind: 'talisman', uid: run.talismans[0].uid }).ok);
  assert.equal(run.money, m + 2);
  assert.ok(G.sell(run, { kind: 'consumable', uid: run.consumables[0].uid }).ok);
  assert.equal(run.money, m + 3);
  assert.equal(G.sell(run, { kind: 'talisman', uid: 'nope' }).ok, false);
});

test('Talisman-Angebote ohne Duplikate zum Besitz', () => {
  for (let k = 0; k < 40; k++) {
    const { run } = shopRun(`dup${k}`, (r) => {
      for (const id of ['cup', 'prime', 'snake_eye', 'sixpack']) giveTalisman(r, id);
    });
    for (const o of run.shop.offers) if (o.kind === 'talisman') assert.ok(!['cup', 'prime', 'snake_eye', 'sixpack'].includes(o.id));
    const t = run.shop.offers.filter((o) => o.kind === 'talisman').map((o) => o.id);
    assert.equal(new Set(t).size, t.length);
  }
});

test('Neu mischen: $5, +$1 je Mal, Reset im nächsten Laden', () => {
  const { run } = shopRun('reroll');
  run.money = 100;
  assert.ok(G.shopReroll(run).ok);
  assert.equal(run.money, 95);
  assert.ok(G.shopReroll(run).ok);
  assert.equal(run.money, 89);
  assert.equal(run.shop.rerollCost, 7);
  run.money = 3;
  assert.equal(G.shopReroll(run).reason, 'Nicht genug Geld');
  G.leaveShop(run);
  assert.equal(run.phase, 'blinds');
  assert.equal(run.blindIndex, 1);
  G.startBlind(run);
  G.beginThrow(run);
  run.round.target = 1;
  G.scoreThrow(run);
  G.cashOut(run);
  assert.equal(run.shop.rerollCost, 5);
});

test('Privilegien: Feilscher, Voraussetzungen, Wirkung', () => {
  const { run } = shopRun('vouch');
  run.money = 50;
  run.shop.voucher = { kind: 'voucher', id: 'v_haggle', price: 10, sold: false };
  assert.ok(G.buy(run, { section: 'voucher', index: 0 }).ok);
  assert.ok(run.vouchers.includes('v_haggle'));
  G.shopReroll(run);
  for (const o of run.shop.offers) {
    const base = o.kind === 'talisman' ? G.TALISMANS[o.id].price : G.CONSUMABLES[o.id].price;
    assert.equal(o.price, Math.max(1, Math.floor(base * 0.75)));
  }
  const r2 = G.newRun({ seed: 'v2' });
  for (let k = 0; k < 30; k++) {
    // v_cup2 nie ohne v_cup
    const r = G.newRun({ seed: `vv${k}` });
    assert.ok(!['v_cup2', 'v_slot2'].includes(r.anteVoucher));
  }
  const dice = r2.dice.length;
  G.VOUCHERS.v_sixth.apply(r2);
  assert.equal(r2.dice.length, dice + 1);
  assert.equal(r2.limits.dice, 6);
  G.VOUCHERS.v_pouch.apply(r2);
  assert.equal(r2.limits.consumables, 3);
  assert.equal(G.VOUCHER_IDS.length, 12);
});

test('Beutel: öffnen, wählen, überspringen', () => {
  const { run } = shopRun('packs');
  run.money = 100;
  run.shop.packs[0] = { kind: 'pack', id: 'p_star', price: 4, sold: false };
  run.shop.packs[1] = { kind: 'pack', id: 'p_dice', price: 5, sold: false };
  let r = G.buy(run, { section: 'packs', index: 0 });
  assert.ok(r.ok);
  assert.equal(run.phase, 'pack');
  assert.equal(run.pack.choices.length, 3);
  const hand = G.CONSUMABLES[run.pack.choices[1].id].hand;
  r = G.pickFromPack(run, 1);
  assert.ok(r.ok);
  assert.equal(run.handLevels[hand], 2, 'Sternbild sofort angewendet');
  assert.equal(run.phase, 'shop');
  // Würfelbeutel: ersetzt gewählten Würfel
  G.buy(run, { section: 'packs', index: 1 });
  const newDie = run.pack.choices[0].die;
  assert.equal(G.pickFromPack(run, 0).reason, 'Wähle einen Würfel, der ersetzt wird');
  assert.ok(G.pickFromPack(run, 0, { die: 2 }).ok);
  assert.equal(run.dice[2].id, newDie.id);
  // Werkzeugbeutel: behalten oder sofort benutzen
  run.pendingPacks.push('p_tool');
  assert.ok(G.openPack(run).ok);
  const ti = run.pack.choices.findIndex((c) => G.CONSUMABLES[c.id].usableIn === 'any' && G.CONSUMABLES[c.id].target && G.CONSUMABLES[c.id].target.type === 'die');
  if (ti >= 0) {
    assert.equal(G.pickFromPack(run, ti, {}).ok, false, 'Ziel fehlt');
  }
  const ki = 0;
  r = G.pickFromPack(run, ki);
  assert.ok(r.ok);
  assert.equal(run.consumables.length, 1);
  // Talismanbeutel
  run.pendingPacks.push('p_charm');
  G.openPack(run);
  assert.equal(run.pack.choices.length, 2);
  assert.ok(run.pack.choices.every((c) => c.kind === 'talisman' && G.TALISMANS[c.id].rarity !== 'legendary'));
  assert.ok(G.skipPack(run).ok);
  assert.equal(run.phase, 'shop');
  // Großer Sternbeutel: 2 aus 5
  run.pendingPacks.push('p_mega_star');
  G.openPack(run);
  assert.equal(run.pack.choices.length, 5);
  G.pickFromPack(run, 0);
  assert.equal(run.phase, 'pack');
  G.pickFromPack(run, 1);
  assert.equal(run.phase, 'shop');
  // Mystikbeutel
  run.pendingPacks.push('p_mystic');
  G.openPack(run);
  assert.ok(run.pack.choices.every((c) => G.CONSUMABLES[c.id].kind === 'mystic'));
  G.skipPack(run);
});

test('Marken: Überspringen, Doppel, Rückenwind, Investition, Ausverkauf, Gönner, Beutel-Marken', () => {
  let run = G.newRun({ seed: 'tags' });
  run.blinds[0].tagOffer = 'tag_double';
  run.blinds[1].tagOffer = 'tag_throw';
  let r = G.skipBlind(run);
  assert.ok(r.ok);
  assert.deepEqual(r.events, [{ type: 'tag', id: 'tag_double' }]);
  r = G.skipBlind(run);
  assert.equal(run.tags.filter((t) => t === 'tag_throw').length, 2);
  assert.equal(G.skipBlind(run).reason, 'Die Wächter-Partie kann nicht übersprungen werden');
  G.startBlind(run);
  assert.equal(run.round.throwsLeft, run.base.throws + 2);
  assert.equal(run.tags.length, 0);

  // Investition nach Wächter
  run = roundRun({ warden: 'wall', values: [6, 6, 6, 6, 6], target: 1 });
  run.tags.push('tag_money');
  G.scoreThrow(run);
  const res = G.cashOut(run);
  assert.ok(res.breakdown.some((b) => b.kind === 'tag' && b.amount === 15));
  assert.equal(run.tags.length, 0);

  // Ausverkauf + Gönner
  const { run: r2 } = shopRun('sale', (x) => x.tags.push('tag_sale', 'tag_charm'));
  assert.ok(r2.shop.sale);
  assert.equal(r2.shop.freeRerolls, 2);
  const free = r2.shop.offers.find((o) => o.free);
  assert.ok(free && free.price === 0 && G.TALISMANS[free.id].rarity === 'uncommon');
  const m = r2.money;
  G.shopReroll(r2);
  G.shopReroll(r2);
  assert.equal(r2.money, m);
  for (const o of r2.shop.packs) assert.equal(o.price, Math.max(1, Math.floor(G.PACKS[o.id].price * 0.5)));

  // Beutel-Marke öffnet sofort
  run = G.newRun({ seed: 'tagpack' });
  run.blinds[0].tagOffer = 'tag_star';
  r = G.skipBlind(run);
  assert.equal(run.phase, 'pack');
  assert.equal(run.pack.packId, 'p_mega_star');
  G.skipPack(run);
  assert.equal(run.phase, 'blinds');
  assert.equal(run.blindIndex, 1);
});

test('Talismane umsortieren', () => {
  const run = G.newRun({ seed: 'move' });
  giveTalisman(run, 'cup');
  giveTalisman(run, 'prime');
  giveTalisman(run, 'triad');
  assert.ok(G.moveTalisman(run, 0, 2).ok);
  assert.deepEqual(run.talismans.map((t) => t.id), ['prime', 'triad', 'cup']);
  assert.equal(G.moveTalisman(run, 0, 5).ok, false);
});

test('Becher: Startvarianten', () => {
  assert.equal(G.CUP_IDS.length, 8);
  assert.equal(G.newRun({ cup: 'red' }).base.rerolls, 4);
  assert.equal(G.newRun({ cup: 'blue' }).base.throws, 5);
  assert.equal(G.newRun({ cup: 'blue' }).base.rerolls, 2);
  const gold = G.newRun({ cup: 'gold' });
  assert.equal(gold.money, 12);
  assert.equal(gold.base.interestCap, 7);
  const black = G.newRun({ cup: 'black' });
  assert.equal(black.limits.talismans, 6);
  assert.equal(black.base.rerolls, 2);
  const loaded = G.newRun({ cup: 'loaded' });
  assert.deepEqual(loaded.dice[0].faces.map((f) => f.v), [6, 2, 3, 4, 5, 6]);
  assert.equal(loaded.blinds[0].target, Math.round(G.anteBase(1) * 1.5));
  const tiny = G.newRun({ cup: 'tiny' });
  assert.equal(tiny.dice.length, 6);
  assert.ok(tiny.dice.every((d) => d.sides === 4));
  assert.equal(tiny.blinds[0].target, Math.round(G.anteBase(1) * 1.5));
  const star = G.newRun({ cup: 'star' });
  assert.ok(star.vouchers.includes('v_stars'));
  assert.deepEqual(star.consumables.map((c) => c.id), ['c_pair', 'c_pair']);
});
