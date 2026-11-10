export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);
export const dist2 = (x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0; return dx * dx + dy * dy; };
export const angleTo = (x0, y0, x1, y1) => Math.atan2(y1 - y0, x1 - x0);
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
/** shortest signed angle difference a->b in (-PI, PI] */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
/** rotate angle a toward b by at most maxStep */
export function rotateToward(a, b, maxStep) {
  const d = angleDiff(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}
export function norm(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l, len: l } : { x: 0, y: 0, len: 0 };
}
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** distance from point p to segment a-b */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
