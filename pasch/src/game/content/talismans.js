// Talismane. Hooks sind rein; sie bekommen den Wertungs-Kontext (siehe scoring.js) bzw. den Run.
//
// Wertungs-Hooks (geben Effekte zurück: [{type:'chips',amount}|{type:'mult',amount}|{type:'xmult',factor}|
//   {type:'money',amount}|{type:'text',text}|{type:'grow',text}]):
//   onDie(ctx, d, t)      – „wenn ein Würfel gewertet wird“ (auch bei Wiederholungen)
//   retrigger(ctx, d, t)  – Anzahl Wiederholungen für Würfel d
//   preHand(ctx, t)       – Wachstum vor Schritt 3 (wird von Nachahmer NICHT kopiert)
//   onHand(ctx, t)        – Effekte „auf die Hand“
//   onScored(ctx, t)      – Nachwirkungen nach der Wertung (nicht kopiert)
//   onRetrigger(ctx, d, t) – nach jedem „Nochmal!“-Schritt (vor der Wiederholung des Würfels)
//   onScored darf zusätzlich {type:'break', text} liefern: der Talisman zerbricht nach der Wertung.
//   Flags: echoRight (rechter Nachbar löst onHand 2× aus), glassShatterMul (Glas-Zerspring-Chance ×k).
// Run-Hooks: modifyRules(rules, run, t), onReroll(run, t, round) -> events, onRoundEnd(run, t, info) -> events,
//   cashout(run, t) -> $ , onAcquire(run, t), onRemove(run, t), describe(t, run) -> string,
//   onRoundStart(run, t, round) -> events, onConsumable(run, t, def) -> events, onPackOpen(run, t, packId) -> events,
//   onShopEnter(run, t) -> events, freeReroll(run, t, round) -> bool, priceMod(price, kind, run, t) -> price,
//   sellBonus(t) -> $, modifyEconomy(eco, run, t) (eco = {interestCap, interestStep}), modifyPack(p, run, t) (p = {size, picks}).
// Anzeige: badge(t) -> kurzer Kartentext (Zähler/Ladungen) oder null.
// d = { index, value, face, die, rolled, held, kept, mark, material }
// Teil 2 (52 weitere Talismane) steht in talismans2.js.

import { HANDS } from '../hands.js';
import { makeDie } from '../dice.js';
import { formatMult } from '../../core/format.js';
import { makeExtraTalismans } from './talismans2.js';

const mult = (amount) => ({ type: 'mult', amount });
const chips = (amount) => ({ type: 'chips', amount });
const xmult = (factor) => ({ type: 'xmult', factor });
const money = (amount) => ({ type: 'money', amount });

const valued = (ctx) => ctx.scoring.filter((i) => ctx.values[i] > 0).map((i) => ctx.values[i]);

const T = [
  // ---------- gewöhnlich ----------
  {
    id: 'snake_eye', name: 'Schlangenauge', rarity: 'common', price: 5, glyph: '⚀', hue: 140,
    desc: '+8 Multi je gewerteter 1.',
    onDie: (ctx, d) => (d.value === 1 ? [mult(8)] : null),
  },
  {
    id: 'sixpack', name: 'Sechserpack', rarity: 'common', price: 5, glyph: '⚅', hue: 30,
    desc: '+40 Punkte je gewerteter 6.',
    onDie: (ctx, d) => (d.value === 6 ? [chips(40)] : null),
  },
  {
    id: 'even_line', name: 'Gerade Linie', rarity: 'common', price: 4, glyph: '2|4', hue: 200,
    desc: '+10 Multi, wenn alle wertenden Würfel gerade sind.',
    onHand: (ctx) => {
      const v = valued(ctx);
      return v.length && v.every((x) => x % 2 === 0) ? [mult(10)] : null;
    },
  },
  {
    id: 'odd_bird', name: 'Komischer Vogel', rarity: 'common', price: 4, glyph: '1|3', hue: 15,
    desc: '+10 Multi, wenn alle wertenden Würfel ungerade sind.',
    onHand: (ctx) => {
      const v = valued(ctx);
      return v.length && v.every((x) => x % 2 === 1) ? [mult(10)] : null;
    },
  },
  {
    id: 'twin_bell', name: 'Zwillingsglocke', rarity: 'common', price: 4, glyph: '⚇', hue: 185,
    desc: '+8 Multi, wenn die Hand ein Paar enthält.',
    onHand: (ctx) => (ctx.contains('pair') ? [mult(8)] : null),
  },
  {
    id: 'triad', name: 'Dreiklang', rarity: 'common', price: 5, glyph: '∴', hue: 150,
    desc: '+12 Multi, wenn die Hand einen Drilling enthält.',
    onHand: (ctx) => (ctx.contains('triple') ? [mult(12)] : null),
  },
  {
    id: 'ladder', name: 'Leiter', rarity: 'common', price: 5, glyph: '╫', hue: 45,
    desc: '+12 Multi, wenn die Hand eine Straße enthält.',
    onHand: (ctx) => (ctx.contains('smallrun') ? [mult(12)] : null),
  },
  {
    id: 'pip_counter', name: 'Augenzähler', rarity: 'common', price: 4, glyph: '∑', hue: 175,
    desc: '+Punkte in Höhe der dreifachen Augensumme aller Würfel.',
    onHand: (ctx) => (ctx.sumAll > 0 ? [chips(3 * ctx.sumAll)] : null),
  },
  {
    id: 'deep_dive', name: 'Tiefgang', rarity: 'common', price: 4, glyph: '⤓', hue: 225,
    desc: '+15 Multi, wenn die Augensumme aller Würfel höchstens 12 ist.',
    onHand: (ctx) => (ctx.sumAll <= 12 ? [mult(15)] : null),
  },
  {
    id: 'high_tide', name: 'Flut', rarity: 'common', price: 4, glyph: '≈', hue: 195,
    desc: '+80 Punkte, wenn die Augensumme aller Würfel mindestens 24 ist.',
    onHand: (ctx) => (ctx.sumAll >= 24 ? [chips(80)] : null),
  },
  {
    id: 'patience', name: 'Geduld', rarity: 'common', price: 5, glyph: '⧗', hue: 265,
    desc: '+4 Multi je ungenutztem Nachwurf.',
    onHand: (ctx) => (ctx.rerollsLeft > 0 ? [mult(4 * ctx.rerollsLeft)] : null),
    describe: (t, run) => {
      const r = run && run.round ? run.round.rerollsLeft : null;
      return r === null ? null : `+4 Multi je ungenutztem Nachwurf (derzeit +${4 * r} Multi).`;
    },
  },
  {
    id: 'lucky_penny', name: 'Glückspfennig', rarity: 'common', price: 5, glyph: '¢', hue: 50,
    desc: '+$1 je gewerteter 6.',
    onDie: (ctx, d) => (d.value === 6 ? [money(1)] : null),
  },
  {
    id: 'center', name: 'Mittelpunkt', rarity: 'common', price: 5, glyph: '◎', hue: 290,
    desc: 'Der mittlere Würfel der Schale wird 1× wiederholt, wenn er wertet.',
    retrigger: (ctx, d) => (d.index === Math.floor((ctx.rolled.length - 1) / 2) ? 1 : 0),
  },
  {
    id: 'lucky_seven', name: 'Glückssieben', rarity: 'common', price: 5, glyph: '7', hue: 100,
    desc: '+7 Multi je Würfelpaar (unter allen Würfeln), dessen Summe 7 ist.',
    onHand: (ctx) => {
      let n = 0;
      const v = ctx.values;
      for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (v[i] > 0 && v[j] > 0 && v[i] + v[j] === 7) n++;
      return n ? [mult(7 * n)] : null;
    },
  },
  {
    id: 'tally', name: 'Kerbholz', rarity: 'common', price: 5, glyph: '⫼', hue: 35, init: { n: 0 },
    desc: 'Gewinnt dauerhaft +5 Punkte, jedes Mal wenn eine Hand mit Paar gewertet wird.',
    preHand: (ctx, t) => {
      if (!ctx.contains('pair')) return null;
      t.state.n = (t.state.n || 0) + 5;
      return [{ type: 'grow', text: `+${t.state.n} Punkte` }];
    },
    onHand: (ctx, t) => (t.state.n > 0 ? [chips(t.state.n)] : null),
    describe: (t) => `Gewinnt dauerhaft +5 Punkte je gewerteter Hand mit Paar (derzeit +${t.state.n || 0} Punkte).`,
  },
  {
    id: 'prime', name: 'Primzahl', rarity: 'common', price: 5, glyph: 'ℙ', hue: 320,
    desc: '+5 Multi je gewerteter 2, 3 oder 5.',
    onDie: (ctx, d) => (d.value === 2 || d.value === 3 || d.value === 5 ? [mult(5)] : null),
  },
  {
    id: 'cup', name: 'Lederbecher', rarity: 'common', price: 4, glyph: '⊔', hue: 25,
    desc: '+4 Multi.',
    onHand: () => [mult(4)],
  },
  {
    id: 'stocking', name: 'Sparstrumpf', rarity: 'common', price: 5, glyph: '⌓', hue: 0, copyable: false,
    desc: '+$2 am Ende jeder gewonnenen Partie.',
    cashout: () => 2,
  },
  {
    id: 'high_roller', name: 'Hochstapler', rarity: 'common', price: 5, glyph: '⇑', hue: 60,
    desc: '+30 Punkte je gewertetem Würfel mit 5 oder mehr Augen.',
    onDie: (ctx, d) => (d.value >= 5 ? [chips(30)] : null),
  },
  {
    id: 'first_throw', name: 'Erster Wurf', rarity: 'common', price: 5, glyph: '①', hue: 10,
    desc: '×2 Multi im ersten Wurf einer Partie, wenn kein Nachwurf benutzt wurde.',
    onHand: (ctx) => (ctx.throwsUsed === 0 && ctx.rerollsUsedThisThrow === 0 ? [xmult(2)] : null),
  },

  // ---------- ungewöhnlich ----------
  {
    id: 'echo_chamber', name: 'Echokammer', rarity: 'uncommon', price: 7, glyph: '⟲', hue: 175,
    desc: 'Wertende Würfel mit der häufigsten Augenzahl werden 1× wiederholt.',
    retrigger: (ctx, d) => (d.value > 0 && d.value === ctx.modeValue ? 1 : 0),
  },
  {
    id: 'loaded', name: 'Gezinkt', rarity: 'uncommon', price: 6, glyph: '◬', hue: 345,
    desc: '×1,5 Multi; −1 Nachwurf pro Partie.',
    onHand: () => [xmult(1.5)],
    modifyRules: (rules) => {
      rules.rerolls -= 1;
    },
  },
  {
    id: 'domino', name: 'Domino', rarity: 'uncommon', price: 6, glyph: '⚏', hue: 0,
    desc: 'Jeder wertende Würfel gibt +Multi in Höhe der Augen seines linken Nachbarn.',
    onDie: (ctx, d) => {
      const left = d.index > 0 ? ctx.values[d.index - 1] : 0;
      return left > 0 ? [mult(left)] : null;
    },
  },
  {
    id: 'momentum', name: 'Schwung', rarity: 'uncommon', price: 7, glyph: '»', hue: 15, init: { n: 0, last: -1 },
    desc: '×(1 + 0,2·n) Multi; n wächst um 1, wenn die Hand ranghöher als die vorige ist, sonst n = 0.',
    preHand: (ctx, t) => {
      const prev = t.state.last === undefined ? -1 : t.state.last;
      const before = t.state.n || 0;
      t.state.n = ctx.rank > prev ? before + 1 : 0;
      t.state.last = ctx.rank;
      if (t.state.n > before) return [{ type: 'grow', text: formatMult(1 + 0.2 * t.state.n) }];
      if (before > 0) return [{ type: 'text', text: 'Zurückgesetzt' }];
      return null;
    },
    onHand: (ctx, t) => (t.state.n > 0 ? [xmult(1 + 0.2 * t.state.n)] : null),
    describe: (t) => `×(1 + 0,2·n) Multi; n wächst, wenn die Hand ranghöher als die vorige ist, sonst n = 0 (derzeit ${formatMult(1 + 0.2 * (t.state.n || 0))}, zuletzt ${t.state.last >= 0 ? Object.values(HANDS).find((h) => h.rank === t.state.last).name : '–'}).`,
  },
  {
    id: 'hoard', name: 'Hamsterbecher', rarity: 'uncommon', price: 6, glyph: '⊌', hue: 80, copyable: false,
    desc: 'Ungenutzte Nachwürfe gehen in die nächste Partie über (max. +3).',
    onRoundEnd: (run, t, info) => {
      t.state.carry = Math.min(3, Math.max(0, info.rerollsLeft));
      return [];
    },
    modifyRules: (rules, run, t) => {
      rules.rerolls += t.state.carry || 0;
    },
    describe: (t) => `Ungenutzte Nachwürfe gehen in die nächste Partie über, max. +3 (gespeichert: ${t.state.carry || 0}).`,
  },
  {
    id: 'rebate', name: 'Rabatt', rarity: 'uncommon', price: 6, glyph: '%', hue: 55, copyable: false,
    desc: 'Jeder Nachwurf gibt $1 (max. $3 pro Partie).',
    onReroll: (run, t, round) => {
      const used = round.flags.rebate || 0;
      if (used >= 3) return [];
      round.flags.rebate = used + 1;
      run.money += 1;
      return [{ type: 'money', amount: 1, reason: 'Rabatt', uid: t.uid }];
    },
  },
  {
    id: 'collector', name: 'Sammler', rarity: 'uncommon', price: 6, glyph: '⁂', hue: 240,
    desc: '+3 Multi je verschiedener Augenzahl unter allen Würfeln.',
    onHand: (ctx) => {
      const n = new Set(ctx.values.filter((v) => v > 0)).size;
      return n ? [mult(3 * n)] : null;
    },
  },
  {
    id: 'tally_board', name: 'Kerbbrett', rarity: 'uncommon', price: 7, glyph: '▦', hue: 30, init: { n: 0 },
    desc: '×(1 + 0,25·n) Multi; n wächst um 1 je gewertetem Vierling oder besser.',
    preHand: (ctx, t) => {
      if (ctx.rank < HANDS.quad.rank || ctx.handId === 'parity') return null;
      t.state.n = (t.state.n || 0) + 1;
      return [{ type: 'grow', text: formatMult(1 + 0.25 * t.state.n) }];
    },
    onHand: (ctx, t) => (t.state.n > 0 ? [xmult(1 + 0.25 * t.state.n)] : null),
    describe: (t) => `×(1 + 0,25·n) Multi; n wächst um 1 je gewertetem Vierling oder besser (derzeit ${formatMult(1 + 0.25 * (t.state.n || 0))}).`,
  },
  {
    id: 'gold_rush', name: 'Goldrausch', rarity: 'uncommon', price: 6, glyph: '¤', hue: 45,
    desc: 'Gold-Prägungen geben zusätzlich +$1 und +8 Multi.',
    onDie: (ctx, d) => (d.mark === 'gold' ? [money(1), mult(8)] : null),
  },
  {
    id: 'sticky', name: 'Klebrige Finger', rarity: 'uncommon', price: 6, glyph: '⌇', hue: 310,
    desc: 'Gehaltene Würfel geben +25 Punkte, wenn sie werten.',
    onDie: (ctx, d) => (d.held ? [chips(25)] : null),
  },
  {
    id: 'crown', name: 'Bröckelnde Krone', rarity: 'uncommon', price: 7, glyph: '♛', hue: 48, init: { x: 3 },
    desc: '×3 Multi; verliert ×0,25 nach jeder Partie, zerbricht bei ×1.',
    onHand: (ctx, t) => (t.state.x > 1 ? [xmult(t.state.x)] : null),
    onRoundEnd: (run, t) => {
      t.state.x = Math.round(((t.state.x || 3) - 0.25) * 100) / 100;
      if (t.state.x <= 1) return [{ type: 'talismanBreak', uid: t.uid }];
      return [{ type: 'talismanGrow', uid: t.uid, text: formatMult(t.state.x) }];
    },
    describe: (t) => `${formatMult(t.state.x || 3)} Multi; verliert ×0,25 nach jeder Partie, zerbricht bei ×1.`,
  },
  {
    id: 'tower', name: 'Würfelturm', rarity: 'uncommon', price: 6, glyph: '♜', hue: 205, copyable: false,
    desc: '+1 Nachwurf pro Partie.',
    modifyRules: (rules) => {
      rules.rerolls += 1;
    },
  },
  {
    id: 'stamina', name: 'Ausdauer', rarity: 'uncommon', price: 7, glyph: '↟', hue: 130, copyable: false,
    desc: '+1 Wurf pro Partie.',
    modifyRules: (rules) => {
      rules.throws += 1;
    },
  },
  {
    id: 'modesty', name: 'Bescheidenheit', rarity: 'uncommon', price: 6, glyph: '½', hue: 95,
    desc: '×2 Multi, wenn die gewählte Hand genau „Paar“ ist.',
    onHand: (ctx) => (ctx.handId === 'pair' ? [xmult(2)] : null),
  },
  {
    id: 'spirit', name: 'Würfelgeist', rarity: 'uncommon', price: 6, glyph: '∿', hue: 255, init: { n: 0 },
    desc: 'Gewinnt dauerhaft +1 Multi je benutztem Nachwurf.',
    onReroll: (run, t) => {
      t.state.n = (t.state.n || 0) + 1;
      return [{ type: 'talismanGrow', uid: t.uid, text: `+${t.state.n} Multi` }];
    },
    onHand: (ctx, t) => (t.state.n > 0 ? [mult(t.state.n)] : null),
    describe: (t) => `Gewinnt dauerhaft +1 Multi je benutztem Nachwurf (derzeit +${t.state.n || 0} Multi).`,
  },

  // ---------- selten ----------
  {
    id: 'pentagram', name: 'Pentagramm', rarity: 'rare', price: 8, glyph: '⛤', hue: 300,
    desc: '×4 Multi bei Pasch oder Sechsling.',
    onHand: (ctx) => (ctx.contains('pasch') ? [xmult(4)] : null),
  },
  {
    id: 'clockwork', name: 'Uhrwerk', rarity: 'rare', price: 9, glyph: '⛭', hue: 35,
    desc: 'Wurde in diesem Wurf kein Nachwurf benutzt, werden alle wertenden Würfel 1× wiederholt.',
    retrigger: (ctx) => (ctx.rerollsUsedThisThrow === 0 ? 1 : 0),
  },
  {
    id: 'philosopher', name: 'Stein der Weisen', rarity: 'rare', price: 9, glyph: '☿', hue: 280,
    desc: 'Jede gewertete 6 gibt ×1,25 Multi.',
    onDie: (ctx, d) => (d.value === 6 ? [xmult(1.25)] : null),
  },
  {
    id: 'copycat', name: 'Nachahmer', rarity: 'rare', price: 9, glyph: '⧉', hue: 190, copyable: false,
    desc: 'Kopiert den Talisman rechts daneben (wenn kopierbar).',
    describe: (t, run) => {
      if (!run) return null;
      const i = run.talismans.findIndex((x) => x.uid === t.uid);
      const right = i >= 0 ? run.talismans[i + 1] : null;
      const def = right ? TALISMANS[right.id] : null;
      if (!def) return 'Kopiert den Talisman rechts daneben (derzeit: nichts).';
      if (def.copyable === false) return `Kopiert den Talisman rechts daneben (${def.name} ist nicht kopierbar).`;
      return `Kopiert den Talisman rechts daneben (derzeit: ${def.name}).`;
    },
  },
  {
    id: 'second_wind', name: 'Zweiter Atem', rarity: 'rare', price: 8, glyph: '↺', hue: 160, copyable: false,
    desc: '1× pro Partie: Verfehlt der letzte Wurf das Ziel, gibt es einen weiteren Wurf.',
  },
  {
    id: 'ledger', name: 'Hauptbuch', rarity: 'rare', price: 8, glyph: '⚖', hue: 48,
    desc: '×(1 + 0,1 je $5 Vermögen) Multi.',
    onHand: (ctx) => {
      const k = Math.floor(Math.max(0, ctx.run.money) / 5);
      return k > 0 ? [xmult(1 + 0.1 * k)] : null;
    },
    describe: (t, run) => `×(1 + 0,1 je $5 Vermögen) Multi (derzeit ${formatMult(1 + 0.1 * Math.floor(Math.max(0, run ? run.money : 0) / 5))}).`,
  },
  {
    id: 'sixth_sense', name: 'Sechster Sinn', rarity: 'rare', price: 10, glyph: '⑥', hue: 270, copyable: false,
    desc: 'Solange du ihn besitzt: ein zusätzlicher normaler W6 in der Schale.',
    onAcquire: (run, t) => {
      run.dice.push(makeDie(run, 6, { src: t.uid }));
    },
    onRemove: (run, t) => {
      run.dice = run.dice.filter((d) => d.src !== t.uid);
    },
  },
  {
    id: 'chain', name: 'Kettenreaktion', rarity: 'rare', price: 8, glyph: '⊶', hue: 25,
    desc: 'Bei Straßen werden alle wertenden Würfel 1× wiederholt.',
    retrigger: (ctx) => (ctx.contains('smallrun') ? 1 : 0),
  },
  {
    id: 'fairy', name: 'Glücksfee', rarity: 'rare', price: 8, glyph: '✿', hue: 120, copyable: false,
    desc: 'Klee-Chancen verdoppelt; jedes Klee-Glück gibt zusätzlich ×1,5 Multi.',
  },

  // ---------- legendär ----------
  {
    id: 'infinity', name: 'Unendlichkeit', rarity: 'legendary', price: 20, glyph: '∞', hue: 280,
    desc: 'Der höchste wertende Würfel wird (Augen − 1)-mal wiederholt.',
    retrigger: (ctx, d) => (d.index === ctx.highestScoringIndex && d.value > 1 ? d.value - 1 : 0),
  },
  {
    id: 'fate', name: 'Schicksalsweber', rarity: 'legendary', price: 20, glyph: '☾', hue: 250, copyable: false, wildOnes: true,
    desc: 'Alle Einsen zählen als Stern (beliebige Augenzahl).',
  },
  {
    id: 'hollow_king', name: 'Hohler König', rarity: 'legendary', price: 20, glyph: '♚', hue: 0,
    desc: '×(1 + 1 je freiem Talismanplatz) Multi.',
    onHand: (ctx) => {
      const free = Math.max(0, ctx.run.limits.talismans - ctx.run.talismans.length);
      return [xmult(1 + free)];
    },
    describe: (t, run) => `×(1 + 1 je freiem Talismanplatz) Multi (derzeit ${formatMult(1 + Math.max(0, run ? run.limits.talismans - run.talismans.length : 0))}).`,
  },
  {
    id: 'croupier', name: 'Croupier', rarity: 'legendary', price: 20, glyph: '♠', hue: 330,
    desc: '×1,25 Multi je gewerteter Fläche mit Prägung.',
    onDie: (ctx, d) => (d.mark ? [xmult(1.25)] : null),
  },
];

export const TALISMANS = {};
T.push(...makeExtraTalismans(TALISMANS));
for (const t of T) {
  if (t.copyable === undefined) t.copyable = true;
  TALISMANS[t.id] = t;
}

export const TALISMAN_IDS = T.map((t) => t.id);

export function talismansByRarity(rarity) {
  return T.filter((t) => t.rarity === rarity).map((t) => t.id);
}

export function sellValue(t) {
  const def = TALISMANS[t.id];
  const bonus = def && def.sellBonus ? def.sellBonus(t) || 0 : 0;
  return Math.max(1, Math.floor((def ? def.price : 2) / 2)) + bonus;
}

export const RARITY_NAMES = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', legendary: 'Legendär' };

/** Aktueller deutscher Text inkl. Zustand. */
export function describeTalisman(t, run) {
  const def = TALISMANS[t.id];
  if (!def) return '';
  let s = def.describe ? def.describe(t, run) : null;
  if (!s) s = def.desc;
  if (t.disabled) s += ' (In dieser Partie deaktiviert.)';
  return s;
}

export function newTalismanState(id) {
  const def = TALISMANS[id];
  return def && def.init ? JSON.parse(JSON.stringify(def.init)) : {};
}
