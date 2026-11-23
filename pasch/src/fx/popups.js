// DOM-Popups über allem: „+30“-Zahlen, Banner, Blitz, chromatische Aberration.
// Ein gemeinsamer Layer #fx-layer (position:fixed, pointer-events:none, z-index 60).

import { time, ease } from './time.js';
import { setLayer } from './springs.js';
import { shake } from './shake.js';

let layer = null;
function getLayer() {
  if (layer && layer.isConnected) return layer;
  layer = document.getElementById('fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

const PREFIX = { chips: '+', mult: '+', xmult: '×', money: '$', info: '' };

/**
 * „+X“-Popup an (x, y) Viewport-px (Mittelpunkt). text: Zahl oder String (Zahlen bekommen automatisch Präfix
 * je kind: chips „+30“, mult „+4“, xmult „×2“, money „$3“). opts: {kind, big, hold=500, rise=24, dx}
 * → Promise (wenn entfernt).
 */
export function popup(x, y, text, opts = {}) {
  const kind = opts.kind || 'info';
  let str = text;
  if (typeof text === 'number') {
    const n = Math.abs(text) >= 1000 ? text.toLocaleString('de-DE') : String(text).replace('.', ',');
    str = kind === 'money' && text < 0 ? `-$${-text}` : (text < 0 && kind !== 'xmult' ? n : PREFIX[kind] + n);
  }
  const el = document.createElement('div');
  el.className = `fx-popup fx-popup--${kind}${opts.big ? ' fx-popup--big' : ''}`;
  el.textContent = str;
  const jx = opts.dx != null ? opts.dx : (Math.random() - 0.5) * 12;
  el.style.left = `${x + jx}px`;
  el.style.top = `${y}px`;
  getLayer().appendChild(el);
  const rise = opts.rise != null ? opts.rise : 24;
  const hold = opts.hold != null ? opts.hold : 500;
  const tIn = 180, tOut = 200;
  const total = tIn + hold + tOut;
  const rot = (Math.random() - 0.5) * (time.reducedMotion ? 0 : 10);
  setLayer(el, 'p', { scale: 0 });
  return time.tween(total, (_, r) => {
    const ms = r * total;
    let s, y2, o = 1;
    if (ms < tIn) {
      const u = ms / tIn;
      // 0 → 1.25 → 1 (easeOutBack-artig)
      s = u < 0.6 ? ease.outCubic(u / 0.6) * 1.25 : 1.25 - 0.25 * ease.outQuad((u - 0.6) / 0.4);
      y2 = -rise * 0.5 * ease.outCubic(u);
    } else {
      const u = (ms - tIn) / (hold + tOut);
      s = 1;
      y2 = -rise * 0.5 - rise * 0.5 * ease.outQuad(u);
      if (ms > tIn + hold) o = 1 - (ms - tIn - hold) / tOut;
    }
    setLayer(el, 'p', { y: y2, scale: s, rot: rot * (1 - Math.min(1, ms / tIn)) });
    el.style.opacity = o.toFixed(3);
  }).then(() => el.remove());
}

/**
 * Großes Banner (Handname, „Partie gewonnen!“ …) über die Bildschirmbreite; Text springt mit easeOutBack.
 * opts: {kind:'hand'|'chips'|'mult'|'xmult'|'money'|'win'|'lose'|'warden'|'info', sub, hold=900, y (0..1 Höhe)}
 * → Promise (wenn verschwunden)
 */
export function banner(text, opts = {}) {
  const kind = opts.kind || 'hand';
  const el = document.createElement('div');
  el.className = `fx-banner fx-banner--${kind}`;
  el.style.top = `${(opts.y != null ? opts.y : 0.36) * 100}%`;
  const band = document.createElement('div');
  band.className = 'fx-banner-band';
  const t = document.createElement('div');
  t.className = 'fx-banner-text';
  t.textContent = text;
  el.appendChild(band);
  el.appendChild(t);
  let s = null;
  if (opts.sub) {
    s = document.createElement('div');
    s.className = 'fx-banner-sub';
    s.textContent = opts.sub;
    el.appendChild(s);
  }
  getLayer().appendChild(el);
  const hold = opts.hold != null ? opts.hold : 900;
  const tIn = 260, tOut = 220, total = tIn + hold + tOut;
  setLayer(t, 'b', { scale: 0 });
  setLayer(band, 'b', { sy: 0 });
  if (s) s.style.opacity = '0';
  return time.tween(total, (_, r) => {
    const ms = r * total;
    if (ms < tIn) {
      const u = ms / tIn;
      setLayer(band, 'b', { sy: ease.outCubic(Math.min(1, u * 1.6)) });
      setLayer(t, 'b', { scale: ease.outBack(u), rot: (1 - u) * -6 });
      if (s) s.style.opacity = String(Math.max(0, u * 2 - 1));
    } else if (ms < tIn + hold) {
      const u = (ms - tIn) / hold;
      setLayer(band, 'b', { sy: 1 });
      setLayer(t, 'b', { scale: 1 + Math.sin(u * Math.PI) * 0.03 });
      if (s) s.style.opacity = '1';
    } else {
      const u = (ms - tIn - hold) / tOut;
      setLayer(band, 'b', { sy: 1 - ease.outCubic(u) });
      setLayer(t, 'b', { scale: 1 + u * 0.15, x: 0 });
      el.style.opacity = String(1 - u);
    }
  }).then(() => el.remove());
}

let flashEl = null;
let flashTween = null;
/** Vollbild-Blitz: Farbe, Start-Deckkraft, Abklingzeit (ms). Reduzierte Bewegung/Blitze aus → abgeschwächt/aus. */
export function flash(color = '#ffffff', alpha = 0.25, ms = 150) {
  if (!time.flashes) return Promise.resolve();
  if (time.reducedMotion) alpha *= 0.3;
  if (!flashEl || !flashEl.isConnected) {
    flashEl = document.createElement('div');
    flashEl.className = 'fx-flash';
    getLayer().appendChild(flashEl);
  }
  flashEl.style.background = color;
  if (flashTween) flashTween.cancel();
  flashEl.style.opacity = String(alpha);
  flashTween = time.tween(ms, (e) => { flashEl.style.opacity = (alpha * (1 - e)).toFixed(3); }, { ease: ease.outQuad });
  return flashTween;
}

/**
 * Chromatische Aberration: Rot/Cyan-Versatz für ms auf el (Standard: Shake-Wurzel #app).
 * Nutzt CSS-Klasse .fx-chroma (filter: drop-shadow) – nur kurz aktiv.
 */
const chromaTimers = new WeakMap();
export function chroma(ms = 120, el) {
  if (time.reducedMotion || !time.flashes) return Promise.resolve();
  const target = el || document.getElementById('app') || document.body;
  target.classList.add('fx-chroma');
  const prev = chromaTimers.get(target);
  if (prev) prev.cancel();
  const tw = time.tween(ms, () => {});
  chromaTimers.set(target, tw);
  return tw.then(() => { if (chromaTimers.get(target) === tw) target.classList.remove('fx-chroma'); });
}

/** Bequem: großer Treffer (×Multi): Hitstop + Chroma + Trauma + Blitz. */
export function bigHit({ hitstop = 60, trauma = 0.3, flashAlpha = 0.12 } = {}) {
  time.hitstop(hitstop);
  chroma(120);
  shake.add(trauma);
  if (flashAlpha) flash('#fff6e0', flashAlpha, 120);
}
