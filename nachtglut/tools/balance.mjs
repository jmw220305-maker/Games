#!/usr/bin/env node
// Balance harness: runs many headless bot simulations (tools/sim.mjs Bot) in parallel worker threads and
// aggregates pacing / difficulty / economy numbers.
//
//   node tools/balance.mjs --mode run   [--runs 40] [--chars bearer,shadow] [--diff 0] [--meta none|mid|full]
//   node tools/balance.mjs --mode god   [--runs 20] ...           god mode (cannot die): pacing + economy on all floors
//   node tools/balance.mjs --mode boss  [--runs 12] [--floors 1,2,3,4,5]
//                                       "typical build" boss test: floor N with weapon level N, 2N random relics,
//                                       3N random boon stacks, then straight into the boss room (god mode, lethal
//                                       hits are counted and the player is refilled, so "lethal/fight" ≈ deaths).
//   node tools/balance.mjs --mode campaign [--runs 4] [--count 100]
//                                       meta progression: sequential runs on one save, ash credited via
//                                       meta/tracker.applyRunEnd, cheapest affordable altar upgrade bought after
//                                       each run. Reports runs to first floor clears / first win / full altar.
//   common: [--workers 4] [--seconds 3000] [--seed prefix] [--json out.json] [--quiet]
//
// Modes `run` (non-god) measure difficulty, `god` measures pacing/economy across all floors. In god mode a would-be
// lethal hit is counted ("lethal") and the player is refilled to full, so "lethal per floor" estimates how many
// deaths the bot would have suffered there. The bot (tools/sim.mjs) auto-aims perfectly, never stops firing and
// dashes only away from bullets within 40 px / telegraphs about to fire: it out-aims a human but dodges worse
// (no reading of melee wind-ups / charges), and it takes the FIRST option of every choice (random build).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => pathToFileURL(resolve(ROOT, p)).href;
const SELF = fileURLToPath(import.meta.url);
const DT = 1 / 60;
const CHARS = ['bearer', 'shadow', 'warden', 'weaver', 'revenant'];

function parseArgs(argv) {
  const o = { mode: 'run', runs: 0, chars: ['bearer'], diff: 0, meta: 'none', workers: Math.min(4, availableParallelism()), seconds: 3000, seed: 'bal', json: null, floors: [1, 2, 3, 4, 5], count: 100, quiet: false, bot: 'expert' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    switch (a) {
      case '--mode': o.mode = v(); break;
      case '--runs': o.runs = Number(v()); break;
      case '--chars': o.chars = v() === 'all' ? CHARS.slice() : argv[i].split(','); break;
      case '--diff': o.diff = Number(v()); break;
      case '--meta': o.meta = v(); break;
      case '--workers': o.workers = Number(v()); break;
      case '--seconds': o.seconds = Number(v()); break;
      case '--seed': o.seed = v(); break;
      case '--json': o.json = v(); break;
      case '--floors': o.floors = v().split(',').map(Number); break;
      case '--count': o.count = Number(v()); break;
      case '--quiet': o.quiet = true; break;
      case '--bot': o.bot = v(); break;
      case '--attacks': o.attacks = true; break;
      default: if (a.startsWith('--')) console.warn(`unknown option ${a}`);
    }
  }
  if (!o.runs) o.runs = { run: 40, god: 20, boss: 12, campaign: 4 }[o.mode] || 20;
  return o;
}

// Meta presets: altar levels for "some upgrades" (≈ 8–15 runs in) and a full altar.
const META_PRESETS = {
  none: {},
  mid: { vitality: 2, might: 2, precision: 1, swiftness: 1, spark_pouch: 1, mending: 1, ash_shield: 1, quick_flame: 1, spark_pull: 1, bright_lantern: 1 },
};

// =============================================================================================
// Worker
// =============================================================================================
async function workerMain() {
  const [gameMod, { bus }, { DIRS, TS, TILE }, { zoneContains }, gen, prog, saveMod, tracker, perks, sim] = await Promise.all([
    import(mod('src/game/game.js')), import(mod('src/core/events.js')), import(mod('src/game/constants.js')),
    import(mod('src/game/entities.js')), import(mod('src/gen/floorgen.js')), import(mod('src/meta/progression.js')),
    import(mod('src/meta/save.js')), import(mod('src/meta/tracker.js')), import(mod('src/game/perks.js')), import(mod('tools/sim.mjs')),
  ]);
  const { Game, makeStubInput } = gameMod;
  const { Bot } = sim;

  /**
   * Bot + one human habit the sim bot lacks: dash *through* an expanding shockwave ring (slams, pulses) instead of
   * running outward in front of it.
   */
  class ExpertBot extends Bot {
    hazardAt(w, x, y) {
      const t = w.tileAtPx(x, y);
      return t === TILE.HAZARD || (t === TILE.SPIKES);
    }
    /** Humans see lava / rifts / spikes: steer the combat movement around them (and off them). */
    avoidHazards(w) {
      if (this.careNow === false) return;
      const p = w.player, mv = this.input.move;
      const l = Math.hypot(mv.x, mv.y);
      const onHaz = this.hazardAt(w, p.x, p.y);
      if (l < 0.1 && !onHaz) return;
      const base = l < 0.1 ? 0 : Math.atan2(mv.y, mv.x);
      const look = 14;
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
        const a = base + off;
        const nx = p.x + Math.cos(a) * look, ny = p.y + Math.sin(a) * look;
        if (!this.hazardAt(w, nx, ny) && w.canStand(nx, ny, p.r, false)) {
          if (off !== 0 || onHaz) this.input.setMove(Math.cos(a), Math.sin(a));
          return;
        }
      }
    }
    combat(w, dt) {
      super.combat(w, dt);
      this.avoidHazards(w);
      const p = w.player;
      if (p.dashing || p.dash.charges <= 0) return;
      for (const z of w.zones) {
        if (z.team !== 'enemy' || z.dead || z.shape !== 'ring' || !(z.damage > 0)) continue;
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        const grow = z.grow || 0;
        const front = z.active ? z.r : (z.inner || 0);
        const soon = z.active ? grow * 0.15 + 8 : 0;
        if (!z.active && z.delay - z.age > 0.2) continue;
        if (d >= (z.inner || 0) - 4 && d <= z.r + soon && (grow > 0 || !z.active) && d > front - 40) {
          const l = d || 1;
          // through the band toward the centre when the ring grows, else straight out of it
          const dir = grow > 0 ? -1 : 1;
          if (this.tryDash(w, ((p.x - z.x) / l) * dir, ((p.y - z.y) / l) * dir)) return;
        }
      }
    }
  }

  /**
   * "Novice" bot ≈ a new human: notices telegraphs only after a reaction delay, succeeds at a dodge-dash only
   * part of the time (a failed attempt blocks dodging for a moment), and does not shoot all the time.
   */
  class NoviceBot extends ExpertBot {
    constructor(game, mods, skill) {
      const react = skill.react, orig = mods.zoneContains;
      super(game, { ...mods, zoneContains: (z, x, y, r) => (z.age == null || z.age >= react || z.active) && orig(z, x, y, r) });
      this.skillCfg = skill;
      this.dodgeLock = 0; this.fireT = 0; this.firing = true;
      this.rnd = mulberry(hashStr(String(game.run && game.run.seedLabel)));
    }
    tryDash(w, dx, dy) {
      if (this.dodgeLock > 0) return false;
      if (this.rnd() > this.skillCfg.dodge) { this.dodgeLock = 0.6; return false; }
      return super.tryDash(w, dx, dy);
    }
    tick(dt) {
      this.dodgeLock -= dt;
      this.fireT -= dt;
      if (this.fireT <= 0) { this.fireT = 0.5; this.firing = this.rnd() < this.skillCfg.uptime; this.careNow = this.rnd() < this.skillCfg.hazard; }
      super.tick(dt);
      if (!this.firing) this.input.hold('fire', false);
    }
  }
  const SKILLS = { novice: { react: 0.3, dodge: 0.35, uptime: 0.8, hazard: 0.6 }, average: { react: 0.2, dodge: 0.6, uptime: 0.9, hazard: 0.85 } };
  const makeBot = (game, job) => {
    const m = { TS, TILE, zoneContains };
    if (job.bot === 'raw') return new Bot(game, m);
    return SKILLS[job.bot] ? new NoviceBot(game, m, SKILLS[job.bot]) : new ExpertBot(game, m);
  };
  let errors = 0;
  console.error = () => { errors++; };
  console.warn = () => {};

  function makeSave(meta) {
    const save = saveMod.defaultSave();
    if (meta === 'full') for (const u of prog.UPGRADE_LIST) save.upgrades[u.id] = u.maxLevel;
    else if (meta && typeof meta === 'object') Object.assign(save.upgrades, meta);
    else Object.assign(save.upgrades, META_PRESETS[meta] || {});
    return save;
  }

  function fresh(fl, run) {
    const p = run.player;
    return {
      t0: run.time, t1: null, level0: p.level, sparks0: p.sparks, hp0: p.hp, maxHp0: p.stats.maxHp,
      sc0: run.stats.sparksCollected, relics: 0, curses: 0, boons: 0, levelUps: 0, buys: 0, spent: 0, buyTypes: {}, shopSparks: null, chests: 0,
      healed: 0, hearts: 0, rooms: {}, dmg: {}, spawned: {}, sparksGot: 0, lethal: 0,
      bossT0: null, bossDur: null, bossDmg: 0, bossHits: 0, bossHp0: null, cleared: false, kills: 0,
    };
  }

  /** God mode that counts would-be-lethal hits and refills the player (≈ "a death happened here"). */
  function installCountingGod(run, rec) {
    const w = run.world;
    const orig = w.damagePlayer.bind(w);
    w.damagePlayer = (amount, info) => {
      const p = w.player;
      const saved = p.hp, BOOST = 1e7;
      p.hp += BOOST;
      const dealt = orig(amount, info);
      const after = saved - (saved + BOOST - p.hp);
      if (after <= 0) {
        const f = rec.floors[run.floorIndex];
        if (f) f.lethal++;
        rec.lethal++;
        if (rec.firstLethalFloor == null) rec.firstLethalFloor = run.floorIndex;
        const src = info && info.source;
        const key = src && src.id ? src.id : info && info.fall ? 'fall' : info && info.hazard ? 'hazard' : info && info.spikes ? 'spikes' : info && info.dot ? `dot_${info.type}` : 'other';
        rec.lethalBy[key] = (rec.lethalBy[key] || 0) + 1;
        p.hp = p.stats.maxHp;
      } else p.hp = Math.min(p.stats.maxHp, Math.max(1, after));
      return dealt;
    };
  }

  function simulateRun(job, opts = {}) {
    const save = opts.save || makeSave(job.meta);
    const game = new Game({ input: makeStubInput(), meta: prog, generateFloor: gen.generateFloor, save });
    const rec = { seed: job.seed, character: job.character, floors: {}, lethal: 0, lethalBy: {}, firstLethalFloor: null, killedBy: null, outcome: null, ash: 0, time: 0, floor: 0, victory: false };
    let curRoom = null;
    const off = bus.on('*', (evt, pl) => {
      const run = (pl && pl.run) || game.run;
      if (!run) return;
      const f = rec.floors[run.floorIndex];
      switch (evt) {
        case 'floor:enter': {
          const prev = rec.floors[run.floorIndex - 1];
          if (prev && prev.t1 == null) prev.t1 = run.time;
          rec.floors[pl.floor.index] = fresh(pl.floor.index, run);
          break;
        }
        case 'room:enter': if (f && pl.room.type === 'shop' && pl.first) { f.shopSparks = run.player.sparks; f.shopIncome = run.stats.sparksCollected - f.sc0; } break;
        case 'room:lock': curRoom = { type: pl.room.type, t0: run.time, dmg0: run.stats.damageTaken }; break;
        case 'room:clear':
          if (f && curRoom) {
            const r = f.rooms[curRoom.type] || (f.rooms[curRoom.type] = { n: 0, t: 0, dmg: 0 });
            r.n++; r.t += run.time - curRoom.t0; r.dmg += run.stats.damageTaken - curRoom.dmg0;
          }
          curRoom = null;
          if (f && pl.room.type === 'boss') f.cleared = true;
          break;
        case 'enemy:spawn': if (f) f.spawned[pl.enemy.id] = (f.spawned[pl.enemy.id] || 0) + 1; break;
        case 'enemy:death': if (f) f.kills++; break;
        case 'player:hit': {
          if (!f) break;
          const s = pl.source;
          let key = s && s.id ? s.id : pl.dot ? `dot_${pl.type}` : `env_${pl.type}`;
          if (s && s.boss && job.attackBreakdown) key += `:${(s.data && s.data.attack) || (s.data && s.data.mode) || '?'}`;
          f.dmg[key] = (f.dmg[key] || 0) + pl.amount;
          if (f.bossT0 != null && f.bossDur == null) { f.bossDmg += pl.amount; if (!pl.dot) f.bossHits++; }
          break;
        }
        case 'boss:start': if (f && f.bossT0 == null) { f.bossT0 = run.time; f.bossHp0 = run.player.hp; f.bossMaxHp = run.player.stats.maxHp; } break;
        case 'boss:death': if (f && f.bossT0 != null && f.bossDur == null) f.bossDur = run.time - f.bossT0; break;
        case 'relic:gain': if (f) f.relics++; break;
        case 'curse:gain': if (f) f.curses++; break;
        case 'boon:gain': if (f) f.boons++; break;
        case 'player:levelup': if (f) f.levelUps++; break;
        case 'shop:buy': if (f) { f.buys++; f.spent += pl.price; f.buyTypes[pl.offer.type] = (f.buyTypes[pl.offer.type] || 0) + 1; } break;
        case 'player:heal': if (f) f.healed += pl.amount; break;
        case 'pickup:collect':
          if (!f) break;
          if (pl.kind === 'heart') f.hearts++;
          else if (pl.kind === 'spark') f.sparksGot += pl.amount || 0;
          break;
        case 'prop:open': if (f && pl.kind === 'chest') f.chests++; break;
        case 'run:end': rec.ash = pl.summary ? pl.summary.ash : 0; rec.victory = !!pl.victory; rec.summary = pl.summary; break;
        default: break;
      }
    });
    let run;
    try {
      run = game.startRun({ character: job.character, difficulty: job.difficulty || 0, seed: job.seed });
      if (job.god) installCountingGod(run, rec);
      if (opts.prepare) opts.prepare(game, run, rec);
      const bot = makeBot(game, job);
      const steps = Math.round((job.seconds || 3000) / DT);
      let simT = 0, lastProg = -1, lastT = 0, stalled = false, crashed = null;
      for (let i = 0; i < steps; i++) {
        try { bot.tick(DT); game.update(DT); } catch (err) { crashed = err; break; }
        simT += DT;
        if (game.state === 'dead' || game.state === 'victory' || game.state === 'menu') break;
        if (opts.stop && opts.stop(game, run, rec)) break;
        const pr = run.stats.roomsCleared + run.stats.kills + run.floorIndex * 100 + Math.floor(run.stats.damageDealt / 25) + (run.stats.sparksCollected || 0);
        if (pr !== lastProg) { lastProg = pr; lastT = simT; } else if (simT - lastT > 90) { stalled = true; break; }
      }
      rec.outcome = crashed ? 'crash' : game.state === 'victory' ? 'victory' : game.state === 'dead' ? 'dead' : stalled ? 'stalled' : 'timeout';
      if (crashed) rec.crash = String(crashed.stack || crashed).slice(0, 400);
      rec.killedBy = run.killedBy ? run.killedBy.id || run.killedBy.name : null;
      rec.time = run.time;
      rec.floor = run.floorIndex;
      const lf = rec.floors[run.floorIndex];
      if (lf && lf.t1 == null) lf.t1 = run.time;
      rec.level = run.player.level;
      rec.relics = run.player.relics.map((r) => r.def.id);
      rec.boonsList = run.player.boons.map((b) => `${b.def.id}x${b.stacks}`);
      rec.weapons = run.player.weapons.filter(Boolean).map((ws) => `${ws.id}:${ws.level}`);
      if (!rec.summary && run && !run.finished) rec.summary = run.summary();
      if (rec.summary && !rec.ash) rec.ash = rec.summary.ash || 0;
    } finally {
      off();
    }
    rec.errors = errors; errors = 0;
    return { rec, run, game };
  }

  function bossJob(job) {
    const N = job.floor;
    const { rec } = simulateRun({ ...job, god: true, seconds: 400 }, {
      prepare(game, run) {
        if (N > 1) run.startFloor(N);
        const p = run.player, rng = run.world.rng;
        for (let k = 1; k < Math.min(5, N); k++) p.upgradeWeapon(p.weapon);
        for (let k = 0; k < 2 * N; k++) run.giveRelic();
        for (let k = 0; k < 3 * N; k++) {
          const d = perks.rollBoons(run, 1, { rng })[0];
          if (d) run.giveBoon(d.id);
        }
        // the bot resolves any choice a relic opened, then we go straight into the boss room
        game.clearChoices && game.clearChoices();
        p.level = 1 + Math.round(3.5 * (N - 1));
        p.hp = p.stats.maxHp;
        const br = run.floor.rooms[run.floor.bossRoomId];
        const doorDir = Object.keys(br.doors)[0];
        run.enterRoom(br.id, doorDir ? DIRS[doorDir].opp : undefined);
      },
      stop(game, run, r) { const f = r.floors[run.floorIndex]; return f && f.bossDur != null; },
    });
    const f = rec.floors[N] || {};
    return {
      kind: 'boss', floor: N, character: job.character, seed: job.seed,
      dur: f.bossDur, timeout: f.bossDur == null, dmg: f.bossDmg, hits: f.bossHits, maxHp: f.bossMaxHp, lethal: f.lethal || 0,
      dmgBy: f.dmg, relics: rec.relics, boons: rec.boonsList, weapons: rec.weapons, errors: rec.errors,
    };
  }

  function campaignJob(job) {
    const save = saveMod.defaultSave();
    const out = { kind: 'campaign', seed: job.seed, runs: [] };
    const total = prog.totalUpgradeCost();
    for (let i = 0; i < job.count; i++) {
      const { rec, run } = simulateRun({ ...job, seed: `${job.seed}-${i}`, god: false }, { save });
      try {
        if (run && rec.summary) tracker.applyRunEnd(save, { run, victory: rec.victory, summary: { ...rec.summary } });
        save.stats.kills = (save.stats.kills || 0) + (run ? run.stats.kills : 0);
        prog.checkUnlocks(save);
      } catch (err) { out.err = String(err); }
      // spend: cheapest affordable upgrade first, repeat
      for (;;) {
        const opts = prog.UPGRADE_LIST.map((u) => ({ u, c: prog.canBuyUpgrade(save, u.id) })).filter((x) => x.c.ok).sort((a, b) => a.c.cost - b.c.cost);
        if (!opts.length) break;
        prog.buyUpgrade(save, opts[0].u.id);
      }
      out.runs.push({ i, floor: rec.floor, victory: rec.victory, ash: rec.summary ? rec.summary.ash : rec.ash, spent: prog.spentAsh(save), bank: save.ash, killedBy: rec.killedBy, time: rec.time, outcome: rec.outcome });
      if (prog.spentAsh(save) >= total) break;
    }
    out.total = total;
    return out;
  }

  parentPort.on('message', (job) => {
    if (job === 'exit') { process.exit(0); }
    let res;
    try {
      if (job.kind === 'boss') res = bossJob(job);
      else if (job.kind === 'campaign') res = campaignJob(job);
      else {
        const { rec } = simulateRun(job);
        delete rec.summary;
        res = { kind: 'run', ...rec };
      }
    } catch (err) {
      res = { kind: 'error', err: String(err && err.stack || err) };
    }
    parentPort.postMessage(res);
  });
  parentPort.postMessage({ kind: 'ready' });
}

// =============================================================================================
// Main thread: pool + aggregation
// =============================================================================================
async function runPool(jobs, nWorkers, quiet) {
  const results = [];
  let next = 0, done = 0;
  const t0 = Date.now();
  await new Promise((resolveAll) => {
    const workers = [];
    const total = jobs.length;
    const feed = (w) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
      else { w.postMessage('exit'); }
    };
    for (let i = 0; i < Math.min(nWorkers, jobs.length); i++) {
      const w = new Worker(SELF, { workerData: { worker: true } });
      workers.push(w);
      w.on('message', (m) => {
        if (m.kind === 'ready') { feed(w); return; }
        results.push(m);
        done++;
        if (!quiet) process.stderr.write(`\r  ${done}/${total} jobs (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
        if (done === total) { if (!quiet) process.stderr.write('\n'); resolveAll(); }
        feed(w);
      });
      w.on('error', (e) => { console.error('worker error', e); results.push({ kind: 'error', err: String(e) }); done++; if (done === total) resolveAll(); });
    }
  });
  return results;
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pctl = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const f1 = (v, w = 6) => (Number.isFinite(v) ? v.toFixed(1) : '–').padStart(w);
const f0 = (v, w = 6) => (Number.isFinite(v) ? Math.round(v).toString() : '–').padStart(w);
const pc = (v, w = 5) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–').padStart(w);

function summarizeRuns(results, o) {
  const runs = results.filter((r) => r.kind === 'run');
  const errs = results.filter((r) => r.kind === 'error');
  const out = { mode: o.mode, n: runs.length, floors: {}, deaths: {}, chars: {}, ash: {}, errors: errs.map((e) => e.err).slice(0, 3) };
  const L = [];
  L.push(`\n== ${o.mode.toUpperCase()} bot=${o.bot}  runs=${runs.length}  chars=${o.chars.join(',')}  diff=${o.diff}  meta=${o.meta}  outcomes=${JSON.stringify(count(runs.map((r) => r.outcome)))}`);
  L.push('floor  reach  clear   time(s) combatRm(s) dmg/room  lvl0  sparks@shop(have/floorIncome) buys  relics hearts heal  bossT(med) bossDmg/maxHp lethal/run kills');
  for (let fl = 1; fl <= 5; fl++) {
    const fr = runs.filter((r) => !(r.floor === fl && (r.outcome === 'stalled' || r.outcome === 'timeout' || r.outcome === 'crash'))).map((r) => r.floors[fl]).filter(Boolean);
    if (!fr.length) continue;
    const cleared = fr.filter((f) => f.cleared);
    const combat = fr.map((f) => f.rooms.combat).filter(Boolean);
    const cN = combat.reduce((s, r) => s + r.n, 0);
    const roomT = cN ? combat.reduce((s, r) => s + r.t, 0) / cN : NaN;
    const roomD = cN ? combat.reduce((s, r) => s + r.dmg, 0) / cN : NaN;
    const times = cleared.filter((f) => f.t1 != null).map((f) => f.t1 - f.t0);
    const bossT = fr.map((f) => f.bossDur).filter((v) => v != null);
    const bossD = fr.filter((f) => f.bossDur != null && f.bossMaxHp).map((f) => f.bossDmg / f.bossMaxHp);
    const row = {
      reach: fr.length, clear: cleared.length / fr.length, time: mean(times), roomT, roomD, level0: mean(fr.map((f) => f.level0)),
      shopSparks: mean(fr.map((f) => f.shopSparks).filter((v) => v != null)), shopIncome: mean(fr.map((f) => f.shopIncome).filter((v) => v != null)), buys: mean(fr.map((f) => f.buys)),
      relics: mean(fr.map((f) => f.relics)), hearts: mean(fr.map((f) => f.hearts)), healed: mean(fr.map((f) => f.healed)),
      bossT: median(bossT), bossT25: pctl(bossT, 0.25), bossT75: pctl(bossT, 0.75), bossDmg: mean(bossD), lethal: mean(fr.map((f) => f.lethal)), kills: mean(fr.map((f) => f.kills)),
      levelUps: mean(fr.map((f) => f.levelUps)), sparksGot: mean(fr.map((f) => f.sparksGot)),
    };
    out.floors[fl] = row;
    L.push(`${String(fl).padStart(5)} ${f0(row.reach)} ${pc(row.clear, 6)} ${f0(row.time, 9)} ${f1(row.roomT, 11)} ${f1(row.roomD, 9)} ${f1(row.level0, 5)} ${f0(row.shopSparks, 5)}/${f0(row.shopIncome, 4)} ${f1(row.buys, 5)} ${f1(row.relics, 7)} ${f1(row.hearts, 6)} ${f0(row.healed, 5)} ${f0(row.bossT, 6)} [${f0(row.bossT25, 3)}-${f0(row.bossT75, 3)}] ${f1(row.bossDmg, 8)} ${f1(row.lethal, 10)} ${f0(row.kills, 5)}`);
  }
  // per-floor level ups and sparks
  L.push('floor  levelUps  sparksPicked  rooms by type: n / avg s / avg dmg');
  for (let fl = 1; fl <= 5; fl++) {
    const fr = runs.map((r) => r.floors[fl]).filter(Boolean);
    if (!fr.length) continue;
    const types = {};
    for (const f of fr) for (const [t, r] of Object.entries(f.rooms)) { const a = types[t] || (types[t] = { n: 0, t: 0, dmg: 0 }); a.n += r.n; a.t += r.t; a.dmg += r.dmg; }
    const tstr = Object.entries(types).map(([t, a]) => `${t} ${(a.n / fr.length).toFixed(1)}/${(a.t / a.n).toFixed(0)}s/${(a.dmg / a.n).toFixed(0)}`).join('  ');
    L.push(`${String(fl).padStart(5)} ${f1(out.floors[fl].levelUps, 9)} ${f0(out.floors[fl].sparksGot, 13)}  ${tstr}`);
  }
  // damage sources
  L.push('damage taken by source (per floor; total per run, share, per spawned enemy):');
  for (let fl = 1; fl <= 5; fl++) {
    const fr = runs.map((r) => r.floors[fl]).filter(Boolean);
    if (!fr.length) continue;
    const dmg = {}, sp = {};
    for (const f of fr) {
      for (const [k, v] of Object.entries(f.dmg)) dmg[k] = (dmg[k] || 0) + v;
      for (const [k, v] of Object.entries(f.spawned)) sp[k] = (sp[k] || 0) + v;
    }
    const tot = Object.values(dmg).reduce((s, v) => s + v, 0);
    const top = Object.entries(dmg).sort((a, b) => b[1] - a[1]).slice(0, 9);
    L.push(`  F${fl} (${Math.round(tot / fr.length)}/run): ` + top.map(([k, v]) => `${k} ${Math.round(v / fr.length)} ${Math.round((v / tot) * 100)}%${sp[k] ? ` (${(v / sp[k]).toFixed(1)}/sp)` : ''}`).join(', '));
  }
  // deaths
  const deaths = count(runs.filter((r) => r.outcome === 'dead').map((r) => `F${r.floor}:${r.killedBy}`));
  out.deaths = deaths;
  if (Object.keys(deaths).length) L.push('deaths: ' + Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', '));
  const lethal = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.lethalBy || {})) lethal[k] = (lethal[k] || 0) + v;
  if (Object.keys(lethal).length) L.push('lethal hits (god): ' + Object.entries(lethal).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}×${v}`).join(', '));
  // characters
  if (o.chars.length > 1 || true) {
    L.push('char       runs  floorReached  win%   F1clear  F2clear F3clear lethal/run  ash   time');
    for (const c of o.chars) {
      const cr = runs.filter((r) => r.character === c);
      if (!cr.length) continue;
      const clr = (fl) => { const x = cr.filter((r) => r.floors[fl]); return x.length ? x.filter((r) => r.floors[fl].cleared).length / x.length : NaN; };
      const row = { n: cr.length, floor: mean(cr.map((r) => r.floor + (r.victory ? 1 : 0))), win: cr.filter((r) => r.victory).length / cr.length, f1: clr(1), f2: clr(2), f3: clr(3), lethal: mean(cr.map((r) => r.lethal)), ash: mean(cr.map((r) => r.ash)), time: mean(cr.map((r) => r.time)) };
      out.chars[c] = row;
      L.push(`${c.padEnd(10)} ${f0(row.n, 4)} ${f1(row.floor, 13)} ${pc(row.win, 5)} ${pc(row.f1, 8)} ${pc(row.f2, 8)} ${pc(row.f3, 7)} ${f1(row.lethal, 10)} ${f0(row.ash, 5)} ${f0(row.time, 6)}`);
    }
  }
  const byFloor = {};
  for (const r of runs) (byFloor[r.victory ? 'win' : r.floor] ||= []).push(r.ash);
  out.ash = Object.fromEntries(Object.entries(byFloor).map(([k, v]) => [k, mean(v)]));
  L.push('ash by end floor: ' + Object.entries(byFloor).map(([k, v]) => `${k}: ${Math.round(mean(v))} (n${v.length})`).join(', ') + `   overall mean ${Math.round(mean(runs.map((r) => r.ash)))}`);
  L.push(`run time mean ${Math.round(mean(runs.map((r) => r.time)))} s, wins ${mean(runs.map((r) => r.victory ? 1 : 0)).toFixed(2)}, win time ${Math.round(mean(runs.filter((r) => r.victory).map((r) => r.time)))} s; content errors ${runs.reduce((s, r) => s + (r.errors || 0), 0)}`);
  if (errs.length) L.push(`worker errors: ${errs.length}: ${errs[0].err.slice(0, 300)}`);
  return { text: L.join('\n'), data: out };
}

function summarizeBoss(results, o) {
  const rs = results.filter((r) => r.kind === 'boss');
  const L = [`\n== BOSS (typical build: weapon L=N, 2N relics, 3N boon stacks; god mode, lethal hits counted)  fights=${rs.length}`];
  L.push('floor  n  dur med [p25-p75]  timeouts  dmg/maxHp  hits  lethal/fight  P(no lethal)  top damage');
  const data = {};
  for (const fl of o.floors) {
    const fr = rs.filter((r) => r.floor === fl);
    if (!fr.length) continue;
    const d = fr.filter((r) => !r.timeout).map((r) => r.dur);
    const dmg = {};
    for (const r of fr) for (const [k, v] of Object.entries(r.dmgBy || {})) dmg[k] = (dmg[k] || 0) + v;
    const tot = Object.values(dmg).reduce((s, v) => s + v, 0) || 1;
    const row = { n: fr.length, med: median(d), p25: pctl(d, 0.25), p75: pctl(d, 0.75), timeouts: fr.filter((r) => r.timeout).length, dmg: mean(fr.map((r) => r.dmg / (r.maxHp || 100))), hits: mean(fr.map((r) => r.hits)), lethal: mean(fr.map((r) => r.lethal)), survive: fr.filter((r) => r.lethal === 0).length / fr.length };
    data[fl] = row;
    L.push(`${String(fl).padStart(5)} ${f0(row.n, 2)} ${f0(row.med, 6)} [${f0(row.p25, 4)}-${f0(row.p75, 4)}] ${f0(row.timeouts, 6)} ${f1(row.dmg, 10)} ${f1(row.hits, 6)} ${f1(row.lethal, 10)} ${pc(row.survive, 12)}   ` + Object.entries(dmg).sort((a, b) => b[1] - a[1]).slice(0, o.attacks ? 9 : 4).map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join(', '));
  }
  return { text: L.join('\n'), data };
}

function summarizeCampaign(results) {
  const cs = results.filter((r) => r.kind === 'campaign');
  const L = [`\n== CAMPAIGN (non-god, diff 0, cheapest-upgrade-first)  campaigns=${cs.length}  altar total=${cs[0] && cs[0].total}`];
  const firstAt = (c, pred) => { const r = c.runs.find(pred); return r ? r.i + 1 : NaN; };
  const data = [];
  for (const c of cs) {
    const row = {
      runs: c.runs.length, firstF2: firstAt(c, (r) => r.floor >= 2 || r.victory), firstF3: firstAt(c, (r) => r.floor >= 3 || r.victory), firstF4: firstAt(c, (r) => r.floor >= 4 || r.victory),
      firstWin: firstAt(c, (r) => r.victory), wins: c.runs.filter((r) => r.victory).length, ash1: c.runs[0] && c.runs[0].ash,
      ash10: mean(c.runs.slice(0, 10).map((r) => r.ash)), ashAll: mean(c.runs.map((r) => r.ash)), spent: c.runs.length ? c.runs[c.runs.length - 1].spent : 0,
      spentAt10: c.runs[9] ? c.runs[9].spent : NaN, full: c.runs.length && c.runs[c.runs.length - 1].spent >= c.total ? c.runs.length : NaN,
      floors: c.runs.map((r) => (r.victory ? 'W' : r.floor)).join(''),
    };
    data.push(row);
    L.push(`seed ${c.seed}: runs ${row.runs}, first F2 @${row.firstF2}, F3 @${row.firstF3}, F4 @${row.firstF4}, first win @${row.firstWin}, wins ${row.wins}, ash run1 ${row.ash1}, ash/run (first 10) ${Math.round(row.ash10)}, ash/run all ${Math.round(row.ashAll)}, spent@10 ${row.spentAt10}, full altar @${row.full}`);
    L.push(`   floors: ${row.floors}`);
  }
  return { text: L.join('\n'), data };
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function count(arr) { const o = {}; for (const a of arr) o[a] = (o[a] || 0) + 1; return o; }

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const jobs = [];
  if (o.mode === 'run' || o.mode === 'god') {
    for (let i = 0; i < o.runs; i++) for (const c of o.chars) jobs.push({ kind: 'run', seed: `${o.seed}-${i}`, character: c, difficulty: o.diff, meta: o.meta, god: o.mode === 'god', seconds: o.seconds, bot: o.bot });
  } else if (o.mode === 'boss') {
    for (const fl of o.floors) for (let i = 0; i < o.runs; i++) for (const c of o.chars) jobs.push({ kind: 'boss', seed: `${o.seed}-b${fl}-${i}`, character: c, floor: fl, difficulty: o.diff, meta: o.meta, bot: o.bot, attackBreakdown: !!o.attacks });
  } else if (o.mode === 'campaign') {
    for (let i = 0; i < o.runs; i++) jobs.push({ kind: 'campaign', seed: `${o.seed}-c${i}`, character: o.chars[0], difficulty: 0, count: o.count, seconds: o.seconds, bot: o.bot });
  } else { console.error(`unknown mode ${o.mode}`); process.exitCode = 1; return; }
  const t0 = Date.now();
  const results = await runPool(jobs, o.workers, o.quiet);
  const s = o.mode === 'boss' ? summarizeBoss(results, o) : o.mode === 'campaign' ? summarizeCampaign(results) : summarizeRuns(results, o);
  console.log(s.text);
  console.log(`(${jobs.length} jobs, ${((Date.now() - t0) / 1000).toFixed(1)} s wall)`);
  const errs = results.filter((r) => r.kind === 'error');
  if (errs.length) console.log(`errors: ${errs.length}\n${errs[0].err}`);
  if (o.json) writeFileSync(o.json, JSON.stringify({ opts: o, summary: s.data, results }, null, 1));
}

if (!isMainThread && workerData && workerData.worker) workerMain();
else if (isMainThread) main();
