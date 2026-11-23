// UI-Texte (Deutsch) und Hervorhebung von Schlüsselwörtern in Beschreibungen.
import { esc } from './dom.js';
import { formatNumber } from '../core/format.js';

export const T = {
  title: 'PASCH',
  tagline: 'Wirf. Halte. Würfle nach. Lass die Zahlen explodieren.',
  newGame: 'Neues Spiel',
  continue: 'Fortsetzen',
  collection: 'Sammlung',
  settings: 'Einstellungen',
  start: 'Los geht’s!',
  back: 'Zurück',
  cup: 'Becher',
  stake: 'Stufe',
  seed: 'Startwert',
  seedHint: 'leer = zufällig',
  locked: 'Gesperrt',
  play: 'Spielen',
  skip: 'Überspringen',
  beginThrow: 'Wurf beginnen',
  reroll: 'Nachwürfeln',
  score: 'Werten',
  fizzle: 'Fehlwurf werten',
  target: 'Ziel',
  result: 'Ergebnis',
  throws: 'Würfe',
  rerolls: 'Nachwürfe',
  money: 'Geld',
  ante: 'Einsatz',
  round: 'Partie',
  handTable: 'Handtabelle',
  yourDice: 'Deine Würfel',
  options: 'Optionen',
  shopReroll: 'Neu mischen',
  nextRound: 'Nächste Partie',
  buy: 'Kaufen',
  sell: 'Verkaufen',
  use: 'Benutzen',
  keep: 'Behalten',
  take: 'Nehmen',
  free: 'Gratis',
  cashOut: 'Einsammeln',
  roundWon: 'Partie gewonnen!',
  runWon: 'Lauf gewonnen!',
  runLost: 'Verloren!',
  endless: 'Endlos weiterspielen',
  newRun: 'Neuer Lauf',
  toTitle: 'Zum Titel',
  resume: 'Weiterspielen',
  pause: 'Pause',
  confirm: 'Bestätigen',
  cancel: 'Abbrechen',
  again: 'Nochmal!',
};

export const KIND_NAMES = {
  star: 'Sternbild', tool: 'Werkzeug', mystic: 'Mystik', talisman: 'Talisman', pack: 'Beutel', voucher: 'Privileg',
  tag: 'Marke', warden: 'Wächter', hand: 'Hand', die: 'Würfel',
};

export const RARITY = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', legendary: 'Legendär' };

// Reihenfolge der Alternativen ist wichtig (×Multi vor Multi, Zahl+Wort vor Wort).
const RX = new RegExp([
  '(×\\([^)]*\\)(?:\\s*Multi)?|×\\s?\\d+(?:,\\d+)?(?:\\s*Multi)?|\\bx\\d+(?:,\\d+)?\\s*Multi)', // 1 xmult
  '([+−-]?\\d+(?:,\\d+)?\\s*Multi\\b|\\bMulti\\b)',                                          // 2 mult
  '([+−-]?\\d+(?:\\.\\d{3})*\\s*Punkte\\b|\\bPunkte\\b|\\bAugen-Punkte\\b)',                   // 3 chips
  '([+−-]?\\$\\d+)',                                                                          // 4 money
  '(„[^“]*“)',                                                                                // 5 Name
].join('|'), 'g');

/** Beschreibung → HTML mit farbigen Schlüsselwörtern. */
export function rich(str) {
  if (!str) return '';
  return esc(str).replace(RX, (m, x, mu, ch, mo, nm) => {
    if (x) return `<b class="kw kw-x">${x}</b>`;
    if (mu) return `<b class="kw kw-mult">${mu}</b>`;
    if (ch) return `<b class="kw kw-chips">${ch}</b>`;
    if (mo) return `<b class="kw kw-money">${mo}</b>`;
    if (nm) return `<b class="kw kw-name">${nm}</b>`;
    return m;
  });
}

export const fmt = (n) => formatNumber(Math.floor(n));
export const fmtMult = (m) => {
  if (m >= 1e6) return formatNumber(m);
  const r = Math.round(m * 100) / 100;
  return String(r).replace('.', ',');
};
export const money = (n) => (n < 0 ? `−$${-n}` : `$${n}`);
