# Nachtglut — Architecture & Module Contract

Nachtglut is a top-down action roguelite for the browser (desktop + touch).
Vanilla JavaScript ES modules, Canvas 2D, WebAudio. **No runtime dependencies, no external assets**
(all art is drawn procedurally, all sound is synthesized). All player-facing text is **German**;
code, identifiers and comments are English.

Premise: the sun at the heart of the world has gone out. You are a *Glutträger* (ember bearer) who
descends through five layers of the Schattenschacht to reignite the *Sonnenherz*. Every bearer who
falls turns to ash — and that ash (**Asche**, the meta currency) feeds the hearth for the next one.

- In-run currency: **Funken** (`sparks`). Meta currency: **Asche** (`ash`).
- XP → level-up → choose 1 of 3 **Segen** (`boons`). Found/bought passives: **Relikte** (`relics`). Negative relics: **Flüche** (`curse` rarity).
- Run = 5 floors (`ash`, `fungal`, `frost`, `void`, `core`), each a graph of rooms ending in a boss. See `src/data/biomes.js`.

## 1. Layout and file ownership

Every module has exactly one owner. **Only edit files you own.** If you need a change in someone
else's file, say so in your final report instead of editing it.

```
nachtglut/
  index.html, style.css          shell (style.css: UI owner)
  src/main.js                    bootstrap                                  [core]
  src/core/      rng.js events.js math.js input.js                          [core]
  src/game/      constants.js game.js run.js world.js player.js stats.js
                 combat.js entities.js perks.js                             [core]
  src/game/ai.js                 enemy AI behaviours + elite affix logic    [enemies]
  src/game/bosses.js             boss defs + boss AI                        [bosses]
  src/gen/                       floor + room generation                    [dungeon]
  src/data/biomes.js             biome roster                               [core]
  src/data/enemies.js            enemy defs, AFFIXES                        [enemies]
  src/data/weapons.js            weapon defs                                [weapons]
  src/data/characters.js         playable characters + skills              [weapons]
  src/data/relics.js             relics + curses                            [relics]
  src/data/boons.js              level-up boons                             [relics]
  src/data/shrines.js            shrine/altar choice events                 [relics]
  src/meta/                      save, permanent upgrades, difficulty,
                                 achievements, codex, run tracking          [meta]
  src/render/renderer.js lighting.js fx.js                                  [core]
  src/render/sprites.js, src/render/tiles.js, src/render/art/*              [art]
  src/audio/                     sfx + music                                [audio]
  src/ui/                        all DOM UI, HUD, menus, touch controls     [ui]
  tests/                         `node --test` unit tests (one file per owner, `tests/<owner>.test.js`)
```

Rules for everyone:
- ES modules with relative imports and explicit `.js` extensions. No bundler-only syntax, no npm packages, no top-level `await`.
- Modules under `src/core`, `src/game`, `src/gen`, `src/data`, `src/meta` must be **DOM-free at import time**
  (they are imported by Node tests). Touch `window`/`document`/`localStorage` only inside functions and guard for absence.
- Gameplay randomness uses an `RNG` instance (`src/core/rng.js`), never `Math.random()`. Cosmetic-only randomness (particles) may use `Math.random()`.
- Units: positions in world pixels, room-local, origin at the room's top-left. `TS = 16` px per tile. Time in **seconds**. Angles in radians (0 = +x, clockwise on screen since y points down).
- Do not run `git` commands that change state (no add/commit/checkout/stash). The orchestrator commits.
- Verify your own files with `node --check <file>` and your tests with `node --test tests/<yours>.test.js`.

## 2. Shared constants (`src/game/constants.js`)

`TS`, `TILE` (`FLOOR 0, WALL 1, PIT 2, DOOR 3, SPIKES 4, HAZARD 5, ICE 6, VOID 8`), `DIRS`, `ROOM_TYPES`,
`DAMAGE_TYPES` (`phys fire frost poison shock shadow light`), `STATUS_IDS`
(`burn poison chill freeze shock mark stun weak slow`), `RARITIES`, `RARITY_INFO`, `TYPE_COLORS`, `SPIKE_CYCLE`, `TOTAL_FLOORS`.

Tile semantics:
| tile | ground units | flying units | projectiles | notes |
|---|---|---|---|---|
| FLOOR | walk | pass | pass | |
| WALL / VOID | solid | solid | solid | VOID = outside the room shape, never drawn |
| PIT | blocked | pass | pass | player may dash across; landing in a pit = small damage + respawn at last safe spot |
| DOOR | pass only when room unlocked | same | solid | 2 tiles wide, on the room border |
| SPIKES | walk | pass | pass | damages the player while extended (`SPIKE_CYCLE`) |
| HAZARD | walk | pass | pass | damages/afflicts the player standing on it (biome `hazardStatus`) |
| ICE | walk (slippery) | pass | pass | |

## 3. Event bus (`src/core/events.js`)

`import { bus } from '../core/events.js'` → `bus.on(evt, fn)` (returns unsubscribe), `bus.off`, `bus.emit(evt, payload)`.
`bus.on('*', (evt, payload) => …)` receives everything. Handlers must never throw into gameplay (the bus catches and logs).

| event | payload |
|---|---|
| `state:change` | `{ from, to }` game state changed |
| `run:start` | `{ run }` |
| `run:end` | `{ run, victory, summary }` (summary: see §9) |
| `floor:enter` | `{ run, floor, biome }` |
| `room:enter` | `{ room, first }` |
| `room:lock` | `{ room }` combat started, doors closed |
| `room:clear` | `{ room }` |
| `wave:spawn` | `{ room, index }` |
| `player:hit` | `{ amount, type, source, hp, maxHp }` |
| `player:heal` | `{ amount }` |
| `player:shield` | `{ amount }` |
| `player:dash` | `{ player }` |
| `player:skill` | `{ id }` |
| `player:levelup` | `{ level }` |
| `player:death` | `{ run }` |
| `player:revive` | `{}` |
| `player:status` | `{ id }` |
| `player:fall` | `{}` fell into a pit |
| `weapon:fire` | `{ id, type }` |
| `weapon:swap` | `{ id }` |
| `weapon:gain` | `{ id }` |
| `weapon:upgrade` | `{ id, level }` |
| `enemy:spawn` | `{ enemy }` |
| `enemy:hit` | `{ enemy, amount, crit, type, killed }` |
| `enemy:death` | `{ enemy, elite, boss }` |
| `enemy:attack` | `{ enemy, kind }` kind: `'shoot'|'melee'|'charge'|'slam'|'cast'|'explode'|'summon'|'beam'|'teleport'` |
| `enemy:telegraph` | `{ enemy, kind }` |
| `boss:start` | `{ boss }` |
| `boss:phase` | `{ boss, phase }` |
| `boss:death` | `{ boss }` |
| `explosion` | `{ x, y, radius, team }` |
| `status:apply` | `{ target, id }` (enemies only) |
| `pickup:collect` | `{ kind, amount }` kind: `spark|xp|heart|ash|shield` |
| `relic:gain` | `{ id, def }` |
| `boon:gain` | `{ id, def, stacks }` |
| `curse:gain` | `{ id, def }` |
| `prop:open` | `{ kind, prop }` chest opened / barrel broken / fountain used / forge used / shrine used |
| `shop:buy` | `{ offer, price }` |
| `shop:fail` | `{}` not enough Funken |
| `portal:enter` | `{}` |
| `door:open` / `door:close` | `{}` |
| `ui:choice` | `Choice` object (§8) — UI must present it |
| `ui:toast` | `{ text, kind?, icon? }` kind: `info|good|bad|unlock|achievement` |
| `ui:banner` | `{ title, subtitle?, kind? }` kind: `floor|boss|clear|victory|death` |
| `ui:click` / `ui:hover` / `ui:open` / `ui:close` / `ui:confirm` / `ui:deny` | `{}` emitted by UI for audio |
| `meta:change` | `{ save }` save data changed (ash, upgrades, unlocks, settings) |
| `achievement:unlock` | `{ id, def }` |
| `settings:change` | `{ settings }` |

## 4. Floor / room data (`src/gen/`, consumed by core + UI + art)

```js
import { generateFloor } from '../gen/floorgen.js';
const floor = generateFloor({ index, biome, seed, difficulty, luck });
// index: 1..5, biome: BIOMES[x], seed: uint32, difficulty: DifficultyMods (§9, may be {}), luck: number (0 default)

floor = {
  index, biome: 'ash', seed,
  rooms: Room[],                 // rooms[i].id === i
  startRoomId, bossRoomId,
};
Room = {
  id, gx, gy,                    // integer grid cell for the minimap (unique per room)
  type,                          // one of ROOM_TYPES
  depth,                         // graph distance from the start room
  w, h,                          // size in tiles, including the 1-tile wall border. 13..40 x 11..28
  tiles: Uint8Array(w * h),      // row-major: tiles[ty * w + tx] = TILE.*
  doors: { n?: Door, e?: Door, s?: Door, w?: Door },
  spawns: Wave[],                // enemies; empty for non-combat rooms
  props: PropSpec[],             // interactables/decoration, see below
  playerStart?: { tx, ty },      // start room only
  variant,                       // uint for cosmetic variation
  visited: false, seen: false, cleared: false,   // mutated by core at runtime
};
Door = { to: roomId, tx, ty };   // first of two DOOR tiles. n/s doors occupy (tx,ty),(tx+1,ty); e/w doors (tx,ty),(tx,ty+1)
                                 // n door has ty === 0, s door ty === h-1, w door tx === 0, e door tx === w-1
Wave = { delay: seconds, entries: [{ id: enemyId, tx, ty, elite?: number /* affix count */ }] };
PropSpec = { kind, tx, ty, ...extra };
```

Guarantees the generator must give (and its tests must check):
- The room graph is connected; doors are symmetric (`rooms[a].doors.e.to === b` ⇔ `rooms[b].doors.w.to === a`); neighbours are grid-adjacent.
- All FLOOR/SPIKES/HAZARD/ICE tiles of a room are reachable from every door **by walking** (no pit/wall islands containing spawns or props), a 2-tile-wide clear lane in front of each door.
- Spawn entries and props sit on walkable tiles, never within 3 tiles of a door; no hazards/spikes within 2 tiles of a door or the player start.
- Boss room: large open arena (≥ 25×19), one door, `spawns` = one wave with the biome boss id.
- Every floor has: 1 `start`, 1 `boss`, ≥ 1 `treasure`, 1 `shop`, plus a mix of `combat`/`elite`/`shrine`/`forge`/`rest`/`challenge`/`secret`.

Prop kinds (core implements behaviour, art draws `prop_<kind>`):
| kind | extra | behaviour |
|---|---|---|
| `chest` | `tier: 'common'|'rare'|'cursed'` | interact → drops sparks/hearts/relic by tier |
| `pedestal` | `offer: 'relic'|'weapon'|'heal'|'boon'|'random'`, `price: 'auto'|0`, `group?: string` | shop item / free reward; picking one removes the rest of its `group` |
| `shrine` | `shrine?: id` | opens a shrine choice (data/shrines.js) |
| `forge` | | upgrade the equipped weapon for sparks |
| `fountain` | | heals once |
| `portal` | | next floor (core adds this after the boss dies) |
| `barrel` | `explosive?: bool` | destructible, drops sparks |
| `crystal` | | destructible light source, drops xp |
| `torch` | | decoration + light |
| `statue` / `bones` / `stalagmite` / `mushroom` | | solid or non-solid decoration (art decides look; `solid: bool` in extra) |

## 5. World API (`src/game/world.js`) — the surface used by AI, bosses, weapons, relics, skills

A single `World` exists per run; it simulates the current room. Content code receives it as `w`.

```js
w.rng            // RNG for gameplay
w.time           // seconds since the room was entered
w.player         // Player (§6)
w.enemies        // Enemy[] (live; skip e.dead / e.hidden as needed)
w.projectiles, w.zones, w.pickups, w.props
w.room           // current Room;  w.biome  // BIOMES entry;  w.run // Run (§9)
w.boss           // current boss Enemy or null

w.spawnEnemy(id, x, y, opts?) -> Enemy        // opts: { elite?: number|string[], summoned?: true, delay?: s, noXp?: bool, hpMul?: n }
w.spawnProjectile(spec) -> Projectile         // §5.1
w.spawnZone(spec) -> Zone                     // §5.2
w.spawnPickup(kind, x, y, opts?)              // kind: 'spark'|'xp'|'heart'|'ash'|'shield'; opts: { amount, burst: bool }
w.dropLoot(x, y, { sparks, xp, hearts, ash })  // scatter pickups

w.damageEnemy(enemy, amount, info?) -> dealt  // info: { type='phys', crit=false, source='weapon'|'relic'|'status'|'skill'|'zone'|'thorns',
                                              //         weaponId?, knockback?: { x, y, force }, proc=true /* false: do not trigger onHit relic hooks */, silent? }
w.damagePlayer(amount, info?) -> dealt        // info: { type='phys', source?: Enemy|null, unblockable?: bool, status?: { id, duration, power } }
w.healPlayer(amount, info?)                   // respects healPower
w.applyStatus(target, id, { duration, power = 1, stacks = 1 })   // target: Enemy or Player
w.hasStatus(target, id) -> bool
w.explode(x, y, radius, damage, opts?)        // opts: { team: 'player'|'enemy' (who deals it), type, status, knockback, crit, color, source, weaponId }
w.knockback(entity, dirX, dirY, force)

w.findNearestEnemy(x, y, maxDist = Infinity, filter?) -> Enemy|null   // ignores dead/hidden/untargetable
w.enemiesInRadius(x, y, r) -> Enemy[]
w.tileAt(tx, ty) -> TILE.*                    // VOID outside
w.tileAtPx(x, y)
w.isSolidPx(x, y, flying = false) -> bool     // wall/void/closed door (+pit when !flying)
w.canStand(x, y, r, flying = false) -> bool   // circle fits here
w.lineOfSight(x0, y0, x1, y1) -> bool         // blocked by WALL/VOID only
w.moveEntity(e, dx, dy)                       // moves with tile collision + sliding; uses e.r and e.flying
w.flowDir(x, y) -> { x, y }                   // unit vector along the shortest walkable path to the player (ground units). {0,0} if unreachable
w.randomFloorPos(opts?) -> { x, y }           // opts: { minPlayerDist = 0, maxPlayerDist = Infinity, flying = false, margin = 1 }
w.clampToRoom(x, y, margin = 8) -> { x, y }

w.fx.burst(preset, x, y, opts?)               // particles. presets: 'hit','spark','ember','smoke','blood','frost','poison','shock','shadow','light','dust','heal','explosion','death','spawn','gold'
                                              // opts: { count, color, speed, life, size, angle, spread }
w.fx.text(x, y, text, color?, opts?)          // floating combat text
w.fx.ring(x, y, radius, color, duration?)     // expanding ring
w.fx.beam(x0, y0, x1, y1, color, width?, duration?)   // visual only
w.fx.lightning(x0, y0, x1, y1, color?)        // jagged bolt, visual only
w.fx.shake(amount, duration?)                 // screen shake (px, s)
w.fx.flash(color, duration?)                  // full-screen flash
w.fx.light(x, y, radius, color, duration?)    // temporary light
w.fx.hitstop(seconds)
```
In Node (headless tests) `w.fx` is a no-op object with the same methods.

### 5.1 Projectile spec
```js
{
  x, y, angle, speed,            // or vx, vy
  r: 3,                          // collision radius
  damage, type: 'phys', team: 'player'|'enemy',
  life: 1.2,                     // seconds (or `range` in px; one of them)
  pierce: 0,                     // extra targets it may pass through (Infinity allowed)
  bounce: 0,                     // wall bounces
  homing: 0,                     // rad/s turn rate toward nearest hostile
  accel: 0,                      // px/s² along heading
  knockback: 60,                 // impulse applied to the target
  crit: false,                   // precomputed for player shots
  status: null,                  // { id, duration, power?, chance? = 1 }
  ghost: false,                  // ignores walls
  arc: null,                     // { tx, ty, time, height? } lobbed shot: flies to (tx,ty) ignoring collisions, then expires (use onExpire to explode)
  sprite: 'proj_orb', color: '#ffb347', scale: 1, spin: 0,
  trail: null,                   // fx preset name for a particle trail, e.g. 'ember'
  light: null,                   // { r, color }
  owner: null, weaponId: null,
  hitInterval: 0,                // >0: may hit the same target again after this many seconds (for lingering orbs)
  onUpdate(w, p, dt), onHit(w, p, target), onWall(w, p) /* return true to keep alive */, onExpire(w, p),
  data: {},
}
```
Runtime fields: `p.x p.y p.vx p.vy p.age p.dead p.hits (Set)`.

### 5.2 Zone spec (telegraphs and area effects)
```js
{
  shape: 'circle'|'line'|'cone'|'ring',
  x, y, r,                        // circle / cone radius / ring outer radius
  x2, y2, width,                  // line: from (x,y) to (x2,y2)
  angle, arc,                     // cone: direction + full arc width (rad)
  inner,                          // ring: inner radius
  delay: 0.6,                     // telegraph time before it becomes active (drawn as a warning)
  duration: 0.1,                  // active time after the delay
  damage: 0, tick: 0,             // tick 0 = each target hit once; >0 = re-hit interval
  team: 'enemy'|'player',         // who it belongs to (it damages the other team)
  type: 'phys', status: null, knockback: 0,
  color: '#ff5a3c',
  follow: null,                   // entity to stick to
  grow: 0,                        // px/s radius growth while active (shockwaves)
  onStart(w, z), onTick(w, z, dt), onHit(w, z, target), onEnd(w, z),
}
```

### 5.3 Enemies
Definition (`src/data/enemies.js` → `export const ENEMIES = { [id]: def }`, `export const AFFIXES = { [id]: affix }`):
```js
{
  id, name, desc,                // German name + one-line codex text
  biome,                         // 'ash'|'fungal'|'frost'|'void'|'core'
  hp, speed, damage,             // damage = contact damage (0 = none). Baseline: player has ~100 HP, floor-1 hits deal 8-14
  r: 6, mass: 1,                 // mass scales knockback resistance (0 = immovable)
  flying: false,
  xp: 3, sparks: [0, 2],
  sprite: id, color: '#f80', light: null /* { r, color } */, shadow: true,
  ai: 'chaser', aiParams: {},
  resist: {},                    // { fire: 0.5 } = takes 50% less; negative = weakness
  immune: [],                    // status ids
  untargetable: false, contact: true,
  hooks: { onSpawn(w, e), onDeath(w, e), onHit(w, e, info) /* may mutate info.amount */ },
}
```
Instance (`Enemy`): `def, id, uid, x, y, vx, vy, r, flying, hp, maxHp, speed, damage, mass, facing (angle), flipX, state (string), stateT (s, counts up),
anim ('idle'|'walk'|'attack'|'hurt'|'cast'|'special'), animT, flash, dead, hidden, invuln, untargetable, spawnT (>0 = still spawning, inactive), elite (affix id[]), boss, summoned, statuses, slowMul, kbx, kby, data: {}`.
Core integrates `kbx/kby` knockback, statuses, contact damage, death/loot. **AI code moves the enemy** through `w.moveEntity(e, dx, dy)`.

AI (`src/game/ai.js` → `export const AI = { [name]: { init?(w, e), update(w, e, dt) } }`). Core calls `update` each tick for active enemies
(not while `spawnT > 0`, frozen or stunned). `e.speed * e.slowMul` is the effective speed. Use `e.state/e.stateT/e.data` for state machines.
Always telegraph dangerous attacks (zones with `delay`, or `e.anim = 'attack'` wind-ups ≥ 0.35 s) and emit `enemy:attack`/`enemy:telegraph`.

Affix (`AFFIXES`): `{ id, name /* adjective, e.g. 'Lodernd' */, color, apply(w, e) /* mutate stats */, update?(w, e, dt), onDeath?(w, e), onHit?(w, e, info) }`.

Bosses (`src/game/bosses.js` → `export const BOSSES = { [id]: def }`, `export const BOSS_AI = { [name]: {init, update} }`): same shapes with
`boss: true, title: 'Herr der Aschegruben'`, big `hp`, `mass: 0` or high. Core merges them into the enemy/AI registries, shows the boss bar
(`w.boss`), and emits `boss:start`. Bosses call `bus.emit('boss:phase', { boss: e, phase })` on phase changes.

Roster ids (authoritative, see biomes.js): ash `ash_crawler cinder_bat ember_spitter soot_bomber kiln_turret slag_brute`;
fungal `spore_puff rot_swarm myco_shooter vine_lasher brood_pod mire_stalker`; frost `frost_wisp glacier_slime (+glacier_slime_small) rime_wolf shard_archer snow_caster ice_golem`;
void `null_leech shade void_eye rift_mage echo_knight gloom_mother`; core `sun_shard ash_revenant`.
Bosses: `boss_cinder` (Schlackenkönig), `boss_mycel` (Myzelmutter), `boss_rime` (Reifwyrm), `boss_umbra` (Umbra, der Zwillingsschatten), `boss_sun` (Die Erloschene Sonne).

## 6. Player, stats, weapons, perks

### 6.1 Player (`src/game/player.js`)
Fields used by content/UI: `x, y, r, vx, vy, aim (angle), hp, shield, level, xp, xpNext, sparks, alive, iframes, dashing (bool),
stats (computed, §6.2), character (def), weapons: [WeaponState, WeaponState|null], weaponIndex, weapon (getter: active WeaponState),
relics: Perk[], boons: Perk[], dash: { charges, max, cd, cdMax }, skill: { def, cd, cdMax, active (s remaining) }, statuses, flags: {} (free for skills/relics, e.g. `player.flags.reflect = true`)`.
Methods: `player.addMod(sourceKey, mods)`, `player.removeMods(sourceKey)`, `player.recalc()`, `player.gainXp(n)`, `player.gainSparks(n)`, `player.spendSparks(n) -> bool`.

### 6.2 Stats (`src/game/stats.js`)
Modifier: `{ stat, add?: number, mul?: number }`. Final = (base + Σadd) × Πmul, then clamped.
```
maxHp 100        regen 0 (hp/s)     armor 0 (flat, min dmg 1)   dodge 0 (cap .6)     iframes 0.7 (s)
damage 1 (mult)  fireRate 1 (mult)  critChance .05              critMult 1.75
projSpeed 1      range 1            projSize 1                  pierce 0 (add)       bounce 0 (add)
multishot 0 (extra projectiles)     homing 0 (rad/s)            knockback 1
moveSpeed 92 (px/s)  dashCooldown 1.1 (s)  dashCharges 1  dashDistance 1  skillCooldown 1 (mult)  skillPower 1
pickupRadius 28  luck 0             xpGain 1   sparkGain 1   ashGain 1
lifesteal 0 (fraction, capped per second)  thorns 0  lightRadius 110 (px)
burnChance 0  chillChance 0  poisonChance 0  shockChance 0  statusPower 1  statusDuration 1
fireDamage 1  frostDamage 1  poisonDamage 1  shockDamage 1  shadowDamage 1  physDamage 1  lightDamage 1 (mults per damage type)
shopDiscount 0 (cap .6)  healPower 1  bossDamage 1  eliteDamage 1
```

### 6.3 Weapons (`src/data/weapons.js` → `export const WEAPONS = { [id]: def }`)
```js
{
  id, name, desc, rarity, type: 'fire',            // main damage type
  icon: { glyph, color },                          // §7 glyphs
  base: { damage, cooldown, projSpeed, range, count: 1, spread: 0, pierce: 0, knockback: 60, ... },  // free-form numbers the weapon needs
  levels: [ { desc: '+25 % Schaden', mods: { damage: 1.25 } }, ... ],   // exactly 4 entries = levels 2..5. mods multiply base numbers; keys prefixed '+' add (e.g. { '+count': 1, '+pierce': 1 })
  fire(w, player, ws, aim),                        // called when the trigger is held and ws.cd <= 0. Spawn shots here. Return a cooldown override (s) or nothing.
  update?(w, player, ws, dt, held, aim),           // every tick while equipped (beams, charge weapons, orbitals). If the weapon handles its own timing set `manual: true` and core will not call fire().
  onEquip?(w, player, ws), onUnequip?(w, player, ws),
}
// aim = { angle, x, y /* aim point in world px */, target /* Enemy|null when auto-aiming */ }
// ws (WeaponState) = { id, def, level (1..5), cd, stats /* base with level mods applied */, data: {} }
```
Use the core helpers from `src/game/combat.js` so that player stats and relic hooks apply uniformly:
```js
playerShot(w, ws, angle, overrides?) -> Projectile   // builds a projectile from ws.stats + player stats (damage, crit roll, projSpeed, range, projSize,
                                                     // pierce, bounce, homing, knockback, on-hit status chances) then runs relic `onShot` hooks. overrides = any projectile spec fields.
playerVolley(w, ws, angle, overrides?)               // fires ws.stats.count + player.stats.multishot shots spread by ws.stats.spread; emits weapon:fire
playerDamage(w, ws, enemy, baseDamage, info?)        // direct (non-projectile) weapon damage with player multipliers + crit roll
rollCrit(w) -> bool,  weaponCooldown(w, ws) -> seconds (ws.stats.cooldown / player.stats.fireRate)
```
Weapon roster (ids are authoritative): `ember_bolt scatter_coal flame_lance spark_chain magma_mortar frost_needle shadow_daggers sun_disc
spore_launcher rift_orb iron_hammer glaive_orbit soul_siphon star_bow ice_staff`.

### 6.4 Characters (`src/data/characters.js` → `export const CHARACTERS = { [id]: def }`)
```js
{ id, name, title, desc, sprite: 'char_<id>', color,
  baseMods: [{ stat, add?, mul? }], weapon: weaponId,
  skill: { id, name, desc, cooldown, icon: { glyph, color }, use(w, player, aim) },
  passive?: { name, desc, hooks: { ...perk hooks } },
  unlock: { text: 'Besiege den Schlackenkönig', default?: true } }
```
Ids: `bearer` (Glutträger, default), `shadow` (Schattenläuferin), `warden` (Eisenwächter), `weaver` (Frostweberin), `revenant` (Aschenkind).
Unlock *conditions* are evaluated by meta (`meta/progression.js: isCharacterUnlocked(save, id)`).

### 6.5 Perks: relics, boons, curses (`src/game/perks.js` runs them)
```js
{
  id, name, desc, flavor?,
  rarity: 'common'|'uncommon'|'rare'|'legendary'|'curse',
  icon: { glyph, color },
  tags: ['fire', 'crit', ...],
  maxStacks: 1,                              // boons usually 3-5, relics 1
  mods: [{ stat, add?, mul? }] | (stacks) => [...],      // static stat modifiers
  requires?: (player, run) => bool,          // offered only when true (e.g. needs a fire weapon)
  hooks: {
    onGain(ctx), onRoomEnter(ctx), onRoomClear(ctx), onFloorEnter(ctx), onUpdate(ctx, dt),
    onFire(ctx, { ws }),                     // after a volley
    onShot(ctx, spec),                       // mutate a player projectile spec before it spawns
    onHit(ctx, { enemy, amount, crit, type, info }),      // after player damage lands (only when info.proc !== false)
    onCrit(ctx, { enemy, amount }), onKill(ctx, { enemy, info }),
    onDamaged(ctx, hit),                     // hit = { amount, type, source } — may reduce hit.amount (set 0 to negate)
    onLethal(ctx) -> true to survive (perk must consume its charge),
    onDash(ctx), onDashEnd(ctx), onSkill(ctx), onHeal(ctx, { amount }), onPickup(ctx, { kind, amount }),
    onLevelUp(ctx), onStatusApplied(ctx, { enemy, id }), onSpend(ctx, { amount }),
    dynamicMods(ctx) -> [{ stat, add?, mul? }],   // conditional stats, re-evaluated 5×/s
  },
}
// ctx = { w, player, run, rng, stacks, state /* per-perk plain object, persists for the run */ }
```
`export const RELICS = { [id]: def }` (incl. curses), `export const BOONS = { [id]: def }`.
Shrines (`src/data/shrines.js` → `export const SHRINES = { [id]: { id, name, text, weight, options(ctx) -> [{ label, desc, icon?, available?: bool, pick(ctx) }] } }`),
with helpers available on `run`: `run.giveRelic(id?)` (random by rarity if omitted), `run.giveCurse(id?)`, `run.offerRelicChoice(n)`, `run.giveWeapon(id)`.

## 7. Art (`src/render/sprites.js`, `src/render/tiles.js`)

```js
import { sprites } from './sprites.js';
sprites.init();                                    // build caches (browser only)
sprites.has(key) -> bool
sprites.size(key) -> { w, h }
sprites.draw(ctx, key, x, y, opts?)                // centred on (x, y). opts: { anim='idle', t=0 (s), flipX, flash (0..1 white), alpha, scale, rot, color /* tint for tintable keys */ }
sprites.icon(spec, px = 32) -> string (data URL)   // spec: sprite key string or { glyph, color } — for DOM <img>
import { renderRoomStatic, drawRoomDynamic } from './tiles.js';
renderRoomStatic(room, biome) -> HTMLCanvasElement  // full room (w*TS × h*TS), floor+walls+pits+static decoration
drawRoomDynamic(ctx, room, biome, time, state)      // animated tiles drawn each frame in world space: hazards, spikes (use SPIKE_CYCLE + time), doors (state.locked)
```
Required sprite keys: `char_<characterId>` (anims idle, walk, dash, hurt); one per enemy id and boss id (anims idle, walk, attack, hurt, plus cast/special where useful);
props `prop_chest prop_chest_rare prop_chest_cursed prop_chest_open prop_pedestal prop_shrine prop_forge prop_fountain prop_fountain_empty prop_portal prop_barrel prop_barrel_explosive prop_crystal prop_torch prop_statue prop_bones prop_stalagmite prop_mushroom`;
pickups `pickup_spark pickup_xp pickup_heart pickup_ash pickup_shield`;
tintable projectiles (drawn in white/grey, tinted via `opts.color`) `proj_orb proj_bolt proj_shard proj_dagger proj_disc proj_spore proj_blob proj_needle proj_wave proj_star proj_skull proj_beam proj_hammer proj_blade`.
Icon glyphs (tintable, used as `{ glyph, color }`): `flame ember skull heart shield boot eye sword dagger hammer bow staff orb star sun moon snowflake drop bolt leaf mushroom bone crown coin key hourglass feather fang claw ring gem book potion bomb wing anchor chain mirror mask candle lantern compass dice scale thorn spiral cross hand tooth horn`.
Missing keys must not throw: `sprites.draw` falls back to a coloured disc.

## 8. Game API for UI (`src/game/game.js`)

```js
game.state        // 'menu' | 'playing' | 'paused' | 'choice' | 'transition' | 'dead' | 'victory'
game.run          // Run or null
game.save         // save object (§9), game.settings === game.save.settings
game.startRun({ character, difficulty /* 0..10 */, seed? /* string|number */ })
game.pause(), game.resume(), game.abandonRun(), game.toMenu()
game.resolveChoice()                // internal; choices call it themselves
```
Choice (modal, simulation paused; emitted via `ui:choice`):
```js
{ kind: 'boon'|'relic'|'shrine'|'weapon'|'forge', title, text?,
  options: [{ id, name, desc, icon, rarity?, tags?, detail?, disabled?, pick() }],
  rerolls: n, reroll?(),              // if present and rerolls > 0 show a reroll button; after reroll() read choice.options again
  skip?(), skipLabel? }
```
HUD data (read every frame by `ui.update(dt)`): `game.run.player` (§6.1), `game.run.floor` + `game.run.roomId` (minimap: draw rooms with `seen`,
highlight current, icon per type for visited ones), `game.run.world.boss` (boss bar: `name`, `def.title`, `hp`, `maxHp`), `game.run.time`, `game.run.stats`,
`game.run.world.interactHint` (`{ text, x, y } | null` — show "E / tap" prompt), `game.run.difficulty`.
UI module surface: `ui.init(game)`, `ui.update(dt)`. Touch controls feed `input.setVirtualMove(x, y)`, `input.setVirtualAim(x, y, active)`, `input.setVirtualButton(name, down)`
with names `fire dash skill swap interact pause map` (`src/core/input.js`).

## 9. Run + meta (`src/game/run.js`, `src/meta/`)

```js
run = { seed, seedLabel, rng, character (id), difficulty (def), floorIndex, floor, roomId, world, player, time,
        rerolls, stats: { kills, eliteKills, bossKills, damageDealt, damageTaken, roomsCleared, floorsCleared, sparksCollected,
                          relicsFound, critHits, dashes, bestHit, hitsTaken, healed, ... }, flags: {}, ended, victory }
summary (run:end) = { victory, character, difficulty, floor, biome, time, seedLabel, stats, relics: id[], boons: [{id, stacks}], weapons: [{id, level}], ash, killedBy? }
```
Meta surface (owner: meta):
```js
// meta/save.js
loadSave() -> save; persistSave(save); resetSave() -> save; exportSave(save) -> string; importSave(str) -> save
save = { version, ash, totalAsh, upgrades: { [id]: level }, unlocks: { characters: [], weapons: [], difficulties: 0 },
         codex: { enemies: { [id]: { seen, kills } }, relics: { [id]: n }, weapons: { [id]: n }, bosses: { [id]: { kills, bestTime } } },
         achievements: { [id]: unixMs }, stats: { runs, wins, deaths, kills, bestFloor, playTime, fastestWin, totalSparks, ... },
         history: [ summary-lite, newest first, max 20 ], settings: { master, music, sfx, shake, flashes, damageNumbers, autoAim, autoFire, touchSide, showTimer, reducedMotion }, tutorialSeen }
// meta/progression.js
META_UPGRADES            // { [id]: { id, name, desc, icon, maxLevel, cost(level) -> ash, mods?(level) -> Modifier[], effect?: {...} } }
buyUpgrade(save, id) -> bool, upgradeLevel(save, id), getMetaMods(save) -> Modifier[]
getRunBonuses(save) -> { startSparks, rerolls, revives, relicChoices /* extra options */, startRelics, shopDiscount, healOnFloor, ... }
DIFFICULTIES             // [0..10]: { level, name, desc, mods: DifficultyMods }
DifficultyMods = { enemyHp: 1, enemyDamage: 1, enemySpeed: 1, eliteChance: 0, extraAffixes: 0, spawnBudget: 1, ashMult: 1, healMult: 1, shopPrice: 1, bossHp: 1 }
isCharacterUnlocked(save, id), isWeaponUnlocked(save, id), computeAshReward(summaryStats...) 
// meta/tracker.js  — initTracker(game): listens to bus events, fills codex + lifetime stats, finalises runs (ash, history, unlocks), emits toasts
// meta/achievements.js — ACHIEVEMENTS, initAchievements(game)
```

## 10. Audio (`src/audio/audio.js`)

```js
audio.init()                       // safe to call repeatedly; creates the AudioContext on first user gesture
audio.setVolumes({ master, music, sfx })   // 0..1
audio.play(name, opts?)            // opts: { volume, pitch, pan }  — unknown names are ignored
audio.music.play(trackId)          // 'menu' 'ash' 'fungal' 'frost' 'void' 'core' 'boss' 'final' 'victory' 'death' (crossfades)
audio.music.setIntensity(0..1)     // calm exploration ↔ combat layers
audio.bindEvents(bus, game)        // maps §3 events to sfx + music changes
```

## 11. Core internals (owners: `sim` = src/game/{entities,props,player,run,game}.js; `shell` = src/main.js, index.html, src/render/{renderer,lighting,fx}.js, tools/build.mjs)

`world.js`, `combat.js`, `perks.js`, `stats.js`, `registry.js` already exist — read them, they are the reference for field names.

### 11.1 Game (`src/game/game.js`, DOM-free)
```js
new Game({ input, fx, meta, generateFloor, save })   // all optional; defaults: Input-like stub, NULL_FX, DEFAULT_META, built-in fallback generator, in-memory save
game.state, game.run, game.save, game.settings (=== game.save.settings), game.input, game.fx, game.meta, game.time
game.view = { x, y, w, h, scale }   // camera top-left in world px, logical view size, CSS px per logical px — written by the renderer every frame
game.worldToScreen(x, y) -> { x, y } (CSS px), game.screenToWorld(cssX, cssY)
game.fade                // 0..1 black overlay alpha for room/floor transitions (renderer draws it)
game.choice              // current Choice or null;  game.openChoice(choice)  queues if one is open; wraps option.pick/skip/reroll so they resolve automatically
game.update(dt)          // fixed 1/60 step; handles pause input, hitstop (skip world while fx.hitstopT > 0), transitions, run.update
game.startRun(opts), pause(), resume(), abandonRun(), toMenu(), transition(fn, duration = 0.3)
```
`meta` (injected, defaults used when absent): `{ DIFFICULTIES, getMetaMods(save), getRunBonuses(save) }`. Bonus keys the core honours: `startSparks, rerolls, revives, relicChoices, startRelics, shopDiscount, healOnFloor, startShield`.
States: `menu → playing ⇄ paused`, `playing ⇄ choice`, `playing → transition → playing`, `playing → dead | victory → menu`.
Death: `run.onPlayerDeath(source)` sets `run.ended = true`, `run.dyingT = 1.6` (world keeps simulating at 0.35× speed, no input), then `run.finish(false)` → emits `run:end` → state `dead`.
Victory: when `boss_sun` dies `run.victoryT = 3.5`, then `run.finish(true)` → `run:end` → state `victory`.

### 11.2 Runtime shapes read by the renderer / UI
- Player: `x y r aim anim ('idle'|'walk'|'dash'|'hurt') animT flipX iframes hurtT fireT dashing alive character.sprite stats.lightRadius shield statuses`.
- Enemy: §5.3 plus `spawnT spawnMax hpBarT elite (ids) affixes (defs, .color) statuses frozen name`.
- Projectile: `x y z (arc height, 0 normally) vx vy r sprite color scale spin age light team dead`.
- Zone: `shape x y r x2 y2 width angle arc inner delay duration age active color team`.
- Pickup: `kind x y amount age`.
- Prop: `kind x y r solid destructible removed used locked sprite light ({ r, color }|null) offer ({ type, id, name, desc, icon, rarity, price }|null) flash`.
- `world.interactHint = { text, x, y, prop } | null`; `world.locked`; `world.boss`; `world.room`; `world.biome`; `world.time`.
- Fx (browser impl in `render/fx.js`, same method set as `NULL_FX` in world.js) additionally: `fx.hitstopT`, `fx.update(dt)`, `fx.clear()`.
