// Frostadern (floor 3): steel blues, white snow, cyan ice — lit by pale cyan cores.
import { sprite } from './helpers.js';

const ICE = ['#2c5a86', '#5fa6d6', '#a8e2ff', '#f0fbff'];
const SNOW = ['#7f9cb8', '#c4d8ea', '#f2f8ff'];
const FUR = ['#3a4c66', '#7890ad', '#b8cce0', '#e6f0fa'];
const ROBE = ['#1c2a52', '#334a86', '#5470b8'];
const C = { d: '#1fb4f0', m: '#8fd8ff', l: '#d9f6ff', w: '#ffffff' };
const DARK = '#0b1420';

// --- Frostirrlicht: floating wisp ------------------------------------------------------
sprite('frost_wisp', 14, 16, (b, p) => {
  const f = p.f || 0, atk = p.atk || 0;
  // flickering tail
  const tl = [[6, 12], [7, 13], [6, 14]];
  tl.forEach(([x, y], i) => b.px(x + ((f + i) % 2 ? 1 : 0), y, i ? ICE[1] : ICE[2]));
  b.px(5 + (f % 2), 11, ICE[2]); b.px(8 - (f % 2), 11, ICE[1]);
  // flame body
  b.vol([ICE[1], ICE[2], ICE[3]], (m) => { m.oval(3, 4, 8, 8, 1); m.poly([[5, 5], [7, 0 + (f % 2)], [9, 5]], 1); m.poly([[3, 7], [2, 3 - (f % 2)], [6, 5]], 1); m.poly([[11, 7], [12, 4 + (f % 2)], [8, 5]], 1); });
  // core
  b.oval(5, 6, 4, 5, atk ? C.w : C.l);
  b.px(6, 8, p.hurt ? ICE[0] : DARK); b.px(8, 8, p.hurt ? ICE[0] : DARK);
  if (atk) { b.px(7, 10, DARK); }
}, {
  idle: [6, { f: 0 }, { f: 1, dy: -1 }, { f: 0, dy: -1 }, { f: 1 }],
  walk: [8, { f: 0 }, { f: 1, dy: -1 }, { f: 0, dy: -1 }, { f: 1 }],
  attack: [8, { f: 0, atk: 1, sx: 1.12, sy: 1.12 }, { f: 1, atk: 1, sx: 1.2, sy: 1.2 }],
}, { outline: '#06101c', anchor: 'center' });

// --- Gletscherschleim: translucent ice slime with a frozen core ---------------------------
function slime(key, w, h, scale) {
  sprite(key, w, h, (b, p) => {
    const sq = p.sq || 0, atk = p.atk || 0;
    const bw = Math.round((w - 4) * (1 + sq * 0.12)), bh = Math.round((h - 5) * (1 - sq * 0.15));
    const x = Math.round((w - bw) / 2), y = h - 2 - bh;
    b.vol(['#2f73a6', '#5fb0e0', '#a2dcf6'], (m) => { m.oval(x, y, bw, bh + 3, 1); m.rect(x, y + bh - 2, bw, 2, 1); }, { grad: 0.5, hi: '#ffffff' });
    // flat bottom
    for (let xx = x; xx < x + bw; xx++) if (b.on(xx, h - 2)) b.px(xx, h - 2, '#2a5f8a');
    // frozen core shard
    const cx = Math.round(w / 2) - 1, cy = y + Math.round(bh * 0.55);
    if (scale > 1) {
      b.poly([[cx, cy - 3], [cx + 3, cy], [cx, cy + 3], [cx - 2, cy]], '#d9f6ff');
      b.px(cx, cy - 1, '#ffffff'); b.px(cx + 1, cy, C.m); b.px(cx, cy + 1, C.d);
    } else b.px(cx, cy, '#ffffff');
    // eyes
    const ey = y + Math.max(2, Math.round(bh * 0.3));
    const ex = Math.round(w / 2) + (scale > 1 ? 1 : 0);
    const ec = p.hurt ? '#2a5f8a' : DARK;
    b.px(ex, ey, ec); b.px(ex + (scale > 1 ? 4 : 2), ey, ec);
    if (scale > 1) { b.px(ex, ey + 1, ec); b.px(ex + 4, ey + 1, ec); }
    if (atk && scale > 1) b.rect(ex + 1, ey + 3, 3, 1, DARK);
    // gloss
    b.px(x + 2, y + 2, '#ffffff'); if (scale > 1) b.px(x + 3, y + 1, '#ffffff');
  }, {
    idle: [3, {}, { sq: 0.5 }],
    walk: [6, { sq: -0.6, dy: -1 }, { sq: -0.3, dy: -2 }, { sq: 0.2 }, { sq: 1 }],
    attack: [6, { sq: 1.2, atk: 1 }, { sq: -0.8, atk: 1, dy: -2 }],
  });
}
slime('glacier_slime', 22, 18, 2);
slime('glacier_slime_small', 12, 10, 1);

// --- Reifwolf: frost-furred wolf ----------------------------------------------------------
sprite('rime_wolf', 24, 16, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, atk = p.atk || 0, by = p.bob || 0;
  // legs: gallop pairs
  const legs = st < 0 ? [[6, 0], [9, 0], [15, 0], [18, 0]]
    : [[[5, 1], [8, -1], [16, 1], [19, -1]], [[6, 0], [8, 0], [15, -1], [18, 1]], [[7, -1], [9, 1], [14, -1], [17, 1]], [[6, 0], [9, 0], [16, 0], [18, 0]]][st];
  legs.forEach(([x, k], i) => {
    const far = i % 2 === 0;
    b.rect(x + (k > 0 ? 1 : 0), 10 + by, 2, 4, far ? FUR[0] : FUR[1]);
    b.px(x + (k > 0 ? 1 : 0) + k, 14, far ? FUR[0] : FUR[2]);
    b.px(x + (k > 0 ? 1 : 0) + k + 1, 14, far ? FUR[0] : FUR[1]);
  });
  // tail
  b.vol(FUR, (m) => m.poly([[5, 6 + by], [1, 3 + by + (st % 2 ? 1 : 0)], [0, 5 + by], [4, 9 + by]], 1), { hi: FUR[3] });
  // body
  b.vol(FUR, (m) => { m.oval(3, 5 + by, 16, 7, 1); }, { grad: 0.5, hi: FUR[3] });
  // frost spikes along the back
  [[7, 4], [10, 3], [13, 4]].forEach(([x, y]) => { b.px(x, y + by, C.l); b.px(x + 1, y + by + 1, C.m); });
  // head
  const hx = atk ? 16 : 15, hy = (atk ? 4 : 2) + by;
  b.vol(FUR, (m) => { m.oval(hx, hy, 7, 6, 1); m.poly([[hx + 4, hy + 2], [hx + 9, hy + 3], [hx + 9, hy + 5], [hx + 4, hy + 5]], 1); }, { sep: 0.5, hi: FUR[3] });
  // ears
  b.px(hx + 1, hy - 1, FUR[1]); b.px(hx + 1, hy - 2, FUR[2]); b.px(hx + 3, hy - 1, FUR[2]);
  // jaw / teeth
  if (atk) { b.rect(hx + 5, hy + 5, 4, 1, '#5a0f1e'); b.px(hx + 6, hy + 5, '#ffffff'); b.px(hx + 8, hy + 5, '#ffffff'); b.rect(hx + 5, hy + 6, 4, 1, FUR[1]); }
  b.px(hx + 9, hy + 3, DARK);
  // eye
  b.px(hx + 4, hy + 2, p.hurt ? FUR[0] : C.w); b.px(hx + 5, hy + 2, p.hurt ? FUR[0] : C.d);
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [10, { step: 0 }, { step: 1, bob: -1 }, { step: 2 }, { step: 3, bob: -1 }],
  attack: [6, { atk: 1, sy: 0.9 }, { atk: 1, step: 0, dx: 1 }],
});

// --- Splitterschütze: crystalline archer --------------------------------------------------
sprite('shard_archer', 20, 20, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, atk = p.atk || 0, by = p.bob || 0;
  const CR = ['#2c5a86', '#5fa6d6', '#a8e2ff', '#e8f8ff'];
  // legs (crystal spikes)
  const lx = st === 0 ? [-1, 1] : st === 2 ? [1, -1] : [0, 0];
  b.vol(CR, (m) => { m.poly([[7 + lx[0], 13], [9 + lx[0], 13], [8 + lx[0], 18]], 1); m.poly([[10 + lx[1], 13], [12 + lx[1], 13], [11 + lx[1], 18]], 1); });
  // torso shard
  b.vol(CR, (m) => m.poly([[6, 7 + by], [9, 5 + by], [13, 7 + by], [12, 13 + by], [7, 13 + by]], 1), { grad: 0.6, hi: '#ffffff' });
  // facets
  b.line(9, 6 + by, 9, 12 + by, CR[0]); b.px(10, 8 + by, CR[3]);
  // head crystal
  b.vol(CR, (m) => m.poly([[8, 4 + by], [10, 0 + by], [12, 4 + by], [10, 6 + by]], 1), { sep: 0.5, hi: '#ffffff' });
  b.px(11, 3 + by, p.hurt ? CR[0] : C.d);
  // bow: arc on the right
  const bx = 15 + (atk ? 1 : 0), drawn = atk ? 2 : 0;
  b.bez(bx - 2, 3 + by, bx + 2, 10 + by, bx - 2, 17 + by, '#d9f6ff', 1, 1);
  b.px(bx, 10 + by, '#ffffff');
  // string
  b.line(bx - 2, 4 + by, bx - 2 - drawn, 10 + by, '#7fb6d8'); b.line(bx - 2 - drawn, 10 + by, bx - 2, 16 + by, '#7fb6d8');
  // arm
  b.line(12, 9 + by, bx - 1, 10 + by, CR[1]);
  // nocked shard arrow
  if (atk) {
    b.line(bx - 4, 10 + by, bx + 3, 10 + by, '#ffffff'); b.px(bx + 4, 10 + by, C.m);
    if (atk === 2) { b.px(bx + 4, 9 + by, C.l); b.px(bx + 4, 11 + by, C.l); }
  }
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [7, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [4, { atk: 1 }, { atk: 2 }],
});

// --- Schneebeschwörer: robed caster -------------------------------------------------------
sprite('snow_caster', 20, 22, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, cast = p.cast || 0, by = p.bob || 0;
  // staff (behind)
  const sx = 15;
  b.line(sx, 4 + by - cast, sx, 20, '#6a5a4a'); b.line(sx + 1, 5 + by - cast, sx + 1, 19, '#3e3228');
  // staff crystal
  const cy = 3 + by - cast * 2;
  b.poly([[sx, cy - 3], [sx + 2, cy], [sx, cy + 2], [sx - 2, cy]], cast ? '#ffffff' : C.l);
  b.px(sx, cy, cast ? C.m : C.d);
  // robe
  const sway = st === 0 ? 1 : st === 2 ? -1 : 0;
  b.vol(ROBE, (m) => m.poly([[7, 7 + by], [12, 7 + by], [15 + sway, 20], [3 + sway, 20]], 1), { grad: 0.4 });
  // snow trim & sash
  b.hl(3 + sway, 20, 13, SNOW[2]); b.hl(4 + sway, 19, 11, SNOW[1]);
  b.line(8, 10 + by, 11, 14 + by, SNOW[1]);
  // hood
  b.vol(ROBE, (m) => { m.oval(5, 1 + by, 9, 9, 1); m.poly([[5, 4 + by], [3, 9 + by], [7, 8 + by]], 1); }, { sep: 0.5, hi: ROBE[2] });
  b.oval(8, 3 + by, 6, 6, DARK);
  // glowing eyes
  b.px(10, 5 + by, p.hurt ? DARK : C.l); b.px(12, 5 + by, p.hurt ? DARK : C.l);
  // snow on hood
  b.hl(7, 1 + by, 4, SNOW[2]); b.px(6, 2 + by, SNOW[1]);
  // hand
  b.rect(13, 10 + by - cast, 2, 2, '#b8cce0');
  if (cast) { b.px(12, 4 + by - cast * 2, C.m); b.px(18, 2 + by - cast * 2, C.l); }
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [6, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [5, { cast: 1 }, { cast: 2 }],
  cast: [5, { cast: 1 }, { cast: 2 }],
}, {
  post(b, p) {
    if (!p.cast) return;
    // swirling snowflakes
    const pts = p.cast === 1 ? [[17, 0], [12, 1], [19, 6]] : [[18, 1], [11, 0], [19, 4], [13, 3]];
    pts.forEach(([x, y]) => b.px(x, y, '#ffffff'));
  },
});

// --- Eisgolem: hulking ice golem --------------------------------------------------------
sprite('ice_golem', 28, 28, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, atk = p.atk || 0, by = p.bob || 0;
  const STONE = ['#1c2a3c', '#3c5470', '#64819e', '#93adc4'];
  const lift = atk === 1 ? -6 : atk === 2 ? 4 : 0;
  // legs
  b.slab(8, 20 + (st === 1 ? -1 : 0), 5, 7 - (st === 1 ? 0 : 0), STONE);
  b.slab(16, 20 + (st === 3 ? -1 : 0), 5, 7, STONE);
  // back arm
  b.ball(20, 11 + by + lift, 7, 10, STONE, { grad: 0.5 });
  // body: stone with ice armour
  b.vol(STONE, (m) => { m.oval(4, 6 + by, 20, 16, 1); }, { grad: 0.7, hi: STONE[3] });
  // ice crystals growing from the shoulders
  b.vol(ICE, (m) => { m.poly([[6, 9 + by], [8, 1 + by], [11, 8 + by]], 1); m.poly([[10, 7 + by], [13, 0 + by], [15, 7 + by]], 1); m.poly([[16, 8 + by], [20, 2 + by], [21, 9 + by]], 1); }, { sep: 0.5, hi: '#ffffff' });
  // face: dark recess + glowing eyes
  b.rect(12, 11 + by, 8, 4, '#0f1a28');
  b.px(14, 12 + by, p.hurt ? STONE[0] : C.w); b.px(18, 12 + by, p.hurt ? STONE[0] : C.w);
  b.px(14, 13 + by, C.d); b.px(18, 13 + by, C.d);
  // chest core
  b.poly([[13, 16 + by], [15, 14 + by], [17, 16 + by], [15, 19 + by]], atk ? '#ffffff' : C.m);
  b.px(15, 16 + by, atk ? C.m : C.l);
  // cracks
  b.line(7, 14 + by, 9, 18 + by, STONE[0]); b.line(20, 16 + by, 22, 19 + by, STONE[0]);
  // front arm: huge ice fist
  const ax = 1 + (atk === 2 ? 3 : 0), ay = 11 + by + lift;
  b.ball(ax, ay, 8, 8, STONE, { sep: 0.6, hi: STONE[3] });
  b.vol(ICE, (m) => m.oval(ax - 0.5, ay + 6, 9, 7, 1), { sep: 0.5, hi: '#ffffff' });
  b.px(ax + 3, ay + 8, '#ffffff');
}, {
  idle: [2, {}, { bob: 1 }],
  walk: [4, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [4, { atk: 1 }, { atk: 1, bob: -1 }, { atk: 2, bob: 1 }],
});
