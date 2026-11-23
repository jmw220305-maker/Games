// Federn + Transform-Ebenen.
//
// Mehrere Effekte (Feder-Position, juice, squash, Neigung, Schweben, Drücken …) wirken gleichzeitig auf dasselbe
// Element. Damit sie sich nicht überschreiben, schreibt jeder Effekt in eine eigene „Ebene“ (layer); am Ende jedes
// Frames wird pro Element EIN transform zusammengesetzt (nur transform, keine Layout-Lesezugriffe).
//
// Hinweis für die UI: Elemente, die fx-Effekte bekommen, sollten ihr transform nicht selbst per CSS setzen
// (stattdessen ein Wrapper-Element verwenden).

import { time } from './time.js';

export class Spring {
  /** k = Steifigkeit (1/s²), damp = Dämpfung je 60-Hz-Frame (0.70–0.82 = leichter Überschwinger) */
  constructor(value = 0, { k = 220, damp = 0.78 } = {}) {
    this.value = value;
    this.target = value;
    this.vel = 0;
    this.k = k;
    this.damp = damp;
  }
  step(dt) {
    if (dt <= 0) return this.value;
    // in kleinen Teilschritten integrieren (stabil auch bei 4× Tempo)
    let rem = Math.min(dt, 0.1);
    while (rem > 0) {
      const h = Math.min(rem, 1 / 120);
      this.vel += (this.target - this.value) * this.k * h;
      this.vel *= Math.pow(this.damp, h * 60);
      this.value += this.vel * h;
      rem -= h;
    }
    return this.value;
  }
  get settled() { return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.vel) < 0.01; }
  snap(v = this.target) { this.value = this.target = v; this.vel = 0; }
}

// ---------------------------------------------------------------- Transform-Ebenen
const states = new WeakMap();
const dirty = new Set();

function getState(el) {
  let st = states.get(el);
  if (!st) { st = { el, layers: new Map(), perspective: 0 }; states.set(el, st); }
  return st;
}

/** Ebene setzen: vals = {x, y, z, rot, rx, ry, scale, sx, sy} (px / deg). null löscht die Ebene. */
export function setLayer(el, name, vals) {
  const st = getState(el);
  if (vals == null) st.layers.delete(name);
  else st.layers.set(name, vals);
  dirty.add(st);
}
export function getLayer(el, name) { const st = states.get(el); return st ? st.layers.get(name) : undefined; }
export function clearLayer(el, name) { setLayer(el, name, null); }
/** Perspektive (px) für Ebenen mit rx/ry (z. B. Karten-Neigung). */
export function setPerspective(el, px) { getState(el).perspective = px; }

function compose(st) {
  let x = 0, y = 0, z = 0, rot = 0, rx = 0, ry = 0, sx = 1, sy = 1;
  for (const l of st.layers.values()) {
    if (l.x) x += l.x;
    if (l.y) y += l.y;
    if (l.z) z += l.z;
    if (l.rot) rot += l.rot;
    if (l.rx) rx += l.rx;
    if (l.ry) ry += l.ry;
    if (l.scale != null) { sx *= l.scale; sy *= l.scale; }
    if (l.sx != null) sx *= l.sx;
    if (l.sy != null) sy *= l.sy;
  }
  const f = (n) => Math.round(n * 1000) / 1000;
  let s = '';
  if ((rx || ry) && st.perspective) s += `perspective(${st.perspective}px) `;
  if (x || y || z) s += `translate3d(${f(x)}px,${f(y)}px,${f(z)}px) `;
  if (rx) s += `rotateX(${f(rx)}deg) `;
  if (ry) s += `rotateY(${f(ry)}deg) `;
  if (rot) s += `rotate(${f(rot)}deg) `;
  if (sx !== 1 || sy !== 1) s += `scale(${f(sx)},${f(sy)})`;
  return s.trim();
}

time.afterFrame(() => {
  if (!dirty.size) return;
  for (const st of dirty) {
    const t = compose(st);
    if (st.last !== t) { st.el.style.transform = t; st.last = t; }
  }
  dirty.clear();
});

/**
 * Element per Federn an ein Ziel bewegen: props {x, y, rot, scale}. Mehrfach aufrufbar (ändert nur Ziele).
 * opts: {k, damp, layer='spring', snap:false}. Gibt Promise zurück, das beim Einschwingen erfüllt wird.
 */
const springSets = new WeakMap();
export function springTo(el, props, opts = {}) {
  const layer = opts.layer || 'spring';
  let set = springSets.get(el);
  if (!set) { set = new Map(); springSets.set(el, set); }
  let entry = set.get(layer);
  if (!entry) {
    entry = { springs: {}, off: null, waiters: [] };
    set.set(layer, entry);
  }
  for (const key of Object.keys(props)) {
    const def = key === 'scale' ? 1 : 0;
    let sp = entry.springs[key];
    if (!sp) sp = entry.springs[key] = new Spring(def, opts);
    if (opts.k) sp.k = opts.k;
    if (opts.damp) sp.damp = opts.damp;
    sp.target = props[key];
    if (opts.snap || (time.reducedMotion && opts.reducedSnap !== false && key !== 'scale')) sp.snap(props[key]);
  }
  const p = new Promise((resolve) => entry.waiters.push(resolve));
  if (!entry.off) {
    entry.off = time.onFrame((dt) => {
      const vals = {};
      let settled = true;
      for (const [key, sp] of Object.entries(entry.springs)) {
        vals[key] = sp.step(dt);
        if (!sp.settled) settled = false;
      }
      if (settled) {
        for (const sp of Object.values(entry.springs)) sp.snap();
        for (const [key, sp] of Object.entries(entry.springs)) vals[key] = sp.value;
      }
      setLayer(el, layer, vals);
      if (settled) {
        entry.off(); entry.off = null;
        const w = entry.waiters; entry.waiters = [];
        w.forEach((r) => r());
      }
    });
  }
  return p;
}
