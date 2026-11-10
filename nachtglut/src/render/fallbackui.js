// Minimal fallback UI, used only when ./ui/ui.js is missing or fails to load. The real UI replaces it
// completely (main.js simply never creates this one). Start prompt, tiny HUD on the overlay canvas,
// choice / pause / death panels as plain DOM buttons, and simple touch controls.
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const RARITY = { common: '#b9b3a8', uncommon: '#5fd38d', rare: '#6aa9ff', legendary: '#ffb347', curse: '#c04bd6' };

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}
const BTN = 'pointer-events:auto;display:block;width:100%;margin:6px 0;padding:10px 12px;border-radius:6px;border:1px solid #6b5245;'
  + 'background:#1c1311;color:#f3e6d0;font:600 15px ' + FONT + ';text-align:left;cursor:pointer;touch-action:manipulation;';

export function createFallbackUI({ game, bus, input, renderer, root, startOpts }) {
  const ui = { game, shown: null, choice: null };
  root = root || document.body;
  const panel = el('div', 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);'
    + 'overflow:auto;padding:16px;border-radius:10px;background:rgba(14,9,8,0.92);border:1px solid #5a3a2a;box-shadow:0 0 40px rgba(255,120,40,0.15);'
    + 'color:#f3e6d0;font:15px ' + FONT + ';pointer-events:auto;display:none;z-index:20;');
  root.appendChild(panel);
  const start = () => { try { game.startRun({ character: 'bearer', difficulty: 0, ...(startOpts || {}) }); } catch (err) { console.error('[fallback-ui] startRun failed', err); } };

  function show(kind, build) {
    ui.shown = kind;
    panel.textContent = '';
    build(panel);
    panel.style.display = 'block';
  }
  function hide() { ui.shown = null; ui.choice = null; panel.style.display = 'none'; panel.textContent = ''; }
  function button(parent, label, desc, onClick, color) {
    const b = el('button', BTN + (color ? `border-color:${color};` : ''));
    const t = el('div', 'font-weight:700;' + (color ? `color:${color};` : ''), label);
    b.appendChild(t);
    if (desc) b.appendChild(el('div', 'font-weight:400;font-size:13px;opacity:.85;margin-top:2px;', desc));
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    parent.appendChild(b);
    return b;
  }

  function showMenu() {
    show('menu', (p) => {
      p.style.textAlign = 'center';
      p.appendChild(el('div', 'font:800 30px ' + FONT + ';letter-spacing:2px;color:#ffb066;margin:4px 0 6px;', 'Nachtglut'));
      p.appendChild(el('div', 'opacity:.85;margin-bottom:10px;', 'Klicken/Tippen zum Start'));
      const b = button(p, 'Abstieg beginnen', 'WASD bewegen · Maus zielen/feuern · Leertaste Ausweichen · Q Fähigkeit · E Interagieren', start, '#ffb066');
      b.style.textAlign = 'center';
    });
    panel.onclick = start;
  }
  function showChoice(choice) {
    ui.choice = choice;
    show('choice', (p) => {
      panel.onclick = null;
      p.style.textAlign = 'left';
      p.appendChild(el('div', 'font:800 20px ' + FONT + ';color:#ffd35a;margin-bottom:4px;', choice.title || 'Wähle'));
      if (choice.text) p.appendChild(el('div', 'opacity:.85;margin-bottom:6px;', choice.text));
      for (const o of choice.options || []) {
        const b = button(p, o.name || o.id, o.desc || '', () => { if (o.pick) o.pick(); }, RARITY[o.rarity] || null);
        if (o.disabled) { b.disabled = true; b.style.opacity = '0.45'; }
      }
      const row = el('div', 'display:flex;gap:8px;');
      if (typeof choice.reroll === 'function' && choice.rerolls > 0) {
        button(row, `Neu würfeln (${choice.rerolls})`, null, () => { choice.reroll(); showChoice(choice); });
      }
      if (typeof choice.skip === 'function') button(row, choice.skipLabel || 'Überspringen', null, () => choice.skip());
      if (row.childNodes.length) p.appendChild(row);
    });
  }
  function showPause() {
    show('paused', (p) => {
      panel.onclick = null;
      p.style.textAlign = 'center';
      p.appendChild(el('div', 'font:800 22px ' + FONT + ';margin-bottom:8px;', 'Pausiert'));
      button(p, 'Weiter', null, () => game.resume(), '#ffb066');
      button(p, 'Aufgeben', null, () => game.abandonRun());
    });
  }
  function showEnd(victory) {
    show(victory ? 'victory' : 'dead', (p) => {
      panel.onclick = null;
      p.style.textAlign = 'center';
      p.appendChild(el('div', 'font:800 24px ' + FONT + ';margin-bottom:6px;color:' + (victory ? '#ffd35a' : '#ff6a5a') + ';',
        victory ? 'Das Sonnenherz glüht wieder' : 'Zu Asche zerfallen'));
      const run = game.run;
      if (run && run.stats) p.appendChild(el('div', 'opacity:.85;margin-bottom:8px;', `Ebene ${run.floorIndex} · ${run.stats.kills || 0} Gegner besiegt`));
      button(p, 'Nochmal', null, () => game.toMenu(), '#ffb066');
    });
  }

  bus.on('ui:choice', (c) => { if (c) showChoice(c); });

  // ---------------------------------------------------------------- touch controls
  const touch = { layer: null, move: null, aim: null, base: null, knob: null };
  if (input.isTouch) {
    const layer = el('div', 'position:fixed;inset:0;pointer-events:auto;touch-action:none;z-index:5;display:none;');
    root.appendChild(layer);
    touch.layer = layer;
    touch.base = el('div', 'position:fixed;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;border:2px solid rgba(255,190,140,.35);background:rgba(255,160,90,.06);display:none;pointer-events:none;z-index:6;');
    touch.knob = el('div', 'position:fixed;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(255,180,120,.35);display:none;pointer-events:none;z-index:6;');
    root.appendChild(touch.base); root.appendChild(touch.knob);
    const R = 48;
    layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const left = e.clientX < window.innerWidth * 0.5;
      const s = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      if (left && !touch.move) {
        touch.move = s;
        touch.base.style.left = touch.knob.style.left = s.ox + 'px';
        touch.base.style.top = touch.knob.style.top = s.oy + 'px';
        touch.base.style.display = touch.knob.style.display = 'block';
      } else if (!left && !touch.aim) touch.aim = s;
      try { layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    layer.addEventListener('pointermove', (e) => {
      const m = touch.move, a = touch.aim;
      if (m && e.pointerId === m.id) {
        let dx = e.clientX - m.ox, dy = e.clientY - m.oy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx *= R / l; dy *= R / l; }
        touch.knob.style.left = m.ox + dx + 'px';
        touch.knob.style.top = m.oy + dy + 'px';
        input.setVirtualMove(l > 6 ? dx / R : 0, l > 6 ? dy / R : 0);
      } else if (a && e.pointerId === a.id) {
        const dx = e.clientX - a.ox, dy = e.clientY - a.oy;
        if (Math.hypot(dx, dy) > 12) input.setVirtualAim(dx, dy, true);
      }
    });
    const end = (e) => {
      if (touch.move && e.pointerId === touch.move.id) {
        touch.move = null; input.setVirtualMove(0, 0);
        touch.base.style.display = touch.knob.style.display = 'none';
      }
      if (touch.aim && e.pointerId === touch.aim.id) { touch.aim = null; input.setVirtualAim(0, 0, false); }
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
    const btns = [['dash', 'Sprung', 'right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(26px + env(safe-area-inset-bottom,0px));width:68px;height:68px;'],
      ['skill', 'Kraft', 'right:calc(96px + env(safe-area-inset-right,0px));bottom:calc(20px + env(safe-area-inset-bottom,0px));width:56px;height:56px;'],
      ['interact', 'E', 'right:calc(26px + env(safe-area-inset-right,0px));bottom:calc(106px + env(safe-area-inset-bottom,0px));width:50px;height:50px;'],
      ['swap', '⇄', 'right:calc(92px + env(safe-area-inset-right,0px));bottom:calc(88px + env(safe-area-inset-bottom,0px));width:44px;height:44px;'],
      ['pause', 'II', 'right:calc(12px + env(safe-area-inset-right,0px));top:calc(12px + env(safe-area-inset-top,0px));width:40px;height:40px;']];
    for (const [name, label, pos] of btns) {
      const b = el('div', 'position:absolute;' + pos + 'border-radius:50%;border:2px solid rgba(255,190,140,.45);background:rgba(30,18,14,.55);color:#ffd9b0;'
        + 'display:flex;align-items:center;justify-content:center;font:700 13px ' + FONT + ';touch-action:none;user-select:none;-webkit-user-select:none;', label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.setVirtualButton(name, true); });
      const up = (e) => { e.stopPropagation(); input.setVirtualButton(name, false); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      layer.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- HUD (overlay canvas)
  function drawHud() {
    const o = renderer.octx, run = game.run;
    if (!o || !run || !run.player) return;
    const d = renderer.dpr || 1;
    const p = run.player, s = p.stats || {};
    const W = renderer.textCanvas.width;
    const inset = 12 * d;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.textBaseline = 'middle';
    o.textAlign = 'left';
    o.lineJoin = 'round';
    o.strokeStyle = 'rgba(10,6,8,.9)';
    const text = (str, x, y, size, color, align = 'left', weight = 700) => {
      o.font = `${weight} ${Math.round(size * d)}px ${FONT}`;
      o.textAlign = align;
      o.lineWidth = 3 * d;
      o.strokeText(str, x, y);
      o.fillStyle = color;
      o.fillText(str, x, y);
    };
    const bar = (x, y, w, h, k, col, bg = '#2a1214') => {
      o.fillStyle = 'rgba(8,4,6,.85)'; o.fillRect(x - d, y - d, w + 2 * d, h + 2 * d);
      o.fillStyle = bg; o.fillRect(x, y, w, h);
      o.fillStyle = col; o.fillRect(x, y, Math.max(0, Math.min(1, k)) * w, h);
    };
    const maxHp = s.maxHp || 100;
    const bw = 130 * d;
    bar(inset, inset, bw, 10 * d, p.hp / maxHp, '#e8433a');
    if (p.shield > 0) { o.fillStyle = 'rgba(154,208,255,.75)'; o.fillRect(inset, inset, Math.min(1, p.shield / maxHp) * bw, 3 * d); }
    text(`${Math.ceil(Math.max(0, p.hp))}/${Math.round(maxHp)}`, inset + bw + 6 * d, inset + 5 * d, 12, '#ffd0c8');
    bar(inset, inset + 15 * d, bw, 4 * d, (p.xp || 0) / (p.xpNext || 1), '#8fd8ff', '#14202a');
    text(`Stufe ${p.level || 1}`, inset + bw + 6 * d, inset + 17 * d, 11, '#bfe6ff');
    text(`✦ ${p.sparks || 0}`, inset, inset + 32 * d, 14, '#ffd35a');
    const biome = run.world && run.world.biome;
    text(`Ebene ${run.floorIndex || 1} · ${(biome && biome.name) || ''}`, W - inset - (input.isTouch ? 48 * d : 0), inset + 6 * d, 12, '#e8dcc8', 'right', 600);
    const ws = p.weapon;
    if (ws && ws.def) {
      const sk = p.skill;
      const skTxt = sk && sk.def ? (sk.cd > 0 ? ` · ${sk.def.name} ${sk.cd.toFixed(1)}s` : ` · ${sk.def.name} bereit`) : '';
      text(`${ws.def.name}${ws.level > 1 ? ' ' + ws.level : ''}${skTxt}`, inset, inset + 48 * d, 11, '#e8dcc8', 'left', 600);
    }
    const boss = run.world && run.world.boss;
    if (boss && !boss.dead && !(boss.spawnT > 0)) {
      const w = Math.min(W - 2 * inset, 420 * d), x = (W - w) / 2, y = renderer.textCanvas.height - inset - 30 * d - (input.isTouch ? 120 * d : 0);
      text(`${boss.name || ''}${boss.def && boss.def.title ? ' – ' + boss.def.title : ''}`, W / 2, y - 9 * d, 13, '#ffd35a', 'center');
      bar(x, y, w, 8 * d, boss.hp / (boss.maxHp || 1), '#d8402a');
    }
    const hint = run.world && run.world.interactHint;
    if (hint && hint.text) {
      const sp = game.worldToScreen(hint.x, hint.y);
      text(`${input.isTouch ? '' : '[E] '}${hint.text}`, sp.x * d, sp.y * d - 30 * d, 12, '#fff3b0', 'center');
    }
  }

  ui.update = function update() {
    const st = game.state;
    if (touch.layer) touch.layer.style.display = st === 'playing' ? 'block' : 'none';
    if (st !== 'playing' && (touch.move || touch.aim)) { touch.move = touch.aim = null; input.setVirtualMove(0, 0); input.setVirtualAim(0, 0, false); }
    if (st === 'menu') { if (ui.shown !== 'menu') showMenu(); }
    else if (st === 'choice') { if (game.choice && ui.choice !== game.choice) showChoice(game.choice); }
    else if (st === 'paused') { if (ui.shown !== 'paused') showPause(); }
    else if (st === 'dead' || st === 'victory') { if (ui.shown !== st) showEnd(st === 'victory'); }
    else if (ui.shown) hide();
    if (st !== 'menu') drawHud();
  };
  // start with Enter/Space on the menu, click on the empty canvas too
  window.addEventListener('keydown', (e) => {
    if (game.state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) start();
  });
  if (renderer.canvas) renderer.canvas.addEventListener('pointerdown', () => { if (game.state === 'menu') start(); });
  ui.destroy = () => { panel.remove(); if (touch.layer) touch.layer.remove(); if (touch.base) touch.base.remove(); if (touch.knob) touch.knob.remove(); };
  return ui;
}
