export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sum = (arr, fn) => arr.reduce((acc, x, i) => acc + (fn ? fn(x, i) : x), 0);
export function countBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn ? fn(x) : x;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
