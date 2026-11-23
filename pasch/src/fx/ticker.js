// Zahlen hochzählen mit Tick-Callback (für Ticksound) und Schluss-Pop.

import { time, ease } from './time.js';
import { pop, juice } from './juice.js';

const running = new WeakMap();
const defaultFormat = (n) => Math.round(n).toLocaleString('de-DE');

/**
 * Zählt el.textContent von from nach to.
 * opts: {duration (Spiel-ms; Standard 300 + 250·log10(|Δ|)), onTick(stepIndex, progress, value) – höchstens alle
 *        35 ms Echtzeit und nur bei sichtbarer Wertänderung, format(n) → String, pop=true (1,25 → 1),
 *        juice=0 (statt Pop: juice-Stärke), easing=easeOutExpo}
 * → Promise (Ende). Ein neuer Aufruf auf demselben Element bricht den alten ab (springt auf dessen Ziel).
 */
export function tickNumber(el, from, to, opts = {}) {
  if (!el) return Promise.resolve();
  const fmt = opts.format || defaultFormat;
  const prev = running.get(el);
  if (prev) prev.cancel();
  const delta = Math.abs(to - from);
  const duration = opts.duration != null ? opts.duration : 300 + 250 * Math.log10(Math.max(1, delta));
  let step = 0;
  let lastTickReal = -1e9;
  let lastShown = fmt(from);
  el.textContent = lastShown;
  const ez = opts.easing || ease.outExpo;
  const tw = time.tween(duration, (e) => {
    const v = from + (to - from) * e;
    const s = fmt(e >= 1 ? to : v);
    if (s !== lastShown) {
      el.textContent = s;
      lastShown = s;
      const now = time.realNow();
      if (opts.onTick && now - lastTickReal >= 35) {
        lastTickReal = now;
        opts.onTick(step++, e, v);
      }
    }
  }, { ease: ez });
  const p = tw.then(() => {
    if (running.get(el) !== handle) return;
    running.delete(el);
    el.textContent = fmt(to);
    if (opts.juice) juice(el, opts.juice);
    else if (opts.pop !== false) pop(el, 1.25, 160);
  });
  const handle = { cancel: () => { tw.cancel(); el.textContent = fmt(to); running.delete(el); } };
  running.set(el, handle);
  return p;
}

export default tickNumber;
