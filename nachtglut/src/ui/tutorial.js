// First-run contextual hints (move, shoot, dash, interact, level-up). Each is shown once.
import { bus } from '../core/events.js';
import { h, icon, setText, toggleClass } from './dom.js';

const ORDER = ['move', 'shoot', 'dash', 'interact', 'levelup'];

function hintText(id, dev) {
  const touch = dev === 'touch', pad = dev === 'gamepad';
  switch (id) {
    case 'move':
      return touch ? 'Lege den Daumen links auf den Bildschirm und ziehe, um dich zu bewegen.'
        : pad ? 'Linker Stick: bewegen.' : 'Bewege dich mit WASD oder den Pfeiltasten.';
    case 'shoot':
      return touch ? 'Deine Glut zielt und feuert von selbst. Ziehe rechts, um selbst zu zielen.'
        : pad ? 'Rechter Stick: zielen und feuern. Ohne Stick zielt deine Glut von selbst.'
          : 'Halte die linke Maustaste zum Feuern. „Automatisch zielen“ findest du in den Einstellungen.';
    case 'dash':
      return touch ? 'Tippe auf „Sprint“, um durch Angriffe zu gleiten – im Sprint bist du unverwundbar.'
        : pad ? 'A: Sprint – gleite unverwundbar durch Angriffe.' : 'Leertaste: Sprint – gleite unverwundbar durch Angriffe.';
    case 'interact':
      return touch ? 'Tippe auf den Hinweis oder „Benutzen“, um Truhen, Schreine und Händler zu nutzen.'
        : pad ? 'B: Truhen, Schreine und Händler benutzen.' : 'Drücke E, um Truhen, Schreine und Händler zu benutzen.';
    case 'levelup':
      return touch ? 'Stufenaufstieg! Tippe auf einen Segen, um ihn zu wählen.' : 'Stufenaufstieg! Wähle einen Segen – per Klick oder mit den Tasten 1–3.';
    default: return '';
  }
}

export function createTutorial(ui) {
  const game = ui.game;
  const textEl = h('div.hint-text');
  const el = h('div.tut-hint', icon({ glyph: 'lantern', color: '#ffd9a0' }, 24, { name: 'T' }), textEl);
  let active = null; // { id, t, done }
  let moveT = 0;
  let fires = 0;
  let queued = new Set();

  const save = () => game.save || {};
  const seen = (id) => !!(save().seenHints && save().seenHints[id]);
  const enabled = () => !save().tutorialSeen;

  function markSeen(id) {
    const s = save();
    if (!s.seenHints || typeof s.seenHints !== 'object') s.seenHints = {};
    s.seenHints[id] = true;
    if (ORDER.every((k) => s.seenHints[k])) s.tutorialSeen = true;
    ui.persist();
  }

  function show(id) {
    if (!enabled() || seen(id) || (active && active.id === id)) return;
    if (active) { queued.add(id); return; }
    active = { id, t: 0 };
    setText(textEl, hintText(id, ui.inputDevice()));
    toggleClass(el, 'show', true);
  }

  function finish(id) {
    queued.delete(id);
    if (!active || active.id !== id) { if (enabled() && !seen(id) && id !== 'move') markSeen(id); return; }
    markSeen(id);
    active = null;
    toggleClass(el, 'show', false);
  }

  const offs = [
    bus.on('run:start', () => { moveT = 0; fires = 0; queued = new Set(); active = null; toggleClass(el, 'show', false); }),
    bus.on('weapon:fire', () => { if (active && active.id === 'shoot' && ++fires > 12) finish('shoot'); }),
    bus.on('player:dash', () => { if (active && active.id === 'dash') finish('dash'); }),
    bus.on('enemy:telegraph', () => { if (seen('move')) show('dash'); }),
    bus.on('player:hit', () => { if (seen('move')) show('dash'); }),
    bus.on('prop:open', () => { if (active && active.id === 'interact') finish('interact'); }),
    bus.on('ui:choice', (c) => { if (c && c.kind === 'boon') show('levelup'); }),
  ];

  return {
    el,
    dispose() { for (const o of offs) o(); },
    update(dt) {
      if (!enabled() || !game.run) { if (active) { active = null; toggleClass(el, 'show', false); } return; }
      const st = game.state;
      toggleClass(el, 'in-choice', st === 'choice');
      if (st !== 'playing' && st !== 'choice') return;
      const run = game.run;
      const w = run.world;
      if (run.time > 2.5) show('move');
      if (w && w.interactHint && seen('move')) show('interact');
      if (w && Array.isArray(w.enemies) && w.enemies.some((e) => e && !e.dead) && seen('move')) show('shoot');
      if (!active) {
        const next = [...queued].find((id) => !seen(id));
        if (next) { queued.delete(next); show(next); }
        return;
      }
      active.t += dt;
      const id = active.id;
      if (id === 'move') {
        const m = ui.input && ui.input.move;
        if (m && Math.hypot(m.x, m.y) > 0.3) moveT += dt;
        if (moveT > 0.8 || active.t > 9) finish('move');
      } else if (id === 'levelup') {
        if (st !== 'choice' || active.t > 20) finish('levelup');
      } else if (id === 'interact') {
        if (active.t > 9 || (!(w && w.interactHint) && active.t > 2)) finish('interact');
      } else if (active.t > 8) {
        finish(id);
      }
    },
  };
}
