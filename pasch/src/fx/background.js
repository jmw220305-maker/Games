// Hintergrund „Farbwirbel“: WebGL-Fragment-Shader auf #bg (halbe Auflösung).
// Polar-Verwirbelung + iterierter Sinus-Domain-Warp, auf 4 Farbbänder quantisiert, Dithering/Korn.
// Paletten mit weichen Übergängen, setIntensity beschleunigt, pulse() kurzer Puls.
// Ohne WebGL: animierter CSS-Verlauf (.fx-bg-fallback, Farben über CSS-Variablen).

import { time } from './time.js';

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// je 4 Bänder: dunkel → hell. Dunkel genug, damit die UI darüber gut lesbar bleibt.
export const PALETTES = {
  menu:   ['#0d0a22', '#1c1245', '#2d1a66', '#0f5560'],
  round:  ['#0b0a1f', '#16143f', '#123a55', '#3a1f6e'],
  warden: ['#12050f', '#2c0a1c', '#561129', '#8a2433'],
  shop:   ['#0a140f', '#12301f', '#2b4d1f', '#695d1a'],
  win:    ['#1a0b2e', '#3d1a6e', '#a0307a', '#e0a33c'],
  lose:   ['#09080e', '#17141f', '#2a2030', '#45242c'],
};

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uSpin;
uniform float uPulse;
uniform vec3 uC0, uC1, uC2, uC3;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  float t = uTime;
  // iterierter Sinus-Domain-Warp (malerisch, fließend)
  vec2 q = p * 2.1;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    q += (0.42 / (1.0 + fi * 0.5)) * vec2(
      sin(q.y * 1.65 + t * 0.29 + fi * 1.37),
      cos(q.x * 1.45 - t * 0.23 + fi * 2.11));
  }
  // Polar-Wirbel: Spiralarme, die sich mit uSpin enger drehen
  float r = length(q) * 0.5;
  float a = atan(q.y, q.x);
  float arms = a * 2.0 + r * (4.6 + 4.0 * uSpin) - t * 0.32;
  float f = 0.5 + 0.5 * sin(arms);
  f = mix(0.5, f, smoothstep(0.0, 0.22, r)); // Zentrum weich statt spitz
  f = mix(f, 0.5 + 0.5 * sin(q.x * 1.2 + q.y * 0.8 + t * 0.11), 0.28);
  float rr = length(p);
  // Dithering vor der Quantisierung (weiche, leicht körnige Bandkanten)
  f += (hash(gl_FragCoord.xy + fract(t * 7.0)) - 0.5) * 0.022;
  float e = 0.02;
  vec3 col = uC0;
  col = mix(col, uC1, smoothstep(0.36 - e, 0.36 + e, f));
  col = mix(col, uC2, smoothstep(0.56 - e, 0.56 + e, f));
  col = mix(col, uC3, smoothstep(0.76 - e, 0.76 + e, f));
  // Vignette + Puls
  col *= 1.0 - 0.5 * smoothstep(0.35, 1.25, rr);
  col += uPulse * 0.10 * (1.0 - rr * 0.6) * (uC3 + 0.2);
  col += (hash(gl_FragCoord.xy * 1.37 + t) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;

let canvas = null, gl = null, prog = null, uni = {};
let fallbackEl = null;
let off = null;
let w = 0, h = 0;
let t = 37.0;
let intensity = 0, intensityTarget = 0;
let pulseV = 0;
let paletteName = 'menu';
let cur = PALETTES.menu.map(hex);
let tgt = PALETTES.menu.map(hex);
let needsDraw = true;
let resScale = 0.5;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

function setupGL() {
  gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('no webgl');
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const n of ['uRes', 'uTime', 'uSpin', 'uPulse', 'uC0', 'uC1', 'uC2', 'uC3']) uni[n] = gl.getUniformLocation(prog, n);
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const nw = Math.max(1, Math.round(window.innerWidth * dpr * resScale));
  const nh = Math.max(1, Math.round(window.innerHeight * dpr * resScale));
  if (nw !== w || nh !== h) {
    w = nw; h = nh;
    canvas.width = w; canvas.height = h;
    if (gl) gl.viewport(0, 0, w, h);
    needsDraw = true;
  }
}

function useFallback() {
  gl = null;
  if (canvas) canvas.style.display = 'none';
  if (!fallbackEl) {
    fallbackEl = document.createElement('div');
    fallbackEl.className = 'fx-bg-fallback';
    fallbackEl.innerHTML = '<div class="fx-bg-swirl"></div><div class="fx-bg-swirl fx-bg-swirl--b"></div>';
    (canvas && canvas.parentNode ? canvas.parentNode : document.body).insertBefore(fallbackEl, canvas ? canvas.nextSibling : document.body.firstChild);
  }
  applyFallbackColors();
}

function applyFallbackColors() {
  if (!fallbackEl) return;
  const p = PALETTES[paletteName];
  p.forEach((c, i) => fallbackEl.style.setProperty(`--bgc${i}`, c));
  fallbackEl.classList.toggle('fx-bg-fast', intensityTarget > 0.5);
}

function frame(_, realDt) {
  // Farben weich überblenden
  const k = 1 - Math.exp(-realDt * 2.6);
  let moving = false;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const d = tgt[i][j] - cur[i][j];
    if (Math.abs(d) > 0.001) { cur[i][j] += d * k; moving = true; } else cur[i][j] = tgt[i][j];
  }
  intensity += (intensityTarget - intensity) * (1 - Math.exp(-realDt * 3));
  pulseV *= Math.exp(-realDt * 3.2);
  if (pulseV < 0.002) pulseV = 0;
  const reduced = time.reducedMotion;
  if (!reduced) {
    t += realDt * (0.32 + intensity * 1.5 + pulseV * 2.2);
  }
  if (!gl) return;
  // reduzierte Bewegung: Standbild, nur bei Änderungen neu zeichnen
  if (reduced && !moving && !needsDraw && pulseV === 0) return;
  needsDraw = false;
  gl.uniform2f(uni.uRes, w, h);
  gl.uniform1f(uni.uTime, t);
  gl.uniform1f(uni.uSpin, 0.55 + intensity * 0.35 + Math.sin(t * 0.07) * 0.12);
  gl.uniform1f(uni.uPulse, pulseV);
  gl.uniform3fv(uni.uC0, cur[0]);
  gl.uniform3fv(uni.uC1, cur[1]);
  gl.uniform3fv(uni.uC2, cur[2]);
  gl.uniform3fv(uni.uC3, cur[3]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export const background = {
  /** Canvas (Standard #bg). opts: {resolution: 0.5 (Anteil der CSS-Pixel·DPR), forceFallback} */
  init(c, opts = {}) {
    if (off) return this;
    canvas = c || document.getElementById('bg');
    if (opts.resolution) resScale = opts.resolution;
    try {
      if (!canvas || opts.forceFallback) throw new Error('fallback');
      setupGL();
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); useFallback(); });
    } catch {
      useFallback();
    }
    resize();
    window.addEventListener('resize', resize);
    off = time.onFrame(frame);
    return this;
  },
  /** 'menu' | 'round' | 'warden' | 'shop' | 'win' | 'lose' (oder eigene 4 Hex-Farben). instant: ohne Übergang */
  setPalette(name, instant = false) {
    const p = Array.isArray(name) ? name : PALETTES[name];
    if (!p) return;
    if (!Array.isArray(name)) paletteName = name;
    tgt = p.map(hex);
    if (instant) cur = tgt.map((c) => c.slice());
    needsDraw = true;
    applyFallbackColors();
  },
  get palette() { return paletteName; },
  /** 0..1: Wirbeltempo (beim Werten hoch, sonst 0) */
  setIntensity(v) { intensityTarget = Math.max(0, Math.min(1, v)); applyFallbackColors(); },
  /** kurzer Puls (Aufhellen + Tempostoß), z. B. bei großem Treffer */
  pulse(amount = 1) {
    pulseV = Math.min(1.5, pulseV + amount);
    if (fallbackEl && !time.reducedMotion) {
      fallbackEl.classList.remove('fx-bg-pulse');
      void fallbackEl.offsetWidth; // Animation neu starten (nur im Fallback, selten)
      fallbackEl.classList.add('fx-bg-pulse');
    }
  },
  get webgl() { return !!gl; },
  destroy() { if (off) off(); off = null; window.removeEventListener('resize', resize); },
};

export default background;
