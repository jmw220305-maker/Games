// boss_rime — Reifwyrm, Schlange der Frostadern (floor 3).
// An ice serpent: the head (boss) sweeps through the arena in curves, its body is a chain of
// `boss_rime_segment` enemies that follow the head's path history and forward damage to the head.
// It burrows under the ice (body follows underground), breathes frost cones, rains icicles, raises
// frost walls (slow/damage lines — room tiles are never touched), sprays shard fans and scale barrages.
// Phase 2 (50 %): faster, chilling trail, sweeping breath, coils around the player.
// Phase 3 (25 %): blizzard — icicles keep falling around the player.
import { angleTo, rotateToward, dist } from '../../core/math.js';
import {
  makeBossAI, during, teleTime, telegraph, attackEvent, angleToPlayer, arena,
  zCircle, zLine, zCone, shot, ringShots, fanShots, phaseGate, keepInArena, forwardHit, removePart, removeParts,
} from './common.js';

const COL = { body: '#8fd8ff', ice: '#dff4ff', frost: '#bfeaff', deep: '#4f8fc0' };
const SEGMENTS = 8;
const SPACING = 15;
const PATH_MAX = Math.ceil(((SEGMENTS + 2) * SPACING) / 2) + 20;
const SEGMENT_FORWARD = 0.6; // body hits deal 60 % to the head (the head is the weak point)

const chill = (duration = 2.5) => ({ id: 'chill', duration });
const shard = (o = {}) => ({ r: 3.5, damage: 18, type: 'frost', sprite: 'proj_shard', color: COL.frost, status: { id: 'chill', duration: 2, chance: 0.4 }, ...o });

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------
function newGoal(w, e, B) {
  const p = w.player;
  B.goalT = 2.6;
  B.goalMode = !B.goalMode;
  if (B.goalMode) {
    // a sweeping pass beside the player
    const a = angleTo(e.x, e.y, p.x, p.y) + w.rng.sign() * w.rng.float(0.35, 0.6);
    const d = dist(e.x, e.y, p.x, p.y) + 80;
    B.goal = w.clampToRoom(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 40);
  } else {
    B.goal = w.randomFloorPos({ minPlayerDist: 60, flying: true, margin: 3 });
  }
}

/** Steer the head toward its goal with a limited turn rate (sweeping curves). */
function steer(w, e, B, dt, spMul = 1, goal = null, turnMul = 1) {
  const A = arena(w);
  if (!goal) {
    B.goalT -= dt;
    if (!B.goal || B.goalT <= 0 || dist(e.x, e.y, B.goal.x, B.goal.y) < 24) newGoal(w, e, B);
    goal = B.goal;
  }
  let desired = angleTo(e.x, e.y, goal.x, goal.y);
  const lx = e.x + Math.cos(B.heading) * 44, ly = e.y + Math.sin(B.heading) * 44;
  const m = 24;
  if (lx < A.x0 + m || lx > A.x1 - m || ly < A.y0 + m || ly > A.y1 - m || w.isSolidPx(lx, ly, true)) {
    desired = angleTo(e.x, e.y, A.cx, A.cy);
    turnMul *= 1.8;
  }
  B.heading = rotateToward(B.heading, desired, (B.phase >= 2 ? 2.6 : 2.2) * turnMul * dt);
  const sp = e.speed * e.slowMul * B.spdMul * spMul;
  w.moveEntity(e, Math.cos(B.heading) * sp * dt, Math.sin(B.heading) * sp * dt);
  if (e.blockedX) B.heading = Math.PI - B.heading;
  if (e.blockedY) B.heading = -B.heading;
  keepInArena(w, e, 10);
  e.facing = B.heading;
  e.flipX = Math.cos(B.heading) < 0;
  if (e.anim === 'idle') e.anim = 'walk';
}

function recordPath(e, B) {
  const last = B.path[0];
  if (!last || Math.hypot(e.x - last.x, e.y - last.y) >= 2) {
    B.path.unshift({ x: e.x, y: e.y, u: !!e.hidden });
    if (B.path.length > PATH_MAX) B.path.length = PATH_MAX;
  } else if (last.u !== !!e.hidden) last.u = !!e.hidden;
}

/** Place every segment along the recorded path; segments on 'under' points are hidden. */
function placeSegments(e, B) {
  const path = B.path;
  let prevX = e.x, prevY = e.y, prevU = !!e.hidden, acc = 0, idx = 0;
  for (let i = 0; i < B.segs.length; i++) {
    const s = B.segs[i];
    const target = (i + 1) * SPACING;
    let x = prevX, y = prevY, u = prevU, found = false;
    while (idx < path.length) {
      const pt = path[idx];
      const l = Math.hypot(pt.x - prevX, pt.y - prevY);
      if (l > 1e-6 && acc + l >= target) {
        const t = (target - acc) / l;
        x = prevX + (pt.x - prevX) * t; y = prevY + (pt.y - prevY) * t; u = pt.u;
        found = true;
        break;
      }
      acc += l; prevX = pt.x; prevY = pt.y; prevU = pt.u; idx++;
    }
    if (!found) { x = prevX; y = prevY; u = prevU; }
    if (s.dead) continue;
    const ahead = i === 0 ? e : B.segs[i - 1];
    if (Math.hypot(ahead.x - x, ahead.y - y) > 0.5) s.facing = Math.atan2(ahead.y - y, ahead.x - x);
    s.flipX = Math.cos(s.facing) < 0;
    s.x = x; s.y = y;
    s.hidden = u;
  }
}

// ---------------------------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------------------------
function* frostBreath(w, e, B) {
  e.anim = 'attack';
  telegraph(e, 'beam');
  yield* during(0.35, (dt) => {
    B.heading = rotateToward(B.heading, angleToPlayer(w, e), 5 * dt);
    e.facing = B.heading; e.flipX = Math.cos(B.heading) < 0;
  });
  const a = angleToPlayer(w, e);
  e.facing = a; e.flipX = Math.cos(a) < 0;
  const d = teleTime(B, 0.9);
  const cones = B.phase >= 2 ? 3 : 1;
  const sgn = w.rng.sign();
  for (let k = 0; k < cones; k++) {
    const ang = cones === 1 ? a : a + sgn * (k - 1) * 0.55;
    zCone(w, e, e.x, e.y, 125, ang, 0.85, {
      delay: d + k * 0.3, duration: 0.55, tick: 0.25, damage: 19, type: 'frost', status: chill(2.5), color: COL.frost,
    });
  }
  yield d;
  attackEvent(e, 'beam');
  w.fx.burst('frost', e.x, e.y, { count: 20, angle: a, spread: 0.6, speed: 140 });
  yield (cones - 1) * 0.3 + 0.6;
}

function* icicleRain(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  yield* during(0.35, (dt) => steer(w, e, B, dt, 0.6));
  attackEvent(e, 'cast');
  const n = [10, 13, 16][B.phase - 1];
  const p = w.player;
  for (let i = 0; i < n; i++) {
    let x = p.x, y = p.y;
    if (i > 0) { const a = w.rng.angle(), r = i === 1 ? 22 : w.rng.float(18, 115); x += Math.cos(a) * r; y += Math.sin(a) * r; }
    const c = w.clampToRoom(x, y, 10);
    zCircle(w, e, c.x, c.y, 13, {
      delay: teleTime(B, 1.0) + i * 0.07, duration: 0.12, damage: 22, type: 'frost', status: chill(2), color: COL.ice,
      onStart(w2, z) { w2.fx.burst('frost', z.x, z.y, { count: 8 }); },
    });
  }
  yield* during(1.0, (dt) => steer(w, e, B, dt));
}

function* burrow(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'burrow');
  yield* during(0.35, (dt) => steer(w, e, B, dt, 0.5));
  const p = w.player;
  try {
    e.hidden = true;
    w.fx.burst('frost', e.x, e.y, { count: 22 });
    w.fx.shake(3, 0.3);
    attackEvent(e, 'teleport');
    // dive forward a little under the ice
    const A = arena(w);
    yield* during(0.45, (dt) => {
      e.x = Math.min(A.x1 - 12, Math.max(A.x0 + 12, e.x + Math.cos(B.heading) * 150 * dt));
      e.y = Math.min(A.y1 - 12, Math.max(A.y0 + 12, e.y + Math.sin(B.heading) * 150 * dt));
    });
    const tgt = w.clampToRoom(p.x, p.y, 18);
    const d = teleTime(B, 0.9);
    zCircle(w, e, tgt.x, tgt.y, 30, { delay: d, duration: 0.15, damage: 32, knockback: 220, type: 'frost', status: chill(2.5), color: COL.ice });
    telegraph(e, 'emerge');
    const sx = e.x, sy = e.y;
    B.heading = angleTo(sx, sy, tgt.x, tgt.y);
    yield* during(d, (dt, t) => {
      const k = Math.min(1, t / d);
      e.x = sx + (tgt.x - sx) * k; e.y = sy + (tgt.y - sy) * k;
    });
    e.x = tgt.x; e.y = tgt.y;
  } finally {
    e.hidden = false;
  }
  w.fx.shake(6, 0.35);
  w.fx.burst('frost', e.x, e.y, { count: 30, speed: 150 });
  attackEvent(e, 'slam');
  ringShots(w, e, e.x, e.y, B.phase >= 2 ? 12 : 8, B.phase >= 2 ? 82 : 70, w.rng.angle(), shard());
  e.anim = 'attack';
  yield* during(0.5, (dt) => steer(w, e, B, dt, 0.5));
}

function* frostWalls(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  const p = w.player;
  const A = arena(w);
  const vertical = w.rng.chance(0.5);
  const n = B.phase >= 2 ? 3 : 2;
  const offs = n === 2 ? [-38, 38] : [-76, 0, 76];
  const d = teleTime(B, 1.0);
  const jitter = w.rng.float(-10, 10);
  for (const o of offs) {
    let x1, y1, x2, y2;
    if (vertical) {
      const x = Math.min(A.x1 - 8, Math.max(A.x0 + 8, p.x + o + jitter));
      x1 = x2 = x; y1 = Math.max(A.y0 + 4, p.y - 105); y2 = Math.min(A.y1 - 4, p.y + 105);
    } else {
      const y = Math.min(A.y1 - 8, Math.max(A.y0 + 8, p.y + o + jitter));
      y1 = y2 = y; x1 = Math.max(A.x0 + 4, p.x - 105); x2 = Math.min(A.x1 - 4, p.x + 105);
    }
    zLine(w, e, x1, y1, x2, y2, 12, {
      delay: d, duration: 5.5, tick: 0.6, damage: 10, type: 'frost', status: chill(1.5), color: COL.ice, data: { hazard: true, wall: true },
      onStart(w2, z) { w2.fx.burst('frost', (z.x + z.x2) / 2, (z.y + z.y2) / 2, { count: 14 }); },
    });
  }
  yield* during(d, (dt) => steer(w, e, B, dt, 0.6));
  attackEvent(e, 'cast');
  yield* during(0.4, (dt) => steer(w, e, B, dt));
}

function* shardVolley(w, e, B) {
  e.anim = 'attack';
  telegraph(e, 'shoot');
  yield* during(teleTime(B, 0.5), (dt) => steer(w, e, B, dt, 0.4));
  const waves = B.phase >= 2 ? 4 : 3;
  for (let v = 0; v < waves; v++) {
    fanShots(w, e, e.x, e.y, angleToPlayer(w, e), v % 2 ? 6 : 5, 0.8, 110, shard());
    attackEvent(e, 'shoot');
    yield* during(0.42, (dt) => steer(w, e, B, dt, 0.5));
  }
}

function* scaleBarrage(w, e, B) {
  const rounds = B.phase >= 2 ? 2 : 1;
  try {
    for (let r = 0; r < rounds; r++) {
      const active = B.segs.filter((s, i) => !s.dead && i % 2 === r % 2);
      for (const s of active) s.anim = 'attack';
      telegraph(e, 'shoot');
      yield* during(teleTime(B, 0.75), (dt) => steer(w, e, B, dt, 0.6));
      for (const s of active) {
        s.anim = 'idle';
        if (s.dead || s.hidden) continue;
        const a = s.facing + Math.PI / 2;
        shot(w, s, s.x, s.y, a, 72, shard({ damage: 16 }));
        shot(w, s, s.x, s.y, a + Math.PI, 72, shard({ damage: 16 }));
      }
      attackEvent(e, 'shoot');
      yield* during(0.45, (dt) => steer(w, e, B, dt, 0.8));
    }
  } finally {
    for (const s of B.segs) if (!s.dead) s.anim = 'idle';
  }
}

function* coil(w, e, B) {
  telegraph(e, 'charge');
  const p = w.player;
  let ang = angleTo(p.x, p.y, e.x, e.y);
  const dir = w.rng.sign();
  const R = 84;
  const orbit = (dt, spMul) => {
    ang += dir * ((e.speed * B.spdMul * 1.25) / R) * dt;
    const g = w.clampToRoom(p.x + Math.cos(ang) * R, p.y + Math.sin(ang) * R, 16);
    steer(w, e, B, dt, spMul, g, 3);
  };
  yield* during(2.4, (dt) => orbit(dt, 1.3));
  const live = B.segs.filter((s, i) => !s.dead && i % 2 === 0);
  try {
    for (const s of live) s.anim = 'attack';
    telegraph(e, 'shoot');
    yield* during(teleTime(B, 0.7), (dt) => orbit(dt, 0.5));
    const tx = p.x, ty = p.y;
    for (const s of live) {
      s.anim = 'idle';
      if (s.dead || s.hidden) continue;
      shot(w, s, s.x, s.y, angleTo(s.x, s.y, tx, ty), 66, shard({ damage: 16 }));
    }
    fanShots(w, e, e.x, e.y, angleToPlayer(w, e), 3, 0.4, 96, shard());
    attackEvent(e, 'shoot');
  } finally {
    for (const s of B.segs) if (!s.dead) s.anim = 'idle';
  }
  yield* during(0.4, (dt) => steer(w, e, B, dt));
}

// ---------------------------------------------------------------------------------------------
export const RIME_AI = makeBossAI({
  phases: [0.5, 0.25],
  phaseStats: [
    { tele: 1, speed: 1, recover: 1.0 },
    { tele: 0.88, speed: 1.22, recover: 0.8 },
    { tele: 0.78, speed: 1.3, recover: 0.65 },
  ],
  introAnim: 'special',
  phaseColor: COL.ice,
  init(w, e, B) {
    B.heading = w.rng.angle();
    B.path = [{ x: e.x, y: e.y, u: true }];
    B.segs = [];
    B.goal = null; B.goalT = 0; B.goalMode = false;
    B.trailT = 0; B.blizT = 1.5;
  },
  start(w, e, B) {
    keepInArena(w, e, 24);
    B.path = [{ x: e.x, y: e.y, u: true }];
    for (let i = 0; i < SEGMENTS; i++) {
      const s = w.spawnEnemy('boss_rime_segment', e.x, e.y, { summoned: true, noXp: true, delay: 0.01 });
      s.data.owner = e;
      s.data.index = i;
      s.data.count = SEGMENTS;
      s.data.tail = i === SEGMENTS - 1;
      s.hidden = true;
      B.segs.push(s);
    }
  },
  introTick(w, e, B, dt) {
    // rise out of the ice: the head circles slowly while the body emerges behind it
    B.heading += 1.4 * dt;
    steer(w, e, B, dt, 0.7, { x: e.x + Math.cos(B.heading) * 50, y: e.y + Math.sin(B.heading) * 50 }, 2);
  },
  move(w, e, B, dt) {
    e.anim = 'walk';
    steer(w, e, B, dt);
  },
  transition(w, e, B, dt) {
    // keep slithering slowly (invulnerable) so the body does not freeze in place
    steer(w, e, B, dt, 0.5);
  },
  post(w, e, B, dt) {
    recordPath(e, B);
    placeSegments(e, B);
    if (B.mode === 'intro' || B.mode === 'transition') return;
    // phase 2+: chilling trail
    if (B.phase >= 2 && !e.hidden) {
      B.trailT -= dt;
      if (B.trailT <= 0) {
        B.trailT = 0.3;
        zCircle(w, e, e.x, e.y, 13, {
          delay: 0.4, duration: B.phase >= 3 ? 4.5 : 3.5, tick: 0.5, damage: 0, type: 'frost', status: chill(1.6),
          color: COL.frost, data: { hazard: true },
        });
      }
    }
    // phase 3: blizzard
    if (B.phase >= 3) {
      B.blizT -= dt;
      if (B.blizT <= 0) {
        B.blizT = 1.5;
        const p = w.player;
        for (let i = 0; i < 2; i++) {
          const a = w.rng.angle(), r = i ? w.rng.float(20, 60) : 0;
          const c = w.clampToRoom(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 10);
          zCircle(w, e, c.x, c.y, 12, { delay: teleTime(B, 1.0), duration: 0.12, damage: 18, type: 'frost', status: chill(2), color: COL.ice });
        }
      }
    }
  },
  attacks: {
    frostBreath: { weight: 3, run: frostBreath },
    icicleRain: { weight: 2.5, run: icicleRain },
    burrow: { weight: (w, e, B) => (B.phase >= 2 ? 3 : 2), run: burrow },
    frostWalls: { weight: 1.5, run: frostWalls, recover: 0.5 },
    shardVolley: { weight: 2.5, run: shardVolley },
    scaleBarrage: { weight: 2, run: scaleBarrage },
    coil: { phases: [2, 3], weight: 2.2, run: coil },
  },
});

export const RIME_SEGMENT_AI = {
  update(w, s) {
    const head = s.data.owner;
    if (!head || head.dead) removePart(w, s);
    // positions are driven by the head (placeSegments)
  },
};

export const RIME_DEFS = {
  boss_rime: {
    id: 'boss_rime', name: 'Reifwyrm', title: 'Schlange der Frostadern',
    desc: 'Ein Wyrm aus uraltem Eis, der unter dem Boden schwimmt. Nur sein Kopf ist verwundbar – sein Panzer leitet Treffer nur zum Teil weiter.',
    biome: 'frost', boss: true, hp: 3900, speed: 72, damage: 18, r: 14, mass: 0, flying: true, xp: 100, sparks: [30, 40],
    sprite: 'boss_rime', color: COL.body, light: { r: 80, color: COL.body }, shadow: true, contactType: 'frost',
    ai: 'boss_rime', aiParams: {},
    hooks: {
      onHit: phaseGate,
      onDeath(w, e) { removeParts(w, e); },
    },
  },
  boss_rime_segment: {
    id: 'boss_rime_segment', name: 'Reifwyrm-Glied', desc: 'Gepanzerter Leib des Reifwyrms.',
    biome: 'frost', boss: false, hp: 9999, speed: 0, damage: 14, r: 10, mass: 0, flying: true, xp: 0, sparks: [0, 0],
    sprite: 'boss_rime_segment', color: COL.deep, light: { r: 26, color: COL.body }, shadow: true, contactType: 'frost',
    ai: 'boss_rime_segment', aiParams: {},
    untargetable: true,
    immune: ['burn', 'poison', 'chill', 'freeze', 'shock', 'mark', 'stun', 'weak', 'slow'],
    hooks: {
      onHit(w, s, hit) { forwardHit(w, s, s.data.owner, hit, SEGMENT_FORWARD); },
    },
  },
};
