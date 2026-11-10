// Runtime props: chests, shop pedestals, shrines, forges, fountains, portals, destructibles, decoration.
// See docs/ARCHITECTURE.md §4 (prop kinds) and §11.2 (runtime shape). DOM-free.
import { bus } from '../core/events.js';
import { TS, TILE, TOTAL_FLOORS } from './constants.js';
import { SHRINES, WEAPONS } from './registry.js';
import { rollRelics, rollBoons } from './perks.js';
import { MAX_WEAPON_LEVEL } from './combat.js';

const INTERACT_RANGE = 16;   // px beyond the prop radius
const PORTAL_STAND_TIME = 0.8;

const RELIC_PRICE = { common: 40, uncommon: 65, rare: 100, legendary: 160 };
const BASE_PRICE = { weapon: 75, heal: 30, boon: 55 };
const HEAL_OFFER = { name: 'Glutelixier', desc: 'Heilt 35 % deines maximalen Lebens.', icon: { glyph: 'potion', color: '#ff6a5a' } };

const INTERACTIVE = new Set(['chest', 'pedestal', 'shrine', 'forge', 'fountain', 'portal']);

// kind -> [radius, solid, destructible]
const KINDS = {
  chest: [7, true, false],
  pedestal: [7, true, false],
  shrine: [8, true, false],
  forge: [9, true, false],
  fountain: [9, true, false],
  portal: [10, false, false],
  barrel: [6, true, true],
  crystal: [6, true, true],
  torch: [3, false, false],
  statue: [7, true, false],
  stalagmite: [6, true, false],
  bones: [5, false, false],
  mushroom: [5, false, false],
};

const floorOf = (run) => Math.max(1, run.floorIndex || 1);

function roundTo5(v) { return Math.max(5, Math.round(v / 5) * 5); }

/** Floor / difficulty / discount price factor shared by shops and forges. */
function priceFactor(run, withDiscount = true) {
  const shop = (run.difficulty && run.difficulty.mods && run.difficulty.mods.shopPrice) ?? 1;
  let f = (1 + 0.15 * (floorOf(run) - 1)) * shop;
  if (withDiscount) {
    const disc = (run.player.stats.shopDiscount || 0) + ((run.bonuses && run.bonuses.shopDiscount) || 0);
    f *= Math.max(0.4, 1 - disc);
  }
  return f;
}

function textOf(v, n) { return typeof v === 'function' ? v(n) : (v || ''); }

function offerRng(run) { return run.world ? run.world.rng : run.rng; }

/**
 * Resolve a shop/reward offer.
 * @param {object} run
 * @param {'relic'|'weapon'|'heal'|'boon'|'random'} type
 * @param {{ price?: 'auto'|number, exclude?: Set<string>, minRarity?: string, boost?: number }} [opts]
 * @returns {{ type, id, def, name, desc, icon, rarity, price, level? }}
 */
export function resolveOffer(run, type, opts = {}) {
  const rng = offerRng(run);
  const player = run.player;
  let offer = null;
  if (type === 'random') {
    type = rng.weighted([{ t: 'relic', w: 45 }, { t: 'weapon', w: 15 }, { t: 'heal', w: 20 }, { t: 'boon', w: 20 }], (o) => o.w).t;
  }
  if (type === 'relic') {
    const def = rollRelics(run, 1, { rng, exclude: opts.exclude, minRarity: opts.minRarity, boost: opts.boost || 0 })[0];
    if (def) {
      if (opts.exclude) opts.exclude.add(def.id);
      offer = { type, id: def.id, def, name: def.name, desc: textOf(def.desc, 1), icon: def.icon, rarity: def.rarity, base: RELIC_PRICE[def.rarity] ?? 65 };
    } else type = 'heal';
  } else if (type === 'weapon') {
    const held = new Set(player.weapons.filter(Boolean).map((ws) => ws.id));
    const pool = Object.values(WEAPONS).filter((d) => d && d.id && !held.has(d.id) && !(opts.exclude && opts.exclude.has(d.id))
      && (!run.unlockedWeapons || run.unlockedWeapons.has(d.id)));
    const def = pool.length ? rng.pick(pool) : null;
    if (def) {
      if (opts.exclude) opts.exclude.add(def.id);
      const level = floorOf(run) >= 3 && rng.chance(0.35) ? 2 : 1;
      offer = { type, id: def.id, def, level, name: level > 1 ? `${def.name} (Stufe ${level})` : def.name, desc: def.desc || '', icon: def.icon, rarity: def.rarity || 'common', base: BASE_PRICE.weapon * (level > 1 ? 1.3 : 1) };
    } else type = 'heal';
  } else if (type === 'boon') {
    const def = rollBoons(run, 1, { rng, exclude: opts.exclude })[0];
    if (def) {
      if (opts.exclude) opts.exclude.add(def.id);
      const have = player.boons.find((p) => p.def.id === def.id);
      const n = (have ? have.stacks : 0) + 1;
      offer = { type, id: def.id, def, name: def.name, desc: textOf(def.desc, n), icon: def.icon, rarity: def.rarity || 'common', base: BASE_PRICE.boon };
    } else type = 'heal';
  }
  if (!offer) {
    offer = { type: 'heal', id: 'heal', def: null, name: HEAL_OFFER.name, desc: HEAL_OFFER.desc, icon: HEAL_OFFER.icon, rarity: 'common', base: BASE_PRICE.heal };
  }
  const price = opts.price ?? 'auto';
  offer.price = price === 'auto' ? roundTo5(offer.base * priceFactor(run)) : Math.max(0, Math.round(Number(price) || 0));
  delete offer.base;
  return offer;
}

/** Forge price for upgrading a weapon state to the next level. */
export function forgeCost(run, ws) {
  return roundTo5((40 + 30 * (ws.level - 1)) * priceFactor(run, false));
}

function makeProp(w, room, spec) {
  const kind = spec.kind || 'statue';
  const k = KINDS[kind] || [6, false, false];
  const pr = {
    kind, spec, tx: spec.tx, ty: spec.ty,
    x: (spec.tx + 0.5) * TS, y: (spec.ty + 0.5) * TS,
    r: spec.r ?? k[0], solid: spec.solid ?? k[1], destructible: k[2],
    removed: false, used: false, locked: false,
    sprite: `prop_${kind}`, light: null, offer: null, flash: 0,
    group: spec.group || null, interactive: INTERACTIVE.has(kind),
    data: {},
  };
  const run = w.run;
  switch (kind) {
    case 'chest': {
      pr.tier = spec.tier === 'rare' || spec.tier === 'cursed' ? spec.tier : 'common';
      pr.sprite = pr.tier === 'rare' ? 'prop_chest_rare' : pr.tier === 'cursed' ? 'prop_chest_cursed' : 'prop_chest';
      pr.locked = !!spec.locked;
      break;
    }
    case 'pedestal': {
      if (!room._offerIds) room._offerIds = new Set();
      const price = spec.price ?? (room.type === 'shop' ? 'auto' : 0);
      pr.offer = resolveOffer(run, spec.offer || 'random', { price, exclude: room._offerIds, minRarity: spec.minRarity, boost: spec.boost });
      break;
    }
    case 'shrine': {
      const defs = Object.values(SHRINES);
      pr.shrine = (spec.shrine && SHRINES[spec.shrine]) || (defs.length ? w.rng.weighted(defs, (d) => d.weight ?? 1) : null);
      if (!pr.shrine) pr.used = true;
      break;
    }
    case 'forge': pr.usesLeft = spec.uses ?? 2; break;
    case 'barrel':
      pr.explosive = !!spec.explosive;
      if (pr.explosive) pr.sprite = 'prop_barrel_explosive';
      break;
    case 'crystal': pr.light = { r: 46, color: (w.biome && w.biome.accent) || '#8fd8ff' }; break;
    case 'torch': pr.light = { r: 64, color: '#ffb066' }; break;
    case 'portal': pr.light = { r: 70, color: (w.biome && w.biome.accent) || '#ffd35a' }; break;
    default: break;
  }
  return pr;
}

/** Create runtime props for a room once; the array is cached on the room so state survives re-entry. */
export function instantiateProps(w, room) {
  if (room._props) return room._props;
  const out = [];
  for (const spec of room.props || []) {
    if (!spec || spec.tx == null || spec.ty == null) continue;
    try { out.push(makeProp(w, room, spec)); } catch (err) { console.error(`[props] could not create "${spec.kind}"`, err); }
  }
  room._props = out;
  return out;
}

/** Add a prop at runtime (e.g. boss rewards). Rebuilds the blocked map for solid props. */
export function addProp(w, spec) {
  const pr = makeProp(w, w.room, spec);
  w.props.push(pr);
  if (pr.solid) w.rebuildBlocked();
  return pr;
}

function removeProp(w, pr) {
  if (pr.removed) return;
  pr.removed = true;
  if (pr.solid) w.rebuildBlocked();
}

function hintText(w, pr) {
  switch (pr.kind) {
    case 'chest': return pr.locked ? 'Versiegelt' : 'Öffnen';
    case 'pedestal': return pr.offer.price > 0 ? `${pr.offer.name} – ${pr.offer.price} Funken` : `Nehmen: ${pr.offer.name}`;
    case 'shrine': return 'Altar berühren';
    case 'forge': return 'Schmieden';
    case 'fountain': return 'Trinken';
    case 'portal': return w.run.floorIndex >= TOTAL_FLOORS ? 'Das Sonnenherz entzünden' : 'Hinabsteigen';
    default: return '';
  }
}

function canInteract(pr) {
  if (pr.removed || pr.used || !pr.interactive) return false;
  if (pr.kind === 'pedestal' && !pr.offer) return false;
  return true;
}

export function updateProps(w, dt) {
  const p = w.player, run = w.run;
  let best = null, bd = Infinity;
  for (const pr of w.props) {
    if (pr.flash > 0) pr.flash = Math.max(0, pr.flash - dt * 3);
    if (!canInteract(pr)) continue;
    const d = Math.hypot(pr.x - p.x, pr.y - p.y);
    if (pr.kind === 'portal') {
      // touch devices: standing on the portal for a moment also uses it
      const input = run.game.input;
      if (d < pr.r && !w.locked && p.alive && !run.ended && (input.lastDevice === 'touch' || input.isTouch)) {
        pr.data.standT = (pr.data.standT || 0) + dt;
        if (pr.data.standT >= PORTAL_STAND_TIME) { pr.data.standT = 0; interact(w, pr); return; }
      } else pr.data.standT = 0;
    }
    if (d <= pr.r + INTERACT_RANGE && d < bd) { bd = d; best = pr; }
  }
  if (!best || w.locked || !p.alive || run.ended) {
    w.interactHint = null;
    w.interactProp = null;
    return;
  }
  w.interactHint = { text: hintText(w, best), x: best.x, y: best.y - best.r - 8, prop: best };
  w.interactProp = best;
  if (run.game.input.take('interact')) interact(w, best);
}

function openChest(w, pr) {
  pr.used = true;
  pr.sprite = 'prop_chest_open';
  pr.flash = 1;
  w.run.stats.chests = (w.run.stats.chests || 0) + 1;
  w.fx.burst('gold', pr.x, pr.y, { count: 14 });
  w.fx.light(pr.x, pr.y, 60, '#ffd35a', 0.4);
  bus.emit('prop:open', { kind: 'chest', prop: pr });
}

/** Use an interactable prop. Returns true when something happened. */
export function interact(w, pr) {
  if (!canInteract(pr) || w.locked) return false;
  const run = w.run, p = w.player, game = run.game, rng = w.rng;
  const fl = floorOf(run);
  switch (pr.kind) {
    case 'chest': {
      if (pr.locked) {
        w.fx.text(pr.x, pr.y - 12, 'Versiegelt', '#9aa7b8', { small: true });
        return false;
      }
      if (pr.tier === 'cursed') {
        game.openChoice({
          kind: 'shrine', title: 'Verfluchte Truhe',
          text: 'Dunkle Glut sickert aus den Ritzen. Was darin liegt, hat seinen Preis.',
          options: [
            {
              id: 'open', name: 'Öffnen', desc: 'Wähle aus mächtigen Relikten – und nimm einen Fluch auf dich.',
              icon: { glyph: 'skull', color: '#c04bd6' }, rarity: 'curse',
              pick() {
                openChest(w, pr);
                run.giveCurse();
                run.offerRelicChoice(3, { boost: 2, title: 'Verfluchte Truhe' });
              },
            },
            { id: 'leave', name: 'Liegen lassen', desc: 'Die Truhe bleibt verschlossen.', icon: { glyph: 'hand', color: '#b9b3a8' }, pick() {} },
          ],
          rerolls: 0,
        });
        return true;
      }
      openChest(w, pr);
      if (pr.tier === 'rare') {
        w.dropLoot(pr.x, pr.y + 6, { sparks: rng.int(25, 40) + 6 * (fl - 1) });
        run.offerRelicChoice(3, { boost: 1, title: 'Prächtige Truhe' });
      } else {
        w.dropLoot(pr.x, pr.y + 6, { sparks: rng.int(12, 22) + 4 * (fl - 1), hearts: rng.chance(0.3) ? 1 : 0 });
        run.offerRelicChoice(2, { title: 'Truhe' });
      }
      return true;
    }
    case 'pedestal': {
      const o = pr.offer;
      if (o.price > 0 && p.sparks < o.price) {
        bus.emit('shop:fail', {});
        bus.emit('ui:toast', { text: 'Nicht genug Funken', kind: 'bad', icon: { glyph: 'coin', color: '#ffd35a' } });
        return false;
      }
      if (o.price > 0 && !p.spendSparks(o.price)) return false;
      switch (o.type) {
        case 'relic': run.giveRelic(o.id); break;
        case 'weapon': run.giveWeapon(o.id, o.level || 1); break;
        case 'boon': run.giveBoon(o.id); break;
        default: w.healPlayer(p.stats.maxHp * 0.35); break;
      }
      if (o.price > 0) {
        run.stats.purchases = (run.stats.purchases || 0) + 1;
        bus.emit('shop:buy', { offer: o, price: o.price });
      }
      w.fx.burst('gold', pr.x, pr.y, { count: 10 });
      pr.used = true;
      let changed = false;
      for (const other of w.props) {
        if (other === pr || (pr.group && other.kind === 'pedestal' && other.group === pr.group && !other.removed)) {
          other.removed = true;
          if (other.solid) changed = true;
        }
      }
      if (changed) w.rebuildBlocked();
      return true;
    }
    case 'shrine': {
      const def = pr.shrine;
      const ctx = { w, player: p, run, rng };
      let opts = [];
      try { opts = def.options(ctx) || []; } catch (err) { console.error(`[shrine] ${def.id}.options failed`, err); return false; }
      game.openChoice({
        kind: 'shrine', title: def.name, text: def.text, rerolls: 0,
        options: opts.map((o, i) => ({
          id: o.id || `opt${i}`, name: o.label ?? o.name ?? '…', desc: o.desc || '',
          icon: o.icon || def.icon || { glyph: 'candle', color: '#ffd9a0' },
          rarity: o.rarity, detail: o.detail, disabled: o.available === false,
          pick() {
            try { if (o.pick) o.pick(ctx); } catch (err) { console.error(`[shrine] ${def.id} option failed`, err); }
            if (o.keep !== true) {
              pr.used = true;
              pr.flash = 1;
              run.stats.shrines = (run.stats.shrines || 0) + 1;
              bus.emit('prop:open', { kind: 'shrine', prop: pr });
            }
          },
        })),
      });
      return true;
    }
    case 'forge': {
      const options = [];
      for (const ws of p.weapons) {
        if (!ws || ws.level >= MAX_WEAPON_LEVEL) continue;
        const cost = forgeCost(run, ws);
        const lv = ws.def.levels && ws.def.levels[ws.level - 1];
        options.push({
          id: ws.id, name: `${ws.def.name} Stufe ${ws.level} → ${ws.level + 1}`,
          desc: lv ? lv.desc : '', icon: ws.def.icon || { glyph: 'hammer', color: '#ff8a3c' }, rarity: ws.def.rarity,
          detail: `${cost} Funken`, disabled: p.sparks < cost,
          pick() {
            if (!p.spendSparks(cost)) return;
            p.upgradeWeapon(ws);
            pr.usesLeft--;
            pr.flash = 1;
            if (pr.usesLeft <= 0) pr.used = true;
            w.fx.burst('ember', pr.x, pr.y, { count: 18 });
            bus.emit('prop:open', { kind: 'forge', prop: pr });
          },
        });
      }
      options.push({ id: 'leave', name: 'Gehen', desc: 'Die Esse glüht weiter.', icon: { glyph: 'hand', color: '#b9b3a8' }, pick() {} });
      game.openChoice({
        kind: 'forge', title: 'Glutesse', rerolls: 0,
        text: pr.usesLeft === 1 ? 'Die Esse reicht noch für einen Schmiedegang.' : `Die Esse reicht noch für ${pr.usesLeft} Schmiedegänge.`,
        options,
      });
      return true;
    }
    case 'fountain': {
      pr.used = true;
      pr.sprite = 'prop_fountain_empty';
      pr.flash = 1;
      pr.light = null;
      w.healPlayer(p.stats.maxHp * 0.4);
      w.fx.burst('heal', pr.x, pr.y, { count: 16 });
      bus.emit('prop:open', { kind: 'fountain', prop: pr });
      return true;
    }
    case 'portal': {
      if (run.floorIndex >= TOTAL_FLOORS) return false;
      pr.used = true;
      bus.emit('portal:enter', {});
      run.nextFloor();
      return true;
    }
    default:
      return false;
  }
}

/** Destructible props break on any hit. */
export function damageProp(w, pr, amount = 1) {
  if (!pr || pr.removed || !pr.destructible || !(amount > 0)) return false;
  const run = w.run, fl = floorOf(run);
  removeProp(w, pr);
  bus.emit('prop:open', { kind: pr.kind, prop: pr });
  if (pr.kind === 'barrel') {
    run.stats.barrels = (run.stats.barrels || 0) + 1;
    w.fx.burst('dust', pr.x, pr.y, { count: 10, color: '#8a6a4a' });
    if (pr.explosive) {
      w.explode(pr.x, pr.y, 44, 40 + 12 * fl, { team: 'player', type: 'fire', knockback: 160, source: 'prop' });
      const p = w.player;
      if (Math.hypot(p.x - pr.x, p.y - pr.y) <= 44 + p.r) {
        w.damagePlayer(14, { type: 'fire' });
        w.knockback(p, p.x - pr.x, p.y - pr.y, 160);
      }
    } else {
      w.dropLoot(pr.x, pr.y, { sparks: w.rng.int(2, 5), hearts: w.rng.chance(0.1) ? 1 : 0 });
    }
  } else if (pr.kind === 'crystal') {
    w.fx.burst('light', pr.x, pr.y, { count: 14, color: pr.light ? pr.light.color : '#8fd8ff' });
    w.dropLoot(pr.x, pr.y, { xp: w.rng.int(4, 7) });
  } else {
    w.fx.burst('dust', pr.x, pr.y, { count: 8 });
  }
  return true;
}

function freeTile(w, tx, ty) {
  const t = w.tileAt(tx, ty);
  if (t === TILE.FLOOR && w.walkableTile(tx, ty)) return { tx, ty };
  const f = w.nearestFloor((tx + 0.5) * TS, (ty + 0.5) * TS);
  return { tx: Math.floor(f.x / TS), ty: Math.floor(f.y / TS) };
}

/** Called by World.clearRoom. */
export function onRoomCleared(w, room) {
  const run = w.run, p = w.player, rng = w.rng, fl = floorOf(run);
  let unlocked = false;
  for (const pr of w.props) {
    if (pr.kind === 'chest' && pr.locked && !pr.removed) {
      pr.locked = false;
      pr.flash = 1;
      unlocked = true;
      w.fx.burst('gold', pr.x, pr.y, { count: 12 });
      w.fx.ring(pr.x, pr.y, 24, '#ffd35a', 0.4);
    }
  }
  if (unlocked) bus.emit('ui:toast', { text: 'Die Truhe öffnet sich', kind: 'good', icon: { glyph: 'key', color: '#ffd35a' } });

  if (room.type === 'boss') {
    const b = w.bossDefeated;
    const bx = b ? b.x : (room.w * TS) / 2, by = b ? b.y : (room.h * TS) / 2;
    w.dropLoot(bx, by, { sparks: 40 + 15 * fl, hearts: 3, ash: 8 + 4 * fl });
    const ctx = Math.floor(room.w / 2), cty = Math.floor(room.h / 2);
    for (let i = -1; i <= 1; i++) {
      const t = freeTile(w, ctx + i * 2, cty + 1);
      const pr = makeProp(w, room, { kind: 'pedestal', tx: t.tx, ty: t.ty, offer: 'relic', price: 0, group: 'boss', minRarity: 'uncommon' });
      w.props.push(pr);
    }
    if (run.floorIndex < TOTAL_FLOORS) {
      const t = freeTile(w, ctx, cty - 2);
      w.props.push(makeProp(w, room, { kind: 'portal', tx: t.tx, ty: t.ty }));
    }
    w.rebuildBlocked();
    return;
  }
  // combat reward: sparks flying straight to the player
  let sparks = rng.int(4, 8) + 2 * fl;
  while (sparks > 0) {
    const v = sparks >= 5 ? 5 : 1;
    w.spawnPickup('spark', p.x, p.y, { amount: v, burst: true, magnet: true });
    sparks -= v;
  }
  if (rng.chance(0.1)) w.spawnPickup('heart', p.x, p.y, { burst: true, magnet: true });
}
