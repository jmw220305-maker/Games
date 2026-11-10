// Shared helpers for enemy AI behaviours and elite affixes (owner: enemies).
// DOM-free; only depends on core/events + core/math so it can be imported anywhere without cycles.
import { bus } from '../../core/events.js';
import { TAU } from '../../core/math.js';

/** Default cap of live projectiles per enemy (keeps bullet density readable). */
export const PROJ_CAP = 14;

/** States in which an enemy is "free" (not winding up / attacking) — affixes may interrupt these. */
export const FREE_STATES = new Set(['idle', 'move', 'chase', 'hover', 'drift', 'swarm', 'flank', 'walk', 'phase', 'surface', 'advance', 'rest']);

export const params = (e) => e.def.aiParams || {};
/** Attack-cooldown multiplier (affix `swift`/Rasend lowers it). */
export const cdMul = (e) => e.data.cdMul ?? 1;
/** Scale for absolute speeds (lunges, dashes): difficulty/affix speed changes and slows apply. */
export function speedScale(e) {
  const b = e.def.speed;
  return (b > 0 ? e.speed / b : 1) * (e.slowMul ?? 1);
}
export const moveSpeed = (e, mul = 1) => e.speed * (e.slowMul ?? 1) * mul;

/** Switch AI state and reset the AI's own state timer (`e.data.t`, only advances while the AI runs). */
export function go(e, state) { e.state = state; e.data.t = 0; }
/** Per-tick bookkeeping: advances the state timer and the main cooldown. Returns e.data. */
export function tick(e, dt) {
  const d = e.data;
  d.t = (d.t || 0) + dt;
  if (d.cd > 0) d.cd -= dt;
  return d;
}

export const distTo = (e, t) => Math.hypot(t.x - e.x, t.y - e.y);

/** Turn the enemy toward a point (facing angle + sprite flip). */
export function face(e, x, y) {
  const dx = x - e.x, dy = y - e.y;
  if (dx * dx + dy * dy > 1e-6) e.facing = Math.atan2(dy, dx);
  if (Math.abs(dx) > 0.5) e.flipX = dx < 0;
}

/**
 * Angle from the enemy to a target; with `projSpeed` > 0 the target's velocity is partially led
 * (`leadFrac` 0..1, kept low so shots stay dodgeable). Also turns the enemy.
 */
export function aimAt(e, target, projSpeed = 0, leadFrac = 0.4) {
  let tx = target.x, ty = target.y;
  if (projSpeed > 0 && leadFrac > 0 && (target.vx || target.vy)) {
    const t = Math.min(1.2, Math.hypot(tx - e.x, ty - e.y) / projSpeed);
    tx += (target.vx || 0) * t * leadFrac;
    ty += (target.vy || 0) * t * leadFrac;
  }
  face(e, tx, ty);
  return Math.atan2(ty - e.y, tx - e.x);
}

/** Wind-up: sets the anim and emits `enemy:telegraph`. */
export function telegraph(w, e, kind, anim = 'attack') {
  e.anim = anim;
  bus.emit('enemy:telegraph', { enemy: e, kind });
}
export function attackEvent(w, e, kind) { bus.emit('enemy:attack', { enemy: e, kind }); }

export function ownedProjectiles(w, e) {
  let n = 0;
  const ps = w.projectiles;
  for (let i = 0; i < ps.length; i++) if (ps[i].owner === e && !ps[i].dead) n++;
  return n;
}
export function ownedZones(w, e, tag) {
  let n = 0;
  for (const z of w.zones) if (z.owner === e && !z.dead && (!tag || (z.data && z.data.tag === tag))) n++;
  return n;
}

const PASS_KEYS = ['pierce', 'bounce', 'homing', 'accel', 'ghost', 'arc', 'spin', 'trail', 'scale', 'hitInterval', 'onUpdate', 'onHit', 'onWall', 'onExpire', 'data', 'vx', 'vy'];

/**
 * Spawn one enemy projectile. Damage is multiplied by e.dmgMul; colour/light default to readable values.
 * o: { speed, damage, type, r, life|range, sprite, color, light (null = none), status, cap, muzzle, knockback, ...spec }
 * Returns the projectile or null when the per-enemy cap is reached.
 */
export function shoot(w, e, angle, o = {}) {
  const cap = o.cap ?? params(e).projCap ?? PROJ_CAP;
  if (ownedProjectiles(w, e) >= cap) return null;
  const muzzle = o.muzzle ?? e.r + 2;
  const color = o.color || e.def.color || '#ff8a3c';
  const speed = o.speed ?? 100;
  const spec = {
    x: e.x + Math.cos(angle) * muzzle, y: e.y + Math.sin(angle) * muzzle,
    angle, speed,
    r: o.r ?? 3,
    damage: (o.damage ?? 10) * (e.dmgMul ?? 1),
    type: o.type || 'phys', team: 'enemy',
    knockback: o.knockback ?? 40,
    status: o.status !== undefined ? o.status : (e.data.shotStatus || null),
    sprite: o.sprite || 'proj_orb', color,
    light: o.light !== undefined ? o.light : { r: 16, color },
    owner: e,
  };
  if (o.range != null && o.life == null) spec.range = o.range;
  else spec.life = o.life ?? 3.2;
  for (const k of PASS_KEYS) if (o[k] !== undefined) spec[k] = o[k];
  return w.spawnProjectile(spec);
}

/** n projectiles evenly around a full circle starting at `base`. */
export function fireRing(w, e, n, base, o = {}) {
  const out = [];
  const opts = { cap: Infinity, ...o };
  for (let i = 0; i < n; i++) {
    const p = shoot(w, e, base + (i / n) * TAU, opts);
    if (p) out.push(p);
  }
  return out;
}

/** n projectiles fanned over a total arc `spread` centred on `center`. */
export function fireFan(w, e, n, center, spread, o = {}) {
  const out = [];
  const opts = { cap: Math.max(PROJ_CAP, n * 3), ...o };
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    const p = shoot(w, e, center + t * spread, opts);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Spawn an enemy-team zone owned by `e` (damage × e.dmgMul; a `shotStatus` from affixes is added to damaging zones).
 * Zones owned by an enemy disappear when it dies before they activate unless `persist: true`.
 */
export function zone(w, e, spec) {
  const z = { team: 'enemy', color: (e && e.def.color) || '#ff5a3c', ...spec };
  if (e) { z.owner = e; z.source = e; }
  z.damage = (spec.damage ?? 0) * (e ? (e.dmgMul ?? 1) : 1);
  if (z.damage > 0 && e && e.data.shotStatus && spec.status === undefined) z.status = e.data.shotStatus;
  return w.spawnZone(z);
}

/** A warning line from the enemy to (x2, y2). Damage 0 by default — purely a telegraph. */
export function telegraphLine(w, e, x2, y2, o = {}) {
  return zone(w, e, {
    shape: 'line', x: o.x ?? e.x, y: o.y ?? e.y, x2, y2, width: o.width ?? 10,
    delay: o.delay ?? 0.6, duration: o.duration ?? 0.05, damage: o.damage ?? 0,
    color: o.color || e.def.color, type: o.type, knockback: o.knockback, status: o.status, data: { tag: 'telegraph' },
  });
}

/** A warning circle (damage 0 by default). */
export function telegraphCircle(w, e, x, y, r, o = {}) {
  return zone(w, e, {
    shape: 'circle', x, y, r, delay: o.delay ?? 0.6, duration: o.duration ?? 0.05, damage: o.damage ?? 0,
    color: o.color || e.def.color, type: o.type, knockback: o.knockback, status: o.status, data: { tag: 'telegraph' },
  });
}

/** Zone onTick helper: ends a long-lived zone as soon as its owner is gone. */
export function endWithOwner(w, z) { if (z.owner && z.owner.dead) z.dead = true; }

/**
 * Delayed explosion: a warning circle for `delay` s, then `w.explode` (team enemy). Persists when the owner dies.
 * o: { type, color, knockback, status, follow, onBlast(w, z) }
 */
export function delayedBlast(w, e, x, y, delay, radius, damage, o = {}) {
  const dmg = damage * (e ? (e.dmgMul ?? 1) : 1);
  return w.spawnZone({
    shape: 'circle', x, y, r: radius, delay, duration: 0.05, damage: 0, team: 'enemy',
    color: o.color || '#ff6a1f', follow: o.follow || null, owner: e || null, source: e || null, persist: true,
    data: { tag: 'blast' },
    onStart(w2, z) {
      w2.explode(z.x, z.y, radius, dmg, {
        team: 'enemy', type: o.type || 'fire', source: e, knockback: o.knockback ?? 140, status: o.status, color: o.color,
      });
      if (e) bus.emit('enemy:attack', { enemy: e, kind: 'explode' });
      if (o.onBlast) o.onBlast(w2, z);
    },
  });
}

/** Free distance (px) along a ray before a solid tile (flying: pits do not block). */
export function rayLength(w, x, y, ang, max, flying = true) {
  const cx = Math.cos(ang), cy = Math.sin(ang);
  for (let d = 4; d <= max; d += 4) {
    if (w.isSolidPx(x + cx * d, y + cy * d, flying)) return Math.max(0, d - 4);
  }
  return max;
}

/** Remove an enemy without player credit side effects (self-destruct). */
export function killSelf(w, e) {
  if (e.dead) return;
  if (typeof w.killEnemy === 'function') w.killEnemy(e, { source: 'self', silent: true });
  else { e.invuln = false; e.hidden = false; e.spawnT = 0; w.damageEnemy(e, e.hp + 1e6, { source: 'zone', proc: false, silent: true }); }
}

/** True while a boss death is wiping the room: death hooks must not spawn new enemies then. */
export function spawnsBlocked(w) {
  return !!((w.boss && w.boss.dead) || w.bossDefeated);
}

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------
/** Move along (dx, dy) at `speed`. Returns the fraction of the intended step actually travelled (0..1). */
export function moveDir(w, e, dx, dy, speed, dt) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-6 || !(speed > 0)) return 1;
  const step = speed * dt;
  const ox = e.x, oy = e.y;
  w.moveEntity(e, (dx / l) * step, (dy / l) * step);
  if (Math.abs(dx) > 1e-3) e.flipX = dx < 0;
  return step > 1e-6 ? Math.hypot(e.x - ox, e.y - oy) / step : 1;
}

/** Path toward the player (flow field for ground units, direct + flow fallback for flyers). */
export function chaseDir(w, e) {
  const p = w.player;
  if (e.flying) {
    const dx = p.x - e.x, dy = p.y - e.y, l = Math.hypot(dx, dy) || 1;
    if (w.lineOfSight(e.x, e.y, p.x, p.y)) return { x: dx / l, y: dy / l };
    const f = w.flowDir(e.x, e.y);
    return f.x || f.y ? f : { x: dx / l, y: dy / l };
  }
  return w.flowDir(e.x, e.y);
}

export function chase(w, e, dt, mul = 1) {
  const d = chaseDir(w, e);
  if (!d.x && !d.y) { e.anim = 'idle'; return 0; }
  const f = moveDir(w, e, d.x, d.y, moveSpeed(e, mul), dt);
  e.facing = Math.atan2(d.y, d.x);
  e.anim = 'walk';
  return f;
}

/** Steer toward an arbitrary point; falls back to the flow field when walled off. Returns moved fraction. */
export function steerTo(w, e, tx, ty, speed, dt) {
  const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy);
  if (l < 1) return 1;
  const sp = Math.min(speed, l / Math.max(dt, 1e-6));
  let f = moveDir(w, e, dx, dy, sp, dt);
  if (f < 0.2 && !w.lineOfSight(e.x, e.y, tx, ty)) {
    const fd = w.flowDir(e.x, e.y);
    if (fd.x || fd.y) f = moveDir(w, e, fd.x, fd.y, speed, dt);
  }
  return f;
}

/**
 * Keep a distance band [min, max] to the player with line of sight: approach, back off (strafing when cornered)
 * or strafe inside the band. Always faces the player. Returns 'approach' | 'retreat' | 'hold'.
 */
export function kite(w, e, dt, min, max, mul = 1) {
  const p = w.player, d = e.data;
  const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1;
  if (d.strafe == null) d.strafe = w.rng.sign();
  const sp = moveSpeed(e, mul);
  let res;
  if (dist > max || !w.lineOfSight(e.x, e.y, p.x, p.y)) {
    chase(w, e, dt, mul);
    res = 'approach';
  } else if (dist < min) {
    const nx = -dx / dist, ny = -dy / dist;
    const f = moveDir(w, e, nx - ny * 0.45 * d.strafe, ny + nx * 0.45 * d.strafe, sp, dt);
    if (f < 0.35) {
      d.strafe = -d.strafe;
      moveDir(w, e, -ny * d.strafe, nx * d.strafe, sp, dt);
    }
    e.anim = 'walk';
    res = 'retreat';
  } else {
    if (w.rng.chance(dt * 0.35)) d.strafe = -d.strafe;
    const f = moveDir(w, e, (-dy / dist) * d.strafe, (dx / dist) * d.strafe, sp * 0.45, dt);
    if (f < 0.3) d.strafe = -d.strafe;
    e.anim = 'walk';
    res = 'hold';
  }
  face(e, p.x, p.y);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Spawning helpers
// ---------------------------------------------------------------------------------------------
/** Find a free spot near (x, y) for an entity of radius r. */
export function freeSpotNear(w, x, y, r, flying, minR = 10, maxR = 26) {
  for (let i = 0; i < 10; i++) {
    const a = w.rng.angle(), d = w.rng.float(minR, maxR);
    const nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
    if (w.canStand(nx, ny, r, flying)) return { x: nx, y: ny };
  }
  return { x, y };
}

/** Summon `n` enemies of `id` around `e` (summoned: no sparks, reduced xp). Returns the new enemies. */
export function summon(w, e, id, n, opts = {}) {
  const out = [];
  if (spawnsBlocked(w)) return out;
  for (let i = 0; i < n; i++) {
    const spot = opts.spots && opts.spots[i] ? opts.spots[i] : freeSpotNear(w, e.x, e.y, 5, !!opts.flying, e.r + 6, e.r + 22);
    const c = w.spawnEnemy(id, spot.x, spot.y, { summoned: true, delay: opts.delay ?? 0.35, hpMul: opts.hpMul });
    if (c) out.push(c);
  }
  return out;
}

/** Teleport to a random reachable spot between minD and maxD px from the player. */
export function teleportNear(w, e, minD, maxD) {
  const p = w.player;
  for (let i = 0; i < 12; i++) {
    const pos = w.randomFloorPos({ minPlayerDist: minD, maxPlayerDist: maxD, flying: !!e.flying, margin: 1 });
    const dd = Math.hypot(pos.x - p.x, pos.y - p.y);
    if (dd < minD * 0.6 || !w.canStand(pos.x, pos.y, e.r, !!e.flying)) continue;
    w.fx.burst('shadow', e.x, e.y, { count: 12, color: e.def.color });
    e.x = pos.x; e.y = pos.y; e.kbx = 0; e.kby = 0;
    w.fx.burst('shadow', e.x, e.y, { count: 12, color: e.def.color });
    face(e, p.x, p.y);
    return true;
  }
  return false;
}
