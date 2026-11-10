// Aschegruben (floor 1): ash greys, charcoal, basalt — lit by ember orange. All face right.
import { sprite, mix } from './helpers.js';

const ASH = ['#3d3532', '#70645c', '#a89a8e'];
const COAL = ['#171113', '#2e2528', '#4d3f42'];
const ROCK = ['#2a1f1d', '#4d3a33', '#7a5e4e'];
const BASALT = ['#1d1617', '#3a2e2e', '#5c4a46', '#806a5e'];
const E = { d: '#a8300f', m: '#ff6a1f', l: '#ffb347', h: '#fff0b8' };

// --- Aschekriecher: small many-legged ash bug -----------------------------------------
sprite('ash_crawler', 16, 12, (b, p) => {
  const st = p.step || 0, atk = p.atk || 0, by = p.bob || 0;
  // legs
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 3;
    const fwd = (st + i) % 2 === 0;
    b.px(x, 8, COAL[1]);
    b.px(x + (fwd ? 1 : -1), 9, COAL[1]);
    b.px(x + (fwd ? 1 : -1), 10, COAL[2]);
  }
  // segmented carapace: tail → head
  b.ball(1, 4 + by, 6, 5, ASH);
  b.ball(4, 3 + by, 6, 6, ASH, { sep: 0.6 });
  b.ball(8, 3 + by - atk, 6, 6, ASH, { sep: 0.6 });
  // ember seams between the plates
  b.px(5, 5 + by, E.m); b.px(5, 6 + by, E.d);
  b.px(9, 4 + by, E.l); b.px(9, 5 + by, E.m);
  // head: eye + mandibles
  const hy = by - atk;
  b.px(12, 5 + hy, E.h); b.px(11, 5 + hy, E.m);
  b.px(14, 7 + hy, COAL[2]); b.px(13, 8 + hy + (atk ? 1 : 0), COAL[2]);
  if (atk) { b.px(14, 5 + hy, COAL[2]); b.px(13, 7 + hy, E.m); }
  // antenna
  b.px(13, 2 + hy, COAL[2]); b.px(14, 1 + hy, COAL[2]);
  if (p.hurt) b.px(12, 5 + hy, COAL[0]);
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [10, { step: 0 }, { step: 1, bob: 1 }],
  attack: [6, { atk: 1 }, { atk: 1, step: 1 }],
});

// --- Zunderfledermaus: ember-eyed bat ----------------------------------------------------
sprite('cinder_bat', 20, 14, (b, p) => {
  const fl = p.flap || 0;            // 0 up, 1 mid, 2 down
  const atk = p.atk || 0;
  const cy = 7 + (fl === 0 ? 1 : fl === 2 ? -1 : 0);
  const tip = [cy - 5, cy - 1, cy + 4][fl];
  const wing = (s) => {
    const x = (v) => 9.5 + s * v;
    b.vol(COAL, (m) => {
      m.poly([[x(1.5), cy - 1], [x(5), Math.min(tip, cy - 2)], [x(8.5), tip], [x(7), tip + 3], [x(5), tip + 2 + (fl === 2 ? -1 : 1)], [x(3), cy + 2], [x(1.5), cy + 2]], 1);
    });
    // glowing membrane edge + finger bone
    b.px(x(8.5), tip, E.m);
    b.px(x(7), tip + 3, E.d);
    b.px(x(5), tip + 2 + (fl === 2 ? -1 : 1), E.d);
    b.line(x(2), cy - 1, x(5), Math.min(tip, cy - 2), COAL[2]);
  };
  wing(-1); wing(1);
  // body + ears
  b.ball(7, cy - 3, 6, 7, [COAL[0], COAL[1], '#5a4a4c'], { sep: 0.5 });
  b.px(7, cy - 4, COAL[1]); b.px(12, cy - 4, COAL[1]);
  b.px(7, cy - 5, COAL[2]); b.px(12, cy - 5, COAL[2]);
  // eyes + fangs
  b.px(8, cy - 1, p.hurt ? COAL[0] : E.h); b.px(11, cy - 1, p.hurt ? COAL[0] : E.h);
  b.px(8, cy, E.m); b.px(11, cy, E.m);
  if (atk) { b.rect(9, cy + 1, 2, 2, '#5a0f0a'); b.px(9, cy + 1, '#f4ead8'); b.px(10, cy + 1, '#f4ead8'); }
  else b.px(9, cy + 2, '#f4ead8');
}, {
  idle: [9, { flap: 0 }, { flap: 1 }, { flap: 2 }, { flap: 1 }],
  walk: [12, { flap: 0 }, { flap: 1 }, { flap: 2 }, { flap: 1 }],
  attack: [8, { flap: 0, atk: 1 }, { flap: 0, atk: 1, dy: -1 }],
  hurt: [1, { flap: 2, hurt: 1 }],
}, { anchor: 'center' });

// --- Glutspucker: squat creature with a glowing maw ------------------------------------
sprite('ember_spitter', 16, 16, (b, p) => {
  const atk = p.atk || 0, st = p.step || 0, by = p.bob || 0;
  // feet
  b.rect(2 + (st === 1 ? -1 : 0), 13, 4, 2, ROCK[0]);
  b.rect(10 + (st === 2 ? 1 : 0), 13, 4, 2, ROCK[0]);
  b.px(2 + (st === 1 ? -1 : 0), 13, ROCK[1]); b.px(10 + (st === 2 ? 1 : 0), 13, ROCK[1]);
  // body
  b.vol(ROCK, (m) => { m.oval(1, 4 + by, 14, 10 - by, 1); m.rect(2, 10, 12, 4, 1); }, { hi: '#96745e' });
  // back spines
  b.px(4, 3 + by, ROCK[1]); b.px(8, 2 + by, ROCK[2]); b.px(11, 3 + by, ROCK[1]);
  // eyes on top
  const ey = 6 + by;
  b.px(4, ey, p.hurt ? ROCK[0] : E.h); b.px(11, ey, p.hurt ? ROCK[0] : E.h);
  b.px(4, ey - 1, ROCK[0]); b.px(11, ey - 1, ROCK[0]); b.px(5, ey - 1, ROCK[0]); b.px(10, ey - 1, ROCK[0]);
  // maw
  const mw = atk ? 8 : 6, mh = atk === 2 ? 6 : atk ? 5 : 3;
  const mx = 8 - mw / 2, my = 8 + by;
  b.oval(mx - 1, my - 1, mw + 2, mh + 2, '#1a0d0c');
  b.oval(mx, my, mw, mh, atk ? E.m : E.d);
  if (mh >= 3) b.oval(mx + 1, my + 1, mw - 2, mh - 1, atk ? E.l : E.m);
  if (atk === 2) b.oval(mx + 2, my + 2, mw - 4, mh - 3, E.h);
  else if (!atk) b.px(8, my + 1, E.l);
  // teeth
  b.px(mx, my, '#d9cdbd'); b.px(mx + mw - 1, my, '#d9cdbd');
  if (atk) { b.px(mx + 2, my - 1 + 1, '#d9cdbd'); b.px(mx + mw - 3, my, '#d9cdbd'); }
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [6, { step: 1 }, { bob: 1 }, { step: 2 }, { bob: 1 }],
  attack: [5, { atk: 1, sy: 0.9, sx: 1.06 }, { atk: 2, sy: 0.84, sx: 1.1 }],
});

// --- Rußbomber: round soot ball with a lit fuse; swells before it bursts ------------------
sprite('soot_bomber', 18, 18, (b, p) => {
  const heat = p.heat || 0, st = p.step || 0, f = p.f || 0;
  const body = [mix(COAL[0], '#6a160a', heat), mix(COAL[1], '#d9451a', heat), mix('#5a4a4c', '#ffb347', heat)];
  // feet
  b.rect(5 + (st === 1 ? -1 : 0), 15, 3, 2, COAL[1]);
  b.rect(10 + (st === 2 ? 1 : 0), 15, 3, 2, COAL[1]);
  // body
  b.ball(4, 6, 10, 10, body, { hi: heat ? E.h : '#6e5d5e' });
  // heat cracks
  if (heat > 0.3) { b.px(6, 12, E.l); b.px(7, 13, E.h); b.px(11, 9, E.l); b.px(10, 13, E.l); b.px(12, 11, E.h); }
  // fuse + spark
  b.px(9, 5, '#8a6a4a'); b.px(10, 4, '#8a6a4a'); b.px(10, 3, '#a8845a');
  const sx = 11, sy = 2;
  b.px(sx, sy, E.h);
  if (f % 2 === 0) { b.px(sx + 1, sy - 1, E.l); b.px(sx - 1, sy - 1, E.m); b.px(sx + 1, sy + 1, E.m); }
  else { b.px(sx, sy - 1, E.l); b.px(sx + 1, sy, E.m); b.px(sx - 1, sy, E.m); }
  // angry eyes
  const ec = p.hurt ? COAL[0] : heat ? '#ffffff' : E.h;
  b.px(6, 10, ec); b.px(7, 10, ec); b.px(10, 10, ec); b.px(11, 10, ec);
  b.px(6, 9, body[0]); b.px(11, 9, body[0]);
  b.px(7, 11, heat ? E.l : E.m); b.px(10, 11, heat ? E.l : E.m);
}, {
  idle: [6, { f: 0 }, { f: 1 }],
  walk: [8, { f: 0, step: 1 }, { f: 1, dy: -1 }, { f: 0, step: 2 }, { f: 1, dy: -1 }],
  attack: [8, { f: 0, heat: 0.35, sx: 1.1, sy: 1.1 }, { f: 1, heat: 0.7, sx: 1.2, sy: 1.2 }, { f: 0, heat: 1, sx: 1.3, sy: 1.3 }, { f: 1, heat: 0.7, sx: 1.2, sy: 1.2 }],
});

// --- Brennofen: stationary stone kiln with glowing openings -----------------------------
sprite('kiln_turret', 20, 22, (b, p) => {
  const atk = p.atk || 0, f = p.f || 0;
  const stone = ['#2b2221', '#54433c', '#806856', '#a48a72'];
  // chimney
  b.slab(8, 1, 4, 5, stone);
  // dome + base
  b.vol(stone, (m) => { m.oval(2, 4, 16, 14, 1); m.rect(2, 11, 16, 8, 1); }, { grad: 0.6 });
  b.slab(1, 18, 18, 3, ['#1d1617', '#3d302c', '#5e4b40']);
  // brick seams
  const seam = '#2b2221';
  for (let y = 8; y < 18; y += 3) {
    for (let x = 3; x < 17; x++) if (b.on(x, y)) b.px(x, y, mix(b.get(x, y), seam, 0.55));
    for (let x = 4 + ((y / 3) % 2 ? 2 : 0); x < 17; x += 4) { if (b.on(x, y + 1)) b.px(x, y + 1, mix(b.get(x, y + 1), seam, 0.55)); if (b.on(x, y + 2)) b.px(x, y + 2, mix(b.get(x, y + 2), seam, 0.55)); }
  }
  // arched mouth
  b.oval(6, 9, 8, 7, '#120a0a'); b.rect(6, 12, 8, 6, '#120a0a');
  const g0 = atk ? E.l : f ? E.m : E.d, g1 = atk ? E.h : f ? E.l : E.m;
  b.oval(7, 10, 6, 6, atk ? E.m : E.d); b.rect(7, 13, 6, 5, atk ? E.m : E.d);
  b.rect(8, 14 - atk * 2, 4, 4 + atk * 2, g0);
  b.rect(9, 16 - atk * 2, 2, 2 + atk * 2, g1);
  if (atk === 2) { b.oval(7, 10, 6, 5, E.l); b.rect(8, 11, 4, 7, E.h); }
  // grate bars
  if (atk < 2) { b.px(8, 13, '#120a0a'); b.px(11, 13, '#120a0a'); }
  // side vents
  b.px(3, 13, g0); b.px(16, 13, g0); b.px(3, 12, '#120a0a'); b.px(16, 12, '#120a0a');
  // chimney glow
  b.rect(9, 1, 2, 1, g1);
  if (p.hurt) { b.px(3, 13, '#120a0a'); b.px(16, 13, '#120a0a'); }
}, {
  idle: [4, { f: 0 }, { f: 1 }],
  attack: [6, { atk: 1 }, { atk: 2 }],
}, {
  post(b, p) {
    // smoke / sparks from the chimney (no outline)
    const f = p.f || 0, atk = p.atk || 0;
    if (atk) { b.px(9, 0, E.h); b.px(11, 0, E.l); if (atk === 2) { b.px(8, 0, E.m); b.px(12, 1, E.m); } }
    else b.px(f ? 11 : 9, 0, f ? E.m : '#54433c');
  },
});

// --- Schlackenbrocken: big molten rock brute ----------------------------------------------
sprite('slag_brute', 28, 26, (b, p) => {
  const st = p.step || 0, atk = p.atk || 0, by = p.bob || 0, f = p.f || 0;
  const lift = atk === 1 ? -7 : atk === 2 ? 3 : 0;
  const swayL = st === 1 ? -1 : st === 3 ? 1 : 0;
  // legs
  b.slab(8, 19 + (st === 1 ? -1 : 0), 5, 6 - (st === 1 ? -1 : 0) - (st === 1 ? 1 : 0), BASALT);
  b.slab(16, 19 + (st === 3 ? -1 : 0), 5, 6 - (st === 3 ? 0 : 0), BASALT);
  // back arm (right side of the sprite, behind torso)
  b.ball(19, 13 + by - swayL + (atk ? lift : 0), 7, 8, BASALT, { grad: 0.5 });
  // torso
  b.vol(BASALT, (m) => { m.oval(5, 5 + by, 18, 16, 1); m.oval(3, 5 + by, 9, 9, 1); m.oval(16, 5 + by, 9, 9, 1); }, { grad: 0.8, hi: '#9a8272' });
  // head sunk between the shoulders
  b.ball(11, 3 + by, 7, 7, BASALT, { sep: 0.5 });
  const ec = p.hurt ? BASALT[0] : E.h;
  b.px(13, 6 + by, ec); b.px(16, 6 + by, ec);
  b.px(13, 5 + by, BASALT[0]); b.px(14, 5 + by, BASALT[0]); b.px(16, 5 + by, BASALT[0]);
  b.rect(14, 8 + by, 2, 1, atk ? E.h : E.m);
  // lava cracks across the chest
  const hot = atk || f;
  const c1 = hot ? E.l : E.m, c2 = hot ? E.h : E.l;
  b.line(9, 11 + by, 12, 14 + by, c1); b.line(12, 14 + by, 11, 18 + by, E.m);
  b.line(12, 14 + by, 16, 13 + by, c1); b.line(16, 13 + by, 19, 16 + by, E.m);
  b.px(12, 14 + by, c2); b.px(16, 13 + by, c2);
  b.px(7, 8 + by, E.d); b.px(21, 9 + by, E.d); b.px(14, 19 + by, E.d);
  // front arm + fist
  const ax = 1 + (atk === 2 ? 3 : 0), ay = 12 + by + swayL + lift;
  b.ball(ax, ay, 8, 9, BASALT, { grad: 0.6, sep: 0.6, hi: '#9a8272' });
  b.px(ax + 3, ay + 5, c1); b.px(ax + 4, ay + 4, c2); b.px(ax + 2, ay + 6, E.d);
  if (atk === 2) { b.px(ax + 1, ay + 9, E.l); b.px(ax + 7, ay + 9, E.l); }
}, {
  idle: [2.5, { f: 0 }, { f: 1, bob: 1 }],
  walk: [5, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [4, { atk: 1 }, { atk: 1, bob: -1 }, { atk: 2, bob: 1 }],
});
