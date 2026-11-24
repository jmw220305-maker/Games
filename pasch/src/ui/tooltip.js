// Tooltips: Maus-Hover (250 ms) oder Langdruck 350 ms (Touch). Positioniert über/unter dem Element, im Viewport.
import { h } from './dom.js';
import { longPress } from './input.js';
import { audio } from '../audio/audio.js';
import { shapeIcon } from './components/itemshapes.js';

let tip = null;
let owner = null;
let timer = 0;
let suppressed = 0;
let stickyTouch = false;

function ensure() {
  if (tip && tip.isConnected) return tip;
  tip = h('div.tooltip', { role: 'tooltip' });
  document.body.appendChild(tip);
  document.addEventListener('pointerdown', (e) => {
    if (stickyTouch && owner && !owner.contains(e.target)) hideTooltip();
  }, true);
  window.addEventListener('scroll', () => hideTooltip(), true);
  return tip;
}

/**
 * content: {title, kind?, body?: html, hue?, rarity?, foot?: html}
 */
export function showTooltip(el, content, opts = {}) {
  if (!content || suppressed > 0) return;
  const t = ensure();
  owner = el;
  t.className = `tooltip${content.rarity ? ` rar-${content.rarity}` : ''}${content.shape ? ` tt--${content.shape}` : ''}`;
  t.style.setProperty('--hue', String(content.hue != null ? content.hue : 270));
  t.innerHTML = '';
  if (content.kind) t.appendChild(h('div.tt-kind', content.shape ? shapeIcon(content.shape) : null, content.kind));
  if (content.title) t.appendChild(h('div.tt-title', content.title));
  if (content.body) t.appendChild(h('div.tt-body', { html: content.body }));
  if (content.foot) t.appendChild(h('div.tt-foot', { html: content.foot }));
  t.classList.add('tooltip--on');
  place(el, t, opts.below);
  stickyTouch = !!opts.sticky;
}

function place(el, t, preferBelow) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  t.style.left = '0px'; t.style.top = '0px';
  t.style.maxWidth = `${Math.min(300, vw - 24)}px`;
  const tr = t.getBoundingClientRect();
  let x = r.left + r.width / 2 - tr.width / 2;
  x = Math.max(8, Math.min(vw - tr.width - 8, x));
  let y;
  const above = r.top - tr.height - 12;
  const below = r.bottom + 12;
  if (preferBelow) y = below + tr.height < vh - 8 ? below : above;
  else y = above > 8 ? above : below;
  y = Math.max(8, Math.min(vh - tr.height - 8, y));
  t.style.left = `${Math.round(x)}px`;
  t.style.top = `${Math.round(y)}px`;
  t.dataset.side = y < r.top ? 'above' : 'below';
}

export function hideTooltip() {
  clearTimeout(timer);
  if (tip) tip.classList.remove('tooltip--on');
  owner = null;
  stickyTouch = false;
}

/** Tooltips kurz unterdrücken (Drag & Drop, Animationen). */
export function suppressTooltips(on) {
  suppressed = Math.max(0, suppressed + (on ? 1 : -1));
  if (on) hideTooltip();
}

/**
 * el bekommt einen Tooltip. getContent() → content (s. showTooltip) – wird beim Anzeigen frisch gelesen.
 * Gibt detach() zurück.
 */
export function attachTooltip(el, getContent, opts = {}) {
  const enter = (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (el.isConnected) showTooltip(el, getContent(), opts); }, opts.delay != null ? opts.delay : 250);
  };
  const leave = (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer);
    if (owner === el) hideTooltip();
  };
  const down = (e) => {
    if (e.pointerType === 'mouse' && owner === el) hideTooltip();
  };
  el.addEventListener('pointerenter', enter);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('pointerdown', down);
  const offLong = longPress(el, () => {
    showTooltip(el, getContent(), { ...opts, sticky: true });
    audio.play('hover');
    if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* */ }
  });
  return () => {
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('pointerdown', down);
    offLong();
    if (owner === el) hideTooltip();
  };
}
