// Trauma-Shake (Eiserloh, GDC 2016): offset = max · trauma² · glattes Rauschen. Plus gerichteter Kick (Feder).
// Wirkt per transform auf ein Wurzel-Element (Standard #app). Wenn ruhig, wird transform wieder entfernt
// (sonst wäre #app dauerhaft Containing-Block für position:fixed-Kinder).

import { time } from './time.js';
import { Spring } from './springs.js';

const MAX_OFFSET = 10;   // px
const MAX_ANGLE = 2;     // Grad
const FREQ = 20;         // Hz-ähnlich (Rausch-Zeitskala)
const DECAY = 1.2;       // Trauma / s

// glattes Rauschen aus drei Sinus mit irrationalen Frequenzen, ≈ [-1, 1]
const noise = (t, seed) =>
  Math.sin(t * 1.0 + seed * 12.9898) * 0.5 +
  Math.sin(t * 2.31 + 1.7 + seed * 7.233) * 0.3 +
  Math.sin(t * 4.77 + 3.1 + seed * 3.917) * 0.2;

let root = null;
let trauma = 0;
let t = 0;
let off = null;
const kx = new Spring(0, { k: 400, damp: 0.72 });
const ky = new Spring(0, { k: 400, damp: 0.72 });

function getRoot() {
  if (!root && typeof document !== 'undefined') root = document.getElementById('app');
  return root;
}

function loop() {
  if (off) return;
  off = time.onFrame((dt, realDt) => {
    const el = getRoot();
    // läuft in Echtzeit (Spieltempo soll das Wackeln nicht hektischer machen); Hitstop friert es mit ein
    const d = time.frozen ? 0 : realDt;
    t += d * FREQ;
    trauma = Math.max(0, trauma - DECAY * d);
    kx.step(d); ky.step(d);
    const str = time.reducedMotion ? 0 : shake.strength;
    const s = trauma * trauma * str;
    const x = MAX_OFFSET * s * noise(t, 1) + kx.value * (time.reducedMotion ? 0.25 : str || 0);
    const y = MAX_OFFSET * s * noise(t, 2) + ky.value * (time.reducedMotion ? 0.25 : str || 0);
    const a = MAX_ANGLE * s * noise(t, 3);
    const idle = trauma <= 0 && kx.settled && ky.settled;
    if (el) {
      el.style.transform = idle ? '' : `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${a.toFixed(3)}deg)`;
    }
    if (idle) { kx.snap(0); ky.snap(0); off(); off = null; }
  });
}

export const shake = {
  /** Einstellung Bildschirmwackeln 0 | 0.5 | 1 */
  strength: 1,
  /** Wurzel-Element setzen (Standard: #app) */
  setRoot(el) { if (root && root !== el) root.style.transform = ''; root = el; },
  /** Trauma hinzufügen (0.08 Würfel-Landung, 0.15 Multi, 0.3 ×Multi …), geklemmt auf 1 */
  add(amount = 0.2) {
    trauma = Math.min(1, trauma + amount);
    loop();
  },
  /** gerichteter Stoß in px (z. B. entgegen der Ereignisrichtung), federt in ~200 ms zurück */
  kick(dx = 0, dy = 6) {
    kx.vel += dx * 22; ky.vel += dy * 22;
    loop();
  },
  get trauma() { return trauma; },
  /** sofort beruhigen */
  reset() { trauma = 0; kx.snap(0); ky.snap(0); const el = getRoot(); if (el) el.style.transform = ''; },
};

export default shake;
