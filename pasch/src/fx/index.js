// Sammel-Einstieg für die fx-Bausteine (optional; Einzelimporte gehen genauso).
export { time, ease } from './time.js';
export { Spring, springTo, setLayer, clearLayer, getLayer, setPerspective } from './springs.js';
export { juice, squash, nope, jitter, popIn, pop, hoverTilt, idleSway, pressable } from './juice.js';
export { shake } from './shake.js';
export { particles } from './particles.js';
export { popup, banner, flash, chroma, bigHit } from './popups.js';
export { tickNumber } from './ticker.js';
export { background, PALETTES } from './background.js';
export { setFlames, clearFlames, flameIntensity } from './flames.js';

import { time } from './time.js';
import { shake } from './shake.js';
import { particles } from './particles.js';
import { background } from './background.js';

/**
 * Einmal beim Start: Wurzel für Shake, Canvas #fx für Partikel, Canvas #bg für den Wirbel.
 * opts: {root=#app, fxCanvas=#fx, bgCanvas=#bg, palette='menu', reducedMotion, crt}
 */
export function initFx(opts = {}) {
  const root = opts.root || document.getElementById('app');
  if (root) shake.setRoot(root);
  const fxc = opts.fxCanvas || document.getElementById('fx');
  if (fxc) particles.init(fxc);
  background.init(opts.bgCanvas || document.getElementById('bg'));
  background.setPalette(opts.palette || 'menu', true);
  if (opts.reducedMotion != null) time.reducedMotion = opts.reducedMotion;
  else time.reducedMotion = time.reducedMotion; // Body-Klasse synchronisieren
  if (opts.crt != null) setCRT(opts.crt);
}

/** CRT-Overlay (Scanlines + Vignette) an/aus: Klasse body.crt */
export function setCRT(on) { document.body.classList.toggle('crt', !!on); }
