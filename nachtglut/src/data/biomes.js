// Biome definitions. One biome per floor. Enemy ids here are the authoritative roster
// (data/enemies.js must define every id listed; gen/ uses `cost` as spawn budget price).
export const BIOMES = {
  ash: {
    id: 'ash', floor: 1, name: 'Aschegruben', subtitle: 'Wo das letzte Feuer erstickte',
    hazard: 'lava', hazardName: 'Glutriss', hazardStatus: 'burn', hazardType: 'fire',
    darkness: 0.62, ambient: '#2a1a14', accent: '#ff7a2f', fog: '#1a0f0b',
    palette: { floor: '#3b2f2a', floorAlt: '#443630', wall: '#1f1715', wallTop: '#5a463c', pit: '#0d0807', hazard: '#ff6a1f', detail: '#6b5245' },
    music: 'ash',
    enemies: [
      { id: 'ash_crawler', cost: 1, weight: 10 },
      { id: 'cinder_bat', cost: 1, weight: 7 },
      { id: 'ember_spitter', cost: 2, weight: 7 },
      { id: 'soot_bomber', cost: 2, weight: 5 },
      { id: 'kiln_turret', cost: 3, weight: 3, max: 2 },
      { id: 'slag_brute', cost: 4, weight: 3, minDepth: 2 },
    ],
    boss: 'boss_cinder',
  },
  fungal: {
    id: 'fungal', floor: 2, name: 'Sporengrotten', subtitle: 'Es atmet im Dunkeln',
    hazard: 'spores', hazardName: 'Sporenmoos', hazardStatus: 'poison', hazardType: 'poison',
    darkness: 0.66, ambient: '#12222a', accent: '#59e0b0', fog: '#0a1418',
    palette: { floor: '#24343a', floorAlt: '#2a3d42', wall: '#101c20', wallTop: '#3f6a5f', pit: '#050b0d', hazard: '#9be35a', detail: '#8a5fd0' },
    music: 'fungal',
    enemies: [
      { id: 'spore_puff', cost: 1, weight: 10 },
      { id: 'rot_swarm', cost: 0.5, weight: 6, pack: [4, 6] },
      { id: 'myco_shooter', cost: 2, weight: 7 },
      { id: 'vine_lasher', cost: 3, weight: 4, max: 3 },
      { id: 'brood_pod', cost: 3, weight: 3, max: 2 },
      { id: 'mire_stalker', cost: 3, weight: 4, minDepth: 2 },
    ],
    boss: 'boss_mycel',
  },
  frost: {
    id: 'frost', floor: 3, name: 'Frostadern', subtitle: 'Die Kälte erinnert sich',
    hazard: 'ice', hazardName: 'Glatteis', hazardStatus: 'chill', hazardType: 'frost',
    darkness: 0.55, ambient: '#162536', accent: '#8fd8ff', fog: '#0b1420',
    palette: { floor: '#2b3d52', floorAlt: '#32465d', wall: '#131c29', wallTop: '#6f93b8', pit: '#060a12', hazard: '#bfeaff', detail: '#dff4ff' },
    music: 'frost',
    enemies: [
      { id: 'frost_wisp', cost: 2, weight: 8 },
      { id: 'glacier_slime', cost: 2, weight: 7 },
      { id: 'rime_wolf', cost: 2, weight: 6, pack: [2, 3] },
      { id: 'shard_archer', cost: 3, weight: 5, max: 3 },
      { id: 'snow_caster', cost: 3, weight: 4, max: 2 },
      { id: 'ice_golem', cost: 4, weight: 3, minDepth: 2 },
    ],
    boss: 'boss_rime',
  },
  void: {
    id: 'void', floor: 4, name: 'Schattenkern', subtitle: 'Hier endet jedes Licht',
    hazard: 'rift', hazardName: 'Leerenriss', hazardStatus: 'weak', hazardType: 'shadow',
    darkness: 0.78, ambient: '#150f24', accent: '#b07cff', fog: '#07040f',
    palette: { floor: '#231a36', floorAlt: '#2a2040', wall: '#0c0816', wallTop: '#4b3a78', pit: '#020105', hazard: '#b07cff', detail: '#e04bd0' },
    music: 'void',
    enemies: [
      { id: 'null_leech', cost: 1, weight: 7, pack: [2, 4] },
      { id: 'shade', cost: 2, weight: 9 },
      { id: 'void_eye', cost: 3, weight: 6, max: 3 },
      { id: 'rift_mage', cost: 3, weight: 5, max: 2 },
      { id: 'echo_knight', cost: 4, weight: 4 },
      { id: 'gloom_mother', cost: 5, weight: 2, max: 1, minDepth: 2 },
    ],
    boss: 'boss_umbra',
  },
  core: {
    id: 'core', floor: 5, name: 'Sonnenherz', subtitle: 'Die erloschene Mitte der Welt',
    hazard: 'lava', hazardName: 'Sonnenglut', hazardStatus: 'burn', hazardType: 'light',
    darkness: 0.5, ambient: '#2a2210', accent: '#ffd35a', fog: '#120e05',
    palette: { floor: '#3a3220', floorAlt: '#443a24', wall: '#17130a', wallTop: '#8a6f2e', pit: '#050402', hazard: '#ffd35a', detail: '#fff3b0' },
    music: 'core',
    enemies: [
      { id: 'sun_shard', cost: 3, weight: 6, max: 3 },
      { id: 'ash_revenant', cost: 5, weight: 4, max: 2 },
      { id: 'slag_brute', cost: 3, weight: 3 },
      { id: 'mire_stalker', cost: 3, weight: 3 },
      { id: 'ice_golem', cost: 3, weight: 3 },
      { id: 'echo_knight', cost: 3, weight: 4 },
      { id: 'rift_mage', cost: 3, weight: 3 },
      { id: 'shade', cost: 2, weight: 4 },
    ],
    boss: 'boss_sun',
  },
};

export const FLOOR_ORDER = ['ash', 'fungal', 'frost', 'void', 'core'];
export const biomeForFloor = (index) => BIOMES[FLOOR_ORDER[Math.min(FLOOR_ORDER.length, Math.max(1, index)) - 1]];
