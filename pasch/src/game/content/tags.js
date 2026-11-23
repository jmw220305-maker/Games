// Marken: Belohnung fürs Überspringen. timing: 'now' (sofort beim Erhalt), 'shop' (nächster Laden),
// 'round' (nächste Partie), 'warden' (nach der nächsten Wächter-Partie), 'tag' (nächste Marke).
const G = [
  { id: 'tag_money', name: 'Investition', timing: 'warden', glyph: '$', hue: 48, desc: '+$15 nach der nächsten Wächter-Partie.' },
  { id: 'tag_charm', name: 'Gönner', timing: 'shop', glyph: '♢', hue: 140, desc: 'Nächster Laden: 1 ungewöhnlicher Talisman gratis.' },
  { id: 'tag_star', name: 'Sternschnuppe', timing: 'now', pack: 'p_mega_star', glyph: '✶', hue: 260, desc: 'Sofort: ein Großer Sternbeutel gratis.' },
  { id: 'tag_tool', name: 'Werkstatt', timing: 'now', pack: 'p_tool', glyph: '⟋', hue: 30, desc: 'Sofort: ein Werkzeugbeutel gratis.' },
  { id: 'tag_sale', name: 'Ausverkauf', timing: 'shop', glyph: '%', hue: 0, desc: 'Nächster Laden: 2× gratis neu mischen, alle Preise −50 %.' },
  { id: 'tag_throw', name: 'Rückenwind', timing: 'round', glyph: '↟', hue: 180, desc: '+1 Wurf in der nächsten Partie.' },
  { id: 'tag_dice', name: 'Würfelmacher', timing: 'now', pack: 'p_dice', glyph: '⚄', hue: 40, desc: 'Sofort: ein Würfelbeutel gratis.' },
  { id: 'tag_double', name: 'Doppel', timing: 'tag', glyph: '⧉', hue: 300, desc: 'Die nächste Marke, die du erhältst, gibt es doppelt.' },
];

export const TAGS = {};
for (const g of G) TAGS[g.id] = g;
export const TAG_IDS = G.map((g) => g.id);
