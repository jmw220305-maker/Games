// Partikel auf EINEM Canvas über allem (#fx). DPR ≤ 2. Läuft nur, solange Partikel leben.
// Formen: square | spark | coin | confetti | dust | ring (Schockwelle)

import { time } from './time.js';

let canvas = null;
let ctx = null;
let W = 0, H = 0, DPR = 1;
let list = [];
let flyers = [];
let off = null;
const MAX = 900;

const PALETTE = {
  chips: ['#3ee6c4', '#a8fff0', '#1fb89a'],
  mult: ['#ff5fa2', '#ffb3d4', '#e0307e'],
  xmult: ['#ffd166', '#fff1c2', '#ff9f43'],
  money: ['#f9c74f', '#fff3b0', '#e09b1a'],
  confetti: ['#3ee6c4', '#ff5fa2', '#ffd166', '#7fb8ff', '#c77dff', '#f4ecd8'],
  dust: ['#e9dfc6', '#c9bda0', '#a99d84'],
};

function resize() {
  if (!canvas) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
}

function ensureCanvas() {
  if (canvas) return true;
  if (typeof document === 'undefined') return false;
  let c = document.getElementById('fx');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'fx';
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
    document.body.appendChild(c);
  }
  particles.init(c);
  return true;
}

const rnd = (a, b) => a + Math.random() * (b - a);

function loop() {
  if (off) return;
  off = time.onFrame((dt) => {
    step(dt);
    draw();
    if (!list.length && !flyers.length) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      off(); off = null;
    }
  });
}

function step(dt) {
  if (dt <= 0) return;
  const alive = [];
  for (const p of list) {
    p.age += dt;
    if (p.age >= p.life) continue;
    const drag = Math.pow(p.drag, dt * 60);
    p.vx *= drag; p.vy *= drag;
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
    alive.push(p);
  }
  list = alive;
  const fl = [];
  for (const f of flyers) {
    f.age += dt;
    if (f.age < 0) { fl.push(f); continue; }
    const u = Math.min(1, f.age / f.dur);
    if (u >= 1) { if (f.onArrive) f.onArrive(f.i); continue; }
    fl.push(f);
  }
  flyers = fl;
}

function drawCoin(x, y, r, rot, alpha) {
  const sx = Math.abs(Math.cos(rot)) * 0.85 + 0.15;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#7a4a0c';
  ctx.beginPath(); ctx.arc(0, r * 0.18, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f9c74f';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff1b8';
  ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b07612';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const p of list) {
    const u = p.age / p.life;
    const k = 1 - u;
    const size = p.size * (p.shrink ? k : 1);
    const alpha = p.fade ? Math.min(1, k * 2.2) * p.alpha : p.alpha;
    if (size <= 0.2) continue;
    ctx.globalAlpha = alpha;
    switch (p.shape) {
      case 'spark': {
        const len = Math.min(40, Math.hypot(p.vx, p.vy) * 0.045) + size;
        const a = Math.atan2(p.vy, p.vx);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, size * 0.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
        ctx.stroke();
        break;
      }
      case 'coin':
        drawCoin(p.x, p.y, size, p.rot, alpha);
        break;
      case 'confetti': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 2.3 + p.seed));
        ctx.fillStyle = p.color;
        ctx.fillRect(-size, -size * 0.45, size * 2, size * 0.9);
        ctx.restore();
        break;
      }
      case 'dust': {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.55 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + u * 1.2), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ring': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, 4 * k);
        ctx.globalAlpha = alpha * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.2 + ease(u) * 1.0), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      default: { // square
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
  }
  ctx.globalAlpha = 1;
  for (const f of flyers) {
    if (f.age < 0) continue;
    const u = Math.min(1, f.age / f.dur);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    // quadratische Bézier über einen seitlich versetzten Kontrollpunkt
    const cx = (f.x0 + f.x1) / 2 + f.bend, cy = Math.min(f.y0, f.y1) - 60 - Math.abs(f.bend) * 0.3;
    const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * cx + e * e * f.x1;
    const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * cy + e * e * f.y1;
    drawCoin(x, y, f.size * (1 + Math.sin(u * Math.PI) * 0.35), f.age * 14, 1);
  }
}
const ease = (u) => 1 - Math.pow(1 - u, 3);

export const particles = {
  /** Canvas setzen (Standard: #fx, wird bei Bedarf angelegt). */
  init(c) {
    canvas = c;
    ctx = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  },
  /**
   * Partikel-Ausbruch bei (x, y) in Viewport-px.
   * opts: {count=14, color (String|Array|Palettenname chips/mult/xmult/money/confetti/dust), speed=[150,500],
   *        gravity=900, life=[0.4,0.9] s, size=[3,7], shape, spread=2π, angle=-π/2, drag=0.92}
   */
  burst(x, y, opts = {}) {
    if (!ensureCanvas()) return;
    let count = opts.count != null ? opts.count : 14;
    if (time.reducedMotion) count = Math.ceil(count / 2);
    const shape = opts.shape || 'square';
    let colors = opts.color || (shape === 'coin' ? PALETTE.money : shape === 'dust' ? PALETTE.dust : PALETTE.confetti);
    if (typeof colors === 'string') colors = PALETTE[colors] || [colors];
    const sp = Array.isArray(opts.speed) ? opts.speed : opts.speed != null ? [opts.speed * 0.5, opts.speed] : [150, 500];
    const life = Array.isArray(opts.life) ? opts.life : opts.life != null ? [opts.life * 0.7, opts.life] : [0.4, 0.9];
    const size = Array.isArray(opts.size) ? opts.size : opts.size != null ? [opts.size * 0.7, opts.size] : (shape === 'coin' ? [6, 9] : shape === 'dust' ? [4, 8] : [3, 7]);
    const spread = opts.spread != null ? opts.spread : Math.PI * 2;
    const angle = opts.angle != null ? opts.angle : -Math.PI / 2;
    const g = opts.gravity != null ? opts.gravity : (shape === 'dust' ? -40 : shape === 'confetti' ? 500 : 900);
    const drag = opts.drag != null ? opts.drag : (shape === 'dust' ? 0.86 : shape === 'confetti' ? 0.95 : 0.92);
    for (let i = 0; i < count; i++) {
      if (list.length >= MAX) list.shift();
      const a = angle + (Math.random() - 0.5) * spread;
      const v = rnd(sp[0], sp[1]);
      list.push({
        x: x + (opts.jitter ? rnd(-opts.jitter, opts.jitter) : 0), y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g, drag, age: 0, life: rnd(life[0], life[1]),
        size: rnd(size[0], size[1]), color: colors[(Math.random() * colors.length) | 0],
        shape, rot: Math.random() * 6.28, vr: rnd(-12, 12), seed: Math.random() * 6,
        shrink: shape !== 'confetti' && shape !== 'coin', fade: true, alpha: opts.alpha || 1,
      });
    }
    loop();
  },
  /** Schockwellen-Ring bei (x, y) */
  ring(x, y, { radius = 60, color = '#f4ecd8', life = 0.35 } = {}) {
    if (!ensureCanvas()) return;
    list.push({ x, y, vx: 0, vy: 0, g: 0, drag: 1, age: 0, life, size: radius, color, shape: 'ring', rot: 0, vr: 0, alpha: 0.9, fade: false });
    loop();
  },
  /** Konfetti-Regen von oben + zwei Kanonen von unten links/rechts (n gesamt). */
  confetti(n = 40) {
    if (!ensureCanvas()) return;
    const third = Math.round(n / 3);
    this.burst(W * 0.08, H * 0.95, { count: third, shape: 'confetti', angle: -Math.PI / 2 + 0.45, spread: 0.7, speed: [700, 1150], life: [1.4, 2.2], size: [4, 7], gravity: 700, drag: 0.965 });
    this.burst(W * 0.92, H * 0.95, { count: third, shape: 'confetti', angle: -Math.PI / 2 - 0.45, spread: 0.7, speed: [700, 1150], life: [1.4, 2.2], size: [4, 7], gravity: 700, drag: 0.965 });
    const rest = n - third * 2;
    for (let i = 0; i < rest; i++) {
      this.burst(Math.random() * W, -10, { count: 1, shape: 'confetti', angle: Math.PI / 2, spread: 0.8, speed: [60, 200], life: [1.8, 2.6], size: [4, 7], gravity: 260, drag: 0.97 });
    }
  },
  /**
   * Münzen fliegen von (x0,y0) nach (x1,y1) auf einer Kurve (350 ms, 40 ms gestaffelt).
   * opts: {count=5, dur=350, stagger=40, size=7, onArrive(i)} → Promise (alle angekommen)
   */
  flyCoins(x0, y0, x1, y1, opts = {}) {
    if (!ensureCanvas()) return Promise.resolve();
    const count = opts.count || 5;
    const dur = (opts.dur || 350) / 1000;
    const stagger = (opts.stagger != null ? opts.stagger : 40) / 1000;
    return new Promise((resolve) => {
      let left = count;
      for (let i = 0; i < count; i++) {
        flyers.push({
          x0: x0 + rnd(-8, 8), y0: y0 + rnd(-6, 6), x1, y1, dur, age: -i * stagger, i,
          bend: rnd(-80, 80), size: opts.size || 7,
          onArrive: (k) => { if (opts.onArrive) opts.onArrive(k); if (--left === 0) resolve(); },
        });
      }
      loop();
    });
  },
  get count() { return list.length + flyers.length; },
  clear() { list = []; flyers = []; },
};

export default particles;
