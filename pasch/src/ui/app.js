// App-Controller: Profil & Lauf (Persistenz), Bildschirme, Einstellungen, gemeinsame Ereignisse, Dialoge.
import { h } from './dom.js';
import * as G from '../game/index.js';
import { load, save, remove } from '../core/storage.js';
import { randomSeedString } from '../core/rng.js';
import { time, shake, background, setCRT, banner, juice, particles, popup } from '../fx/index.js';
import { audio } from '../audio/audio.js';
import { pushKeys } from './input.js';
import { openModal, toast as toastFn, confirmDialog, anyModal, closeAllModals, closeHint } from './overlay.js';
import { hideTooltip } from './tooltip.js';
import { createRunView } from './runview.js';
import { createTitle, newRunDialog } from './screens/title.js';
import { createCollection } from './screens/collection.js';
import { openSettings } from './screens/settings.js';
import { openInspector } from './components/inspector.js';
import { button } from './components/button.js';
import { rich, fmt } from './text.js';

const MOODS = {
  menu: ['menu', 'menu'], round: ['round', 'round'], warden: ['warden', 'warden'], shop: ['shop', 'shop'],
  win: ['win', 'menu'], lose: ['lose', 'menu'],
};

export function createApp(root, opts = {}) {
  const app = {
    root, run: null, rv: null, screen: null, screenName: null, busy: false, opts,
    profile: null,
    get settings() { return this.profile.settings; },
  };

  // ------------------------------------------------------------------ Profil
  const stored = load(G.meta.PROFILE_KEY, null);
  app.profile = G.meta.migrateProfile(stored);
  if (!stored) {
    app.profile.settings.autoThrow = true; // Standard: automatisch werfen
    app.profile.tutorial = {};
  }
  if (!app.profile.tutorial) app.profile.tutorial = { done: true };
  app.saveProfile = () => save(G.meta.PROFILE_KEY, app.profile);

  app.applySettings = () => {
    const s = app.settings;
    time.speed = opts.speed || s.speed || 1;
    shake.strength = s.shake;
    time.flashes = !!s.flashes;
    setCRT(!!s.crt);
    time.reducedMotion = s.reducedMotion == null ? matchMedia('(prefers-reduced-motion: reduce)').matches : !!s.reducedMotion;
    audio.setVolume('master', s.volume.master);
    audio.setVolume('sfx', s.volume.sfx);
    audio.setVolume('music', s.volume.music);
    audio.mute(!!s.muted);
  };
  app.applySettings();

  // ------------------------------------------------------------------ Lauf speichern/laden
  let saveQueued = false;
  app.save = () => {
    if (saveQueued || !app.run) return;
    saveQueued = true;
    queueMicrotask(() => {
      saveQueued = false;
      if (app.run) save(G.meta.RUN_KEY, app.run);
    });
  };
  app.savedRun = () => {
    const r = G.loadRun(load(G.meta.RUN_KEY, null));
    if (!r) return null;
    if (r.phase === 'lost') return null;
    return r;
  };

  // ------------------------------------------------------------------ Stimmung (Palette + Musik)
  app.mood = (name) => {
    const m = MOODS[name] || MOODS.menu;
    background.setPalette(m[0]);
    audio.music.setMood(m[1]);
  };

  // ------------------------------------------------------------------ Bildschirme
  let wipeEl = null;
  async function swap(make, name) {
    hideTooltip();
    closeHint();
    closeAllModals();
    const first = !app.screen && !app.rv;
    if (!first) {
      if (!wipeEl) { wipeEl = h('div.wipe', h('div.wipe-band')); document.body.appendChild(wipeEl); }
      wipeEl.classList.remove('wipe--out');
      wipeEl.classList.add('wipe--in');
      audio.play('whoosh');
      await new Promise((r) => setTimeout(r, time.reducedMotion ? 60 : 260));
    }
    if (app.screen) { app.screen.leave(); app.screen.el.remove(); app.screen = null; }
    if (app.rv) { app.rv.destroy(); app.rv = null; }
    const scr = make();
    app.screenName = name;
    document.body.dataset.screen = name;
    if (scr.isRun) app.rv = scr.rv;
    else app.screen = scr;
    root.appendChild(scr.el);
    if (!first) {
      wipeEl.classList.remove('wipe--in');
      void wipeEl.offsetWidth;
      wipeEl.classList.add('wipe--out');
    }
    scr.enter();
  }

  app.showTitle = () => {
    if (app.run && !G.isOver(app.run)) app.save();
    app.run = null;
    return swap(() => createTitle(app), 'title');
  };
  app.showCollection = () => swap(() => createCollection(app), 'collection');
  app.showSettings = () => openSettings(app);
  app.newRunDialog = async () => {
    const saved = app.savedRun();
    if (saved && app.screenName === 'title' && saved.phase !== 'won') {
      const ok = await confirmDialog('Laufenden Lauf verwerfen?', `Dein Lauf in Einsatz ${saved.ante} geht verloren.`, { yes: 'Neues Spiel', danger: true });
      if (!ok) return;
    }
    newRunDialog(app);
  };

  function enterRun(phaseOverride) {
    return swap(() => {
      const rv = createRunView(app);
      return { isRun: true, rv, el: rv.el, enter: () => rv.go(phaseOverride || app.run.phase), leave() {} };
    }, 'run');
  }

  app.startRun = ({ cup = 'wood', stake = 1, seed = null } = {}) => {
    const s = seed || randomSeedString();
    app.run = G.newRun({ seed: s, cup, stake });
    if (opts.money != null) app.run.money = opts.money;
    if (opts.ante && opts.ante > 1) {
      app.run.ante = opts.ante;
      app.run.stats.highestAnte = opts.ante;
      app.run.blinds.forEach((b) => { b.target = G.blindTarget(app.run, b.kind, b.wardenId || app.run.wardens.current); });
    }
    app.profile.lastCup = cup;
    if (app.profile.tutorial && !app.profile.tutorial.done && app.profile.stats.runs > 0) app.profile.tutorial.done = true;
    app.save();
    app.saveProfile();
    audio.play('roll_start');
    return enterRun();
  };

  app.continueRun = () => {
    const r = app.savedRun();
    if (!r) { app.toast('Kein gespeicherter Lauf'); return null; }
    app.run = r;
    return enterRun();
  };

  app.finishRun = () => {
    const run = app.run;
    if (!run || (run.phase !== 'lost' && run.phase !== 'won')) return;
    const evs = G.meta.finishRun(app.profile, run);
    if (app.profile.tutorial) app.profile.tutorial.done = true;
    app.saveProfile();
    if (run.phase === 'lost') remove(G.meta.RUN_KEY);
    else save(G.meta.RUN_KEY, run);
    showMetaEvents(evs);
  };

  app.resetAll = () => {
    remove(G.meta.RUN_KEY);
    remove(G.meta.PROFILE_KEY);
    app.profile = G.meta.migrateProfile(null);
    app.profile.settings.autoThrow = true;
    app.profile.tutorial = {};
    app.saveProfile();
    app.applySettings();
    app.toast('Alles zurückgesetzt.', { kind: 'bad' });
    app.showTitle();
  };

  // ------------------------------------------------------------------ Ereignisse
  app.toast = (text, o = {}) => toastFn(text, o);

  function showMetaEvents(evs) {
    for (const e of evs) {
      if (e.type === 'achievement') {
        const a = G.ACHIEVEMENTS[e.id];
        audio.play('level_up');
        app.toast(a.desc, { title: `Erfolg: ${a.name}`, glyph: a.glyph, hue: a.hue, kind: 'ach', ms: 3400 });
      } else if (e.type === 'unlock' && e.kind === 'cup') {
        const c = G.CUPS[e.id];
        app.toast(c.desc, { title: `Neuer Becher: ${c.name}`, glyph: '⊔', hue: c.hue, kind: 'gold', ms: 4000 });
      } else if (e.type === 'unlock' && e.kind === 'stake') {
        app.toast(`${G.CUPS[e.id].name}: Stufe ${e.stake} freigeschaltet`, { title: 'Neue Stufe', glyph: G.STAKES[e.stake].glyph, hue: G.STAKES[e.stake].hue, kind: 'gold', ms: 4000 });
      }
    }
  }

  /** Nach jeder Aktion: Toasts für allgemeine Ereignisse, Profil synchronisieren, Anzeige auffrischen, speichern. */
  app.afterAction = (events = [], o = {}) => {
    const run = app.run;
    if (!run) return;
    for (const e of events) {
      switch (e.type) {
        case 'tag': { const g = G.TAGS[e.id]; app.toast(g.desc, { title: `Marke: ${g.name}`, glyph: g.glyph, hue: g.hue, kind: 'gold' }); audio.play('tag'); break; }
        case 'tagUsed': { const g = G.TAGS[e.id]; app.toast(`${g.name} eingelöst`, { glyph: g.glyph, hue: g.hue }); audio.play('tag'); break; }
        case 'talismanDisabled': {
          const t = run.talismans.find((x) => x.uid === e.uid);
          if (t) app.toast(`${G.TALISMANS[t.id].name} ist in dieser Partie deaktiviert.`, { title: 'Der Dieb', glyph: '⌀', hue: 290, kind: 'bad' });
          break;
        }
        case 'talismanGrow': {
          const el = app.rv && app.rv.belt.cardEl(e.uid);
          if (el) juice(el, 0.3);
          if (e.text && !o.silent && el) { const r = el.getBoundingClientRect(); popup(r.left + r.width / 2, r.bottom + 14, e.text, { kind: 'info' }); }
          audio.play('grow');
          break;
        }
        case 'message': if (e.text) app.toast(e.text); break;
        case 'levelUp': break;
        case 'faceShatter': break;
        default: break;
      }
    }
    const evs = G.meta.syncProfile(app.profile, run);
    if (evs.length) { app.saveProfile(); showMetaEvents(evs); }
    if (app.rv) app.rv.refresh({ tickMoney: o.tickMoney, keepMoney: o.keepMoney, keepScore: app.rv.stageName === 'play' });
    app.save();
  };

  // ------------------------------------------------------------------ Verbrauchsgüter
  app.useConsumable = async (uid) => {
    const run = app.run;
    if (!run || app.busy) return;
    const c = run.consumables.find((x) => x.uid === uid);
    if (!c) return;
    const def = G.CONSUMABLES[c.id];
    if (def.usableIn === 'round' && !(run.phase === 'round' && run.round && run.round.rolled)) {
      app.toast('Nur während eines Wurfs benutzbar', { kind: 'bad' });
      audio.play('deny');
      return;
    }
    let target = null;
    if (def.target) {
      target = await openInspector(app, { mode: 'target', spec: def.target, def, title: def.name, sub: rich(def.desc), confirmLabel: 'Benutzen' });
      if (!target) return;
    }
    const r = G.useConsumable(run, uid, target);
    if (!r.ok) { audio.play('deny'); app.toast(r.reason, { kind: 'bad' }); return; }
    app.save();
    const el = app.rv.belt.cardEl(uid);
    if (el) {
      const rr = el.getBoundingClientRect();
      particles.burst(rr.left + rr.width / 2, rr.top + rr.height / 2, { count: 20, color: 'confetti', shape: 'confetti', speed: [150, 450] });
    }
    audio.play(def.kind === 'star' ? 'level_up' : 'card_pick');
    const lv = r.events.filter((e) => e.type === 'levelUp');
    app.afterAction(r.events, { tickMoney: true });
    if (run.phase === 'round' && app.rv.stageName === 'play') await app.rv.play.onConsumableEvents(r.events);
    if (lv.length === 1) {
      const hd = G.HANDS[lv[0].handId];
      const b = G.handBase(lv[0].handId, lv[0].level);
      banner(`${hd.name} Stufe ${lv[0].level}`, { kind: 'chips', sub: `${b.chips} Punkte × ${b.mult} Multi`, hold: 600 });
    } else if (lv.length > 1) banner('Alle Hände +1 Stufe', { kind: 'chips', hold: 600 });
    for (const e of r.events) {
      if (e.type === 'faceChange' || e.type === 'dieChange' || e.type === 'gainDie') { app.toast(def.desc, { title: def.name, glyph: def.glyph, hue: def.hue, shape: def.kind }); break; }
      if (e.type === 'gainTalisman') { app.toast(G.TALISMANS[e.id].name, { title: 'Neuer Talisman', glyph: G.TALISMANS[e.id].glyph, hue: G.TALISMANS[e.id].hue, kind: 'gold', shape: 'talisman' }); }
    }
  };

  // ------------------------------------------------------------------ Dialoge im Lauf
  app.showInspector = () => { if (app.run) openInspector(app, { mode: 'view' }); };

  app.showHandTable = () => {
    const run = app.run;
    if (!run) return;
    const rows = G.handTable(run);
    const t = h('div.handtable');
    t.appendChild(h('div.ht-row.ht-head', h('span', 'Hand'), h('span', 'Stufe'), h('span', 'Punkte × Multi'), h('span', 'gewertet')));
    for (const r of rows) {
      const hd = G.HANDS[r.handId];
      t.appendChild(h('div.ht-row', { vars: { hue: hd.hue } },
        h('span.ht-name', h('span.ht-glyph', hd.glyph), r.name),
        h('span.ht-lvl', String(r.level)),
        h('span.ht-base', h('b.kw-chips', fmt(r.chips)), ' × ', h('b.kw-mult', String(r.mult))),
        h('span.ht-plays', `${r.plays}×`)));
    }
    openModal({ title: 'Handtabelle', sub: 'Sternbilder erhöhen die Stufe einer Hand.', content: t, cls: 'modal-panel--table', buttons: [{ label: 'Schließen', kind: 'plain', onClick: (m) => m.close() }] });
  };

  app.pause = () => {
    if (anyModal()) return;
    const run = app.run;
    const list = h('div.pause-list',
      button('Weiterspielen', { kind: 'hot', size: 'l', onClick: () => m.close() }),
      button('Handtabelle', { kind: 'plain', icon: '☰', onClick: () => { m.close(); app.showHandTable(); } }),
      button('Deine Würfel', { kind: 'plain', icon: '⚄', onClick: () => { m.close(); app.showInspector(); } }),
      button('Einstellungen', { kind: 'plain', icon: '⚙', onClick: () => { m.close(); app.showSettings(); } }),
      button('Zum Titel', { kind: 'plain', icon: '⌂', sub: 'Lauf wird gespeichert', onClick: () => { m.close(); app.showTitle(); } }));
    const info = run ? h('div.pause-info', { html: `${G.CUPS[run.cup].name} · Stufe ${run.stake} · Startwert <b>${run.seed}</b>` }) : null;
    const help = h('div.pause-help', { html: 'Leertaste: Wurf beginnen / nachwürfeln · 1–7: halten · ←/→: Hand wählen · Enter: werten · Esc: Pause' });
    const m = openModal({ title: 'Pause', content: h('div', list, info, help), cls: 'modal-panel--pause' });
  };

  // Tutorial-Hinweise (nur im allerersten Lauf, je einmal)
  app.tutorial = (key, fn) => {
    const t = app.profile.tutorial;
    if (opts.noTutorial || !t || t.done || t[key]) return;
    t[key] = true;
    app.saveProfile();
    try { fn(); } catch (e) { console.error(e); }
  };

  // ------------------------------------------------------------------ Tastatur
  pushKeys((e) => {
    if (app.rv) return app.rv.onKey(e);
    if (app.screen && app.screen.onKey) return app.screen.onKey(e);
    return false;
  });

  // Zustand beim Verlassen sichern
  window.addEventListener('pagehide', () => { if (app.run) save(G.meta.RUN_KEY, app.run); app.saveProfile(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.run) save(G.meta.RUN_KEY, app.run); });

  return app;
}
