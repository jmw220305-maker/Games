// Partie-Auswahl: 3 Partien des Einsatzes als Karten (Ziel, Belohnung, Wächter, Überspringen mit Marke).
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { attachTooltip } from '../tooltip.js';
import { popIn, juice, hoverTilt, time, nope, shake, banner } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { T, fmt, rich } from '../text.js';

const STATE = { upcoming: 'Bald', current: 'Jetzt', skipped: 'Übersprungen', done: 'Geschafft' };

export function createBlinds(app) {
  const head = h('div.sub-head');
  const row = h('div.blinds-row');
  const el = h('section.sub.sub-blinds', head, row);
  let busy = false;

  function render(anim) {
    const run = app.run;
    head.innerHTML = '';
    head.appendChild(h('div.sub-title', `Einsatz ${run.ante}`));
    head.appendChild(h('div.sub-subtitle', run.ante >= G.ANTES_TO_WIN && !run.endless ? 'Letzter Einsatz – besiege den Wächter!' : run.endless ? 'Endlos-Modus' : `Noch ${G.ANTES_TO_WIN - run.ante + 1} Einsätze bis zum Sieg`));
    row.innerHTML = '';
    run.blinds.forEach((b, i) => {
      const w = b.kind === 'warden' ? G.WARDENS[b.wardenId] : null;
      const cur = i === run.blindIndex && b.state === 'current';
      const hue = w ? w.hue : b.kind === 'small' ? 200 : 260;
      const card = h(`div.blind.blind--${b.kind}.blind--${b.state}${cur ? '.blind--current' : ''}`, { vars: { hue } });
      const inner = h('div.blind-in');
      inner.appendChild(h('div.blind-state', STATE[b.state] || ''));
      inner.appendChild(h('div.blind-name', b.name));
      inner.appendChild(h('div.blind-medal', h('span', w ? w.glyph : b.kind === 'small' ? '◔' : '◑')));
      if (w) {
        inner.appendChild(h('div.blind-warden', w.name));
        inner.appendChild(h('div.blind-desc', { html: rich(w.desc) }));
      }
      inner.appendChild(h('div.blind-target', h('div.blind-cap', 'Ziel'), h('div.blind-num', fmt(b.target))));
      inner.appendChild(h('div.blind-reward', h('span.blind-cap', 'Belohnung '), h('span.kw-money', b.reward > 0 ? '$'.repeat(Math.min(8, b.reward)) : '—')));
      const actions = h('div.blind-actions');
      if (cur) {
        actions.appendChild(button(T.play, { kind: 'hot', size: 'l', onClick: () => play() }));
        if (b.kind !== 'warden' && b.tagOffer) {
          const tg = G.TAGS[b.tagOffer];
          const sk = button(T.skip, { kind: 'plain', size: 'm', onClick: () => skip(), sub: null });
          const tagEl = h('div.blind-tag', { vars: { hue: tg.hue } }, h('div.tag-chip', { vars: { hue: tg.hue } }, h('span', tg.glyph)), h('div.blind-tag-txt', h('b', tg.name), h('span', { html: rich(tg.desc) })));
          attachTooltip(tagEl, () => ({ title: tg.name, kind: 'Marke fürs Überspringen', hue: tg.hue, body: rich(tg.desc) }));
          actions.appendChild(h('div.blind-skip', sk, tagEl));
        }
        if (w && run.vouchers.includes('v_ban')) {
          const used = run.wardenRerolledAnte === run.ante;
          const bb = button('Wächterbann', { kind: 'gold', size: 's', sub: used ? 'benutzt' : '1× pro Einsatz', onClick: () => ban() });
          if (used) bb.setDisabled(true, 'In diesem Einsatz schon benutzt');
          actions.appendChild(bb);
        }
      } else if (b.state === 'upcoming' && b.kind !== 'warden' && b.tagOffer) {
        const tg = G.TAGS[b.tagOffer];
        const tagEl = h('div.blind-tag.blind-tag--dim', { vars: { hue: tg.hue } }, h('div.tag-chip', { vars: { hue: tg.hue } }, h('span', tg.glyph)), h('div.blind-tag-txt', h('b', `Marke: ${tg.name}`)));
        attachTooltip(tagEl, () => ({ title: tg.name, kind: 'Marke fürs Überspringen', hue: tg.hue, body: rich(tg.desc) }));
        actions.appendChild(tagEl);
      } else if (w && b.state === 'upcoming' && run.vouchers.includes('v_ban') && run.wardenRerolledAnte !== run.ante) {
        actions.appendChild(button('Wächterbann', { kind: 'gold', size: 's', sub: '1× pro Einsatz', onClick: () => ban() }));
      }
      inner.appendChild(actions);
      card.appendChild(inner);
      if (w) attachTooltip(card.querySelector('.blind-medal'), () => ({ title: w.name, kind: 'Wächter', hue: w.hue, body: rich(w.desc) }));
      row.appendChild(card);
      if (anim) popIn(card, 300, 70 * i);
      hoverTilt(card, { maxDeg: 5, lift: cur ? 6 : 3, scale: 1.02 });
    });
  }

  async function play() {
    if (busy) return;
    const r = G.startBlind(app.run);
    if (!r.ok) { app.toast(r.reason); return; }
    busy = true;
    audio.play('whoosh');
    app.save();
    app.afterAction(r.events.filter((e) => e.type !== 'warden'));
    const curEl = row.querySelector('.blind--current');
    if (curEl) juice(curEl, 0.3);
    await time.wait(160);
    busy = false;
    app.rv.go('round');
  }

  async function skip() {
    if (busy) return;
    const run = app.run;
    const r = G.skipBlind(run);
    if (!r.ok) { app.toast(r.reason); return; }
    busy = true;
    app.save();
    audio.play('tag');
    const curEl = row.querySelector('.blind--current');
    if (curEl) { curEl.classList.add('blind--skipping'); nope(curEl, 10, 2, 200); }
    for (const e of r.events) {
      if (e.type === 'tag') {
        const tg = G.TAGS[e.id];
        app.toast(tg.desc, { title: `Marke: ${tg.name}`, glyph: tg.glyph, hue: tg.hue, kind: 'gold' });
      }
    }
    app.afterAction(r.events.filter((e) => e.type !== 'tag'));
    await time.wait(240);
    busy = false;
    if (run.phase === 'pack') app.rv.go('pack');
    else render(true);
  }

  async function ban() {
    const run = app.run;
    const r = G.rerollWarden(run);
    if (!r.ok) { app.toast(r.reason); audio.play('deny'); return; }
    app.save();
    audio.play('warden_reveal');
    shake.add(0.3);
    render(true);
    const w = G.WARDENS[run.wardens.current];
    banner(w.name, { kind: 'warden', sub: w.desc, hold: 800 });
    app.rv.hud.update();
  }

  return {
    el,
    enter() {
      const run = app.run;
      const b = run.blinds[run.blindIndex];
      app.mood(b && b.kind === 'warden' ? 'warden' : 'round');
      render(true);
      app.tutorial('blinds', () => null);
    },
    leave() {},
    refresh() { render(false); },
    onKey(e) {
      if (e.key === 'Enter' || e.key === ' ') { if (!e.repeat) play(); return true; }
      return false;
    },
  };
}
