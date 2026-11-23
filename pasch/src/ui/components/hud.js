// Seitenleiste (Hochformat: kompakter Kopf): Partie, Ziel, Ergebnis, Scorebox, Würfe/Nachwürfe, Geld, Einsatz.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { juice, tickNumber, pop, ease } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { createScorebox } from './scorebox.js';
import { iconButton, button } from './button.js';
import { attachTooltip } from '../tooltip.js';
import { fmt, money, rich, T } from '../text.js';

export function createHud(app) {
  const blindName = h('div.hud-blind-name');
  const blindGlyph = h('div.hud-blind-glyph');
  const blindDesc = h('div.hud-blind-desc');
  const blind = h('div.hud-blind', blindGlyph, h('div.hud-blind-txt', blindName, blindDesc));
  const target = h('div.hud-val.hud-target-val', '0');
  const score = h('div.hud-val.hud-score-val', '0');
  const barFill = h('div.bar-fill');
  const bar = h('div.bar', barFill);
  const targetBox = h('div.hud-cell.hud-target', h('div.hud-cap', T.target), target);
  const scoreBox = h('div.hud-cell.hud-score', h('div.hud-cap', T.result), score, bar);
  const sb = createScorebox();
  const throws = h('div.hud-num.hud-throws', '0');
  const rerolls = h('div.hud-num.hud-rerolls', '0');
  const moneyEl = h('div.hud-num.hud-money', '$0');
  const ante = h('div.hud-num.hud-ante', '1/8');
  const cThrows = h('div.hud-stat.hud-stat--throws', h('div.hud-cap', T.throws), throws);
  const cRerolls = h('div.hud-stat.hud-stat--rerolls', h('div.hud-cap', T.rerolls), rerolls);
  const cMoney = h('div.hud-stat.hud-stat--money', h('div.hud-cap', T.money), moneyEl);
  const cAnte = h('div.hud-stat.hud-stat--ante', h('div.hud-cap', T.ante), ante);
  const tags = h('div.hud-tags');
  const bHands = button(T.handTable, { kind: 'plain', size: 's', icon: '☰', onClick: () => app.showHandTable() });
  const bDice = button(T.yourDice, { kind: 'plain', size: 's', icon: '⚄', onClick: () => app.showInspector() });
  const bOpt = iconButton('⚙', { kind: 'plain', size: 's', title: T.options, onClick: () => app.pause() });
  bOpt.setLabel('', null);
  bOpt.setAttribute('aria-label', T.options);
  const el = h('aside.hud',
    blind,
    h('div.hud-goal', targetBox, scoreBox),
    sb.el,
    h('div.hud-stats', cThrows, cRerolls, cMoney, cAnte),
    tags,
    h('div.hud-buttons', bHands, bDice, bOpt));

  attachTooltip(blind, () => {
    const run = app.run;
    if (!run) return null;
    const b = run.blinds[run.blindIndex];
    if (!b) return null;
    const w = b.kind === 'warden' ? G.WARDENS[b.wardenId] : null;
    return {
      title: w ? w.name : b.name, kind: b.name, hue: w ? w.hue : 270,
      body: rich(w ? `${w.desc} Ziel ${fmt(b.target)} Punkte, Belohnung $${b.reward}.` : `Ziel ${fmt(b.target)} Punkte, Belohnung $${b.reward}.`),
    };
  }, { below: true });
  attachTooltip(cMoney, () => {
    const run = app.run;
    if (!run) return null;
    const cap = G.getRoundRules(run).interestCap;
    return { title: 'Geld', kind: 'Zinsen', hue: 48, body: rich(`Bei der Abrechnung: $1 Zinsen je $5 (höchstens $${cap}).`) };
  }, { below: true });
  attachTooltip(cRerolls, () => ({ title: T.rerolls, kind: 'Vorrat der Partie', hue: 200, body: 'Ein Nachwurf wirft alle nicht gehaltenen Würfel neu. Der Vorrat gilt für die ganze Partie.' }), { below: true });
  attachTooltip(cThrows, () => ({ title: T.throws, kind: 'Partie', hue: 330, body: 'Jedes Werten kostet einen Wurf. Ziel nicht erreicht und keine Würfe mehr: der Lauf ist verloren.' }), { below: true });

  let shownMoney = null;
  let shownScore = 0;

  const api = {
    el, sb, moneyEl, scoreEl: score, barFill, throwsEl: throws, rerollsEl: rerolls, targetEl: target, cMoney, bDice,
    get shownMoney() { return shownMoney; },
    update(o = {}) {
      const run = app.run;
      if (!run) return;
      const b = run.blinds[run.blindIndex] || run.blinds[2];
      const inRound = run.round && (run.phase === 'round' || run.phase === 'cashout' || run.phase === 'lost' || run.phase === 'won');
      const w = b && b.kind === 'warden' ? G.WARDENS[b.wardenId] : null;
      const shop = run.phase === 'shop' || (run.phase === 'pack' && run.pack && run.pack.returnPhase === 'shop');
      el.classList.toggle('hud--warden', !!w && !shop);
      el.classList.toggle('hud--shop', shop);
      el.classList.toggle('hud--round', run.phase === 'round');
      if (shop) {
        blindGlyph.textContent = '⌂';
        blindName.textContent = 'Nachtmarkt';
        blindDesc.textContent = 'Laden';
        el.style.setProperty('--hue', '200');
      } else {
        blindGlyph.textContent = w ? w.glyph : b.kind === 'small' ? '✧' : '✦';
        blindName.textContent = w ? w.name : b.name;
        blindDesc.textContent = w ? w.desc : `Belohnung ${'$'.repeat(Math.min(6, b.reward))}`;
        el.style.setProperty('--hue', String(w ? w.hue : b.kind === 'small' ? 200 : 260));
      }
      target.textContent = fmt(inRound ? run.round.target : b.target);
      const sc = inRound ? run.round.score : 0;
      if (!o.keepScore) api.setScore(sc, inRound ? run.round.target : b.target);
      const rules = G.getRoundRules(run);
      const tl = run.round ? run.round.throwsLeft : rules.throws;
      const rl = run.round ? run.round.rerollsLeft : rules.rerolls;
      setNum(throws, tl, o.bump);
      setNum(rerolls, rl, o.bump);
      throws.classList.toggle('hud-num--low', tl <= 1);
      rerolls.classList.toggle('hud-num--zero', rl <= 0);
      ante.textContent = `${run.ante}/${G.ANTES_TO_WIN}`;
      if (!o.keepMoney) api.setMoney(run.money, { tick: o.tickMoney });
      // Außerhalb des Spiel-Bildschirms zeigt die Scorebox den letzten Wurf statt „– 0×0“
      if (app.rv && app.rv.stageName && app.rv.stageName !== 'play') sb.setIdle();
      // Marken
      const tg = run.tags || [];
      tags.innerHTML = '';
      tags.style.display = tg.length ? '' : 'none';
      for (const id of tg) {
        const d = G.TAGS[id];
        const c = h('div.tag-chip', { vars: { hue: d.hue } }, h('span', d.glyph));
        attachTooltip(c, () => ({ title: d.name, kind: 'Marke', hue: d.hue, body: rich(d.desc) }), { below: true });
        tags.appendChild(c);
      }
    },
    setScore(v, tgt, o = {}) {
      const t = tgt || 1;
      if (o.tick) {
        const from = shownScore;
        shownScore = v;
        return tickNumber(score, from, v, {
          format: fmt,
          duration: 220 + 130 * Math.log10(Math.max(10, Math.abs(v - from))),
          easing: ease.outQuart,
          onTick: (k, p) => { audio.play('tick', { progress: p }); barFill.style.transform = `scaleX(${Math.min(1, (from + (v - from) * p) / t)})`; },
        }).then(() => { barFill.style.transform = `scaleX(${Math.min(1, v / t)})`; juice(scoreBox, 0.2); });
      }
      shownScore = v;
      score.textContent = fmt(v);
      barFill.style.transform = `scaleX(${Math.min(1, v / t)})`;
      el.classList.toggle('hud--cleared', v >= t && v > 0);
      return Promise.resolve();
    },
    setMoney(v, o = {}) {
      if (shownMoney === null || !o.tick) {
        shownMoney = v;
        moneyEl.textContent = money(v);
        return Promise.resolve();
      }
      if (v === shownMoney) return Promise.resolve();
      const from = shownMoney;
      shownMoney = v;
      juice(cMoney, v > from ? 0.25 : 0.18);
      // Farbblitz: grün bei Gewinn, rot bei Ausgabe; am Ende kleiner Pop
      cMoney.classList.remove('hud-money--up', 'hud-money--down');
      void cMoney.offsetWidth;
      cMoney.classList.add(v > from ? 'hud-money--up' : 'hud-money--down');
      return tickNumber(moneyEl, from, v, { format: (n) => money(Math.round(n)), duration: Math.min(700, 250 + 40 * Math.abs(v - from)), onTick: (k) => audio.play('tick', { step: Math.min(10, k) }) })
        .then(() => { if (shownMoney === v) pop(moneyEl, v > from ? 1.25 : 1.12, 150); });
    },
    bumpMoney() { juice(cMoney, 0.25); pop(moneyEl, 1.3, 160); },
    moneyTarget() {
      const r = moneyEl.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    },
  };
  return api;
}

function setNum(el, v, bump) {
  const s = String(v);
  if (el.textContent !== s) {
    el.textContent = s;
    if (bump) juice(el.parentElement, 0.2);
  }
}
