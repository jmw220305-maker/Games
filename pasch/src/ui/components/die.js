// Echter CSS-3D-Würfel (preserve-3d, 6 Seiten) mit Wurf-Choreografie nach research_feel §3.
//
// Aufbau (jede Ebene hat genau EINEN Schreiber):
//   .die                 Wurzel: perspective, Klickfläche; transform über fx/springs-Ebenen (juice, press)
//     .die-shadow        Boden-Schatten (Ellipse) – folgt der Höhe
//     .die-air           Höhe (Bogen, Bounces, Halten, Rütteln)               ← render()
//       .die-squash      Squash & Stretch (Ursprung unten)                     ← render()
//         .die-tilt      Blickwinkel + Hover-Neigung                           ← render()
//           .die-cube    Würfelrotation (akkumulierte Winkel)                  ← render()
//             .die-core ×3   Innenkern (füllt die abgerundeten Ecken)
//             .die-face ×6   Seiten (Inhalt wird gemalt; .die-shade = Licht je Frame)
//       .die-badge       Fessel/Schwächung (vor dem Würfel)
//
// Seiten (lokal): 0 vorne(+z) 1 hinten 2 rechts(+x) 3 links 4 oben(−y) 5 unten.
// Der Würfel hat individuelle Flächen (W4/W6/W8 mit Werten + Prägungen): beim Wurf wird die Zielfläche auf eine
// gerade VERDECKTE Seite gemalt, und genau diese Seite dreht sich nach vorne. Die anderen verdeckten Seiten
// bekommen andere Flächen desselben Würfels.

import { time, ease } from '../../fx/time.js';
import { Spring } from '../../fx/springs.js';
import { juice as juiceFx, pressable } from '../../fx/juice.js';
import { shake } from '../../fx/shake.js';
import { particles } from '../../fx/particles.js';

const D2R = Math.PI / 180;
const BASE = [[0, 0], [0, 180], [0, -90], [0, 90], [-90, 0], [90, 0]]; // (rx, ry) bringt Seite s nach vorne
const NORMALS = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0]];
const VIEW_TX = -17; // Blickwinkel: Oberseite …
const VIEW_TY = 19;  // … und linke Seite sichtbar
const LIGHT = norm([-0.45, -0.8, 0.62]);

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
const rotX = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; };
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
const rotZ = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; };
/** Weltnormale einer lokalen Seite bei Würfelwinkeln (ohne Blickwinkel) */
const worldN = (s, rx, ry, rz) => rotZ(rotX(rotY(NORMALS[s], ry * D2R), rx * D2R), rz * D2R);

// Augenpositionen (Prozent): l/c/r × t/m/b
const P = { l: 26, c: 50, r: 74 };
const PIPS = {
  1: [['c', 'c']],
  2: [['l', 'l'], ['r', 'r']],
  3: [['l', 'l'], ['c', 'c'], ['r', 'r']],
  4: [['l', 'l'], ['r', 'l'], ['l', 'r'], ['r', 'r']],
  5: [['l', 'l'], ['r', 'l'], ['c', 'c'], ['l', 'r'], ['r', 'r']],
  6: [['l', 'l'], ['l', 'c'], ['l', 'r'], ['r', 'l'], ['r', 'c'], ['r', 'r']],
};

const rnd = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rnd(a, b + 1));

function faceHTML(face, sides, hidden) {
  if (hidden) return { cls: 'is-hidden', html: '<span class="die-glyph die-q">?</span>' };
  const v = face ? face.v | 0 : 0;
  const mark = face && face.mark ? face.mark : null;
  let cls = mark ? `mk-${mark}` : '';
  let html = '';
  if (mark === 'stone') {
    cls += ' is-stone';
    html = '<span class="die-stone-specks"></span>';
  } else if (mark === 'star') {
    cls += ' is-star';
    html = '<span class="die-glyph die-star">✦</span>';
    if (v > 0) html += `<span class="die-corner">${v}</span>`;
  } else if (v <= 0) {
    cls += ' is-blank';
    html = '<span class="die-scratch"></span>';
  } else if (sides !== 6 || v > 6) {
    cls += ' is-num';
    html = `<span class="die-glyph die-num">${v}</span><span class="die-kind">W${sides}</span>`;
  } else {
    html = PIPS[v].map(([x, y]) => `<i class="pip" style="left:${P[x]}%;top:${P[y]}%"></i>`).join('');
  }
  if (mark === 'clover') html += '<span class="die-corner die-clover">♣</span>';
  if (mark === 'gold' || mark === 'star' || mark === 'glass') html += '<span class="die-sheen"></span>';
  return { cls, html };
}

const hoverCapable = () => { try { return matchMedia('(hover: hover)').matches; } catch { return false; } };

/**
 * Würfel-Komponente.
 * @param {object} dieData  Die = {id, sides, faces:[{v, mark}], material}
 * @param {object} [opts]   {value, faceIndex, hidden, index}
 */
export function createDie(dieData, opts = {}) {
  const el = document.createElement('div');
  el.className = 'die';
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.innerHTML = `
    <div class="die-shadow"></div>
    <div class="die-air">
      <div class="die-squash"><div class="die-tilt"><div class="die-cube">
        <div class="die-core die-core-z"></div><div class="die-core die-core-x"></div><div class="die-core die-core-y"></div>
        ${[0, 1, 2, 3, 4, 5].map((s) => `<div class="die-face s${s}"><div class="die-face-in"></div><div class="die-gloss"></div><div class="die-shade"></div></div>`).join('')}
      </div></div></div>
      <div class="die-badge"></div>
    </div>`;
  const q = (s) => el.querySelector(s);
  const shadowEl = q('.die-shadow');
  const airEl = q('.die-air');
  const squashEl = q('.die-squash');
  const tiltEl = q('.die-tilt');
  const cubeEl = q('.die-cube');
  const badgeEl = q('.die-badge');
  const faceEls = [...el.querySelectorAll('.die-face')];
  const inEls = faceEls.map((f) => f.querySelector('.die-face-in'));
  const shadeEls = faceEls.map((f) => f.querySelector('.die-shade'));
  const glossEls = faceEls.map((f) => f.querySelector('.die-gloss'));

  // ------------------------------------------------------------ Zustand
  let data = dieData || { id: '?', sides: 6, faces: [1, 2, 3, 4, 5, 6].map((v) => ({ v, mark: null })), material: null };
  const sideFace = new Array(6).fill(-1); // welcher Flächenindex auf welcher Seite gemalt ist (-2 = „?“)
  let rx = BASE[0][0], ry = BASE[0][1], rz = rnd(-5, 5);
  let rzWobble = 0;
  let airY = 0, airX = 0;         // px (y negativ = nach oben)
  let dip = 0;                    // px nach unten (Anlauf)
  let sqX = 1, sqY = 1;
  let squashState = null;         // {t0, s, ms}
  let height01 = 0;               // für Schatten
  const holdSp = new Spring(0, { k: 260, damp: 0.74 });
  const hlSp = new Spring(0, { k: 300, damp: 0.72 });
  const hovX = new Spring(0, { k: 240, damp: 0.75 });
  const hovY = new Spring(0, { k: 240, damp: 0.75 });
  let held = false, scoring = false, rolling = 0, hovering = false;
  let value = null, faceIndex = -1, hidden = false;
  let off = null;
  let destroyed = false;
  let resistT0 = -1e9;
  const seed = Math.random() * 1000;
  const cache = {};
  let lastShade = '';

  const api = {
    el,
    /** Hooks (von tray verdrahtet): impact ~0.3..1.2 */
    onLand: null, onBounce: null, onLaunch: null,
    get data() { return data; },
    get value() { return value; },
    get faceIndex() { return faceIndex; },
    get hidden() { return hidden; },
    get held() { return held; },
    get rolling() { return rolling > 0; },
    setData, show, roll, turn, setHeld, juice, setDebuffed, setShackled, setScoring, resist, destroy,
    /** Seitenrechteck in Viewport-Koordinaten (für Popups) */
    rect() { return el.getBoundingClientRect(); },
  };

  // ------------------------------------------------------------ Malen
  function sizeOf() { return data.sides || (data.faces ? data.faces.length : 6); }

  function paintSide(s, fi, isHidden = false) {
    const face = fi >= 0 ? data.faces[fi] : null;
    const { cls, html } = faceHTML(face, sizeOf(), isHidden);
    faceEls[s].className = `die-face s${s} ${cls}`;
    inEls[s].innerHTML = html;
    sideFace[s] = isHidden ? -2 : fi;
  }

  /** andere Flächen des Würfels (für die übrigen Seiten), Gegenfläche zuerst */
  function otherFaces(fi, n) {
    const faces = data.faces || [];
    const idx = faces.map((_, i) => i).filter((i) => i !== fi);
    for (let i = idx.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const tv = fi >= 0 && faces[fi] ? faces[fi].v : 0;
    const opp = idx.findIndex((i) => faces[i].v === sizeOf() + 1 - tv);
    if (opp > 0) idx.unshift(idx.splice(opp, 1)[0]);
    const out = [];
    for (let k = 0; k < n; k++) out.push(idx.length ? idx[k % idx.length] : fi);
    return out;
  }

  function findFace(v, fi) {
    const faces = data.faces || [];
    if (fi != null && fi >= 0 && fi < faces.length) return fi;
    let i = faces.findIndex((f) => f.v === v && !f.mark);
    if (i < 0) i = faces.findIndex((f) => f.v === v);
    return i;
  }

  /** welche lokale Seite zeigt gerade in Weltrichtung dir ('front'|'back'|'left'|'right'|'top'|'bottom') */
  function sidesByWorld() {
    const m = {};
    for (let s = 0; s < 6; s++) {
      const n = worldN(s, rx, ry, rz);
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      let k;
      if (az >= ax && az >= ay) k = n[2] > 0 ? 'front' : 'back';
      else if (ax >= ay) k = n[0] > 0 ? 'right' : 'left';
      else k = n[1] > 0 ? 'bottom' : 'top';
      m[k] = s;
    }
    return m;
  }

  function paintDisplay(v, fi, isHidden, frontSide) {
    // Anzeige-Wert v (inkl. Stupser) kann von der Fläche abweichen → Kopie der Fläche mit v
    const faces = data.faces || [];
    if (fi >= 0 && faces[fi] && v != null && faces[fi].v !== v && faces[fi].mark !== 'stone') {
      const { cls, html } = faceHTML({ v, mark: faces[fi].mark }, sizeOf(), isHidden);
      faceEls[frontSide].className = `die-face s${frontSide} ${cls}`;
      inEls[frontSide].innerHTML = html;
      sideFace[frontSide] = fi;
    } else {
      paintSide(frontSide, fi, isHidden);
    }
  }

  function setState(v, fi, isHidden) {
    value = v; faceIndex = fi; hidden = !!isHidden;
    el.dataset.value = isHidden ? '?' : String(v);
    el.dataset.face = String(fi);
    el.dataset.hidden = isHidden ? '1' : '0';
    el.setAttribute('aria-label', isHidden ? 'Würfel verdeckt' : `Würfel ${v}`);
  }

  // ------------------------------------------------------------ öffentliche API
  function setData(d) {
    data = d || data;
    const mat = data.material;
    el.className = el.className.replace(/\bdie--m-\w+/g, '').replace(/\bdie--w\d\b/g, '').trim();
    if (mat) el.classList.add(`die--m-${mat}`);
    el.classList.add(`die--w${sizeOf()}`);
    el.dataset.dieId = data.id || '';
    // Inhalt neu malen (aktuelle Vorderseite behalten, falls Wert noch existiert)
    const fi = value != null ? findFace(value, faceIndex) : 0;
    show(value != null ? value : (data.faces[0] ? data.faces[0].v : 1), { faceIndex: fi >= 0 ? fi : 0, hidden });
  }

  /** sofort (ohne Animation) diesen Wert vorne zeigen */
  function show(v, o = {}) {
    const fi = findFace(v, o.faceIndex);
    const w = sidesByWorld();
    paintDisplay(v, fi, !!o.hidden, w.front);
    const others = ['top', 'left', 'back', 'right', 'bottom'].map((k) => w[k]);
    const of = otherFaces(fi, 5);
    // Gegenseite bekommt die Gegenfläche
    others.sort((a, b) => (a === w.back ? -1 : b === w.back ? 1 : 0));
    others.forEach((s, k) => paintSide(s, of[k]));
    setState(v, fi, o.hidden);
    kick();
  }

  /**
   * Wurf. → Promise (beim Landen).
   * o: {delay=0 (ms nach dem Anlauf), duration (650–900), suspense, faceIndex, hidden, anticipate=true}
   */
  function roll(targetValue, o = {}) {
    if (destroyed) return Promise.resolve();
    rolling++;
    el.classList.add('die--rolling');
    const fi = findFace(targetValue, o.faceIndex);
    const S = el.offsetWidth || 64; // einmalig lesen
    const suspense = !!o.suspense;
    const antMs = o.anticipate === false ? 0 : 140;
    const launch = antMs + (o.delay || 0);
    const D = (o.duration || rnd(650, 900)) + (suspense ? 300 : 0);
    const T_TOUCH = launch + D - 200;
    const T_B1 = T_TOUCH + 120;
    const T_LAND = launch + D;
    const H = S * (suspense ? 1.25 : rnd(0.8, 1.0));
    const b1 = 12 * S / 64, b2 = 4 * S / 64;

    // Zielseite: eine gerade verdeckte Seite (hinten/rechts/unten)
    const w = sidesByWorld();
    const hiddenSides = [w.back, w.right, w.bottom].filter((s) => s != null);
    const landSide = hiddenSides[(Math.random() * hiddenSides.length) | 0];
    paintDisplay(targetValue, fi, !!o.hidden, landSide);
    const others = hiddenSides.filter((s) => s !== landSide);
    const of = otherFaces(fi, others.length);
    others.forEach((s, k) => paintSide(s, of[k]));

    // Zielwinkel: Basis der Seite + volle Umdrehungen, immer vorwärts
    const rx0 = rx, ry0 = ry, rz0 = rz;
    const turnsX = suspense ? randInt(2, 3) : randInt(1, 2);
    const turnsY = suspense ? randInt(2, 3) : randInt(1, 2);
    const fwd = (from, base, turns) => {
      let t = base + 360 * Math.ceil((from - base) / 360);
      return t + 360 * turns;
    };
    const rx1 = fwd(rx0, BASE[landSide][0], turnsX);
    const ry1 = fwd(ry0, BASE[landSide][1], turnsY);
    const rzEnd = rnd(-6, 6);
    const rzDir = Math.random() < 0.5 ? -1 : 1;
    const extraZ = suspense ? 360 : (Math.random() < 0.5 ? 0 : 360);
    const rz1 = rzEnd + 360 * Math.round((rz0 - rzEnd) / 360) + rzDir * extraZ;
    const rotEnd = T_TOUCH + 70;
    const rotEase = suspense ? ease.outQuint : ease.outQuart;
    const rattleSeed = Math.random() * 10;

    return new Promise((resolve) => {
      const t0 = time.now();
      let launched = false, b0done = false, b1done = false;
      const offRoll = time.onFrame(() => {
        if (destroyed) { offRoll(); resolve(); return; }
        const t = time.now() - t0;
        // Anlauf: Delle + Rütteln
        if (t < launch) {
          const a = Math.min(1, t / 80);
          dip = 4 * ease.outCubic(a) * S / 64;
          const rat = t < 120 && !time.reducedMotion ? 3 * S / 64 * (1 - t / 140) : 0;
          airX = Math.sin(t * 0.19 + rattleSeed) * rat;
          airY = Math.cos(t * 0.23 + rattleSeed * 2) * rat * 0.6;
          sqX = sqY = 1 - 0.05 * a;
          height01 = 0;
          kick();
          return;
        }
        if (!launched) {
          launched = true;
          airX = 0; dip = 0;
          startSquash(-0.14, 90); // Streckung beim Abheben
          if (api.onLaunch) api.onLaunch();
        }
        // Rotation (easeOutQuart über die Flugphase, endet kurz nach dem ersten Aufsetzen)
        const pr = Math.min(1, (t - launch) / (rotEnd - launch));
        const e = rotEase(pr);
        rx = rx0 + (rx1 - rx0) * e;
        ry = ry0 + (ry1 - ry0) * e;
        rz = rz0 + (rz1 - rz0) * e;
        // Höhe
        if (t < T_TOUCH) {
          const u = (t - launch) / (T_TOUCH - launch);
          airY = -H * 4 * u * (1 - u);
        } else if (t < T_B1) {
          if (!b0done) { b0done = true; bounce(0.75 + (suspense ? 0.25 : 0), 0.12); }
          const u = (t - T_TOUCH) / (T_B1 - T_TOUCH);
          airY = -b1 * 4 * u * (1 - u);
        } else if (t < T_LAND) {
          if (!b1done) { b1done = true; bounce(0.4, 0.07); }
          const u = (t - T_B1) / (T_LAND - T_B1);
          airY = -b2 * 4 * u * (1 - u);
        } else {
          airY = 0; rx = rx1; ry = ry1; rz = rz1;
          offRoll();
          land(suspense ? 1.15 : 1);
          resolve();
          return;
        }
        height01 = Math.min(1, -airY / (S * 1.1));
        kick();
      });
    });

    function bounce(impact, s) {
      startSquash(s, 70);
      dust(3, 0.6);
      if (api.onBounce) api.onBounce(impact);
    }

    function land(impact) {
      rolling = Math.max(0, rolling - 1);
      if (!rolling) el.classList.remove('die--rolling');
      // Winkel normalisieren (gleiche Orientierung, kleine Zahlen)
      rx = ((rx % 360) + 360) % 360; ry = ((ry % 360) + 360) % 360; rz = ((rz + 180) % 360 + 360) % 360 - 180;
      setState(targetValue, fi, o.hidden);
      startSquash(0.13, 70);   // 0.85 / 1.12
      rzWobble = time.now();
      dust(5, 1);
      shake.add(0.08);
      time.hitstop(30);
      if (api.onLand) api.onLand(impact);
      kick();
    }
  }

  /**
   * Kurzes Umdrehen auf einen neuen Wert (Stupser, Wender, Aufdecken verdeckter Würfel). → Promise
   * o: {faceIndex, hidden, ms=380}
   */
  function turn(v, o = {}) {
    if (destroyed) return Promise.resolve();
    rolling++;
    const fi = findFace(v, o.faceIndex);
    const w = sidesByWorld();
    // Ziel: die gerade verdeckte Unterseite kippt nach vorne
    const landSide = w.bottom;
    paintDisplay(v, fi, !!o.hidden, landSide);
    const rx0 = rx, ry0 = ry;
    const fwd = (from, base) => base + 360 * Math.ceil((from - base) / 360);
    const rxT = fwd(rx0, BASE[landSide][0]);
    const ryT = fwd(ry0, BASE[landSide][1]);
    const ms = o.ms || 380;
    const S = el.offsetWidth || 64;
    return time.tween(ms, (e, r) => {
      rx = rx0 + (rxT - rx0) * e;
      ry = ry0 + (ryT - ry0) * e;
      airY = -S * 0.35 * Math.sin(Math.PI * r);
      height01 = -airY / (S * 1.1);
      kick();
    }, { ease: ease.outBack }).then(() => {
      rolling = Math.max(0, rolling - 1);
      airY = 0; height01 = 0;
      rx = ((rx % 360) + 360) % 360; ry = ((ry % 360) + 360) % 360;
      setState(v, fi, o.hidden);
      startSquash(0.1, 70);
      if (api.onLand) api.onLand(0.5);
      kick();
    });
  }

  function setHeld(b) {
    b = !!b;
    if (b === held) return;
    held = b;
    el.classList.toggle('die--held', held);
    el.setAttribute('aria-pressed', held ? 'true' : 'false');
    const S = el.offsetWidth || 64;
    holdSp.target = held ? -10 * S / 64 : 0;
    holdSp.vel += held ? -60 : 40;
    if (!held) startSquash(0.08, 70);
    kick();
  }

  /** wertender Würfel: hebt sich + Leuchtrand (tray.highlight) */
  function setScoring(b) {
    scoring = !!b;
    el.classList.toggle('die--scoring', scoring);
    const S = el.offsetWidth || 64;
    hlSp.target = scoring ? -8 * S / 64 : 0;
    kick();
  }

  function juice(amount = 0.3) {
    juiceFx(el, amount);
  }

  /** gehaltene Würfel widerstehen dem Wurf: ±2 px Zittern */
  function resist() {
    resistT0 = time.now();
    kick();
  }

  function setDebuffed(b) {
    el.classList.toggle('die--debuffed', !!b);
    updateBadge();
  }
  function setShackled(b) {
    el.classList.toggle('die--shackled', !!b);
    updateBadge();
  }
  function updateBadge() {
    const sh = el.classList.contains('die--shackled');
    const db = el.classList.contains('die--debuffed');
    badgeEl.innerHTML = (sh ? '<span class="die-chain die-chain--a"></span><span class="die-chain die-chain--b"></span><span class="die-lock">⛓</span>' : '')
      + (db ? '<span class="die-x">✕</span>' : '');
  }

  function destroy() {
    destroyed = true;
    if (off) { off(); off = null; }
    detachPress();
    el.remove();
  }

  // ------------------------------------------------------------ Effekte intern
  function startSquash(s, ms) {
    if (time.reducedMotion) s *= 0.5;
    squashState = { t0: time.now(), s, ms };
  }

  function dust(n, strength) {
    if (time.reducedMotion) n = Math.ceil(n / 2);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.bottom - r.height * 0.02;
    particles.burst(x, y, { count: n, shape: 'dust', speed: [40 * strength, 140 * strength], spread: Math.PI * 0.9, angle: -Math.PI / 2, life: [0.35, 0.6], size: [r.width * 0.05, r.width * 0.1], jitter: r.width * 0.35 });
  }

  // ------------------------------------------------------------ Hover-Neigung
  const canHover = hoverCapable();
  let hoverRect = null;
  function onEnter() { if (!canHover) return; hovering = true; hoverRect = el.getBoundingClientRect(); kick(); }
  function onMove(ev) {
    if (!canHover || !hovering || time.reducedMotion) return;
    if (!hoverRect) hoverRect = el.getBoundingClientRect();
    const mx = (ev.clientX - hoverRect.left) / hoverRect.width - 0.5;
    const my = (ev.clientY - hoverRect.top) / hoverRect.height - 0.5;
    hovX.target = -Math.max(-0.5, Math.min(0.5, my)) * 24;
    hovY.target = Math.max(-0.5, Math.min(0.5, mx)) * 24;
    kick();
  }
  function onLeave() { hovering = false; hoverRect = null; hovX.target = 0; hovY.target = 0; kick(); }
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  const detachPress = pressable(el, { down: 0.92 });

  // ------------------------------------------------------------ Render-Schleife (nur aktiv, wenn nötig)
  function kick() {
    if (off || destroyed) return;
    off = time.onFrame(frame);
  }

  function frame(dt, realDt) {
    const now = time.now();
    holdSp.step(dt); hlSp.step(dt);
    hovX.step(realDt); hovY.step(realDt);
    // Squash
    let busy = rolling > 0 || hovering || held;
    if (squashState) {
      const tt = (now - squashState.t0) / 1000;
      const T = squashState.ms / 1000;
      if (tt > T * 3.5) { squashState = null; if (!rolling) { sqX = sqY = 1; } }
      else {
        const v = squashState.s * Math.exp(-tt / T * 1.2) * Math.cos(tt / T * Math.PI * 0.55);
        sqX = 1 + v; sqY = 1 / (1 + v);
        busy = true;
      }
    } else if (!rolling) { sqX = sqY = 1; }
    // Lande-Wackler um Z (gedämpft)
    let wob = 0;
    const tw = (now - rzWobble) / 1000;
    if (tw >= 0 && tw < 0.45) { wob = 3.5 * Math.exp(-tw * 9) * Math.sin(tw * 38); busy = true; }
    // Widerstand (gehalten, andere werden geworfen)
    let rx2 = 0, ry2 = 0;
    const tr = (now - resistT0) / 1000;
    if (tr >= 0 && tr < 0.12) {
      const k = 1 - tr / 0.12;
      rx2 = Math.sin(tr * 190) * 2 * k; ry2 = Math.cos(tr * 150) * 0.8 * k;
      busy = true;
    }
    // Schweben, wenn gehalten
    let float = 0;
    if (held && !time.reducedMotion) float = Math.sin(time.realNow() / 1000 * 2.2 + seed) * 1.6;
    const hold = holdSp.value + hlSp.value;
    const y = airY + dip + hold + float;
    const x = airX + rx2;
    const red = time.reducedMotion;
    const tx = VIEW_TX + (red ? 0 : hovX.value);
    const ty = VIEW_TY + (red ? 0 : hovY.value);

    const tAir = `translate3d(${x.toFixed(2)}px,${(y + ry2).toFixed(2)}px,0)`;
    const tSq = (sqX !== 1 || sqY !== 1) ? `scale(${sqX.toFixed(4)},${sqY.toFixed(4)})` : 'none';
    const tTilt = `rotateX(${tx.toFixed(2)}deg) rotateY(${ty.toFixed(2)}deg)`;
    const rzv = rz + wob;
    const tCube = `rotateZ(${rzv.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    if (cache.air !== tAir) { airEl.style.transform = tAir; cache.air = tAir; }
    if (cache.sq !== tSq) { squashEl.style.transform = tSq; cache.sq = tSq; }
    if (cache.tilt !== tTilt) { tiltEl.style.transform = tTilt; cache.tilt = tTilt; }
    if (cache.cube !== tCube) { cubeEl.style.transform = tCube; cache.cube = tCube; }
    // Schatten: kleiner & blasser je höher
    const h = Math.max(0, Math.min(1, height01 + (-hold - float) / 80));
    const tSh = `scale(${(1 - 0.42 * h).toFixed(3)})`;
    const oSh = (1 - 0.6 * h).toFixed(3);
    if (cache.sh !== tSh) { shadowEl.style.transform = tSh; cache.sh = tSh; }
    if (cache.sho !== oSh) { shadowEl.style.opacity = oSh; cache.sho = oSh; }
    // Licht je Seite
    shadeFaces(tx, ty, rzv);
    if (!busy && holdSp.settled && hlSp.settled && hovX.settled && hovY.settled) {
      off(); off = null;
    }
  }

  function shadeFaces(tx, ty, rzv) {
    let key = '';
    const vals = [];
    for (let s = 0; s < 6; s++) {
      let n = worldN(s, rx, ry, rzv);
      n = rotX(rotY(n, ty * D2R), tx * D2R);
      const lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const shade = Math.min(0.72, 0.62 * Math.pow(1 - lam, 1.35) + 0.02);
      const gloss = Math.max(0, Math.min(1, (lam - 0.55) * 2.6));
      vals.push(shade, gloss);
      key += shade.toFixed(2) + gloss.toFixed(2);
    }
    if (key === lastShade) return;
    lastShade = key;
    for (let s = 0; s < 6; s++) {
      shadeEls[s].style.opacity = vals[s * 2].toFixed(3);
      glossEls[s].style.opacity = vals[s * 2 + 1].toFixed(3);
    }
  }

  // ------------------------------------------------------------ Start
  setData(data);
  if (opts.value != null) show(opts.value, { faceIndex: opts.faceIndex, hidden: opts.hidden });
  kick();
  return api;
}

export default createDie;
