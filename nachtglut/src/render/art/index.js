// Art registry: importing this module registers every sprite definition (DOM-free).
import { DEFS } from './helpers.js';
import './characters.js';
import './enemies_ash.js';
import './enemies_fungal.js';
import './enemies_frost.js';
import './enemies_void.js';
import './bosses.js';
import './props.js';
import './projectiles.js';
import { GLYPH_NAMES } from './glyphs.js';

export { DEFS, GLYPH_NAMES };

/** Every registered sprite key (characters, enemies, bosses, props, pickups, projectiles, glyph_*). */
export const SPRITE_KEYS = Object.freeze([...DEFS.keys()]);
