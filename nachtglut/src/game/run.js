// Run: one descent (5 floors). Owns the RNG, player, world, floor, stats and the run-level flow
// (floors, room changes, boon/relic choices, death, victory). See docs/ARCHITECTURE.md §9, §11.1. DOM-free.
import { bus } from '../core/events.js';
import { RNG, hashString } from '../core/rng.js';
import { TOTAL_FLOORS } from './constants.js';
import { CHARACTERS, WEAPONS, RELICS } from './registry.js';
import { biomeForFloor } from '../data/biomes.js';
import { Player } from './player.js';
import { World } from './world.js';
import { STATUS } from './combat.js';
import { addPerk, rollRelics, rollBoons, rollCurse, refreshDynamicMods, runHooks } from './perks.js';
import { generateFallbackFloor } from './fallbackgen.js';

const NEUTRAL_DIFFICULTY = Object.freeze({ level: 0, name: 'Erste Glut', mods: Object.freeze({}) });
const DYING_TIME = 1.6;
const VICTORY_TIME = 3.5;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function emptyRunStats() {
  return {
    kills: 0, eliteKills: 0, bossKills: 0, damageDealt: 0, damageTaken: 0, roomsCleared: 0, floorsCleared: 0,
    sparksCollected: 0, sparksSpent: 0, relicsFound: 0, cursesTaken: 0, boonsChosen: 0, weaponsFound: 0,
    critHits: 0, dashes: 0, bestHit: 0, hitsTaken: 0, healed: 0, ashPickedUp: 0, levelUps: 0,
    falls: 0, barrels: 0, chests: 0, shrines: 0, purchases: 0, revives: 0, skillsUsed: 0, flawlessRooms: 0,
  };
}

function textOf(v, n) { return typeof v === 'function' ? v(n) : (v || ''); }

export class Run {
  constructor(game, opts = {}) {
    const { character, difficulty = 0, seed } = opts;
    this.game = game;
    this.seedLabel = seed != null && String(seed).trim() !== '' ? String(seed).trim().slice(0, 32) : randomCode();
    this.seed = hashString(this.seedLabel);
    this.rng = new RNG(this.seed);
    const charDef = CHARACTERS[character] || CHARACTERS.bearer || Object.values(CHARACTERS)[0];
    this.character = charDef.id;
    this.characterDef = charDef;

    const meta = game.meta || {};
    const diffs = meta.DIFFICULTIES || [];
    const lv = Math.max(0, Math.floor(Number(typeof difficulty === 'object' && difficulty ? difficulty.level : difficulty) || 0));
    const d = diffs[Math.min(lv, Math.max(0, diffs.length - 1))] || NEUTRAL_DIFFICULTY;
    this.difficulty = d.mods ? d : { ...d, mods: {} };

    let bonuses = {};
    try { bonuses = (meta.getRunBonuses && meta.getRunBonuses(game.save)) || {}; } catch (err) { console.error('[run] getRunBonuses failed', err); }
    this.bonuses = {
      startSparks: 0, rerolls: 0, revives: 0, relicChoices: 0, startRelics: 0, startRelicRarity: 'common',
      shopDiscount: 0, healOnFloor: 0, startShield: 0, reviveHp: 0.3, ...bonuses,
    };
    // weapon loot pool (weapon offers only roll from this set)
    let ids = null;
    if (typeof meta.unlockedWeapons === 'function') {
      try { ids = meta.unlockedWeapons(game.save); } catch (err) { console.error('[run] unlockedWeapons failed', err); }
    }
    this.unlockedWeapons = new Set(Array.isArray(ids) ? ids : Object.keys(WEAPONS));

    this.stats = emptyRunStats();
    this.rerolls = Math.max(0, Math.floor(this.bonuses.rerolls || 0));
    this.revives = Math.max(0, Math.floor(this.bonuses.revives || 0));
    this.pendingBoons = 0;
    this.time = 0;
    this.floorIndex = 0;
    this.floor = null;
    this.biome = null;
    this.roomId = -1;
    this.roomHits = 0;
    this.flags = {};
    this.ended = false;
    this.finished = false;
    this.victory = false;
    this.dyingT = 0;
    this.victoryT = 0;
    this.killedBy = null;
    this.offeredOut = new Set();
    this._dynT = 0;
    this._changing = false;

    const player = new Player(this, charDef);
    this.player = player;
    let metaMods = [];
    try { metaMods = (meta.getMetaMods && meta.getMetaMods(game.save)) || []; } catch (err) { console.error('[run] getMetaMods failed', err); }
    player.mods.set('meta', metaMods);
    player.mods.set('character', charDef.baseMods || []);
    player.recalc();
    player.hp = player.stats.maxHp;
    player.dash.charges = player.dash.max;
    player.sparks = Math.max(0, Math.floor(this.bonuses.startSparks || 0));
    player.shield = Math.max(0, this.bonuses.startShield || 0);

    this.world = new World(this, game.fx);
    const wdef = WEAPONS[charDef.weapon] || Object.values(WEAPONS)[0];
    if (wdef) player.giveWeapon(wdef, 1);
  }

  get diffLevel() { return this.difficulty.level ?? 0; }

  // -------------------------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------------------------
  start() {
    this.startFloor(1);
    bus.emit('run:start', { run: this });
    const n = Math.floor(this.bonuses.startRelics || 0);
    const rarity = this.bonuses.startRelicRarity || 'common';
    for (let i = 0; i < n; i++) {
      const owned = new Set(this.player.relics.map((p) => p.def.id));
      let pool = Object.values(RELICS).filter((d) => d.rarity === rarity && !owned.has(d.id) && (!d.requires || safeReq(d, this)));
      if (!pool.length) pool = rollRelics(this, 1, { rng: this.rng });
      const def = this.rng.pick(pool);
      if (def) this.giveRelic(def.id);
    }
  }

  startFloor(index) {
    const game = this.game;
    this.floorIndex = index;
    this.biome = biomeForFloor(index);
    this.world.bossDefeated = null;
    this.finalBossCleared = false;
    this.victoryT = 0;
    const genOpts = {
      index, biome: this.biome, seed: this.rng.int(0, 0xffffffff),
      difficulty: this.difficulty.mods, luck: this.player.stats.luck,
    };
    let floor = null;
    try { floor = game.generateFloor(genOpts); } catch (err) { console.error('[run] generateFloor failed – using fallback floor', err); }
    if (!floor || !Array.isArray(floor.rooms) || !floor.rooms.length || !floor.rooms[floor.startRoomId]) {
      if (floor) console.error('[run] generator returned an invalid floor – using fallback floor');
      floor = generateFallbackFloor(genOpts);
    }
    this.floor = floor;
    this.enterRoom(floor.startRoomId);
    bus.emit('floor:enter', { run: this, floor, biome: this.biome });
    bus.emit('ui:banner', { title: this.biome.name, subtitle: this.biome.subtitle, kind: 'floor' });
    runHooks(this, 'onFloorEnter', { floor, index });
    if (index > 1 && this.bonuses.healOnFloor > 0) {
      this.world.healPlayer(this.player.stats.maxHp * this.bonuses.healOnFloor);
    }
  }

  enterRoom(id, fromDir) {
    const room = this.floor.rooms[id];
    if (!room) { console.error(`[run] unknown room ${id}`); return; }
    this.roomId = id;
    this.roomHits = 0;
    this.world.enterRoom(room, fromDir);
  }

  get room() { return this.floor ? this.floor.rooms[this.roomId] : null; }

  changeRoom(id, dir) {
    if (this._changing || this.ended) return;
    this._changing = true;
    this.game.transition(() => {
      this._changing = false;
      this.enterRoom(id, dir);
    }, 0.3);
  }

  nextFloor() {
    if (this.ended || this._changing || this.floorIndex >= TOTAL_FLOORS) return;
    this._changing = true;
    this.stats.floorsCleared++;
    this.game.transition(() => {
      this._changing = false;
      this.startFloor(this.floorIndex + 1);
    }, 0.8);
  }

  update(dt) {
    if (this.finished) return;
    const game = this.game, w = this.world;
    let sdt = dt;
    if (this.dyingT > 0) {
      sdt = dt * 0.35;
      this.dyingT -= dt;
      if (this.dyingT <= 0) { this.dyingT = 0; this.finish(false); return; }
    }
    if (!this.ended) this.time += dt;
    w.update(sdt);
    if (this.finished) return;

    this._dynT -= dt;
    if (this._dynT <= 0) { this._dynT = 0.2; refreshDynamicMods(this); }

    // victory: the final boss is down
    if (!this.ended && (w.bossDefeated || this.finalBossCleared) && this.floorIndex >= TOTAL_FLOORS) {
      this.ended = true;
      this.victory = true;
      this.victoryT = VICTORY_TIME;
      this.player.invuln = Math.max(this.player.invuln, VICTORY_TIME + 1);
      w.fx.flash('#fff3b0', 0.8);
      w.fx.shake(6, 0.8);
    }
    if (this.victoryT > 0) {
      this.victoryT -= dt;
      if (this.victoryT <= 0) { this.victoryT = 0; this.finish(true); return; }
    }

    if (this.pendingBoons > 0 && !w.locked && !this.ended && game.state === 'playing' && !game.choice) {
      this.offerBoonChoice();
    }
  }

  onRoomClear(room) {
    if (this.roomHits === 0) this.stats.flawlessRooms++;
    this.roomHits = 0;
    // robust victory even when the final boss def is missing (placeholder enemy without `boss`)
    if (room && room.type === 'boss' && this.floorIndex >= TOTAL_FLOORS) this.finalBossCleared = true;
  }

  onPlayerDeath(source, info = {}) {
    if (this.ended) return;
    this.ended = true;
    this.dyingT = DYING_TIME;
    this.killedBy = this._describeKiller(source, info);
    this.game.clearChoices();
    bus.emit('player:death', { run: this });
  }

  _describeKiller(source, info) {
    if (source && typeof source === 'object') {
      return { id: source.id || null, name: source.name || (source.def && source.def.name) || 'Unbekannt', boss: !!source.boss };
    }
    if (info.fall) return { id: 'fall', name: 'Sturz in die Tiefe' };
    if (info.hazard) return { id: 'hazard', name: (this.biome && this.biome.hazardName) || 'Gefahr' };
    if (info.spikes) return { id: 'spikes', name: 'Stachelfalle' };
    if (info.dot) {
      const st = STATUS[info.type === 'poison' ? 'poison' : info.type === 'fire' ? 'burn' : ''];
      return { id: 'status', name: st ? st.name : 'Siechtum' };
    }
    return { id: null, name: 'Unbekannt' };
  }

  /**
   * End the run: emits run:end with the summary and switches to 'dead' / 'victory'.
   * opts.abandoned: no banner, the caller decides the next state.
   */
  finish(victory, opts = {}) {
    if (this.finished) return null;
    this.finished = true;
    this.ended = true;
    this.victory = !!victory;
    this.abandoned = !!opts.abandoned;
    const game = this.game;
    game.clearChoices();
    const summary = this.summary();
    this.lastSummary = summary;
    bus.emit('run:end', { run: this, victory: this.victory, summary });
    if (!opts.abandoned) {
      if (this.victory) {
        bus.emit('ui:banner', { title: 'Das Sonnenherz brennt wieder', subtitle: 'Die Nacht weicht der Glut.', kind: 'victory' });
      } else {
        bus.emit('ui:banner', { title: 'Zu Asche zerfallen', subtitle: this.killedBy ? `Gefallen durch: ${this.killedBy.name}` : '', kind: 'death' });
      }
      game.setState(this.victory ? 'victory' : 'dead');
    }
    return summary;
  }

  summary() {
    const p = this.player;
    const stats = { ...this.stats, level: p.level };
    let ash = Math.round(this.stats.ashPickedUp || 0), ashParts = null;
    const meta = this.game.meta || {};
    if (typeof meta.computeAshReward === 'function') {
      try {
        const r = meta.computeAshReward({
          floor: this.floorIndex, victory: this.victory, stats, difficulty: this.diffLevel,
          ashGain: p.stats.ashGain, ashPickedUp: this.stats.ashPickedUp,
        });
        if (r && Number.isFinite(r.total)) { ash = r.total; ashParts = r.parts || null; }
      } catch (err) { console.error('[run] computeAshReward failed', err); }
    }
    const out = {
      victory: this.victory,
      abandoned: !!this.abandoned,
      character: this.character,
      difficulty: this.diffLevel,
      floor: Math.max(1, this.floorIndex),
      biome: this.biome ? this.biome.id : null,
      time: this.time,
      seedLabel: this.seedLabel,
      level: p.level,
      stats,
      relics: p.relics.filter((r) => r.def.rarity !== 'curse').map((r) => r.def.id),
      curses: p.relics.filter((r) => r.def.rarity === 'curse').map((r) => r.def.id),
      boons: p.boons.map((b) => ({ id: b.def.id, stacks: b.stacks })),
      weapons: p.weapons.filter(Boolean).map((ws) => ({ id: ws.id, level: ws.level })),
      ash,
      date: Date.now(),
    };
    if (ashParts) out.ashParts = ashParts;
    if (!this.victory && this.killedBy) out.killedBy = this.killedBy.name;
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Choices + rewards
  // -------------------------------------------------------------------------------------------
  _boonOption(def) {
    const have = this.player.boons.find((b) => b.def.id === def.id);
    const n = (have ? have.stacks : 0) + 1;
    const max = def.maxStacks ?? 1;
    return {
      id: def.id, name: def.name, desc: textOf(def.desc, n), icon: def.icon, rarity: def.rarity || 'common', tags: def.tags,
      detail: `Stufe ${n}/${max}`,
      pick: () => this.giveBoon(def.id),
    };
  }

  offerBoonChoice() {
    if (this.pendingBoons <= 0) return null;
    this.pendingBoons--;
    const rng = this.world.rng;
    const defs = rollBoons(this, 3, { rng });
    if (!defs.length) {
      this.player.sparks += 10;
      this.stats.sparksCollected += 10;
      bus.emit('ui:toast', { text: 'Alle Segen gemeistert: +10 Funken', kind: 'good', icon: { glyph: 'coin', color: '#ffd35a' } });
      return null;
    }
    const choice = {
      kind: 'boon', title: 'Segen der Glut', text: `Stufe ${this.player.level} erreicht – wähle einen Segen.`,
      options: defs.map((d) => this._boonOption(d)),
      rerolls: this.rerolls,
    };
    choice.reroll = () => {
      if (this.rerolls <= 0) return;
      this.rerolls--;
      choice.rerolls = this.rerolls;
      const next = rollBoons(this, 3, { rng, exclude: new Set(choice.options.map((o) => o.id)) });
      const use = next.length ? next : rollBoons(this, 3, { rng });
      choice.options = use.map((d) => this._boonOption(d));
    };
    return this.game.openChoice(choice);
  }

  _relicOption(def) {
    return {
      id: def.id, name: def.name, desc: textOf(def.desc, 1), icon: def.icon, rarity: def.rarity, tags: def.tags,
      detail: def.flavor || undefined,
      pick: () => this.giveRelic(def.id),
    };
  }

  /** Choose 1 of n (+ relicChoices bonus) relics. opts: { boost, minRarity, title, text } */
  offerRelicChoice(n = 3, opts = {}) {
    const count = Math.max(1, n + Math.floor(this.bonuses.relicChoices || 0));
    const rng = this.world.rng;
    const roll = (exclude) => rollRelics(this, count, { rng, boost: opts.boost || 0, minRarity: opts.minRarity, exclude });
    const defs = roll();
    if (!defs.length) {
      this.player.sparks += 25;
      this.stats.sparksCollected += 25;
      bus.emit('ui:toast', { text: 'Keine Relikte mehr: +25 Funken', kind: 'good', icon: { glyph: 'coin', color: '#ffd35a' } });
      return null;
    }
    const choice = {
      kind: 'relic', title: opts.title || 'Relikt wählen', text: opts.text || 'Nimm eines mit in die Tiefe.',
      options: defs.map((d) => this._relicOption(d)),
      rerolls: this.rerolls,
      skipLabel: '+15 Funken',
    };
    choice.skip = () => {
      this.player.sparks += 15;
      this.stats.sparksCollected += 15;
    };
    choice.reroll = () => {
      if (this.rerolls <= 0) return;
      this.rerolls--;
      choice.rerolls = this.rerolls;
      const next = roll(new Set(choice.options.map((o) => o.id)));
      choice.options = (next.length ? next : roll()).map((d) => this._relicOption(d));
    };
    return this.game.openChoice(choice);
  }

  /** Give a relic by id, or a random one (by rarity weights) when omitted. */
  giveRelic(id) {
    let def = id ? RELICS[id] : rollRelics(this, 1, { rng: this.world.rng })[0];
    if (!def) return null;
    return addPerk(this, 'relic', def.id);
  }

  giveCurse(id) {
    const def = id ? RELICS[id] : rollCurse(this, this.world.rng);
    if (!def) return null;
    const perk = addPerk(this, 'relic', def.id);
    if (perk) this.stats.cursesTaken++;
    return perk;
  }

  giveBoon(id) {
    const perk = addPerk(this, 'boon', id);
    if (perk) this.stats.boonsChosen++;
    return perk;
  }

  giveWeapon(id, level = 1) {
    const def = WEAPONS[id];
    if (!def) { console.warn(`[run] unknown weapon "${id}"`); return null; }
    this.stats.weaponsFound++;
    return this.player.giveWeapon(def, level);
  }
}

function safeReq(def, run) {
  try { return !!def.requires(run.player, run); } catch { return false; }
}
