// Lauf-Zustand und alle Spieler-Aktionen. Jede Aktion mutiert `run` und gibt
// { ok:true, events:[...] } oder { ok:false, reason:'…' } zurück.
import { hashSeed, makeStream, pick, shuffle, int } from '../core/rng.js';
import { deepClone } from '../core/util.js';
import {
  RUN_VERSION, START_MONEY, BASE_THROWS, BASE_REROLLS, BASE_INTEREST_CAP, LIMITS, ANTES_TO_WIN, BLIND_KINDS,
  BLIND_NAMES, SHOP_REROLL_BASE, MAX_DICE_ABSOLUTE,
} from './constants.js';
import { HANDS, HAND_ORDER, handBase } from './hands.js';
import { makeDie, rollFaceIndex, countedDice } from './dice.js';
import { TALISMANS, describeTalisman, sellValue } from './content/talismans.js';
import { CONSUMABLES, describeConsumable, consumableSellValue, flipRolled } from './content/consumables.js';
import { WARDENS, wardenPool } from './content/wardens.js';
import { VOUCHERS } from './content/vouchers.js';
import { PACKS } from './content/packs.js';
import { TAGS, TAG_IDS } from './content/tags.js';
import { CUPS } from './content/cups.js';
import { STAKES } from './content/stakes.js';
import { handsInThrow, computeScore, currentWarden } from './scoring.js';
import { blindTarget, blindReward, cashoutBreakdown, interest, anteBase, priceFor } from './economy.js';
import { enterShop, rerollOffers, pickAnteVoucher, packChoices, randomOffer } from './shop.js';
import { acquireTalisman, removeTalisman, addConsumable, syncRolledToDice, markSeen } from './inventory.js';

const fail = (reason) => ({ ok: false, reason });
const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });

const STREAMS = ['roll', 'shop', 'chance', 'warden', 'pack', 'misc'];

function newStats() {
  return {
    throws: 0, rerolls: 0, bestThrow: 0, bestHand: null, moneyEarned: 0, hands: {}, roundsWon: 0, wardensBeaten: 0,
    skips: 0, constellationsUsed: 0, consumablesUsed: 0, talismansBought: 0, talismansOwned: 0, maxTalismans: 0,
    maxMoney: START_MONEY, glassShattered: 0, maxRetriggers: 0, retriggers: 0, legendaryOwned: 0, wardenNoReroll: 0,
    maxHandLevel: 1, highestAnte: 1, packsOpened: 0, shopRerolls: 0, scoreByAnte: {}, lostTo: null, wardensBeatenIds: [],
  };
}

// ---------------------------------------------------------------- Aufbau

export function newRun({ seed, cup = 'wood', stake = 1 } = {}) {
  const seedStr = String(seed === undefined || seed === null || seed === '' ? 'PASCH' : seed);
  const rng = {};
  for (const name of STREAMS) rng[name] = makeStream(hashSeed(`${seedStr}:${name}`));
  const run = {
    version: RUN_VERSION,
    seed: seedStr,
    cup: CUPS[cup] ? cup : 'wood',
    stake: Math.max(1, Math.min(5, stake | 0 || 1)),
    rng,
    ante: 1,
    blindIndex: 0,
    phase: 'blinds',
    money: START_MONEY,
    dice: [],
    talismans: [],
    consumables: [],
    limits: { ...LIMITS },
    base: { throws: BASE_THROWS, rerolls: BASE_REROLLS, interestCap: BASE_INTEREST_CAP },
    handLevels: {},
    handPlays: {},
    vouchers: [],
    tags: [],
    wardens: { current: null, seen: [] },
    blinds: [],
    round: null,
    shop: null,
    pack: null,
    pendingPacks: [],
    anteVoucher: null,
    wardenRerolledAnte: 0,
    endless: false,
    won: false,
    nextUid: 0,
    seen: { talismans: [], consumables: [], wardens: [] },
    stats: newStats(),
    log: [],
  };
  for (const h of HAND_ORDER) {
    run.handLevels[h] = 1;
    run.handPlays[h] = 0;
  }
  for (let i = 0; i < 5; i++) run.dice.push(makeDie(run, 6));
  CUPS[run.cup].apply(run);
  run.stats.maxMoney = run.money;
  setupAnte(run);
  return run;
}

function setupAnte(run) {
  run.wardens.current = drawWarden(run);
  pickAnteVoucher(run);
  run.blinds = BLIND_KINDS.map((kind) => {
    const b = {
      kind,
      name: BLIND_NAMES[kind],
      target: blindTarget(run, kind, run.wardens.current),
      reward: blindReward(run, kind),
      state: 'upcoming',
      tagOffer: kind === 'warden' ? null : pick(run.rng.misc, TAG_IDS),
    };
    if (kind === 'warden') b.wardenId = run.wardens.current;
    return b;
  });
  run.blindIndex = 0;
  run.blinds[0].state = 'current';
  run.stats.highestAnte = Math.max(run.stats.highestAnte || 1, run.ante);
}

function drawWarden(run, exclude = []) {
  const pool = wardenPool(run.ante).filter((id) => !exclude.includes(id));
  let fresh = pool.filter((id) => !run.wardens.seen.includes(id));
  if (!fresh.length) fresh = pool;
  const id = pick(run.rng.warden, fresh) || 'wall';
  if (!run.wardens.seen.includes(id)) run.wardens.seen.push(id);
  if (!run.seen.wardens.includes(id)) run.seen.wardens.push(id);
  return id;
}

// ---------------------------------------------------------------- Regeln

/** Effektive Werte für die (nächste bzw. laufende) Partie inkl. Talismane, Privilegien, Wächter, Stufe, Marken. */
export function getRoundRules(run) {
  const blind = run.blinds[run.blindIndex];
  const rules = {
    throws: run.base.throws,
    rerolls: run.base.rerolls,
    interestCap: run.base.interestCap,
    talismanSlots: run.limits.talismans,
    consumableSlots: run.limits.consumables,
    diceLimit: run.limits.dice,
    target: blind ? blind.target : 0,
    reward: blind ? blind.reward : 0,
    wardenId: blind && blind.kind === 'warden' ? blind.wardenId : null,
  };
  if (run.stake >= 4) rules.rerolls -= 1;
  for (const t of run.talismans) {
    const def = TALISMANS[t.id];
    if (def && def.modifyRules && !t.disabled) def.modifyRules(rules, run, t);
  }
  rules.throws += run.tags.filter((g) => g === 'tag_throw').length;
  const w = rules.wardenId ? WARDENS[rules.wardenId] : null;
  if (w && w.rerollsZero) rules.rerolls = 0;
  if (w && w.throwsOne) rules.throws = 1;
  rules.throws = Math.max(1, rules.throws);
  rules.rerolls = Math.max(0, rules.rerolls);
  if (run.round) {
    rules.throwsLeft = run.round.throwsLeft;
    rules.rerollsLeft = run.round.rerollsLeft;
  }
  return rules;
}

// ---------------------------------------------------------------- Partien

export function startBlind(run) {
  if (run.phase !== 'blinds') return fail('Gerade kann keine Partie beginnen');
  const blind = run.blinds[run.blindIndex];
  if (!blind) return fail('Keine Partie verfügbar');
  const events = [];
  const round = {
    kind: blind.kind,
    wardenId: blind.kind === 'warden' ? blind.wardenId : null,
    target: blind.target,
    score: 0,
    throwsLeft: 0,
    rerollsLeft: 0,
    rolled: null,
    rolledThisTurn: false,
    rerollsUsedThisThrow: 0,
    rerollsUsed: 0,
    throwsUsed: 0,
    playedHands: [],
    lastHandRank: -1,
    flags: { grudged: [], rebate: 0, secondWindUsed: false },
  };
  run.round = round;
  const w = currentWarden(run);
  if (w && w.thief && run.talismans.length) {
    const t = pick(run.rng.warden, run.talismans);
    t.disabled = true;
    round.flags.thiefUid = t.uid;
    events.push({ type: 'talismanDisabled', uid: t.uid });
  }
  const rules = getRoundRules(run);
  round.throwsLeft = rules.throws;
  round.rerollsLeft = rules.rerolls;
  if (run.tags.includes('tag_throw')) {
    const n = run.tags.filter((g) => g === 'tag_throw').length;
    run.tags = run.tags.filter((g) => g !== 'tag_throw');
    for (let k = 0; k < n; k++) events.push({ type: 'tagUsed', id: 'tag_throw' });
  }
  for (const t of run.talismans) if (t.id === 'hoard') t.state.carry = 0;
  run.phase = 'round';
  if (w) events.push({ type: 'warden', id: w.id });
  return ok(events);
}

export function skipBlind(run) {
  if (run.phase !== 'blinds') return fail('Gerade kann nichts übersprungen werden');
  const blind = run.blinds[run.blindIndex];
  if (!blind || blind.kind === 'warden') return fail('Die Wächter-Partie kann nicht übersprungen werden');
  blind.state = 'skipped';
  run.stats.skips = (run.stats.skips || 0) + 1;
  const events = gainTag(run, blind.tagOffer);
  run.blindIndex += 1;
  run.blinds[run.blindIndex].state = 'current';
  return ok(events);
}

function gainTag(run, id) {
  const events = [];
  let n = 1;
  if (id !== 'tag_double' && run.tags.includes('tag_double')) {
    run.tags.splice(run.tags.indexOf('tag_double'), 1);
    n = 2;
    events.push({ type: 'tagUsed', id: 'tag_double' });
  }
  for (let k = 0; k < n; k++) {
    events.push({ type: 'tag', id });
    const def = TAGS[id];
    if (def.timing === 'now' && def.pack) run.pendingPacks.push(def.pack);
    else run.tags.push(id);
  }
  if (run.pendingPacks.length && run.phase !== 'pack') {
    const r = openNextPending(run, run.phase);
    events.push(...r);
  }
  return events;
}

export function rerollWarden(run) {
  if (!run.vouchers.includes('v_ban')) return fail('Dafür brauchst du das Privileg „Wächterbann“');
  if (run.phase !== 'blinds') return fail('Nur vor einer Partie möglich');
  if (run.wardenRerolledAnte === run.ante) return fail('In diesem Einsatz schon benutzt');
  const wb = run.blinds[2];
  if (wb.state === 'done') return fail('Der Wächter ist schon besiegt');
  const id = drawWarden(run, [run.wardens.current]);
  run.wardens.current = id;
  wb.wardenId = id;
  wb.target = blindTarget(run, 'warden', id);
  run.wardenRerolledAnte = run.ante;
  return ok([{ type: 'warden', id }]);
}

// ---------------------------------------------------------------- Würfeln

function inRound(run) {
  return run.phase === 'round' && run.round;
}

export function beginThrow(run) {
  if (!inRound(run)) return fail('Keine laufende Partie');
  const round = run.round;
  if (round.rolled) return fail('Die Würfel liegen schon');
  if (round.throwsLeft <= 0) return fail('Keine Würfe mehr');
  const w = currentWarden(run);
  round.rolled = run.dice.map((d) => {
    const fi = rollFaceIndex(run.rng.roll, d);
    return { dieId: d.id, faceIndex: fi, v: d.faces[fi].v, hidden: false, held: false, shackled: false, nudged: 0 };
  });
  const n = round.rolled.length;
  if (w && w.eclipse) round.rolled.forEach((r) => (r.hidden = true));
  if (w && w.fogCount) {
    const idx = shuffle(run.rng.warden, [...Array(n).keys()]).slice(0, Math.min(w.fogCount, n));
    for (const i of idx) round.rolled[i].hidden = true;
  }
  if (w && w.shackle) round.rolled[int(run.rng.warden, 0, n - 1)].shackled = true;
  round.rolledThisTurn = true;
  round.rerollsUsedThisThrow = 0;
  const dice = [...Array(n).keys()];
  return ok([{ type: 'roll', dice, results: round.rolled.map((r) => (r.hidden ? null : r.v)) }]);
}

export function toggleHold(run, i) {
  if (!inRound(run) || !run.round.rolled) return fail('Es liegen keine Würfel');
  const r = run.round.rolled[i];
  if (!r) return fail('Diesen Würfel gibt es nicht');
  if (r.shackled) return fail('Dieser Würfel ist gefesselt');
  r.held = !r.held;
  return ok([{ type: r.held ? 'hold' : 'unhold', die: i }]);
}

export function reroll(run) {
  if (!inRound(run) || !run.round.rolled) return fail('Es liegen keine Würfel');
  const round = run.round;
  if (round.rerollsLeft <= 0) return fail('Keine Nachwürfe mehr');
  const idx = [];
  round.rolled.forEach((r, i) => {
    if (!r.held) idx.push(i);
  });
  if (!idx.length) return fail('Alle Würfel sind gehalten');
  const w = currentWarden(run);
  for (const i of idx) {
    const r = round.rolled[i];
    const d = run.dice[i];
    r.faceIndex = rollFaceIndex(run.rng.roll, d);
    r.v = d.faces[r.faceIndex].v;
    r.nudged = 0;
    if (w && w.eclipse) r.hidden = false;
  }
  round.rerollsLeft -= 1;
  round.rerollsUsedThisThrow += 1;
  round.rerollsUsed += 1;
  run.stats.rerolls += 1;
  const events = [{ type: 'roll', dice: idx, results: idx.map((i) => (round.rolled[i].hidden ? null : round.rolled[i].v)) }];
  if (w && w.toll && run.money > 0) {
    run.money -= 1;
    events.push({ type: 'money', amount: -1, reason: 'Der Zöllner' });
  }
  for (const t of run.talismans) {
    const def = TALISMANS[t.id];
    if (def && def.onReroll && !t.disabled) events.push(...(def.onReroll(run, t, round) || []));
  }
  if (w && w.turner) {
    const i = int(run.rng.warden, 0, round.rolled.length - 1);
    events.push(flipRolled(run, i));
  }
  trackMoney(run);
  return ok(events);
}

/** Alle Hände im aktuellen Wurf, ranghöchste zuerst:
 * [{handId, name, rank, dice, scoring, values, base:{chips,mult}, level, allowed, reason, secret, hidden}] */
export function availableHands(run) {
  if (!inRound(run) || !run.round.rolled) return [];
  return handsInThrow(run);
}

function chooseEntry(run, handId) {
  const hands = handsInThrow(run);
  if (handId) {
    const e = hands.find((h) => h.handId === handId);
    if (!e) return { error: 'Diese Hand liegt nicht vor' };
    if (!e.allowed) return { error: e.reason || 'Diese Hand ist nicht erlaubt' };
    return { entry: e };
  }
  const e = hands.find((h) => h.allowed);
  if (!e) return { error: 'Keine erlaubte Hand' };
  return { entry: e };
}

/** Basiswerte der gewählten (oder besten erlaubten) Hand für die Live-Anzeige. */
export function previewHand(run, handId) {
  if (!inRound(run) || !run.round.rolled) return null;
  const c = chooseEntry(run, handId);
  if (c.error) {
    const any = handsInThrow(run).find((h) => h.handId === handId);
    if (!any) return null;
    return { handId: any.handId, name: any.name, chips: any.base.chips, mult: any.base.mult, dice: any.scoring, level: any.level, allowed: false };
  }
  const e = c.entry;
  return { handId: e.handId, name: e.name, chips: e.base.chips, mult: e.base.mult, dice: e.scoring, level: e.level, allowed: true };
}

/** Komplette Wertung auf einer Kopie (für Bot/Debug; verrät Zufall – nicht in der UI anzeigen). */
export function previewScore(run, handId) {
  if (!inRound(run) || !run.round.rolled) return null;
  const copy = deepClone(run);
  const c = chooseEntry(copy, handId);
  if (c.error) return null;
  return computeScore(copy, c.entry);
}

export function scoreThrow(run, handId) {
  if (!inRound(run)) return fail('Keine laufende Partie');
  const round = run.round;
  if (!round.rolled) return fail('Erst würfeln');
  const c = chooseEntry(run, handId);
  if (c.error) return fail(c.error);
  const entry = c.entry;
  const scoreBefore = round.score;
  const res = computeScore(run, entry);
  run.money += res.money;
  if (res.money > 0) run.stats.moneyEarned += res.money;
  round.score += res.total;
  round.playedHands.push(entry.handId);
  round.lastHandRank = entry.rank;
  round.throwsUsed += 1;
  round.throwsLeft -= 1;
  run.handPlays[entry.handId] = (run.handPlays[entry.handId] || 0) + 1;
  const st = run.stats;
  st.throws += 1;
  st.hands[entry.handId] = (st.hands[entry.handId] || 0) + 1;
  if (res.total > st.bestThrow) {
    st.bestThrow = res.total;
    st.bestHand = entry.handId;
  }
  st.retriggers += res.retriggers;
  st.maxRetriggers = Math.max(st.maxRetriggers, res.retriggers);
  st.scoreByAnte[run.ante] = Math.max(st.scoreByAnte[run.ante] || 0, res.total);
  trackMoney(run);

  const events = [...res.events];
  for (const s of res.steps) if (s.type === 'grow' && s.source.uid) events.push({ type: 'talismanGrow', uid: s.source.uid, text: s.text });
  if (res.money) events.push({ type: 'money', amount: res.money, reason: 'Wertung' });
  // Würfel freigeben
  round.rolled = null;
  round.rolledThisTurn = false;
  round.rerollsUsedThisThrow = 0;

  const cleared = round.score >= round.target;
  const result = {
    handId: entry.handId,
    handName: entry.name,
    level: entry.level,
    total: res.total,
    chips: res.chips,
    mult: res.mult,
    scoreBefore,
    scoreAfter: round.score,
    target: round.target,
    cleared,
    steps: res.steps,
    dice: res.scoring,
    money: res.money,
  };
  if (cleared) {
    events.push(...winRound(run));
  } else if (round.throwsLeft <= 0) {
    const sw = run.talismans.find((t) => t.id === 'second_wind' && !t.disabled);
    if (sw && !round.flags.secondWindUsed) {
      round.flags.secondWindUsed = true;
      round.throwsLeft = 1;
      events.push({ type: 'extraThrow', uid: sw.uid });
    } else {
      run.phase = 'lost';
      st.lostTo = { ante: run.ante, blind: round.kind, wardenId: round.wardenId, score: round.score, target: round.target };
      events.push({ type: 'roundLost' });
    }
  }
  return { ok: true, result, events };
}

function winRound(run) {
  const round = run.round;
  const events = [{ type: 'roundWon' }];
  const blind = run.blinds[run.blindIndex];
  blind.state = 'done';
  run.stats.roundsWon += 1;
  if (round.kind === 'warden') {
    run.stats.wardensBeaten += 1;
    if (!run.stats.wardensBeatenIds.includes(round.wardenId)) run.stats.wardensBeatenIds.push(round.wardenId);
    if (round.rerollsUsed === 0) run.stats.wardenNoReroll += 1;
  }
  // Talismane: Rundenende
  for (const t of [...run.talismans]) {
    const def = TALISMANS[t.id];
    if (def && def.onRoundEnd) {
      const evs = def.onRoundEnd(run, t, { won: true, rerollsLeft: round.rerollsLeft }) || [];
      for (const e of evs) {
        events.push(e);
        if (e.type === 'talismanBreak') removeTalisman(run, t.uid);
      }
    }
  }
  for (const t of run.talismans) t.disabled = false;
  if (round.kind === 'warden' && run.ante >= ANTES_TO_WIN && !run.endless) {
    run.phase = 'won';
    run.won = true;
    events.push({ type: 'runWon' });
  } else {
    run.phase = 'cashout';
  }
  return events;
}

// ---------------------------------------------------------------- Abrechnung & Laden

export function cashOut(run) {
  if (run.phase !== 'cashout') return fail('Gerade gibt es nichts abzurechnen');
  const breakdown = cashoutBreakdown(run);
  const total = breakdown.reduce((a, b) => a + b.amount, 0);
  run.money += total;
  run.stats.moneyEarned += total;
  if (run.blinds[run.blindIndex].kind === 'warden') run.tags = run.tags.filter((g) => g !== 'tag_money');
  trackMoney(run);
  run.round = null;
  run.phase = 'shop';
  const events = [{ type: 'money', amount: total, reason: 'Abrechnung' }];
  events.push(...enterShop(run));
  return { ok: true, events, breakdown, total };
}

/** Vorschau der Abrechnung (ohne Änderung). */
export function previewCashOut(run) {
  if (run.phase !== 'cashout') return null;
  return cashoutBreakdown(run);
}

export function shopReroll(run) {
  if (run.phase !== 'shop' || !run.shop) return fail('Kein Laden geöffnet');
  const s = run.shop;
  if (s.freeRerolls > 0) {
    s.freeRerolls -= 1;
  } else {
    if (run.money < s.rerollCost) return fail('Nicht genug Geld');
    run.money -= s.rerollCost;
    s.rerollCost += 1;
  }
  s.rerolls += 1;
  run.stats.shopRerolls += 1;
  rerollOffers(run);
  return ok([{ type: 'shopReroll' }]);
}

function resolveOffer(run, ref) {
  const s = run.shop;
  if (typeof ref === 'number') ref = { section: 'offers', index: ref };
  if (!ref || typeof ref !== 'object') return { error: 'Ungültiges Angebot' };
  if (ref.section === 'voucher') return s.voucher ? { offer: s.voucher, section: 'voucher' } : { error: 'Kein Privileg im Angebot' };
  const list = ref.section === 'packs' ? s.packs : ref.section === 'offers' ? s.offers : null;
  if (!list) return { error: 'Ungültiger Bereich' };
  const o = list[ref.index];
  if (!o) return { error: 'Ungültiges Angebot' };
  return { offer: o, section: ref.section };
}

export function buy(run, ref) {
  if (run.phase !== 'shop' || !run.shop) return fail('Kein Laden geöffnet');
  const r = resolveOffer(run, ref);
  if (r.error) return fail(r.error);
  const o = r.offer;
  if (o.sold) return fail('Schon verkauft');
  if (run.money < o.price) return fail('Nicht genug Geld');
  const events = [];
  if (o.kind === 'talisman') {
    if (run.talismans.length >= run.limits.talismans) return fail('Keine freien Talismanplätze');
    run.money -= o.price;
    const t = acquireTalisman(run, o.id);
    run.stats.talismansBought += 1;
    events.push({ type: 'gainTalisman', uid: t.uid, id: t.id });
  } else if (o.kind === 'consumable') {
    if (run.consumables.length >= run.limits.consumables) return fail('Keine freien Verbrauchsplätze');
    run.money -= o.price;
    const c = addConsumable(run, o.id);
    events.push({ type: 'gainConsumable', uid: c.uid, id: c.id });
  } else if (o.kind === 'voucher') {
    run.money -= o.price;
    run.vouchers.push(o.id);
    VOUCHERS[o.id].apply(run);
    run.anteVoucher = null;
    events.push({ type: 'voucher', id: o.id });
    if (o.id === 'v_shop') {
      const ex = new Set(run.shop.offers.filter((x) => x.kind === 'talisman').map((x) => x.id));
      run.shop.offers.push(randomOffer(run, run.rng.shop, ex));
    }
  } else if (o.kind === 'pack') {
    run.money -= o.price;
    o.sold = true;
    events.push({ type: 'money', amount: -o.price, reason: 'Kauf' });
    events.push(...openPackInternal(run, o.id, 'shop'));
    return ok(events);
  } else {
    return fail('Unbekanntes Angebot');
  }
  o.sold = true;
  if (o.price) events.unshift({ type: 'money', amount: -o.price, reason: 'Kauf' });
  return ok(events);
}

export function sell(run, ref) {
  if (!ref || !ref.uid) return fail('Nichts ausgewählt');
  if (run.phase === 'lost' || run.phase === 'won') return fail('Der Lauf ist vorbei');
  if (ref.kind === 'talisman') {
    const t = run.talismans.find((x) => x.uid === ref.uid);
    if (!t) return fail('Diesen Talisman besitzt du nicht');
    const v = sellValue(t);
    removeTalisman(run, t.uid);
    run.money += v;
    trackMoney(run);
    return ok([{ type: 'money', amount: v, reason: 'Verkauf' }, { type: 'sold', kind: 'talisman', uid: t.uid }]);
  }
  if (ref.kind === 'consumable') {
    const i = run.consumables.findIndex((x) => x.uid === ref.uid);
    if (i < 0) return fail('Dieses Verbrauchsgut besitzt du nicht');
    const [c] = run.consumables.splice(i, 1);
    const v = consumableSellValue(c);
    run.money += v;
    trackMoney(run);
    return ok([{ type: 'money', amount: v, reason: 'Verkauf' }, { type: 'sold', kind: 'consumable', uid: c.uid }]);
  }
  return fail('Das kann man nicht verkaufen');
}

export function sellPrice(run, ref) {
  if (ref.kind === 'talisman') {
    const t = run.talismans.find((x) => x.uid === ref.uid);
    return t ? sellValue(t) : 0;
  }
  const c = run.consumables.find((x) => x.uid === ref.uid);
  return c ? consumableSellValue(c) : 0;
}

export function moveTalisman(run, from, to) {
  const n = run.talismans.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= n || to < 0 || to >= n) return fail('Ungültige Position');
  const [t] = run.talismans.splice(from, 1);
  run.talismans.splice(to, 0, t);
  return ok([{ type: 'move', from, to }]);
}

export function leaveShop(run) {
  if (run.phase !== 'shop') return fail('Kein Laden geöffnet');
  run.shop = null;
  const cur = run.blinds[run.blindIndex];
  const events = [];
  if (cur.kind === 'warden') {
    run.ante += 1;
    setupAnte(run);
    events.push({ type: 'newAnte', ante: run.ante, wardenId: run.wardens.current });
  } else {
    run.blindIndex += 1;
    run.blinds[run.blindIndex].state = 'current';
  }
  run.phase = 'blinds';
  return ok(events);
}

export function continueEndless(run) {
  if (run.phase !== 'won') return fail('Erst den Lauf gewinnen');
  run.endless = true;
  run.phase = 'cashout';
  return ok([{ type: 'message', text: 'Endlos-Modus' }]);
}

// ---------------------------------------------------------------- Beutel

function openPackInternal(run, packId, returnPhase) {
  const choices = packChoices(run, packId);
  run.pack = { packId, choices, picksLeft: PACKS[packId].picks, returnPhase };
  run.phase = 'pack';
  run.stats.packsOpened += 1;
  return [{ type: 'packOpen', packId }];
}

function openNextPending(run, returnPhase) {
  if (!run.pendingPacks.length) return [];
  const id = run.pendingPacks.shift();
  return openPackInternal(run, id, returnPhase);
}

/** Öffnet den nächsten wartenden Gratis-Beutel (aus Marken). Normalerweise automatisch. */
export function openPack(run) {
  if (run.phase === 'pack') return fail('Ein Beutel ist schon offen');
  if (!run.pendingPacks.length) return fail('Kein Beutel zum Öffnen');
  if (run.phase !== 'blinds' && run.phase !== 'shop') return fail('Jetzt nicht');
  return ok(openNextPending(run, run.phase));
}

function closePack(run) {
  const ret = run.pack ? run.pack.returnPhase : 'shop';
  run.pack = null;
  run.phase = ret;
  if (run.pendingPacks.length) return openNextPending(run, ret);
  return [];
}

/**
 * Wahl aus dem offenen Beutel.
 * - Talisman: braucht freien Platz.
 * - Sternbild: wird sofort angewendet.
 * - Werkzeug/Mystik: target === undefined → behalten (freier Platz nötig); sonst sofort benutzen
 *   (target = Zielobjekt gemäß CONSUMABLES[id].target, oder null bei Gütern ohne Ziel).
 * - Würfel: target {die:i} ersetzt run.dice[i]; ohne Ziel nur, wenn das Würfellimit noch Platz hat.
 */
export function pickFromPack(run, choiceIndex, target) {
  if (run.phase !== 'pack' || !run.pack) return fail('Kein Beutel offen');
  const pack = run.pack;
  const o = pack.choices[choiceIndex];
  if (!o) return fail('Ungültige Wahl');
  if (o.sold) return fail('Schon gewählt');
  const events = [];
  if (o.kind === 'talisman') {
    if (run.talismans.length >= run.limits.talismans) return fail('Keine freien Talismanplätze');
    const t = acquireTalisman(run, o.id);
    events.push({ type: 'gainTalisman', uid: t.uid, id: t.id });
  } else if (o.kind === 'consumable') {
    const def = CONSUMABLES[o.id];
    if (def.kind === 'star') {
      events.push(...applyConsumable(run, def, null));
    } else if (target === undefined) {
      if (run.consumables.length >= run.limits.consumables) return fail('Kein freier Verbrauchsplatz – sofort benutzen oder überspringen');
      const c = addConsumable(run, o.id);
      events.push({ type: 'gainConsumable', uid: c.uid, id: c.id });
    } else {
      if (def.usableIn === 'round') return fail('Nur während eines Wurfs benutzbar – behalten statt benutzen');
      const err = validateTarget(run, def, target) || (def.validate ? def.validate(run, target) : null);
      if (err) return fail(err);
      events.push(...applyConsumable(run, def, target));
    }
  } else if (o.kind === 'die') {
    if (target && Number.isInteger(target.die)) {
      const old = run.dice[target.die];
      if (!old) return fail('Diesen Würfel gibt es nicht');
      if (old.src) return fail('Dieser Würfel gehört zu einem Talisman');
      run.dice[target.die] = o.die;
      events.push({ type: 'replaceDie', index: target.die, dieId: o.die.id, oldDieId: old.id });
    } else {
      const add = o.die.material === 'phantom' || countedDice(run) < run.limits.dice;
      if (!add || run.dice.length >= MAX_DICE_ABSOLUTE) return fail('Wähle einen Würfel, der ersetzt wird');
      run.dice.push(o.die);
      events.push({ type: 'gainDie', dieId: o.die.id });
    }
  }
  o.sold = true;
  pack.picksLeft -= 1;
  if (pack.picksLeft <= 0 || pack.choices.every((c) => c.sold)) events.push({ type: 'packClosed' }, ...closePack(run));
  return ok(events);
}

export function skipPack(run) {
  if (run.phase !== 'pack' || !run.pack) return fail('Kein Beutel offen');
  return ok([{ type: 'packClosed' }, ...closePack(run)]);
}

// ---------------------------------------------------------------- Verbrauchsgüter

function isIdx(x, n) {
  return Number.isInteger(x) && x >= 0 && x < n;
}

/** Prüft ein Ziel gegen CONSUMABLES[id].target → Fehlertext oder null. */
export function validateTarget(run, def, target) {
  const tt = def.target;
  if (!tt) return null;
  if (!target || typeof target !== 'object') return 'Ziel wählen';
  const nd = run.dice.length;
  const checkFace = (f) => {
    if (!f || !isIdx(f.die, nd)) return 'Würfel wählen';
    if (!isIdx(f.face, run.dice[f.die].faces.length)) return 'Fläche wählen';
    return null;
  };
  switch (tt.type) {
    case 'face':
      return checkFace(target);
    case 'faces': {
      const fs = target.faces;
      if (!Array.isArray(fs) || fs.length < 1) return 'Flächen wählen';
      if (fs.length > tt.count) return `Höchstens ${tt.count} Flächen`;
      if (tt.exact && fs.length !== tt.count) return `Genau ${tt.count} Flächen wählen`;
      for (const f of fs) {
        const e = checkFace(f);
        if (e) return e;
      }
      const keys = new Set(fs.map((f) => `${f.die}:${f.face}`));
      if (keys.size !== fs.length) return 'Verschiedene Flächen wählen';
      if (tt.sameDie && fs.some((f) => f.die !== fs[0].die)) return 'Flächen desselben Würfels wählen';
      return null;
    }
    case 'die':
      return isIdx(target.die, nd) ? null : 'Würfel wählen';
    case 'rolled': {
      if (!inRound(run) || !run.round.rolled) return 'Nur während eines Wurfs';
      if (!isIdx(target.rolled, run.round.rolled.length)) return 'Würfel wählen';
      if (run.round.rolled[target.rolled].hidden) return 'Verdeckte Würfel können nicht verändert werden';
      return null;
    }
    default:
      return null;
  }
}

function applyConsumable(run, def, target) {
  const events = def.use(run, target) || [];
  run.stats.consumablesUsed += 1;
  if (def.kind === 'star') run.stats.constellationsUsed += 1;
  run.stats.maxHandLevel = Math.max(run.stats.maxHandLevel || 1, ...Object.values(run.handLevels));
  trackMoney(run);
  return [{ type: 'consumableUsed', id: def.id }, ...events];
}

export function useConsumable(run, uid, target) {
  if (run.phase === 'lost' || run.phase === 'won') return fail('Der Lauf ist vorbei');
  const i = run.consumables.findIndex((c) => c.uid === uid);
  if (i < 0) return fail('Dieses Verbrauchsgut besitzt du nicht');
  const c = run.consumables[i];
  const def = CONSUMABLES[c.id];
  if (!def) return fail('Unbekanntes Verbrauchsgut');
  if (def.usableIn === 'round' && !(inRound(run) && run.round.rolled)) return fail('Nur während eines Wurfs benutzbar');
  const err = validateTarget(run, def, target);
  if (err) return fail(err);
  run.consumables.splice(i, 1);
  const err2 = def.validate ? def.validate(run, target) : null;
  if (err2) {
    run.consumables.splice(i, 0, c);
    return fail(err2);
  }
  return ok(applyConsumable(run, def, target));
}

// ---------------------------------------------------------------- Hilfen & Texte

function trackMoney(run) {
  run.stats.maxMoney = Math.max(run.stats.maxMoney || 0, run.money);
}

export function describeHand(handId, run) {
  const h = HANDS[handId];
  const level = run ? run.handLevels[handId] || 1 : 1;
  const b = handBase(handId, level);
  return `${h.name} (Stufe ${level}): ${b.chips} Punkte × ${b.mult} Multi. ${h.desc}`;
}

export function describeWarden(id) {
  const w = WARDENS[id];
  return w ? w.desc : '';
}

export function describeVoucher(id) {
  const v = VOUCHERS[id];
  return v ? v.desc : '';
}

export function describeTag(id) {
  const g = TAGS[id];
  return g ? g.desc : '';
}

export function describePack(id) {
  const p = PACKS[id];
  return p ? p.desc : '';
}

export function describeStake(id) {
  const s = STAKES[id];
  return s ? s.desc : '';
}

export function describeOffer(run, o) {
  if (!o) return '';
  if (o.kind === 'talisman') return describeTalisman({ id: o.id, state: {} }, run);
  if (o.kind === 'consumable') return describeConsumable(o, run);
  if (o.kind === 'pack') return describePack(o.id);
  if (o.kind === 'voucher') return describeVoucher(o.id);
  return '';
}

export { describeTalisman, describeConsumable };

/** Handtabelle für die Info-Anzeige (geheime Hände erst nach dem ersten Werten). */
export function handTable(run) {
  return HAND_ORDER.slice()
    .reverse()
    .filter((id) => !HANDS[id].secret || (run.handPlays[id] || 0) > 0)
    .map((id) => {
      const level = run.handLevels[id] || 1;
      return { handId: id, name: HANDS[id].name, level, ...handBase(id, level), plays: run.handPlays[id] || 0 };
    });
}

/** Sichere Kopie (Speichern/Laden). */
export function serializeRun(run) {
  return JSON.stringify(run);
}

export function loadRun(data) {
  try {
    const run = typeof data === 'string' ? JSON.parse(data) : deepClone(data);
    if (!run || run.version !== RUN_VERSION || !run.rng || !Array.isArray(run.dice)) return null;
    return run;
  } catch (e) {
    return null;
  }
}

export function isOver(run) {
  return run.phase === 'lost' || (run.phase === 'won' && !run.endless);
}

export { anteBase, interest, priceFor, markSeen, syncRolledToDice, SHOP_REROLL_BASE };
