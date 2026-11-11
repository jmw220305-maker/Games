// Frostadern (floor 3) enemy behaviours.
import { TAU } from '../../core/math.js';
import {
  params, cdMul, speedScale, moveSpeed, go, tick, distTo, face, aimAt, telegraph, attackEvent,
  shoot, fireFan, zone, telegraphLine, rayLength, moveDir, chase, steerTo, kite, freeSpotNear, spawnsBlocked,
} from './util.js';

const FROST = '#8fd8ff';
const CHILL = { id: 'chill', duration: 2.5, power: 1 };

export const FROST_AI = {
  // Flying orbiter: circles the player at ~88 px, slows to aim (0.45 s) and fires a chilling pair.
  frost_wisp: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.0, 1.8); d.orb = null; d.dir = w.rng.sign(); d.ph = w.rng.angle(); go(e, 'hover'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.orb == null) d.orb = Math.atan2(e.y - p.y, e.x - p.x);
      const winding = e.state === 'windup';
      d.ph += dt * 2;
      d.orb += d.dir * a.angSpeed * dt * (winding ? 0.25 : 1);
      const R = a.orbit + Math.sin(d.ph) * 12;
      const f = steerTo(w, e, p.x + Math.cos(d.orb) * R, p.y + Math.sin(d.orb) * R, moveSpeed(e, winding ? 0.35 : 1), dt);
      if (f < 0.15 && !winding) d.dir = -d.dir;
      face(e, p.x, p.y);
      if (winding) {
        e.anim = 'attack';
        if (d.t >= a.windup) {
          fireFan(w, e, 2, aimAt(e, p, a.projSpeed, 0.3), 0.18, {
            speed: a.projSpeed, damage: a.projDamage, type: 'frost', sprite: 'proj_shard', color: FROST, status: CHILL,
            light: { r: 16, color: FROST },
          });
          attackEvent(w, e, 'shoot');
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.85, 1.25);
          go(e, 'hover');
        }
        return;
      }
      e.anim = 'walk';
      if (d.cd <= 0 && distTo(e, p) < 200 && w.lineOfSight(e.x, e.y, p.x, p.y)) { go(e, 'windup'); telegraph(w, e, 'shoot'); }
    },
  },

  // Hops toward the player: squash wind-up (≥0.35 s) → hop → rest. Splits on death (def hook).
  glacier_slime: {
    init(w, e) { e.data.rest = w.rng.float(0.8, 1.3); go(e, 'rest'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'squash':
          e.anim = 'attack';
          // keeps tracking a target in clear view until the last 0.12 s, then the hop direction is locked
          if (d.t < a.squash - 0.12 && distTo(e, p) < a.hop * 2.2 && w.hasClearPath && w.hasClearPath(e.x, e.y, p.x, p.y, false)) {
            d.ang = aimAt(e, p, a.hop / a.hopTime, 0.6);
          }
          if (d.t >= a.squash) {
            go(e, 'hop');
            if (distTo(e, p) < a.hop * 1.6) attackEvent(w, e, 'melee');
          }
          break;
        case 'hop': {
          e.anim = 'walk';
          const f = moveDir(w, e, Math.cos(d.ang), Math.sin(d.ang), (a.hop / a.hopTime) * speedScale(e), dt);
          if (d.t >= a.hopTime || f < 0.2) {
            w.fx.burst('frost', e.x, e.y, { count: 4 });
            d.rest = a.rest * cdMul(e) * w.rng.float(0.8, 1.25);
            go(e, 'rest');
          }
          break;
        }
        default: {
          e.anim = 'idle';
          if (d.t >= d.rest) {
            const dir = w.flowDir(e.x, e.y);
            d.ang = dir.x || dir.y ? Math.atan2(dir.y, dir.x) : Math.atan2(p.y - e.y, p.x - e.x);
            face(e, e.x + Math.cos(d.ang), e.y + Math.sin(d.ang));
            go(e, 'squash');
            if (distTo(e, p) < a.hop * 1.6) telegraph(w, e, 'melee');
            else e.anim = 'attack';
          }
        }
      }
    },
  },

  // Pack hunter: circles the player, one wolf at a time lunges along a marked line.
  rime_wolf: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.2, 2.4); d.dir = w.rng.sign(); d.orb = null; go(e, 'flank'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          face(e, e.x + Math.cos(d.ang), e.y + Math.sin(d.ang));
          if (d.t >= a.windup) { go(e, 'lunge'); d.trav = 0; attackEvent(w, e, 'melee'); }
          break;
        case 'lunge': {
          e.anim = 'attack';
          const sp = a.lungeSpeed * speedScale(e);
          const f = moveDir(w, e, Math.cos(d.ang), Math.sin(d.ang), sp, dt);
          d.trav += f * sp * dt;
          if (d.trav >= d.len || f < 0.25 || d.t > 1) {
            go(e, 'recover');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.35);
            d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          }
          break;
        }
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.45) go(e, 'flank');
          break;
        default: {
          const dist = distTo(e, p);
          if (d.orb == null) d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          if (dist > a.orbit + 70 || !w.lineOfSight(e.x, e.y, p.x, p.y)) {
            chase(w, e, dt);
            d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          } else {
            d.orb += d.dir * 1.0 * dt;
            const f = steerTo(w, e, p.x + Math.cos(d.orb) * a.orbit, p.y + Math.sin(d.orb) * a.orbit, moveSpeed(e), dt);
            if (f < 0.2) d.dir = -d.dir;
            e.anim = 'walk';
          }
          face(e, p.x, p.y);
          if (d.cd <= 0 && dist < a.orbit + 55 && w.lineOfSight(e.x, e.y, p.x, p.y) && !packBusy(w, e)) {
            const ang = aimAt(e, p);
            const len = Math.min(a.lungeMax, dist + 30, rayLength(w, e.x, e.y, ang, a.lungeMax + 10, false) - e.r);
            if (len > 30) {
              d.ang = ang; d.len = len;
              go(e, 'windup');
              telegraph(w, e, 'melee');
              telegraphLine(w, e, e.x + Math.cos(ang) * (len + e.r), e.y + Math.sin(ang) * (len + e.r), { width: 12, delay: a.windup, color: '#b8cce0' });
            }
          }
        }
      }
    },
  },

  // Stops and aims (marked line, 0.8 s), then fires one fast ice shard along it.
  shard_archer: {
    init(w, e) { e.data.cd = w.rng.float(1.2, 2.0); go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (e.state === 'aim') {
        e.anim = 'attack';
        // the marked line follows the player for the first half of the aim, then locks (last `lock` s)
        if (d.t < a.aim - a.lock && d.line && !d.line.dead) {
          d.ang = aimAt(e, p, a.projSpeed, 0.35);
          const len = rayLength(w, e.x, e.y, d.ang, a.range, true);
          d.line.x2 = e.x + Math.cos(d.ang) * len;
          d.line.y2 = e.y + Math.sin(d.ang) * len;
        }
        face(e, e.x + Math.cos(d.ang), e.y + Math.sin(d.ang));
        if (d.t >= a.aim) {
          shoot(w, e, d.ang, {
            speed: a.projSpeed, damage: a.projDamage, type: 'frost', sprite: 'proj_shard', color: '#d9f6ff', r: 3,
            range: a.range + 20, pierce: 2, light: { r: 18, color: FROST }, trail: 'frost',
          });
          attackEvent(w, e, 'shoot');
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
          go(e, 'recover');
        }
        return;
      }
      if (e.state === 'recover') { e.anim = 'idle'; if (d.t >= 0.4) go(e, 'move'); return; }
      kite(w, e, dt, a.min, a.max);
      if (d.cd <= 0 && distTo(e, p) < a.max + 40 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
        const ang = aimAt(e, p, a.projSpeed, 0.35);
        const len = rayLength(w, e.x, e.y, ang, a.range, true);
        d.ang = ang;
        go(e, 'aim');
        telegraph(w, e, 'shoot');
        d.line = telegraphLine(w, e, e.x + Math.cos(ang) * len, e.y + Math.sin(ang) * len, { width: 5, delay: a.aim, color: '#d9f6ff' });
      }
    },
  },

  // Keeps its distance; casts a ring of ice spikes around the player followed by a centre spike.
  snow_caster: {
    init(w, e) { e.data.cd = w.rng.float(1.3, 2.0); go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (e.state === 'cast') {
        e.anim = 'cast';
        face(e, p.x, p.y);
        if (d.t >= a.windup) {
          const tx = p.x, ty = p.y, base = w.rng.angle();
          for (let i = 0; i < a.ring; i++) {
            const ang = base + (i / a.ring) * TAU;
            zone(w, e, {
              shape: 'circle', x: tx + Math.cos(ang) * a.ringR, y: ty + Math.sin(ang) * a.ringR, r: a.spikeR,
              delay: a.delay, duration: 0.25, damage: a.spikeDamage, type: 'frost', status: CHILL, color: FROST, data: { tag: 'spike' },
            });
          }
          zone(w, e, {
            shape: 'circle', x: tx, y: ty, r: a.spikeR + 4, delay: a.delay + 0.3, duration: 0.25,
            damage: a.spikeDamage, type: 'frost', status: CHILL, color: FROST, data: { tag: 'spike' },
          });
          attackEvent(w, e, 'cast');
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
          go(e, 'recover');
        }
        return;
      }
      if (e.state === 'recover') { e.anim = 'idle'; if (d.t >= 0.5) go(e, 'move'); return; }
      kite(w, e, dt, a.min, a.max);
      if (d.cd <= 0 && distTo(e, p) < a.max + 50 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
        go(e, 'cast');
        telegraph(w, e, 'cast', 'cast');
      }
    },
  },

  // Slow giant: telegraphed slam that releases a growing shockwave ring; hurls ice boulders at range.
  ice_golem: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.3, 2.0); d.cd2 = w.rng.float(2.0, 3.0); go(e, 'walk'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.cd2 > 0) d.cd2 -= dt;
      switch (e.state) {
        case 'slamWind':
          e.anim = 'attack';
          if (d.t >= a.slamWind) {
            zone(w, e, {
              shape: 'ring', x: e.x, y: e.y, r: e.r + 12, inner: e.r + 2, grow: a.waveGrow, delay: 0, duration: a.waveDur,
              damage: a.waveDamage, type: 'frost', status: CHILL, knockback: 120, color: '#a8e2ff',
            });
            w.fx.shake(4, 0.25);
            w.fx.burst('frost', e.x, e.y, { count: 20 });
            attackEvent(w, e, 'slam');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
            go(e, 'recover');
          }
          break;
        case 'throwWind':
          e.anim = 'attack';
          if (d.t >= 0.6) {
            shoot(w, e, aimAt(e, p, 80, 0.3), {
              speed: 80, damage: a.throwDamage, type: 'frost', sprite: 'proj_shard', color: '#bfeaff', r: 5, scale: 1.7,
              knockback: 120, light: { r: 18, color: FROST }, life: 3.5,
            });
            attackEvent(w, e, 'shoot');
            d.cd2 = a.throwCd * cdMul(e);
            go(e, 'recover');
          }
          break;
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.7) go(e, 'walk');
          break;
        default: {
          chase(w, e, dt);
          const dist = distTo(e, p);
          if (d.cd <= 0 && dist < a.slamRange) {
            go(e, 'slamWind');
            telegraph(w, e, 'slam');
            zone(w, e, {
              shape: 'circle', x: e.x, y: e.y, r: e.r + 24, delay: a.slamWind, duration: 0.12,
              damage: a.slamDamage, knockback: 170, type: 'frost', color: '#a8e2ff',
            });
          } else if (d.cd2 <= 0 && dist >= a.slamRange && dist < 230 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            go(e, 'throwWind');
            telegraph(w, e, 'shoot');
          }
        }
      }
    },
  },
};

function packBusy(w, e) {
  for (const o of w.enemies) {
    if (o === e || o.dead || o.id !== e.id) continue;
    if (o.state === 'windup' || o.state === 'lunge') return true;
  }
  return false;
}

/** glacier_slime death: splits into smaller slimes (def.aiParams.split / splitInto). */
export function glacierSlimeDeath(w, e) {
  const a = params(e);
  const n = a.split || 0;
  if (!n || spawnsBlocked(w)) return;
  w.fx.burst('frost', e.x, e.y, { count: 14 });
  for (let i = 0; i < n; i++) {
    const s = freeSpotNear(w, e.x, e.y, 5, false, 4, 12);
    w.spawnEnemy(a.splitInto || 'glacier_slime_small', s.x, s.y, { summoned: true, delay: 0.3 });
  }
}
