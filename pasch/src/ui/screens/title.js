// Titelbildschirm: großes Logo „PASCH“ mit springenden Buchstaben und echten Würfeln, Menü, Neues Spiel.
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { button } from '../components/button.js';
import { createDie } from '../components/die.js';
import { juice, idleSway, popIn, time, shake, particles, banner, springTo } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { openModal } from '../overlay.js';
import { attachTooltip } from '../tooltip.js';
import { T, rich } from '../text.js';

export function createTitle(app) {
  const letters = 'PASCH'.split('').map((ch, i) => h('span.logo-letter', { vars: { i } }, h('span.logo-ch', ch)));
  const logo = h('h1.logo', { 'aria-label': 'Pasch' }, letters);
  const diceRow = h('div.title-dice');
  const menu = h('div.title-menu');
  const foot = h('div.title-foot');
  const lanterns = h('div.lanterns', Array.from({ length: 9 }, (_, i) => h('span.lantern', { vars: { i, hue: [330, 45, 175, 280, 20, 200, 330, 45, 175][i] } })));
  const el = h('section.screen.screen-title', lanterns, h('div.title-center', logo, h('div.title-tag', T.tagline), diceRow, menu), foot);

  const offs = [];
  letters.forEach((l, i) => {
    offs.push(idleSway(l, i * 37 + 5, { deg: 3, px: 5 }));
    l.addEventListener('pointerdown', () => { audio.init(); juice(l, 0.5); audio.play('chip', { step: i * 2 }); shake.add(0.08); });
  });

  // Würfel
  const dice = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    const d = createDie({ id: `t${i}`, sides: 6, material: i === 2 ? 'crystal' : null, faces: [1, 2, 3, 4, 5, 6].map((v) => ({ v, mark: null })) }, { value: 'PASCH'.length - i });
    d.el.style.setProperty('--die-size', 'var(--title-die)');
    d.onLand = (imp) => audio.play('dice_clack', { gain: Math.min(1.5, imp || 0.5), pan: (i / (N - 1) - 0.5) * 0.6 });
    d.el.addEventListener('click', () => { audio.init(); rollOne(i); });
    diceRow.appendChild(d.el);
    dice.push(d);
  }
  let rolling = false;
  let alive = true;
  let rollCount = 0;
  async function rollAll() {
    if (rolling || !alive) return;
    rolling = true;
    rollCount++;
    const pasch = rollCount % 4 === 3;
    const v0 = 1 + Math.floor(Math.random() * 6);
    audio.play('dice_rattle', { gain: 0.6 });
    await Promise.all(dice.map((d, i) => d.roll(pasch ? v0 : 1 + Math.floor(Math.random() * 6), { delay: i * 60, suspense: i === N - 1 })));
    rolling = false;
    if (!alive) return;
    if (pasch) {
      dice.forEach((d, i) => time.wait(i * 70).then(() => { d.juice(0.4); audio.play('chip', { step: i * 2 }); }));
      await time.wait(400);
      letters.forEach((l, i) => time.wait(i * 60).then(() => juice(l, 0.5)));
      const r = diceRow.getBoundingClientRect();
      particles.burst(r.left + r.width / 2, r.top, { count: 26, color: 'confetti', shape: 'confetti', speed: [200, 520] });
      audio.play('xmult');
      shake.add(0.2);
    }
  }
  function rollOne(i) {
    dice[i].roll(1 + Math.floor(Math.random() * 6));
  }
  const loop = async () => {
    await time.wait(900);
    while (alive) {
      await rollAll();
      await waitReal(3600);
    }
  };

  function renderMenu() {
    menu.innerHTML = '';
    const saved = app.savedRun();
    const items = [];
    if (saved) {
      items.push(button(T.continue, { kind: 'hot', size: 'l', sub: `Einsatz ${saved.ante} · ${G.CUPS[saved.cup].name}${saved.phase === 'won' ? ' · gewonnen' : ''}`, onClick: () => app.continueRun() }));
    }
    items.push(button(T.newGame, { kind: saved ? 'go' : 'hot', size: 'l', onClick: () => app.newRunDialog() }));
    const row = h('div.title-menu-row',
      button(T.collection, { kind: 'plain', size: 'm', icon: '❖', onClick: () => app.showCollection() }),
      button(T.settings, { kind: 'plain', size: 'm', icon: '⚙', onClick: () => app.showSettings() }));
    items.forEach((b, i) => { menu.appendChild(b); popIn(b, 260, 300 + i * 80); });
    menu.appendChild(row);
    popIn(row, 260, 300 + items.length * 80);
    const st = app.profile.stats;
    const cs = G.meta.collectionSummary(app.profile).counts;
    foot.textContent = st.runs ? `Läufe ${st.runs} · Siege ${st.wins} · Bester Wurf ${st.bestThrow.toLocaleString('de-DE')} · Erfolge ${cs.achievements}/${cs.achievementsTotal}` : 'Ein Würfel-Roguelike vom Neon-Nachtmarkt';
  }

  return {
    el,
    enter() {
      app.mood('menu');
      renderMenu();
      letters.forEach((l, i) => { popIn(l, 380, 80 * i); time.wait(80 * i + 200).then(() => audio.play('chip', { step: i * 2, gain: 0.5 })); });
      loop();
    },
    leave() { alive = false; offs.forEach((f) => f()); dice.forEach((d) => d.destroy()); },
    onKey(e) {
      if (e.key === 'Enter') { const b = menu.querySelector('.btn'); if (b) b.click(); return true; }
      return false;
    },
  };
}

function waitReal(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Dialog „Neues Spiel“: Becher, Stufe, Startwert. → ruft app.startRun */
export function newRunDialog(app) {
  const p = app.profile;
  let cup = p.lastCup && G.meta.isCupUnlocked(p, p.lastCup) ? p.lastCup : 'wood';
  let stake = 1;
  const cupsEl = h('div.cups');
  const cupInfo = h('div.cup-info');
  const stakesEl = h('div.stakes');
  const stakeInfo = h('div.stake-info');
  const seed = h('input.seed-input', { type: 'text', placeholder: T.seedHint, maxlength: 16, spellcheck: 'false', autocomplete: 'off' });

  function render() {
    cupsEl.innerHTML = '';
    for (const id of G.CUP_IDS) {
      const c = G.CUPS[id];
      const unlocked = G.meta.isCupUnlocked(p, id);
      const b = h(`button.cup${unlocked ? '' : '.cup--locked'}${id === cup ? '.cup--sel' : ''}`, { type: 'button', vars: { hue: c.hue } },
        h('span.cup-glyph', unlocked ? cupGlyph(id) : '🔒︎'.replace('🔒︎', '✕')),
        h('span.cup-name', c.name));
      if (!unlocked) b.querySelector('.cup-glyph').textContent = '?';
      b.addEventListener('click', () => {
        audio.init();
        if (!unlocked) { audio.play('deny'); juice(b, 0.2); showCup(id); return; }
        cup = id;
        stake = Math.min(stake, G.meta.maxStake(p, id));
        audio.play('card_pick');
        render();
        juice(cupsEl.querySelector('.cup--sel'), 0.25);
      });
      attachTooltip(b, () => cupTip(id));
      cupsEl.appendChild(b);
    }
    showCup(cup);
    stakesEl.innerHTML = '';
    const max = G.meta.maxStake(p, cup);
    for (const id of G.STAKE_IDS) {
      const s = G.STAKES[id];
      const ok = id <= max;
      const b = h(`button.stake${ok ? '' : '.stake--locked'}${id === stake ? '.stake--sel' : ''}`, { type: 'button', vars: { hue: s.hue } }, h('span', s.glyph));
      b.addEventListener('click', () => {
        if (!ok) { audio.play('deny'); juice(b, 0.2); stakeInfo.innerHTML = `<b>${s.name}</b> – gesperrt: gewinne mit diesem Becher auf Stufe ${id - 1}.`; return; }
        stake = id; audio.play('card_pick'); render();
      });
      attachTooltip(b, () => ({ title: `Stufe ${id}: ${s.name}`, kind: ok ? 'Schwierigkeit' : 'Gesperrt', hue: s.hue, body: rich(G.stakeRules(id).join(' ') || s.desc) }));
      stakesEl.appendChild(b);
    }
    const s = G.STAKES[stake];
    stakeInfo.innerHTML = `<b>Stufe ${stake}: ${s.name}</b> – ${rich(stake === 1 ? s.desc : G.stakeRules(stake).join(' '))}`;
  }
  function showCup(id) {
    const c = G.CUPS[id];
    const unlocked = G.meta.isCupUnlocked(p, id);
    cupInfo.innerHTML = '';
    cupInfo.appendChild(h('b', c.name));
    cupInfo.appendChild(h('span', { html: ` – ${rich(c.desc)}` }));
    if (!unlocked && c.unlock) {
      const a = G.ACHIEVEMENTS[c.unlock];
      cupInfo.appendChild(h('div.cup-lock', `Freischalten: ${a.desc}`));
    }
  }
  function cupTip(id) {
    const c = G.CUPS[id];
    const unlocked = G.meta.isCupUnlocked(p, id);
    const a = c.unlock ? G.ACHIEVEMENTS[c.unlock] : null;
    return { title: c.name, kind: unlocked ? `Becher · bis Stufe ${G.meta.maxStake(p, id)}` : 'Gesperrt', hue: c.hue, body: rich(c.desc) + (!unlocked && a ? `<br><b class="kw kw-name">Freischalten:</b> ${rich(a.desc)}` : '') };
  }
  render();
  const content = h('div.newrun',
    h('div.nr-cap', T.cup), cupsEl, cupInfo,
    h('div.nr-cap', T.stake), stakesEl, stakeInfo,
    h('label.nr-seed', h('span.nr-cap', T.seed), seed));
  const m = openModal({
    title: T.newGame, content, cls: 'modal-panel--newrun',
    buttons: [
      { label: T.back, kind: 'plain', onClick: (mm) => mm.close() },
      { label: T.start, kind: 'hot', onClick: (mm) => { mm.close(); p.lastCup = cup; app.startRun({ cup, stake, seed: seed.value.trim() || null }); } },
    ],
    onKey: (e) => { if (e.key === 'Enter') { m.panel.querySelector('.modal-buttons .btn--hot').click(); return true; } return false; },
  });
  return m;
}

function cupGlyph(id) {
  return { wood: '⊔', red: '⊔', blue: '⊔', gold: '⊔', black: '⊔', loaded: '⊔', tiny: '⊔', star: '⊔' }[id] || '⊔';
}

export { banner, springTo };
