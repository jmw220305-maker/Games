// Geld: Ziele, Belohnungen, Zinsen, Preise, Abrechnung.
import { ANTE_BASES, BLIND_MULT, BLIND_REWARD, INTEREST_STEP, MONEY_PER_THROW_LEFT, BLIND_NAMES } from './constants.js';
import { WARDENS } from './content/wardens.js';
import { CUPS } from './content/cups.js';
import { TALISMANS } from './content/talismans.js';

function roundSig(n, digits) {
  if (n <= 0) return 0;
  const e = Math.floor(Math.log10(n)) - (digits - 1);
  const p = Math.pow(10, e);
  return Math.round(n / p) * p;
}

/** Basisziel eines Einsatzes (Endlos: 50000 · (1,6^(a−8))^(1 + 0,2·(a−8)), 2 signifikante Stellen). */
export function anteBase(ante) {
  if (ante <= 0) return ANTE_BASES[0];
  if (ante <= ANTE_BASES.length) return ANTE_BASES[ante - 1];
  const k = ante - 8;
  return roundSig(50000 * Math.pow(Math.pow(1.6, k), 1 + 0.2 * k), 2);
}

export function blindTarget(run, kind, wardenId) {
  let mul = BLIND_MULT[kind];
  if (kind === 'warden') {
    const w = WARDENS[wardenId];
    if (w && w.targetMul !== undefined) mul = w.targetMul;
    if (run.stake >= 5) mul *= 1.25;
  }
  if (run.stake >= 3) mul *= 1.2;
  const cup = CUPS[run.cup];
  if (cup && cup.targetMul) mul *= cup.targetMul;
  return Math.round(anteBase(run.ante) * mul);
}

export function blindReward(run, kind) {
  if (kind === 'small' && run.stake >= 2) return 0;
  return BLIND_REWARD[kind];
}

export function interest(run, money = run.money) {
  return Math.max(0, Math.min(Math.floor(Math.max(0, money) / INTEREST_STEP), run.base.interestCap));
}

/** Ladenpreis inkl. Feilscher (−25 %) und Ausverkauf (−50 %), mind. $1. */
export function priceFor(run, base, opts = {}) {
  if (opts.free) return 0;
  let p = base;
  if (run.vouchers.includes('v_haggle')) p = Math.floor(p * 0.75);
  if (opts.sale || (run.shop && run.shop.sale)) p = Math.floor(p * 0.5);
  return Math.max(1, p);
}

/** Aufstellung der Abrechnung nach einer gewonnenen Partie (ohne Seiteneffekte). */
export function cashoutBreakdown(run) {
  const round = run.round;
  const blind = run.blinds[run.blindIndex];
  const out = [];
  const reward = blindReward(run, blind.kind);
  out.push({ label: BLIND_NAMES[blind.kind], amount: reward, kind: 'reward' });
  const left = round ? Math.max(0, round.throwsLeft) : 0;
  if (left > 0) out.push({ label: `Übrige Würfe (${left})`, amount: left * MONEY_PER_THROW_LEFT, kind: 'throws' });
  const zins = interest(run);
  if (zins > 0) out.push({ label: `Zinsen ($1 je $${INTEREST_STEP}, max. $${run.base.interestCap})`, amount: zins, kind: 'interest' });
  for (const t of run.talismans) {
    const def = TALISMANS[t.id];
    if (def && def.cashout && !t.disabled) {
      const a = def.cashout(run, t);
      if (a) out.push({ label: def.name, amount: a, kind: 'talisman', uid: t.uid });
    }
  }
  if (blind.kind === 'warden') {
    const n = run.tags.filter((g) => g === 'tag_money').length;
    if (n > 0) out.push({ label: 'Investition', amount: 15 * n, kind: 'tag' });
  }
  return out;
}
