// Animated menu backdrop: a dark shaft (the Schattenschacht) with the dead sun far above, a small hearth fire
// at the bottom centre, rising embers, slow parallax dust and a vignette. The DOM menu is overlaid on top.
// DOM-free at import time; the static layers are rendered once per size into a cached canvas.
import { makeCanvas, glowSprite, vignetteSprite, shade } from './lighting.js';

const TAU = Math.PI * 2;
const N_EMBERS = 70;
const N_FLAMES = 46;
const N_DUST = 70;

// deterministic hash noise (no Math.random in the static layer so resizes look identical)
function h1(n) {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i;
  const a = h1(i * 7919 + seed), b = h1((i + 1) * 7919 + seed);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
const FLAME_RAMP = ['#fffbe0', '#ffe9a0', '#ffd35a', '#ffb347', '#ff8a3c', '#ff5a1f', '#c8321a', '#5a1a10'];

export class MenuBg {
  constructor() {
    this.t = 0;
    this.w = 0; this.h = 0;
    this.bg = null;
    this.fireX = 0; this.fireY = 0;
    this.embers = [];
    for (let i = 0; i < N_EMBERS; i++) this.embers.push({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, ph: 0, c: '#ffb347' });
    this.flames = [];
    for (let i = 0; i < N_FLAMES; i++) this.flames.push({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, s: 2 });
    this.dust = [];
    for (let i = 0; i < N_DUST; i++) this.dust.push({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75, ph: Math.random() * TAU });
    this._fi = 0;
  }

  resize(w, h) {
    if (w === this.w && h === this.h && this.bg) return;
    this.w = w; this.h = h;
    this.fireX = Math.round(w / 2);
    this.fireY = Math.round(h * 0.86);
    this.bg = makeCanvas(w, h);
    if (!this.bg) return;
    const g = this.bg.getContext('2d');
    // deep vertical gradient: cold void above, warm glow below
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#07060d');
    grad.addColorStop(0.45, '#0c0910');
    grad.addColorStop(0.8, '#1a0e0b');
    grad.addColorStop(1, '#241209');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // the dead sun high up the shaft: a dark disc with a faint cold corona
    const sx = w / 2, sy = Math.round(h * 0.13), sr = Math.max(10, Math.round(Math.min(w, h) * 0.085));
    const corona = g.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * 2.6);
    corona.addColorStop(0, 'rgba(120,110,150,0.20)');
    corona.addColorStop(0.4, 'rgba(70,60,100,0.08)');
    corona.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = corona;
    g.fillRect(sx - sr * 3, sy - sr * 3, sr * 6, sr * 6);
    g.fillStyle = '#050409';
    g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,140,190,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(sx, sy, sr + 0.5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();

    // far rock layer (parallax depth hint, static)
    const portrait = h > w;
    const topHalf = portrait ? w * 0.26 : w * 0.17;
    const botHalf = portrait ? w * 0.52 : w * 0.42;
    for (let layer = 0; layer < 2; layer++) {
      const far = layer === 0;
      const extra = far ? -10 : 0;
      for (let y = 0; y < h; y++) {
        const t = y / h;
        const half = topHalf + (botHalf - topHalf) * Math.pow(t, far ? 1.1 : 1.35) + extra;
        const jagL = (noise1(y / (far ? 9 : 6), far ? 11 : 3) - 0.5) * (far ? 14 : 22) + (noise1(y / 2.5, 7) - 0.5) * 4;
        const jagR = (noise1(y / (far ? 9 : 6), far ? 29 : 17) - 0.5) * (far ? 14 : 22) + (noise1(y / 2.5, 41) - 0.5) * 4;
        const lx = Math.round(w / 2 - half + jagL), rx = Math.round(w / 2 + half + jagR);
        // fire-lit warmth toward the bottom
        const warm = Math.max(0, (t - 0.45) / 0.55);
        g.fillStyle = far ? shade('#120c12', -0.1 + warm * 0.12) : '#060408';
        g.fillRect(0, y, Math.max(0, lx), 1);
        g.fillRect(rx, y, Math.max(0, w - rx), 1);
        if (!far) {
          // rim light on the shaft edges
          const a = 0.12 + warm * 0.55;
          g.fillStyle = `rgba(255,${Math.round(120 + 60 * (1 - warm))},70,${a.toFixed(3)})`;
          g.fillRect(lx - 1, y, 1, 1);
          g.fillRect(rx, y, 1, 1);
          // strata ledges
          if (h1(y * 31 + 5) > 0.93) {
            g.fillStyle = `rgba(255,140,80,${(0.05 + warm * 0.18).toFixed(3)})`;
            g.fillRect(Math.max(0, lx - 18 - Math.round(h1(y) * 20)), y, 18, 1);
            g.fillRect(rx + 2, y, 14 + Math.round(h1(y + 9) * 18), 1);
          }
        }
      }
    }
    // ground with the hearth
    const gy = this.fireY + 5;
    g.fillStyle = '#0b0708';
    g.fillRect(0, gy, w, h - gy);
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x - this.fireX) / (w * 0.5);
      const a = Math.max(0, 0.5 - d * 0.6);
      if (a <= 0) continue;
      g.fillStyle = `rgba(255,150,80,${a.toFixed(3)})`;
      g.fillRect(x, gy, 1, 1);
      if (h1(x * 13) > 0.7) { g.fillStyle = `rgba(255,120,60,${(a * 0.4).toFixed(3)})`; g.fillRect(x, gy + 1 + Math.floor(h1(x) * 4), 1, 1); }
    }
    // hearth stones
    const fx = this.fireX, fy = this.fireY;
    const stones = [[-9, 2, 4, 3], [-5, 3, 4, 3], [-1, 3, 3, 3], [2, 3, 4, 3], [6, 2, 4, 3], [-11, 4, 3, 2], [9, 4, 3, 2]];
    for (const [ox, oy, sw, shh] of stones) {
      g.fillStyle = '#2a201c';
      g.fillRect(fx + ox, fy + oy, sw, shh);
      g.fillStyle = '#6b4a38';
      g.fillRect(fx + ox, fy + oy, sw, 1);
    }
    // logs
    g.fillStyle = '#3a2418';
    g.fillRect(fx - 6, fy + 1, 12, 2);
    g.fillStyle = '#5a3420';
    g.fillRect(fx - 4, fy, 8, 1);
  }

  _spawnFlame(f) {
    f.x = this.fireX + (Math.random() - 0.5) * 9;
    f.y = this.fireY + 1;
    f.vx = (Math.random() - 0.5) * 6;
    f.vy = -(14 + Math.random() * 22);
    f.life = f.t = 0.35 + Math.random() * 0.45;
    f.s = Math.random() < 0.5 ? 2 : 3;
  }

  _spawnEmber(e, anywhere) {
    e.x = anywhere ? Math.random() * this.w : this.fireX + (Math.random() - 0.5) * 10;
    e.y = anywhere ? this.h * (0.3 + Math.random() * 0.7) : this.fireY - 2;
    e.vx = (Math.random() - 0.5) * 10;
    e.vy = -(12 + Math.random() * 30);
    e.life = e.t = 2.5 + Math.random() * 5;
    e.ph = Math.random() * TAU;
    e.c = Math.random() < 0.3 ? '#ffd35a' : Math.random() < 0.5 ? '#ff8a3c' : '#ffb347';
  }

  /** Draw the backdrop. Optional `sprites` (art module) shows the bearer resting by the fire. */
  draw(ctx, w, h, dt, sprites) {
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    const first = this.t === 0;
    this.t += dt;
    const t = this.t;
    this.resize(w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    else { ctx.fillStyle = '#0a070b'; ctx.fillRect(0, 0, w, h); }
    if (first) for (const e of this.embers) this._spawnEmber(e, true);

    const fx = this.fireX, fy = this.fireY;
    const flick = 0.85 + Math.sin(t * 8.3) * 0.06 + Math.sin(t * 13.7 + 1) * 0.05 + Math.sin(t * 2.1) * 0.04;

    // dust: three parallax depths drifting slowly, lit by proximity to the fire
    for (let i = 0; i < N_DUST; i++) {
      const d = this.dust[i];
      d.x += (0.004 + d.z * 0.006) * dt * (i & 1 ? 1 : -1) + Math.sin(t * 0.3 + d.ph) * 0.0006 * dt * 60;
      d.y -= (0.002 + d.z * 0.006) * dt;
      if (d.x < 0) d.x += 1; else if (d.x > 1) d.x -= 1;
      if (d.y < 0) d.y += 1;
      const x = d.x * w, y = d.y * h;
      const near = Math.max(0, 1 - Math.hypot(x - fx, (y - fy) * 1.4) / (h * 0.75));
      ctx.globalAlpha = (0.08 + 0.5 * near * flick) * d.z;
      ctx.fillStyle = near > 0.3 ? '#ffcf9a' : '#8a8090';
      ctx.fillRect(Math.round(x), Math.round(y), d.z > 0.8 ? 2 : 1, 1);
    }

    // fire glow
    ctx.globalCompositeOperation = 'lighter';
    const gs = glowSprite('#ff8a3c');
    if (gs) {
      const r = h * 0.55 * flick;
      ctx.globalAlpha = 0.24;
      ctx.drawImage(gs, fx - r, fy - r * 0.9, r * 2, r * 2);
      const r2 = 26 * flick;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(glowSprite('#ffd35a'), fx - r2, fy - r2 - 4, r2 * 2, r2 * 2);
    }
    // flames
    let spawn = dt * 70;
    for (let i = 0; i < N_FLAMES; i++) {
      const f = this.flames[i];
      if (f.t <= 0) { if (spawn >= 1 || (spawn > 0 && Math.random() < spawn)) { this._spawnFlame(f); spawn -= 1; } else continue; }
      f.t -= dt;
      if (f.t <= 0) continue;
      f.x += (f.vx + Math.sin(t * 9 + i) * 4) * dt;
      f.y += f.vy * dt;
      f.x += (fx - f.x) * dt * 2.5; // pull toward the centre: tapered flame
      const k = 1 - f.t / f.life;
      const ci = Math.min(FLAME_RAMP.length - 1, Math.floor(k * FLAME_RAMP.length));
      const s = k > 0.6 ? 1 : f.s;
      ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.fillStyle = FLAME_RAMP[ci];
      ctx.fillRect(Math.round(f.x - s / 2), Math.round(f.y - s / 2), s, s);
    }
    // embers rising up the shaft
    for (let i = 0; i < N_EMBERS; i++) {
      const e = this.embers[i];
      if (e.t <= 0) { if (Math.random() < dt * 4) this._spawnEmber(e, false); else continue; }
      e.t -= dt;
      e.x += (e.vx + Math.sin(t * 1.7 + e.ph) * 9) * dt;
      e.y += e.vy * dt;
      e.vy *= 1 - dt * 0.05;
      if (e.y < -4) { e.t = 0; continue; }
      const k = e.t / e.life;
      ctx.globalAlpha = Math.min(1, k * 2.5) * (0.6 + 0.4 * Math.sin(t * 17 + e.ph * 3));
      ctx.fillStyle = e.c;
      ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
      if (gs && k > 0.5) {
        ctx.globalAlpha *= 0.25;
        ctx.drawImage(glowSprite(e.c), e.x - 3, e.y - 3, 7, 7);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // the bearer resting by the fire (optional art)
    if (sprites && typeof sprites.has === 'function') {
      try {
        if (sprites.has('char_bearer')) sprites.draw(ctx, 'char_bearer', fx - 22, fy - 3, { anim: 'idle', t, flipX: false });
      } catch { /* art optional */ }
    }

    // vignette
    const vg = vignetteSprite('#000000', 1);
    if (vg) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(vg, -w * 0.08, -h * 0.08, w * 1.16, h * 1.16);
      ctx.globalAlpha = 1;
    }
  }
}

export default MenuBg;
