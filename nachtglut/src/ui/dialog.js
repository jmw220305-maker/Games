// In-page confirm dialog (window.confirm/alert do not work in the hosting frame).
import { h, button, sfx } from './dom.js';

/**
 * @param {object} ui UI context (layers + focus)
 * @param {{ title, text, confirmLabel?, cancelLabel?, danger?, body? }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(ui, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      (ok ? sfx.confirm : sfx.close)();
      ui.popLayer(layer);
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), ui.reducedMotion() ? 0 : 180);
      resolve(ok);
    };
    const yes = button(opts.confirmLabel || 'Bestätigen', { cls: opts.danger ? 'btn-danger' : 'btn-primary', sound: false, onClick: () => finish(true) });
    const no = button(opts.cancelLabel || 'Abbrechen', { sound: false, onClick: () => finish(false) });
    const box = h('div.dialog.panel', { attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Bestätigen' } },
      h('div.dialog-title', { text: opts.title || 'Bist du sicher?' }),
      opts.text ? h('div.dialog-text', { text: opts.text }) : null,
      opts.body || null,
      h('div.dialog-actions', no, yes));
    const overlay = h('div.dialog-overlay', box);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) finish(false); });
    ui.dialogRoot.appendChild(overlay);
    const layer = { el: box, kind: 'dialog', back: () => finish(false) };
    ui.pushLayer(layer);
    sfx.open();
    ui.focusEl(opts.danger ? no : yes);
  });
}
