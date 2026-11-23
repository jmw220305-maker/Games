// Feste Zahlen des Spiels (Balancing an einer Stelle).

export const RUN_VERSION = 1;
export const ANTES_TO_WIN = 8;
export const ANTE_BASES = [300, 700, 1800, 4500, 10000, 20000, 35000, 50000];
export const BLIND_KINDS = ['small', 'big', 'warden'];
export const BLIND_NAMES = { small: 'Kleine Partie', big: 'Große Partie', warden: 'Wächter-Partie' };
export const BLIND_MULT = { small: 1, big: 1.5, warden: 2 };
export const BLIND_REWARD = { small: 3, big: 4, warden: 5 };

export const START_MONEY = 4;
export const BASE_THROWS = 4;
export const BASE_REROLLS = 3;
export const BASE_INTEREST_CAP = 5;
export const INTEREST_STEP = 5;
export const MONEY_PER_THROW_LEFT = 1;

export const LIMITS = { talismans: 5, consumables: 2, dice: 5, shopSlots: 2 };
export const MAX_DICE_ABSOLUTE = 7;

export const SHOP_REROLL_BASE = 5;
export const SHOP_KIND_WEIGHTS = { talisman: 60, star: 25, tool: 15 };
export const RARITY_WEIGHTS = { common: 70, uncommon: 25, rare: 5 };
export const VOUCHER_PRICE = 10;
export const STAR_PRICE = 3;
export const TOOL_PRICE = 3;
export const MYSTIC_PRICE = 4;

export const MARKS = ['gold', 'ruby', 'azure', 'star', 'echo', 'glass', 'stone', 'clover'];
export const MATERIALS = ['lead', 'bone', 'prism', 'crystal', 'phantom'];

export const MARK_INFO = {
  gold: { name: 'Gold', desc: '+$1 beim Werten', glyph: '$', hue: 48 },
  ruby: { name: 'Rubin', desc: '+4 Multi beim Werten', glyph: '◆', hue: 340 },
  azure: { name: 'Azur', desc: '+30 Punkte beim Werten', glyph: '◇', hue: 200 },
  star: { name: 'Stern', desc: 'zählt als beliebige Augenzahl', glyph: '✦', hue: 280 },
  echo: { name: 'Echo', desc: 'Würfel wird 1× wiederholt', glyph: '↻', hue: 170 },
  glass: { name: 'Glas', desc: '×2 Multi; 1 zu 4: Fläche zerspringt', glyph: '◈', hue: 190 },
  stone: { name: 'Stein', desc: '+50 Punkte, keine Augenzahl, wertet immer', glyph: '■', hue: 30 },
  clover: { name: 'Klee', desc: '1 zu 5: +20 Multi; 1 zu 15: +$20', glyph: '♣', hue: 120 },
};

export const MATERIAL_INFO = {
  lead: { name: 'Blei', desc: 'höchste Fläche fällt doppelt so oft', glyph: '⊥', hue: 220 },
  bone: { name: 'Knochen', desc: 'beim Werten +2× Augen als Punkte', glyph: '⟟', hue: 40 },
  prism: { name: 'Prisma', desc: 'beim Werten +10 Multi', glyph: '△', hue: 300 },
  crystal: { name: 'Kristall', desc: 'beim Werten ×1,5 Multi', glyph: '✧', hue: 260 },
  phantom: { name: 'Phantom', desc: 'zählt nicht gegen das Würfellimit', glyph: '◌', hue: 250 },
};

export const MARK_RNG = {
  glassShatter: 1 / 4,
  cloverMult: 1 / 5,
  cloverMoney: 1 / 15,
};
