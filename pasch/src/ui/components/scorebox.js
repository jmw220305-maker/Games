// Scorebox: HANDNAME · Stufe, [PUNKTE] × [MULTI], darunter die Summe während der Wertung.
import { h } from '../dom.js';
import { juice, pop, setFlames, tickNumber, time } from '../../fx/index.js';
import { fmt, fmtMult } from '../text.js';

export function createScorebox() {
  const name = h('div.sb-name', '—');
  const level = h('div.sb-level');
  const chips = h('div.sb-num', '0');
  const mult = h('div.sb-num', '0');
  const chipsBox = h('div.sb-box.sb-chips', h('div.sb-cap', 'Punkte'), chips);
  const multBox = h('div.sb-box.sb-mult', h('div.sb-cap', 'Multi'), mult);
  const x = h('div.sb-x', '×');
  const total = h('div.sb-total');
  const totalWrap = h('div.sb-totalwrap', h('span.sb-eq', '='), total);
  const el = h('div.scorebox',
    h('div.sb-head', name, level),
    h('div.sb-row', h('div.sb-boxw', chipsBox), x, h('div.sb-boxw', multBox)),
    totalWrap);
  let cv = 0, mv = 0;
  let flames = 0;

  const api = {
    el, chipsBox, multBox, chipsNum: chips, multNum: mult, nameEl: name, totalEl: total,
    get chips() { return cv; },
    get mult() { return mv; },
    setHand(n, lvl, o = {}) {
      name.textContent = n || '—';
      level.textContent = lvl ? `Stufe ${lvl}` : '';
      el.classList.toggle('scorebox--empty', !n);
      el.classList.toggle('scorebox--bad', !!o.bad);
      if (o.pop) juice(name, 0.25);
    },
    set(c, m, o = {}) {
      cv = c; mv = m;
      chips.textContent = fmt(c);
      mult.textContent = fmtMult(m);
      if (o.bump === 'chips' || o.bump === 'both') { juice(chipsBox, o.amount || 0.22); flashBox(chipsBox); }
      if (o.bump === 'mult' || o.bump === 'both') { juice(multBox, o.amount || 0.22); flashBox(multBox); }
    },
    clear() {
      api.setHand(null, null);
      api.set(0, 0);
      api.hideTotal();
      api.flames(0);
    },
    async showTotal(value, o = {}) {
      el.classList.add('scorebox--total');
      total.textContent = '0';
      pop(totalWrap, 1.3, 180);
      await tickNumber(total, 0, value, { duration: o.duration, onTick: o.onTick, format: (n) => fmt(n) });
    },
    hideTotal() { el.classList.remove('scorebox--total'); total.textContent = ''; },
    flames(intensity) {
      if (Math.abs(intensity - flames) < 0.02 && intensity > 0) return;
      flames = intensity;
      setFlames(chipsBox, intensity, { color: 'chips' });
      setFlames(multBox, intensity, { color: 'mult' });
    },
    get flameLevel() { return flames; },
    /** Punkte und Multi „verschmelzen“: beide Kästen schieben zur Mitte und pulsieren. */
    async merge() {
      el.classList.add('scorebox--merge');
      juice(chipsBox, 0.35); juice(multBox, 0.35);
      await time.wait(180);
      el.classList.remove('scorebox--merge');
    },
  };
  return api;
}

function flashBox(box) {
  box.classList.remove('sb-flash');
  void box.offsetWidth;
  box.classList.add('sb-flash');
}
