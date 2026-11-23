// Flammen-Overlay auf einem Element (z. B. Punkte-/Multi-Kasten). Canvas-Partikel mit additiver Mischung,
// steigen von der Oberkante und den Seiten auf. Ein Canvas je Element, gemeinsame Uhr.
// Das Canvas liegt als Kind im Element (z-index -1, Element bekommt isolation:isolate) → Flammen hinter dem
// Inhalt, aber über dem Hintergrund des Elements, und lecken oben über den Rand hinaus.

import { time } from './time.js';

const entries = new Map(); // el → entry
let off = null;
const spriteCache = new Map();

const COLORS = { chips: '#3ee6c4', mult: '#ff5fa2', xmult: '#ffd166', money: '#f9c74f' };

function sprite(color) {
  let s = spriteCache.get(color);
  if (s) return s;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.42, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Farbe an den Rändern transparent auslaufen lassen
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(32, 32, 10, 32, 32, 32);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(color, c);
  return c;
}

function measure(e) {
  // Layout-Lesen nur bei Bedarf (Start, Resize), nie im Frame-Loop
  const r = e.el.getBoundingClientRect();
  e.bw = Math.max(1, r.width);
  e.bh = Math.max(1, r.height);
  e.fh = Math.max(40, Math.min(160, e.bh * 1.6)); // Flammenhöhe über dem Kasten
  e.pad = Math.max(12, e.bw * 0.08);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  e.dpr = dpr;
  const cw = e.bw + e.pad * 2, ch = e.bh + e.fh;
  e.canvas.width = Math.round(cw * dpr);
  e.canvas.height = Math.round(ch * dpr);
  e.canvas.style.left = `${-e.pad}px`;
  e.canvas.style.top = `${-e.fh}px`;
  e.canvas.style.width = `${cw}px`;
  e.canvas.style.height = `${ch}px`;
  e.cw = cw; e.ch = ch;
}

function loop() {
  if (off) return;
  off = time.onFrame((_, realDt) => {
    for (const e of entries.values()) stepEntry(e, realDt);
    if (!entries.size) { off(); off = null; }
  });
}

function stepEntry(e, dt) {
  e.level += (e.target - e.level) * (1 - Math.exp(-dt * 4));
  if (e.target === 0 && e.level < 0.01 && !e.parts.length) { remove(e); return; }
  const lv = e.level * (time.reducedMotion ? 0.5 : 1);
  // emittieren
  e.acc += dt * (20 + 160 * lv) * (e.bw / 160 + 0.5);
  while (e.acc >= 1 && lv > 0.02) {
    e.acc -= 1;
    const side = Math.random();
    let x, y;
    if (side < 0.72) { x = e.pad + Math.random() * e.bw; y = e.fh + 4; }
    else { x = side < 0.86 ? e.pad + 2 : e.pad + e.bw - 2; y = e.fh + Math.random() * e.bh * 0.6; }
    e.parts.push({
      x, y, vx: (Math.random() - 0.5) * 18, vy: -(40 + Math.random() * 80) * (0.6 + lv),
      age: 0, life: 0.45 + Math.random() * 0.5 * (0.5 + lv),
      r: (8 + Math.random() * 10) * (0.6 + lv * 0.8) * Math.min(1.4, e.bh / 50 + 0.4),
      ph: Math.random() * 6.28, hot: Math.random() < 0.25,
    });
  }
  if (e.acc > 1) e.acc = 1;
  const ctx = e.ctx;
  ctx.setTransform(e.dpr, 0, 0, e.dpr, 0, 0);
  ctx.clearRect(0, 0, e.cw, e.ch);
  ctx.globalCompositeOperation = 'lighter';
  const sp = sprite(e.color);
  const hot = sprite('#ffffff');
  const alive = [];
  const tt = time.realNow() / 1000;
  for (const p of e.parts) {
    p.age += dt;
    if (p.age >= p.life) continue;
    const u = p.age / p.life;
    p.vy -= 60 * dt;
    p.x += (p.vx + Math.sin(tt * 7 + p.ph) * 22) * dt;
    p.y += p.vy * dt;
    const r = p.r * (1 - u * 0.75);
    ctx.globalAlpha = Math.min(1, (1 - u) * 1.4) * (0.55 + e.level * 0.45) * (u < 0.1 ? u * 10 : 1);
    ctx.drawImage(p.hot && u < 0.4 ? hot : sp, p.x - r, p.y - r * 1.25, r * 2, r * 2.5);
    alive.push(p);
  }
  e.parts = alive;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function remove(e) {
  e.canvas.remove();
  e.ro && e.ro.disconnect();
  e.el.classList.remove('fx-flames-host');
  entries.delete(e.el);
}

/**
 * Flammen auf el setzen. intensity 0..1 (0 = ausklingen lassen und entfernen).
 * opts: {color: Hex oder 'chips'|'mult'|'xmult'|'money' (Standard 'chips')}
 */
export function setFlames(el, intensity = 1, opts = {}) {
  if (!el) return;
  const color = COLORS[opts.color] || opts.color || COLORS.chips;
  let e = entries.get(el);
  intensity = Math.max(0, Math.min(1, intensity));
  if (!e) {
    if (intensity === 0) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-flames';
    el.classList.add('fx-flames-host');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.insertBefore(canvas, el.firstChild);
    e = { el, canvas, ctx: canvas.getContext('2d'), parts: [], level: 0, target: 0, acc: 0, color };
    measure(e);
    if (typeof ResizeObserver === 'function') {
      e.ro = new ResizeObserver(() => measure(e));
      e.ro.observe(el);
    }
    entries.set(el, e);
  }
  e.color = color;
  e.target = intensity;
  loop();
}

/** Alle Flammen ausklingen lassen. */
export function clearFlames() { for (const e of entries.values()) e.target = 0; }

/** Intensität nach research_feel #25: clamp(log10(score/target) + 0.3, 0, 1) */
export function flameIntensity(score, target) {
  if (!(target > 0) || score < target) return 0;
  return Math.max(0, Math.min(1, Math.log10(score / target) + 0.3));
}
