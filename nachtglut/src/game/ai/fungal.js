// Sporengrotten (floor 2) enemy behaviours.
import {
  params, cdMul, speedScale, moveSpeed, go, tick, distTo, face, aimAt, telegraph, attackEvent,
  shoot, fireFan, zone, telegraphCircle, ownedZones, moveDir, chase, chaseDir, kite, summon, spawnsBlocked,
} from './util.js';

const POISON = '#9be35a';

export const FUNGAL_AI = {
  // Drifting puffball: sways toward the player and puffs a small spore burst when close.
  spore_puff: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.0, 1.6); d.wob = w.rng.angle(); go(e, 'drift'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (e.state === 'puff') {
        e.anim = 'attack';
        if (d.t >= a.windup) { attackEvent(w, e, 'cast'); w.fx.burst('poison', e.x, e.y, { count: 12 }); go(e, 'recover'); d.cd = a.cooldown * cdMul(e); }
        return;
      }
      if (e.state === 'recover') { e.anim = 'idle'; if (d.t >= 0.5) go(e, 'drift'); return; }
      d.wob += dt * 2.6;
      const dir = chaseDir(w, e);
      if (dir.x || dir.y) {
        const s = Math.sin(d.wob) * 0.6;
        moveDir(w, e, dir.x - dir.y * s, dir.y + dir.x * s, moveSpeed(e), dt);
        e.anim = 'walk';
      } else e.anim = 'idle';
      if (d.cd <= 0 && distTo(e, p) < a.puffRange) {
        go(e, 'puff');
        telegraph(w, e, 'cast');
        zone(w, e, {
          shape: 'circle', x: e.x, y: e.y, r: a.puffR, delay: a.windup, duration: 0.15, damage: a.puffDamage,
          type: 'poison', color: POISON, status: { id: 'poison', duration: 2.5, power: 1.5 },
        });
      }
    },
  },

  // Tiny flock: boids-ish swirl around the player, individual gnats dart in after a short buzz.
  rot_swarm: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.0, 2.4); d.ph = w.rng.angle(); d.orb = null; d.dir = w.rng.sign(); go(e, 'swarm'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      d.ph += dt * 7;
      switch (e.state) {
        case 'windup':
          e.anim = 'attack';
          moveDir(w, e, Math.cos(d.ph * 3), Math.sin(d.ph * 3), 20, dt); // agitated buzz in place
          if (d.t >= a.windup) { d.ang = aimAt(e, p, a.dartSpeed, 0.6); go(e, 'dart'); attackEvent(w, e, 'melee'); }
          break;
        case 'dart': {
          e.anim = 'attack';
          const f = moveDir(w, e, Math.cos(d.ang), Math.sin(d.ang), a.dartSpeed * speedScale(e), dt);
          if (d.t >= a.dartTime || f < 0.25) {
            go(e, 'swarm');
            d.cd = a.cooldown * cdMul(e) * w.rng.float(0.8, 1.4);
            d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          }
          break;
        }
        default: {
          if (d.orb == null) d.orb = Math.atan2(e.y - p.y, e.x - p.x);
          let sx = 0, sy = 0, cx = 0, cy = 0, n = 0;
          for (const o of w.enemies) {
            if (o === e || o.dead || o.id !== e.id) continue;
            const dx = e.x - o.x, dy = e.y - o.y, d2 = dx * dx + dy * dy;
            if (d2 < 144 && d2 > 1e-4) { const dd = Math.sqrt(d2); sx += (dx / dd) * (12 - dd) / 12; sy += (dy / dd) * (12 - dd) / 12; }
            if (d2 < 3600) { cx += o.x; cy += o.y; n++; }
          }
          if (w.rng.chance(dt * 0.3)) d.dir = -d.dir;
          d.orb += d.dir * dt * 2.2;
          const R = a.orbit + Math.sin(d.ph * 0.5) * 10;
          let vx = p.x + Math.cos(d.orb) * R - e.x, vy = p.y + Math.sin(d.orb) * R - e.y;
          const l = Math.hypot(vx, vy) || 1;
          vx /= l; vy /= l;
          vx += sx * 1.6; vy += sy * 1.6;
          if (n) {
            const mx = cx / n - e.x, my = cy / n - e.y, ml = Math.hypot(mx, my);
            if (ml > 1) { vx += (mx / ml) * 0.25; vy += (my / ml) * 0.25; }
          }
          vx += Math.cos(d.ph * 1.3) * 0.45; vy += Math.sin(d.ph * 1.7) * 0.45;
          if (!w.lineOfSight(e.x, e.y, p.x, p.y)) { const f = w.flowDir(e.x, e.y); vx = f.x || vx; vy = f.y || vy; }
          const f = moveDir(w, e, vx, vy, moveSpeed(e), dt);
          if (f < 0.2) d.dir = -d.dir;
          e.anim = 'walk';
          if (d.cd <= 0 && distTo(e, p) < a.orbit + 30) { go(e, 'windup'); telegraph(w, e, 'melee'); }
        }
      }
    },
  },

  // Lobs spore capsules (arc) at the player; each lands after 0.9 s (marked) and leaves a poison puddle.
  myco_shooter: {
    init(w, e) { e.data.cd = w.rng.float(1.1, 1.8); go(e, 'move'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (e.state === 'windup') {
        e.anim = 'attack';
        face(e, p.x, p.y);
        if (d.t >= a.windup) {
          let tx = p.x + (p.vx || 0) * a.flight * 0.3, ty = p.y + (p.vy || 0) * a.flight * 0.3;
          if (w.isSolidPx(tx, ty, true)) { tx = p.x; ty = p.y; }
          const ang = Math.atan2(ty - e.y, tx - e.x);
          shoot(w, e, ang, {
            arc: { tx, ty, time: a.flight, height: 36 }, damage: 0, sprite: 'proj_spore', color: POISON, trail: 'poison',
            light: { r: 14, color: POISON }, cap: 8,
          });
          zone(w, e, {
            shape: 'circle', x: tx, y: ty, r: a.puddleR, delay: a.flight, duration: a.puddleDur, tick: 0.5,
            damage: a.puddleDamage, type: 'poison', color: POISON, persist: true, data: { tag: 'puddle' },
          });
          attackEvent(w, e, 'shoot');
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
          go(e, 'recover');
        }
        return;
      }
      if (e.state === 'recover') { e.anim = 'idle'; face(e, p.x, p.y); if (d.t >= 0.4) go(e, 'move'); return; }
      kite(w, e, dt, a.min, a.max);
      if (d.cd <= 0 && distTo(e, p) < a.max + 50 && w.lineOfSight(e.x, e.y, p.x, p.y) && ownedZones(w, e, 'puddle') < 3) {
        go(e, 'windup');
        telegraph(w, e, 'shoot');
      }
    },
  },

  // Rooted: whips a cone (0.55 s telegraph) at close range, spits a slow thorn fan at mid range.
  vine_lasher: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(0.9, 1.4); d.cd2 = w.rng.float(1.5, 2.4); go(e, 'idle'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.cd2 > 0) d.cd2 -= dt;
      const dist = distTo(e, p);
      switch (e.state) {
        case 'whip':
          e.anim = 'attack';
          if (d.t >= a.windup) { attackEvent(w, e, 'melee'); go(e, 'recover'); d.cd = a.cooldown * cdMul(e); }
          break;
        case 'spit':
          e.anim = 'attack';
          if (d.t >= 0.45) {
            fireFan(w, e, 3, aimAt(e, p, 85, 0.3), 0.5, { speed: 85, damage: a.thornDamage, sprite: 'proj_needle', color: '#c9f06a', light: { r: 12, color: '#9be35a' } });
            attackEvent(w, e, 'shoot');
            go(e, 'recover');
          }
          break;
        case 'recover':
          e.anim = 'idle';
          if (d.t >= 0.45) go(e, 'idle');
          break;
        default:
          e.anim = 'idle';
          face(e, p.x, p.y);
          if (d.cd <= 0 && dist < a.reach) {
            const ang = aimAt(e, p);
            go(e, 'whip');
            telegraph(w, e, 'melee');
            zone(w, e, {
              shape: 'cone', x: e.x, y: e.y, r: a.reach + 6, angle: ang, arc: a.arc, delay: a.windup, duration: 0.12,
              damage: a.damage, knockback: 150, color: '#5a964a',
            });
          } else if (d.cd2 <= 0 && dist >= a.reach && dist < a.thornRange && w.lineOfSight(e.x, e.y, p.x, p.y)) {
            d.cd2 = a.thornCd * cdMul(e);
            go(e, 'spit');
            telegraph(w, e, 'shoot');
          }
      }
    },
  },

  // Stationary nest: pulses (0.7 s) and releases rot_swarm (cap 6 alive); shoves the player away when touched.
  brood_pod: {
    init(w, e) { const d = e.data; d.cd = w.rng.float(1.2, 2.0); d.pcd = 1.0; d.kids = []; go(e, 'idle'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      if (d.pcd > 0) d.pcd -= dt;
      d.kids = d.kids.filter((k) => !k.dead);
      if (e.state === 'brood') {
        e.anim = 'cast';
        if (d.t >= a.windup) {
          const n = Math.min(a.cap - d.kids.length, w.rng.int(a.batch[0], a.batch[1]));
          if (n > 0 && !spawnsBlocked(w)) {
            d.kids.push(...summon(w, e, 'rot_swarm', n, { flying: true, spots: d.spots }));
            w.fx.burst('poison', e.x, e.y, { count: 16 });
            attackEvent(w, e, 'summon');
          }
          d.cd = a.cooldown * cdMul(e) * w.rng.float(0.9, 1.2);
          go(e, 'idle');
        }
        return;
      }
      if (e.state === 'pulse') {
        e.anim = 'attack';
        if (d.t >= 0.5) { attackEvent(w, e, 'slam'); go(e, 'idle'); }
        return;
      }
      e.anim = 'idle';
      const dist = distTo(e, p);
      if (d.pcd <= 0 && dist < e.r + 26) {
        d.pcd = 2.5;
        go(e, 'pulse');
        telegraph(w, e, 'slam');
        zone(w, e, { shape: 'circle', x: e.x, y: e.y, r: e.r + 26, delay: 0.5, duration: 0.12, damage: a.pulseDamage, knockback: 220, type: 'poison', color: POISON });
      } else if (d.cd <= 0 && d.kids.length < a.cap && dist < 280) {
        d.spots = [];
        for (let i = 0; i < 3; i++) {
          const ang = w.rng.angle(), r = e.r + 10;
          const x = e.x + Math.cos(ang) * r, y = e.y + Math.sin(ang) * r;
          d.spots.push(w.canStand(x, y, 4, true) ? { x, y } : { x: e.x, y: e.y });
        }
        go(e, 'brood');
        telegraph(w, e, 'summon', 'cast');
      }
    },
  },

  // Burrows (hidden, untargetable), tunnels to the player and erupts with a telegraphed bite (0.65 s).
  mire_stalker: {
    init(w, e) { e.data.surf = w.rng.float(0.9, 1.4); go(e, 'surface'); },
    update(w, e, dt) {
      const d = tick(e, dt), a = params(e), p = w.player;
      switch (e.state) {
        case 'dive':
          e.anim = 'special';
          if (d.t >= 0.4) {
            setBurrowed(e, true);
            w.fx.burst('dust', e.x, e.y, { count: 10, color: '#4a5e52' });
            go(e, 'tunnel');
          }
          break;
        case 'tunnel': {
          e.anim = 'walk';
          const dir = w.flowDir(e.x, e.y);
          if (dir.x || dir.y) moveDir(w, e, dir.x, dir.y, a.tunnelSpeed * speedScale(e), dt);
          d.dust = (d.dust || 0) - dt;
          if (d.dust <= 0) { d.dust = 0.12; w.fx.burst('dust', e.x, e.y, { count: 2, color: '#4a5e52' }); }
          const dist = distTo(e, p);
          if (dist < 10 || d.t >= a.maxTunnel || (!dir.x && !dir.y && d.t > 1)) {
            go(e, 'emerge');
            telegraph(w, e, 'melee', 'special');
            zone(w, e, {
              shape: 'circle', x: e.x, y: e.y, r: a.biteR, delay: a.emerge, duration: 0.12,
              damage: a.biteDamage, knockback: 160, color: '#5a964a',
            });
          }
          break;
        }
        case 'emerge':
          e.anim = 'special';
          if (d.t >= a.emerge) {
            setBurrowed(e, false);
            w.fx.burst('dust', e.x, e.y, { count: 16, color: '#4a5e52' });
            w.fx.shake(1.5, 0.12);
            attackEvent(w, e, 'melee');
            d.surf = a.surface;
            go(e, 'surface');
            e.anim = 'attack';
          }
          break;
        default:
          if (d.t < 0.35 && d.surf === a.surface) { e.anim = 'attack'; break; }
          chase(w, e, dt, 0.7);
          if (d.t >= d.surf) go(e, 'dive');
      }
    },
  },
};

function setBurrowed(e, on) {
  e.hidden = on;
  e.untargetable = on || !!e.def.untargetable;
}

/** spore_puff death: lingering poison cloud. */
export function sporePuffDeath(w, e) {
  const a = params(e);
  zone(w, e, {
    shape: 'circle', x: e.x, y: e.y, r: a.cloudR, delay: 0.5, duration: a.cloudDur, tick: 0.5,
    damage: a.cloudDamage, type: 'poison', color: POISON, persist: true,
  });
  w.fx.burst('poison', e.x, e.y, { count: 20 });
}
