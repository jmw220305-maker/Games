// Hände: Definitionen, Erkennung (inkl. Wild), Enthaltensein.

export const HANDS = {
  scatter: { id: 'scatter', name: 'Streuung', rank: 0, chips: 10, mult: 2, perLevel: { chips: 20, mult: 1 }, secret: false, desc: 'Keine Kombination – der höchste Würfel wertet.', glyph: '⁘', hue: 210 },
  pair: { id: 'pair', name: 'Paar', rank: 1, chips: 20, mult: 3, perLevel: { chips: 30, mult: 1 }, secret: false, desc: 'Zwei gleiche Augenzahlen.', glyph: '⚁', hue: 180 },
  twopair: { id: 'twopair', name: 'Zwei Paare', rank: 2, chips: 40, mult: 3, perLevel: { chips: 40, mult: 1 }, secret: false, desc: 'Zwei verschiedene Paare.', glyph: '⚃', hue: 160 },
  triple: { id: 'triple', name: 'Drilling', rank: 3, chips: 60, mult: 4, perLevel: { chips: 40, mult: 2 }, secret: false, desc: 'Drei gleiche Augenzahlen.', glyph: '⚂', hue: 140 },
  smallrun: { id: 'smallrun', name: 'Kleine Straße', rank: 4, chips: 70, mult: 4, perLevel: { chips: 50, mult: 2 }, secret: false, desc: 'Vier aufeinanderfolgende Augenzahlen.', glyph: '⋰', hue: 40 },
  parity: { id: 'parity', name: 'Gleichklang', rank: 5, chips: 80, mult: 4, perLevel: { chips: 40, mult: 2 }, secret: false, desc: 'Fünf Würfel, alle gerade oder alle ungerade.', glyph: '≡', hue: 260 },
  fullhouse: { id: 'fullhouse', name: 'Full House', rank: 6, chips: 80, mult: 5, perLevel: { chips: 50, mult: 2 }, secret: false, desc: 'Ein Drilling und ein Paar.', glyph: '⌂', hue: 20 },
  bigrun: { id: 'bigrun', name: 'Große Straße', rank: 7, chips: 120, mult: 6, perLevel: { chips: 60, mult: 3 }, secret: false, desc: 'Fünf aufeinanderfolgende Augenzahlen.', glyph: '⇗', hue: 50 },
  quad: { id: 'quad', name: 'Vierling', rank: 8, chips: 120, mult: 8, perLevel: { chips: 60, mult: 3 }, secret: false, desc: 'Vier gleiche Augenzahlen.', glyph: '⚅', hue: 330 },
  pasch: { id: 'pasch', name: 'Pasch', rank: 9, chips: 240, mult: 13, perLevel: { chips: 70, mult: 4 }, secret: false, desc: 'Fünf gleiche Augenzahlen.', glyph: '✪', hue: 300 },
  skyladder: { id: 'skyladder', name: 'Himmelsleiter', rank: 10, chips: 320, mult: 15, perLevel: { chips: 80, mult: 4 }, secret: true, desc: 'Sechs aufeinanderfolgende Augenzahlen.', glyph: '☈', hue: 230 },
  sixer: { id: 'sixer', name: 'Sechsling', rank: 11, chips: 400, mult: 21, perLevel: { chips: 100, mult: 5 }, secret: true, desc: 'Sechs gleiche Augenzahlen (nur mit mindestens sechs Würfeln).', glyph: '✹', hue: 0 },
};

export const HAND_ORDER = Object.values(HANDS)
  .sort((a, b) => a.rank - b.rank)
  .map((h) => h.id);

const CONTAINS = {
  scatter: [],
  pair: [],
  twopair: ['pair'],
  triple: ['pair'],
  smallrun: [],
  parity: [],
  fullhouse: ['pair', 'twopair', 'triple'],
  bigrun: ['smallrun'],
  quad: ['pair', 'triple'],
  pasch: ['pair', 'triple', 'quad'],
  skyladder: ['smallrun', 'bigrun'],
  sixer: ['pair', 'triple', 'quad', 'pasch'],
};

/** Enthält die Hand `handId` die Hand `otherId` (oder ist sie es)? */
export function contains(handId, otherId) {
  if (handId === otherId) return true;
  return (CONTAINS[handId] || []).includes(otherId);
}

export function handBase(handId, level = 1) {
  const h = HANDS[handId];
  const l = Math.max(1, level) - 1;
  return { chips: h.chips + h.perLevel.chips * l, mult: h.mult + h.perLevel.mult * l };
}

/**
 * Erkennung für feste Werte. values[i] = Augenzahl (0 = keine Augen).
 * Liefert { handId: dice[] } (Würfelindizes) für jede enthaltene Hand – jeweils die beste (höchste) Auswahl.
 */
function detectConcrete(values) {
  const out = {};
  const groups = new Map();
  values.forEach((v, i) => {
    if (v > 0) {
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(i);
    }
  });
  const vals = [...groups.keys()].sort((a, b) => b - a);

  // Streuung: höchster Würfel
  if (vals.length) out.scatter = [groups.get(vals[0])[0]];
  else out.scatter = [];

  const ofKind = (n) => {
    for (const v of vals) if (groups.get(v).length >= n) return groups.get(v).slice(0, n);
    return null;
  };
  const kinds = { pair: 2, triple: 3, quad: 4, pasch: 5, sixer: 6 };
  for (const [id, n] of Object.entries(kinds)) {
    const d = ofKind(n);
    if (d) out[id] = d;
  }
  const pairVals = vals.filter((v) => groups.get(v).length >= 2);
  if (pairVals.length >= 2) out.twopair = [...groups.get(pairVals[0]).slice(0, 2), ...groups.get(pairVals[1]).slice(0, 2)];

  // Full House: bester Drilling-Wert + anderes Paar
  let bestFH = null;
  let bestFHScore = -1;
  for (const a of vals) {
    if (groups.get(a).length < 3) continue;
    for (const b of vals) {
      if (b === a || groups.get(b).length < 2) continue;
      const s = 3 * a + 2 * b;
      if (s > bestFHScore) {
        bestFHScore = s;
        bestFH = [...groups.get(a).slice(0, 3), ...groups.get(b).slice(0, 2)];
      }
    }
  }
  if (bestFH) out.fullhouse = bestFH;

  // Straßen
  const runOf = (len) => {
    for (const top of vals) {
      let ok = true;
      for (let k = 0; k < len; k++) if (!groups.has(top - k)) { ok = false; break; }
      if (ok) {
        const d = [];
        for (let k = 0; k < len; k++) d.push(groups.get(top - k)[0]);
        return d;
      }
    }
    return null;
  };
  const r4 = runOf(4);
  if (r4) out.smallrun = r4;
  const r5 = runOf(5);
  if (r5) out.bigrun = r5;
  const r6 = runOf(6);
  if (r6) out.skyladder = r6;

  // Gleichklang: 5 Würfel gleicher Parität (die höchsten)
  const byParity = [[], []];
  values.forEach((v, i) => {
    if (v > 0) byParity[v % 2].push(i);
  });
  let bestPar = null;
  let bestParSum = -1;
  for (const list of byParity) {
    if (list.length < 5) continue;
    const top = [...list].sort((a, b) => values[b] - values[a] || a - b).slice(0, 5);
    const s = top.reduce((acc, i) => acc + values[i], 0);
    if (s > bestParSum) {
      bestParSum = s;
      bestPar = top;
    }
  }
  if (bestPar) out.parity = bestPar;

  for (const k of Object.keys(out)) out[k] = out[k].slice().sort((a, b) => a - b);
  return out;
}

function* multisets(n, lo, hi, start = lo) {
  if (n === 0) {
    yield [];
    return;
  }
  for (let v = start; v <= hi; v++) {
    for (const rest of multisets(n - 1, lo, hi, v)) yield [v, ...rest];
  }
}

/**
 * Alle enthaltenen Hände, ranghöchste zuerst.
 * values: int[] (0 = keine Augen), wildMask: bool[] (Stern = beliebige Augenzahl), opts.wildMax (Standard 6, max. Seitenzahl)
 * → [{ handId, dice:[i...], values:int[] /*Belegung aller Würfel inkl. Wild*\/ }]
 */
export function detectHands(values, wildMask = [], opts = {}) {
  const wildIdx = [];
  values.forEach((v, i) => {
    if (wildMask[i]) wildIdx.push(i);
  });
  const best = {};
  const consider = (vals) => {
    const found = detectConcrete(vals);
    for (const [id, dice] of Object.entries(found)) {
      const s = dice.reduce((a, i) => a + vals[i], 0);
      if (!best[id] || s > best[id].score) best[id] = { dice, values: vals.slice(), score: s };
    }
  };
  if (wildIdx.length === 0) {
    consider(values.slice());
  } else {
    const wildMax = Math.max(6, opts.wildMax || 6);
    for (const ms of multisets(wildIdx.length, 1, wildMax)) {
      const vals = values.slice();
      wildIdx.forEach((wi, k) => {
        vals[wi] = ms[k];
      });
      consider(vals);
    }
  }
  return Object.entries(best)
    .map(([handId, b]) => ({ handId, dice: b.dice, values: b.values }))
    .sort((a, b) => HANDS[b.handId].rank - HANDS[a.handId].rank);
}
