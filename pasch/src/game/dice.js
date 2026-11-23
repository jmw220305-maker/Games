// Würfel: Erzeugen, Werfen, Flächen.
import { next, weighted, pick, int, chance } from '../core/rng.js';
// (pick wird für Materialien verwendet)
import { MARKS } from './constants.js';

export function nextUid(run, prefix) {
  run.nextUid = (run.nextUid || 0) + 1;
  return `${prefix}${run.nextUid}`;
}

export function makeDie(run, sides = 6, opts = {}) {
  const faces = [];
  for (let v = 1; v <= sides; v++) faces.push({ v, mark: null });
  const die = { id: nextUid(run, 'd'), sides, faces, material: opts.material || null };
  if (opts.src) die.src = opts.src;
  return die;
}

/** Würfel, die gegen das Würfellimit zählen (Phantom und Talisman-Würfel nicht). */
export function countedDice(run) {
  return run.dice.filter((d) => d.material !== 'phantom' && !d.src).length;
}

export function faceWeights(die) {
  const w = die.faces.map(() => 1);
  if (die.material === 'lead') {
    let hi = -1;
    let hiIdx = 0;
    die.faces.forEach((f, i) => {
      const v = f.mark === 'stone' ? 0 : f.v;
      if (v > hi) {
        hi = v;
        hiIdx = i;
      }
    });
    w[hiIdx] = 2;
  }
  return w;
}

/** → faceIndex */
export function rollFaceIndex(stream, die) {
  const w = faceWeights(die);
  return weighted(stream, w.map((x, i) => [i, x]));
}

export function faceOf(run, rolled, i) {
  const r = rolled[i];
  const die = run.dice.find((d) => d.id === r.dieId);
  return die ? die.faces[r.faceIndex] : null;
}

export function dieOfRolled(run, r) {
  return run.dice.find((d) => d.id === r.dieId) || null;
}

/** Gegenseite: Flächenindex gespiegelt (Standardwürfel: v → Seiten+1−v). */
export function oppositeFaceIndex(die, faceIndex) {
  return die.faces.length - 1 - faceIndex;
}

/** Zufälliger besonderer Würfel (Würfelbeutel). */
export function randomSpecialDie(run, stream) {
  const sides = weighted(stream, [[6, 75], [4, 15], [8, 10]]);
  const die = makeDie(run, sides);
  const n = int(stream, 1, 3);
  const idxs = die.faces.map((_, i) => i);
  for (let k = 0; k < n && idxs.length; k++) {
    const j = Math.floor(next(stream) * idxs.length);
    const fi = idxs.splice(j, 1)[0];
    die.faces[fi].mark = weighted(stream, MARKS.map((m) => [m, m === 'star' ? 1 : 3]));
  }
  if (chance(stream, 0.3)) die.material = pick(stream, ['lead', 'bone', 'prism', 'crystal']);
  return die;
}
