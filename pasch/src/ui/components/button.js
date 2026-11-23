// Knöpfe mit Gefühl: pressable (0,94 → Überschwinger), Hover-/Klick-Sounds, „geht nicht“ bei gesperrt.
import { h, hoverCapable } from '../dom.js';
import { pressable, nope } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';

/**
 * button('Werten', {onClick, kind:'hot'|'go'|'blue'|'gold'|'plain'|'ghost'|'danger', size:'s'|'m'|'l', sub, icon, key, title})
 * → HTMLButtonElement mit .setLabel(text, sub), .setDisabled(bool, reason), .setKind(kind)
 */
export function button(label, opts = {}) {
  const el = h(`button.btn.btn--${opts.kind || 'plain'}${opts.size ? `.btn--${opts.size}` : ''}`, { type: 'button' });
  if (opts.title) el.title = opts.title;
  if (opts.cls) el.className += ` ${opts.cls}`;
  const lab = h('span.btn-label');
  const sub = h('span.btn-sub');
  if (opts.icon) el.appendChild(h('span.btn-icon', opts.icon));
  el.appendChild(lab);
  el.appendChild(sub);
  if (opts.key) el.appendChild(h('span.btn-key', opts.key));
  let disabled = false;
  let reason = null;
  el.setLabel = (text, s) => {
    lab.textContent = text;
    sub.textContent = s == null ? '' : s;
    sub.style.display = s == null || s === '' ? 'none' : '';
  };
  el.setLabel(label, opts.sub);
  el.setDisabled = (b, r) => {
    disabled = !!b;
    reason = r || null;
    el.classList.toggle('btn--disabled', disabled);
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  };
  el.setKind = (k) => {
    el.className = el.className.replace(/\bbtn--(hot|go|blue|gold|plain|ghost|danger)\b/, `btn--${k}`);
  };
  pressable(el, { down: 0.94 });
  if (hoverCapable()) el.addEventListener('pointerenter', () => { if (!disabled) audio.play('hover'); });
  el.addEventListener('pointerdown', () => { audio.init(); if (!disabled) audio.play('press'); });
  // Nach Zeiger-Klick Fokus abgeben, damit die Leertaste nicht zusätzlich den Knopf auslöst
  el.addEventListener('pointerup', () => setTimeout(() => el.blur(), 0));
  el.addEventListener('click', (e) => {
    if (disabled) {
      nope(el);
      audio.play('deny');
      if (opts.onDenied) opts.onDenied(reason, e);
      return;
    }
    audio.play('click');
    if (opts.onClick) opts.onClick(e);
  });
  return el;
}

/** Kleiner runder Symbol-Knopf (Optionen, Info) */
export function iconButton(icon, opts = {}) {
  return button('', { ...opts, icon, cls: `btn--icon ${opts.cls || ''}`.trim() });
}
