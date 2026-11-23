// Beutel öffnen: Karten fliegen auf, drehen sich um, wählen (mit Zielwahl, wo nötig).
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { createCard, model, dieSummary } from '../components/card.js';
import { createDie } from '../components/die.js';
import { openInspector, dieNet } from '../components/inspector.js';
import { attachTooltip } from '../tooltip.js';
import { popIn, juice, nope, time, ease, setLayer, springTo, particles, shake, jitter, background, banner } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { rich } from '../text.js';
import { flyCard } from './shop.js';

export function createPack(app) {
  const head = h('div.pack-head');
  const row = h('div.pack-row');
  const bSkip = button('Überspringen', { kind: 'plain', size: 'm', onClick: () => skip() });
  const foot = h('div.pack-foot', bSkip);
  const el = h('section.sub.sub-pack', head, row, foot);
  let items = [];
  let busy = false;
  let packId = null;

  function cleanup() {
    items.forEach((it) => it.destroy && it.destroy());
    items = [];
    row.innerHTML = '';
  }

  function headText() {
    const run = app.run;
    const p = G.PACKS[run.pack.packId];
    head.innerHTML = '';
    head.appendChild(h('div.pack-glyph', { vars: { hue: p.hue } }, p.glyph));
    head.appendChild(h('div.pack-titles', h('div.sub-title', p.name), h('div.sub-subtitle', { html: `Wähle <b>${run.pack.picksLeft}</b> · ${rich(p.desc)}` })));
  }

  function actionsFor(o, i) {
    const run = app.run;
    const acts = [];
    if (o.kind === 'talisman') acts.push({ label: 'Nehmen', kind: 'go', go: () => pick(i) });
    else if (o.kind === 'consumable') {
      const def = G.CONSUMABLES[o.id];
      if (def.kind === 'star') acts.push({ label: 'Benutzen', kind: 'go', go: () => pick(i, null) });
      else {
        const roundOnly = def.usableIn === 'round';
        acts.push({ label: def.target ? 'Benutzen …' : 'Benutzen', kind: 'go', disabled: roundOnly ? 'Nur während eines Wurfs – behalten' : null, go: () => useNow(i, def) });
        acts.push({ label: 'Behalten', kind: 'plain', disabled: run.consumables.length >= run.limits.consumables ? 'Kein freier Verbrauchsplatz' : null, go: () => pick(i) });
      }
    } else if (o.kind === 'die') {
      const counted = run.dice.filter((d) => !d.src && d.material !== 'phantom').length;
      const room = (o.die.material === 'phantom' || counted < run.limits.dice) && run.dice.length < 7;
      if (room) acts.push({ label: 'Hinzufügen', kind: 'go', go: () => pick(i) });
      acts.push({ label: 'Ersetzen …', kind: room ? 'plain' : 'go', go: () => replaceDie(i, o.die) });
    }
    return acts;
  }

  function itemFor(o, i) {
    const wrap = h('div.pack-item');
    let api;
    if (o.kind === 'die') {
      const box = h('div.card.card--die', { vars: { hue: 40 } });
      const face = h('div.card-face');
      const dieHolder = h('div.pack-die3d');
      const d = createDie(o.die, { value: bestFace(o.die).v, faceIndex: bestFace(o.die).i });
      d.el.style.setProperty('--die-size', '54px');
      dieHolder.appendChild(d.el);
      face.appendChild(h('div.card-top', 'Würfel'));
      face.appendChild(dieHolder);
      face.appendChild(h('div.card-name', `W${o.die.sides}${o.die.material ? ` · ${G.MATERIAL_INFO[o.die.material].name}` : ''}`));
      box.appendChild(face);
      box.appendChild(h('div.card-back', h('div.card-back-glyph', '⚄')));
      box.classList.add('card--down');
      attachTooltip(box, () => {
        if (box.classList.contains('card--down')) return null;
        const net = dieNet(o.die, { size: 26 }).el;
        return { title: 'Besonderer Würfel', kind: dieSummary(o.die), hue: 40, body: `<div class="tt-net">${net.outerHTML}</div>${o.die.faces.filter((f) => f.mark).map((f) => `<div>${G.MARK_INFO[f.mark].name}: ${rich(G.MARK_INFO[f.mark].desc)}</div>`).join('')}${o.die.material ? `<div>${G.MATERIAL_INFO[o.die.material].name}: ${rich(G.MATERIAL_INFO[o.die.material].desc)}</div>` : ''}` };
      });
      api = { el: box, setDown: (b) => box.classList.toggle('card--down', b), destroy: () => { d.destroy(); box.remove(); }, die: d };
    } else {
      const kind = o.kind === 'consumable' ? 'consumable' : 'talisman';
      api = createCard(model(kind, o.id), { run: () => app.run, obj: kind === 'consumable' ? { id: o.id } : { id: o.id, state: {} }, down: true });
    }
    wrap.appendChild(api.el);
    const acts = h('div.pack-acts');
    for (const a of actionsFor(o, i)) {
      const b = button(a.label, { kind: a.kind, size: 's', onClick: () => a.go(), onDenied: (r) => r && app.toast(r) });
      if (a.disabled) b.setDisabled(true, a.disabled);
      acts.appendChild(b);
    }
    wrap.appendChild(acts);
    return { wrap, api, acts, o, i };
  }

  async function open(anim) {
    const run = app.run;
    cleanup();
    packId = run.pack.packId;
    headText();
    busy = true;
    bSkip.setDisabled(true);
    const p = G.PACKS[packId];
    if (anim) {
      // Beutel in der Mitte: rütteln, aufplatzen
      const bag = createCard(model('pack', packId), { tilt: false, sway: false, tooltip: false });
      bag.el.classList.add('pack-bag');
      row.appendChild(bag.el);
      popIn(bag.el, 240);
      audio.play('pack_open');
      await time.wait(200);
      await jitter(bag.el, 5, 420);
      const r = bag.el.getBoundingClientRect();
      particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 30, color: 'confetti', shape: 'confetti', speed: [200, 600] });
      particles.ring(r.left + r.width / 2, r.top + r.height / 2, { radius: 90, color: `hsl(${p.hue} 90% 70%)` });
      shake.add(0.25);
      background.pulse(0.6);
      await time.tween(160, (e) => setLayer(bag.el, 'burst', { scale: 1 + e * 0.5 }), { ease: ease.outQuad });
      bag.destroy();
    }
    items = run.pack.choices.map((o, i) => itemFor(o, i));
    items.forEach((it) => row.appendChild(it.wrap));
    // auffliegen aus der Mitte
    const rr = row.getBoundingClientRect();
    const cx = rr.left + rr.width / 2;
    const cy = rr.top + rr.height / 2;
    items.forEach((it, k) => {
      if (it.o.sold) { it.wrap.classList.add('pack-item--gone'); return; }
      const er = it.api.el.getBoundingClientRect();
      if (anim) {
        springTo(it.api.el, { x: cx - (er.left + er.width / 2), y: cy - (er.top + er.height / 2), scale: 0.4, rot: (k - items.length / 2) * 12 }, { layer: 'fly', snap: true });
        time.wait(40 + 70 * k).then(() => {
          audio.play('whoosh', { gain: 0.35, pitch: k });
          springTo(it.api.el, { x: 0, y: 0, scale: 1, rot: 0 }, { layer: 'fly', k: 200, damp: 0.74 });
        });
      }
      it.acts.style.visibility = 'hidden';
    });
    await time.wait(anim ? 420 + 70 * items.length : 0);
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (it.o.sold) continue;
      await flip(it.api, k);
      it.acts.style.visibility = '';
      popIn(it.acts, 200);
    }
    busy = false;
    bSkip.setDisabled(false);
  }

  async function flip(api, k) {
    const el2 = api.el;
    audio.play('card_flip', { pitch: k * 2 });
    await time.tween(110, (e) => setLayer(el2, 'flip', { sx: 1 - e }), { ease: ease.inQuad });
    api.setDown(false);
    await time.tween(150, (e) => setLayer(el2, 'flip', { sx: e }), { ease: ease.outBack });
    setLayer(el2, 'flip', null);
    juice(el2, 0.2);
    if (api.el.classList.contains('rar-rare') || api.el.classList.contains('rar-legendary')) {
      const r = el2.getBoundingClientRect();
      particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 16, color: 'xmult', shape: 'spark' });
      audio.play('grow');
    }
  }

  async function useNow(i, def) {
    if (busy) return;
    let target = null;
    if (def.target) {
      target = await openInspector(app, { mode: 'target', spec: def.target, def, title: def.name, sub: rich(def.desc), confirmLabel: 'Benutzen' });
      if (!target) return;
    }
    pick(i, target);
  }

  async function replaceDie(i, die) {
    if (busy) return;
    const target = await openInspector(app, {
      mode: 'target', spec: { type: 'die' }, title: 'Welcher Würfel wird ersetzt?', previewDie: die, confirmLabel: 'Ersetzen',
      dieCheck: (k) => (app.run.dice[k] && app.run.dice[k].src ? 'Dieser Würfel gehört zu einem Talisman' : null),
    });
    if (!target) return;
    pick(i, target);
  }

  async function pick(i, target) {
    if (busy) return;
    const run = app.run;
    const it = items[i];
    const r = target === undefined ? G.pickFromPack(run, i) : G.pickFromPack(run, i, target);
    if (!r.ok) {
      nope(it.api.el, 8);
      audio.play('deny');
      app.toast(r.reason, { kind: 'bad' });
      return;
    }
    busy = true;
    app.save();
    audio.play('card_pick');
    const from = it.api.el.getBoundingClientRect();
    it.acts.style.visibility = 'hidden';
    // Folgen
    const gain = r.events.find((e) => e.type === 'gainTalisman' || e.type === 'gainConsumable');
    app.afterAction(r.events.filter((e) => e.type !== 'packClosed' && e.type !== 'packOpen'), { tickMoney: true });
    const lv = r.events.filter((e) => e.type === 'levelUp');
    if (gain) {
      const dest = app.rv.belt.cardEl(gain.uid);
      it.api.el.style.visibility = 'hidden';
      if (dest) await flyCard(it.api.el, from, dest);
    } else {
      particles.burst(from.left + from.width / 2, from.top + from.height / 2, { count: 22, color: 'confetti', shape: 'confetti', speed: [150, 480] });
      await time.tween(240, (e) => setLayer(it.api.el, 'use', { scale: 1 + 0.25 * e, y: -40 * e, rot: 10 * e }), { ease: ease.outCubic });
      it.api.el.style.opacity = '0';
      if (lv.length === 1) {
        const hd = G.HANDS[lv[0].handId];
        audio.play('level_up');
        await banner(`${hd.name} Stufe ${lv[0].level}`, { kind: 'chips', sub: `${G.handBase(lv[0].handId, lv[0].level).chips} Punkte × ${G.handBase(lv[0].handId, lv[0].level).mult} Multi`, hold: 600 });
      } else if (lv.length > 1) {
        audio.play('level_up');
        await banner('Alle Hände +1 Stufe', { kind: 'chips', hold: 600 });
      } else {
        await time.wait(150);
      }
    }
    it.wrap.classList.add('pack-item--gone');
    busy = false;
    if (r.events.some((e) => e.type === 'packClosed')) {
      await time.wait(200);
      close();
    } else headText();
  }

  async function skip() {
    if (busy) return;
    const r = G.skipPack(app.run);
    if (!r.ok) { app.toast(r.reason); return; }
    app.save();
    audio.play('whoosh');
    close();
  }

  function close() {
    const run = app.run;
    if (run.phase === 'pack') {
      // nächster wartender Beutel
      open(true);
      return;
    }
    app.rv.go(run.phase);
  }

  return {
    el,
    enter() {
      busy = false;
      const run = app.run;
      app.mood(run.pack && run.pack.returnPhase === 'shop' ? 'shop' : 'round');
      open(true);
    },
    leave() { cleanup(); },
    refresh() {},
    onKey(e) {
      if (e.key === 'Escape') return false;
      if (/^[1-5]$/.test(e.key) && !busy) {
        const it = items[Number(e.key) - 1];
        if (it) { const b = it.acts.querySelector('.btn'); if (b) b.click(); }
        return true;
      }
      return false;
    },
  };
}

function bestFace(die) {
  let best = { i: 0, v: die.faces[0].v, s: -1 };
  die.faces.forEach((f, i) => {
    const s = (f.mark ? 10 : 0) + f.v;
    if (s > best.s) best = { i, v: f.v, s };
  });
  return best;
}
