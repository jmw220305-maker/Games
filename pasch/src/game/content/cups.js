// Becher (Startvarianten). unlock = Erfolg, der den Becher freischaltet (null = von Anfang an).
// apply(run) wird von newRun nach dem Standard-Aufbau aufgerufen.
import { makeDie } from '../dice.js';
import { addConsumable } from '../inventory.js';

const C = [
  { id: 'wood', name: 'Holzbecher', glyph: '⊔', hue: 30, unlock: null, desc: 'Standard.', apply: () => {} },
  { id: 'red', name: 'Roter Becher', glyph: '⊔', hue: 0, unlock: 'ante3', desc: '+1 Nachwurf pro Partie.',
    apply: (run) => { run.base.rerolls += 1; } },
  { id: 'blue', name: 'Blauer Becher', glyph: '⊔', hue: 215, unlock: 'ante4', desc: '+1 Wurf pro Partie.',
    apply: (run) => { run.base.throws += 1; } },
  { id: 'gold', name: 'Goldbecher', glyph: '⊔', hue: 48, unlock: 'throws50', desc: 'Start mit $12, Zinsobergrenze $7.',
    apply: (run) => { run.money = 12; run.base.interestCap = 7; } },
  { id: 'black', name: 'Schwarzer Becher', glyph: '⊔', hue: 270, unlock: 'win', desc: '+1 Talismanplatz, −1 Wurf pro Partie.',
    apply: (run) => { run.limits.talismans += 1; run.base.throws -= 1; } },
  { id: 'loaded', name: 'Gezinkter Becher', glyph: '⊔', hue: 330, unlock: 'pasch', desc: 'Jeder Würfel hat statt der 1 eine 6; alle Ziele ×1,5.',
    targetMul: 1.5,
    apply: (run) => {
      for (const d of run.dice) d.faces[0].v = 6;
    } },
  { id: 'tiny', name: 'Vierbecher', glyph: '⊔', hue: 160, unlock: 'runs5', desc: '6 W4 statt 5 W6 (Würfellimit 6).',
    apply: (run) => {
      run.dice = [];
      run.limits.dice = 6;
      for (let i = 0; i < 6; i++) run.dice.push(makeDie(run, 4));
    } },
  { id: 'star', name: 'Sternbecher', glyph: '⊔', hue: 250, unlock: 'stars10', desc: 'Start mit Sternkarte und 2 Sternbildern „Zwillinge“.',
    apply: (run) => {
      run.vouchers.push('v_stars');
      addConsumable(run, 'c_pair');
      addConsumable(run, 'c_pair');
    } },
];

export const CUPS = {};
for (const c of C) CUPS[c.id] = c;
export const CUP_IDS = C.map((c) => c.id);
