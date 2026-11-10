// Renderer: low-res pixel canvas (#game) + device-resolution text canvas (#overlay).
// Draw order: fog clear → static room → animated tiles → ground decals (zone telegraphs, spawn rings, elite auras,
// fx rings) → y-sorted props / pickups / enemies / player → projectiles → particles, beams, lightning → lighting →
// HP bars, status pips, off-screen indicators, vignettes, flash, fade → overlay texts.
// Tolerates a missing/broken art module (placeholder shapes). DOM-free at import time.
import { TS, TILE, SPIKE_CYCLE, RARITY_INFO, TYPE_COLORS } from '../game/constants.js';
import { Lighting, glowSprite, shadowSprite, vignetteSprite, makeCanvas, shade } from './lighting.js';
import { MenuBg } from './menubg.js';

const TAU = Math.PI * 2;
const LANDSCAPE_H = 270, LANDSCAPE_MAX_W = 560;
const PORTRAIT_W = 240, PORTRAIT_MAX_H = 520;
const LOOK_AHEAD = 14;
const CAM_LERP = 7;
const CULL = 28;
const AFTER_N = 10;

const K_PROP = 0, K_PICKUP = 1, K_ENEMY = 2, K_PLAYER = 3;

const STATUS_COLORS = {
  burn: TYPE_COLORS.fire, poison: TYPE_COLORS.poison, chill: TYPE_COLORS.frost, freeze: '#d6f4ff', shock: TYPE_COLORS.shock,
  mark: '#ff4f7a', stun: '#ffe9a0', weak: '#9a86c9', slow: '#7fa0c0',
};
const PICKUP_COLORS = { spark: '#ffd35a', xp: '#8fd8ff', heart: '#ff4f6a', ash: '#c9c2b8', shield: '#9ad0ff' };
const PROP_LOOK = {
  chest: ['#8a5a2a', 'rect'], pedestal: ['#6e6878', 'rect'], shrine: ['#8a5fd0', 'tri'], forge: ['#ff7a2f', 'rect'],
  fountain: ['#5fb0e0', 'disc'], portal: ['#b07cff', 'ring'], barrel: ['#7a4a26', 'disc'], crystal: ['#8fd8ff', 'diamond'],
  torch: ['#ffb347', 'torch'], statue: ['#8a8478', 'rect'], bones: ['#d8d0c0', 'disc'], stalagmite: ['#5a4c44', 'tri'], mushroom: ['#9be35a', 'disc'],
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const byY = (a, b) => a.y - b.y;

export class Renderer {
  constructor(canvas, textCanvas, game, fx) {
    this.canvas = canvas || null;
    this.textCanvas = textCanvas || null;
    this.game = game || null;
    this.fx = fx || null;
    this.ctx = null;
    this.octx = null;
    if (this.canvas && this.canvas.getContext) this.ctx = this.canvas.getContext('2d', { alpha: false }) || this.canvas.getContext('2d');
    if (this.textCanvas && this.textCanvas.getContext) this.octx = this.textCanvas.getContext('2d');
    // sizes
    this.w = 480; this.h = 270;             // logical view (game pixels)
    this.scale = 2;                         // CSS px per logical px
    this.dpr = 1;
    this.cssW = 960; this.cssH = 540;
    this.kx = 2; this.ky = 2;               // overlay device px per logical px
    // art
    this.sprites = null;
    this.renderRoomStatic = null;
    this.drawRoomDynamic = null;
    this.badKeys = new Set();
    this.dynBroken = false;
    // caches
    this.roomCache = new WeakMap();
    this.dynCache = new WeakMap();
    this.lastFloor = null;
    this.lastRoom = null;
    // camera
    this.cam = { x: 0, y: 0 };
    this.camX = 0; this.camY = 0;
    this.time = 0;
    this.lighting = new Lighting();
    this.menubg = new MenuBg();
    this.lightingEnabled = true;
    // y-sort list (pooled slots)
    this.slotPool = [];
    this.list = [];
    // dash after-images
    this.afterX = new Float32Array(AFTER_N);
    this.afterY = new Float32Array(AFTER_N);
    this.afterT = new Float32Array(AFTER_N).fill(-9);
    this.afterF = new Uint8Array(AFTER_N);
    this.afterI = 0;
    this.afterAcc = 0;
    // reusable sprite opts
    this._o = { anim: 'idle', t: 0, flipX: false, flash: 0, alpha: 1, scale: 1, rot: 0, color: undefined };
    this.frameMs = 0;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
  }

  /** art = { sprites, renderRoomStatic, drawRoomDynamic } — any may be missing. */
  setArt(art) {
    art = art || {};
    this.sprites = art.sprites && typeof art.sprites.draw === 'function' && typeof art.sprites.has === 'function' ? art.sprites : null;
    this.renderRoomStatic = typeof art.renderRoomStatic === 'function' ? art.renderRoomStatic : null;
    this.drawRoomDynamic = typeof art.drawRoomDynamic === 'function' ? art.drawRoomDynamic : null;
    this.badKeys.clear();
    this.dynBroken = false;
    this.invalidateRooms();
  }

  invalidateRooms() { this.roomCache = new WeakMap(); this.dynCache = new WeakMap(); }
  invalidateRoom(room) { if (room) { this.roomCache.delete(room); this.dynCache.delete(room); } }

  // ------------------------------------------------------------------------------------------
  // sizing
  // ------------------------------------------------------------------------------------------
  resize() {
    if (!this.canvas || typeof window === 'undefined') return;
    const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : null;
    const W = Math.max(1, (rect && rect.width) || window.innerWidth || 960);
    const H = Math.max(1, (rect && rect.height) || window.innerHeight || 540);
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    let scale, w, h;
    if (W >= H) {
      scale = H / LANDSCAPE_H; w = W / scale;
      if (w > LANDSCAPE_MAX_W) { scale = W / LANDSCAPE_MAX_W; w = LANDSCAPE_MAX_W; }
      h = H / scale;
    } else {
      scale = W / PORTRAIT_W; h = H / scale;
      if (h > PORTRAIT_MAX_H) { scale = H / PORTRAIT_MAX_H; h = PORTRAIT_MAX_H; }
      w = W / scale;
    }
    w = Math.max(64, Math.round(w)); h = Math.max(64, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.w = w; this.h = h;
    this.cssW = W; this.cssH = H;
    this.scale = W / w;
    this.dpr = dpr;
    if (this.textCanvas) {
      const ow = Math.round(W * dpr), oh = Math.round(H * dpr);
      if (this.textCanvas.width !== ow || this.textCanvas.height !== oh) { this.textCanvas.width = ow; this.textCanvas.height = oh; }
      this.kx = ow / w; this.ky = oh / h;
    } else { this.kx = this.ky = this.scale; }
    this.lighting.resize(w, h);
    this.syncView();
  }

  syncView() {
    const g = this.game;
    if (!g) return;
    const v = g.view || (g.view = { x: 0, y: 0, w: 0, h: 0, scale: 1 });
    v.x = Math.round(this.cam.x); v.y = Math.round(this.cam.y);
    v.w = this.w; v.h = this.h; v.scale = this.scale;
  }

  // ------------------------------------------------------------------------------------------
  // frame
  // ------------------------------------------------------------------------------------------
  draw(dtFrame) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = dtFrame > 0 ? Math.min(0.1, dtFrame) : 0;
    this.time += dt;
    const game = this.game;
    const run = game && game.run;
    const world = run && run.world;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.clearOverlay();
    if (!run || !game || game.state === 'menu') {
      this.menubg.draw(ctx, this.w, this.h, dt, this.sprites);
      this.lastRoom = null;
      this.drawFade(ctx);
      this.syncView();
    } else if (!world || !world.room) {
      ctx.fillStyle = '#050307';
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawFade(ctx);
    } else {
      this.drawWorld(world, run, dt);
    }
    if (t0) this.frameMs = performance.now() - t0;
  }

  clearOverlay() {
    const o = this.octx;
    if (!o) return;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalAlpha = 1;
    o.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);
  }

  drawFade(ctx) {
    const f = this.game && this.game.fade;
    if (f > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, f);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
  }

  updateCamera(world, dt, snap) {
    const p = world.player, room = world.room;
    const RW = room.w * TS, RH = room.h * TS;
    let tx = p ? p.x : RW / 2, ty = p ? p.y : RH / 2;
    if (p && p.alive !== false) {
      const aim = p.aim || 0;
      tx += Math.cos(aim) * LOOK_AHEAD + clamp((p.vx || 0) * 0.1, -10, 10);
      ty += Math.sin(aim) * LOOK_AHEAD * 0.8 + clamp((p.vy || 0) * 0.1, -10, 10);
    }
    let cx = tx - this.w / 2, cy = ty - this.h / 2;
    cx = RW <= this.w ? (RW - this.w) / 2 : clamp(cx, 0, RW - this.w);
    cy = RH <= this.h ? (RH - this.h) / 2 : clamp(cy, 0, RH - this.h);
    if (snap || !(this.cam.x === this.cam.x)) { this.cam.x = cx; this.cam.y = cy; return; }
    const k = 1 - Math.exp(-dt * CAM_LERP);
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
  }

  drawWorld(world, run, dt) {
    const ctx = this.ctx, fx = this.fx;
    const room = world.room;
    const biome = world.biome || {};
    const fog = biome.fog || '#0a070b';
    const vw = this.w, vh = this.h;
    if (run.floor !== this.lastFloor) { this.lastFloor = run.floor; this.invalidateRooms(); }
    const snap = room !== this.lastRoom;
    if (snap) { this.lastRoom = room; this.afterT.fill(-9); }
    this.updateCamera(world, dt, snap);
    const camX = Math.round(this.cam.x + (fx ? fx.shakeX || 0 : 0));
    const camY = Math.round(this.cam.y + (fx ? fx.shakeY || 0 : 0));
    this.camX = camX; this.camY = camY;
    this.syncView();
    const time = world.time || 0;
    const t = this.time;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, vw, vh);
    ctx.setTransform(1, 0, 0, 1, -camX, -camY);

    // static room (clipped blit)
    const st = this.roomCanvas(room, biome);
    if (st) {
      const sx = Math.max(0, camX), sy = Math.max(0, camY);
      const sw = Math.min(st.width, camX + vw) - sx, sh = Math.min(st.height, camY + vh) - sy;
      if (sw > 0 && sh > 0) ctx.drawImage(st, sx, sy, sw, sh, sx, sy, sw, sh);
    }
    // animated tiles
    this.drawDynamic(ctx, room, biome, world, time);
    // ground decals
    this.drawZones(ctx, world.zones, t);
    this.drawEnemyDecals(ctx, world.enemies, t);
    if (fx && fx.drawRings) fx.drawRings(ctx);
    // y-sorted entities
    this.drawEntities(ctx, world, run, t, dt, camX, camY);
    // projectiles
    this.drawProjectiles(ctx, world.projectiles, camX, camY);
    // particles / beams / lightning
    if (fx && fx.drawParticles) fx.drawParticles(ctx, camX, camY, vw, vh);
    // lighting
    if (this.lightingEnabled) {
      this.lighting.render(ctx, world, fx, camX, camY, vw, vh, t, biome.darkness ?? 0.6, fog);
    }
    // after lighting: always readable
    ctx.setTransform(1, 0, 0, 1, -camX, -camY);
    this.drawBars(ctx, world, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawIndicators(ctx, world, camX, camY);
    this.drawScreenFx(ctx, world, t);
    this.drawFade(ctx);
    // overlay: texts + price labels
    this.drawOverlay(world, camX, camY);
  }

  // ------------------------------------------------------------------------------------------
  // sprites helpers
  // ------------------------------------------------------------------------------------------
  has(key) {
    const s = this.sprites;
    return !!(s && key && !this.badKeys.has(key) && s.has(key));
  }

  opt(anim, t, flipX, flash, alpha, scale) {
    const o = this._o;
    o.anim = anim || 'idle'; o.t = t || 0; o.flipX = !!flipX; o.flash = flash || 0;
    o.alpha = alpha == null ? 1 : alpha; o.scale = scale == null ? 1 : scale; o.rot = 0; o.color = undefined;
    return o;
  }

  /** sprites.draw guarded: a throwing sprite is blacklisted and drawn as a placeholder from then on. */
  spr(ctx, key, x, y, o) {
    try {
      this.sprites.draw(ctx, key, x, y, o);
      return true;
    } catch (err) {
      this.badKeys.add(key);
      console.warn(`[renderer] sprite "${key}" failed – placeholder from now on`, err);
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, -this.camX, -this.camY);
      return false;
    }
  }

  sizeOf(key, fallbackR) {
    if (this.has(key)) {
      try { const s = this.sprites.size(key); if (s && s.h) return s; } catch { /* ignore */ }
    }
    const d = (fallbackR || 6) * 2;
    return { w: d, h: d };
  }

  shadow(ctx, x, y, w, h, alpha) {
    const s = shadowSprite();
    if (!s) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(s, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.max(2, Math.round(h)));
    ctx.globalAlpha = 1;
  }

  disc(ctx, x, y, r, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), Math.max(1, r), 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#0b0709';
    ctx.stroke();
    ctx.fillStyle = shade(color, 0.5);
    ctx.fillRect(Math.round(x - r * 0.45), Math.round(y - r * 0.55), Math.max(1, Math.round(r * 0.35)), 1);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------------------------------
  // tiles
  // ------------------------------------------------------------------------------------------
  roomCanvas(room, biome) {
    let c = this.roomCache.get(room);
    if (c !== undefined) return c;
    c = null;
    if (this.renderRoomStatic) {
      try { c = this.renderRoomStatic(room, biome) || null; } catch (err) {
        console.warn('[renderer] renderRoomStatic failed – placeholder tiles', err);
        c = null;
      }
    }
    if (!c) c = this.placeholderRoom(room, biome);
    this.roomCache.set(room, c);
    return c;
  }

  placeholderRoom(room, biome) {
    const W = room.w, H = room.h;
    const c = makeCanvas(W * TS, H * TS);
    if (!c) return null;
    const g = c.getContext('2d');
    const pal = (biome && biome.palette) || {};
    const floor = pal.floor || '#3b2f2a', floorAlt = pal.floorAlt || shade(floor, 0.06), wall = pal.wall || '#1f1715';
    const wallTop = pal.wallTop || '#5a463c', pit = pal.pit || '#0d0807', hazard = pal.hazard || '#ff6a1f', detail = pal.detail || '#6b5245';
    const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? TILE.VOID : room.tiles[y * W + x]);
    const isWall = (v) => v === TILE.WALL || v === TILE.VOID;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const v = tile(tx, ty);
        const x = tx * TS, y = ty * TS;
        const hsh = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if (v === TILE.VOID) continue;
        if (v === TILE.WALL) {
          g.fillStyle = wall; g.fillRect(x, y, TS, TS);
          if (!isWall(tile(tx, ty + 1))) { // south face
            g.fillStyle = shade(wall, 0.12); g.fillRect(x, y + TS - 7, TS, 7);
            g.fillStyle = wallTop; g.fillRect(x, y + TS - 8, TS, 1);
            g.fillStyle = shade(wall, -0.3); g.fillRect(x, y + TS - 1, TS, 1);
          }
          if (!isWall(tile(tx, ty - 1)) && ty > 0) { g.fillStyle = wallTop; g.fillRect(x, y, TS, 1); }
          if (hsh % 5 === 0) { g.fillStyle = shade(wall, 0.08); g.fillRect(x + (hsh % 11), y + 3 + (hsh % 5), 3, 1); }
          continue;
        }
        // floor base for every walkable-ish tile
        g.fillStyle = (tx + ty) & 1 ? floor : floorAlt;
        g.fillRect(x, y, TS, TS);
        if (hsh % 3 === 0) { g.fillStyle = detail; g.globalAlpha = 0.35; g.fillRect(x + (hsh % 13), y + ((hsh >> 4) % 13), 2, 1); g.globalAlpha = 1; }
        g.fillStyle = shade(floor, -0.18);
        g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS);
        if (v === TILE.PIT) {
          g.fillStyle = pit; g.fillRect(x, y, TS, TS);
          if (tile(tx, ty - 1) !== TILE.PIT) { g.fillStyle = shade(floor, -0.45); g.fillRect(x, y, TS, 3); }
        } else if (v === TILE.HAZARD) {
          g.fillStyle = shade(hazard, -0.55); g.fillRect(x + 1, y + 1, TS - 2, TS - 2);
          g.fillStyle = shade(hazard, -0.2); g.fillRect(x + 3, y + 7, TS - 6, 2); g.fillRect(x + 7, y + 3, 2, TS - 6);
        } else if (v === TILE.ICE) {
          g.fillStyle = '#9fcfe8'; g.globalAlpha = 0.55; g.fillRect(x, y, TS, TS); g.globalAlpha = 1;
          g.fillStyle = '#e8f8ff'; g.fillRect(x + 3, y + 10, 4, 1); g.fillRect(x + 9, y + 4, 3, 1);
        } else if (v === TILE.SPIKES) {
          g.fillStyle = shade(floor, -0.35); g.fillRect(x + 1, y + 1, TS - 2, TS - 2);
          g.fillStyle = '#0a0606';
          for (let i = 0; i < 4; i++) g.fillRect(x + 3 + (i & 1) * 8, y + 3 + (i >> 1) * 8, 2, 2);
        } else if (v === TILE.DOOR) {
          g.fillStyle = shade(floor, -0.25); g.fillRect(x, y, TS, TS);
        }
      }
    }
    return c;
  }

  dynLists(room) {
    let d = this.dynCache.get(room);
    if (d) return d;
    const haz = [], spikes = [], doors = [];
    const t = room.tiles || [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === TILE.HAZARD) haz.push(i);
      else if (t[i] === TILE.SPIKES) spikes.push(i);
      else if (t[i] === TILE.DOOR) doors.push(i);
    }
    d = { haz: Int32Array.from(haz), spikes: Int32Array.from(spikes), doors: Int32Array.from(doors) };
    this.dynCache.set(room, d);
    return d;
  }

  drawDynamic(ctx, room, biome, world, time) {
    if (this.drawRoomDynamic && !this.dynBroken) {
      try {
        this.drawRoomDynamic(ctx, room, biome, time, { locked: !!world.locked, view: this.game && this.game.view });
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, -this.camX, -this.camY);
        return;
      } catch (err) {
        this.dynBroken = true;
        console.warn('[renderer] drawRoomDynamic failed – placeholder animation', err);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, -this.camX, -this.camY);
      }
    }
    // placeholder animation
    const d = this.dynLists(room);
    const W = room.w;
    const pal = (biome && biome.palette) || {};
    const x0 = this.camX - TS, y0 = this.camY - TS, x1 = this.camX + this.w, y1 = this.camY + this.h;
    if (d.haz.length) {
      ctx.fillStyle = pal.hazard || '#ff6a1f';
      for (let i = 0; i < d.haz.length; i++) {
        const idx = d.haz[i], tx = idx % W, ty = (idx - tx) / W, x = tx * TS, y = ty * TS;
        if (x < x0 || y < y0 || x > x1 || y > y1) continue;
        ctx.globalAlpha = 0.28 + 0.2 * Math.sin(time * 2.4 + idx * 0.9);
        ctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);
      }
      ctx.globalAlpha = 1;
    }
    if (d.spikes.length) {
      const ph = time % SPIKE_CYCLE.period;
      const out = ph >= SPIKE_CYCLE.outAt, warn = !out && ph >= SPIKE_CYCLE.warnAt;
      if (out || warn) {
        for (let i = 0; i < d.spikes.length; i++) {
          const idx = d.spikes[i], tx = idx % W, ty = (idx - tx) / W, x = tx * TS, y = ty * TS;
          if (x < x0 || y < y0 || x > x1 || y > y1) continue;
          for (let k = 0; k < 4; k++) {
            const sx = x + 3 + (k & 1) * 8, sy = y + 3 + (k >> 1) * 8;
            if (out) {
              ctx.fillStyle = '#d8d4cc'; ctx.fillRect(sx, sy - 3, 2, 4);
              ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, sy - 3, 1, 1);
            } else { ctx.fillStyle = '#ff5a3c'; ctx.fillRect(sx, sy, 2, 1); }
          }
        }
      }
    }
    if (world.locked && d.doors.length) {
      for (let i = 0; i < d.doors.length; i++) {
        const idx = d.doors[i], tx = idx % W, ty = (idx - tx) / W, x = tx * TS, y = ty * TS;
        ctx.fillStyle = '#2a1c16'; ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#8a6f5a';
        for (let k = 0; k < 4; k++) ctx.fillRect(x + 1 + k * 4, y, 2, TS);
        ctx.fillStyle = pal.wallTop || '#5a463c'; ctx.fillRect(x, y + 6, TS, 2);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // ground decals
  // ------------------------------------------------------------------------------------------
  zonePath(ctx, z, s) {
    ctx.beginPath();
    switch (z.shape) {
      case 'ring': {
        const inner = Math.max(0, z.inner || 0), outer = inner + (Math.max(inner, z.r || 0) - inner) * s;
        ctx.arc(z.x, z.y, Math.max(0.5, outer), 0, TAU);
        if (inner > 0.5) { ctx.moveTo(z.x + inner, z.y); ctx.arc(z.x, z.y, inner, 0, TAU, true); }
        break;
      }
      case 'line': {
        const dx = z.x2 - z.x, dy = z.y2 - z.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) { ctx.arc(z.x, z.y, Math.max(1, (z.width || 6) * s / 2), 0, TAU); break; }
        const hw = Math.max(0.5, (z.width || 6) * s / 2);
        const nx = (-dy / len) * hw, ny = (dx / len) * hw;
        ctx.moveTo(z.x + nx, z.y + ny);
        ctx.lineTo(z.x2 + nx, z.y2 + ny);
        ctx.lineTo(z.x2 - nx, z.y2 - ny);
        ctx.lineTo(z.x - nx, z.y - ny);
        ctx.closePath();
        break;
      }
      case 'cone': {
        const a = z.angle || 0, h = (z.arc || Math.PI / 2) / 2;
        ctx.moveTo(z.x, z.y);
        ctx.arc(z.x, z.y, Math.max(0.5, (z.r || 0) * s), a - h, a + h);
        ctx.closePath();
        break;
      }
      default:
        ctx.arc(z.x, z.y, Math.max(0.5, (z.r || 0) * s), 0, TAU);
    }
  }

  drawZones(ctx, zones, t) {
    if (!zones || !zones.length) return;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.dead || z.hidden) continue;
      const col = z.color || '#ff5a3c';
      const hostile = z.team !== 'player';
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      if (!z.active) {
        const p = z.delay > 0 ? clamp(z.age / z.delay, 0, 1) : 1;
        // faint full area
        ctx.globalAlpha = hostile ? 0.13 : 0.07;
        this.zonePath(ctx, z, 1);
        ctx.fill();
        // fill-up core: reaches the outline exactly when the zone triggers
        ctx.globalAlpha = hostile ? 0.2 + 0.25 * p : 0.1;
        this.zonePath(ctx, z, p);
        ctx.fill();
        // outline (blinks during the last 30 %)
        const blink = p > 0.7 ? ((t * 18) & 1 ? 1 : 0.4) : 0.85;
        ctx.globalAlpha = (hostile ? 0.95 : 0.4) * blink;
        ctx.lineWidth = 1;
        this.zonePath(ctx, z, 1);
        ctx.stroke();
      } else {
        const at = Math.max(0, z.age - (z.delay || 0));
        const dur = z.duration > 0 ? z.duration : 0.1;
        const flashK = clamp(1 - at / Math.min(0.25, Math.max(0.08, dur)), 0, 1);
        const lasting = dur > 0.5;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (lasting ? 0.16 + 0.05 * Math.sin(t * 6 + i) : 0.12) + 0.5 * flashK;
        this.zonePath(ctx, z, 1);
        ctx.fill();
        if (flashK > 0) {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.45 * flashK;
          ctx.fill();
        }
        ctx.globalAlpha = lasting ? 0.55 : 0.8 * Math.max(flashK, 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  drawEnemyDecals(ctx, es, t) {
    if (!es) return;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || e.hidden) continue;
      if (e.x < this.camX - CULL || e.y < this.camY - CULL || e.x > this.camX + this.w + CULL || e.y > this.camY + this.h + CULL) continue;
      const col = (e.def && e.def.color) || '#ff5a4a';
      if (e.spawnT > 0) {
        // spawn telegraph: shrinking ring + rising column
        const k = clamp(e.spawnT / (e.spawnMax || 0.6), 0, 1);
        const r = (e.r || 6) + 2 + 14 * k;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.35 + 0.55 * (1 - k);
        ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, r, r * 0.55, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.25 * (1 - k);
        ctx.fill();
        const hgt = 22 * (1 - k);
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.fillRect(Math.round(e.x) - 1, Math.round(e.y + 2 - hgt), 2, Math.round(hgt));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (e.elite && e.elite.length && e.affixes && e.affixes[0]) {
        // elite aura
        const ac = e.affixes[0].color || '#ffd35a';
        const r = (e.r || 6) + 3 + Math.sin(t * 4 + e.uid) * 0.8;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = ac;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 5 + e.uid);
        ctx.beginPath(); ctx.ellipse(e.x, e.y + (e.r || 6) * 0.55, r, r * 0.5, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = ac;
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // entities
  // ------------------------------------------------------------------------------------------
  pushSlot(n, kind, obj, y) {
    let s = this.slotPool[n];
    if (!s) s = this.slotPool[n] = { k: 0, o: null, y: 0 };
    s.k = kind; s.o = obj; s.y = y;
    this.list[n] = s;
    return n + 1;
  }

  inView(x, y, m) {
    return x > this.camX - m && y > this.camY - m && x < this.camX + this.w + m && y < this.camY + this.h + m;
  }

  drawEntities(ctx, world, run, t, dt, camX, camY) {
    let n = 0;
    const props = world.props, pk = world.pickups, es = world.enemies, p = world.player;
    if (props) for (let i = 0; i < props.length; i++) { const o = props[i]; if (!o.removed && this.inView(o.x, o.y, 40)) n = this.pushSlot(n, K_PROP, o, o.y); }
    if (pk) for (let i = 0; i < pk.length; i++) { const o = pk[i]; if (!o.dead && this.inView(o.x, o.y, 12)) n = this.pushSlot(n, K_PICKUP, o, o.y - 1); }
    if (es) for (let i = 0; i < es.length; i++) { const o = es[i]; if (!o.dead && !o.hidden && this.inView(o.x, o.y, CULL + (o.boss ? 40 : 0))) n = this.pushSlot(n, K_ENEMY, o, o.y + (o.flying ? 6 : 0)); }
    if (p) n = this.pushSlot(n, K_PLAYER, p, p.y);
    this.list.length = n;
    this.list.sort(byY);
    // dash after-images (recorded every ~16 ms while dashing)
    if (p) this.recordAfterImage(p, dt);
    for (let i = 0; i < n; i++) {
      const s = this.list[i];
      switch (s.k) {
        case K_PROP: this.drawProp(ctx, s.o, t, world); break;
        case K_PICKUP: this.drawPickup(ctx, s.o, t); break;
        case K_ENEMY: this.drawEnemy(ctx, s.o, t); break;
        default: this.drawPlayer(ctx, s.o, run, t);
      }
    }
    for (let i = 0; i < n; i++) this.list[i].o = null;
  }

  drawProp(ctx, pr, t) {
    const key = pr.sprite || 'prop_' + pr.kind;
    const r = pr.r || 6;
    if (pr.kind !== 'torch' && pr.kind !== 'portal') this.shadow(ctx, pr.x, pr.y + r * 0.6, r * 2.4, r * 1.0, 0.6);
    if (this.has(key)) {
      this.spr(ctx, key, pr.x, pr.y, this.opt(pr.anim || 'idle', t, false, pr.flash || 0, pr.used && pr.kind === 'shrine' ? 0.6 : 1, 1));
    } else this.placeholderProp(ctx, pr, t);
    // pedestal offers bob above with a rarity glow
    const off = pr.offer;
    if (off && !pr.used) {
      const bob = Math.sin(t * 2.4 + pr.x * 0.1) * 1.5;
      const ix = pr.x, iy = Math.round(pr.y - 15 + bob);
      const icon = off.icon || {};
      const rc = (off.rarity && RARITY_INFO[off.rarity] && RARITY_INFO[off.rarity].color) || icon.color || '#ffd35a';
      const gs = glowSprite(rc);
      if (gs) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4 + 0.12 * Math.sin(t * 3 + pr.x);
        ctx.drawImage(gs, ix - 12, iy - 12, 24, 24);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      let gkey = null;
      if (typeof icon === 'string') gkey = this.has(icon) ? icon : 'glyph_' + icon;
      else if (icon.glyph) gkey = 'glyph_' + icon.glyph;
      else if (icon.sprite) gkey = icon.sprite;
      if (gkey && this.has(gkey)) {
        const o = this.opt('idle', t, false, 0, 1, 1);
        o.color = icon.color || rc;
        this.spr(ctx, gkey, ix, iy, o);
      } else {
        ctx.fillStyle = '#0b0709';
        ctx.beginPath(); ctx.moveTo(ix, iy - 5); ctx.lineTo(ix + 4, iy); ctx.lineTo(ix, iy + 5); ctx.lineTo(ix - 4, iy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = icon.color || rc;
        ctx.beginPath(); ctx.moveTo(ix, iy - 4); ctx.lineTo(ix + 3, iy); ctx.lineTo(ix, iy + 4); ctx.lineTo(ix - 3, iy); ctx.closePath(); ctx.fill();
      }
    }
  }

  placeholderProp(ctx, pr, t) {
    const look = PROP_LOOK[pr.kind] || ['#8a7a6a', 'disc'];
    const col = pr.kind === 'chest' && pr.tier === 'rare' ? '#5a7ad0' : pr.kind === 'chest' && pr.tier === 'cursed' ? '#8a3aa0' : look[0];
    const x = Math.round(pr.x), y = Math.round(pr.y), r = Math.max(4, pr.r || 6);
    ctx.globalAlpha = pr.used ? 0.55 : 1;
    switch (look[1]) {
      case 'rect':
        ctx.fillStyle = '#0b0709'; ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
        ctx.fillStyle = col; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = shade(col, 0.4); ctx.fillRect(x - r, y - r, r * 2, 2);
        if (pr.kind === 'chest') { ctx.fillStyle = '#ffd35a'; ctx.fillRect(x - 1, y - 2, 2, 3); }
        break;
      case 'tri':
        ctx.fillStyle = col; ctx.strokeStyle = '#0b0709'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x + r, y + r * 0.6); ctx.lineTo(x - r, y + r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'diamond':
        ctx.fillStyle = col; ctx.strokeStyle = '#0b0709'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x, y + r * 0.8); ctx.lineTo(x - r * 0.7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'ring':
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, r + 2 + Math.sin(t * 3), (r + 2) * 1.3, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#1a0f2a'; ctx.fill();
        break;
      case 'torch':
        ctx.fillStyle = '#3a2418'; ctx.fillRect(x - 1, y - 4, 2, 8);
        ctx.fillStyle = (t * 10) & 1 ? '#ffd35a' : '#ff8a3c'; ctx.fillRect(x - 1, y - 7, 2, 3);
        break;
      default:
        this.disc(ctx, x, y, r, col, pr.used ? 0.55 : 1);
    }
    if (pr.flash > 0) { ctx.globalAlpha = Math.min(1, pr.flash) * 0.7; ctx.fillStyle = '#fff'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.globalAlpha = 1;
  }

  drawPickup(ctx, pk, t) {
    const age = pk.age || 0;
    const bob = Math.sin(age * 5 + pk.x * 0.3) * 1.2;
    const y = pk.y - 3 + bob;
    this.shadow(ctx, pk.x, pk.y + 2, 7, 3, 0.45);
    const key = 'pickup_' + pk.kind;
    const pop = age < 0.15 ? 0.6 + age / 0.15 * 0.4 : 1;
    if (this.has(key)) {
      this.spr(ctx, key, pk.x, y, this.opt('idle', t + pk.x * 0.01, false, 0, 1, pop));
    } else {
      const c = PICKUP_COLORS[pk.kind] || '#ffd35a';
      const s = (pk.kind === 'heart' ? 3 : 2) * pop;
      ctx.fillStyle = '#0b0709';
      ctx.beginPath(); ctx.moveTo(pk.x, y - s - 1); ctx.lineTo(pk.x + s + 1, y); ctx.lineTo(pk.x, y + s + 1); ctx.lineTo(pk.x - s - 1, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(pk.x, y - s); ctx.lineTo(pk.x + s, y); ctx.lineTo(pk.x, y + s); ctx.lineTo(pk.x - s, y); ctx.closePath(); ctx.fill();
    }
  }

  drawEnemy(ctx, e, t) {
    const def = e.def || {};
    const key = def.sprite || e.id;
    const r = e.r || 6;
    let alpha = 1, scale = 1;
    if (e.spawnT > 0) {
      const k = clamp(e.spawnT / (e.spawnMax || 0.6), 0, 1);
      alpha = 1 - k; scale = 0.45 + 0.55 * (1 - k);
      if (alpha < 0.05) return;
    }
    const has = this.has(key);
    const sz = has ? this.sizeOf(key, r) : null;
    const halfH = sz ? sz.h / 2 : r;
    const fy = e.flying ? -4 + Math.sin(t * 5 + (e.uid || 0)) * 1.2 : 0;
    // shadow
    const sw = sz ? Math.min(sz.w * 0.8, r * 2.8) : r * 2.2;
    this.shadow(ctx, e.x, e.y + (e.flying ? halfH + 1 : halfH * 0.75), sw * (e.flying ? 0.7 : 1), sw * 0.38, (e.flying ? 0.4 : 0.65) * alpha);
    const flash = e.frozen ? Math.max(e.flash || 0, 0.38) : e.flash || 0;
    if (has) {
      this.spr(ctx, key, e.x, e.y + fy, this.opt(e.anim, e.animT, e.flipX, flash, alpha, scale));
    } else {
      const col = def.color || '#c0508a';
      this.disc(ctx, e.x, e.y + fy, r * scale, flash > 0.5 ? '#ffffff' : col, alpha);
      const dir = e.flipX ? -1 : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = e.boss ? '#ffd35a' : '#ffffff';
      ctx.fillRect(Math.round(e.x + dir * r * 0.3), Math.round(e.y + fy - r * 0.25), 1, 1);
      ctx.fillRect(Math.round(e.x + dir * r * 0.3 + dir * 2), Math.round(e.y + fy - r * 0.25), 1, 1);
      ctx.globalAlpha = 1;
    }
    // frozen: ice block
    if (e.frozen) {
      const w = sz ? sz.w : r * 2, h = sz ? sz.h : r * 2;
      const x = Math.round(e.x - w / 2) - 1, y = Math.round(e.y + fy - h / 2) - 1;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#9fdcff';
      ctx.fillRect(x, y, w + 2, h + 2);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#dff4ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w + 1, h + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 2, y + 2, 2, 1);
      ctx.globalAlpha = 1;
    }
  }

  recordAfterImage(p, dt) {
    if (!p.dashing) { this.afterAcc = 0; return; }
    this.afterAcc += dt;
    if (this.afterAcc < 0.016 && this.afterT[(this.afterI + AFTER_N - 1) % AFTER_N] > this.time - 0.1) return;
    this.afterAcc = 0;
    const i = this.afterI;
    this.afterX[i] = p.x; this.afterY[i] = p.y; this.afterT[i] = this.time; this.afterF[i] = p.flipX ? 1 : 0;
    this.afterI = (i + 1) % AFTER_N;
  }

  drawPlayer(ctx, p, run, t) {
    const key = (p.character && p.character.sprite) || 'char_' + (run.character || 'bearer');
    const has = this.has(key);
    const sz = has ? this.sizeOf(key, p.r || 5) : { w: 10, h: 12 };
    const color = (p.character && p.character.color) || '#ff8a3c';
    // after-images
    for (let i = 0; i < AFTER_N; i++) {
      const age = this.time - this.afterT[i];
      if (age > 0.22 || age < 0) continue;
      const a = 0.42 * (1 - age / 0.22);
      if (has) {
        ctx.globalCompositeOperation = 'lighter';
        this.spr(ctx, key, this.afterX[i], this.afterY[i], this.opt('dash', 0, this.afterF[i] === 1, 1, a, 1));
        ctx.globalCompositeOperation = 'source-over';
      } else this.disc(ctx, this.afterX[i], this.afterY[i], p.r || 5, color, a);
    }
    this.shadow(ctx, p.x, p.y + sz.h * 0.42, Math.min(14, sz.w * 0.85), 4, 0.7);
    let alpha = 1;
    if (p.alive === false) alpha = clamp(run.dyingT != null ? run.dyingT / 1.6 : 0.4, 0.2, 1);
    else if (p.iframes > 0 && !p.dashing) alpha = (t * 18) & 1 ? 0.35 : 1;
    const flash = p.hurtT > 0 ? Math.min(1, p.hurtT / 0.25) : 0;
    if (has) this.spr(ctx, key, p.x, p.y, this.opt(p.anim || 'idle', p.animT || 0, p.flipX, flash, alpha, 1));
    else {
      this.disc(ctx, p.x, p.y, p.r || 5, flash > 0.5 ? '#ffffff' : color, alpha);
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(Math.round(p.x + Math.cos(p.aim || 0) * 2), Math.round(p.y - 1 + Math.sin(p.aim || 0) * 2), 1, 1);
    }
    // shield bubble
    if (p.shield > 0 && p.alive !== false) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#9ad0ff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 4);
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r || 5) + 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // aim ember orbiting the player
    if (p.alive !== false) {
      const a = p.aim || 0;
      const ex = p.x + Math.cos(a) * 11, ey = p.y - 2 + Math.sin(a) * 11;
      const gs = glowSprite('#ffb066');
      ctx.globalCompositeOperation = 'lighter';
      if (gs) { ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 9); ctx.drawImage(gs, ex - 4, ey - 4, 8, 8); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff3c0';
      ctx.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 2, 2);
      ctx.fillStyle = '#ff8a3c';
      const bx = Math.round(ex - Math.cos(a) * 2), by = Math.round(ey - Math.sin(a) * 2);
      ctx.fillRect(bx, by, 1, 1);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawProjectiles(ctx, ps, camX, camY) {
    if (!ps || !ps.length) return;
    const x0 = camX - 16, y0 = camY - 24, x1 = camX + this.w + 16, y1 = camY + this.h + 16;
    // glow pass
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dead || p.hidden) continue;
      const y = p.y - (p.z || 0);
      if (p.x < x0 || y < y0 || p.x > x1 || y > y1) continue;
      const gs = glowSprite(p.color || '#ffb347');
      if (!gs) break;
      const d = ((p.r || 3) * 2 + 9) * (p.scale || 1);
      ctx.globalAlpha = p.team === 'enemy' ? 0.6 : 0.38;
      ctx.drawImage(gs, p.x - d / 2, y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // sprite pass
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dead || p.hidden) continue;
      const z = p.z || 0;
      const y = p.y - z;
      if (p.x < x0 || y < y0 || p.x > x1 || y > y1) continue;
      if (z > 0.5 || p.arc) this.shadow(ctx, p.x, p.y + 1, (p.r || 3) * 2.4, (p.r || 3), clamp(0.6 - z * 0.006, 0.25, 0.6));
      const key = p.sprite || 'proj_orb';
      if (this.has(key)) {
        const o = this.opt('idle', p.age || 0, false, 0, 1, p.scale || 1);
        o.rot = Math.atan2(p.vy || 0, p.vx || 0) + (p.spin || 0) * (p.age || 0);
        o.color = p.color;
        this.spr(ctx, key, p.x, y, o);
      } else {
        const r = Math.max(1.5, (p.r || 3) * 0.8);
        ctx.fillStyle = p.team === 'enemy' ? '#1a0606' : '#0b0709';
        ctx.beginPath(); ctx.arc(p.x, y, r + 1, 0, TAU); ctx.fill();
        ctx.fillStyle = p.color || '#ffb347';
        ctx.beginPath(); ctx.arc(p.x, y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(p.x - 0.5), Math.round(y - 0.5), 1, 1);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // after lighting
  // ------------------------------------------------------------------------------------------
  drawBars(ctx, world, t) {
    const es = world.enemies;
    if (es) {
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        if (e.dead || e.hidden || e.spawnT > 0) continue;
        if (!this.inView(e.x, e.y, 8)) continue;
        const key = (e.def && e.def.sprite) || e.id;
        const halfH = this.has(key) ? this.sizeOf(key, e.r).h / 2 : (e.r || 6);
        const fy = e.flying ? -4 : 0;
        let top = Math.round(e.y + fy - halfH - 3);
        const elite = e.elite && e.elite.length > 0;
        if (!e.boss && (e.hpBarT > 0 || elite)) {
          const w = clamp(Math.round((e.r || 6) * 2 + 2), 10, 26);
          const x = Math.round(e.x - w / 2);
          const k = clamp(e.hp / (e.maxHp || 1), 0, 1);
          ctx.globalAlpha = elite ? 1 : clamp(e.hpBarT / 0.4, 0, 1);
          ctx.fillStyle = '#0b0507';
          ctx.fillRect(x - 1, top - 1, w + 2, 3);
          ctx.fillStyle = '#3a1416';
          ctx.fillRect(x, top, w, 1);
          ctx.fillStyle = elite ? (e.affixes && e.affixes[0] && e.affixes[0].color) || '#ffd35a' : '#ff4a3a';
          ctx.fillRect(x, top, Math.max(e.hp > 0 ? 1 : 0, Math.round(w * k)), 1);
          ctx.globalAlpha = 1;
          top -= 3;
        }
        // status pips
        const st = e.statuses;
        if (st) {
          let c = 0;
          for (const id in st) { if (STATUS_COLORS[id]) c++; }
          if (c) {
            c = Math.min(c, 5);
            let x = Math.round(e.x - (c * 3 - 1) / 2);
            let m = 0;
            for (const id in st) {
              const col = STATUS_COLORS[id];
              if (!col || m >= 5) continue;
              ctx.fillStyle = '#0b0507';
              ctx.fillRect(x - 1, top - 2, 4, 4);
              ctx.fillStyle = col;
              ctx.fillRect(x, top - 1, 2, 2);
              x += 3; m++;
            }
          }
        }
      }
    }
    // auto-aim target brackets
    const p = world.player;
    const tg = p && p.target;
    if (tg && !tg.dead && !tg.hidden && p.alive !== false) {
      const r = (tg.r || 6) + 4 + Math.sin(t * 8) * 0.6;
      const x = Math.round(tg.x), y = Math.round(tg.y + (tg.flying ? -4 : 0));
      ctx.fillStyle = '#ffe0a0';
      ctx.globalAlpha = 0.8;
      const L = 3, R = Math.round(r);
      ctx.fillRect(x - R, y - R, L, 1); ctx.fillRect(x - R, y - R, 1, L);
      ctx.fillRect(x + R - L + 1, y - R, L, 1); ctx.fillRect(x + R, y - R, 1, L);
      ctx.fillRect(x - R, y + R, L, 1); ctx.fillRect(x - R, y + R - L + 1, 1, L);
      ctx.fillRect(x + R - L + 1, y + R, L, 1); ctx.fillRect(x + R, y + R - L + 1, 1, L);
      ctx.globalAlpha = 1;
    }
    // interact marker over the highlighted prop
    const hint = world.interactHint;
    if (hint) {
      const pr = hint.prop;
      const hx = Math.round(pr ? pr.x : hint.x), hy = Math.round((pr ? pr.y - (pr.offer ? 26 : 14) : hint.y - 14) + Math.sin(t * 5) * 1.2);
      ctx.fillStyle = '#0b0709';
      ctx.fillRect(hx - 3, hy - 1, 7, 2); ctx.fillRect(hx - 2, hy + 1, 5, 1); ctx.fillRect(hx - 1, hy + 2, 3, 1);
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(hx - 2, hy - 1, 5, 1); ctx.fillRect(hx - 1, hy, 3, 1); ctx.fillRect(hx, hy + 1, 1, 1);
    }
  }

  drawIndicators(ctx, world, camX, camY) {
    const es = world.enemies;
    if (!es || !es.length) return;
    const vw = this.w, vh = this.h, cx = vw / 2, cy = vh / 2;
    const p = world.player;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || e.hidden || e.spawnT > 0 || e.untargetable) continue;
      const sx = e.x - camX, sy = e.y - camY;
      if (sx > -2 && sy > -2 && sx < vw + 2 && sy < vh + 2) continue;
      const dx = sx - cx, dy = sy - cy;
      const k = Math.min((vw / 2 - 6) / (Math.abs(dx) || 1e-6), (vh / 2 - 6) / (Math.abs(dy) || 1e-6));
      const ix = cx + dx * k, iy = cy + dy * k;
      const a = Math.atan2(dy, dx);
      const dist = p ? Math.hypot(e.x - p.x, e.y - p.y) : 200;
      const s = e.boss ? 5 : 3;
      const col = e.boss ? '#ffd35a' : e.elite && e.elite.length && e.affixes && e.affixes[0] ? e.affixes[0].color || '#ff5a4a' : '#ff5a4a';
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.globalAlpha = clamp(1.1 - dist / 420, 0.35, 0.95);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(ix + ca * s, iy + sa * s);
      ctx.lineTo(ix - ca * s - sa * s * 0.8, iy - sa * s + ca * s * 0.8);
      ctx.lineTo(ix - ca * s + sa * s * 0.8, iy - sa * s - ca * s * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawScreenFx(ctx, world, t) {
    const vw = this.w, vh = this.h;
    const vg = vignetteSprite('#000000', 0.75);
    if (vg) { ctx.globalAlpha = 0.6; ctx.drawImage(vg, -vw * 0.05, -vh * 0.05, vw * 1.1, vh * 1.1); ctx.globalAlpha = 1; }
    const p = world.player;
    if (p && p.alive !== false && p.stats && p.stats.maxHp > 0) {
      const ratio = p.hp / p.stats.maxHp;
      if (ratio < 0.35) {
        const k = (0.35 - Math.max(0, ratio)) / 0.35;
        const pulse = 0.6 + 0.4 * Math.sin(t * (4 + 3 * k));
        const red = vignetteSprite('#c01414', 1.15);
        if (red) {
          ctx.globalAlpha = clamp((0.3 + 0.6 * k) * pulse, 0, 0.9);
          ctx.drawImage(red, -vw * 0.02, -vh * 0.02, vw * 1.04, vh * 1.04);
          ctx.globalAlpha = 1;
        }
      }
    }
    const fx = this.fx;
    const fa = fx ? fx.flashAlpha : 0;
    if (fa > 0) {
      ctx.globalAlpha = fa;
      ctx.fillStyle = fx.flashColor || '#fff';
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalAlpha = 1;
    }
  }

  drawOverlay(world, camX, camY) {
    const o = this.octx;
    if (!o) return;
    const k = this.kx;
    const minPx = 10 * this.dpr;
    if (this.fx && this.fx.drawTexts) this.fx.drawTexts(o, camX, camY, k, minPx);
    // shop prices under pedestals
    const props = world.props;
    if (!props) return;
    let fontSet = false;
    const p = world.player;
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      const off = pr.offer;
      if (pr.removed || pr.used || !off || !(off.price > 0)) continue;
      if (!this.inView(pr.x, pr.y, 10)) continue;
      const px = Math.round(Math.max(minPx, 4.6 * k));
      if (!fontSet) {
        fontSet = true;
        o.font = `700 ${px}px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
        o.textAlign = 'left'; o.textBaseline = 'middle'; o.lineJoin = 'round';
        o.strokeStyle = 'rgba(12,6,10,0.92)';
      }
      const str = String(off.price);
      const tw = o.measureText(str).width;
      const d = px * 0.32;
      const total = tw + d * 2 + px * 0.25;
      const sx = Math.round((pr.x - camX) * k - total / 2), sy = Math.round((pr.y + 11 - camY) * this.ky);
      // spark diamond
      o.fillStyle = '#0b0709';
      o.beginPath(); o.moveTo(sx + d, sy - d - 2); o.lineTo(sx + d * 2 + 2, sy); o.lineTo(sx + d, sy + d + 2); o.lineTo(sx - 2, sy); o.closePath(); o.fill();
      o.fillStyle = '#ffd35a';
      o.beginPath(); o.moveTo(sx + d, sy - d); o.lineTo(sx + d * 2, sy); o.lineTo(sx + d, sy + d); o.lineTo(sx, sy); o.closePath(); o.fill();
      const tx = sx + d * 2 + px * 0.25;
      o.lineWidth = Math.max(2, px * 0.22);
      o.strokeText(str, tx, sy);
      o.fillStyle = p && p.sparks < off.price ? '#ff8a7a' : '#ffe9a0';
      o.fillText(str, tx, sy);
    }
  }
}

export default Renderer;
