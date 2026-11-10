// Einstellungen: audio, display, controls, save export/import/reset (save section only outside a run).
import { bus } from '../../core/events.js';
import { h, icon, button, sfx } from '../dom.js';
import * as saveMod from '../../meta/save.js';
import { screenShell, sectionTitle } from './common.js';

export function createSettings(ui, params = {}) {
  const game = ui.game;
  const inRun = !!params.inRun;
  const shell = screenShell(ui, { id: 'settings', title: 'Einstellungen', kicker: inRun ? 'Pause' : 'Feuerstelle' });
  const s = () => ui.settings();

  function slider(key, label, opts = {}) {
    const max = opts.max ?? 1;
    const val = h('span.set-val');
    const inp = h('input.set-range', { type: 'range', min: 0, max: Math.round(max * 100), step: 5, attrs: { 'aria-label': label } });
    const show = (v) => { val.textContent = `${Math.round(v * 100)} %`; inp.style.setProperty('--f', String(v / max)); };
    const cur = Number.isFinite(s()[key]) ? s()[key] : (opts.def ?? 1);
    inp.value = String(Math.round(cur * 100));
    show(cur);
    inp.addEventListener('input', () => { const v = Number(inp.value) / 100; show(v); ui.setSetting(key, v, { persist: false }); });
    inp.addEventListener('change', () => { ui.setSetting(key, Number(inp.value) / 100); sfx.click(); });
    return h('div.set-row.set-slider', h('label.set-label', { text: label }), inp, val);
  }

  function toggle(key, label, desc) {
    const b = h('button.set-toggle', { type: 'button', attrs: { role: 'switch', 'aria-checked': String(!!s()[key]) } },
      h('span.set-text', h('span.set-label', { text: label }), desc ? h('span.set-desc', { text: desc }) : null),
      h('span.switch', h('span.switch-knob')));
    b.addEventListener('click', () => {
      const v = !s()[key];
      ui.setSetting(key, v);
      b.setAttribute('aria-checked', String(v));
      sfx.click();
    });
    return b;
  }

  function segmented(key, label, options) {
    const row = h('div.set-row.set-seg', h('span.set-label', { text: label }));
    const seg = h('div.seg', { attrs: { role: 'radiogroup', 'aria-label': label } });
    for (const o of options) {
      const b = h('button.seg-btn', { type: 'button', attrs: { role: 'radio', 'aria-checked': String(s()[key] === o.value) } }, o.label);
      b.addEventListener('click', () => {
        ui.setSetting(key, o.value);
        for (const x of seg.children) x.setAttribute('aria-checked', String(x === b));
        sfx.click();
      });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
  }

  const audio = h('div.set-section.panel', sectionTitle('Klang'),
    slider('master', 'Gesamtlautstärke'), slider('music', 'Musik'), slider('sfx', 'Effekte'));
  const display = h('div.set-section.panel', sectionTitle('Darstellung'),
    slider('shake', 'Bildschirmwackeln', { max: 2 }),
    toggle('flashes', 'Lichtblitze', 'Helle Vollbild-Blitze bei Explosionen und Treffern.'),
    toggle('damageNumbers', 'Schadenszahlen'),
    toggle('showTimer', 'Laufzeit anzeigen'),
    toggle('reducedMotion', 'Reduzierte Bewegung', 'Weniger Animationen in Menüs und Anzeigen.'));
  const controls = h('div.set-section.panel', sectionTitle('Steuerung'),
    toggle('autoAim', 'Automatisch zielen', 'Zielt auf den nächsten Gegner, statt auf den Mauszeiger.'),
    toggle('autoFire', 'Automatisch feuern', 'Feuert von selbst, sobald ein Ziel in Reichweite ist.'),
    segmented('touchSide', 'Touch-Knöpfe', [{ value: 'left', label: 'Links' }, { value: 'right', label: 'Rechts' }]),
    h('div.set-keys',
      h('div.keys-title', { text: 'Tastatur & Gamepad' }),
      h('div.keys-grid',
        ...[['WASD / Pfeile', 'Bewegen'], ['Maus', 'Zielen & feuern'], ['Leertaste', 'Sprint'], ['Q / Rechtsklick', 'Fertigkeit'],
          ['E', 'Benutzen'], ['R / Tab', 'Waffe wechseln'], ['M', 'Karte'], ['Esc / P', 'Pause']].map(([k, v]) => h('div.key-row', h('kbd', { text: k }), h('span', { text: v }))))));

  const sections = [audio, display, controls];

  if (!inRun) {
    const out = h('div.save-io');
    const msg = h('div.save-msg', { attrs: { 'aria-live': 'polite' } });
    const setMsg = (t, kind = 'info') => { msg.textContent = t; msg.className = `save-msg ${kind}`; };

    const exportBtn = button('Spielstand exportieren', {
      icon: icon({ glyph: 'book', color: '#e8d6b0' }, 20, { name: 'E' }),
      onClick: () => {
        let code = '';
        try { code = saveMod.exportSave(game.save); } catch (err) { setMsg('Export fehlgeschlagen.', 'bad'); return; }
        out.replaceChildren();
        const ta = h('textarea.save-text', { readOnly: true, rows: 4, attrs: { 'aria-label': 'Spielstand-Code', spellcheck: 'false' } });
        ta.value = code;
        const copy = button('Kopieren', {
          cls: 'btn-small btn-primary',
          onClick: () => {
            const fallback = () => { ta.focus(); ta.select(); setMsg('Der Code ist markiert – kopiere ihn mit Strg+C bzw. ⌘+C.', 'info'); };
            try {
              const p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(code) : null;
              if (!p) { fallback(); return; }
              p.then(() => setMsg('Code in die Zwischenablage kopiert.', 'good')).catch(fallback);
            } catch { fallback(); }
          },
        });
        out.append(ta, h('div.save-actions', copy));
        setMsg('Bewahre diesen Code gut auf. Mit ihm holst du deinen Fortschritt zurück.', 'info');
      },
    });
    const importBtn = button('Spielstand importieren', {
      icon: icon({ glyph: 'key', color: '#e8d6b0' }, 20, { name: 'I' }),
      onClick: () => {
        out.replaceChildren();
        const ta = h('textarea.save-text', { rows: 4, placeholder: 'Spielstand-Code hier einfügen …', attrs: { 'aria-label': 'Spielstand-Code einfügen', spellcheck: 'false' } });
        const load = button('Laden', {
          cls: 'btn-small btn-primary', sound: false,
          onClick: async () => {
            let imported;
            try { imported = saveMod.importSave(ta.value, { persist: false }); } catch (err) { sfx.deny(); setMsg(err && err.message ? err.message : 'Der Code ist ungültig.', 'bad'); return; }
            const ok = await ui.confirm({ title: 'Spielstand laden?', text: 'Dein aktueller Fortschritt wird durch den importierten Spielstand ersetzt.', confirmLabel: 'Laden', danger: true });
            if (!ok) return;
            saveMod.assignSave(game.save, imported);
            saveMod.persistSave(game.save);
            bus.emit('meta:change', { save: game.save });
            bus.emit('settings:change', { settings: game.save.settings });
            setMsg('Spielstand geladen.', 'good');
            ui.toast({ text: 'Spielstand geladen.', kind: 'good' });
            out.replaceChildren();
          },
        });
        out.append(ta, h('div.save-actions', load));
        setMsg('Füge einen exportierten Code ein.', 'info');
        ui.focusEl(ta, true);
      },
    });
    const resetBtn = button('Spielstand zurücksetzen', {
      cls: 'btn-danger', icon: icon({ glyph: 'skull', color: '#ff8a7a' }, 20, { name: 'R' }), sound: false,
      onClick: async () => {
        sfx.click();
        const ok = await ui.confirm({
          title: 'Allen Fortschritt löschen?',
          text: 'Asche, Verbesserungen, Freischaltungen, Chronik und Erfolge gehen unwiderruflich verloren. Deine Einstellungen bleiben erhalten.',
          confirmLabel: 'Endgültig löschen', danger: true,
        });
        if (!ok) return;
        saveMod.resetSave({ into: game.save, keepSettings: true });
        bus.emit('meta:change', { save: game.save });
        bus.emit('settings:change', { settings: game.save.settings });
        setMsg('Der Spielstand wurde zurückgesetzt.', 'good');
        ui.toast({ text: 'Die Feuerstelle beginnt von Neuem.', kind: 'info' });
      },
    });
    sections.push(h('div.set-section.panel.set-save', sectionTitle('Spielstand'), h('div.save-btns', exportBtn, importBtn, resetBtn), msg, out));
  }

  shell.body.appendChild(h('div.set-grid', sections));

  return {
    el: shell.el,
    focus() { return shell.body.querySelector('input, button'); },
  };
}
