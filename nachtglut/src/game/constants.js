// Shared constants. Do not change values without updating docs/ARCHITECTURE.md.
export const TS = 16; // tile size in world pixels

export const TILE = Object.freeze({
  FLOOR: 0,  // walkable
  WALL: 1,   // solid for everything
  PIT: 2,    // blocks ground movement; flying units and projectiles pass; player can dash across
  DOOR: 3,   // door tile on the room border; passable only while the room is unlocked
  SPIKES: 4, // walkable; periodic spike trap that damages the player while extended
  HAZARD: 5, // walkable; biome hazard (ash: lava crack/burn, fungal: spore moss/poison, void: rift/shadow)
  ICE: 6,    // walkable; slippery floor (frost biome)
  VOID: 8,   // outside of the playable room shape; solid and not rendered
});

export const ROOM_TYPES = Object.freeze([
  'start', 'combat', 'elite', 'treasure', 'shop', 'shrine', 'forge', 'rest', 'challenge', 'boss', 'secret',
]);

export const DIRS = Object.freeze({
  n: { dx: 0, dy: -1, opp: 's' },
  e: { dx: 1, dy: 0, opp: 'w' },
  s: { dx: 0, dy: 1, opp: 'n' },
  w: { dx: -1, dy: 0, opp: 'e' },
});

export const DAMAGE_TYPES = Object.freeze(['phys', 'fire', 'frost', 'poison', 'shock', 'shadow', 'light']);
export const STATUS_IDS = Object.freeze(['burn', 'poison', 'chill', 'freeze', 'shock', 'mark', 'stun', 'weak', 'slow']);
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'legendary', 'curse']);

export const RARITY_INFO = Object.freeze({
  common: { name: 'Gewöhnlich', color: '#b9b3a8', weight: 60 },
  uncommon: { name: 'Selten', color: '#5fd38d', weight: 28 },
  rare: { name: 'Episch', color: '#6aa9ff', weight: 10 },
  legendary: { name: 'Legendär', color: '#ffb347', weight: 2 },
  curse: { name: 'Fluch', color: '#c04bd6', weight: 0 },
});

export const TYPE_COLORS = Object.freeze({
  phys: '#e8e2d4', fire: '#ff8a3c', frost: '#8fd8ff', poison: '#9be35a', shock: '#ffe75a', shadow: '#b07cff', light: '#fff3b0',
});

// Spike trap cycle (seconds): hidden -> warn -> out
export const SPIKE_CYCLE = Object.freeze({ period: 2.6, warnAt: 1.3, outAt: 1.8 });

export const TOTAL_FLOORS = 5;
