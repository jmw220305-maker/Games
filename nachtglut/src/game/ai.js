// Enemy AI behaviours (owner: enemies). See docs/ARCHITECTURE.md §5.3.
// `AI[name] = { init?(w, e), update(w, e, dt) }` — one behaviour per enemy id plus generic `chaser` / `shooter`.
// Behaviours live in src/game/ai/<biome>.js; shared helpers in src/game/ai/util.js (re-exported here for reuse).
import { ASH_AI } from './ai/ash.js';
import { FUNGAL_AI } from './ai/fungal.js';
import { FROST_AI } from './ai/frost.js';
import { VOID_AI } from './ai/void.js';
import { CORE_AI, GENERIC_AI } from './ai/core.js';

export const AI = {
  ...GENERIC_AI,
  ...ASH_AI,
  ...FUNGAL_AI,
  ...FROST_AI,
  ...VOID_AI,
  ...CORE_AI,
};

// Helpers others may reuse (bosses, relics, skills): all take (w, e, ...) and respect e.dmgMul / projectile caps.
export {
  aimAt, face, telegraph, attackEvent, shoot, fireRing, fireFan, zone, telegraphLine, telegraphCircle,
  delayedBlast, rayLength, chase, kite, steerTo, moveDir, summon, teleportNear, killSelf, go, tick,
  speedScale, cdMul, PROJ_CAP,
} from './ai/util.js';
