// Shared boss framework: intro, HP-threshold phases, a weighted attack scheduler that runs
// generator-based attack scripts, plus telegraph / zone / bullet / summon helpers. DOM-free.
//
// Attack scripts are generator functions `function* (w, e, B)`:
//   `yield 0.5`        -> wait 0.5 s
//   `yield`            -> wait one tick (the yield expression returns dt)
//   `yield* during(s, (dt, t) => …)` -> run a per-tick function for s seconds (return true to stop early)
// On a phase change the running script is aborted with `gen.return()`, so `finally` blocks run
// (use them to restore e.hidden / e.damage / anims).
import { bus } from '../../core/events.js';
import { TS, TYPE_COLORS } from '../constants.js';
import { TAU, clamp } from '../../core/math.js';

export const INTRO_TIME = 1.6;
export const TRANSITION_TIME = 1.0;
export const TELE_MIN = 0.45;
export const SHOT_CAP = 420;          // hard cap on live projectiles (boss patterns stop spawning above it)
const ATTACK_TIMEOUT = 16;            // s: safety net against a script that never ends

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
export function* during(dur, fn) {
  let t = 0;
  while (t < dur) {
    const dt = (yield) || 0;
    t += dt;
    if (fn && fn(dt, t) === true) return t;
  }
  return t;
}

/** Arena rectangle (inside the 1-tile wall border) in world px. */
export function arena(w) {
  const rw = w.room ? w.room.w : w.w, rh = w.room ? w.room.h : w.h;
  const W = rw * TS, H = rh * TS;
  return { x0: TS, y0: TS, x1: W - TS, y1: H - TS, cx: W / 2, cy: H / 2, w: W - 2 * TS, h: H - 2 * TS };
}

/** Nearest position around (x, y) where a circle of radius r can stand. */
export function findStand(w, x, y, r = 8, flying = false) {
  if (w.canStand(x, y, r, flying)) return { x, y };
  for (let rad = 1; rad <= 10; rad++) {
    const n = 8 * rad;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const nx = x + Math.cos(a) * rad * TS * 0.5, ny = y + Math.sin(a) * rad * TS * 0.5;
      if (w.canStand(nx, ny, r, flying)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}

/** A standable point at distance `d` from (x, y) in direction `ang`, pulled inside the room. */
export function pointNear(w, x, y, d, ang, margin = 14) {
  for (let i = 0; i < 6; i++) {
    const dd = d * (1 - i * 0.12);
    const c = w.clampToRoom(x + Math.cos(ang) * dd, y + Math.sin(ang) * dd, margin);
    if (w.canStand(c.x, c.y, 6)) return c;
  }
  const c = w.clampToRoom(x + Math.cos(ang) * d, y + Math.sin(ang) * d, margin);
  return findStand(w, c.x, c.y, 6);
}

/** Length of a ray from (x, y) along `ang` until it leaves the arena rectangle. */
export function rayLen(w, x, y, ang, max = 600) {
  const A = arena(w);
  const c = Math.cos(ang), s = Math.sin(ang);
  let t = max;
  if (c > 1e-6) t = Math.min(t, (A.x1 - x) / c); else if (c < -1e-6) t = Math.min(t, (A.x0 - x) / c);
  if (s > 1e-6) t = Math.min(t, (A.y1 - y) / s); else if (s < -1e-6) t = Math.min(t, (A.y0 - y) / s);
  return Math.max(0, t);
}

/** Keep a (big) boss fully inside the room rectangle. Returns true when it had to be pushed back. */
export function keepInArena(w, e, margin = e.r * 0.8) {
  const c = w.clampToRoom(e.x, e.y, margin);
  const moved = Math.abs(c.x - e.x) > 0.01 || Math.abs(c.y - e.y) > 0.01;
  e.x = c.x; e.y = c.y;
  return moved;
}

export function facePlayer(w, e) {
  const p = w.player;
  e.facing = Math.atan2(p.y - e.y, p.x - e.x);
  e.flipX = p.x < e.x;
}

export const angleToPlayer = (w, e) => Math.atan2(w.player.y - e.y, w.player.x - e.x);
export const distToPlayer = (w, e) => Math.hypot(w.player.x - e.x, w.player.y - e.y);
export const teleTime = (B, base) => Math.max(TELE_MIN, base * (B.teleMul || 1));
export const telegraph = (e, kind) => bus.emit('enemy:telegraph', { enemy: e, kind });
export const attackEvent = (e, kind) => bus.emit('enemy:attack', { enemy: e, kind });

// ---------------------------------------------------------------------------------------------
// Zones (telegraphs + area effects). Damage is multiplied by the owner's dmgMul.
// ---------------------------------------------------------------------------------------------
export function zone(w, e, spec) {
  const s = { team: 'enemy', owner: e, ...spec };
  s.damage = (spec.damage || 0) * (e.dmgMul ?? 1);
  return w.spawnZone(s);
}
export const zCircle = (w, e, x, y, r, o = {}) => zone(w, e, { shape: 'circle', x, y, r, ...o });
export const zLine = (w, e, x, y, x2, y2, width, o = {}) => zone(w, e, { shape: 'line', x, y, x2, y2, width, ...o });
export const zCone = (w, e, x, y, r, angle, arc, o = {}) => zone(w, e, { shape: 'cone', x, y, r, angle, arc, ...o });
export const zRing = (w, e, x, y, r, inner, o = {}) => zone(w, e, { shape: 'ring', x, y, r, inner, ...o });

// ---------------------------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------------------------
export function shot(w, e, x, y, angle, speed, o = {}) {
  if (w.projectiles.length >= SHOT_CAP) return null;
  const color = o.color || e.def.color;
  return w.spawnProjectile({
    x, y, angle, speed,
    r: o.r ?? 3.5,
    damage: (o.damage ?? 10) * (e.dmgMul ?? 1),
    type: o.type || 'phys', team: 'enemy',
    life: o.life ?? clamp(560 / Math.max(20, speed || 20), 1.2, 7),
    sprite: o.sprite || 'proj_orb', color, scale: o.scale ?? 1, spin: o.spin ?? 0,
    light: o.light === false ? null : (o.light || { r: 14, color }),
    trail: o.trail ?? null, status: o.status ?? null,
    accel: o.accel ?? 0, homing: o.homing ?? 0, ghost: !!o.ghost, arc: o.arc ?? null,
    knockback: o.knockback ?? 40, owner: e,
    onUpdate: o.onUpdate, onExpire: o.onExpire, onHit: o.onHit, data: o.data,
  });
}

/** Evenly spaced ring. o.gap = { at: angle, size: rad } leaves an opening. */
export function ringShots(w, e, x, y, n, speed, a0 = 0, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    if (o.gap) {
      let d = (a - o.gap.at) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      if (Math.abs(d) < o.gap.size / 2) continue;
    }
    const p = shot(w, e, x, y, a, speed, o);
    if (p) out.push(p);
  }
  return out;
}

/** n bullets spread over `spread` rad centred on `angle`. */
export function fanShots(w, e, x, y, angle, n, spread, speed, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    const p = shot(w, e, x, y, angle + t * spread, speed, o);
    if (p) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Summons + parts
// ---------------------------------------------------------------------------------------------
export function liveMinions(B) {
  B.minions = (B.minions || []).filter((m) => !m.dead);
  return B.minions.length;
}

function pendingSummons(w, e) {
  let n = 0;
  for (const z of w.zones) if (!z.dead && !z.active && z.data && z.data.summonFor === e) n++;
  return n;
}

/**
 * Telegraphed summon: a marker zone per minion; the minion appears when the marker fires.
 * opts: { cap = 4, radius, delay = 0.7, color, ids?: string[] (cycled) }
 */
export function summon(w, e, id, n, opts = {}) {
  const B = e.data;
  const cap = opts.cap ?? 4;
  const k = Math.min(n, cap - liveMinions(B) - pendingSummons(w, e));
  if (k <= 0) return 0;
  const base = w.rng.angle();
  const rad = opts.radius ?? e.r + 22;
  for (let i = 0; i < k; i++) {
    const a = base + (i / k) * TAU;
    let pos = w.clampToRoom(e.x + Math.cos(a) * rad, e.y + Math.sin(a) * rad, 12);
    if (!w.canStand(pos.x, pos.y, 6)) pos = w.randomFloorPos({ minPlayerDist: 70, margin: 2 });
    const mid = opts.ids ? opts.ids[i % opts.ids.length] : id;
    zCircle(w, e, pos.x, pos.y, 10, {
      delay: opts.delay ?? 0.7, duration: 0.05, damage: 0, color: opts.color || e.def.color,
      data: { summonFor: e },
      onStart(w2, z) {
        if (e.dead) return;
        const m = w2.spawnEnemy(mid, z.x, z.y, { summoned: true, noXp: true });
        if (m) { (B.minions || (B.minions = [])).push(m); w2.fx.burst('spawn', z.x, z.y, { color: e.def.color, count: 10 }); }
      },
    });
  }
  attackEvent(e, 'summon');
  return k;
}

/** Despawn a boss part without death events/loot (segments, twins, cores when their boss dies). */
export function removePart(w, o, fx = true) {
  if (!o || o.dead) return;
  if (fx && !o.hidden) w.fx.burst('death', o.x, o.y, { color: o.def.color, count: 14 });
  o.hidden = false;
  o.dead = true;
  o.hp = 0;
}

/** Removes every enemy whose `data.owner` is `e` (call from the boss' onDeath hook). */
export function removeParts(w, e) {
  for (const o of w.enemies) if (!o.dead && o !== e && o.data && o.data.owner === e) removePart(w, o);
}

const fmtDmg = (d) => (d < 10 ? (Math.round(d * 10) / 10).toString() : Math.round(d).toString());

/**
 * hooks.onHit helper for parts that share the HP pool of `to` (wyrm segments, Umbra's twin):
 * forwards `mul` × the hit to `to`, negates it on the part, flashes both and shows the number on the part.
 */
export function forwardHit(w, from, to, hit, mul = 1) {
  const info = hit.info || {};
  const wasSilent = !!info.silent, wasDot = !!info.dot;
  // undo the boss-damage multiplier the part already received (it is applied again on `to`)
  const bd = from.boss ? (w.player && w.player.stats && w.player.stats.bossDamage) || 1 : 1;
  const amount = (hit.amount * mul) / bd;
  hit.amount = 0;
  info.silent = true; // the part itself must not print "Geblockt"
  from.flash = 1;
  if (!to || to.dead || !(amount > 0)) return 0;
  const dealt = w.damageEnemy(to, amount, { ...info, silent: true, dot: false, type: hit.type, crit: hit.crit });
  if (dealt > 0 && (!wasSilent || wasDot)) {
    w.fx.text(from.x + (wasDot ? w.rng.float(-4, 4) : 0), from.y - from.r - 4, fmtDmg(dealt),
      hit.crit ? '#ffe75a' : TYPE_COLORS[hit.type] || '#fff', { crit: !!hit.crit, small: wasDot, damage: true });
    if (!wasSilent) w.fx.burst('hit', from.x, from.y, { color: TYPE_COLORS[hit.type], count: hit.crit ? 7 : 4 });
  }
  return dealt;
}

/**
 * hooks.onHit helper: a single hit may not skip a phase. HP stops just below the next threshold so the
 * phase transition (and its attack set) is always seen, even with burst builds.
 */
export function phaseGate(w, e, hit) {
  const B = e.data;
  if (!B || !B.thresholds || !(hit.amount > 0)) return;
  const next = B.thresholds[(B.phase || 1) - 1];
  if (next == null) return;
  const floor = e.maxHp * (next - 0.02);
  if (e.hp - hit.amount < floor) hit.amount = Math.max(0, e.hp - floor);
}

// ---------------------------------------------------------------------------------------------
// Boss AI factory
// ---------------------------------------------------------------------------------------------
/**
 * cfg = {
 *   phases: [0.5, 0.25],                       // HP fractions that start phase 2, 3, …
 *   phaseStats: [{ tele, speed, recover }, …],  // per phase: telegraph mul, speed mul, recovery between attacks (s)
 *   introAnim: 'special', transitionTime: 1, firstDelay: 0.6,
 *   attacks: { id: { phases?: [1,2], weight: n | (w,e,B) => n, cond?(w,e,B), recover?: mul, run: function*(w,e,B) } },
 *   init?(w,e,B), start?(w,e,B) (first active tick), pre?(w,e,B,dt), post?(w,e,B,dt) (every tick),
 *   move?(w,e,B,dt) (between attacks), onPhase?(w,e,B,phase), transition?(w,e,B,dt,t), afterTransition?(w,e,B),
 *   phaseColor: '#fff',
 * }
 */
export function makeBossAI(cfg) {
  const attacks = cfg.attacks || {};
  const ids = Object.keys(attacks);

  function applyPhase(B) {
    const ps = (cfg.phaseStats && cfg.phaseStats[B.phase - 1]) || {};
    B.teleMul = ps.tele ?? 1;
    B.spdMul = ps.speed ?? 1;
    B.recover = ps.recover ?? 1;
  }

  function pick(w, e, B) {
    const list = [];
    for (const id of ids) {
      const a = attacks[id];
      if (a.phases && !a.phases.includes(B.phase)) continue;
      if (a.cond && !a.cond(w, e, B)) continue;
      list.push(id);
    }
    let pool = list.filter((id) => id !== B.last);
    if (!pool.length) pool = list;
    if (!pool.length) return null;
    return w.rng.weighted(pool, (id) => {
      const wt = attacks[id].weight;
      return typeof wt === 'function' ? wt(w, e, B) : (wt ?? 1);
    });
  }

  function abort(B) {
    const g = B.gen;
    B.gen = null; B.attack = null; B.wait = 0;
    if (g) { try { g.return(); } catch (err) { console.error('[boss] attack abort failed', err); } }
  }

  function endAttack(e, B) {
    const a = attacks[B.attack];
    B.gen = null;
    B.mode = 'idle';
    B.cd = (a && a.recover != null ? a.recover : 1) * B.recover;
    B.attack = null;
    e.anim = 'idle';
  }

  function step(w, e, B, dt) {
    B.attackT += dt;
    if (B.attackT > ATTACK_TIMEOUT) { abort(B); endAttack(e, B); return; }
    if (B.wait > 0) {
      B.wait -= dt;
      if (B.wait > 0) return;
    }
    let r;
    try { r = B.gen.next(dt); } catch (err) {
      console.error(`[boss] ${e.id} attack ${B.attack} failed`, err);
      r = { done: true };
    }
    if (!B.gen) return; // aborted from inside
    if (r.done) endAttack(e, B);
    else if (typeof r.value === 'number') B.wait = r.value;
  }

  function startAttack(w, e, B) {
    const id = pick(w, e, B);
    if (!id) { B.cd = 0.5; return; }
    B.last = id; B.attack = id; B.mode = 'attack'; B.wait = 0; B.attackT = 0;
    B.gen = attacks[id].run(w, e, B);
    step(w, e, B, 0);
  }

  function enterPhase(w, e, B) {
    abort(B);
    B.phase++;
    applyPhase(B);
    B.mode = 'transition';
    B.modeT = 0;
    e.invuln = true;
    e.hidden = false;
    for (const p of w.projectiles) if (p.team === 'enemy') p.dead = true;
    const col = cfg.phaseColor || e.def.color;
    w.fx.shake(6, 0.6);
    w.fx.flash(col, 0.25);
    w.fx.ring(e.x, e.y, 120, col, 0.6);
    w.fx.burst('explosion', e.x, e.y, { color: col, count: 30 });
    w.fx.light(e.x, e.y, 200, col, 0.8);
    e.anim = cfg.phaseAnim || 'special';
    telegraph(e, 'phase');
    bus.emit('boss:phase', { boss: e, phase: B.phase });
    if (cfg.onPhase) cfg.onPhase(w, e, B, B.phase);
  }

  return {
    init(w, e) {
      const B = e.data;
      B.phase = 1; B.mode = 'intro'; B.modeT = 0; B.cd = 0; B.gen = null; B.wait = 0;
      B.last = null; B.attack = null; B.attackT = 0; B.minions = [];
      B.thresholds = cfg.phases || [];
      B.baseDamage = e.damage;
      applyPhase(B);
      e.invuln = true;
      e.anim = cfg.introAnim || 'special';
      if (cfg.init) cfg.init(w, e, B);
    },
    update(w, e, dt) {
      const B = e.data;
      if (!B.started) {
        B.started = true;
        w.fx.shake(5, INTRO_TIME * 0.8);
        w.fx.burst('explosion', e.x, e.y, { color: e.def.color, count: 26 });
        telegraph(e, 'intro');
        if (cfg.start) cfg.start(w, e, B);
      }
      if (cfg.pre) cfg.pre(w, e, B, dt);
      if (e.dead) return;
      // phase thresholds
      if (B.mode === 'idle' || B.mode === 'attack') {
        const next = B.thresholds[B.phase - 1];
        if (next != null && e.hp <= e.maxHp * next) enterPhase(w, e, B);
      }
      B.modeT += dt;
      switch (B.mode) {
        case 'intro':
          e.invuln = true;
          e.anim = cfg.introAnim || 'special';
          if (cfg.introTick) cfg.introTick(w, e, B, dt);
          if (B.modeT >= INTRO_TIME) {
            e.invuln = false;
            B.mode = 'idle';
            B.cd = cfg.firstDelay ?? 0.6;
            e.anim = 'idle';
          }
          break;
        case 'transition':
          e.invuln = true;
          if (cfg.transition) cfg.transition(w, e, B, dt, B.modeT);
          if (B.modeT >= (cfg.transitionTime ?? TRANSITION_TIME)) {
            e.invuln = false;
            B.mode = 'idle';
            B.cd = 0.5;
            e.anim = 'idle';
            if (cfg.afterTransition) cfg.afterTransition(w, e, B);
          }
          break;
        case 'idle':
          if (cfg.move) cfg.move(w, e, B, dt);
          B.cd -= dt;
          if (B.cd <= 0) startAttack(w, e, B);
          break;
        case 'attack':
          step(w, e, B, dt);
          break;
        default:
          B.mode = 'idle';
      }
      if (cfg.post) cfg.post(w, e, B, dt);
    },
  };
}
