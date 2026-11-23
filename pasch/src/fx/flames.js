// Flammen-Overlay auf einem Element (z. B. Punkte-/Multi-Kasten). Canvas-Partikel mit additiver Mischung,
// steigen von der Oberkante und den Seiten auf. Ein Canvas je Element, gemeinsame Uhr.
// Das Canvas liegt als Kind im Element (z-index -1, Element bekommt isolation:isolate) → Flammen hinter dem
// Inhalt, aber über dem Hintergrund des Elements, und lecken oben über den Rand hinaus.

import { time } from './time.js';

const entries = new Map(); // el → entry
let off = null;
const spriteCache = new Map();

const COLORS = { chips: '#3ee6c4', mult: '#ff5fa2', xmult: '#ffd166', money: '#f9c74f' };

function mixWhite(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.round(c + (255 - c) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function sprite(color, hot = false) {
  const key = color + (hot ? '#hot' : '');
  let s = spriteCache.get(key);
  if (s) return s;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hot) {
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.3, rgba(color, 0.6));
    grad.addColorStop(1, rgba(color, 0));
  } else {
    grad.addColorStop(0, mixWhite(color, 0.35));
    grad.addColorStop(0.3, rgba(color, 0.85));
    grad.addColorStop(0.65, rgba(color, 0.25));
    grad.addColorStop(1, rgba(color, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(key, c);
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
  e.acc += dt * (30 + 170 * lv) * (e.bw / 120 + 0.4);
  while (e.acc >= 1 && lv > 0.02) {
    e.acc -= 1;
    const side = Math.random();
    let x, y;
    if (side < 0.72) { x = e.pad + Math.random() * e.bw; y = e.fh + e.bh * (0.1 + Math.random() * 0.15); }
    else { x = side < 0.86 ? e.pad + 2 : e.pad + e.bw - 2; y = e.fh + Math.random() * e.bh * 0.6; }
    e.parts.push({
      x, y, vx: (Math.random() - 0.5) * 18, vy: -(40 + Math.random() * 80) * (0.6 + lv),
      age: 0, life: 0.45 + Math.random() * 0.5 * (0.5 + lv),
      r: (5 + Math.random() * 7) * (0.75 + lv * 0.8) * Math.max(0.7, Math.min(1.5, e.bh / 48)),
      ph: Math.random() * 6.28, hot: Math.random() < 0.25,
    });
  }
  if (e.acc > 1) e.acc = 1;
  const ctx = e.ctx;
  ctx.setTransform(e.dpr, 0, 0, e.dpr, 0, 0);
  ctx.clearRect(0, 0, e.cw, e.ch);
  ctx.globalCompositeOperation = 'lighter';
  const sp = sprite(e.color);
  const hot = sprite(e.color, true);
  // Glut entlang der Oberkante
  if (lv > 0.02) {
    const gy = e.fh + e.bh * 0.25, top = e.fh - e.fh * (0.25 + 0.45 * lv);
    const gr = ctx.createLinearGradient(0, gy, 0, top);
    gr.addColorStop(0, rgba(e.color, 0));
    gr.addColorStop(0.3, rgba(e.color, 0.35 * lv + 0.1));
    gr.addColorStop(1, rgba(e.color, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(e.pad * 0.6, top, e.bw + e.pad * 0.8, gy - top);
  }
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
    ctx.globalAlpha = Math.min(1, (1 - u) * 1.3) * (0.45 + e.level * 0.4) * (u < 0.06 ? u / 0.06 : 1);
    // Flammenzunge: schmal und hoch, oben spitzer werdend
    ctx.drawImage(p.hot && u < 0.35 ? hot : sp, p.x - r * 0.8, p.y - r * 1.8, r * 1.6, r * (2.6 + u * 1.2));
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
