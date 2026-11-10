// Deterministic seeded RNG (sfc32). All gameplay randomness must go through an RNG instance
// so that runs are reproducible from a seed.

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = Date.now()) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = s ^ 0xdeadbeef;
    for (let i = 0; i < 15; i++) this.next();
  }
  /** float in [0,1) */
  next() {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  /** float in [a,b) */
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  /** integer in [a,b] inclusive */
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  angle() { return this.next() * Math.PI * 2; }
  pick(arr) { return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined; }
  /** weighted pick. weightFn(item) -> number >= 0 (default item.weight ?? 1) */
  weighted(items, weightFn = (it) => it.weight ?? 1) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it));
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weightFn(it)); if (r < 0) return it; }
    return items[items.length - 1];
  }
  /** in-place Fisher-Yates */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** n distinct items (or fewer if arr is short) */
  sample(arr, n) { return this.shuffle(arr.slice()).slice(0, n); }
  /** independent child stream; does not disturb this stream beyond one draw */
  fork(label = '') { return new RNG((Math.floor(this.next() * 4294967296) ^ hashString(label)) >>> 0); }
  get state() { return [this.a, this.b, this.c, this.d]; }
  set state(s) { [this.a, this.b, this.c, this.d] = s; }
}
