// boss_sun — Die Erloschene Sonne (floor 5, final boss). A dead sun disc in the arena centre.
// Phase 1 (dark): orbiting `boss_sun_core` satellites shield it (−70 % damage while any core lives),
//   slow rotating cinder spirals, gravity well, splitting embers; cores re-form after a while.
// Phase 2 (60 %): the cracks glow — sweeping beams (rotating line zones, long telegraph), corona rings with gaps.
// Phase 3 (25 %): it reignites (anim 'special', golden) — flower bullet patterns with safe lanes, solar flares at
//   the player and a ring of fire at the arena edge that slowly shrinks, then resets.
// Its death ends the run in victory (handled by the core via w.bossDefeated).
import { TAU, angleTo } from '../../core/math.js';
import {
  makeBossAI, during, teleTime, telegraph, attackEvent, facePlayer, angleToPlayer, arena, rayLen, findStand,
  zCircle, zLine, zCone, zRing, shot, ringShots, fanShots, phaseGate, removePart, removeParts,
} from './common.js';

const COL = {
  dark: '#3a2a1a', ember: '#ff8a3c', cinder: '#ff6a1f', gold: '#ffd35a', light: '#fff3b0', core: '#ffb347',
  well: '#6a4aa8', flare: '#ffe27a',
};
const CORE_R = 74;
const SHIELD = 0.3; // damage taken while a core lives

const burn = (e, power = 5) => ({ id: 'burn', duration: 2, power: power * (e.dmgMul ?? 1) });
const ember = (o = {}) => ({ r: 3.5, damage: 11, type: 'fire', sprite: 'proj_orb', color: COL.ember, ...o });
const star = (o = {}) => ({ r: 3.5, damage: 12, type: 'light', sprite: 'proj_star', color: COL.gold, light: { r: 14, color: COL.gold }, ...o });

function liveCores(B) {
  B.cores = (B.cores || []).filter((c) => !c.dead);
  return B.cores.length;
}

/** Telegraphed core formation in orbit slots. */
function formCores(w, e, B, n, delay = 0.9) {
  const base = B.coreAng || 0;
  for (let i = 0; i < n; i++) {
    const a = base + (i / n) * TAU;
    const x = e.x + Math.cos(a) * CORE_R, y = e.y + Math.sin(a) * CORE_R;
    zCircle(w, e, x, y, 12, {
      delay, duration: 0.05, damage: 0, color: COL.core, data: { summonFor: e },
      onStart(w2, z) {
        if (e.dead || B.phase >= 3) return;
        const c = w2.spawnEnemy('boss_sun_core', z.x, z.y, { summoned: true, noXp: true, delay: 0.3 });
        c.data.owner = e;
        c.data.slot = i;
        c.data.count = n;
        c.data.shootT = 2.2 + i * 0.8;
        B.cores.push(c);
        w2.fx.burst('light', z.x, z.y, { count: 12, color: COL.core });
      },
    });
  }
  B.coreDownT = 0;
}

// ---------------------------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------------------------
function* cinderSpiral(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  yield teleTime(B, 0.6);
  attackEvent(e, 'shoot');
  const arms = [4, 5, 6][B.phase - 1];
  const spin = [0.55, 0.7, 0.8][B.phase - 1];
  const dir = w.rng.sign();
  let a = w.rng.angle(), acc = 0, flip = 0;
  yield* during(3.6, (dt) => {
    a += spin * dir * dt;
    acc += dt;
    while (acc >= 0.17) {
      acc -= 0.17;
      flip ^= 1;
      for (let k = 0; k < arms; k++) shot(w, e, e.x, e.y, a + (k * TAU) / arms, 66, ember({ color: flip ? COL.ember : COL.cinder }));
    }
  });
  yield 0.3;
}

function* gravityWell(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  const d = teleTime(B, 1.0);
  const dur = 3.4;
  const pull = B.phase >= 2 ? 50 : 42;
  zCircle(w, e, e.x, e.y, 200, {
    delay: d, duration: dur, damage: 0, color: COL.well, data: { pull: true },
    onTick(w2, z, dt) {
      const p = w2.player;
      if (!p.alive || p.dashing) return;
      const dx = z.x - p.x, dy = z.y - p.y, l = Math.hypot(dx, dy);
      if (l < 1 || l > z.r) return;
      w2.moveEntity(p, (dx / l) * pull * dt, (dy / l) * pull * dt);
    },
  });
  zCircle(w, e, e.x, e.y, e.r + 22, { delay: d, duration: dur, tick: 0.5, damage: 16, type: 'fire', status: burn(e), color: COL.cinder });
  yield d;
  attackEvent(e, 'cast');
  w.fx.shake(2.5, dur);
  for (let k = 0; k < 3; k++) {
    ringShots(w, e, e.x, e.y, 18, 58, w.rng.angle(), ember({ gap: { at: angleToPlayer(w, e) + w.rng.float(-0.6, 0.6), size: 0.95 } }));
    attackEvent(e, 'shoot');
    yield 1.05;
  }
  yield 0.2;
}

function* emberBloom(w, e, B) {
  e.anim = 'attack';
  facePlayer(w, e);
  telegraph(e, 'shoot');
  yield teleTime(B, 0.55);
  const n = B.phase >= 2 ? 3 : 2;
  const base = angleToPlayer(w, e);
  for (let k = 0; k < n; k++) {
    const a = base + (k - (n - 1) / 2) * 0.5;
    shot(w, e, e.x, e.y, a, 85, ember({
      r: 7, scale: 2.2, damage: 16, life: 1.5, trail: 'ember', light: { r: 40, color: COL.ember },
      onExpire: (w2, pr) => ringShots(w2, e, pr.x, pr.y, 10, 76, w2.rng.angle(), ember({ damage: 10 })),
    }));
  }
  attackEvent(e, 'shoot');
  yield 1.7;
}

function* coreForge(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'summon');
  w.fx.burst('light', e.x, e.y, { count: 30, color: COL.core });
  formCores(w, e, B, B.phase >= 2 ? 3 : 2, teleTime(B, 1.0));
  attackEvent(e, 'summon');
  yield 1.2;
}

function* beams(w, e, B) {
  const n = B.phase >= 3 ? 3 : 2;
  const dir = w.rng.sign();
  const a0 = angleToPlayer(w, e) - dir * 0.9;
  const d = teleTime(B, 1.1);
  const spin = (B.phase >= 3 ? 0.8 : 0.7) * dir;
  const dur = 3.4;
  e.anim = 'cast';
  telegraph(e, 'beam');
  for (let k = 0; k < n; k++) {
    const ang0 = a0 + (k * TAU) / n;
    const L0 = rayLen(w, e.x, e.y, ang0);
    zLine(w, e, e.x, e.y, e.x + Math.cos(ang0) * L0, e.y + Math.sin(ang0) * L0, 14, {
      delay: d, duration: dur, tick: 0.35, damage: 15, type: 'light', color: COL.light, data: { ang: ang0, beam: true },
      onTick(w2, z, dt) {
        z.data.ang += spin * dt;
        const L = rayLen(w2, z.x, z.y, z.data.ang);
        z.x2 = z.x + Math.cos(z.data.ang) * L; z.y2 = z.y + Math.sin(z.data.ang) * L;
        z._lx = z.x2 - z.x; z._ly = z.y2 - z.y;
      },
    });
    // direction hint: the sector the beam sweeps first
    zCone(w, e, e.x, e.y, Math.min(140, L0), ang0 + Math.sign(spin) * 0.3, 0.6, { delay: d, duration: 0.01, damage: 0, color: COL.light });
  }
  yield d;
  attackEvent(e, 'beam');
  w.fx.shake(2, dur);
  w.fx.flash(COL.light, 0.1);
  yield dur + 0.2;
}

function* corona(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  yield teleTime(B, 0.6);
  const rings = B.phase >= 3 ? 4 : 3;
  const speed = B.phase >= 3 ? 82 : 70;
  let gap = angleToPlayer(w, e);
  for (let k = 0; k < rings; k++) {
    ringShots(w, e, e.x, e.y, 30, speed, k * 0.1, star({ gap: { at: gap, size: 0.95 } }));
    attackEvent(e, 'shoot');
    w.fx.ring(e.x, e.y, e.r + 10, COL.gold, 0.3);
    gap += w.rng.sign() * w.rng.float(0.35, 0.6);
    yield 0.75;
  }
  yield 0.3;
}

function* flower(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'cast');
  yield teleTime(B, 0.55);
  const petals = 7, bursts = 5;
  const dir = w.rng.sign();
  let base = w.rng.angle();
  for (let b = 0; b < bursts; b++) {
    for (let k = 0; k < petals; k++) {
      const pa = base + (k * TAU) / petals;
      for (let j = -2; j <= 2; j++) shot(w, e, e.x, e.y, pa + j * 0.07, 75 + (2 - Math.abs(j)) * 14, star({ color: COL.flare }));
    }
    attackEvent(e, 'shoot');
    base += dir * 0.3;
    yield 0.6;
  }
  yield 0.3;
}

function* flares(w, e, B) {
  e.anim = 'special';
  for (let k = 0; k < 3; k++) {
    const p = w.player;
    const ang = angleTo(e.x, e.y, p.x, p.y);
    const L = rayLen(w, e.x, e.y, ang);
    const d = teleTime(B, 0.85);
    telegraph(e, 'beam');
    zLine(w, e, e.x, e.y, e.x + Math.cos(ang) * L, e.y + Math.sin(ang) * L, 22, { delay: d, duration: 0.2, damage: 22, type: 'light', color: COL.flare });
    zCircle(w, e, p.x, p.y, 28, {
      delay: d, duration: 0.2, damage: 22, type: 'fire', status: burn(e), color: COL.ember,
      onStart(w2, z) { w2.fx.burst('explosion', z.x, z.y, { color: COL.flare, count: 14 }); attackEvent(e, 'beam'); },
    });
    yield 0.5;
  }
  yield 0.5;
}

/** Phase 3 passive: a ring of fire hugging the arena edge that shrinks slowly, then resets. */
function fireRing(w, e, B) {
  const A = arena(w);
  const near = Math.min(e.x - A.x0, A.x1 - e.x, e.y - A.y0, A.y1 - e.y);
  const inner0 = Math.max(120, near + 10);
  const minInner = 105;
  zRing(w, e, e.x, e.y, 520, inner0, {
    delay: teleTime(B, 1.1), duration: 9, tick: 0.5, damage: 10, type: 'fire', status: burn(e), color: COL.cinder,
    data: { fireRing: true },
    onTick(w2, z, dt) { z.inner = Math.max(minInner, z.inner - 7 * dt); },
  });
}

// ---------------------------------------------------------------------------------------------
export const SUN_AI = makeBossAI({
  phases: [0.6, 0.25],
  phaseStats: [
    { tele: 1, speed: 1, recover: 1.25 },
    { tele: 0.9, speed: 1, recover: 1.0 },
    { tele: 0.8, speed: 1, recover: 0.8 },
  ],
  introAnim: 'cast',
  phaseColor: COL.gold,
  init(w, e, B) {
    B.cores = []; B.coreAng = 0; B.coreDownT = 0; B.linkT = 0; B.ringT = 2;
  },
  start(w, e, B) {
    const A = arena(w);
    const c = findStand(w, A.cx, A.cy, 8, true);
    e.x = c.x; e.y = c.y;
    formCores(w, e, B, 4, 1.2);
    e.light = { r: 90, color: COL.cinder };
  },
  move(w, e, B) {
    facePlayer(w, e);
    e.anim = B.phase >= 3 ? 'special' : 'idle';
  },
  onPhase(w, e, B, phase) {
    if (phase === 2) {
      e.light = { r: 130, color: COL.ember };
      w.fx.burst('ember', e.x, e.y, { count: 40, color: COL.ember });
    } else if (phase === 3) {
      // reignition: burns away every remaining core
      for (const c of B.cores) removePart(w, c);
      B.cores = [];
      e.light = { r: 190, color: COL.gold };
      w.fx.flash(COL.light, 0.6);
      w.fx.shake(9, 1.2);
      w.fx.burst('light', e.x, e.y, { count: 80, color: COL.gold, speed: 220 });
      B.ringT = 2.5;
    }
  },
  transitionTime: 1.2,
  transition(w, e, B) { if (B.phase >= 3) e.anim = 'special'; },
  post(w, e, B, dt) {
    // orbiting cores
    const n = liveCores(B);
    B.coreAng += dt * (B.phase >= 2 ? 0.85 : 0.65);
    for (const c of B.cores) {
      if (c.frozen || c.stunned) continue;
      const a = B.coreAng + (c.data.slot * TAU) / c.data.count;
      const tx = e.x + Math.cos(a) * CORE_R, ty = e.y + Math.sin(a) * CORE_R;
      const k = Math.min(1, dt * 8);
      c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    }
    if (n) {
      B.linkT -= dt;
      if (B.linkT <= 0) { B.linkT = 0.3; for (const c of B.cores) w.fx.beam(c.x, c.y, e.x, e.y, COL.core, 1, 0.32); }
    } else if (B.mode !== 'intro') B.coreDownT += dt;
    // phase 3: shrinking ring of fire
    if (B.phase >= 3 && B.mode !== 'transition') {
      const alive = w.zones.some((z) => !z.dead && z.data && z.data.fireRing);
      if (!alive) {
        B.ringT -= dt;
        if (B.ringT <= 0) { B.ringT = 2.5; fireRing(w, e, B); }
      }
    }
  },
  attacks: {
    cinderSpiral: { weight: (w, e, B) => (B.phase >= 3 ? 1.5 : B.phase === 2 ? 2 : 3), run: cinderSpiral },
    gravityWell: { phases: [1, 2], weight: (w, e, B) => (B.phase === 2 ? 1.5 : 2.2), run: gravityWell },
    emberBloom: { phases: [1, 2], weight: (w, e, B) => (B.phase === 2 ? 1.5 : 2.5), run: emberBloom },
    coreForge: {
      phases: [1, 2], weight: 5, run: coreForge,
      cond: (w, e, B) => liveCores(B) === 0 && B.coreDownT > (B.phase === 1 ? 9 : 14) && !w.zones.some((z) => !z.dead && z.data && z.data.summonFor === e),
    },
    beams: { phases: [2, 3], weight: (w, e, B) => (B.phase === 2 ? 3 : 2.5), run: beams },
    corona: { phases: [2, 3], weight: (w, e, B) => (B.phase === 2 ? 3 : 2), run: corona },
    flower: { phases: [3], weight: 3, run: flower },
    flares: { phases: [3], weight: 2.5, run: flares },
  },
});

export const SUN_CORE_AI = {
  update(w, c, dt) {
    const sun = c.data.owner;
    if (!sun || sun.dead) { removePart(w, c); return; }
    const SB = sun.data;
    if (SB.mode !== 'idle' && SB.mode !== 'attack') return;
    c.data.shootT = (c.data.shootT ?? 2.5) - dt;
    if (c.data.shootT <= 0.45 && !c.data.wind) { c.data.wind = true; c.anim = 'attack'; telegraph(c, 'shoot'); }
    if (c.data.shootT <= 0) {
      c.data.shootT = 3.4;
      c.data.wind = false;
      c.anim = 'idle';
      const p = w.player;
      fanShots(w, c, c.x, c.y, angleTo(c.x, c.y, p.x, p.y), 1, 0, 80, ember({ damage: 10, color: COL.core }));
      attackEvent(c, 'shoot');
    }
  },
};

function sunOnHit(w, e, hit) {
  const B = e.data;
  if (B && B.cores && B.cores.some((c) => !c.dead)) {
    hit.amount *= SHIELD;
    if (w.rng.chance(0.25)) w.fx.burst('light', e.x, e.y, { count: 3, color: COL.core });
  }
  phaseGate(w, e, hit);
}

export const SUN_DEFS = {
  boss_sun: {
    id: 'boss_sun', name: 'Die Erloschene Sonne', title: 'Das kalte Herz der Welt',
    desc: 'Was vom Sonnenherz übrig blieb: eine tote Scheibe, umkreist von glühenden Kernen. Doch tief in ihr glimmt noch Glut – und sie will nicht verlöschen.',
    biome: 'core', boss: true, hp: 4200, speed: 0, damage: 24, r: 24, mass: 0, flying: true, xp: 0, sparks: [0, 0],
    sprite: 'boss_sun', color: COL.gold, light: { r: 110, color: COL.ember }, shadow: false, contactType: 'fire',
    ai: 'boss_sun', aiParams: {},
    hooks: {
      onHit: sunOnHit,
      onDeath(w, e) { removeParts(w, e); },
    },
  },
  boss_sun_core: {
    id: 'boss_sun_core', name: 'Sonnenkern', desc: 'Ein glühender Splitter, der die Erloschene Sonne abschirmt. Zerstöre die Kerne!',
    biome: 'core', boss: false, hp: 170, speed: 0, damage: 12, r: 8, mass: 0, flying: true, xp: 0, sparks: [0, 0],
    sprite: 'boss_sun_core', color: COL.core, light: { r: 34, color: COL.core }, shadow: false, contactType: 'fire',
    ai: 'boss_sun_core', aiParams: {},
  },
};
