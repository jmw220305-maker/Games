// Shrines: choice events on `shrine` props. See docs/ARCHITECTURE.md §6.5.
// SHRINES[id] = { id, name, text, weight, icon, options(ctx) -> [{ id, label, desc, icon?, available?, keep?, pick(ctx) }] }
// ctx = { w, player, run, rng } (props.js). Every shrine ends with "Weitergehen", which keeps the shrine usable (keep: true).
import { bus } from '../core/events.js';
import { RELICS } from './relics.js';
import { WEAPONS } from './weapons.js';
import { rollRelics, rollBoons, removePerk, refreshPerkMods, addPerk } from '../game/perks.js';
import { MAX_WEAPON_LEVEL, recalcWeapon } from '../game/combat.js';

const ORDER = ['common', 'uncommon', 'rare', 'legendary'];
const RAR_NAME = { common: 'Gewöhnlich', uncommon: 'Selten', rare: 'Episch', legendary: 'Legendär' };

// ---------------------------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------------------------
/** Normalised shrine context. */
export function shrineCtx(ctx) {
  const run = ctx.run || ctx;
  const w = ctx.w || run.world;
  return { run, w, player: ctx.player || run.player, rng: ctx.rng || (w && w.rng) || run.rng };
}

const floorOf = (run) => Math.max(1, run.floorIndex || 1);
/** Funken price scaled by floor (+30 % per floor below the first). */
export const shrinePrice = (run, base) => Math.round(base * (1 + 0.3 * (floorOf(run) - 1)));

function toast(text, kind = 'info', icon) { bus.emit('ui:toast', icon ? { text, kind, icon } : { text, kind }); }

function rollRelicId(c, minRarity, boost = 0) {
  const d = rollRelics(c.run, 1, { rng: c.rng, minRarity, boost })[0];
  return d ? d.id : null;
}

function giveRelic(c, id) {
  if (!id) return null;
  return typeof c.run.giveRelic === 'function' ? c.run.giveRelic(id) : addPerk(c.run, 'relic', id);
}

function gainSparks(c, n) {
  const p = c.player;
  if (typeof p.gainSparks === 'function') p.gainSparks(n); else p.sparks = (p.sparks || 0) + n;
}

/** Random relic of at least `minRarity`; falls back to Funken when the pool is empty. */
function giveRandomRelic(c, minRarity, boost = 0) {
  const id = rollRelicId(c, minRarity, boost);
  if (id) {
    const perk = giveRelic(c, id);
    if (perk) toast(`${RELICS[id].name} erhalten`, 'good', RELICS[id].icon);
    return perk;
  }
  gainSparks(c, 25);
  toast('Keine Relikte mehr: +25 Funken', 'good');
  return null;
}

function offerRelics(c, n, opts) {
  if (typeof c.run.offerRelicChoice === 'function') return c.run.offerRelicChoice(n, opts);
  return giveRandomRelic(c, opts && opts.minRarity, opts && opts.boost);
}

function giveCurse(c, id) {
  const perk = typeof c.run.giveCurse === 'function' ? c.run.giveCurse(id) : null;
  if (perk) toast(`Fluch: ${perk.def.name}`, 'bad', perk.def.icon);
  return perk;
}

function giveBoon(c, id) {
  return typeof c.run.giveBoon === 'function' ? c.run.giveBoon(id) : addPerk(c.run, 'boon', id);
}

function spend(c, n) {
  const p = c.player;
  return typeof p.spendSparks === 'function' ? p.spendSparks(n) : (p.sparks >= n ? ((p.sparks -= n), true) : false);
}

/** Lose current HP (never below 1, bypasses shield / armor / dodge). */
function payHp(c, n) {
  const p = c.player;
  const loss = Math.min(n, Math.max(0, p.hp - 1));
  p.hp -= loss;
  if (c.run.stats) c.run.stats.damageTaken += loss;
  if (c.w) {
    c.w.fx.burst('blood', p.x, p.y, { count: 12 });
    c.w.fx.text(p.x, p.y - 12, `-${Math.round(loss)}`, '#ff5a5a', { player: true });
  }
  return loss;
}

/** Permanent stat change for the rest of the run (unique mod key per use). */
function addPermanent(c, key, mods) {
  const run = c.run, p = c.player;
  if (!run.flags) run.flags = {};
  run.flags.shrineMods = (run.flags.shrineMods || 0) + 1;
  const k = `shrine:${key}:${run.flags.shrineMods}`;
  if (typeof p.addMod === 'function') {
    p.addMod(k, mods);
    if (typeof p.recalc === 'function') p.recalc();
  } else if (p.mods) p.mods.set(k, mods);
  if (p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
  if (p.hp < 1) p.hp = 1;
}

function loseMaxHp(c, amount) { addPermanent(c, 'maxhp', [{ stat: 'maxHp', add: -amount }]); }

/** Asche as magnet pickups at the player (counted through the normal pickup path). */
function gainAsh(c, n) {
  const p = c.player;
  if (typeof c.run.giveAsh === 'function') { c.run.giveAsh(n); return; }
  if (!c.w) { c.run.stats.ashPickedUp = (c.run.stats.ashPickedUp || 0) + n; return; }
  let left = Math.round(n);
  while (left > 0) {
    const v = Math.min(5, left);
    c.w.spawnPickup('ash', p.x, p.y, { amount: v, burst: true, magnet: true });
    left -= v;
  }
}

function upgradableWeapons(p) { return (p.weapons || []).filter((ws) => ws && ws.level < MAX_WEAPON_LEVEL); }

function upgradeWeapon(c, ws) {
  const p = c.player;
  if (typeof p.upgradeWeapon === 'function') return p.upgradeWeapon(ws);
  if (ws.level >= MAX_WEAPON_LEVEL) return false;
  ws.level++;
  recalcWeapon(ws);
  bus.emit('weapon:upgrade', { id: ws.id, level: ws.level });
  return true;
}

function upgradeAll(c) {
  let n = 0;
  for (const ws of upgradableWeapons(c.player)) if (upgradeWeapon(c, ws)) n++;
  if (c.w) c.w.fx.burst('ember', c.player.x, c.player.y, { count: 24 });
  if (n) toast(n > 1 ? 'Beide Waffen geschmiedet' : 'Waffe geschmiedet', 'good', { glyph: 'hammer', color: '#ff8a3c' });
  return n;
}

function loseBoonStack(c, perk) {
  if (perk.stacks > 1) {
    perk.stacks--;
    refreshPerkMods(c.player, perk);
    c.player.recalc();
  } else removePerk(c.run, 'boon', perk.def.id);
}

const leave = (text = 'Du lässt den Schrein unberührt.') => ({
  id: 'leave', label: 'Weitergehen', desc: text, icon: { glyph: 'boot', color: '#b9b3a8' }, keep: true, pick() {},
});

const sparkIcon = { glyph: 'coin', color: '#ffd35a' };
const bloodIcon = { glyph: 'drop', color: '#ff4f5a' };

// --- Glücksrad outcomes: w = paid spin weight, wf = free spin weight -----------------------------
const WHEEL = [
  { id: 'relic', w: 18, wf: 9, run(c) { giveRandomRelic(c); } },
  {
    id: 'boon', w: 16, wf: 9,
    run(c) {
      const d = rollBoons(c.run, 1, { rng: c.rng })[0];
      if (d) { giveBoon(c, d.id); toast(`Segen: ${d.name}`, 'good', d.icon); } else { gainSparks(c, 30); toast('+30 Funken', 'good', sparkIcon); }
    },
  },
  { id: 'sparks', w: 16, wf: 14, run(c) { const n = shrinePrice(c.run, 40); gainSparks(c, n); toast(`+${n} Funken`, 'good', sparkIcon); } },
  { id: 'heal', w: 12, wf: 10, run(c) { if (c.w) c.w.healPlayer(c.player.stats.maxHp); toast('Vollständig geheilt', 'good', { glyph: 'heart', color: '#7dff9a' }); } },
  { id: 'curse', w: 10, wf: 16, run(c) { giveCurse(c); } },
  { id: 'wound', w: 10, wf: 18, run(c) { payHp(c, Math.round(c.player.stats.maxHp * 0.2)); toast('Das Rad schneidet dich', 'bad', bloodIcon); } },
  { id: 'legendary', w: 3, wf: 1.5, run(c) { giveRandomRelic(c, 'legendary'); } },
  { id: 'nothing', w: 15, wf: 22.5, run() { toast('Das Rad bleibt stehen. Nichts geschieht.', 'info'); } },
];

function spinWheel(c, free) {
  const o = c.rng.weighted(WHEEL, (x) => (free ? x.wf : x.w));
  o.run(c);
  return o.id;
}

// --- Wächterstatue: guardians + one-shot reward listener ----------------------------------------
function summonGuardians(c) {
  const { w, run, rng } = c;
  if (!w || !w.room) return [];
  const list = (w.biome && w.biome.enemies) || [];
  const n = floorOf(run) >= 3 ? 3 : 2;
  const spawned = [];
  for (let i = 0; i < n; i++) {
    const en = list.length ? rng.weighted(list, (e) => e.weight ?? 1) : null;
    const pos = w.randomFloorPos({ minPlayerDist: 64, maxPlayerDist: 170 });
    spawned.push(w.spawnEnemy(en ? en.id : 'ash_crawler', pos.x, pos.y, { elite: 1, delay: 1 + i * 0.2 }));
  }
  // lock the doors like a combat room (only in rooms without own waves: the world clears it when all are dead)
  const room = w.room;
  if (!(room.spawns && room.spawns.length)) {
    w.locked = true;
    bus.emit('room:lock', { room });
    bus.emit('door:close', {});
  }
  const ids = new Set(spawned.map((e) => e.uid));
  const offs = [];
  const done = () => { while (offs.length) offs.pop()(); };
  offs.push(bus.on('enemy:death', ({ enemy }) => {
    if (!enemy || !ids.delete(enemy.uid) || ids.size > 0) return;
    done();
    const p = c.player;
    w.dropLoot(enemy.x, enemy.y, { sparks: shrinePrice(run, 20) });
    w.fx.ring(p.x, p.y, 60, '#6aa9ff', 0.5);
    toast('Die Wächter sind bezwungen', 'good', { glyph: 'crown', color: '#6aa9ff' });
    giveRandomRelic(c, 'rare');
  }));
  offs.push(bus.on('room:enter', done));
  offs.push(bus.on('run:end', done));
  return spawned;
}

// ---------------------------------------------------------------------------------------------
// Shrines
// ---------------------------------------------------------------------------------------------
const LIST = [
  {
    id: 'blood', name: 'Blutaltar', weight: 1, icon: { glyph: 'drop', color: '#d6304a' },
    text: 'Ein schwarzer Stein, warm wie Haut. Rillen führen zu einer Schale, die niemals trocknet.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const cost = Math.max(15, Math.round(p.stats.maxHp * 0.2));
      return [
        {
          id: 'bleed', label: 'Blut geben', icon: bloodIcon, available: p.hp > cost + 1,
          desc: `Verliere ${cost} Leben. Erhalte ein zufälliges Relikt.`,
          pick(x) { const k = shrineCtx(x); payHp(k, cost); giveRandomRelic(k); },
        },
        {
          id: 'lifeblood', label: 'Lebensblut opfern', icon: { glyph: 'heart', color: '#d6304a' }, available: p.stats.maxHp > 40,
          desc: 'Verliere dauerhaft 12 max. Leben. Wähle 1 aus 3 Relikten (mindestens Selten).',
          pick(x) { const k = shrineCtx(x); loseMaxHp(k, 12); offerRelics(k, 3, { minRarity: 'uncommon', title: 'Blutaltar', text: 'Dein Blut hat gewählt.' }); },
        },
        leave(),
      ];
    },
  },
  {
    id: 'greed', name: 'Gierschrein', weight: 1, icon: { glyph: 'coin', color: '#ffbf2a' },
    text: 'Goldene Zähne grinsen aus dem Fels. Sie wollen Funken – und sie wollen immer mehr.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const p1 = shrinePrice(c.run, 40), p2 = shrinePrice(c.run, 90), p3 = shrinePrice(c.run, 20);
      return [
        {
          id: 'offering', label: 'Opfergabe', icon: sparkIcon, available: p.sparks >= p1,
          desc: `Zahle ${p1} Funken: Wähle 1 aus 3 Relikten (mindestens Selten).`,
          pick(x) { const k = shrineCtx(x); if (spend(k, p1)) offerRelics(k, 3, { minRarity: 'uncommon', title: 'Gierschrein' }); },
        },
        {
          id: 'tribute', label: 'Großes Opfer', icon: { glyph: 'gem', color: '#6aa9ff' }, available: p.sparks >= p2,
          desc: `Zahle ${p2} Funken: Erhalte ein episches Relikt.`,
          pick(x) { const k = shrineCtx(x); if (spend(k, p2)) giveRandomRelic(k, 'rare'); },
        },
        {
          id: 'gamble', label: 'Glücksspiel', icon: { glyph: 'dice', color: '#ffd35a' }, available: p.sparks >= p3,
          desc: `Zahle ${p3} Funken: 50 % Chance auf ein zufälliges Relikt – sonst nichts.`,
          pick(x) {
            const k = shrineCtx(x);
            if (!spend(k, p3)) return;
            if (k.rng.chance(0.5)) giveRandomRelic(k);
            else toast('Die Zähne schließen sich. Deine Funken sind fort.', 'bad', sparkIcon);
          },
        },
        leave(),
      ];
    },
  },
  {
    id: 'curse', name: 'Fluchschrein', weight: 0.8, icon: { glyph: 'skull', color: '#c04bd6' },
    text: 'Violettes Feuer, das nicht wärmt. Eine Stimme bietet dir Macht – zu einem Preis, den du tragen wirst.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const curses = p.relics.filter((r) => r.def.rarity === 'curse');
      const target = curses.length ? c.rng.pick(curses) : null;
      const cleanse = shrinePrice(c.run, 35);
      return [
        {
          id: 'pact', label: 'Den Pakt schließen', icon: { glyph: 'crown', color: '#ffb347' }, rarity: 'legendary',
          desc: 'Erhalte einen zufälligen Fluch – und ein legendäres Relikt.',
          pick(x) { const k = shrineCtx(x); giveCurse(k); giveRandomRelic(k, 'legendary'); },
        },
        {
          id: 'cleanse', label: 'Läutern', icon: { glyph: 'candle', color: '#e8e2d4' }, available: !!target && p.sparks >= cleanse,
          desc: target ? `Zahle ${cleanse} Funken: Entferne »${target.def.name}«.` : `Zahle ${cleanse} Funken: Entferne einen Fluch (du trägst keinen).`,
          pick(x) {
            const k = shrineCtx(x);
            if (!target || !spend(k, cleanse)) return;
            removePerk(k.run, 'relic', target.def.id);
            toast(`${target.def.name} ist gebrochen`, 'good', { glyph: 'candle', color: '#e8e2d4' });
          },
        },
        leave(),
      ];
    },
  },
  {
    id: 'ancestor_forge', name: 'Schmiedeschrein der Ahnen', weight: 0.8, icon: { glyph: 'hammer', color: '#ff8a3c' },
    text: 'Ein Amboss aus erkalteter Sonne. Die Hämmer der Ahnen ruhen – sie warten auf ein Opfer.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const can = upgradableWeapons(p).length > 0;
      const cost = shrinePrice(c.run, 45);
      return [
        {
          id: 'sparks', label: 'Mit Funken bezahlen', icon: sparkIcon, available: can && p.sparks >= cost,
          desc: `Zahle ${cost} Funken: Jede deiner Waffen steigt um 1 Stufe.`,
          pick(x) { const k = shrineCtx(x); if (spend(k, cost)) upgradeAll(k); },
        },
        {
          id: 'blood', label: 'Mit Blut bezahlen', icon: bloodIcon, available: can && p.stats.maxHp > 30,
          desc: 'Verliere dauerhaft 10 max. Leben: Jede deiner Waffen steigt um 1 Stufe.',
          pick(x) { const k = shrineCtx(x); loseMaxHp(k, 10); upgradeAll(k); },
        },
        leave('Die Hämmer schlafen weiter.'),
      ];
    },
  },
  {
    id: 'memory_well', name: 'Brunnen der Erinnerung', weight: 0.8, icon: { glyph: 'drop', color: '#8fd8ff' },
    text: 'Im Wasser treiben Bilder vergangener Träger. Was du hier vergisst, kehrt verwandelt zurück.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const target = p.boons.length ? c.rng.pick(p.boons) : null;
      return [
        {
          id: 'remember', label: 'Erinnern', icon: { glyph: 'book', color: '#8fd8ff' }, available: !!target,
          desc: target ? `Verliere 1 Stufe von »${target.def.name}«. Erhalte 2 zufällige Segen.` : 'Verliere 1 Segensstufe, erhalte 2 zufällige Segen (du hast keine Segen).',
          pick(x) {
            const k = shrineCtx(x);
            if (!target || !k.player.boons.includes(target)) return;
            loseBoonStack(k, target);
            const defs = rollBoons(k.run, 2, { rng: k.rng, exclude: new Set([target.def.id]) });
            for (const d of defs) giveBoon(k, d.id);
            if (defs.length) toast(`Neue Segen: ${defs.map((d) => d.name).join(', ')}`, 'good', { glyph: 'book', color: '#8fd8ff' });
          },
        },
        {
          id: 'drink', label: 'Einen Schluck nehmen', icon: { glyph: 'heart', color: '#7dff9a' },
          desc: 'Heile 25 % deines Lebens.',
          pick(x) { const k = shrineCtx(x); if (k.w) k.w.healPlayer(k.player.stats.maxHp * 0.25); },
        },
        leave(),
      ];
    },
  },
  {
    id: 'mirror', name: 'Spiegel der Tiefe', weight: 0.7, icon: { glyph: 'mirror', color: '#e8f4ff' },
    text: 'Glas, schwärzer als die Nacht. Dein Spiegelbild trägt etwas, das auch du trägst – nur heller.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const pool = p.relics.filter((r) => r.def.rarity === 'common' && r.stacks < (r.def.maxStacks ?? 1));
      const target = pool.length ? c.rng.pick(pool) : null;
      const gold = shrinePrice(c.run, 30);
      return [
        {
          id: 'reflect', label: 'Spiegeln', icon: target ? target.def.icon : { glyph: 'mirror', color: '#e8f4ff' }, available: !!target,
          desc: target ? `»${target.def.name}« wirkt doppelt: ${target.def.desc}` : 'Verdopple ein gewöhnliches Relikt (du trägst keines, das sich spiegeln lässt).',
          pick(x) {
            const k = shrineCtx(x);
            if (!target) return;
            giveRelic(k, target.def.id);
            toast(`${target.def.name} gespiegelt`, 'good', target.def.icon);
          },
        },
        {
          id: 'shatter', label: 'Zerschlagen', icon: { glyph: 'gem', color: '#c9c2b8' },
          desc: `Erhalte ${gold} Funken, aber dauerhaft −1 Glück.`,
          pick(x) { const k = shrineCtx(x); gainSparks(k, gold); addPermanent(k, 'luck', [{ stat: 'luck', add: -1 }]); },
        },
        leave(),
      ];
    },
  },
  {
    id: 'sacrifice', name: 'Opferstein', weight: 0.9, icon: { glyph: 'heart', color: '#b0203a' },
    text: 'Ein Stein mit einer Mulde in Form eines Herzens. Er nimmt, was du am meisten brauchst – und gibt Zorn zurück.',
    options(ctx) {
      const p = shrineCtx(ctx).player;
      return [
        {
          id: 'small', label: 'Kleines Opfer', icon: bloodIcon, available: p.stats.maxHp > 35,
          desc: 'Verliere dauerhaft 15 max. Leben. Erhalte dauerhaft +10 % Schaden.',
          pick(x) { const k = shrineCtx(x); loseMaxHp(k, 15); addPermanent(k, 'dmg', [{ stat: 'damage', mul: 1.1 }]); },
        },
        {
          id: 'great', label: 'Großes Opfer', icon: { glyph: 'skull', color: '#b0203a' }, available: p.stats.maxHp > 55,
          desc: 'Verliere dauerhaft 30 max. Leben. Erhalte dauerhaft +22 % Schaden.',
          pick(x) { const k = shrineCtx(x); loseMaxHp(k, 30); addPermanent(k, 'dmg', [{ stat: 'damage', mul: 1.22 }]); },
        },
        leave(),
      ];
    },
  },
  {
    id: 'wheel', name: 'Glücksrad', weight: 1, icon: { glyph: 'dice', color: '#ffd35a' },
    text: 'Ein rostiges Rad voller Zeichen, die niemand je gemalt hat. Es dreht sich schon, bevor du es berührst.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const cost = shrinePrice(c.run, 15);
      return [
        {
          id: 'spin', label: 'Drehen', icon: sparkIcon, available: p.sparks >= cost,
          desc: `Zahle ${cost} Funken für ein zufälliges Schicksal: Relikt, Segen, Funken, Heilung – oder ein Fluch.`,
          pick(x) { const k = shrineCtx(x); if (spend(k, cost)) spinWheel(k, false); },
        },
        {
          id: 'yank', label: 'Am Rad reißen', icon: { glyph: 'hand', color: '#c04bd6' },
          desc: 'Kostenlos – aber das Rad meint es seltener gut mit dir.',
          pick(x) { spinWheel(shrineCtx(x), true); },
        },
        leave(),
      ];
    },
  },
  {
    id: 'guardian', name: 'Wächterstatue', weight: 0.9, icon: { glyph: 'shield', color: '#6aa9ff' },
    text: 'Eine steinerne Gestalt mit glühenden Augen. Wer sie herausfordert, muss ihre Wächter bezwingen.',
    options(ctx) {
      const c = shrineCtx(ctx);
      const n = floorOf(c.run) >= 3 ? 3 : 2;
      return [
        {
          id: 'challenge', label: 'Herausfordern', icon: { glyph: 'sword', color: '#6aa9ff' }, rarity: 'rare',
          desc: `${n} Elitewächter erwachen und die Türen schließen sich. Besiege sie für ein episches Relikt und Funken.`,
          pick(x) { summonGuardians(shrineCtx(x)); },
        },
        leave('Die Augen der Statue folgen dir.'),
      ];
    },
  },
  {
    id: 'ash_chalice', name: 'Aschekelch', weight: 0.8, icon: { glyph: 'potion', color: '#c9c2b8' },
    text: 'Ein Kelch voll grauer Asche, die nach Heimat riecht. Die Feuerstelle oben wird sich an dein Opfer erinnern.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player, fl = floorOf(c.run);
      const sip = 15, small = 6 + 2 * fl, big = 20 + 6 * fl;
      const bigHp = Math.max(1, Math.round(p.stats.maxHp * 0.15));
      return [
        {
          id: 'sip', label: 'Nippen', icon: bloodIcon, available: p.hp > sip + 1,
          desc: `Verliere ${sip} Leben. Erhalte ${small} Asche.`,
          pick(x) { const k = shrineCtx(x); payHp(k, sip); gainAsh(k, small); },
        },
        {
          id: 'drain', label: 'Leeren', icon: { glyph: 'skull', color: '#c9c2b8' }, available: p.stats.maxHp > 30,
          desc: `Verliere dauerhaft ${bigHp} max. Leben (15 %). Erhalte ${big} Asche.`,
          pick(x) { const k = shrineCtx(x); loseMaxHp(k, bigHp); gainAsh(k, big); },
        },
        leave(),
      ];
    },
  },
  {
    id: 'soul_swap', name: 'Seelentausch', weight: 0.6, icon: { glyph: 'hand', color: '#d86bff' },
    text: 'Zwei Hände aus Rauch strecken sich nach deiner Waffe. Sie bieten dir etwas Besseres – ungesehen.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const ws = p.weapon;
      const pool = ws ? swapPool(c, ws) : [];
      return [
        {
          id: 'swap', label: 'Tauschen', icon: ws ? ws.def.icon : { glyph: 'hand', color: '#d86bff' }, available: pool.length > 0,
          desc: ws
            ? `Tausche »${ws.def.name}« (Stufe ${ws.level}) gegen eine zufällige Waffe höherer Seltenheit auf gleicher Stufe.`
            : 'Tausche deine Waffe gegen eine zufällige Waffe höherer Seltenheit.',
          pick(x) {
            const k = shrineCtx(x), pl = k.player, cur = pl.weapon;
            if (!cur) return;
            const options = swapPool(k, cur);
            if (!options.length) return;
            const def = k.rng.pick(options);
            const level = cur.level;
            if (cur.def.onUnequip) { try { cur.def.onUnequip(k.w, pl, cur); } catch (err) { console.error('[shrine] onUnequip failed', err); } }
            pl.weapons[pl.weaponIndex] = null;
            const nws = k.run.giveWeapon(def.id, level);
            if (nws) toast(`${def.name} (${RAR_NAME[def.rarity] || ''}) erhalten`, 'good', def.icon);
          },
        },
        leave('Die Hände lösen sich in Rauch auf.'),
      ];
    },
  },
  {
    id: 'star_map', name: 'Sternenkarte', weight: 0.7, icon: { glyph: 'star', color: '#fff3b0' },
    text: 'In die Decke geritzt: Sterne, die längst erloschen sind. Sie zeigen dir trotzdem den Weg.',
    options(ctx) {
      const c = shrineCtx(ctx), p = c.player;
      const cost = shrinePrice(c.run, 25);
      return [
        {
          id: 'study', label: 'Studieren', icon: { glyph: 'compass', color: '#fff3b0' },
          desc: 'Enthülle alle Räume dieses Stockwerks auf der Karte.',
          pick(x) { revealFloor(shrineCtx(x)); },
        },
        {
          id: 'read', label: 'Die Sterne deuten', icon: { glyph: 'star', color: '#ffd35a' }, available: p.sparks >= cost,
          desc: `Zahle ${cost} Funken: Enthülle die Karte und erhalte +1 Glück sowie +1 Neuwurf.`,
          pick(x) {
            const k = shrineCtx(x);
            if (!spend(k, cost)) return;
            revealFloor(k);
            addPermanent(k, 'luck', [{ stat: 'luck', add: 1 }]);
            k.run.rerolls = (k.run.rerolls || 0) + 1;
          },
        },
        leave(),
      ];
    },
  },
];

function swapPool(c, ws) {
  const cur = ORDER.indexOf(ws.def.rarity || 'common');
  const unlocked = c.run.unlockedWeapons;
  const other = (c.player.weapons || []).filter((x) => x && x !== ws).map((x) => x.id);
  return Object.values(WEAPONS).filter((d) => ORDER.indexOf(d.rarity || 'common') > cur && d.id !== ws.id && !other.includes(d.id)
    && (!unlocked || typeof unlocked.has !== 'function' || unlocked.has(d.id)));
}

function revealFloor(c) {
  const floor = c.run.floor;
  if (!floor || !floor.rooms) return 0;
  let n = 0;
  for (const r of floor.rooms) if (r && !r.seen) { r.seen = true; n++; }
  toast('Die Sterne zeigen dir den Weg', 'good', { glyph: 'compass', color: '#fff3b0' });
  return n;
}

export const SHRINES = {};
for (const def of LIST) SHRINES[def.id] = def;
