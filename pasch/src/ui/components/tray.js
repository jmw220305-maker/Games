// Filz-Schale mit Würfeln in einer Reihe. Responsiv: Würfelgröße folgt der Breite (5–7 Würfel).

import { time } from '../../fx/time.js';
import { createDie } from './die.js';

/**
 * @param {HTMLElement} container  Element, in das die Schale gehängt wird
 * @param {object} [opts]          {maxSize=88, minSize=34}
 */
export function createTray(container, opts = {}) {
  const el = document.createElement('div');
  el.className = 'tray';
  el.innerHTML = '<div class="tray-felt"><div class="tray-row"></div></div>';
  const row = el.querySelector('.tray-row');
  container.appendChild(el);

  const maxSize = opts.maxSize || 88;
  const minSize = opts.minSize || 30;
  let dice = [];        // Die-Komponenten
  let clickFn = null;
  let interactive = true;
  let size = 64;

  const api = {
    el,
    /** Hooks: onLand(i, impact), onBounce(i, impact), onLaunch() (einmal je Wurf), onHighlight(i, k) */
    onLand: null, onBounce: null, onLaunch: null, onHighlight: null,
    get count() { return dice.length; },
    get dieSize() { return size; },
    get dice() { return dice; },
    setDice, roll, setHeld, onDieClick, getDieRect, highlight, clearHighlight, dieEl, die, setInteractive, layout, destroy,
    show(i, v, o) { if (dice[i]) dice[i].show(v, o); },
    turn(i, v, o) { return dice[i] ? dice[i].turn(v, o) : Promise.resolve(); },
  };

  function wire(d, i) {
    d.index = i;
    d.el.dataset.index = String(i);
    d.onLand = (impact) => { if (api.onLand) api.onLand(d.index, impact); };
    d.onBounce = (impact) => { if (api.onBounce) api.onBounce(d.index, impact); };
  }

  function onClick(ev) {
    const dEl = ev.target.closest('.die');
    if (!dEl || !interactive || !clickFn) return;
    const i = Number(dEl.dataset.index);
    clickFn(i, ev);
  }
  function onKey(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const dEl = ev.target.closest && ev.target.closest('.die');
    if (!dEl || !interactive || !clickFn) return;
    ev.preventDefault();
    clickFn(Number(dEl.dataset.index), ev);
  }
  row.addEventListener('click', onClick);
  row.addEventListener('keydown', onKey);

  /**
   * Würfel setzen. dice: Die[]. Optional rolled: Rolled[] (zeigt Werte sofort, inkl. held/hidden).
   * Vorhandene Komponenten werden wiederverwendet (gleiche Position → setData).
   */
  function setDice(list, rolled) {
    list = list || [];
    while (dice.length > list.length) dice.pop().destroy();
    list.forEach((d, i) => {
      if (dice[i]) dice[i].setData(d);
      else {
        const c = createDie(d, { index: i });
        c.el.style.setProperty('--i', String(i));
        row.appendChild(c.el);
        dice[i] = c;
      }
      wire(dice[i], i);
      const r = rolled && rolled[i];
      if (r) {
        dice[i].show(r.v, { faceIndex: r.faceIndex, hidden: r.hidden });
        dice[i].setHeld(!!r.held);
        dice[i].setShackled(!!r.shackled);
      }
    });
    layout();
  }

  /**
   * Würfeln. indices: Würfelindizes; values: Zahl | Rolled je Würfel –
   * entweder parallel zu indices (values[k] gehört zu indices[k]) oder voll (values[i], wenn values.length === Anzahl
   * Würfel und indices eine echte Teilmenge ist).
   * opts: {suspenseIndex (Würfelindex; Standard: letzter geworfener; null = kein Spannungs-Würfel), stagger=50}
   * → Promise (alle gelandet). Gehaltene, nicht geworfene Würfel zittern kurz („widerstehen“).
   */
  function roll(indices, values, o = {}) {
    if (indices == null) indices = dice.map((_, i) => i);
    const full = values && values.length === dice.length && indices.length < dice.length;
    const stagger = o.stagger != null ? o.stagger : 50;
    const susp = o.suspenseIndex === undefined ? indices[indices.length - 1] : o.suspenseIndex;
    let launched = false;
    const set = new Set(indices);
    dice.forEach((d, i) => { if (!set.has(i) && d.held) d.resist(); });
    const ps = indices.map((i, k) => {
      const d = dice[i];
      if (!d) return Promise.resolve();
      const raw = full ? values[i] : values[k];
      const r = typeof raw === 'object' && raw ? raw : { v: raw };
      d.onLaunch = () => { if (!launched) { launched = true; if (api.onLaunch) api.onLaunch(); } };
      return d.roll(r.v, { faceIndex: r.faceIndex, hidden: r.hidden, delay: k * stagger, suspense: i === susp && (indices.length > 1 || !!o.forceSuspense) });
    });
    return Promise.all(ps).then(() => undefined);
  }

  function setHeld(i, b) { if (dice[i]) dice[i].setHeld(b); }
  function onDieClick(fn) { clickFn = fn; }
  function getDieRect(i) { return dice[i] ? dice[i].el.getBoundingClientRect() : null; }
  function dieEl(i) { return dice[i] ? dice[i].el : null; }
  function die(i) { return dice[i] || null; }
  function setInteractive(b) { interactive = !!b; el.classList.toggle('tray--locked', !interactive); }

  /**
   * Wertende Würfel heben sich nacheinander mit juice. opts: {gap=75 (Spiel-ms), amount=0.3, keep=true}
   * → Promise (nach dem letzten). Mit keep bleiben sie oben bis clearHighlight().
   */
  async function highlight(indices, o = {}) {
    const gap = o.gap != null ? o.gap : 75;
    for (let k = 0; k < indices.length; k++) {
      const d = dice[indices[k]];
      if (!d) continue;
      d.setScoring(true);
      d.juice(o.amount || 0.3);
      if (api.onHighlight) api.onHighlight(indices[k], k);
      if (k < indices.length - 1) await time.wait(gap);
    }
    if (o.keep === false) { await time.wait(300); clearHighlight(); }
  }
  function clearHighlight() { dice.forEach((d) => d.setScoring(false)); }

  // ------------------------------------------------------------ Größe
  function layout() {
    const n = Math.max(dice.length, 5);
    const w = el.clientWidth || container.clientWidth || 360;
    const portrait = window.innerHeight > window.innerWidth;
    const gapR = portrait ? 0.24 : 0.42;
    // Rand (Holz) + Filz-Innenabstand in Würfelgrößen (siehe CSS .tray/.tray-felt), 3D-Überstand je Würfel ≈ 12 %
    const frame = portrait ? 0.28 + 0.36 : 0.28 + 0.6;
    let s = (w - 6) / (n * 1.12 + (n - 1) * gapR + frame);
    const hmax = portrait ? window.innerHeight * 0.12 : window.innerHeight * 0.17;
    s = Math.max(minSize, Math.min(maxSize, s, hmax));
    s = Math.floor(s);
    if (s !== size || !el.style.getPropertyValue('--die-size')) {
      size = s;
      el.style.setProperty('--die-size', `${s}px`);
      el.style.setProperty('--die-gap', `${Math.round(s * gapR * 1.12 + s * 0.12)}px`);
    }
  }
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => layout());
    ro.observe(el);
  } else window.addEventListener('resize', layout);
  layout();

  function destroy() {
    dice.forEach((d) => d.destroy());
    dice = [];
    if (ro) ro.disconnect(); else window.removeEventListener('resize', layout);
    el.remove();
  }

  return api;
}

export default createTray;
