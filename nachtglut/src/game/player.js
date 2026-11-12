// Player: movement, dash, aim, weapons, skill, xp/sparks, tile effects. See docs/ARCHITECTURE.md §6.1, §11.2. DOM-free.
import { bus } from '../core/events.js';
import { TS, TILE, SPIKE_CYCLE } from './constants.js';
import { computeStats } from './stats.js';
import { updateStatuses, makeWeaponState, recalcWeapon, weaponCooldown, MAX_WEAPON_LEVEL } from './combat.js';
import { runHooks } from './perks.js';

const ACCEL = 1400;          // px/s² normal ground
const ICE_ACCEL = 260;       // px/s² on ice (slippery)
const DASH_TIME = 0.16;      // s
const DASH_BASE = 105;       // px per dash at dashDistance 1
const DASH_BUFFER = 0.15;    // s an early dash press is remembered
const HAZARD_FIRST = 0.15;   // s on a hazard before the first tick
const HAZARD_TICK = 0.5;
const SAFE_INTERVAL = 0.25;  // s between safe-position updates
const LIFESTEAL_PER_S = 3.5;   // HP/s lifesteal can heal at most (balance: keeps lifesteal stacks from making the player immortal)

/** XP needed to go from `level` to `level + 1`. */
export function xpNext(level) { return Math.round(16 + 9 * level + 1.0 * level * level); }

function safeCall(label, fn) {
  try { return fn(); } catch (err) { console.error(`[player] ${label} failed`, err); return undefined; }
}

export class Player {
  constructor(run, characterDef) {
    this.run = run;
    this.character = characterDef;
    this.x = 0; this.y = 0; this.r = 5;
    this.vx = 0; this.vy = 0; this.kbx = 0; this.kby = 0;
    this.aim = 0; this.aimPoint = { x: 0, y: 0 };
    this.target = null;
    this.hp = 100; this.shield = 0;
    this.level = 1; this.xp = 0; this.xpNext = xpNext(1);
    this.sparks = 0; this._sparkRem = 0;
    this.alive = true;
    this.iframes = 0; this.invuln = 0;
    this.dashing = false; this.flying = false;
    this.hurtT = 0; this.fireT = 0;
    this.anim = 'idle'; this.animT = 0; this.flipX = false;
    this.weapons = [null, null]; this.weaponIndex = 0;
    this.relics = []; this.boons = [];
    this.statuses = {};
    this.flags = {};
    this.mods = new Map();
    this.slowMul = 1; this.frozen = false; this.stunned = false;
    this.dmgTakenMul = 1; this.dmgDealtMul = 1; this.tempDamageMul = 1;
    this.lsBudget = LIFESTEAL_PER_S;
    this._hookDepth = 0;
    this.safeX = 0; this.safeY = 0; this._safeT = 0;
    this._hazT = 0; this._hazNext = HAZARD_FIRST;
    this.dash = { charges: 1, max: 1, cd: 0, cdMax: 1.1, t: 0, dx: 1, dy: 0, buffer: 0, speed: 0 };
    const sk = characterDef && characterDef.skill;
    this.skill = { def: sk || null, cd: 0, cdMax: sk ? sk.cooldown || 0 : 0, active: 0 };
    const pas = characterDef && characterDef.passive;
    this.passive = pas ? {
      id: pas.id || `${characterDef.id}_passive`,
      def: { id: pas.id || `${characterDef.id}_passive`, name: pas.name, desc: pas.desc, hooks: pas.hooks || {}, mods: pas.mods },
      kind: 'passive', stacks: 1, state: {},
    } : null;
    if (this.passive && this.passive.def.mods) {
      const m = typeof this.passive.def.mods === 'function' ? this.passive.def.mods(1) : this.passive.def.mods;
      if (m && m.length) this.mods.set(`passive:${this.passive.id}`, m);
    }
    this.stats = null;
    this.recalc();
    this.hp = this.stats.maxHp;
    this.dash.charges = this.dash.max;
  }

  get weapon() { return this.weapons[this.weaponIndex] || this.weapons[0] || null; }

  // -------------------------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------------------------
  addMod(key, mods) {
    if (!mods || !mods.length) this.mods.delete(key);
    else this.mods.set(key, mods);
    this.recalc();
  }

  removeMods(key) {
    if (this.mods.delete(key)) this.recalc();
  }

  recalc() {
    const prev = this.stats;
    const s = computeStats(this.mods.values());
    this.stats = s;
    if (prev) {
      if (s.maxHp > prev.maxHp && this.alive) this.hp += s.maxHp - prev.maxHp;
      if (s.dashCharges > prev.dashCharges) this.dash.charges += s.dashCharges - prev.dashCharges;
    }
    if (this.hp > s.maxHp) this.hp = s.maxHp;
    this.dash.max = s.dashCharges;
    if (this.dash.charges > this.dash.max) this.dash.charges = this.dash.max;
    this.dash.cdMax = s.dashCooldown;
    if (this.dash.cd > s.dashCooldown) this.dash.cd = s.dashCooldown;
    this.skill.cdMax = this.skill.def ? (this.skill.def.cooldown || 0) * s.skillCooldown : 0;
    return s;
  }

  // -------------------------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------------------------
  gainXp(n) {
    if (!(n > 0) || !this.alive) return;
    const run = this.run, w = run.world;
    this.xp += n * this.stats.xpGain;
    let guard = 0;
    while (this.xp >= this.xpNext && guard++ < 50) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpNext(this.level);
      run.pendingBoons++;
      run.stats.levelUps = (run.stats.levelUps || 0) + 1;
      if (w) {
        w.healPlayer(this.stats.maxHp * 0.06, { silent: true });
        w.fx.ring(this.x, this.y, 40, '#ffd35a', 0.5);
        w.fx.burst('light', this.x, this.y, { count: 20, color: '#ffd35a' });
        w.fx.text(this.x, this.y - 16, 'Stufe ' + this.level, '#ffd35a');
      }
      bus.emit('player:levelup', { level: this.level });
      runHooks(run, 'onLevelUp', { level: this.level });
    }
  }

  gainSparks(n) {
    if (!(n > 0)) return 0;
    const v = n * this.stats.sparkGain + this._sparkRem;
    const whole = Math.floor(v + 1e-9);
    this._sparkRem = v - whole;
    this.sparks += whole;
    this.run.stats.sparksCollected += whole;
    return whole;
  }

  spendSparks(n) {
    n = Math.max(0, Math.round(n));
    if (this.sparks < n) return false;
    this.sparks -= n;
    this.run.stats.sparksSpent = (this.run.stats.sparksSpent || 0) + n;
    if (n > 0) runHooks(this.run, 'onSpend', { amount: n });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Weapons
  // -------------------------------------------------------------------------------------------
  _equip(ws) {
    const def = ws && ws.def;
    if (def && def.onEquip) safeCall(`${def.id}.onEquip`, () => def.onEquip(this.run.world, this, ws));
  }

  _unequip(ws) {
    const def = ws && ws.def;
    if (def && def.onUnequip) safeCall(`${def.id}.onUnequip`, () => def.onUnequip(this.run.world, this, ws));
  }

  /** Fills the empty second slot (and switches to it), else replaces the active weapon. */
  giveWeapon(def, level = 1) {
    if (!def) return null;
    const ws = makeWeaponState(def, level);
    const cur = this.weapons[this.weaponIndex];
    if (!this.weapons[0]) {
      this.weapons[0] = ws; this.weaponIndex = 0;
    } else if (!this.weapons[1]) {
      this._unequip(cur);
      this.weapons[1] = ws; this.weaponIndex = 1;
    } else {
      this._unequip(cur);
      this.weapons[this.weaponIndex] = ws;
    }
    this._equip(ws);
    bus.emit('weapon:gain', { id: def.id });
    return ws;
  }

  swapWeapon() {
    const other = 1 - this.weaponIndex;
    if (!this.weapons[other]) return false;
    this._unequip(this.weapons[this.weaponIndex]);
    this.weaponIndex = other;
    this._equip(this.weapons[other]);
    bus.emit('weapon:swap', { id: this.weapons[other].id });
    return true;
  }

  upgradeWeapon(ws) {
    if (!ws || ws.level >= MAX_WEAPON_LEVEL) return false;
    ws.level++;
    recalcWeapon(ws);
    bus.emit('weapon:upgrade', { id: ws.id, level: ws.level });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------
  update(w, dt) {
    const run = this.run, s = this.stats;
    if (this.iframes > 0) this.iframes = Math.max(0, this.iframes - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.fireT > 0) this.fireT = Math.max(0, this.fireT - dt);
    if (this.skill.cd > 0) this.skill.cd = Math.max(0, this.skill.cd - dt);
    if (this.skill.active > 0) this.skill.active = Math.max(0, this.skill.active - dt);
    this.lsBudget = Math.min(LIFESTEAL_PER_S, this.lsBudget + LIFESTEAL_PER_S * dt);
    this._prevAnim = this.anim;

    if (this.alive) {
      updateStatuses(w, this, dt);
      if (this.alive && s.regen > 0 && this.hp < s.maxHp && !run.ended) this.hp = Math.min(s.maxHp, this.hp + s.regen * dt);
    }
    if (run.ended || !this.alive) {
      this.dashing = false; this.flying = false;
      const f = Math.pow(0.002, dt);
      this.vx *= f; this.vy *= f;
      this._integrate(w, dt);
      this._setAnim(this.hurtT > 0 ? 'hurt' : 'idle', dt);
      return;
    }

    const game = run.game, input = game.input;
    this._updateDashCharges(dt);
    if (input.take('dash')) this.dash.buffer = DASH_BUFFER;
    else if (this.dash.buffer > 0) this.dash.buffer -= dt;

    // --- aim (needed before the dash: dash falls back to the aim direction)
    const aimObj = this._updateAim(w, input, game);

    // --- movement / dash
    const mv = input.move || { x: 0, y: 0 };
    if (!this.dashing && this.dash.buffer > 0 && this.dash.charges > 0) this._startDash(w, mv);
    if (this.dashing) {
      this.dash.t -= dt;
      this.vx = this.dash.dx * this.dash.speed;
      this.vy = this.dash.dy * this.dash.speed;
      if (Math.random() < 0.8) w.fx.burst('ember', this.x, this.y, { count: 1, color: this.character && this.character.color });
    } else {
      const tile = w.tileAtPx(this.x, this.y);
      const speed = s.moveSpeed * this.slowMul;
      const tvx = mv.x * speed, tvy = mv.y * speed;
      const accel = (tile === TILE.ICE ? ICE_ACCEL : ACCEL) * dt;
      const dvx = tvx - this.vx, dvy = tvy - this.vy, dl = Math.hypot(dvx, dvy);
      if (dl <= accel) { this.vx = tvx; this.vy = tvy; } else { this.vx += (dvx / dl) * accel; this.vy += (dvy / dl) * accel; }
    }
    this._integrate(w, dt);
    if (this.dashing && this.dash.t <= 0) this._endDash(w);
    if (!this.alive || run.ended) return;

    // --- tiles: doors, hazards, spikes, safe spot
    if (this._tileEffects(w, dt)) return;

    // --- weapons
    for (const ws of this.weapons) if (ws && ws.cd > 0) ws.cd -= dt;
    if (input.take('swap')) this.swapWeapon();
    const ws = this.weapon;
    if (ws) {
      const def = ws.def;
      if (def.update) safeCall(`${def.id}.update`, () => def.update(w, this, ws, dt, aimObj.firing, aimObj));
      if (!def.manual && def.fire && aimObj.firing && ws.cd <= 0 && this.alive) {
        const r = safeCall(`${def.id}.fire`, () => def.fire(w, this, ws, aimObj));
        const cd = typeof r === 'number' && Number.isFinite(r) ? r : weaponCooldown(w, ws);
        ws.cd = cd + Math.max(-dt, Math.min(0, ws.cd));
        this.fireT = 0.15;
      }
    }

    // --- skill
    if (input.take('skill') && this.skill.def && this.skill.cd <= 0) {
      const def = this.skill.def;
      safeCall(`skill ${def.id}.use`, () => def.use(w, this, aimObj));
      this.skill.cdMax = (def.cooldown || 0) * s.skillCooldown;
      this.skill.cd = this.skill.cdMax;
      run.stats.skillsUsed = (run.stats.skillsUsed || 0) + 1;
      bus.emit('player:skill', { id: def.id });
      runHooks(run, 'onSkill', { id: def.id });
    }

    // --- anim
    let anim = 'idle';
    if (this.dashing) anim = 'dash';
    else if (this.hurtT > 0) anim = 'hurt';
    else if (Math.hypot(this.vx, this.vy) > 8) anim = 'walk';
    this._setAnim(anim, dt);
    this.flipX = Math.cos(this.aim) < 0;
  }

  _setAnim(anim, dt) {
    if (anim !== this.anim) { this.anim = anim; this.animT = 0; } else this.animT += dt;
  }

  _integrate(w, dt) {
    const dx = (this.vx + this.kbx) * dt, dy = (this.vy + this.kby) * dt;
    if (dx || dy) w.moveEntity(this, dx, dy);
    if (this.kbx || this.kby) {
      const f = Math.pow(0.0008, dt);
      this.kbx *= f; this.kby *= f;
      if (Math.abs(this.kbx) < 2) this.kbx = 0;
      if (Math.abs(this.kby) < 2) this.kby = 0;
    }
  }

  _updateDashCharges(dt) {
    const d = this.dash;
    if (d.charges >= d.max) { d.cd = 0; return; }
    if (d.cd <= 0) d.cd = d.cdMax;
    d.cd -= dt;
    if (d.cd <= 0) {
      d.charges++;
      d.cd = d.charges < d.max ? d.cdMax + d.cd : 0;
    }
  }

  _startDash(w, mv) {
    const d = this.dash;
    let dx = mv.x, dy = mv.y;
    let l = Math.hypot(dx, dy);
    if (l < 0.2) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); l = 1; }
    d.dx = dx / l; d.dy = dy / l;
    d.buffer = 0;
    d.charges--;
    if (d.cd <= 0) d.cd = d.cdMax;
    d.t = DASH_TIME;
    d.speed = (DASH_BASE * this.stats.dashDistance) / DASH_TIME;
    this.dashing = true;
    this.flying = true;
    this.kbx = this.kby = 0;
    this.run.stats.dashes++;
    w.fx.burst('dust', this.x, this.y, { count: 6 });
    bus.emit('player:dash', { player: this });
    runHooks(this.run, 'onDash', {});
  }

  _endDash(w) {
    this.dashing = false;
    this.flying = false;
    this.iframes = Math.max(this.iframes, 0.1);
    // keep some momentum, but never more than the walking speed
    const sp = Math.hypot(this.vx, this.vy), max = this.stats.moveSpeed;
    if (sp > max) { this.vx *= max / sp; this.vy *= max / sp; }
    runHooks(this.run, 'onDashEnd', {});
    if (!this.alive || this.run.ended) return;
    if (w.tileAtPx(this.x, this.y) === TILE.PIT) { this.fall(w); return; }
    // half over a pit edge: nudge onto solid ground (or fall if there is none nearby)
    if (!w.canStand(this.x, this.y, this.r, false)) {
      for (let rad = 2; rad <= 10; rad += 2) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const nx = this.x + Math.cos(a) * rad, ny = this.y + Math.sin(a) * rad;
          if (w.canStand(nx, ny, this.r, false)) { this.x = nx; this.y = ny; return; }
        }
      }
      this.fall(w);
    }
  }

  fall(w) {
    const run = this.run;
    run.stats.falls = (run.stats.falls || 0) + 1;
    bus.emit('player:fall', {});
    w.fx.burst('dust', this.x, this.y, { count: 10 });
    this.dashing = false; this.flying = false;
    this.vx = this.vy = this.kbx = this.kby = 0;
    this.x = this.safeX; this.y = this.safeY;
    if (!w.canStand(this.x, this.y, this.r, false)) {
      const f = w.nearestFloor(this.x, this.y);
      this.x = f.x; this.y = f.y;
    }
    w.damagePlayer(8, { raw: true, type: 'phys', fall: true });
    this.iframes = Math.max(this.iframes, 1);
  }

  /** Doors, hazards, spikes, safe position. Returns true when the room is being left. */
  _tileEffects(w, dt) {
    const run = this.run;
    if (this.dashing) return false;
    const tx = Math.floor(this.x / TS), ty = Math.floor(this.y / TS);
    const tile = w.tileAt(tx, ty);
    if (tile === TILE.DOOR && !w.locked) {
      const doors = w.room.doors;
      for (const dir in doors) {
        const d = doors[dir];
        const vertical = dir === 'n' || dir === 's';
        const hit = vertical ? (ty === d.ty && (tx === d.tx || tx === d.tx + 1)) : (tx === d.tx && (ty === d.ty || ty === d.ty + 1));
        if (hit) { run.changeRoom(d.to, dir); return true; }
      }
    }
    const fl = Math.max(1, run.floorIndex || 1);
    if (tile === TILE.HAZARD) {
      this._hazT += dt;
      if (this._hazT >= this._hazNext) {
        this._hazNext += HAZARD_TICK;
        const b = w.biome || {};
        w.damagePlayer(4 + 2 * fl, {
          type: b.hazardType || 'fire', hazard: true,
          status: b.hazardStatus ? { id: b.hazardStatus, duration: 2.5, power: 2 + fl } : null,
        });
      }
    } else { this._hazT = 0; this._hazNext = HAZARD_FIRST; }
    if (tile === TILE.SPIKES && (w.time % SPIKE_CYCLE.period) >= SPIKE_CYCLE.outAt) {
      w.damagePlayer(8 + 2 * fl, { type: 'phys', spikes: true });
    }
    this._safeT -= dt;
    if (this._safeT <= 0) {
      this._safeT = SAFE_INTERVAL;
      if (tile === TILE.FLOOR && w.canStand(this.x, this.y, this.r, false)) { this.safeX = this.x; this.safeY = this.y; }
    }
    return false;
  }

  _validTarget(w, e, range) {
    if (!e || e.dead || e.hidden || e.untargetable || e.spawnT > 0) return false;
    if (Math.hypot(e.x - this.x, e.y - this.y) > range) return false;
    return w.lineOfSight(this.x, this.y, e.x, e.y);
  }

  _updateAim(w, input, game) {
    const settings = game.settings || {};
    const ws = this.weapon;
    let firing = false, target = null;
    let ax = this.aimPoint.x, ay = this.aimPoint.y;
    const vaim = input.vaim, pad = input.padAim;
    if (vaim && vaim.active && (vaim.x || vaim.y)) {
      this.aim = Math.atan2(vaim.y, vaim.x);
      firing = true;
      ax = this.x + Math.cos(this.aim) * 80; ay = this.y + Math.sin(this.aim) * 80;
      this.target = null;
    } else if (pad && pad.active && (pad.x || pad.y)) {
      this.aim = Math.atan2(pad.y, pad.x);
      firing = true;
      ax = this.x + Math.cos(this.aim) * 80; ay = this.y + Math.sin(this.aim) * 80;
      this.target = null;
    } else if (input.lastDevice === 'keyboard' && input.aimMode === 'mouse' && !settings.autoAim) {
      const view = game.view || { x: 0, y: 0 };
      ax = input.mouse.x + view.x; ay = input.mouse.y + view.y;
      this.aim = Math.atan2(ay - this.y, ax - this.x);
      firing = input.down('fire');
      this.target = null;
    } else {
      const range = ((ws && ws.stats.range) ?? 200) * this.stats.range + 24;
      let t = this.target;
      if (!this._validTarget(w, t, range * 1.15)) {
        t = w.findNearestEnemy(this.x, this.y, range, (e) => w.lineOfSight(this.x, this.y, e.x, e.y));
      }
      this.target = t || null;
      target = this.target;
      if (target) {
        this.aim = Math.atan2(target.y - this.y, target.x - this.x);
        ax = target.x; ay = target.y;
        firing = input.down('fire') || !!settings.autoFire || input.lastDevice === 'touch';
      } else {
        const mv = input.move || { x: 0, y: 0 };
        if (Math.hypot(mv.x, mv.y) > 0.2) this.aim = Math.atan2(mv.y, mv.x);
        ax = this.x + Math.cos(this.aim) * 80; ay = this.y + Math.sin(this.aim) * 80;
        firing = input.down('fire');
      }
    }
    this.aimPoint.x = ax; this.aimPoint.y = ay;
    return { angle: this.aim, x: ax, y: ay, target, firing };
  }
}
