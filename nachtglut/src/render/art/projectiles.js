// Tintable projectiles: drawn in greys/white and coloured via sprites.draw(..., { color }).
// Orientation: every directional projectile points to +x (angle 0) — pass `rot: angle`.
import { sprite, still } from './helpers.js';

const W = '#ffffff', L = '#e6e6e6', M = '#bfbfbf', D = '#8c8c8c', K = '#5e5e5e';
const OUT = '#3a3a3a'; // tints to a dark rim of the projectile's own colour
const T = { tint: true, outline: OUT, anchor: 'center' };

sprite('proj_orb', 10, 10, (b, p) => {
  const r = p.f ? 3.5 : 3;
  b.disc(4.5, 4.5, r, M);
  b.disc(4.5, 4.5, r - 1, L);
  b.disc(4.5, 4.5, 1, W);
  b.px(3, 3, W);
}, { idle: [10, { f: 0 }, { f: 1 }] }, T);

sprite('proj_bolt', 14, 7, (b, p) => {
  // comet: bright head on the right, tapering tail on the left
  b.poly([[1, 3], [8, 1], [12, 3], [8, 5]], D);
  b.poly([[4, 3], [9, 2], [12, 3], [9, 4]], M);
  b.oval(8, 1, 5, 5, L);
  b.oval(9, 2, 3, 3, W);
  b.px(p.f ? 1 : 2, 3, M); b.px(p.f ? 3 : 0, 3, K);
}, { idle: [12, { f: 0 }, { f: 1 }] }, T);

still('proj_shard', 12, 7, (b) => {
  b.poly([[1, 3], [4, 1], [11, 3], [4, 5]], M);
  b.poly([[2, 3], [4, 1], [11, 3]], L);
  b.line(4, 2, 10, 3, W);
  b.px(1, 3, D); b.px(4, 5, D);
}, T);

still('proj_dagger', 12, 7, (b) => {
  b.poly([[4, 2], [9, 2], [11, 3], [9, 4], [4, 4]], L);
  b.hl(4, 2, 6, W);
  b.vl(3, 1, 5, D);
  b.rect(1, 3, 2, 1, K); b.px(0, 3, M);
}, T);

sprite('proj_disc', 12, 12, (b, p) => {
  b.disc(5.5, 5.5, 4.5, M);
  b.disc(5.5, 5.5, 2, D);
  b.disc(5.5, 5.5, 1, W);
  // spinning teeth / notches
  const o = p.f ? 1 : 0;
  const pts = o ? [[5, 0], [11, 5], [6, 11], [0, 6]] : [[1, 1], [10, 1], [10, 10], [1, 10]];
  pts.forEach(([x, y]) => b.px(x, y, L));
  b.ring(1, 1, 10, 10, L);
  b.px(3, 2, W);
}, { idle: [16, { f: 0 }, { f: 1 }] }, T);

sprite('proj_spore', 10, 10, (b, p) => {
  b.disc(4.5, 4.5, 3, M);
  b.disc(4, 4, 1.5, L);
  b.px(3, 3, W);
  const fuzz = p.f ? [[4, 0], [9, 4], [5, 9], [0, 5]] : [[1, 1], [8, 1], [8, 8], [1, 8]];
  fuzz.forEach(([x, y]) => b.px(x, y, D));
}, { idle: [6, { f: 0 }, { f: 1 }] }, T);

sprite('proj_blob', 10, 9, (b, p) => {
  // goo droplet stretched along its flight (+x)
  if (p.f) { b.oval(1, 2, 8, 5, M); b.oval(3, 3, 5, 3, L); }
  else { b.oval(2, 1, 7, 7, M); b.oval(4, 2, 4, 4, L); b.px(1, 4, D); }
  b.px(5, 3, W);
}, { idle: [8, { f: 0 }, { f: 1 }] }, T);

still('proj_needle', 12, 5, (b) => {
  b.hl(1, 2, 9, M);
  b.hl(4, 2, 7, L);
  b.px(10, 2, W); b.px(1, 1, D); b.px(1, 3, D);
}, T);

sprite('proj_wave', 10, 16, (b, p) => {
  // crescent facing +x
  b.vol([D, M, L], (m) => { m.oval(0, 0, 10, 16, 1); m.oval(-3 - (p.f || 0), 1, 10, 14, 0); });
  b.bez(7, 2, 10, 8, 7, 13, W, 1, 1);
}, { idle: [10, { f: 0 }, { f: 1 }] }, T);

sprite('proj_star', 11, 11, (b, p) => {
  const c = 5;
  if (p.f) {
    b.poly([[c, 0], [c + 1.5, c - 1.5], [10, c], [c + 1.5, c + 1.5], [c, 10], [c - 1.5, c + 1.5], [0, c], [c - 1.5, c - 1.5]], M);
  } else {
    b.poly([[1, 1], [c, c - 2], [9, 1], [c + 2, c], [9, 9], [c, c + 2], [1, 9], [c - 2, c]], M);
  }
  b.disc(c, c, 1.5, L);
  b.px(c, c, W);
}, { idle: [12, { f: 0 }, { f: 1 }] }, T);

sprite('proj_skull', 12, 12, (b, p) => {
  // flaming skull flying +x: flame wisps trailing left
  b.poly([[0, 3 + (p.f || 0)], [5, 3], [5, 9], [1, 8 - (p.f || 0)]], D);
  b.oval(3, 2, 8, 7, L);
  b.rect(5, 7, 5, 3, L);
  b.px(4, 3, W); b.px(5, 3, W);
  b.rect(6, 4, 2, 2, '#1c1c1c'); b.rect(9, 4, 2, 2, '#1c1c1c');
  b.px(8, 7, K);
  b.px(6, 9, K); b.px(8, 9, K);
}, { idle: [10, { f: 0 }, { f: 1 }] }, T);

// 16×6 segment, horizontally tileable: draw consecutive segments 16px apart along the beam.
sprite('proj_beam', 16, 6, (b, p) => {
  const f = p.f || 0;
  b.rect(0, 0, 16, 6, '#7a7a7a');
  b.rect(0, 1, 16, 4, M);
  b.rect(0, 2, 16, 2, W);
  for (let x = 0; x < 16; x++) {
    if ((x + f * 3) % 8 === 0) { b.px(x, 1, W); b.px(x, 4, L); }
    if ((x + f * 3) % 8 === 4) { b.px(x, 0, M); b.px(x, 5, D); }
  }
}, { idle: [14, { f: 0 }, { f: 1 }, { f: 2 }] }, { tint: true, outline: false, anchor: 'center' });

sprite('proj_hammer', 13, 13, (b, p) => {
  // spinning hammer: two frames 45° apart
  if (p.f) {
    b.stroke(2, 10, 7, 5, D, 2);
    b.poly([[5, 3], [9, -1 + 1], [12, 3], [8, 7]], L);
    b.poly([[6, 3], [9, 1], [10, 2], [7, 5]], W);
  } else {
    b.rect(5, 6, 2, 6, D);
    b.rect(1, 1, 10, 5, L);
    b.hl(1, 1, 10, W); b.vl(3, 1, 5, M); b.vl(8, 1, 5, M);
  }
}, { idle: [14, { f: 0 }, { f: 1 }] }, T);

sprite('proj_blade', 13, 13, (b, p) => {
  // curved sickle/glaive blade spinning
  const a = p.f ? Math.PI / 4 : 0;
  const c = 6;
  for (let i = 0; i < 2; i++) {
    const ang = a + i * Math.PI;
    const x0 = c + Math.cos(ang) * 1, y0 = c + Math.sin(ang) * 1;
    const x1 = c + Math.cos(ang - 0.6) * 6, y1 = c + Math.sin(ang - 0.6) * 6;
    const cx = c + Math.cos(ang + 0.5) * 6, cy = c + Math.sin(ang + 0.5) * 6;
    b.bez(x0, y0, cx, cy, x1, y1, L, 2, 1);
    b.px(x1, y1, W);
  }
  b.disc(c, c, 1, M);
}, { idle: [14, { f: 0 }, { f: 1 }] }, T);
