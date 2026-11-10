// Sporengrotten (floor 2): teal flesh, purple caps, pale stalks — lit by lime/mint spores.
import { sprite, mix, alpha } from './helpers.js';

const TEAL = ['#10242c', '#1f4650', '#35706c', '#5aa090'];
const CAP = ['#2a1a50', '#523592', '#8a5fd0', '#b892f2'];
const STEM = ['#5a6c62', '#9db39a', '#d8e6c6'];
const MOSS = ['#17301f', '#2f5a36', '#5a964a'];
const MUD = ['#141a18', '#2c3a34', '#4a5e52'];
const G = { d: '#3f8a2a', m: '#9be35a', l: '#dcff9e', mint: '#59e0b0', w: '#f4ffe0' };
const DARK = '#0a1114';

// --- Sporling: little walking puffball ---------------------------------------------------
sprite('spore_puff', 14, 14, (b, p) => {
  const st = p.step || 0, puff = p.puff || 0, by = p.bob || 0;
  // feet
  b.rect(4 + (st === 1 ? -1 : 0), 11, 2, 2, STEM[0]);
  b.rect(8 + (st === 2 ? 1 : 0), 11, 2, 2, STEM[0]);
  // stalk body with face
  b.ball(3, 6 + by, 8, 6, STEM);
  // cap
  const g = puff ? 1 : 0;
  b.vol(CAP, (m) => { m.oval(1 - g, 1 + by - g, 12 + g * 2, 7 + g, 1); }, { sep: 0.6, hi: CAP[3] });
  // glowing spots
  const sc = puff ? G.l : G.m;
  b.px(4, 3 + by - g, sc); b.px(8, 2 + by - g, sc); b.px(10, 5 + by - g, sc); b.px(6, 6 + by, G.d);
  // face peeking out under the cap
  const fy = 9 + by;
  b.px(6, fy, p.hurt ? STEM[0] : G.l); b.px(9, fy, p.hurt ? STEM[0] : G.l);
  b.px(6, fy + 1, DARK); b.px(9, fy + 1, DARK);
  if (puff) { b.px(4, 2 + by - g, G.w); b.px(8, 1 + by - g, G.w); b.px(2, 5 + by, sc); }
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [7, { step: 1 }, { bob: 1 }, { step: 2 }, { bob: 1 }],
  attack: [6, { puff: 1 }, { puff: 1, sy: 0.92, sx: 1.08 }],
}, {
  post(b, p) {
    if (!p.puff) return;
    b.px(1, 1, G.m); b.px(12, 0, G.l); b.px(13, 4, G.m); b.px(0, 6, G.d);
  },
});

// --- Fäulnisschwarm: tiny gnat -----------------------------------------------------------
sprite('rot_swarm', 8, 8, (b, p) => {
  const f = p.f || 0;
  // wings
  const wy = f ? 4 : 1;
  b.px(1, wy, '#b9d6c8'); b.px(2, wy + (f ? -1 : 1), '#8fb3a6');
  b.px(6, wy, '#b9d6c8'); b.px(5, wy + (f ? -1 : 1), '#8fb3a6');
  // body
  b.ball(2, 2, 4, 4, [MOSS[0], MOSS[1], MOSS[2]]);
  b.px(4, 3, p.hurt ? DARK : G.l);
  if (p.atk) { b.px(5, 4, '#f4ffe0'); b.px(3, 3, G.l); }
}, {
  idle: [14, { f: 0 }, { f: 1 }],
  attack: [14, { f: 0, atk: 1 }, { f: 1, atk: 1 }],
}, { anchor: 'center' });

// --- Pilzschütze: mushroom with a cannon cap --------------------------------------------
sprite('myco_shooter', 18, 20, (b, p) => {
  const atk = p.atk || 0, by = p.bob || 0, st = p.step || 0;
  const back = atk === 1 ? -1 : 0;
  // root feet
  b.rect(5 + (st === 1 ? -1 : 0), 17, 3, 2, STEM[0]);
  b.rect(10 + (st === 2 ? 1 : 0), 17, 3, 2, STEM[0]);
  // stalk
  b.vol(STEM, (m) => { m.rect(6, 9 + by, 6, 8 - by, 1); m.oval(5, 12, 8, 6, 1); });
  // face
  b.px(8, 12 + by, DARK); b.px(11, 12 + by, DARK);
  b.px(8, 11 + by, STEM[0]); b.px(11, 11 + by, STEM[0]);
  if (!p.hurt) b.px(11, 12 + by, '#16323a');
  b.rect(9, 14 + by, 2, 1, STEM[0]);
  // cap: fat barrel tilted up-right
  const cx = 1 + back, cy = 2 + by + (atk === 1 ? 1 : 0);
  b.vol(CAP, (m) => { m.oval(cx, cy, 14, 9, 1); m.oval(cx + 8, cy - 1, 8, 9, 1); }, { sep: 0.6, grad: 0.5, hi: CAP[3] });
  // spots
  b.px(cx + 3, cy + 2, G.m); b.px(cx + 6, cy + 5, G.d); b.px(cx + 2, cy + 5, G.m);
  // muzzle
  const mx = cx + 10, my = cy;
  b.oval(mx, my, 6, 7, CAP[3]);
  b.oval(mx + 1, my + 1, 4, 5, '#120a22');
  if (atk === 1) { b.oval(mx + 2, my + 2, 2, 3, G.m); }
  else if (atk === 2) { b.oval(mx + 1, my + 1, 4, 5, G.m); b.oval(mx + 2, my + 2, 2, 3, G.w); }
  else b.px(mx + 2, my + 3, G.d);
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [6, { step: 1 }, { bob: 1 }, { step: 2 }, { bob: 1 }],
  attack: [5, { atk: 1, sy: 0.92 }, { atk: 2 }],
});

// --- Rankenpeitscher: rooted plant with a thorned whip ------------------------------------
sprite('vine_lasher', 24, 22, (b, p) => {
  const f = p.f || 0, atk = p.atk || 0;
  const VINE = [MOSS[0], MOSS[1], MOSS[2]];
  // roots
  b.line(7, 19, 3, 20, MOSS[0]); b.line(9, 19, 8, 20, MOSS[0]); b.line(13, 19, 17, 20, MOSS[0]); b.px(2, 20, MOSS[1]); b.px(18, 20, MOSS[1]);
  // whip (behind the bulb)
  let pts;
  if (atk === 1) pts = [13, 15, 20, 6, 8, 1];          // coiled back over the head
  else if (atk === 2) pts = [13, 15, 18, 9, 22, 13];   // lashed out to the right
  else pts = f ? [13, 15, 22, 13, 19, 5] : [13, 15, 21, 12, 20, 4];
  b.bez(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], VINE[1], 2, 1);
  b.bez(pts[0], pts[1] - 1, pts[2], pts[3] - 1, pts[4], pts[5], VINE[2], 1, 1);
  b.px(pts[4], pts[5], G.l);
  // thorns
  const tx = (pts[0] + 2 * pts[2] + pts[4]) / 4, ty = (pts[1] + 2 * pts[3] + pts[5]) / 4;
  b.px(tx + 1, ty - 1, '#e6f2c8'); b.px((pts[0] + pts[2]) / 2 + 1, (pts[1] + pts[3]) / 2 + 2, '#e6f2c8');
  // bulb
  b.ball(5, 12, 10, 8, [TEAL[0], TEAL[1], TEAL[2]], { hi: TEAL[3] });
  b.px(8, 15, TEAL[0]); b.px(11, 16, TEAL[0]); b.px(7, 17, TEAL[2]);
  // neck + bud head
  const hx = 5 + (atk === 2 ? 2 : atk === 1 ? -1 : 0), hy = 3 + (f && !atk ? 1 : 0);
  b.rect(9 + (atk === 2 ? 1 : 0), hy + 6, 2, 12 - hy - 6 + 1, MOSS[1]);
  b.vol(CAP, (m) => { m.oval(hx, hy, 10, 8, 1); m.poly([[hx + 1, hy + 2], [hx - 1, hy - 1], [hx + 3, hy + 1]], 1); m.poly([[hx + 8, hy + 2], [hx + 10, hy - 1], [hx + 6, hy + 1]], 1); }, { sep: 0.6, hi: CAP[3] });
  // toothy glowing mouth
  const open = atk ? 3 : 1;
  b.rect(hx + 2, hy + 4, 7, open, atk ? G.l : G.m);
  b.px(hx + 2, hy + 4, '#f4ffe0'); b.px(hx + 4, hy + 4, '#f4ffe0'); b.px(hx + 6, hy + 4, '#f4ffe0'); b.px(hx + 8, hy + 4, '#f4ffe0');
  if (open > 1) { b.px(hx + 3, hy + 4 + open - 1, '#f4ffe0'); b.px(hx + 5, hy + 4 + open - 1, '#f4ffe0'); b.px(hx + 7, hy + 4 + open - 1, '#f4ffe0'); }
  if (p.hurt) b.rect(hx + 2, hy + 4, 7, 1, DARK);
}, {
  idle: [3, { f: 0 }, { f: 1 }],
  attack: [5, { atk: 1 }, { atk: 1, f: 1 }, { atk: 2 }],
});

// --- Brutkapsel: pulsing egg sac -------------------------------------------------------------
sprite('brood_pod', 20, 20, (b, p) => {
  const f = p.f || 0, open = p.open || 0;
  const FLESH = ['#1c1638', '#3a2c66', '#5c4a94', '#8672c0'];
  // root tendrils
  b.line(6, 17, 2, 18, TEAL[1]); b.line(13, 17, 17, 18, TEAL[1]); b.px(9, 18, TEAL[1]); b.px(1, 18, TEAL[2]); b.px(18, 18, TEAL[2]);
  // sac
  b.vol(FLESH, (m) => { m.oval(3, 3, 14, 15, 1); m.rect(6, 15, 8, 3, 1); }, { grad: 0.7, hi: FLESH[3] });
  // veins
  b.line(5, 9, 8, 6, FLESH[0]); b.line(14, 13, 12, 16, FLESH[0]); b.px(8, 15, FLESH[0]);
  // glowing membrane windows with embryos
  const win = (x, y, w, h) => {
    b.oval(x - 1, y - 1, w + 2, h + 2, FLESH[0]);
    b.oval(x, y, w, h, f ? G.m : G.d);
    b.px(x + 1, y + 1, f ? G.l : G.m);
    b.px(x + w - 2, y + h - 2, DARK);
  };
  win(6, 7, 4, 5); win(11, 9, 4, 4); win(8, 13, 3, 3);
  // top opening
  if (open) {
    b.oval(7, 2, 6, 3 + open, DARK);
    b.oval(8, 3, 4, 1 + open, open > 1 ? G.l : G.m);
    b.px(6, 3, FLESH[3]); b.px(13, 3, FLESH[3]);
  } else { b.px(9, 3, FLESH[0]); b.px(10, 3, FLESH[0]); }
}, {
  idle: [2.5, { f: 0 }, { f: 1, sx: 1.06, sy: 1.04 }],
  attack: [5, { f: 1, open: 1, sx: 1.08, sy: 0.96 }, { f: 1, open: 2, sx: 0.96, sy: 1.08 }],
  cast: [5, { f: 1, open: 1, sx: 1.08, sy: 0.96 }, { f: 1, open: 2, sx: 0.96, sy: 1.08 }],
  hurt: [1, { f: 0, sx: 0.94, sy: 0.94 }],
});

// --- Moorpirscher: burrowing predator -------------------------------------------------------
sprite('mire_stalker', 24, 16, (b, p) => {
  const st = p.step || 0, atk = p.atk || 0, by = p.bob || 0;
  const HIDE = [TEAL[0], TEAL[1], TEAL[2]];
  if (p.burrow) {
    // mound of mud with spines and eyes peeking out
    const f = p.f || 0;
    b.vol(MUD, (m) => { m.oval(3, 8, 18, 10, 1); }, { hi: '#64796a' });
    b.rect(2, 14, 20, 2, 0);
    for (let x = 3; x < 21; x++) if (b.on(x, 13)) b.px(x, 13, MUD[0]);
    b.px(8, 7 - f, '#d8e6c6'); b.px(8, 8 - f, STEM[1]); b.px(12, 6 - f, '#d8e6c6'); b.px(12, 7 - f, STEM[1]); b.px(15, 7, '#d8e6c6'); b.px(15, 8, STEM[1]);
    b.px(17, 11, G.l); b.px(19, 11, G.l);
    b.px(5, 12, MUD[2]); b.px(1, 13, MUD[1]); b.px(22, 13, MUD[1]); b.px(10, 11, MUD[0]);
    return;
  }
  // legs
  const leg = (x, ph) => {
    const fwd = ph === 0 ? 1 : ph === 2 ? -1 : 0;
    b.rect(x + fwd, 11, 2, 3 - (ph === 1 ? 1 : 0), HIDE[0]);
    b.px(x + fwd + 1, 13 - (ph === 1 ? 1 : 0), HIDE[1]);
  };
  leg(5, st % 4); leg(13, (st + 2) % 4);
  // tail
  b.vol(HIDE, (m) => m.poly([[5, 7 + by], [0, 9 + by + (st % 2)], [1, 10 + by + (st % 2)], [6, 11 + by]], 1));
  // body
  b.vol(HIDE, (m) => { m.oval(3, 5 + by, 14, 7, 1); }, { hi: TEAL[3] });
  // belly
  for (let x = 6; x < 15; x++) if (b.on(x, 11 + by)) b.px(x, 11 + by, '#6a8a78');
  // dorsal spines
  for (let i = 0; i < 4; i++) { b.px(5 + i * 3, 4 + by, '#d8e6c6'); b.px(5 + i * 3, 5 + by, STEM[1]); }
  // head: upper jaw + lower jaw
  const up = atk ? -2 : 0;
  b.vol(HIDE, (m) => m.poly([[14, 5 + by], [17, 4 + by + up], [22, 6 + by + up], [22, 8 + by + up], [14, 9 + by]], 1), { sep: 0.5, hi: TEAL[3] });
  b.vol(HIDE, (m) => m.poly([[14, 9 + by], [21, 9 + by + (atk ? 2 : 0)], [21, 10 + by + (atk ? 2 : 0)], [15, 11 + by]], 1));
  if (atk) {
    b.poly([[16, 8 + by], [21, 7 + by], [20, 10 + by], [16, 9 + by]], '#5a0f1e');
    b.px(18, 7 + by, '#f4ffe0'); b.px(20, 7 + by, '#f4ffe0'); b.px(19, 10 + by, '#f4ffe0'); b.px(17, 10 + by, '#f4ffe0');
  } else { b.px(18, 9 + by, '#f4ffe0'); b.px(20, 9 + by, '#f4ffe0'); }
  // eye
  b.px(17, 6 + by + up, p.hurt ? DARK : G.l); b.px(16, 6 + by + up, DARK);
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [9, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [6, { atk: 1 }, { atk: 1, dx: 1 }],
  special: [3, { burrow: 1, f: 0 }, { burrow: 1, f: 1 }],
});

export const FUNGAL_GLOW = alpha(mix(G.m, G.mint, 0.5), 1);
