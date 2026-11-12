// Relics (passives found in chests, shops, shrines) and curses (`rarity: 'curse'`).
// Contract: docs/ARCHITECTURE.md §6.5 — hooks receive ctx = { w, player, run, rng, stacks, state }.
// Rules kept here:
//  - proc damage never re-triggers onHit hooks (proc: false on everything a relic deals),
//  - onUpdate hooks allocate nothing per frame beyond trivial scalars,
//  - consumable effects remember their charge in ctx.state.used.
// Common relics stack up to 2 times (only the "Spiegel" shrine can stack them); everything else is unique.
import { playerDamageMul, skillDamage } from '../game/combat.js';
import { TYPE_COLORS } from '../game/constants.js';

const TAU = Math.PI * 2;
const FIRE = TYPE_COLORS.fire, FROST = TYPE_COLORS.frost, POISON = TYPE_COLORS.poison, SHOCK = TYPE_COLORS.shock;
const SHADOW = TYPE_COLORS.shadow, LIGHT = TYPE_COLORS.light;
const CURSE = '#c04bd6';

// ---------------------------------------------------------------------------------------------
// Helpers (exported for tests and for other content that wants the same rules)
// ---------------------------------------------------------------------------------------------
function weaponDefs(p) {
  const out = [];
  const list = (p && p.weapons) || [];
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].def) out.push(list[i].def);
  return out;
}

/** True if one of the player's weapons deals `type` damage (or is tagged with it). */
export function hasWeaponType(p, type) {
  return weaponDefs(p).some((d) => d.type === type || (Array.isArray(d.tags) && d.tags.includes(type)));
}

const CHANCE_STAT = { fire: 'burnChance', frost: 'chillChance', poison: 'poisonChance', shock: 'shockChance' };
/** Player has a way to deal/apply this element (weapon type or a status chance from other perks). */
export function affinity(p, type) {
  if (hasWeaponType(p, type)) return true;
  const st = CHANCE_STAT[type];
  return !!(st && p && p.stats && p.stats[st] > 0);
}

const NON_PROJECTILE = new Set(['iron_hammer', 'soul_siphon', 'glaive_orbit', 'spark_chain']);
/** At least one weapon fires regular projectiles (projectile modifiers would do something). */
export function shootsProjectiles(p) {
  const defs = weaponDefs(p);
  if (!defs.length) return true;
  return defs.some((d) => (Array.isArray(d.tags) ? d.tags.includes('projectile') : !(d.melee || d.beam || NON_PROJECTILE.has(d.id))));
}

/** Monotonic time for internal cooldowns (run time survives room changes; world time is the fallback). */
function now(ctx) {
  const r = ctx.run;
  if (r && typeof r.time === 'number') return r.time;
  return ctx.w ? ctx.w.time : 0;
}
/** Internal cooldown: returns true (and arms the cooldown) when `key` is ready. */
function ready(ctx, key, cd) {
  const t = now(ctx), s = ctx.state;
  const until = s[key];
  if (until != null && until > t && until - t <= cd + 1e-6) return false;
  s[key] = t + cd;
  return true;
}

function heal(ctx, amount, silent = false) {
  const { w, player: p } = ctx;
  if (!(amount > 0) || !p) return 0;
  if (w && typeof w.healPlayer === 'function') return w.healPlayer(amount, silent ? { silent: true } : undefined);
  const before = p.hp;
  p.hp = Math.min(p.stats.maxHp, p.hp + amount);
  return p.hp - before;
}

function shield(ctx, amount) {
  if (ctx.w && typeof ctx.w.addShield === 'function') ctx.w.addShield(amount);
}

function sparks(ctx, n) {
  const p = ctx.player;
  if (!(n > 0) || !p) return;
  if (typeof p.gainSparks === 'function') p.gainSparks(n);
  else p.sparks = (p.sparks || 0) + n;
}

/** Player-team explosion whose base damage scales like any player damage of that type. */
function nova(ctx, x, y, radius, base, type, extra) {
  const w = ctx.w;
  if (!w) return;
  const opts = { team: 'player', type, source: 'relic', proc: false };
  if (extra) for (const k in extra) opts[k] = extra[k];
  w.explode(x, y, radius, base * playerDamageMul(w, type), opts);
}

/** A relic-owned projectile (never runs onShot, never procs onHit hooks). */
function relicShot(w, x, y, angle, base, type, o) {
  const color = (o && o.color) || TYPE_COLORS[type] || '#ffb347';
  return w.spawnProjectile({
    x, y, angle, speed: (o && o.speed) || 210, r: (o && o.r) || 3,
    damage: base * playerDamageMul(w, type), type, team: 'player',
    life: (o && o.life) || 1.1, homing: (o && o.homing) || 0, pierce: (o && o.pierce) || 0,
    knockback: (o && o.knockback) ?? 30, status: (o && o.status) || null,
    sprite: (o && o.sprite) || 'proj_orb', color, scale: (o && o.scale) || 0.8, spin: (o && o.spin) || 0,
    trail: (o && o.trail) || null, light: { r: 16, color },
    owner: w.player, source: 'relic', proc: false, data: { relic: true },
  });
}

/** Lightning that jumps from `from` to up to `jumps` further enemies within `range` px each. */
function chainLightning(w, from, damage, jumps, range) {
  const hit = [from];
  let cur = from;
  const notHit = (e) => !hit.includes(e);
  for (let i = 0; i < jumps; i++) {
    const next = w.findNearestEnemy(cur.x, cur.y, range, notHit);
    if (!next) break;
    w.fx.lightning(cur.x, cur.y, next.x, next.y, SHOCK);
    hit.push(next);
    w.damageEnemy(next, damage, { type: 'shock', source: 'relic', proc: false });
    if (!next.dead) w.applyStatus(next, 'shock', { duration: 3 });
    cur = next;
  }
  return hit.length - 1;
}

function burnStatus(w, base = 4, duration = 3) {
  const s = w.player.stats;
  return { id: 'burn', duration: duration * s.statusDuration, power: base * s.statusPower * s.damage };
}

function isMoving(p) { return Math.abs(p.vx || 0) + Math.abs(p.vy || 0) > 14; }
function inCombat(w) { return !!(w && w.locked); }
function noXpEnemy(e) { return !!(e && (e.summoned || e.noXp)); }

// --- orbitals: persistent ghost projectiles that circle the player -------------------------------
function spawnOrb(w, p, cfg) {
  return w.spawnProjectile({
    x: p.x, y: p.y, vx: 0, vy: 0, r: cfg.r, damage: cfg.damage * playerDamageMul(w, cfg.type), type: cfg.type,
    team: 'player', life: 1e9, pierce: Infinity, ghost: true, hitInterval: cfg.hitInterval, knockback: cfg.knockback || 0,
    sprite: cfg.sprite, color: cfg.color, scale: cfg.scale || 1, spin: cfg.spinSprite || 0,
    light: { r: cfg.light || 22, color: cfg.color }, owner: p, source: 'relic', proc: false, data: { orbital: true },
  });
}

/** Keeps `cfg.count` orbitals around the player; returns the orb array (or null outside a room). */
function updateOrbitals(ctx, dt, cfg) {
  const { w, player: p, state: s } = ctx;
  if (!w || !w.room || !p) return null;
  if (!s.orbs || s.room !== w.room) {
    s.room = w.room;
    s.orbs = [];
    for (let i = 0; i < cfg.count; i++) s.orbs.push(spawnOrb(w, p, cfg));
  }
  s.ang = ((s.ang || 0) + cfg.speed * dt) % TAU;
  const mul = playerDamageMul(w, cfg.type);
  const orbs = s.orbs;
  for (let i = 0; i < orbs.length; i++) {
    let o = orbs[i];
    if (o.dead) o = orbs[i] = spawnOrb(w, p, cfg);
    const a = s.ang + (i * TAU) / orbs.length;
    o.x = p.x + Math.cos(a) * cfg.radius;
    o.y = p.y + Math.sin(a) * cfg.radius;
    o.vx = 0; o.vy = 0; o.age = 0;
    o.damage = cfg.damage * mul;
  }
  return orbs;
}

/** Orbitals that also shoot homing embers at the nearest enemy. */
function orbitalTurrets(ctx, dt, cfg) {
  const orbs = updateOrbitals(ctx, dt, cfg);
  if (!orbs) return;
  const s = ctx.state, w = ctx.w;
  if (!s.cds || s.cds.length !== orbs.length) {
    s.cds = [];
    for (let i = 0; i < orbs.length; i++) s.cds.push(cfg.interval * (0.4 + i / orbs.length));
  }
  for (let i = 0; i < orbs.length; i++) {
    s.cds[i] -= dt;
    if (s.cds[i] > 0) continue;
    const o = orbs[i];
    const t = w.findNearestEnemy(o.x, o.y, cfg.shotRange);
    if (!t) { s.cds[i] = 0.2; continue; }
    s.cds[i] = cfg.interval;
    relicShot(w, o.x, o.y, Math.atan2(t.y - o.y, t.x - o.x), cfg.shotDamage, cfg.type,
      { speed: 220, homing: 4, life: 1.2, trail: 'ember', color: cfg.color, scale: 0.7 });
  }
}

/** Fires `fn(ctx)` once after a dash finished (works with or without the onDashEnd hook). */
function dashEndHooks(fn) {
  const fire = (ctx) => { if (ctx.state.pend == null) return; ctx.state.pend = null; fn(ctx); };
  return {
    onDash(ctx) { ctx.state.pend = 0.08; },
    onDashEnd: fire,
    onUpdate(ctx, dt) {
      const s = ctx.state;
      if (s.pend == null) return;
      s.pend -= dt;
      if (s.pend <= 0 && !ctx.player.dashing) fire(ctx);
    },
  };
}

/** Wraps a projectile-spec callback so the original (weapon) callback still runs first. */
function chain(prev, fn) {
  if (!prev) return fn;
  return function chained(w, p, a) { prev(w, p, a); fn(w, p, a); };
}

/** Projectile specs that relic shot-modifiers should leave alone (lobs, orbitals, boomerangs, beams, relic shots). */
function plainShot(spec, p) {
  if (spec.arc || !(spec.speed > 0) || !(spec.life > 0) || spec.life >= 4) return false;
  if (spec.data && (spec.data.relic || spec.data.orbital || spec.data.flare)) return false;
  if (spec.weaponId && p) {
    const defs = weaponDefs(p);
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (d.id === spec.weaponId && Array.isArray(d.tags) && (d.tags.includes('boomerang') || d.tags.includes('orbit'))) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------
const LIST = [
  // =========================================================================================
  // COMMON (30) — stackable twice through the Spiegel shrine
  // =========================================================================================
  {
    id: 'ember_heart', name: 'Glutherz', rarity: 'common', maxStacks: 2,
    desc: '+20 max. Leben.', flavor: 'Es schlägt noch – langsam, aber warm.',
    icon: { glyph: 'heart', color: '#ff6a5a' }, tags: ['hp'],
    mods: (n) => [{ stat: 'maxHp', add: 20 * n }],
  },
  {
    id: 'whetstone', name: 'Wetzstein', rarity: 'common', maxStacks: 2,
    desc: '+12 % Schaden.', flavor: 'Grau, schwer und erstaunlich geduldig.',
    icon: { glyph: 'sword', color: '#d0d0d0' }, tags: ['damage'],
    mods: (n) => [{ stat: 'damage', mul: 1 + 0.12 * n }],
  },
  {
    id: 'swift_boots', name: 'Windstiefel', rarity: 'common', maxStacks: 2,
    desc: '+12 % Lauftempo.', flavor: 'Die Sohlen sind nie ganz kalt geworden.',
    icon: { glyph: 'boot', color: '#8fd8ff' }, tags: ['speed'],
    mods: (n) => [{ stat: 'moveSpeed', mul: 1 + 0.12 * n }],
  },
  {
    id: 'ash_cloak', name: 'Aschemantel', rarity: 'common', maxStacks: 2,
    desc: '+2 Rüstung.', flavor: 'Gewebt aus dem Staub gefallener Träger.',
    icon: { glyph: 'shield', color: '#9a948a' }, tags: ['defense'],
    mods: (n) => [{ stat: 'armor', add: 2 * n }],
  },
  {
    id: 'spark_lens', name: 'Funkenlinse', rarity: 'common', maxStacks: 2,
    desc: '+6 % Krit-Chance.', flavor: 'Bündelt das Licht auf die schwächste Stelle.',
    icon: { glyph: 'eye', color: '#ffe75a' }, tags: ['crit'],
    mods: (n) => [{ stat: 'critChance', add: 0.06 * n }],
  },
  {
    id: 'sharp_fang', name: 'Reißzahn', rarity: 'common', maxStacks: 2,
    desc: '+30 % Krit-Schaden.', flavor: 'Er hat schon einmal getroffen. Er weiß, wo.',
    icon: { glyph: 'fang', color: '#f0e6d0' }, tags: ['crit'],
    mods: (n) => [{ stat: 'critMult', add: 0.3 * n }],
  },
  {
    id: 'quick_tinder', name: 'Hastiger Zunder', rarity: 'common', maxStacks: 2,
    desc: '+10 % Feuerrate.', flavor: 'Fängt Feuer, bevor du daran denkst.',
    icon: { glyph: 'bolt', color: '#ffb347' }, tags: ['fireRate'],
    mods: (n) => [{ stat: 'fireRate', mul: 1 + 0.1 * n }],
  },
  {
    id: 'long_wick', name: 'Langer Docht', rarity: 'common', maxStacks: 2,
    desc: '+20 % Reichweite, +10 % Projektiltempo.', flavor: 'Brennt weiter, als man ihm zutraut.',
    icon: { glyph: 'compass', color: '#ffd9a0' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'range', mul: 1 + 0.2 * n }, { stat: 'projSpeed', mul: 1 + 0.1 * n }],
  },
  {
    id: 'lodestone', name: 'Magnetstein', rarity: 'common', maxStacks: 2,
    desc: '+50 % Aufsammelradius.', flavor: 'Funken folgen ihm wie Motten dem Licht.',
    icon: { glyph: 'anchor', color: '#9aa7b8' }, tags: ['utility'],
    mods: (n) => [{ stat: 'pickupRadius', mul: 1 + 0.5 * n }],
  },
  {
    id: 'bone_dice', name: 'Knochenwürfel', rarity: 'common', maxStacks: 2,
    desc: '+2 Glück.', flavor: 'Sechs Seiten, sieben Augen. Niemand fragt nach.',
    icon: { glyph: 'dice', color: '#e8e2d4' }, tags: ['luck'],
    mods: (n) => [{ stat: 'luck', add: 2 * n }],
  },
  {
    id: 'coal_pouch', name: 'Kohlebeutel', rarity: 'common', maxStacks: 2,
    desc: '+20 % Funken.', flavor: 'Klirrt verdächtig angenehm.',
    icon: { glyph: 'coin', color: '#ffd35a' }, tags: ['gold'],
    mods: (n) => [{ stat: 'sparkGain', mul: 1 + 0.2 * n }],
  },
  {
    id: 'old_lantern', name: 'Alte Laterne', rarity: 'common', maxStacks: 2,
    desc: '+40 Lichtradius, +4 % Krit-Chance.', flavor: 'Wer sieht, trifft.',
    icon: { glyph: 'lantern', color: '#ffcf6a' }, tags: ['light', 'crit'],
    mods: (n) => [{ stat: 'lightRadius', add: 40 * n }, { stat: 'critChance', add: 0.04 * n }],
  },
  {
    id: 'thorn_bark', name: 'Dornenrinde', rarity: 'common', maxStacks: 2,
    desc: 'Wer dich trifft, erleidet 8 Dornenschaden.', flavor: 'Rinde eines Baums, der im Dunkeln wuchs.',
    icon: { glyph: 'thorn', color: '#8a6a3a' }, tags: ['defense', 'thorns'],
    mods: (n) => [{ stat: 'thorns', add: 8 * n }],
  },
  {
    id: 'healing_moss', name: 'Heilmoos', rarity: 'common', maxStacks: 2,
    desc: 'Regeneriert 0,25 Leben pro Sekunde.', flavor: 'Wächst sogar auf Schlacke.',
    icon: { glyph: 'leaf', color: '#7dff9a' }, tags: ['heal'],
    mods: (n) => [{ stat: 'regen', add: 0.25 * n }],
  },
  {
    id: 'blood_tooth', name: 'Blutzahn', rarity: 'common', maxStacks: 2,
    desc: '3 % Lebensraub.', flavor: 'Er wird nie satt. Du schon.',
    icon: { glyph: 'tooth', color: '#ff4f5a' }, tags: ['heal'],
    mods: (n) => [{ stat: 'lifesteal', add: 0.03 * n }],
  },
  {
    id: 'lead_orb', name: 'Bleikugel', rarity: 'common', maxStacks: 2,
    desc: '+25 % Projektilgröße, +30 % Rückstoß.', flavor: 'Plump, aber überzeugend.',
    icon: { glyph: 'orb', color: '#b9b3a8' }, tags: ['projectile'],
    mods: (n) => [{ stat: 'projSize', mul: 1 + 0.25 * n }, { stat: 'knockback', mul: 1 + 0.3 * n }],
  },
  {
    id: 'storm_wing', name: 'Sturmschwinge', rarity: 'common', maxStacks: 2,
    desc: '−12 % Dash-Abklingzeit.', flavor: 'Eine Feder aus einem Wind, der nicht mehr weht.',
    icon: { glyph: 'wing', color: '#cfe8ff' }, tags: ['dash'],
    mods: (n) => [{ stat: 'dashCooldown', mul: 1 - 0.12 * n }],
  },
  {
    id: 'ash_chronicle', name: 'Aschenchronik', rarity: 'common', maxStacks: 2,
    desc: '+15 % Erfahrung.', flavor: 'Jede Seite ein Träger, der vor dir fiel.',
    icon: { glyph: 'book', color: '#c9a66b' }, tags: ['xp'],
    mods: (n) => [{ stat: 'xpGain', mul: 1 + 0.15 * n }],
  },
  {
    id: 'ember_elixir', name: 'Glutelixier', rarity: 'common', maxStacks: 2,
    desc: '+10 max. Leben. Heilt dich beim Erhalt vollständig.', flavor: 'Schmeckt nach Rauch und Hoffnung.',
    icon: { glyph: 'potion', color: '#ff6a5a' }, tags: ['hp', 'heal'],
    mods: (n) => [{ stat: 'maxHp', add: 10 * n }],
    hooks: { onGain(ctx) { heal(ctx, 9999); } },
  },
  {
    id: 'hunter_horn', name: 'Jagdhorn', rarity: 'common', maxStacks: 2,
    desc: '+20 % Schaden gegen Elitegegner, +10 % gegen Bosse.', flavor: 'Sein Ruf weckt die Großen.',
    icon: { glyph: 'horn', color: '#d9b47a' }, tags: ['damage'],
    mods: (n) => [{ stat: 'eliteDamage', mul: 1 + 0.2 * n }, { stat: 'bossDamage', mul: 1 + 0.1 * n }],
  },
  {
    id: 'coal_heart', name: 'Kohlenherz', rarity: 'common', maxStacks: 2,
    desc: '+15 % Feuerschaden, 6 % Brandchance.', flavor: 'Glüht, selbst wenn alles andere erlischt.',
    icon: { glyph: 'flame', color: FIRE }, tags: ['fire', 'status'],
    mods: (n) => [{ stat: 'fireDamage', mul: 1 + 0.15 * n }, { stat: 'burnChance', add: 0.06 * n }],
  },
  {
    id: 'rime_shard', name: 'Reifsplitter', rarity: 'common', maxStacks: 2,
    desc: '+10 % Frostschaden, 8 % Frostchance.', flavor: 'Er schmilzt nicht. Nie.',
    icon: { glyph: 'snowflake', color: FROST }, tags: ['frost', 'status'],
    mods: (n) => [{ stat: 'frostDamage', mul: 1 + 0.1 * n }, { stat: 'chillChance', add: 0.08 * n }],
  },
  {
    id: 'venom_gland', name: 'Giftdrüse', rarity: 'common', maxStacks: 2,
    desc: '+10 % Giftschaden, 8 % Giftchance.', flavor: 'Pulsiert noch leise im Glas.',
    icon: { glyph: 'drop', color: POISON }, tags: ['poison', 'status'],
    mods: (n) => [{ stat: 'poisonDamage', mul: 1 + 0.1 * n }, { stat: 'poisonChance', add: 0.08 * n }],
  },
  {
    id: 'static_coil', name: 'Spannungsspule', rarity: 'common', maxStacks: 2,
    desc: '+10 % Schockschaden, 8 % Schockchance.', flavor: 'Knistert, wenn man sie ansieht.',
    icon: { glyph: 'bolt', color: SHOCK }, tags: ['shock', 'status'],
    mods: (n) => [{ stat: 'shockDamage', mul: 1 + 0.1 * n }, { stat: 'shockChance', add: 0.08 * n }],
  },
  {
    id: 'campfire_ash', name: 'Lagerfeuerasche', rarity: 'common', maxStacks: 2,
    desc: 'Nach jedem geräumten Raum heilst du 6 Leben.', flavor: 'Ein Rest Wärme für den Weg.',
    icon: { glyph: 'cross', color: '#7dff9a' }, tags: ['heal'],
    hooks: { onRoomClear(ctx) { heal(ctx, 6 * ctx.stacks); } },
  },
  {
    id: 'beggar_bowl', name: 'Bettlerschale', rarity: 'common', maxStacks: 2,
    desc: 'Nach jedem geräumten Raum erhältst du 3 Funken.', flavor: 'Die Tiefe gibt. Manchmal.',
    icon: { glyph: 'hand', color: '#ffd35a' }, tags: ['gold'],
    hooks: { onRoomClear(ctx) { sparks(ctx, 3 * ctx.stacks); } },
  },
  {
    id: 'vigil_candle', name: 'Wachkerze', rarity: 'common', maxStacks: 2,
    desc: 'Beim Betreten eines Kampfraums erhältst du 10 Schild.', flavor: 'Sie brennt für die, die wachen.',
    icon: { glyph: 'candle', color: '#9ad0ff' }, tags: ['shield', 'defense'],
    hooks: { onRoomEnter(ctx) { if (inCombat(ctx.w)) shield(ctx, 10 * ctx.stacks); } },
  },
  {
    id: 'cracked_mask', name: 'Gesprungene Maske', rarity: 'common', maxStacks: 2,
    desc: '+7 % Ausweichen.', flavor: 'Hinter dem Riss ist niemand mehr.',
    icon: { glyph: 'mask', color: '#c9c2b8' }, tags: ['defense'],
    mods: (n) => [{ stat: 'dodge', add: 0.07 * n }],
  },
  {
    id: 'bone_charm', name: 'Knochenamulett', rarity: 'common', maxStacks: 2,
    desc: 'Jeder 4. Kill heilt 3 Leben.', flavor: 'Klappert zufrieden nach jedem Kampf.',
    icon: { glyph: 'bone', color: '#efe6cf' }, tags: ['heal', 'kill'],
    hooks: {
      onKill(ctx) {
        const s = ctx.state;
        s.k = (s.k || 0) + 1;
        if (s.k >= 4) { s.k = 0; heal(ctx, 3 * ctx.stacks); }
      },
    },
  },
  {
    id: 'quiet_step', name: 'Leiser Schritt', rarity: 'common', maxStacks: 2,
    desc: '+15 % Lauftempo, solange kein Gegner näher als 60 px ist.', flavor: 'Die Schatten hören dich nicht kommen.',
    icon: { glyph: 'feather', color: '#b8c4d6' }, tags: ['speed'],
    hooks: {
      dynamicMods(ctx) {
        const { w, player: p } = ctx;
        if (!w || w.findNearestEnemy(p.x, p.y, 60)) return null;
        return [{ stat: 'moveSpeed', mul: 1 + 0.15 * ctx.stacks }];
      },
    },
  },

  // =========================================================================================
  // UNCOMMON (24)
  // =========================================================================================
  {
    id: 'lucky_coin', name: 'Glücksmünze', rarity: 'uncommon',
    desc: '+25 % Funken, +1 Glück.', flavor: 'Beide Seiten zeigen dasselbe Gesicht.',
    icon: { glyph: 'coin', color: '#ffd35a' }, tags: ['gold', 'luck'],
    mods: [{ stat: 'sparkGain', mul: 1.25 }, { stat: 'luck', add: 1 }],
  },
  {
    id: 'interest_purse', name: 'Zinsbeutel', rarity: 'uncommon',
    desc: 'Nach jedem geräumten Raum: +1 Funke je 10 Funken in deinem Besitz (max. 6).', flavor: 'Auch Funken vermehren sich im Dunkeln.',
    icon: { glyph: 'scale', color: '#ffd35a' }, tags: ['gold', 'economy'],
    hooks: {
      onRoomClear(ctx) {
        const p = ctx.player;
        const n = Math.min(6, Math.floor((p.sparks || 0) / 10));
        if (n > 0) {
          sparks(ctx, n);
          if (ctx.w) ctx.w.fx.text(p.x, p.y - 18, `+${n} Zinsen`, '#ffd35a', { small: true });
        }
      },
    },
  },
  {
    id: 'haggler_ring', name: 'Feilscherring', rarity: 'uncommon',
    desc: '15 % Rabatt bei Händlern.', flavor: 'Er glänzt genau dann, wenn jemand einen Preis nennt.',
    icon: { glyph: 'ring', color: '#ffd35a' }, tags: ['gold', 'economy'],
    mods: [{ stat: 'shopDiscount', add: 0.15 }],
  },
  {
    id: 'loaded_dice', name: 'Gezinkter Würfel', rarity: 'uncommon',
    desc: '+1 Glück. +1 Neuwurf sofort und bei jedem neuen Stockwerk.', flavor: 'Er fällt immer ein bisschen zu oft auf die Sechs.',
    icon: { glyph: 'dice', color: '#b07cff' }, tags: ['luck', 'economy'],
    mods: [{ stat: 'luck', add: 1 }],
    hooks: {
      onGain(ctx) { ctx.run.rerolls = (ctx.run.rerolls || 0) + 1; },
      onFloorEnter(ctx) { ctx.run.rerolls = (ctx.run.rerolls || 0) + 1; },
    },
  },
  {
    id: 'tinder_bundle', name: 'Zunderbündel', rarity: 'uncommon',
    desc: 'Treffer haben 8 % Chance auf eine Glutexplosion (30 px, 10 Feuerschaden).', flavor: 'Trocken, brüchig und sehr ungeduldig.',
    icon: { glyph: 'ember', color: '#ff6a1f' }, tags: ['fire', 'proc'],
    hooks: {
      onHit(ctx, { enemy }) {
        if (ctx.rng.chance(0.08)) nova(ctx, enemy.x, enemy.y, 30, 10, 'fire', { knockback: 60 });
      },
    },
  },
  {
    id: 'shatter_glass', name: 'Splitterglas', rarity: 'uncommon',
    desc: 'Unterkühlte oder gefrorene Gegner zerspringen beim Tod in 6 Eissplitter (je 7 Frostschaden).', flavor: 'Kälte macht alles zerbrechlich.',
    icon: { glyph: 'gem', color: FROST }, tags: ['frost', 'kill', 'status'],
    requires: (p) => affinity(p, 'frost'),
    hooks: {
      onKill(ctx, { enemy }) {
        const st = enemy.statuses;
        if (!st || !(st.freeze || st.chill)) return;
        const w = ctx.w, off = ctx.rng.angle();
        for (let i = 0; i < 6; i++) {
          relicShot(w, enemy.x, enemy.y, off + (i * TAU) / 6, 7, 'frost',
            { speed: 190, life: 0.5, sprite: 'proj_shard', status: { id: 'chill', duration: 2.5 } });
        }
      },
    },
  },
  {
    id: 'wildfire', name: 'Flächenbrand', rarity: 'uncommon',
    desc: 'Brennende Gegner geben ihren Brand beim Tod an alle Gegner im Umkreis von 56 px weiter.', flavor: 'Ein Funke findet immer den nächsten.',
    icon: { glyph: 'flame', color: '#ff5a1f' }, tags: ['fire', 'status', 'kill'],
    requires: (p) => affinity(p, 'fire'),
    hooks: {
      onKill(ctx, { enemy }) {
        const b = enemy.statuses && enemy.statuses.burn;
        if (!b) return;
        const w = ctx.w;
        w.fx.ring(enemy.x, enemy.y, 56, FIRE, 0.3);
        const near = w.enemiesInRadius(enemy.x, enemy.y, 56);
        for (let i = 0; i < near.length; i++) {
          if (near[i] !== enemy) w.applyStatus(near[i], 'burn', { duration: Math.max(2, b.t), power: b.power });
        }
      },
    },
  },
  {
    id: 'rot_catalyst', name: 'Fäulniskatalysator', rarity: 'uncommon',
    desc: 'Treffer gegen vergiftete Gegner fügen 1 weiteren Giftstapel hinzu. +15 % Statusstärke.', flavor: 'Beschleunigt, was ohnehin geschieht.',
    icon: { glyph: 'mushroom', color: POISON }, tags: ['poison', 'status'],
    requires: (p) => affinity(p, 'poison'),
    mods: [{ stat: 'statusPower', mul: 1.15 }],
    hooks: {
      onHit(ctx, { enemy }) {
        const ps = enemy.statuses && enemy.statuses.poison;
        if (!ps || enemy.dead) return;
        ctx.w.applyStatus(enemy, 'poison', { stacks: 1, power: ps.power, duration: 4 * ctx.player.stats.statusDuration });
      },
    },
  },
  {
    id: 'conductor_rod', name: 'Leitstab', rarity: 'uncommon',
    desc: 'Treffer gegen geschockte Gegner springen auf einen weiteren Gegner (bis 110 px) über: 50 % Schaden, schockt ihn.', flavor: 'Der Blitz sucht sich immer einen Weg.',
    icon: { glyph: 'staff', color: SHOCK }, tags: ['shock', 'status'],
    requires: (p) => affinity(p, 'shock'),
    hooks: {
      onHit(ctx, { enemy, amount }) {
        if (!enemy.statuses || !enemy.statuses.shock || !ready(ctx, 'cd', 0.12)) return;
        chainLightning(ctx.w, enemy, amount * 0.5 * ctx.player.stats.shockDamage, 1, 110);
      },
    },
  },
  {
    id: 'ember_wisp', name: 'Glutirrlicht', rarity: 'uncommon',
    desc: 'Ein Irrlicht umkreist dich und schießt alle 1,4 s eine zielsuchende Glutkugel (9 Feuerschaden).', flavor: 'Es hat beschlossen, dir zu folgen.',
    icon: { glyph: 'orb', color: '#ffb347' }, tags: ['orbital', 'fire', 'summon'],
    hooks: {
      onRoomEnter(ctx) { ctx.state.orbs = null; },
      onUpdate(ctx, dt) {
        orbitalTurrets(ctx, dt, {
          count: 1, radius: 22, speed: 2.2, r: 2, damage: 0, hitInterval: 1, type: 'fire',
          sprite: 'proj_orb', color: '#ffb347', scale: 0.9, light: 30,
          interval: 1.4, shotDamage: 9, shotRange: 180,
        });
      },
    },
  },
  {
    id: 'cinder_trail', name: 'Glutspur', rarity: 'uncommon',
    desc: 'Dein Dash hinterlässt 2 s lang eine brennende Spur (6 Feuerschaden alle 0,4 s, setzt in Brand).', flavor: 'Wo du warst, glüht der Boden.',
    icon: { glyph: 'boot', color: FIRE }, tags: ['dash', 'fire'],
    hooks: {
      onDash(ctx) { ctx.state.t = 0.3; ctx.state.tick = 0; },
      onUpdate(ctx, dt) {
        const s = ctx.state;
        if (!(s.t > 0)) return;
        const { w, player: p } = ctx;
        if (p.dashing) s.t = Math.max(s.t, 0.06);
        s.t -= dt; s.tick -= dt;
        if (s.tick > 0 || !w) return;
        s.tick = 0.05;
        w.spawnZone({
          shape: 'circle', x: p.x, y: p.y, r: 12, delay: 0, duration: 2, damage: 6 * playerDamageMul(w, 'fire'), tick: 0.4,
          team: 'player', type: 'fire', status: burnStatus(w, 3, 2), color: FIRE, source: 'relic',
        });
      },
    },
  },
  {
    id: 'thunder_step', name: 'Donnerschritt', rarity: 'uncommon',
    desc: 'Am Ende jedes Dashs entlädt sich eine Schockwelle (52 px, 14 Schockschaden, schockt, stößt zurück).', flavor: 'Jeder Schritt ein Gewitter.',
    icon: { glyph: 'bolt', color: '#fff27a' }, tags: ['dash', 'shock'],
    hooks: dashEndHooks((ctx) => {
      const p = ctx.player;
      nova(ctx, p.x, p.y, 52, 14, 'shock', { status: { id: 'shock', duration: 3 }, knockback: 180 });
    }),
  },
  {
    id: 'vampire_fang', name: 'Vampirfang', rarity: 'uncommon',
    desc: 'Kritische Treffer heilen 1 Leben (höchstens 5× pro Sekunde).', flavor: 'Er trinkt nur das Beste.',
    icon: { glyph: 'fang', color: '#d6304a' }, tags: ['crit', 'heal'],
    hooks: { onCrit(ctx) { if (ready(ctx, 'cd', 0.2)) heal(ctx, 1, true); } },
  },
  {
    id: 'retribution', name: 'Vergeltungsglut', rarity: 'uncommon',
    desc: 'Wirst du getroffen, entlädt sich eine Feuernova (64 px, 18 Feuerschaden, setzt in Brand).', flavor: 'Wer die Glut schlägt, verbrennt sich.',
    icon: { glyph: 'spiral', color: '#ff7a2f' }, tags: ['defense', 'fire'],
    hooks: {
      onDamaged(ctx, hit) {
        if (!(hit.amount > 0) || hit.dot || !ready(ctx, 'cd', 0.5)) return;
        const { w, player: p } = ctx;
        nova(ctx, p.x, p.y, 64, 18, 'fire', { status: burnStatus(w), knockback: 140 });
      },
    },
  },
  {
    id: 'glass_needle', name: 'Glasnadel', rarity: 'uncommon',
    desc: 'Projektile durchschlagen 1 zusätzlichen Gegner.', flavor: 'So fein, dass sie den Widerstand nicht bemerkt.',
    icon: { glyph: 'dagger', color: '#cfe8ff' }, tags: ['projectile'],
    requires: shootsProjectiles,
    mods: [{ stat: 'pierce', add: 1 }],
  },
  {
    id: 'spiral_shell', name: 'Wirbelschnecke', rarity: 'uncommon',
    desc: 'Projektile prallen 1× zusätzlich von Wänden ab. +10 % Reichweite.', flavor: 'Alles kehrt irgendwann zurück.',
    icon: { glyph: 'spiral', color: '#e0c9a6' }, tags: ['projectile'],
    requires: shootsProjectiles,
    mods: [{ stat: 'bounce', add: 1 }, { stat: 'range', mul: 1.1 }],
  },
  {
    id: 'hunters_mark', name: 'Jägermal', rarity: 'uncommon',
    desc: '+3 % Krit-Chance. Kritische Treffer zeichnen Gegner 4 s lang (+25 % erlittener Schaden).', flavor: 'Einmal gesehen, nie mehr verloren.',
    icon: { glyph: 'eye', color: '#ff4f7a' }, tags: ['crit', 'status'],
    mods: [{ stat: 'critChance', add: 0.03 }],
    hooks: { onCrit(ctx, { enemy }) { if (!enemy.dead) ctx.w.applyStatus(enemy, 'mark', { duration: 4 }); } },
  },
  {
    id: 'ember_frenzy', name: 'Glutrausch', rarity: 'uncommon',
    desc: 'Unter 40 % Leben: +25 % Schaden und +15 % Feuerrate.', flavor: 'Am hellsten brennt, was fast erloschen ist.',
    icon: { glyph: 'skull', color: '#ff4f3a' }, tags: ['damage', 'fireRate'],
    hooks: {
      dynamicMods(ctx) {
        const p = ctx.player;
        if (p.hp >= p.stats.maxHp * 0.4) return null;
        return [{ stat: 'damage', mul: 1.25 }, { stat: 'fireRate', mul: 1.15 }];
      },
    },
  },
  {
    id: 'full_flame', name: 'Volle Flamme', rarity: 'uncommon',
    desc: 'Bei vollem Leben: +20 % Schaden.', flavor: 'Unversehrt brennt es sich am leichtesten.',
    icon: { glyph: 'sun', color: '#ffcf5a' }, tags: ['damage'],
    hooks: {
      dynamicMods(ctx) {
        const p = ctx.player;
        return p.hp >= p.stats.maxHp - 0.5 ? [{ stat: 'damage', mul: 1.2 }] : null;
      },
    },
  },
  {
    id: 'spark_battery', name: 'Funkenbatterie', rarity: 'uncommon',
    desc: '−15 % Fertigkeits-Abklingzeit, +15 % Fertigkeitsstärke.', flavor: 'Speichert, was andere verschwenden.',
    icon: { glyph: 'hourglass', color: '#ffe75a' }, tags: ['skill'],
    mods: [{ stat: 'skillCooldown', mul: 0.85 }, { stat: 'skillPower', mul: 1.15 }],
  },
  {
    id: 'flare_up', name: 'Aufflammen', rarity: 'uncommon',
    desc: 'Deine Fertigkeit löst zusätzlich eine Feuernova aus (72 px, 20 Feuerschaden) und gibt 10 Schild.', flavor: 'Ein kurzes, grelles Nein.',
    icon: { glyph: 'star', color: '#ff9a3c' }, tags: ['skill', 'fire', 'shield'],
    hooks: {
      onSkill(ctx) {
        const p = ctx.player;
        nova(ctx, p.x, p.y, 72, 20, 'fire', { knockback: 150 });
        shield(ctx, 10);
      },
    },
  },
  {
    id: 'soul_spark', name: 'Seelenfunke', rarity: 'uncommon',
    desc: 'Kills haben 20 % Chance, eine zielsuchende Glut freizusetzen (12 Feuerschaden).', flavor: 'Was stirbt, will noch einmal leuchten.',
    icon: { glyph: 'ember', color: '#ffd35a' }, tags: ['kill', 'fire'],
    hooks: {
      onKill(ctx, { enemy }) {
        if (!ctx.rng.chance(0.2)) return;
        const w = ctx.w;
        const t = w.findNearestEnemy(enemy.x, enemy.y, 200, (o) => o !== enemy);
        const a = t ? Math.atan2(t.y - enemy.y, t.x - enemy.x) : ctx.rng.angle();
        relicShot(w, enemy.x, enemy.y, a, 12, 'fire', { speed: 200, homing: 5, life: 1.5, trail: 'ember', color: '#ffd35a' });
      },
    },
  },
  {
    id: 'far_sight', name: 'Fernsicht', rarity: 'uncommon',
    desc: '+18 % Schaden, solange kein Gegner näher als 80 px ist.', flavor: 'Aus der Ferne ist jeder Schatten ein Ziel.',
    icon: { glyph: 'bow', color: '#cfe8ff' }, tags: ['damage'],
    hooks: {
      dynamicMods(ctx) {
        const { w, player: p } = ctx;
        if (!w || w.findNearestEnemy(p.x, p.y, 80)) return null;
        return [{ stat: 'damage', mul: 1.18 }];
      },
    },
  },
  {
    id: 'dancing_ember', name: 'Tanzende Glut', rarity: 'uncommon',
    desc: '+10 % Krit-Chance, solange du in Bewegung bist.', flavor: 'Stillstand ist Asche.',
    icon: { glyph: 'feather', color: '#ffb347' }, tags: ['crit', 'speed'],
    hooks: { dynamicMods(ctx) { return isMoving(ctx.player) ? [{ stat: 'critChance', add: 0.1 }] : null; } },
  },

  // =========================================================================================
  // RARE (16)
  // =========================================================================================
  {
    id: 'ash_amulet', name: 'Aschenamulett', rarity: 'rare',
    desc: 'Tödlicher Schaden kostet dich stattdessen alle Funken (mind. 40) – du überlebst mit 30 % Leben. Wiederholbar.', flavor: 'Der Tod lässt mit sich handeln. Er nimmt Funken.',
    icon: { glyph: 'gem', color: '#c9c2b8' }, tags: ['revive', 'gold'],
    hooks: {
      onLethal(ctx) {
        const { w, player: p } = ctx;
        const n = p.sparks || 0;
        if (n < 40) return false;
        if (typeof p.spendSparks === 'function') { if (!p.spendSparks(n)) return false; } else p.sparks = 0;
        p.hp = Math.max(1, Math.round(p.stats.maxHp * 0.3));
        if (w) w.fx.text(p.x, p.y - 20, `−${n} Funken`, '#ffd35a');
        return true;
      },
    },
  },
  {
    id: 'phoenix_feather', name: 'Phönixfeder', rarity: 'rare',
    desc: 'Einmalig: Überlebe tödlichen Schaden mit 40 % Leben.', flavor: 'Sie glimmt, als warte sie auf etwas.',
    icon: { glyph: 'feather', color: '#ff8a3c' }, tags: ['revive'],
    hooks: {
      onLethal(ctx) {
        if (ctx.state.used) return false;
        ctx.state.used = true;
        const p = ctx.player;
        p.hp = Math.max(1, Math.round(p.stats.maxHp * 0.4));
        if (ctx.w) ctx.w.fx.text(p.x, p.y - 20, 'Die Feder verglüht', '#ff8a3c');
        return true;
      },
    },
  },
  {
    id: 'crescent_moon', name: 'Sichelmond', rarity: 'rare',
    desc: 'Projektile kehren nach halber Strecke zu dir zurück und können auf dem Rückweg erneut treffen.', flavor: 'Was du wirfst, gehört dir für immer.',
    icon: { glyph: 'moon', color: '#d6e2ff' }, tags: ['projectile'],
    requires: shootsProjectiles,
    hooks: {
      onShot(ctx, spec) {
        if (!plainShot(spec, ctx.player)) return;
        const out = spec.life * 0.55;
        spec.life = out * 2.6;
        spec.onUpdate = chain(spec.onUpdate, boomerangUpdate);
        spec.data = spec.data ? { ...spec.data, turnAt: out } : { turnAt: out };
      },
    },
  },
  {
    id: 'seeking_eye', name: 'Suchendes Auge', rarity: 'rare',
    desc: 'Projektile suchen ihr Ziel (+2,5 Zielsuche). +10 % Projektilgröße.', flavor: 'Es blinzelt nie.',
    icon: { glyph: 'eye', color: '#b07cff' }, tags: ['projectile'],
    requires: shootsProjectiles,
    mods: [{ stat: 'homing', add: 2.5 }, { stat: 'projSize', mul: 1.1 }],
  },
  {
    id: 'twin_flame', name: 'Zwillingsflamme', rarity: 'rare',
    desc: '+1 Projektil pro Salve. −25 % Schaden.', flavor: 'Zwei Flammen, ein Docht.',
    icon: { glyph: 'star', color: '#ffb347' }, tags: ['projectile'],
    requires: shootsProjectiles,
    mods: [{ stat: 'multishot', add: 1 }, { stat: 'damage', mul: 0.75 }],
  },
  {
    id: 'winter_heart', name: 'Herz des Winters', rarity: 'rare',
    desc: '+12 % Frostchance. Treffer gegen gefrorene Gegner verursachen 40 % Bonus-Frostschaden.', flavor: 'Kalt genug, um selbst Glut zu brechen.',
    icon: { glyph: 'snowflake', color: '#d6f4ff' }, tags: ['frost', 'status'],
    mods: [{ stat: 'chillChance', add: 0.12 }],
    hooks: {
      onHit(ctx, { enemy, amount }) {
        if (!enemy.frozen && !(enemy.statuses && enemy.statuses.freeze)) return;
        if (enemy.dead) return;
        ctx.w.damageEnemy(enemy, amount * 0.4 * ctx.player.stats.frostDamage, { type: 'frost', source: 'relic', proc: false });
      },
    },
  },
  {
    id: 'rot_bloom', name: 'Giftblüte', rarity: 'rare',
    desc: 'Vergiftete Gegner platzen beim Tod zu einer Giftwolke (36 px, 2,5 s, 4 Giftschaden alle 0,5 s, vergiftet).', flavor: 'Aus jedem Ende wächst etwas.',
    icon: { glyph: 'mushroom', color: '#7fd34a' }, tags: ['poison', 'kill', 'status'],
    requires: (p) => affinity(p, 'poison'),
    hooks: {
      onKill(ctx, { enemy }) {
        if (!enemy.statuses || !enemy.statuses.poison) return;
        const w = ctx.w, s = ctx.player.stats;
        w.spawnZone({
          shape: 'circle', x: enemy.x, y: enemy.y, r: 36, delay: 0, duration: 2.5, damage: 4 * playerDamageMul(w, 'poison'), tick: 0.5,
          team: 'player', type: 'poison', color: POISON, source: 'relic',
          status: { id: 'poison', duration: 4 * s.statusDuration, power: 2.2 * s.statusPower * s.damage },
        });
        w.fx.burst('poison', enemy.x, enemy.y, { count: 14 });
      },
    },
  },
  {
    id: 'inferno_core', name: 'Infernokern', rarity: 'rare',
    desc: '+12 % Brandchance, +20 % Feuerschaden, +30 % Statusstärke.', flavor: 'Ein Splitter der Sonne, noch nicht ganz erloschen.',
    icon: { glyph: 'sun', color: '#ff6a1f' }, tags: ['fire', 'status'],
    requires: (p) => affinity(p, 'fire'),
    mods: [{ stat: 'burnChance', add: 0.12 }, { stat: 'fireDamage', mul: 1.2 }, { stat: 'statusPower', mul: 1.3 }],
  },
  {
    id: 'shadow_veil', name: 'Schattenschleier', rarity: 'rare',
    desc: 'Nach einem Dash bist du 0,5 s unverwundbar (höchstens alle 1,5 s) und dein nächster Schuss trifft garantiert kritisch.', flavor: 'Für einen Herzschlag bist du nicht hier.',
    icon: { glyph: 'mask', color: SHADOW }, tags: ['dash', 'crit', 'shadow'],
    hooks: {
      ...dashEndHooks((ctx) => {
        const p = ctx.player;
        // balance: an internal cooldown so dash spam + dash-cooldown stacking cannot chain the i-frames forever
        if (ready(ctx, 'veilT', 1.5)) p.iframes = Math.max(p.iframes || 0, 0.5);
        ctx.state.crit = true;
        if (ctx.w) ctx.w.fx.burst('shadow', p.x, p.y, { count: 10 });
      }),
      onShot(ctx, spec) {
        if (!ctx.state.crit || (spec.data && (spec.data.relic || spec.data.orbital))) return;
        ctx.state.crit = false;
        if (!spec.crit) { spec.crit = true; spec.damage *= ctx.player.stats.critMult; }
      },
    },
  },
  {
    id: 'blood_chalice', name: 'Blutkelch', rarity: 'rare',
    desc: '+5 % Lebensraub, +15 max. Leben.', flavor: 'Nie leer. Nie ganz voll.',
    icon: { glyph: 'potion', color: '#b0203a' }, tags: ['heal', 'hp'],
    mods: [{ stat: 'lifesteal', add: 0.05 }, { stat: 'maxHp', add: 15 }],
  },
  {
    id: 'orbit_blades', name: 'Kreisende Klingen', rarity: 'rare',
    desc: 'Zwei Klingen umkreisen dich (36 px) und verursachen 10 Schaden alle 0,35 s.', flavor: 'Sie tanzen um dich, damit niemand anders es tut.',
    icon: { glyph: 'dagger', color: '#e8e2d4' }, tags: ['orbital'],
    hooks: {
      onRoomEnter(ctx) { ctx.state.orbs = null; },
      onUpdate(ctx, dt) {
        updateOrbitals(ctx, dt, {
          count: 2, radius: 36, speed: 3.4, r: 6, damage: 10, hitInterval: 0.35, knockback: 70, type: 'phys',
          sprite: 'proj_blade', color: '#e8e2d4', spinSprite: 14, light: 18,
        });
      },
    },
  },
  {
    id: 'star_heart', name: 'Sternenherz', rarity: 'rare',
    desc: 'Alle 8 s entlädt sich eine Lichtnova um dich (80 px, 30 Lichtschaden), sobald ein Gegner in Reichweite ist.', flavor: 'Ein Stern, klein genug für eine Brust.',
    icon: { glyph: 'star', color: LIGHT }, tags: ['light'],
    hooks: {
      onUpdate(ctx, dt) {
        const s = ctx.state, { w, player: p } = ctx;
        s.t = Math.min(8, (s.t || 0) + dt);
        if (s.t < 8 || !w || !p.alive) return;
        if (!w.findNearestEnemy(p.x, p.y, 80)) return;
        s.t = 0;
        nova(ctx, p.x, p.y, 80, 30, 'light', { knockback: 120, color: LIGHT });
        w.fx.light(p.x, p.y, 160, LIGHT, 0.4);
      },
    },
  },
  {
    id: 'gold_vein', name: 'Goldader', rarity: 'rare',
    desc: '+40 % Funken. Jeder aufgesammelte Funke heilt 0,3 Leben.', flavor: 'Reichtum, der durch die Adern fließt.',
    icon: { glyph: 'coin', color: '#ffbf2a' }, tags: ['gold', 'heal'],
    mods: [{ stat: 'sparkGain', mul: 1.4 }],
    hooks: { onPickup(ctx, { kind, amount }) { if (kind === 'spark') heal(ctx, 0.3 * (amount || 1), true); } },
  },
  {
    id: 'death_knell', name: 'Totenglocke', rarity: 'rare',
    desc: '+15 % Schaden gegen Elitegegner. Elite- und Bosskills setzen deine Fertigkeit und deine Dashes sofort zurück.', flavor: 'Sie läutet nur für die Großen.',
    icon: { glyph: 'horn', color: '#9aa7b8' }, tags: ['skill', 'dash', 'kill'],
    mods: [{ stat: 'eliteDamage', mul: 1.15 }],
    hooks: {
      onKill(ctx, { enemy }) {
        if (!(enemy.boss || (enemy.elite && enemy.elite.length))) return;
        const p = ctx.player;
        if (p.skill) p.skill.cd = 0;
        if (p.dash) { p.dash.charges = p.dash.max; p.dash.cd = 0; }
        if (ctx.w) ctx.w.fx.ring(p.x, p.y, 40, '#9aa7b8', 0.3);
      },
    },
  },
  {
    id: 'split_core', name: 'Splitterkern', rarity: 'rare',
    desc: 'Projektile zerplatzen beim ersten Treffer in 2 Splitter (je 40 % Schaden).', flavor: 'Ein Ende ist nur ein Anfang in zwei Richtungen.',
    icon: { glyph: 'gem', color: '#ff9a5a' }, tags: ['projectile'],
    requires: shootsProjectiles,
    hooks: {
      onShot(ctx, spec) {
        if (!plainShot(spec, ctx.player)) return;
        spec.onHit = chain(spec.onHit, splitOnHit);
      },
    },
  },
  {
    id: 'ash_bulwark', name: 'Glutbastion', rarity: 'rare',
    desc: '+1 Rüstung. Im Kampf erhältst du alle 10 s 12 Schild.', flavor: 'Asche, gepresst zu einer Mauer.',
    icon: { glyph: 'shield', color: '#ffb347' }, tags: ['shield', 'defense'],
    mods: [{ stat: 'armor', add: 1 }],
    hooks: {
      onUpdate(ctx, dt) {
        if (!inCombat(ctx.w)) return;
        const s = ctx.state;
        s.t = (s.t || 0) + dt;
        if (s.t < 10) return;
        s.t = 0;
        shield(ctx, 12);
        ctx.w.fx.ring(ctx.player.x, ctx.player.y, 22, '#ffb347', 0.3);
      },
    },
  },

  // =========================================================================================
  // LEGENDARY (8) — these change how you play
  // =========================================================================================
  {
    id: 'sun_heart', name: 'Herz der Sonne', rarity: 'legendary',
    desc: 'Jedes 10. Projektil wird zur Sonneneruption: 2,5× Schaden, doppelte Größe, durchschlägt 3 Gegner und explodiert am Ende (56 px, 30 Feuerschaden, setzt in Brand).',
    flavor: 'Ein letzter Rest der Sonne. Er will zurück.',
    icon: { glyph: 'sun', color: '#ffd35a' }, tags: ['projectile', 'fire', 'light'],
    requires: shootsProjectiles,
    hooks: {
      onShot(ctx, spec) {
        if (!plainShot(spec, ctx.player)) return;
        const s = ctx.state;
        s.n = (s.n || 0) + 1;
        if (s.n < 10) return;
        s.n = 0;
        const w = ctx.w;
        spec.damage *= 2.5;
        spec.r = (spec.r || 3) * 2;
        spec.scale = (spec.scale || 1) * 2;
        spec.pierce = (spec.pierce || 0) + 3;
        spec.life = Math.max(spec.life, 0.5);
        spec.color = '#fff3b0';
        spec.sprite = 'proj_star';
        spec.spin = 8;
        spec.trail = 'light';
        spec.light = { r: 60, color: '#ffd35a' };
        spec.data = spec.data ? { ...spec.data, flare: 30 * playerDamageMul(w, 'fire') } : { flare: 30 * playerDamageMul(w, 'fire') };
        spec.onExpire = chain(spec.onExpire, flareExpire);
      },
    },
  },
  {
    id: 'second_ember', name: 'Zweite Glut', rarity: 'legendary',
    desc: 'Einmalig: Bei tödlichem Schaden erhebst du dich mit 60 % Leben in einer Feuersbrunst (110 px, 60 Feuerschaden). Danach +15 % Schaden für den Rest des Abstiegs.',
    flavor: 'Asche erinnert sich daran, Feuer gewesen zu sein.',
    icon: { glyph: 'wing', color: '#ff8a3c' }, tags: ['revive', 'fire', 'damage'],
    hooks: {
      onLethal(ctx) {
        if (ctx.state.used) return false;
        ctx.state.used = true;
        const { w, player: p } = ctx;
        p.hp = Math.max(1, Math.round(p.stats.maxHp * 0.6));
        if (w) {
          nova(ctx, p.x, p.y, 110, 60, 'fire', { status: burnStatus(w, 6, 4), knockback: 280, color: '#ffb347' });
          w.fx.text(p.x, p.y - 22, 'Zweite Glut!', '#ffb347');
        }
        return true;
      },
      dynamicMods(ctx) { return ctx.state.used ? [{ stat: 'damage', mul: 1.15 }] : null; },
    },
  },
  {
    id: 'mirror_shard', name: 'Spiegelscherbe', rarity: 'legendary',
    desc: '+1 Dash-Ladung. Während eines Dashs (und 0,3 s danach) wirfst du gegnerische Projektile mit doppeltem Schaden zurück.',
    flavor: 'Sie zeigt dem Dunkel sein eigenes Gesicht.',
    icon: { glyph: 'mirror', color: '#e8f4ff' }, tags: ['dash', 'defense'],
    mods: [{ stat: 'dashCharges', add: 1 }],
    hooks: {
      onDash(ctx) {
        const p = ctx.player, s = ctx.state;
        if (!p.flags) p.flags = {};
        p.flags.reflect = true;
        s.on = true;
        s.t = 0.45;
        if (ctx.w) ctx.w.fx.ring(p.x, p.y, 18, '#e8f4ff', 0.25);
      },
      onUpdate(ctx, dt) {
        const s = ctx.state;
        if (!s.on) return;
        const p = ctx.player;
        if (p.dashing) s.t = Math.max(s.t, 0.3);
        s.t -= dt;
        if (s.t <= 0) { s.on = false; if (p.flags) p.flags.reflect = false; }
      },
    },
  },
  {
    id: 'storm_crown', name: 'Sturmkrone', rarity: 'legendary',
    desc: '+10 % Schockchance. Treffer haben 25 % Chance auf einen Kettenblitz, der bis zu 4 Gegner trifft (je 60 % Schaden, schockt).',
    flavor: 'Wer sie trägt, hört den Donner denken.',
    icon: { glyph: 'crown', color: SHOCK }, tags: ['shock', 'proc'],
    mods: [{ stat: 'shockChance', add: 0.1 }],
    hooks: {
      onHit(ctx, { enemy, amount }) {
        if (!ctx.rng.chance(0.25) || !ready(ctx, 'cd', 0.06)) return;
        chainLightning(ctx.w, enemy, amount * 0.6 * ctx.player.stats.shockDamage, 4, 110);
      },
    },
  },
  {
    id: 'ember_swarm', name: 'Glutschwarm', rarity: 'legendary',
    desc: 'Drei Glutfunken umkreisen dich (8 Feuerschaden bei Berührung) und schießen alle 1,6 s zielsuchende Glut (10 Feuerschaden).',
    flavor: 'Die letzten Funken der Feuerstelle haben dich gewählt.',
    icon: { glyph: 'ember', color: '#ffb347' }, tags: ['orbital', 'fire', 'summon'],
    hooks: {
      onRoomEnter(ctx) { ctx.state.orbs = null; },
      onUpdate(ctx, dt) {
        orbitalTurrets(ctx, dt, {
          count: 3, radius: 30, speed: 2.6, r: 4, damage: 8, hitInterval: 0.4, knockback: 40, type: 'fire',
          sprite: 'proj_orb', color: '#ffb347', scale: 0.9, light: 26,
          interval: 1.6, shotDamage: 10, shotRange: 190,
        });
      },
    },
  },
  {
    id: 'eternity_glass', name: 'Sanduhr der Ewigkeit', rarity: 'legendary',
    desc: '−25 % Fertigkeits-Abklingzeit. Deine Fertigkeit verlangsamt alle Gegner 3 s lang und bremst gegnerische Projektile um 55 %.',
    flavor: 'Der Sand fällt nach oben, wenn du es willst.',
    icon: { glyph: 'hourglass', color: '#8fd8ff' }, tags: ['skill', 'defense'],
    mods: [{ stat: 'skillCooldown', mul: 0.75 }],
    hooks: {
      onSkill(ctx) {
        const w = ctx.w;
        if (!w) return;
        for (const e of w.enemies) if (!e.dead) w.applyStatus(e, 'slow', { duration: 3 });
        for (const pr of w.projectiles) {
          if (pr.team !== 'enemy' || pr.dead || pr.arc || pr.data.slowed) continue;
          pr.data.slowed = true;
          pr.vx *= 0.45; pr.vy *= 0.45;
          pr.life = pr.age + (pr.life - pr.age) / 0.45;
        }
        w.fx.ring(ctx.player.x, ctx.player.y, 160, '#8fd8ff', 0.5);
      },
    },
  },
  {
    id: 'abyss_eye', name: 'Auge des Abgrunds', rarity: 'legendary',
    desc: '+10 % Krit-Chance. Kritische Treffer zeichnen Gegner (+25 % erlittener Schaden). Gezeichnete Gegner setzen beim Tod 3 zielsuchende Schattensplitter frei (je 12 Schattenschaden).',
    flavor: 'Wenn du in den Abgrund blickst, zielt er für dich.',
    icon: { glyph: 'eye', color: SHADOW }, tags: ['crit', 'shadow', 'kill'],
    mods: [{ stat: 'critChance', add: 0.1 }],
    hooks: {
      onCrit(ctx, { enemy }) { if (!enemy.dead) ctx.w.applyStatus(enemy, 'mark', { duration: 4 }); },
      onKill(ctx, { enemy }) {
        if (!enemy.statuses || !enemy.statuses.mark) return;
        const w = ctx.w, off = ctx.rng.angle();
        for (let i = 0; i < 3; i++) {
          relicShot(w, enemy.x, enemy.y, off + (i * TAU) / 3, 12, 'shadow',
            { speed: 190, homing: 6, life: 1.6, sprite: 'proj_dagger', trail: 'shadow', color: SHADOW });
        }
      },
    },
  },
  {
    id: 'ash_crown', name: 'Krone der Asche', rarity: 'legendary',
    desc: 'Jeder Kill gibt +1,5 % Schaden und +0,8 % Lauftempo (max. 30 Stapel). Wirst du getroffen, zerfällt die Krone zu null Stapeln.',
    flavor: 'Herrschen heißt, nie berührt zu werden.',
    icon: { glyph: 'crown', color: '#c9c2b8' }, tags: ['damage', 'kill', 'speed'],
    hooks: {
      onKill(ctx) { ctx.state.n = Math.min(30, (ctx.state.n || 0) + 1); },
      onUpdate(ctx) {
        const s = ctx.state;
        const h = ctx.run.stats ? ctx.run.stats.hitsTaken : 0;
        if (s.h === h) return;
        if (s.h != null && s.n > 0) {
          if (ctx.w) ctx.w.fx.text(ctx.player.x, ctx.player.y - 20, 'Die Krone zerfällt', '#c9c2b8', { small: true });
          s.n = 0;
        }
        s.h = h;
      },
      dynamicMods(ctx) {
        const n = ctx.state.n || 0;
        return n ? [{ stat: 'damage', mul: 1 + 0.015 * n }, { stat: 'moveSpeed', mul: 1 + 0.008 * n }] : null;
      },
    },
  },

  // =========================================================================================
  // CURSES (12) — real downsides, some with a twisted upside
  // =========================================================================================
  {
    id: 'curse_frail', name: 'Fluch der Brüchigkeit', rarity: 'curse',
    desc: '−20 % max. Leben.', flavor: 'Du fühlst dich dünner. Als wäre ein Teil schon Asche.',
    icon: { glyph: 'skull', color: CURSE }, tags: ['curse', 'hp'],
    mods: [{ stat: 'maxHp', mul: 0.8 }],
  },
  {
    id: 'curse_glass', name: 'Gläserne Glut', rarity: 'curse',
    desc: '+25 % Schaden, aber du erleidest 35 % mehr Schaden.', flavor: 'Hell. Heiß. Zerbrechlich.',
    icon: { glyph: 'mirror', color: CURSE }, tags: ['curse', 'damage'],
    mods: [{ stat: 'damage', mul: 1.25 }],
    hooks: { onDamaged(ctx, hit) { hit.amount *= 1.35; } },
  },
  {
    id: 'curse_greed', name: 'Fluch der Gier', rarity: 'curse',
    desc: '−25 % Funken. Beim Betreten eines neuen Stockwerks verlierst du 15 % deiner Funken.', flavor: 'Etwas in der Tasche frisst mit.',
    icon: { glyph: 'coin', color: CURSE }, tags: ['curse', 'gold'],
    mods: [{ stat: 'sparkGain', mul: 0.75 }],
    hooks: {
      onFloorEnter(ctx) {
        const p = ctx.player;
        const loss = Math.floor((p.sparks || 0) * 0.15);
        if (loss > 0) p.sparks -= loss;
      },
    },
  },
  {
    id: 'curse_lead', name: 'Bleierne Füße', rarity: 'curse',
    desc: '−12 % Lauftempo, +30 % Dash-Abklingzeit.', flavor: 'Der Boden will dich behalten.',
    icon: { glyph: 'anchor', color: CURSE }, tags: ['curse', 'speed', 'dash'],
    mods: [{ stat: 'moveSpeed', mul: 0.88 }, { stat: 'dashCooldown', mul: 1.3 }],
  },
  {
    id: 'curse_dark', name: 'Erlöschendes Licht', rarity: 'curse',
    desc: '−40 % Lichtradius, −25 % Aufsammelradius.', flavor: 'Die Nacht rückt näher. Jeden Raum ein Stück.',
    icon: { glyph: 'candle', color: CURSE }, tags: ['curse', 'light'],
    mods: [{ stat: 'lightRadius', mul: 0.6 }, { stat: 'pickupRadius', mul: 0.75 }],
  },
  {
    id: 'curse_thirst', name: 'Blutdurst', rarity: 'curse',
    desc: '+5 % Lebensraub, aber im Kampf verlierst du 0,6 Leben pro Sekunde (nie unter 1).', flavor: 'Es trinkt mit dir. Und von dir.',
    icon: { glyph: 'tooth', color: CURSE }, tags: ['curse', 'heal'],
    mods: [{ stat: 'lifesteal', add: 0.05 }],
    hooks: {
      onUpdate(ctx, dt) {
        const p = ctx.player;
        if (!inCombat(ctx.w) || !p.alive || p.hp <= 1) return;
        p.hp = Math.max(1, p.hp - 0.6 * dt);
      },
    },
  },
  {
    id: 'curse_brittle', name: 'Sprödes Gebein', rarity: 'curse',
    desc: 'Jeder Treffer gegen dich verursacht 4 zusätzlichen Schaden.', flavor: 'Du hörst deine Knochen bei jedem Schritt.',
    icon: { glyph: 'bone', color: CURSE }, tags: ['curse', 'defense'],
    hooks: { onDamaged(ctx, hit) { if (!hit.dot && hit.amount > 0) hit.amount += 4; } },
  },
  {
    id: 'curse_haunt', name: 'Heimsuchung', rarity: 'curse',
    desc: '+20 % Erfahrung, aber in jedem Kampfraum erscheint ein zusätzlicher Gegner.', flavor: 'Sie folgen deinem Licht. Immer.',
    icon: { glyph: 'mask', color: CURSE }, tags: ['curse', 'xp'],
    mods: [{ stat: 'xpGain', mul: 1.2 }],
    hooks: {
      onRoomEnter(ctx) {
        const w = ctx.w;
        if (!inCombat(w) || !w.room || w.room.type === 'boss') return;
        const list = w.biome && w.biome.enemies;
        if (!list || !list.length) return;
        const en = ctx.rng.weighted(list, (e) => e.weight ?? 1);
        const pos = w.randomFloorPos({ minPlayerDist: 90 });
        w.spawnEnemy(en.id, pos.x, pos.y, { delay: 1.4 });
      },
    },
  },
  {
    id: 'curse_famine', name: 'Hungerfluch', rarity: 'curse',
    desc: '−40 % Heilung. +10 max. Leben.', flavor: 'Nichts sättigt mehr.',
    icon: { glyph: 'drop', color: CURSE }, tags: ['curse', 'heal'],
    mods: [{ stat: 'healPower', mul: 0.6 }, { stat: 'maxHp', add: 10 }],
  },
  {
    id: 'curse_dull', name: 'Stumpfe Klinge', rarity: 'curse',
    desc: 'Du landest keine kritischen Treffer mehr. +15 % Schaden.', flavor: 'Gleichmäßig. Verlässlich. Ohne Glanz.',
    icon: { glyph: 'sword', color: CURSE }, tags: ['curse', 'crit', 'damage'],
    mods: [{ stat: 'critChance', mul: 0 }, { stat: 'damage', mul: 1.15 }],
  },
  {
    id: 'curse_cold_gift', name: 'Erkaltete Gabe', rarity: 'curse',
    desc: '+40 % Fertigkeits-Abklingzeit, −10 % Fertigkeitsstärke.', flavor: 'Die Glut in deinen Händen zögert.',
    icon: { glyph: 'hand', color: CURSE }, tags: ['curse', 'skill'],
    mods: [{ stat: 'skillCooldown', mul: 1.4 }, { stat: 'skillPower', mul: 0.9 }],
  },
  {
    id: 'curse_restless', name: 'Rastlose Glut', rarity: 'curse',
    desc: '+12 % Feuerrate, aber stehst du im Kampf länger als 1,5 s still, verlierst du 4 Leben pro Sekunde.', flavor: 'Stillstand ist Verlöschen.',
    icon: { glyph: 'hourglass', color: CURSE }, tags: ['curse', 'fireRate'],
    mods: [{ stat: 'fireRate', mul: 1.12 }],
    hooks: {
      onUpdate(ctx, dt) {
        const { w, player: p, state: s } = ctx;
        if (!inCombat(w) || !p.alive) { s.still = 0; s.x = null; return; }
        if (s.x == null) { s.x = p.x; s.y = p.y; s.still = 0; return; }
        const dx = p.x - s.x, dy = p.y - s.y;
        s.x = p.x; s.y = p.y;
        if (dx * dx + dy * dy > 0.05) { s.still = 0; return; }
        s.still += dt;
        if (s.still < 1.5) return;
        s.tick = (s.tick || 0) - dt;
        if (s.tick > 0) return;
        s.tick = 0.5;
        w.damagePlayer(2, { type: 'fire', dot: true, unblockable: true });
      },
    },
  },
];

// --- projectile callbacks shared by every shot (no per-shot closures) -------------------------
function boomerangUpdate(w, p, dt) {
  const d = p.data;
  if (!d.back) {
    if (p.age < d.turnAt) return;
    d.back = true;
    p.hits.clear();
    p.ghost = true;
    p.homing = 0;
    p.bounce = 0;
  }
  const pl = w.player;
  const dx = pl.x - p.x, dy = pl.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 10) { p.life = p.age; return; }
  const sp = Math.max(120, Math.hypot(p.vx, p.vy));
  const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(dy, dx);
  let diff = want - cur;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  const step = 11 * dt;
  const a = Math.abs(diff) <= step ? want : cur + Math.sign(diff) * step;
  p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.angle = a;
}

function splitOnHit(w, p, target) {
  if (p.data.split) return;
  p.data.split = true;
  const a = Math.atan2(p.vy, p.vx);
  const sp = Math.max(140, Math.hypot(p.vx, p.vy) * 0.9);
  for (let i = -1; i <= 1; i += 2) {
    const q = w.spawnProjectile({
      x: target.x, y: target.y, angle: a + i * 0.55, speed: sp, r: Math.max(2, p.r * 0.7), damage: p.damage * 0.4,
      type: p.type, team: 'player', life: 0.4, knockback: 20, crit: p.crit, sprite: 'proj_shard', color: p.color, scale: 0.7,
      owner: w.player, source: 'relic', proc: false, data: { relic: true, split: true },
    });
    q.hits.set(target, w.time); // do not hit the enemy that split it
  }
}

function flareExpire(w, p) {
  const dmg = p.data.flare || 0;
  w.explode(p.x, p.y, 56, dmg, {
    team: 'player', type: 'fire', source: 'relic', proc: false, knockback: 130, color: '#ffd35a',
    status: burnStatus(w, 6, 3),
  });
  w.fx.light(p.x, p.y, 140, '#ffd35a', 0.35);
}

export const RELICS = {};
for (const def of LIST) {
  if (def.maxStacks == null) def.maxStacks = 1;
  RELICS[def.id] = def;
}

/** Ids by rarity (handy for shrines/tests). */
export const RELIC_IDS_BY_RARITY = Object.freeze(LIST.reduce((acc, d) => {
  (acc[d.rarity] || (acc[d.rarity] = [])).push(d.id);
  return acc;
}, {}));

// keep skillDamage reachable for content that imports it from here
export { skillDamage };
