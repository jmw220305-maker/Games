// Choice modal (ui:choice): boons, relics, shrines, weapons, forge.
import { h, clear, icon, button, sfx, setDisabled } from './dom.js';
import { rarityInfo, text } from './format.js';

const KIND = {
  boon: { kicker: 'Stufenaufstieg', title: 'Wähle einen Segen', glyph: 'star', color: '#ffd35a' },
  relic: { kicker: 'Relikt', title: 'Wähle ein Relikt', glyph: 'gem', color: '#6aa9ff' },
  shrine: { kicker: 'Schrein', title: 'Ein Schrein ruft', glyph: 'candle', color: '#c9a0ff' },
  weapon: { kicker: 'Waffe', title: 'Wähle eine Waffe', glyph: 'sword', color: '#ff8a3c' },
  forge: { kicker: 'Schmiede', title: 'Verbessere deine Waffen', glyph: 'hammer', color: '#ff8a3c' },
};

const TAG_DE = {
  fire: 'Feuer', frost: 'Frost', poison: 'Gift', shock: 'Blitz', shadow: 'Schatten', light: 'Licht', phys: 'Physisch',
  crit: 'Kritisch', hp: 'Leben', heal: 'Heilung', speed: 'Tempo', damage: 'Schaden', gold: 'Funken', sparks: 'Funken',
  dash: 'Sprint', skill: 'Fertigkeit', defense: 'Abwehr', shield: 'Schild', luck: 'Glück', projectile: 'Geschoss',
  status: 'Effekt', summon: 'Beschwörung', orbit: 'Umlauf', area: 'Fläche', curse: 'Fluch', xp: 'Erfahrung', utility: 'Nutzen',
  kill: 'Erlegen', fireRate: 'Feuerrate', revive: 'Wiederkehr', orbital: 'Umlauf', economy: 'Handel', thorns: 'Dornen',
  rapid: 'Schnellfeuer', proc: 'Auslöser', pierce: 'Durchschlag', melee: 'Nahkampf', split: 'Teilung', shotgun: 'Streuung',
  knockback: 'Rückstoß', explosive: 'Explosiv', control: 'Kontrolle', charge: 'Aufladen', chain: 'Kette', boomerang: 'Bumerang',
  beam: 'Strahl', elite: 'Elite', boss: 'Boss', lifesteal: 'Lebensraub', armor: 'Rüstung', dodge: 'Ausweichen', range: 'Reichweite',
};
export const tagName = (t) => TAG_DE[t] || t;

export function createChoice(ui) {
  const overlay = h('div.choice-overlay');
  const box = h('div.choice', { attrs: { role: 'dialog', 'aria-modal': 'true' } });
  overlay.appendChild(box);
  let current = null;
  let openedAt = 0;
  let layer = null;
  const resolved = new WeakSet();

  function close() {
    if (!current) return;
    current = null;
    overlay.classList.remove('show');
    if (layer) { ui.popLayer(layer); layer = null; }
  }

  function pick(choice, opt) {
    if (current !== choice || resolved.has(choice)) return;
    if (performance.now() - openedAt < 320) return; // ignore clicks carried over from combat
    if (opt.disabled) { sfx.deny(); return; }
    resolved.add(choice);
    sfx.confirm();
    close();
    try { opt.pick && opt.pick(); } catch (err) { console.error('[ui] choice pick failed', err); }
    ui.afterChoice(choice);
  }

  function card(choice, opt, i) {
    const r = opt.rarity ? rarityInfo(opt.rarity, ui.RARITY_INFO) : null;
    const tags = Array.isArray(opt.tags) ? opt.tags.filter((t) => t && t !== opt.rarity).slice(0, 4) : [];
    const el = h('button.ccard' + (opt.disabled ? '.disabled' : '') + (opt.rarity ? `.r-${opt.rarity}` : ''), {
      type: 'button',
      style: { '--rc': r ? r.color : '#c9b48a', '--i': i },
    },
    h('kbd.ccard-key', { text: String(i + 1) }),
    r ? h('div.ccard-rarity', { text: r.name }) : h('div.ccard-rarity.blank'),
    h('div.ccard-icon', icon(opt.icon, 48, { name: opt.name || opt.label })),
    h('div.ccard-main',
      h('div.ccard-name', { text: text(opt.name || opt.label, '???') }),
      opt.detail ? h('div.ccard-detail', { text: text(opt.detail) }) : null,
      h('div.ccard-desc', { text: text(opt.desc, '') }),
      tags.length ? h('div.ccard-tags', tags.map((t) => h('span.tag', { text: tagName(t) }))) : null));
    if (opt.disabled) setDisabled(el, true);
    el.addEventListener('click', () => pick(choice, opt));
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') sfx.hover(); });
    return el;
  }

  function render(choice) {
    clear(box);
    const k = KIND[choice.kind] || KIND.relic;
    const opts = Array.isArray(choice.options) ? choice.options : [];
    const head = h('div.choice-head',
      h('div.choice-kicker', icon({ glyph: k.glyph, color: k.color }, 20, { name: k.kicker }), h('span', { text: k.kicker })),
      h('div.choice-title', { text: text(choice.title, k.title) }),
      choice.text ? h('div.choice-text', { text: text(choice.text) }) : null);
    const cards = h('div.choice-cards', { style: { '--n': Math.max(1, opts.length) } }, opts.map((o, i) => card(choice, o, i)));
    const foot = h('div.choice-foot');
    if (typeof choice.reroll === 'function') {
      const n = choice.rerolls | 0;
      const rb = button(`Neu würfeln (${n})`, {
        cls: 'btn-small', icon: icon({ glyph: 'dice', color: '#e8d6b0' }, 20, { name: 'W' }), disabled: n <= 0, sound: false,
        onClick: () => {
          if ((choice.rerolls | 0) <= 0 || current !== choice) return;
          sfx.confirm();
          try { choice.reroll(); } catch (err) { console.error('[ui] reroll failed', err); }
          render(choice);
          openedAt = performance.now() - 200;
          const first = box.querySelector('.ccard');
          if (first) ui.focusEl(first);
        },
      });
      foot.appendChild(rb);
    }
    if (typeof choice.skip === 'function') {
      foot.appendChild(button(text(choice.skipLabel, 'Überspringen'), {
        cls: 'btn-small btn-ghost', sound: false,
        onClick: () => {
          if (current !== choice || resolved.has(choice)) return;
          resolved.add(choice);
          sfx.close();
          close();
          try { choice.skip(); } catch (err) { console.error('[ui] skip failed', err); }
          ui.afterChoice(choice);
        },
      }));
    }
    box.className = `choice choice-${choice.kind || 'relic'}`;
    box.append(head, cards);
    if (foot.childElementCount) box.appendChild(foot);
  }

  return {
    el: overlay,
    get current() { return current; },
    isResolved: (c) => resolved.has(c),
    show(choice) {
      if (!choice || resolved.has(choice)) return;
      if (current === choice) return;
      current = choice;
      openedAt = performance.now();
      render(choice);
      overlay.classList.add('show');
      sfx.open();
      if (!layer) {
        layer = { el: box, kind: 'choice', back: () => {} };
        ui.pushLayer(layer);
      }
      const first = box.querySelector('.ccard:not([aria-disabled="true"])') || box.querySelector('.ccard');
      if (first) ui.focusEl(first, true);
    },
    hide: close,
    /** number keys 1..4 */
    pickIndex(i) {
      if (!current) return false;
      const opt = (current.options || [])[i];
      if (!opt) return false;
      pick(current, opt);
      return true;
    },
  };
}
