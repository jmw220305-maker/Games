// Laden („Nachtmarkt“): Angebote, Beutel, Privileg, Neu mischen, weiter zur nächsten Partie.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { createCard, model } from '../components/card.js';
import { popIn, juice, nope, time, ease, setLayer, particles, background } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { T, money } from '../text.js';
import { hint } from '../overlay.js';

export function createShop(app) {
  const offersRow = h('div.shop-row.shop-offers');
  const packsRow = h('div.shop-row.shop-packs');
  const voucherRow = h('div.shop-row.shop-voucher');
  const bReroll = button(T.shopReroll, { kind: 'go', size: 'm', onClick: () => reroll(), onDenied: (r) => r && app.toast(r) });
  const bNext = button(T.nextRound, { kind: 'hot', size: 'l', onClick: () => next() });
  const el = h('section.sub.sub-shop',
    h('div.shop-top',
      h('div.shop-sign', h('div.shop-sign-title', 'Nachtmarkt'), h('div.shop-sign-sub', 'Kaufen · Verkaufen · Beutel öffnen')),
      h('div.shop-ctl', bNext, bReroll)),
    h('div.shop-shelf.shop-shelf--offers', h('div.shelf-cap', 'Angebote'), offersRow),
    h('div.shop-lower',
      h('div.shop-shelf.shop-shelf--packs', h('div.shelf-cap', 'Beutel'), packsRow),
      h('div.shop-shelf.shop-shelf--voucher', h('div.shelf-cap', 'Privileg'), voucherRow)));
  let cards = [];
  let busy = false;

  function offerEl(o, section, index, delay) {
    const run = app.run;
    const wrap = h(`div.offer.offer--${o.kind}`);
    if (o.sold) {
      wrap.classList.add('offer--sold');
      wrap.appendChild(h('div.offer-empty', 'Verkauft'));
      return wrap;
    }
    const kind = o.kind === 'consumable' ? 'consumable' : o.kind;
    const c = createCard(model(kind, o.id), { run: () => app.run, obj: o.kind === 'consumable' ? { id: o.id } : { id: o.id, state: {} } });
    cards.push(c);
    const price = o.free || o.price === 0 ? T.free : money(o.price);
    const afford = run.money >= o.price;
    const b = button(o.kind === 'pack' ? 'Öffnen' : T.buy, { kind: 'gold', size: 's', sub: price, onClick: () => buy(section, index, c, b) });
    if (!afford) b.classList.add('btn--poor');
    b.addEventListener('click', () => {}, { once: false });
    wrap.appendChild(h('div.offer-price', price));
    wrap.appendChild(c.el);
    wrap.appendChild(b);
    c.el.addEventListener('click', () => { juice(c.el, 0.15); audio.play('card_pick', { gain: 0.4 }); });
    popIn(c.el, 300, delay);
    setLayer(c.el, 'enter', { rot: (Math.random() - 0.5) * 8 });
    time.tween(300, (e) => setLayer(c.el, 'enter', { rot: (1 - e) * ((Math.random() - 0.5) * 8) }), { delay }).then(() => setLayer(c.el, 'enter', null));
    if (delay) time.wait(delay).then(() => audio.play('card_flip', { gain: 0.35, pitch: index * 2 }));
    return wrap;
  }

  function render(anim = true) {
    const run = app.run;
    const s = run.shop;
    cards.forEach((c) => c.destroy());
    cards = [];
    offersRow.innerHTML = '';
    packsRow.innerHTML = '';
    voucherRow.innerHTML = '';
    if (!s) return;
    let k = 0;
    const d = () => (anim ? 60 * k++ : 0);
    s.offers.forEach((o, i) => offersRow.appendChild(offerEl(o, 'offers', i, d())));
    s.packs.forEach((o, i) => packsRow.appendChild(offerEl(o, 'packs', i, d())));
    if (s.voucher && !s.voucher.sold) voucherRow.appendChild(offerEl(s.voucher, 'voucher', 0, d()));
    else voucherRow.appendChild(h('div.offer.offer--sold', h('div.offer-empty', s.voucher ? 'Gekauft' : 'Kein Privileg')));
    updateButtons();
  }

  function updateButtons() {
    const run = app.run;
    const s = run.shop;
    if (!s) return;
    const free = s.freeRerolls > 0;
    bReroll.setLabel(T.shopReroll, free ? `gratis (${s.freeRerolls})` : money(s.rerollCost));
    bReroll.classList.toggle('btn--poor', !free && run.money < s.rerollCost);
    for (const b of el.querySelectorAll('.offer .btn')) {
      const wrap = b.closest('.offer');
      void wrap;
    }
  }

  async function buy(section, index, card, btn) {
    if (busy) return;
    const run = app.run;
    const ref = { section, index };
    const offer = section === 'voucher' ? run.shop.voucher : run.shop[section][index];
    const r = G.buy(run, ref);
    if (!r.ok) {
      nope(card.el, 8);
      nope(btn);
      audio.play('deny');
      app.toast(r.reason, { kind: 'bad' });
      return;
    }
    busy = true;
    app.save();
    audio.play('buy');
    const from = card.el.getBoundingClientRect();
    const [mx, my] = app.rv.hud.moneyTarget();
    particles.burst(mx, my, { count: 8, shape: 'coin', speed: [120, 260] });
    app.rv.hud.setMoney(run.money, { tick: true });
    if (offer.kind === 'pack') {
      // Beutel: zur Mitte fliegen und öffnen
      await time.tween(260, (e) => setLayer(card.el, 'buy', { scale: 1 + 0.3 * e, rot: e * 8, y: -30 * e }), { ease: ease.outBack });
      app.afterAction(r.events.filter((e) => e.type !== 'money' && e.type !== 'packOpen'), { keepMoney: true });
      busy = false;
      app.rv.go('pack');
      return;
    }
    if (offer.kind === 'voucher') {
      const v = G.VOUCHERS[offer.id];
      audio.play('level_up');
      background.pulse(0.7);
      particles.burst(from.left + from.width / 2, from.top + from.height / 2, { count: 26, color: 'confetti', shape: 'confetti', speed: [200, 500] });
      await time.tween(320, (e) => setLayer(card.el, 'buy', { scale: 1 + 0.4 * e, rot: e * -10 }), { ease: ease.outBack });
      card.el.style.opacity = '0';
      app.toast(v.desc, { title: `Privileg: ${v.name}`, glyph: v.glyph, hue: v.hue, kind: 'gold' });
      app.afterAction(r.events.filter((e) => e.type !== 'money' && e.type !== 'voucher'), { keepMoney: true });
      busy = false;
      render(false);
      return;
    }
    // Talisman / Verbrauchsgut: Karte fliegt in den Platz
    app.afterAction(r.events.filter((e) => e.type !== 'money'), { keepMoney: true });
    const gain = r.events.find((e) => e.type === 'gainTalisman' || e.type === 'gainConsumable');
    const dest = gain ? app.rv.belt.cardEl(gain.uid) : null;
    card.el.style.visibility = 'hidden';
    if (dest) await flyCard(card.el, from, dest);
    busy = false;
    render(false);
  }

  async function reroll() {
    if (busy) return;
    const run = app.run;
    const r = G.shopReroll(run);
    if (!r.ok) { nope(bReroll); audio.play('deny'); app.toast(r.reason, { kind: 'bad' }); return; }
    app.save();
    audio.play('reroll_shop');
    app.rv.hud.setMoney(run.money, { tick: true });
    // alte Angebote fallen weg
    const olds = [...offersRow.querySelectorAll('.card')];
    await Promise.all(olds.map((c, i) => time.tween(160, (e) => setLayer(c, 'out', { y: 30 * e, scale: 1 - 0.6 * e, rot: (i % 2 ? 1 : -1) * 10 * e }), { delay: i * 30, ease: ease.inQuad })));
    const s = run.shop;
    cards = cards.filter((c) => { if (olds.includes(c.el)) { c.destroy(); return false; } return true; });
    offersRow.innerHTML = '';
    s.offers.forEach((o, i) => offersRow.appendChild(offerEl(o, 'offers', i, 60 * i)));
    updateButtons();
    app.afterAction(r.events.filter((e) => e.type !== 'shopReroll'), { keepMoney: true });
  }

  async function next() {
    if (busy) return;
    const run = app.run;
    const r = G.leaveShop(run);
    if (!r.ok) { app.toast(r.reason); return; }
    busy = true;
    app.save();
    audio.play('whoosh');
    for (const e of r.events) {
      if (e.type === 'newAnte') app.toast(`Wächter: ${G.WARDENS[e.wardenId].name}`, { title: `Einsatz ${e.ante}`, glyph: G.WARDENS[e.wardenId].glyph, hue: G.WARDENS[e.wardenId].hue });
    }
    app.afterAction(r.events.filter((e) => e.type !== 'newAnte'));
    busy = false;
    app.rv.go(run.phase);
  }

  return {
    el,
    enter() {
      busy = false;
      app.mood('shop');
      render(true);
      app.tutorial('shop', () => time.wait(700).then(() => hint(offersRow, '<b>Talismane</b> wirken bei jeder Wertung von links nach rechts. Ziehe sie, um die Reihenfolge zu ändern. Tippe eine Karte an, um sie zu verkaufen.', { side: 'below' })));
    },
    leave() {},
    refresh() { render(false); },
    onKey(e) {
      if (e.key === 'Enter') { if (!e.repeat) next(); return true; }
      if (e.key === 'r' || e.key === 'R') { reroll(); return true; }
      return false;
    },
  };
}

/** Karte (Klon) fliegt von Rechteck `from` zum Element `dest`, das solange unsichtbar ist. */
export async function flyCard(srcEl, from, dest) {
  const to = dest.getBoundingClientRect();
  const ghost = srcEl.cloneNode(true);
  ghost.style.visibility = 'visible';
  ghost.style.transform = '';
  ghost.classList.add('card--ghost');
  Object.assign(ghost.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, margin: '0', zIndex: '75' });
  document.body.appendChild(ghost);
  dest.style.opacity = '0';
  const sx = to.width / from.width;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  audio.play('whoosh', { gain: 0.6 });
  await time.tween(360, (e, raw) => {
    const arc = -Math.sin(raw * Math.PI) * 50;
    setLayer(ghost, 'fly', { x: dx * e, y: dy * e + arc, scale: 1 + (sx - 1) * e, rot: Math.sin(raw * Math.PI) * 14 });
  }, { ease: ease.outCubic });
  ghost.remove();
  dest.style.opacity = '';
  juice(dest, 0.35);
  audio.play('card_flip', { gain: 0.6 });
  const r = dest.getBoundingClientRect();
  particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 10, color: 'dust', shape: 'dust', speed: [80, 200] });
}
