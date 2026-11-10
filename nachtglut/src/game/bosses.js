// Boss definitions + boss AI (owner: bosses). Core merges BOSSES into the enemy registry and BOSS_AI into
// the AI registry (see docs/ARCHITECTURE.md §5.3). One file per boss lives in ./bosses/.
//
//   boss_cinder  Schlackenkönig              floor 1   2 phases
//   boss_mycel   Myzelmutter                 floor 2   3 phases
//   boss_rime    Reifwyrm (+ boss_rime_segment ×8)            3 phases
//   boss_umbra   Umbra, der Zwillingsschatten (+ boss_umbra_twin, shared HP pool)   3 phases
//   boss_sun     Die Erloschene Sonne (+ boss_sun_core satellites)   3 phases, final boss
import { CINDER_DEFS, CINDER_AI } from './bosses/cinder.js';
import { MYCEL_DEFS, MYCEL_AI } from './bosses/mycel.js';
import { RIME_DEFS, RIME_AI, RIME_SEGMENT_AI } from './bosses/rime.js';
import { UMBRA_DEFS, UMBRA_AI, UMBRA_TWIN_AI } from './bosses/umbra.js';
import { SUN_DEFS, SUN_AI, SUN_CORE_AI } from './bosses/sun.js';

export const BOSSES = {
  ...CINDER_DEFS,
  ...MYCEL_DEFS,
  ...RIME_DEFS,
  ...UMBRA_DEFS,
  ...SUN_DEFS,
};

export const BOSS_AI = {
  boss_cinder: CINDER_AI,
  boss_mycel: MYCEL_AI,
  boss_rime: RIME_AI,
  boss_rime_segment: RIME_SEGMENT_AI,
  boss_umbra: UMBRA_AI,
  boss_umbra_twin: UMBRA_TWIN_AI,
  boss_sun: SUN_AI,
  boss_sun_core: SUN_CORE_AI,
};

/** The five floor bosses in floor order. */
export const BOSS_IDS = Object.freeze(['boss_cinder', 'boss_mycel', 'boss_rime', 'boss_umbra', 'boss_sun']);
/** Auxiliary enemies that belong to a boss (removed when the boss dies). */
export const BOSS_PARTS = Object.freeze({
  boss_rime: ['boss_rime_segment'],
  boss_umbra: ['boss_umbra_twin'],
  boss_sun: ['boss_sun_core'],
});
/** Number of phases per boss (boss:phase is emitted for 2..n). */
export const BOSS_PHASES = Object.freeze({ boss_cinder: 2, boss_mycel: 3, boss_rime: 3, boss_umbra: 3, boss_sun: 3 });

export { makeBossAI, phaseGate, forwardHit } from './bosses/common.js';
