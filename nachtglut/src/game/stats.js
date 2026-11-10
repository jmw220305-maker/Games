// Player stat model: final = (base + sum(add)) * product(mul), then clamped.

export const BASE_STATS = Object.freeze({
  maxHp: 100, regen: 0, armor: 0, dodge: 0, iframes: 0.7,
  damage: 1, fireRate: 1, critChance: 0.05, critMult: 1.75,
  projSpeed: 1, range: 1, projSize: 1, pierce: 0, bounce: 0, multishot: 0, homing: 0, knockback: 1,
  moveSpeed: 92, dashCooldown: 1.1, dashCharges: 1, dashDistance: 1, skillCooldown: 1, skillPower: 1,
  pickupRadius: 28, luck: 0, xpGain: 1, sparkGain: 1, ashGain: 1,
  lifesteal: 0, thorns: 0, lightRadius: 110,
  burnChance: 0, chillChance: 0, poisonChance: 0, shockChance: 0, statusPower: 1, statusDuration: 1,
  fireDamage: 1, frostDamage: 1, poisonDamage: 1, shockDamage: 1, shadowDamage: 1, physDamage: 1, lightDamage: 1,
  shopDiscount: 0, healPower: 1, bossDamage: 1, eliteDamage: 1,
});

export const STAT_NAMES = Object.freeze(Object.keys(BASE_STATS));

const LIMITS = {
  maxHp: [1, 9999], regen: [0, 50], armor: [0, 60], dodge: [0, 0.6], iframes: [0.2, 3],
  damage: [0.1, 50], fireRate: [0.2, 6], critChance: [0, 1], critMult: [1, 10],
  projSpeed: [0.3, 4], range: [0.3, 4], projSize: [0.4, 4], pierce: [0, 99], bounce: [0, 20], multishot: [0, 12], homing: [0, 12], knockback: [0, 6],
  moveSpeed: [35, 230], dashCooldown: [0.2, 6], dashCharges: [1, 5], dashDistance: [0.4, 3], skillCooldown: [0.25, 4], skillPower: [0.1, 20],
  pickupRadius: [8, 400], luck: [-10, 30], xpGain: [0.1, 10], sparkGain: [0, 10], ashGain: [0.1, 10],
  lifesteal: [0, 0.5], thorns: [0, 999], lightRadius: [40, 320],
  burnChance: [0, 1], chillChance: [0, 1], poisonChance: [0, 1], shockChance: [0, 1], statusPower: [0.1, 20], statusDuration: [0.2, 6],
  shopDiscount: [0, 0.6], healPower: [0, 6], bossDamage: [0.1, 20], eliteDamage: [0.1, 20],
};
const INT_STATS = new Set(['pierce', 'bounce', 'multishot', 'dashCharges']);

/**
 * @param {Iterable<Array<{stat:string, add?:number, mul?:number}>>} modLists
 * @returns {Record<string, number>}
 */
export function computeStats(modLists) {
  const add = {}, mul = {};
  for (const list of modLists) {
    if (!list) continue;
    for (const m of list) {
      if (!m || !(m.stat in BASE_STATS)) continue;
      if (typeof m.add === 'number' && Number.isFinite(m.add)) add[m.stat] = (add[m.stat] || 0) + m.add;
      if (typeof m.mul === 'number' && Number.isFinite(m.mul)) mul[m.stat] = (mul[m.stat] ?? 1) * m.mul;
    }
  }
  const out = {};
  for (const k of STAT_NAMES) {
    let v = (BASE_STATS[k] + (add[k] || 0)) * (mul[k] ?? 1);
    const lim = LIMITS[k];
    if (lim) v = v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
    else v = v < 0.05 ? 0.05 : v;
    if (INT_STATS.has(k)) v = Math.floor(v + 1e-6);
    out[k] = v;
  }
  return out;
}

export const TYPE_STAT = Object.freeze({
  phys: 'physDamage', fire: 'fireDamage', frost: 'frostDamage', poison: 'poisonDamage', shock: 'shockDamage', shadow: 'shadowDamage', light: 'lightDamage',
});
