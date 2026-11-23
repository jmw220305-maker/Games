// Test-Hilfen (keine Testdatei: *.test.js wird nicht gematcht).
import * as G from '../src/game/index.js';

/** Neuer Lauf in einer laufenden Partie (Kleine Partie, kein Wächter), Würfel geworfen. */
export function roundRun(opts = {}) {
  const run = G.newRun({ seed: opts.seed || 'TEST', cup: opts.cup || 'wood', stake: opts.stake || 1 });
  if (opts.warden) {
    // direkt in die Wächter-Partie springen
    run.blinds[0].state = 'skipped';
    run.blinds[1].state = 'skipped';
    run.blindIndex = 2;
    run.blinds[2].state = 'current';
    run.blinds[2].wardenId = opts.warden;
    run.wardens.current = opts.warden;
    run.blinds[2].target = G.blindTarget(run, 'warden', opts.warden);
  }
  if (opts.talismans) for (const id of opts.talismans) giveTalisman(run, id);
  if (opts.target !== undefined) run.blinds[run.blindIndex].target = opts.target;
  let r = G.startBlind(run);
  if (!r.ok) throw new Error(r.reason);
  r = G.beginThrow(run);
  if (!r.ok) throw new Error(r.reason);
  if (opts.values) setRolled(run, opts.values, opts.marks);
  return run;
}

export function giveTalisman(run, id) {
  run.limits.talismans = Math.max(run.limits.talismans, run.talismans.length + 1);
  // über die öffentliche Kauf-Logik wäre Geld nötig – hier direkt:
  const before = run.talismans.length;
  run.shop = run.shop || null;
  const t = { uid: `t_test_${id}_${before}`, id, state: JSON.parse(JSON.stringify(G.TALISMANS[id].init || {})), disabled: false };
  run.talismans.push(t);
  if (G.TALISMANS[id].onAcquire) G.TALISMANS[id].onAcquire(run, t);
  return t;
}

/** Setzt die geworfenen Würfel auf feste Werte (und optional Prägungen der gezeigten Fläche). */
export function setRolled(run, values, marks = []) {
  values.forEach((v, i) => {
    const die = run.dice[i];
    let fi = die.faces.findIndex((f) => f.v === v);
    if (fi < 0) {
      fi = 0;
      die.faces[0].v = v;
    }
    if (marks[i] !== undefined) die.faces[fi].mark = marks[i];
    const r = run.round.rolled[i];
    r.faceIndex = fi;
    r.v = die.faces[fi].v;
    r.hidden = false;
    r.held = false;
    r.nudged = 0;
  });
}

export function stepsOf(res) {
  return res.result.steps.map((s) => s.type);
}
