// Playable characters + their skills and passives (owner: weapons). See docs/ARCHITECTURE.md §6.4.
// DOM-free; no top-level side effects (part of the registry import cycle).
//
// Timed skill effects (Bollwerk, Schattenschritt) end through three independent paths so a flag can never stick:
// the effect's own zone `onEnd`, the passive's `onRoomEnter` (zones are discarded on room change) and a watchdog
// that runs from `dynamicMods` (the core evaluates it 5×/s) / `onUpdate`, using `run.time`.
import { skillDamage } from '../game/combat.js';
import { distToSegment } from '../core/math.js';
import { TILE } from '../game/constants.js';

const TAU = Math.PI * 2;

/** Skill area growth with skillPower (gentle, capped). */
const sizeMul = (P) => Math.min(1.6, 0.85 + 0.15 * P);
const runTime = (run) => (run && typeof run.time === 'number' ? run.time : 0);
const alive = (e) => !!e && !e.dead && !e.hidden && !(e.spawnT > 0);

/** Seconds since this perk's last pulse (works whether it is called from dynamicMods, onUpdate or both). */
function pulseDt(ctx) {
  const t = runTime(ctx.run), st = ctx.state;
  const dt = st._t == null ? 0 : Math.max(0, Math.min(1, t - st._t));
  st._t = t;
  return dt;
}

/** Skill area damage: explosion fx (+ destructible props), skill-scaled damage, optional status. */
function skillBurst(w, x, y, radius, base, opts = {}) {
  const type = opts.type || 'phys';
  w.explode(x, y, radius, 0, { team: 'player', type, color: opts.color, silent: !!opts.silent });
  let n = 0;
  for (const e of w.enemiesInRadius(x, y, radius)) {
    skillDamage(w, e, base, {
      type, source: 'skill', canCrit: true,
      knockback: opts.knockback ? { x: e.x - x, y: e.y - y, force: opts.knockback } : undefined,
    });
    if (opts.status && !e.dead) w.applyStatus(e, opts.status.id, opts.status);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Glutträger
// ---------------------------------------------------------------------------------------------
function flameWave(w, player) {
  const s = player.stats, P = s.skillPower;
  const R = 82 * sizeMul(P), dur = 0.32;
  const x = player.x, y = player.y;
  const burn = { duration: 4 * s.statusDuration, power: 6 * P * s.statusPower * s.damage };
  w.spawnZone({
    shape: 'ring', x, y, r: 10, inner: 0, grow: (R - 10) / dur, delay: 0, duration: dur,
    team: 'player', damage: 0, type: 'fire', color: '#ff8a3c', persist: true,
    onHit(w2, z, e) {
      skillDamage(w2, e, 30, { type: 'fire', source: 'skill', canCrit: true, knockback: { x: e.x - x, y: e.y - y, force: 240 } });
      if (!e.dead) w2.applyStatus(e, 'burn', burn);
    },
  });
  // the wave also burns enemy shots out of the air
  for (const pr of w.projectiles) {
    if (pr.team !== 'enemy' || pr.dead) continue;
    if (Math.hypot(pr.x - x, pr.y - y) <= R) { pr.dead = true; w.fx.burst('ember', pr.x, pr.y, { count: 3 }); }
  }
  w.fx.ring(x, y, R, '#ff8a3c', 0.4);
  w.fx.burst('ember', x, y, { count: 36, speed: 200 });
  w.fx.light(x, y, R * 2, '#ff8a3c', 0.4);
  w.fx.shake(3, 0.2);
  player.skill.active = dur;
}

// ---------------------------------------------------------------------------------------------
// Schattenläuferin
// ---------------------------------------------------------------------------------------------
function endShadowCrits(player) {
  const f = player.flags;
  f.shadowCrits = 0;
  f.shadowCritUntil = 0;
  player.removeMods('skill:shadow_step');
}

function consumeShadowCrit(player) {
  const f = player.flags;
  if (!(f.shadowCrits > 0)) return;
  f.shadowCrits--;
  if (f.shadowCrits <= 0) endShadowCrits(player);
}

function shadowStep(w, player, aim) {
  const s = player.stats, P = s.skillPower;
  const ox = player.x, oy = player.y;
  const a = aim && typeof aim.angle === 'number' ? aim.angle : player.aim;
  const maxD = 100 * Math.min(1.4, s.dashDistance);
  let want = aim && aim.x != null ? Math.hypot(aim.x - ox, aim.y - oy) : 0;
  if (!(want > 30)) want = maxD;
  want = Math.min(maxD, want);
  const ca = Math.cos(a), sa = Math.sin(a);
  let bx = ox, by = oy;
  for (let d = want; d > 0; d -= 4) {
    const nx = ox + ca * d, ny = oy + sa * d;
    if (w.tileAtPx(nx, ny) === TILE.PIT || w.tileAtPx(nx, ny) === TILE.DOOR) continue;
    if (w.lineOfSight(ox, oy, nx, ny) && w.canStand(nx, ny, player.r, false)) { bx = nx; by = ny; break; }
  }
  player.x = bx; player.y = by;
  player.vx = 0; player.vy = 0; player.kbx = 0; player.kby = 0;
  player.invuln = Math.max(player.invuln || 0, 0.6);
  player.iframes = Math.max(player.iframes || 0, 0.6);
  w.fx.burst('shadow', ox, oy, { count: 18, speed: 90 });
  w.fx.burst('shadow', bx, by, { count: 18, speed: 120 });
  w.fx.beam(ox, oy, bx, by, '#b07cff', 4, 0.2);
  w.fx.light(bx, by, 60, '#b07cff', 0.3);
  // cut through everything on the way
  for (const e of w.enemies.slice()) {
    if (!alive(e)) continue;
    if (distToSegment(e.x, e.y, ox, oy, bx, by) <= e.r + 10) {
      skillDamage(w, e, 16, { type: 'shadow', source: 'skill', canCrit: true });
      if (!e.dead) w.applyStatus(e, 'mark', { duration: 3 * s.statusDuration });
    }
  }
  // the shadow left behind hurts, then bursts
  const SR = 26 * sizeMul(P);
  w.spawnZone({
    shape: 'circle', x: ox, y: oy, r: SR, delay: 0, duration: 1.5, tick: 0.4, team: 'player', damage: 0,
    type: 'shadow', color: '#7a4fd0', persist: true,
    onHit(w2, z, e) { skillDamage(w2, e, 4, { type: 'shadow', source: 'skill' }); },
    onEnd(w2, z) { skillBurst(w2, z.x, z.y, SR * 1.75, 20, { type: 'shadow', color: '#b07cff', knockback: 160 }); },
  });
  // the next 3 hits are critical
  const f = player.flags;
  f.shadowCrits = 3;
  f.shadowCritUntil = runTime(w.run) + 6;
  player.addMod('skill:shadow_step', [{ stat: 'critChance', add: 1 }]);
  player.skill.active = 0.6;
}

function afterimage(w, player) {
  const s = player.stats, x = player.x, y = player.y;
  w.fx.burst('shadow', x, y, { count: 8 });
  w.spawnZone({
    shape: 'circle', x, y, r: 30, delay: 0.45, duration: 0.05, team: 'player', damage: 0, type: 'shadow', color: '#b07cff', persist: true,
    onStart(w2, z) {
      skillBurst(w2, z.x, z.y, z.r, 10, { type: 'shadow', color: '#b07cff', knockback: 90, status: { id: 'mark', duration: 2.5 * s.statusDuration } });
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Eisenwächter
// ---------------------------------------------------------------------------------------------
function bulwarkPulse(w, player) {
  const s = player.stats, R = 72 * sizeMul(s.skillPower);
  w.fx.ring(player.x, player.y, R, '#9ad0ff', 0.3);
  for (const e of w.enemiesInRadius(player.x, player.y, R)) {
    skillDamage(w, e, 8, { type: 'phys', source: 'skill', knockback: { x: e.x - player.x, y: e.y - player.y, force: 320 * s.knockback } });
    if (!e.dead) w.applyStatus(e, 'weak', { duration: 2 * s.statusDuration });
  }
}

function endBulwark(player) {
  const f = player.flags;
  if (!f.bulwark) return;
  f.bulwark = false;
  f.bulwarkUntil = 0;
  if (f._bulwarkReflect) f.reflect = false;
  f._bulwarkReflect = false;
  player.removeMods('skill:bulwark');
}

function startBulwark(w, player) {
  const s = player.stats, P = s.skillPower, f = player.flags;
  const dur = 3 * Math.min(1.5, 0.9 + 0.1 * P);
  endBulwark(player);
  f.bulwark = true;
  f._bulwarkReflect = !f.reflect; // only clear reflect later if we were the ones to set it
  f.reflect = true;
  f.bulwarkUntil = runTime(w.run) + dur;
  player.addMod('skill:bulwark', [{ stat: 'armor', add: 6 }]);
  bulwarkPulse(w, player);
  w.fx.flash('#9ad0ff', 0.1);
  w.spawnZone({
    shape: 'circle', x: player.x, y: player.y, r: 20, follow: player, persist: true, delay: 0, duration: dur,
    team: 'player', damage: 0, color: '#9ad0ff', data: { pulseT: 1 },
    onTick(w2, z, dt) {
      z.data.pulseT -= dt;
      if (z.data.pulseT <= 0) { z.data.pulseT += 1; bulwarkPulse(w2, player); }
      if (Math.random() < 0.3) {
        const a = Math.random() * TAU;
        w2.fx.burst('spark', z.x + Math.cos(a) * 16, z.y + Math.sin(a) * 16, { count: 1, color: '#9ad0ff' });
      }
    },
    onEnd() { endBulwark(player); },
  });
  player.skill.active = dur;
}

function bulwarkWatch(ctx) {
  const f = ctx.player.flags;
  if (f.bulwark && runTime(ctx.run) > f.bulwarkUntil + 0.3) endBulwark(ctx.player);
}

// ---------------------------------------------------------------------------------------------
// Frostweberin
// ---------------------------------------------------------------------------------------------
function iceStorm(w, player, aim) {
  const s = player.stats, P = s.skillPower;
  let tx = aim && aim.x != null ? aim.x : player.x, ty = aim && aim.y != null ? aim.y : player.y;
  if (aim && alive(aim.target)) { tx = aim.target.x; ty = aim.target.y; }
  const dx = tx - player.x, dy = ty - player.y, d = Math.hypot(dx, dy), maxD = 150 * s.range;
  if (d > maxD) { tx = player.x + (dx / d) * maxD; ty = player.y + (dy / d) * maxD; }
  const c = w.clampToRoom(tx, ty, 8);
  const R = 54 * sizeMul(P), dur = 4;
  const chill = { duration: 2 * s.statusDuration, stacks: 1 };
  w.spawnZone({
    shape: 'circle', x: c.x, y: c.y, r: R, delay: 0.3, duration: dur, tick: 0.4, team: 'player', damage: 0,
    type: 'frost', color: '#bfe9ff', persist: true, data: { fxT: 0 },
    onStart(w2, z) { w2.fx.ring(z.x, z.y, z.r, '#bfe9ff', 0.4); w2.fx.light(z.x, z.y, z.r * 2, '#bfe9ff', dur); },
    onHit(w2, z, e) {
      skillDamage(w2, e, 5, { type: 'frost', source: 'skill' });
      if (!e.dead) w2.applyStatus(e, 'chill', chill);
    },
    onTick(w2, z, dt) {
      z.data.fxT -= dt;
      if (z.data.fxT > 0) return;
      z.data.fxT = 0.05;
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * z.r;
      w2.fx.burst('frost', z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, { count: 1, angle: 2.2, spread: 0.4, speed: 70 });
    },
  });
  player.skill.active = dur;
}

// ---------------------------------------------------------------------------------------------
// Aschenkind
// ---------------------------------------------------------------------------------------------
function overshield(player, amount) {
  if (!(amount > 0)) return;
  const cap = player.stats.maxHp * 0.25;
  if (player.shield >= cap) return;
  player.shield = Math.min(cap, (player.shield || 0) + amount);
}

function ashRebirth(w, player) {
  const s = player.stats, P = s.skillPower;
  const cost = Math.min(Math.max(0, Math.floor(player.hp - 1)), Math.max(1, Math.round(player.hp * 0.15)));
  if (cost > 0) {
    player.hp -= cost;
    w.fx.text(player.x, player.y - 12, `-${cost}`, '#c9c2b8', { player: true, small: true });
  }
  const R = 86 * sizeMul(P);
  skillBurst(w, player.x, player.y, R, 22 + cost * 2.5, {
    type: 'fire', color: '#c9c2b8', knockback: 260, status: { id: 'weak', duration: 3 * s.statusDuration },
  });
  const shield = (10 + cost * 1.5) * P;
  if (typeof w.addShield === 'function') w.addShield(shield);
  else player.shield = (player.shield || 0) + shield;
  player.iframes = Math.max(player.iframes || 0, 0.3);
  w.fx.burst('smoke', player.x, player.y, { count: 40, speed: 170, color: '#c9c2b8' });
  w.fx.burst('ember', player.x, player.y, { count: 20, speed: 140 });
  w.fx.flash('#c9c2b8', 0.12);
  w.fx.shake(4, 0.25);
  player.skill.active = 0.4;
}

// ---------------------------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------------------------
export const CHARACTERS = {
  bearer: {
    id: 'bearer', name: 'Glutträger', title: 'Der letzte Funke',
    desc: 'Ausgewogen und verlässlich. Trägt die Glut der alten Feuerstelle im Herzen – sein Feuer brennt etwas heißer.',
    sprite: 'char_bearer', color: '#ff8a3c',
    baseMods: [{ stat: 'fireDamage', mul: 1.15 }, { stat: 'maxHp', add: 10 }],
    weapon: 'ember_bolt',
    skill: {
      id: 'flame_wave', name: 'Flammenwoge', cooldown: 9, duration: 0.35,
      desc: 'Eine Feuerwoge rollt von dir aus, verbrennt feindliche Geschosse, schleudert Gegner zurück und setzt sie in Brand.',
      icon: { glyph: 'flame', color: '#ff8a3c' },
      use(w, player) { flameWave(w, player); },
    },
    passive: {
      id: 'bearer_passive', name: 'Glutherz', desc: 'Jeder 5. Schuss – oder jeder 5. Nahkampf-/Strahltreffer – ist garantiert kritisch.',
      hooks: {
        onShot(ctx, spec) {
          const st = ctx.state;
          st.n = (st.n || 0) + 1;
          if (st.n < 5) return;
          st.n = 0;
          if (!spec.crit) { spec.crit = true; spec.damage *= ctx.player.stats.critMult; }
          spec.scale = (spec.scale || 1) * 1.3;
          spec.light = { r: 30, color: '#ffd35a' };
        },
        onHit(ctx, { enemy, amount, crit, type, info }) {
          // direct weapon hits (melee, beams, orbitals); projectiles are handled in onShot
          if (!info || info.proj || info.source !== 'weapon' || !enemy || enemy.dead) return;
          const st = ctx.state;
          st.h = (st.h || 0) + 1;
          if (st.h < 5) return;
          st.h = 0;
          if (crit) return;
          ctx.w.damageEnemy(enemy, amount * (ctx.player.stats.critMult - 1), { type, crit: true, proc: false, source: 'weapon', weaponId: info.weaponId });
        },
      },
    },
    unlock: { text: 'Von Beginn an verfügbar.', default: true },
  },

  shadow: {
    id: 'shadow', name: 'Schattenläuferin', title: 'Die aus dem Zwielicht',
    desc: 'Schnell und zerbrechlich. Hohe Krit-Chance, ein zusätzlicher Dash – wer sie treffen will, trifft meist nur ihren Schatten.',
    sprite: 'char_shadow', color: '#b07cff',
    baseMods: [
      { stat: 'maxHp', add: -20 }, { stat: 'moveSpeed', mul: 1.12 }, { stat: 'critChance', add: 0.1 }, { stat: 'critMult', add: 0.25 },
      { stat: 'dashCharges', add: 1 }, { stat: 'dashCooldown', mul: 0.85 },
    ],
    weapon: 'shadow_daggers',
    skill: {
      id: 'shadow_step', name: 'Schattenschritt', cooldown: 7, duration: 0.6,
      desc: 'Springe durch die Schatten in Zielrichtung und zeichne alles auf dem Weg. Kurz unverwundbar, die nächsten 3 Treffer sind kritisch. Zurück bleibt ein Schatten, der Gegner verletzt und dann zerbirst.',
      icon: { glyph: 'moon', color: '#b07cff' },
      use(w, player, aim) { shadowStep(w, player, aim); },
    },
    passive: {
      id: 'shadow_passive', name: 'Nachbild', desc: 'Jeder Dash hinterlässt ein Nachbild, das kurz darauf zerbirst und getroffene Gegner zeichnet.',
      hooks: {
        onDash(ctx) { afterimage(ctx.w, ctx.player); },
        onShot(ctx) { consumeShadowCrit(ctx.player); },
        onHit(ctx, { info }) { if (info && !info.proj && info.source === 'weapon') consumeShadowCrit(ctx.player); },
        onUpdate(ctx) { const f = ctx.player.flags; if (f.shadowCrits > 0 && runTime(ctx.run) > f.shadowCritUntil) endShadowCrits(ctx.player); },
        dynamicMods(ctx) { const f = ctx.player.flags; if (f.shadowCrits > 0 && runTime(ctx.run) > f.shadowCritUntil) endShadowCrits(ctx.player); return null; },
      },
    },
    unlock: { text: 'Besiege den Schlackenkönig.' },
  },

  warden: {
    id: 'warden', name: 'Eisenwächter', title: 'Der Wall am Abgrund',
    desc: 'Langsam, schwer gepanzert und kaum zu bewegen. Wer ihn angreift, blutet an seinen Dornen.',
    sprite: 'char_warden', color: '#9aa7b8',
    baseMods: [
      { stat: 'maxHp', add: 40 }, { stat: 'armor', add: 2 }, { stat: 'moveSpeed', mul: 0.88 }, { stat: 'knockback', mul: 1.3 },
      { stat: 'thorns', add: 6 }, { stat: 'dashDistance', mul: 0.85 },
    ],
    weapon: 'iron_hammer',
    skill: {
      id: 'bulwark', name: 'Bollwerk', cooldown: 12, duration: 3,
      desc: '3 s lang wirft eine Barriere feindliche Geschosse zurück und gewährt +6 Rüstung. Jede Sekunde stößt ein Puls Gegner zurück und schwächt sie.',
      icon: { glyph: 'shield', color: '#9ad0ff' },
      use(w, player) { startBulwark(w, player); },
    },
    passive: {
      id: 'warden_passive', name: 'Unerschütterlich', desc: 'Erleidet nur 40 % Rückstoß im Nahkampf, und wer ihn trifft, wird selbst zurückgestoßen.',
      hooks: {
        onDamaged(ctx, hit) {
          const p = ctx.player, w = ctx.w, src = hit.source;
          if (!w || !src || src.hp == null || src.dead || hit.dot || !(hit.amount > 0)) return;
          const dx = src.x - p.x, dy = src.y - p.y, d = Math.hypot(dx, dy) || 1;
          // contact hit: the core shoves the player 150 away from the attacker right after this; absorb 60 %
          if (d <= (src.r || 6) + p.r + 6 && !p.dashing) { p.kbx += (dx / d) * 90; p.kby += (dy / d) * 90; }
          if (d <= 60) w.knockback(src, dx, dy, 180);
        },
        onRoomEnter(ctx) { endBulwark(ctx.player); },
        onUpdate(ctx) { bulwarkWatch(ctx); },
        dynamicMods(ctx) { bulwarkWatch(ctx); return null; },
      },
    },
    unlock: { text: 'Erreiche die Frostadern (Ebene 3).' },
  },

  weaver: {
    id: 'weaver', name: 'Frostweberin', title: 'Die Spinnerin des Winters',
    desc: 'Webt Kälte in jeden Angriff. Stärkere und längere Zustände – unterkühlte Gegner zerbrechen unter ihren Händen.',
    sprite: 'char_weaver', color: '#8fd8ff',
    baseMods: [
      { stat: 'maxHp', add: 0 }, { stat: 'statusPower', mul: 1.25 }, { stat: 'statusDuration', mul: 1.2 },
      { stat: 'chillChance', add: 0.12 }, { stat: 'frostDamage', mul: 1.2 },
    ],
    weapon: 'ice_staff',
    skill: {
      id: 'ice_storm', name: 'Eissturm', cooldown: 11, duration: 4,
      desc: 'Beschwört am Zielpunkt einen Schneesturm, der 4 s lang Gegner verletzt und so lange unterkühlt, bis sie einfrieren.',
      icon: { glyph: 'snowflake', color: '#bfe9ff' },
      use(w, player, aim) { iceStorm(w, player, aim); },
    },
    passive: {
      id: 'weaver_passive', name: 'Kältegespinst', desc: '+25 % Schaden gegen unterkühlte und gefrorene Gegner.',
      hooks: {
        onHit(ctx, { enemy, amount, type, info }) {
          if (!enemy || enemy.dead || !(amount > 0)) return;
          const st = enemy.statuses;
          if (!st || !(st.chill || st.freeze)) return;
          ctx.w.damageEnemy(enemy, amount * 0.25, { type, crit: !!(info && info.crit), proc: false, silent: true, source: 'relic' });
        },
      },
    },
    unlock: { text: 'Besiege den Reifwyrm – oder opfere 400 Asche.' },
  },

  revenant: {
    id: 'revenant', name: 'Aschenkind', title: 'Aus der Asche geboren',
    desc: 'Wenig Leben, aber unstillbarer Hunger: Lebensraub, Regeneration und die Kraft, das eigene Leben zu verbrennen.',
    sprite: 'char_revenant', color: '#c9c2b8',
    baseMods: [{ stat: 'maxHp', add: -40 }, { stat: 'lifesteal', add: 0.015 }, { stat: 'regen', add: 0.05 }, { stat: 'healPower', mul: 1.15 }],
    weapon: 'soul_siphon',
    skill: {
      id: 'ash_rebirth', name: 'Aschegeburt', cooldown: 10, duration: 0.4,
      desc: 'Opfere 15 % deines aktuellen Lebens: Du zerbirst in einer gewaltigen Aschewolke, die Gegner zurückwirft und schwächt, und erhebst dich mit einem Schild.',
      icon: { glyph: 'skull', color: '#c9c2b8' },
      use(w, player) { ashRebirth(w, player); },
    },
    passive: {
      id: 'revenant_passive', name: 'Aschenhunger', desc: 'Jeder Kill heilt 1 Leben. Heilung über dem Maximum wird zu Schild (bis 25 % der max. Leben).',
      hooks: {
        onKill(ctx) {
          const p = ctx.player, w = ctx.w;
          if (!w || !p.alive) return;
          const mods = ctx.run && ctx.run.difficulty && ctx.run.difficulty.mods;
          const want = p.stats.healPower * ((mods && mods.healMult) ?? 1);
          const healed = w.healPlayer(1, { silent: true }) || 0;
          overshield(p, want - healed);
        },
        onUpdate(ctx) {
          const dt = pulseDt(ctx), p = ctx.player;
          if (dt > 0 && p.alive && p.hp >= p.stats.maxHp - 1e-6 && p.stats.regen > 0) overshield(p, p.stats.regen * dt);
        },
        dynamicMods(ctx) {
          const dt = pulseDt(ctx), p = ctx.player;
          if (dt > 0 && p.alive && p.hp >= p.stats.maxHp - 1e-6 && p.stats.regen > 0) overshield(p, p.stats.regen * dt);
          return null;
        },
      },
    },
    unlock: { text: 'Entzünde das Sonnenherz neu (gewinne einen Abstieg).' },
  },
};

/** Ids in roster order (ARCHITECTURE §6.4). */
export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTERS));
