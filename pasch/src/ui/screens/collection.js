// Sammlung: Talismane, Verbrauchsgüter, Wächter, Hände (mit Entdeckt-Status), Erfolge, Statistik.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { createCard, model } from '../components/card.js';
import { attachTooltip } from '../tooltip.js';
import { popIn, juice } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { rich, fmt, money } from '../text.js';

const TABS = [
  ['talismans', 'Talismane'], ['consumables', 'Verbrauchsgüter'], ['wardens', 'Wächter'], ['hands', 'Hände'],
  ['achievements', 'Erfolge'], ['stats', 'Statistik'],
];

export function createCollection(app) {
  const tabsEl = h('div.coll-tabs');
  const grid = h('div.coll-body');
  const count = h('div.coll-count');
  const el = h('section.screen.screen-collection',
    h('div.coll-head', button('Zurück', { kind: 'plain', size: 'm', icon: '‹', onClick: () => app.showTitle() }), h('div.coll-title', 'Sammlung'), count),
    tabsEl, grid);
  let tab = 'talismans';
  let cards = [];

  function render() {
    const p = app.profile;
    const c = p.collection;
    tabsEl.innerHTML = '';
    for (const [id, label] of TABS) {
      const b = h(`button.coll-tab${id === tab ? '.coll-tab--sel' : ''}`, { type: 'button' }, label);
      b.addEventListener('click', () => { audio.play('click'); tab = id; render(); });
      tabsEl.appendChild(b);
    }
    cards.forEach((x) => x.destroy());
    cards = [];
    grid.innerHTML = '';
    grid.className = `coll-body coll-body--${tab}`;
    let found = 0, total = 0;
    const addCard = (kind, id, status) => {
      total++;
      const known = !!status;
      if (known) found++;
      const wrap = h(`div.coll-item${known ? '' : '.coll-item--unknown'}`);
      if (known) {
        const cd = createCard(model(kind, id), { run: () => null, sway: false, badge: status === 'owned' ? '✓' : status === 'beaten' ? '✓' : null });
        cards.push(cd);
        wrap.appendChild(cd.el);
      } else {
        const ph = h('div.card.card--unknown', h('div.card-face', h('div.card-glyph', h('span', '?')), h('div.card-name', '???')));
        attachTooltip(ph, () => ({ title: 'Noch nicht entdeckt', kind: 'Sammlung', hue: 270, body: 'Begegne diesem Inhalt in einem Lauf, um ihn freizuschalten.' }));
        wrap.appendChild(ph);
      }
      grid.appendChild(wrap);
      popIn(wrap, 200, Math.min(600, total * 12));
    };
    if (tab === 'talismans') for (const id of G.TALISMAN_IDS) addCard('talisman', id, c.talismans[id]);
    else if (tab === 'consumables') for (const id of G.CONSUMABLE_IDS) addCard('consumable', id, c.consumables[id]);
    else if (tab === 'wardens') for (const id of G.WARDEN_IDS) addCard('warden', id, c.wardens[id]);
    else if (tab === 'hands') {
      for (const id of G.HAND_ORDER) {
        const hd = G.HANDS[id];
        total++;
        const known = !hd.secret || c.hands[id];
        if (c.hands[id]) found++;
        const plays = p.stats.hands[id] || 0;
        const row = h(`div.coll-hand${known ? '' : '.coll-hand--unknown'}`, { vars: { hue: hd.hue } },
          h('span.coll-hand-glyph', known ? hd.glyph : '?'),
          h('span.coll-hand-name', known ? hd.name : 'Geheime Hand'),
          h('span.coll-hand-base', known ? h('span', h('b.kw-chips', String(hd.chips)), ' × ', h('b.kw-mult', String(hd.mult))) : '—'),
          h('span.coll-hand-plays', c.hands[id] ? `${plays}× gewertet` : 'noch nie gewertet'));
        if (known) attachTooltip(row, () => ({ title: hd.name, kind: 'Hand', hue: hd.hue, body: rich(`${hd.desc} Basis ${hd.chips} Punkte × ${hd.mult} Multi, je Stufe +${hd.perLevel.chips} Punkte / +${hd.perLevel.mult} Multi.`) }));
        grid.appendChild(row);
      }
    } else if (tab === 'achievements') {
      for (const id of G.ACHIEVEMENT_IDS) {
        const a = G.ACHIEVEMENTS[id];
        total++;
        const done = !!p.achievements[id];
        if (done) found++;
        const un = a.unlocks ? ` Schaltet frei: ${G.CUPS[a.unlocks.id].name}.` : '';
        grid.appendChild(h(`div.ach${done ? '.ach--done' : ''}`, { vars: { hue: a.hue } },
          h('span.ach-glyph', a.glyph), h('div.ach-txt', h('b', a.name), h('span', a.desc + un)), h('span.ach-mark', done ? '✓' : '')));
      }
    } else {
      const s = p.stats;
      const rows = [
        ['Läufe', s.runs], ['Siege', s.wins], ['Niederlagen', s.losses], ['Höchster Einsatz', s.highestAnte],
        ['Bester Wurf', fmt(s.bestThrow)], ['Beste Hand', s.bestHand ? G.HANDS[s.bestHand].name : '–'],
        ['Würfe gewertet', s.throws], ['Nachwürfe', s.rerolls], ['Partien gewonnen', s.roundsWon], ['Wächter besiegt', s.wardensBeaten],
        ['Geld verdient', money(s.moneyEarned)], ['Sternbilder benutzt', s.constellationsUsed], ['Beutel geöffnet', s.packsOpened],
        ['Talismane gekauft', s.talismansBought], ['Gläser zersprungen', s.glassShattered], ['Wiederholungen', s.retriggers],
      ];
      for (const [k, v] of rows) grid.appendChild(h('div.go-stat', h('span', k), h('b', String(v))));
      const hist = (p.history || []).slice(-8).reverse();
      if (hist.length) {
        grid.appendChild(h('div.coll-sub', 'Letzte Läufe'));
        for (const r of hist) grid.appendChild(h('div.go-stat', h('span', `${G.CUPS[r.cup] ? G.CUPS[r.cup].name : r.cup} · Stufe ${r.stake} · ${r.seed}`), h('b', `${r.won ? 'Sieg' : `Einsatz ${r.ante}`} · ${fmt(r.bestThrow)}`)));
      }
      count.textContent = '';
      return;
    }
    count.textContent = `${found}/${total} entdeckt`;
    juice(count, 0.15);
  }

  return {
    el,
    enter() { app.mood('menu'); render(); },
    leave() { cards.forEach((x) => x.destroy()); },
    onKey(e) { if (e.key === 'Escape') { app.showTitle(); return true; } return false; },
  };
}
