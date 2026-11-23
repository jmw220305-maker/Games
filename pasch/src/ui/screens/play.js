// Spiel-Bildschirm (Phase 'round'): Schale, Handwahl, Wurf beginnen / Nachwürfeln / Werten.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { createTray } from '../components/tray.js';
import { button } from '../components/button.js';
import { attachTooltip } from '../tooltip.js';
import { juice, nope, time, banner, popup, background, shake, popIn, particles, flash, bigHit } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { playScore } from '../scoreplayer.js';
import { T, fmt, rich } from '../text.js';
import { hint, closeHint } from '../overlay.js';

export function createPlay(app) {
  const trayWrap = h('div.play-tray');
  const handsRow = h('div.hands-row');
  const handInfo = h('div.hands-info');
  const bBegin = button(T.beginThrow, { kind: 'go', size: 'l', key: 'Leertaste', onClick: () => beginThrow() });
  const bReroll = button(T.reroll, { kind: 'blue', size: 'l', key: 'Leertaste', onClick: () => reroll(), onDenied: (r) => r && app.toast(r) });
  const bScore = button(T.score, { kind: 'hot', size: 'l', key: 'Enter', onClick: () => score(), onDenied: (r) => r && app.toast(r) });
  const buttons = h('div.play-buttons', bBegin, bReroll, bScore);
  const note = h('div.play-note');
  const el = h('section.sub.sub-play', note, trayWrap, h('div.hands', handsRow, handInfo), buttons);

  const tray = createTray(trayWrap, { maxSize: 96, minSize: 34 });
  tray.onLand = (i, imp) => { audio.play('dice_clack', { gain: Math.min(2, imp || 0.6), pan: panOf(i) }); };
  tray.onBounce = (i, imp) => { audio.play('dice_clack', { gain: Math.min(1.2, (imp || 0.4) * 0.6), pan: panOf(i) }); };
  tray.onLaunch = () => { audio.play('dice_rattle'); };
  tray.onDieClick((i) => toggleHold(i));

  function panOf(i) { return tray.count > 1 ? (i / (tray.count - 1) - 0.5) * 0.6 : 0; }

  let hands = [];
  let selected = null;
  let busy = false;
  let entered = false;

  const run = () => app.run;
  const round = () => (app.run ? app.run.round : null);

  // ------------------------------------------------------------------ Anzeige
  function refreshButtons() {
    const r = round();
    const rolled = !!(r && r.rolled);
    bBegin.style.display = rolled ? 'none' : '';
    bReroll.style.display = rolled ? '' : 'none';
    bScore.style.display = rolled ? '' : 'none';
    if (!r) return;
    bBegin.setDisabled(busy || r.throwsLeft <= 0, 'Keine Würfe mehr');
    const allHeld = rolled && r.rolled.every((x) => x.held);
    bReroll.setLabel(T.reroll, `(${r.rerollsLeft})`);
    bReroll.setDisabled(busy || r.rerollsLeft <= 0 || allHeld, r.rerollsLeft <= 0 ? 'Keine Nachwürfe mehr' : allHeld ? 'Alle Würfel sind gehalten' : 'Gerade nicht');
    const fz = rolled && G.mustFizzle(app.run);
    bScore.setLabel(fz ? T.fizzle : T.score, null);
    bScore.setDisabled(busy, 'Gerade nicht');
    el.classList.toggle('play--idle', !rolled);
    el.classList.toggle('play--last', isLastThrow());
    tray.setInteractive(rolled && !busy);
  }

  /** letzter Wurf der Partie und Ziel noch offen → Spannung */
  function isLastThrow() {
    const r = round();
    return !!(r && app.run.phase === 'round' && r.throwsLeft === 1 && r.score < r.target);
  }

  function refreshHands(resetSel) {
    const r = round();
    handsRow.innerHTML = '';
    if (!r || !r.rolled) {
      hands = [];
      selected = null;
      handInfo.innerHTML = '';
      app.rv.hud.sb.setIdle();
      previewDice([]);
      return;
    }
    const prevIds = new Set(hands.map((x) => x.handId));
    const prevSel = selected;
    hands = G.availableHands(app.run);
    if (resetSel || !hands.find((x) => x.handId === selected && x.allowed)) {
      const best = hands.find((x) => x.allowed);
      selected = best ? best.handId : null;
    }
    // neue Hände nach einem Nachwurf „ploppen“ auf; bessere Auswahl stupst die Scorebox an
    const fresh = prevIds.size > 0;
    let k = 0;
    for (const hd of hands) {
      const chip = h(`button.hand-chip${hd.allowed ? '' : '.hand-chip--off'}${hd.handId === selected ? '.hand-chip--sel' : ''}`, { type: 'button', vars: { hue: G.HANDS[hd.handId].hue }, dataset: { hand: hd.handId } },
        h('span.hc-name', hd.name),
        h('span.hc-base', h('b.kw-chips', fmt(hd.base.chips)), '×', h('b.kw-mult', String(hd.base.mult))),
        hd.hidden ? h('span.hc-q', '?') : null);
      chip.addEventListener('click', () => {
        audio.init();
        if (!hd.allowed) { nope(chip); audio.play('deny'); app.toast(hd.reason || 'Nicht erlaubt'); return; }
        selectHand(hd.handId);
      });
      chip.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') previewDice(hd.scoring); });
      chip.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') previewSelected(); });
      attachTooltip(chip, () => ({
        title: hd.name, kind: `Hand · Stufe ${hd.level}`, hue: G.HANDS[hd.handId].hue,
        body: rich(`${G.HANDS[hd.handId].desc} Basis: ${hd.base.chips} Punkte × ${hd.base.mult} Multi.`) + (hd.allowed ? '' : `<br><b class="kw kw-bad">${hd.reason || 'Nicht erlaubt'}</b>`) + (hd.hidden ? '<br>Verdeckte Würfel sind beteiligt.' : ''),
      }));
      handsRow.appendChild(chip);
      if (!prevIds.has(hd.handId)) popIn(chip, 240, 50 * k++);
    }
    if (G.mustFizzle(app.run)) {
      handInfo.innerHTML = '<b class="kw kw-bad">Keine erlaubte Hand</b> – nur ein Fehlwurf ist möglich.';
    } else handInfo.innerHTML = '';
    const improved = fresh && selected && selected !== prevSel && k > 0;
    previewSelected(improved);
    if (improved) audio.play('card_flip', { gain: 0.5, pitch: 4 });
  }

  function selectHand(id) {
    if (busy) return;
    selected = id;
    for (const c of handsRow.children) c.classList.toggle('hand-chip--sel', c.dataset.hand === id);
    const c = handsRow.querySelector(`[data-hand="${id}"]`);
    if (c) { juice(c, 0.2); c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    const hd = hands.find((x) => x.handId === id);
    audio.play('card_pick', { gain: 0.5, pitch: hd ? Math.min(9, hd.rank) : 0 });
    previewSelected(true);
  }

  function previewSelected(pop) {
    const hd = hands.find((x) => x.handId === selected);
    const sb = app.rv.hud.sb;
    if (!hd) {
      if (hands.length && G.mustFizzle(app.run)) { sb.setHand('Fehlwurf', null, { bad: true }); sb.set(0, 0); }
      previewDice([]);
      return;
    }
    sb.setHand(hd.name, hd.level, { pop });
    sb.set(hd.base.chips, hd.base.mult, pop ? { bump: 'both', amount: 0.15 } : {});
    previewDice(hd.scoring);
  }

  function previewDice(idx) {
    const set = new Set(idx);
    for (let i = 0; i < tray.count; i++) {
      const d = tray.die(i);
      if (d) d.el.classList.toggle('die--preview', set.has(i));
    }
  }

  function syncDice() {
    const r = round();
    tray.setDice(app.run.dice, r && r.rolled ? r.rolled : null);
    if (!(r && r.rolled)) for (let i = 0; i < tray.count; i++) { tray.setHeld(i, false); tray.die(i).setShackled(false); }
    tray.clearHighlight();
  }

  // ------------------------------------------------------------------ Aktionen
  async function beginThrow() {
    if (busy) return;
    const r0 = round();
    if (!r0 || r0.rolled) return;
    const res = G.beginThrow(app.run);
    if (!res.ok) { app.toast(res.reason); return; }
    busy = true;
    closeHint();
    refreshButtons();
    app.save();
    const r = round();
    for (let i = 0; i < tray.count; i++) { tray.setHeld(i, false); tray.die(i).setShackled(false); tray.die(i).el.classList.remove('die--preview'); }
    tray.clearHighlight();
    if (isLastThrow() && r.throwsUsed > 0) {
      // letzter Wurf: kurzer Spannungsmoment vor dem Wurf
      audio.play('tension');
      audio.music.duck(4, 700);
      shake.add(0.12);
      juice(app.rv.hud.throwsEl.parentElement, 0.35);
      el.classList.add('play--idle'); // alte Augen bleiben gedimmt, bis die Würfel fliegen
      await banner('Letzter Wurf!', { kind: 'lose', sub: `Noch ${fmt(Math.max(0, r.target - r.score))} Punkte`, hold: 380 });
      el.classList.remove('play--idle');
    }
    audio.play('roll_start');
    const vals = r.rolled.map((x) => ({ v: x.v, faceIndex: x.faceIndex, hidden: x.hidden }));
    await tray.roll(null, vals);
    r.rolled.forEach((x, i) => tray.die(i).setShackled(!!x.shackled));
    if (r.rolled.some((x) => x.shackled)) audio.play('hold', { pitch: -5 });
    busy = false;
    afterRoll(true);
    app.tutorial('hold', () => hint(tray.el, 'Tippe Würfel an (oder Tasten <b>1–7</b>), um sie zu <b>halten</b>. Gehaltene Würfel bleiben beim Nachwürfeln liegen.', { side: 'above' }));
  }

  async function reroll() {
    if (busy) return;
    const r = round();
    if (!r || !r.rolled) return;
    const res = G.reroll(app.run);
    if (!res.ok) { nope(bReroll); audio.play('deny'); app.toast(res.reason); return; }
    busy = true;
    closeHint();
    refreshButtons();
    app.save();
    const evRoll = res.events.find((e) => e.type === 'roll');
    const idx = evRoll ? evRoll.dice : [];
    const vals = idx.map((i) => ({ v: r.rolled[i].v, faceIndex: r.rolled[i].faceIndex, hidden: r.rolled[i].hidden }));
    for (const i of idx) tray.die(i).el.classList.remove('die--preview');
    app.rv.hud.update({ bump: true, keepScore: true, keepMoney: true });
    audio.play('roll_start', { gain: 0.8 });
    // nur noch 1–2 Würfel offen, der Rest gehalten: das ist der Moment – Spannungs-Würfel + Anstieg
    const heldN = r.rolled.length - idx.length;
    const tense = idx.length >= 1 && idx.length <= 2 && heldN >= 3;
    if (tense) audio.play('tension', { gain: 0.8 });
    await tray.roll(idx, vals, { forceSuspense: tense });
    for (const e of res.events) {
      if (e.type === 'flip') {
        const x = r.rolled[e.die];
        popup(...topOf(e.die), 'Gewendet!', { kind: 'info' });
        audio.play('card_flip');
        await tray.turn(e.die, x.v, { faceIndex: x.faceIndex, hidden: x.hidden });
      } else if (e.type === 'money') {
        const [x, y] = topOf(0);
        popup(app.rv.hud.moneyTarget()[0], app.rv.hud.moneyTarget()[1] - 20, e.amount, { kind: 'money' });
        audio.play(e.amount < 0 ? 'deny' : 'coin');
        void x; void y;
      }
    }
    app.afterAction(res.events.filter((e) => e.type !== 'roll' && e.type !== 'flip'), { tickMoney: true });
    busy = false;
    afterRoll(true);
    app.tutorial('score', () => hint(bScore, 'Wähle unten eine <b>Hand</b> und drücke <b>Werten</b>. Jede Wertung kostet einen Wurf – erreiche das <b>Ziel</b>, bevor die Würfe ausgehen.', { side: 'above' }));
  }

  function topOf(i) {
    const rr = tray.getDieRect(i);
    return rr ? [rr.left + rr.width / 2, rr.top - 10] : [window.innerWidth / 2, window.innerHeight / 2];
  }

  function toggleHold(i) {
    if (busy) return;
    const r = round();
    if (!r || !r.rolled || !r.rolled[i]) return;
    const res = G.toggleHold(app.run, i);
    if (!res.ok) {
      const d = tray.die(i);
      if (d) d.resist();
      nope(d.el);
      audio.play('deny');
      app.toast(res.reason);
      return;
    }
    const held = r.rolled[i].held;
    tray.setHeld(i, held);
    audio.play(held ? 'hold' : 'unhold');
    // kurzes „Klack“: Würfel tippt beim Anheben/Absetzen auf den Filz
    audio.play('dice_clack', { gain: held ? 0.35 : 0.6, pan: panOf(i) });
    if (tray.die(i)) tray.die(i).juice(held ? 0.12 : 0.08);
    app.save();
    refreshButtons();
    app.tutorial('reroll', () => hint(bReroll, '<b>Nachwürfeln</b> wirft alle nicht gehaltenen Würfel neu. Der Vorrat an Nachwürfen gilt für die ganze Partie.', { side: 'above' }));
  }

  function afterRoll(resetSel) {
    refreshHands(resetSel);
    refreshButtons();
    app.rv.hud.update({ keepScore: true, keepMoney: true });
  }

  async function score() {
    if (busy) return;
    const r = round();
    if (!r || !r.rolled) return;
    const fz = G.mustFizzle(app.run);
    const before = r.rolled.map((x) => ({ ...x }));
    const res = G.scoreThrow(app.run, fz ? undefined : selected || undefined);
    if (!res.ok) { nope(bScore); audio.play('deny'); app.toast(res.reason); return; }
    busy = true;
    closeHint();
    app.busy = true;
    app.rv.belt.setLocked(true);
    refreshButtons();
    handsRow.classList.add('hands-row--used');
    app.save();
    // verdeckte Würfel aufdecken
    const reveal = before.map((x, i) => (x.hidden ? i : -1)).filter((i) => i >= 0);
    if (reveal.length) {
      audio.play('card_flip');
      await Promise.all(reveal.map((i) => tray.turn(i, before[i].v, { faceIndex: before[i].faceIndex, hidden: false })));
      await time.wait(200);
    }
    previewDice([]);
    for (let i = 0; i < tray.count; i++) tray.setHeld(i, false);
    el.classList.add('play--scoring');
    app.rv.hud.update({ keepScore: true, keepMoney: true, bump: true });
    try { await playScore(app, res.result); } catch (err) { console.error(err); }
    handsRow.classList.remove('hands-row--used');
    el.classList.remove('play--scoring');
    // Folge-Ereignisse
    const evs = res.events;
    for (const e of evs) {
      if (e.type === 'talismanBreak') await app.rv.belt.breakCard(e.uid);
    }
    app.afterAction(evs, { tickMoney: false });
    tray.clearHighlight();
    app.rv.hud.sb.flames(0);
    busy = false;
    app.busy = false;
    app.rv.belt.setLocked(false);
    const won = evs.some((e) => e.type === 'roundWon');
    const lost = evs.some((e) => e.type === 'roundLost');
    el.classList.toggle('play--over', won || lost);
    const extra = evs.find((e) => e.type === 'extraThrow');
    if (won) {
      const runWon = evs.some((e) => e.type === 'runWon');
      el.classList.remove('play--last');
      if (runWon) {
        await celebrateRun();
      } else {
        audio.play('round_won');
        await banner(T.roundWon, { kind: 'win', sub: `${fmt(app.run.round.score)} von ${fmt(app.run.round.target)}`, hold: 900 });
      }
      app.rv.go(app.run.phase);
      return;
    }
    if (lost) {
      await defeat();
      app.rv.go('lost');
      return;
    }
    if (extra) {
      const el2 = app.rv.belt.cardEl(extra.uid);
      if (el2) juice(el2, 0.5);
      audio.play('level_up');
      await banner('Zweiter Atem!', { kind: 'info', sub: 'Ein weiterer Wurf', hold: 700 });
    }
    syncDice();
    refreshHands();
    refreshButtons();
    app.rv.hud.update({ bump: true });
    if (app.settings.autoThrow && round() && round().throwsLeft > 0) {
      await time.wait(260);
      if (app.run && app.run.phase === 'round' && !round().rolled && app.rv.stageName === 'play') beginThrow();
    }
  }

  // ------------------------------------------------------------------ Sieg & Niederlage
  /** Partie-Sieg (Einsatz 8): Feuerwerk, Goldblitz, großer Banner – der Moment des Laufs. */
  async function celebrateRun() {
    app.wonFanfare = true; // Spielende-Bildschirm spielt die Fanfare nicht noch einmal
    audio.play('run_won');
    audio.music.duck(6, 1600);
    background.setPalette('win');
    background.pulse(1);
    bigHit({ hitstop: 90, trauma: 0.55, flashAlpha: 0.35 });
    particles.confetti(90);
    const W = window.innerWidth, H = window.innerHeight;
    const cols = ['#ffd166', '#ff5fa2', '#3ee6c4', '#c77dff', '#7fb8ff', '#f4ecd8'];
    for (let k = 0; k < 7; k++) {
      time.wait(140 + k * 210).then(() => {
        const x = W * (0.15 + Math.random() * 0.7), y = H * (0.12 + Math.random() * 0.35);
        particles.burst(x, y, { count: 34, color: [cols[k % cols.length], '#ffffff'], shape: 'spark', speed: [220, 620], life: [0.6, 1.1], gravity: 380 });
        particles.ring(x, y, { radius: 110, color: cols[k % cols.length], life: 0.5 });
        audio.play('coin', { pitch: k * 2, gain: 0.7 });
        shake.add(0.12);
      });
    }
    time.wait(900).then(() => particles.confetti(60));
    await banner(T.runWon, { kind: 'win', sub: `Alle ${G.ANTES_TO_WIN} Einsätze geschafft!`, hold: 1700 });
  }

  /** Niederlage: kurzer, harter Schnitt – Würfel „sterben“, Welt entsättigt, roter Blitz. */
  async function defeat() {
    audio.play('round_lost');
    audio.music.duck(8, 1400);
    background.setPalette('lose');
    bigHit({ hitstop: 80, trauma: 0.5, flashAlpha: 0 });
    flash('#ff2244', 0.28, 260);
    for (let i = 0; i < tray.count; i++) {
      const d = tray.die(i);
      if (!d) continue;
      d.setDebuffed(true);
      time.wait(i * 60).then(() => { d.resist(); d.juice(0.2); });
    }
    const veil = h('div.fx-defeat');
    document.body.appendChild(veil);
    void veil.offsetWidth;
    veil.classList.add('fx-defeat--on');
    const r = app.run.round;
    await banner(T.runLost, { kind: 'lose', sub: `${fmt(r ? r.score : 0)} von ${fmt(r ? r.target : 0)} Punkten`, hold: 900 });
    veil.classList.remove('fx-defeat--on');
    setTimeout(() => veil.remove(), 400);
    for (let i = 0; i < tray.count; i++) if (tray.die(i)) tray.die(i).setDebuffed(false);
  }

  // ------------------------------------------------------------------ Werkzeug-Folgen (vom App-Controller)
  async function onConsumableEvents(events) {
    const r = round();
    if (!r) return;
    for (const e of events) {
      if (e.type === 'nudge' || e.type === 'flip') {
        const x = r.rolled && r.rolled[e.die];
        if (x) {
          audio.play('card_flip');
          popup(...topOf(e.die), e.type === 'nudge' ? 'Gestupst!' : 'Gewendet!', { kind: 'info' });
          await tray.turn(e.die, x.v, { faceIndex: x.faceIndex, hidden: x.hidden });
        }
      }
    }
    tray.setDice(app.run.dice, r.rolled || null);
    if (r.rolled) r.rolled.forEach((x, i) => { tray.setHeld(i, !!x.held); tray.die(i).setShackled(!!x.shackled); });
    for (const e of events) {
      if (e.type === 'faceChange' || e.type === 'dieChange') {
        const i = app.run.dice.findIndex((d) => d.id === e.dieId);
        if (i >= 0 && tray.die(i)) tray.die(i).juice(0.4);
      }
      if (e.type === 'gainDie') {
        const i = app.run.dice.findIndex((d) => d.id === e.dieId);
        if (i >= 0 && tray.die(i)) popIn(tray.die(i).el, 300);
      }
    }
    refreshHands();
    refreshButtons();
  }

  // ------------------------------------------------------------------ Lebenszyklus
  return {
    el, tray,
    get busy() { return busy; },
    async enter() {
      entered = true;
      const r = round();
      syncDice();
      refreshHands(true);
      refreshButtons();
      const w = r && r.wardenId ? G.WARDENS[r.wardenId] : null;
      app.mood(w ? 'warden' : 'round');
      background.setIntensity(0.15);
      if (r && !r.rolled && r.throwsUsed === 0 && r.score === 0) {
        busy = true;
        refreshButtons();
        await time.wait(120);
        if (w) {
          audio.play('warden_reveal');
          shake.add(0.3);
          await banner(w.name, { kind: 'warden', sub: w.desc, hold: 1100 });
        } else {
          audio.play('whoosh');
          await banner(r.kind === 'small' ? 'Kleine Partie' : 'Große Partie', { kind: 'info', sub: `Ziel: ${fmt(r.target)} Punkte`, hold: 650 });
        }
        busy = false;
        refreshButtons();
        if (app.settings.autoThrow && app.rv.stageName === 'play') beginThrow();
        else app.tutorial('begin', () => hint(bBegin, '<b>Wurf beginnen</b> wirft alle Würfel. Taste: <b>Leertaste</b>.', { side: 'above' }));
      }
      tray.layout();
    },
    leave() { entered = false; closeHint(); el.classList.remove('play--over', 'play--last'); },
    refresh() { if (entered) { refreshHands(); refreshButtons(); } },
    onConsumableEvents,
    onKey(e) {
      if (busy) return false;
      const r = round();
      if (!r) return false;
      if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        if (e.repeat) return true;
        if (!r.rolled) beginThrow(); else if (bReroll.getAttribute('aria-disabled') === 'true') { nope(bReroll); audio.play('deny'); } else reroll();
        return true;
      }
      if (e.key === 'Enter') { if (r.rolled && !e.repeat) score(); return true; }
      if (/^[1-7]$/.test(e.key)) { toggleHold(Number(e.key) - 1); return true; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const allowed = hands.filter((x) => x.allowed);
        if (!allowed.length) return true;
        let k = allowed.findIndex((x) => x.handId === selected);
        k = (k + (e.key === 'ArrowRight' ? 1 : -1) + allowed.length) % allowed.length;
        selectHand(allowed[k].handId);
        return true;
      }
      return false;
    },
  };
}
