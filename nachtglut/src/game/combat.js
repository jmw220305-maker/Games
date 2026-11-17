// Combat helpers: status effects (incl. the §12 threshold payoffs), weapon state, and the player-shot helpers used by weapons.
import { bus } from '../core/events.js';
import { TYPE_COLORS, STATUS_IDS } from './constants.js';
import { TYPE_STAT } from './stats.js';
import { runHooks } from './perks.js';

// ---------------------------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------------------------
// `burstAt`: stack count that triggers the threshold payoff (consumes all stacks; enemies only).
// `playerMaxStacks`: lower stack cap on the player. desc / burstName / burstDesc: German glossary text
// for the Chronik (burstName/burstDesc are null for statuses without a threshold payoff).
export const STATUS = {
  burn: {
    name: 'Brand', color: TYPE_COLORS.fire, duration: 3, maxStacks: 1, type: 'fire', fx: 'ember',
    desc: 'Feuerschaden über Zeit. Erneutes Entzünden frischt die Dauer auf.',
    burstName: null, burstDesc: null,
  },
  poison: {
    name: 'Gift', color: TYPE_COLORS.poison, duration: 4, maxStacks: 8, burstAt: 8, type: 'poison', fx: 'poison',
    desc: 'Stapelbarer Giftschaden über Zeit. Vergiftete Gegner heilen sich nur halb so stark.',
    burstName: 'Gifteruption', burstDesc: 'Bei 8 Stapeln platzt das Gift: starker Giftschaden, und die halben Stapel springen auf Gegner in der Nähe über.',
  },
  chill: {
    name: 'Frost', color: TYPE_COLORS.frost, duration: 3, maxStacks: 5, playerMaxStacks: 3, fx: 'frost',
    desc: 'Verlangsamt um 10 % pro Stapel.',
    burstName: 'Eingefroren', burstDesc: 'Bei 5 Stapeln erstarrt das Ziel kurz zu Eis. Bosse werden nur verlangsamt.',
  },
  freeze: {
    name: 'Eingefroren', color: '#d6f4ff', duration: 1.6, maxStacks: 1, fx: 'frost',
    desc: 'Kann sich weder bewegen noch angreifen. Danach kurz frostimmun.',
    burstName: null, burstDesc: null,
  },
  shock: {
    name: 'Schock', color: TYPE_COLORS.shock, duration: 4, maxStacks: 5, burstAt: 5, fx: 'shock',
    desc: 'Jede Ladung erhöht den erlittenen Schaden um 5 %. Treffer springen als Funke auf Nachbarn über.',
    burstName: 'Entladung', burstDesc: 'Bei 5 Ladungen entlädt sich ein Kettenblitz auf bis zu 4 weitere Gegner und betäubt kurz.',
  },
  mark: {
    name: 'Gezeichnet', color: '#ff4f7a', duration: 5, maxStacks: 1,
    desc: 'Erleidet 25 % mehr Schaden.',
    burstName: null, burstDesc: null,
  },
  stun: {
    name: 'Betäubt', color: '#ffe9a0', duration: 1, maxStacks: 1,
    desc: 'Kann weder handeln noch sich bewegen. Bosse werden stattdessen verlangsamt.',
    burstName: null, burstDesc: null,
  },
  weak: {
    name: 'Geschwächt', color: '#9a86c9', duration: 4, maxStacks: 1,
    desc: 'Verursacht 30 % weniger Schaden.',
    burstName: null, burstDesc: null,
  },
  slow: {
    name: 'Verlangsamt', color: '#7fa0c0', duration: 2.5, maxStacks: 1,
    desc: 'Bewegt sich deutlich langsamer.',
    burstName: null, burstDesc: null,
  },
  bleed: {
    name: 'Blutung', color: '#d6304a', duration: 4, maxStacks: 10, playerMaxStacks: 5, burstAt: 10, type: 'phys', fx: 'blood',
    desc: 'Schaden über Zeit, stärker in Bewegung. Ignoriert Rüstung. Wer blutet, heilt schwächer.',
    burstName: 'Aderlass', burstDesc: 'Bei 10 Stapeln reißt die Wunde auf: hoher Sofortschaden und eine Blutkugel, die heilt und Blutrausch weckt.',
  },
};

/** Glossary rows for the Chronik, in STATUS_IDS order. */
export function statusGlossary() {
  return STATUS_IDS.filter((id) => STATUS[id]).map((id) => {
    const d = STATUS[id];
    return { id, name: d.name, color: d.color, desc: d.desc, burstName: d.burstName, burstDesc: d.burstDesc, maxStacks: d.maxStacks, burstAt: d.burstAt ?? null };
  });
}

const DOT_TICK = 0.5;

// §12 tuning (exported for tests / UI text)
export const BLEED_MOVE_SPEED = 12;        // px/s: the target counts as moving above this speed
export const BLEED_MOVE_MUL = 1.6;         // bleed DoT multiplier while moving
export const PLAYER_BLEED_HEAL_MUL = 0.6;  // healing received by a bleeding player
export const POISON_HEAL_MUL = 0.5;        // healing received by a poisoned enemy
export const SHOCK_TAKEN_PER_STACK = 0.05; // damage taken per shock stack
export const ERUPT_RADIUS = 48;            // px, × run.flags.eruptRadiusMul
export const ERUPT_IMMUNE = 0.5;           // s an eruption-spread target cannot erupt
export const DISCHARGE_DAMAGE = 14;        // × status power, scaled like skill damage (shock)
export const DISCHARGE_JUMPS = 4;
export const DISCHARGE_RANGE = 80;         // px per jump
export const DISCHARGE_FALLOFF = 0.8;      // damage × per jump
export const BLOOD_ORB_LIFE = 8;           // s
export const BLOOD_ORB_BLINK = 2;          // s before despawn the orb blinks
export const FRENZY_TIME = 4;              // s per Blutrausch stack refresh
export const FRENZY_DAMAGE = 0.03;         // damage × per stack
export const FRENZY_SPEED = 0.02;          // moveSpeed × per stack
export const VAMP_PER_S = 6;               // vampirism heal budget (HP/s, also the cap)
export const VAMP_KILL_CAP = 0.04;         // vampirism heal per kill ≤ this × player maxHp
const BURST_MAX_DEPTH = 2;                 // a burst may cause at most one nested burst
const BURST_FRAME_CAP = 40;                // bursts per simulation step (same-frame chain guard)

export function hasStatus(target, id) {
  return !!(target && target.statuses && target.statuses[id]);
}

/**
 * Heal an enemy (affixes, drains, boss mechanics). Poisoned enemies heal only POISON_HEAL_MUL.
 * Clamped to maxHp. @returns {number} HP actually healed
 */
export function healEnemy(w, e, amount) {
  if (!e || e.dead || !(amount > 0) || !(e.maxHp > 0)) return 0;
  const mul = hasStatus(e, 'poison') ? POISON_HEAL_MUL : 1;
  const healed = Math.max(0, Math.min(e.maxHp - e.hp, amount * mul));
  e.hp += healed;
  return healed;
}

/**
 * @param {object} w World
 * @param {object} target Enemy or Player
 * @param {string} id status id
 * @param {{duration?:number, power?:number, stacks?:number}} [opts]
 */
export function applyStatus(w, target, id, opts = {}) {
  const def = STATUS[id];
  if (!def || !target || target.dead) return false;
  const isPlayer = target === w.player;
  if (isPlayer) {
    if (!target.alive || target.dashing || target.invuln > 0) return false;
    if (id === 'freeze' || id === 'stun' || id === 'mark' || id === 'shock') id = id === 'freeze' ? 'chill' : 'slow';
  } else {
    const edef = target.def;
    if (edef && edef.immune && edef.immune.includes(id)) return false;
    if (id === 'bleed' && edef && edef.bloodless) return false;
    if (target.invuln || target.spawnT > 0) return false;
    if (target.boss && (id === 'freeze' || id === 'stun')) id = id === 'freeze' ? 'chill' : 'slow';
    if (id === 'chill' && target.freezeImmune > 0) return false;
  }
  const d = STATUS[id];
  const st = target.statuses || (target.statuses = {});
  const duration = opts.duration ?? d.duration;
  const power = opts.power ?? 1;
  const add = opts.stacks ?? 1;
  let s = st[id];
  const fresh = !s;
  if (!s) {
    s = st[id] = { t: duration, power, stacks: 0, tick: DOT_TICK };
    if (id === 'bleed') { s.mv = 0; if (target._lpx == null) { target._lpx = target.x; target._lpy = target.y; } }
  }
  s.t = Math.max(s.t, duration);
  s.power = Math.max(s.power, power);
  s.stacks = Math.min(isPlayer ? (d.playerMaxStacks ?? d.maxStacks) : d.maxStacks, s.stacks + add);
  // chill -> freeze conversion on enemies
  if (!isPlayer && id === 'chill' && s.stacks >= d.maxStacks && !target.boss) {
    delete st.chill;
    target.freezeImmune = 3.2;
    st.freeze = { t: STATUS.freeze.duration * (opts.freezeMul || 1), power: 1, stacks: 1, tick: DOT_TICK };
    w.fx.burst('frost', target.x, target.y, { count: 10 });
    bus.emit('status:apply', { target, id: 'freeze' });
    runHooks(w.run, 'onStatusApplied', { enemy: target, id: 'freeze' });
    return true;
  }
  if (fresh) {
    if (isPlayer) bus.emit('player:status', { id });
    else {
      bus.emit('status:apply', { target, id });
      runHooks(w.run, 'onStatusApplied', { enemy: target, id });
    }
  }
  // threshold payoffs (enemies only): Aderlass / Gifteruption / Entladung
  if (!isPlayer && add > 0 && d.burstAt && s.stacks >= d.burstAt && st[id] === s && !target.dead) statusBurst(w, target, id);
  return true;
}

/**
 * Trigger the threshold payoff of `id` on enemy `e` (consumes all stacks). Visuals are drawn by the presentation layer
 * from the `status:burst` event { target, id, x, y, damage, radius? (poison), chain? ([{ x, y, target }], shock) }. Guarded against recursion
 * (nested depth) and same-frame chain loops (per-step cap); a skipped burst fires on the next application.
 * @returns {boolean} true when the burst happened
 */
export function statusBurst(w, e, id) {
  const st = e.statuses;
  const s = st && st[id];
  if (!s || e.dead) return false;
  if (id === 'poison' && e.eruptImmune > 0) return false;
  if (w._burstStamp !== w.time) { w._burstStamp = w.time; w._burstCount = 0; }
  if ((w._burstDepth || 0) >= BURST_MAX_DEPTH || w._burstCount >= BURST_FRAME_CAP) return false;
  w._burstDepth = (w._burstDepth || 0) + 1;
  w._burstCount++;
  const ev = { target: e, id, x: e.x, y: e.y, damage: 0 };
  try {
    delete st[id];
    if (id === 'bleed') ev.damage = bloodletting(w, e, s);
    else if (id === 'poison') ev.damage = poisonEruption(w, e, s, ev);
    else if (id === 'shock') ev.damage = discharge(w, e, s, ev);
    const damage = ev.damage;
    const stats = w.run && w.run.stats;
    if (stats) stats.statusBursts = (stats.statusBursts || 0) + 1;
    bus.emit('status:burst', ev);
    runHooks(w.run, 'onStatusBurst', { enemy: e, id, damage });
  } finally {
    w._burstDepth--;
  }
  return true;
}

/** Aderlass: remaining bleed up front + a slice of max HP, drops blood orbs. */
function bloodletting(w, e, s) {
  const pct = e.boss ? 0.02 : e.elite && e.elite.length ? 0.04 : 0.08;
  const raw = s.stacks * s.power * Math.max(0, s.t) + pct * e.maxHp;
  const dealt = w.damageEnemy(e, raw, { type: 'phys', source: 'status', proc: false, bleed: true, burst: 'bleed', ignoreResist: true, ignoreArmor: true });
  const p = w.player;
  const orbs = 1 + (p && p.stats.vampirism > 0 ? 1 : 0);
  for (let i = 0; i < orbs; i++) w.spawnPickup('blood', e.x, e.y, { burst: true });
  return dealt;
}

/** Gifteruption: burst damage on the target, half the stacks spread to neighbours (who cannot erupt for a moment). */
function poisonEruption(w, e, s, ev) {
  const radius = ERUPT_RADIUS * ((w.run && w.run.flags && w.run.flags.eruptRadiusMul) ?? 1);
  ev.radius = radius;
  const x = e.x, y = e.y;
  const dealt = w.damageEnemy(e, s.stacks * s.power * 2, { type: 'poison', source: 'status', proc: false, burst: 'poison' });
  const spread = Math.ceil(s.stacks / 2);
  const opts = { duration: Math.max(2, s.t), power: s.power, stacks: spread };
  for (const o of w.enemiesInRadius(x, y, radius)) {
    if (o === e || o.dead) continue;
    o.eruptImmune = Math.max(o.eruptImmune || 0, ERUPT_IMMUNE);
    applyStatus(w, o, 'poison', opts);
  }
  return dealt;
}

function dischargeStun(w, o) {
  if (o.dead || o.boss) return;
  applyStatus(w, o, 'stun', { duration: o.elite && o.elite.length ? 0.3 : 0.6 });
}

/** Entladung: shock skill damage on the target, chain lightning to up to 4 more (no new stacks), short stun. */
function discharge(w, e, s, ev) {
  const base = DISCHARGE_DAMAGE * s.power;
  const info = { type: 'shock', source: 'status', burst: 'shock' };
  let total = skillDamage(w, e, base, info);
  dischargeStun(w, e);
  const hit = new Set([e]);
  const chain = ev.chain = [];
  let cur = { x: e.x, y: e.y }, mul = 1;
  for (let j = 0; j < DISCHARGE_JUMPS; j++) {
    const next = w.findNearestEnemy(cur.x, cur.y, DISCHARGE_RANGE, (o) => !hit.has(o));
    if (!next) break;
    hit.add(next);
    mul *= DISCHARGE_FALLOFF;
    total += skillDamage(w, next, base * mul, { ...info, chained: true });
    dischargeStun(w, next);
    cur = { x: next.x, y: next.y };
    chain.push({ x: cur.x, y: cur.y, target: next });
  }
  return total;
}

export function clearStatuses(target) { target.statuses = {}; }

/** Ticks statuses; sets target.slowMul / frozen / stunned / dmgTakenMul / dmgDealtMul / bleeding. */
export function updateStatuses(w, target, dt) {
  const st = target.statuses;
  let slow = 1, taken = 1, dealt = 1, frozen = false, stunned = false, bleeding = false;
  const isPlayer = target === w.player;
  if (target.freezeImmune > 0) target.freezeImmune -= dt;
  if (target.eruptImmune > 0) target.eruptImmune -= dt;
  if (st) {
    for (const id in st) {
      const s = st[id];
      s.t -= dt;
      if (s.t <= 0) { delete st[id]; continue; }
      switch (id) {
        case 'burn':
        case 'poison': {
          s.tick -= dt;
          if (s.tick <= 0) {
            s.tick += DOT_TICK;
            const dmg = s.power * (id === 'poison' ? s.stacks : 1) * DOT_TICK;
            if (isPlayer) w.damagePlayer(Math.max(1, dmg), { type: STATUS[id].type, dot: true, unblockable: true, statusId: id });
            else w.damageEnemy(target, dmg, { type: STATUS[id].type, source: 'status', proc: false, silent: true, dot: true });
            if (target.dead) return;
          }
          break;
        }
        case 'bleed': {
          bleeding = true;
          // movement = position delta since the last step (knockback counts too)
          const lx = target._lpx ?? target.x, ly = target._lpy ?? target.y;
          const ddx = target.x - lx, ddy = target.y - ly, lim = BLEED_MOVE_SPEED * dt;
          if (dt > 0 && ddx * ddx + ddy * ddy > lim * lim) s.mv = (s.mv || 0) + dt;
          s.tick -= dt;
          if (s.tick <= 0) {
            s.tick += DOT_TICK;
            const moving = Math.min(1, (s.mv || 0) / DOT_TICK);
            s.mv = 0;
            const dmg = s.power * s.stacks * DOT_TICK * (1 + (BLEED_MOVE_MUL - 1) * moving);
            if (isPlayer) w.damagePlayer(Math.max(0.1, dmg), { type: 'phys', dot: true, unblockable: true, statusId: 'bleed' });
            else {
              w.damageEnemy(target, dmg, {
                type: 'phys', source: 'status', proc: false, silent: true, dot: true, bleed: true, ignoreResist: true, ignoreArmor: true,
              });
            }
            if (target.dead) return;
          }
          break;
        }
        case 'chill': slow *= isPlayer ? 1 - 0.12 * s.stacks : 1 - 0.1 * s.stacks; break;
        case 'freeze': frozen = true; break;
        case 'stun': stunned = true; break;
        case 'slow': slow *= 0.62; break;
        case 'mark': taken *= 1.25; break;
        case 'shock': taken *= 1 + SHOCK_TAKEN_PER_STACK * s.stacks; break;
        case 'weak': dealt *= 0.7; break;
      }
    }
  }
  target._lpx = target.x;
  target._lpy = target.y;
  target.slowMul = slow;
  target.frozen = frozen;
  target.stunned = stunned;
  target.dmgTakenMul = taken;
  target.dmgDealtMul = dealt;
  target.bleeding = bleeding;
}

// ---------------------------------------------------------------------------------------------
// Weapon state
// ---------------------------------------------------------------------------------------------
export function recalcWeapon(ws) {
  const stats = { ...ws.def.base };
  const levels = ws.def.levels || [];
  for (let i = 0; i < ws.level - 1 && i < levels.length; i++) {
    const mods = levels[i].mods || {};
    for (const k in mods) {
      if (k[0] === '+') { const key = k.slice(1); stats[key] = (stats[key] || 0) + mods[k]; }
      else stats[k] = (stats[k] ?? 1) * mods[k];
    }
  }
  ws.stats = stats;
  return ws;
}

export function makeWeaponState(def, level = 1) {
  return recalcWeapon({ id: def.id, def, level: Math.max(1, Math.min(5, level)), cd: 0, stats: {}, data: {} });
}

export const MAX_WEAPON_LEVEL = 5;

// ---------------------------------------------------------------------------------------------
// Player shot helpers
// ---------------------------------------------------------------------------------------------
export function rollCrit(w) { return w.rng.chance(w.player.stats.critChance); }

export function weaponCooldown(w, ws) {
  return Math.max(0.03, (ws.stats.cooldown || 0.4) / w.player.stats.fireRate);
}

/** Outgoing damage multiplier of the player for a damage type (without crit). */
export function playerDamageMul(w, type = 'phys') {
  const p = w.player, s = p.stats;
  return s.damage * (s[TYPE_STAT[type]] ?? 1) * (p.dmgDealtMul ?? 1) * (p.tempDamageMul ?? 1);
}

/** Rolls the on-hit status chances of the player's stats (first success wins). Exported for tests. */
export function statusFromStats(w, type) {
  const s = w.player.stats, r = w.rng;
  // innate type affinity gives a small base chance; relic stats add to it
  if (s.burnChance > 0 && r.chance(s.burnChance)) return { id: 'burn', duration: 3 * s.statusDuration, power: 5 * s.statusPower * s.damage };
  if (s.chillChance > 0 && r.chance(s.chillChance)) return { id: 'chill', duration: 3 * s.statusDuration, power: 1 };
  if (s.poisonChance > 0 && r.chance(s.poisonChance)) return { id: 'poison', duration: 4 * s.statusDuration, power: 2.2 * s.statusPower * s.damage };
  if (s.shockChance > 0 && r.chance(s.shockChance)) return { id: 'shock', duration: 4 * s.statusDuration, power: 1 };
  if (s.bleedChance > 0 && r.chance(s.bleedChance)) return { id: 'bleed', duration: 4 * s.statusDuration, power: 2.5 * s.statusPower * s.damage * s.bleedDamage };
  return null;
}

/** Player-stat multiplier for a weapon-defined status power (bleed also scales with bleedDamage). */
function statusPowerMul(s, id) {
  return s.statusPower * s.damage * (id === 'bleed' ? s.bleedDamage : 1);
}

/**
 * Build + spawn one player projectile from weapon stats and player stats.
 * `overrides` may contain any projectile spec field; `damageMul`, `speedMul`, `rangeMul` are convenience multipliers.
 */
export function playerShot(w, ws, angle, overrides = {}) {
  const p = w.player, s = p.stats, ws_ = ws.stats, def = ws.def;
  const type = overrides.type || def.type || 'phys';
  const crit = overrides.crit ?? rollCrit(w);
  const speed = (overrides.speed ?? ws_.projSpeed ?? 220) * s.projSpeed * (overrides.speedMul ?? 1);
  const range = (overrides.range ?? ws_.range ?? 220) * s.range * (overrides.rangeMul ?? 1);
  let damage = (overrides.damage ?? ws_.damage ?? 5) * (overrides.damageMul ?? 1) * playerDamageMul(w, type);
  if (crit) damage *= s.critMult;
  const muzzle = overrides.muzzle ?? p.r + 3;
  const spec = {
    x: p.x + Math.cos(angle) * muzzle, y: p.y + Math.sin(angle) * muzzle,
    angle, speed,
    r: (overrides.r ?? ws_.size ?? 3) * s.projSize,
    damage, type, team: 'player',
    life: speed > 0 ? range / speed : (overrides.life ?? 1),
    pierce: (ws_.pierce || 0) + s.pierce,
    bounce: (ws_.bounce || 0) + s.bounce,
    homing: (ws_.homing || 0) + s.homing,
    knockback: (ws_.knockback ?? 60) * s.knockback,
    crit,
    status: ws_.status ? { ...ws_.status } : statusFromStats(w, type),
    sprite: def.projSprite || 'proj_orb',
    color: def.color || TYPE_COLORS[type],
    scale: s.projSize,
    light: { r: 22, color: def.color || TYPE_COLORS[type] },
    owner: p, weaponId: def.id,
  };
  for (const k in overrides) {
    if (k === 'damage' || k === 'speed' || k === 'range' || k === 'r' || k === 'damageMul' || k === 'speedMul' || k === 'rangeMul' || k === 'muzzle' || k === 'crit') continue;
    spec[k] = overrides[k];
  }
  if (overrides.life != null) spec.life = overrides.life;
  if (spec.status && spec.status.power != null && !spec.status._scaled && ws_.status) {
    spec.status.power *= statusPowerMul(s, spec.status.id);
    spec.status.duration = (spec.status.duration ?? 3) * s.statusDuration;
    spec.status._scaled = true;
  }
  runHooks(w.run, 'onShot', spec);
  return w.spawnProjectile(spec);
}

/** Fire ws.stats.count + multishot projectiles spread around `angle`. Emits weapon:fire and runs onFire hooks. */
export function playerVolley(w, ws, angle, overrides = {}) {
  const s = w.player.stats;
  const count = Math.max(1, Math.round((overrides.count ?? ws.stats.count ?? 1) + s.multishot));
  const spread = overrides.spread ?? ws.stats.spread ?? 0;
  const jitter = overrides.jitter ?? ws.stats.jitter ?? 0;
  // extra multishot projectiles fan out a little even for single-shot weapons
  const total = count > 1 ? Math.max(spread, 0.14 * (count - 1)) : 0;
  const shots = [];
  const o = { ...overrides };
  delete o.count; delete o.spread; delete o.jitter;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) - 0.5 : 0;
    const a = angle + t * total + (jitter ? w.rng.float(-jitter, jitter) : 0);
    shots.push(playerShot(w, ws, a, o));
  }
  bus.emit('weapon:fire', { id: ws.def.id, type: ws.def.type || 'phys' });
  runHooks(w.run, 'onFire', { ws, shots, angle });
  return shots;
}

/** Direct weapon damage (melee swings, beams) with player multipliers and a crit roll. */
export function playerDamage(w, ws, enemy, baseDamage, info = {}) {
  const type = info.type || ws.def.type || 'phys';
  const crit = info.crit ?? rollCrit(w);
  let dmg = baseDamage * playerDamageMul(w, type);
  if (crit) dmg *= w.player.stats.critMult;
  const st = ws.stats.status || statusFromStats(w, type);
  const dealt = w.damageEnemy(enemy, dmg, { ...info, type, crit, source: info.source || 'weapon', weaponId: ws.def.id });
  if (st && !enemy.dead && (st.chance == null || w.rng.chance(st.chance))) {
    const s = w.player.stats;
    w.applyStatus(enemy, st.id, {
      duration: (st.duration ?? STATUS[st.id]?.duration ?? 3) * s.statusDuration,
      power: ws.stats.status ? (st.power ?? 1) * statusPowerMul(s, st.id) : st.power,
      stacks: st.stacks,
    });
  }
  return dealt;
}

/** Damage from skills/relics that should scale with the player's damage stats but is not tied to a weapon. */
export function skillDamage(w, enemy, baseDamage, info = {}) {
  const type = info.type || 'phys';
  const crit = info.crit ?? (info.canCrit ? rollCrit(w) : false);
  let dmg = baseDamage * playerDamageMul(w, type) * (info.source === 'skill' ? w.player.stats.skillPower : 1);
  if (crit) dmg *= w.player.stats.critMult;
  return w.damageEnemy(enemy, dmg, { proc: false, ...info, type, crit, source: info.source || 'relic' });
}
