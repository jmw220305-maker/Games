// boss_umbra — Umbra, der Zwillingsschatten (floor 4).
// A shadow duelist. Phase 1 solo: teleport strikes (mark at the destination), blade fans, darkness pulse,
// shadow dash cuts, homing soul lights.
// Phase 2 (60 %): splits — `boss_umbra_twin` (inverted colours) shares ONE HP pool with Umbra; the twins
// fight in sync: crossfire lines, pincer dashes, mirrored fans, alternating strikes.
// Phase 3 (25 %): the twin merges back — frantic strike chains and a blade storm.
import { TAU, clamp, angleTo, dist, norm } from '../../core/math.js';
import {
  makeBossAI, during, teleTime, telegraph, attackEvent, facePlayer, angleToPlayer, distToPlayer, pointNear, rayLen,
  findStand, zCircle, zLine, zCone, zRing, shot, ringShots, fanShots, phaseGate, keepInArena, forwardHit,
  removePart, removeParts,
} from './common.js';

const COL = { body: '#8a5cff', twin: '#e6dcff', blade: '#c9a6ff', twinBlade: '#f4efff', dark: '#3a2266', weak: '#9a86c9' };

const colorOf = (a) => (a.id === 'boss_umbra_twin' ? COL.twinBlade : COL.blade);
const blade = (a, o = {}) => ({ r: 3.5, damage: 15, type: 'shadow', sprite: 'proj_blade', color: colorOf(a), ...o });
const twinAlive = (B) => !!(B.twin && !B.twin.dead);

// ---------------------------------------------------------------------------------------------
// Building blocks (work for Umbra and the twin alike)
// ---------------------------------------------------------------------------------------------
/** Vanish, show a mark at each destination, reappear there after `d` seconds. moves = [[actor, x, y], …] */
function* blink(w, moves, d) {
  for (const [a, x, y] of moves) {
    if (a.dead) continue;
    zCircle(w, a, x, y, 14, { delay: d, duration: 0.05, damage: 0, color: a.def.color, data: { mark: true } });
    w.fx.burst('shadow', a.x, a.y, { count: 16, color: a.def.color });
    a.hidden = true;
    a.anim = 'cast';
    telegraph(a, 'teleport');
    attackEvent(a, 'teleport');
  }
  try {
    yield d;
  } finally {
    for (const [a, x, y] of moves) {
      if (a.dead) continue;
      const s = findStand(w, x, y, 6);
      a.x = s.x; a.y = s.y;
      a.hidden = false;
      w.fx.burst('shadow', a.x, a.y, { count: 16, color: a.def.color });
    }
  }
}

/** Teleport next to the player and slash (cone). */
function* strike(w, B, a, markT = 0.75) {
  const p = w.player;
  const dest = pointNear(w, p.x, p.y, 44, w.rng.angle());
  yield* blink(w, [[a, dest.x, dest.y]], teleTime(B, markT));
  if (a.dead) return;
  facePlayer(w, a);
  a.anim = 'attack';
  telegraph(a, 'melee');
  const ds = teleTime(B, 0.55);
  zCone(w, a, a.x, a.y, 50, angleToPlayer(w, a), 1.7, { delay: ds, duration: 0.12, damage: 23, knockback: 160, type: 'shadow', color: a.def.color });
  yield ds;
  attackEvent(a, 'melee');
  yield 0.15;
}

/** Shadow dash cut: telegraphed line, instant cut, lingering orbs that burst. */
function* dashCut(w, B, a, target = null, d = null) {
  const p = w.player;
  const tx = target ? target.x : p.x, ty = target ? target.y : p.y;
  const ang = angleTo(a.x, a.y, tx, ty);
  const len = Math.min(clamp(dist(a.x, a.y, tx, ty) + 60, 110, 300), rayLen(w, a.x, a.y, ang) - 8);
  const end = findStand(w, a.x + Math.cos(ang) * len, a.y + Math.sin(ang) * len, 6);
  facePlayer(w, a);
  a.anim = 'attack';
  telegraph(a, 'charge');
  const dd = d ?? teleTime(B, 0.8);
  zLine(w, a, a.x, a.y, end.x, end.y, 20, { delay: dd, duration: 0.18, damage: 23, knockback: 140, type: 'shadow', color: a.def.color });
  yield dd;
  return { a, sx: a.x, sy: a.y, ex: end.x, ey: end.y };
}

function* zip(w, cuts, orbs = true) {
  for (const c of cuts) { attackEvent(c.a, 'charge'); }
  yield* during(0.16, (dt, t) => {
    const k = Math.min(1, t / 0.16);
    for (const c of cuts) {
      if (c.a.dead) continue;
      c.a.x = c.sx + (c.ex - c.sx) * k; c.a.y = c.sy + (c.ey - c.sy) * k;
    }
  });
  w.fx.shake(3, 0.2);
  if (!orbs) return;
  for (const c of cuts) {
    if (c.a.dead) continue;
    for (let i = 1; i <= 4; i++) {
      const k = i / 5;
      const x = c.sx + (c.ex - c.sx) * k, y = c.sy + (c.ey - c.sy) * k;
      const a0 = i % 2 ? 0 : Math.PI / 4;
      shot(w, c.a, x, y, 0, 0, {
        r: 4.5, damage: 13, type: 'shadow', sprite: 'proj_orb', color: c.a.def.color, life: 0.8,
        onExpire: (w2, pr) => ringShots(w2, c.a, pr.x, pr.y, 4, 72, a0, blade(c.a, { damage: 13 })),
      });
    }
  }
}

function* fans(w, B, list, waves, n, spread = 1.1, speed = 115) {
  const actors = list.filter((a) => a && !a.dead);
  for (const a of actors) { a.anim = 'attack'; facePlayer(w, a); telegraph(a, 'shoot'); }
  yield teleTime(B, 0.5);
  for (let v = 0; v < waves; v++) {
    for (const a of actors) {
      if (a.dead || a.hidden) continue;
      facePlayer(w, a);
      fanShots(w, a, a.x, a.y, angleToPlayer(w, a), v % 2 ? n + 1 : n, spread, speed, blade(a));
      attackEvent(a, 'shoot');
    }
    yield 0.38;
  }
}

function pulseAt(w, B, a, d) {
  a.anim = 'cast';
  telegraph(a, 'cast');
  zCircle(w, a, a.x, a.y, 36, { delay: d, duration: 0.15, damage: 20, type: 'shadow', status: { id: 'weak', duration: 3 }, color: COL.dark });
  zRing(w, a, a.x, a.y, 36, 24, {
    delay: d, duration: 1.8, grow: 115, damage: 18, type: 'shadow', status: { id: 'weak', duration: 3 }, color: a.def.color,
    onStart(w2) { w2.fx.flash('#140a24', 0.15); attackEvent(a, 'explode'); },
  });
}

// ---------------------------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------------------------
function* teleStrike(w, e, B) {
  const n = B.phase >= 3 ? 4 : 2;
  for (let i = 0; i < n; i++) yield* strike(w, B, e, i === 0 ? 0.75 : 0.6);
  yield 0.2;
}

function* bladeFan(w, e, B) {
  if (B.phase >= 3) yield* fans(w, B, [e], 4, 7, 1.3, 120);
  else yield* fans(w, B, [e], 3, 6, 1.1, 112);
}

function* darkPulse(w, e, B) {
  const d = teleTime(B, 0.8);
  pulseAt(w, B, e, d);
  yield d;
  if (B.phase >= 3) { pulseAt(w, B, e, teleTime(B, 0.5)); yield 0.5; }
  // a slow orb ring with an opening follows the wave
  ringShots(w, e, e.x, e.y, 14, 58, w.rng.angle(), blade(e, { sprite: 'proj_orb', gap: { at: angleToPlayer(w, e) + w.rng.float(-1, 1), size: 1.0 } }));
  yield 0.5;
}

function* shadowDash(w, e, B) {
  const n = B.phase >= 3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const cut = yield* dashCut(w, B, e);
    yield* zip(w, [cut]);
    yield 0.35;
  }
}

function* soulLights(w, e, B) {
  e.anim = 'cast';
  telegraph(e, 'cast');
  yield teleTime(B, 0.55);
  const n = B.phase >= 3 ? 4 : 3;
  const base = angleToPlayer(w, e);
  for (let i = 0; i < n; i++) {
    const a = base + Math.PI + (i - (n - 1) / 2) * 0.7; // launched backwards, then they curve in
    shot(w, e, e.x, e.y, a, 62, {
      r: 5, damage: 15, type: 'shadow', sprite: 'proj_skull', color: COL.twinBlade, homing: 1.3, life: 5, trail: 'shadow',
      light: { r: 20, color: COL.blade },
    });
  }
  attackEvent(e, 'cast');
  yield 0.6;
}

function* shadowStorm(w, e, B) {
  e.anim = 'special';
  telegraph(e, 'cast');
  const d = teleTime(B, 0.6);
  zCircle(w, e, e.x, e.y, e.r + 16, { delay: d, duration: 0.1, damage: 18, type: 'shadow', color: COL.dark });
  yield d;
  attackEvent(e, 'shoot');
  let a = w.rng.angle(), acc = 0;
  const dir = w.rng.sign();
  yield* during(3, (dt) => {
    a += dir * 1.5 * dt;
    acc += dt;
    while (acc >= 0.13) {
      acc -= 0.13;
      for (let k = 0; k < 3; k++) shot(w, e, e.x, e.y, a + (k * TAU) / 3, 92, blade(e, { damage: 14 }));
    }
    // drift slowly toward the player
    const n = norm(w.player.x - e.x, w.player.y - e.y);
    if (n.len > 60) w.moveEntity(e, n.x * 22 * dt, n.y * 22 * dt);
  });
  yield 0.3;
}

// --- twin attacks (phase 2) ------------------------------------------------------------------
function* crossfire(w, e, B) {
  const t = B.twin;
  let theta = w.rng.chance(0.5) ? 0 : Math.PI / 4;
  for (let r = 0; r < 2; r++) {
    const p = w.player;
    const dm = pointNear(w, p.x, p.y, 120, theta), dt2 = pointNear(w, p.x, p.y, 120, theta + Math.PI / 2);
    yield* blink(w, [[e, dm.x, dm.y], [t, dt2.x, dt2.y]], teleTime(B, 0.6));
    const d = teleTime(B, 0.9);
    for (const a of [e, t]) {
      if (a.dead) continue;
      const ang = angleToPlayer(w, a);
      const L = rayLen(w, a.x, a.y, ang);
      a.anim = 'cast';
      facePlayer(w, a);
      zLine(w, a, a.x, a.y, a.x + Math.cos(ang) * L, a.y + Math.sin(ang) * L, 18, {
        delay: d, duration: 0.2, damage: 23, type: 'shadow', color: a.def.color,
      });
      telegraph(a, 'beam');
    }
    yield d;
    attackEvent(e, 'beam');
    w.fx.shake(3, 0.2);
    theta += Math.PI / 4;
    yield 0.3;
  }
}

function* pincer(w, e, B) {
  const t = B.twin;
  let theta = w.rng.angle();
  for (let r = 0; r < 2; r++) {
    const p = w.player;
    const dm = pointNear(w, p.x, p.y, 110, theta), dtw = pointNear(w, p.x, p.y, 110, theta + Math.PI);
    yield* blink(w, [[e, dm.x, dm.y], [t, dtw.x, dtw.y]], teleTime(B, 0.6));
    const c = { x: w.player.x, y: w.player.y };
    const d = teleTime(B, 0.85);
    const cuts = [];
    // both telegraph at once; collect the cut data without waiting twice
    for (const a of [e, t]) {
      if (a.dead) continue;
      const g = dashCut(w, B, a, c, d);
      g.next(); // runs up to its `yield dd`
      cuts.push({ g, a });
    }
    yield d;
    const res = cuts.map(({ g }) => g.next().value).filter(Boolean);
    yield* zip(w, res, false);
    theta += Math.PI / 2;
    yield 0.35;
  }
}

function* mirrorFans(w, e, B) {
  yield* fans(w, B, [e, B.twin], 3, 4, 0.7, 108);
}

function* twinStrikes(w, e, B) {
  for (let i = 0; i < 4; i++) {
    const a = i % 2 ? B.twin : e;
    if (!a || a.dead) continue;
    yield* strike(w, B, a, 0.65);
  }
  yield 0.2;
}

function* duoPulse(w, e, B) {
  const d = teleTime(B, 0.8);
  pulseAt(w, B, e, d);
  yield 0.6;
  if (twinAlive(B)) pulseAt(w, B, B.twin, d);
  yield d + 0.2;
}

// ---------------------------------------------------------------------------------------------
function strafe(w, a, B, dt, dirKey) {
  const p = w.player;
  const n = norm(p.x - a.x, p.y - a.y);
  const dir = B[dirKey] || 1;
  let vx = -n.y * dir, vy = n.x * dir;
  if (n.len > 125) { vx += n.x * 1.2; vy += n.y * 1.2; } else if (n.len < 80) { vx -= n.x; vy -= n.y; }
  const m = norm(vx, vy);
  const sp = a.speed * a.slowMul * B.spdMul;
  w.moveEntity(a, m.x * sp * dt, m.y * sp * dt);
  if (a.blockedX || a.blockedY || keepInArena(w, a)) B[dirKey] = -dir;
  facePlayer(w, a);
  a.anim = 'walk';
}

export const UMBRA_AI = makeBossAI({
  phases: [0.6, 0.25],
  phaseStats: [
    { tele: 1, speed: 1, recover: 1.0 },
    { tele: 0.9, speed: 1.1, recover: 0.9 },
    { tele: 0.75, speed: 1.3, recover: 0.55 },
  ],
  introAnim: 'cast',
  phaseColor: COL.blade,
  init(w, e, B) { B.dir = 1; B.flipT = 2; B.twin = null; },
  move(w, e, B, dt) {
    B.flipT -= dt;
    if (B.flipT <= 0) { B.flipT = w.rng.float(1.5, 2.6); B.dir = -(B.dir || 1); }
    strafe(w, e, B, dt, 'dir');
  },
  onPhase(w, e, B, phase) {
    if (phase === 2) {
      // split: the shadow tears in two
      const t = w.spawnEnemy('boss_umbra_twin', e.x, e.y, { summoned: true, noXp: true, delay: 0.5 });
      t.data.owner = e;
      t.hp = e.hp; t.maxHp = e.maxHp;
      B.twin = t;
      B.splitA = w.rng.angle();
      w.fx.flash(COL.twin, 0.2);
    } else if (phase === 3 && twinAlive(B)) {
      B.merging = true;
      B.twin.hidden = false;
    }
  },
  transition(w, e, B, dt, t) {
    if (B.phase === 2 && twinAlive(B)) {
      // drift apart
      const k = 40 * dt;
      w.moveEntity(e, Math.cos(B.splitA) * k, Math.sin(B.splitA) * k);
      w.moveEntity(B.twin, -Math.cos(B.splitA) * k, -Math.sin(B.splitA) * k);
    } else if (B.phase === 3 && twinAlive(B)) {
      const tw = B.twin;
      tw.invuln = true;
      tw.x += (e.x - tw.x) * Math.min(1, dt * 5);
      tw.y += (e.y - tw.y) * Math.min(1, dt * 5);
      if (t > 0.8) {
        removePart(w, tw);
        B.twin = null;
        w.fx.flash(COL.blade, 0.2);
        w.fx.burst('shadow', e.x, e.y, { count: 40, color: COL.blade });
      }
    }
  },
  afterTransition(w, e, B) {
    if (B.phase >= 3 && twinAlive(B)) { removePart(w, B.twin); B.twin = null; }
  },
  post(w, e, B, dt) {
    const t = B.twin;
    if (!t) return;
    if (t.dead) { B.twin = null; return; }
    t.hp = e.hp; t.maxHp = e.maxHp;
    // between attacks the twin mirrors Umbra through the player (flanking)
    if (B.mode === 'idle' && t.spawnT <= 0 && !t.hidden) {
      const p = w.player;
      const goal = w.clampToRoom(2 * p.x - e.x, 2 * p.y - e.y, 14);
      const n = norm(goal.x - t.x, goal.y - t.y);
      if (n.len > 4) {
        const sp = Math.min(n.len, t.speed * t.slowMul * B.spdMul * 1.15 * dt);
        w.moveEntity(t, n.x * sp, n.y * sp);
        t.anim = 'walk';
      } else t.anim = 'idle';
      facePlayer(w, t);
    }
  },
  attacks: {
    teleStrike: { weight: (w, e, B) => (B.phase === 2 && twinAlive(B) ? 0.6 : 3), run: teleStrike },
    bladeFan: { weight: (w, e, B) => (B.phase === 2 && twinAlive(B) ? 0.6 : 3), run: bladeFan },
    darkPulse: { weight: (w, e, B) => (distToPlayer(w, e) < 70 ? 4 : 2), run: darkPulse, cond: (w, e, B) => !(B.phase === 2 && twinAlive(B)) },
    shadowDash: { weight: 2.5, run: shadowDash, cond: (w, e, B) => !(B.phase === 2 && twinAlive(B)) },
    soulLights: { weight: 1.6, run: soulLights },
    crossfire: { phases: [2], weight: 3, run: crossfire, cond: (w, e, B) => twinAlive(B) },
    pincer: { phases: [2], weight: 3, run: pincer, cond: (w, e, B) => twinAlive(B) },
    mirrorFans: { phases: [2], weight: 2.5, run: mirrorFans, cond: (w, e, B) => twinAlive(B) },
    twinStrikes: { phases: [2], weight: 2.5, run: twinStrikes, cond: (w, e, B) => twinAlive(B) },
    duoPulse: { phases: [2], weight: 1.8, run: duoPulse, cond: (w, e, B) => twinAlive(B) },
    shadowStorm: { phases: [3], weight: 2.5, run: shadowStorm },
  },
});

export const UMBRA_TWIN_AI = {
  update(w, t) {
    const main = t.data.owner;
    if (!main || main.dead) { removePart(w, t); return; }
    // the twin is a puppet: Umbra's AI moves it and runs its attacks
    t.hp = main.hp; t.maxHp = main.maxHp;
  },
};

function umbraOnHit(w, e, hit) {
  phaseGate(w, e, hit);
  const t = e.data && e.data.twin;
  if (t && !t.dead && hit.amount > 0) t.flash = 1;
}

export const UMBRA_DEFS = {
  boss_umbra: {
    id: 'boss_umbra', name: 'Umbra, der Zwillingsschatten', title: 'Klinge des Schattenkerns',
    desc: 'Ein Schattenduellant, der zwischen den Lichtern springt. Verwundet reißt er sich entzwei – zwei Klingen, ein Leben.',
    biome: 'void', boss: true, hp: 4300, speed: 72, damage: 20, r: 14, mass: 0, xp: 120, sparks: [35, 45],
    sprite: 'boss_umbra', color: COL.body, light: { r: 64, color: COL.blade }, shadow: true, contactType: 'shadow',
    ai: 'boss_umbra', aiParams: {},
    hooks: {
      onHit: umbraOnHit,
      onDeath(w, e) { removeParts(w, e); },
    },
  },
  boss_umbra_twin: {
    id: 'boss_umbra_twin', name: 'Umbras Spiegelschatten', title: 'Die andere Hälfte',
    desc: 'Umbras abgespaltene Hälfte in umgekehrten Farben. Jeder Treffer trifft beide.',
    biome: 'void', boss: true, hp: 4300, speed: 72, damage: 20, r: 14, mass: 0, xp: 0, sparks: [0, 0],
    sprite: 'boss_umbra_twin', color: COL.twin, light: { r: 64, color: COL.twin }, shadow: true, contactType: 'shadow',
    ai: 'boss_umbra_twin', aiParams: {},
    hooks: {
      onHit(w, t, hit) { forwardHit(w, t, t.data.owner, hit, 1); },
    },
  },
};
