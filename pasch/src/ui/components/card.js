// Karten für Talismane, Verbrauchsgüter, Beutel, Privilegien, Marken, Wächter, Hände, Erfolge.
// Wurzel .card bekommt fx-Ebenen (hoverTilt, idleSway, juice, Drag) – kein eigenes CSS-transform darauf.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { hoverTilt, idleSway } from '../../fx/index.js';
import { attachTooltip } from '../tooltip.js';
import { rich, KIND_NAMES, RARITY } from '../text.js';
import { shapeOf, buildShapeFace } from './itemshapes.js';

/** Darstellungsdaten aus einem Inhalt. kind: talisman|consumable|pack|voucher|tag|warden|hand|achievement|cup|stake */
export function model(kind, id, extra = {}) {
  let def = null;
  let sub = '';
  let rarity = null;
  switch (kind) {
    case 'talisman': def = G.TALISMANS[id]; rarity = def && def.rarity; sub = KIND_NAMES.talisman; break;
    case 'consumable': def = G.CONSUMABLES[id]; sub = def ? KIND_NAMES[def.kind] : ''; break;
    case 'pack': def = G.PACKS[id]; sub = KIND_NAMES.pack; break;
    case 'voucher': def = G.VOUCHERS[id]; sub = KIND_NAMES.voucher; break;
    case 'tag': def = G.TAGS[id]; sub = KIND_NAMES.tag; break;
    case 'warden': def = G.WARDENS[id]; sub = KIND_NAMES.warden; break;
    case 'hand': def = G.HANDS[id]; sub = KIND_NAMES.hand; break;
    case 'achievement': def = G.ACHIEVEMENTS[id]; sub = 'Erfolg'; break;
    case 'cup': def = G.CUPS[id]; sub = 'Becher'; break;
    case 'stake': def = G.STAKES[id]; sub = 'Stufe'; break;
    default: break;
  }
  const ckind = kind === 'consumable' && def ? def.kind : null;
  return {
    kind, id, ckind,
    name: def ? def.name : '?',
    glyph: def ? def.glyph : '?',
    hue: def && def.hue != null ? def.hue : 270,
    rarity, sub,
    desc: def ? def.desc : '',
    ...extra,
  };
}

/** Tooltip-Inhalt für ein Modell (mit Lauf für dynamische Texte). */
export function tooltipFor(m, run, obj) {
  let body = m.desc || '';
  try {
    if (m.kind === 'talisman') body = G.describeTalisman(obj || { id: m.id, state: {} }, run);
    else if (m.kind === 'consumable') body = G.describeConsumable(obj || { id: m.id }, run);
    else if (m.kind === 'hand' && run) body = G.describeHand(m.id, run);
  } catch { /* Fallback desc */ }
  let kind = m.sub;
  if (m.rarity) kind = `${m.sub} · ${RARITY[m.rarity]}`;
  if (m.kind === 'consumable' && m.ckind === 'tool') {
    const def = G.CONSUMABLES[m.id];
    if (def && def.usableIn === 'round') kind += ' · nur im Wurf';
  }
  const t = { title: m.name, kind, body: rich(body), hue: m.hue, rarity: m.rarity, shape: shapeOf(m) };
  if (m.foot) t.foot = m.foot;
  return t;
}

/**
 * createCard(model, {run, obj, tilt=true, sway=true, tooltip=true, size, down}) → {el, m, destroy, setDown(b), update(obj)}
 */
export function createCard(m, opts = {}) {
  const glyphLen = [...String(m.glyph)].length;
  const shape = shapeOf(m);
  const el = h(`div.card.card--${m.kind}${m.ckind ? `.card--${m.ckind}` : ''}${m.rarity ? `.rar-${m.rarity}` : ''}${shape ? `.card--shape.shape-${shape}` : ''}${opts.unknown ? '.card--unknown' : ''}`, {
    vars: { hue: m.hue }, dataset: { id: m.id, kind: m.kind },
  });
  if (m.uid) el.dataset.uid = m.uid;
  const glyphCls = glyphLen > 2 ? '.card-glyph--long' : glyphLen > 1 ? '.card-glyph--mid' : '';
  let face;
  if (shape) {
    // eigene Formsprache je Kategorie (itemshapes.js)
    face = buildShapeFace(shape, m, { glyphCls, nameCls: nameCls(m.name), name: softHyphens(m.name) });
  } else {
    face = h('div.card-face',
      h('div.card-shine'),
      h('div.card-top', m.sub),
      h(`div.card-glyph${glyphCls}`, h('span', m.glyph)),
      h(`div.card-name${nameCls(m.name)}`, softHyphens(m.name)),
      h('div.card-sheen'));
  }
  el.appendChild(face);
  // Rückseite: Karten (Talisman, generisch) – Formen zeigen verdeckt ihre dunkle Silhouette (CSS .card--down)
  if (!shape || shape === 'talisman') el.appendChild(h('div.card-back', h('div.card-back-glyph', '⚄')));
  if (opts.badge) el.appendChild(h('div.card-badge', opts.badge));
  if (opts.down) el.classList.add('card--down');
  const offs = [];
  if (opts.tilt !== false) offs.push(hoverTilt(el, { maxDeg: 12, lift: 8, scale: 1.05 }));
  if (opts.sway !== false) offs.push(idleSway(el, opts.seed != null ? opts.seed : Math.random() * 1000, { deg: 1.4, px: 2 }));
  let obj = opts.obj || null;
  if (opts.tooltip !== false) {
    offs.push(attachTooltip(el, () => (el.classList.contains('card--down') ? null : tooltipFor(m, opts.run ? opts.run() : null, obj)), { below: opts.tooltipBelow }));
  }
  return {
    el, m,
    setDown(b) { el.classList.toggle('card--down', !!b); },
    update(o) { obj = o; },
    setBadge(text) {
      let b = el.querySelector('.card-badge');
      if (!text) { if (b) b.remove(); return; }
      if (!b) { b = h('div.card-badge'); el.appendChild(b); }
      b.textContent = text;
    },
    destroy() { offs.forEach((f) => f()); el.remove(); },
  };
}

// Trennstellen für lange Komposita (weiches Trennzeichen; nur sichtbar, wenn wirklich umbrochen wird)
const SUFFIXES = ['beutel', 'pfennig', 'kammer', 'zähler', 'becher', 'strumpf', 'finger', 'sieben', 'glocke', 'brett', 'krone', 'weber',
  'hauch', 'splitter', 'staub', 'tinte', 'bläser', 'blatt', 'schnuppe', 'macher', 'training', 'würfel', 'karte', 'zins', 'stapler',
  'gestirn', 'straße', 'schlag', 'geist', 'stein', 'werk', 'reaktion', 'gänger', 'brunnen', 'leiter', 'linie', 'vogel', 'heit', 'keit', 'auge', 'punkt'];
export function softHyphens(name) {
  return String(name).split(' ').map((w) => {
    if ([...w].length < 10) return w;
    const lw = w.toLowerCase();
    for (const suf of SUFFIXES) {
      if (lw.endsWith(suf) && lw.length - suf.length >= 3) return `${w.slice(0, w.length - suf.length)}\u00ad${w.slice(w.length - suf.length)}`;
    }
    return w;
  }).join(' ');
}

/** Lange Einzelwörter („Talismanbeutel“) passen sonst nicht auf schmale Karten. */
function nameCls(name) {
  const longest = Math.max(0, ...String(name).split(/\s+/).map((w) => [...w].length));
  return longest >= 13 ? '.card-name--xl' : longest >= 10 ? '.card-name--l' : '';
}

/** Würfel-Angebot (Würfelbeutel) als kleine Karte mit Flächenliste */
export function dieSummary(die) {
  const marks = die.faces.filter((f) => f.mark).map((f) => G.MARK_INFO[f.mark].name);
  const parts = [`W${die.sides}`];
  if (die.material) parts.push(G.MATERIAL_INFO[die.material].name);
  if (marks.length) parts.push(`Prägungen: ${marks.join(', ')}`);
  return parts.join(' · ');
}
