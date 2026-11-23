// Wächter (Boss-Partien). Die Regel-Logik steckt in run.js/scoring.js und fragt diese Flags ab.
// Flags: rerollsZero, throwsOne, noRepeat, fixation, fogCount, eclipse, toll, shackle, turner, thief, grudge,
//        chill, leaden. targetMul überschreibt den Wächter-Faktor ×2.

const W = [
  { id: 'leaden', name: 'Der Bleierne', minAnte: 2, glyph: '⚊', hue: 215, leaden: true,
    desc: 'Einsen und Zweien zählen nicht (keine Punkte, keine Hände).' },
  { id: 'miser', name: 'Der Geizhals', minAnte: 2, glyph: '⊘', hue: 40, rerollsZero: true,
    desc: 'Keine Nachwürfe.' },
  { id: 'lonely', name: 'Der Einsame', minAnte: 2, glyph: 'Ⅰ', hue: 230, throwsOne: true, targetMul: 1,
    desc: 'Nur 1 Wurf; dafür Ziel ×1 statt ×2.' },
  { id: 'echo', name: 'Das Echo', minAnte: 1, glyph: '⫶', hue: 175, noRepeat: true,
    desc: 'Keine Hand darf zweimal gewertet werden.' },
  { id: 'fixation', name: 'Die Fixierung', minAnte: 3, glyph: '⊙', hue: 0, fixation: true,
    desc: 'Nach dem ersten Wurf sind nur noch Hände erlaubt, die die zuerst gewertete Hand enthalten.' },
  { id: 'fog', name: 'Der Nebel', minAnte: 1, glyph: '▒', hue: 250, fogCount: 2,
    desc: '2 zufällige Würfel landen verdeckt („?“) bis zum Werten.' },
  { id: 'toll', name: 'Der Zöllner', minAnte: 1, glyph: '⊖', hue: 50, toll: true,
    desc: '−$1 je Nachwurf.' },
  { id: 'shackle', name: 'Die Fessel', minAnte: 1, glyph: '⊗', hue: 20, shackle: true,
    desc: 'In jedem Wurf ist ein zufälliger Würfel gefesselt: er kann nicht gehalten werden.' },
  { id: 'turner', name: 'Der Wender', minAnte: 2, glyph: '⇵', hue: 140, turner: true,
    desc: 'Nach jedem Nachwurf dreht ein zufälliger Würfel auf die Gegenseite.' },
  { id: 'wall', name: 'Die Mauer', minAnte: 2, glyph: '▙', hue: 10, targetMul: 4,
    desc: 'Ziel ×4.' },
  { id: 'thief', name: 'Der Dieb', minAnte: 2, glyph: '⌀', hue: 290, thief: true,
    desc: 'Ein zufälliger Talisman ist in dieser Partie deaktiviert.' },
  { id: 'grudge', name: 'Der Groll', minAnte: 3, glyph: '⌁', hue: 345, grudge: true,
    desc: 'Gewertete Würfel geben für den Rest der Partie keine Augen-Punkte mehr.' },
  { id: 'chill', name: 'Die Kälte', minAnte: 3, glyph: '❅', hue: 195, chill: true,
    desc: 'Basis-Multi der Hand halbiert.' },
  { id: 'abyss', name: 'Der Abgrund', minAnte: 8, finale: true, glyph: '◼', hue: 270, targetMul: 6,
    desc: 'Ziel ×6.' },
  { id: 'eclipse', name: 'Die Finsternis', minAnte: 8, finale: true, glyph: '●', hue: 260, eclipse: true,
    desc: 'Alle Würfel landen verdeckt; nachgewürfelte Würfel werden aufgedeckt.' },
];

export const WARDENS = {};
for (const w of W) {
  if (!w.finale) w.finale = false;
  WARDENS[w.id] = w;
}
export const WARDEN_IDS = W.map((w) => w.id);

export function isFinaleAnte(ante) {
  return ante % 8 === 0;
}

/** Wächter, die in diesem Einsatz gezogen werden dürfen. */
export function wardenPool(ante) {
  const finale = isFinaleAnte(ante);
  return W.filter((w) => (finale ? w.finale : !w.finale && w.minAnte <= ante)).map((w) => w.id);
}
