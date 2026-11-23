// Privilegien ($10, eins pro Einsatz im Laden). apply(run) wirkt sofort und dauerhaft.
import { VOUCHER_PRICE } from '../constants.js';
import { makeDie } from '../dice.js';
import { syncRolledToDice } from '../inventory.js';

const V = [
  { id: 'v_cup', name: 'Großer Becher', glyph: '⊻', hue: 20, desc: '+1 Nachwurf pro Partie.',
    apply: (run) => { run.base.rerolls += 1; } },
  { id: 'v_cup2', name: 'Riesenbecher', glyph: '⩡', hue: 25, requires: 'v_cup', desc: '+1 Nachwurf pro Partie.',
    apply: (run) => { run.base.rerolls += 1; } },
  { id: 'v_hand', name: 'Ausdauertraining', glyph: '↟', hue: 130, desc: '+1 Wurf pro Partie.',
    apply: (run) => { run.base.throws += 1; } },
  { id: 'v_slot', name: 'Vitrine', glyph: '▭', hue: 200, desc: '+1 Talismanplatz.',
    apply: (run) => { run.limits.talismans += 1; } },
  { id: 'v_slot2', name: 'Galerie', glyph: '▤', hue: 205, requires: 'v_slot', desc: '+1 Talismanplatz.',
    apply: (run) => { run.limits.talismans += 1; } },
  { id: 'v_haggle', name: 'Feilscher', glyph: '↘', hue: 55, desc: 'Alle Ladenpreise −25 % (abgerundet).',
    apply: () => {} },
  { id: 'v_interest', name: 'Zinseszins', glyph: '%', hue: 48, desc: 'Zinsobergrenze $10.',
    apply: (run) => { run.base.interestCap = Math.max(run.base.interestCap, 10); } },
  { id: 'v_sixth', name: 'Sechster Würfel', glyph: '⚅', hue: 280, desc: '+1 Würfellimit und ein neuer normaler W6.',
    apply: (run) => {
      run.limits.dice += 1;
      run.dice.push(makeDie(run, 6));
      syncRolledToDice(run);
    } },
  { id: 'v_ban', name: 'Wächterbann', glyph: '⊛', hue: 0, desc: '1× pro Einsatz den Wächter neu ziehen.',
    apply: () => {} },
  { id: 'v_pouch', name: 'Tasche', glyph: '⊓', hue: 100, desc: '+1 Verbrauchsplatz.',
    apply: (run) => { run.limits.consumables += 1; } },
  { id: 'v_shop', name: 'Großer Laden', glyph: '⊞', hue: 170, desc: '+1 Angebotsplatz im Laden.',
    apply: (run) => { run.limits.shopSlots += 1; } },
  { id: 'v_stars', name: 'Sternkarte', glyph: '✧', hue: 250, desc: 'Sternbilder erscheinen im Laden doppelt so häufig.',
    apply: () => {} },
];

export const VOUCHERS = {};
for (const v of V) {
  v.price = VOUCHER_PRICE;
  if (!v.requires) v.requires = null;
  VOUCHERS[v.id] = v;
}
export const VOUCHER_IDS = V.map((v) => v.id);

export function availableVouchers(run) {
  return V.filter((v) => !run.vouchers.includes(v.id) && (!v.requires || run.vouchers.includes(v.requires))).map((v) => v.id);
}
