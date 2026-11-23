// Schwierigkeitsstufen (kumulativ).
const S = [
  { id: 1, name: 'Normal', glyph: 'Ⅰ', hue: 140, desc: 'Normale Regeln.' },
  { id: 2, name: 'Knausrig', glyph: 'Ⅱ', hue: 60, desc: 'Die Kleine Partie gibt kein Geld.' },
  { id: 3, name: 'Steil', glyph: 'Ⅲ', hue: 30, desc: 'Alle Ziele ×1,2.' },
  { id: 4, name: 'Karg', glyph: 'Ⅳ', hue: 10, desc: '−1 Nachwurf pro Partie.' },
  { id: 5, name: 'Gnadenlos', glyph: 'Ⅴ', hue: 340, desc: 'Wächter-Ziele ×1,25 (Standard-Wächter ×2,5 statt ×2).' },
];
export const STAKES = {};
for (const s of S) STAKES[s.id] = s;
export const STAKE_IDS = S.map((s) => s.id);
export const MAX_STAKE = 5;

/** Beschreibung inkl. aller niedrigeren Stufen. */
export function stakeRules(stake) {
  return S.filter((s) => s.id <= stake && s.id > 1).map((s) => s.desc);
}
