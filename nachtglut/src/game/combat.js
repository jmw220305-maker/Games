// Combat helpers: status effects, weapon state, and the player-shot helpers used by weapons.
import { bus } from '../core/events.js';
import { TYPE_COLORS } from './constants.js';
import { TYPE_STAT } from './stats.js';
import { runHooks } from './perks.js';

// ---------------------------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------------------------
export const STATUS = {
  burn: { name: 'Brand', color: TYPE_COLORS.fire, duration: 3, maxStacks: 1, type: 'fire', fx: 'ember' },
  poison: { name: 'Gift', color: TYPE_COLORS.poison, duration: 4, maxStacks: 8, type: 'poison', fx: 'poison' },
  chill: { name: 'Frost', color: TYPE_COLORS.frost, duration: 3, maxStacks: 5, fx: 'frost' },
  freeze: { name: 'Eingefroren', color: '#d6f4ff', duration: 1.6, maxStacks: 1, fx: 'frost' },
  shock: { name: 'Schock', color: TYPE_COLORS.shock, duration: 4, maxStacks: 1, fx: 'shock' },
  mark: { name: 'Gezeichnet', color: '#ff4f7a', duration: 5, maxStacks: 1 },
  stun: { name: 'Betäubt', color: '#ffe9a0', duration: 1, maxStacks: 1 },
  weak: { name: 'Geschwächt', color: '#9a86c9', duration: 4, maxStacks: 1 },
  slow: { name: 'Verlangsamt', color: '#7fa0c0', duration: 2.5, maxStacks: 1 },
};

const DOT_TICK = 0.5;

export function hasStatus(target, id) {
  return !!(target && target.statuses && target.statuses[id]);
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
    if (target.def && target.def.immune && target.def.immune.includes(id)) return false;
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
  if (!s) s = st[id] = { t: duration, power, stacks: 0, tick: DOT_TICK };
  s.t = Math.max(s.t, duration);
  s.power = Math.max(s.power, power);
  s.stacks = Math.min(isPlayer && id === 'chill' ? 3 : d.maxStacks, s.stacks + add);
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
  return true;
}

export function clearStatuses(target) { target.statuses = {}; }

/** Ticks statuses; sets target.slowMul / frozen / stunned / dmgTakenMul / dmgDealtMul. */
export function updateStatuses(w, target, dt) {
  const st = target.statuses;
  let slow = 1, taken = 1, dealt = 1, frozen = false, stunned = false;
  const isPlayer = target === w.player;
  if (target.freezeImmune > 0) target.freezeImmune -= dt;
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
            if (isPlayer) w.damagePlayer(Math.max(1, dmg), { type: STATUS[id].type, dot: true, unblockable: true });
            else w.damageEnemy(target, dmg, { type: STATUS[id].type, source: 'status', proc: false, silent: true, dot: true });
            if (target.dead) return;
          }
          break;
        }
        case 'chill': slow *= isPlayer ? 1 - 0.12 * s.stacks : 1 - 0.1 * s.stacks; break;
        case 'freeze': frozen = true; break;
        case 'stun': stunned = true; break;
        case 'slow': slow *= 0.62; break;
        case 'mark': taken *= 1.25; break;
        case 'shock': taken *= 1.15; break;
        case 'weak': dealt *= 0.7; break;
      }
    }
  }
  target.slowMul = slow;
  target.frozen = frozen;
  target.stunned = stunned;
  target.dmgTakenMul = taken;
  target.dmgDealtMul = dealt;
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

function statusFromStats(w, type) {
  const s = w.player.stats, r = w.rng;
  // innate type affinity gives a small base chance; relic stats add to it
  if (s.burnChance > 0 && r.chance(s.burnChance)) return { id: 'burn', duration: 3 * s.statusDuration, power: 5 * s.statusPower * s.damage };
  if (s.chillChance > 0 && r.chance(s.chillChance)) return { id: 'chill', duration: 3 * s.statusDuration, power: 1 };
  if (s.poisonChance > 0 && r.chance(s.poisonChance)) return { id: 'poison', duration: 4 * s.statusDuration, power: 2.2 * s.statusPower * s.damage };
  if (s.shockChance > 0 && r.chance(s.shockChance)) return { id: 'shock', duration: 4 * s.statusDuration, power: 1 };
  return null;
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
    spec.status.power *= s.statusPower * s.damage;
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
      power: ws.stats.status ? (st.power ?? 1) * s.statusPower * s.damage : st.power,
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
