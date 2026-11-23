// Gemeinsame Hilfen für Talismane, Verbrauchsgüter und Würfel (ohne Zirkelbezüge zu run.js).
import { TALISMANS, newTalismanState } from './content/talismans.js';
import { nextUid } from './dice.js';

export function acquireTalisman(run, id) {
  const t = { uid: nextUid(run, 't'), id, state: newTalismanState(id), disabled: false };
  run.talismans.push(t);
  const def = TALISMANS[id];
  if (def && def.onAcquire) def.onAcquire(run, t);
  run.stats.talismansOwned = (run.stats.talismansOwned || 0) + 1;
  run.stats.maxTalismans = Math.max(run.stats.maxTalismans || 0, run.talismans.length);
  if (def && def.rarity === 'legendary') run.stats.legendaryOwned = (run.stats.legendaryOwned || 0) + 1;
  markSeen(run, 'talismans', id);
  return t;
}

export function removeTalisman(run, uid) {
  const i = run.talismans.findIndex((t) => t.uid === uid);
  if (i < 0) return null;
  const [t] = run.talismans.splice(i, 1);
  const def = TALISMANS[t.id];
  if (def && def.onRemove) def.onRemove(run, t);
  if (run.round && run.round.rolled) syncRolledToDice(run);
  return t;
}

export function addConsumable(run, id) {
  const c = { uid: nextUid(run, 'c'), id };
  run.consumables.push(c);
  markSeen(run, 'consumables', id);
  return c;
}

export function markSeen(run, kind, id) {
  if (!run.seen) run.seen = {};
  if (!run.seen[kind]) run.seen[kind] = [];
  if (!run.seen[kind].includes(id)) run.seen[kind].push(id);
}

export function hasTalisman(run, id) {
  return run.talismans.some((t) => t.id === id && !t.disabled);
}

/** Nach Änderungen an run.dice (neue/entfernte Würfel, Flächen) den Rolled-Zustand angleichen. */
export function syncRolledToDice(run) {
  const round = run.round;
  if (!round || !round.rolled) return;
  const byId = new Map(round.rolled.map((r) => [r.dieId, r]));
  round.rolled = run.dice.map((d) => {
    const r = byId.get(d.id);
    if (r) {
      const face = d.faces[r.faceIndex] || d.faces[0];
      if (!d.faces[r.faceIndex]) r.faceIndex = 0;
      r.v = face.v === 0 ? 0 : clampV(face.v + (r.nudged || 0), d);
      return r;
    }
    // neuer Würfel während eines Wurfs: zeigt Fläche 0, unverdeckt
    return { dieId: d.id, faceIndex: 0, v: d.faces[0].v, hidden: false, held: false, shackled: false, nudged: 0 };
  });
}

export function clampV(v, die) {
  return Math.max(1, Math.min(die.sides, v));
}
