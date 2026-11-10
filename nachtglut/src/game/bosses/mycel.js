// boss_mycel — Myzelmutter, Herz der Sporengrotten (floor 2).
// A rooted fungal queen: stationary, relocates by burrowing (telegraphed). Spore spirals, lobbed spore
// bombs that leave poison clouds, travelling root eruptions, brood summons, toxic pulse rings.
// Phase 2 (60 %): spore sacs open — slow poison clouds drift through the grotto; root cage.
// Phase 3 (25 %): frantic counter-rotating spirals.
import { TAU, angleTo } from '../../core/math.js';
import {
  makeBossAI, during, teleTime, telegraph, attackEvent, facePlayer, angleToPlayer, distToPlayer, arena,
  zCircle, zRing, shot, ringShots, summon, liveMinions, phaseGate, keepInArena,
} from './common.js';

const COL = { body: '#a77be0', spore: '#9be35a', root: '#b98cff', toxic: '#7fd94a', cloud: '#8fcf5a' };

const poison = (e, power = 1.1, duration = 2.5) => ({ id: 'poison', duration, power: power * (e.dmgMul ?? 1) });
const sporeShot = (e, o = {}) => ({
  r: 3.5, damage: 9, type: 'poison', sprite: 'proj_spore', color: COL.spore,
  status: { id: 'poison', duration: 3, power: 1 * (e.dmgMul ?? 1), chance: 0.3 }, ...o,
});

/** Stationary poison cloud (status-only zone). */
function poisonCloud(w, e, x, y, o = {}) {
  return zCircle(w, e, x, y, o.r ?? 26, {
    delay: o.delay ?? 0.05, duration: o.duration ?? 4.5, tick: 0.5, damage: 0, type: 'poison',
    status: poison(e), color: COL.cloud, data: { cloud: true, hazard: true },
  });
}

/** Phase 2+: a slow cloud drifting across the grotto from an edge. */
function driftingCloud(w, e) {
  const A = arena(w);
  const side = w.rng.int(0, 3);
  let x, y;
  if (side === 0) { x = A.x0 + 24; y = w.rng.float(A.y0 + 30, A.y1 - 30); }
  else if (side === 1) { x = A.x1 - 24; y = w.rng.float(A.y0 + 30, A.y1 - 30); }
  else if (side === 2) { x = w.rng.float(A.x0 + 30, A.x1 - 30); y = A.y0 + 24; }
  else { x = w.rng.float(A.x0 + 30, A.x1 - 30); y = A.y1 - 24; }
  const tx = A.cx + w.rng.float(-A.w * 0.25, A.w * 0.25), ty = A.cy + w.rng.float(-A.h * 0.25, A.h * 0.25);
  const a = angleTo(x, y, tx, ty), sp = w.rng.float(15, 22);
  const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
  return zCircle(w, e, x, y, 26, {
    delay: 1.0, duration: 16, tick: 0.5, damage: 0, type: 'poison', status: poison(e, 1.2),
    color: COL.cloud, data: { cloud: true, drift: true, hazard: true },
    onTick(w2, z, dt) {
      z.x += vx * dt; z.y += vy * dt;
      if (z.x < A.x0 - 20 || z.x > A.x1 + 20 || z.y < A.y0 - 20 || z.y > A.y1 + 20) z.dead = true;
    },
  });
}

function* sporeSpiral(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  w.fx.burst('poison', e.x, e.y, { count: 14 });
  yield teleTime(B, 0.6);
  attackEvent(e, 'shoot');
  const arms = [3, 4, 4][B.phase - 1];
  const rate = B.phase >= 3 ? 0.12 : 0.13;
  const spin = [1.2, 1.35, 1.55][B.phase - 1];
  const dir = w.rng.sign();
  let a = w.rng.angle(), b = a + Math.PI / 3, acc = 0;
  yield* during(B.phase >= 3 ? 3.4 : 3, (dt) => {
    a += spin * dir * dt;
    b -= spin * 0.8 * dir * dt;
    acc += dt;
    while (acc >= rate) {
      acc -= rate;
      for (let k = 0; k < arms; k++) shot(w, e, e.x, e.y, a + (k * TAU) / arms, 74, sporeShot(e));
      if (B.phase >= 3) for (let k = 0; k < 2; k++) shot(w, e, e.x, e.y, b + k * Math.PI, 60, sporeShot(e, { color: COL.toxic }));
    }
  });
  yield 0.3;
}

function* sporeBombs(w, e, B) {
  e.anim = 'attack';
  facePlayer(w, e);
  telegraph(e, 'cast');
  yield 0.4;
  const n = [3, 4, 5][B.phase - 1];
  const p = w.player;
  for (let i = 0; i < n; i++) {
    let tx = p.x, ty = p.y;
    if (i > 0) { const a = w.rng.angle(), r = w.rng.float(30, 75); tx += Math.cos(a) * r; ty += Math.sin(a) * r; }
    const c = w.clampToRoom(tx, ty, 12);
    const d = teleTime(B, 1.0) + i * 0.12;
    shot(w, e, e.x, e.y - e.r * 0.6, 0, 0, {
      arc: { tx: c.x, ty: c.y, time: d, height: 64 }, damage: 0, sprite: 'proj_spore', scale: 1.8, color: COL.spore,
      light: { r: 18, color: COL.spore },
    });
    zCircle(w, e, c.x, c.y, 22, {
      delay: d, duration: 0.12, damage: 12, type: 'poison', status: poison(e, 1.2, 3), color: COL.toxic,
      onStart(w2, z) {
        w2.fx.burst('poison', z.x, z.y, { count: 16 });
        poisonCloud(w2, e, z.x, z.y, { r: 26, duration: B.phase >= 2 ? 5.5 : 4.5 });
      },
    });
  }
  attackEvent(e, 'shoot');
  yield 0.7;
}

function* rootEruption(w, e, B) {
  e.anim = 'special';
  facePlayer(w, e);
  telegraph(e, 'slam');
  const lines = B.phase >= 2 ? 3 : 1;
  const waves = B.phase >= 3 ? 2 : 1;
  const per = B.phase >= 3 ? 0.055 : 0.07;
  for (let wv = 0; wv < waves; wv++) {
    const base = angleToPlayer(w, e) + (wv ? 0.21 : 0);
    const d0 = teleTime(B, 0.75);
    let maxN = 0;
    for (let l = 0; l < lines; l++) {
      const a = base + (l - (lines - 1) / 2) * 0.42;
      for (let i = 0; i < 11; i++) {
        const r = e.r + 12 + i * 22;
        const x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r;
        const c = w.clampToRoom(x, y, 8);
        if (Math.abs(c.x - x) > 1 || Math.abs(c.y - y) > 1) break;
        maxN = Math.max(maxN, i + 1);
        zCircle(w, e, x, y, 13, {
          delay: d0 + i * per, duration: 0.14, damage: 14, knockback: 120, type: 'phys', color: COL.root,
          onStart(w2, z) { w2.fx.burst('dust', z.x, z.y, { count: 5, color: COL.root }); },
        });
      }
    }
    yield d0;
    attackEvent(e, 'slam');
    w.fx.shake(3, 0.3);
    yield maxN * per + (wv < waves - 1 ? 0.15 : 0.3);
  }
}

function* rootCage(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'slam');
  const p = w.player;
  const cx = p.x, cy = p.y, n = 12, R = 66;
  const gap = w.rng.int(0, n - 1);
  const d = teleTime(B, 0.95);
  for (let i = 0; i < n; i++) {
    if (i === gap || i === (gap + 1) % n) continue;
    const a = (i / n) * TAU;
    zCircle(w, e, cx + Math.cos(a) * R, cy + Math.sin(a) * R, 14, { delay: d, duration: 0.14, damage: 14, type: 'phys', color: COL.root });
  }
  zCircle(w, e, cx, cy, 44, { delay: d + 0.55, duration: 0.15, damage: 18, knockback: 160, type: 'poison', status: poison(e, 1.4, 3), color: COL.toxic });
  yield d;
  attackEvent(e, 'slam');
  w.fx.shake(2, 0.2);
  yield 0.9;
}

function* brood(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'summon');
  B.broodN = (B.broodN || 0) + 1;
  if (B.broodN % 2) summon(w, e, 'spore_puff', 2, { cap: 6, color: COL.spore });
  else summon(w, e, 'rot_swarm', 4, { cap: 6, color: COL.body });
  yield 0.9;
}

function* toxicPulse(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  const rings = B.phase;
  const d = teleTime(B, 0.8);
  for (let i = 0; i < rings; i++) {
    zRing(w, e, e.x, e.y, e.r + 10, e.r - 2, {
      delay: d + i * 0.55, duration: 2.3, grow: 95, damage: 12, type: 'poison', status: poison(e, 1.2, 3), color: COL.toxic,
    });
  }
  yield d;
  attackEvent(e, 'explode');
  w.fx.burst('poison', e.x, e.y, { count: 24 });
  yield 0.5 + (rings - 1) * 0.55;
}

function* relocate(w, e, B) {
  let dest = w.randomFloorPos({ minPlayerDist: 110, margin: 3 });
  dest = w.clampToRoom(dest.x, dest.y, e.r);
  const d = teleTime(B, 1.1);
  e.anim = 'special';
  telegraph(e, 'teleport');
  zCircle(w, e, dest.x, dest.y, 30, { delay: d, duration: 0.15, damage: 16, knockback: 180, type: 'phys', color: COL.root });
  yield 0.35;
  try {
    e.hidden = true;
    w.fx.burst('dust', e.x, e.y, { count: 22, color: COL.root });
    attackEvent(e, 'teleport');
    yield Math.max(0.1, d - 0.35);
  } finally {
    e.x = dest.x; e.y = dest.y;
    e.hidden = false;
    B.lastReloc = B.clock;
  }
  w.fx.shake(4, 0.3);
  w.fx.burst('poison', e.x, e.y, { count: 20 });
  ringShots(w, e, e.x, e.y, B.phase >= 3 ? 16 : 12, 70, w.rng.angle(), sporeShot(e));
  attackEvent(e, 'shoot');
  e.anim = 'attack';
  yield 0.6;
}

function* sacBurst(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'cast');
  yield teleTime(B, 0.6);
  for (let i = 0; i < 2; i++) driftingCloud(w, e);
  ringShots(w, e, e.x, e.y, 18, 64, w.rng.angle(), sporeShot(e, { gap: { at: angleToPlayer(w, e) + w.rng.float(-0.8, 0.8), size: 1.0 } }));
  attackEvent(e, 'shoot');
  yield 0.4;
  ringShots(w, e, e.x, e.y, 18, 64, w.rng.angle(), sporeShot(e, { gap: { at: angleToPlayer(w, e) + w.rng.float(-0.8, 0.8), size: 1.0 } }));
  yield 0.6;
}

const cloudCount = (w) => w.zones.reduce((n, z) => n + (!z.dead && z.data && z.data.drift ? 1 : 0), 0);

export const MYCEL_AI = makeBossAI({
  phases: [0.6, 0.25],
  phaseStats: [
    { tele: 1, speed: 1, recover: 1.15 },
    { tele: 0.9, speed: 1, recover: 0.95 },
    { tele: 0.78, speed: 1, recover: 0.7 },
  ],
  introAnim: 'special',
  phaseColor: COL.spore,
  init(w, e, B) { B.clock = 0; B.lastReloc = 0; B.cloudT = 2; },
  start(w, e) { keepInArena(w, e, e.r); },
  move(w, e) {
    facePlayer(w, e);
    e.anim = 'idle';
  },
  onPhase(w, e, B, phase) {
    if (phase === 2) {
      w.fx.burst('poison', e.x, e.y, { count: 50 });
      B.cloudT = 0.8;
    }
  },
  post(w, e, B, dt) {
    B.clock += dt;
    if (B.phase < 2 || B.mode === 'transition') return;
    B.cloudT -= dt;
    if (B.cloudT <= 0) {
      B.cloudT = B.phase >= 3 ? 3.6 : 4.6;
      if (cloudCount(w) < (B.phase >= 3 ? 5 : 4)) driftingCloud(w, e);
    }
  },
  attacks: {
    sporeSpiral: { weight: (w, e, B) => (B.phase >= 3 ? 4 : 3), run: sporeSpiral },
    sporeBombs: { weight: 2.5, run: sporeBombs },
    rootEruption: { weight: 3, run: rootEruption },
    toxicPulse: { weight: 2, run: toxicPulse },
    brood: { weight: 1.4, run: brood, cond: (w, e, B) => liveMinions(B) < 4 },
    relocate: {
      weight: (w, e) => (distToPlayer(w, e) < 70 ? 5 : 1.2), run: relocate, recover: 0.6,
      cond: (w, e, B) => B.clock - B.lastReloc > 6,
    },
    rootCage: { phases: [2, 3], weight: 2, run: rootCage },
    sacBurst: { phases: [2, 3], weight: 1.4, run: sacBurst, cond: (w) => cloudCount(w) < 5 },
  },
});

export const MYCEL_DEFS = {
  boss_mycel: {
    id: 'boss_mycel', name: 'Myzelmutter', title: 'Herz der Sporengrotten',
    desc: 'Die verwurzelte Königin der Grotten. Ihre Wurzeln brechen aus dem Boden, ihre Sporen wirbeln in Spiralen – und wenn ihre Sporensäcke aufplatzen, atmet die Höhle Gift.',
    biome: 'fungal', boss: true, hp: 1500, speed: 0, damage: 16, r: 20, mass: 0, xp: 80, sparks: [50, 75],
    sprite: 'boss_mycel', color: COL.body, light: { r: 90, color: COL.spore }, shadow: true, contactType: 'poison',
    ai: 'boss_mycel', aiParams: {},
    hooks: { onHit: phaseGate },
  },
};
