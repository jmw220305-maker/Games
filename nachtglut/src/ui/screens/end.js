// Death / victory screen from the run:end payload (summary incl. ash/ashParts/unlocks set by the tracker).
import { h, icon, button, setText } from '../dom.js';
import { attachTooltip, tipContent } from '../tooltip.js';
import { content, biomeFor, enemyName } from '../content.js';
import { fmtInt, fmtTime, rarityInfo, descAt, easeOutCubic, text } from '../format.js';
import { sectionTitle } from './common.js';

const UNLOCK_ICON = {
  character: { glyph: 'mask', color: '#ffd35a' },
  weapon: { glyph: 'sword', color: '#ffb347' },
  difficulty: { glyph: 'flame', color: '#ff8a3c' },
};

export function createEnd(ui, params = {}) {
  const game = ui.game;
  const payload = params.payload || {};
  const s = payload.summary || {};
  const victory = !!(payload.victory ?? s.victory);
  const st = s.stats || {};
  const floor = s.floor || 1;
  const biome = biomeFor(s.biome || floor);
  const cdef = content.CHARACTERS[s.character] || { name: s.character || 'Glutträger', sprite: `char_${s.character || 'bearer'}` };
  const killer = s.killedBy ? enemyName(s.killedBy) : '';

  const title = victory ? 'Das Sonnenherz brennt wieder' : 'Die Glut erlischt';
  const sub = victory
    ? 'Die Nacht weicht. Dein Name wird an der Feuerstelle erzählt.'
    : `Gefallen auf Ebene ${floor}${biome ? ' – ' + biome.name : ''}${killer ? ` · durch ${killer}` : ''}`;

  const tile = (label, value, ic) => h('div.end-stat', ic ? icon(ic, 20, { name: label }) : null, h('div.es-val', { text: value }), h('div.es-label', { text: label }));
  const statsRow = h('div.end-stats',
    tile('Ebene', `${victory ? 5 : floor}/5`, { glyph: 'compass', color: '#e8d6b0' }),
    tile('Zeit', fmtTime(s.time || 0), { glyph: 'hourglass', color: '#e8d6b0' }),
    tile('Gegner', fmtInt(st.kills || 0), { glyph: 'skull', color: '#e8d6b0' }),
    tile('Schaden', fmtInt(st.damageDealt || 0), { glyph: 'sword', color: '#e8d6b0' }),
    tile('Härtester Treffer', fmtInt(st.bestHit || 0), { glyph: 'star', color: '#e8d6b0' }),
    tile('Stufe', String(s.level || st.level || 1), { glyph: 'crown', color: '#e8d6b0' }));

  // ---- build recap -------------------------------------------------------------------------
  const recap = h('div.end-build');
  const addIcons = (label, items) => {
    if (!items.length) return;
    recap.appendChild(h('div.eb-group', h('div.eb-label', { text: label }), h('div.eb-icons', items)));
  };
  addIcons('Waffen', (s.weapons || []).map((w) => {
    const def = content.WEAPONS[w.id] || { name: w.id };
    const el = h('div.perk', { attrs: { tabindex: '0' }, style: { '--rc': rarityInfo(def.rarity || 'common', ui.RARITY_INFO).color } }, icon(def.icon, 32, { name: def.name }), h('span.perk-stack', { text: w.level || 1 }));
    attachTooltip(el, () => tipContent({ name: def.name, rarity: def.rarity, icon: def.icon, desc: def.desc, detail: `Stufe ${w.level || 1}/5` }));
    return el;
  }));
  const perkEl = (id, reg, stacks, kind) => {
    const def = reg[id] || { name: id };
    const r = rarityInfo(def.rarity || 'common', ui.RARITY_INFO);
    const el = h('div.perk' + (def.rarity === 'curse' ? '.curse' : ''), { attrs: { tabindex: '0' }, style: { '--rc': r.color } }, icon(def.icon, 32, { name: def.name }), stacks > 1 ? h('span.perk-stack', { text: stacks }) : null);
    attachTooltip(el, () => tipContent({ name: def.name, rarity: def.rarity, rarityTable: ui.RARITY_INFO, icon: def.icon, desc: descAt(def.desc, stacks), detail: kind === 'boon' ? `Stufe ${stacks}/${def.maxStacks || 1}` : '' }));
    return el;
  };
  addIcons('Relikte', (s.relics || []).map((id) => perkEl(id, content.RELICS, 1, 'relic')));
  addIcons('Flüche', (s.curses || []).map((id) => perkEl(id, content.RELICS, 1, 'relic')));
  addIcons('Segen', (s.boons || []).map((b) => perkEl(b.id, content.BOONS, b.stacks || 1, 'boon')));
  if (!recap.childElementCount) recap.appendChild(h('div.empty.small', { text: 'Ohne Relikte und Segen – nur Glut und Willen.' }));

  // ---- ash breakdown -----------------------------------------------------------------------
  const parts = Array.isArray(s.ashParts) && s.ashParts.length ? s.ashParts
    : [{ label: (s.ash || 0) > 0 ? 'Asche' : 'Zu früh erloschen – kaum Asche geblieben', amount: s.ash || 0, kind: 'total' }];
  const total = Number.isFinite(s.ash) ? s.ash : parts.reduce((a, p) => a + (p.amount || 0), 0);
  const lines = parts.map((p) => {
    const val = h('span.ash-amt', { text: '0' });
    const el = h('div.ash-line' + (p.amount < 0 ? '.neg' : ''), h('span.ash-lbl', { text: text(p.label) }), val);
    return { p, el, val };
  });
  const totalVal = h('span.ash-total-val', { text: '0' });
  const ashBox = h('div.end-ash.panel',
    sectionTitle('Asche für die Feuerstelle'),
    h('div.ash-lines', lines.map((l) => l.el)),
    h('div.ash-total', icon({ glyph: 'ember', color: '#ff9a4a' }, 32, { name: 'A' }), h('span.ash-total-lbl', { text: 'Gesamt' }), totalVal),
    h('div.ash-bank', { text: `Vorrat: ${fmtInt((game.save && game.save.ash) || 0)} Asche` }));

  // ---- unlocks -----------------------------------------------------------------------------
  const unl = [];
  for (const u of Array.isArray(s.unlocks) ? s.unlocks : []) {
    const label = u.type === 'character' ? `Neuer Glutträger: ${u.name}` : u.type === 'weapon' ? `Neue Waffe im Schacht: ${u.name}` : u.type === 'difficulty' ? `Glutstufe ${u.id}: ${u.name}` : `Freigeschaltet: ${u.name}`;
    unl.push(h('div.unlock-row', icon(UNLOCK_ICON[u.type] || { glyph: 'star', color: '#ffd35a' }, 24, { name: u.name }), h('span', { text: label })));
  }
  for (const a of params.achievements || []) {
    const def = a.def || (content.ACHIEVEMENTS && content.ACHIEVEMENTS[a.id]) || { name: a.id };
    unl.push(h('div.unlock-row.ach', icon(def.icon || { glyph: 'crown', color: '#ffd35a' }, 24, { name: def.name }), h('span', { text: `Erfolg: ${def.name}` })));
  }
  const unlockBox = unl.length ? h('div.end-unlocks.panel', sectionTitle('Neu entfacht'), unl) : null;

  // ---- actions -----------------------------------------------------------------------------
  const again = button('Nochmal', {
    cls: 'btn-primary', sound: 'confirm', icon: icon({ glyph: 'flame', color: '#ffe2b8' }, 24, { name: 'N' }),
    onClick: () => ui.startRun({ character: s.character || 'bearer', difficulty: s.difficulty || 0 }),
  });
  const home = button('Zur Feuerstelle', { icon: icon({ glyph: 'candle', color: '#e8d6b0' }, 24, { name: 'F' }), onClick: () => game.toMenu() });

  const el = h(`section.screen.screen-end.${victory ? 'victory' : 'death'}`, { attrs: { 'aria-label': title } },
    h('div.end-frame',
      h('header.end-head',
        h('div.end-portrait', icon(cdef.sprite || `char_${s.character}`, 64, { name: cdef.name })),
        h('div.end-kicker', { text: `${cdef.name}${s.difficulty ? ` · Glutstufe ${s.difficulty}` : ''}${s.seedLabel ? ` · Saat ${s.seedLabel}` : ''}` }),
        h('h1.end-title', { text: title }),
        h('div.end-sub', { text: sub })),
      h('div.end-body',
        h('div.end-col', statsRow, h('div.end-build-wrap.panel', sectionTitle('Dein Abstieg'), recap)),
        h('div.end-col', ashBox, unlockBox)),
      h('div.end-actions', again, home)));

  let t = 0;
  let done = false;
  const LINE_START = 0.6, LINE_GAP = 0.32, LINE_DUR = 0.55;
  function step(dt) {
    if (done) return;
    t += dt;
    const instant = ui.reducedMotion();
    let shown = 0;
    lines.forEach((l, i) => {
      const t0 = LINE_START + i * LINE_GAP;
      const f = instant ? 1 : easeOutCubic((t - t0) / LINE_DUR);
      if (t >= t0 || instant) l.el.classList.add('in');
      const v = Math.round((l.p.amount || 0) * f);
      setText(l.val, `${v > 0 ? '+' : ''}${fmtInt(v)}`);
      shown += v;
    });
    setText(totalVal, fmtInt(Math.max(0, Math.min(total, shown))));
    const end = LINE_START + lines.length * LINE_GAP + LINE_DUR;
    if (instant || t >= end) {
      done = true;
      setText(totalVal, fmtInt(total));
      ashBox.classList.add('done');
    }
  }
  step(0);

  return { el, update: step, back() { /* stay */ }, focus() { return again; } };
}
