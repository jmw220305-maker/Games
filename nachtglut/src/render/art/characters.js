// Playable characters, 18×20 canvases (figure ≈ 12×18), facing right.
import { humanoid } from './humanoid.js';

const W = 18, H = 20;

// --- Glutträger: hooded ember bearer with a glowing ember at the chest ---------------
{
  const pal = {
    h: '#93402c', H: '#c9683c', d: '#5e2523', k: '#3d1719',
    f: '#170d10', e: '#fff0b8', E: '#ffb347',
    t: '#3b2523', T: '#5a382e', s: '#e6a873',
    1: '#ff6a1f', 2: '#ffb347', 3: '#fff6c8',
  };
  const hot = { ...pal, 1: '#ff8a3c', 2: '#ffd87a', 3: '#ffffff' };
  humanoid('char_bearer', {
    w: W, h: H, pal,
    hy: 1,
    head: [
      '.......hHHh.......',
      '.....hHHHHHhd.....',
      '....hHHhhhhhhd....',
      '....hHhffffffd....',
      '....hHhfeffefd....',
      '....hhhfEffEfd....',
      '....dhhhffffdd....',
      '.....ddhhhhdd.....',
    ],
    ty: 9,
    torso: [
      '....hHhhhhhhhd....',
      '...hHhhtt12thhd...',
      '...hHhst1321shd...',
      '...hhhhtt12tthd...',
      '...dhhhtTttthdd...',
      '....dhhtttthdk....',
      '....kdhd..dhdk....',
    ],
    torsoPal: (p) => (p.f % 2 ? hot : pal),
    legs: { xl: 6, xr: 10, y: 16, leg: '#33211f', boot: '#6b4634', bootHi: '#9a6a48', far: '#2a1b1b', bootFar: '#54372b' },
    fx(b, p, c) {
      // tiny ember motes drifting up from the lantern / trailing in a dash
      if (p.dash) { b.px(1, 12 + (p.f || 0), '#ff8a3c'); b.px(0, 15 - (p.f || 0), '#c9683c'); return; }
      const f = p.f || 0;
      if (f === 1) b.px(13, 9 + c.by, '#ffb347');
      if (f === 2) b.px(14, 7 + c.by, '#ff7a2f');
      if (f === 3) b.px(14, 5 + c.by, '#a8300f');
    },
  });
}

// --- Schattenläuferin: slim dark-violet rogue with a flowing scarf -------------------
{
  const pal = {
    v: '#43327a', V: '#6a54b8', d: '#281c48', k: '#170f2c',
    s: '#e2b094', e: '#d8fbff', m: '#1c1430',
    S: '#e8447a', R: '#ff86a8', r: '#9c2458',
    g: '#cfd8e6', G: '#ffffff',
  };
  humanoid('char_shadow', {
    w: W, h: H, pal,
    hy: 1,
    head: [
      '.......vVVv.......',
      '......vVVVVvd.....',
      '.....vVVvvvvvd....',
      '.....vVvssssvd....',
      '.....vvsesesdd....',
      '.....dvmmmmmd.....',
      '......dmmmmd......',
      '.....rSRSSSSr.....',
    ],
    ty: 9,
    torso: [
      '.....rSSSSSrd.....',
      '......vVvvvvd.....',
      '.....svVvvgvds....',
      '.....svvkkGkds....',
      '......dvvvvdd.....',
      '......dvvddvd.....',
      '......dv..dvd.....',
    ],
    legs: { xl: 7, xr: 10, y: 16, leg: '#281c48', boot: '#1c1430', bootHi: '#43327a', far: '#1c1430', bootFar: '#140e24' },
    under(b, p, c) {
      // scarf tail fluttering behind (to the left)
      const f = p.step >= 0 ? p.step : (p.f || 0);
      const y = 9 + c.hy;
      const wave = [[0, 1, 1, 2], [0, 0, 1, 1], [0, -1, 0, 1], [0, 0, 0, 1]][f % 4];
      const len = p.dash ? 6 : 4;
      for (let i = 0; i < len; i++) {
        const yy = y + (p.dash ? (i > 3 ? -1 : 0) : wave[Math.min(3, i)]);
        b.px(5 - i, yy, i === 1 ? pal.R : pal.S);
        if (i < len - 1) b.px(5 - i, yy + 1, pal.r);
      }
    },
  });
}

// --- Eisenwächter: bulky iron-armoured guardian with an orange visor ------------------
{
  const pal = {
    a: '#7b8795', A: '#b2c0cd', W: '#e9f1f6', d: '#4b5461', D: '#2b313b',
    o: '#ff7a2f', O: '#ffd98a', g: '#d19a3a', p: '#d9451a', P: '#ff8a3c',
  };
  humanoid('char_warden', {
    w: W, h: H, pal,
    hy: 1,
    head: [
      '.......pPp........',
      '......dAAAAad.....',
      '.....aAWAAaaad....',
      '.....aAAaaaaad....',
      '.....aDoOooODd....',
      '.....aAaaDaaad....',
      '.....daaaDaadd....',
      '......dddddd......',
    ],
    ty: 9,
    torso: [
      '..aAWAadaadaAAad..',
      '..aAAaaAAaaaaaad..',
      '..daaDaAgAaaDadd..',
      '...ddDaAAaaaDdd...',
      '...aA.daaaad.aa...',
      '...dd.dggaad.dd...',
      '......daD.aad.....',
    ],
    legs: { xl: 6, xr: 10, y: 16, leg: '#4b5461', boot: '#7b8795', bootHi: '#b2c0cd', far: '#3a424e', bootFar: '#5a6472' },
    headPal: (p) => (p.f % 2 ? { ...pal, o: '#ff8a3c', O: '#fff0b8' } : pal),
  });
}

// --- Frostweberin: frost mage, pale blue robe, ice crown ------------------------------
{
  const pal = {
    r: '#86b2da', R: '#bfe0f6', d: '#5578aa', D: '#35507a',
    w: '#eef9ff', h: '#d3e6f5', H: '#a9c4de',
    i: '#9fe9ff', I: '#ffffff', s: '#f2ccb4', e: '#1fb4f0',
    c: '#6fe0ff', C: '#ffffff',
  };
  const robe = (sway) => {
    const rows = [
      '....HwwRrrrrdw....',
      '...HhRRrrrrrrd....',
      '...HhRrrrrrrsd....',
      '...HhRrrrrrrrd....',
      '....RRrrrDrrrd....',
      '....RrrrrDrrrdd...',
    ];
    const hem = [
      '...RRrrrrDrrrrd...',
      '...RrrrrrDrrrrdd..',
      '..RRrrrrrDrrrrrd..',
      '..wwwwwwwwwwwwwH..',
    ];
    const shift = (row, n) => (n > 0 ? '.'.repeat(n) + row.slice(0, row.length - n) : n < 0 ? row.slice(-n) + '.'.repeat(-n) : row);
    return rows.concat(hem.map((row, i) => shift(row, i >= 2 ? sway : 0)));
  };
  const robes = [robe(0), robe(-1), robe(1)];
  humanoid('char_weaver', {
    w: W, h: H, pal,
    hy: 1,
    head: [
      '.......i.I.i......',
      '.....wiIiIiIiH....',
      '....whhhhhhhhhH...',
      '....whhsssssshH...',
      '....whhsesseshh...',
      '....HhhsssssshH...',
      '....HHhhsssshH....',
      '....HhhHwwwwH.....',
    ],
    ty: 9,
    torso: (p) => robes[p.step === 0 ? 1 : p.step === 2 ? 2 : 0],
    legs: null,
    extra(b, p, c) {
      // floating frost crystal in front of the hand
      const f = p.f || 0;
      const y = 11 + (f % 4 === 1 || f % 4 === 2 ? -1 : 0);
      const x = 15;
      b.px(x, y - 1, pal.C);
      b.px(x - 1, y, pal.c); b.px(x, y, pal.C); b.px(x + 1, y, pal.c);
      b.px(x, y + 1, pal.c);
    },
    anims: {
      // robes glide: no body bob, the head dips instead
      walk: [7, { step: 0, f: 0, by: -1 }, { step: 1, f: 1, hy: 1 }, { step: 2, f: 2, by: -1 }, { step: 3, f: 3, hy: 1 }],
    },
  });
}

// --- Aschenkind: grey ashen body, cracks glowing red ----------------------------------
{
  const pal = {
    a: '#756c66', A: '#a2978d', d: '#4a423f', D: '#231c1d',
    c: '#ff4a1f', C: '#ffc04d', E: '#fff0b8', w: '#352826', x: '#4a3530',
  };
  const dim = { ...pal, c: '#d9451a', C: '#ff8a3c' };
  humanoid('char_revenant', {
    w: W, h: H, pal,
    hy: 2,
    head: [
      '......aAAAAa......',
      '.....aAAAAaaad....',
      '....aAAAaacaad....',
      '....aAAaaaCcad....',
      '....aAaDDaaDDd....',
      '....aaaDCaaDCd....',
      '....daaaaacaad....',
      '.....ddaaDDad.....',
    ],
    ty: 10,
    torso: [
      '......daAaad......',
      '.....aAAacaad.....',
      '....aAdaaCcadd....',
      '....ad.xwwcw.ad...',
      '....d..wxwww.d....',
      '.......wwdww......',
    ],
    headPal: (p) => (p.f % 2 ? dim : pal),
    torsoPal: (p) => (p.f % 2 ? dim : pal),
    legs: { xl: 7, xr: 10, y: 16, leg: '#756c66', boot: '#4a423f', bootHi: '#756c66', far: '#5a524e', bootFar: '#3a3331' },
    fx(b, p) {
      // ash and embers flaking off the head
      const f = (p.step >= 0 ? p.step : p.f) || 0;
      const pts = [[5, 2, '#a2978d'], [13, 1, '#ff6a1f'], [3, 4, '#756c66'], [14, 3, '#ffc04d']];
      const q = pts[f % 4];
      b.px(q[0] - (p.dash ? 3 : 0), q[1], q[2]);
      if (p.dash) { b.px(1, 9, '#ff6a1f'); b.px(0, 13, '#756c66'); }
    },
  });
}
