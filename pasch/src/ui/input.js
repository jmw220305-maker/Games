// Eingabe: Tastatur-Stapel (oberste Ebene bekommt die Tasten zuerst) und Langdruck.

const stack = [];

/** Handler registrieren: fn(e) → true = verbraucht (preventDefault), 'stop' = verbraucht ohne preventDefault. Gibt remove() zurück. Zuletzt registriert = zuerst gefragt. */
export function pushKeys(fn) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.key !== 'Escape') return;
    for (let i = stack.length - 1; i >= 0; i--) {
      try {
        const r = stack[i](e);
        if (r === 'stop') return;
        if (r) { e.preventDefault(); return; }
      } catch (err) { console.error(err); }
    }
  });
}

/**
 * Langdruck (Touch/Stift): nach ms → onLong(ev). Ein Langdruck unterdrückt den folgenden click.
 * Gibt detach() zurück.
 */
export function longPress(el, onLong, ms = 350) {
  let timer = 0;
  let sx = 0, sy = 0;
  let fired = false;
  const down = (e) => {
    if (e.pointerType === 'mouse') return;
    fired = false;
    sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; onLong(e); }, ms);
  };
  const move = (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); timer = 0; } };
  const up = () => { clearTimeout(timer); timer = 0; };
  const click = (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } };
  const ctx = (e) => { if (fired || timer) e.preventDefault(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('click', click, true);
  el.addEventListener('contextmenu', ctx);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('click', click, true);
    el.removeEventListener('contextmenu', ctx);
  };
}
