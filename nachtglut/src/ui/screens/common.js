// Shared screen chrome: header with back button + title + Asche, tab bars, sections.
import { h, icon, button, setText, sfx } from '../dom.js';
import { fmtInt } from '../format.js';

export function ashPill(ui) {
  const num = h('span.ash-num');
  const el = h('div.ash-pill', { title: 'Asche' }, icon({ glyph: 'ember', color: '#ff9a4a' }, 20, { name: 'A' }), num, h('span.ash-label', { text: 'Asche' }));
  const update = () => setText(num, fmtInt((ui.game.save && ui.game.save.ash) || 0));
  update();
  el.refresh = update;
  return el;
}

/**
 * Full-screen panel with header.
 * opts: { id, title, kicker, ash: bool, back: fn | false, backLabel, extra (node in header) }
 */
export function screenShell(ui, opts = {}) {
  const head = h('header.screen-head');
  if (opts.back !== false) {
    head.appendChild(button(opts.backLabel || 'Zurück', {
      cls: 'btn-back', sound: false,
      icon: h('span.back-arrow', { attrs: { 'aria-hidden': 'true' } }),
      onClick: () => { sfx.close(); (opts.back || ui.back)(); },
    }));
  } else head.appendChild(h('span.head-spacer'));
  head.appendChild(h('div.screen-titles',
    opts.kicker ? h('div.screen-kicker', { text: opts.kicker }) : null,
    h('h1.screen-title', { text: opts.title || '' })));
  const ash = opts.ash ? ashPill(ui) : null;
  head.appendChild(ash || opts.extra || h('span.head-spacer'));
  const body = h('div.screen-body');
  const el = h(`section.screen.screen-${opts.id || 'x'}`, { attrs: { 'aria-label': opts.title || '' } }, h('div.screen-frame', head, body));
  return { el, head, body, ash };
}

/**
 * Tab bar. tabs: [{ id, label, badge? }]. Returns { el, select(id), current }.
 */
export function tabBar(tabs, onSelect, initial) {
  const el = h('div.tabs', { attrs: { role: 'tablist' } });
  const btns = new Map();
  let current = initial || (tabs[0] && tabs[0].id);
  for (const t of tabs) {
    const b = h('button.tab', { type: 'button', attrs: { role: 'tab', 'aria-selected': String(t.id === current) } },
      h('span.tab-label', { text: t.label }), t.badge != null ? h('span.tab-badge', { text: t.badge }) : null);
    b.addEventListener('click', () => { if (current !== t.id) { sfx.click(); api.select(t.id); } });
    btns.set(t.id, b);
    el.appendChild(b);
  }
  const api = {
    el,
    get current() { return current; },
    select(id, silent) {
      if (!btns.has(id)) return;
      current = id;
      for (const [k, b] of btns) { b.setAttribute('aria-selected', String(k === id)); b.classList.toggle('on', k === id); }
      btns.get(id).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!silent) onSelect(id);
    },
    step(d) {
      const ids = tabs.map((t) => t.id);
      const i = ids.indexOf(current);
      const n = ids[(i + d + ids.length) % ids.length];
      sfx.click();
      api.select(n);
      return btns.get(n);
    },
    button: (id) => btns.get(id),
  };
  btns.get(current)?.classList.add('on');
  return api;
}

export function progressBar(ratio, label) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  return h('div.progress', { attrs: { role: 'progressbar', 'aria-valuenow': Math.round(r * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 } },
    h('div.progress-fill', { style: { '--f': r } }), label ? h('span.progress-label', { text: label }) : null);
}

export function sectionTitle(text, extra) {
  return h('div.section-title', h('span', { text }), extra || null);
}
