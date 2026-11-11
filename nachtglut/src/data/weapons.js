// Weapon definitions (owner: weapons). See docs/ARCHITECTURE.md §6.3.
// Every weapon routes its damage through the combat helpers (playerVolley / playerShot / playerDamage) so that
// player stats, crits, status chances and relic hooks apply uniformly. DOM-free; no top-level side effects
// (this module takes part in an import cycle with game/registry.js).
import { bus } from '../core/events.js';
import { playerShot, playerVolley, playerDamage } from '../game/combat.js';
import { runHooks } from '../game/perks.js';
import { angleDiff, distToSegment } from '../core/math.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** weapon:fire (audio) + onFire relic hooks for attacks that do not go through playerVolley. */
function announce(w, ws, angle, shots = []) {
  bus.emit('weapon:fire', { id: ws.def.id, type: ws.def.type || 'phys' });
  runHooks(w.run, 'onFire', { ws, shots, angle });
}

/** A weapon-owned status scaled like core statuses (statusPower × damage, statusDuration). */
function wStatus(w, id, power, duration, extra) {
  const s = w.player.stats;
  return { id, power: (power ?? 1) * s.statusPower * s.damage, duration: duration * s.statusDuration, _scaled: true, ...extra };
}

/** Give spawned shots a weapon status unless a relic status was already rolled for them. */
function tagStatus(shots, st) {
  if (!st) return;
  for (const p of shots) if (p && !p.status) p.status = { ...st };
}

/** Apply a weapon status directly (melee / beam / zone hits). Honours `chance`. */
function applyWStatus(w, e, st) {
  if (!st || !e || e.dead) return;
  if (st.chance != null && st.chance < 1 && !w.rng.chance(st.chance)) return;
  w.applyStatus(e, st.id, st);
}

const alive = (e) => !!e && !e.dead && !e.hidden && !(e.spawnT > 0);

/** Enemy the player is aiming at: auto-aim target, else the enemy closest to the aim ray within `range`. */
function pickTarget(w, player, aim, range, cone = 0.6) {
  const t = aim && aim.target;
  if (alive(t) && Math.hypot(t.x - player.x, t.y - player.y) <= range + t.r) return t;
  let best = null, bs = Infinity;
  for (const e of w.enemies) {
    if (!alive(e) || e.untargetable) continue;
    const dx = e.x - player.x, dy = e.y - player.y, d = Math.hypot(dx, dy);
    if (d > range + e.r) continue;
    const da = Math.abs(angleDiff(aim.angle, Math.atan2(dy, dx)));
    if (da > cone + Math.atan2(e.r, Math.max(d, 1))) continue;
    if (!w.lineOfSight(player.x, player.y, e.x, e.y)) continue;
    const score = d * (1 + da * 2);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}

/** Area hit: explosion fx (+ destructible props), then per-enemy weapon damage via playerDamage. */
function blast(w, ws, x, y, radius, base, opts = {}) {
  const type = opts.type || ws.def.type || 'phys';
  w.explode(x, y, radius, 0, { team: 'player', type, color: opts.color || ws.def.color, silent: !!opts.silent });
  const kb = opts.knockback ? opts.knockback * w.player.stats.knockback : 0;
  let n = 0;
  for (const e of w.enemiesInRadius(x, y, radius)) {
    if (opts.exclude === e) continue;
    const dx = opts.inward ? x - e.x : e.x - x, dy = opts.inward ? y - e.y : e.y - y;
    playerDamage(w, ws, e, base, { type, proc: opts.proc ?? false, knockback: kb ? { x: dx, y: dy, force: kb } : undefined });
    if (opts.status) applyWStatus(w, e, opts.status);
    n++;
  }
  return n;
}

/** Player zone whose tick hits deal weapon damage through playerDamage (multipliers, crits, statuses). */
function weaponZone(w, ws, spec, base, opts = {}) {
  const type = spec.type || ws.def.type || 'phys';
  return w.spawnZone({
    team: 'player', delay: 0, damage: 0, color: ws.def.color, owner: w.player, persist: true, weaponId: ws.def.id,
    ...spec, type,
    onHit(w2, z, e) {
      if (e === w2.player) return;
      playerDamage(w2, ws, e, base, { type, proc: false });
      if (opts.status) applyWStatus(w2, e, opts.status);
    },
  });
}

/** Place a scripted projectile at (x, y) at the end of this step while keeping a velocity for its orientation. */
function pin(p, x, y, vx, vy, dt) {
  p.vx = vx; p.vy = vy;
  if (Math.abs(vx) + Math.abs(vy) > 1e-3) p.angle = Math.atan2(vy, vx);
  p.x = x - vx * dt; p.y = y - vy * dt;
}

/** Room change / re-entry detection for weapons that keep projectiles alive across frames. */
function sameRoom(w, d) {
  const ok = d.room === w.room && w.time >= (d.lastT ?? 0);
  d.room = w.room; d.lastT = w.time;
  return ok;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);

// ---------------------------------------------------------------------------------------------
// Weapon-specific behaviours
// ---------------------------------------------------------------------------------------------

// ember_bolt: sparks that fly from a hit toward nearby enemies
function emberSplit(w, ws, p, e) {
  const n = ws.stats.split | 0;
  if (!n) return;
  const used = new Set([e]);
  const dir = Math.atan2(p.vy, p.vx);
  for (let i = 0; i < n; i++) {
    const t = w.findNearestEnemy(e.x, e.y, 95, (o) => !used.has(o) && !p.hits.has(o));
    if (t) used.add(t);
    const a = t ? Math.atan2(t.y - e.y, t.x - e.x) : dir + w.rng.float(-1.1, 1.1);
    const sp = playerShot(w, ws, a, {
      x: e.x, y: e.y, damage: ws.stats.damage * 0.35, speed: 230, range: 95, r: 2, pierce: 0, bounce: 0, homing: 5,
      sprite: 'proj_orb', scale: 0.55, trail: 'ember', light: { r: 12, color: ws.def.color },
    });
    sp.hits.add(e);
  }
}

// frost_needle: bonus damage vs chilled / frozen targets
function needleBite(w, ws, p, e) {
  const bonus = ws.stats.shatter || 0;
  if (!bonus || e.dead || !e.statuses || !(e.statuses.chill || e.statuses.freeze)) return;
  w.damageEnemy(e, p.damage * bonus, { type: 'frost', crit: p.crit, proc: false, silent: true, source: 'weapon', weaponId: ws.def.id });
}

// shadow_daggers: bonus vs marked targets, crits mark
function daggerHit(w, ws, p, e) {
  const st = ws.stats;
  if (e.dead) return;
  if (e.statuses && e.statuses.mark && st.markBonus > 0) {
    w.damageEnemy(e, p.damage * st.markBonus, { type: 'shadow', crit: p.crit, proc: false, silent: true, source: 'weapon', weaponId: ws.def.id });
    if (Math.random() < 0.5) w.fx.burst('shadow', e.x, e.y, { count: 2 });
  }
  if (p.crit && !e.dead) w.applyStatus(e, 'mark', { duration: st.markTime * w.player.stats.statusDuration });
}

// flame_lance: burning line left behind
function lanceTrail(w, ws, p) {
  if (!ws.stats.trail) return;
  const d = p.data;
  const len = Math.hypot(p.x - d.sx, p.y - d.sy);
  if (len < 8) return;
  weaponZone(w, ws, {
    shape: 'line', x: d.sx, y: d.sy, x2: p.x, y2: p.y, width: 10 * w.player.stats.projSize,
    duration: 1.2, tick: 0.4, color: '#ff6a1f', type: 'fire',
  }, ws.stats.damage * 0.09, { status: wStatus(w, 'burn', 3, 2, { chance: 0.3 }) });
}

// magma_mortar
function mortarImpact(w, ws, x, y) {
  const st = ws.stats, ps = w.player.stats;
  const R = st.radius * ps.projSize;
  blast(w, ws, x, y, R, st.damage, { type: 'fire', knockback: st.knockback, proc: true, status: wStatus(w, 'burn', 3, 2, { chance: 0.4 }) });
  weaponZone(w, ws, { shape: 'circle', x, y, r: R * 0.72, duration: st.puddle, tick: 0.5, color: '#ff5a1f', type: 'fire' },
    st.puddleDamage, { status: wStatus(w, 'burn', 2, 1.5, { chance: 0.25 }) });
  w.fx.burst('ember', x, y, { count: 18, speed: 120 });
  const n = st.cluster | 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + w.rng.float(-0.4, 0.4), dist = w.rng.float(R * 0.8, R * 1.4);
    const c = w.clampToRoom(x + Math.cos(a) * dist, y + Math.sin(a) * dist, 6);
    w.spawnProjectile({
      x, y, team: 'player', owner: w.player, weaponId: ws.def.id, damage: 0, r: 3,
      arc: { tx: c.x, ty: c.y, time: 0.38, height: 26 }, sprite: 'proj_blob', color: '#ff7a2f', scale: 0.7, trail: 'ember',
      light: { r: 14, color: '#ff7a2f' },
      onExpire: (w2, q) => blast(w2, ws, q.x, q.y, R * 0.55, st.damage * 0.4, { type: 'fire', knockback: 60 }),
    });
  }
}

// sun_disc: boomerang
function discUpdate(w, p, dt) {
  const d = p.data, pl = w.player;
  if (d.phase === 0) {
    const k = Math.max(0, 1 - p.age / d.tOut);
    const sp = d.s0 * k;
    p.vx = Math.cos(p.angle) * sp; p.vy = Math.sin(p.angle) * sp;
    if (k <= 0.06) { d.phase = d.hover > 0 ? 1 : 2; d.t = 0; }
  } else if (d.phase === 1) {
    p.vx = 0; p.vy = 0;
    p.hitInterval = d.hi * 0.45;
    d.t += dt;
    if (Math.random() < 0.35) w.fx.burst('light', p.x, p.y, { count: 1, color: '#fff3b0' });
    if (d.t >= d.hover) { d.phase = 2; p.hitInterval = d.hi; }
  } else {
    p.ghost = true;
    const dx = pl.x - p.x, dy = pl.y - p.y, dist = Math.hypot(dx, dy);
    d.rs = Math.min(d.s0 * 1.3, (d.rs || 30) + d.s0 * 3.2 * dt);
    if (dist <= pl.r + p.r + 3 || !pl.alive) { p.dead = true; return; }
    const step = Math.min(d.rs, dist / dt);
    p.vx = (dx / dist) * step; p.vy = (dy / dist) * step;
  }
}
function discWall(w, p) {
  if (p.data.phase === 0) { p.data.phase = 2; p.data.t = 0; }
  return true; // never destroyed by walls: it flies home
}

// spore_launcher
function sporeBurst(w, ws, x, y, scale) {
  const st = ws.stats, ps = w.player.stats;
  const R = st.cloud * ps.projSize * scale;
  w.fx.burst('poison', x, y, { count: Math.round(12 * scale), speed: 70 });
  weaponZone(w, ws, { shape: 'circle', x, y, r: R, duration: st.cloudTime * (scale < 1 ? 0.7 : 1), tick: 0.5, color: '#9be35a', type: 'poison' },
    st.cloudDamage * scale, { status: wStatus(w, 'poison', st.poison, 3, { stacks: st.poisonStacks }) });
  if (scale >= 1) {
    const n = st.seeds | 0;
    for (let i = 0; i < n; i++) {
      const a = w.rng.angle();
      playerShot(w, ws, a, {
        x, y, damage: st.damage * 0.4, speed: 95, range: 55, r: 3, pierce: 0, homing: 0, bounce: 0,
        sprite: 'proj_spore', scale: 0.65, trail: null, spin: 4,
        onExpire: (w2, q) => sporeBurst(w2, ws, q.x, q.y, 0.6),
      });
    }
  }
}

// rift_orb
function riftUpdate(w, p, dt) {
  const d = p.data, st = d.ws.stats;
  if (Math.abs(p.vx) + Math.abs(p.vy) > 0.5) p.angle = Math.atan2(p.vy, p.vx);
  const k = Math.max(0.18, 1 - p.age / Math.max(0.1, p.life) * 0.9);
  // the rift latches on: it nearly stops while it is grinding an enemy
  const grinding = !!w.findNearestEnemy(p.x, p.y, p.r + 10);
  const sp = d.stuck ? 0 : d.s0 * k * (grinding ? 0.25 : 1);
  p.vx = Math.cos(p.angle) * sp; p.vy = Math.sin(p.angle) * sp;
  const R = st.pullRadius * w.player.stats.projSize;
  for (const e of w.enemiesInRadius(p.x, p.y, R)) {
    if (e.boss || !(e.mass > 0)) continue;
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy);
    if (dist < 2) continue;
    w.knockback(e, dx, dy, st.pull * dt * Math.min(1, dist / 14));
  }
  if (Math.random() < 0.3) {
    const a = Math.random() * TAU;
    w.fx.burst('shadow', p.x + Math.cos(a) * R * 0.6, p.y + Math.sin(a) * R * 0.6, { count: 1, angle: a + Math.PI, spread: 0.2, speed: 40 });
  }
}
function riftImplode(w, p) {
  const ws = p.data.ws, st = ws.stats;
  const R = st.implodeRadius * w.player.stats.projSize;
  blast(w, ws, p.x, p.y, R, st.implode, { type: 'shadow', inward: true, knockback: 150, color: '#9a6bff',
    status: st.stun ? { id: 'stun', duration: st.stun * w.player.stats.statusDuration } : null });
  w.fx.ring(p.x, p.y, R, '#9a6bff', 0.25);
}

// iron_hammer: swing visual (also smashes barrels / crystals)
function swingVisual(w, ws, player, a, R, arc) {
  const dur = 0.13;
  w.spawnProjectile({
    x: player.x, y: player.y, vx: 0, vy: 0, r: 6, damage: 0, team: 'player', owner: player, weaponId: ws.def.id,
    ghost: true, pierce: Infinity, life: dur, sprite: 'proj_hammer', color: ws.def.color, scale: 1.3, knockback: 0,
    light: { r: 18, color: '#e8e2d4' },
    data: { a0: a - arc / 2, arc, R: R * 0.78, dur },
    onUpdate(w2, p, dt) {
      const d = p.data, t = Math.min(1, (p.age + dt) / d.dur);
      const ang = d.a0 + d.arc * easeOut(t);
      const v = (d.arc / d.dur) * d.R;
      pin(p, player.x + Math.cos(ang) * d.R, player.y + Math.sin(ang) * d.R, Math.cos(ang + Math.PI / 2) * v, Math.sin(ang + Math.PI / 2) * v, dt);
    },
  });
}

// glaive_orbit
function spawnBlade(w, ws, player) {
  return w.spawnProjectile({
    x: player.x, y: player.y, vx: 0, vy: 0, r: ws.stats.size * player.stats.projSize, damage: 0,
    team: 'player', owner: player, weaponId: ws.def.id, ghost: true, pierce: Infinity, life: 1e9,
    hitInterval: ws.stats.hitInterval * 0.5, knockback: 0, sprite: 'proj_blade', color: ws.def.color, scale: player.stats.projSize, spin: 0,
    light: { r: 16, color: '#d8e0ea' },
    onHit(w2, p, e) {
      // per-enemy interval shared by all blades: more blades cover more enemies, not more hits on one
      const d = ws.data, last = d.hitT && d.hitT.get(e);
      if (!d.hitT) d.hitT = new WeakMap();
      if (last != null && w2.time >= last && w2.time - last < ws.stats.hitInterval) return;
      d.hitT.set(e, w2.time);
      const ps = w2.player.stats;
      playerDamage(w2, ws, e, ws.stats.damage, { knockback: { x: e.x - w2.player.x, y: e.y - w2.player.y, force: ws.stats.knockback * ps.knockback } });
      w2.fx.burst('spark', e.x, e.y, { count: 3, color: '#e8eef5' });
    },
  });
}
function clearBlades(ws) {
  const d = ws.data;
  if (d.blades) for (const b of d.blades) b.dead = true;
  d.blades = [];
}

// star_bow
function starBurst(w, ws, p, x, y, exclude) {
  const st = ws.stats, n = st.stars | 0;
  if (!n || p.data.burst) return;
  p.data.burst = true;
  const base = w.rng.angle();
  w.fx.burst('light', x, y, { count: 16, color: '#fff3b0', speed: 140 });
  w.fx.light(x, y, 70, '#fff3b0', 0.25);
  for (let i = 0; i < n; i++) {
    const s = playerShot(w, ws, base + (i / n) * TAU, {
      x, y, damage: st.damage * st.starDamage, speed: 230, range: 90, r: 3, pierce: 0, bounce: 0,
      homing: st.starHoming || 0, sprite: 'proj_star', scale: 0.8, spin: 10, trail: null, light: { r: 12, color: '#fff3b0' },
    });
    if (exclude) s.hits.add(exclude);
  }
}
function bowRelease(w, player, ws, aim) {
  const d = ws.data, st = ws.stats, ps = player.stats;
  const c = Math.max(0, Math.min(1, d.charge || 0));
  d.charge = 0; d.charging = false; d.full = false;
  d.recover = st.recover;
  ws.cd = st.recover;
  player.fireT = 0.15;
  const full = c >= 0.999;
  const opts = {
    damageMul: 0.15 + 0.85 * c * c, speedMul: 0.65 + 0.55 * c, scale: (0.8 + 0.5 * c) * ps.projSize,
    pierce: (full ? st.pierce : 0) + ps.pierce, trail: full ? 'light' : null,
    knockback: st.knockback * (0.3 + 0.7 * c) * ps.knockback,
    light: { r: 14 + 18 * c, color: ws.def.color },
  };
  if (full) {
    opts.onHit = (w2, p, e) => starBurst(w2, ws, p, e.x, e.y, e);
    opts.onExpire = (w2, p) => starBurst(w2, ws, p, p.x, p.y, null);
  }
  playerVolley(w, ws, aim.angle, opts);
  if (full) w.fx.flash('#fff3b0', 0.05);
}

// ice_staff
function shatter(w, ws, p) {
  const st = ws.stats, n = Math.max(1, Math.round(st.splinters));
  const hit = p.data.lastHit || null;
  let dir = Math.atan2(p.vy, p.vx);
  if (!hit && p.age < p.life - 0.02) dir += Math.PI; // shattered on a wall: splinters fly back
  const fan = Math.min(2.2, 0.55 * (n - 1) + 0.6);
  const x = p.x - Math.cos(dir) * 2, y = p.y - Math.sin(dir) * 2;
  w.fx.burst('frost', p.x, p.y, { count: 10, speed: 90 });
  const chill = st.splinterChill ? wStatus(w, 'chill', 1, 2, { chance: 0.5 }) : null;
  for (let i = 0; i < n; i++) {
    const a = dir + (n > 1 ? (i / (n - 1) - 0.5) * fan : 0) + w.rng.float(-0.08, 0.08);
    const s = playerShot(w, ws, a, {
      x, y, damage: st.damage * st.splinterDamage, speed: 270, range: 85, r: 2, pierce: st.splinterPierce | 0, bounce: 0, homing: 0,
      sprite: 'proj_needle', scale: 0.8, trail: null, light: { r: 10, color: '#bfe9ff' },
    });
    if (hit) s.hits.add(hit);
    if (chill) tagStatus([s], chill);
  }
}

// ---------------------------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------------------------
export const WEAPONS = {
  // -------------------------------------------------------------------------------------------
  ember_bolt: {
    id: 'ember_bolt', name: 'Glutbolzen', rarity: 'common', type: 'fire', tags: ['fire', 'projectile'],
    desc: 'Ein verlässlicher Bolzen aus gebündelter Glut. Setzt Gegner gelegentlich in Brand.',
    icon: { glyph: 'flame', color: '#ff8a3c' }, projSprite: 'proj_bolt', color: '#ffb347',
    base: { damage: 7.2, cooldown: 0.34, projSpeed: 280, range: 230, size: 3, count: 1, spread: 0.16, pierce: 0, knockback: 50, burnChance: 0.15, burnPower: 4, split: 0 },
    levels: [
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: '+18 % Feuerrate, Bolzen durchschlagen 1 Gegner', mods: { cooldown: 0.85, '+pierce': 1 } },
      { desc: 'Funkenflug: Treffer versprühen 2 Funken auf nahe Gegner, +10 % Schaden', mods: { '+split': 2, damage: 1.1 } },
      { desc: 'Zwillingsglut: +1 Bolzen (je −30 % Schaden), +15 % Brandchance', mods: { '+count': 1, damage: 0.7, '+burnChance': 0.15 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats;
      const shots = playerVolley(w, ws, aim.angle, {
        trail: 'ember', light: { r: 24, color: '#ffb347' },
        onHit: st.split ? (w2, p, e) => emberSplit(w2, ws, p, e) : undefined,
      });
      tagStatus(shots, wStatus(w, 'burn', st.burnPower, 2.5, { chance: st.burnChance }));
    },
  },

  // -------------------------------------------------------------------------------------------
  scatter_coal: {
    id: 'scatter_coal', name: 'Streukohle', rarity: 'common', type: 'fire', tags: ['fire', 'projectile', 'shotgun'],
    desc: 'Ein Fächer glühender Kohlesplitter. Verheerend aus nächster Nähe, harter Rückstoß.',
    icon: { glyph: 'ember', color: '#ff6a1f' }, projSprite: 'proj_shard', color: '#ff7a2f',
    base: { damage: 4.8, cooldown: 0.72, projSpeed: 300, range: 125, size: 2.5, count: 5, spread: 0.5, jitter: 0.05, pierce: 0, knockback: 70, burnChance: 0 },
    levels: [
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: '+1 Splitter, Splitter fliegen 20 % weiter', mods: { '+count': 1, range: 1.2 } },
      { desc: 'Glühende Splitter: durchschlagen 1 Gegner, 25 % Brandchance, +10 % Schaden', mods: { '+pierce': 1, '+burnChance': 0.25, damage: 1.1 } },
      { desc: '+2 Splitter, +20 % Feuerrate, +10 % Schaden', mods: { '+count': 2, cooldown: 0.83, damage: 1.1 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats;
      const shots = playerVolley(w, ws, aim.angle, { accel: -380, spin: 8, trail: null, light: { r: 14, color: '#ff7a2f' } });
      for (const p of shots) {
        const k = w.rng.float(0.86, 1.1);
        p.vx *= k; p.vy *= k;
      }
      if (st.burnChance) tagStatus(shots, wStatus(w, 'burn', 3, 2, { chance: st.burnChance }));
      const a = aim.angle;
      w.fx.burst('ember', player.x + Math.cos(a) * 9, player.y + Math.sin(a) * 9, { count: 6, angle: a, spread: 0.6, speed: 120 });
      w.fx.shake(0.8, 0.06);
    },
  },

  // -------------------------------------------------------------------------------------------
  flame_lance: {
    id: 'flame_lance', name: 'Flammenlanze', rarity: 'uncommon', type: 'fire', tags: ['fire', 'projectile', 'pierce'],
    desc: 'Eine blitzschnelle Lanze aus weißer Glut, die mehrere Gegner durchbohrt.',
    icon: { glyph: 'sword', color: '#ff9a3c' }, projSprite: 'proj_beam', color: '#ff9a3c',
    base: { damage: 15.5, cooldown: 0.62, projSpeed: 520, range: 240, size: 3.5, count: 1, spread: 0.6, pierce: 2, knockback: 45, trail: 0 },
    levels: [
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: 'Glutspur: Die Lanze hinterlässt eine brennende Linie', mods: { '+trail': 1 } },
      { desc: 'Durchschlägt alle Gegner, +15 % Feuerrate', mods: { '+pierce': 99, cooldown: 0.87 } },
      { desc: 'Dreizack: +2 Lanzen im weiten Fächer, +10 % Schaden', mods: { '+count': 2, damage: 1.1 } },
    ],
    fire(w, player, ws, aim) {
      const shots = playerVolley(w, ws, aim.angle, { trail: 'ember', scale: 1.35 * player.stats.projSize, light: { r: 30, color: '#ff9a3c' } });
      // only the centre lance leaves the burning line
      const mid = shots[(shots.length - 1) >> 1];
      if (mid && ws.stats.trail) {
        mid.data.sx = mid.x; mid.data.sy = mid.y;
        mid.onExpire = (w2, p) => lanceTrail(w2, ws, p);
      }
      w.fx.burst('ember', player.x + Math.cos(aim.angle) * 8, player.y + Math.sin(aim.angle) * 8, { count: 5, angle: aim.angle, spread: 0.3, speed: 160 });
    },
  },

  // -------------------------------------------------------------------------------------------
  spark_chain: {
    id: 'spark_chain', name: 'Funkenkette', rarity: 'uncommon', type: 'shock', tags: ['shock', 'chain'],
    desc: 'Ein Blitz, der von Gegner zu Gegner springt und sie unter Schock setzt.',
    icon: { glyph: 'bolt', color: '#ffe75a' }, projSprite: 'proj_orb', color: '#ffe75a',
    base: { damage: 10.5, cooldown: 0.5, range: 165, jumps: 3, jumpRange: 72, falloff: 0.8, shockChance: 0.25, knockback: 25 },
    levels: [
      { desc: '+1 Sprung, +15 % Schaden', mods: { '+jumps': 1, damage: 1.15 } },
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: 'Überladung: Blitze schocken immer, +40 % Sprungweite, +15 % Feuerrate', mods: { '+shockChance': 1, jumpRange: 1.4, cooldown: 0.87 } },
      { desc: 'Gewitter: +2 Sprünge ohne Schadensverlust, +15 % Schaden', mods: { '+jumps': 2, '+falloff': 0.2, damage: 1.15 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats, ps = player.stats, color = ws.def.color;
      const range = st.range * ps.range;
      const first = pickTarget(w, player, aim, range, 0.55);
      if (!first) {
        // fizzle: short visual arc, quick retry
        const len = 30 + w.rng.float(0, 20);
        w.fx.lightning(player.x, player.y, player.x + Math.cos(aim.angle) * len, player.y + Math.sin(aim.angle) * len, color);
        return 0.25;
      }
      const hit = new Set();
      const jumps = Math.max(0, Math.round(st.jumps + ps.multishot));
      const jr = st.jumpRange * ps.range;
      let sx = player.x, sy = player.y, cur = first, mul = 1;
      for (let i = 0; i <= jumps && cur; i++) {
        w.fx.lightning(sx, sy, cur.x, cur.y, color);
        hit.add(cur);
        if (st.shockChance > 0 && w.rng.chance(st.shockChance)) w.applyStatus(cur, 'shock', { duration: 3 * ps.statusDuration });
        playerDamage(w, ws, cur, st.damage * mul, { type: 'shock', knockback: { x: cur.x - sx, y: cur.y - sy, force: st.knockback * ps.knockback } });
        w.fx.burst('shock', cur.x, cur.y, { count: 4 });
        sx = cur.x; sy = cur.y;
        mul *= Math.min(1, st.falloff);
        const fx = sx, fy = sy;
        cur = w.findNearestEnemy(fx, fy, jr, (o) => !hit.has(o) && w.lineOfSight(fx, fy, o.x, o.y));
      }
      w.fx.light(player.x, player.y, 50, color, 0.12);
      announce(w, ws, aim.angle);
    },
  },

  // -------------------------------------------------------------------------------------------
  magma_mortar: {
    id: 'magma_mortar', name: 'Magmamörser', rarity: 'rare', type: 'fire', tags: ['fire', 'explosive', 'projectile', 'area'],
    desc: 'Schleudert einen Magmaklumpen auf den Zielpunkt. Er explodiert und hinterlässt eine brennende Lache.',
    icon: { glyph: 'bomb', color: '#ff5a1f' }, projSprite: 'proj_blob', color: '#ff5a1f',
    base: { damage: 15, cooldown: 1.1, range: 190, radius: 34, flight: 0.6, puddle: 1.6, puddleDamage: 2.2, cluster: 0, knockback: 120 },
    levels: [
      { desc: '+25 % Explosionsradius, +10 % Schaden', mods: { radius: 1.25, damage: 1.1, puddleDamage: 1.1 } },
      { desc: '+25 % Schaden', mods: { damage: 1.25, puddleDamage: 1.25 } },
      { desc: 'Streumagma: Die Explosion schleudert 3 Brocken umher', mods: { '+cluster': 3 } },
      { desc: '−20 % Abklingzeit, Lachen brennen 50 % länger', mods: { cooldown: 0.8, puddle: 1.5 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats, ps = player.stats;
      const maxR = st.range * ps.range;
      let tx = aim.x, ty = aim.y;
      if (alive(aim.target)) { tx = aim.target.x; ty = aim.target.y; }
      let dx = tx - player.x, dy = ty - player.y, d = Math.hypot(dx, dy);
      if (d < 1) { dx = Math.cos(aim.angle); dy = Math.sin(aim.angle); d = 1; tx = player.x + dx; ty = player.y + dy; }
      if (d > maxR) { tx = player.x + (dx / d) * maxR; ty = player.y + (dy / d) * maxR; }
      else if (d < 28) { tx = player.x + (dx / d) * 28; ty = player.y + (dy / d) * 28; }
      const n = Math.max(1, Math.round(1 + ps.multishot));
      const time = st.flight / Math.sqrt(ps.projSpeed);
      const shots = [];
      for (let i = 0; i < n; i++) {
        let px = tx, py = ty;
        if (i > 0) { const a = w.rng.angle(), r = w.rng.float(14, 30); px += Math.cos(a) * r; py += Math.sin(a) * r; }
        const c = w.clampToRoom(px, py, 6);
        shots.push(playerShot(w, ws, Math.atan2(dy, dx), {
          arc: { tx: c.x, ty: c.y, time, height: 46 }, r: 4, pierce: 0, damage: 0, status: null,
          sprite: 'proj_blob', scale: 1.3, trail: 'ember', spin: 6, light: { r: 26, color: '#ff5a1f' },
          onExpire: (w2, p) => mortarImpact(w2, ws, p.x, p.y),
        }));
      }
      announce(w, ws, aim.angle, shots);
    },
  },

  // -------------------------------------------------------------------------------------------
  frost_needle: {
    id: 'frost_needle', name: 'Frostnadeln', rarity: 'common', type: 'frost', tags: ['frost', 'projectile', 'rapid'],
    desc: 'Ein Strom pfeilschneller Eisnadeln, die Gegner unterkühlen, bis sie erstarren.',
    icon: { glyph: 'thorn', color: '#8fd8ff' }, projSprite: 'proj_needle', color: '#8fd8ff',
    base: { damage: 3.2, cooldown: 0.14, projSpeed: 430, range: 240, size: 2, count: 1, spread: 0.1, jitter: 0.05, pierce: 0, knockback: 18, chillChance: 0.3, shatter: 0 },
    levels: [
      { desc: '+20 % Feuerrate', mods: { cooldown: 0.83 } },
      { desc: 'Nadeln durchschlagen 1 Gegner, +15 % Schaden', mods: { '+pierce': 1, damage: 1.15 } },
      { desc: 'Kältebiss: +35 % Schaden gegen unterkühlte und gefrorene Gegner', mods: { '+shatter': 0.35 } },
      { desc: '+1 Nadel pro Salve (je −35 % Schaden), +15 % Kältechance', mods: { '+count': 1, damage: 0.65, '+chillChance': 0.15 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats;
      const shots = playerVolley(w, ws, aim.angle, {
        light: { r: 12, color: '#8fd8ff' },
        onHit: st.shatter ? (w2, p, e) => needleBite(w2, ws, p, e) : undefined,
      });
      tagStatus(shots, wStatus(w, 'chill', 1, 2.5, { chance: st.chillChance, stacks: 1 }));
    },
  },

  // -------------------------------------------------------------------------------------------
  shadow_daggers: {
    id: 'shadow_daggers', name: 'Schattendolche', rarity: 'uncommon', type: 'shadow', tags: ['shadow', 'projectile', 'crit', 'rapid'],
    desc: 'Rasch geworfene Dolche mit hoher Krit-Chance. Krits zeichnen Gegner, gezeichnete erleiden Bonusschaden.',
    icon: { glyph: 'dagger', color: '#b07cff' }, projSprite: 'proj_dagger', color: '#b07cff',
    base: { damage: 3, cooldown: 0.2, projSpeed: 340, range: 175, size: 2.5, count: 1, spread: 0.2, jitter: 0.04, pierce: 0, knockback: 25, critBonus: 0.2, markBonus: 0.15, markTime: 2.5 },
    levels: [
      { desc: '+20 % Schaden', mods: { damage: 1.2 } },
      { desc: '+10 % Krit-Chance, Dolche fliegen 20 % schneller', mods: { '+critBonus': 0.1, projSpeed: 1.2 } },
      { desc: 'Hinrichtung: +25 % Bonus gegen Gezeichnete, Dolche durchschlagen 1 Gegner', mods: { '+markBonus': 0.25, '+pierce': 1 } },
      { desc: 'Klingenfächer: +2 Dolche (je −35 % Schaden)', mods: { '+count': 2, damage: 0.65 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats, ps = player.stats;
      const shots = playerVolley(w, ws, aim.angle, {
        light: { r: 12, color: '#b07cff' },
        onHit: (w2, p, e) => daggerHit(w2, ws, p, e),
      });
      // weapon crit bonus: upgrade non-crits so that the total chance is critChance + critBonus
      const c = ps.critChance, extra = c >= 1 ? 0 : st.critBonus / (1 - c);
      for (const p of shots) {
        if (!p.crit && extra > 0 && w.rng.chance(extra)) { p.crit = true; p.damage *= ps.critMult; p.scale *= 1.15; }
      }
    },
  },

  // -------------------------------------------------------------------------------------------
  sun_disc: {
    id: 'sun_disc', name: 'Sonnenscheibe', rarity: 'rare', type: 'light', tags: ['light', 'projectile', 'boomerang', 'pierce'],
    desc: 'Eine glühende Scheibe, die durch alle Gegner schneidet und zu dir zurückkehrt – auch auf dem Rückweg trifft sie.',
    icon: { glyph: 'sun', color: '#ffe08a' }, projSprite: 'proj_disc', color: '#ffe08a',
    base: { damage: 15, cooldown: 0.25, projSpeed: 340, range: 150, size: 5, count: 1, spread: 0.36, knockback: 70, hitInterval: 0.3, burn: 0, hover: 0 },
    levels: [
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: 'Zwillingsscheibe: +1 Scheibe gleichzeitig', mods: { '+count': 1 } },
      { desc: 'Sonnenglut: Scheiben sind 30 % größer und setzen in Brand', mods: { size: 1.3, '+burn': 1 } },
      { desc: 'Zenit: Die Scheibe verharrt am Wendepunkt und trifft dort doppelt so oft, +15 % Schaden', mods: { '+hover': 0.6, damage: 1.15 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats, ps = player.stats, d = ws.data;
      const max = Math.max(1, Math.round(st.count + ps.multishot));
      if (!sameRoom(w, d) || !d.discs) d.discs = [];
      d.discs = d.discs.filter((p) => !p.dead);
      if (d.discs.length >= max) return 0.05;
      d.n = (d.n || 0) + 1;
      const a = aim.angle + (max > 1 ? (d.n % 2 ? -0.5 : 0.5) * st.spread : 0);
      const s0 = st.projSpeed * ps.projSpeed * Math.sqrt(ps.fireRate);
      const R = st.range * ps.range;
      const p = playerShot(w, ws, a, {
        pierce: Infinity, hitInterval: st.hitInterval, life: 8, spin: 16, light: { r: 30, color: ws.def.color },
        onUpdate: discUpdate, onWall: discWall,
        data: { phase: 0, s0, tOut: (2 * R) / s0, hover: st.hover || 0, hi: st.hitInterval },
      });
      if (st.burn) tagStatus([p], wStatus(w, 'burn', 4, 2, { chance: 0.5 }));
      d.discs.push(p);
      announce(w, ws, a, [p]);
    },
    onUnequip(w, player, ws) { if (ws.data.discs) for (const p of ws.data.discs) p.data.phase = 2; },
  },

  // -------------------------------------------------------------------------------------------
  spore_launcher: {
    id: 'spore_launcher', name: 'Sporenwerfer', rarity: 'uncommon', type: 'poison', tags: ['poison', 'projectile', 'area'],
    desc: 'Träge, zielsuchende Sporen platzen zu Giftwolken, deren Gift sich aufstapelt.',
    icon: { glyph: 'mushroom', color: '#9be35a' }, projSprite: 'proj_spore', color: '#9be35a',
    base: { damage: 5, cooldown: 0.85, projSpeed: 120, range: 185, size: 4, count: 1, spread: 0.3, pierce: 0, knockback: 20, homing: 1.2, cloud: 26, cloudTime: 2.2, cloudDamage: 1, poison: 1, poisonStacks: 1, seeds: 0 },
    levels: [
      { desc: '+30 % Wolkengröße, +10 % Schaden', mods: { cloud: 1.3, damage: 1.1, cloudDamage: 1.1, poison: 1.1 } },
      { desc: '+25 % Schaden und Giftstärke', mods: { damage: 1.25, cloudDamage: 1.25, poison: 1.25 } },
      { desc: 'Sporenteilung: Platzende Sporen streuen 2 kleine Sporen, +10 % Schaden', mods: { '+seeds': 2, damage: 1.1, cloudDamage: 1.1, poison: 1.1 } },
      { desc: 'Fäulnis: Gift stapelt doppelt so schnell und wirkt 20 % stärker, Wolken halten 40 % länger', mods: { '+poisonStacks': 1, cloudTime: 1.4, poison: 1.2 } },
    ],
    fire(w, player, ws, aim) {
      playerVolley(w, ws, aim.angle, {
        trail: 'poison', spin: 3, light: { r: 18, color: '#9be35a' },
        onExpire: (w2, p) => sporeBurst(w2, ws, p.x, p.y, 1),
      });
    },
  },

  // -------------------------------------------------------------------------------------------
  rift_orb: {
    id: 'rift_orb', name: 'Rissorb', rarity: 'rare', type: 'shadow', tags: ['shadow', 'projectile', 'area', 'control'],
    desc: 'Ein langsamer Riss in der Wirklichkeit. Er saugt Gegner an, zermahlt sie und fällt in sich zusammen.',
    icon: { glyph: 'spiral', color: '#9a6bff' }, projSprite: 'proj_orb', color: '#9a6bff',
    base: { damage: 4, cooldown: 1.4, projSpeed: 85, range: 175, size: 7, count: 1, spread: 0.15, pierce: 0, knockback: 0, hitInterval: 0.25, pull: 260, pullRadius: 58, implode: 12, implodeRadius: 44, stun: 0 },
    levels: [
      { desc: '+25 % Sogradius', mods: { pullRadius: 1.25 } },
      { desc: '+25 % Schaden', mods: { damage: 1.25, implode: 1.25 } },
      { desc: 'Kollaps: Die Implosion ist 75 % stärker und betäubt kurz', mods: { implode: 1.75, '+stun': 0.6 } },
      { desc: 'Doppelriss: +1 Orb (je −30 % Schaden)', mods: { '+count': 1, damage: 0.7, implode: 0.7 } },
    ],
    fire(w, player, ws, aim) {
      const ps = player.stats;
      playerVolley(w, ws, aim.angle, {
        pierce: Infinity, hitInterval: ws.stats.hitInterval, knockback: 0, scale: 2 * ps.projSize, spin: 5,
        light: { r: 34, color: '#9a6bff' },
        onUpdate: riftUpdate, onWall: (w2, p) => { p.data.stuck = true; return true; }, onExpire: riftImplode,
        data: { ws, s0: ws.stats.projSpeed * ps.projSpeed },
      });
    },
  },

  // -------------------------------------------------------------------------------------------
  iron_hammer: {
    id: 'iron_hammer', name: 'Eisenhammer', rarity: 'common', type: 'phys', tags: ['phys', 'melee', 'knockback'],
    desc: 'Ein schwerer Schwung im Halbkreis vor dir. Schleudert Gegner weit zurück.',
    icon: { glyph: 'hammer', color: '#c9d1d9' }, projSprite: 'proj_hammer', color: '#c9d1d9',
    base: { damage: 21, cooldown: 0.85, range: 40, arc: 2.1, knockback: 260, wave: 0, stun: 0, quake: 0 },
    levels: [
      { desc: '+20 % Schaden', mods: { damage: 1.2 } },
      { desc: 'Schockwelle: Jeder Schlag sendet eine Bodenwelle nach vorn', mods: { '+wave': 1 } },
      { desc: '+25 % Reichweite und Rückstoß, Treffer betäuben kurz', mods: { range: 1.25, knockback: 1.25, '+stun': 0.35 } },
      { desc: 'Erdbeben: Jeder dritte Schlag erschüttert den Boden um dich', mods: { '+quake': 1 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats, ps = player.stats, d = ws.data;
      const R = st.range * ps.range, arc = st.arc, a = aim.angle;
      let hits = 0;
      for (const e of w.enemies.slice()) {
        if (!alive(e)) continue;
        const dx = e.x - player.x, dy = e.y - player.y, dist = Math.hypot(dx, dy);
        if (dist - e.r > R) continue;
        if (dist > e.r + 3 && Math.abs(angleDiff(a, Math.atan2(dy, dx))) > arc / 2 + Math.asin(Math.min(1, e.r / dist))) continue;
        playerDamage(w, ws, e, st.damage, { knockback: { x: dx, y: dy, force: st.knockback * ps.knockback } });
        if (st.stun && !e.dead) w.applyStatus(e, 'stun', { duration: st.stun * ps.statusDuration });
        hits++;
      }
      swingVisual(w, ws, player, a, R, arc);
      const tipX = player.x + Math.cos(a) * R * 0.8, tipY = player.y + Math.sin(a) * R * 0.8;
      w.fx.burst('dust', tipX, tipY, { count: 5, angle: a, spread: 1, speed: 60 });
      if (hits) { w.fx.shake(1.6, 0.08); w.fx.hitstop(0.03); }
      if (st.wave) {
        playerShot(w, ws, a, {
          damage: st.damage * 0.5, speed: 240, range: 120, r: 7, pierce: Infinity, bounce: 0, knockback: 120 * ps.knockback,
          sprite: 'proj_wave', scale: 1.4 * ps.projSize, trail: 'dust', light: null, status: null,
        });
      }
      d.swings = (d.swings || 0) + 1;
      if (st.quake && d.swings % 3 === 0) {
        const QR = 62 * ps.range;
        blast(w, ws, player.x, player.y, QR, st.damage * 0.9, { type: 'phys', knockback: 200, color: '#c9b79a',
          status: { id: 'stun', duration: 0.45 * ps.statusDuration } });
        w.fx.shake(3.5, 0.2);
        w.fx.burst('dust', player.x, player.y, { count: 24, speed: 120 });
      }
      announce(w, ws, a);
    },
  },

  // -------------------------------------------------------------------------------------------
  glaive_orbit: {
    id: 'glaive_orbit', name: 'Kreisklingen', rarity: 'rare', type: 'phys', tags: ['phys', 'orbit', 'melee'],
    desc: 'Klingen kreisen unablässig um dich und schneiden jeden Gegner höchstens alle 0,4 s. Halte Feuer, um den Kreis zu weiten.',
    icon: { glyph: 'ring', color: '#d8e0ea' }, projSprite: 'proj_blade', color: '#d8e0ea',
    manual: true,
    base: { damage: 13.5, count: 2, radius: 22, extend: 2.4, range: 72, spin: 4.5, size: 6, hitInterval: 0.4, knockback: 90, cooldown: 0 },
    levels: [
      { desc: '+1 Klinge', mods: { '+count': 1 } },
      { desc: '+25 % Schaden, Klingen 20 % größer', mods: { damage: 1.25, size: 1.2 } },
      { desc: '+1 Klinge, Klingen kreisen 20 % schneller, Trefferintervall −15 %', mods: { '+count': 1, spin: 1.2, hitInterval: 0.85 } },
      { desc: 'Klingensturm: +1 Klinge, +15 % Schaden', mods: { '+count': 1, damage: 1.15 } },
    ],
    update(w, player, ws, dt, held) {
      const st = ws.stats, ps = player.stats, d = ws.data;
      const n = Math.max(1, Math.round(st.count + ps.multishot));
      if (!sameRoom(w, d) || !d.blades) d.blades = [];
      d.blades = d.blades.filter((b) => !b.dead);
      while (d.blades.length < n) d.blades.push(spawnBlade(w, ws, player));
      while (d.blades.length > n) d.blades.pop().dead = true;
      const target = st.radius * ps.range * (held ? st.extend : 1);
      if (d.r == null) d.r = target;
      d.r += Math.sign(target - d.r) * Math.min(Math.abs(target - d.r), 150 * dt);
      const omega = st.spin * (0.5 + 0.5 * ps.fireRate);
      d.ang = ((d.ang || 0) + omega * dt) % TAU;
      const R = d.r, v = omega * R;
      for (let i = 0; i < d.blades.length; i++) {
        const b = d.blades[i];
        const ang = d.ang + (i / d.blades.length) * TAU;
        b.r = st.size * ps.projSize;
        b.scale = ps.projSize;
        b.hitInterval = st.hitInterval * 0.5;
        pin(b, player.x + Math.cos(ang) * R, player.y + Math.sin(ang) * R, Math.cos(ang + Math.PI / 2) * v, Math.sin(ang + Math.PI / 2) * v, dt);
      }
      // one "attack" per revolution while enemies are close (audio + onFire relics)
      d.rev = (d.rev || 0) + omega * dt;
      if (d.rev >= TAU) {
        d.rev -= TAU;
        if (w.findNearestEnemy(player.x, player.y, R + 24)) announce(w, ws, player.aim, d.blades);
      }
    },
    onUnequip(w, player, ws) { clearBlades(ws); },
  },

  // -------------------------------------------------------------------------------------------
  soul_siphon: {
    id: 'soul_siphon', name: 'Seelensauger', rarity: 'uncommon', type: 'shadow', tags: ['shadow', 'beam', 'heal'],
    desc: 'Ein kurzer Strahl, der sich an Gegner heftet, ihnen stetig Leben entzieht und dich ein wenig heilt.',
    icon: { glyph: 'hand', color: '#d86bff' }, projSprite: 'proj_beam', color: '#d86bff',
    manual: true,
    base: { damage: 2.3, tick: 0.1, range: 105, heal: 0.025, healCap: 1, beams: 1, secondary: 0.6, reap: 0, cooldown: 0.1, knockback: 0 },
    levels: [
      { desc: '+20 % Schaden und Reichweite', mods: { damage: 1.2, range: 1.2 } },
      { desc: 'Zweiter Strahl: Saugt zusätzlich an einem weiteren Gegner (60 %), +10 % Schaden', mods: { '+beams': 1, damage: 1.1 } },
      { desc: '+25 % Schaden, +50 % Heilung', mods: { damage: 1.25, heal: 1.5, healCap: 1.5 } },
      { desc: 'Seelenernte: Gegner, die am Strahl sterben, explodieren in Seelenfeuer, +15 % Schaden', mods: { '+reap': 1, damage: 1.15 } },
    ],
    update(w, player, ws, dt, held, aim) {
      const st = ws.stats, ps = player.stats, d = ws.data;
      d.healBudget = Math.min(st.healCap, (d.healBudget ?? st.healCap) + st.healCap * dt);
      if (d.tickT > 0) d.tickT -= dt;
      if (d.sfxT > 0) d.sfxT -= dt;
      if (!held || !player.alive) { d.targets = null; return; }
      const R = st.range * ps.range;
      const ok = (e) => alive(e) && Math.hypot(e.x - player.x, e.y - player.y) <= R + e.r + 6 && w.lineOfSight(player.x, player.y, e.x, e.y);
      let main = d.targets && d.targets[0];
      if (!ok(main) || (alive(aim.target) && aim.target !== main && ok(aim.target))) main = pickTarget(w, player, aim, R, 0.7);
      if (!main) {
        d.targets = null;
        if (Math.random() < 0.25) w.fx.burst('shadow', player.x + Math.cos(aim.angle) * 10, player.y + Math.sin(aim.angle) * 10, { count: 1 });
        return;
      }
      const targets = [main];
      const extra = Math.max(0, Math.round(st.beams - 1 + ps.multishot));
      for (let i = 0; i < extra; i++) {
        const o = w.findNearestEnemy(main.x, main.y, R, (e) => !targets.includes(e) && ok(e));
        if (!o) break;
        targets.push(o);
      }
      d.targets = targets;
      player.fireT = 0.15;
      player.aim = Math.atan2(main.y - player.y, main.x - player.x);
      const pulse = 0.5 + 0.5 * Math.sin(w.time * 18);
      for (let i = 0; i < targets.length; i++) {
        const e = targets[i];
        w.fx.beam(player.x, player.y, e.x, e.y, ws.def.color, (i ? 2 : 3) + pulse * 1.5, 0.05);
      }
      if (d.sfxT <= 0 || d.sfxT == null) { d.sfxT = 0.45; announce(w, ws, player.aim); }
      if (d.tickT > 0) return;
      d.tickT = (d.tickT || 0) + st.tick / ps.fireRate;
      if (d.tickT < 0) d.tickT = 0;
      for (let i = 0; i < targets.length; i++) {
        const e = targets[i];
        if (e.dead) continue;
        const dealt = playerDamage(w, ws, e, st.damage * (i ? st.secondary : 1), { type: 'shadow', proc: i === 0 ? undefined : false });
        const heal = Math.min(dealt * st.heal, d.healBudget);
        if (heal > 0.01) { d.healBudget -= heal; w.healPlayer(heal, { silent: true }); }
        if (Math.random() < 0.4) w.fx.burst('shadow', e.x, e.y, { count: 1, color: ws.def.color });
        if (st.reap && e.dead && !e._reaped) {
          e._reaped = true;
          blast(w, ws, e.x, e.y, 38 * ps.projSize, st.damage * 10, { type: 'shadow', knockback: 80, color: '#d86bff' });
        }
      }
    },
    onUnequip(w, player, ws) { ws.data.targets = null; },
  },

  // -------------------------------------------------------------------------------------------
  star_bow: {
    id: 'star_bow', name: 'Sternbogen', rarity: 'rare', type: 'light', tags: ['light', 'projectile', 'charge'],
    desc: 'Halten zum Spannen. Je länger, desto härter der Pfeil – voll gespannt zerbirst er in Sterne.',
    icon: { glyph: 'bow', color: '#fff3b0' }, projSprite: 'proj_bolt', color: '#fff3b0',
    manual: true,
    base: { damage: 23.5, charge: 0.85, minCharge: 0.2, recover: 0.12, cooldown: 0.85, projSpeed: 380, range: 280, size: 3, count: 1, spread: 0.12, pierce: 1, knockback: 130, stars: 5, starDamage: 0.3, starHoming: 0 },
    levels: [
      { desc: '+20 % Schaden', mods: { damage: 1.2 } },
      { desc: '−20 % Spannzeit', mods: { charge: 0.8, cooldown: 0.8 } },
      { desc: 'Sternenregen: +3 Sterne, Sterne suchen Ziele, +15 % Schaden', mods: { '+stars': 3, '+starHoming': 3.5, damage: 1.15 } },
      { desc: 'Kometenpfeil: Voll gespannt durchschlägt er +2 Gegner, +20 % Schaden', mods: { '+pierce': 2, damage: 1.2 } },
    ],
    update(w, player, ws, dt, held, aim) {
      const st = ws.stats, ps = player.stats, d = ws.data;
      if (d.recover > 0) { d.recover -= dt; return; }
      const chargeTime = Math.max(0.1, st.charge / ps.fireRate);
      if (held && player.alive) {
        d.charging = true;
        d.charge = Math.min(1, (d.charge || 0) + dt / chargeTime);
        const mx = player.x + Math.cos(aim.angle) * 9, my = player.y + Math.sin(aim.angle) * 9;
        if (Math.random() < 0.2 + 0.5 * d.charge) {
          const a = Math.random() * TAU;
          w.fx.burst('light', mx + Math.cos(a) * 12, my + Math.sin(a) * 12, { count: 1, angle: a + Math.PI, spread: 0.1, speed: 50, color: ws.def.color });
        }
        if (d.charge >= 1) {
          w.fx.ring(mx, my, 12, ws.def.color, 0.2);
          bowRelease(w, player, ws, aim); // fully drawn: loose automatically (works with auto-fire / touch)
        }
      } else if (d.charging) {
        if ((d.charge || 0) >= st.minCharge) bowRelease(w, player, ws, aim);
        else { d.charge = 0; d.charging = false; }
      }
    },
    onUnequip(w, player, ws) { ws.data.charge = 0; ws.data.charging = false; },
  },

  // -------------------------------------------------------------------------------------------
  ice_staff: {
    id: 'ice_staff', name: 'Eisstab', rarity: 'uncommon', type: 'frost', tags: ['frost', 'projectile', 'split'],
    desc: 'Verschießt einen Eiskristall, der bei Treffern und an Wänden in kühlende Splitter zerbirst.',
    icon: { glyph: 'staff', color: '#bfe9ff' }, projSprite: 'proj_shard', color: '#bfe9ff',
    base: { damage: 13, cooldown: 0.6, projSpeed: 250, range: 210, size: 4, count: 1, spread: 0.2, pierce: 0, knockback: 60, splinters: 3, splinterDamage: 0.35, chill: 1, splinterChill: 0, splinterPierce: 0 },
    levels: [
      { desc: '+1 Splitter, +15 % Schaden', mods: { '+splinters': 1, damage: 1.15 } },
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: 'Tiefenfrost: Der Kristall kühlt doppelt, auch Splitter kühlen, +15 % Schaden', mods: { '+chill': 1, '+splinterChill': 1, damage: 1.15 } },
      { desc: '+1 Splitter, Splitter durchschlagen 1 Gegner, +25 % Feuerrate', mods: { '+splinters': 1, '+splinterPierce': 1, cooldown: 0.8 } },
    ],
    fire(w, player, ws, aim) {
      const st = ws.stats;
      const shots = playerVolley(w, ws, aim.angle, {
        spin: 6, trail: 'frost', scale: 1.2 * player.stats.projSize, light: { r: 22, color: '#bfe9ff' },
        onHit: (w2, p, e) => { p.data.lastHit = e; },
        onExpire: (w2, p) => shatter(w2, ws, p),
      });
      tagStatus(shots, wStatus(w, 'chill', 1, 2.5, { stacks: st.chill }));
    },
  },
};

/** Ids in roster order (ARCHITECTURE §6.3). */
export const WEAPON_IDS = Object.freeze(Object.keys(WEAPONS));

