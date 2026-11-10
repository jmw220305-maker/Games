// Achievements ("Erfolge"): definitions + a bus listener that unlocks them. DOM-free at import time.
import { bus as globalBus } from '../core/events.js';
import { BIOMES } from '../data/biomes.js';
import { persistSave, ensureSaveShape } from './save.js';
import { UPGRADE_LIST, upgradeLevel, isCharacterUnlocked, CHARACTER_UNLOCKS, WEAPON_IDS } from './progression.js';

export const ACHIEVEMENT_CATEGORIES = Object.freeze({
  progress: 'Fortschritt',
  skill: 'Können',
  collection: 'Sammlung',
  curious: 'Kurioses',
});

/** Every regular enemy id of the five biome rosters (bosses excluded). */
export const ROSTER_ENEMY_IDS = Object.freeze([...new Set(Object.values(BIOMES).flatMap((b) => b.enemies.map((e) => e.id)))]);

const BOSS_IDS = Object.freeze(['boss_cinder', 'boss_mycel', 'boss_rime', 'boss_umbra', 'boss_sun']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ico = (glyph, color) => Object.freeze({ glyph, color });

const GOLD = '#ffd35a', EMBER = '#ff8a3c', RED = '#ff6a5a', ICE = '#8fd8ff', VIOLET = '#b07cff', GREEN = '#7dff9a', GREY = '#c9c2b8';

// `check(save)` (optional): evaluated against the save state; makes achievements retroactive.
const DEFS = [
  // --- Fortschritt ------------------------------------------------------------------------------
  { id: 'first_death', cat: 'progress', name: 'Asche zu Asche', desc: 'Falle zum ersten Mal im Schacht.', icon: ico('skull', GREY), reward: 10,
    check: (s) => num(s.stats.deaths) > 0 },
  { id: 'boss_cinder', cat: 'progress', name: 'Erkaltete Schlacke', desc: 'Besiege den Schlackenkönig.', icon: ico('crown', EMBER), reward: 25,
    check: (s) => bossKills(s, 'boss_cinder') > 0 },
  { id: 'boss_mycel', cat: 'progress', name: 'Welkes Geflecht', desc: 'Besiege die Myzelmutter.', icon: ico('mushroom', '#59e0b0'), reward: 40,
    check: (s) => bossKills(s, 'boss_mycel') > 0 },
  { id: 'boss_rime', cat: 'progress', name: 'Tauwetter', desc: 'Besiege den Reifwyrm.', icon: ico('snowflake', ICE), reward: 60,
    check: (s) => bossKills(s, 'boss_rime') > 0 },
  { id: 'boss_umbra', cat: 'progress', name: 'Licht teilt Schatten', desc: 'Besiege Umbra, den Zwillingsschatten.', icon: ico('moon', VIOLET), reward: 80,
    check: (s) => bossKills(s, 'boss_umbra') > 0 },
  { id: 'first_win', cat: 'progress', name: 'Morgenrot', desc: 'Entzünde das Sonnenherz neu und gewinne einen Abstieg.', icon: ico('sun', GOLD), reward: 150,
    check: (s) => num(s.stats.wins) > 0 || bossKills(s, 'boss_sun') > 0 },
  { id: 'win_bearer', cat: 'progress', name: 'Erbe der Feuerstelle', desc: 'Gewinne einen Abstieg als Glutträger.', icon: ico('flame', EMBER), reward: 50, char: 'bearer' },
  { id: 'win_shadow', cat: 'progress', name: 'Schritt im Dunkel', desc: 'Gewinne einen Abstieg als Schattenläuferin.', icon: ico('dagger', VIOLET), reward: 75, char: 'shadow' },
  { id: 'win_warden', cat: 'progress', name: 'Eiserne Wacht', desc: 'Gewinne einen Abstieg als Eisenwächter.', icon: ico('shield', '#9aa7b8'), reward: 75, char: 'warden' },
  { id: 'win_weaver', cat: 'progress', name: 'Gewobenes Licht', desc: 'Gewinne einen Abstieg als Frostweberin.', icon: ico('snowflake', ICE), reward: 75, char: 'weaver' },
  { id: 'win_revenant', cat: 'progress', name: 'Aus Asche geboren', desc: 'Gewinne einen Abstieg als Aschenkind.', icon: ico('ember', GREY), reward: 75, char: 'revenant' },
  { id: 'heat_1', cat: 'progress', name: 'Schwelende Entschlossenheit', desc: 'Gewinne einen Abstieg auf Glutstufe 1 oder höher.', icon: ico('flame', '#ffb347'), reward: 60, heat: 1 },
  { id: 'heat_3', cat: 'progress', name: 'Glühender Wille', desc: 'Gewinne einen Abstieg auf Glutstufe 3 oder höher.', icon: ico('flame', EMBER), reward: 100, heat: 3 },
  { id: 'heat_5', cat: 'progress', name: 'Feuerprobe', desc: 'Gewinne einen Abstieg auf Glutstufe 5 oder höher.', icon: ico('flame', '#ff5a3c'), reward: 150, heat: 5 },
  { id: 'heat_10', cat: 'progress', name: 'Herr der Ewigen Nacht', desc: 'Gewinne einen Abstieg auf Glutstufe 10.', icon: ico('crown', VIOLET), reward: 300, heat: 10 },
  { id: 'all_characters', cat: 'progress', name: 'Fünf Flammen', desc: 'Schalte alle Glutträger frei.', icon: ico('candle', GOLD), reward: 100,
    check: (s) => Object.keys(CHARACTER_UNLOCKS).every((id) => isCharacterUnlocked(s, id)) },
  { id: 'altar_first', cat: 'progress', name: 'Erste Opfergabe', desc: 'Erwirb eine Verbesserung am Aschealtar.', icon: ico('candle', EMBER), reward: 10,
    check: (s) => UPGRADE_LIST.some((u) => upgradeLevel(s, u.id) > 0) },
  { id: 'altar_full', cat: 'progress', name: 'Hüter der Feuerstelle', desc: 'Baue jede Verbesserung am Aschealtar vollständig aus.', icon: ico('lantern', GOLD), reward: 250,
    check: (s) => UPGRADE_LIST.every((u) => upgradeLevel(s, u.id) >= u.maxLevel) },
  { id: 'ash_1000', cat: 'progress', name: 'Aschehaufen', desc: 'Sammle insgesamt 1 000 Asche.', icon: ico('ember', GREY), reward: 25,
    check: (s) => num(s.totalAsh) >= 1000 },
  { id: 'ash_10000', cat: 'progress', name: 'Aschengebirge', desc: 'Sammle insgesamt 10 000 Asche.', icon: ico('ember', '#e8e2d4'), reward: 150,
    check: (s) => num(s.totalAsh) >= 10000 },

  // --- Können -----------------------------------------------------------------------------------
  { id: 'boss_flawless', cat: 'skill', name: 'Unberührt', desc: 'Besiege einen Boss, ohne Schaden zu nehmen.', icon: ico('shield', GOLD), reward: 100 },
  { id: 'win_no_shop', cat: 'skill', name: 'Asket', desc: 'Gewinne einen Abstieg, ohne beim Händler etwas zu kaufen.', icon: ico('coin', GREY), reward: 100 },
  { id: 'win_fast', cat: 'skill', name: 'Sonnensturm', desc: 'Gewinne einen Abstieg in unter 20 Minuten.', icon: ico('hourglass', GOLD), reward: 100 },
  { id: 'floor_hitless', cat: 'skill', name: 'Schattentänzer', desc: 'Durchquere eine ganze Ebene samt Boss, ohne getroffen zu werden.', icon: ico('feather', ICE), reward: 75 },
  { id: 'streak_50', cat: 'skill', name: 'Unantastbar', desc: 'Besiege 50 Gegner in Folge, ohne getroffen zu werden.', icon: ico('wing', ICE), reward: 40 },
  { id: 'big_hit', cat: 'skill', name: 'Vernichtender Schlag', desc: 'Verursache mit einem einzigen Treffer mindestens 500 Schaden.', icon: ico('hammer', EMBER), reward: 40 },
  { id: 'boss_low_hp', cat: 'skill', name: 'Am seidenen Faden', desc: 'Besiege einen Boss mit weniger als 10 % Leben.', icon: ico('heart', RED), reward: 50, secret: true },
  { id: 'win_cursed', cat: 'skill', name: 'Fluchträger', desc: 'Gewinne einen Abstieg mit mindestens zwei Flüchen.', icon: ico('skull', '#c04bd6'), reward: 100 },

  // --- Sammlung ---------------------------------------------------------------------------------
  { id: 'relics_25', cat: 'collection', name: 'Sammler', desc: 'Entdecke 25 verschiedene Relikte.', icon: ico('gem', '#5fd38d'), reward: 40,
    check: (s) => Object.keys(s.codex.relics).length >= 25 },
  { id: 'relics_50', cat: 'collection', name: 'Reliktkundiger', desc: 'Entdecke 50 verschiedene Relikte.', icon: ico('gem', '#6aa9ff'), reward: 100,
    check: (s) => Object.keys(s.codex.relics).length >= 50 },
  { id: 'weapons_all', cat: 'collection', name: 'Waffenmeister', desc: 'Führe jede der 15 Waffen mindestens einmal.', icon: ico('sword', '#e8e2d4'), reward: 150,
    check: (s) => WEAPON_IDS.every((id) => num(s.codex.weapons[id]) > 0) },
  { id: 'enemies_all', cat: 'collection', name: 'Bestiarium', desc: 'Entdecke jede Gegnerart des Schachts.', icon: ico('book', EMBER), reward: 100,
    check: (s) => ROSTER_ENEMY_IDS.every((id) => s.codex.enemies[id] && s.codex.enemies[id].seen) },
  { id: 'boon_max', cat: 'collection', name: 'Vollkommener Segen', desc: 'Steigere einen Segen auf seine höchste Stufe.', icon: ico('star', GOLD), reward: 25 },
  { id: 'relics_held_10', cat: 'collection', name: 'Schatzkammer', desc: 'Trage 10 Relikte gleichzeitig.', icon: ico('key', GOLD), reward: 50 },
  { id: 'legendary', cat: 'collection', name: 'Legendärer Fund', desc: 'Finde ein legendäres Relikt.', icon: ico('crown', '#ffb347'), reward: 40 },
  { id: 'weapon_max', cat: 'collection', name: 'Meisterschmied', desc: 'Schmiede eine Waffe auf Stufe 5.', icon: ico('hammer', '#ffb347'), reward: 40 },

  // --- Kurioses ---------------------------------------------------------------------------------
  { id: 'die_first_room', cat: 'curious', name: 'Ein kurzer Abstieg', desc: 'Falle in den Aschegruben, bevor du einen einzigen Raum gesäubert hast.', icon: ico('bone', GREY), reward: 10, secret: true },
  { id: 'sparks_500', cat: 'curious', name: 'Funkenhort', desc: 'Besitze 500 Funken gleichzeitig.', icon: ico('coin', GOLD), reward: 40 },
  { id: 'curses_3', cat: 'curious', name: 'Dreifach verflucht', desc: 'Trage drei Flüche gleichzeitig.', icon: ico('mask', '#c04bd6'), reward: 40, secret: true },
  { id: 'level_15', cat: 'curious', name: 'Glühende Seele', desc: 'Erreiche in einem Abstieg Stufe 15.', icon: ico('orb', '#8fd8ff'), reward: 40 },
  { id: 'falls_10', cat: 'curious', name: 'Die Schwerkraft gewinnt', desc: 'Stürze zehnmal in eine Grube.', icon: ico('anchor', GREY), reward: 15, secret: true,
    check: (s) => num(s.counters.falls) >= 10 },
  { id: 'barrels_100', cat: 'curious', name: 'Fassbrecher', desc: 'Zerschlage 100 Fässer.', icon: ico('bomb', EMBER), reward: 25,
    check: (s) => num(s.counters.barrels) >= 100 },
  { id: 'kills_1000', cat: 'curious', name: 'Aschesturm', desc: 'Besiege insgesamt 1 000 Gegner.', icon: ico('claw', RED), reward: 50,
    check: (s) => num(s.stats.kills) >= 1000 },
  { id: 'revive', cat: 'curious', name: 'Aus der Asche', desc: 'Erhebe dich nach einem tödlichen Treffer erneut.', icon: ico('ember', GREEN), reward: 25 },
  { id: 'secret_room', cat: 'curious', name: 'Verborgene Pfade', desc: 'Finde einen geheimen Raum.', icon: ico('compass', VIOLET), reward: 25, secret: true },
];

function bossKills(save, id) {
  const b = save.codex && save.codex.bosses ? save.codex.bosses[id] : null;
  return b ? num(b.kills) : 0;
}

for (const d of DEFS) {
  if (d.char) {
    const c = d.char;
    d.check = (s) => !!(s.characterStats && s.characterStats[c] && num(s.characterStats[c].wins) > 0);
  }
  if (d.heat != null) {
    const h = d.heat;
    d.check = (s) => Number.isFinite(s.stats.highestDifficultyWon) && s.stats.highestDifficultyWon >= h;
  }
}

/** Achievement definitions in display order. */
export const ACHIEVEMENT_LIST = Object.freeze(DEFS.map((d) => Object.freeze({
  id: d.id, name: d.name, desc: d.desc, icon: d.icon, category: d.cat,
  secret: !!d.secret,
  reward: d.reward ? Object.freeze({ ash: d.reward }) : undefined,
  check: d.check,
})));

/** { [id]: def } */
export const ACHIEVEMENTS = Object.freeze(Object.fromEntries(ACHIEVEMENT_LIST.map((a) => [a.id, a])));

export function isAchievementUnlocked(save, id) {
  return !!(save && save.achievements && save.achievements[id]);
}

/** @returns {{ unlocked: number, total: number, ratio: number }} */
export function achievementProgress(save) {
  const total = ACHIEVEMENT_LIST.length;
  const unlocked = ACHIEVEMENT_LIST.filter((a) => isAchievementUnlocked(save, a.id)).length;
  return { unlocked, total, ratio: total ? unlocked / total : 0 };
}

/**
 * UI list: secret achievements stay hidden ("???") until unlocked.
 * @returns {Array<{ id, def, unlocked: boolean, date: number|null, name, desc, icon, category, categoryName, secret, hidden, reward }>}
 */
export function achievementStatus(save) {
  return ACHIEVEMENT_LIST.map((a) => {
    const unlocked = isAchievementUnlocked(save, a.id);
    const hidden = a.secret && !unlocked;
    const t = unlocked ? save.achievements[a.id] : null;
    return {
      id: a.id, def: a, unlocked, date: unlocked && t > 1 ? t : null,
      name: hidden ? '???' : a.name,
      desc: hidden ? 'Ein verborgener Erfolg. Erkunde den Schacht, um ihn zu entdecken.' : a.desc,
      icon: hidden ? { glyph: 'key', color: '#5a5048' } : a.icon,
      category: a.category, categoryName: ACHIEVEMENT_CATEGORIES[a.category],
      secret: a.secret, hidden, reward: a.reward ? a.reward.ash : 0,
    };
  });
}

/**
 * Unlock one achievement on a save (no events). Grants its ash reward.
 * @returns {boolean} true when it was newly unlocked
 */
export function grantAchievement(save, id) {
  const def = ACHIEVEMENTS[id];
  if (!def || !save) return false;
  ensureSaveShape(save);
  if (save.achievements[id]) return false;
  save.achievements[id] = Date.now();
  const ash = def.reward ? def.reward.ash : 0;
  if (ash > 0) {
    save.ash = num(save.ash) + ash;
    save.totalAsh = num(save.totalAsh) + ash;
  }
  return true;
}

/**
 * Subscribe achievement tracking to the bus.
 * @param {object} game `game.save`, `game.run` are read at event time
 * @param {{ bus?: object }} [opts]
 * @returns {() => void} dispose
 */
export function initAchievements(game, opts = {}) {
  const bus = opts.bus || globalBus;
  const save = () => (game && game.save && typeof game.save === 'object' ? ensureSaveShape(game.save) : null);
  const run = () => (game && game.run) || null;

  // per-run counters
  let rs = null;
  function resetRun(r) {
    rs = { run: r || null, started: !!r, streak: 0, floorHit: false, purchases: 0, bossActive: false, bossDamaged: false };
  }
  resetRun(null);
  function state() {
    const r = run();
    if (r && rs.run !== r) {
      // joined mid-run (no run:start seen): run-wide conditions cannot be verified
      resetRun(r);
      rs.started = false;
    }
    return rs;
  }

  let checking = false;
  function unlock(id) {
    const s = save();
    if (!s || !grantAchievement(s, id)) return false;
    const def = ACHIEVEMENTS[id];
    persistSave(s);
    bus.emit('achievement:unlock', { id, def });
    bus.emit('ui:toast', { kind: 'achievement', text: `Erfolg: ${def.name}`, icon: def.icon });
    bus.emit('meta:change', { save: s });
    return true;
  }
  /** Evaluate every save-state based achievement (idempotent). */
  function checkSave() {
    if (checking) return;
    const s = save();
    if (!s) return;
    checking = true;
    try {
      let again = true;
      while (again) {
        again = false;
        for (const a of ACHIEVEMENT_LIST) {
          if (!a.check || s.achievements[a.id]) continue;
          let ok = false;
          try { ok = !!a.check(s); } catch { ok = false; }
          if (ok && unlock(a.id)) again = true; // a reward may complete an ash achievement
        }
      }
    } finally {
      checking = false;
    }
  }

  const curses = (p) => (p && Array.isArray(p.relics) ? p.relics.filter((r) => r && r.def && r.def.rarity === 'curse').length : 0);
  const relicsHeld = (p) => (p && Array.isArray(p.relics) ? p.relics.filter((r) => r && r.def && r.def.rarity !== 'curse').length : 0);
  const checkSparks = () => { const r = run(); if (r && r.player && num(r.player.sparks) >= 500) unlock('sparks_500'); };
  const bump = (key) => { const s = save(); if (s) s.counters[key] = num(s.counters[key]) + 1; };

  const handlers = {
    'run:start'(p) {
      resetRun((p && p.run) || run());
      checkSave();
    },
    'floor:enter'() {
      const st = state();
      st.floorHit = false;
      st.bossActive = false;
      checkSave();
    },
    'room:enter'(p) {
      if (p && p.room && p.room.type === 'secret') unlock('secret_room');
    },
    'room:clear'() { checkSparks(); checkSave(); },
    'player:hit'(p) {
      if (!p || !(p.amount > 0)) return;
      const st = state();
      if (st.bossActive) st.bossDamaged = true;
      if (!p.dot) {
        st.floorHit = true;
        st.streak = 0;
      }
    },
    'enemy:hit'(p) {
      if (p && num(p.amount) >= 500) unlock('big_hit');
    },
    'enemy:death'(p) {
      if (!p || !p.enemy || (p.enemy.summoned && p.enemy.noXp)) return;
      const st = state();
      st.streak++;
      if (st.streak >= 50) unlock('streak_50');
    },
    'boss:start'() {
      const st = state();
      if (!st.bossActive) { st.bossActive = true; st.bossDamaged = false; }
    },
    'boss:death'(p) {
      const st = state();
      const id = p && p.boss ? ((p.boss.def && p.boss.def.id) || p.boss.id) : null;
      if (st.bossActive && !st.bossDamaged) unlock('boss_flawless');
      if (!st.floorHit && st.started) unlock('floor_hitless');
      st.bossActive = false;
      const r = run();
      const pl = r && r.player;
      if (pl && pl.alive !== false && num(pl.hp) > 0 && pl.stats && num(pl.stats.maxHp) > 0 && pl.hp / pl.stats.maxHp < 0.1) unlock('boss_low_hp');
      if (id && BOSS_IDS.includes(id) && ACHIEVEMENTS[id]) unlock(id);
      checkSave();
    },
    'player:death'(p) {
      unlock('first_death');
      const r = (p && p.run) || run();
      if (r && num(r.floorIndex) <= 1 && r.stats && num(r.stats.roomsCleared) === 0) unlock('die_first_room');
    },
    'player:revive'() { unlock('revive'); },
    'player:levelup'(p) {
      const r = run();
      const lv = Math.max(num(p && p.level), num(r && r.player && r.player.level));
      if (lv >= 15) unlock('level_15');
    },
    'player:fall'() { bump('falls'); checkSave(); },
    'prop:open'(p) {
      if (p && p.kind === 'barrel') { bump('barrels'); checkSave(); }
    },
    'pickup:collect'(p) { if (p && p.kind === 'spark') checkSparks(); },
    'shop:buy'() { state().purchases++; },
    'relic:gain'(p) {
      if (p && p.def && p.def.rarity === 'legendary') unlock('legendary');
      const r = run();
      if (r && relicsHeld(r.player) >= 10) unlock('relics_held_10');
    },
    'curse:gain'() {
      const r = run();
      if (r && curses(r.player) >= 3) unlock('curses_3');
    },
    'boon:gain'(p) {
      const max = p && p.def ? num(p.def.maxStacks) || 1 : 1;
      if (p && max > 1 && num(p.stacks) >= max) unlock('boon_max');
    },
    'weapon:upgrade'(p) { if (p && num(p.level) >= 5) unlock('weapon_max'); },
    'run:end'(p) {
      if (!p) return;
      const r = p.run || run();
      const summary = p.summary || {};
      const victory = p.victory === true || summary.victory === true;
      const st = rs && rs.run === r ? rs : null;
      if (victory) {
        unlock('first_win');
        const ch = summary.character || (r && r.character);
        if (typeof ch === 'string' && ACHIEVEMENTS[`win_${ch}`]) unlock(`win_${ch}`);
        const d = r && r.difficulty != null ? r.difficulty : summary.difficulty;
        const level = d && typeof d === 'object' ? num(d.level) : num(Number(d));
        for (const h of [1, 3, 5, 10]) if (level >= h) unlock(`heat_${h}`);
        const time = num(summary.time) || num(r && r.time);
        if (time > 0 && time < 20 * 60) unlock('win_fast');
        if (st && st.started && st.purchases === 0) unlock('win_no_shop');
        if (r && curses(r.player) >= 2) unlock('win_cursed');
      }
      checkSave();
    },
    'meta:change'() { checkSave(); },
  };

  const offs = Object.keys(handlers).map((evt) => bus.on(evt, handlers[evt]));
  // retroactive unlocks for saves that already meet conditions (e.g. imported or older saves)
  checkSave();

  let disposed = false;
  return function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of offs) off();
  };
}
