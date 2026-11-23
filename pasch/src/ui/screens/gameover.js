// Spielende: Sieg oder Niederlage, Statistik, Endlos weiter / neuer Lauf / Titel.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { popIn, juice, time, particles, background, tickNumber, flash } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { T, fmt, money } from '../text.js';

export function createGameover(app) {
  const panel = h('div.panel.go-panel');
  const el = h('section.sub.sub-gameover', panel);

  async function render() {
    const run = app.run;
    const won = run.phase === 'won';
    const st = run.stats;
    panel.innerHTML = '';
    panel.classList.toggle('go-panel--won', won);
    panel.appendChild(h('div.go-title', won ? T.runWon : run.endless ? 'Endlos beendet' : T.runLost));
    let sub = '';
    if (won) sub = `Alle ${G.ANTES_TO_WIN} Einsätze geschafft – ${G.CUPS[run.cup].name}, Stufe ${run.stake}.`;
    else if (st.lostTo) {
      const lt = st.lostTo;
      const who = lt.wardenId ? G.WARDENS[lt.wardenId].name : G.BLIND_NAMES[lt.blind];
      sub = `Einsatz ${lt.ante}: ${who} – ${fmt(lt.score)} von ${fmt(lt.target)} Punkten.`;
    }
    panel.appendChild(h('div.go-sub', sub));
    const best = h('b.go-best-num', '0');
    panel.appendChild(h('div.go-best', h('div.go-cap', 'Bester Wurf'), best, h('div.go-best-hand', st.bestHand ? G.HANDS[st.bestHand].name : '–')));
    const rows = [
      ['Einsatz erreicht', `${run.ante}`],
      ['Partien gewonnen', `${st.roundsWon}`],
      ['Wächter besiegt', `${st.wardensBeaten}`],
      ['Würfe gewertet', `${st.throws}`],
      ['Nachwürfe', `${st.rerolls}`],
      ['Geld verdient', money(st.moneyEarned)],
      ['Talismane gekauft', `${st.talismansBought}`],
      ['Beutel geöffnet', `${st.packsOpened}`],
    ];
    const grid = h('div.go-stats');
    for (const [k, v] of rows) grid.appendChild(h('div.go-stat', h('span', k), h('b', v)));
    panel.appendChild(grid);
    panel.appendChild(h('div.go-seed', `Startwert: ${run.seed}`));
    const btns = h('div.go-buttons');
    if (won && !run.endless) btns.appendChild(button(T.endless, { kind: 'hot', size: 'l', onClick: () => endless() }));
    btns.appendChild(button(T.newRun, { kind: won ? 'go' : 'hot', size: 'l', onClick: () => app.newRunDialog() }));
    btns.appendChild(button(T.toTitle, { kind: 'plain', size: 'm', onClick: () => app.showTitle() }));
    panel.appendChild(btns);
    popIn(panel, 320);
    if (won) {
      background.setPalette('win');
      // die Fanfare lief schon im Spiel-Bildschirm (Partie-Sieg) – hier nur ein Nachklang
      if (app.wonFanfare) audio.play('level_up');
      else audio.play('run_won');
      app.wonFanfare = false;
      flash('#fff6e0', 0.3, 200);
      particles.confetti(80);
      time.wait(600).then(() => particles.confetti(50));
    } else {
      background.setPalette('lose');
    }
    await time.wait(300);
    tickNumber(best, 0, st.bestThrow, { format: fmt, onTick: (k, p) => audio.play('tick', { progress: p }) }).then(() => juice(best, 0.3));
  }

  async function endless() {
    const r = G.continueEndless(app.run);
    if (!r.ok) { app.toast(r.reason); return; }
    app.save();
    audio.play('level_up');
    app.toast('Die Ziele wachsen weiter. Wie weit kommst du?', { title: 'Endlos-Modus', glyph: '∞', hue: 280, kind: 'gold' });
    app.rv.go(app.run.phase);
  }

  return {
    el,
    enter() {
      app.finishRun();
      app.mood(app.run.phase === 'won' ? 'win' : 'lose');
      render();
    },
    leave() {},
    refresh() {},
    onKey() { return false; },
  };
}
