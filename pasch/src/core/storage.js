// localStorage mit try/catch; in Node (oder wenn gesperrt) In-Memory-Fallback.
const memory = new Map();

function backend() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  } catch (e) {
    /* gesperrt */
  }
  return null;
}

export function load(key, fallback) {
  try {
    const ls = backend();
    let raw = null;
    if (ls) raw = ls.getItem(key);
    if (raw === null || raw === undefined) raw = memory.has(key) ? memory.get(key) : null;
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function save(key, value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch (e) {
    return false;
  }
  memory.set(key, raw);
  try {
    const ls = backend();
    if (ls) ls.setItem(key, raw);
  } catch (e) {
    /* Speicher voll/gesperrt: In-Memory bleibt */
  }
  return true;
}

export function remove(key) {
  memory.delete(key);
  try {
    const ls = backend();
    if (ls) ls.removeItem(key);
  } catch (e) {
    /* egal */
  }
}
