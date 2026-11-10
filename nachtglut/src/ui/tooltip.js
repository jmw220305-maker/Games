// One shared tooltip: hover (mouse), focus (keyboard/gamepad) and long-press (touch).
import { h, clear, icon } from './dom.js';
import { rarityInfo, text } from './format.js';

let tip = null;
let owner = null;
let pressTimer = 0;
const builders = new WeakMap();

export function initTooltip(root) {
  tip = h('div.tooltip', { attrs: { role: 'tooltip', 'aria-hidden': 'true' } });
  root.appendChild(tip);
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
}

/**
 * Standard tooltip content for perks/weapons/relics.
 * info: { name, rarity, rarityTable, desc, flavor, icon, detail, tags, extra }
 */
export function tipContent(info) {
  const r = info.rarity ? rarityInfo(info.rarity, info.rarityTable) : null;
  const head = h('div.tip-head',
    info.icon ? icon(info.icon, 32, { name: info.name }) : null,
    h('div.tip-titles',
      h('div.tip-name', { text: text(info.name, '???'), style: r ? { color: r.color } : null }),
      r || info.detail ? h('div.tip-sub', [r ? h('span', { text: r.name, style: { color: r.color } }) : null, info.detail ? h('span', { text: (r ? ' · ' : '') + info.detail }) : null]) : null));
  return h('div.tip-body',
    head,
    info.desc ? h('div.tip-desc', { text: text(info.desc) }) : null,
    info.extra || null,
    info.flavor ? h('div.tip-flavor', { text: text(info.flavor) }) : null,
    info.tags && info.tags.length ? h('div.tip-tags', info.tags.map((t) => h('span.tag', { text: t }))) : null);
}

function place(target) {
  if (!tip || !target) return;
  const r = target.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2;
  let y = r.bottom + 10;
  if (y + th > vh - 8) y = r.top - th - 10;
  if (y < 8) y = Math.min(vh - th - 8, Math.max(8, r.top + r.height / 2 - th / 2));
  x = Math.max(8, Math.min(vw - tw - 8, x));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function showTooltip(target, node) {
  if (!tip || !node) return;
  owner = target;
  clear(tip).appendChild(node);
  tip.classList.add('show');
  tip.setAttribute('aria-hidden', 'false');
  place(target);
}

export function hideTooltip() {
  if (!tip) return;
  owner = null;
  clearTimeout(pressTimer);
  tip.classList.remove('show');
  tip.setAttribute('aria-hidden', 'true');
}

/** Attach a tooltip to an element. `build` returns a node (called lazily on show). */
export function attachTooltip(el, build) {
  builders.set(el, build);
  if (el.__tipBound) return el;
  el.__tipBound = true;
  const show = () => {
    const b = builders.get(el);
    if (b) showTooltip(el, b());
  };
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && owner === el) hideTooltip(); });
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) show(); });
  el.addEventListener('blur', () => { if (owner === el) hideTooltip(); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(show, 380);
  });
  const end = (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(pressTimer);
    if (owner === el) setTimeout(() => { if (owner === el) hideTooltip(); }, 1400);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

export function tooltipOwner() { return owner; }
