// juice_up & Freunde (research_feel §1.1, §1.3, §2.4). Alles über Transform-Ebenen (springs.js).

import { time } from './time.js';
import { Spring, setLayer, setPerspective } from './springs.js';

const active = new WeakMap(); // el → {layer: cancel}

function run(el, layer, fn) {
  let map = active.get(el);
  if (!map) { map = {}; active.set(el, map); }
  if (map[layer]) map[layer]();
  let off = null;
  const p = new Promise((resolve) => {
    const start = time.now();
    off = time.onFrame(() => {
      const t = (time.now() - start) / 1000;
      const vals = fn(t);
      if (vals === null) { setLayer(el, layer, null); stop(); resolve(); return; }
      setLayer(el, layer, vals);
    });
    function stop() { off(); if (map[layer] === cancel) delete map[layer]; }
    const cancel = () => { stop(); setLayer(el, layer, null); resolve(); };
    map[layer] = cancel;
  });
  return p;
}

/**
 * juice_up: Wackel-Skalierung + Rotation, 0,4 s, kubisch abklingend.
 * amount 0.1 (kleine UI) … 0.3 (Würfel/Karten) … 0.6 (riesig). opts: {rot: Grad-Maximum, dur: s}
 */
export function juice(el, amount = 0.3, opts = {}) {
  if (!el) return Promise.resolve();
  const dur = opts.dur || 0.4;
  const A = amount * 0.6;                    // Skalierungsamplitude
  let R = opts.rot != null ? opts.rot : amount * 22; // Grad
  R *= Math.random() < 0.5 ? -1 : 1;
  const reduced = time.reducedMotion;
  return run(el, 'juice', (t) => {
    if (t >= dur) return null;
    const k = Math.max(0, 1 - t / dur);
    const dip = -0.6 * A * Math.exp(-t * 22);            // Antizipations-Delle, federt sofort zurück
    const s = 1 + dip + A * Math.sin(50.8 * t) * k * k * k * (reduced ? 0.4 : 1);
    const rot = reduced ? 0 : R * Math.sin(40.8 * t) * k * k;
    return { scale: s, rot };
  });
}

/** Squash & Stretch mit Volumenerhalt, federt mit Überschwinger zurück. s>0 = breit/flach. */
export function squash(el, s = 0.2, ms = 90) {
  if (!el) return Promise.resolve();
  const dur = (ms / 1000) * 3.2;
  const w = Math.PI / (ms / 1000) * 0.5;
  return run(el, 'squash', (t) => {
    if (t >= dur) return null;
    const v = s * Math.exp(-t / (ms / 1000) * 1.1) * Math.cos(w * t);
    return { sx: 1 + v, sy: 1 / (1 + v) };
  });
}

/** Kurzes horizontales Kopfschütteln (z. B. „zu wenig Geld“): ±px, cycles, ms. */
export function nope(el, px = 6, cycles = 3, ms = 240) {
  if (!el) return Promise.resolve();
  const dur = ms / 1000;
  return run(el, 'nope', (t) => {
    if (t >= dur) return null;
    const k = 1 - t / dur;
    return { x: px * k * Math.sin((t / dur) * cycles * Math.PI * 2) * (time.reducedMotion ? 0.3 : 1) };
  });
}

/** Kleines Zittern (gehaltene Würfel „widerstehen“ dem Wurf): ±px für ms. */
export function jitter(el, px = 2, ms = 110) {
  if (!el) return Promise.resolve();
  const dur = ms / 1000;
  return run(el, 'jitter', (t) => {
    if (t >= dur) return null;
    const k = 1 - t / dur;
    return { x: Math.sin(t * 190) * px * k, y: Math.cos(t * 150) * px * 0.4 * k };
  });
}

/** Einblenden mit Überschwinger: scale 0→1 (easeOutBack). */
export function popIn(el, ms = 260, delay = 0) {
  if (!el) return Promise.resolve();
  const d = ms / 1000;
  const dl = delay / 1000;
  const p = run(el, 'pop', (t) => {
    const u = (t - dl) / d;
    if (u >= 1) return null;
    if (u < 0) return { scale: 0 };
    const c1 = 1.70158, c3 = c1 + 1;
    return { scale: Math.max(0, 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2)) };
  });
  setLayer(el, 'pop', { scale: 0 });
  return p;
}

/** Schluss-Pop: scale from→1 (Zahlen, Beträge). */
export function pop(el, from = 1.25, ms = 160) {
  if (!el) return Promise.resolve();
  const d = ms / 1000;
  return run(el, 'pop', (t) => {
    const u = t / d;
    if (u >= 1) return null;
    return { scale: 1 + (from - 1) * Math.pow(1 - u, 2) };
  });
}

const hoverOK = () => { try { return matchMedia('(hover: hover)').matches; } catch { return false; } };

/**
 * 3D-Neigung zum Zeiger + Anheben + Glanz. Setzt CSS-Variablen --fx-mx/--fx-my (0..1) und --fx-glare (0..1) für
 * ein Glanz-Element (Klasse .fx-sheen im Element, siehe style.css). Gibt detach() zurück. Nur bei (hover: hover).
 */
export function hoverTilt(el, { maxDeg = 12, lift = 10, scale = 1.05, perspective = 600 } = {}) {
  if (!el || !hoverOK()) return () => {};
  setPerspective(el, perspective);
  const rx = new Spring(0, { k: 260, damp: 0.74 });
  const ry = new Spring(0, { k: 260, damp: 0.74 });
  const ly = new Spring(0, { k: 300, damp: 0.72 });
  const sc = new Spring(1, { k: 300, damp: 0.72 });
  let off = null;
  let rect = null;
  const loop = () => {
    if (off) return;
    off = time.onFrame((_, realDt) => {
      const d = realDt; // Hover unabhängig vom Spieltempo
      rx.step(d); ry.step(d); ly.step(d); sc.step(d);
      const red = time.reducedMotion;
      setLayer(el, 'tilt', { rx: red ? 0 : rx.value, ry: red ? 0 : ry.value, y: ly.value, scale: sc.value });
      if (rx.settled && ry.settled && ly.settled && sc.settled && !inside) {
        off(); off = null; setLayer(el, 'tilt', null);
      }
    });
  };
  let inside = false;
  // Stabile Trefferfläche: das Anheben verschiebt das Element; ::before (.fx-hover) füllt die alte Fläche auf,
  // damit der Zeiger am unteren Rand nicht „herausfällt“ (Flackern, verlorene Klicks).
  el.style.setProperty('--fx-lift', `${lift + 6}px`);
  const enter = () => { inside = true; rect = el.getBoundingClientRect(); ly.target = -lift; sc.target = scale; el.style.setProperty('--fx-glare', '1'); el.classList.add('fx-hover'); loop(); };
  const move = (e) => {
    if (!rect) rect = el.getBoundingClientRect();
    const mx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const my = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    rx.target = -(my - 0.5) * 2 * maxDeg;
    ry.target = (mx - 0.5) * 2 * maxDeg;
    el.style.setProperty('--fx-mx', (1 - mx).toFixed(3));
    el.style.setProperty('--fx-my', (1 - my).toFixed(3));
    loop();
  };
  const leave = () => { inside = false; rect = null; rx.target = ry.target = ly.target = 0; sc.target = 1; el.style.setProperty('--fx-glare', '0'); el.classList.remove('fx-hover'); loop(); };
  el.addEventListener('pointerenter', enter);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  return () => {
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave);
    if (off) { off(); off = null; }
    setLayer(el, 'tilt', null);
  };
}

/** Leichtes Schweben/Schaukeln (±1,5°, ±2 px, Periode 4–7 s). Gibt stop() zurück. */
export function idleSway(el, seed = Math.random() * 1000, { deg = 1.5, px = 2 } = {}) {
  if (!el) return () => {};
  const ph = (seed * 2.399) % (Math.PI * 2);
  const f1 = 1.0 + ((seed * 0.37) % 0.4);
  const f2 = 0.8 + ((seed * 0.53) % 0.4);
  const off = time.onFrame(() => {
    if (time.reducedMotion) { setLayer(el, 'sway', null); return; }
    const t = time.realNow() / 1000;
    setLayer(el, 'sway', { rot: Math.sin(t * f1 + ph) * deg, y: Math.sin(t * f2 + ph * 1.7) * px });
  });
  return () => { off(); setLayer(el, 'sway', null); };
}

/** Knopf-Gefühl: drücken 0,94 (60 ms), loslassen → Überschwinger 1,04 → 1. Gibt detach() zurück. */
export function pressable(el, { down = 0.94 } = {}) {
  if (!el) return () => {};
  const sp = new Spring(1, { k: 520, damp: 0.7 });
  let off = null;
  const loop = () => {
    if (off) return;
    off = time.onFrame((_, realDt) => {
      sp.step(realDt);
      setLayer(el, 'press', { scale: sp.value });
      if (sp.settled && sp.target === 1) { off(); off = null; setLayer(el, 'press', null); }
    });
  };
  const pd = () => { sp.target = down; sp.vel = -2; loop(); };
  const pu = () => { if (sp.target !== 1) { sp.target = 1; sp.vel = 3.5; loop(); } };
  el.addEventListener('pointerdown', pd);
  el.addEventListener('pointerup', pu);
  el.addEventListener('pointerleave', pu);
  el.addEventListener('pointercancel', pu);
  return () => {
    el.removeEventListener('pointerdown', pd);
    el.removeEventListener('pointerup', pu);
    el.removeEventListener('pointerleave', pu);
    el.removeEventListener('pointercancel', pu);
    if (off) { off(); off = null; }
    setLayer(el, 'press', null);
  };
}
