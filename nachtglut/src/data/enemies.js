// Enemy definitions + elite affixes (owner: enemies). See docs/ARCHITECTURE.md §5.3.
// Baseline (floor 1): player ~100 HP. Deeper biomes are scaled in their defs (≈ ×1.45 HP per biome floor);
// core additionally scales enemies met outside their home biome (world.spawnEnemy: +50 % HP / +22 % dmg per floor).
import { bus } from '../core/events.js';
import { sootBomberDeath } from '../game/ai/ash.js';
import { sporePuffDeath } from '../game/ai/fungal.js';
import { glacierSlimeDeath } from '../game/ai/frost.js';
import { echoShieldHit } from '../game/ai/void.js';
import {
  FREE_STATES, cdMul, distTo, zone, telegraphCircle, delayedBlast, ownedZones, summon, teleportNear,
  freeSpotNear, spawnsBlocked,
} from '../game/ai/util.js';

const def = (o) => ({
  r: 6, mass: 1, flying: false, xp: 3, sparks: [0, 2], light: null, shadow: true, aiParams: {},
  resist: {}, immune: [], untargetable: false, contact: true, hooks: {}, ...o, sprite: o.sprite || o.id, ai: o.ai || o.id,
});

export const ENEMIES = {
  // ------------------------------------------------------------------------------------------- ash (floor 1)
  ash_crawler: def({
    id: 'ash_crawler', name: 'Aschekriecher', biome: 'ash',
    desc: 'Huscht durch kalte Asche und springt nach allem, was noch warm ist.',
    hp: 22, speed: 54, damage: 9, r: 6, mass: 0.8, xp: 2, sparks: [1, 2], color: '#a89a8e',
    resist: { fire: 0.25, frost: -0.2 },
    aiParams: { lungeRange: 56, windup: 0.42, lungeSpeed: 190, lungeTime: 0.28, cooldown: 1.5 },
  }),
  cinder_bat: def({
    id: 'cinder_bat', name: 'Zunderflatterer', biome: 'ash',
    desc: 'Glimmende Schwingen, die im Zickzack aus der Dunkelheit herabstoßen.',
    hp: 18, speed: 72, damage: 8, r: 5, mass: 0.5, flying: true, xp: 2, sparks: [1, 2], color: '#ff7a2f',
    light: { r: 26, color: '#ff6a1f' }, contactType: 'fire',
    resist: { fire: 0.5, frost: -0.25 },
    aiParams: { orbit: 70, windup: 0.45, diveSpeed: 190, diveTime: 0.45, cooldown: 2.4 },
  }),
  ember_spitter: def({
    id: 'ember_spitter', name: 'Glutspucker', biome: 'ash',
    desc: 'Ein Schlund voller flüssiger Schlacke, der lieber aus sicherer Entfernung spuckt.',
    hp: 30, speed: 36, damage: 8, r: 7, mass: 1.2, xp: 4, sparks: [1, 4], color: '#ff8a3c',
    light: { r: 24, color: '#ff8a3c' }, contactType: 'fire',
    resist: { fire: 0.5, frost: -0.25 }, immune: ['burn'],
    aiParams: { min: 90, max: 140, windup: 0.5, cooldown: 2.2, shots: 3, spread: 0.24, projSpeed: 100, projDamage: 9 },
  }),
  soot_bomber: def({
    id: 'soot_bomber', name: 'Rußbombe', biome: 'ash',
    desc: 'Ein wandelnder Kohlesack mit glimmender Lunte. Wer klug ist, hält Abstand.',
    hp: 25, speed: 60, damage: 0, contact: false, r: 6.5, mass: 0.9, xp: 3, sparks: [1, 3], color: '#4d3f42',
    light: { r: 18, color: '#ff6a1f' },
    resist: { fire: 0.5 },
    aiParams: { fuseRange: 30, fuse: 0.7, radius: 36, blast: 18, deathFuse: 0.45, deathRadius: 30, deathBlast: 12 },
    hooks: { onDeath: sootBomberDeath },
  }),
  kiln_turret: def({
    id: 'kiln_turret', name: 'Brennofen', biome: 'ash',
    desc: 'Ein uralter Schmelzofen, der noch immer Glut in alle Richtungen speit.',
    hp: 69, speed: 0, damage: 0, contact: false, r: 8, mass: 0, xp: 5, sparks: [1, 4], color: '#806a5e',
    light: { r: 34, color: '#ff6a1f' },
    resist: { fire: 0.6, poison: 0.5, frost: -0.2 }, immune: ['burn', 'poison'],
    aiParams: { range: 250, windup: 0.5, cooldown: 2.4, shots: 6, projSpeed: 78, projDamage: 9, rot: 0.27, projCap: 24, stationary: true },
  }),
  slag_brute: def({
    id: 'slag_brute', name: 'Schlackenrohling', biome: 'ash',
    desc: 'Ein Berg aus erkalteter Schlacke. Wenn er losstürmt, bebt der Boden.',
    hp: 150, speed: 30, damage: 13, r: 9, mass: 3, xp: 10, sparks: [3, 6], color: '#5c4a46',
    light: { r: 22, color: '#ff6a1f' },
    resist: { fire: 0.5, phys: 0.15, frost: -0.2 }, immune: ['stun'],
    aiParams: {
      chargeRange: 170, chargeWind: 0.8, chargeSpeed: 230, chargeLen: 150, chargeDamage: 15,
      slamRange: 48, slamWind: 0.65, slamRadius: 46, slamDamage: 15, cooldown: 2.2,
    },
  }),

  // ------------------------------------------------------------------------------------------- fungal (floor 2)
  spore_puff: def({
    id: 'spore_puff', name: 'Sporling', biome: 'fungal',
    desc: 'Ein wandelnder Bovist. Wer ihn zerplatzen lässt, atmet sein Gift.',
    hp: 34, speed: 30, damage: 12, r: 6, mass: 0.7, xp: 3, sparks: [0, 2], color: '#8a5fd0',
    light: { r: 18, color: '#9be35a' }, contactType: 'poison',
    resist: { poison: 0.6, fire: -0.25 }, immune: ['poison'],
    aiParams: { puffRange: 38, puffR: 28, puffDamage: 10, windup: 0.5, cooldown: 2.0, cloudR: 30, cloudDur: 3, cloudDamage: 7 },
    hooks: { onDeath: sporePuffDeath },
  }),
  rot_swarm: def({
    id: 'rot_swarm', name: 'Fäulnisschwarm', biome: 'fungal',
    desc: 'Ein summender Knoten aus Fäulnismücken, der nie ganz stillhält.',
    hp: 12, speed: 86, damage: 8, r: 3.5, mass: 0.3, flying: true, xp: 1, sparks: [0, 1], color: '#9be35a',
    light: { r: 10, color: '#9be35a' }, contactType: 'poison',
    resist: { poison: 0.6 }, immune: ['poison'],
    aiParams: { orbit: 34, windup: 0.35, dartSpeed: 165, dartTime: 0.3, cooldown: 2.0 },
  }),
  myco_shooter: def({
    id: 'myco_shooter', name: 'Myzelschleuder', biome: 'fungal',
    desc: 'Schleudert schwere Sporenkapseln, die als giftige Pfützen zerplatzen.',
    hp: 55, speed: 34, damage: 12, r: 7, mass: 1.2, xp: 5, sparks: [1, 3], color: '#35706c',
    light: { r: 20, color: '#59e0b0' },
    resist: { poison: 0.6, fire: -0.25 }, immune: ['poison'],
    aiParams: { min: 100, max: 160, windup: 0.5, flight: 0.9, puddleR: 20, puddleDur: 2.6, puddleDamage: 8, cooldown: 2.8 },
  }),
  vine_lasher: def({
    id: 'vine_lasher', name: 'Rankenpeitscher', biome: 'fungal',
    desc: 'Fest verwurzelt — doch seine Dornenranken reichen weiter, als man denkt.',
    hp: 91, speed: 0, damage: 13, r: 8, mass: 0, xp: 7, sparks: [1, 4], color: '#2f5a36',
    resist: { poison: 0.6, fire: -0.35 }, immune: ['poison'],
    aiParams: { reach: 76, arc: 1.3, windup: 0.6, damage: 15, cooldown: 1.6, thornRange: 170, thornCd: 3.4, thornDamage: 11, stationary: true },
  }),
  brood_pod: def({
    id: 'brood_pod', name: 'Brutkapsel', biome: 'fungal',
    desc: 'Ein pulsierender Sack, aus dem unablässig neue Schwärme schlüpfen.',
    hp: 110, speed: 0, damage: 10, r: 9, mass: 0, xp: 8, sparks: [2, 4], color: '#523592',
    light: { r: 26, color: '#9be35a' }, contactType: 'poison',
    resist: { poison: 0.7, fire: -0.35 }, immune: ['poison'],
    aiParams: { cap: 6, cooldown: 5, windup: 0.7, batch: [2, 3], pulseDamage: 10, stationary: true },
  }),
  mire_stalker: def({
    id: 'mire_stalker', name: 'Sumpflauerer', biome: 'fungal',
    desc: 'Gräbt sich durch den Morast und taucht genau dort auf, wo du eben noch standest.',
    hp: 98, speed: 52, damage: 16, r: 7, mass: 1.5, xp: 9, sparks: [2, 5], color: '#4a5e52',
    resist: { poison: 0.5, phys: 0.1 },
    aiParams: { tunnelSpeed: 78, emerge: 0.65, biteR: 24, biteDamage: 21, surface: 2.4, maxTunnel: 4.5 },
  }),

  // ------------------------------------------------------------------------------------------- frost (floor 3)
  frost_wisp: def({
    id: 'frost_wisp', name: 'Frostirrlicht', biome: 'frost',
    desc: 'Ein kaltes Licht, das dich umkreist und dir die Wärme aus den Gliedern saugt.',
    hp: 49, speed: 62, damage: 15, r: 5, mass: 0.5, flying: true, xp: 5, sparks: [1, 3], color: '#8fd8ff',
    light: { r: 30, color: '#8fd8ff' }, contactType: 'frost',
    resist: { frost: 0.35, fire: -0.3 }, immune: ['chill', 'freeze'],
    aiParams: { orbit: 88, angSpeed: 0.9, windup: 0.45, cooldown: 2.1, projSpeed: 95, projDamage: 18 },
  }),
  glacier_slime: def({
    id: 'glacier_slime', name: 'Gletscherschleim', biome: 'frost',
    desc: 'Eine zitternde Masse aus Schmelzwasser. Zerschlagen teilt sie sich.',
    hp: 91, speed: 44, damage: 20, r: 8, mass: 1.6, xp: 6, sparks: [1, 3], color: '#5fa6d6',
    light: { r: 18, color: '#a8e2ff' }, contactType: 'frost',
    resist: { frost: 0.25, fire: -0.25, phys: 0.1 },
    aiParams: { hop: 46, rest: 0.55, squash: 0.38, hopTime: 0.4, split: 2, splitInto: 'glacier_slime_small' },
    hooks: { onDeath: glacierSlimeDeath },
  }),
  glacier_slime_small: def({
    id: 'glacier_slime_small', name: 'Gletscherklecks', biome: 'frost', ai: 'glacier_slime',
    desc: 'Ein abgesprengter Rest eines Gletscherschleims — klein, aber hartnäckig.',
    hp: 29, speed: 50, damage: 14, r: 5, mass: 0.7, xp: 1, sparks: [0, 1], color: '#a8e2ff', contactType: 'frost',
    resist: { frost: 0.25, fire: -0.25 },
    aiParams: { hop: 32, rest: 0.4, squash: 0.35, hopTime: 0.3, split: 0 },
  }),
  rime_wolf: def({
    id: 'rime_wolf', name: 'Reifwolf', biome: 'frost',
    desc: 'Jagt im Rudel: Die einen kreisen dich ein, der andere springt.',
    hp: 58, speed: 80, damage: 20, r: 6.5, mass: 1.1, xp: 5, sparks: [1, 3], color: '#b8cce0',
    resist: { frost: 0.25, fire: -0.25 },
    aiParams: { orbit: 74, windup: 0.45, lungeSpeed: 240, lungeMax: 140, cooldown: 2.4 },
  }),
  shard_archer: def({
    id: 'shard_archer', name: 'Splitterschütze', biome: 'frost',
    desc: 'Zielt lange und genau. Sein Eissplitter ist schneller als ein Herzschlag.',
    hp: 72, speed: 40, damage: 15, r: 6.5, mass: 1, xp: 7, sparks: [1, 4], color: '#c4d8ea',
    resist: { frost: 0.25, fire: -0.25 },
    aiParams: { min: 110, max: 175, aim: 0.8, lock: 0.4, cooldown: 2.6, projSpeed: 165, projDamage: 25, range: 300 },
  }),
  snow_caster: def({
    id: 'snow_caster', name: 'Schneebeschwörer', biome: 'frost',
    desc: 'Flüstert in die Kälte, und um dich herum wachsen Spieße aus Eis.',
    hp: 78, speed: 38, damage: 15, r: 6.5, mass: 1, xp: 8, sparks: [2, 4], color: '#5470b8',
    light: { r: 22, color: '#8fd8ff' },
    resist: { frost: 0.3, fire: -0.25 },
    aiParams: { min: 110, max: 170, windup: 0.55, cooldown: 3.4, ring: 6, ringR: 38, spikeR: 14, spikeDamage: 23, delay: 0.85 },
  }),
  ice_golem: def({
    id: 'ice_golem', name: 'Eisgolem', biome: 'frost',
    desc: 'Ein wandelnder Gletscher. Jeder seiner Schläge lässt den Boden splittern.',
    hp: 377, speed: 26, damage: 16, r: 10, mass: 5, xp: 12, sparks: [2, 5], color: '#a8e2ff',
    light: { r: 20, color: '#bfeaff' }, contactType: 'frost',
    resist: { frost: 0.35, phys: 0.2, fire: -0.3 }, immune: ['chill', 'freeze', 'stun'],
    aiParams: { slamRange: 80, slamWind: 0.75, slamDamage: 18, waveDamage: 15, waveGrow: 120, waveDur: 0.85, throwCd: 3.8, throwDamage: 15, cooldown: 2.6 },
  }),

  // ------------------------------------------------------------------------------------------- void (floor 4)
  null_leech: def({
    id: 'null_leech', name: 'Nichtsauger', biome: 'void',
    desc: 'Ein blinder Egel aus Leere. Hat er dich erst, saugt er dir das Licht aus.',
    hp: 37, speed: 70, damage: 13, r: 4.5, mass: 0.6, xp: 3, sparks: [0, 2], color: '#e04bd0',
    light: { r: 12, color: '#e04bd0' }, contactType: 'shadow',
    resist: { shadow: 0.5, light: -0.3 },
    aiParams: { leapRange: 64, windup: 0.4, leapSpeed: 210, leapTime: 0.32, drain: 4, latchMax: 4, maxLatched: 2, cooldown: 2.2 },
  }),
  shade: def({
    id: 'shade', name: 'Schemen', biome: 'void',
    desc: 'Halb hier, halb nicht. Nur wenn er zuschlägt, ist er verwundbar.',
    hp: 80, speed: 64, damage: 18, r: 6, mass: 0.8, flying: true, xp: 6, sparks: [1, 3], color: '#7a5ab8', contactType: 'shadow',
    resist: { shadow: 0.6, light: -0.4 },
    aiParams: { strike: 42, windup: 0.45, arc: 1.5, damage: 20, recover: 1.0, maxPhase: 3.2 },
  }),
  void_eye: def({
    id: 'void_eye', name: 'Leerenauge', biome: 'void',
    desc: 'Ein schwebendes Auge, dessen Blick wie eine Klinge durch den Raum schneidet.',
    hp: 126, speed: 30, damage: 14, r: 7, mass: 0.6, flying: true, xp: 9, sparks: [2, 4], color: '#b07cff',
    light: { r: 30, color: '#e04bd0' }, contactType: 'shadow',
    resist: { shadow: 0.5, light: -0.3 },
    aiParams: { min: 90, max: 170, charge: 1.0, sweep: 1.1, sweepTime: 1.6, damage: 20, width: 9, cooldown: 3.6, range: 260 },
  }),
  rift_mage: def({
    id: 'rift_mage', name: 'Rissmagier', biome: 'void',
    desc: 'Faltet den Raum und tritt hindurch, sobald du ihm zu nahe kommst.',
    hp: 109, speed: 40, damage: 13, r: 6.5, mass: 1, xp: 10, sparks: [2, 4], color: '#9a6ae0',
    light: { r: 22, color: '#b07cff' },
    resist: { shadow: 0.5, light: -0.3 },
    aiParams: {
      min: 100, max: 165, blinkRange: 64, blinkMin: 120, blinkMax: 220, blinkCd: 3.5,
      windup: 0.55, shots: 5, spread: 0.9, projSpeed: 95, projDamage: 19, cooldown: 2.6,
    },
  }),
  echo_knight: def({
    id: 'echo_knight', name: 'Echoritter', biome: 'void',
    desc: 'Das Echo eines gefallenen Wächters. Sein Schild hält jedem Angriff von vorn stand.',
    hp: 264, speed: 34, damage: 20, r: 7.5, mass: 2.5, xp: 12, sparks: [2, 5], color: '#4b3a78',
    light: { r: 16, color: '#b07cff' },
    resist: { shadow: 0.5, light: -0.3 }, immune: ['stun'],
    aiParams: {
      dashMax: 140, windup: 0.55, dashSpeed: 300, dashLen: 130, dashDamage: 23,
      bashRange: 38, bashWind: 0.45, bashDamage: 18, turn: 2.4, recover: 0.9, cooldown: 2.4, block: 0.8, shieldArc: 1.05,
    },
    hooks: { onHit: echoShieldHit },
  }),
  gloom_mother: def({
    id: 'gloom_mother', name: 'Düstermutter', biome: 'void',
    desc: 'Wo sie geht, erlischt das Licht — und aus der Dunkelheit kriechen ihre Kinder.',
    hp: 483, speed: 22, damage: 20, r: 11, mass: 5, xp: 12, sparks: [3, 6], color: '#3a2a5e', contactType: 'shadow',
    resist: { shadow: 0.6, light: -0.35 }, immune: ['stun', 'freeze'],
    aiParams: { aura: 64, summonCd: 7, summonWind: 0.8, cap: 3, ring: 10, ringCd: 3.2, projSpeed: 72, projDamage: 20 },
  }),

  // ------------------------------------------------------------------------------------------- core (floor 5)
  sun_shard: def({
    id: 'sun_shard', name: 'Sonnensplitter', biome: 'core',
    desc: 'Ein Bruchstück der erloschenen Sonne, das noch immer Licht in Spiralen verschleudert.',
    hp: 200, speed: 28, damage: 15, r: 7, mass: 0.8, flying: true, xp: 11, sparks: [2, 4], color: '#ffd35a',
    light: { r: 40, color: '#ffd35a' }, contactType: 'light',
    resist: { light: 0.6, fire: 0.3, shadow: -0.3 }, immune: ['burn'],
    aiParams: { min: 90, max: 160, windup: 0.6, arms: 3, interval: 0.16, duration: 1.6, rot: 0.33, projSpeed: 80, projDamage: 14, cooldown: 2.6, projCap: 32 },
  }),
  ash_revenant: def({
    id: 'ash_revenant', name: 'Aschenwiedergänger', biome: 'core',
    desc: 'Was von einem früheren Glutträger blieb. Er kämpft, wie du kämpfst.',
    hp: 280, speed: 74, damage: 15, r: 6, mass: 1.2, xp: 12, sparks: [3, 6], color: '#c9c2b8',
    light: { r: 28, color: '#ff8a3c' },
    resist: { fire: 0.4, shadow: 0.2 },
    aiParams: { min: 80, max: 150, windup: 0.4, burst: 3, burstGap: 0.12, projSpeed: 140, projDamage: 16, cooldown: 1.9, dashSpeed: 260, dashTime: 0.18, dashCd: 1.6 },
  }),
};

// ---------------------------------------------------------------------------------------------
// Elite affixes
// ---------------------------------------------------------------------------------------------
/** Cheap fodder each biome's summoners call in. */
export const SUMMON_FODDER = { ash: 'ash_crawler', fungal: 'rot_swarm', frost: 'glacier_slime_small', void: 'null_leech', core: 'ash_crawler' };

const has = (e, id) => !!(e && e.elite && e.elite.indexOf(id) >= 0);

// One shared `player:hit` listener drives the on-hit affixes (vampiric heal, venomous poison, icy chill).
let hitWorld = null;
let hitSubscribed = false;
function onPlayerHit(pl) {
  const src = pl && pl.source, w = hitWorld;
  if (!w || !src || !src.elite || !src.elite.length || pl.dot || !(pl.amount > 0)) return;
  if (has(src, 'vampiric') && !src.dead) {
    const heal = Math.min(src.maxHp - src.hp, Math.max(pl.amount * 1.5, src.maxHp * 0.06));
    if (heal > 0) {
      src.hp += heal;
      w.fx.text(src.x, src.y - src.r - 6, `+${Math.round(heal)}`, '#d6304a', { small: true });
      w.fx.burst('blood', src.x, src.y, { count: 5, color: '#d6304a' });
    }
  }
  if (w.player && w.player.alive && w.player.hp > 0) {
    if (has(src, 'venomous')) w.applyStatus(w.player, 'poison', { duration: 3, power: 1.5 });
    if (has(src, 'icy')) w.applyStatus(w.player, 'chill', { duration: 2 });
  }
}
function ensureHitListener(w) {
  hitWorld = w;
  const l = bus.map && typeof bus.map.get === 'function' ? bus.map.get('player:hit') : null;
  if (bus.map) { if (!l || !l.includes(onPlayerHit)) bus.on('player:hit', onPlayerHit); }
  else if (!hitSubscribed) { bus.on('player:hit', onPlayerHit); hitSubscribed = true; }
}

function ensureShield(e) {
  const d = e.data;
  if (d.af_shMax == null) {
    d.af_shMax = Math.max(4, Math.round(e.maxHp * 0.3));
    e.shieldMax = d.af_shMax;
    e.shield = d.af_shMax;
    d.af_shT = 0;
  }
}

export const AFFIXES = {
  blazing: {
    id: 'blazing', name: 'Lodernd', color: '#ff6a1f', desc: 'Hinterlässt eine Spur aus Glut.',
    apply(w, e) { e.data.af_lx = e.x; e.data.af_ly = e.y; e.data.af_fire = 1.5; },
    update(w, e, dt) {
      const d = e.data;
      d.af_fire -= dt;
      const moved = Math.hypot(e.x - d.af_lx, e.y - d.af_ly);
      if (e.hidden || (moved < 16 && d.af_fire > 0)) return;
      d.af_lx = e.x; d.af_ly = e.y; d.af_fire = 2.5;
      if (ownedZones(w, e, 'fire') >= 7) return;
      zone(w, e, {
        shape: 'circle', x: e.x, y: e.y, r: 9, delay: 0.5, duration: 2.2, tick: 0.5, damage: 4,
        type: 'fire', color: '#ff6a1f', persist: true, data: { tag: 'fire' },
      });
    },
  },
  icy: {
    id: 'icy', name: 'Eisig', color: '#8fd8ff', desc: 'Treffer lassen erstarren; zerbirst beim Tod in einer Frostnova.',
    apply(w, e) { ensureHitListener(w); },
    onDeath(w, e) {
      zone(w, e, {
        shape: 'circle', x: e.x, y: e.y, r: 50, delay: 0.6, duration: 0.15, damage: 10, type: 'frost',
        status: { id: 'chill', duration: 2.5 }, knockback: 90, color: '#8fd8ff', persist: true,
        onStart(w2, z) { w2.fx.burst('frost', z.x, z.y, { count: 24 }); w2.fx.ring(z.x, z.y, 50, '#8fd8ff', 0.3); },
      });
    },
  },
  tough: {
    id: 'tough', name: 'Gepanzert', color: '#9aa7b8', desc: 'Erleidet 40 % weniger Schaden.',
    apply(w, e) { e.mass *= 1.5; },
    onHit(w, e, hit) { hit.amount *= 0.6; },
  },
  swift: {
    id: 'swift', name: 'Rasend', color: '#ffe75a', desc: 'Schneller in Bewegung und Angriff.',
    apply(w, e) { e.speed *= 1.4; e.data.cdMul = (e.data.cdMul ?? 1) * 0.7; },
  },
  splitting: {
    id: 'splitting', name: 'Spaltend', color: '#c9f06a', desc: 'Zerfällt beim Tod in zwei kleinere Abbilder.',
    onDeath(w, e) {
      if (spawnsBlocked(w) || e.boss) return;
      for (let i = 0; i < 2; i++) {
        const s = freeSpotNear(w, e.x, e.y, Math.min(e.r, 6), e.flying, 4, 14);
        const c = w.spawnEnemy(e.id, s.x, s.y, { summoned: true, hpMul: 0.35, delay: 0.3 });
        if (c) { c.scale = 0.8; c.r = Math.max(3, c.r * 0.8); }
      }
    },
  },
  vampiric: {
    id: 'vampiric', name: 'Vampirisch', color: '#d6304a', desc: 'Heilt sich, wenn es dich trifft.',
    apply(w, e) { ensureHitListener(w); },
  },
  shielded: {
    id: 'shielded', name: 'Abschirmend', color: '#6aa9ff', desc: 'Ein Schild schluckt Schaden und lädt sich wieder auf.',
    update(w, e, dt) {
      ensureShield(e);
      const d = e.data;
      d.af_shT += dt;
      if (d.af_shT > 4 && e.shield < d.af_shMax) e.shield = Math.min(d.af_shMax, e.shield + d.af_shMax * 0.6 * dt);
    },
    onHit(w, e, hit) {
      ensureShield(e);
      const d = e.data;
      d.af_shT = 0;
      if (!(e.shield > 0) || !(hit.amount > 0)) return;
      const absorbed = Math.min(e.shield, hit.amount);
      e.shield -= absorbed;
      hit.amount -= absorbed;
      if (e.shield <= 0) {
        e.shield = 0;
        w.fx.burst('spark', e.x, e.y, { count: 10, color: '#6aa9ff' });
        w.fx.text(e.x, e.y - e.r - 8, 'Schild bricht', '#6aa9ff', { small: true });
      }
    },
  },
  blinking: {
    id: 'blinking', name: 'Teleportierend', color: '#b07cff', desc: 'Springt durch den Raum, wenn du ihm zu nahe kommst.',
    apply(w, e) { e.data.af_tp = 2.5; e.data.af_tpT = 0; },
    update(w, e, dt) {
      const d = e.data;
      if (d.af_tpT > 0) {
        d.af_tpT -= dt;
        if (d.af_tpT <= 0) {
          if (!e.hidden && FREE_STATES.has(e.state) && teleportNear(w, e, 70, 150)) bus.emit('enemy:attack', { enemy: e, kind: 'teleport' });
          else d.af_tp = 1;
        }
        return;
      }
      d.af_tp -= dt;
      if (d.af_tp > 0 || e.hidden || !FREE_STATES.has(e.state)) return;
      if (distTo(e, w.player) < 60 || w.rng.chance(dt * 0.2)) {
        d.af_tpT = 0.45;
        d.af_tp = w.rng.float(4, 6) * cdMul(e);
        w.fx.burst('shadow', e.x, e.y, { count: 10, color: '#b07cff' });
        bus.emit('enemy:telegraph', { enemy: e, kind: 'teleport' });
      }
    },
  },
  explosive: {
    id: 'explosive', name: 'Explosiv', color: '#ff9a3c', desc: 'Explodiert kurz nach seinem Tod.',
    onDeath(w, e) {
      delayedBlast(w, e, e.x, e.y, 0.6, 40, 14, { type: 'fire', color: '#ff9a3c', knockback: 160 });
    },
  },
  venomous: {
    id: 'venomous', name: 'Giftig', color: '#9be35a', desc: 'Jeder Treffer vergiftet.',
    apply(w, e) { ensureHitListener(w); },
  },
  summoner: {
    id: 'summoner', name: 'Beschwörend', color: '#c04bd6', desc: 'Ruft regelmäßig Diener herbei.',
    apply(w, e) { e.data.af_sum = w.rng.float(3, 5); e.data.af_kids = []; e.data.af_sumT = 0; },
    update(w, e, dt) {
      const d = e.data;
      d.af_kids = d.af_kids.filter((k) => !k.dead);
      if (d.af_sumT > 0) {
        d.af_sumT -= dt;
        if (d.af_sumT <= 0 && !spawnsBlocked(w)) {
          const id = SUMMON_FODDER[e.def.biome] || 'ash_crawler';
          d.af_kids.push(...summon(w, e, id, d.af_spots.length, { spots: d.af_spots, delay: 0.3 }));
          bus.emit('enemy:attack', { enemy: e, kind: 'summon' });
        }
        return;
      }
      d.af_sum -= dt;
      if (d.af_sum > 0 || e.hidden || d.af_kids.length >= 4) return;
      d.af_sum = 7 * cdMul(e);
      d.af_sumT = 0.6;
      d.af_spots = [];
      for (let i = 0; i < 2; i++) {
        const s = freeSpotNear(w, e.x, e.y, 5, false, e.r + 8, e.r + 24);
        d.af_spots.push(s);
        telegraphCircle(w, e, s.x, s.y, 8, { delay: 0.6, color: '#c04bd6' });
      }
      w.fx.ring(e.x, e.y, e.r + 14, '#c04bd6', 0.5);
      bus.emit('enemy:telegraph', { enemy: e, kind: 'summon' });
    },
  },
  giant: {
    id: 'giant', name: 'Riesig', color: '#e8c07a', desc: 'Größer, zäher und langsamer.',
    apply(w, e) {
      e.r *= 1.35;
      e.scale = (e.scale || 1) * 1.35;
      e.maxHp *= 1.6;
      e.speed *= 0.8;
      e.mass *= 1.6;
      e.damage *= 1.15;
    },
  },
};
