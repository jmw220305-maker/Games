// Spielt ScoreResult.steps als Animation ab (ARCHITECTURE §6, research_feel §1.4 / §6).
import {
  time, juice, springTo, popup, banner, flash, bigHit, shake, particles, background, flameIntensity,
} from '../fx/index.js';
import { audio } from '../audio/audio.js';
import { T } from './text.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * playScore(app, result) → Promise. Erwartet app.rv (hud, belt, play.tray).
 * Tippen/Klicken während des Abspielens = time.skipping (Spieluhr ×8).
 */
export async function playScore(app, result) {
  const rv = app.rv;
  const tray = rv.play.tray;
  const hud = rv.hud;
  const sb = hud.sb;
  const belt = rv.belt;
  const run = app.run;

  const onSkip = () => { time.skipping = true; };
  document.addEventListener('pointerdown', onSkip, true);
  time.skipping = false;
  audio.music.scoringOpen(true);
  background.setIntensity(0.9);
  background.pulse(0.6);
  sb.hideTotal();

  const moneyBase = run.money - (result.money || 0);
  let moneyShown = moneyBase;
  hud.setMoney(moneyBase);

  try {
    if (result.fizzle) {
      await fizzle(app, result);
      return;
    }
    const remaining = Math.max(1, result.target - result.scoreBefore);
    let n = 0;
    let flamesOn = false;
    const gap = () => Math.max(120, 450 * Math.pow(0.9, n));

    for (const s of result.steps) {
      const src = sourcePoint(s);
      switch (s.type) {
        case 'hand': {
          audio.play('hand_reveal');
          sb.setHand(result.handName, result.level, { pop: true });
          sb.set(s.chips, s.mult, { bump: 'both', amount: 0.3 });
          banner(result.handName, { kind: 'hand', sub: `Stufe ${result.level}`, hold: 520, y: bannerY() });
          tray.onHighlight = (i, k) => audio.play('chip', { step: k, gain: 0.6 });
          await tray.highlight(result.dice, { gap: 85, amount: 0.3 });
          tray.onHighlight = null;
          await time.wait(380);
          break;
        }
        case 'chips':
        case 'mult':
        case 'xmult': {
          const kind = s.type;
          if (src.die != null) tray.die(src.die) && tray.die(src.die).juice(0.32);
          if (src.card) cardHop(src.card);
          const val = kind === 'xmult' ? s.factor : s.amount;
          popup(src.x, src.y, kind === 'xmult' ? fmtX(val) : val, { kind, big: kind === 'xmult', hold: popHold() });
          sb.set(s.chips, s.mult, { bump: kind === 'chips' ? 'chips' : 'mult', amount: kind === 'xmult' ? 0.45 : 0.22 });
          if (kind === 'chips') {
            audio.play('chip', { step: n });
            particles.burst(src.x, src.y + 14, { count: 8, color: 'chips', shape: 'square', speed: [120, 320], life: [0.3, 0.6] });
          } else if (kind === 'mult') {
            audio.play('mult', { step: n });
            shake.add(0.12);
            particles.burst(src.x, src.y + 14, { count: 10, color: 'mult', shape: 'square', speed: [140, 360], life: [0.3, 0.6] });
          } else {
            audio.play('xmult', { step: n });
            bigHit({ hitstop: 60, trauma: 0.3, flashAlpha: 0.12 });
            const r = sb.multBox.getBoundingClientRect();
            particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 18, color: 'xmult', shape: 'spark', speed: [250, 600] });
            particles.ring(r.left + r.width / 2, r.top + r.height / 2, { radius: 70, color: '#ffd166' });
            background.pulse(0.8);
          }
          n++;
          break;
        }
        case 'money': {
          if (src.die != null && tray.die(src.die)) tray.die(src.die).juice(0.3);
          if (src.card) cardHop(src.card);
          popup(src.x, src.y, s.amount, { kind: 'money', hold: popHold() });
          audio.play('money');
          particles.burst(src.x, src.y + 10, { count: 6, shape: 'coin', speed: [180, 360] });
          moneyShown += s.amount;
          const [mx, my] = hud.moneyTarget();
          particles.flyCoins(src.x, src.y, mx, my, { count: Math.min(5, Math.max(1, s.amount)), onArrive: (i) => { audio.play('coin', { pitch: i }); if (i === 0) hud.bumpMoney(); } });
          hud.setMoney(moneyShown, { tick: true });
          n++;
          break;
        }
        case 'retrigger': {
          if (src.die != null && tray.die(src.die)) tray.die(src.die).juice(0.45);
          if (src.card) cardHop(src.card);
          const dp = s.dieIndex != null ? diePoint(s.dieIndex) : src;
          popup(dp.x, dp.y - 8, T.again, { kind: 'info', hold: popHold() });
          audio.play('retrigger', { step: n });
          n++;
          break;
        }
        case 'text': {
          if (src.card) cardHop(src.card);
          popup(src.x, src.y, s.text, { kind: 'info', hold: popHold() + 150 });
          audio.play(s.source.kind === 'warden' ? 'warden_reveal' : 'hover', { gain: 0.8 });
          break;
        }
        case 'grow': {
          if (src.card) cardHop(src.card, 0.4);
          popup(src.x, src.y, s.text, { kind: 'info', hold: popHold() });
          audio.play('grow');
          break;
        }
        case 'shatter': {
          const i = s.dieIndex != null ? s.dieIndex : s.source.index;
          const p = diePoint(i);
          audio.play('shatter');
          particles.burst(p.x, p.y + 24, { count: 20, color: ['#c4e8ff', '#ffffff', '#6ea8eb'], shape: 'spark', speed: [200, 520] });
          popup(p.x, p.y, 'Zersprungen!', { kind: 'info', hold: popHold() });
          const d = tray.die(i);
          if (d && run.dice[i]) { d.setData(run.dice[i]); d.juice(0.4); }
          shake.add(0.2);
          break;
        }
        default: break;
      }
      // Flammen live, sobald das Ziel mit diesem Wurf fällt
      const cur = Math.floor(s.chips * s.mult);
      if (s.type !== 'hand' && cur >= remaining && cur > 0) {
        sb.flames(flameIntensity(cur, remaining));
        if (!flamesOn) { flamesOn = true; audio.play('flame'); }
      }
      if (s.type !== 'hand') await time.wait(gap());
    }

    // ---- Ende: Punkte × Multi verschmelzen zur Summe
    await time.wait(160);
    audio.play('whoosh');
    await sb.merge();
    await sb.showTotal(result.total, { onTick: (k, p) => audio.play('tick', { progress: p }) });
    const mag = Math.log10(Math.max(10, result.total));
    shake.add(clamp(0.1 + (mag - 1) * 0.09, 0.1, 0.75));
    juice(sb.totalEl, clamp(0.2 + mag * 0.04, 0.2, 0.5));
    if (result.total >= 1000) background.pulse(clamp(mag / 6, 0.3, 1));
    if (result.cleared) sb.flames(Math.max(sb.flameLevel, flameIntensity(result.total, remaining)));
    await time.wait(200);
    // Ergebnis zählt hoch
    const crossing = result.scoreAfter >= result.target && result.scoreBefore < result.target;
    await hud.setScore(result.scoreAfter, result.target, { tick: true });
    if (crossing) {
      audio.play('target_cross');
      audio.music.duck(5, 600);
      flash('#ffffff', 0.25, 150);
      particles.confetti(46);
      background.pulse(1);
      shake.add(0.35);
      juice(hud.scoreEl.parentElement, 0.4);
      await time.wait(350);
    }
    await time.wait(300);
  } finally {
    document.removeEventListener('pointerdown', onSkip, true);
    time.skipping = false;
    audio.music.scoringOpen(false);
    background.setIntensity(run.phase === 'round' ? 0.15 : 0.1);
    hud.setMoney(run.money);
    sb.hideTotal();
    tray.onHighlight = null;
  }

  // ------------------------------------------------------------------ Hilfen
  function popHold() { return Math.max(260, 500 - n * 25); }
  function bannerY() { return window.innerHeight > window.innerWidth ? 0.42 : 0.36; }

  function diePoint(i) {
    const r = tray.getDieRect(i);
    if (!r) return centerOf(sb.el);
    return { x: r.left + r.width / 2, y: r.top - 10 };
  }

  function sourcePoint(s) {
    const k = s.source && s.source.kind;
    if (k === 'talisman') {
      const el = (s.source.uid && belt.cardEl(s.source.uid)) || belt.talismanEl(s.source.index);
      if (el) {
        const r = el.getBoundingClientRect();
        const portrait = window.innerHeight > window.innerWidth;
        return { x: r.left + r.width / 2, y: portrait ? r.bottom + 16 : r.bottom + 22, card: el, die: s.dieIndex };
      }
    }
    if ((k === 'die' || k === 'face') || s.dieIndex != null) {
      const i = s.dieIndex != null ? s.dieIndex : s.source.index;
      const p = diePoint(i);
      return { ...p, die: k === 'talisman' ? null : i };
    }
    if (k === 'warden') {
      const el = hud.el.querySelector('.hud-blind');
      const c = centerOf(el || sb.el);
      return { x: c.x, y: c.y + 30 };
    }
    const c = centerOf(sb.el);
    return { x: c.x, y: c.y - 30 };
  }
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function cardHop(el, amount = 0.3) {
  juice(el, amount);
  springTo(el, { y: -14 }, { layer: 'hop', k: 420, damp: 0.7 }).then(() => springTo(el, { y: 0 }, { layer: 'hop', k: 300, damp: 0.75 }));
}

function fmtX(f) {
  return `×${String(Math.round(f * 100) / 100).replace('.', ',')}`;
}

async function fizzle(app, result) {
  const tray = app.rv.play.tray;
  const sb = app.rv.hud.sb;
  audio.play('error');
  sb.setHand('Fehlwurf', null, { pop: true, bad: true });
  sb.set(0, 0, { bump: 'both' });
  banner('Fehlwurf', { kind: 'lose', sub: 'Keine erlaubte Hand – 0 Punkte', hold: 800 });
  for (let i = 0; i < tray.count; i++) {
    const d = tray.die(i);
    d.setDebuffed(true);
    d.resist();
  }
  shake.add(0.25);
  await time.wait(1100);
  for (let i = 0; i < tray.count; i++) tray.die(i).setDebuffed(false);
  await app.rv.hud.setScore(result.scoreAfter, result.target, { tick: false });
}
