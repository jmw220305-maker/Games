// Formsprache der Gegenstände: jede Kategorie hat eine eigene Silhouette (inline SVG, viewBox 100×140) plus
// HTML-Überlagerungen für Glyphe/Name (Pixelschrift, Einpassen). Keine Bilder, alles deterministisch aus den Inhaltsdaten.
//   talisman → Hochkant-Karte mit Rahmen, Edelstein (Form je Seltenheit), Amulett an Kette, Namensband
//   star     → achteckige Sternenkarte (Siegel) mit Sternbild aus der ID, Handname + „+1 Stufe“
//   tool     → Hängeetikett mit Öse und Schnur (Kraftpapier/Messing)
//   mystic   → facettierter Kristall (Raute) mit Nebelschimmer
//   pack     → zugebundener Stoffbeutel mit Aufnäher
//   voucher  → Coupon mit perforierten Kanten, Stempel und Goldfolie
import { h } from '../dom.js';
import * as G from '../../game/index.js';

export const SHAPES = ['talisman', 'star', 'tool', 'mystic', 'pack', 'voucher'];

/** Formschlüssel eines Karten-Modells (null = generische Karte, z. B. Wächter/Marke). */
export function shapeOf(m) {
  if (!m) return null;
  if (m.kind === 'talisman') return 'talisman';
  if (m.kind === 'consumable') return m.ckind && SHAPES.includes(m.ckind) ? m.ckind : 'tool';
  if (m.kind === 'pack') return 'pack';
  if (m.kind === 'voucher') return 'voucher';
  return null;
}

// ------------------------------------------------------------------ deterministischer Zufall
function hashStr(s) {
  let x = 2166136261;
  for (const ch of String(s)) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (n) => Math.round(n * 10) / 10;
const poly = (pts) => pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
function ngon(cx, cy, r, n, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
function starPts(cx, cy, r1, r2, n, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? r2 : r1;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
const sparkle = (x, y, r) => `M${f1(x)},${f1(y - r)} Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)} Q${f1(x)},${f1(y)} ${f1(x)},${f1(y + r)} Q${f1(x)},${f1(y)} ${f1(x - r)},${f1(y)} Q${f1(x)},${f1(y)} ${f1(x)},${f1(y - r)}Z`;

const svgWrap = (cls, inner) => `<svg class="card-art art-${cls}" viewBox="0 0 100 140" aria-hidden="true" focusable="false">${inner}</svg>`;

// ------------------------------------------------------------------ Talisman
function talismanArt(m) {
  const rar = m.rarity || 'none';
  const gem = {
    common: `<circle class="t-gem o" cx="50" cy="10" r="6.2"/><circle class="t-gem-hi" cx="48" cy="8" r="2.2"/>`,
    uncommon: `<polygon class="t-gem o" points="50,1.5 58.5,10 50,18.5 41.5,10"/><polygon class="t-gem-hi" points="50,4 54,9 50,10 46,9"/>`,
    rare: `<polygon class="t-gem o" points="${poly(ngon(50, 10, 8, 6, Math.PI / 6))}"/><polygon class="t-gem-hi" points="${poly([[50, 3.5], [55.5, 6.8], [50, 9.5], [44.5, 6.8]])}"/>`,
    legendary: `<polygon class="t-gem o" points="${poly(starPts(50, 10, 11, 4.6, 4))}"/><polygon class="t-gem-hi" points="${poly([[50, 1.5], [52.2, 8], [50, 10], [47.8, 8]])}"/><circle class="t-gem-glow" cx="50" cy="10" r="13"/>`,
    none: `<circle class="t-gem o" cx="50" cy="10" r="6.2"/>`,
  }[rar];
  const corner = (d) => [d, `<g transform="translate(100 0) scale(-1 1)">${d}</g>`, `<g transform="translate(0 136) scale(1 -1)">${d}</g>`, `<g transform="translate(100 136) scale(-1 -1)">${d}</g>`].join('');
  let deco = '';
  if (rar === 'common' || rar === 'none') deco = corner('<circle class="t-rivet" cx="7.6" cy="7.6" r="1.7"/>');
  if (rar === 'uncommon') deco = `<rect class="t-inner" x="13" y="14" width="74" height="108" rx="3"/>${corner('<polygon class="t-notch" points="10,11 18,11 10,19"/>')}`;
  if (rar === 'rare' || rar === 'legendary') {
    deco = corner('<path class="t-orn-ol" d="M13,34 L13,14 L33,14"/><path class="t-orn" d="M13,34 L13,14 L33,14"/><circle class="t-orn-dot o" cx="13" cy="14" r="2.6"/>');
  }
  if (rar === 'legendary') {
    deco += [[22, 30], [78, 34], [24, 92], [80, 88], [70, 24]].map(([x, y], i) => `<path class="t-twinkle" d="${sparkle(x, y, i % 2 ? 2.4 : 3.2)}"/>`).join('');
  }
  const rays = [];
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    const a1 = a0 + Math.PI / 22;
    rays.push(`<polygon class="t-ray" points="${poly([[50, 66], [50 + Math.cos(a0) * 70, 66 + Math.sin(a0) * 70], [50 + Math.cos(a1) * 70, 66 + Math.sin(a1) * 70]])}"/>`);
  }
  return svgWrap('talisman', `
    <rect class="sh" x="3" y="7" width="94" height="130" rx="10"/>
    <rect class="t-frame o" x="3" y="3" width="94" height="130" rx="10"/>
    <rect class="t-bevel" x="6.5" y="6.5" width="87" height="123" rx="7"/>
    <svg x="11" y="12" width="78" height="112" viewBox="11 12 78 112"><rect class="t-panel" x="11" y="12" width="78" height="112"/>${rays.join('')}</svg>
    <rect class="t-panel-ol o" x="11" y="12" width="78" height="112" rx="5"/>
    ${deco}
    <circle class="t-halo" cx="50" cy="66" r="31"/>
    <path class="t-chain-ol" d="M15,14 Q28,38 45,43 M85,14 Q72,38 55,43"/>
    <path class="t-chain" d="M15,14 Q28,38 45,43 M85,14 Q72,38 55,43"/>
    <circle class="t-bail-ol" cx="50" cy="42.5" r="4.6"/><circle class="t-bail" cx="50" cy="42.5" r="4.6"/>
    <circle class="t-bezel o" cx="50" cy="67" r="23"/>
    <circle class="t-bezel-dots" cx="50" cy="67" r="20.3"/>
    <circle class="t-stone o" cx="50" cy="67" r="16.5"/>
    <path class="t-stone-hi" d="M37.5,62 A13.5,13.5 0 0 1 55,53.5 A16,16 0 0 0 37.5,62 Z"/>
    ${gem}
    <path class="t-tail o" d="M1,104 L12,104 L12,124 L1,124 L5.5,114 Z"/>
    <path class="t-tail o" d="M99,104 L88,104 L88,124 L99,124 L94.5,114 Z"/>
    <rect class="t-ribbon o" x="6" y="99" width="88" height="27" rx="2"/>
    <rect class="t-ribbon-hi" x="8" y="101" width="84" height="2.6"/>`);
}

// ------------------------------------------------------------------ Sternbild
function constellation(id) {
  const r = rng(hashStr(id));
  const n = 4 + Math.floor(r() * 3);
  const pts = [];
  let guard = 0;
  while (pts.length < n && guard++ < 200) {
    const a = r() * Math.PI * 2;
    const rad = 7 + r() * 20;
    const p = [50 + Math.cos(a) * rad, 55 + Math.sin(a) * rad * 0.95];
    if (pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 10)) pts.push(p);
  }
  // Kette nach Winkel um den Schwerpunkt, plus ein Ast
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let d = `M${pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' L')}`;
  if (pts.length > 4) d += ` M${f1(pts[0][0])},${f1(pts[0][1])} L${f1(pts[2][0])},${f1(pts[2][1])}`;
  const dust = [];
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 33;
    dust.push(`<circle class="s-dust" cx="${f1(50 + Math.cos(a) * rad)}" cy="${f1(55 + Math.sin(a) * rad)}" r="${f1(0.45 + r() * 0.6)}" style="opacity:${f1(0.35 + r() * 0.6)}"/>`);
  }
  const big = Math.floor(r() * pts.length);
  const stars = pts.map((p, i) => `<circle class="s-glow" cx="${f1(p[0])}" cy="${f1(p[1])}" r="${i === big ? 5.2 : 3.8}"/><path class="s-star" d="${sparkle(p[0], p[1], i === big ? 4 : 2.9)}"/>`).join('');
  return { d, dust: dust.join(''), stars };
}
function starArt(m) {
  const c = constellation(m.id);
  const ticks = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r0 = i % 3 ? 39.2 : 38;
    ticks.push(`M${f1(50 + Math.cos(a) * r0)},${f1(55 + Math.sin(a) * r0)} L${f1(50 + Math.cos(a) * 41.6)},${f1(55 + Math.sin(a) * 41.6)}`);
  }
  const oct = (r) => poly(ngon(50, 55, r, 8, Math.PI / 8));
  return svgWrap('star', `
    <polygon class="sh" points="${poly(ngon(50, 59, 48, 8, Math.PI / 8))}"/>
    <polygon class="s-rim o" points="${oct(48)}"/>
    <polygon class="s-rim-hi" points="${poly(ngon(50, 55, 48, 8, Math.PI / 8).slice(3, 7).concat([[50, 55]]))}"/>
    <polygon class="s-band o" points="${oct(42.5)}"/>
    <path class="s-tick" d="${ticks.join(' ')}"/>
    <circle class="s-sky o" cx="50" cy="55" r="35.5"/>
    <circle class="s-neb" cx="43" cy="47" r="21"/>
    <circle class="s-neb2" cx="60" cy="64" r="14"/>
    ${c.dust}
    <path class="s-line-ol" d="${c.d}"/>
    <path class="s-line" d="${c.d}"/>
    ${c.stars}`);
}

// ------------------------------------------------------------------ Werkzeug (Hängeetikett)
const TAG = 'M32,20 L68,20 L90,41 L90,121 Q90,128 83,128 L17,128 Q10,128 10,121 L10,41 Z';
const HOLE = 'M44.6,36 a5.4,5.4 0 1,0 10.8,0 a5.4,5.4 0 1,0 -10.8,0 Z';
function toolArt() {
  return svgWrap('tool', `
    <path class="sh" fill-rule="evenodd" transform="translate(0 4)" d="${TAG} ${HOLE}"/>
    <path class="tl-body o" fill-rule="evenodd" d="${TAG} ${HOLE}"/>
    <path class="tl-grain" d="M14,56 Q40,52 86,58 M14,98 Q46,94 86,101 M14,110 Q30,108 50,111 Q70,114 86,112 M60,46 Q74,47 86,50"/>
    <path class="tl-shade" d="M90,41 L90,121 Q90,128 83,128 L17,128 Q10,128 10,121 L10,118 Q12,123 18,123 L80,123 Q85,123 85,117 L85,44 Z"/>
    <path class="tl-stitch" d="M34,25 L66,25 L85,43.5 L85,118 Q85,123 80,123 L20,123 Q15,123 15,118 L15,43.5 Z"/>
    <path class="tl-ring o" fill-rule="evenodd" d="M41.4,36 a8.6,8.6 0 1,0 17.2,0 a8.6,8.6 0 1,0 -17.2,0 Z ${HOLE}"/>
    <path class="tl-ring-hi" d="M43.5,33.5 A7.2,7.2 0 0 1 52,29"/>
    <path class="tl-string-ol" d="M49,31.5 C44,20 40,9 31,-3 M51,31.5 C56,20 61,9 69,-3"/>
    <path class="tl-string" d="M49,31.5 C44,20 40,9 31,-3 M51,31.5 C56,20 61,9 69,-3"/>
    <circle class="tl-badge o" cx="50" cy="70" r="18"/>
    <circle class="tl-badge-ring" cx="50" cy="70" r="14.6"/>
    <path class="tl-badge-hi" d="M37,66 A13.5,13.5 0 0 1 52,56.6 A16,16 0 0 0 37,66 Z"/>`);
}

// ------------------------------------------------------------------ Mystik (Kristall)
function mysticArt() {
  const O = [[50, 3], [97, 57], [50, 111], [3, 57]];
  const I = [[50, 23], [74, 57], [50, 91], [26, 57]];
  return svgWrap('mystic', `
    <polygon class="sh" points="${poly(O.map(([x, y]) => [x, y + 4.5]))}"/>
    <polygon class="m-f1" points="${poly([O[3], O[0], I[0], I[3]])}"/>
    <polygon class="m-f2" points="${poly([O[0], O[1], I[1], I[0]])}"/>
    <polygon class="m-f3" points="${poly([O[1], O[2], I[2], I[1]])}"/>
    <polygon class="m-f4" points="${poly([O[2], O[3], I[3], I[2]])}"/>
    <polygon class="m-table" points="${poly(I)}"/>
    <path class="m-edge" d="M${O.map((p, i) => `${p[0]},${p[1]} L${I[i][0]},${I[i][1]}`).join(' M')} M${poly(I).split(' ').join(' L')} Z"/>
    <path class="m-glint" d="M14,57 L50,10 L50,17 Z"/>
    <polygon class="m-outline o" points="${poly(O)}"/>`);
}

// ------------------------------------------------------------------ Beutel
const BAG = 'M36,34 C14,48 3,78 6,104 C9,126 27,135 50,135 C73,135 91,126 94,104 C97,78 86,48 64,34 Z';
function packArt() {
  return svgWrap('pack', `
    <path class="sh" transform="translate(0 4)" d="${BAG}"/>
    <path class="b-ruffle o" d="M37,35 L28,15 Q32,6 40,11 Q44,2 50,8 Q56,2 60,11 Q68,6 72,15 L63,35 Z"/>
    <path class="b-fold" d="M44,11 L45,33 M56,11 L55,33 M35,14 L40,33 M65,14 L60,33"/>
    <path class="b-body o" d="${BAG}"/>
    <path class="b-shade" d="M64,34 C86,48 97,78 94,104 C91,126 73,135 50,135 C70,128 83,110 83,88 C83,64 73,46 60,36 Z"/>
    <path class="b-hi" d="M31,50 C20,62 13,79 14,94 C17,80 23,66 35,54 Z"/>
    <path class="b-seam" d="M50,40 C49,60 49,70 50,64"/>
    <rect class="b-tie o" x="30" y="29" width="40" height="7.5" rx="3.6"/>
    <path class="b-tie-twist" d="M36,29.5 L33,36 M43,29.5 L40,36 M50,29.5 L47,36 M57,29.5 L54,36 M64,29.5 L61,36"/>
    <path class="b-cord-ol" d="M60,35 Q64,44 68,51 M58,35 Q56,45 54,52"/>
    <path class="b-cord" d="M60,35 Q64,44 68,51 M58,35 Q56,45 54,52"/>
    <circle class="b-knot o" cx="59" cy="33" r="4"/>
    <circle class="b-patch o" cx="50" cy="83" r="19.5"/>
    <circle class="b-stitch" cx="50" cy="83" r="16.3"/>`);
}

// ------------------------------------------------------------------ Privileg (Coupon)
function ticketPath() {
  const top = 6, bot = 132, L = 8, R = 92, tear = 98, rs = 2.1, rb = 6.2;
  const bites = [];
  for (let y = 15; y < bot - 6; y += 9.4) if (Math.abs(y - tear) > rb + rs + 1.5) bites.push([y, rs]);
  bites.push([tear, rb]);
  bites.sort((a, b) => a[0] - b[0]);
  let d = `M${L},${top} L${R},${top}`;
  for (const [y, r] of bites) d += ` L${R},${f1(y - r)} A${r},${r} 0 0 0 ${R},${f1(y + r)}`;
  d += ` L${R},${bot} L${L},${bot}`;
  for (const [y, r] of [...bites].reverse()) d += ` L${L},${f1(y + r)} A${r},${r} 0 0 0 ${L},${f1(y - r)}`;
  return `${d} Z`;
}
const TICKET = ticketPath();
function voucherArt(m) {
  const no = String((hashStr(m.id) % 89) + 10);
  return svgWrap('voucher', `
    <path class="sh" transform="translate(0 4)" d="${TICKET}"/>
    <path class="v-body o" d="${TICKET}"/>
    <polygon class="v-band" points="14,58 14,40 46,10 64,10"/>
    <polygon class="v-band v-band2" points="14,92 14,84 80,12 86,12 86,18"/>
    <rect class="v-frame" x="14" y="12" width="72" height="80" rx="2"/>
    <rect class="v-frame" x="14" y="104" width="72" height="22" rx="2"/>
    <path class="v-tear" d="M15,98 L85,98"/>
    <text class="v-no" x="17.5" y="21.5">Nº ${no}</text>
    <path class="v-star" d="${sparkle(80, 19, 3.2)}"/>
    <g transform="rotate(-11 50 53)">
      <circle class="v-stamp" cx="50" cy="53" r="22"/>
      <circle class="v-stamp-in" cx="50" cy="53" r="17.6"/>
    </g>`);
}

// ------------------------------------------------------------------ Würfel-Kissen (Würfelbeutel)
export function cushionArt() {
  return svgWrap('die', `
    <ellipse class="sh" cx="50" cy="104" rx="44" ry="17"/>
    <path class="d-tassel-ol" d="M8,98 L4,118 M92,98 L96,118"/>
    <path class="d-tassel" d="M8,98 L4,118 M92,98 L96,118"/>
    <ellipse class="d-cushion o" cx="50" cy="98" rx="44" ry="17"/>
    <ellipse class="d-cushion-top" cx="50" cy="94" rx="34" ry="10"/>
    <path class="d-seam" d="M10,98 Q50,118 90,98"/>
    <g class="d-cloche">
      <path class="sh" transform="translate(0 4)" d="M12,98 Q12,40 50,40 Q88,40 88,98 Z"/>
      <path class="d-dome o" d="M12,98 Q12,40 50,40 Q88,40 88,98 Z"/>
      <path class="d-dome-hi" d="M22,88 Q22,54 44,49 Q30,58 28,88 Z"/>
      <rect class="d-rim o" x="6" y="94" width="88" height="8" rx="4"/>
      <circle class="d-knob o" cx="50" cy="37" r="5.5"/>
    </g>`);
}

// ------------------------------------------------------------------ Fläche bauen
const ART = { talisman: talismanArt, star: starArt, tool: toolArt, mystic: mysticArt, pack: packArt, voucher: voucherArt };

/**
 * Baut die Vorderseite (.card-face.shape-face) für eine Formkategorie.
 * parts: {glyphCls, nameCls, name(Node|String)} – Klassen aus card.js (Größenstufen).
 */
export function buildShapeFace(shape, m, parts) {
  const face = h(`div.card-face.shape-face.face-${shape}`);
  face.innerHTML = ART[shape](m);
  const glyph = h(`div.card-glyph.sg${parts.glyphCls || ''}`, h('span', m.glyph));
  const name = h(`div.card-name.sn${parts.nameCls || ''}`, parts.name);
  if (shape === 'mystic') face.appendChild(h('div.m-neb', h('div.m-neb-in')));
  if (shape === 'talisman' && m.rarity === 'legendary') face.appendChild(h('div.t-foil', h('div.t-foil-band')));
  if (shape === 'voucher') face.appendChild(h('div.v-foil', h('div.v-foil-band')));
  if (shape !== 'star') face.appendChild(glyph);
  if (shape === 'star') {
    const def = G.CONSUMABLES[m.id];
    const hd = def && def.hand && G.HANDS[def.hand];
    face.appendChild(h('div.s-up', '+1 Stufe'));
    face.appendChild(h('div.s-plaque.card-fit', hd ? hd.name : m.name));
  }
  if (shape === 'pack') {
    const def = G.PACKS[m.id];
    if (def && def.picks > 1) face.appendChild(h('div.b-big', `${def.picks}×`));
    if (def) face.appendChild(h('div.b-size', `${def.picks} aus ${def.size}`));
  }
  face.appendChild(name);
  face.appendChild(h('div.card-sheen'));
  face.appendChild(h('div.card-qm', '?'));
  return face;
}

/** Kleines Kategorie-Symbol (für Tooltips/Toasts/Etiketten): leeres Element, Form per CSS. */
export function shapeIcon(shape, hue) {
  return h(`span.shape-ico.shape-ico--${shape}`, { vars: hue != null ? { hue } : null, 'aria-hidden': 'true' });
}
