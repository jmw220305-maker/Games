// Central access to content registries. Only re-exports and lazy lookups here: content modules import
// core helpers (combat.js) which import this file, so nothing may be read at module-evaluation time.
import { ENEMIES, AFFIXES } from '../data/enemies.js';
import { AI } from './ai.js';
import { BOSSES, BOSS_AI } from './bosses.js';
import { WEAPONS } from '../data/weapons.js';
import { CHARACTERS } from '../data/characters.js';
import { RELICS } from '../data/relics.js';
import { BOONS } from '../data/boons.js';
import { SHRINES } from '../data/shrines.js';

export { ENEMIES, AFFIXES, AI, BOSSES, BOSS_AI, WEAPONS, CHARACTERS, RELICS, BOONS, SHRINES };

const PLACEHOLDER_AI = {
  update(w, e, dt) {
    const d = w.flowDir(e.x, e.y);
    const sp = e.speed * e.slowMul;
    w.moveEntity(e, d.x * sp * dt, d.y * sp * dt);
    if (d.x) e.flipX = d.x < 0;
    e.anim = 'walk';
  },
};

const warned = new Set();
function warnOnce(msg) { if (!warned.has(msg)) { warned.add(msg); console.warn(msg); } }

/** Enemy or boss definition by id. Unknown ids get a generic placeholder so the game never crashes on missing content. */
export function enemyDef(id) {
  const d = ENEMIES[id] || BOSSES[id];
  if (d) return d;
  warnOnce(`[registry] missing enemy def "${id}" – using placeholder`);
  return {
    id, name: id, desc: '', biome: 'ash', hp: 30, speed: 45, damage: 10, r: 6, mass: 1, xp: 3, sparks: [0, 2],
    sprite: id, color: '#c0508a', ai: '__placeholder', aiParams: {},
  };
}

export function aiFor(name) {
  const a = AI[name] || BOSS_AI[name];
  if (a) return a;
  if (name !== '__placeholder') warnOnce(`[registry] missing AI "${name}" – using placeholder`);
  return PLACEHOLDER_AI;
}

export function allEnemyDefs() { return { ...ENEMIES, ...BOSSES }; }
