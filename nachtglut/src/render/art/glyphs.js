// 50 icon glyphs, 16×16, greyscale + white highlights so they tint cleanly (`opts.color`).
// Registered as `glyph_<name>`; used by sprites.icon({ glyph, color }) and drawable on canvas.
import { still } from './helpers.js';

export const GLYPH_NAMES = Object.freeze([
  'flame', 'ember', 'skull', 'heart', 'shield', 'boot', 'eye', 'sword', 'dagger', 'hammer',
  'bow', 'staff', 'orb', 'star', 'sun', 'moon', 'snowflake', 'drop', 'bolt', 'leaf',
  'mushroom', 'bone', 'crown', 'coin', 'key', 'hourglass', 'feather', 'fang', 'claw', 'ring',
  'gem', 'book', 'potion', 'bomb', 'wing', 'anchor', 'chain', 'mirror', 'mask', 'candle',
  'lantern', 'compass', 'dice', 'scale', 'thorn', 'spiral', 'cross', 'hand', 'tooth', 'horn',
]);

// Tint mapping (see Buf.tinted): lum ≤ .75 → black…colour, above → colour…white.
const W = '#ffffff';      // hot highlight → white
const L = '#e2e2e2';      // light → colour, slightly washed
const M = '#bfbfbf';      // mid → pure colour
const D = '#8a8a8a';      // dark → ~70 % colour
const K = '#5c5c5c';      // deep → ~48 % colour
const O = '#1c1c1c';      // holes / interior lines
const R = [D, M, L];      // default volume ramp
const R4 = [K, D, M, L];
const OUT = '#151515';

const G = {};

G.flame = (b) => {
  b.vol(R, (m) => { m.oval(3, 6, 10, 9, 1); m.poly([[3, 10], [7, 1], [12, 9]], 1); m.poly([[9, 8], [13, 3], [13, 11]], 1); m.poly([[3, 9], [2, 5], [5, 8]], 1); }, { hi: W });
  b.vol([M, L, W], (m) => { m.oval(5, 9, 6, 6, 1); m.poly([[5, 11], [8, 5], [10, 11]], 1); });
  b.oval(6, 11, 4, 3, W);
};
G.ember = (b) => {
  b.vol(R4, (m) => m.poly([[8, 2], [14, 8], [8, 14], [2, 8]], 1), { hi: W });
  b.poly([[8, 5], [11, 8], [8, 11], [5, 8]], L);
  b.poly([[8, 6], [10, 8], [8, 10], [6, 8]], W);
  b.px(2, 2, L); b.px(13, 1, W); b.px(14, 13, L); b.px(1, 13, M);
};
G.skull = (b) => {
  b.vol(R, (m) => { m.oval(2, 1, 12, 11, 1); m.rect(4, 9, 8, 5, 1); }, { hi: W });
  b.oval(3, 5, 4, 4, O); b.oval(9, 5, 4, 4, O);
  b.px(4, 6, K); b.px(10, 6, K);
  b.px(7, 9, O); b.px(8, 9, O); b.px(7, 10, K); b.px(8, 10, K);
  b.vl(5, 12, 2, O); b.vl(7, 12, 2, O); b.vl(9, 12, 2, O); b.vl(11, 12, 1, O);
};
G.heart = (b) => {
  b.vol(R4, (m) => { m.oval(0.5, 1, 7, 7, 1); m.oval(7.5, 1, 7, 7, 1); m.poly([[0.7, 5.5], [14.3, 5.5], [7.5, 14]], 1); }, { hi: W, lw: 2 });
  b.px(3, 3, W); b.px(4, 3, W); b.px(3, 4, W);
};
G.shield = (b) => {
  b.vol(R4, (m) => m.poly([[2, 2], [7.5, 1], [13, 2], [13, 8], [7.5, 14], [2, 8]], 1), { hi: W, lw: 2 });
  b.vl(7, 3, 9, D); b.hl(4, 6, 8, D);
  b.px(7, 6, W); b.px(8, 6, L);
};
G.boot = (b) => {
  b.vol(R, (m) => { m.rect(4, 2, 6, 8, 1); m.rect(4, 8, 7, 5, 1); m.oval(8, 8, 7, 5, 1); }, { hi: W });
  b.rect(3, 1, 8, 3, L); b.hl(3, 1, 8, W);
  b.hl(4, 13, 11, K); b.rect(4, 12, 3, 2, K);
  b.px(6, 6, D); b.px(8, 6, D); b.px(6, 8, D); b.px(8, 8, D);
};
G.eye = (b) => {
  b.vol([D, L, W], (m) => m.poly([[0, 8], [4, 4], [11, 4], [15, 8], [11, 12], [4, 12]], 1));
  b.disc(7.5, 8, 3.5, M); b.disc(7.5, 8, 2.5, D); b.disc(7.5, 8, 1, O);
  b.px(6, 6, W); b.px(6, 7, W);
  b.hl(4, 3, 8, M); b.px(3, 4, M); b.px(12, 4, M);
};
G.sword = (b) => {
  b.stroke(5, 10, 13, 2, L, 2); b.line(6, 10, 13, 3, D); b.px(13, 2, W); b.line(5, 9, 11, 3, W);
  b.stroke(2, 8, 7, 13, D, 2); b.px(2, 8, M); b.px(7, 13, M);
  b.stroke(2, 13, 4, 11, K, 2); b.disc(1.5, 14, 1, M);
};
G.dagger = (b) => {
  b.vol([D, L, W], (m) => m.poly([[7.5, 1], [10, 4], [10, 9], [5, 9], [5, 4]], 1));
  b.vl(7, 3, 6, M);
  b.vol(R, (m) => { m.rect(3, 9, 10, 2, 1); });
  b.rect(6, 11, 4, 3, K); b.hl(6, 12, 4, D);
  b.disc(7.5, 14, 1, M);
};
G.hammer = (b) => {
  b.vol(R4, (m) => { m.rect(1, 2, 14, 6, 1); }, { hi: W, lw: 2 });
  b.vl(4, 2, 6, D); b.vl(11, 2, 6, D);
  b.rect(7, 8, 2, 7, K); b.vl(7, 8, 7, D); b.hl(6, 14, 4, D);
};
G.bow = (b) => {
  b.bez(5, 1, 17, 8, 5, 15, M, 2, 2); b.bez(5, 1, 16, 8, 5, 15, L, 1, 1);
  b.line(5, 1, 5, 15, D);
  b.line(1, 8, 12, 8, L); b.poly([[12, 6], [15, 8], [12, 10]], W); b.px(1, 7, M); b.px(1, 9, M); b.px(2, 7, M); b.px(2, 9, M);
};
G.staff = (b) => {
  b.stroke(2, 14, 10, 6, D, 2); b.line(2, 13, 9, 6, M);
  b.line(8, 3, 9, 7, K); b.line(13, 8, 9, 7, K);
  b.vol([M, L, W], (m) => m.disc(11.5, 4, 3, 1));
  b.px(10, 3, W); b.px(11, 3, W);
};
G.orb = (b) => {
  b.vol([K, D, M, L, W], (m) => m.disc(7.5, 7.5, 6.5, 1), { grad: 0.9 });
  b.oval(4, 3, 3, 2, W);
};
G.star = (b) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 2.8 : 7.2;
    pts.push([7.5 + Math.cos(a) * r, 8.2 + Math.sin(a) * r]);
  }
  b.vol(R4, (m) => m.poly(pts, 1), { hi: W });
  b.px(7, 6, W); b.px(8, 7, L);
};
G.sun = (b) => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.stroke(7.5 + Math.cos(a) * 4, 7.5 + Math.sin(a) * 4, 7.5 + Math.cos(a) * 7, 7.5 + Math.sin(a) * 7, i % 2 ? D : M, i % 2 ? 1 : 2);
  }
  b.vol([M, L, W], (m) => m.disc(7.5, 7.5, 4, 1));
};
G.moon = (b) => {
  b.vol(R4, (m) => { m.disc(7.5, 7.5, 6.5, 1); m.disc(11, 5, 5.5, 0); }, { hi: W, lw: 2 });
  b.px(4, 10, D); b.px(6, 12, D);
};
G.snowflake = (b) => {
  const c = 7.5;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + Math.PI / 2;
    const dx = Math.cos(a) * 6.5, dy = Math.sin(a) * 6.5;
    b.line(c - dx, c - dy, c + dx, c + dy, L);
    for (const s of [-1, 1]) {
      const bx = c + s * dx * 0.6, by = c + s * dy * 0.6;
      const pa = a + Math.PI / 2;
      b.line(bx, by, bx + s * dx * 0.3 + Math.cos(pa) * 2, by + s * dy * 0.3 + Math.sin(pa) * 2, M);
      b.line(bx, by, bx + s * dx * 0.3 - Math.cos(pa) * 2, by + s * dy * 0.3 - Math.sin(pa) * 2, M);
      b.px(c + s * dx, c + s * dy, W);
    }
  }
  b.disc(7.5, 7.5, 1, W);
};
G.drop = (b) => {
  b.vol(R4, (m) => { m.disc(7.5, 9.5, 4.5, 1); m.poly([[3.3, 8.5], [7.5, 0], [11.7, 8.5]], 1); }, { hi: W, lw: 2 });
  b.px(5, 9, W); b.px(5, 10, W); b.px(6, 12, L);
};
G.bolt = (b) => {
  b.vol([D, L, W], (m) => m.poly([[10, 0], [3, 9], [7, 9], [5, 15], [13, 6], [9, 6], [12, 0]], 1));
  b.line(9, 2, 5, 8, W);
};
G.leaf = (b) => {
  b.vol(R4, (m) => { m.poly([[3, 12], [2, 7], [5, 3], [10, 1], [14, 1], [14, 5], [12, 10], [7, 13]], 1); }, { hi: W });
  b.line(3, 12, 13, 2, K);
  b.line(6, 9, 5, 5, D); b.line(9, 6, 8, 3, D); b.line(7, 8, 11, 9, D); b.line(10, 5, 13, 6, D);
  b.line(1, 14, 3, 12, D);
};
G.mushroom = (b) => {
  b.vol([D, L, W], (m) => { m.rect(5, 7, 6, 7, 1); m.oval(4, 11, 8, 4, 1); });
  b.hl(5, 7, 6, K);
  b.vol(R4, (m) => { m.oval(1, 1, 14, 12, 1); m.rect(0, 7, 16, 9, 0); }, { hi: W, lw: 2 });
  b.hl(2, 6, 12, D);
  b.disc(4.5, 3.5, 1, W); b.px(9, 2, W); b.px(11, 4, L); b.px(7, 5, L);
};
G.bone = (b) => {
  b.stroke(4, 11, 11, 4, L, 3);
  b.vol([D, L, W], (m) => { m.disc(2.5, 11, 2, 1); m.disc(4.5, 13, 2, 1); m.disc(11, 2.5, 2, 1); m.disc(13, 4.5, 2, 1); m.stroke(4, 11, 11, 4, 1, 3); });
  b.line(5, 12, 12, 5, D);
};
G.crown = (b) => {
  b.vol(R4, (m) => { m.poly([[1, 4], [4.5, 8], [7.5, 2], [10.5, 8], [14, 4], [13, 12], [2, 12]], 1); m.rect(2, 11, 12, 3, 1); }, { hi: W });
  b.hl(2, 11, 12, D);
  b.px(1, 3, W); b.px(7, 1, W); b.px(8, 1, W); b.px(14, 3, W);
  b.px(4, 12, W); b.px(7, 12, W); b.px(8, 12, W); b.px(11, 12, W);
};
G.coin = (b) => {
  b.vol(R4, (m) => m.oval(1, 1, 14, 14, 1), { hi: W, lw: 2 });
  b.ring(3, 3, 10, 10, D);
  b.rect(7, 5, 2, 6, W); b.px(6, 6, L); b.px(9, 9, L);
};
G.key = (b) => {
  b.vol(R4, (m) => { m.disc(4.5, 4.5, 3.5, 1); m.disc(4.5, 4.5, 1.2, 0); m.stroke(6, 6, 14, 14, 1, 2); m.rect(10, 12, 2, 3, 1); m.rect(12, 9, 3, 2, 1); }, { hi: W });
  b.disc(4.5, 4.5, 1.2, 0);
  b.px(3, 2, W); b.px(2, 3, W);
};
G.hourglass = (b) => {
  b.vol([D, M, L], (m) => { m.rect(2, 0, 12, 2, 1); m.rect(2, 14, 12, 2, 1); });
  b.vol([K, D, M], (m) => { m.poly([[3, 2], [12, 2], [8, 8], [7, 8]], 1); m.poly([[7, 8], [8, 8], [12, 13], [3, 13]], 1); });
  b.poly([[5, 4], [10, 4], [8, 7], [7, 7]], W);
  b.poly([[7, 10], [8, 10], [11, 13], [4, 13]], L);
  b.vl(7, 8, 3, W);
  b.vl(2, 2, 12, D); b.vl(13, 2, 12, K);
};
G.feather = (b) => {
  b.vol(R4, (m) => { m.bez(3, 13, 6, 3, 14, 1, 1, 2, 2); m.poly([[3, 12], [4, 6], [9, 2], [14, 1], [12, 6], [7, 11]], 1); }, { hi: W });
  b.bez(1, 15, 7, 7, 14, 1, K, 1, 1);
  b.px(6, 6, 0); b.px(11, 7, 0); b.px(5, 11, D); b.px(9, 3, D);
};
G.fang = (b) => {
  b.vol([D, L, W], (m) => { m.bez(4, 2, 13, 5, 6, 14, 1, 6, 1); });
  b.vol([K, D, M], (m) => m.rect(1, 1, 12, 3, 1));
  b.bez(4, 5, 9, 7, 7, 11, W, 1, 1);
};
G.claw = (b) => {
  for (let i = 0; i < 3; i++) {
    const o = i * 4;
    b.bez(1 + o, 14, 3 + o, 5, 7 + o, 1, i === 1 ? L : M, 3, 1);
    b.px(7 + o, 1, W);
  }
};
G.ring = (b) => {
  b.vol(R4, (m) => { m.disc(7.5, 9.5, 5.5, 1); m.disc(7.5, 9.5, 3.4, 0); }, { hi: W, lw: 1 });
  b.disc(7.5, 9.5, 3.4, 0);
  b.vol([M, L, W], (m) => m.poly([[7.5, 0], [11, 3], [7.5, 6], [4, 3]], 1));
  b.px(6, 2, W);
};
G.gem = (b) => {
  b.vol([D, M, L], (m) => m.poly([[4, 2], [11, 2], [14, 6], [7.5, 14], [1, 6]], 1));
  b.poly([[4, 2], [11, 2], [9, 6], [6, 6]], W);
  b.line(1, 6, 14, 6, M); b.line(6, 6, 7, 13, K); b.line(9, 6, 8, 13, D);
  b.poly([[1, 6], [6, 6], [7, 13]], L);
};
G.book = (b) => {
  b.rect(4, 12, 10, 2, W); b.hl(4, 13, 10, D);
  b.vol(R4, (m) => m.rect(2, 1, 11, 12, 1), { hi: W });
  b.vl(4, 1, 12, K);
  b.vol([M, L, W], (m) => m.poly([[8.5, 4], [11, 7], [8.5, 10], [6, 7]], 1));
  b.rect(13, 2, 1, 11, L);
};
G.potion = (b) => {
  b.vol([K, D, M], (m) => { m.disc(7.5, 10, 5, 1); m.rect(6, 3, 4, 4, 1); });
  b.vol([M, L, W], (m) => { m.disc(7.5, 10, 4, 1); m.rect(3, 6, 10, 3, 0); });
  b.rect(3, 6, 10, 3, 0);
  b.vol([M, L, W], (m) => { m.disc(7.5, 10, 4, 1); });
  b.blendRect(3, 6, 10, 4, K, 0.6);
  b.rect(5, 1, 6, 2, D); b.hl(5, 1, 6, M);
  b.px(5, 9, W); b.px(5, 10, W);
};
G.bomb = (b) => {
  b.vol([K, D, M, L], (m) => m.disc(6.5, 9.5, 5.5, 1), { hi: W, grad: 0.5 });
  b.rect(8, 3, 3, 2, D);
  b.bez(10, 3, 12, 0, 14, 2, M, 1, 1);
  b.px(14, 1, W); b.px(15, 2, L); b.px(13, 0, L); b.px(15, 0, M);
  b.px(4, 7, W); b.px(4, 8, L);
};
G.wing = (b) => {
  b.map([
    'lw............',
    'mlw...........',
    'mmlww.........',
    'dmmllww.......',
    'dmmmmllwww....',
    '.dmmmmmmllww..',
    '.ddmmmmmmmmlw.',
    '..ddmmdmmdmmmw',
    '...dd.dmd.dmd.',
    '......dd..dd..',
  ], { w: W, l: L, m: M, d: D }, 1, 3);
};
G.anchor = (b) => {
  b.ring(5, 0, 6, 5, L);
  b.rect(7, 4, 2, 10, M); b.vl(7, 4, 10, L);
  b.rect(4, 5, 8, 2, M); b.hl(4, 5, 8, L);
  b.bez(1, 9, 3, 15, 7.5, 14, M, 2, 2); b.bez(14, 9, 12, 15, 7.5, 14, D, 2, 2);
  b.poly([[0, 8], [3, 9], [1, 11]], L); b.poly([[15, 8], [12, 9], [14, 11]], M);
};
G.chain = (b) => {
  const link = (x, y, c, hole) => { b.oval(x, y, 7, 5, c); b.oval(x + 2, y + 1.5, 3, 2, hole); };
  link(0, 10, D, 0); link(4, 6, L, 0); link(8, 2, M, 0);
  b.px(5, 12, D); b.px(9, 8, M);
  b.px(5, 7, W); b.px(9, 3, W); b.px(1, 11, M);
};
G.mirror = (b) => {
  b.vol(R4, (m) => { m.oval(2, 0, 12, 12, 1); m.rect(6, 11, 4, 5, 1); }, { hi: W });
  b.oval(4, 2, 8, 8, D);
  b.oval(4, 2, 8, 8, L);
  b.line(5, 7, 9, 3, W); b.line(7, 8, 10, 5, W);
  b.hl(5, 13, 6, D);
};
G.mask = (b) => {
  b.vol(R4, (m) => { m.oval(1, 1, 14, 14, 1); m.rect(0, 0, 16, 2, 0); }, { hi: W, lw: 2 });
  b.vol(R4, (m) => { m.poly([[1, 3], [7.5, 1], [14, 3], [14, 8], [11, 14], [4, 14], [1, 8]], 1); }, { hi: W, lw: 2 });
  b.poly([[3, 6], [6, 5], [7, 7], [4, 8]], O); b.poly([[12, 6], [9, 5], [8, 7], [11, 8]], O);
  b.bez(5, 11, 7.5, 13, 10, 11, O, 1, 1);
  b.px(7, 3, W);
};
G.candle = (b) => {
  b.vol([D, L, W], (m) => m.rect(5, 6, 6, 9, 1));
  b.rect(4, 14, 8, 2, D); b.hl(4, 14, 8, M);
  b.px(10, 7, M); b.px(10, 8, M); b.px(6, 7, W);
  b.vl(7, 4, 2, K);
  b.vol([M, L, W], (m) => { m.disc(7.5, 3, 1.5, 1); m.poly([[6, 3], [7.5, -1], [9, 3]], 1); });
};
G.lantern = (b) => {
  b.ring(5, 0, 6, 3, M);
  b.vol(R, (m) => m.poly([[4, 3], [11, 3], [13, 5], [2, 5]], 1));
  b.rect(3, 5, 10, 8, D);
  b.rect(4, 6, 8, 6, L); b.rect(5, 7, 6, 4, W);
  b.vl(7, 5, 8, M);
  b.vol(R, (m) => m.rect(2, 13, 12, 2, 1));
};
G.compass = (b) => {
  b.vol(R4, (m) => m.disc(7.5, 7.5, 7, 1), { hi: W });
  b.disc(7.5, 7.5, 5, K);
  b.poly([[7.5, 2], [9.5, 7.5], [5.5, 7.5]], W);
  b.poly([[7.5, 13], [9.5, 7.5], [5.5, 7.5]], D);
  b.px(7, 7, M); b.px(8, 7, M);
  b.px(2, 7, L); b.px(13, 7, M); b.px(7, 1, L);
};
G.dice = (b) => {
  b.poly([[7.5, 1], [14, 4], [7.5, 7], [1, 4]], L);
  b.poly([[1, 4], [7.5, 7], [7.5, 15], [1, 11]], M);
  b.poly([[14, 4], [7.5, 7], [7.5, 15], [14, 11]], D);
  b.line(7, 7, 7, 15, K);
  b.px(7, 4, O); b.px(8, 4, O);
  b.px(3, 7, O); b.px(5, 10, O); b.px(4, 9, O);
  b.px(10, 8, O); b.px(12, 7, O); b.px(10, 12, O); b.px(12, 11, O);
};
G.scale = (b) => {
  b.rect(7, 2, 2, 12, M); b.vl(7, 2, 12, L);
  b.rect(4, 13, 8, 2, D); b.hl(4, 13, 8, M);
  b.line(1, 3, 14, 3, L); b.disc(7.5, 2, 1, W);
  b.line(2, 4, 0, 9, D); b.line(2, 4, 4, 9, D); b.line(13, 4, 11, 9, D); b.line(13, 4, 15, 9, D);
  b.vol([D, M, L], (m) => { m.oval(-1, 8, 7, 4, 1); m.rect(-1, 8, 7, 1, 0); });
  b.vol([D, M, L], (m) => { m.oval(10, 8, 7, 4, 1); m.rect(10, 8, 7, 1, 0); });
};
G.thorn = (b) => {
  b.bez(1, 14, 3, 5, 14, 2, D, 3, 2);
  b.bez(1, 13, 3, 5, 14, 1, M, 1, 1);
  const sp = [[3, 10, -1], [4, 6, 1], [7, 4, -1], [10, 3, 1], [12, 2, -1]];
  sp.forEach(([x, y, s]) => {
    if (s < 0) b.poly([[x - 1, y], [x - 4, y - 2], [x, y - 2]], L);
    else b.poly([[x, y + 1], [x + 3, y + 3], [x + 1, y - 1]], L);
  });
  sp.forEach(([x, y, s]) => b.px(s < 0 ? x - 4 : x + 3, s < 0 ? y - 2 : y + 3, W));
};
G.spiral = (b) => {
  let px = 7.5, py = 7.5;
  for (let i = 1; i <= 64; i++) {
    const a = i * 0.21, r = 0.4 + i * 0.095;
    const x = 7.5 + Math.cos(a) * r, y = 7.5 + Math.sin(a) * r;
    b.stroke(px, py, x, y, i < 12 ? W : i < 40 ? L : M, 2);
    px = x; py = y;
  }
};
G.cross = (b) => {
  b.vol(R4, (m) => { m.rect(6, 0, 4, 16, 1); m.rect(1, 4, 14, 4, 1); }, { hi: W });
  b.rect(7, 5, 2, 2, W);
};
G.hand = (b) => {
  b.vol(R, (m) => {
    m.rect(3, 7, 9, 7, 1); m.oval(3, 11, 9, 4, 1);
    m.rect(3, 2, 2, 6, 1); m.rect(5, 1, 2, 7, 1); m.rect(7, 1, 2, 7, 1); m.rect(9, 2, 2, 6, 1);
    m.poly([[11, 9], [14, 5], [15, 6], [12, 12]], 1);
  }, { hi: W });
  b.vl(5, 3, 4, D); b.vl(7, 2, 5, D); b.vl(9, 3, 4, D);
  b.line(5, 10, 9, 11, D);
};
G.tooth = (b) => {
  b.vol([D, L, W], (m) => { m.oval(1, 1, 14, 9, 1); m.poly([[2, 6], [7, 6], [5, 15], [3, 15]], 1); m.poly([[9, 6], [14, 6], [12, 15], [10, 15]], 1); });
  b.line(7, 2, 8, 4, M); b.px(6, 9, M); b.px(9, 9, D);
};
G.horn = (b) => {
  b.vol(R4, (m) => { m.bez(4, 14, 2, 4, 14, 1, 1, 6, 1); }, { hi: W });
  [[0.2, K], [0.42, D], [0.62, D]].forEach(([t, c]) => {
    const u = 1 - t;
    const x = u * u * 4 + 2 * u * t * 2 + t * t * 14, y = u * u * 14 + 2 * u * t * 4 + t * t * 1;
    const w = 6 + (1 - 6) * t;
    b.line(x - w / 2, y - w / 4, x + w / 2, y + w / 4 + 1, c);
  });
  b.hl(2, 14, 5, D);
};

for (const name of GLYPH_NAMES) {
  still('glyph_' + name, 16, 16, (b) => G[name](b), { tint: true, outline: OUT });
}
