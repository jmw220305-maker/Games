// Projectiles, zones (telegraphs / area effects) and pickups. See docs/ARCHITECTURE.md §5.1, §5.2. DOM-free.
import { bus } from '../core/events.js';
import { TS } from './constants.js';
import { angleDiff, distToSegment, rotateToward } from '../core/math.js';
import { runHooks } from './perks.js';
import { damageProp } from './props.js';

const HOMING_RANGE = 170;   // px: homing shots only steer toward targets this close
const MAX_STEP = 6;         // px: projectile movement sub-step
const ROOM_MARGIN = 32;     // px: ghost projectiles may leave the room rect by this much before they are removed
const TRAIL_INTERVAL = 0.04;

/**
 * Map<target, w.time of the last hit>. Also answers to the Set-style `add()` so content written against
 * "p.hits (Set)" keeps working.
 */
class HitMap extends Map {
  constructor(w) { super(); this._w = w; }
  add(target) { this.set(target, this._w ? this._w.time : 0); return this; }
}

function logOnce(obj, what, err) {
  const key = `_err_${what}`;
  if (obj[key]) return;
  obj[key] = true;
  console.error(`[entities] ${what} failed`, err);
}

const isGone = (ent) => !!ent && (ent.dead === true || ent.alive === false);

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------
export function makeProjectile(w, spec = {}) {
  const p = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, speed: 0,
    r: 3, damage: 0, type: 'phys', team: null, life: 1.2,
    pierce: 0, bounce: 0, homing: 0, accel: 0, knockback: 60, crit: false, status: null, ghost: false, arc: null,
    sprite: 'proj_orb', color: '#ffb347', scale: 1, spin: 0, trail: null, light: null,
    owner: null, weaponId: null, hitInterval: 0,
    onUpdate: null, onHit: null, onWall: null, onExpire: null,
  };
  for (const k in spec) if (spec[k] !== undefined) p[k] = spec[k];
  p.data = spec.data ? { ...spec.data } : {};
  if (!p.team) p.team = p.owner && p.owner === w.player ? 'player' : 'enemy';

  if (spec.vx != null || spec.vy != null) {
    p.vx = spec.vx || 0; p.vy = spec.vy || 0;
    p.speed = Math.hypot(p.vx, p.vy);
    if (p.speed > 1e-6) p.angle = Math.atan2(p.vy, p.vx);
  } else {
    p.vx = Math.cos(p.angle) * p.speed;
    p.vy = Math.sin(p.angle) * p.speed;
  }
  if (spec.life == null && spec.range != null) p.life = p.speed > 1e-6 ? spec.range / p.speed : 1.2;
  if (!(p.life >= 0)) p.life = 1.2;

  if (p.arc) {
    const a = p.arc;
    const time = Math.max(0.05, a.time ?? 0.8);
    p._sx = p.x; p._sy = p.y;
    p.vx = ((a.tx ?? p.x) - p.x) / time;
    p.vy = ((a.ty ?? p.y) - p.y) / time;
    p.speed = Math.hypot(p.vx, p.vy);
    if (p.speed > 1e-6) p.angle = Math.atan2(p.vy, p.vx);
    p.life = time;
  }

  p.age = 0;
  p.dead = false;
  p.z = 0;
  p.hits = new HitMap(w);
  p._trailT = 0;
  p._expired = false;
  return p;
}

/** Ends a projectile: runs `onExpire` exactly once, then marks it dead. */
export function expireProjectile(w, p) {
  if (p.dead || p._expired) { p.dead = true; return; }
  p._expired = true;
  if (p.onExpire) {
    try { p.onExpire(w, p); } catch (err) { logOnce(p, 'projectile.onExpire', err); }
  }
  p.dead = true;
}

function steer(w, p, dt) {
  let tx = 0, ty = 0, found = false;
  if (p.team === 'player') {
    const e = w.findNearestEnemy(p.x, p.y, HOMING_RANGE, (o) => !p.hits.has(o));
    if (e) { tx = e.x; ty = e.y; found = true; }
  } else {
    const pl = w.player;
    if (pl.alive && Math.hypot(pl.x - p.x, pl.y - p.y) <= HOMING_RANGE) { tx = pl.x; ty = pl.y; found = true; }
  }
  if (!found) return;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp < 1e-6) return;
  const na = rotateToward(Math.atan2(p.vy, p.vx), Math.atan2(ty - p.y, tx - p.x), p.homing * dt);
  p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; p.angle = na;
}

function emitTrail(w, p, dt) {
  if (!p.trail) return;
  p._trailT -= dt;
  if (p._trailT > 0) return;
  p._trailT = TRAIL_INTERVAL;
  w.fx.burst(p.trail, p.x, p.y - p.z, { count: 1, color: p.color });
}

function stepArc(w, p, dt) {
  const a = p.arc;
  const time = Math.max(0.05, a.time ?? 0.8);
  const t = Math.min(1, p.age / time);
  const tx = a.tx ?? p._sx, ty = a.ty ?? p._sy;
  p.x = p._sx + (tx - p._sx) * t;
  p.y = p._sy + (ty - p._sy) * t;
  p.z = Math.sin(Math.PI * t) * (a.height ?? 40);
  if (p.onUpdate) {
    try { p.onUpdate(w, p, dt); } catch (err) { logOnce(p, 'projectile.onUpdate', err); }
    if (p.dead) return;
  }
  emitTrail(w, p, dt);
  if (t >= 1) { p.z = 0; expireProjectile(w, p); }
}

/** @returns {boolean} true when the projectile ended */
function hitWall(w, p, nx, ny) {
  if (p.onWall) {
    let keep = false;
    try { keep = p.onWall(w, p) === true; } catch (err) { logOnce(p, 'projectile.onWall', err); }
    if (p.dead) return true;
    if (keep) return false;
  }
  if (p.bounce > 0) {
    const bx = w.isSolidPx(nx, p.y, true), by = w.isSolidPx(p.x, ny, true);
    if (bx || !by) p.vx = -p.vx;
    if (by || !bx) p.vy = -p.vy;
    p.bounce--;
    p.hits.clear();
    p.angle = Math.atan2(p.vy, p.vx);
    return false;
  }
  expireProjectile(w, p);
  return true;
}

/** @returns {boolean} true when the projectile ended */
function collideProps(w, p) {
  const props = w.props;
  for (let i = 0; i < props.length; i++) {
    const pr = props[i];
    if (pr.removed || !(pr.solid || pr.destructible)) continue;
    const dx = pr.x - p.x, dy = pr.y - p.y, rr = pr.r + p.r;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (pr.destructible && p.team === 'player') {
      damageProp(w, pr, 1);
      if (p.dead) return true;
      if (p.pierce > 0) { p.pierce--; continue; }
      expireProjectile(w, p);
      return true;
    }
    if (pr.solid && !p.ghost) { expireProjectile(w, p); return true; }
  }
  return false;
}

/** After a successful hit: consume one pierce, linger (hitInterval) or end. @returns {boolean} ended */
function afterHit(w, p) {
  if (p.dead) return true;
  if (p.pierce > 0) { p.pierce--; return false; }
  if (p.hitInterval > 0) return false;
  expireProjectile(w, p);
  return true;
}

function reflectProjectile(w, p) {
  const pl = w.player;
  const o = p.owner;
  const sp = Math.max(Math.hypot(p.vx, p.vy), 120);
  let ang;
  if (o && o !== pl && o.x != null && !isGone(o)) ang = Math.atan2(o.y - p.y, o.x - p.x);
  else ang = Math.atan2(-p.vy, -p.vx);
  p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp; p.angle = ang;
  p.team = 'player';
  p.owner = pl;
  p.damage *= 2;
  p.homing = 0;
  p.age = 0;
  p.life = Math.max(p.life, 1.2);
  p.hits.clear();
  w.fx.burst('spark', p.x, p.y, { count: 6, color: '#ffffff' });
}

/** @returns {boolean} true when the projectile ended */
function collideTargets(w, p) {
  if (p.team === 'player') {
    const es = w.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || e.hidden || e.spawnT > 0) continue;
      const dx = e.x - p.x, dy = e.y - p.y, rr = p.r + e.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      const last = p.hits.get(e);
      if (last !== undefined && !(p.hitInterval > 0 && w.time - last >= p.hitInterval)) continue;
      p.hits.set(e, w.time);
      const moving = Math.abs(p.vx) + Math.abs(p.vy) > 1;
      w.damageEnemy(e, p.damage, {
        type: p.type, crit: p.crit, source: p.source || 'weapon', weaponId: p.weaponId, proc: p.proc,
        knockback: { x: moving ? p.vx : dx, y: moving ? p.vy : dy, force: p.knockback },
        proj: p,
      });
      const st = p.status;
      if (st && !e.dead && (st.chance == null || st.chance >= 1 || w.rng.chance(st.chance))) w.applyStatus(e, st.id, st);
      if (p.onHit) { try { p.onHit(w, p, e); } catch (err) { logOnce(p, 'projectile.onHit', err); } }
      if (afterHit(w, p)) return true;
    }
    return false;
  }
  // enemy shots vs the player
  const pl = w.player;
  if (!pl.alive) return false;
  const dx = pl.x - p.x, dy = pl.y - p.y, rr = p.r + pl.r * 0.8;
  if (dx * dx + dy * dy > rr * rr) return false;
  if (pl.flags && pl.flags.reflect) { reflectProjectile(w, p); return false; }
  let st = p.status;
  if (st && st.chance != null && st.chance < 1 && !w.rng.chance(st.chance)) st = null;
  const dealt = w.damagePlayer(p.damage, { type: p.type, source: p.owner, status: st });
  if (!(dealt > 0)) return false; // dash / i-frames: the shot passes through
  if (p.onHit) { try { p.onHit(w, p, pl); } catch (err) { logOnce(p, 'projectile.onHit', err); } }
  return afterHit(w, p);
}

function stepProjectile(w, p, dt) {
  p.age += dt;
  if (p.arc) { stepArc(w, p, dt); return; }
  if (p.homing > 0) steer(w, p, dt);
  if (p.accel) {
    const sp = Math.hypot(p.vx, p.vy);
    const ns = Math.max(0, sp + p.accel * dt);
    if (sp > 1e-6) { p.vx *= ns / sp; p.vy *= ns / sp; }
    else { p.vx = Math.cos(p.angle) * ns; p.vy = Math.sin(p.angle) * ns; }
  }
  if (p.onUpdate) {
    try { p.onUpdate(w, p, dt); } catch (err) { logOnce(p, 'projectile.onUpdate', err); }
    if (p.dead) return;
  }

  const dist = Math.hypot(p.vx, p.vy) * dt;
  const steps = dist > MAX_STEP ? Math.ceil(dist / MAX_STEP) : 1;
  const sdt = dt / steps;
  const maxX = w.w * TS + ROOM_MARGIN, maxY = w.h * TS + ROOM_MARGIN;
  for (let s = 0; s < steps; s++) {
    const nx = p.x + p.vx * sdt, ny = p.y + p.vy * sdt;
    if (!p.ghost && w.isSolidPx(nx, ny, true)) {
      if (hitWall(w, p, nx, ny)) return;
    } else {
      p.x = nx; p.y = ny;
      if (nx < -ROOM_MARGIN || ny < -ROOM_MARGIN || nx > maxX || ny > maxY) { p.dead = true; return; }
    }
    if (collideProps(w, p)) return;
    if (collideTargets(w, p)) return;
  }
  emitTrail(w, p, dt);
  if (p.age >= p.life) expireProjectile(w, p);
}

export function updateProjectiles(w, dt) {
  const list = w.projectiles;
  const n = list.length; // shots spawned during this loop start next tick
  for (let i = 0; i < n; i++) {
    const p = list[i];
    if (p.dead) continue;
    stepProjectile(w, p, dt);
  }
}

// ---------------------------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------------------------
export function makeZone(w, spec = {}) {
  const z = {
    shape: 'circle', x: 0, y: 0, r: 20, x2: 0, y2: 0, width: 10, angle: 0, arc: Math.PI / 2, inner: null,
    delay: 0.6, duration: 0.1, damage: 0, tick: 0, team: 'enemy', type: 'phys', status: null, knockback: 0,
    color: '#ff5a3c', follow: null, followAim: false, grow: 0, owner: null, persist: false,
    onStart: null, onTick: null, onHit: null, onEnd: null,
  };
  for (const k in spec) if (spec[k] !== undefined) z[k] = spec[k];
  if (spec.x2 == null) z.x2 = z.x;
  if (spec.y2 == null) z.y2 = z.y;
  if (z.inner == null) z.inner = z.shape === 'ring' ? Math.max(0, z.r - 12) : 0;
  if (!z.owner && z.follow) z.owner = z.follow;
  z.data = spec.data ? { ...spec.data } : {};
  // line zones keep their direction + length relative to the entity they follow
  z._lx = z.x2 - z.x; z._ly = z.y2 - z.y;
  z.age = 0;
  z.active = false;
  z.dead = false;
  z.hits = new HitMap(w);
  return z;
}

/** Does a circle of radius `r` at (x, y) touch the zone's shape? */
export function zoneContains(z, x, y, r = 0) {
  switch (z.shape) {
    case 'ring': {
      const d = Math.hypot(x - z.x, y - z.y);
      return d <= z.r + r && d >= (z.inner || 0) - r;
    }
    case 'line':
      return distToSegment(x, y, z.x, z.y, z.x2, z.y2) <= (z.width || 0) / 2 + r;
    case 'cone': {
      const dx = x - z.x, dy = y - z.y;
      const d = Math.hypot(dx, dy);
      if (d > z.r + r) return false;
      if (d <= r || d < 1e-6) return true; // overlapping the apex
      return Math.abs(angleDiff(z.angle, Math.atan2(dy, dx))) <= z.arc / 2;
    }
    default: {
      const dx = x - z.x, dy = y - z.y, rr = z.r + r;
      return dx * dx + dy * dy <= rr * rr;
    }
  }
}

function followEntity(z) {
  const f = z.follow;
  if (!f || f.x == null) return;
  z.x = f.x; z.y = f.y;
  if (z.followAim) {
    const a = f.aim ?? f.facing;
    if (typeof a === 'number') {
      if (z.shape === 'line') {
        const len = Math.hypot(z._lx, z._ly);
        z._lx = Math.cos(a) * len; z._ly = Math.sin(a) * len;
      }
      z.angle = a;
    }
  }
  if (z.shape === 'line') { z.x2 = z.x + z._lx; z.y2 = z.y + z._ly; }
}

function zoneHitPlayer(w, z) {
  const pl = w.player;
  if (!pl.alive || !zoneContains(z, pl.x, pl.y, pl.r * 0.7)) return;
  const last = z.hits.get(pl);
  if (last !== undefined && !(z.tick > 0 && w.time - last >= z.tick - 1e-9)) return;
  if (z.damage > 0) {
    const src = z.owner && z.owner !== pl && z.owner.hp != null ? z.owner : null;
    let st = z.status;
    if (st && st.chance != null && st.chance < 1 && !w.rng.chance(st.chance)) st = null;
    const dealt = w.damagePlayer(z.damage, { type: z.type, source: src, status: st });
    if (!(dealt > 0)) {
      // dodged (dash / i-frames): ticking zones wait a full tick, one-shot zones may still catch the player later
      if (z.tick > 0) z.hits.set(pl, w.time);
      return;
    }
  } else if (z.status) {
    w.applyStatus(pl, z.status.id, z.status);
  }
  z.hits.set(pl, w.time);
  if (z.knockback) w.knockback(pl, pl.x - z.x, pl.y - z.y, z.knockback);
  if (z.onHit) { try { z.onHit(w, z, pl); } catch (err) { logOnce(z, 'zone.onHit', err); } }
}

function zoneHitEnemies(w, z) {
  const es = w.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e.dead || e.hidden || e.spawnT > 0) continue;
    if (!zoneContains(z, e.x, e.y, e.r)) continue;
    const last = z.hits.get(e);
    if (last !== undefined && !(z.tick > 0 && w.time - last >= z.tick - 1e-9)) continue;
    z.hits.set(e, w.time);
    if (z.damage > 0) {
      w.damageEnemy(e, z.damage, { type: z.type, source: z.source || 'zone', proc: z.proc === true, crit: !!z.crit, weaponId: z.weaponId });
    }
    const st = z.status;
    if (st && !e.dead && (st.chance == null || st.chance >= 1 || w.rng.chance(st.chance))) w.applyStatus(e, st.id, st);
    if (z.knockback && !e.dead) w.knockback(e, e.x - z.x, e.y - z.y, z.knockback);
    if (z.onHit) { try { z.onHit(w, z, e); } catch (err) { logOnce(z, 'zone.onHit', err); } }
    if (z.dead) return;
  }
}

export function updateZones(w, dt) {
  const list = w.zones;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const z = list[i];
    if (z.dead) continue;
    z.age += dt;
    if (z.follow && !isGone(z.follow)) followEntity(z);
    if (!z.active) {
      if (!z.persist && (isGone(z.follow) || isGone(z.owner))) { z.dead = true; continue; }
      if (z.age < z.delay) continue;
      z.active = true;
      if (z.onStart) { try { z.onStart(w, z); } catch (err) { logOnce(z, 'zone.onStart', err); } }
      if (z.dead) continue;
    } else if (z.grow) {
      z.r += z.grow * dt;
      if (z.shape === 'ring') z.inner += z.grow * dt;
    }
    if (z.team === 'player') zoneHitEnemies(w, z);
    else zoneHitPlayer(w, z);
    if (z.dead) continue;
    if (z.onTick) { try { z.onTick(w, z, dt); } catch (err) { logOnce(z, 'zone.onTick', err); } }
    if (z.dead) continue;
    if (z.age >= z.delay + z.duration) {
      if (z.onEnd) { try { z.onEnd(w, z); } catch (err) { logOnce(z, 'zone.onEnd', err); } }
      z.dead = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------------------------
const PICKUP_AMOUNT = { spark: 1, xp: 1, heart: 15, ash: 1, shield: 15 };
const PICKUP_FX = { spark: ['gold', '#ffd35a'], xp: ['light', '#8fd8ff'], heart: ['heal', '#7dff9a'], ash: ['smoke', '#c9c2b8'], shield: ['spark', '#9ad0ff'] };
const PICKUP_DELAY = 0.3;   // s before a fresh pickup can be attracted / collected
const PICKUP_SPEED = 340;

export function makePickup(w, kind, x, y, opts = {}) {
  // never leave loot inside a wall or above a pit (flying enemies die anywhere)
  if (w.tiles && w.isSolidPx(x, y, false)) {
    const f = w.nearestFloor(x, y);
    x = f.x; y = f.y;
  }
  const pk = {
    kind, x, y, vx: 0, vy: 0,
    amount: opts.amount ?? PICKUP_AMOUNT[kind] ?? 1,
    age: 0, magnet: !!opts.magnet, dead: false, r: 5, pull: 0,
  };
  if (opts.burst) {
    const a = w.rng.angle(), s = w.rng.float(60, 130);
    pk.vx = Math.cos(a) * s; pk.vy = Math.sin(a) * s;
  }
  return pk;
}

function collectPickup(w, pk) {
  const p = w.player, run = w.run;
  pk.dead = true;
  switch (pk.kind) {
    case 'spark': p.gainSparks(pk.amount); break;
    case 'xp': p.gainXp(pk.amount); break;
    case 'heart': w.healPlayer(pk.amount); break;
    case 'ash': run.stats.ashPickedUp = (run.stats.ashPickedUp || 0) + pk.amount; break;
    case 'shield': w.addShield(pk.amount); break;
    default: break;
  }
  bus.emit('pickup:collect', { kind: pk.kind, amount: pk.amount });
  runHooks(run, 'onPickup', { kind: pk.kind, amount: pk.amount });
  const fx = PICKUP_FX[pk.kind];
  if (fx) w.fx.burst(fx[0], pk.x, pk.y, { count: 3, color: fx[1] });
}

export function updatePickups(w, dt) {
  const p = w.player;
  const list = w.pickups;
  const n = list.length;
  const radius = p.stats.pickupRadius;
  const full = p.hp >= p.stats.maxHp;
  for (let i = 0; i < n; i++) {
    const pk = list[i];
    if (pk.dead) continue;
    pk.age += dt;
    let attracted = false;
    if (pk.age >= PICKUP_DELAY && p.alive && !(pk.kind === 'heart' && full)) {
      const dx = p.x - pk.x, dy = p.y - pk.y;
      const d = Math.hypot(dx, dy);
      if (d < p.r + 5) { collectPickup(w, pk); continue; }
      if (pk.magnet || d < radius) {
        attracted = true;
        pk.pull = Math.min(PICKUP_SPEED, Math.max(pk.pull, 80) + 900 * dt);
        const step = Math.min(d, pk.pull * dt);
        pk.x += (dx / d) * step; pk.y += (dy / d) * step;
        pk.vx = 0; pk.vy = 0;
        if (d - step < p.r + 5) { collectPickup(w, pk); continue; }
      }
    }
    if (!attracted) {
      pk.pull = 0;
      if (pk.vx || pk.vy) {
        const nx = pk.x + pk.vx * dt, ny = pk.y + pk.vy * dt;
        if (w.isSolidPx(nx, ny, false)) { pk.vx = 0; pk.vy = 0; }
        else {
          pk.x = nx; pk.y = ny;
          const f = Math.pow(0.004, dt);
          pk.vx *= f; pk.vy *= f;
          if (Math.abs(pk.vx) + Math.abs(pk.vy) < 4) { pk.vx = 0; pk.vy = 0; }
        }
      }
    }
  }
}
