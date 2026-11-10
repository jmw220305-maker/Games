#!/usr/bin/env node
// Headless simulation harness: runs the real Game with a bot at fixed 1/60 s steps.
//
//   node tools/sim.mjs [--seconds 120] [--seed abc] [--floor 1] [--god] [--character bearer]
//                      [--difficulty 0] [--fallback] [--verbose] [--quiet] [--strict] [--json]
//
// Uses src/gen/floorgen.js and src/meta/progression.js when they exist (else the built-in fallback floor and
// neutral meta). Prints a compact report. Exit code 1 on an uncaught exception (or with --strict on any console.error).
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => pathToFileURL(resolve(ROOT, p)).href;

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const o = { seconds: 120, seed: null, floor: 1, god: false, character: 'bearer', difficulty: 0, verbose: false, quiet: false, strict: false, json: false, fallback: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    switch (a) {
      case '--seconds': case '-s': o.seconds = Number(val()) || o.seconds; break;
      case '--seed': o.seed = String(val()); break;
      case '--floor': o.floor = Math.max(1, Math.min(5, Number(val()) || 1)); break;
      case '--god': o.god = true; break;
      case '--character': case '--char': o.character = String(val()); break;
      case '--difficulty': case '--diff': o.difficulty = Math.max(0, Number(val()) || 0); break;
      case '--verbose': case '-v': o.verbose = true; break;
      case '--quiet': case '-q': o.quiet = true; break;
      case '--strict': o.strict = true; break;
      case '--json': o.json = true; break;
      case '--fallback': o.fallback = true; break;
      case '--help': case '-h': o.help = true; break;
      default: if (a.startsWith('--')) console.warn(`unbekannte Option ${a}`);
    }
  }
  return o;
}

// ---------------------------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------------------------
const DT = 1 / 60;

export class Bot {
  constructor(game, mods) {
    this.game = game;
    this.input = game.input;
    this.TS = mods.TS; this.TILE = mods.TILE; this.zoneContains = mods.zoneContains;
    this.path = null; this.pathI = 0; this.goal = null; this.repathT = 0;
    this.skip = new Set();          // props the bot gave up on
    this.stuckT = 0; this.lastX = 0; this.lastY = 0; this.wiggleT = 0; this.wiggle = { x: 0, y: 0 };
    this.strafe = 1; this.strafeT = 0;
    this.roomKey = null;
    this.t = 0;
  }

  // --- tile helpers -----------------------------------------------------------------------------
  passable(w, tx, ty, avoid) {
    const T = this.TILE;
    const t = w.tileAt(tx, ty);
    if (t === T.WALL || t === T.VOID || t === T.PIT) return false;
    if (t === T.DOOR && w.locked) return false;
    if (avoid && (t === T.HAZARD || t === T.SPIKES)) return false;
    if (w.blocked && w.blocked[ty * w.w + tx]) return false;
    return true;
  }

  bfs(w, goalFn, avoid) {
    const TS = this.TS, W = w.w, H = w.h, p = w.player;
    const sx = Math.floor(p.x / TS), sy = Math.floor(p.y / TS);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
    const prev = new Int32Array(W * H).fill(-2);
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    const s = sy * W + sx;
    prev[s] = -1; q[tail++] = s;
    while (head < tail) {
      const c = q[head++];
      const cx = c % W, cy = (c - cx) / W;
      if (goalFn(cx, cy)) {
        const out = [];
        for (let k = c; k >= 0; k = prev[k]) out.push(k);
        out.reverse();
        return out.map((k) => ({ x: ((k % W) + 0.5) * TS, y: (Math.floor(k / W) + 0.5) * TS }));
      }
      const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (prev[k] !== -2) continue;
        if (!this.passable(w, nx, ny, avoid)) {
          // goal tiles may hold a solid prop (loot lying under a pedestal) but never a wall/pit
          const t = w.tileAt(nx, ny);
          if (!goalFn(nx, ny) || t === this.TILE.WALL || t === this.TILE.VOID || t === this.TILE.PIT || (t === this.TILE.DOOR && w.locked)) continue;
        }
        prev[k] = c; q[tail++] = k;
      }
    }
    return null;
  }

  pathTo(w, key, goalFn) {
    if (this.goal !== key || this.repathT <= 0 || !this.path) {
      this.goal = key;
      this.repathT = 0.4;
      this.path = this.bfs(w, goalFn, true) || this.bfs(w, goalFn, false);
      this.pathI = 1;
    }
    return this.path;
  }

  follow(w) {
    const p = w.player, path = this.path;
    if (!path) return null;
    while (this.pathI < path.length && Math.hypot(path[this.pathI].x - p.x, path[this.pathI].y - p.y) < 3) this.pathI++;
    const wp = path[Math.min(this.pathI, path.length - 1)];
    const dx = wp.x - p.x, dy = wp.y - p.y, d = Math.hypot(dx, dy);
    if (d < 0.5) return { x: 0, y: 0 };
    return { x: dx / d, y: dy / d };
  }

  // --- decisions --------------------------------------------------------------------------------
  pickChoice(choice) {
    const opt = choice.options.find((o) => !o.disabled);
    if (opt) opt.pick();
    else if (choice.skip) choice.skip();
    else this.game.resolveChoice(choice);
  }

  propWanted(w, pr) {
    const p = w.player;
    if (pr.removed || pr.used || !pr.interactive || this.skip.has(pr)) return false;
    switch (pr.kind) {
      case 'chest': return !pr.locked;
      case 'pedestal': return pr.offer && pr.offer.price <= p.sparks;
      case 'shrine': return true;
      case 'forge': return p.sparks >= 40;
      case 'fountain': return p.hp < p.stats.maxHp * 0.8;
      default: return false;
    }
  }

  /** Next room to walk to (first step direction), exploring everything before the boss. */
  nextDoor(w, run) {
    const rooms = run.floor.rooms, cur = run.roomId;
    const dist = new Map([[cur, null]]);
    const q = [cur];
    const order = [];
    while (q.length) {
      const id = q.shift();
      order.push(id);
      const r = rooms[id];
      for (const dir in r.doors) {
        const to = r.doors[dir].to;
        if (dist.has(to) || !rooms[to]) continue;
        dist.set(to, dist.get(id) === null ? dir : dist.get(id));
        q.push(to);
      }
    }
    const bossId = run.floor.bossRoomId;
    let target = order.find((id) => id !== cur && !rooms[id].visited && id !== bossId);
    if (target == null && !rooms[bossId].visited) target = bossId;
    if (target == null) target = order.find((id) => id !== cur && !rooms[id].cleared);
    if (target == null && cur !== bossId) target = bossId;
    if (target == null || target === cur) return null;
    return dist.get(target);
  }

  canLand(w, x, y, dx, dy) {
    const p = w.player;
    const len = 105 * p.stats.dashDistance;
    for (let t = 0.25; t <= 1.0001; t += 0.25) {
      if (w.isSolidPx(x + dx * len * t, y + dy * len * t, true)) return t > 0.5 && w.canStand(x + dx * len * (t - 0.25), y + dy * len * (t - 0.25), p.r, false);
    }
    return w.canStand(x + dx * len, y + dy * len, p.r, false);
  }

  tryDash(w, dx, dy) {
    const p = w.player;
    if (p.dash.charges <= 0 || p.dashing) return false;
    const cands = [[dx, dy], [-dy, dx], [dy, -dx], [-dx, -dy]];
    for (const [cx, cy] of cands) {
      if (this.canLand(w, p.x, p.y, cx, cy)) {
        this.input.setMove(cx, cy);
        this.input.press('dash');
        return true;
      }
    }
    return false;
  }

  combat(w, dt) {
    const p = w.player, input = this.input;
    let near = null, nd = Infinity, close = 0;
    for (const e of w.enemies) {
      if (e.dead || e.hidden) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < nd) { nd = d; near = e; }
      if (d < 80 && e.spawnT <= 0) close++;
    }
    let mx = 0, my = 0;
    // threats: incoming shots and telegraphs
    let threat = null;
    for (const pr of w.projectiles) {
      if (pr.team !== 'enemy' || pr.dead || pr.z > 4) continue;
      const rx = p.x - pr.x, ry = p.y - pr.y, d = Math.hypot(rx, ry);
      if (d > 40) continue;
      if (rx * pr.vx + ry * pr.vy > 0) { threat = { x: -pr.vy, y: pr.vx }; break; }
    }
    for (const z of w.zones) {
      if (z.team !== 'enemy' || z.dead) continue;
      if (!this.zoneContains(z, p.x, p.y, p.r + 4)) continue;
      const ax = p.x - z.x, ay = p.y - z.y, l = Math.hypot(ax, ay) || 1;
      mx += ax / l * 2; my += ay / l * 2;
      if (!z.active && z.delay - z.age < 0.25) threat = threat || { x: ax / l, y: ay / l };
    }
    if (near) {
      const ws = p.weapon;
      const want = Math.max(45, Math.min(120, ((ws && ws.stats.range) || 180) * p.stats.range * 0.55));
      const dx = near.x - p.x, dy = near.y - p.y, l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 1.2 + (this.t % 0.7); this.strafe = -this.strafe; }
      if (!w.lineOfSight(p.x, p.y, near.x, near.y) || nd > want * 1.4) {
        const tx = Math.floor(near.x / this.TS), ty = Math.floor(near.y / this.TS);
        this.pathTo(w, `enemy:${near.uid}:${tx},${ty}`, (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 2);
        const f = this.follow(w);
        if (f) { mx += f.x; my += f.y; } else { mx += ux; my += uy; }
      } else if (nd < want * 0.6) {
        mx += -ux + -uy * this.strafe * 0.6; my += -uy + ux * this.strafe * 0.6;
      } else {
        mx += -uy * this.strafe; my += ux * this.strafe;
      }
      if (p.skill.def && p.skill.cd <= 0 && (close >= 2 || near.boss || nd < 40)) input.press('skill');
    }
    let ml = Math.hypot(mx, my);
    if (ml > 1e-3) {
      mx /= ml; my /= ml;
      // steer around walls/pits
      if (!w.canStand(p.x + mx * 10, p.y + my * 10, p.r, false)) {
        const alts = [[-my, mx], [my, -mx], [-mx, -my]];
        for (const [ax, ay] of alts) if (w.canStand(p.x + ax * 10, p.y + ay * 10, p.r, false)) { mx = ax; my = ay; break; }
      }
    }
    input.setMove(mx, my);
    if (threat) {
      const tl = Math.hypot(threat.x, threat.y) || 1;
      this.tryDash(w, threat.x / tl, threat.y / tl);
    } else if (near && nd < 18 && !near.boss) {
      const l = nd || 1;
      this.tryDash(w, (p.x - near.x) / l, (p.y - near.y) / l);
    }
  }

  explore(w, run, dt) {
    const p = w.player, input = this.input, TS = this.TS;
    let goalKey = null, goalFn = null, prop = null;
    // pickups first (hearts only when hurt)
    let best = null, bd = Infinity;
    for (const pk of w.pickups) {
      if (pk.dead || this.skip.has(pk) || (pk.kind === 'heart' && p.hp >= p.stats.maxHp)) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d < bd) { bd = d; best = pk; }
    }
    let pickup = null;
    if (best && bd > p.stats.pickupRadius * 0.6) {
      pickup = best;
      const tx = Math.floor(best.x / TS), ty = Math.floor(best.y / TS);
      goalKey = `pk:${tx},${ty}`; goalFn = (x, y) => x === tx && y === ty;
    } else if (!best) {
      let pb = null, pd = Infinity;
      for (const pr of w.props) {
        if (!this.propWanted(w, pr)) continue;
        const d = Math.hypot(pr.x - p.x, pr.y - p.y);
        if (d < pd) { pd = d; pb = pr; }
      }
      if (!pb) {
        const portal = w.props.find((pr) => pr.kind === 'portal' && !pr.removed && !pr.used && !this.skip.has(pr));
        // take the portal only once the floor has nothing left to explore
        if (portal && this.nextDoor(w, run) == null) pb = portal;
      }
      if (pb) {
        prop = pb;
        const tx = Math.floor(pb.x / TS), ty = Math.floor(pb.y / TS);
        goalKey = `prop:${tx},${ty}`;
        goalFn = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 1 && !(pb.solid && x === tx && y === ty);
      } else {
        const dir = this.nextDoor(w, run);
        const door = dir ? w.room.doors[dir] : null;
        if (door) {
          const vertical = dir === 'n' || dir === 's';
          goalKey = `door:${dir}`;
          goalFn = (x, y) => (vertical ? (y === door.ty && (x === door.tx || x === door.tx + 1)) : (x === door.tx && (y === door.ty || y === door.ty + 1)));
        }
      }
    }
    if (prop && (w.interactProp === prop || Math.hypot(prop.x - p.x, prop.y - p.y) <= prop.r + 8)) {
      const dx = prop.x - p.x, dy = prop.y - p.y, l = Math.hypot(dx, dy) || 1;
      input.setMove(l > prop.r + 7 ? dx / l : 0, l > prop.r + 7 ? dy / l : 0);
      if (w.interactProp === prop) input.press('interact');
      // one attempt per prop (forges/shrines may stay usable; the bot moves on)
      this.attempts = (this.attempts || 0) + 1;
      if (this.attempts > 20) { this.skip.add(prop); this.attempts = 0; }
      return;
    }
    this.attempts = 0;
    if (!goalFn) { input.setMove(0, 0); return; }
    this.pathTo(w, goalKey, goalFn);
    if (!this.path) {
      if (prop) this.skip.add(prop);
      if (pickup) this.skip.add(pickup);
      input.setMove(0, 0);
      return;
    }
    let f = this.follow(w) || { x: 0, y: 0 };
    if (prop && this.pathI >= this.path.length - 1 && Math.hypot(f.x, f.y) < 0.1) {
      const dx = prop.x - p.x, dy = prop.y - p.y, l = Math.hypot(dx, dy) || 1;
      f = { x: dx / l, y: dy / l };
    }
    input.setMove(f.x, f.y);
  }

  tick(dt) {
    const game = this.game, input = this.input;
    this.t += dt;
    input.setMove(0, 0);
    if (game.state === 'choice' && game.choice) { this.pickChoice(game.choice); return; }
    if (game.state === 'paused') { game.resume(); return; }
    if (game.state !== 'playing' || !game.run) return;
    const run = game.run, w = run.world, p = run.player;
    if (run.ended) return;
    const key = `${run.floorIndex}:${run.roomId}`;
    if (key !== this.roomKey) { this.roomKey = key; this.path = null; this.goal = null; this.stuckT = 0; }
    this.repathT -= dt;
    input.hold('fire', true);
    if (this.wiggleT > 0) {
      this.wiggleT -= dt;
      input.setMove(this.wiggle.x, this.wiggle.y);
      return;
    }
    const fighting = w.locked || w.enemies.some((e) => !e.dead && !e.hidden);
    if (fighting) this.combat(w, dt);
    else this.explore(w, run, dt);
    // stuck detection
    const mv = input.move;
    if (Math.hypot(mv.x, mv.y) > 0.3 && Math.hypot(p.x - this.lastX, p.y - this.lastY) < 0.15) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 0.5);
    this.lastX = p.x; this.lastY = p.y;
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      const a = (this.t * 2.39996) % (Math.PI * 2);
      this.wiggle = { x: Math.cos(a), y: Math.sin(a) };
      this.wiggleT = 0.4;
      this.path = null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------
/** Install god mode: the player cannot drop below 1 HP (damage is still applied and counted). */
export function installGodMode(run) {
  const w = run.world;
  const orig = w.damagePlayer.bind(w);
  w.damagePlayer = (amount, info) => {
    const p = w.player;
    const saved = p.hp, BOOST = 1e7;
    p.hp += BOOST;
    const dealt = orig(amount, info);
    p.hp = Math.min(p.stats.maxHp, Math.max(1, saved - (saved + BOOST - p.hp)));
    return dealt;
  };
}

async function loadOptional(path, label, errors) {
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return null;
  try { return await import(mod(path)); } catch (err) {
    errors.push(`${label}: ${err && err.stack || err}`);
    return null;
  }
}

/**
 * Run one simulation. Returns a result object (also used by tests).
 * @param {object} o parsed options (see parseArgs)
 */
export async function simulate(o = {}) {
  o = { ...parseArgs([]), ...o };
  const loadErrors = [];
  const errLog = [];
  let errorCount = 0, warnCount = 0;
  const origError = console.error, origWarn = console.warn;
  console.error = (...args) => {
    errorCount++;
    if (errLog.length < 12) errLog.push(args.map((a) => (a && a.stack) ? a.stack.split('\n').slice(0, 3).join(' | ') : String(a)).join(' '));
    if (!o.quiet && !o.json && errorCount <= 12) origError(...args);
  };
  console.warn = (...args) => {
    warnCount++;
    if (o.verbose && !o.json) origWarn(...args);
  };
  try {
    const { Game, makeStubInput, defaultSaveLite } = await import(mod('src/game/game.js'));
    const { bus } = await import(mod('src/core/events.js'));
    const { TS, TILE } = await import(mod('src/game/constants.js'));
    const { zoneContains } = await import(mod('src/game/entities.js'));
    const gen = o.fallback ? null : await loadOptional('src/gen/floorgen.js', 'src/gen/floorgen.js', loadErrors);
    const prog = await loadOptional('src/meta/progression.js', 'src/meta/progression.js', loadErrors);
    const saveMod = await loadOptional('src/meta/save.js', 'src/meta/save.js', loadErrors);
    for (const e of loadErrors) console.error('[sim] Laden fehlgeschlagen:', e);

    const save = saveMod && saveMod.defaultSave ? saveMod.defaultSave() : defaultSaveLite();
    const game = new Game({
      input: makeStubInput(),
      meta: prog || undefined,
      generateFloor: gen && typeof gen.generateFloor === 'function' ? gen.generateFloor : undefined,
      save,
    });
    const events = {};
    const timeline = [];
    let simT = 0;
    const offAll = bus.on('*', (evt, pl) => {
      events[evt] = (events[evt] || 0) + 1;
      if (evt === 'floor:enter' || evt === 'boss:start' || evt === 'boss:death' || evt === 'room:clear' || evt === 'run:end' || evt === 'player:death') {
        let what = evt;
        if (evt === 'floor:enter') what += ` ${pl.floor.index} (${pl.biome.name})`;
        if (evt === 'boss:start' || evt === 'boss:death') what += ` ${pl.boss.name}`;
        if (evt === 'room:clear') what += ` #${pl.room.id} ${pl.room.type}`;
        timeline.push(`${simT.toFixed(1).padStart(6)}s  ${what}`);
        if (o.verbose && !o.json) console.log(`${simT.toFixed(1).padStart(6)}s  ${what}`);
      }
    });

    const run = game.startRun({ character: o.character, difficulty: o.difficulty, seed: o.seed || 'sim' });
    if (o.god) installGodMode(run);
    if (o.floor > 1) {
      run.startFloor(o.floor);
      run.player.gainXp(400 * (o.floor - 1));
    }
    const bot = new Bot(game, { TS, TILE, zoneContains });
    const real0 = performance.now();
    const steps = Math.round(o.seconds / DT);
    let crashed = null, lastProgress = 0, lastRooms = -1, stalled = false;
    for (let i = 0; i < steps; i++) {
      try {
        bot.tick(DT);
        game.update(DT);
      } catch (err) {
        crashed = err;
        break;
      }
      simT += DT;
      if (game.state === 'dead' || game.state === 'victory' || game.state === 'menu') break;
      const prog = run.stats.roomsCleared + run.stats.kills + run.floorIndex * 100;
      if (prog !== lastRooms) { lastRooms = prog; lastProgress = simT; }
      else if (simT - lastProgress > 90) { stalled = true; break; }
    }
    const realMs = performance.now() - real0;
    offAll();
    const p = run.player;
    const result = {
      seed: run.seedLabel, character: run.character, difficulty: run.diffLevel, god: !!o.god,
      floorgen: gen && gen.generateFloor ? 'src/gen/floorgen.js' : 'fallback',
      meta: prog ? 'src/meta/progression.js' : 'neutral',
      outcome: crashed ? 'crash' : game.state === 'victory' ? 'victory' : game.state === 'dead' ? 'dead' : stalled ? 'stalled' : 'timeout',
      killedBy: run.killedBy ? run.killedBy.name : null,
      simSeconds: simT, realMs, speed: realMs > 0 ? (simT * 1000) / realMs : Infinity,
      floor: run.floorIndex, room: run.roomId,
      stats: { ...run.stats },
      level: p.level, hp: Math.round(p.hp), maxHp: Math.round(p.stats.maxHp), sparks: p.sparks,
      relics: p.relics.map((r) => r.def.id), boons: p.boons.map((b) => `${b.def.id}×${b.stacks}`),
      weapons: p.weapons.filter(Boolean).map((ws) => `${ws.id} L${ws.level}`),
      events, timeline, errors: errorCount, warnings: warnCount, errorSamples: errLog,
      crash: crashed ? (crashed.stack || String(crashed)) : null,
    };
    return result;
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
}

function fmt(n) { return Math.round(n).toLocaleString('de-DE'); }

function printReport(r) {
  const out = [];
  const outcome = { victory: 'SIEG', dead: `TOD${r.killedBy ? ` (durch ${r.killedBy})` : ''}`, timeout: 'Zeitlimit erreicht', stalled: 'Bot steckt fest (90 s ohne Fortschritt)', crash: 'ABSTURZ' }[r.outcome];
  out.push(`Nachtglut-Sim  seed=${r.seed}  char=${r.character}  diff=${r.difficulty}${r.god ? '  god' : ''}  gen=${r.floorgen}  meta=${r.meta}`);
  out.push(`Ergebnis   ${outcome} nach ${r.simSeconds.toFixed(1)} s Spielzeit (${(r.realMs / 1000).toFixed(2)} s real, ${r.speed.toFixed(0)}×)`);
  const s = r.stats;
  out.push(`Fortschritt Ebene ${r.floor}, Räume geräumt ${s.roomsCleared}, Ebenen abgeschlossen ${s.floorsCleared}`);
  out.push(`Kampf      Kills ${s.kills} (Elite ${s.eliteKills}, Bosse ${s.bossKills}), Schaden ausgeteilt ${fmt(s.damageDealt)}, erlitten ${fmt(s.damageTaken)} (${s.hitsTaken} Treffer), bester Treffer ${fmt(s.bestHit)}`);
  out.push(`Spieler    Stufe ${r.level}, Leben ${r.hp}/${r.maxHp}, Funken ${r.sparks} (gesammelt ${s.sparksCollected}, ausgegeben ${s.sparksSpent}), Dashes ${s.dashes}, Stürze ${s.falls}`);
  out.push(`Waffen     ${r.weapons.join(', ') || '–'}`);
  out.push(`Relikte    ${r.relics.join(', ') || '–'}`);
  out.push(`Segen      ${r.boons.join(', ') || '–'}`);
  const ev = r.events;
  const keys = ['enemy:spawn', 'enemy:death', 'weapon:fire', 'prop:open', 'shop:buy', 'shop:fail', 'relic:gain', 'curse:gain', 'boon:gain', 'weapon:gain', 'weapon:upgrade', 'player:levelup', 'player:fall', 'player:skill', 'portal:enter', 'boss:start', 'boss:death', 'ui:choice'];
  out.push(`Events     ${keys.filter((k) => ev[k]).map((k) => `${k}=${ev[k]}`).join('  ')}`);
  out.push(`Konsole    console.error ${r.errors}, console.warn ${r.warnings}`);
  for (const e of r.errorSamples.slice(0, 5)) out.push(`  ! ${e.slice(0, 300)}`);
  if (r.crash) out.push(`ABSTURZ:\n${r.crash}`);
  console.log(out.join('\n'));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log('node tools/sim.mjs [--seconds 120] [--seed abc] [--floor 1] [--god] [--character bearer] [--difficulty 0] [--fallback] [--verbose] [--quiet] [--strict] [--json]');
    return 0;
  }
  const r = await simulate(o);
  if (o.json) console.log(JSON.stringify(r, null, 2));
  else printReport(r);
  if (r.outcome === 'crash') return 1;
  if (o.strict && r.errors > 0) return 1;
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}
