// STUB — replaced by the enemies owner. Minimal roster so the core runs.
export const ENEMIES = {
  ash_crawler: {
    id: 'ash_crawler', name: 'Aschekriecher', desc: 'Krabbelt aus der kalten Asche.', biome: 'ash',
    hp: 22, speed: 48, damage: 9, r: 6, mass: 1, xp: 3, sparks: [0, 2], sprite: 'ash_crawler', color: '#b0a090',
    ai: 'chaser', aiParams: {},
  },
  ember_spitter: {
    id: 'ember_spitter', name: 'Glutspucker', desc: 'Spuckt glühende Schlacke.', biome: 'ash',
    hp: 26, speed: 34, damage: 8, r: 7, mass: 1.2, xp: 4, sparks: [1, 3], sprite: 'ember_spitter', color: '#ff8a3c',
    ai: 'shooter', aiParams: { range: 130, cooldown: 2.0, projSpeed: 110, damage: 10 },
  },
};
export const AFFIXES = {
  swift: { id: 'swift', name: 'Rasend', color: '#ffe75a', apply(w, e) { e.speed *= 1.4; } },
  tough: { id: 'tough', name: 'Gepanzert', color: '#9aa7b8', apply(w, e) { e.maxHp *= 1.8; e.hp = e.maxHp; } },
};
