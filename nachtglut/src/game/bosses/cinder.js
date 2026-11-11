// boss_cinder — Schlackenkönig, Herr der Aschegruben (floor 1).
// A molten golem king. Phase 1: charge, ground slam (ring shockwave), magma rain, fireball fans, ash crawlers.
// Phase 2 (50 %): the crown ignites — faster, fire trail, double charge, double ring, crown flame spiral.
import { TAU, clamp } from '../../core/math.js';
import {
  makeBossAI, during, teleTime, telegraph, attackEvent, facePlayer, angleToPlayer, distToPlayer,
  zCircle, zLine, zRing, shot, fanShots, summon, liveMinions, phaseGate, keepInArena,
} from './common.js';

const COL = { body: '#ff6a1f', fire: '#ff8a3c', hot: '#ffb347', crown: '#ffd35a', warn: '#ff5a3c', ash: '#8a6a58' };

const burn = (e, power = 4) => ({ id: 'burn', duration: 2, power: power * (e.dmgMul ?? 1) });

/** Lingering burning ground: status-only (burn DoT), so it never hands out i-frames. */
function burningGround(w, e, B, x, y, o = {}) {
  return zCircle(w, e, x, y, o.r ?? 12, {
    delay: o.delay ?? 0.25, duration: o.duration ?? (B.phase >= 2 ? 4.5 : 3), tick: 0.5, damage: 0,
    type: 'fire', status: burn(e), color: COL.fire, data: { hazard: true },
  });
}

function* charge(w, e, B) {
  const times = B.phase >= 2 ? 2 : 1;
  for (let k = 0; k < times; k++) {
    const p = w.player;
    facePlayer(w, e);
    e.anim = 'attack';
    const ang = angleToPlayer(w, e);
    const len = clamp(distToPlayer(w, e) + 70, 110, 300);
    const end = w.clampToRoom(e.x + Math.cos(ang) * len, e.y + Math.sin(ang) * len, e.r * 0.8);
    const d = teleTime(B, k === 0 ? 0.9 : 0.7);
    zLine(w, e, e.x, e.y, end.x, end.y, e.r * 2 + 4, { delay: d, duration: 0.05, damage: 0, color: COL.warn });
    telegraph(e, 'charge');
    w.fx.burst('ember', e.x, e.y, { count: 10, color: COL.fire });
    yield d;
    attackEvent(e, 'charge');
    w.fx.shake(2.5, 0.25);
    const sp = 270 * (B.phase >= 2 ? 1.15 : 1);
    const total = Math.hypot(end.x - e.x, end.y - e.y);
    const cx = Math.cos(ang), cy = Math.sin(ang);
    let travelled = 0, trail = 0, wall = false;
    e.damage = B.baseDamage * 1.4;
    try {
      yield* during(total / sp + 0.2, (dt) => {
        const step = Math.min(sp * dt, total - travelled);
        w.moveEntity(e, cx * step, cy * step);
        travelled += step;
        trail -= step;
        if (trail <= 0) { trail = 20; burningGround(w, e, B, e.x, e.y, { r: 13, delay: 0.3 }); }
        const pushed = keepInArena(w, e);
        if ((e.blockedX || e.blockedY || pushed) && travelled < total - 4) { wall = true; return true; }
        return travelled >= total - 0.5;
      });
    } finally {
      e.damage = B.baseDamage;
    }
    if (wall) {
      // slammed into the wall: stagger window + falling debris around him
      w.fx.shake(6, 0.35);
      w.fx.burst('dust', e.x, e.y, { count: 24 });
      e.anim = 'hurt';
      for (let i = 0; i < 4; i++) {
        const a = w.rng.angle(), r = w.rng.float(30, 70);
        const c = w.clampToRoom(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, 10);
        zCircle(w, e, c.x, c.y, 14, { delay: teleTime(B, 0.8) + i * 0.08, duration: 0.12, damage: 7, type: 'phys', color: COL.ash });
      }
      yield 1.0;
      return;
    }
    e.anim = 'idle';
    yield 0.35;
  }
}

function* slam(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'slam');
  const d = teleTime(B, 0.85);
  const r0 = 44;
  zCircle(w, e, e.x, e.y, r0, { delay: d, duration: 0.12, damage: 13, knockback: 220, type: 'phys', color: COL.warn });
  const rings = B.phase >= 2 ? 2 : 1;
  for (let i = 0; i < rings; i++) {
    zRing(w, e, e.x, e.y, r0, r0 - 12, {
      delay: d + i * 0.5, duration: 1.7, grow: 115, damage: 10, type: 'fire', status: burn(e, 2), color: COL.fire,
    });
  }
  yield d;
  e.anim = 'attack';
  attackEvent(e, 'slam');
  w.fx.shake(7, 0.35);
  w.fx.burst('dust', e.x, e.y, { count: 30 });
  w.fx.light(e.x, e.y, 160, COL.fire, 0.4);
  yield 0.5 + (rings - 1) * 0.5;
}

function* magmaRain(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  yield 0.35;
  attackEvent(e, 'cast');
  const waves = 3, per = B.phase >= 2 ? 4 : 3;
  for (let v = 0; v < waves; v++) {
    const p = w.player;
    for (let i = 0; i < per; i++) {
      let tx = p.x, ty = p.y;
      if (i > 0) {
        const a = w.rng.angle(), r = w.rng.float(28, 80);
        tx += Math.cos(a) * r; ty += Math.sin(a) * r;
      }
      const c = w.clampToRoom(tx, ty, 10);
      const d = teleTime(B, 0.95) + i * 0.08;
      zCircle(w, e, c.x, c.y, 18, {
        delay: d, duration: 0.15, damage: 9, type: 'fire', status: burn(e, 3), color: COL.warn,
        onStart(w2, z) {
          w2.fx.burst('explosion', z.x, z.y, { color: COL.fire, count: 10 });
          if (B.phase >= 2) burningGround(w2, e, B, z.x, z.y, { r: 14, delay: 0.05, duration: 2.5 });
        },
      });
      // the visible lump of magma flying over (harmless; the zone deals the damage)
      shot(w, e, e.x, e.y - e.r * 0.7, 0, 0, {
        arc: { tx: c.x, ty: c.y, time: d, height: 70 }, damage: 0, sprite: 'proj_blob', color: COL.fire, scale: 1.4,
        trail: 'ember', light: { r: 22, color: COL.fire },
      });
    }
    yield 0.4;
  }
  yield 0.6;
}

function* fireFan(w, e, B) {
  e.anim = 'attack';
  facePlayer(w, e);
  telegraph(e, 'shoot');
  yield teleTime(B, 0.5);
  const volleys = B.phase >= 2 ? 4 : 3;
  for (let v = 0; v < volleys; v++) {
    facePlayer(w, e);
    const n = v % 2 ? 6 : 5;
    fanShots(w, e, e.x, e.y, angleToPlayer(w, e), n, 0.95, B.phase >= 2 ? 118 : 104, {
      r: 4, damage: 8, type: 'fire', sprite: 'proj_orb', color: COL.hot, trail: v === 0 ? 'ember' : null,
    });
    attackEvent(e, 'shoot');
    yield 0.45;
  }
  yield 0.2;
}

function* ashCall(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'summon');
  w.fx.burst('smoke', e.x, e.y, { count: 20, color: COL.ash });
  summon(w, e, 'ash_crawler', B.phase >= 2 ? 3 : 2, { cap: 4, color: COL.ash });
  yield 0.9;
}

function* crownFlame(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'cast');
  const d = teleTime(B, 0.7);
  zCircle(w, e, e.x, e.y, e.r + 14, { delay: d, duration: 0.1, damage: 8, type: 'fire', color: COL.crown });
  yield d;
  attackEvent(e, 'shoot');
  w.fx.flash(COL.crown, 0.12);
  let a = w.rng.angle(), acc = 0;
  const dir = w.rng.sign();
  yield* during(2.2, (dt) => {
    a += dir * 1.5 * dt;
    acc += dt;
    while (acc >= 0.13) {
      acc -= 0.13;
      for (let k = 0; k < 3; k++) {
        shot(w, e, e.x, e.y, a + (k * TAU) / 3, 82, { r: 3.5, damage: 7, type: 'fire', color: COL.crown });
      }
    }
  });
  yield 0.3;
}

export const CINDER_AI = makeBossAI({
  phases: [0.5],
  phaseStats: [{ tele: 1, speed: 1, recover: 1.3 }, { tele: 0.85, speed: 1.35, recover: 0.9 }],
  introAnim: 'special',
  phaseColor: COL.crown,
  init(w, e, B) { B.trailT = 0; B.lastX = e.x; B.lastY = e.y; },
  move(w, e, B, dt) {
    facePlayer(w, e);
    if (distToPlayer(w, e) > e.r + 20) {
      const f = w.flowDir(e.x, e.y);
      const sp = e.speed * e.slowMul * B.spdMul;
      w.moveEntity(e, f.x * sp * dt, f.y * sp * dt);
      e.anim = 'walk';
    } else e.anim = 'idle';
    keepInArena(w, e);
  },
  onPhase(w, e) {
    w.fx.burst('ember', e.x, e.y - e.r, { count: 40, color: COL.crown });
    e.light = { r: 120, color: COL.crown };
  },
  post(w, e, B, dt) {
    // phase 2: the burning crown leaves a fire trail
    if (B.phase < 2 || B.mode === 'transition' || e.dead) return;
    B.trailT -= dt;
    if (B.trailT > 0) return;
    if (Math.hypot(e.x - B.lastX, e.y - B.lastY) < 10) return;
    B.trailT = 0.35;
    B.lastX = e.x; B.lastY = e.y;
    burningGround(w, e, B, e.x, e.y, { r: 12, delay: 0.3, duration: 2.6 });
  },
  attacks: {
    charge: { weight: 3, run: charge, recover: 0.9 },
    slam: { weight: 3, run: slam },
    magmaRain: { weight: 2.5, run: magmaRain },
    fireFan: { weight: 2.5, run: fireFan },
    ashCall: { weight: 1.3, run: ashCall, cond: (w, e, B) => liveMinions(B) < 3 },
    crownFlame: { phases: [2], weight: 2.2, run: crownFlame },
  },
});

export const CINDER_DEFS = {
  boss_cinder: {
    id: 'boss_cinder', name: 'Schlackenkönig', title: 'Herr der Aschegruben',
    desc: 'Ein König aus erstarrter Schlacke. Er stürmt, stampft Schockwellen in den Boden und lässt Magma regnen – und wenn seine Krone entflammt, brennt die Grube.',
    biome: 'ash', boss: true, hp: 1400, speed: 34, damage: 14, r: 18, mass: 0, xp: 60, sparks: [20, 30],
    sprite: 'boss_cinder', color: COL.body, light: { r: 90, color: '#ff7a2f' }, shadow: true, contactType: 'fire',
    ai: 'boss_cinder', aiParams: {},
    hooks: { onHit: phaseGate },
  },
};
