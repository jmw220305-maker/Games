// Tiny synchronous event bus. See docs/ARCHITECTURE.md for the list of game events.
class Bus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    let l = this.map.get(evt);
    if (!l) this.map.set(evt, (l = []));
    l.push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    const l = this.map.get(evt);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  emit(evt, payload) {
    const l = this.map.get(evt);
    if (l) for (const fn of l.slice()) {
      try { fn(payload); } catch (err) { console.error(`[bus] handler for "${evt}" failed`, err); }
    }
    const any = this.map.get('*');
    if (any) for (const fn of any.slice()) {
      try { fn(evt, payload); } catch (err) { console.error('[bus] wildcard handler failed', err); }
    }
  }
  clear() { this.map.clear(); }
}
export const bus = new Bus();
export { Bus };
