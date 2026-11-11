// Level-up boons ("Segen"). See docs/ARCHITECTURE.md §6.5. `mods(stacks)` scales with the boon's stack count,
// hooks read `ctx.stacks`. `rarity` sets the roll weight (common / uncommon / rare).
import { TYPE_COLORS } from '../game/constants.js';

const pct = (v) => Math.round(v * 100);

/**
 * Boon desc: a function of the stack (run.js / ui descAt call desc(n)) whose toString() is the generic sentence,
 * so consumers that only expect a string (codex, tooltips via text()) still show the right text.
 */
function per(base, detail) {
  const f = (n = 1) => `${base} Stufe ${Math.max(1, n)}: ${detail(Math.max(1, n))}.`;
  f.toString = () => base;
  return f;
}

const LIST = [
  // --- core stats --------------------------------------------------------------------------
  {
    id: 'boon_might', name: 'Lodernde Kraft', rarity: 'common', maxStacks: 5,
    desc: per('+8 % Schaden pro Stufe.', (n) => `+${pct(0.08 * n)} %`),
    icon: { glyph: 'flame', color: '#ff8a3c' }, tags: ['damage'],
    mods: (n) => [{ stat: 'damage', mul: 1 + 0.08 * n }],
  },
  {
    id: 'boon_haste', name: 'Rasche Glut', rarity: 'common', maxStacks: 5,
    desc: per('+7 % Feuerrate pro Stufe.', (n) => `+${pct(0.07 * n)} %`),
    icon: { glyph: 'bolt', color: '#ffe75a' }, tags: ['fireRate'],
    mods: (n) => [{ stat: 'fireRate', mul: 1 + 0.07 * n }],
  },
  {
    id: 'boon_vigor', name: 'Zähe Asche', rarity: 'common', maxStacks: 5,
    desc: per('+15 max. Leben pro Stufe.', (n) => `+${15 * n}`),
    icon: { glyph: 'heart', color: '#ff6a5a' }, tags: ['hp'],
    mods: (n) => [{ stat: 'maxHp', add: 15 * n }],
  },
  {
    id: 'boon_fleet', name: 'Leichter Schritt', rarity: 'common', maxStacks: 4,
    desc: per('+6 % Lauftempo pro Stufe.', (n) => `+${pct(0.06 * n)} %`),
    icon: { glyph: 'boot', color: '#8fd8ff' }, tags: ['speed'],
    mods: (n) => [{ stat: 'moveSpeed', mul: 1 + 0.06 * n }],
  },
  {
    id: 'boon_keen', name: 'Scharfer Blick', rarity: 'common', maxStacks: 5,
    desc: per('+4 % Krit-Chance pro Stufe.', (n) => `+${4 * n} %`),
    icon: { glyph: 'eye', color: '#ffe75a' }, tags: ['crit'],
    mods: (n) => [{ stat: 'critChance', add: 0.04 * n }],
  },
  {
    id: 'boon_cruel', name: 'Grausame Glut', rarity: 'uncommon', maxStacks: 4,
    desc: per('+20 % Krit-Schaden pro Stufe.', (n) => `+${20 * n} %`),
    icon: { glyph: 'fang', color: '#ff4f5a' }, tags: ['crit'],
    mods: (n) => [{ stat: 'critMult', add: 0.2 * n }],
  },
  {
    id: 'boon_reach', name: 'Weiter Funkenflug', rarity: 'common', maxStacks: 4,
    desc: per('+12 % Reichweite und +6 % Projektiltempo pro Stufe.', (n) => `+${12 * n} % / +${6 * n} %`),
    icon: { glyph: 'compass', color: '#ffd9a0' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'range', mul: 1 + 0.12 * n }, { stat: 'projSpeed', mul: 1 + 0.06 * n }],
  },
  {
    id: 'boon_size', name: 'Schwere Glut', rarity: 'common', maxStacks: 3,
    desc: per('+10 % Projektilgröße und Rückstoß pro Stufe.', (n) => `+${10 * n} %`),
    icon: { glyph: 'orb', color: '#b9b3a8' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'projSize', mul: 1 + 0.1 * n }, { stat: 'knockback', mul: 1 + 0.1 * n }],
  },
  {
    id: 'boon_magnet', name: 'Sog der Glut', rarity: 'common', maxStacks: 3,
    desc: per('+25 % Aufsammelradius pro Stufe.', (n) => `+${25 * n} %`),
    icon: { glyph: 'anchor', color: '#9aa7b8' }, tags: ['utility'],
    mods: (n) => [{ stat: 'pickupRadius', mul: 1 + 0.25 * n }],
  },
  {
    id: 'boon_armor', name: 'Aschehaut', rarity: 'uncommon', maxStacks: 4,
    desc: per('+1 Rüstung pro Stufe.', (n) => `+${n}`),
    icon: { glyph: 'shield', color: '#9a948a' }, tags: ['defense'],
    mods: (n) => [{ stat: 'armor', add: n }],
  },
  {
    id: 'boon_dodge', name: 'Schattentanz', rarity: 'uncommon', maxStacks: 4,
    desc: per('+4 % Ausweichen pro Stufe.', (n) => `+${4 * n} %`),
    icon: { glyph: 'mask', color: '#b07cff' }, tags: ['defense'],
    mods: (n) => [{ stat: 'dodge', add: 0.04 * n }],
  },
  {
    id: 'boon_regen', name: 'Glimmendes Blut', rarity: 'uncommon', maxStacks: 4,
    desc: per('+0,15 Leben pro Sekunde pro Stufe.', (n) => `+${(0.15 * n).toFixed(2).replace('.', ',')}/s`),
    icon: { glyph: 'leaf', color: '#7dff9a' }, tags: ['heal'],
    mods: (n) => [{ stat: 'regen', add: 0.15 * n }],
  },
  {
    id: 'boon_leech', name: 'Durstige Flamme', rarity: 'uncommon', maxStacks: 4,
    desc: per('+1,5 % Lebensraub pro Stufe.', (n) => `+${(1.5 * n).toString().replace('.', ',')} %`),
    icon: { glyph: 'tooth', color: '#ff4f5a' }, tags: ['heal'],
    mods: (n) => [{ stat: 'lifesteal', add: 0.015 * n }],
  },
  {
    id: 'boon_dash', name: 'Windglut', rarity: 'common', maxStacks: 4,
    desc: per('−8 % Dash-Abklingzeit pro Stufe; ab Stufe 3 +1 Dash-Ladung.', (n) => `−${8 * n} %${n >= 3 ? ', +1 Ladung' : ''}`),
    icon: { glyph: 'wing', color: '#cfe8ff' }, tags: ['dash'],
    mods: (n) => [{ stat: 'dashCooldown', mul: 1 - 0.08 * n }, { stat: 'dashCharges', add: n >= 3 ? 1 : 0 }],
  },
  {
    id: 'boon_skill_cd', name: 'Glutgedächtnis', rarity: 'common', maxStacks: 4,
    desc: per('−8 % Fertigkeits-Abklingzeit pro Stufe.', (n) => `−${8 * n} %`),
    icon: { glyph: 'hourglass', color: '#ffe75a' }, tags: ['skill'],
    mods: (n) => [{ stat: 'skillCooldown', mul: 1 - 0.08 * n }],
  },
  {
    id: 'boon_skill_power', name: 'Lodernde Gabe', rarity: 'uncommon', maxStacks: 4,
    desc: per('+15 % Fertigkeitsstärke pro Stufe.', (n) => `+${15 * n} %`),
    icon: { glyph: 'star', color: '#ff9a3c' }, tags: ['skill'],
    mods: (n) => [{ stat: 'skillPower', mul: 1 + 0.15 * n }],
  },
  {
    id: 'boon_elite', name: 'Jägerinstinkt', rarity: 'common', maxStacks: 4,
    desc: per('+10 % Schaden gegen Elitegegner und Bosse pro Stufe.', (n) => `+${10 * n} %`),
    icon: { glyph: 'horn', color: '#d9b47a' }, tags: ['damage'],
    mods: (n) => [{ stat: 'eliteDamage', mul: 1 + 0.1 * n }, { stat: 'bossDamage', mul: 1 + 0.1 * n }],
  },
  {
    id: 'boon_thorns', name: 'Dornenhaut', rarity: 'common', maxStacks: 4,
    desc: per('Angreifer erleiden 5 Dornenschaden pro Stufe.', (n) => `${5 * n} Dornenschaden`),
    icon: { glyph: 'thorn', color: '#8a6a3a' }, tags: ['defense', 'thorns'],
    mods: (n) => [{ stat: 'thorns', add: 5 * n }],
  },
  {
    id: 'boon_light', name: 'Leuchtfeuer', rarity: 'common', maxStacks: 3,
    desc: per('+20 Lichtradius und +3 % Schaden pro Stufe.', (n) => `+${20 * n}, +${3 * n} %`),
    icon: { glyph: 'lantern', color: '#ffcf6a' }, tags: ['light', 'damage'],
    mods: (n) => [{ stat: 'lightRadius', add: 20 * n }, { stat: 'damage', mul: 1 + 0.03 * n }],
  },

  // --- elements ----------------------------------------------------------------------------
  {
    id: 'boon_burn', name: 'Zündfunke', rarity: 'common', maxStacks: 4,
    desc: per('+6 % Brandchance und +6 % Feuerschaden pro Stufe.', (n) => `+${6 * n} %`),
    icon: { glyph: 'ember', color: TYPE_COLORS.fire }, tags: ['fire', 'status'],
    mods: (n) => [{ stat: 'burnChance', add: 0.06 * n }, { stat: 'fireDamage', mul: 1 + 0.06 * n }],
  },
  {
    id: 'boon_chill', name: 'Reifhauch', rarity: 'common', maxStacks: 4,
    desc: per('+6 % Frostchance und +6 % Frostschaden pro Stufe.', (n) => `+${6 * n} %`),
    icon: { glyph: 'snowflake', color: TYPE_COLORS.frost }, tags: ['frost', 'status'],
    mods: (n) => [{ stat: 'chillChance', add: 0.06 * n }, { stat: 'frostDamage', mul: 1 + 0.06 * n }],
  },
  {
    id: 'boon_poison', name: 'Fäulnisatem', rarity: 'common', maxStacks: 4,
    desc: per('+6 % Giftchance und +6 % Giftschaden pro Stufe.', (n) => `+${6 * n} %`),
    icon: { glyph: 'drop', color: TYPE_COLORS.poison }, tags: ['poison', 'status'],
    mods: (n) => [{ stat: 'poisonChance', add: 0.06 * n }, { stat: 'poisonDamage', mul: 1 + 0.06 * n }],
  },
  {
    id: 'boon_shock', name: 'Gewitterfunke', rarity: 'common', maxStacks: 4,
    desc: per('+6 % Schockchance und +6 % Schockschaden pro Stufe.', (n) => `+${6 * n} %`),
    icon: { glyph: 'bolt', color: TYPE_COLORS.shock }, tags: ['shock', 'status'],
    mods: (n) => [{ stat: 'shockChance', add: 0.06 * n }, { stat: 'shockDamage', mul: 1 + 0.06 * n }],
  },
  {
    id: 'boon_shadow', name: 'Nachtschneide', rarity: 'uncommon', maxStacks: 4,
    desc: per('+10 % Schatten- und Lichtschaden pro Stufe.', (n) => `+${10 * n} %`),
    icon: { glyph: 'moon', color: TYPE_COLORS.shadow }, tags: ['shadow', 'light'],
    mods: (n) => [{ stat: 'shadowDamage', mul: 1 + 0.1 * n }, { stat: 'lightDamage', mul: 1 + 0.1 * n }],
  },
  {
    id: 'boon_status', name: 'Glühender Wille', rarity: 'uncommon', maxStacks: 4,
    desc: per('+12 % Statusstärke und +10 % Statusdauer pro Stufe.', (n) => `+${12 * n} % / +${10 * n} %`),
    icon: { glyph: 'spiral', color: '#c04bd6' }, tags: ['status'],
    mods: (n) => [{ stat: 'statusPower', mul: 1 + 0.12 * n }, { stat: 'statusDuration', mul: 1 + 0.1 * n }],
  },

  // --- fortune -----------------------------------------------------------------------------
  {
    id: 'boon_luck', name: 'Glückssträhne', rarity: 'uncommon', maxStacks: 3,
    desc: per('+1 Glück pro Stufe.', (n) => `+${n}`),
    icon: { glyph: 'dice', color: '#5fd38d' }, tags: ['luck'],
    mods: (n) => [{ stat: 'luck', add: n }],
  },
  {
    id: 'boon_xp', name: 'Wissensdurst', rarity: 'common', maxStacks: 3,
    desc: per('+10 % Erfahrung pro Stufe.', (n) => `+${10 * n} %`),
    icon: { glyph: 'book', color: '#c9a66b' }, tags: ['xp'],
    mods: (n) => [{ stat: 'xpGain', mul: 1 + 0.1 * n }],
  },
  {
    id: 'boon_sparks', name: 'Funkenschimmer', rarity: 'common', maxStacks: 3,
    desc: per('+10 % Funken pro Stufe.', (n) => `+${10 * n} %`),
    icon: { glyph: 'coin', color: '#ffd35a' }, tags: ['gold'],
    mods: (n) => [{ stat: 'sparkGain', mul: 1 + 0.1 * n }],
  },

  // --- boons with small effects ------------------------------------------------------------
  {
    id: 'boon_heartshard', name: 'Glutsplitter', rarity: 'uncommon', maxStacks: 3,
    desc: per('Kills haben 5 % Chance pro Stufe, ein Herz fallen zu lassen.', (n) => `${5 * n} %`),
    icon: { glyph: 'heart', color: '#ff8a7a' }, tags: ['heal', 'kill'],
    hooks: {
      onKill(ctx, { enemy }) {
        if (!enemy || enemy.summoned || enemy.noXp || !ctx.w) return;
        if (ctx.rng.chance(0.05 * ctx.stacks)) ctx.w.spawnPickup('heart', enemy.x, enemy.y, { burst: true });
      },
    },
  },
  {
    id: 'boon_multishot', name: 'Funkenregen', rarity: 'rare', maxStacks: 3,
    desc: per('+3 % Schaden pro Stufe. Auf Stufe 3: +1 Projektil pro Salve.', (n) => `+${3 * n} %${n >= 3 ? ', +1 Projektil' : ''}`),
    icon: { glyph: 'star', color: '#ffb347' }, tags: ['projectile', 'damage'],
    mods: (n) => [{ stat: 'damage', mul: 1 + 0.03 * n }, { stat: 'multishot', add: n >= 3 ? 1 : 0 }],
  },
  {
    id: 'boon_pierce', name: 'Durchdringende Glut', rarity: 'rare', maxStacks: 3,
    desc: per('Projektile durchschlagen Gegner: +1 Durchschlag auf Stufe 1 und 3, +5 % Schaden pro Stufe.', (n) => `+${Math.floor((n + 1) / 2)} Durchschlag`),
    icon: { glyph: 'dagger', color: '#cfe8ff' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'pierce', add: Math.floor((n + 1) / 2) }, { stat: 'damage', mul: 1 + 0.05 * n }],
  },
  {
    id: 'boon_bounce', name: 'Prallglut', rarity: 'uncommon', maxStacks: 3,
    desc: per('Projektile prallen 1× pro Stufe von Wänden ab.', (n) => `${n}×`),
    icon: { glyph: 'spiral', color: '#e0c9a6' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'bounce', add: n }],
  },
  {
    id: 'boon_homing', name: 'Suchende Funken', rarity: 'uncommon', maxStacks: 3,
    desc: per('Projektile suchen ihr Ziel: +0,8 Zielsuche pro Stufe.', (n) => `+${(0.8 * n).toFixed(1).replace('.', ',')}`),
    icon: { glyph: 'eye', color: '#b07cff' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'homing', add: 0.8 * n }],
  },
  {
    id: 'boon_heal', name: 'Wärmende Glut', rarity: 'uncommon', maxStacks: 3,
    desc: per('+15 % Heilwirkung pro Stufe. Geräumte Räume heilen 2 Leben pro Stufe.', (n) => `+${15 * n} %, ${2 * n} Leben`),
    icon: { glyph: 'cross', color: '#7dff9a' }, tags: ['heal'],
    mods: (n) => [{ stat: 'healPower', mul: 1 + 0.15 * n }],
    hooks: { onRoomClear(ctx) { if (ctx.w) ctx.w.healPlayer(2 * ctx.stacks); } },
  },
  {
    id: 'boon_shield', name: 'Aschewall', rarity: 'uncommon', maxStacks: 4,
    desc: per('Beim Betreten eines Kampfraums erhältst du 5 Schild pro Stufe.', (n) => `${5 * n} Schild`),
    icon: { glyph: 'shield', color: '#9ad0ff' }, tags: ['shield', 'defense'],
    hooks: { onRoomEnter(ctx) { if (ctx.w && ctx.w.locked) ctx.w.addShield(5 * ctx.stacks); } },
  },
  {
    id: 'boon_kill_haste', name: 'Jagdfieber', rarity: 'uncommon', maxStacks: 3,
    desc: per('Nach einem Kill: 2 s lang +6 % Feuerrate und +4 % Lauftempo pro Stufe.', (n) => `+${6 * n} % / +${4 * n} %`),
    icon: { glyph: 'claw', color: '#ff9a5a' }, tags: ['fireRate', 'speed', 'kill'],
    hooks: {
      onKill(ctx) { ctx.state.until = (ctx.run.time || 0) + 2; },
      dynamicMods(ctx) {
        if (!((ctx.state.until || 0) > (ctx.run.time || 0))) return null;
        return [{ stat: 'fireRate', mul: 1 + 0.06 * ctx.stacks }, { stat: 'moveSpeed', mul: 1 + 0.04 * ctx.stacks }];
      },
    },
  },
];

export const BOONS = {};
for (const def of LIST) {
  if (def.maxStacks == null) def.maxStacks = 1;
  BOONS[def.id] = def;
}
