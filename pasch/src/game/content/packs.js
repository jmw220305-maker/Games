// Beutel. size = Anzahl Auswahlen, picks = wie viele man nehmen darf. weight = Häufigkeit im Laden.
const P = [
  { id: 'p_star', name: 'Sternbeutel', price: 4, kind: 'star', size: 3, picks: 1, weight: 4, glyph: '✦', hue: 250,
    desc: 'Wähle 1 aus 3 Sternbildern (wird sofort angewendet).' },
  { id: 'p_tool', name: 'Werkzeugbeutel', price: 4, kind: 'tool', size: 3, picks: 1, weight: 4, glyph: '⟋', hue: 30,
    desc: 'Wähle 1 aus 3 Werkzeugen (sofort benutzen oder behalten).' },
  { id: 'p_charm', name: 'Talismanbeutel', price: 5, kind: 'talisman', size: 2, picks: 1, weight: 3, glyph: '♢', hue: 140,
    desc: 'Wähle 1 aus 2 Talismanen.' },
  { id: 'p_dice', name: 'Würfelbeutel', price: 5, kind: 'dice', size: 3, picks: 1, weight: 2, glyph: '⚄', hue: 40,
    desc: 'Wähle 1 aus 3 besonderen Würfeln; er ersetzt einen gewählten Würfel.' },
  { id: 'p_mystic', name: 'Mystikbeutel', price: 6, kind: 'mystic', size: 2, picks: 1, weight: 1, glyph: '❂', hue: 285,
    desc: 'Wähle 1 aus 2 Mystik-Gütern (sofort benutzen oder behalten).' },
  { id: 'p_mega_star', name: 'Großer Sternbeutel', price: 8, kind: 'star', size: 5, picks: 2, weight: 1, glyph: '✶', hue: 260,
    desc: 'Wähle 2 aus 5 Sternbildern (werden sofort angewendet).' },
];

export const PACKS = {};
for (const p of P) PACKS[p.id] = p;
export const PACK_IDS = P.map((p) => p.id);
export const PACK_WEIGHTS = P.map((p) => [p.id, p.weight]);
