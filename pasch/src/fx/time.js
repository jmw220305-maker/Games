// Zentrale Uhr: EINE requestAnimationFrame-Schleife für alle Effekte.
//
// Zwei Uhren:
//  - Spieluhr  time.now()      ms, läuft mit speed (× 8 beim Überspringen), steht während Hitstop still.
//                              Alle Animationsdauern (wait, tween, juice, Würfelwurf …) laufen auf dieser Uhr,
//                              d. h. speed skaliert automatisch alle Dauern.
//  - Echtzeit  time.realNow()  ms, für Dinge, die nicht vom Spieltempo abhängen (Hintergrund, Shake-Abklingen).
// Versteckter Tab: rAF pausiert → alles steht; beim Zurückkehren wird dt gekappt (kein Sprung).

const MAX_DT = 1 / 20; // s – längere Frames werden gekappt (Tab-Wechsel, Ruckler)

const subs = new Set();       // fn(dt, realDt) – dt = Spiel-dt in s (0 während Hitstop)
const after = new Set();      // fn() – nach allen Subscribern (Transform-Flush)
let waits = [];               // {at, resolve}
let gameNow = 0;
let realNow = 0;
let hitstopUntil = 0;         // Echtzeit-ms
let lastTs = 0;
let running = false;
let reduced = false;

try {
  reduced = !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
} catch { /* ignore */ }

function syncBodyClass() {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('fx-reduced', reduced);
}

export const time = {
  /** Spielgeschwindigkeit 0.5 | 1 | 2 | 4 */
  speed: 1,
  /** Tippen beim Werten: Spieluhr läuft zusätzlich × skipFactor */
  skipping: false,
  skipFactor: 8,
  /** Blitze erlaubt (Einstellung „Blitze an/aus“) */
  flashes: true,
  get reducedMotion() { return reduced; },
  set reducedMotion(v) { reduced = !!v; syncBodyClass(); },
  /** Spiel-dt des aktuellen Frames (s) */
  dt: 0,
  /** Echtzeit-dt des aktuellen Frames (s) */
  realDt: 0,
  frame: 0,
  now() { return gameNow; },
  realNow() { return realNow; },
  /** effektiver Faktor Spieluhr/Echtzeit */
  get rate() { return this.speed * (this.skipping ? this.skipFactor : 1); },
  /** Dauer in Spiel-ms → Echtzeit-ms (zum Planen von Sounds o. ä.) */
  toReal(ms) { return ms / this.rate; },
  get frozen() { return realNow < hitstopUntil; },

  /** Animationsuhr für ms (Echtzeit, ÷ speed) anhalten. Überlappende Hitstops verlängern nur. */
  hitstop(ms = 50) {
    if (this.skipping) return;
    const d = ms / Math.max(1, Math.sqrt(this.speed));
    hitstopUntil = Math.max(hitstopUntil, realNow + d);
    ensure();
  },

  /** Promise, das nach ms Spieluhr erfüllt wird (also ÷ speed, + Hitstops). */
  wait(ms = 0) {
    ensure();
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => { waits.push({ at: gameNow + ms, resolve }); });
  },

  /** fn(dt, realDt) jeden Frame. Gibt unsubscribe zurück. */
  onFrame(fn) { subs.add(fn); ensure(); return () => subs.delete(fn); },
  /** fn() nach allen onFrame-Callbacks (intern: Transform-Flush). */
  afterFrame(fn) { after.add(fn); ensure(); return () => after.delete(fn); },

  /**
   * Tween auf der Spieluhr: fn(easedProgress, rawProgress) jeden Frame, Promise am Ende.
   * opts: {ease, delay}. Gibt Promise mit .cancel() zurück.
   */
  tween(ms, fn, opts = {}) {
    const easeFn = opts.ease || ease.linear;
    const start = gameNow + (opts.delay || 0);
    let off;
    let done;
    const p = new Promise((resolve) => {
      done = resolve;
      if (ms <= 0) { fn(1, 1); resolve(); return; }
      off = this.onFrame(() => {
        const raw = (gameNow - start) / ms;
        if (raw < 0) return;
        const r = raw >= 1 ? 1 : raw;
        fn(easeFn(r), r);
        if (r >= 1) { off(); resolve(); }
      });
    });
    p.cancel = () => { if (off) off(); done && done(); };
    return p;
  },
};

export const ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
};

function tick(ts) {
  if (!lastTs) lastTs = ts;
  let realDt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (realDt > MAX_DT) realDt = MAX_DT;
  if (realDt < 0) realDt = 0;
  realNow += realDt * 1000;
  const frozen = realNow < hitstopUntil;
  const dt = frozen ? 0 : realDt * time.rate;
  gameNow += dt * 1000;
  time.dt = dt;
  time.realDt = realDt;
  time.frame++;

  for (const fn of [...subs]) {
    try { fn(dt, realDt); } catch (e) { console.error(e); subs.delete(fn); }
  }
  if (waits.length) {
    const still = [];
    for (const w of waits) { if (w.at <= gameNow) w.resolve(); else still.push(w); }
    waits = still;
  }
  for (const fn of after) {
    try { fn(); } catch (e) { console.error(e); }
  }
  if (subs.size || waits.length || after.size) requestAnimationFrame(tick);
  else { running = false; lastTs = 0; }
}

function ensure() {
  if (running || typeof requestAnimationFrame !== 'function') return;
  running = true;
  lastTs = 0;
  requestAnimationFrame(tick);
}

if (typeof document !== 'undefined') {
  // nach Rückkehr in den Tab keinen Riesen-Frame erzeugen
  document.addEventListener('visibilitychange', () => { lastTs = 0; });
  if (document.body) syncBodyClass();
  else document.addEventListener('DOMContentLoaded', syncBodyClass, { once: true });
}

export default time;
