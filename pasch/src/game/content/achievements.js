// Erfolge. check(s) bekommt die zusammengeführte Statistik (Profil + laufender Lauf, siehe meta.js).
// unlocks: {kind:'cup', id} – schaltet einen Becher frei.

const A = [
  { id: 'first_throw', name: 'Erster Wurf', glyph: '⚀', hue: 140, desc: 'Werte deinen ersten Wurf.', check: (s) => s.throws >= 1 },
  { id: 'ante3', name: 'Aufgewärmt', glyph: 'Ⅲ', hue: 0, desc: 'Erreiche Einsatz 3.', check: (s) => s.highestAnte >= 3, unlocks: { kind: 'cup', id: 'red' } },
  { id: 'ante4', name: 'Halbzeit', glyph: 'Ⅳ', hue: 215, desc: 'Erreiche Einsatz 4.', check: (s) => s.highestAnte >= 4, unlocks: { kind: 'cup', id: 'blue' } },
  { id: 'ante6', name: 'Hoch hinaus', glyph: 'Ⅵ', hue: 30, desc: 'Erreiche Einsatz 6.', check: (s) => s.highestAnte >= 6 },
  { id: 'win', name: 'Paschmeister', glyph: '♚', hue: 270, desc: 'Gewinne einen Lauf.', check: (s) => s.wins >= 1, unlocks: { kind: 'cup', id: 'black' } },
  { id: 'endless', name: 'Kein Ende in Sicht', glyph: '∞', hue: 280, desc: 'Erreiche im Endlosspiel Einsatz 9.', check: (s) => s.highestAnte >= 9 },
  { id: 'stake3', name: 'Hartgesotten', glyph: '⛤', hue: 340, desc: 'Gewinne einen Lauf auf Stufe 3 oder höher.', check: (s) => s.bestWinStake >= 3 },
  { id: 'pasch', name: 'Pasch!', glyph: '✪', hue: 330, desc: 'Werte einen Pasch.', check: (s) => (s.hands.pasch || 0) >= 1, unlocks: { kind: 'cup', id: 'loaded' } },
  { id: 'bigrun', name: 'Freie Bahn', glyph: '⇗', hue: 50, desc: 'Werte eine Große Straße.', check: (s) => (s.hands.bigrun || 0) >= 1 },
  { id: 'sixer', name: 'Sechs auf einen Streich', glyph: '✹', hue: 0, desc: 'Werte einen Sechsling.', check: (s) => (s.hands.sixer || 0) >= 1 },
  { id: 'skyladder', name: 'Himmelsstürmer', glyph: '☈', hue: 230, desc: 'Werte eine Himmelsleiter.', check: (s) => (s.hands.skyladder || 0) >= 1 },
  { id: 'throws50', name: 'Fingerübung', glyph: '⁘', hue: 48, desc: 'Werte insgesamt 50 Würfe.', check: (s) => s.throws >= 50, unlocks: { kind: 'cup', id: 'gold' } },
  { id: 'throws500', name: 'Würfelwerk', glyph: '⚅', hue: 60, desc: 'Werte insgesamt 500 Würfe.', check: (s) => s.throws >= 500 },
  { id: 'runs5', name: 'Stammgast', glyph: '⌂', hue: 160, desc: 'Beende 5 Läufe.', check: (s) => s.runs >= 5, unlocks: { kind: 'cup', id: 'tiny' } },
  { id: 'stars10', name: 'Sterndeuter', glyph: '✦', hue: 250, desc: 'Benutze insgesamt 10 Sternbilder.', check: (s) => s.constellationsUsed >= 10, unlocks: { kind: 'cup', id: 'star' } },
  { id: 'score1k', name: 'Tausender', glyph: 'K', hue: 175, desc: 'Erziele 1.000 Punkte mit einem Wurf.', check: (s) => s.bestThrow >= 1000 },
  { id: 'score10k', name: 'Zehntausend', glyph: '10K', hue: 185, desc: 'Erziele 10.000 Punkte mit einem Wurf.', check: (s) => s.bestThrow >= 10000 },
  { id: 'score100k', name: 'Hunderttausend', glyph: 'C', hue: 195, desc: 'Erziele 100.000 Punkte mit einem Wurf.', check: (s) => s.bestThrow >= 100000 },
  { id: 'score1m', name: 'Millionenwurf', glyph: 'M', hue: 300, desc: 'Erziele 1 Million Punkte mit einem Wurf.', check: (s) => s.bestThrow >= 1e6 },
  { id: 'full_slots', name: 'Volle Vitrine', glyph: '▤', hue: 205, desc: 'Besitze 5 Talismane gleichzeitig.', check: (s) => s.maxTalismans >= 5 },
  { id: 'rich', name: 'Goldgrube', glyph: '$', hue: 48, desc: 'Besitze $50 auf einmal.', check: (s) => s.maxMoney >= 50 },
  { id: 'shatter', name: 'Scherben bringen Glück', glyph: '◈', hue: 190, desc: 'Lass eine Glasfläche zerspringen.', check: (s) => s.glassShattered >= 1 },
  { id: 'retrigger5', name: 'Echo im Tal', glyph: '↻', hue: 170, desc: 'Löse 5 Wiederholungen in einem Wurf aus.', check: (s) => s.maxRetriggers >= 5 },
  { id: 'calm', name: 'Ruhige Hand', glyph: '⊙', hue: 120, desc: 'Gewinne eine Wächter-Partie ohne Nachwurf.', check: (s) => s.wardenNoReroll >= 1 },
  { id: 'legend', name: 'Legende', glyph: '❂', hue: 285, desc: 'Besitze einen legendären Talisman.', check: (s) => s.legendaryOwned >= 1 },
  { id: 'skip3', name: 'Überflieger', glyph: '»', hue: 15, desc: 'Überspringe 3 Partien in einem Lauf.', check: (s) => s.skipsInRun >= 3 },
  { id: 'level5', name: 'Meisterklasse', glyph: 'Ⅴ', hue: 100, desc: 'Bringe eine Hand auf Stufe 5.', check: (s) => s.maxHandLevel >= 5 },
];

export const ACHIEVEMENTS = {};
for (const a of A) {
  if (!a.unlocks) a.unlocks = null;
  ACHIEVEMENTS[a.id] = a;
}
export const ACHIEVEMENT_IDS = A.map((a) => a.id);
