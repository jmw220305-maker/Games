// Schattenkern (floor 4) + Sonnenherz (floor 5) enemies.
import { sprite, mix } from './helpers.js';

const VOID = ['#0e0a1c', '#251a44', '#45307a', '#6a4fb0'];
const INK = ['#07050e', '#151026', '#2a2048'];
const V = { d: '#7a3fd0', m: '#b07cff', l: '#e2ccff', p: '#e04bd0', P: '#ff9af0', w: '#ffffff' };
const GOLD = ['#5a3a10', '#a8741c', '#e8b23a', '#fff0a0'];
const S = { d: '#d9861a', m: '#ffd35a', l: '#fff3b0', w: '#ffffff' };

// --- Nullegel: void leech ------------------------------------------------------------------
sprite('null_leech', 16, 10, (b, p) => {
  const st = p.step || 0, atk = p.atk || 0;
  // body as an inchworm: hump moves with walk
  const hump = [0, 2, 1, 0][st];
  b.vol(VOID, (m) => {
    m.oval(1, 4 - (st === 1 ? 1 : 0), 7, 5 + (st === 1 ? 1 : 0), 1);
    m.oval(5, 3 - hump, 6, 6 + hump, 1);
    m.oval(9, 4 - (atk ? 1 : 0), 6, 5, 1);
  }, { hi: VOID[3] });
  // segment rings
  b.vl(5, 5, 3, VOID[0]); b.vl(10, 5 - hump, 3, VOID[0]);
  // glowing spots
  b.px(3, 5, V.p); b.px(7, 4 - hump, V.p); b.px(12, 5, V.p);
  // round sucker mouth
  if (atk) { b.oval(12, 3, 4, 5, INK[0]); b.ring(12, 3, 4, 5, V.P); b.px(13, 5, V.l); }
  else { b.px(14, 6, INK[0]); b.px(14, 5, V.P); }
  if (p.hurt) b.px(12, 5, INK[0]);
}, {
  idle: [3, { step: 0 }, { step: 3, sx: 1.05 }],
  walk: [8, { step: 0 }, { step: 1 }, { step: 2 }, { step: 3 }],
  attack: [8, { atk: 1, dx: 1 }, { atk: 1 }],
});

// --- Schemen: ghostly shade --------------------------------------------------------------
sprite('shade', 16, 20, (b, p) => {
  const f = p.f || 0, atk = p.atk || 0;
  const SH = [INK[0], INK[1], INK[2], '#3d3166'];
  // wispy tattered tail
  const tails = [[3, 17, 5], [6, 18, 7], [9, 17, 6], [12, 16, 4]];
  b.vol(SH, (m) => {
    m.oval(2, 2, 12, 12, 1);
    m.rect(3, 8, 10, 6, 1);
    tails.forEach(([x, y, h], i) => m.poly([[x - 1, 12], [x + 2, 12], [x + ((i + f) % 2 ? 1 : -1), y + ((i + f) % 2)]], 1));
  }, { grad: 0.5, hi: SH[3] });
  // claws reaching
  const cx = atk ? 13 : 12, cy = atk ? 7 : 9;
  b.line(10, 10, cx, cy, SH[2]); b.px(cx + 1, cy - 1, V.l); b.px(cx + 1, cy + 1, V.l); b.px(cx + 2, cy, V.l);
  // hollow face
  b.oval(6, 4, 7, 6, '#000000');
  const ec = p.hurt ? SH[1] : V.l;
  b.px(8, 6, ec); b.px(11, 6, ec); b.px(8, 7, V.m); b.px(11, 7, V.m);
  if (atk) b.oval(8, 8, 4, 2, V.m);
}, {
  idle: [4, { f: 0 }, { f: 1, dy: -1 }],
  walk: [6, { f: 0, shear: 0.1 }, { f: 1, shear: 0.1, dy: -1 }],
  attack: [6, { f: 0, atk: 1, sx: 1.08 }, { f: 1, atk: 1, sx: 1.12, dy: -1 }],
}, { outline: '#000000', anchor: 'center' });

// --- Leerenauge: floating eye ---------------------------------------------------------------
sprite('void_eye', 18, 18, (b, p) => {
  const f = p.f || 0, atk = p.atk || 0;
  // tentacles below
  for (let i = 0; i < 3; i++) {
    const x = 5 + i * 4, sway = (f + i) % 2 ? 1 : -1;
    b.bez(x, 12, x + sway, 15, x - sway, 17, VOID[1], 2, 1);
    b.px(x - sway, 17, V.p);
  }
  // eyeball shell
  b.ball(2, 2, 14, 13, VOID, { grad: 0.6, hi: VOID[3] });
  // lids / sclera
  const open = atk ? 9 : 7;
  b.oval(4, 8.5 - open / 2, 10, open, '#e8dcff');
  for (let x = 4; x < 14; x++) if (b.get(x, Math.round(8.5 - open / 2)) === b.get(9, 8)) b.px(x, Math.round(8.5 - open / 2), '#b9a4e6');
  // iris + pupil, looking right
  const ix = 9 + (atk ? 0 : 1);
  b.oval(ix - 2, 6, 5, 5, atk ? V.p : V.d);
  b.oval(ix - 1, 7, 3, 3, atk ? V.P : V.m);
  b.px(ix, 8, atk ? '#ffffff' : '#000000');
  b.px(ix - 1, 7, '#ffffff');
  if (p.hurt) { b.rect(4, 7, 10, 3, VOID[2]); b.hl(4, 8, 10, VOID[0]); }
}, {
  idle: [4, { f: 0 }, { f: 1, dy: -1 }],
  walk: [4, { f: 0 }, { f: 1, dy: -1 }],
  attack: [6, { f: 0, atk: 1, sx: 1.1, sy: 1.1 }, { f: 1, atk: 1, sx: 1.15, sy: 1.15 }],
}, { anchor: 'center' });

// --- Rissmagier: rift mage ----------------------------------------------------------------
sprite('rift_mage', 18, 22, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, cast = p.cast || 0, by = p.bob || 0;
  const ROBE = [VOID[0], VOID[1], VOID[2], VOID[3]];
  const sway = st === 0 ? 1 : st === 2 ? -1 : 0;
  // robe
  b.vol(ROBE, (m) => m.poly([[6, 7 + by], [11, 7 + by], [14 + sway, 20], [3 + sway, 20]], 1), { grad: 0.4 });
  // magenta runes down the front
  b.px(9, 12 + by, V.p); b.px(9, 15 + by, V.p); b.px(8, 18, V.p); b.hl(3 + sway, 20, 12, V.d);
  // tall hood with horn-like points
  b.vol(ROBE, (m) => { m.oval(4, 1 + by, 9, 9, 1); m.poly([[5, 3 + by], [3, -1 + by], [7, 2 + by]], 1); m.poly([[11, 3 + by], [14, -1 + by], [10, 2 + by]], 1); }, { sep: 0.5, hi: ROBE[3] });
  b.oval(7, 4 + by, 5, 5, '#000000');
  b.px(8, 6 + by, p.hurt ? INK[2] : V.P); b.px(10, 6 + by, p.hurt ? INK[2] : V.P);
  // hands + rift between them
  const hy = 11 + by - cast;
  b.px(13, hy, '#c9b4e8'); b.px(4, hy + 1, '#c9b4e8');
  if (cast) {
    const r = cast === 2 ? 3 : 2;
    b.oval(14 - r, hy - r - 2, r * 2 + 1, r * 2 + 3, '#000000');
    b.ring(14 - r, hy - r - 2, r * 2 + 1, r * 2 + 3, V.m);
    b.px(14, hy - 1, V.w);
  } else { b.px(14, hy - 1, V.m); }
}, {
  idle: [3, {}, { bob: 1 }],
  walk: [6, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [5, { cast: 1 }, { cast: 2 }],
  cast: [5, { cast: 1 }, { cast: 2 }],
  special: [8, { cast: 2, sx: 0.6, sy: 1.2 }, { cast: 2, sx: 0.3, sy: 1.4 }],
});

// --- Echoritter: armoured knight with a big shield -------------------------------------------
sprite('echo_knight', 22, 22, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, atk = p.atk || 0, by = p.bob || 0;
  const ARM = ['#141026', '#2e2850', '#524a80', '#8c84b8'];
  // legs
  const lx = st === 0 ? [-1, 1] : st === 2 ? [1, -1] : [0, 0];
  b.slab(7 + lx[0], 15, 3, 5 + (st === 1 ? -1 : 0), ARM);
  b.slab(11 + lx[1], 15, 3, 5 + (st === 3 ? -1 : 0), ARM);
  // sword (behind, raised during attack)
  if (atk) {
    b.line(4, 10 + by, 10, 1 + by, '#d8d0f0'); b.line(5, 10 + by, 11, 1 + by, '#8c84b8');
    b.rect(3, 10 + by, 3, 1, ARM[1]);
  } else { b.line(4, 6 + by, 4, 17 + by, '#d8d0f0'); b.vl(5, 7 + by, 10, '#8c84b8'); b.rect(3, 6 + by, 3, 1, ARM[2]); }
  // body
  b.vol(ARM, (m) => { m.rect(6, 7 + by, 9, 9, 1); m.oval(5, 6 + by, 11, 6, 1); }, { grad: 0.5, hi: ARM[3] });
  // helmet with plume
  b.vol(ARM, (m) => { m.oval(7, 0 + by, 7, 8, 1); }, { sep: 0.5, hi: ARM[3] });
  b.hl(9, 3 + by, 5, '#000000'); b.px(11, 3 + by, p.hurt ? ARM[1] : V.l); b.px(13, 3 + by, p.hurt ? ARM[1] : V.l);
  b.px(8, -1 + by + 1, V.p); b.px(7, 0 + by + 1, V.p);
  // tower shield on the right (front)
  const sx = atk === 2 ? 15 : 13;
  b.vol(['#2a1440', '#4a2a78', '#7a52b8', '#b892f2'], (m) => m.poly([[sx, 5 + by], [sx + 6, 5 + by], [sx + 6, 15 + by], [sx + 3, 19 + by], [sx, 15 + by]], 1), { sep: 0.6, hi: '#e2ccff' });
  // shield emblem (echo rings)
  b.ring(sx + 1, 8 + by, 5, 6, V.m);
  b.px(sx + 3, 11 + by, V.w);
}, {
  idle: [2, {}, { bob: 1 }],
  walk: [6, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [4, { atk: 1 }, { atk: 2, dx: 1 }],
});

// --- Düstermutter: large floating matron --------------------------------------------------
sprite('gloom_mother', 30, 32, (b, p) => {
  const f = p.f || 0, cast = p.cast || 0;
  // trailing veil tendrils
  for (let i = 0; i < 5; i++) {
    const x = 7 + i * 4, sway = (f + i) % 2 ? 1 : -1;
    b.bez(x, 20, x + sway * 2, 25, x - sway, 30, i % 2 ? VOID[1] : VOID[2], 3, 1);
    b.px(x - sway, 30, V.p);
  }
  // gown body
  b.vol(VOID, (m) => { m.oval(5, 10, 20, 15, 1); m.poly([[6, 18], [24, 18], [27, 24], [3, 24]], 1); }, { grad: 0.7, hi: VOID[3] });
  // arms cradling a glowing orb (womb)
  const glow = cast ? V.P : V.m;
  b.oval(11, 14, 8, 8, '#000000');
  b.oval(12, 15, 6, 6, cast ? V.p : V.d);
  b.oval(13, 16, 4, 4, glow);
  b.px(14, 17, '#ffffff');
  b.bez(7, 13, 9, 22, 14, 22, VOID[2], 2, 2); b.bez(23, 13, 21, 22, 16, 22, VOID[2], 2, 2);
  // head with tall crown/veil
  b.vol(VOID, (m) => { m.oval(10, 2, 10, 11, 1); m.poly([[10, 5], [8, 0], [12, 3]], 1); m.poly([[20, 5], [22, 0], [18, 3]], 1); m.poly([[13, 3], [15, -1], [17, 3]], 1); }, { sep: 0.5, hi: VOID[3] });
  // mask face
  b.oval(12, 4, 6, 7, '#d8ccec');
  b.px(13, 6, '#000000'); b.px(16, 6, '#000000'); b.px(13, 7, p.hurt ? '#000000' : V.p); b.px(16, 7, p.hurt ? '#000000' : V.p);
  b.vl(14, 9, 1, '#9c8cc0'); b.vl(15, 9, 1, '#9c8cc0');
  // crown gems
  b.px(15, 1, V.P); b.px(9, 1, V.p); b.px(21, 1, V.p);
}, {
  idle: [3, { f: 0 }, { f: 1, dy: -1 }],
  walk: [3, { f: 0 }, { f: 1, dy: -1 }],
  attack: [5, { f: 0, cast: 1, sx: 1.06, sy: 1.04 }, { f: 1, cast: 1, sx: 1.1, sy: 1.06 }],
  cast: [5, { f: 0, cast: 1, sx: 1.06, sy: 1.04 }, { f: 1, cast: 1, sx: 1.1, sy: 1.06 }],
}, { anchor: 'center' });

// --- Sonnensplitter: floating golden crystal ---------------------------------------------
sprite('sun_shard', 16, 20, (b, p) => {
  const f = p.f || 0, atk = p.atk || 0;
  // orbiting chips
  const o = [[2, 6], [13, 4], [12, 14], [3, 15]][f % 4];
  b.px(o[0], o[1], S.m); b.px(15 - o[0], 19 - o[1], S.d);
  // crystal
  b.vol(GOLD, (m) => m.poly([[8, 1], [12, 8], [10, 17], [6, 17], [4, 8]], 1), { grad: 0.6, hi: '#ffffff' });
  // facets
  b.line(8, 2, 8, 16, GOLD[1]); b.line(5, 8, 11, 8, GOLD[1]);
  b.px(7, 5, S.l); b.px(6, 9, S.l);
  // core
  b.oval(6, 8, 4, 5, atk ? S.w : S.m); b.px(7, 9, S.w);
  if (p.hurt) b.oval(6, 8, 4, 5, GOLD[0]);
}, {
  idle: [5, { f: 0 }, { f: 1, dy: -1 }, { f: 2, dy: -1 }, { f: 3 }],
  walk: [6, { f: 0 }, { f: 1, dy: -1 }, { f: 2, dy: -1 }, { f: 3 }],
  attack: [8, { f: 0, atk: 1, sx: 1.15, sy: 1.1 }, { f: 2, atk: 1, sx: 0.9, sy: 1.15 }],
}, { anchor: 'center' });

// --- Aschenwiedergänger: dark mirror of the Glutträger -----------------------------------
{
  const pal = {
    h: '#2a2230', H: '#463a4c', d: '#16111a', k: '#0c080e',
    f: '#000000', e: '#e8e8ff', E: '#8fd8ff',
    t: '#1f1a26', T: '#342c3c',
    1: '#3a1a6a', 2: '#7a3fd0', 3: '#e2ccff',
  };
  const W = 18, H = 20;
  const head = [
    '.......hHHh.......',
    '.....hHHHHHhd.....',
    '....hHHhhhhhhd....',
    '....hHhffffffd....',
    '....hHhfeffefd....',
    '....hhhfEffEfd....',
    '....dhhhffffdd....',
    '.....ddhhhhdd.....',
  ];
  const torso = [
    '....hHhhhhhhhd....',
    '...hHhhtt12thhd...',
    '...hHhtt1321thd...',
    '...hhhhtt12tthd...',
    '...dhhhtTttthdd...',
    '....dhhtttthdk....',
    '....kdhd..dhdk....',
  ];
  sprite('ash_revenant', W, H, (b, p) => {
    const st = p.step === undefined ? -1 : p.step, atk = p.atk || 0;
    const by = (st === 0 || st === 2 ? 1 : 0) + (p.bob || 0);
    const lx = st === 0 ? [-1, 1] : st === 2 ? [1, -1] : [0, 0];
    b.rect(6 + lx[0], 16, 2, 3, '#1a141e'); b.rect(10 + lx[1], 16, 2, 3, '#241c2a');
    b.map(torso, atk ? { ...pal, 1: '#7a3fd0', 2: '#e2ccff', 3: '#ffffff' } : pal, 0, 9 + by);
    b.map(head, pal, 0, 1 + by);
    // ashen blade
    if (atk) { b.line(13, 12 + by, 17, 4 + by, '#c9c0d8'); b.line(14, 12 + by, 17, 6 + by, '#6a6078'); }
    else { b.line(14, 11 + by, 15, 17 + by, '#8c84a0'); }
    if (p.hurt) { b.px(8, 5 + by, '#000000'); b.px(11, 5 + by, '#000000'); }
  }, {
    idle: [3, {}, { bob: 1 }],
    walk: [8, { step: 0 }, { step: 1 }, { step: 2 }, { step: 3 }],
    attack: [6, { atk: 1, shear: -0.1 }, { atk: 1, shear: 0.15, dx: 1 }],
    cast: [6, { atk: 1 }, { atk: 1, bob: -1 }],
  }, {
    post(b, p) {
      // drifting black ash flecks
      const f = (p.step === undefined ? 0 : p.step) + (p.bob ? 1 : 0);
      [[2, 4], [15, 2], [1, 10], [16, 8]].forEach(([x, y], i) => { if ((i + f) % 2 === 0) b.px(x, y, i % 2 ? '#7a3fd0' : '#463a4c'); });
    },
  });
}

export const VOID_COLORS = { mix: mix(V.m, V.p, 0.5) };
