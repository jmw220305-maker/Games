// Touch controls: floating move stick (thumb side), optional aim stick, Dash/Skill/Swap/Interact buttons.
// Multi-touch via pointerIds; mirrored by settings.touchSide.
import { h, clear, icon, setVar, toggleClass } from './dom.js';
import { content } from './content.js';
import { clamp01 } from './format.js';

const STICK_R = 52;
const DEADZONE = 0.14;

export function createTouch(ui) {
  const input = () => ui.input;
  const layer = h('div.touch-layer', { attrs: { 'aria-hidden': 'true' } });
  const stickBase = h('div.stick-base', h('div.stick-knob'));
  const aimBase = h('div.stick-base.aim', h('div.stick-knob'));
  const mk = (name, cls, label) => h(`div.tc-btn.tc-${name}${cls ? '.' + cls : ''}`, { data: { action: name } }, h('div.tc-ico'), label ? h('span.tc-label', { text: label }) : null);
  const btn = {
    dash: mk('dash', 'big', 'Sprint'),
    skill: mk('skill', 'ring', ''),
    swap: mk('swap', 'small', 'Wechsel'),
    interact: mk('interact', 'small', 'Benutzen'),
  };
  btn.dash.querySelector('.tc-ico').appendChild(icon({ glyph: 'wing', color: '#ffe2b8' }, 32, { name: 'S' }));
  btn.interact.querySelector('.tc-ico').appendChild(icon({ glyph: 'hand', color: '#ffe2b8' }, 24, { name: 'B' }));
  btn.dashCount = h('span.tc-count');
  btn.dash.appendChild(btn.dashCount);
  const cluster = h('div.tc-cluster', btn.interact, btn.swap, btn.skill, btn.dash);
  layer.append(h('div.tc-zone-hint'), stickBase, aimBase, cluster);

  const pointers = new Map(); // pointerId -> { kind: 'move'|'aim'|'btn', ox, oy, name }
  let visible = false;

  function sideRight() { return ui.settings().touchSide !== 'left'; }

  function placeBase(base, x, y) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const m = STICK_R + 8;
    const cx = Math.max(m, Math.min(vw - m, x)), cy = Math.max(m, Math.min(vh - m, y));
    base.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
    base.classList.add('on');
    return { cx, cy };
  }

  function setKnob(base, dx, dy) {
    base.firstChild.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
  }

  function vec(p, x, y) {
    let dx = x - p.ox, dy = y - p.oy;
    let d = Math.hypot(dx, dy);
    // floating stick follows the thumb when dragged far
    if (d > STICK_R * 1.35) {
      const k = (d - STICK_R * 1.35) / d;
      p.ox += dx * k; p.oy += dy * k;
      const base = p.kind === 'move' ? stickBase : aimBase;
      base.style.transform = `translate(${Math.round(p.ox)}px, ${Math.round(p.oy)}px)`;
      dx = x - p.ox; dy = y - p.oy; d = Math.hypot(dx, dy);
    }
    const cl = Math.min(d, STICK_R);
    const kx = d > 0 ? (dx / d) * cl : 0, ky = d > 0 ? (dy / d) * cl : 0;
    setKnob(p.kind === 'move' ? stickBase : aimBase, kx, ky);
    let m = cl / STICK_R;
    if (m < DEADZONE) return { x: 0, y: 0, m: 0 };
    m = (m - DEADZONE) / (1 - DEADZONE);
    return { x: (dx / d) * m, y: (dy / d) * m, m };
  }

  function press(name, down) {
    const inp = input();
    if (inp && typeof inp.setVirtualButton === 'function') inp.setVirtualButton(name, down);
    const b = btn[name];
    if (b) toggleClass(b, 'down', down);
  }

  layer.addEventListener('pointerdown', (e) => {
    if (!visible) return;
    e.preventDefault();
    const target = e.target.closest('.tc-btn');
    try { layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (target) {
      const name = target.dataset.action;
      pointers.set(e.pointerId, { kind: 'btn', name });
      press(name, true);
      return;
    }
    const vw = window.innerWidth;
    const inMoveZone = sideRight() ? e.clientX < vw * 0.45 : e.clientX > vw * 0.55;
    const moveTaken = [...pointers.values()].some((p) => p.kind === 'move');
    const aimTaken = [...pointers.values()].some((p) => p.kind === 'aim');
    if (inMoveZone && !moveTaken) {
      const c = placeBase(stickBase, e.clientX, e.clientY);
      pointers.set(e.pointerId, { kind: 'move', ox: c.cx, oy: c.cy });
      setKnob(stickBase, e.clientX - c.cx, e.clientY - c.cy);
    } else if (!inMoveZone && !aimTaken) {
      const c = placeBase(aimBase, e.clientX, e.clientY);
      pointers.set(e.pointerId, { kind: 'aim', ox: c.cx, oy: c.cy, active: false });
      press('fire', true);
    }
  });

  layer.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || p.kind === 'btn') return;
    e.preventDefault();
    const v = vec(p, e.clientX, e.clientY);
    const inp = input();
    if (p.kind === 'move') inp?.setVirtualMove?.(v.x, v.y);
    else if (v.m > 0) { p.active = true; inp?.setVirtualAim?.(v.x, v.y, true); }
  });

  const release = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    const inp = input();
    if (p.kind === 'btn') press(p.name, false);
    else if (p.kind === 'move') { inp?.setVirtualMove?.(0, 0); stickBase.classList.remove('on'); setKnob(stickBase, 0, 0); }
    else if (p.kind === 'aim') { inp?.setVirtualAim?.(0, 0, false); press('fire', false); aimBase.classList.remove('on'); setKnob(aimBase, 0, 0); }
  };
  layer.addEventListener('pointerup', release);
  layer.addEventListener('pointercancel', release);
  layer.addEventListener('lostpointercapture', release);
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  function releaseAll() {
    for (const id of [...pointers.keys()]) release({ pointerId: id });
    const inp = input();
    inp?.setVirtualMove?.(0, 0);
    inp?.setVirtualAim?.(0, 0, false);
    for (const n of ['fire', 'dash', 'skill', 'swap', 'interact']) press(n, false);
  }

  const last = { skillKey: '', swapKey: '', dashMax: -1 };

  return {
    el: layer,
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      toggleClass(layer, 'show', v);
      if (!v) releaseAll();
    },
    releaseAll,
    update() {
      if (!visible) return;
      toggleClass(layer, 'side-left', !sideRight());
      const run = ui.game.run;
      const p = run && run.player;
      if (!p) return;
      // skill
      const sk = p.skill;
      const skey = sk && sk.def ? sk.def.id || sk.def.name : '';
      if (skey !== last.skillKey) {
        last.skillKey = skey;
        const ico = btn.skill.querySelector('.tc-ico');
        clear(ico);
        if (sk && sk.def) ico.appendChild(icon(sk.def.icon, 32, { name: sk.def.name }));
        toggleClass(btn.skill, 'is-hidden', !skey);
      }
      if (sk) {
        const f = sk.cd > 0 ? clamp01(sk.cd / (sk.cdMax || (sk.def && sk.def.cooldown) || 1)) : 0;
        setVar(btn.skill, '--cd', Math.round(f * 100) / 100);
        toggleClass(btn.skill, 'ready', f <= 0);
      }
      // swap shows the other weapon
      const ws = Array.isArray(p.weapons) ? p.weapons : [];
      const other = ws[(p.weaponIndex | 0) === 0 ? 1 : 0];
      const okey = other ? other.id || (other.def && other.def.id) : '';
      if (okey !== last.swapKey) {
        last.swapKey = okey;
        const ico = btn.swap.querySelector('.tc-ico');
        clear(ico);
        const def = other && (other.def || content.WEAPONS[okey]);
        if (other) ico.appendChild(icon(def && def.icon, 24, { name: def ? def.name : '?' }));
        toggleClass(btn.swap, 'is-hidden', !other);
      }
      // dash charges
      const d = p.dash || {};
      const max = d.max || 1;
      const ch = Math.max(0, Math.min(max, d.charges ?? max));
      btn.dashCount.textContent = max > 1 ? String(ch) : '';
      toggleClass(btn.dash, 'empty', ch <= 0);
      // interact pulse
      const hint = run.world && run.world.interactHint;
      toggleClass(btn.interact, 'pulse', !!hint);
      toggleClass(btn.interact, 'dim', !hint);
    },
  };
}
