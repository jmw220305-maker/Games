// Art registry: importing this module registers every sprite definition (DOM-free).
import { DEFS } from './helpers.js';
import './characters.js';

export { DEFS };

export const GLYPH_NAMES = Object.freeze([
  'flame', 'ember', 'skull', 'heart', 'shield', 'boot', 'eye', 'sword', 'dagger', 'hammer',
  'bow', 'staff', 'orb', 'star', 'sun', 'moon', 'snowflake', 'drop', 'bolt', 'leaf',
  'mushroom', 'bone', 'crown', 'coin', 'key', 'hourglass', 'feather', 'fang', 'claw', 'ring',
  'gem', 'book', 'potion', 'bomb', 'wing', 'anchor', 'chain', 'mirror', 'mask', 'candle',
  'lantern', 'compass', 'dice', 'scale', 'thorn', 'spiral', 'cross', 'hand', 'tooth', 'horn',
]);

/** Every registered sprite key (characters, enemies, bosses, props, pickups, projectiles, glyph_*). */
export const SPRITE_KEYS = Object.freeze([...DEFS.keys()]);
