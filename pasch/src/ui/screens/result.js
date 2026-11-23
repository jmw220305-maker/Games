// Abrechnung nach gewonnener Partie: Zeilen mit Tickern, fliegende Münzen zur Geldanzeige.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { popIn, juice, time, tickNumber, particles, background } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { T, fmt, money } from '../text.js';

const KIND_GLYPH = { reward: '♛', throws: '⚄', interest: '%', talisman: '♢', tag: '✶' };

export function createResult(app) {
  const panel = h('div.panel.result-panel');
  const el = h('section.sub.sub-result', panel);
  let busy = false;
  let btn = null;
  let total = 0;

  async function render() {
    const run = app.run;
    const lines = G.previewCashOut(run) || [];
    total = lines.reduce((a, b) => a + b.amount, 0);
    panel.innerHTML = '';
    const r = run.round;
    const b = run.blinds[run.blindIndex];
    const w = b && b.kind === 'warden' ? G.WARDENS[b.wardenId] : null;
    panel.appendChild(h('div.result-title', T.roundWon));
    panel.appendChild(h('div.result-sub', `${w ? w.name : b.name} · ${fmt(r ? r.score : 0)} / ${fmt(r ? r.target : 0)}`));
    const list = h('div.result-lines');
    panel.appendChild(list);
    btn = button(T.cashOut, { kind: 'gold', size: 'l', sub: money(total), onClick: () => collect() });
    btn.setDisabled(true, 'Einen Moment …');
    const totalEl = h('div.result-total', h('span', 'Gesamt'), h('b.kw-money', '$0'));
    panel.appendChild(totalEl);
    panel.appendChild(h('div.result-actions', btn));
    popIn(panel, 280);
    audio.play('whoosh');
    await time.wait(260);
    let sum = 0;
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      const amt = h('b.result-amt.kw-money', '$0');
      const row = h(`div.result-line.result-line--${l.kind}`, h('span.result-glyph', KIND_GLYPH[l.kind] || '•'), h('span.result-label', l.label), amt);
      list.appendChild(row);
      popIn(row, 220);
      audio.play('coin', { pitch: k * 2 });
      await tickNumber(amt, 0, l.amount, { format: (n) => money(Math.round(n)), duration: 200 + 40 * l.amount, onTick: (s) => audio.play('tick', { step: Math.min(10, s + k) }) });
      sum += l.amount;
      totalEl.lastChild.textContent = money(sum);
      juice(totalEl, 0.15);
      await time.wait(110);
    }
    juice(totalEl, 0.3);
    btn.setDisabled(false);
    juice(btn, 0.25);
    app.tutorial('cashout', () => null);
  }

  async function collect() {
    if (busy) return;
    busy = true;
    const run = app.run;
    const res = G.cashOut(run);
    if (!res.ok) { app.toast(res.reason); busy = false; return; }
    app.save();
    btn.setDisabled(true);
    const r = btn.getBoundingClientRect();
    const [mx, my] = app.rv.hud.moneyTarget();
    audio.play('money');
    const n = Math.min(14, Math.max(3, res.total));
    let arrived = 0;
    const from = app.rv.hud.shownMoney;
    await particles.flyCoins(r.left + r.width / 2, r.top + r.height / 2, mx, my, {
      count: n, dur: 420, stagger: 45,
      onArrive: (i) => {
        arrived++;
        audio.play('coin', { pitch: Math.min(12, i) });
        app.rv.hud.setMoney(Math.round(from + (res.total * arrived) / n));
        app.rv.hud.bumpMoney();
      },
    });
    app.rv.hud.setMoney(run.money);
    background.pulse(0.5);
    app.afterAction(res.events.filter((e) => e.type !== 'money'));
    await time.wait(150);
    busy = false;
    app.rv.go(run.phase);
  }

  return {
    el,
    enter() { busy = false; app.mood('shop'); render(); },
    leave() {},
    refresh() {},
    onKey(e) {
      if ((e.key === 'Enter' || e.key === ' ') && btn && btn.getAttribute('aria-disabled') !== 'true') { collect(); return true; }
      return false;
    },
  };
}
