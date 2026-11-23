// Balance-Bot: spielt N Läufe headless und meldet Statistiken.
//   node tools/sim.mjs --runs 300 --seed S --cup wood --stake 1 [--verbose]
// Exportiert playRun() für Tests.
import * as G from '../src/game/index.js';
import { makeStream, hashSeed, next } from '../src/core/rng.js';
import { faceWeights } from '../src/game/dice.js';
import { handsInThrow, computeScore } from '../src/game/scoring.js';

const { HANDS, TALISMANS, CONSUMABLES, WARDENS } = G;

// ------------------------------------------------------------------ Bewertung

function botRand(bot) {
  return next(bot.rng);
}

function sampleFace(bot, die) {
  const w = faceWeights(die);
  const tot = w.reduce((a, b) => a + b, 0);
  let r = botRand(bot) * tot;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r < 0) return i;
  }
  return w.length - 1;
}

/** Logik-Wert einer Fläche (wie scoring.rolledValues). */
function logicValue(run, die, face, v, warden, fate) {
  if (face.mark === 'stone') return { v: 0, wild: false };
  if (face.mark === 'star' || (fate && v === 1)) return { v: 0, wild: true };
  if (warden && warden.leaden && (v === 1 || v === 2)) return { v: 0, wild: false };
  return { v, wild: false };
}

function handAllowed(run, handId) {
  const round = run.round;
  const w = round.wardenId ? WARDENS[round.wardenId] : null;
  if (w && w.noRepeat && round.playedHands.includes(handId)) return false;
  if (w && w.fixation && round.playedHands.length && !G.contains(handId, round.playedHands[0])) return false;
  return true;
}

/** grobe Wertschätzung je Hand: Basis + Augen, mal Multi, plus Talisman-Vorlieben */
function approxBest(run, bot, values, wild, wildMax) {
  const found = G.detectHands(values, wild, { wildMax });
  let best = 0;
  for (const f of found) {
    if (!handAllowed(run, f.handId)) continue;
    const b = G.handBase(f.handId, run.handLevels[f.handId] || 1);
    const pips = f.dice.reduce((a, i) => a + f.values[i], 0);
    const bias = bot.handBias[f.handId] || 0;
    const val = (b.chips + pips + bias * 10) * (b.mult + bias);
    if (val > best) best = val;
  }
  return best;
}

function currentLogic(run) {
  const round = run.round;
  const w = round.wardenId ? WARDENS[round.wardenId] : null;
  const fate = run.talismans.some((t) => t.id === 'fate' && !t.disabled);
  const values = [];
  const wild = [];
  let wildMax = 6;
  round.rolled.forEach((r, i) => {
    const die = run.dice[i];
    wildMax = Math.max(wildMax, die.sides);
    const lv = logicValue(run, die, die.faces[r.faceIndex], r.v, w, fate);
    values.push(lv.v);
    wild.push(lv.wild);
  });
  return { values, wild, wildMax, w, fate };
}

function evalHold(run, bot, hold, base, samples) {
  const { values, wild, wildMax, w, fate } = base;
  let total = 0;
  for (let s = 0; s < samples; s++) {
    const v2 = values.slice();
    const w2 = wild.slice();
    for (let i = 0; i < v2.length; i++) {
      if (hold[i]) continue;
      const die = run.dice[i];
      const fi = sampleFace(bot, die);
      const lv = logicValue(run, die, die.faces[fi], die.faces[fi].v, w, fate);
      v2[i] = lv.v;
      w2[i] = lv.wild;
    }
    total += approxBest(run, bot, v2, w2, wildMax);
  }
  return total / samples;
}

function holdCandidates(run, base) {
  const n = base.values.length;
  const { values, wild } = base;
  const cands = [];
  const mk = (pred) => values.map((v, i) => wild[i] || pred(v, i));
  const shackled = run.round.rolled.map((r) => r.shackled);
  const distinct = [...new Set(values.filter((v) => v > 0))];
  for (const v of distinct) cands.push(mk((x) => x === v));
  // zwei häufigste Werte
  const cnt = {};
  for (const v of values) if (v > 0) cnt[v] = (cnt[v] || 0) + 1;
  const pairs = Object.entries(cnt).filter(([, c]) => c >= 2).map(([v]) => +v).sort((a, b) => b - a);
  if (pairs.length >= 2) cands.push(mk((x) => x === pairs[0] || x === pairs[1]));
  // Straßenfenster
  const maxS = Math.max(...run.dice.map((d) => d.sides));
  for (const len of [4, 5]) {
    for (let s = 1; s + len - 1 <= maxS; s++) {
      const used = new Set();
      cands.push(values.map((v, i) => {
        if (wild[i]) return true;
        if (v >= s && v < s + len && !used.has(v)) {
          used.add(v);
          return true;
        }
        return false;
      }));
    }
  }
  cands.push(mk((x) => x > 0 && x % 2 === 0));
  cands.push(mk((x) => x > 0 && x % 2 === 1));
  cands.push(mk(() => false));
  // gefesselte Würfel können nicht gehalten werden
  return cands.map((c) => c.map((h, i) => h && !shackled[i])).filter((c) => c.some((h, i) => !h) || n === 0);
}

function bestScoreNow(run) {
  let hands = G.availableHands(run).filter((h) => h.allowed);
  const w = run.round.wardenId ? WARDENS[run.round.wardenId] : null;
  if (w && w.fixation && !run.round.playedHands.length && run.round.score + 0 < run.round.target) {
    // Fixierung: eine leicht wiederholbare Hand festlegen (Paar ist fast immer enthalten)
    const pair = hands.find((h) => h.handId === 'pair');
    if (pair) {
      const r = G.previewScore(run, 'pair');
      if (r && r.total < run.round.target - run.round.score) return { handId: 'pair', total: r.total };
    }
  }
  let best = null;
  for (const h of hands.slice(0, 5)) {
    const r = G.previewScore(run, h.handId);
    if (r && (!best || r.total > best.total)) best = { handId: h.handId, total: r.total };
  }
  return best;
}

function playThrow(run, bot) {
  let res = G.beginThrow(run);
  if (!res.ok) throw new Error('beginThrow: ' + res.reason);
  const round = run.round;
  for (let guard = 0; guard < 20; guard++) {
    const now = bestScoreNow(run);
    if (!now) break;
    const need = round.target - round.score;
    if (now.total >= need || round.rerollsLeft <= 0) break;
    const base = currentLogic(run);
    const curApprox = Math.max(1, approxBest(run, bot, base.values, base.wild, base.wildMax));
    let bestHold = null;
    let bestEv = -1;
    for (const c of holdCandidates(run, base)) {
      const ev = evalHold(run, bot, c, base, bot.samples);
      if (ev > bestEv) {
        bestEv = ev;
        bestHold = c;
      }
    }
    // Nachwurf lohnt? Bei knappem Budget nur bei deutlicher Verbesserung.
    const throwsLeft = round.throwsLeft;
    const behind = now.total * throwsLeft < need;
    const perThrow = round.rerollsLeft / Math.max(1, throwsLeft);
    const threshold = behind || perThrow >= 0.5 ? 1.0 : 1.1;
    if (!bestHold || bestEv < curApprox * threshold) break;
    round.rolled.forEach((r, i) => {
      if (!!r.held !== !!bestHold[i]) G.toggleHold(run, i);
    });
    res = G.reroll(run);
    if (!res.ok) break;
  }
  const now = bestScoreNow(run);
  if (bot.snapshots) {
    bot.snapshots.push({ rolled: JSON.parse(JSON.stringify(round.rolled)), dieIds: run.dice.map((d) => d.id), rerollsUsed: round.rerollsUsedThisThrow, throwsUsed: round.throwsUsed });
    if (bot.snapshots.length > 24) bot.snapshots.shift();
  }
  res = G.scoreThrow(run, now ? now.handId : undefined);
  if (!res.ok) throw new Error('scoreThrow: ' + res.reason);
  return res;
}

// ------------------------------------------------------------------ Laden

// Wert eines Talisman-Satzes: die letzten echten Würfe des Bots neu werten (leichte Kopie des Runs).
function lightClone(run) {
  return {
    ...run,
    rng: { ...run.rng, chance: { ...run.rng.chance } },
    dice: JSON.parse(JSON.stringify(run.dice)),
    talismans: JSON.parse(JSON.stringify(run.talismans)),
    stats: { ...run.stats },
  };
}

const PASSIVE_GAIN = { stamina: 1.22, tower: 1.08, sixth_sense: 1.18, second_wind: 1.06, hoard: 1.04, loaded: 0.94, stocking: 1.03, rebate: 1.02 };
const GROWTH_GAIN = { tally: 1.1, spirit: 1.15, tally_board: 1.05, momentum: 1.03 };

function configScore(run, bot, talismans) {
  const snaps = bot.snapshots.filter((sn) => sn.dieIds.length === run.dice.length);
  if (!snaps.length) return 1;
  let total = 0;
  for (const sn of snaps) {
    const base = lightClone(run);
    base.talismans = talismans.map((t) => JSON.parse(JSON.stringify(t)));
    base.dice.forEach((d, i) => {
      if (base.dice[i].id !== sn.dieIds[i]) return;
    });
    base.round = {
      kind: 'small', wardenId: null, target: 1e12, score: 0, throwsLeft: 1, rerollsLeft: 1,
      rolled: sn.rolled.map((r, i) => ({ ...r, faceIndex: Math.min(r.faceIndex, base.dice[i].faces.length - 1) })),
      rerollsUsedThisThrow: sn.rerollsUsed, rerollsUsed: sn.rerollsUsed, throwsUsed: sn.throwsUsed, playedHands: [], lastHandRank: -1,
      flags: { grudged: [], rebate: 0 },
    };
    base.round.rolled.forEach((r, i) => { r.v = base.dice[i].faces[r.faceIndex].v + (r.nudged || 0); });
    const hands = handsInThrow(base).slice(0, 3);
    let best = 0;
    for (const h of hands) {
      const c = lightClone(base);
      c.round = { ...base.round, flags: { grudged: [], rebate: 0 } };
      const r = computeScore(c, h);
      if (r.total > best) best = r.total;
    }
    total += best;
  }
  let score = total / snaps.length;
  for (const t of talismans) score *= (PASSIVE_GAIN[t.id] || 1) * (t.state && Object.keys(t.state).length && GROWTH_GAIN[t.id] && !(t.state.n > 0) ? GROWTH_GAIN[t.id] : 1);
  return Math.max(1, score);
}

function fakeTalisman(id) {
  return { uid: 'eval-' + id, id, state: JSON.parse(JSON.stringify(TALISMANS[id].init || {})), disabled: false };
}

/** bester Gewinnfaktor, wenn Talisman id dazukommt (ggf. als Ersatz). → {gain, replace:uid|null} */
function talismanGain(run, bot, id) {
  const cur = run.talismans.filter((t) => !t.disabled || true);
  const now = configScore(run, bot, cur);
  if (cur.length < run.limits.talismans) {
    return { gain: configScore(run, bot, [...cur, fakeTalisman(id)]) / now, replace: null };
  }
  let best = { gain: 0, replace: null };
  cur.forEach((t, i) => {
    const next = cur.slice();
    next[i] = fakeTalisman(id);
    const g = configScore(run, bot, next) / now;
    if (g > best.gain) best = { gain: g, replace: t.uid };
  });
  return best;
}

function mainHand(run) {
  let best = 'pair';
  let bestN = -1;
  for (const [h, n] of Object.entries(run.handPlays)) {
    if (h === 'scatter') continue;
    const v = n * (HANDS[h].rank + 2);
    if (v > bestN) {
      bestN = v;
      best = h;
    }
  }
  return best;
}

function faceTargets(run, count) {
  // höchste Augen ohne Prägung auf verschiedenen Würfeln
  const out = [];
  const cands = [];
  run.dice.forEach((d, di) => d.faces.forEach((f, fi) => {
    if (!f.mark && f.v > 0) cands.push({ die: di, face: fi, v: f.v });
  }));
  cands.sort((a, b) => b.v - a.v || a.die - b.die);
  const used = new Set();
  for (const c of cands) {
    if (out.length >= count) break;
    if (used.has(c.die)) continue;
    used.add(c.die);
    out.push({ die: c.die, face: c.face });
  }
  return out;
}

/** Ziel für ein Verbrauchsgut wählen; null = nicht benutzen (verkaufen). */
function chooseTarget(run, id) {
  const def = CONSUMABLES[id];
  if (def.kind === 'star') return { target: null };
  switch (id) {
    case 't_stone':
    case 't_shaper':
    case 't_nudge':
    case 't_flip':
      return null;
    case 't_chisel': {
      for (let di = 0; di < run.dice.length; di++) {
        const d = run.dice[di];
        const fi = d.faces.findIndex((f) => f.v > 0 && f.v <= 2 && f.mark !== 'star');
        if (fi >= 0) return { target: { die: di, face: fi, value: d.sides } };
      }
      return null;
    }
    case 't_mirror': {
      for (let di = 0; di < run.dice.length; di++) {
        const d = run.dice[di];
        let hi = -1;
        let lo = -1;
        d.faces.forEach((f, fi) => {
          if (hi < 0 || f.v > d.faces[hi].v) hi = fi;
          if (lo < 0 || f.v < d.faces[lo].v) lo = fi;
        });
        if (d.faces[hi].v > d.faces[lo].v + 2) return { target: { faces: [{ die: di, face: hi }, { die: di, face: lo }] } };
      }
      return null;
    }
    case 't_lead':
    case 'm_prism':
    case 'm_crystal': {
      const di = run.dice.findIndex((d) => !d.material);
      return di >= 0 ? { target: { die: di } } : null;
    }
    case 'm_star': {
      for (let di = 0; di < run.dice.length; di++) {
        const fi = run.dice[di].faces.findIndex((f) => f.v === 1 && f.mark !== 'star');
        if (fi >= 0) return { target: { die: di, face: fi } };
      }
      return null;
    }
    case 't_coin':
    case 'm_phantom':
      return { target: null };
    case 'm_wish':
      return run.money <= 6 ? { target: null } : null;
    case 't_seer':
      return run.consumables.length < run.limits.consumables ? { target: null } : null;
    case 'm_double':
    case 'm_soul':
      return run.talismans.length < run.limits.talismans ? { target: null } : null;
    default: {
      if (def.target && (def.target.type === 'face' || def.target.type === 'faces')) {
        const fs = faceTargets(run, def.target.count || 1);
        if (!fs.length) return null;
        return { target: def.target.type === 'face' ? fs[0] : { faces: fs } };
      }
      return null;
    }
  }
}

function useInventory(run) {
  for (const c of [...run.consumables]) {
    const t = chooseTarget(run, c.id);
    if (t) {
      const r = G.useConsumable(run, c.uid, t.target);
      if (!r.ok) G.sell(run, { kind: 'consumable', uid: c.uid });
    } else if (run.phase === 'shop' || run.phase === 'blinds') {
      G.sell(run, { kind: 'consumable', uid: c.uid });
    }
  }
}

function handlePack(run, bot) {
  const pack = run.pack;
  const choices = pack.choices.map((o, i) => ({ o, i })).filter((x) => !x.o.sold);
  let pick = null;
  if (choices[0] && choices[0].o.kind === 'talisman') {
    let best = null;
    for (const c of choices) {
      const g = talismanGain(run, bot, c.o.id);
      if (!best || g.gain > best.g.gain) best = { c, g };
    }
    if (best && best.g.gain >= (best.g.replace ? 1.12 : 1.0)) {
      if (best.g.replace) G.sell(run, { kind: 'talisman', uid: best.g.replace });
      pick = { i: best.c.i };
    }
  } else if (choices[0] && choices[0].o.kind === 'die') {
    const score = (d) => d.faces.filter((f) => f.mark && f.mark !== 'stone').length + (d.material ? 1 : 0) - (d.sides !== 6 ? 1 : 0);
    choices.sort((a, b) => score(b.o.die) - score(a.o.die));
    const plain = run.dice.findIndex((d) => !d.src && !d.material && d.faces.every((f) => !f.mark));
    if (plain >= 0 && score(choices[0].o.die) > 0) pick = { i: choices[0].i, target: { die: plain } };
  } else {
    const main = mainHand(run);
    const ranked = choices.map((x) => {
      const def = CONSUMABLES[x.o.id];
      let v = 1;
      if (def.kind === 'star') v = def.hand === main ? 10 : HANDS[def.hand].rank >= 1 && HANDS[def.hand].rank <= 6 ? 4 : 1;
      if (def.kind === 'mystic') v = { m_soul: 9, m_crystal: 7, m_prism: 6, m_star: 6, m_double: 5, m_phantom: 5, m_wish: 3 }[def.id] || 2;
      if (def.kind === 'tool') v = { t_glass: 6, t_ruby: 5, t_chisel: 5, t_echo: 5, t_azure: 4, t_coin: 4, t_gold: 3, t_mirror: 3, t_clover: 3, t_lead: 2, t_seer: 3 }[def.id] || 0;
      return { ...x, v };
    });
    ranked.sort((a, b) => b.v - a.v);
    for (const x of ranked) {
      const def = CONSUMABLES[x.o.id];
      if (def.kind === 'star') {
        pick = { i: x.i };
        break;
      }
      const t = chooseTarget(run, x.o.id);
      if (t) {
        pick = { i: x.i, target: t.target };
        break;
      }
    }
  }
  if (pick) {
    const r = G.pickFromPack(run, pick.i, pick.target);
    if (r.ok) return;
  }
  G.skipPack(run);
}

function handleShop(run, bot) {
  useInventory(run);
  const reserve = run.ante <= 1 ? 0 : Math.min(bot.reserve, 5 * run.ante);
  for (let guard = 0; guard < 30; guard++) {
    if (run.phase !== 'shop') return;
    let acted = false;
    const s = run.shop;
    // Privileg
    if (s.voucher && !s.voucher.sold && run.money >= s.voucher.price + reserve && bot.vouchers.includes(s.voucher.id)) {
      if (G.buy(run, { section: 'voucher', index: 0 }).ok) acted = true;
    }
    // Talismane (nach echtem Nutzen)
    s.offers.forEach((o, i) => {
      if (acted || o.sold || o.kind !== 'talisman') return;
      if (run.money < o.price) return;
      const g = talismanGain(run, bot, o.id);
      const need = g.replace ? 1.12 : 1.03;
      if (g.gain < need) return;
      if (g.replace) G.sell(run, { kind: 'talisman', uid: g.replace });
      if (G.buy(run, i).ok) acted = true;
    });
    if (acted) continue;
    // Sternbilder für die Haupthand
    const main = mainHand(run);
    s.offers.forEach((o, i) => {
      if (acted || o.sold || o.kind !== 'consumable') return;
      const def = CONSUMABLES[o.id];
      const want = def.kind === 'star' ? def.hand === main || bot.anyStar : chooseTarget(run, o.id) !== null;
      if (want && run.money - o.price >= reserve && run.consumables.length < run.limits.consumables) {
        if (G.buy(run, i).ok) {
          acted = true;
          useInventory(run);
        }
      }
    });
    if (acted) continue;
    // Beutel
    s.packs.forEach((o, i) => {
      if (acted || o.sold) return;
      const p = G.PACKS[o.id];
      const want = p.kind === 'talisman' ? true : p.kind !== 'dice' || bot.dicePacks;
      if (want && run.money - o.price >= reserve + 2) {
        const r = G.buy(run, { section: 'packs', index: i });
        if (r.ok) {
          acted = true;
          while (run.phase === 'pack') handlePack(run, bot);
        }
      }
    });
    if (acted) continue;
    // Neu mischen, wenn Platz und Geld
    const slotFree = run.talismans.length < run.limits.talismans;
    if (s.freeRerolls > 0 || (slotFree && run.money >= s.rerollCost + reserve + 6) || (run.ante >= 2 && run.money >= s.rerollCost + bot.richAt)) {
      if (G.shopReroll(run).ok) continue;
    }
    break;
  }
  useInventory(run);
}

// ------------------------------------------------------------------ Lauf

export function playRun(seed, opts = {}) {
  const run = G.newRun({ seed, cup: opts.cup || 'wood', stake: opts.stake || 1 });
  const bot = {
    rng: makeStream(hashSeed(`bot:${seed}`)),
    samples: opts.samples || 10,
    reserve: opts.reserve === undefined ? 15 : opts.reserve,
    vouchers: ['v_cup', 'v_cup2', 'v_hand', 'v_slot', 'v_slot2', 'v_interest', 'v_haggle', 'v_sixth', 'v_shop'],
    anyStar: false,
    dicePacks: true,
    handBias: {},
    snapshots: [],
    richAt: opts.richAt === undefined ? 22 : opts.richAt,
  };
  const log = [];
  const trace = { anteMoney: {}, anteBest: {}, anteThrows: {} };
  let steps = 0;
  while (steps++ < 5000) {
    // Talisman-Vorlieben grob aktualisieren
    bot.handBias = {};
    for (const t of run.talismans) {
      if (t.id === 'ladder' || t.id === 'chain') bot.handBias.smallrun = (bot.handBias.smallrun || 0) + 3;
      if (t.id === 'triad') bot.handBias.triple = (bot.handBias.triple || 0) + 3;
      if (t.id === 'pentagram') bot.handBias.pasch = (bot.handBias.pasch || 0) + 10;
    }
    switch (run.phase) {
      case 'blinds': {
        if (run.vouchers.includes('v_ban') && run.wardenRerolledAnte !== run.ante && ['wall', 'abyss', 'lonely'].includes(run.wardens.current)) G.rerollWarden(run);
        trace.anteMoney[run.ante] = trace.anteMoney[run.ante] ?? run.money;
        const r = G.startBlind(run);
        if (!r.ok) throw new Error('startBlind: ' + r.reason);
        break;
      }
      case 'round': {
        const r = playThrow(run, bot);
        if (r.result.cleared === false && run.phase === 'lost') bot.lostAnte = run.ante;
        trace.anteBest[run.ante] = Math.max(trace.anteBest[run.ante] || 0, r.result.total);
        trace.anteThrows[run.ante] = (trace.anteThrows[run.ante] || []);
        trace.anteThrows[run.ante].push(r.result.total);
        break;
      }
      case 'cashout':
        G.cashOut(run);
        break;
      case 'shop':
        handleShop(run, bot);
        if (run.phase === 'shop') G.leaveShop(run);
        break;
      case 'pack':
        handlePack(run, bot);
        break;
      case 'won':
      case 'lost':
        return { run, won: run.phase === 'won', ante: run.ante, trace, log };
      default:
        throw new Error('Unbekannte Phase ' + run.phase);
    }
  }
  throw new Error('Lauf hängt fest');
}

// ------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const a = { runs: 200, seed: 'SIM', cup: 'wood', stake: 1, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--runs') a.runs = +argv[++i];
    else if (k === '--seed') a.seed = argv[++i];
    else if (k === '--cup') a.cup = argv[++i];
    else if (k === '--stake') a.stake = +argv[++i];
    else if (k === '--samples') a.samples = +argv[++i];
    else if (k === '--verbose') a.verbose = true;
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv);
  const t0 = process.hrtime.bigint();
  const reached = {};
  let wins = 0;
  const wardenLoss = {};
  const blindLoss = { small: 0, big: 0, warden: 0 };
  const anteThrows = {};
  const anteMoney = {};
  const talismanWins = {};
  const talismanSeen = {};
  for (let i = 0; i < a.runs; i++) {
    const seed = `${a.seed}-${i}`;
    const r = playRun(seed, { cup: a.cup, stake: a.stake, samples: a.samples });
    reached[r.ante] = (reached[r.ante] || 0) + 1;
    if (r.won) wins++;
    else {
      const lt = r.run.stats.lostTo;
      if (lt) {
        blindLoss[lt.blind] = (blindLoss[lt.blind] || 0) + 1;
        if (lt.wardenId) wardenLoss[lt.wardenId] = (wardenLoss[lt.wardenId] || 0) + 1;
      }
    }
    for (const [ante, list] of Object.entries(r.trace.anteThrows)) {
      (anteThrows[ante] = anteThrows[ante] || []).push(...list);
    }
    for (const [ante, m] of Object.entries(r.trace.anteMoney)) (anteMoney[ante] = anteMoney[ante] || []).push(m);
    for (const t of r.run.talismans) {
      talismanSeen[t.id] = (talismanSeen[t.id] || 0) + 1;
      if (r.won) talismanWins[t.id] = (talismanWins[t.id] || 0) + 1;
    }
    if (a.verbose) {
      console.log(`${seed}: ${r.won ? 'SIEG' : 'Niederlage'} Einsatz ${r.ante} ${r.won ? '' : JSON.stringify(r.run.stats.lostTo)} | $${r.run.money} | ${r.run.talismans.map((t) => t.id).join(',')} | best ${r.run.stats.bestThrow}`);
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const pct = (n) => `${((100 * n) / a.runs).toFixed(1)} %`;
  console.log(`\nPasch-Sim: ${a.runs} Läufe, Becher ${a.cup}, Stufe ${a.stake}, Seed ${a.seed} (${(ms / 1000).toFixed(1)} s)`);
  console.log(`Siegquote: ${pct(wins)}`);
  console.log('Endstation (Einsatz, bei dem verloren wurde bzw. 8 = gewonnen/verloren in 8):');
  for (const k of Object.keys(reached).sort((x, y) => x - y)) console.log(`  Einsatz ${k}: ${reached[k]} (${pct(reached[k])})`);
  let survived = a.runs;
  const keys = Object.keys(reached).map(Number).sort((x, y) => x - y);
  console.log('Einsatz geschafft:');
  for (let ante = 1; ante <= 8; ante++) {
    const lostHere = ante === 8 ? a.runs - wins - keys.filter((k) => k < 8).reduce((s, k) => s + reached[k], 0) : reached[ante] || 0;
    survived -= lostHere;
    console.log(`  ${ante}: ${pct(survived)}`);
  }
  console.log('Niederlagen nach Partie:', blindLoss);
  console.log('Niederlagen nach Wächter:', Object.entries(wardenLoss).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('Punkte je Wurf (Median / Mittel) und Geld zu Beginn je Einsatz:');
  for (const ante of Object.keys(anteThrows).sort((x, y) => x - y)) {
    const l = anteThrows[ante].slice().sort((x, y) => x - y);
    const med = l[Math.floor(l.length / 2)];
    const mean = l.reduce((s, x) => s + x, 0) / l.length;
    const m = anteMoney[ante] || [];
    const mm = m.length ? m.reduce((s, x) => s + x, 0) / m.length : 0;
    console.log(`  Einsatz ${ante}: ${Math.round(med)} / ${Math.round(mean)}  (Ziel Basis ${G.anteBase(+ante)})  $${mm.toFixed(1)}`);
  }
  if (a.verbose) {
    console.log('Talismane am Ende (Anzahl / davon Siege):');
    for (const [id, n] of Object.entries(talismanSeen).sort((x, y) => y[1] - x[1])) console.log(`  ${id}: ${n} / ${talismanWins[id] || 0}`);
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) main();

/** Für Experimente: einen Wurf mit der Bot-Strategie spielen. */
export function playThrowExport(run, opts = {}) {
  const bot = { rng: makeStream(hashSeed(`exp:${run.seed}:${run.round.throwsLeft}`)), samples: opts.samples || 10, handBias: {} };
  return playThrow(run, bot);
}
