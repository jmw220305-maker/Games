// Bosses (40–64 px). All face right; anims idle/walk/attack/cast/special/hurt.
import { sprite, mix, hash2 } from './helpers.js';

const E = { d: '#a8300f', m: '#ff6a1f', l: '#ffb347', h: '#fff0b8', w: '#ffffff' };

/** Jagged crack polyline from (x, y) heading roughly (dx, dy), deterministic by seed. */
function crack(b, x, y, dx, dy, len, col, hot, seed) {
  let px = x, py = y;
  for (let i = 0; i < len; i++) {
    const h = hash2(i, seed, 77);
    const nx = px + dx + ((h & 3) === 0 ? 1 : (h & 3) === 1 ? -1 : 0) * (dy !== 0 ? 1 : 0);
    const ny = py + dy + (((h >> 2) & 3) === 0 ? 1 : ((h >> 2) & 3) === 1 ? -1 : 0) * (dx !== 0 ? 1 : 0);
    b.line(px, py, nx, ny, col);
    px = nx; py = ny;
  }
  if (hot) b.px(x, y, hot);
}

// =========================================================================================
// Schlackenkönig — molten golem king with a slag crown (48×50)
// =========================================================================================
sprite('boss_cinder', 48, 50, (b, p) => {
  const st = p.step === undefined ? -1 : p.step, atk = p.atk || 0, by = p.bob || 0;
  const rage = p.rage || 0, cast = p.cast || 0;
  const ROCK = rage ? ['#2a1210', '#5a2a1c', '#8a4630', '#b86a48'] : ['#1a1314', '#352a2a', '#57463f', '#7e675a'];
  const c1 = rage || cast ? E.l : E.m, c2 = rage || cast ? E.h : E.l;
  // legs
  const ll = st === 1 ? -2 : st === 3 ? 1 : 0, rl = st === 3 ? -2 : st === 1 ? 1 : 0;
  b.slab(13, 36 + ll, 8, 12 - ll, ROCK, { hi: ROCK[3] });
  b.slab(27, 36 + rl, 8, 12 - rl, ROCK, { hi: ROCK[3] });
  b.hl(14, 44 + ll, 6, E.d); b.hl(28, 44 + rl, 6, E.d);
  // back arm
  const armUp = atk === 1 || cast ? -12 : atk === 2 ? 4 : 0;
  b.vol(ROCK, (m) => { m.oval(34, 17 + by + armUp, 12, 12, 1); m.oval(35, 25 + by + armUp, 11, 11, 1); }, { grad: 0.5 });
  b.px(40, 30 + by + armUp, c1); b.px(41, 31 + by + armUp, c2);
  // torso
  b.vol(ROCK, (m) => { m.oval(7, 13 + by, 34, 28, 1); m.oval(4, 13 + by, 14, 14, 1); m.oval(30, 13 + by, 14, 14, 1); }, { grad: 0.85, hi: ROCK[3] });
  // lava cracks from the core
  const cx = 24, cy = 27 + by;
  crack(b, cx, cy, -1, -1, 7, c1, null, 1);
  crack(b, cx, cy, 1, -1, 8, c1, null, 2);
  crack(b, cx, cy, -1, 1, 7, c1, null, 3);
  crack(b, cx, cy, 1, 1, 6, c1, null, 4);
  crack(b, 9, 20 + by, 1, 0, 4, E.d, null, 5);
  crack(b, 38, 22 + by, -1, 1, 4, E.d, null, 6);
  // molten heart
  b.oval(cx - 4, cy - 4, 9, 9, '#3a0d08');
  b.oval(cx - 3, cy - 3, 7, 7, c1);
  b.oval(cx - 2, cy - 2, 5, 5, c2);
  b.px(cx - 1, cy - 1, E.w);
  // head sunk between shoulders
  b.vol(ROCK, (m) => m.oval(17, 7 + by, 14, 12, 1), { sep: 0.6, hi: ROCK[3] });
  b.rect(19, 12 + by, 10, 3, '#120808');
  const ec = p.hurt ? ROCK[0] : E.h;
  b.rect(20, 12 + by, 2, 2, ec); b.rect(26, 12 + by, 2, 2, ec);
  b.px(21, 13 + by, E.l); b.px(27, 13 + by, E.l);
  b.hl(22, 16 + by, 4, c1);
  // slag crown with drips
  const CR = ['#6a3a10', '#c2701c', '#f0a83a', '#ffe08a'];
  b.vol(CR, (m) => {
    m.rect(17, 5 + by, 14, 4, 1);
    [[17, 0], [21, -2], [24, -4], [27, -2], [30, 0]].forEach(([x, t]) => m.poly([[x - 1, 6 + by], [x, t + 1 + by], [x + 2, 6 + by]], 1));
  }, { sep: 0.6, hi: CR[3] });
  b.px(24, 6 + by, E.m); b.px(20, 7 + by, '#ff3a1f'); b.px(28, 7 + by, '#ff3a1f');
  b.px(18, 9 + by, CR[2]); b.px(18, 10 + by, CR[1]); b.px(29, 9 + by, CR[2]);
  // front arm + massive fist
  const fx = 1 + (atk === 2 ? 4 : 0), fy = 18 + by + armUp;
  b.vol(ROCK, (m) => { m.oval(fx + 1, fy, 12, 11, 1); m.oval(fx, fy + 8, 14, 13, 1); }, { grad: 0.6, sep: 0.6, hi: ROCK[3] });
  b.line(fx + 4, fy + 12, fx + 10, fy + 12, '#140c0c'); b.line(fx + 4, fy + 15, fx + 10, fy + 15, '#140c0c');
  b.px(fx + 6, fy + 5, c1); b.px(fx + 7, fy + 6, c2); b.px(fx + 5, fy + 17, c1);
  if (atk === 2) { b.hl(fx - 1, fy + 21, 16, E.l); b.hl(fx + 2, fy + 22, 10, E.m); }
  if (cast) { b.oval(fx + 3, fy - 4, 8, 6, E.l); b.oval(fx + 5, fy - 3, 4, 3, E.h); }
}, {
  idle: [2.5, {}, { bob: 1 }],
  walk: [5, { step: 0 }, { step: 1, bob: 1 }, { step: 2 }, { step: 3, bob: 1 }],
  attack: [4, { atk: 1 }, { atk: 1, bob: -1 }, { atk: 2, bob: 2 }],
  cast: [6, { cast: 1 }, { cast: 1, bob: -1 }],
  special: [6, { rage: 1 }, { rage: 1, bob: 1 }],
}, {
  post(b, p) {
    if (!(p.rage || p.cast)) return;
    // rising sparks
    const pts = p.bob ? [[6, 6], [42, 4], [12, 2], [36, 10]] : [[8, 9], [40, 7], [14, 4], [33, 2]];
    pts.forEach(([x, y], i) => b.px(x, y, i % 2 ? E.l : E.h));
  },
});

// =========================================================================================
// Myzelmutter — huge fungal queen with glowing spore sacs (56×56)
// =========================================================================================
sprite('boss_mycel', 56, 56, (b, p) => {
  const f = p.f || 0, atk = p.atk || 0, cast = p.cast || 0, sp = p.sp || 0, st = p.step === undefined ? -1 : p.step;
  const CAP = ['#24143f', '#47286f', '#6e45a8', '#9a72d6'];
  const FLESH = ['#25403e', '#3f6a5f', '#6a9a84', '#a8ccb0'];
  const PALE = ['#6a7a70', '#a8b8a4', '#dfe8d0'];
  const G = { d: '#3f8a2a', m: '#9be35a', l: '#dcff9e', w: '#f6ffe8' };
  const glow = cast || sp ? G.l : f ? G.m : '#78c048';
  // root tendrils
  for (let i = 0; i < 6; i++) {
    const x = 10 + i * 7, sway = ((i + (st >= 0 ? st : 0)) % 2 ? 1 : -1);
    b.bez(x + 2, 44, x + sway * 3, 50, x - 3 + sway * 2 + (i < 3 ? -2 : 2), 54, FLESH[i % 2], 3, 1);
  }
  // gown
  b.vol(FLESH, (m) => { m.poly([[18, 26], [38, 26], [46, 48], [10, 48]], 1); m.oval(10, 40, 36, 10, 1); }, { grad: 0.6, hi: FLESH[3] });
  // mycelium veins
  b.bez(28, 28, 22, 38, 16, 46, FLESH[0], 1, 1); b.bez(28, 28, 34, 38, 40, 46, FLESH[0], 1, 1); b.line(28, 30, 28, 46, FLESH[0]);
  // spore sacs (hanging bulbs)
  const sac = (x, y, r) => {
    const s = r + (f || cast ? 1 : 0);
    b.oval(x - s - 1, y - s - 1, s * 2 + 3, s * 2 + 3, '#1a2a12');
    b.oval(x - s, y - s, s * 2 + 1, s * 2 + 1, cast || sp ? G.m : G.d);
    b.oval(x - s + 1, y - s + 1, s * 2 - 1, s * 2 - 1, glow);
    b.px(x - 1, y - 1, G.w);
  };
  sac(13, 38, 3); sac(43, 37, 3); sac(20, 45, 2); sac(36, 45, 2); sac(28, 41, 2);
  // arms
  const ay = atk ? -8 : cast ? -5 : 0;
  b.bez(19, 28, 12, 32 + ay, 8, 24 + ay * 2, PALE[1], 3, 2);
  b.bez(37, 28, 44, 32 + ay, 48, 24 + ay * 2, PALE[1], 3, 2);
  [[8, 24 + ay * 2], [48, 24 + ay * 2]].forEach(([x, y]) => { b.px(x - 1, y - 1, PALE[2]); b.px(x + 1, y - 1, PALE[2]); b.px(x, y - 2, PALE[2]); if (atk) b.px(x, y - 3, G.l); });
  // torso + head (under the cap)
  b.vol(PALE, (m) => { m.oval(21, 16, 14, 14, 1); m.rect(23, 24, 10, 6, 1); }, { sep: 0.5, hi: PALE[2] });
  b.oval(23, 18, 10, 8, '#1a2420');
  b.px(25, 21, p.hurt ? PALE[0] : G.l); b.px(30, 21, p.hurt ? PALE[0] : G.l);
  b.px(25, 22, G.d); b.px(30, 22, G.d);
  b.hl(26, 24, 4, PALE[0]);
  // the cap: a vast parasol
  const lift = cast ? -2 : sp ? -3 : 0;
  b.vol(CAP, (m) => { m.oval(1, 1 + lift, 54, 22, 1); }, { grad: 0.9, hi: CAP[3] });
  // gills underside
  for (let x = 6; x < 50; x += 2) if (b.on(x, 19 + lift)) { b.px(x, 19 + lift, '#c9b4e8'); b.px(x, 20 + lift, '#8a72b8'); }
  b.hl(8, 21 + lift, 40, CAP[0]);
  // cap spots (glowing)
  [[10, 9, 2], [20, 5, 3], [33, 4, 2], [44, 9, 3], [27, 12, 2], [15, 14, 1], [39, 15, 1]].forEach(([x, y, r]) => {
    b.disc(x, y + lift, r, glow);
    b.px(x - (r > 1 ? 1 : 0), y + lift - (r > 1 ? 1 : 0), G.w);
  });
}, {
  idle: [2.5, { f: 0 }, { f: 1 }],
  walk: [4, { step: 0, f: 0 }, { step: 1, f: 1, dy: -1 }, { step: 2, f: 0 }, { step: 3, f: 1, dy: -1 }],
  attack: [4, { atk: 1, f: 1 }, { atk: 1, f: 1, dy: -1 }],
  cast: [5, { cast: 1 }, { cast: 1, f: 1, sy: 1.03 }],
  special: [6, { sp: 1 }, { sp: 1, f: 1, sx: 1.04, sy: 0.97 }],
}, {
  post(b, p) {
    if (!(p.sp || p.cast)) return;
    const pts = p.f ? [[4, 2], [52, 6], [14, 0], [42, 1], [28, 0]] : [[2, 6], [50, 2], [20, 1], [36, 0], [54, 12]];
    pts.forEach(([x, y], i) => b.px(x, y, i % 2 ? '#9be35a' : '#dcff9e'));
  },
});

// =========================================================================================
// Reifwyrm — ice serpent head (44×36), body segment (18×18), tail tip (16×16)
// =========================================================================================
const WYRM = ['#16304e', '#2e5c86', '#5a92be', '#9cc8e8'];
const BELLY = ['#7aa0be', '#bcd8ec', '#eef8ff'];
const CY = { d: '#1fb4f0', m: '#8fd8ff', l: '#d9f6ff', w: '#ffffff' };

sprite('boss_rime', 44, 36, (b, p) => {
  const open = p.open || 0, f = p.f || 0, glow = p.glow || 0;
  // neck stub (left)
  b.vol(WYRM, (m) => m.oval(0, 12, 14, 16, 1), { grad: 0.5 });
  // ice horns sweeping back
  b.vol(['#4a8ab8', '#a8e2ff', '#e8f8ff'], (m) => {
    m.poly([[14, 10], [4, 1], [7, 0], [19, 8]], 1);
    m.poly([[18, 8], [14, -1 + 1], [17, 0], [23, 8]], 1);
  }, { hi: '#ffffff' });
  // upper head + snout
  const jaw = open * 4;
  b.vol(WYRM, (m) => {
    m.oval(8, 7, 20, 16, 1);
    m.poly([[22, 9], [40, 13 - open], [42, 17 - open], [24, 20]], 1);
  }, { grad: 0.6, hi: WYRM[3] });
  // brow ridge + frost frill spikes
  b.line(17, 10, 28, 12, WYRM[0]);
  [[10, 9], [12, 6], [15, 5]].forEach(([x, y]) => { b.px(x, y, CY.l); b.px(x - 1, y + 1, CY.m); });
  // nostrils & teeth
  b.px(38, 14 - open, '#081422');
  for (let x = 26; x < 41; x += 3) b.px(x, 19 - Math.round(open * (x - 24) / 16), '#ffffff');
  // lower jaw
  b.vol(WYRM, (m) => m.poly([[14, 20], [24, 20], [39, 20 + jaw], [39, 23 + jaw], [22, 27], [14, 25]], 1), { sep: 0.5 });
  for (let x = 27; x < 39; x += 3) b.px(x, 20 + Math.round(jaw * (x - 22) / 17) - 1, '#ffffff');
  // belly plates on jaw
  b.line(17, 25, 37, 22 + jaw, BELLY[1]);
  // mouth glow when open
  if (open) {
    b.poly([[25, 20], [38, 15], [38, 20 + jaw - 1], [25, 21]], '#0c2238');
    b.poly([[27, 20], [37, 17], [37, 19 + jaw - 1]], glow ? CY.l : CY.d);
    if (glow) b.px(35, 18 + Math.round(jaw / 2), CY.w);
  }
  // eye
  b.rect(22, 12, 4, 2, '#081422');
  b.px(23, 12, p.hurt ? WYRM[0] : CY.w); b.px(24, 12, p.hurt ? WYRM[0] : CY.m); b.px(25, 13, CY.d);
  // icy cheek crystals
  b.vol(['#4a8ab8', '#a8e2ff', '#ffffff'], (m) => { m.poly([[12, 22], [8, 30], [15, 25]], 1); m.poly([[17, 24], [16, 33], [20, 26]], 1); });
  if (glow || f) { b.px(14, 14, CY.m); b.px(19, 18, CY.l); }
}, {
  idle: [2, { f: 0 }, { f: 1, dy: 1 }],
  walk: [4, { f: 0 }, { f: 1, dy: 1 }, { f: 0 }, { f: 1, dy: -1 }],
  attack: [5, { open: 1 }, { open: 2, glow: 1 }],
  cast: [6, { open: 1, glow: 1 }, { open: 1, glow: 1, f: 1 }],
  special: [8, { open: 2, glow: 1 }, { open: 2, glow: 1, dx: 1 }],
}, { anchor: 'center' });

function segment(key, size, spikes) {
  sprite(key, size, size, (b, p) => {
    const f = p.f || 0, s = size;
    const r = Math.floor(s / 2) - 2;
    b.ball(s / 2 - r - 0.5, s / 2 - r + 0.5, r * 2 + 1, r * 2, WYRM, { grad: 0.6, hi: WYRM[3] });
    // belly band
    for (let x = 0; x < s; x++) { const y = Math.round(s / 2 + r * 0.55); if (b.on(x, y) && b.on(x, y + 1)) b.px(x, y, BELLY[1]); }
    // scale ridges
    b.line(Math.round(s * 0.3), Math.round(s * 0.35), Math.round(s * 0.45), Math.round(s * 0.6), WYRM[0]);
    b.line(Math.round(s * 0.55), Math.round(s * 0.35), Math.round(s * 0.7), Math.round(s * 0.6), WYRM[0]);
    // dorsal ice spine
    if (spikes) {
      const sx = Math.round(s / 2), top = Math.round(s / 2 - r);
      b.vol(['#4a8ab8', '#a8e2ff', '#ffffff'], (m) => m.poly([[sx - 3, top + 2], [sx + (f ? 1 : 0), top - 3 + 1], [sx + 2, top + 2]], 1));
      b.px(sx, top, CY.w);
    }
    if (p.glow) b.px(Math.round(s / 2), Math.round(s / 2), CY.l);
  }, {
    idle: [2, { f: 0 }, { f: 1 }],
    attack: [6, { glow: 1 }, { glow: 1, f: 1 }],
  }, { anchor: 'center' });
}
segment('boss_rime_segment', 18, true);
segment('boss_rime_tail', 12, false);

// =========================================================================================
// Umbra, der Zwillingsschatten — tall shadow with a white mask (36×56) + pale twin
// =========================================================================================
function umbra(key, inv) {
  const CLOAK = inv ? ['#6a6478', '#a49cb6', '#d4cee0', '#f4f0ff'] : ['#05040a', '#130e22', '#251c40', '#3a2e62'];
  const MASK = inv ? ['#120e1c', '#241c36', '#3a2e52'] : ['#9c94b0', '#e4def0', '#ffffff'];
  const EYE = inv ? '#ffffff' : '#000000';
  const GL = inv ? { d: '#6a2a9a', m: '#e04bd0', l: '#ffd0f4' } : { d: '#5a2aa0', m: '#b07cff', l: '#e2ccff' };
  sprite(key, 36, 56, (b, p) => {
    const f = p.f || 0, atk = p.atk || 0, cast = p.cast || 0;
    // tattered robe tails
    for (let i = 0; i < 5; i++) {
      const x = 9 + i * 4.5, sway = ((i + f) % 2 ? 1 : -1);
      b.bez(x, 40, x + sway * 2, 47, x - sway, 54 - (i % 2) * 2, CLOAK[i % 2 ? 1 : 2], 4, 1);
    }
    // long cloak body
    b.vol(CLOAK, (m) => { m.poly([[13, 14], [23, 14], [29, 44], [7, 44]], 1); m.oval(10, 12, 16, 10, 1); }, { grad: 0.6, hi: CLOAK[3] });
    // inner glow seam
    b.line(18, 22, 18, 42, GL.d); if (cast) { b.line(18, 24, 18, 40, GL.m); }
    // arms: long, spindly, claws
    const reach = atk ? 1 : 0, up = cast ? -10 : 0;
    const arm = (sx, dir) => {
      const ex = sx + dir * (8 + reach * 4), ey = 30 + up - reach * 6;
      b.bez(sx, 18, sx + dir * 9, 24 + up / 2, ex, ey, CLOAK[2], 2, 2);
      for (let k = -1; k <= 1; k++) b.line(ex, ey, ex + dir * 3, ey + k * 2 + (atk ? -2 : 2), MASK[1]);
      if (cast) b.disc(ex + dir * 2, ey - 2, 1, GL.l);
    };
    arm(11, -1); arm(25, 1);
    // hood
    b.vol(CLOAK, (m) => { m.oval(9, 1, 18, 18, 1); m.poly([[11, 6], [18, -1], [25, 6]], 1); }, { sep: 0.5, hi: CLOAK[3] });
    b.oval(12, 5, 12, 13, inv ? '#2a2438' : '#000000');
    // mask
    b.vol(MASK, (m) => { m.oval(13, 6, 10, 12, 1); }, { hi: MASK[2] });
    const ec = p.hurt ? MASK[0] : EYE;
    b.rect(15, 10, 2, 3, ec); b.rect(20, 10, 2, 3, ec);
    b.px(15, 13, ec); b.px(21, 13, ec); // tear streaks
    if (cast || atk) { b.px(15, 11, GL.m); b.px(21, 11, GL.m); }
    // crack across the mask
    b.line(18, 6, 17, 9, MASK[0]); b.line(17, 9, 19, 12, MASK[0]);
    // mouth slit
    b.hl(16, 15, 5, MASK[0]);
  }, {
    idle: [3, { f: 0 }, { f: 1, dy: -1 }],
    walk: [4, { f: 0, shear: 0.08 }, { f: 1, shear: 0.08, dy: -1 }],
    attack: [5, { atk: 1, f: 0 }, { atk: 1, f: 1, dx: 1 }],
    cast: [5, { cast: 1, f: 0 }, { cast: 1, f: 1, dy: -1 }],
    special: [10, { f: 0, sx: 0.7, sy: 1.15 }, { f: 1, sx: 0.4, sy: 1.3 }, { f: 0, sx: 0.15, sy: 1.4 }],
  }, {
    anchor: 'center',
    outline: inv ? '#1a1426' : '#000000',
    post(b, p) {
      if (!p.cast) return;
      const pts = p.f ? [[3, 12], [32, 8], [6, 2], [30, 18]] : [[4, 6], [31, 14], [2, 18], [33, 3]];
      pts.forEach(([x, y], i) => b.px(x, y, i % 2 ? GL.m : GL.l));
    },
  });
}
umbra('boss_umbra', false);
umbra('boss_umbra_twin', true);

// =========================================================================================
// Die Erloschene Sonne — dead sun disc with a cracked corona (64×64) + core (20×20)
// =========================================================================================
sprite('boss_sun', 64, 64, (b, p) => {
  const lit = p.lit || 0, f = p.f || 0, heat = p.heat || 0;
  const cx = 31.5, cy = 31.5;
  const DISC = lit ? ['#b85a10', '#e8901c', '#ffc23a', '#fff0a0', '#ffffff'] : ['#0c0908', '#1a1412', '#2c221e', '#463630', '#5e4a40'];
  const RAY = lit ? ['#c2701c', '#ffb347', '#ffe08a'] : ['#15100e', '#2e2420', '#4a3a32'];
  // corona rays: 12 spikes, alternate long/short, broken ones
  const N = 12, rot = (f * Math.PI) / N / 2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rot;
    const broken = !lit && (i === 2 || i === 7 || i === 10);
    const len = (i % 2 ? 26 : 31) - (broken ? 7 : 0) + (lit ? 1 : 0);
    const w = i % 2 ? 2.5 : 4;
    const tx = cx + Math.cos(a) * len, ty = cy + Math.sin(a) * len;
    const px = -Math.sin(a), py = Math.cos(a);
    b.vol(RAY, (m) => m.poly([[cx + Math.cos(a) * 16 + px * w, cy + Math.sin(a) * 16 + py * w], [tx, ty], [cx + Math.cos(a) * 16 - px * w, cy + Math.sin(a) * 16 - py * w]], 1));
    if (broken) { b.px(tx + Math.cos(a) * 3, ty + Math.sin(a) * 3, RAY[1]); b.px(tx + Math.cos(a) * 5 + px * 2, ty + Math.sin(a) * 5 + py * 2, RAY[0]); }
    // ember vein along each ray
    if (!lit && heat) b.line(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18, cx + Math.cos(a) * (len - 4), cy + Math.sin(a) * (len - 4), i % 2 ? E.d : E.m);
  }
  // disc
  b.vol(DISC, (m) => m.disc(cx - 0.5, cy - 0.5, 19, 1), { grad: 0.9, hi: DISC[4], lw: 2 });
  // rim
  b.ring(cx - 19.5, cy - 19.5, 40, 40, lit ? '#fff6c8' : '#2a1a14');
  // cracks
  const cc = lit ? '#ffffff' : heat ? E.l : E.m, cd = lit ? '#fff0a0' : E.d;
  crack(b, 31, 31, -1, -1, 9, cc, null, 11);
  crack(b, 32, 31, 1, -1, 11, cc, null, 12);
  crack(b, 31, 32, 0, 1, 12, cd, null, 13);
  crack(b, 33, 33, 1, 1, 7, cd, null, 14);
  crack(b, 30, 30, -1, 0, 10, cd, null, 15);
  // inner core
  b.disc(31, 31, lit ? 6 : 4, lit ? '#ffffff' : heat ? E.l : '#5a1a0c');
  b.disc(31, 31, lit ? 3 : 2, lit ? '#fff6c8' : heat ? E.h : E.m);
  if (p.hurt) b.disc(31, 31, 3, '#1a1412');
}, {
  idle: [1.5, { f: 0 }, { f: 1 }],
  walk: [2, { f: 0 }, { f: 1 }],
  attack: [5, { f: 0, heat: 1 }, { f: 1, heat: 1 }],
  cast: [6, { f: 0, heat: 1, sx: 1.04, sy: 1.04 }, { f: 1, heat: 1 }],
  special: [6, { lit: 1, f: 0 }, { lit: 1, f: 1, sx: 1.03, sy: 1.03 }, { lit: 1, f: 0, sx: 1.05, sy: 1.05 }],
}, { anchor: 'center', outline: '#0a0605' });

sprite('boss_sun_core', 20, 20, (b, p) => {
  const f = p.f || 0, hot = p.hot || 0;
  const r = 6 + (f ? 1 : 0);
  b.disc(9.5, 9.5, r + 2, '#5a2a08');
  b.disc(9.5, 9.5, r + 1, '#d9861a');
  b.disc(9.5, 9.5, r, hot ? '#fff0a0' : '#ffb347');
  b.disc(9.5, 9.5, r - 2, hot ? '#ffffff' : '#ffe08a');
  b.disc(8, 8, 1, '#ffffff');
  // small flares
  [[9, 0], [19, 9], [9, 19], [0, 9]].forEach(([x, y], i) => { if ((i + f) % 2 === 0) b.px(x, y, '#ffd35a'); });
  if (p.hurt) b.disc(9.5, 9.5, 2, '#5a2a08');
}, {
  idle: [4, { f: 0 }, { f: 1 }],
  attack: [8, { f: 0, hot: 1 }, { f: 1, hot: 1 }],
  special: [8, { f: 0, hot: 1 }, { f: 1, hot: 1 }],
}, { anchor: 'center', outline: '#2a1404' });

export const BOSS_KEYS = ['boss_cinder', 'boss_mycel', 'boss_rime', 'boss_rime_segment', 'boss_rime_tail', 'boss_umbra', 'boss_umbra_twin', 'boss_sun', 'boss_sun_core'];
export { mix };
