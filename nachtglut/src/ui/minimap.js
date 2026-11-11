// Minimap + large map overlay drawn on canvases from run.floor.rooms (gx/gy grid).
import { mapLayout, ROOM_ICON } from './format.js';

const TS = 16;

function drawShape(g, shape, x, y, s, color) {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, s * 0.22);
  g.beginPath();
  switch (shape) {
    case 'skull':
      g.arc(x, y - s * 0.12, s * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - s * 0.24, y + s * 0.1, s * 0.48, s * 0.32);
      g.fillStyle = '#1a0f0b';
      g.fillRect(x - s * 0.24, y - s * 0.18, s * 0.16, s * 0.16);
      g.fillRect(x + s * 0.08, y - s * 0.18, s * 0.16, s * 0.16);
      return;
    case 'coin':
      g.arc(x, y, s * 0.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(x - s * 0.06, y - s * 0.24, s * 0.12, s * 0.48);
      return;
    case 'chest':
      g.fillRect(x - s * 0.42, y - s * 0.22, s * 0.84, s * 0.5);
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.fillRect(x - s * 0.42, y - s * 0.04, s * 0.84, s * 0.08);
      return;
    case 'diamond':
      g.moveTo(x, y - s * 0.45); g.lineTo(x + s * 0.35, y); g.lineTo(x, y + s * 0.45); g.lineTo(x - s * 0.35, y); g.closePath();
      g.fill();
      return;
    case 'anvil':
      g.fillRect(x - s * 0.42, y - s * 0.24, s * 0.84, s * 0.2);
      g.fillRect(x - s * 0.14, y - s * 0.04, s * 0.28, s * 0.24);
      g.fillRect(x - s * 0.3, y + s * 0.2, s * 0.6, s * 0.14);
      return;
    case 'cross':
      g.fillRect(x - s * 0.12, y - s * 0.4, s * 0.24, s * 0.8);
      g.fillRect(x - s * 0.4, y - s * 0.12, s * 0.8, s * 0.24);
      return;
    case 'x':
      g.moveTo(x - s * 0.32, y - s * 0.32); g.lineTo(x + s * 0.32, y + s * 0.32);
      g.moveTo(x + s * 0.32, y - s * 0.32); g.lineTo(x - s * 0.32, y + s * 0.32);
      g.lineWidth = Math.max(1.5, s * 0.2);
      g.stroke();
      return;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? s * 0.2 : s * 0.46;
        if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      return;
    case 'flame':
      g.moveTo(x, y - s * 0.46);
      g.quadraticCurveTo(x + s * 0.42, y, x + s * 0.2, y + s * 0.38);
      g.lineTo(x - s * 0.2, y + s * 0.38);
      g.quadraticCurveTo(x - s * 0.42, y, x, y - s * 0.46);
      g.fill();
      return;
    default:
      g.arc(x, y, s * 0.22, 0, Math.PI * 2);
      g.fill();
  }
}

/**
 * Draw a floor map.
 * opts: { mode: 'mini'|'full', cell, player: {x,y}, room (current Room), time }
 */
export function drawMap(canvas, floor, roomId, opts = {}) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  const W = Math.max(1, Math.round(cw * dpr)), H = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  const rooms = floor && Array.isArray(floor.rooms) ? floor.rooms : [];
  const lay = mapLayout(rooms, roomId);
  if (!lay.cells.length) return;
  const full = opts.mode === 'full';
  let cell = opts.cell || 16;
  if (full) {
    const pad = 24;
    cell = Math.max(10, Math.min(64, Math.floor(Math.min((cw - pad * 2) / Math.max(1, lay.cols), (ch - pad * 2) / Math.max(1, lay.rows)))));
  }
  const cellW = cell, cellH = Math.round(cell * 0.78);
  const gap = Math.max(3, Math.round(cell * 0.28));
  const roomW = cellW - gap, roomH = cellH - gap;
  let ox, oy;
  const cur = lay.cells.find((c) => c.current);
  if (!full && cur) {
    ox = cw / 2 - (cur.col * cellW + cellW / 2);
    oy = ch / 2 - (cur.row * cellH + cellH / 2);
  } else {
    ox = (cw - lay.cols * cellW) / 2;
    oy = (ch - lay.rows * cellH) / 2;
  }
  const pos = new Map();
  for (const c of lay.cells) pos.set(c.id, { x: ox + c.col * cellW + cellW / 2, y: oy + c.row * cellH + cellH / 2, c });

  // connectors
  g.strokeStyle = 'rgba(160, 120, 90, 0.75)';
  g.lineWidth = Math.max(2, Math.round(cell * 0.14));
  g.beginPath();
  for (const l of lay.links) {
    const a = pos.get(l.a), b = pos.get(l.b);
    if (!a || !b) continue;
    g.moveTo(Math.round(a.x), Math.round(a.y));
    g.lineTo(Math.round(b.x), Math.round(b.y));
  }
  g.stroke();

  // rooms
  for (const { x, y, c } of pos.values()) {
    const rx = Math.round(x - roomW / 2), ry = Math.round(y - roomH / 2);
    if (c.current) {
      g.shadowColor = 'rgba(255, 140, 60, 0.9)';
      g.shadowBlur = full ? 14 : 8;
      g.fillStyle = '#ff9a4a';
    } else if (c.visited) {
      g.fillStyle = c.type === 'boss' ? '#5a2620' : '#5c4536';
    } else {
      g.fillStyle = '#211915';
    }
    g.fillRect(rx, ry, roomW, roomH);
    g.shadowBlur = 0;
    g.strokeStyle = c.current ? '#ffe2b8' : c.visited ? '#8a6a52' : '#5a463c';
    g.lineWidth = 1;
    g.strokeRect(rx + 0.5, ry + 0.5, roomW - 1, roomH - 1);
    const ic = ROOM_ICON[c.type];
    const showIcon = ic && c.type !== 'combat' && (c.visited || c.type === 'boss') && !(c.current && !full && c.type === 'start');
    if (showIcon) {
      const s = Math.min(roomW, roomH) * 0.78;
      drawShape(g, ic.shape, x, y, s, c.current ? '#2a140a' : ic.color);
    }
  }

  // player marker inside the current room
  if (cur && opts.player && opts.room && opts.room.w && opts.room.h) {
    const p = pos.get(cur.id);
    const fx = Math.max(0.08, Math.min(0.92, opts.player.x / (opts.room.w * TS)));
    const fy = Math.max(0.08, Math.min(0.92, opts.player.y / (opts.room.h * TS)));
    const px = p.x - roomW / 2 + fx * roomW, py = p.y - roomH / 2 + fy * roomH;
    g.fillStyle = '#fff6e0';
    g.beginPath();
    g.arc(px, py, Math.max(1.6, cell * 0.11), 0, Math.PI * 2);
    g.fill();
  }
}

/** Signature that changes whenever the minimap would look different (cheap per frame). */
export function mapSignature(floor, roomId) {
  if (!floor || !Array.isArray(floor.rooms)) return '';
  let seen = 0, visited = 0;
  for (const r of floor.rooms) {
    if (!r) continue;
    if (r.seen) seen++;
    if (r.visited) visited++;
  }
  return `${floor.index ?? ''}|${floor.seed ?? ''}|${roomId}|${seen}|${visited}`;
}

export { ROOM_ICON };
