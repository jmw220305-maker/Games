// Wertung: Handerkennung auf dem aktuellen Wurf und die Schritt-für-Schritt-Berechnung (ScoreResult.steps).
import { HANDS, detectHands, handBase, contains } from './hands.js';
import { TALISMANS } from './content/talismans.js';
import { WARDENS } from './content/wardens.js';
import { chance } from '../core/rng.js';
import { MARK_RNG } from './constants.js';
import { removeTalisman } from './inventory.js';

export function currentWarden(run) {
  const round = run.round;
  if (!round || !round.wardenId) return null;
  return WARDENS[round.wardenId] || null;
}

function activeTalisman(run, id) {
  return run.talismans.some((t) => t.id === id && !t.disabled);
}

/** Werte des aktuellen Wurfs für die Logik (verdeckte Würfel zählen mit). */
export function rolledValues(run) {
  const round = run.round;
  const warden = currentWarden(run);
  const leaden = !!(warden && warden.leaden);
  const fate = activeTalisman(run, 'fate');
  const values = [];
  const wild = [];
  const stone = [];
  let wildMax = 6;
  round.rolled.forEach((r, i) => {
    const die = run.dice[i];
    const face = die.faces[r.faceIndex];
    wildMax = Math.max(wildMax, die.sides);
    let v = r.v;
    let w = false;
    const isStone = face.mark === 'stone';
    if (isStone) v = 0;
    else if (face.mark === 'star') w = true;
    else if (fate && v === 1) w = true;
    if (!w && leaden && (v === 1 || v === 2)) v = 0;
    values.push(w ? 0 : v);
    wild.push(w);
    stone.push(isStone);
  });
  return { values, wild, stone, wildMax };
}

/** Alle Hände im aktuellen Wurf inkl. Wächter-Erlaubnis. */
export function handsInThrow(run) {
  const round = run.round;
  if (!round || !round.rolled) return [];
  const { values, wild, stone, wildMax } = rolledValues(run);
  const found = detectHands(values, wild, { wildMax });
  const warden = currentWarden(run);
  return found.map((f) => {
    const h = HANDS[f.handId];
    const level = run.handLevels[f.handId] || 1;
    let allowed = true;
    let reason = null;
    if (warden && warden.noRepeat && round.playedHands.includes(f.handId)) {
      allowed = false;
      reason = 'Das Echo: Diese Hand wurde schon gewertet';
    }
    if (warden && warden.fixation && round.playedHands.length && !contains(f.handId, round.playedHands[0])) {
      allowed = false;
      reason = `Die Fixierung: Nur noch Hände mit ${HANDS[round.playedHands[0]].name} erlaubt`;
    }
    const scoring = [...new Set([...f.dice, ...stone.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)])].sort((a, b) => a - b);
    return {
      handId: f.handId,
      name: h.name,
      rank: h.rank,
      dice: f.dice,
      scoring,
      values: f.values,
      base: baseWithWarden(run, f.handId, level),
      level,
      allowed,
      reason,
      secret: h.secret,
      hidden: f.dice.some((i) => round.rolled[i].hidden),
    };
  });
}

function baseWithWarden(run, handId, level) {
  const b = handBase(handId, level);
  const warden = currentWarden(run);
  if (warden && warden.chill) b.mult = Math.max(1, Math.floor(b.mult / 2));
  return b;
}

/** Talisman-Definition, die an Position i tatsächlich wirkt (Nachahmer folgt nach rechts). */
function effectiveDef(run, i, depth = 0) {
  const t = run.talismans[i];
  if (!t || t.disabled) return null;
  const def = TALISMANS[t.id];
  if (!def) return null;
  if (def.id !== 'copycat') return { def, t, copy: depth > 0 };
  if (depth > 6) return null;
  const right = run.talismans[i + 1];
  if (!right || right.disabled) return null;
  const rdef = TALISMANS[right.id];
  if (!rdef || rdef.copyable === false && rdef.id !== 'copycat') return null;
  const inner = effectiveDef(run, i + 1, depth + 1);
  if (!inner) return null;
  return { def: inner.def, t: inner.t, copy: true };
}

function fixMult(m) {
  return Math.round(m * 1e9) / 1e9;
}

/**
 * Berechnet die Wertung für einen Handeintrag aus handsInThrow. Mutiert den Run (Zufall, Glas, Wachstum, Geld) –
 * für eine Vorschau auf einer Kopie aufrufen.
 */
export function computeScore(run, entry) {
  const round = run.round;
  const rolled = round.rolled;
  const warden = currentWarden(run);
  const handId = entry.handId;
  const hand = HANDS[handId];
  const level = entry.level;
  const steps = [];
  let chips = 0;
  let mult = 0;
  let money = 0;
  let retriggers = 0;
  const values = entry.values;

  const push = (type, payload, source, dieIndex) => {
    const s = { type, ...payload, source, chips, mult: fixMult(mult) };
    if (dieIndex !== undefined && dieIndex !== null) s.dieIndex = dieIndex;
    steps.push(s);
  };
  const apply = (eff, source, dieIndex) => {
    if (!eff) return;
    switch (eff.type) {
      case 'chips':
        if (!eff.amount) return;
        chips += eff.amount;
        push('chips', { amount: eff.amount }, source, dieIndex);
        break;
      case 'mult':
        if (!eff.amount) return;
        mult += eff.amount;
        push('mult', { amount: eff.amount }, source, dieIndex);
        break;
      case 'xmult':
        if (eff.factor === 1 || !eff.factor) return;
        mult *= eff.factor;
        push('xmult', { factor: eff.factor }, source, dieIndex);
        break;
      case 'money':
        if (!eff.amount) return;
        money += eff.amount;
        push('money', { amount: eff.amount }, source, dieIndex);
        break;
      case 'grow':
        push('grow', { text: eff.text }, source, dieIndex);
        break;
      case 'text':
        push('text', { text: eff.text }, source, dieIndex);
        break;
      default:
        break;
    }
  };
  const applyAll = (effs, source, dieIndex) => {
    if (!effs) return;
    if (!Array.isArray(effs)) effs = [effs];
    for (const e of effs) apply(e, source, dieIndex);
  };

  // 1. Hand
  const base = entry.base;
  chips = base.chips;
  mult = base.mult;
  push('hand', {}, { kind: 'hand', index: -1 });
  if (warden && warden.chill) push('text', { text: 'Kälte: Basis-Multi halbiert' }, { kind: 'warden', index: -1 });

  // Kontext für Talismane
  const scoring = entry.scoring;
  const valuedScoring = scoring.filter((i) => values[i] > 0);
  const counts = {};
  for (const i of valuedScoring) counts[values[i]] = (counts[values[i]] || 0) + 1;
  let modeValue = 0;
  let modeCount = 0;
  for (const [v, c] of Object.entries(counts)) {
    if (c > modeCount || (c === modeCount && Number(v) > modeValue)) {
      modeValue = Number(v);
      modeCount = c;
    }
  }
  let highestScoringIndex = -1;
  for (const i of valuedScoring) if (highestScoringIndex < 0 || values[i] > values[highestScoringIndex]) highestScoringIndex = i;
  const allValues = entry.values.slice();
  const ctx = {
    run,
    round,
    handId,
    rank: hand.rank,
    level,
    scoring,
    values: allValues,
    rolled,
    sumAll: allValues.reduce((a, v) => a + Math.max(0, v), 0),
    modeValue,
    highestScoringIndex,
    rerollsLeft: round.rerollsLeft,
    rerollsUsedThisThrow: round.rerollsUsedThisThrow,
    throwsUsed: round.throwsUsed,
    throwsLeft: round.throwsLeft, // vor dem Abzug: 1 = letzter Wurf der Partie
    warden,
    contains: (h) => contains(handId, h),
    steps, // bisherige Schritte (nur lesen)
    currentIndex: -1, // Talisman-Index, dessen Hook gerade läuft
    unlucky: 0, // Klee-Flächen ohne Glück in dieser Wertung
    shattered: 0, // in dieser Wertung zersprungene Glasflächen (für onScored)
    total: 0, // Ergebnis (für onScored)
  };
  const active = [];
  run.talismans.forEach((t, i) => {
    const e = effectiveDef(run, i);
    if (e) active.push({ ...e, index: i, uid: run.talismans[i].uid });
  });
  const tSource = (a) => ({ kind: 'talisman', index: a.index, uid: a.uid });
  const fairy = active.find((a) => a.def.id === 'fairy' && !a.copy);
  const glassMul = active.reduce((m, a) => (!a.copy && a.def.glassShatterMul ? m * a.def.glassShatterMul : m), 1);
  const grudged = round.flags.grudged || [];
  const glassHits = [];

  const dieInfo = (i) => {
    const r = rolled[i];
    const die = run.dice[i];
    const face = die.faces[r.faceIndex];
    return { index: i, value: values[i], face, die, rolled: r, held: !!r.held, kept: !!r.kept, mark: face.mark, material: die.material, faceIndex: r.faceIndex };
  };

  const scoreDie = (d) => {
    const i = d.index;
    const dieSrc = { kind: 'die', index: i };
    const faceSrc = { kind: 'face', index: i };
    // a. Augen
    if (d.value > 0) {
      if (warden && warden.grudge && grudged.includes(d.die.id)) push('text', { text: 'Groll: keine Augen' }, { kind: 'warden', index: -1 }, i);
      else apply({ type: 'chips', amount: d.value }, dieSrc, i);
    }
    // b. Material
    if (d.material === 'bone' && d.value > 0) apply({ type: 'chips', amount: 2 * d.value }, dieSrc, i);
    else if (d.material === 'prism') apply({ type: 'mult', amount: 10 }, dieSrc, i);
    else if (d.material === 'crystal') apply({ type: 'xmult', factor: 1.5 }, dieSrc, i);
    // c. Prägung
    switch (d.mark) {
      case 'gold':
        apply({ type: 'money', amount: 1 }, faceSrc, i);
        break;
      case 'ruby':
        apply({ type: 'mult', amount: 4 }, faceSrc, i);
        break;
      case 'azure':
        apply({ type: 'chips', amount: 30 }, faceSrc, i);
        break;
      case 'stone':
        apply({ type: 'chips', amount: 50 }, faceSrc, i);
        break;
      case 'glass':
        apply({ type: 'xmult', factor: 2 }, faceSrc, i);
        if (!glassHits.some((g) => g.i === i)) glassHits.push({ i, faceIndex: d.faceIndex, dieId: d.die.id });
        break;
      case 'clover': {
        const f = fairy ? 2 : 1;
        let lucky = false;
        if (chance(run.rng.chance, MARK_RNG.cloverMult * f)) {
          apply({ type: 'mult', amount: 20 }, faceSrc, i);
          lucky = true;
          if (fairy) apply({ type: 'xmult', factor: 1.5 }, tSource(fairy), i);
        }
        if (chance(run.rng.chance, MARK_RNG.cloverMoney * f)) {
          apply({ type: 'money', amount: 20 }, faceSrc, i);
          lucky = true;
          if (fairy) apply({ type: 'xmult', factor: 1.5 }, tSource(fairy), i);
        }
        if (!lucky) {
          ctx.unlucky++;
          push('text', { text: 'Kein Glück' }, faceSrc, i);
        }
        break;
      }
      default:
        break;
    }
    // d. Talismane „wenn ein Würfel gewertet wird“
    for (const a of active) {
      if (!a.def.onDie) continue;
      ctx.currentIndex = a.index;
      applyAll(a.def.onDie(ctx, d, a.t), tSource(a), i);
    }
  };

  // 2. Würfel
  for (const i of scoring) {
    const d = dieInfo(i);
    scoreDie(d);
    const reps = [];
    if (d.mark === 'echo') reps.push({ kind: 'face', index: i });
    for (const a of active) {
      if (!a.def.retrigger) continue;
      const n = a.def.retrigger(ctx, d, a.t) || 0;
      for (let k = 0; k < n; k++) reps.push(tSource(a));
    }
    for (const src of reps) {
      retriggers++;
      push('retrigger', {}, src, i);
      for (const a of active) {
        if (!a.def.onRetrigger) continue;
        ctx.currentIndex = a.index;
        applyAll(a.def.onRetrigger(ctx, d, a.t), tSource(a), i);
      }
      scoreDie(dieInfo(i));
    }
  }

  // 3. Talismane auf die Hand
  for (const a of active) {
    ctx.currentIndex = a.index;
    if (!a.copy && a.def.preHand) applyAll(a.def.preHand(ctx, a.t), tSource(a));
    if (!a.def.onHand) continue;
    applyAll(a.def.onHand(ctx, a.t), tSource(a));
    // Leuchtturm & Co. (echoRight): der rechte Nachbar löst seine Hand-Effekte ein weiteres Mal aus
    const left = run.talismans[a.index - 1];
    const ldef = left && !left.disabled ? TALISMANS[left.id] : null;
    if (ldef && ldef.echoRight) {
      const n0 = steps.length;
      push('retrigger', {}, { kind: 'talisman', index: a.index - 1, uid: left.uid });
      applyAll(a.def.onHand(ctx, a.t), tSource(a));
      if (steps.length === n0 + 1) steps.pop();
    }
  }

  // 4. Ergebnis
  mult = fixMult(mult);
  const total = Math.floor(chips * mult + 1e-7);

  // Nachwirkungen
  const events = [];
  for (const g of glassHits) {
    if (chance(run.rng.chance, Math.min(1, MARK_RNG.glassShatter * glassMul))) {
      ctx.shattered++;
      const die = run.dice[g.i];
      die.faces[g.faceIndex] = { v: 0, mark: null };
      push('shatter', {}, { kind: 'face', index: g.i }, g.i);
      events.push({ type: 'faceShatter', dieId: g.dieId, faceIndex: g.faceIndex });
      run.stats.glassShattered = (run.stats.glassShattered || 0) + 1;
    }
  }
  ctx.total = total;
  const broken = [];
  for (const a of active) {
    if (a.copy || !a.def.onScored) continue;
    ctx.currentIndex = a.index;
    let effs = a.def.onScored(ctx, a.t) || [];
    if (!Array.isArray(effs)) effs = [effs];
    for (const e of effs) {
      if (e.type === 'break') {
        push('text', { text: e.text || 'Zerbrochen!' }, tSource(a));
        if (!broken.includes(a.uid)) broken.push(a.uid);
      } else if (e.type === 'chips' || e.type === 'mult' || e.type === 'xmult') {
        // Nachwirkungen ändern das Ergebnis nicht mehr
      } else apply(e, tSource(a));
    }
  }
  for (const uid of broken) {
    events.push({ type: 'talismanBreak', uid });
    removeTalisman(run, uid);
  }
  if (warden && warden.grudge) {
    round.flags.grudged = [...new Set([...grudged, ...scoring.map((i) => run.dice[i].id)])];
  }

  return { handId, handName: hand.name, level, total, chips, mult, steps, money, retriggers, scoring, events };
}
