// Schattenkern (floor 4) enemy behaviours.
import { angleDiff, rotateToward } from '../../core/math.js';
import {
  params, cdMul, speedScale, moveSpeed, go, tick, distTo, face, aimAt, telegraph, attackEvent,
  fireFan, fireRing, zone, telegraphLine, telegraphCircle, endWithOwner, rayLength, moveDir, chase, kite,
  summon, teleportNear,
} from './util.js';

const SHADOW = '#b07cff';
const MAGENTA = '#e04bd0';

export const VOID_AI = {
  // Leaps onto the player (0.4 s crouch) and latches: slows + drains. A dash (or a hard knock) shakes it off.
  null_leech: {
    init(w, e) { e.data.cd = w.rng.float(0.9, 1.6); go(e, 'chase'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          if (d.t < a.windup - 0.12) d.ang = aimAt(e, p);
          if (d.t >= a.windup) { go(e, 'leap'); attackEvent(w, e, 'melee'); }
          break;
        case 'leap': {
          e.anim = 'attack';
          const f = moveDir(w, e, Math.cos(d.ang), Math.sin(d.ang), a.leapSpeed * speedScale(e), dt);
          if (distTo(e, p) < e.r + p.r + 2 && p.alive && !p.dashing && latchedCount(w) < a.maxLatched) {
            latch(w, e);
          } else if (d.t >= a.leapTime || f < 0.25) {
            go(e, 'recover');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.3);
          }
          break;
        }
        case 'latched': {
          e.anim = 'attack';
          const kb = Math.hypot(e.kbx, e.kby);
          if (p.dashing || !p.alive || d.t >= a.latchMax || kb > 140 || w.isSolidPx(p.x, p.y, false)) { detach(w, e, p.dashing || kb > 140); break; }
          e.x = p.x + d.ox; e.y = p.y + d.oy;
          if (!w.canStand(e.x, e.y, e.r)) { e.x = p.x; e.y = p.y; }
          e.kbx = 0; e.kby = 0;
          face(e, p.x, p.y);
          w.applyStatus(p, 'slow', { duration: 0.35 });
          d.drainT -= dt;
          if (d.drainT <= 0) {
            d.drainT = 0.5;
            const dealt = w.damagePlayer(a.drain * (e.dmgMul ?? 1), { type: 'shadow', source: e, dot: true, unblockable: true });
            if (dealt > 0) e.hp = Math.min(e.maxHp, e.hp + dealt);
          }
          break;
        }
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.6) { e.contact = e.def.contact !== false; go(e, 'chase'); }
          break;
        default:
          chase(w, e, dt);
          if (d.cd <= 0 && distTo(e, p) < a.leapRange && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            d.ang = aimAt(e, p);
            go(e, 'windup');
            telegraph(w, e, 'melee');
          }
      }
    },
  },

  // Phased (translucent, invulnerable, untargetable) while gliding; turns solid to strike and stays solid briefly.
  shade: {
    init(w, e) { e.data.cd = w.rng.float(0.9, 1.4); setPhased(e, true); go(e, 'phase'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          if (d.t >= a.windup) { attackEvent(w, e, 'melee'); go(e, 'recover'); }
          break;
        case 'recover':
          e.anim = 'idle';
          face(e, p.x, p.y);
          if (d.t >= a.recover) { setPhased(e, true); go(e, 'phase'); d.cd = 0.9 * cdMul(e); }
          break;
        default: {
          chase(w, e, dt);
          const dist = distTo(e, p);
          if (d.cd <= 0 && ((dist < a.strike && w.lineOfSight(e.x, e.y, p.x, p.y)) || d.t >= a.maxPhase)) {
            setPhased(e, false);
            const ang = aimAt(e, p);
            go(e, 'windup');
            telegraph(w, e, 'melee');
            zone(w, e, {
              shape: 'cone', x: e.x, y: e.y, r: a.strike + 10, angle: ang, arc: a.arc, delay: a.windup, duration: 0.12,
              damage: a.damage, type: 'shadow', knockback: 120, color: SHADOW,
            });
          }
        }
      }
    },
  },

  // Floating eye: charges a beam (1 s marked line) that then sweeps slowly across the player's position.
  void_eye: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.5, 2.2); d.ph = w.rng.angle(); go(e, 'hover'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      d.ph += dt * 2.2;
      switch (e.state) {
        case 'charge':
        case 'beam': {
          e.anim = 'attack';
          const z = d.beam;
          if (!z || z.dead) { d.beam = null; go(e, 'recover'); d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2); break; }
          if (z.active) {
            if (e.state === 'charge') { go(e, 'beam'); attackEvent(w, e, 'beam'); }
            d.bAng += d.sweepDir * (a.sweep / a.sweepTime) * dt * (e.slowMul ?? 1);
          }
          aimBeam(w, e, z, d.bAng, a.range);
          e.facing = d.bAng;
          e.flipX = Math.cos(d.bAng) < 0;
          break;
        }
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.7) go(e, 'hover');
          break;
        default: {
          kite(w, e, dt, a.min, a.max, 0.8);
          e.anim = 'idle';
          if (d.cd <= 0 && distTo(e, p) < a.range - 20 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            const aim = aimAt(e, p);
            d.sweepDir = w.rng.sign();
            d.bAng = aim - d.sweepDir * a.sweep * 0.5;
            d.beam = zone(w, e, {
              shape: 'line', x: e.x, y: e.y, x2: e.x, y2: e.y, width: a.width, delay: a.charge, duration: a.sweepTime,
              tick: 0.35, damage: a.damage, type: 'shadow', color: MAGENTA, onTick: endWithOwner, data: { tag: 'beam' },
            });
            aimBeam(w, e, d.beam, d.bAng, a.range);
            go(e, 'charge');
            telegraph(w, e, 'beam');
          }
        }
      }
    },
  },

  // Blinks away when the player gets close, then fires a 5-shot fan (0.55 s cast).
  rift_mage: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.2, 1.9); d.bcd = w.rng.float(0.8, 1.5); go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.bcd > 0) d.bcd -= dt;
      switch (e.state) {
        case 'blink':
          e.anim = 'cast';
          if (d.t >= 0.35) {
            teleportNear(w, e, a.blinkMin, a.blinkMax);
            attackEvent(w, e, 'teleport');
            d.bcd = a.blinkCd * cdMul(e);
            if (w.lineOfSight(e.x, e.y, p.x, p.y)) { go(e, 'castWind'); telegraph(w, e, 'shoot', 'cast'); }
            else { go(e, 'move'); d.cd = Math.min(d.cd, 0.6); }
          }
          break;
        case 'castWind': {
          e.anim = 'cast';
          const ang = aimAt(e, p, a.projSpeed, 0.25);
          if (d.t >= a.windup) {
            fireFan(w, e, a.shots, ang, a.spread, {
              speed: a.projSpeed, damage: a.projDamage, type: 'shadow', sprite: 'proj_orb', color: SHADOW, light: { r: 16, color: SHADOW },
            });
            attackEvent(w, e, 'shoot');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
            go(e, 'recover');
          }
          break;
        }
        case 'recover':
          e.anim = 'idle';
          face(e, p.x, p.y);
          if (d.t >= 0.4) go(e, 'move');
          break;
        default: {
          kite(w, e, dt, a.min, a.max);
          const dist = distTo(e, p);
          if (d.bcd <= 0 && dist < a.blinkRange) {
            go(e, 'blink');
            telegraph(w, e, 'teleport', 'cast');
            w.fx.burst('shadow', e.x, e.y, { count: 10, color: SHADOW });
          } else if (d.cd <= 0 && dist < a.max + 40 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            go(e, 'castWind');
            telegraph(w, e, 'shoot', 'cast');
          }
        }
      }
    },
  },

  // Shield bearer: turns slowly toward the player (frontal hits −80 %), dash-strikes along a marked line,
  // and is open from the front for a moment afterwards.
  echo_knight: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.2, 2.0); d.face = null; go(e, 'advance'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      const toP = Math.atan2(p.y - e.y, p.x - e.x);
      if (d.face == null) d.face = toP;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          if (d.t >= a.windup) {
            go(e, 'dash');
            d.trav = 0;
            attackEvent(w, e, 'charge');
            d.hit = zone(w, e, { shape: 'circle', x: e.x, y: e.y, r: e.r + 5, follow: e, delay: 0, duration: 1, damage: a.dashDamage, knockback: 200, type: 'shadow', color: SHADOW });
          }
          break;
        case 'dash': {
          e.anim = 'attack';
          const sp = a.dashSpeed * speedScale(e);
          const f = moveDir(w, e, Math.cos(d.face), Math.sin(d.face), sp, dt);
          d.trav += f * sp * dt;
          if (d.trav >= d.len || f < 0.3 || d.t > 0.9) {
            if (d.hit) d.hit.dead = true;
            d.hit = null;
            d.shieldDown = true;
            go(e, 'recover');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
          }
          break;
        }
        case 'bash':
          e.anim = 'attack';
          if (d.t >= a.bashWind) { attackEvent(w, e, 'melee'); d.shieldDown = true; go(e, 'recover'); d.cd = a.cooldown * 0.7 * cdMul(e); }
          break;
        case 'recover':
          e.anim = 'idle';
          if (d.t >= a.recover) { d.shieldDown = false; go(e, 'advance'); }
          break;
        default: {
          d.face = rotateToward(d.face, toP, a.turn * dt * (e.slowMul ?? 1));
          const dir = w.flowDir(e.x, e.y);
          if (dir.x || dir.y) { moveDir(w, e, dir.x, dir.y, moveSpeed(e), dt); e.anim = 'walk'; } else e.anim = 'idle';
          const dist = distTo(e, p);
          const aligned = Math.abs(angleDiff(d.face, toP)) < 0.35;
          if (d.cd <= 0 && aligned && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            if (dist < a.bashRange) {
              go(e, 'bash');
              telegraph(w, e, 'melee');
              zone(w, e, { shape: 'cone', x: e.x, y: e.y, r: a.bashRange + 8, angle: d.face, arc: 1.6, delay: a.bashWind, duration: 0.12, damage: a.bashDamage, knockback: 220, color: SHADOW });
            } else if (dist < a.dashMax) {
              d.face = toP;
              const len = Math.min(a.dashLen, dist + 40, rayLength(w, e.x, e.y, toP, a.dashLen + 10, false) - e.r);
              if (len > 30) {
                d.len = len;
                go(e, 'windup');
                telegraph(w, e, 'charge');
                telegraphLine(w, e, e.x + Math.cos(toP) * (len + e.r), e.y + Math.sin(toP) * (len + e.r), { width: e.r * 2 + 4, delay: a.windup, color: SHADOW });
              }
            }
          }
        }
      }
      e.facing = d.face;
      e.flipX = Math.cos(d.face) < 0;
    },
  },

  // Brood mother: darkness aura (slows), summons shades (cap 3), slow 10-way shadow rings.
  gloom_mother: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(2.0, 3.0); d.rcd = w.rng.float(1.2, 1.8); d.kids = []; go(e, 'walk'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.rcd > 0) d.rcd -= dt;
      d.kids = d.kids.filter((k) => !k.dead);
      if (!d.aura || d.aura.dead) {
        d.aura = zone(w, e, {
          shape: 'circle', x: e.x, y: e.y, r: a.aura, follow: e, delay: 0, duration: 600, tick: 0.25, damage: 0,
          status: { id: 'slow', duration: 0.5 }, color: '#2a1840', onTick: endWithOwner, data: { tag: 'aura' },
        });
      }
      switch (e.state) {
        case 'summonWind':
          e.anim = 'cast';
          if (d.t >= a.summonWind) {
            d.kids.push(...summon(w, e, 'shade', d.spots.length, { flying: true, spots: d.spots, delay: 0.3 }));
            attackEvent(w, e, 'summon');
            d.cd = a.summonCd * cdMul(e) * w.rng.float(0.9, 1.2);
            go(e, 'recover');
          }
          break;
        case 'ringWind':
          e.anim = 'attack';
          if (d.t >= 0.6) {
            fireRing(w, e, a.ring, w.rng.angle(), {
              speed: a.projSpeed, damage: a.projDamage, type: 'shadow', color: SHADOW, sprite: 'proj_orb', cap: a.ring * 3,
              light: { r: 14, color: MAGENTA }, life: 4,
            });
            attackEvent(w, e, 'shoot');
            d.rcd = a.ringCd * cdMul(e) * w.rng.float(0.9, 1.2);
            go(e, 'recover');
          }
          break;
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.6) go(e, 'walk');
          break;
        default: {
          chase(w, e, dt);
          const dist = distTo(e, p);
          if (d.cd <= 0 && d.kids.length < a.cap) {
            const n = Math.min(2, a.cap - d.kids.length);
            d.spots = [];
            for (let i = 0; i < n; i++) {
              const ang = w.rng.angle(), r = e.r + 14;
              const x = e.x + Math.cos(ang) * r, y = e.y + Math.sin(ang) * r;
              const ok = w.canStand(x, y, 6, true);
              d.spots.push(ok ? { x, y } : { x: e.x, y: e.y });
              telegraphCircle(w, e, ok ? x : e.x, ok ? y : e.y, 8, { delay: a.summonWind, color: SHADOW });
            }
            go(e, 'summonWind');
            telegraph(w, e, 'summon', 'cast');
          } else if (d.rcd <= 0 && dist < 220) {
            go(e, 'ringWind');
            telegraph(w, e, 'shoot');
          }
        }
      }
    },
  },
};

function aimBeam(w, e, z, ang, range) {
  const len = rayLength(w, e.x, e.y, ang, range, true);
  z.x = e.x; z.y = e.y;
  z.x2 = e.x + Math.cos(ang) * len;
  z.y2 = e.y + Math.sin(ang) * len;
}

function setPhased(e, on) {
  e.invuln = on;
  e.untargetable = on || !!e.def.untargetable;
  e.contact = !on && e.def.contact !== false;
  e.alpha = on ? 0.4 : 1;   // render hint (translucent while phased)
  e.data.phased = on;
}

function latchedCount(w) {
  let n = 0;
  for (const o of w.enemies) if (!o.dead && o.state === 'latched') n++;
  return n;
}

function latch(w, e) {
  const p = w.player, d = e.data;
  const ang = Math.atan2(e.y - p.y, e.x - p.x);
  d.ox = Math.cos(ang) * p.r * 0.7;
  d.oy = Math.sin(ang) * p.r * 0.7;
  d.drainT = 0.5;
  e.contact = false;
  go(e, 'latched');
  w.fx.burst('shadow', p.x, p.y, { count: 8, color: MAGENTA });
}

function detach(w, e, knocked) {
  const p = w.player, d = e.data, a = params(e);
  const ang = Math.atan2(e.y - p.y, e.x - p.x) || w.rng.angle();
  if (!w.canStand(e.x, e.y, e.r)) { const f = w.nearestFloor ? w.nearestFloor(e.x, e.y) : { x: e.x, y: e.y }; e.x = f.x; e.y = f.y; }
  w.knockback(e, Math.cos(ang), Math.sin(ang), 220);
  if (knocked) {
    w.applyStatus(e, 'stun', { duration: 0.8 });
    w.fx.text(e.x, e.y - 10, 'Abgeschüttelt', '#e04bd0', { small: true });
  }
  d.cd = a.cooldown * cdMul(e);
  go(e, 'recover');
}

/** echo_knight def hook: frontal hits are reduced by `aiParams.block` unless the shield is down. */
export function echoShieldHit(w, e, hit) {
  const a = params(e), info = hit.info || {};
  if (e.data.shieldDown || info.dot || info.source === 'status' || info.source === 'thorns') return;
  let from;
  const pr = info.proj;
  if (pr && (pr.vx || pr.vy)) from = Math.atan2(-pr.vy, -pr.vx);
  else from = Math.atan2(w.player.y - e.y, w.player.x - e.x);
  if (Math.abs(angleDiff(e.facing, from)) <= a.shieldArc) {
    hit.amount *= 1 - a.block;
    if (!info.silent) {
      w.fx.burst('spark', e.x + Math.cos(e.facing) * e.r, e.y + Math.sin(e.facing) * e.r, { count: 4, color: '#d8c8ff' });
      if (w.rng.chance(0.35)) w.fx.text(e.x, e.y - e.r - 8, 'Abgewehrt', '#9aa7b8', { small: true });
    }
  }
}
