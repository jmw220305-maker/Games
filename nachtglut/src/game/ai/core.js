// Sonnenherz (floor 5) enemy behaviours + generic fallbacks.
import {
  params, cdMul, speedScale, go, tick, distTo, aimAt, telegraph, attackEvent,
  shoot, fireRing, rayLength, moveDir, chase, kite,
} from './util.js';

const GOLD = '#ffd35a';

export const CORE_AI = {
  // Floating crystal: charges (0.6 s), then releases a rotating 3-arm spiral of light for 1.6 s.
  sun_shard: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.3, 2.0); d.base = w.rng.angle(); d.dir = w.rng.sign(); d.ph = w.rng.angle(); go(e, 'hover'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      d.ph += dt * 1.8;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          if (d.t >= a.windup) { go(e, 'spiral'); d.vt = 0; attackEvent(w, e, 'shoot'); }
          break;
        case 'spiral':
          e.anim = 'attack';
          d.vt -= dt;
          if (d.vt <= 0) {
            d.vt += a.interval;
            fireRing(w, e, a.arms, d.base, {
              cap: a.projCap, speed: a.projSpeed, damage: a.projDamage, type: 'light', color: GOLD, sprite: 'proj_star', spin: 4,
              light: { r: 14, color: GOLD }, life: 4,
            });
            d.base += a.rot * d.dir;
          }
          e.facing = d.base;
          if (d.t >= a.duration) {
            go(e, 'hover');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
            d.dir = w.rng.sign();
          }
          break;
        default:
          kite(w, e, dt, a.min, a.max, 0.7);
          e.anim = 'idle';
          if (d.cd <= 0 && distTo(e, p) < a.max + 70 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            go(e, 'windup');
            telegraph(w, e, 'shoot');
          }
      }
    },
  },

  // Mirror of the player: strafes, dashes out of incoming shots, fires 3-bolt bursts after a 0.4 s wind-up.
  ash_revenant: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.0, 1.6); d.dcd = 0.8; go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.dcd > 0) d.dcd -= dt;
      // dodge: like the player, a dash can be used out of most states
      if (e.state !== 'dash' && e.state !== 'burst' && d.dcd <= 0) {
        const threat = incomingShot(w, e, 64);
        if (threat || (e.state === 'move' && w.rng.chance(dt * 0.2))) {
          const base = threat ? Math.atan2(threat.vy, threat.vx) : Math.atan2(p.y - e.y, p.x - e.x);
          const l = base + Math.PI / 2, r = base - Math.PI / 2;
          const ll = rayLength(w, e.x, e.y, l, 60, false), rl = rayLength(w, e.x, e.y, r, 60, false);
          d.dashAng = ll >= rl ? l : r;
          d.resume = e.state === 'windup' ? 'windup' : 'move';
          d.resumeT = d.t;
          e.invuln = true;
          w.fx.burst('smoke', e.x, e.y, { count: 6, color: '#c9c2b8' });
          go(e, 'dash');
        }
      }
      switch (e.state) {
        case 'dash':
          e.anim = 'special';
          moveDir(w, e, Math.cos(d.dashAng), Math.sin(d.dashAng), a.dashSpeed * speedScale(e), dt);
          if (d.t >= a.dashTime) {
            e.invuln = false;
            d.dcd = a.dashCd * cdMul(e);
            const resume = d.resume, rt = d.resumeT || 0;
            go(e, resume || 'move');
            if (resume === 'windup') { d.t = rt; e.anim = 'attack'; }
          }
          break;
        case 'windup':
          e.anim = 'attack';
          aimAt(e, p);
          if (d.t >= a.windup) { go(e, 'burst'); d.shots = 0; d.bt = 0; }
          break;
        case 'burst':
          e.anim = 'attack';
          d.bt -= dt;
          if (d.bt <= 0 && d.shots < a.burst) {
            shoot(w, e, aimAt(e, p, a.projSpeed, 0.5) + w.rng.float(-0.05, 0.05), {
              speed: a.projSpeed, damage: a.projDamage, type: 'fire', sprite: 'proj_bolt', color: '#ffb347', trail: 'ember',
              light: { r: 18, color: '#ff8a3c' }, cap: 9,
            });
            if (d.shots === 0) attackEvent(w, e, 'shoot');
            d.shots++;
            d.bt = a.burstGap;
          }
          if (d.shots >= a.burst) { d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2); go(e, 'move'); }
          break;
        default:
          kite(w, e, dt, a.min, a.max);
          if (d.cd <= 0 && distTo(e, p) < a.max + 50 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            go(e, 'windup');
            telegraph(w, e, 'shoot');
          }
      }
    },
  },
};

/** A player projectile that will pass within reach of e soon. */
function incomingShot(w, e, range) {
  let best = null, bd = range;
  for (const pr of w.projectiles) {
    if (pr.dead || pr.team !== 'player' || pr.arc) continue;
    const rx = e.x - pr.x, ry = e.y - pr.y;
    const d = Math.hypot(rx, ry);
    if (d > bd) continue;
    const v = Math.hypot(pr.vx, pr.vy);
    if (v < 1 || rx * pr.vx + ry * pr.vy <= 0) continue;
    const miss = Math.abs(rx * pr.vy - ry * pr.vx) / v;
    if (miss > e.r + pr.r + 6) continue;
    best = pr; bd = d;
  }
  return best;
}

/** Generic behaviours kept for other content (summons, quick prototypes). */
export const GENERIC_AI = {
  chaser: {
    update(w, e, dt) { chase(w, e, dt); },
  },
  shooter: {
    init(w, e) { e.data.cd = w.rng.float(1.0, 1.6); go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      const range = a.range ?? 130;
      if (e.state === 'windup') {
        e.anim = 'attack';
        const ang = aimAt(e, p);
        if (d.t >= (a.windup ?? 0.45)) {
          shoot(w, e, ang, { speed: a.projSpeed ?? 105, damage: a.damage ?? 10, type: a.type || 'phys', color: e.def.color });
          attackEvent(w, e, 'shoot');
          d.cd = (a.cooldown ?? 2) * cdMul(e);
          go(e, 'move');
        }
        return;
      }
      kite(w, e, dt, range * 0.55, range);
      if (d.cd <= 0 && distTo(e, p) < range * 1.3 && w.lineOfSight(e.x, e.y, p.x, p.y)) { go(e, 'windup'); telegraph(w, e, 'shoot'); }
    },
  },
};
