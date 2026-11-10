// Props (interactables + decoration) and pickups.
import { sprite, still, mix } from './helpers.js';

const WOOD = ['#2a1810', '#4e301c', '#7a4c2a', '#a06a3c'];
const IRON = ['#262a32', '#4a525e', '#7c8796', '#b4c0cc'];
const STONE = ['#1f1d22', '#3d3a42', '#625e68', '#8c8794'];
const GOLD = ['#5a3a10', '#a8741c', '#e8b23a', '#fff0a0'];
const E = { d: '#a8300f', m: '#ff6a1f', l: '#ffb347', h: '#fff0b8' };
const CU = { d: '#6a1a9a', m: '#c04bd6', l: '#f0a0ff' };

// ---- chests (16×15) -------------------------------------------------------------------
function chest(key, body, trim, lockCol, extra) {
  still(key, 16, 15, (b) => {
    // base box
    b.slab(1, 6, 14, 8, body, { hi: body[3] });
    // lid
    b.vol(body, (m) => { m.oval(1, 1, 14, 8, 1); m.rect(1, 5, 14, 3, 1); }, { hi: body[3] });
    b.hl(1, 7, 14, body[0]);
    // metal bands
    b.slab(3, 1, 2, 13, trim); b.slab(11, 1, 2, 13, trim);
    b.hl(1, 13, 14, trim[0]);
    // lock
    b.slab(6, 6, 4, 4, lockCol, { hi: lockCol[3] });
    b.px(7, 8, '#0c0808'); b.px(8, 8, '#0c0808');
    if (extra) extra(b);
  });
}
chest('prop_chest', WOOD, IRON, GOLD);
chest('prop_chest_rare', ['#1a2240', '#2e4078', '#4a68b0', '#7a9ae0'], GOLD, GOLD, (b) => {
  b.px(4, 2, GOLD[3]); b.px(12, 2, GOLD[3]);
});
chest('prop_chest_cursed', ['#160c1e', '#2e1a3e', '#4a2c62', '#6c4a8a'], ['#2a1a2a', '#5a3a5a', '#8a5a8a', '#b88ab8'], ['#3a0a3a', '#8a1a8a', '#c04bd6', '#f0a0ff'], (b) => {
  // a watching eye on the lock
  b.rect(6, 7, 4, 2, '#f0d0ff'); b.px(7, 7, CU.d); b.px(8, 8, '#000000'); b.px(7, 8, '#000000');
  b.px(2, 3, CU.m); b.px(13, 4, CU.m);
});
still('prop_chest_open', 16, 16, (b) => {
  // open lid standing behind, glowing interior
  b.slab(1, 1, 14, 5, WOOD, { hi: WOOD[3] });
  b.slab(3, 1, 2, 5, IRON); b.slab(11, 1, 2, 5, IRON);
  b.slab(1, 7, 14, 8, WOOD, { hi: WOOD[3] });
  b.rect(2, 6, 12, 3, '#1a0c08');
  b.rect(3, 6, 10, 2, E.l); b.hl(4, 6, 8, E.h);
  b.slab(3, 7, 2, 8, IRON); b.slab(11, 7, 2, 8, IRON);
  b.hl(1, 14, 14, IRON[0]);
});

// ---- pedestal (14×16) -------------------------------------------------------------------
still('prop_pedestal', 14, 16, (b) => {
  b.slab(0, 12, 14, 4, STONE, { hi: STONE[3] });
  b.slab(3, 4, 8, 9, STONE, { hi: STONE[3] });
  b.slab(1, 2, 12, 3, STONE, { hi: STONE[3] });
  b.hl(4, 7, 6, STONE[0]); b.hl(4, 10, 6, STONE[0]);
  b.rect(3, 2, 8, 1, GOLD[2]); b.px(3, 2, GOLD[3]);
});

// ---- shrine (20×26), runes pulse -------------------------------------------------------
sprite('prop_shrine', 20, 26, (b, p) => {
  const f = p.f || 0;
  const RUNE = f ? ['#b07cff', '#e2ccff'] : ['#7a3fd0', '#b07cff'];
  // steps
  b.slab(0, 21, 20, 4, STONE, { hi: STONE[3] });
  b.slab(2, 18, 16, 4, STONE, { hi: STONE[3] });
  // monolith with arched top
  b.vol(STONE, (m) => { m.rect(4, 6, 12, 13, 1); m.oval(4, 1, 12, 11, 1); }, { grad: 0.5, hi: STONE[3] });
  // carved rune (eye/sun)
  b.ring(7, 5, 6, 6, RUNE[0]);
  b.px(9, 7, RUNE[1]); b.px(10, 7, RUNE[1]); b.px(9, 8, RUNE[1]); b.px(10, 8, RUNE[1]);
  b.vl(9, 12, 5, RUNE[0]); b.hl(7, 14, 6, RUNE[0]);
  // offering bowl with flame
  b.rect(7, 17, 6, 2, IRON[2]); b.hl(7, 17, 6, IRON[3]);
}, { idle: [2, { f: 0 }, { f: 1 }] }, {
  post(b, p) { b.px(9 + (p.f ? 1 : 0), 15, '#e2ccff'); b.px(10 - (p.f ? 1 : 0), 16, '#b07cff'); },
});

// ---- forge (24×22): anvil + glowing furnace ---------------------------------------------
sprite('prop_forge', 24, 22, (b, p) => {
  const f = p.f || 0;
  // furnace
  b.vol(STONE, (m) => { m.rect(1, 6, 12, 15, 1); m.oval(1, 1, 12, 10, 1); }, { grad: 0.5, hi: STONE[3] });
  b.rect(3, 10, 8, 7, '#140806');
  b.rect(4, 12, 6, 5, f ? E.l : E.m);
  b.rect(5, 14, 4, 3, f ? E.h : E.l);
  b.hl(4, 11, 6, E.d);
  b.rect(5, 0, 4, 2, STONE[1]);
  // anvil
  b.slab(15, 16, 6, 5, IRON);
  b.slab(16, 13, 4, 4, IRON);
  b.vol(IRON, (m) => m.poly([[12, 10], [23, 10], [23, 13], [15, 13]], 1), { hi: IRON[3] });
  b.px(22, 10, E.l);
  // hammer leaning
  b.line(21, 20, 22, 15, WOOD[2]); b.rect(20, 13, 4, 2, IRON[2]);
}, { idle: [3, { f: 0 }, { f: 1 }] }, {
  post(b, p) { b.px(6 + (p.f ? 1 : 0), 0, p.f ? E.l : E.m); },
});

// ---- fountain (22×20) -----------------------------------------------------------------
function fountain(key, full) {
  sprite(key, 22, 20, (b, p) => {
    const f = p.f || 0;
    // basin
    b.vol(STONE, (m) => { m.oval(0, 8, 22, 11, 1); }, { grad: 0.4, hi: STONE[3] });
    b.oval(2, 9, 18, 7, '#0c0a10');
    if (full) {
      b.oval(3, 10, 16, 5, '#2f8a9a');
      b.oval(5, 10, 12, 3, '#6fd8e0');
      b.px(6 + f * 3, 11, '#e8ffff'); b.px(14 - f * 2, 12, '#e8ffff');
    } else {
      b.oval(3, 10, 16, 5, '#1a1820');
      b.px(8, 12, STONE[1]); b.px(13, 11, STONE[1]);
    }
    // central pillar with bowl
    b.slab(9, 3, 4, 9, STONE, { hi: STONE[3] });
    b.vol(STONE, (m) => m.oval(6, 1, 10, 4, 1), { hi: STONE[3] });
    if (full) {
      b.oval(8, 1, 6, 2, '#6fd8e0');
      // falling water
      b.vl(7, 4 + f, 5, '#6fd8e0'); b.vl(14, 5 - f, 5, '#6fd8e0');
      b.px(7, 3 + f, '#e8ffff'); b.px(14, 4 - f + 1, '#e8ffff');
    } else {
      b.px(10, 2, STONE[0]); b.px(11, 2, STONE[0]);
      b.line(4, 14, 7, 16, STONE[0]);
    }
  }, { idle: [3, { f: 0 }, { f: 1 }] });
}
fountain('prop_fountain', true);
fountain('prop_fountain_empty', false);

// ---- portal (28×32), swirling ---------------------------------------------------------
sprite('prop_portal', 28, 32, (b, p) => {
  const f = p.f || 0;
  // stone arch
  b.vol(STONE, (m) => { m.oval(0, 0, 28, 30, 1); m.rect(0, 15, 28, 16, 1); m.oval(4, 4, 20, 24, 0); m.rect(4, 16, 20, 15, 0); }, { grad: 0.4, hi: STONE[3] });
  // swirling vortex (golden ember light)
  b.oval(4, 4, 20, 24, '#2a1404'); b.rect(4, 16, 20, 15, '#2a1404');
  const cols = ['#5a2a08', '#a8500f', '#ff8a3c', '#ffd35a', '#fff6c8'];
  for (let k = 0; k < 4; k++) {
    const rx = 9 - k * 2, ry = 11 - k * 2.5;
    b.oval(14 - rx, 17 - ry, rx * 2, ry * 2, cols[k]);
  }
  b.oval(12, 14, 4, 6, cols[4]);
  // swirl arms
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 + f * (Math.PI / 6);
    for (let t = 0; t < 10; t++) {
      const a = a0 + t * 0.32, r = 2 + t * 0.85;
      b.px(14 + Math.cos(a) * r * 0.9, 17 + Math.sin(a) * r * 1.1, t < 5 ? '#fff6c8' : '#ffd35a');
    }
  }
  // keystone + runes
  b.slab(11, 0, 6, 4, GOLD, { hi: GOLD[3] });
  b.px(2, 18, E.l); b.px(25, 18, E.l); b.px(2, 24, E.m); b.px(25, 24, E.m);
}, { idle: [8, { f: 0 }, { f: 1 }, { f: 2 }, { f: 3 }] });

// ---- barrels (12×14) --------------------------------------------------------------------
function barrel(key, body, band, extra) {
  still(key, 12, 14, (b) => {
    b.vol(body, (m) => { m.oval(0, 0, 12, 14, 1); m.rect(1, 2, 10, 10, 1); }, { grad: 0.5, hi: body[3] });
    b.hl(1, 3, 10, band[1]); b.hl(1, 10, 10, band[1]); b.hl(2, 3, 3, band[2]); b.hl(2, 10, 3, band[2]);
    b.oval(2, 0, 8, 3, body[1]); b.hl(3, 1, 6, body[0]);
    b.vl(4, 4, 6, body[0]); b.vl(8, 4, 6, body[0]);
    if (extra) extra(b);
  });
}
barrel('prop_barrel', WOOD, IRON);
barrel('prop_barrel_explosive', ['#3a0e0a', '#7a1c12', '#b83a22', '#e06a40'], IRON, (b) => {
  // hazard flame mark + fuse
  b.rect(4, 5, 4, 4, '#ffd35a'); b.px(5, 6, '#3a0e0a'); b.px(6, 6, '#3a0e0a'); b.px(5, 7, '#3a0e0a'); b.px(6, 7, '#7a1c12');
  b.px(6, 0, '#8a6a4a'); b.px(7, 0, E.h);
});

// ---- crystal (12×18) — light source, pulses -------------------------------------------
sprite('prop_crystal', 14, 18, (b, p) => {
  const f = p.f || 0;
  const CR = f ? ['#2a7a9a', '#6fd8f0', '#bff4ff', '#ffffff'] : ['#245e80', '#4fb8e0', '#a8eaff', '#ffffff'];
  b.slab(1, 14, 12, 3, STONE);
  b.vol(CR, (m) => m.poly([[3, 15], [2, 8], [4, 5], [6, 9], [5, 15]], 1), { hi: CR[3] });
  b.vol(CR, (m) => m.poly([[9, 15], [10, 9], [12, 7], [12, 15]], 1), { hi: CR[3] });
  b.vol(CR, (m) => m.poly([[5, 15], [5, 5], [7, 1], [9, 5], [9, 15]], 1), { hi: CR[3], grad: 0.4 });
  b.vl(7, 4, 9, CR[3]);
}, { idle: [2, { f: 0 }, { f: 1 }] });

// ---- torch (8×18), flame flickers -------------------------------------------------------
sprite('prop_torch', 10, 20, (b, p) => {
  const f = p.f || 0;
  b.slab(3, 9, 4, 10, WOOD, { hi: WOOD[3] });
  b.slab(2, 8, 6, 2, IRON);
  b.slab(2, 13, 6, 1, IRON);
  // flame
  const fl = [[0, 0], [1, -1], [-1, 0], [0, -1]][f];
  b.oval(2, 3, 6, 6, E.d);
  b.poly([[2, 6], [5 + fl[0], 0 + fl[1] + 1], [8, 6]], E.d);
  b.oval(3, 4, 4, 5, E.m);
  b.poly([[3, 6], [5 + fl[0], 1 + fl[1] + 1], [7, 6]], E.m);
  b.oval(4, 5, 2, 3, E.l);
  b.px(4 + (f % 2), 6, E.h);
}, { idle: [8, { f: 0 }, { f: 1 }, { f: 2 }, { f: 3 }] });

// ---- statue (18×28): hooded bearer statue ----------------------------------------------
still('prop_statue', 18, 28, (b) => {
  b.slab(1, 22, 16, 5, STONE, { hi: STONE[3] });
  b.vol(STONE, (m) => { m.poly([[5, 9], [13, 9], [15, 22], [3, 22]], 1); m.oval(5, 1, 9, 10, 1); }, { grad: 0.7, hi: STONE[3] });
  b.oval(7, 4, 5, 5, STONE[0]);
  // hands clasping an (unlit) ember
  b.rect(7, 12, 4, 3, STONE[2]); b.px(8, 12, '#5a3a2a'); b.px(9, 13, E.d);
  b.line(5, 14, 7, 18, STONE[0]); b.line(13, 14, 11, 19, STONE[0]);
  // moss/cracks
  b.px(4, 20, '#3a4a3a'); b.px(13, 17, STONE[0]); b.px(12, 18, STONE[0]);
});

// ---- bones (14×9) ---------------------------------------------------------------------
still('prop_bones', 16, 10, (b) => {
  const BN = ['#7a7060', '#bdb29c', '#ebe2cc'];
  b.vol(BN, (m) => { m.stroke(1, 7, 10, 4, 1, 2); m.disc(1.5, 7, 1.5, 1); m.disc(10, 4, 1.5, 1); });
  b.vol(BN, (m) => { m.stroke(5, 3, 13, 8, 1, 2); m.disc(5, 2.5, 1.5, 1); m.disc(13.5, 8, 1.5, 1); });
  b.vol(BN, (m) => { m.oval(8, 0, 6, 5, 1); m.rect(9, 4, 4, 2, 1); });
  b.px(9, 2, '#1a1410'); b.px(12, 2, '#1a1410'); b.px(10, 5, '#3a3020');
});

// ---- stalagmite (12×20) -----------------------------------------------------------------
still('prop_stalagmite', 12, 20, (b) => {
  b.vol(STONE, (m) => { m.poly([[1, 19], [4, 6], [6, 0], [8, 6], [11, 19]], 1); }, { grad: 0.7, hi: STONE[3] });
  b.vol(STONE, (m) => { m.poly([[7, 19], [9, 12], [11, 19]], 1); }, { sep: 0.5 });
  b.hl(3, 12, 3, STONE[0]); b.hl(4, 7, 2, STONE[0]); b.hl(2, 16, 4, STONE[0]);
});

// ---- glowing mushroom cluster (14×14) ----------------------------------------------------
sprite('prop_mushroom', 14, 14, (b, p) => {
  const f = p.f || 0;
  const G = f ? '#c8ff7a' : '#9be35a';
  const CAP = ['#24143f', '#47286f', '#6e45a8', '#9a72d6'];
  const st = (x, y, h) => { b.rect(x, y, 2, h, '#b8c8b0'); b.vl(x + 1, y, h, '#7a8a78'); };
  st(3, 8, 5); st(9, 6, 7); st(6, 10, 3);
  b.vol(CAP, (m) => m.oval(0, 4, 7, 5, 1), { hi: CAP[3] });
  b.vol(CAP, (m) => m.oval(6, 1, 8, 6, 1), { hi: CAP[3] });
  b.vol(CAP, (m) => m.oval(4, 8, 5, 3, 1));
  b.px(2, 5, G); b.px(4, 6, G); b.px(8, 2, G); b.px(11, 3, G); b.px(9, 4, G); b.px(6, 9, G);
  b.hl(1, 8, 5, CAP[0]); b.hl(7, 6, 6, CAP[0]);
}, { idle: [1.5, { f: 0 }, { f: 1 }] });

// =========================================================================================
// Pickups
// =========================================================================================
sprite('pickup_spark', 8, 8, (b, p) => {
  const f = p.f || 0;
  if (f % 2 === 0) { b.poly([[3.5, 0], [5, 3], [7, 3.5], [5, 4.5], [3.5, 7], [2, 4.5], [0, 3.5], [2, 3]], E.m); }
  else { b.poly([[3.5, 1], [5, 2], [6, 3.5], [5, 5], [3.5, 6], [2, 5], [1, 3.5], [2, 2]], E.m); }
  b.disc(3.5, 3.5, 1, E.l);
  b.px(3, 3, E.h);
}, { idle: [6, { f: 0 }, { f: 1 }] }, { outline: '#3a1206', anchor: 'center' });

sprite('pickup_xp', 8, 8, (b, p) => {
  const f = p.f || 0;
  b.poly([[3.5, 0], [7, 3.5], [3.5, 7], [0, 3.5]], f ? '#59e0b0' : '#3fc89a');
  b.poly([[3.5, 1], [5, 3], [3.5, 3.5], [2, 3]], '#c8fff0');
  b.px(3, 2, '#ffffff');
}, { idle: [4, { f: 0 }, { f: 1 }] }, { outline: '#0a2a22', anchor: 'center' });

sprite('pickup_heart', 11, 10, (b, p) => {
  const H = ['#7a0f1e', '#d9283a', '#ff6a78', '#ffd0d6'];
  b.vol(H, (m) => { m.disc(3, 3, 2.5, 1); m.disc(7, 3, 2.5, 1); m.poly([[0.5, 4], [9.5, 4], [5, 9]], 1); }, { hi: H[3] });
  if (p.f) { b.px(2, 2, '#ffffff'); }
}, { idle: [3, { f: 0 }, { f: 1, sx: 1.1, sy: 1.1 }] }, { outline: '#2a0408', anchor: 'center' });

sprite('pickup_ash', 9, 9, (b, p) => {
  // a little mound of grey ash with a glowing ember inside
  b.vol(['#3d3532', '#70645c', '#a89a8e', '#d4c8bc'], (m) => { m.oval(0, 3, 9, 6, 1); m.oval(2, 1, 5, 5, 1); }, { hi: '#e8ded2' });
  b.px(4, 5, p.f ? E.l : E.m); b.px(5, 6, E.d); b.px(3, 6, E.d);
}, { idle: [3, { f: 0 }, { f: 1 }] }, { outline: '#120c0a', anchor: 'center' });

sprite('pickup_shield', 10, 11, (b, p) => {
  const S = ['#1c4a8a', '#3a7ad9', '#7ab8ff', '#d8ecff'];
  b.vol(S, (m) => m.poly([[0, 1], [4.5, 0], [9, 1], [9, 5], [4.5, 10], [0, 5]], 1), { hi: S[3] });
  b.vl(4, 2, 6, S[0]); b.px(p.f ? 2 : 6, 2, '#ffffff');
}, { idle: [3, { f: 0 }, { f: 1 }] }, { outline: '#06142a', anchor: 'center' });

export { mix };
