// Tiny DOM helpers shared by every UI module.
import { bus } from '../core/events.js';
import { content, onContentLoaded } from './content.js';

// Icons created before the sprite module finished loading get upgraded in place once it is there.
const pendingIcons = new Set();
onContentLoaded(() => {
  for (const p of pendingIcons) {
    const url = iconUrl(p.spec, p.px);
    if (!url) continue;
    p.el.classList.remove('ico-fallback');
    clear(p.el).appendChild(h('img', { src: url, alt: '', draggable: false, width: p.size, height: p.size }));
  }
  pendingIcons.clear();
});

/**
 * Create an element. `tag` may carry classes and an id: 'div.panel.big#root'.
 * props: { text, html, attrs, style, on: { evt: fn }, data: { k: v }, title, ...plain props }
 * children: nodes, strings, arrays, null/false (skipped)
 */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'class') { for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c); }
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const s of Object.keys(v)) { if (s.startsWith('--')) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; }
      } else if (k === 'on') { for (const e of Object.keys(v)) el.addEventListener(e, v[e]); }
      else if (k === 'data') { for (const d of Object.keys(v)) el.dataset[d] = v[d]; }
      else if (k === 'attrs') { for (const a of Object.keys(v)) if (v[a] != null && v[a] !== false) el.setAttribute(a, v[a] === true ? '' : v[a]); }
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Set text only when it changed (avoids layout work in the HUD). */
export function setText(el, value) {
  const s = String(value);
  if (el.__t !== s) { el.__t = s; el.textContent = s; }
}

export function toggleClass(el, cls, on) {
  const want = !!on;
  const key = '__c_' + cls;
  if (el[key] !== want) { el[key] = want; el.classList.toggle(cls, want); }
}

export function setVar(el, name, value) {
  const key = '__v' + name;
  if (el[key] !== value) { el[key] = value; el.style.setProperty(name, value); }
}

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------
function fallbackLetter(spec, name) {
  const s = name || (spec && (spec.glyph || spec.sprite)) || (typeof spec === 'string' ? spec.replace(/^(char_|glyph_|boss_)/, '') : '?');
  return String(s).trim().charAt(0).toUpperCase() || '?';
}

function iconKey(spec) {
  if (typeof spec === 'string') return spec;
  if (spec && spec.glyph) return 'glyph_' + spec.glyph;
  if (spec && (spec.sprite || spec.key)) return spec.sprite || spec.key;
  return '';
}

/** Data URL for an icon spec or null when the art is missing (caller shows a CSS fallback). */
export function iconUrl(spec, px = 32) {
  const sp = content.sprites;
  if (!sp || !spec) return null;
  const key = iconKey(spec);
  try {
    if (typeof sp.has === 'function' && !(sp.has(key) || (typeof spec === 'string' && sp.has('glyph_' + spec)))) return null;
    const url = sp.icon(spec, px);
    return typeof url === 'string' && url.length > 100 ? url : null;
  } catch {
    return null;
  }
}

/**
 * <span class="ico"> with a pixel-crisp <img> (or a lettered fallback disc).
 * opts: { name (for the fallback letter), color, cls, silhouette }
 */
export function icon(spec, px = 32, opts = {}) {
  const color = opts.color || (spec && spec.color) || '#ffb347';
  const el = h('span.ico', { style: { '--ico': `${px}px`, '--ico-c': color } });
  if (opts.cls) el.classList.add(...opts.cls.split(' '));
  if (opts.silhouette) el.classList.add('silhouette');
  const url = iconUrl(spec, Math.max(16, Math.round(px)));
  if (url) {
    const img = h('img', { src: url, alt: '', draggable: false, width: px, height: px });
    el.appendChild(img);
  } else {
    el.classList.add('ico-fallback');
    el.appendChild(h('span', { text: fallbackLetter(spec, opts.name) }));
    if (!content.loaded && spec) pendingIcons.add({ el, spec, px: Math.max(16, Math.round(px)), size: px });
  }
  return el;
}

// ---------------------------------------------------------------------------------------------
// Audio cue events
// ---------------------------------------------------------------------------------------------
let lastHover = 0;
export const sfx = {
  click() { bus.emit('ui:click', {}); },
  hover() {
    const t = performance.now();
    if (t - lastHover < 45) return;
    lastHover = t;
    bus.emit('ui:hover', {});
  },
  open() { bus.emit('ui:open', {}); },
  close() { bus.emit('ui:close', {}); },
  confirm() { bus.emit('ui:confirm', {}); },
  deny() { bus.emit('ui:deny', {}); },
};

/**
 * Standard button. opts: { cls, icon, sub, disabled (aria), reason, onClick, sound: 'click'|'confirm'|false, title, key }
 * Disabled buttons stay focusable (aria-disabled) so keyboard/gamepad users can read why.
 */
export function button(label, opts = {}) {
  const b = h('button.btn', { type: 'button' });
  if (opts.cls) b.classList.add(...opts.cls.split(' ').filter(Boolean));
  if (opts.icon) b.appendChild(opts.icon);
  const lbl = h('span.btn-label', { text: label });
  b.appendChild(lbl);
  if (opts.sub) b.appendChild(h('span.btn-sub', { text: opts.sub }));
  if (opts.key) b.appendChild(h('kbd.btn-key', { text: opts.key }));
  if (opts.title) b.title = opts.title;
  setDisabled(b, !!opts.disabled);
  b.addEventListener('click', (e) => {
    if (b.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      sfx.deny();
      b.classList.remove('shake');
      void b.offsetWidth;
      b.classList.add('shake');
      if (opts.onDenied) opts.onDenied(e);
      return;
    }
    if (opts.sound !== false) (opts.sound === 'confirm' ? sfx.confirm : sfx.click)();
    if (opts.onClick) opts.onClick(e);
  });
  return b;
}

export function setDisabled(el, disabled) {
  if (disabled) el.setAttribute('aria-disabled', 'true');
  else el.removeAttribute('aria-disabled');
}

/** Focusable elements inside a container, in DOM order. */
export function focusables(root) {
  if (!root) return [];
  const list = root.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
  const out = [];
  for (const el of list) {
    if (el.disabled || el.closest('[hidden]') || el.closest('.is-hidden')) continue;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    out.push(el);
  }
  return out;
}

export function isTextField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(el.type);
  return false;
}
