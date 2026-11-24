// Modale Fenster, Toasts und Tutorial-Hinweise.
import { h } from './dom.js';
import { pushKeys } from './input.js';
import { popIn, juice, time } from '../fx/index.js';
import { audio } from '../audio/audio.js';
import { button } from './components/button.js';
import { hideTooltip } from './tooltip.js';

const modals = [];

/**
 * openModal({title, sub, content: Node, buttons:[{label, kind, onClick(close)}], closable=true, cls, onClose})
 * → {el, panel, close()}
 */
export function openModal(o) {
  hideTooltip();
  const panel = h(`div.modal-panel${o.cls ? `.${o.cls}` : ''}`);
  if (o.title) panel.appendChild(h('div.modal-title', o.title));
  if (o.sub) panel.appendChild(h('div.modal-sub', { html: o.sub }));
  const body = h('div.modal-body');
  if (o.content) body.appendChild(o.content);
  panel.appendChild(body);
  const back = h('div.modal-back');
  const el = h('div.modal', back, h('div.modal-wrap', panel));
  let closed = false;
  const api = {
    el, panel, body,
    close(v) {
      if (closed) return;
      closed = true;
      offKeys();
      const i = modals.indexOf(api);
      if (i >= 0) modals.splice(i, 1);
      el.classList.add('modal--out');
      setTimeout(() => el.remove(), 160);
      hideTooltip();
      if (o.onClose) o.onClose(v);
    },
  };
  if (o.buttons && o.buttons.length) {
    const row = h('div.modal-buttons');
    for (const b of o.buttons) {
      row.appendChild(button(b.label, { kind: b.kind || 'plain', onClick: () => (b.onClick ? b.onClick(api) : api.close()) }));
    }
    panel.appendChild(row);
  }
  if (o.closable !== false) {
    const x = h('button.modal-x', { type: 'button', 'aria-label': 'Schließen' }, '✕');
    x.addEventListener('click', () => { audio.play('click'); api.close(); });
    panel.appendChild(x);
    back.addEventListener('click', () => api.close());
  }
  const offKeys = pushKeys((e) => {
    if (e.key === 'Escape') { if (o.closable !== false) api.close(); return true; }
    if (o.onKey && o.onKey(e)) return true;
    return 'stop'; // nichts an das Spiel darunter weiterreichen, native Knopf-Bedienung bleibt
  });
  document.body.appendChild(el);
  modals.push(api);
  popIn(panel, 240);
  audio.play('whoosh', { gain: 0.5 });
  return api;
}

export function anyModal() { return modals.length > 0; }
export function closeAllModals() { [...modals].forEach((m) => m.close()); }

/** Bestätigungsdialog → Promise<bool> */
export function confirmDialog(title, text, { yes = 'Ja', no = 'Abbrechen', danger = false } = {}) {
  return new Promise((resolve) => {
    let v = false;
    openModal({
      title, content: h('p.modal-text', text), cls: 'modal-panel--small',
      buttons: [
        { label: no, kind: 'plain', onClick: (m) => { v = false; m.close(); } },
        { label: yes, kind: danger ? 'danger' : 'hot', onClick: (m) => { v = true; m.close(); } },
      ],
      onClose: () => resolve(v),
    });
  });
}

// ---------------------------------------------------------------- Toasts
let toastBox = null;
/** toast(text, {title, glyph, kind:'info'|'good'|'bad'|'gold'|'ach', hue, ms, shape?: Formkategorie (itemshapes.js)}) */
export function toast(text, o = {}) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h('div.toasts', { 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const el = h(`div.toast.toast--${o.kind || 'info'}`, { vars: { hue: o.hue != null ? o.hue : 270 } },
    o.glyph ? h(`div.toast-glyph${o.shape ? `.toast-glyph--${o.shape}` : ''}`, h('span', o.glyph)) : null,
    h('div.toast-text', o.title ? h('div.toast-title', o.title) : null, h('div.toast-body', text)));
  // gleicher Text kurz hintereinander (z. B. mehrfach „Gerade nicht“) → nur den vorhandenen anstupsen
  const key = `${o.title || ''}|${text}`;
  const dup = [...toastBox.children].find((t) => t._key === key && !t.classList.contains('toast--out'));
  if (dup) { juice(dup, 0.15); clearTimeout(dup._timer); dup._timer = setTimeout(() => dismiss(dup), o.ms || 2600); return dup; }
  el._key = key;
  toastBox.appendChild(el);
  // höchstens 2 sichtbar: ältere sofort ausblenden
  const live = [...toastBox.children].filter((t) => !t.classList.contains('toast--out'));
  while (live.length > 2) dismiss(live.shift(), true);
  popIn(el, 220);
  el._timer = setTimeout(() => dismiss(el), o.ms || 2600);
  el.addEventListener('click', () => dismiss(el, true));
  return el;
}

function dismiss(el, fast) {
  if (!el || el.classList.contains('toast--out')) return;
  clearTimeout(el._timer);
  el.classList.add('toast--out');
  setTimeout(() => el.remove(), fast ? 140 : 260);
}

// ---------------------------------------------------------------- Tutorial-Hinweise
let hintEl = null;
/**
 * Kurzer Hinweis neben einem Element (wegklickbar). → Promise (wenn geschlossen)
 */
export function hint(anchor, text, { side = 'above' } = {}) {
  closeHint();
  if (!anchor || !anchor.isConnected) return Promise.resolve();
  return new Promise((resolve) => {
    const ok = h('button.hint-ok', { type: 'button' }, 'Verstanden');
    const el = h(`div.hint.hint--${side}`, h('div.hint-text', { html: text }), ok);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    let x = r.left + r.width / 2 - er.width / 2;
    x = Math.max(10, Math.min(window.innerWidth - er.width - 10, x));
    let y = side === 'below' ? r.bottom + 14 : r.top - er.height - 14;
    if (y < 8) { y = r.bottom + 14; el.classList.replace('hint--above', 'hint--below'); }
    if (y + er.height > window.innerHeight - 8) { y = r.top - er.height - 14; el.classList.replace('hint--below', 'hint--above'); }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.setProperty('--ax', `${Math.round(Math.max(16, Math.min(er.width - 16, r.left + r.width / 2 - x)))}px`);
    popIn(el, 240);
    audio.play('tag', { gain: 0.6 });
    const close = () => {
      if (hintEl !== el) return;
      hintEl = null;
      el.classList.add('hint--out');
      setTimeout(() => el.remove(), 200);
      resolve();
    };
    el._close = close;
    ok.addEventListener('click', (e) => { e.stopPropagation(); audio.play('click'); close(); });
    hintEl = el;
    time.wait(60).then(() => juice(el, 0.15));
  });
}
export function closeHint() { if (hintEl && hintEl._close) hintEl._close(); }
