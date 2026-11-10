// STUB — replaced by the relics owner.
export const BOONS = {
  boon_might: { id: 'boon_might', name: 'Lodernde Kraft', desc: '+10 % Schaden pro Stufe.', rarity: 'common', icon: { glyph: 'flame', color: '#ff8a3c' }, maxStacks: 5, mods: (n) => [{ stat: 'damage', mul: 1 + 0.1 * n }] },
  boon_haste: { id: 'boon_haste', name: 'Rasche Glut', desc: '+8 % Feuerrate pro Stufe.', rarity: 'common', icon: { glyph: 'bolt', color: '#ffe75a' }, maxStacks: 5, mods: (n) => [{ stat: 'fireRate', mul: 1 + 0.08 * n }] },
  boon_vigor: { id: 'boon_vigor', name: 'Zähe Asche', desc: '+15 max. Leben pro Stufe.', rarity: 'common', icon: { glyph: 'heart', color: '#ff6a5a' }, maxStacks: 5, mods: (n) => [{ stat: 'maxHp', add: 15 * n }] },
  boon_fleet: { id: 'boon_fleet', name: 'Leichter Schritt', desc: '+6 % Lauftempo pro Stufe.', rarity: 'common', icon: { glyph: 'boot', color: '#8fd8ff' }, maxStacks: 4, mods: (n) => [{ stat: 'moveSpeed', mul: 1 + 0.06 * n }] },
};
