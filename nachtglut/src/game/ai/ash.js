// Aschegruben (floor 1) enemy behaviours.
import {
  params, cdMul, speedScale, moveSpeed, go, tick, distTo, face, aimAt, telegraph, attackEvent,
  fireFan, fireRing, zone, telegraphLine, delayedBlast, rayLength, killSelf, moveDir, chase, chaseDir, steerTo, kite,
} from './util.js';

/** Move along a locked angle at `speed`; returns moved fraction. */
function dashAlong(w, e, ang, speed, dt) { return moveDir(w, e, Math.cos(ang), Math.sin(ang), speed, dt); }

export const ASH_AI = {
  // Skittering chaser: zig-zags toward the player, crouches (0.42 s) and lunges a short distance.
  ash_crawler: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(0.9, 1.6); d.wob = w.rng.angle(); go(e, 'chase'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          if (d.t < a.windup - 0.15) d.ang = aimAt(e, p, a.lungeSpeed, 0.6);
          if (d.t >= a.windup) { go(e, 'lunge'); attackEvent(w, e, 'melee'); }
          break;
        case 'lunge': {
          e.anim = 'attack';
          const f = dashAlong(w, e, d.ang, a.lungeSpeed * speedScale(e), dt);
          if (d.t >= a.lungeTime || f < 0.25) { go(e, 'recover'); d.cd = a.cooldown * cdMul(e) * w.rng.float(0.85, 1.25); }
          break;
        }
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.35) go(e, 'chase');
          break;
        default: {
          d.wob += dt * 10;
          const dir = chaseDir(w, e);
          if (dir.x || dir.y) {
            const s = Math.sin(d.wob) * 0.55;
            moveDir(w, e, dir.x - dir.y * s, dir.y + dir.x * s, moveSpeed(e), dt);
            e.anim = 'walk';
          } else e.anim = 'idle';
          const dist = distTo(e, p);
          if (d.cd <= 0 && dist < a.lungeRange && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            d.ang = aimAt(e, p);
            go(e, 'windup');
            telegraph(w, e, 'melee');
          }
        }
      }
    },
  },

  // Flying: erratic sine-wave swoops around the player, rears back (0.45 s) and dives through.
  cinder_bat: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.0, 1.8); d.orb = null; d.dir = w.rng.sign(); d.ph = w.rng.angle(); go(e, 'hover'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'windup': {
          e.anim = 'attack';
          const back = Math.atan2(e.y - p.y, e.x - p.x);
          moveDir(w, e, Math.cos(back), Math.sin(back), 18 * speedScale(e), dt);
          if (d.t < a.windup - 0.12) d.ang = aimAt(e, p, a.diveSpeed, 0.6);
          else face(e, e.x + Math.cos(d.ang), e.y + Math.sin(d.ang));
          if (d.t >= a.windup) { go(e, 'dive'); attackEvent(w, e, 'melee'); }
          break;
        }
        case 'dive': {
          e.anim = 'attack';
          const f = dashAlong(w, e, d.ang, a.diveSpeed * speedScale(e), dt);
          if (d.t >= a.diveTime || f < 0.25) {
            go(e, 'hover');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.85, 1.3);
            d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          }
          break;
        }
        default: {
          if (d.orb == null) d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          d.ph += dt * 3.4;
          if (w.rng.chance(dt * 0.4)) d.dir = -d.dir;
          d.orb += d.dir * dt * 1.5;
          const R = a.orbit + Math.sin(d.ph) * 24;
          const f = steerTo(w, e, p.x + Math.cos(d.orb) * R, p.y + Math.sin(d.orb) * R, moveSpeed(e), dt);
          if (f < 0.15) d.dir = -d.dir;
          e.anim = 'walk';
          const dist = distTo(e, p);
          if (d.cd <= 0 && dist < a.orbit + 50 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            d.ang = aimAt(e, p);
            go(e, 'windup');
            telegraph(w, e, 'melee');
          }
        }
      }
    },
  },

  // Keeps 90–140 px away and spits a 3-shot spread of slag after a 0.5 s wind-up.
  ember_spitter: {
    init(w, e) { e.data.cd = w.rng.float(1.0, 1.7); go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (e.state === 'windup') {
        e.anim = 'attack';
        const ang = aimAt(e, p, a.projSpeed, 0.3);
        if (d.t >= a.windup) {
          fireFan(w, e, a.shots, ang, a.spread * (a.shots - 1), {
            speed: a.projSpeed, damage: a.projDamage, type: 'fire', color: '#ff8a3c', sprite: 'proj_blob', trail: 'ember',
            light: { r: 18, color: '#ff6a1f' },
          });
          attackEvent(w, e, 'shoot');
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
          go(e, 'recover');
        }
        return;
      }
      if (e.state === 'recover') { e.anim = 'idle'; face(e, p.x, p.y); if (d.t >= 0.35) go(e, 'move'); return; }
      kite(w, e, dt, a.min, a.max);
      if (d.cd <= 0 && distTo(e, p) < a.max + 40 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
        go(e, 'windup');
        telegraph(w, e, 'shoot');
      }
    },
  },

  // Runs at the player; when close it plants itself, the fuse burns 0.7 s (warning circle), then it explodes.
  soot_bomber: {
    init(w, e) { e.data.cd = w.rng.float(0.8, 1.2); go(e, 'chase'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (e.state === 'fuse') {
        e.anim = 'attack';
        face(e, p.x, p.y);
        // safety: if the fuse zone vanished without exploding, re-arm
        if (!d.fuse || (d.fuse.dead && !d.fuse.active)) { d.fuse = null; go(e, 'chase'); }
        return;
      }
      chase(w, e, dt);
      if (d.cd <= 0 && distTo(e, p) < a.fuseRange) {
        go(e, 'fuse');
        telegraph(w, e, 'explode');
        d.fuse = delayedBlast(w, e, e.x, e.y, a.fuse, a.radius, a.blast, {
          type: 'fire', color: '#ff6a1f', knockback: 170,
          onBlast(w2) { killSelf(w2, e); },
        });
      }
    },
  },

  // Stationary kiln: winds up 0.5 s, then two staggered 6-way rings; the pattern rotates every volley.
  kiln_turret: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.0, 1.8); d.base = w.rng.angle(); go(e, 'idle'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      e.facing = d.base;
      const ring = (off) => fireRing(w, e, a.shots, d.base + off, {
        speed: a.projSpeed, damage: a.projDamage, type: 'fire', color: '#ffb347', sprite: 'proj_orb', cap: a.projCap ?? 24,
        light: { r: 16, color: '#ff8a3c' }, life: 4,
      });
      if (e.state === 'windup') {
        e.anim = 'attack';
        if (d.t >= a.windup) { ring(0); attackEvent(w, e, 'shoot'); go(e, 'volley2'); }
        return;
      }
      if (e.state === 'volley2') {
        e.anim = 'attack';
        if (d.t >= 0.32) {
          ring(Math.PI / a.shots);
          d.base += a.rot * (d.spin || (d.spin = w.rng.sign()));
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.15);
          go(e, 'idle');
        }
        return;
      }
      e.anim = 'idle';
      if (d.cd <= 0 && distTo(e, p) < a.range) { go(e, 'windup'); telegraph(w, e, 'shoot'); }
    },
  },

  // Heavy: telegraphed charge along a line (0.8 s) or a ground slam ring when the player is close.
  slag_brute: {
    init(w, e) { e.data.cd = w.rng.float(1.2, 2.0); go(e, 'chase'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'chargeWind':
          e.anim = 'attack';
          if (d.t >= a.chargeWind) {
            go(e, 'charge');
            attackEvent(w, e, 'charge');
            d.trav = 0;
            d.hit = zone(w, e, {
              shape: 'circle', x: e.x, y: e.y, r: e.r + 5, follow: e, delay: 0, duration: 2,
              damage: a.chargeDamage, knockback: 230, color: '#ff6a1f',
            });
          }
          break;
        case 'charge': {
          e.anim = 'attack';
          const sp = a.chargeSpeed * speedScale(e);
          const f = dashAlong(w, e, d.ang, sp, dt);
          d.trav += f * sp * dt;
          if (d.trav >= d.len || f < 0.3 || d.t > 1.6) {
            if (d.hit) d.hit.dead = true;
            d.hit = null;
            if (f < 0.3) w.fx.shake(2.5, 0.15);
            go(e, 'stagger');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.25);
          }
          break;
        }
        case 'slamWind':
          e.anim = 'attack';
          if (d.t >= a.slamWind) {
            attackEvent(w, e, 'slam');
            w.fx.shake(3, 0.2);
            w.fx.burst('dust', e.x, e.y, { count: 14 });
            go(e, 'stagger');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.25);
          }
          break;
        case 'stagger':
          e.anim = 'idle';
          if (d.t >= 0.8) go(e, 'chase');
          break;
        default: {
          chase(w, e, dt);
          if (d.cd > 0) break;
          const dist = distTo(e, p);
          if (dist < a.slamRange) {
            go(e, 'slamWind');
            telegraph(w, e, 'slam');
            zone(w, e, {
              shape: 'circle', x: e.x, y: e.y, r: a.slamRadius, delay: a.slamWind, duration: 0.12,
              damage: a.slamDamage, knockback: 200, color: '#ff8a3c',
            });
          } else if (dist < a.chargeRange && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            const ang = aimAt(e, p);
            const len = Math.min(a.chargeLen, rayLength(w, e.x, e.y, ang, a.chargeLen + 20, false) - e.r);
            if (len > 40) {
              d.ang = ang; d.len = len;
              go(e, 'chargeWind');
              telegraph(w, e, 'charge');
              telegraphLine(w, e, e.x + Math.cos(ang) * (len + e.r), e.y + Math.sin(ang) * (len + e.r), {
                width: e.r * 2 + 6, delay: a.chargeWind, color: '#ff6a1f',
              });
            } else d.cd = 0.5;
          }
        }
      }
    },
  },
};

/** soot_bomber death: if it did not blow itself up, it still bursts after a short warning. */
export function sootBomberDeath(w, e) {
  if (e.data.fuse) return; // fuse already burning: that zone explodes on its own
  const a = params(e);
  delayedBlast(w, e, e.x, e.y, a.deathFuse, a.deathRadius, a.deathBlast, { type: 'fire', color: '#ff6a1f', knockback: 140 });
}
