// World: simulates the current room. This is the API surface used by AI, bosses, weapons, relics and skills
// (see docs/ARCHITECTURE.md §5). DOM-free.
import { bus } from '../core/events.js';
import { TS, TILE, DIRS, TYPE_COLORS } from './constants.js';
import { clamp, norm } from '../core/math.js';
import { BIOMES } from '../data/biomes.js';
import { enemyDef, aiFor, AFFIXES } from './registry.js';
import { applyStatus, updateStatuses, hasStatus } from './combat.js';
import { runHooks } from './perks.js';
import { makeProjectile, makeZone, updateProjectiles, updateZones, updatePickups, makePickup } from './entities.js';
import { instantiateProps, updateProps, damageProp, onRoomCleared as propsOnRoomCleared } from './props.js';

const noop = () => {};
/** No-op fx implementation for headless runs. */
export const NULL_FX = Object.freeze({
  burst: noop, text: noop, ring: noop, beam: noop, lightning: noop, shake: noop, flash: noop, light: noop, hitstop: noop,
  update: noop, clear: noop, hitstopT: 0,
});

const COL_HALF_MAX = 6.5; // tile-collision half size cap: everything fits through 1-tile gaps

export class World {
  constructor(run, fx) {
    this.run = run;
    this.fx = fx || NULL_FX;
    this.rng = run.rng.fork('world');
    this.player = run.player;
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
    this.pickups = [];
    this.props = [];
    this.room = null;
    this.biome = null;
    this.tiles = null;
    this.w = 0; this.h = 0;
    this.time = 0;
    this.locked = false;
    this.boss = null;
    this.waveIndex = -1;
    this.waveTimer = 0;
    this.clearDelay = 0;
    this.flow = null;
    this.flowT = 0;
    this.flowTile = -1;
    this.blocked = null;
    this.interactHint = null;
    this.interactProp = null;
    this.nextUid = 1;
    this.sepT = 0;
    this.bossDefeated = null;
  }

  // -------------------------------------------------------------------------------------------
  // Room lifecycle
  // -------------------------------------------------------------------------------------------
  enterRoom(room, fromDir) {
    const run = this.run, p = this.player;
    this.room = room;
    this.biome = run.biome;
    this.tiles = room.tiles;
    this.w = room.w; this.h = room.h;
    this.time = 0;
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
    this.pickups = [];
    this.boss = null;
    this.bossDefeated = null;
    this.interactHint = null;
    this.interactProp = null;
    this.fx.clear && this.fx.clear();
    const first = !room.visited;
    room.visited = true;
    room.seen = true;
    for (const d in room.doors) {
      const n = run.floor.rooms[room.doors[d].to];
      const secret = n && (n.secret || n.type === 'secret');
      if (n && (!secret || n.visited)) n.seen = true;
    }
    this.props = instantiateProps(this, room);
    this.rebuildBlocked();

    // place the player
    let px, py;
    const door = fromDir ? room.doors[DIRS[fromDir].opp] : null;
    if (door) {
      const side = DIRS[fromDir].opp;
      if (side === 'n') { px = (door.tx + 1) * TS; py = (door.ty + 2.1) * TS; }
      else if (side === 's') { px = (door.tx + 1) * TS; py = (door.ty - 1.1) * TS; }
      else if (side === 'w') { px = (door.tx + 2.1) * TS; py = (door.ty + 1) * TS; }
      else { px = (door.tx - 1.1) * TS; py = (door.ty + 1) * TS; }
    } else if (room.playerStart) {
      px = (room.playerStart.tx + 0.5) * TS; py = (room.playerStart.ty + 0.5) * TS;
    } else {
      px = (room.w * TS) / 2; py = (room.h * TS) / 2;
    }
    if (!this.canStand(px, py, p.r)) {
      const f = this.nearestFloor(px, py);
      px = f.x; py = f.y;
    }
    p.x = px; p.y = py; p.vx = p.vy = 0; p.kbx = p.kby = 0;
    p.dashing = false;
    p.safeX = px; p.safeY = py;
    p.target = null;

    this.locked = false;
    this.waveIndex = -1;
    this.waveTimer = 0;
    this.clearDelay = 0;
    this.flowTile = -1;
    this.computeFlow();

    if (!room.cleared && room.spawns && room.spawns.length) {
      this.locked = true;
      this.waveTimer = room.spawns[0].delay ?? 0.6;
      bus.emit('room:lock', { room });
      bus.emit('door:close', {});
    } else if (!room.cleared) {
      room.cleared = true;
    }
    bus.emit('room:enter', { room, first });
    runHooks(run, 'onRoomEnter', { room, first });
  }

  rebuildBlocked() {
    const b = new Uint8Array(this.w * this.h);
    for (const pr of this.props) {
      if (pr.removed || !pr.solid) continue;
      const tx = Math.floor(pr.x / TS), ty = Math.floor(pr.y / TS);
      if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) b[ty * this.w + tx] = 1;
    }
    this.blocked = b;
    this.flowTile = -1;
  }

  spawnWave(index) {
    const wave = this.room.spawns[index];
    this.waveIndex = index;
    if (!wave) return;
    for (const en of wave.entries) {
      const x = (en.tx + 0.5) * TS, y = (en.ty + 0.5) * TS;
      this.spawnEnemy(en.id, x, y, { elite: en.elite || 0, delay: 0.75 + this.rng.float(0, 0.25) });
    }
    bus.emit('wave:spawn', { room: this.room, index });
  }

  clearRoom() {
    const room = this.room, run = this.run;
    this.locked = false;
    room.cleared = true;
    run.stats.roomsCleared++;
    for (const pk of this.pickups) pk.magnet = true;
    for (const pr of this.projectiles) if (pr.team === 'enemy') pr.dead = true;
    for (const z of this.zones) if (z.team === 'enemy') z.dead = true;
    bus.emit('door:open', {});
    bus.emit('room:clear', { room });
    propsOnRoomCleared(this, room);
    runHooks(run, 'onRoomClear', { room });
    run.onRoomClear(room);
  }

  // -------------------------------------------------------------------------------------------
  // Tiles + movement
  // -------------------------------------------------------------------------------------------
  tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return TILE.VOID;
    return this.tiles[ty * this.w + tx];
  }
  tileAtPx(x, y) { return this.tileAt(Math.floor(x / TS), Math.floor(y / TS)); }

  solidTile(t, flying) {
    if (t === TILE.WALL || t === TILE.VOID) return true;
    if (t === TILE.DOOR) return this.locked;
    if (t === TILE.PIT) return !flying;
    return false;
  }
  isSolidPx(x, y, flying = false) { return this.solidTile(this.tileAtPx(x, y), flying); }

  boxSolid(x, y, hr, flying) {
    return this.isSolidPx(x - hr, y - hr, flying) || this.isSolidPx(x + hr, y - hr, flying)
      || this.isSolidPx(x - hr, y + hr, flying) || this.isSolidPx(x + hr, y + hr, flying);
  }

  canStand(x, y, r = 5, flying = false) {
    const hr = Math.min(r, COL_HALF_MAX);
    if (this.boxSolid(x, y, hr, flying)) return false;
    for (const pr of this.props) {
      if (pr.removed || !pr.solid) continue;
      const dx = x - pr.x, dy = y - pr.y, rr = hr + pr.r;
      if (dx * dx + dy * dy < rr * rr) return false;
    }
    return true;
  }

  /** Moves e by (dx,dy) with tile collision and sliding. Returns true if blocked; sets e.blockedX / e.blockedY. */
  moveEntity(e, dx, dy) {
    const hr = Math.min(e.r || 5, COL_HALF_MAX);
    const flying = !!e.flying;
    e.blockedX = false; e.blockedY = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0 && !e.blockedX) {
        let nx = e.x + sx;
        if (this.boxSolid(nx, e.y, hr, flying)) {
          if (sx > 0) nx = Math.floor((nx + hr) / TS) * TS - hr - 0.01;
          else nx = (Math.floor((nx - hr) / TS) + 1) * TS + hr + 0.01;
          if (this.boxSolid(nx, e.y, hr, flying)) nx = e.x;
          e.blockedX = true;
        }
        e.x = nx;
      }
      if (sy !== 0 && !e.blockedY) {
        let ny = e.y + sy;
        if (this.boxSolid(e.x, ny, hr, flying)) {
          if (sy > 0) ny = Math.floor((ny + hr) / TS) * TS - hr - 0.01;
          else ny = (Math.floor((ny - hr) / TS) + 1) * TS + hr + 0.01;
          if (this.boxSolid(e.x, ny, hr, flying)) ny = e.y;
          e.blockedY = true;
        }
        e.y = ny;
      }
    }
    // solid props (circles)
    const props = this.props;
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      if (pr.removed || !pr.solid) continue;
      const ddx = e.x - pr.x, ddy = e.y - pr.y, rr = hr + pr.r;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < rr * rr && d2 > 1e-4) {
        const d = Math.sqrt(d2), push = rr - d;
        const nx = e.x + (ddx / d) * push, ny = e.y + (ddy / d) * push;
        if (!this.boxSolid(nx, ny, hr, flying)) { e.x = nx; e.y = ny; }
      }
    }
    return e.blockedX || e.blockedY;
  }

  /** Straight-line visibility; blocked by WALL/VOID (and closed doors) only. */
  lineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const tt = this.tileAtPx(x0 + dx * t, y0 + dy * t);
      if (tt === TILE.WALL || tt === TILE.VOID) return false;
    }
    return true;
  }

  /** Like lineOfSight but for walking: also blocked by pits (unless flying) and solid props. */
  hasClearPath(x0, y0, x1, y1, flying = false) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = x0 + dx * t, y = y0 + dy * t;
      const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
      if (this.solidTile(this.tileAt(tx, ty), flying)) return false;
      if (this.blocked && tx >= 0 && ty >= 0 && tx < this.w && ty < this.h && this.blocked[ty * this.w + tx]) return false;
    }
    return true;
  }

  walkableTile(tx, ty) {
    const t = this.tileAt(tx, ty);
    if (t === TILE.WALL || t === TILE.VOID || t === TILE.PIT || t === TILE.DOOR) return false;
    return !(this.blocked && this.blocked[ty * this.w + tx]);
  }

  computeFlow() {
    const p = this.player;
    const ptx = clamp(Math.floor(p.x / TS), 0, this.w - 1), pty = clamp(Math.floor(p.y / TS), 0, this.h - 1);
    const idx = pty * this.w + ptx;
    if (idx === this.flowTile && this.flow) return;
    this.flowTile = idx;
    const n = this.w * this.h;
    if (!this.flow || this.flow.length !== n) this.flow = new Int16Array(n);
    const f = this.flow;
    f.fill(-1);
    const q = this._flowQ && this._flowQ.length >= n ? this._flowQ : (this._flowQ = new Int32Array(n));
    let head = 0, tail = 0;
    f[idx] = 0; q[tail++] = idx;
    const W = this.w;
    while (head < tail) {
      const c = q[head++];
      const cx = c % W, cy = (c - cx) / W, d = f[c] + 1;
      if (cx > 0 && f[c - 1] < 0 && this.walkableTile(cx - 1, cy)) { f[c - 1] = d; q[tail++] = c - 1; }
      if (cx < W - 1 && f[c + 1] < 0 && this.walkableTile(cx + 1, cy)) { f[c + 1] = d; q[tail++] = c + 1; }
      if (cy > 0 && f[c - W] < 0 && this.walkableTile(cx, cy - 1)) { f[c - W] = d; q[tail++] = c - W; }
      if (cy < this.h - 1 && f[c + W] < 0 && this.walkableTile(cx, cy + 1)) { f[c + W] = d; q[tail++] = c + W; }
    }
  }

  /** Unit vector along the shortest walkable path to the player (ground units). */
  flowDir(x, y) {
    const p = this.player;
    const dxp = p.x - x, dyp = p.y - y;
    const dp = Math.hypot(dxp, dyp);
    if (dp < 1e-3) return { x: 0, y: 0 };
    if (dp < TS * 1.5 || this.hasClearPath(x, y, p.x, p.y, false)) return { x: dxp / dp, y: dyp / dp };
    const f = this.flow;
    if (!f) return { x: dxp / dp, y: dyp / dp };
    const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return { x: dxp / dp, y: dyp / dp };
    const W = this.w;
    let best = f[ty * W + tx], bx = 0, by = 0;
    if (best < 0) best = 32767;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox, ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.h) continue;
        const d = f[ny * W + nx];
        if (d < 0 || d >= best) continue;
        if (ox && oy && (f[ty * W + nx] < 0 || f[ny * W + tx] < 0)) continue; // no corner cutting
        best = d; bx = ox; by = oy;
      }
    }
    if (!bx && !by) return { x: 0, y: 0 };
    // steer toward the centre of the chosen tile
    const cx = (tx + bx + 0.5) * TS - x, cy = (ty + by + 0.5) * TS - y;
    const l = Math.hypot(cx, cy) || 1;
    return { x: cx / l, y: cy / l };
  }

  nearestFloor(x, y) {
    const tx0 = clamp(Math.floor(x / TS), 0, this.w - 1), ty0 = clamp(Math.floor(y / TS), 0, this.h - 1);
    for (let rad = 0; rad < Math.max(this.w, this.h); rad++) {
      for (let oy = -rad; oy <= rad; oy++) {
        for (let ox = -rad; ox <= rad; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== rad) continue;
          const tx = tx0 + ox, ty = ty0 + oy;
          if (this.tileAt(tx, ty) === TILE.FLOOR && this.walkableTile(tx, ty)) return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
        }
      }
    }
    return { x, y };
  }

  randomFloorPos(opts = {}) {
    const { minPlayerDist = 0, maxPlayerDist = Infinity, flying = false, margin = 1 } = opts;
    const p = this.player;
    for (let i = 0; i < 60; i++) {
      const tx = this.rng.int(margin, this.w - 1 - margin), ty = this.rng.int(margin, this.h - 1 - margin);
      const t = this.tileAt(tx, ty);
      const ok = flying ? (t !== TILE.WALL && t !== TILE.VOID && t !== TILE.DOOR) : (t === TILE.FLOOR && this.walkableTile(tx, ty) && (!this.flow || this.flow[ty * this.w + tx] >= 0));
      if (!ok) continue;
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < minPlayerDist || d > maxPlayerDist) continue;
      return { x, y };
    }
    // relax distance constraints
    for (let i = 0; i < 200; i++) {
      const tx = this.rng.int(1, this.w - 2), ty = this.rng.int(1, this.h - 2);
      if (this.tileAt(tx, ty) === TILE.FLOOR && this.walkableTile(tx, ty)) return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
    }
    return { x: p.x, y: p.y };
  }

  clampToRoom(x, y, margin = 8) {
    return { x: clamp(x, TS + margin, (this.w - 1) * TS - margin), y: clamp(y, TS + margin, (this.h - 1) * TS - margin) };
  }

  // -------------------------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------------------------
  spawnEnemy(id, x, y, opts = {}) {
    const def = enemyDef(id);
    const run = this.run, diff = run.difficulty.mods;
    const biomeFloor = (BIOMES[def.biome] && BIOMES[def.biome].floor) || run.floorIndex;
    const delta = Math.max(0, run.floorIndex - biomeFloor);
    const hpScale = (1 + 0.5 * delta) * (def.boss ? (diff.bossHp ?? 1) : (diff.enemyHp ?? 1)) * (opts.hpMul ?? 1);
    const dmgMul = 1 + 0.22 * delta;
    const e = {
      def, id, uid: this.nextUid++, name: def.name,
      x, y, vx: 0, vy: 0, r: def.r ?? 6, flying: !!def.flying,
      hp: 1, maxHp: Math.max(1, Math.round(def.hp * hpScale)),
      speed: def.speed * (diff.enemySpeed ?? 1), damage: (def.damage || 0) * dmgMul, dmgMul, mass: def.mass ?? 1,
      facing: 0, flipX: false, state: 'idle', stateT: 0, _state: 'idle', anim: 'idle', animT: 0, _anim: 'idle',
      flash: 0, dead: false, hidden: false, invuln: false, untargetable: !!def.untargetable, contact: def.contact !== false,
      spawnT: opts.delay ?? (opts.summoned ? 0.35 : 0.6), spawnMax: 0,
      elite: [], affixes: [], boss: !!def.boss, summoned: !!opts.summoned, noXp: !!opts.noXp,
      statuses: {}, slowMul: 1, frozen: false, stunned: false, dmgTakenMul: 1, dmgDealtMul: 1, freezeImmune: 0,
      kbx: 0, kby: 0, hpBarT: 0, shockCd: 0, blockedX: false, blockedY: false, xpMul: 1, sparkMul: 1,
      data: {},
    };
    e.spawnMax = e.spawnT;
    // elite affixes
    let affixIds = [];
    if (Array.isArray(opts.elite)) affixIds = opts.elite.filter((a) => AFFIXES[a]);
    else if (opts.elite > 0 && !def.boss) {
      const n = Math.min(3, opts.elite + (diff.extraAffixes || 0));
      affixIds = this.rng.sample(Object.keys(AFFIXES), n);
    }
    if (affixIds.length) {
      e.maxHp = Math.round(e.maxHp * 1.7);
      e.xpMul = 2.5; e.sparkMul = 3;
      for (const a of affixIds) {
        const af = AFFIXES[a];
        e.elite.push(a); e.affixes.push(af);
        try { af.apply && af.apply(this, e); } catch (err) { console.error(`[affix] ${a}.apply failed`, err); }
      }
      e.name = `${e.affixes.map((a) => a.name).join(' ')} ${def.name}`.trim();
      e.maxHp = Math.max(1, Math.round(e.maxHp));
    }
    e.hp = e.maxHp;
    e.ai = aiFor(def.ai);
    this.enemies.push(e);
    try { e.ai.init && e.ai.init(this, e); } catch (err) { console.error(`[ai] ${def.ai}.init failed`, err); }
    try { def.hooks && def.hooks.onSpawn && def.hooks.onSpawn(this, e); } catch (err) { console.error(`[enemy] ${id}.onSpawn failed`, err); }
    if (e.boss && !opts.summoned) {
      this.boss = e;
      bus.emit('boss:start', { boss: e });
    }
    bus.emit('enemy:spawn', { enemy: e });
    return e;
  }

  spawnProjectile(spec) {
    const p = makeProjectile(this, spec);
    this.projectiles.push(p);
    return p;
  }

  spawnZone(spec) {
    const z = makeZone(this, spec);
    this.zones.push(z);
    return z;
  }

  spawnPickup(kind, x, y, opts = {}) {
    const pk = makePickup(this, kind, x, y, opts);
    this.pickups.push(pk);
    return pk;
  }

  dropLoot(x, y, loot = {}) {
    let sparks = Math.round((loot.sparks || 0));
    while (sparks > 0) {
      const v = sparks >= 25 ? 10 : sparks >= 10 ? 5 : 1;
      this.spawnPickup('spark', x, y, { amount: v, burst: true });
      sparks -= v;
    }
    let xp = loot.xp || 0;
    while (xp > 0.01) {
      const v = xp >= 20 ? 10 : xp >= 6 ? 3 : Math.min(xp, 1);
      this.spawnPickup('xp', x, y, { amount: v, burst: true });
      xp -= v;
    }
    for (let i = 0; i < (loot.hearts || 0); i++) this.spawnPickup('heart', x, y, { burst: true });
    let ash = Math.round(loot.ash || 0);
    while (ash > 0) {
      const v = ash >= 10 ? 5 : 1;
      this.spawnPickup('ash', x, y, { amount: v, burst: true });
      ash -= v;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------
  findNearestEnemy(x, y, maxDist = Infinity, filter) {
    let best = null, bd = maxDist * maxDist;
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || e.hidden || e.untargetable || e.spawnT > 0) continue;
      if (filter && !filter(e)) continue;
      const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  enemiesInRadius(x, y, r) {
    const out = [];
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || e.hidden || e.spawnT > 0) continue;
      const dx = e.x - x, dy = e.y - y, rr = r + e.r;
      if (dx * dx + dy * dy <= rr * rr) out.push(e);
    }
    return out;
  }

  aliveEnemies() {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  // -------------------------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------------------------
  damageEnemy(enemy, amount, info = {}) {
    if (!enemy || enemy.dead || enemy.invuln || enemy.hidden || enemy.spawnT > 0 || !(amount > 0)) return 0;
    const run = this.run, p = this.player, s = p.stats;
    const type = info.type || 'phys';
    let dmg = amount * (enemy.dmgTakenMul ?? 1);
    const res = enemy.def.resist && enemy.def.resist[type];
    if (res) dmg *= 1 - res;
    if (enemy.boss) dmg *= s.bossDamage;
    else if (enemy.elite.length) dmg *= s.eliteDamage;
    const hit = { amount: dmg, type, crit: !!info.crit, info };
    const hooks = enemy.def.hooks;
    if (hooks && hooks.onHit) { try { hooks.onHit(this, enemy, hit); } catch (err) { console.error(`[enemy] ${enemy.id}.onHit failed`, err); } }
    for (const af of enemy.affixes) if (af.onHit) { try { af.onHit(this, enemy, hit); } catch (err) { console.error(`[affix] ${af.id}.onHit failed`, err); } }
    dmg = hit.amount;
    if (!(dmg > 0)) {
      if (!info.silent && !hit.redirected) this.fx.text(enemy.x, enemy.y - enemy.r - 4, 'Geblockt', '#9aa7b8', { small: true });
      return 0;
    }
    enemy.hp -= dmg;
    enemy.flash = 1;
    enemy.hpBarT = 3;
    if (info.knockback && enemy.mass > 0) this.knockback(enemy, info.knockback.x, info.knockback.y, info.knockback.force ?? 60);
    run.stats.damageDealt += dmg;
    if (dmg > run.stats.bestHit) run.stats.bestHit = dmg;
    if (info.crit) run.stats.critHits++;
    const killed = enemy.hp <= 0;
    if (!info.silent || info.dot) {
      this.fx.text(enemy.x + (info.dot ? this.rng.float(-4, 4) : 0), enemy.y - enemy.r - 4, dmg < 10 ? (Math.round(dmg * 10) / 10).toString() : Math.round(dmg).toString(),
        info.crit ? '#ffe75a' : TYPE_COLORS[type] || '#fff', { crit: !!info.crit, small: !!info.dot, damage: true });
    }
    if (!info.silent) this.fx.burst('hit', enemy.x, enemy.y, { color: TYPE_COLORS[type], count: info.crit ? 7 : 4 });
    bus.emit('enemy:hit', { enemy, amount: dmg, crit: !!info.crit, type, killed });
    // shock arcs to a neighbour
    if (info.proc !== false && enemy.shockCd <= 0 && hasStatus(enemy, 'shock')) {
      enemy.shockCd = 0.25;
      const other = this.findNearestEnemy(enemy.x, enemy.y, 64, (o) => o !== enemy);
      if (other) {
        this.fx.lightning(enemy.x, enemy.y, other.x, other.y, TYPE_COLORS.shock);
        this.damageEnemy(other, dmg * 0.4 * s.shockDamage, { type: 'shock', source: 'status', proc: false });
      }
    }
    // lifesteal (budgeted so it cannot make the player immortal)
    if (s.lifesteal > 0 && info.source !== 'thorns' && p.alive) {
      const heal = Math.min(dmg * s.lifesteal, p.lsBudget);
      if (heal > 0) { p.lsBudget -= heal; this.healPlayer(heal, { silent: true, raw: true }); }
    }
    if (info.proc !== false) {
      const arg = { enemy, amount: dmg, crit: !!info.crit, type, info };
      runHooks(run, 'onHit', arg);
      if (info.crit) runHooks(run, 'onCrit', arg);
    }
    if (killed && !enemy.dead) this.killEnemy(enemy, info);
    return dmg;
  }

  killEnemy(e, info = {}) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    const run = this.run, def = e.def;
    try { def.hooks && def.hooks.onDeath && def.hooks.onDeath(this, e); } catch (err) { console.error(`[enemy] ${e.id}.onDeath failed`, err); }
    for (const af of e.affixes) if (af.onDeath) { try { af.onDeath(this, e); } catch (err) { console.error(`[affix] ${af.id}.onDeath failed`, err); } }
    const elite = e.elite.length > 0;
    run.stats.kills++;
    if (elite) run.stats.eliteKills++;
    if (e.boss) run.stats.bossKills++;
    // loot
    if (!e.noXp) {
      const luck = this.player.stats.luck;
      const sp = def.sparks || [0, 1];
      const sparks = this.rng.int(sp[0], sp[1]) * e.sparkMul * (e.summoned ? 0 : 1);
      const hearts = e.boss ? 3 : (!e.summoned && this.rng.chance((elite ? 0.3 : 0.035) + luck * 0.004)) ? 1 : 0;
      this.dropLoot(e.x, e.y, {
        sparks, xp: (def.xp || 0) * e.xpMul * (e.summoned ? 0.34 : 1), hearts,
        ash: e.boss ? 0 : elite ? 2 : (!e.summoned && this.rng.chance(0.03)) ? 1 : 0,
      });
    }
    this.fx.burst('death', e.x, e.y, { color: def.color, count: e.boss ? 60 : elite ? 22 : 12 });
    this.fx.shake(e.boss ? 7 : elite ? 3 : 1.2, e.boss ? 0.7 : 0.15);
    if (e.boss || elite) this.fx.hitstop(e.boss ? 0.25 : 0.06);
    bus.emit('enemy:death', { enemy: e, elite, boss: e.boss });
    if (e.boss && this.boss === e) {
      // a boss may consist of several boss enemies (twins): only finish when no boss is left
      const other = this.enemies.find((o) => o.boss && !o.dead && !o.summoned);
      if (other) this.boss = other;
      else {
        for (const o of this.enemies) if (!o.dead) { o.noXp = true; this.killEnemy(o, { silent: true }); }
        for (const pr of this.projectiles) if (pr.team === 'enemy') pr.dead = true;
        for (const z of this.zones) if (z.team === 'enemy') z.dead = true;
        bus.emit('boss:death', { boss: e });
        this.bossDefeated = e;
      }
    }
    runHooks(run, 'onKill', { enemy: e, info });
  }

  damagePlayer(amount, info = {}) {
    const p = this.player, run = this.run, s = p.stats;
    if (!p.alive || !(amount > 0) || run.ended) return 0;
    const raw = !!info.raw;
    if (!info.unblockable && !raw) {
      if (p.iframes > 0 || p.dashing || p.invuln > 0) return 0;
      if (s.dodge > 0 && this.rng.chance(s.dodge)) {
        this.fx.text(p.x, p.y - 12, 'Ausgewichen', '#cfe8ff', { small: true });
        p.iframes = Math.max(p.iframes, 0.25);
        return 0;
      }
    }
    let dmg = amount;
    if (!raw) {
      dmg *= run.difficulty.mods.enemyDamage ?? 1;
      if (info.source && info.source.dmgDealtMul != null) dmg *= info.source.dmgDealtMul;
      const hit = { amount: dmg, type: info.type || 'phys', source: info.source || null, dot: !!info.dot };
      runHooks(run, 'onDamaged', hit);
      dmg = hit.amount;
      if (!(dmg > 0)) { p.iframes = Math.max(p.iframes, 0.2); return 0; }
      if (!info.dot) dmg = Math.max(1, dmg - s.armor);
    }
    let absorbed = 0;
    if (p.shield > 0) { absorbed = Math.min(p.shield, dmg); p.shield -= absorbed; }
    const hpLoss = dmg - absorbed;
    p.hp -= hpLoss;
    run.stats.damageTaken += dmg;
    if (!info.dot) {
      run.stats.hitsTaken++;
      run.roomHits = (run.roomHits || 0) + 1;
      if (!info.unblockable || raw) p.iframes = Math.max(p.iframes, raw ? 0.3 : s.iframes);
      else p.iframes = Math.max(p.iframes, s.iframes);
      p.hurtT = 0.25;
      this.fx.shake(Math.min(6, 2 + dmg * 0.12), 0.2);
      this.fx.flash('#ff2a2a', 0.18);
      this.fx.burst('blood', p.x, p.y, { count: 8 });
      this.fx.hitstop(0.05);
    }
    this.fx.text(p.x, p.y - 12, `-${Math.max(1, Math.round(dmg))}`, '#ff5a5a', { small: !!info.dot, player: true });
    bus.emit('player:hit', { amount: dmg, type: info.type || 'phys', source: info.source || null, hp: Math.max(0, p.hp), maxHp: s.maxHp, dot: !!info.dot });
    if (info.status && p.hp > 0) this.applyStatus(p, info.status.id, info.status);
    if (s.thorns > 0 && info.source && info.source.hp != null && !info.dot && !info.source.dead) {
      this.damageEnemy(info.source, s.thorns * s.damage, { source: 'thorns', proc: false, type: 'phys' });
    }
    if (p.hp <= 0) {
      if (runHooks(run, 'onLethal', { source: info.source || null })) {
        if (p.hp <= 0) p.hp = Math.max(1, Math.round(s.maxHp * 0.25));
        this.onRevive();
      } else if (run.revives > 0) {
        run.revives--;
        p.hp = Math.max(1, Math.round(s.maxHp * 0.3));
        this.onRevive();
      } else {
        p.hp = 0;
        p.alive = false;
        run.onPlayerDeath(info.source || null, info);
      }
    }
    return dmg;
  }

  onRevive() {
    const p = this.player;
    this.run.stats.revives = (this.run.stats.revives || 0) + 1;
    p.iframes = Math.max(p.iframes, 2.2);
    p.statuses = {};
    this.fx.flash('#ffd35a', 0.5);
    this.fx.ring(p.x, p.y, 90, '#ffd35a', 0.5);
    this.fx.burst('light', p.x, p.y, { count: 40, speed: 160 });
    for (const pr of this.projectiles) if (pr.team === 'enemy') pr.dead = true;
    for (const e of this.enemiesInRadius(p.x, p.y, 90)) {
      this.knockback(e, e.x - p.x, e.y - p.y, 260);
      this.applyStatus(e, 'stun', { duration: 1.2 });
    }
    bus.emit('player:revive', {});
  }

  healPlayer(amount, info = {}) {
    const p = this.player;
    if (!p.alive || !(amount > 0)) return 0;
    const mul = info.raw ? 1 : p.stats.healPower * (this.run.difficulty.mods.healMult ?? 1);
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + amount * mul);
    const healed = p.hp - before;
    if (healed > 0) {
      this.run.stats.healed += healed;
      if (!info.silent) {
        this.fx.text(p.x, p.y - 14, `+${Math.max(1, Math.round(healed))}`, '#7dff9a', { player: true });
        this.fx.burst('heal', p.x, p.y, { count: 10 });
        bus.emit('player:heal', { amount: healed });
      }
      runHooks(this.run, 'onHeal', { amount: healed });
    }
    return healed;
  }

  addShield(amount) {
    const p = this.player;
    const cap = Math.max(20, p.stats.maxHp * 0.6);
    const before = p.shield;
    p.shield = Math.min(cap, p.shield + amount);
    if (p.shield > before) bus.emit('player:shield', { amount: p.shield - before });
    return p.shield - before;
  }

  applyStatus(target, id, opts) { return applyStatus(this, target, id, opts || {}); }
  hasStatus(target, id) { return hasStatus(target, id); }

  /**
   * Area damage. opts.team = who deals it ('player' hurts enemies + destructible props, 'enemy' hurts the player).
   */
  explode(x, y, radius, damage, opts = {}) {
    const team = opts.team || 'player';
    const type = opts.type || 'fire';
    const color = opts.color || TYPE_COLORS[type] || '#ffb347';
    if (!opts.silent) {
      this.fx.ring(x, y, radius, color, 0.3);
      this.fx.burst('explosion', x, y, { color, count: Math.min(40, 10 + radius * 0.5) });
      this.fx.light(x, y, radius * 2.2, color, 0.3);
      this.fx.shake(Math.min(5, 1 + radius * 0.05), 0.18);
      bus.emit('explosion', { x, y, radius, team });
    }
    if (team === 'player') {
      for (const e of this.enemiesInRadius(x, y, radius)) {
        const dealt = this.damageEnemy(e, damage, {
          type, crit: !!opts.crit, source: opts.source || 'relic', weaponId: opts.weaponId, proc: opts.proc ?? false,
          knockback: opts.knockback ? { x: e.x - x, y: e.y - y, force: opts.knockback } : null,
        });
        if (opts.status && !e.dead && dealt >= 0) this.applyStatus(e, opts.status.id, opts.status);
      }
      for (const pr of this.props) {
        if (pr.removed || !pr.destructible) continue;
        if (Math.hypot(pr.x - x, pr.y - y) <= radius + pr.r) damageProp(this, pr, 1);
      }
    } else {
      const p = this.player;
      if (Math.hypot(p.x - x, p.y - y) <= radius + p.r * 0.6) {
        const dealt = this.damagePlayer(damage, { type, source: opts.source && opts.source.hp != null ? opts.source : null, status: opts.status });
        if (dealt > 0 && opts.knockback) this.knockback(p, p.x - x, p.y - y, opts.knockback);
      }
    }
  }

  knockback(e, dx, dy, force) {
    const n = norm(dx, dy);
    if (!n.len) return;
    if (e === this.player) {
      if (e.dashing) return;
      e.kbx += n.x * force; e.kby += n.y * force;
      return;
    }
    if (!(e.mass > 0)) return;
    const f = force / e.mass;
    e.kbx += n.x * f; e.kby += n.y * f;
    const l = Math.hypot(e.kbx, e.kby);
    if (l > 420) { e.kbx *= 420 / l; e.kby *= 420 / l; }
  }

  // -------------------------------------------------------------------------------------------
  // Simulation step
  // -------------------------------------------------------------------------------------------
  update(dt) {
    const run = this.run, p = this.player;
    this.time += dt;
    const room = this.room;
    p.update(this, dt);
    if (this.room !== room || run.game.state !== 'playing') return; // room changed / choice opened during player update

    // waves
    if (this.locked) {
      const spawns = room.spawns || [];
      const alive = this.aliveEnemies();
      if (this.waveIndex < spawns.length - 1) {
        if (this.waveIndex < 0 || alive === 0) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) {
            this.spawnWave(this.waveIndex + 1);
            const next = spawns[this.waveIndex + 1];
            this.waveTimer = next ? (next.delay ?? 0.8) : 0;
          }
        }
      } else if (alive === 0) {
        this.clearDelay += dt;
        if (this.clearDelay > 0.45) this.clearRoom();
      } else this.clearDelay = 0;
    }

    this.updateEnemies(dt);
    updateProjectiles(this, dt);
    updateZones(this, dt);
    updatePickups(this, dt);
    updateProps(this, dt);

    // cleanup
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.projectiles.some((q) => q.dead)) this.projectiles = this.projectiles.filter((q) => !q.dead);
    if (this.zones.some((z) => z.dead)) this.zones = this.zones.filter((z) => !z.dead);
    if (this.pickups.some((k) => k.dead)) this.pickups = this.pickups.filter((k) => !k.dead);
    if (this.boss && this.boss.dead) this.boss = null;

    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.12; this.computeFlow(); }
  }

  updateEnemies(dt) {
    const p = this.player;
    const es = this.enemies;
    const n = es.length; // enemies spawned during this loop start next tick
    for (let i = 0; i < n; i++) {
      const e = es[i];
      if (e.dead) continue;
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 6);
      if (e.hpBarT > 0) e.hpBarT -= dt;
      if (e.shockCd > 0) e.shockCd -= dt;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        if (e.spawnT <= 0) this.fx.burst('spawn', e.x, e.y, { color: e.def.color, count: 8 });
        continue;
      }
      updateStatuses(this, e, dt);
      if (e.dead) continue;
      if (!e.frozen && !e.stunned) {
        try { e.ai.update(this, e, dt); } catch (err) {
          if (!e._aiErr) { e._aiErr = true; console.error(`[ai] ${e.def.ai}.update failed for ${e.id}`, err); }
        }
        for (let a = 0; a < e.affixes.length; a++) {
          const af = e.affixes[a];
          if (af.update) { try { af.update(this, e, dt); } catch (err) { if (!e._afErr) { e._afErr = true; console.error(`[affix] ${af.id}.update failed`, err); } } }
        }
        if (e.dead) continue;
        e.animT += dt;
      }
      // auto-reset timers when AI switches state/anim
      if (e.state !== e._state) { e._state = e.state; e.stateT = 0; } else e.stateT += dt;
      if (e.anim !== e._anim) { e._anim = e.anim; e.animT = 0; }
      // knockback
      if (e.kbx || e.kby) {
        this.moveEntity(e, e.kbx * dt, e.kby * dt);
        const decay = Math.pow(0.0015, dt);
        e.kbx *= decay; e.kby *= decay;
        if (Math.abs(e.kbx) < 2) e.kbx = 0;
        if (Math.abs(e.kby) < 2) e.kby = 0;
      }
      // contact damage
      if (e.contact && e.damage > 0 && !e.hidden && !e.frozen && p.alive) {
        const dx = p.x - e.x, dy = p.y - e.y, rr = e.r + p.r - 2;
        if (dx * dx + dy * dy < rr * rr) {
          const dealt = this.damagePlayer(e.damage, { source: e, type: e.def.contactType || 'phys' });
          if (dealt > 0) this.knockback(p, dx, dy, 150);
        }
      }
    }
    // soft separation so enemies do not stack on one spot (every other tick)
    this.sepT ^= 1;
    if (this.sepT) {
      for (let i = 0; i < es.length; i++) {
        const a = es[i];
        if (a.dead || a.spawnT > 0 || a.hidden || !(a.mass > 0)) continue;
        for (let j = i + 1; j < es.length; j++) {
          const b = es[j];
          if (b.dead || b.spawnT > 0 || b.hidden || !(b.mass > 0) || a.flying !== b.flying) continue;
          const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.85;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-4) continue;
          const d = Math.sqrt(d2), push = (rr - d) * 0.5;
          const ma = b.mass / (a.mass + b.mass), mb = a.mass / (a.mass + b.mass);
          const nx = dx / d, ny = dy / d;
          this.moveEntity(a, -nx * push * ma, -ny * push * ma);
          this.moveEntity(b, nx * push * mb, ny * push * mb);
        }
      }
    }
  }
}
