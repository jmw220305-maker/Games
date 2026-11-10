// Banners (big centred titles) and toasts (small stacking notices).
import { h, icon } from './dom.js';
import { text } from './format.js';

const TOAST_ICON = {
  info: { glyph: 'ember', color: '#ffb347' },
  good: { glyph: 'star', color: '#7be08f' },
  bad: { glyph: 'skull', color: '#ff6a5a' },
  unlock: { glyph: 'key', color: '#ffd35a' },
  achievement: { glyph: 'crown', color: '#ffd35a' },
};
const TOAST_TIME = { info: 3.2, good: 3.2, bad: 3.4, unlock: 5, achievement: 5 };
const MAX_TOASTS = 4;

export function createNotify(root, ui) {
  const bannerLayer = h('div.banner-layer', { attrs: { 'aria-live': 'polite' } });
  const toastLayer = h('div.toast-layer', { attrs: { 'aria-live': 'polite' } });
  root.append(bannerLayer, toastLayer);
  const toasts = [];
  let banner = null;

  function removeToast(t) {
    const i = toasts.indexOf(t);
    if (i >= 0) toasts.splice(i, 1);
    t.el.classList.add('out');
    setTimeout(() => t.el.remove(), ui.reducedMotion() ? 0 : 320);
  }

  return {
    toast(p = {}) {
      const kind = TOAST_ICON[p.kind] ? p.kind : 'info';
      let spec = p.icon || TOAST_ICON[kind];
      if (typeof spec === 'string' && !spec.includes('_')) spec = { glyph: spec, color: TOAST_ICON[kind].color };
      const msg = text(p.text, '');
      if (!msg) return;
      // merge identical consecutive toasts
      const last = toasts[toasts.length - 1];
      if (last && last.msg === msg && last.kind === kind) {
        last.count++;
        last.t = TOAST_TIME[kind];
        last.countEl.textContent = `×${last.count}`;
        last.countEl.hidden = false;
        return;
      }
      const countEl = h('span.toast-count', { hidden: true });
      const el = h(`div.toast.toast-${kind}`,
        icon(spec, 24, { name: msg }),
        h('div.toast-text', p.title ? h('div.toast-title', { text: p.title }) : null, h('div.toast-msg', { text: msg })),
        countEl);
      toastLayer.appendChild(el);
      const t = { el, kind, msg, t: (p.duration || TOAST_TIME[kind]), count: 1, countEl };
      toasts.push(t);
      while (toasts.length > MAX_TOASTS) removeToast(toasts[0]);
    },

    banner(p = {}) {
      const kind = p.kind || 'floor';
      if (banner) {
        const old = banner.el;
        old.classList.add('out');
        setTimeout(() => old.remove(), 400);
      }
      const el = h(`div.banner.banner-${kind}`,
        h('div.banner-orn'),
        h('div.banner-title', { text: text(p.title, '') }),
        p.subtitle ? h('div.banner-sub', { text: text(p.subtitle) }) : null,
        h('div.banner-orn.bottom'));
      bannerLayer.appendChild(el);
      banner = { el, t: p.duration || (kind === 'boss' ? 2.8 : kind === 'victory' || kind === 'death' ? 3.4 : 2.6), kind };
    },

    clearBanner() {
      if (banner) { banner.el.remove(); banner = null; }
    },

    clearToasts() {
      for (const t of toasts.slice()) t.el.remove();
      toasts.length = 0;
    },

    update(dt) {
      for (const t of toasts.slice()) {
        t.t -= dt;
        if (t.t <= 0) removeToast(t);
      }
      if (banner) {
        banner.t -= dt;
        if (banner.t <= 0) {
          const el = banner.el;
          el.classList.add('out');
          setTimeout(() => el.remove(), ui.reducedMotion() ? 0 : 600);
          banner = null;
        }
      }
    },
  };
}
