// Unified input: keyboard + mouse, gamepad and virtual (touch) controls feed the same action state.
// Actions: fire dash skill swap interact pause map

const KEYMAP = {
  Space: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
  KeyQ: 'skill', KeyF: 'skill',
  KeyE: 'interact', Enter: 'interact',
  KeyR: 'swap', Tab: 'swap',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'map',
};
const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

class Input {
  constructor() {
    this.keys = new Set();
    this.buttons = Object.create(null);     // action -> held (keyboard/mouse)
    this.virtual = Object.create(null);     // action -> held (touch)
    this.pad = Object.create(null);         // action -> held (gamepad)
    this.pressedSet = new Set();            // edge-triggered actions since last consume
    this.move = { x: 0, y: 0 };
    this.vmove = { x: 0, y: 0 };
    this.vaim = { x: 0, y: 0, active: false };
    this.padAim = { x: 0, y: 0, active: false };
    this.mouse = { x: 0, y: 0, moved: false, inside: false };
    this.aimMode = 'mouse';                 // 'mouse' | 'stick' | 'pad' | 'auto'
    this.isTouch = false;
    this.lastDevice = 'keyboard';           // 'keyboard' | 'touch' | 'gamepad'
    this.enabled = true;
    this.canvas = null;
    this._bound = false;
  }

  init(canvas) {
    this.canvas = canvas;
    if (this._bound || typeof window === 'undefined') return;
    this._bound = true;
    this.isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    const isTyping = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.lastDevice = 'keyboard';
      if (e.code in MOVE_KEYS || e.code in KEYMAP) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) { this.buttons[a] = true; this.pressedSet.add(a); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a) {
        // released only if no other key mapped to the same action is still held
        let still = false;
        for (const k of this.keys) if (KEYMAP[k] === a) still = true;
        if (!still) this.buttons[a] = false;
      }
    });
    window.addEventListener('blur', () => this.releaseAll());
    const onMouse = (e) => {
      if (e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
      this.mouse.moved = true;
      this.mouse.inside = true;
      if (this.aimMode !== 'mouse' && e.type === 'pointermove') this.aimMode = 'mouse';
    };
    window.addEventListener('pointermove', onMouse);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { this.lastDevice = 'touch'; return; }
      this.lastDevice = 'keyboard';
      onMouse(e);
      this.aimMode = 'mouse';
      if (e.button === 0) { this.buttons.fire = true; this.pressedSet.add('fire'); }
      if (e.button === 2) { this.buttons.skill = true; this.pressedSet.add('skill'); }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.buttons.fire = false;
      if (e.button === 2) this.buttons.skill = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  releaseAll() {
    this.keys.clear();
    for (const k in this.buttons) this.buttons[k] = false;
    for (const k in this.virtual) this.virtual[k] = false;
    this.vmove.x = this.vmove.y = 0;
    this.vaim.active = false;
  }

  // --- virtual (touch) controls -------------------------------------------------
  setVirtualMove(x, y) { this.vmove.x = x; this.vmove.y = y; if (x || y) this.lastDevice = 'touch'; }
  setVirtualAim(x, y, active) {
    this.vaim.x = x; this.vaim.y = y; this.vaim.active = !!active;
    if (active) { this.aimMode = 'stick'; this.lastDevice = 'touch'; }
  }
  setVirtualButton(name, down) {
    if (down && !this.virtual[name]) this.pressedSet.add(name);
    this.virtual[name] = !!down;
    if (down) this.lastDevice = 'touch';
  }

  /** call once per rendered frame before game updates */
  poll() {
    // keyboard movement
    let x = 0, y = 0;
    for (const k of this.keys) { const m = MOVE_KEYS[k]; if (m) { x += m[0]; y += m[1]; } }
    x = Math.sign(x); y = Math.sign(y);
    // gamepad
    this.padAim.active = false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = 0.22;
      const lx = p.axes[0] || 0, ly = p.axes[1] || 0, rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      if (Math.hypot(lx, ly) > dz) { x += lx; y += ly; this.lastDevice = 'gamepad'; }
      if (Math.hypot(rx, ry) > 0.35) { this.padAim.x = rx; this.padAim.y = ry; this.padAim.active = true; this.aimMode = 'pad'; this.lastDevice = 'gamepad'; }
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const map = { fire: b(7) || b(5), dash: b(0) || b(6), skill: b(2) || b(4), swap: b(3), interact: b(1), pause: b(9), map: b(8) };
      for (const a in map) {
        if (map[a] && !this.pad[a]) { this.pressedSet.add(a); this.lastDevice = 'gamepad'; }
        this.pad[a] = map[a];
      }
      break;
    }
    x += this.vmove.x; y += this.vmove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.move.x = x; this.move.y = y;
  }

  down(name) { return this.enabled && !!(this.buttons[name] || this.virtual[name] || this.pad[name]); }
  /** edge-triggered; stays true until consume() */
  pressed(name) { return this.enabled && this.pressedSet.has(name); }
  take(name) { const had = this.pressedSet.has(name); this.pressedSet.delete(name); return this.enabled && had; }
  consume() { this.pressedSet.clear(); }
}

export const input = new Input();
export { Input };
