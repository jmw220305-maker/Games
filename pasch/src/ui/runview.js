// Lauf-Ansicht: Seitenleiste (HUD) + Talisman-/Verbrauchsgut-Reihe + Bühne mit Unter-Bildschirmen je Phase.
import { h } from './dom.js';
import { createHud } from './components/hud.js';
import { createBelt } from './components/belt.js';
import { createPlay } from './screens/play.js';
import { createBlinds } from './screens/blinds.js';
import { createResult } from './screens/result.js';
import { createShop } from './screens/shop.js';
import { createPack } from './screens/pack.js';
import { createGameover } from './screens/gameover.js';
import { time } from '../fx/index.js';
import { hideTooltip } from './tooltip.js';
import { closeHint } from './overlay.js';

const PHASE_SUB = { blinds: 'blinds', round: 'play', cashout: 'result', shop: 'shop', pack: 'pack', won: 'gameover', lost: 'gameover' };

export function createRunView(app) {
  const stage = h('main.stage');
  const el = h('div.runview');
  const rv = { el, stage, stageName: null };
  app.rv = rv;
  rv.hud = createHud(app);
  rv.belt = createBelt(app);
  const top = h('div.topbar', rv.belt.el);
  el.appendChild(rv.hud.el);
  el.appendChild(top);
  el.appendChild(stage);
  const subs = {
    blinds: createBlinds(app),
    play: createPlay(app),
    result: createResult(app),
    shop: createShop(app),
    pack: createPack(app),
    gameover: createGameover(app),
  };
  rv.play = subs.play;
  rv.subs = subs;
  let current = null;

  rv.go = (phase) => {
    const name = PHASE_SUB[phase] || phase;
    const next = subs[name];
    if (!next) return;
    hideTooltip();
    closeHint();
    rv.belt.closeMenu();
    const prev = current;
    current = next;
    rv.stageName = name;
    el.dataset.stage = name;
    if (prev && prev !== next) {
      prev.leave();
      const old = prev.el;
      old.classList.remove('sub--in');
      old.classList.add('sub--out');
      setTimeout(() => { if (current !== prev) { old.remove(); old.classList.remove('sub--out'); } }, Math.max(120, 240 / Math.max(1, time.speed)));
    }
    if (!next.el.isConnected || next.el.parentNode !== stage) stage.appendChild(next.el);
    next.el.classList.remove('sub--out', 'sub--in');
    void next.el.offsetWidth;
    next.el.classList.add('sub--in');
    rv.hud.update();
    rv.belt.render();
    next.enter();
  };

  rv.refresh = (o = {}) => {
    rv.hud.update(o);
    rv.belt.render();
    if (current) current.refresh();
  };

  rv.onKey = (e) => {
    if (e.key === 'Escape') { app.pause(); return true; }
    return current ? current.onKey(e) : false;
  };

  rv.destroy = () => {
    if (current) current.leave();
    rv.play.tray.destroy();
    el.remove();
  };

  rv.setPortrait = () => {};
  return rv;
}
