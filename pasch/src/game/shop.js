// Laden: Angebote, Beutel, Privileg, Neu mischen, Beutel-Inhalte.
import { weighted, pick, shuffle } from '../core/rng.js';
import { SHOP_KIND_WEIGHTS, RARITY_WEIGHTS, SHOP_REROLL_BASE } from './constants.js';
import { TALISMANS, talismansByRarity } from './content/talismans.js';
import { CONSUMABLES, starIds, toolIds, mysticIds } from './content/consumables.js';
import { PACKS, PACK_WEIGHTS } from './content/packs.js';
import { VOUCHERS, availableVouchers } from './content/vouchers.js';
import { priceFor } from './economy.js';
import { randomSpecialDie } from './dice.js';
import { markSeen } from './inventory.js';

/** Talisman-IDs, die gerade nicht im Besitz und nicht schon ausgelegt sind. */
function talismanPool(run, rarity, exclude) {
  const owned = new Set(run.talismans.map((t) => t.id));
  return talismansByRarity(rarity).filter((id) => !owned.has(id) && !exclude.has(id));
}

export function randomTalismanId(run, stream, exclude = new Set(), forcedRarity = null) {
  let rarity = forcedRarity || weighted(stream, Object.entries(RARITY_WEIGHTS));
  let pool = talismanPool(run, rarity, exclude);
  if (!pool.length) {
    for (const r of ['common', 'uncommon', 'rare']) {
      pool = talismanPool(run, r, exclude);
      if (pool.length) break;
    }
  }
  if (!pool.length) return null;
  return pick(stream, pool);
}

function offerFor(run, kind, id, opts = {}) {
  let base;
  if (kind === 'talisman') base = TALISMANS[id].price;
  else if (kind === 'consumable') base = CONSUMABLES[id].price;
  else if (kind === 'pack') base = PACKS[id].price;
  else if (kind === 'voucher') base = VOUCHERS[id].price;
  else base = 0;
  const o = { kind, id, price: priceFor(run, base, { ...opts, kind }), basePrice: base, sold: false };
  if (opts.free) o.free = true;
  return o;
}

function excludeSet(run) {
  const ex = new Set();
  if (run.shop) for (const o of run.shop.offers) if (o.kind === 'talisman' && !o.sold) ex.add(o.id);
  return ex;
}

export function randomOffer(run, stream, exclude) {
  const w = { ...SHOP_KIND_WEIGHTS };
  if (run.vouchers.includes('v_stars')) w.star *= 2;
  const kind = weighted(stream, Object.entries(w));
  if (kind === 'talisman') {
    const id = randomTalismanId(run, stream, exclude);
    if (id) {
      exclude.add(id);
      markSeen(run, 'talismans', id);
      return offerFor(run, 'talisman', id);
    }
  }
  if (kind === 'tool') {
    const id = pick(stream, toolIds());
    markSeen(run, 'consumables', id);
    return offerFor(run, 'consumable', id);
  }
  const id = pick(stream, starIds(run));
  markSeen(run, 'consumables', id);
  return offerFor(run, 'consumable', id);
}

function fillOffers(run) {
  const s = run.rng.shop;
  const exclude = new Set();
  const offers = [];
  for (let k = 0; k < run.limits.shopSlots; k++) offers.push(randomOffer(run, s, exclude));
  return offers;
}

/** Neuen Laden aufbauen (nach der Abrechnung). Wertet Laden-Marken aus. */
export function enterShop(run) {
  const events = [];
  run.shop = { offers: [], packs: [], voucher: null, rerollCost: SHOP_REROLL_BASE, rerolls: 0, freeRerolls: 0, sale: false };
  // Marken für den Laden
  const remaining = [];
  for (const g of run.tags) {
    if (g === 'tag_sale') {
      run.shop.sale = true;
      run.shop.freeRerolls += 2;
      events.push({ type: 'tagUsed', id: g });
    } else remaining.push(g);
  }
  run.tags = remaining;
  run.shop.offers = fillOffers(run);
  const charmTags = run.tags.filter((g) => g === 'tag_charm').length;
  if (charmTags) {
    run.tags = run.tags.filter((g) => g !== 'tag_charm');
    for (let k = 0; k < charmTags; k++) {
      const id = randomTalismanId(run, run.rng.shop, excludeSet(run), 'uncommon');
      if (id) {
        run.shop.offers.push(offerFor(run, 'talisman', id, { free: true }));
        markSeen(run, 'talismans', id);
      }
      events.push({ type: 'tagUsed', id: 'tag_charm' });
    }
  }
  for (const t of run.talismans) {
    const def = TALISMANS[t.id];
    if (def && def.onShopEnter && !t.disabled) events.push(...(def.onShopEnter(run, t) || []));
  }
  for (let k = 0; k < 2; k++) run.shop.packs.push(offerFor(run, 'pack', weighted(run.rng.shop, PACK_WEIGHTS)));
  if (run.anteVoucher && !run.vouchers.includes(run.anteVoucher)) run.shop.voucher = offerFor(run, 'voucher', run.anteVoucher);
  return events;
}

/** Nur die Angebotsplätze neu mischen (Beutel und Privileg bleiben). */
export function rerollOffers(run) {
  const keepFree = run.shop.offers.filter((o) => o.free && !o.sold);
  run.shop.offers = [];
  run.shop.offers = fillOffers(run).concat(keepFree);
}

export function pickAnteVoucher(run) {
  const pool = availableVouchers(run);
  run.anteVoucher = pool.length ? pick(run.rng.shop, pool) : null;
}

/** Größe/Wahlen eines Beutels inkl. Talisman-Hook modifyPack → {size, picks}. */
export function packShape(run, packId) {
  const p = { size: PACKS[packId].size, picks: PACKS[packId].picks };
  for (const t of run.talismans) {
    const def = TALISMANS[t.id];
    if (def && def.modifyPack && !t.disabled) def.modifyPack(p, run, t);
  }
  p.picks = Math.max(1, Math.min(p.picks, p.size));
  return p;
}

/** Inhalt eines Beutels erzeugen → Offer[] (kind 'talisman' | 'consumable' | 'die'). */
export function packChoices(run, packId) {
  const pack = { ...PACKS[packId], ...packShape(run, packId) };
  const s = run.rng.pack;
  const out = [];
  const mkC = (id) => ({ kind: 'consumable', id, price: 0, sold: false });
  if (pack.kind === 'star') {
    const pool = shuffle(s, starIds(run).slice());
    for (let k = 0; k < pack.size; k++) out.push(mkC(pool[k % pool.length]));
  } else if (pack.kind === 'tool') {
    const pool = shuffle(s, toolIds().slice());
    for (let k = 0; k < pack.size; k++) out.push(mkC(pool[k % pool.length]));
  } else if (pack.kind === 'mystic') {
    const pool = shuffle(s, mysticIds().slice());
    for (let k = 0; k < pack.size; k++) out.push(mkC(pool[k % pool.length]));
  } else if (pack.kind === 'talisman') {
    const ex = excludeSet(run);
    for (let k = 0; k < pack.size; k++) {
      const id = randomTalismanId(run, s, ex);
      if (!id) break;
      ex.add(id);
      out.push({ kind: 'talisman', id, price: 0, sold: false });
    }
  } else if (pack.kind === 'dice') {
    for (let k = 0; k < pack.size; k++) out.push({ kind: 'die', id: 'die', price: 0, sold: false, die: randomSpecialDie(run, s) });
  }
  for (const o of out) if (o.kind === 'talisman') markSeen(run, 'talismans', o.id);
  for (const o of out) if (o.kind === 'consumable') markSeen(run, 'consumables', o.id);
  return out;
}
