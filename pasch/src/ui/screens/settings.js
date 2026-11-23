// Einstellungen (als Modal – vom Titel und aus dem Pause-Menü erreichbar).
import { h } from '../dom.js';
import { audio } from '../../audio/audio.js';
import { openModal, confirmDialog } from '../overlay.js';
import { juice } from '../../fx/index.js';

function seg(options, value, onPick) {
  const el = h('div.seg');
  const render = (v) => {
    el.innerHTML = '';
    for (const [val, label] of options) {
      const b = h(`button.seg-b${val === v ? '.seg-b--sel' : ''}`, { type: 'button' }, label);
      b.addEventListener('click', () => { audio.init(); audio.play('click'); onPick(val); render(val); juice(b, 0.2); });
      el.appendChild(b);
    }
  };
  render(value);
  return el;
}

function toggle(value, onPick) {
  return seg([[true, 'An'], [false, 'Aus']], !!value, onPick);
}

function slider(value, onInput) {
  const out = h('span.slider-val', `${Math.round(value * 100)} %`);
  const inp = h('input.slider', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100) });
  inp.addEventListener('input', () => { out.textContent = `${inp.value} %`; onInput(inp.value / 100); });
  inp.addEventListener('change', () => audio.play('tick', { step: Math.round(inp.value / 10) }));
  return h('div.slider-wrap', inp, out);
}

export function openSettings(app) {
  const s = app.settings;
  const set = (fn) => { fn(); app.applySettings(); app.saveProfile(); };
  const row = (label, ctl, sub) => h('div.set-row', h('div.set-label', label, sub ? h('div.set-sub', sub) : null), ctl);
  const reduced = s.reducedMotion == null ? matchMedia('(prefers-reduced-motion: reduce)').matches : s.reducedMotion;
  const content = h('div.settings',
    row('Spielgeschwindigkeit', seg([[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']], s.speed, (v) => set(() => { s.speed = v; }))),
    row('Gesamtlautstärke', slider(s.volume.master, (v) => set(() => { s.volume.master = v; }))),
    row('Effekte', slider(s.volume.sfx, (v) => set(() => { s.volume.sfx = v; }))),
    row('Musik', slider(s.volume.music, (v) => set(() => { s.volume.music = v; }))),
    row('Ton', seg([[false, 'An'], [true, 'Stumm']], !!s.muted, (v) => set(() => { s.muted = v; }))),
    row('Bildschirmwackeln', seg([[0, '0 %'], [0.5, '50 %'], [1, '100 %']], s.shake, (v) => set(() => { s.shake = v; }))),
    row('Blitze', toggle(s.flashes, (v) => set(() => { s.flashes = v; }))),
    row('CRT-Effekt', toggle(s.crt, (v) => set(() => { s.crt = v; })), 'Scanlines und Vignette'),
    row('Bewegung reduzieren', toggle(reduced, (v) => set(() => { s.reducedMotion = v; }))),
    row('Automatisch werfen', toggle(s.autoThrow, (v) => set(() => { s.autoThrow = v; })), 'Wurf beginnt nach dem Werten von selbst'),
    h('div.set-danger', h('button.btn.btn--danger.btn--s', { type: 'button', onclick: async () => {
      audio.play('click');
      const ok = await confirmDialog('Spielstand löschen?', 'Profil, Sammlung, Erfolge und der laufende Lauf werden unwiderruflich gelöscht.', { yes: 'Löschen', danger: true });
      if (ok) { m.close(); app.resetAll(); }
    } }, h('span.btn-label', 'Spielstand löschen'))));
  const m = openModal({ title: 'Einstellungen', content, cls: 'modal-panel--settings', buttons: [{ label: 'Fertig', kind: 'hot', onClick: (mm) => mm.close() }] });
  return m;
}
