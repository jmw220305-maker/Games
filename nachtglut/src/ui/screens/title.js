// Title / Feuerstelle (state 'menu'). Translucent so the animated hearth backdrop shows through.
import { h, button, icon, setText } from '../dom.js';
import { fmtInt, plural } from '../format.js';
import { ashPill } from './common.js';

export function createTitle(ui) {
  const save = () => ui.game.save || {};
  const statsLine = h('div.title-stats');
  const ash = ashPill(ui);
  const altarBtn = button('Aschealtar', { cls: 'btn-menu', icon: icon({ glyph: 'ember', color: '#ff9a4a' }, 24, { name: 'A' }), sub: '', onClick: () => ui.openScreen('altar') });
  const menu = h('nav.title-menu', { attrs: { 'aria-label': 'Hauptmenü' } },
    button('Aufbrechen', { cls: 'btn-menu btn-primary', icon: icon({ glyph: 'flame', color: '#ffd9a0' }, 24, { name: 'F' }), sub: 'Ein neuer Abstieg', onClick: () => ui.openScreen('setup') }),
    altarBtn,
    button('Chronik', { cls: 'btn-menu', icon: icon({ glyph: 'book', color: '#e8d6b0' }, 24, { name: 'C' }), sub: 'Gegner, Relikte, Erfolge', onClick: () => ui.openScreen('chronik') }),
    button('Einstellungen', { cls: 'btn-menu', icon: icon({ glyph: 'compass', color: '#e8d6b0' }, 24, { name: 'E' }), sub: 'Klang, Bild, Steuerung', onClick: () => ui.openScreen('settings') }));

  const el = h('section.screen.screen-title', { attrs: { 'aria-label': 'Nachtglut' } },
    h('div.title-vignette'),
    h('div.title-wrap',
      h('div.logo-block',
        h('div.logo-kicker', { text: 'Ein Abstieg in die Glut' }),
        h('h1.logo', { attrs: { 'aria-label': 'Nachtglut' } }, h('span.logo-text', { text: 'Nachtglut' })),
        h('div.logo-rule', h('span.rule-gem')),
        h('p.tagline', { text: 'Die Sonne im Herzen der Welt ist erloschen. Trag die letzte Glut hinab und entzünde sie neu.' })),
      menu,
      h('div.title-foot', ash, statsLine)),
    h('div.title-version', { text: 'Feuerstelle' }));

  function refresh() {
    ash.refresh();
    const s = save();
    const st = s.stats || {};
    const parts = [];
    if (st.runs) parts.push(plural(st.runs, 'Abstieg', 'Abstiege'));
    if (st.wins) parts.push(plural(st.wins, 'Sieg', 'Siege'));
    if (st.bestFloor) parts.push(`tiefste Ebene ${st.bestFloor}`);
    setText(statsLine, parts.length ? parts.join(' · ') : 'Noch kein Glutträger ist hinabgestiegen.');
    const sub = altarBtn.querySelector('.btn-sub');
    if (sub) sub.textContent = `${fmtInt(s.ash || 0)} Asche bereit`;
  }
  refresh();

  return {
    el,
    refresh,
    back() { /* nothing below the title */ },
    focus() { return menu.querySelector('button'); },
  };
}
