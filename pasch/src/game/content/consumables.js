// Verbrauchsgüter: Sternbilder (kind 'star'), Werkzeuge ('tool'), Mystik ('mystic').
//
// target-Beschreibung (null = kein Ziel):
//   {type:'face',  count:1, value?:true}  → Ziel {die, face, value?}
//   {type:'faces', count:n, sameDie?:true, exact?:true} → Ziel {faces:[{die, face}, ...]} (1..n, bei exact genau n)
//   {type:'die'}                           → Ziel {die}
//   {type:'rolled', delta?:true}           → Ziel {rolled, delta?:+1|-1} (nur während eines Wurfs)
// die = Index in run.dice (= Schalen-Reihenfolge = Index in round.rolled), face = Flächenindex.
// use(run, target) → events[]; validate(run, target) → Fehlertext | null.

import { HANDS, HAND_ORDER } from '../hands.js';
import { STAR_PRICE, TOOL_PRICE, MYSTIC_PRICE } from '../constants.js';
import { talismansByRarity } from './talismans.js';
import { acquireTalisman, addConsumable, syncRolledToDice, clampV } from '../inventory.js';
import { makeDie, oppositeFaceIndex } from '../dice.js';
import { pick } from '../../core/rng.js';

const STAR_NAMES = {
  scatter: ['Streulicht', '⁘'],
  pair: ['Zwillinge', '⁑'],
  twopair: ['Doppelstern', '⁂'],
  triple: ['Dreigestirn', '∴'],
  smallrun: ['Kleiner Pfad', '⋰'],
  parity: ['Waage', '⚖'],
  fullhouse: ['Haus der Sterne', '⌂'],
  bigrun: ['Milchstraße', '≋'],
  quad: ['Kreuz des Südens', '✛'],
  pasch: ['Polarstern', '✶'],
  sixer: ['Sechsgestirn', '✹'],
  skyladder: ['Himmelstor', '☈'],
};

const list = [];

for (const handId of HAND_ORDER) {
  const [name, glyph] = STAR_NAMES[handId];
  list.push({
    id: `c_${handId}`,
    name,
    kind: 'star',
    hand: handId,
    secret: HANDS[handId].secret,
    price: STAR_PRICE,
    glyph,
    hue: (HANDS[handId].hue + 20) % 360,
    desc: `${HANDS[handId].name} +1 Stufe.`,
    target: null,
    usableIn: 'any',
    use(run) {
      run.handLevels[handId] = (run.handLevels[handId] || 1) + 1;
      return [{ type: 'levelUp', handId, level: run.handLevels[handId] }];
    },
    describe(run) {
      const l = run ? run.handLevels[handId] || 1 : 1;
      return `${HANDS[handId].name} +1 Stufe (derzeit Stufe ${l}).`;
    },
  });
}

function markTool(id, name, mark, count, glyph, hue, desc, kind = 'tool', price = TOOL_PRICE) {
  return {
    id, name, kind, price, glyph, hue, desc,
    target: count === 1 ? { type: 'face', count: 1 } : { type: 'faces', count },
    usableIn: 'any',
    mark,
    use(run, target) {
      const faces = target.faces || [target];
      const events = [];
      for (const f of faces) {
        run.dice[f.die].faces[f.face].mark = mark;
        events.push({ type: 'faceChange', dieId: run.dice[f.die].id, faceIndex: f.face, mark });
      }
      syncRolledToDice(run);
      return events;
    },
  };
}

list.push(
  {
    id: 't_chisel', name: 'Meißel', kind: 'tool', price: TOOL_PRICE, glyph: '⟋', hue: 30,
    desc: 'Setzt 1 Fläche auf einen gewählten Wert (1 bis Seitenzahl).',
    target: { type: 'face', count: 1, value: true }, usableIn: 'any',
    validate(run, t) {
      const die = run.dice[t.die];
      if (!Number.isInteger(t.value) || t.value < 1 || t.value > die.sides) return `Wert muss zwischen 1 und ${die.sides} liegen`;
      return null;
    },
    use(run, t) {
      const die = run.dice[t.die];
      die.faces[t.face].v = t.value;
      if (die.faces[t.face].mark === 'stone') die.faces[t.face].mark = null;
      syncRolledToDice(run);
      return [{ type: 'faceChange', dieId: die.id, faceIndex: t.face, v: t.value }];
    },
  },
  {
    id: 't_mirror', name: 'Spiegel', kind: 'tool', price: TOOL_PRICE, glyph: '⧎', hue: 190,
    desc: 'Kopiert 1 Fläche (Wert und Prägung) auf eine andere Fläche desselben Würfels. Erste Wahl = Vorlage.',
    target: { type: 'faces', count: 2, exact: true, sameDie: true }, usableIn: 'any',
    use(run, t) {
      const [a, b] = t.faces;
      const die = run.dice[a.die];
      die.faces[b.face] = { v: die.faces[a.face].v, mark: die.faces[a.face].mark };
      syncRolledToDice(run);
      return [{ type: 'faceChange', dieId: die.id, faceIndex: b.face, v: die.faces[b.face].v, mark: die.faces[b.face].mark }];
    },
  },
  markTool('t_gold', 'Goldlack', 'gold', 1, '$', 48, 'Gold-Prägung auf 1 Fläche (+$1 beim Werten).'),
  markTool('t_ruby', 'Rubinstaub', 'ruby', 1, '◆', 340, 'Rubin-Prägung auf 1 Fläche (+4 Multi beim Werten).'),
  markTool('t_azure', 'Azurtinte', 'azure', 2, '◇', 200, 'Azur-Prägung auf bis zu 2 Flächen (+30 Punkte beim Werten).'),
  markTool('t_echo', 'Echo-Rune', 'echo', 1, '↻', 170, 'Echo-Prägung auf 1 Fläche (Würfel wird 1× wiederholt).'),
  markTool('t_glass', 'Glasbläser', 'glass', 2, '◈', 185, 'Glas-Prägung auf bis zu 2 Flächen (×2 Multi, kann zerspringen).'),
  markTool('t_stone', 'Steinmetz', 'stone', 1, '■', 30, 'Stein-Prägung auf 1 Fläche (+50 Punkte, keine Augen, wertet immer).'),
  markTool('t_clover', 'Kleeblatt', 'clover', 2, '♣', 120, 'Klee-Prägung auf bis zu 2 Flächen (Glückschancen).'),
  {
    id: 't_lead', name: 'Bleiguss', kind: 'tool', price: TOOL_PRICE, glyph: '⊥', hue: 220,
    desc: 'Würfel wird Blei: seine höchste Fläche fällt doppelt so oft.',
    target: { type: 'die' }, usableIn: 'any',
    validate(run, t) {
      return run.dice[t.die].material === 'phantom' ? 'Phantom-Würfel lassen sich nicht verändern' : null;
    },
    use(run, t) {
      run.dice[t.die].material = 'lead';
      return [{ type: 'dieChange', dieId: run.dice[t.die].id, material: 'lead' }];
    },
  },
  {
    id: 't_shaper', name: 'Former', kind: 'tool', price: TOOL_PRICE, glyph: '⬡', hue: 75,
    desc: 'Macht aus einem W6 einen W8 (Flächen 7 und 8 kommen hinzu).',
    target: { type: 'die' }, usableIn: 'any',
    validate(run, t) {
      return run.dice[t.die].sides !== 6 ? 'Nur ein W6 kann geformt werden' : null;
    },
    use(run, t) {
      const die = run.dice[t.die];
      die.sides = 8;
      die.faces.push({ v: 7, mark: null }, { v: 8, mark: null });
      return [{ type: 'dieChange', dieId: die.id, sides: 8 }];
    },
  },
  {
    id: 't_coin', name: 'Münzwurf', kind: 'tool', price: TOOL_PRICE, glyph: '⊚', hue: 50,
    desc: 'Verdoppelt dein Geld (max. +$20).',
    target: null, usableIn: 'any',
    use(run) {
      const gain = Math.max(0, Math.min(20, run.money));
      run.money += gain;
      run.stats.moneyEarned = (run.stats.moneyEarned || 0) + gain;
      return [{ type: 'money', amount: gain, reason: 'Münzwurf' }];
    },
  },
  {
    id: 't_seer', name: 'Seher', kind: 'tool', price: TOOL_PRICE, glyph: '◉', hue: 265,
    desc: 'Erzeugt bis zu 2 zufällige Sternbilder (freie Plätze).',
    target: null, usableIn: 'any',
    validate(run) {
      return run.consumables.length >= run.limits.consumables ? 'Kein freier Verbrauchsplatz' : null;
    },
    use(run) {
      const events = [];
      for (let k = 0; k < 2 && run.consumables.length < run.limits.consumables; k++) {
        const id = randomStarId(run, run.rng.misc);
        const c = addConsumable(run, id);
        events.push({ type: 'gainConsumable', uid: c.uid, id });
      }
      return events;
    },
  },
  {
    id: 't_nudge', name: 'Stupser', kind: 'tool', price: TOOL_PRICE, glyph: '±', hue: 160,
    desc: 'Nur im Wurf: ein geworfener Würfel zeigt 1 mehr oder weniger (nur dieser Wurf).',
    target: { type: 'rolled', delta: true }, usableIn: 'round',
    validate(run, t) {
      const r = run.round.rolled[t.rolled];
      if (t.delta !== 1 && t.delta !== -1) return 'Richtung wählen (+1 oder −1)';
      if (r.v === 0) return 'Diese Fläche hat keine Augen';
      const die = run.dice[t.rolled];
      const nv = r.v + t.delta;
      if (nv < 1 || nv > die.sides) return 'Weiter geht es nicht';
      return null;
    },
    use(run, t) {
      const r = run.round.rolled[t.rolled];
      const die = run.dice[t.rolled];
      r.nudged = (r.nudged || 0) + t.delta;
      r.v = clampV(r.v + t.delta, die);
      return [{ type: 'nudge', die: t.rolled, v: r.v }];
    },
  },
  {
    id: 't_flip', name: 'Wende', kind: 'tool', price: TOOL_PRICE, glyph: '⇅', hue: 140,
    desc: 'Nur im Wurf: ein geworfener Würfel dreht auf die Gegenseite (W6: 7 − Augen).',
    target: { type: 'rolled' }, usableIn: 'round',
    use(run, t) {
      return [flipRolled(run, t.rolled)];
    },
  },
  // ---------- Mystik ----------
  markTool('m_star', 'Sternenstaub', 'star', 1, '✦', 280, 'Stern-Prägung auf 1 Fläche: zählt als beliebige Augenzahl.', 'mystic', MYSTIC_PRICE),
  {
    id: 'm_prism', name: 'Prismensplitter', kind: 'mystic', price: MYSTIC_PRICE, glyph: '△', hue: 300,
    desc: 'Würfel wird Prisma: beim Werten +10 Multi.',
    target: { type: 'die' }, usableIn: 'any',
    use(run, t) {
      run.dice[t.die].material = 'prism';
      return [{ type: 'dieChange', dieId: run.dice[t.die].id, material: 'prism' }];
    },
  },
  {
    id: 'm_crystal', name: 'Kristallauge', kind: 'mystic', price: MYSTIC_PRICE, glyph: '✧', hue: 260,
    desc: 'Würfel wird Kristall: beim Werten ×1,5 Multi.',
    target: { type: 'die' }, usableIn: 'any',
    use(run, t) {
      run.dice[t.die].material = 'crystal';
      return [{ type: 'dieChange', dieId: run.dice[t.die].id, material: 'crystal' }];
    },
  },
  {
    id: 'm_phantom', name: 'Phantomhauch', kind: 'mystic', price: MYSTIC_PRICE, glyph: '◌', hue: 250,
    desc: 'Neuer Phantom-W6 in der Schale (zählt nicht gegen das Würfellimit).',
    target: null, usableIn: 'any',
    validate(run) {
      return run.dice.length >= 7 ? 'Die Schale ist voll (max. 7 Würfel)' : null;
    },
    use(run) {
      const die = makeDie(run, 6, { material: 'phantom' });
      run.dice.push(die);
      syncRolledToDice(run);
      return [{ type: 'gainDie', dieId: die.id }];
    },
  },
  {
    id: 'm_double', name: 'Doppelgänger', kind: 'mystic', price: MYSTIC_PRICE, glyph: '⧉', hue: 200,
    desc: 'Kopiert einen zufälligen deiner Talismane (braucht einen freien Platz).',
    target: null, usableIn: 'any',
    validate(run) {
      if (!run.talismans.length) return 'Du hast keinen Talisman';
      if (run.talismans.length >= run.limits.talismans) return 'Kein freier Talismanplatz';
      return null;
    },
    use(run) {
      const src = pick(run.rng.misc, run.talismans);
      const t = acquireTalisman(run, src.id);
      t.state = JSON.parse(JSON.stringify(src.state || {}));
      return [{ type: 'gainTalisman', uid: t.uid, id: t.id }];
    },
  },
  {
    id: 'm_soul', name: 'Seelenstein', kind: 'mystic', price: MYSTIC_PRICE, glyph: '❂', hue: 285,
    desc: 'Erzeugt einen legendären Talisman (braucht einen freien Platz).',
    target: null, usableIn: 'any',
    validate(run) {
      return run.talismans.length >= run.limits.talismans ? 'Kein freier Talismanplatz' : null;
    },
    use(run) {
      const owned = new Set(run.talismans.map((t) => t.id));
      let pool = talismansByRarity('legendary').filter((id) => !owned.has(id));
      if (!pool.length) pool = talismansByRarity('legendary');
      const t = acquireTalisman(run, pick(run.rng.misc, pool));
      return [{ type: 'gainTalisman', uid: t.uid, id: t.id }];
    },
  },
  {
    id: 'm_wish', name: 'Wunschbrunnen', kind: 'mystic', price: MYSTIC_PRICE, glyph: '⍟', hue: 210,
    desc: 'Alle Hände +1 Stufe; dein Geld fällt auf $0.',
    target: null, usableIn: 'any',
    use(run) {
      const events = [];
      for (const h of HAND_ORDER) {
        run.handLevels[h] = (run.handLevels[h] || 1) + 1;
        events.push({ type: 'levelUp', handId: h, level: run.handLevels[h] });
      }
      if (run.money > 0) events.push({ type: 'money', amount: -run.money, reason: 'Wunschbrunnen' });
      run.money = 0;
      return events;
    },
  },
);

/** Würfel i auf die Gegenseite drehen (Wende, Wächter „Der Wender“). */
export function flipRolled(run, i) {
  const r = run.round.rolled[i];
  const die = run.dice[i];
  r.faceIndex = oppositeFaceIndex(die, r.faceIndex);
  r.nudged = 0;
  r.v = die.faces[r.faceIndex].v;
  return { type: 'flip', die: i, v: r.v, faceIndex: r.faceIndex };
}

export const CONSUMABLES = {};
for (const c of list) CONSUMABLES[c.id] = c;
export const CONSUMABLE_IDS = list.map((c) => c.id);

export function starIds(run) {
  return list.filter((c) => c.kind === 'star' && (!c.secret || (run && (run.handPlays[c.hand] || 0) > 0))).map((c) => c.id);
}
export function toolIds() {
  return list.filter((c) => c.kind === 'tool').map((c) => c.id);
}
export function mysticIds() {
  return list.filter((c) => c.kind === 'mystic').map((c) => c.id);
}
export function randomStarId(run, stream) {
  return pick(stream, starIds(run));
}

export function describeConsumable(c, run) {
  const def = CONSUMABLES[c.id || c];
  if (!def) return '';
  return def.describe ? def.describe(run) : def.desc;
}

export function consumableSellValue(c) {
  const def = CONSUMABLES[c.id];
  return Math.max(1, Math.floor((def ? def.price : 2) / 2));
}

