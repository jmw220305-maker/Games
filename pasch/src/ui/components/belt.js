// Talisman-Reihe (Drag & Drop zum Umsortieren, Verkaufen) und Verbrauchsgut-Plätze (Benutzen, Verkaufen).
import { h, hoverCapable } from '../dom.js';
import * as G from '../../game/index.js';
import { juice, springTo, setLayer, popIn, time, ease, nope, particles } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { createCard, model, tooltipFor } from './card.js';
import { suppressTooltips, hideTooltip } from '../tooltip.js';
import { button } from './button.js';
import { money } from '../text.js';

export function createBelt(app) {
  const tRow = h('div.belt-row.belt-talismans');
  const cRow = h('div.belt-row.belt-consumables');
  const tCount = h('div.belt-count');
  const cCount = h('div.belt-count');
  const el = h('div.belt',
    h('div.belt-group.belt-group--t', tRow, h('div.belt-label', 'Talismane'), tCount),
    h('div.belt-group.belt-group--c', cRow, h('div.belt-label', 'Verbrauch'), cCount));
  const cards = new Map(); // uid → card api
  let menu = null;
  let dragging = null;
  let locked = false;

  function closeMenu() {
    if (!menu) return;
    const m = menu;
    menu = null;
    m.card.el.classList.remove('card--selected');
    springTo(m.card.el, { y: 0 }, { layer: 'sel' });
    m.el.classList.add('cardmenu--out');
    setTimeout(() => m.el.remove(), 150);
  }

  function openMenu(card, kind, obj) {
    const same = menu && menu.card === card;
    closeMenu();
    if (same) return;
    hideTooltip();
    const run = app.run;
    const tt = tooltipFor(card.m, run, obj);
    const buttons = h('div.cardmenu-buttons');
    const sellRef = { kind, uid: obj.uid };
    const canSell = run.phase !== 'lost' && run.phase !== 'won';
    if (kind === 'consumable') {
      const def = G.CONSUMABLES[obj.id];
      const usable = def.usableIn !== 'round' || (run.phase === 'round' && run.round && run.round.rolled);
      const b = button('Benutzen', { kind: 'go', size: 's', onClick: () => { closeMenu(); app.useConsumable(obj.uid); } });
      if (!usable) b.setDisabled(true, 'Nur während eines Wurfs benutzbar');
      if (app.busy) b.setDisabled(true, 'Gerade nicht');
      buttons.appendChild(b);
      bDenied(b);
    }
    if (canSell) {
      const price = G.sellPrice(run, sellRef);
      const b = button('Verkaufen', { kind: 'gold', size: 's', sub: money(price), onClick: () => { closeMenu(); sellCard(card, sellRef); } });
      if (app.busy) b.setDisabled(true, 'Gerade nicht');
      buttons.appendChild(b);
      bDenied(b);
    }
    const mEl = h(`div.cardmenu${tt.rarity ? `.rar-${tt.rarity}` : ''}`, { vars: { hue: tt.hue } },
      h('div.tt-kind', tt.kind), h('div.tt-title', tt.title), h('div.tt-body', { html: tt.body }), buttons);
    document.body.appendChild(mEl);
    const r = card.el.getBoundingClientRect();
    const mr = mEl.getBoundingClientRect();
    let x = r.left + r.width / 2 - mr.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - mr.width - 8, x));
    let y = r.bottom + 10;
    if (y + mr.height > window.innerHeight - 8) y = Math.max(8, r.top - mr.height - 10);
    mEl.style.left = `${Math.round(x)}px`;
    mEl.style.top = `${Math.round(y)}px`;
    popIn(mEl, 180);
    card.el.classList.add('card--selected');
    springTo(card.el, { y: -8 }, { layer: 'sel' });
    juice(card.el, 0.15);
    audio.play('card_pick', { gain: 0.6 });
    menu = { el: mEl, card };
  }
  function bDenied(b) {
    b.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('pointerdown', (e) => {
    if (!menu) return;
    if (menu.el.contains(e.target) || menu.card.el.contains(e.target)) return;
    closeMenu();
  }, true);

  async function sellCard(card, ref) {
    if (app.busy) return;
    const run = app.run;
    const r = G.sell(run, ref);
    if (!r.ok) { nope(card.el); audio.play('deny'); app.toast(r.reason); return; }
    audio.play('sell');
    const rr = card.el.getBoundingClientRect();
    const [mx, my] = app.rv.hud.moneyTarget();
    particles.burst(rr.left + rr.width / 2, rr.top + rr.height / 2, { count: 12, color: 'money', shape: 'coin', speed: [150, 380] });
    cards.delete(ref.uid);
    const el2 = card.el;
    time.tween(220, (e) => setLayer(el2, 'gone', { scale: 1 - e, rot: e * 40, y: -20 * e }), { ease: ease.inQuad }).then(() => card.destroy());
    particles.flyCoins(rr.left + rr.width / 2, rr.top + rr.height / 2, mx, my, { count: 4, onArrive: (i) => audio.play('coin', { pitch: i }) });
    app.afterAction(r.events, { tickMoney: true });
  }

  // ------------------------------------------------------------ Drag & Drop (Talismane)
  function wireDrag(card) {
    const el = card.el;
    let sx = 0, sy = 0, down = false, moved = false, lastX = 0, lastT = 0, vx = 0, from = -1, slotW = 0, pid = 0;
    let order = [];
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || locked) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY; lastX = sx; lastT = performance.now(); pid = e.pointerId;
    });
    el.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved) {
        if (Math.hypot(dx, dy) < 9) return;
        if (app.busy || app.run.talismans.length < 2) { down = false; return; }
        moved = true;
        closeMenu();
        try { el.setPointerCapture(pid); } catch { /* */ }
        suppressTooltips(true);
        order = app.run.talismans.map((t) => t.uid);
        from = order.indexOf(el.dataset.uid);
        const els = order.map((u) => cards.get(u).el);
        slotW = els.length > 1 ? Math.abs(els[1].offsetLeft - els[0].offsetLeft) : el.offsetWidth + 10;
        el.classList.add('card--drag');
        dragging = { el, from, to: from };
        audio.play('card_pick');
      }
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vx = vx * 0.6 + ((e.clientX - lastX) / dt) * 1000 * 0.4;
      lastX = e.clientX; lastT = now;
      setLayer(el, 'drag', { x: dx, y: dy, rot: Math.max(-15, Math.min(15, vx * 0.02)), scale: 1.08 });
      const to = Math.max(0, Math.min(order.length - 1, from + Math.round(dx / slotW)));
      if (to !== dragging.to) {
        dragging.to = to;
        audio.play('hover');
        order.forEach((u, i) => {
          if (u === el.dataset.uid) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -slotW;
          if (from > to && i < from && i >= to) shift = slotW;
          springTo(cards.get(u).el, { x: shift }, { layer: 'shift', k: 300, damp: 0.72 });
        });
      }
    });
    const end = (e) => {
      if (!down || (e && e.pointerId !== pid)) return;
      down = false;
      if (!moved) return;
      suppressTooltips(false);
      const d = dragging;
      dragging = null;
      el.classList.remove('card--drag');
      // Position merken (FLIP)
      const before = new Map();
      order.forEach((u) => {
        const c = cards.get(u).el;
        const lx = (layerX(c, 'drag') + layerX(c, 'shift') + layerX(c, 'flip'));
        before.set(u, { x: c.offsetLeft + lx, y: c === el ? layerY(c, 'drag') : 0 });
      });
      if (d.to !== d.from) {
        const r = G.moveTalisman(app.run, d.from, d.to);
        if (r.ok) app.afterAction(r.events, { silent: true });
      }
      order.forEach((u) => {
        const c = cards.get(u).el;
        setLayer(c, 'drag', null);
        springTo(c, { x: 0 }, { layer: 'shift', snap: true });
      });
      render();
      order.forEach((u) => {
        const c = cards.get(u);
        if (!c) return;
        const b = before.get(u);
        springTo(c.el, { x: b.x - c.el.offsetLeft, y: b.y }, { layer: 'flip', snap: true });
        springTo(c.el, { x: 0, y: 0 }, { layer: 'flip', k: 260, damp: 0.74 });
      });
      audio.play('card_flip', { gain: 0.7 });
      juice(el, 0.2);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => {
      if (moved) { moved = false; e.stopPropagation(); return; }
      if (locked) return;
      const t = app.run.talismans.find((x) => x.uid === el.dataset.uid);
      if (t) openMenu(card, 'talisman', t);
    });
  }
  const layerX = (el, n) => { const l = getLayerVals(el, n); return l && l.x ? l.x : 0; };
  const layerY = (el, n) => { const l = getLayerVals(el, n); return l && l.y ? l.y : 0; };

  // ------------------------------------------------------------ Rendern (nach uid wiederverwenden)
  function render() {
    const run = app.run;
    if (!run) return;
    const seen = new Set();
    const tEls = [];
    run.talismans.forEach((t, i) => {
      let c = cards.get(t.uid);
      if (!c) {
        c = createCard(model('talisman', t.id, { uid: t.uid }), { run: () => app.run, obj: t, seed: hashUid(t.uid), tooltipBelow: true });
        c.el.dataset.uid = t.uid;
        cards.set(t.uid, c);
        wireDrag(c);
      }
      c.update(t);
      c.el.dataset.index = String(i);
      c.el.classList.toggle('card--disabled', !!t.disabled);
      c.setBadge(badgeFor(t));
      seen.add(t.uid);
      tEls.push(c.el);
    });
    const cEls = [];
    run.consumables.forEach((cs, i) => {
      let c = cards.get(cs.uid);
      if (!c) {
        c = createCard(model('consumable', cs.id, { uid: cs.uid }), { run: () => app.run, obj: cs, seed: hashUid(cs.uid), tooltipBelow: true });
        cards.set(cs.uid, c);
        c.el.addEventListener('click', () => { if (!locked) openMenu(c, 'consumable', app.run.consumables.find((x) => x.uid === cs.uid) || cs); });
      }
      c.el.dataset.index = String(i);
      seen.add(cs.uid);
      cEls.push(c.el);
    });
    for (const [uid, c] of cards) if (!seen.has(uid)) { c.destroy(); cards.delete(uid); }
    const tSlots = Math.max(run.limits.talismans, run.talismans.length);
    const cSlots = Math.max(run.limits.consumables, run.consumables.length);
    syncRow(tRow, tEls, tSlots);
    syncRow(cRow, cEls, cSlots);
    tRow.style.setProperty('--slots', String(tSlots));
    cRow.style.setProperty('--slots', String(cSlots));
    el.style.setProperty('--tslots', String(tSlots));
    el.style.setProperty('--cslots', String(cSlots));
    requestAnimationFrame(() => fitNames(el));
    tCount.textContent = `${run.talismans.length}/${run.limits.talismans}`;
    cCount.textContent = `${run.consumables.length}/${run.limits.consumables}`;
  }

  function syncRow(row, els, slots) {
    // Karten in richtiger Reihenfolge, danach leere Plätze
    els.forEach((c, i) => {
      if (row.children[i] !== c) row.insertBefore(c, row.children[i] || null);
    });
    [...row.querySelectorAll('.slot-empty')].forEach((e) => e.remove());
    for (let i = els.length; i < slots; i++) row.appendChild(h('div.slot-empty'));
  }

  const api = {
    el, render, closeMenu,
    cardEl(uid) { const c = cards.get(uid); return c ? c.el : null; },
    talismanEl(index) {
      const t = app.run && app.run.talismans[index];
      return t ? api.cardEl(t.uid) : null;
    },
    /** nächster freier Platz (für Fluganimationen) */
    slotEl(kind) {
      const row = kind === 'talisman' ? tRow : cRow;
      return row.querySelector('.slot-empty') || row.lastElementChild || row;
    },
    setLocked(b) { locked = !!b; el.classList.toggle('belt--locked', locked); if (locked) closeMenu(); },
    /** Karte zerbricht (Bröckelnde Krone) */
    breakCard(uid) {
      const c = cards.get(uid);
      if (!c) return Promise.resolve();
      cards.delete(uid);
      const r = c.el.getBoundingClientRect();
      particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 22, color: ['#c77dff', '#ffd166', '#f4ecd8'], shape: 'square', speed: [200, 520] });
      audio.play('shatter');
      return time.tween(260, (e) => setLayer(c.el, 'gone', { scale: 1 + e * 0.3, rot: e * -20 }), { ease: ease.outQuad })
        .then(() => { c.el.style.opacity = '0'; c.destroy(); render(); });
    },
  };
  return api;
}

import { getLayer } from '../../fx/springs.js';
function getLayerVals(el, n) { return getLayer(el, n); }

/** Kartennamen auf kleinen Karten (Handy) einzeilig einpassen statt abschneiden. */
function fitNames(root) {
  for (const n of root.querySelectorAll('.card-name')) {
    n.style.fontSize = '';
    if (getComputedStyle(n).whiteSpace !== 'nowrap') continue;
    const cw = n.clientWidth;
    if (!cw || n.scrollWidth <= cw + 1) continue;
    const fs = parseFloat(getComputedStyle(n).fontSize);
    n.style.fontSize = `${Math.max(6, Math.floor(fs * (cw / n.scrollWidth) * 10) / 10)}px`;
  }
}
if (typeof window !== 'undefined') {
  let tmr = 0;
  const refit = () => { const b = document.querySelector('.belt'); if (b) fitNames(b); };
  window.addEventListener('resize', () => { clearTimeout(tmr); tmr = setTimeout(refit, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
}

function hashUid(uid) {
  let x = 0;
  for (const ch of String(uid)) x = (x * 31 + ch.charCodeAt(0)) % 997;
  return x;
}

function badgeFor(t) {
  const s = t.state || {};
  switch (t.id) {
    case 'tally': return s.n ? `+${s.n}` : null;
    case 'spirit': return s.n ? `+${s.n}` : null;
    case 'momentum': return s.n ? `×${String(Math.round((1 + 0.2 * s.n) * 100) / 100).replace('.', ',')}` : null;
    case 'tally_board': return s.n ? `×${String(1 + 0.25 * s.n).replace('.', ',')}` : null;
    case 'crown': return `×${String(s.x || 3).replace('.', ',')}`;
    case 'hoard': return s.carry ? `+${s.carry}` : null;
    default: return null;
  }
}

export { hoverCapable };
