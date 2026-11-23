// Deterministische Zufallsströme. Zustand ist reines JSON ({s:uint32}), damit Run-States speicherbar sind.

/** FNV-1a 32 bit */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeStream(seed) {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

/** mulberry32 – mutiert stream.s, liefert [0,1) */
export function next(stream) {
  stream.s = (stream.s + 0x6d2b79f5) >>> 0;
  let t = stream.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function int(stream, lo, hi) {
  return lo + Math.floor(next(stream) * (hi - lo + 1));
}

export function pick(stream, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(next(stream) * arr.length)];
}

export function weighted(stream, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, w);
  if (total <= 0) return pairs.length ? pairs[0][0] : undefined;
  let r = next(stream) * total;
  for (const [item, w] of pairs) {
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return item;
  }
  for (let i = pairs.length - 1; i >= 0; i--) if (pairs[i][1] > 0) return pairs[i][0];
  return pairs[pairs.length - 1][0];
}

export function shuffle(stream, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(stream) * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function chance(stream, p) {
  return next(stream) < p;
}

/** Nur hier ist Math.random erlaubt (Seed-Vorschlag für die UI). */
export function randomSeedString() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
