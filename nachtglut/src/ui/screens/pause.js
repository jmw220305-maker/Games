// Pause menu (state 'paused') + Charakterbogen.
import { h, clear, icon, button, sfx } from '../dom.js';
import { attachTooltip, tipContent } from '../tooltip.js';
import { content, biomeFor } from '../content.js';
import { fmtInt, fmtTime, rarityInfo, text, descAt, STAT_GROUPS, statLabel, formatStat, statTrend } from '../format.js';
import { screenShell, sectionTitle } from './common.js';

function runLine(run) {
  if (!run) return '';
  const fi = run.floorIndex || (run.floor && run.floor.index) || 1;
  const b = run.biome || biomeFor(fi);
  const dl = typeof run.difficulty === 'object' ? run.difficulty && run.difficulty.level : run.difficulty;
  return [`Ebene ${fi}${b ? ' · ' + b.name : ''}`, fmtTime(run.time || 0), dl > 0 ? `Glutstufe ${dl}` : null, run.seedLabel ? `Saat ${run.seedLabel}` : null].filter(Boolean).join('  ·  ');
}

export function perkIcons(ui, list, kind) {
  const wrap = h('div.perk-icons');
  for (const perk of list) {
    const def = perk.def || (kind === 'boon' ? content.BOONS[perk.id] : content.RELICS[perk.id]) || {};
    const r = rarityInfo(def.rarity || 'common', ui.RARITY_INFO);
    const stacks = perk.stacks || 1;
    const el = h('div.perk' + (def.rarity === 'curse' ? '.curse' : ''), { style: { '--rc': r.color }, attrs: { tabindex: '0', 'aria-label': def.name || perk.id } },
      icon(def.icon, 32, { name: def.name }), stacks > 1 ? h('span.perk-stack', { text: stacks }) : null);
    attachTooltip(el, () => tipContent({ name: def.name || perk.id, rarity: def.rarity, rarityTable: ui.RARITY_INFO, icon: def.icon, detail: kind === 'boon' ? `Stufe ${stacks}/${def.maxStacks || 1}` : '', desc: descAt(def.desc, stacks), flavor: def.flavor }));
    wrap.appendChild(el);
  }
  return wrap;
}

export function createPause(ui) {
  const game = ui.game;
  const info = h('div.pause-info');
  const build = h('div.pause-build');
  const menu = h('nav.pause-menu', { attrs: { 'aria-label': 'Pause' } },
    button('Fortsetzen', { cls: 'btn-menu btn-primary', icon: icon({ glyph: 'flame', color: '#ffe2b8' }, 24, { name: 'F' }), sound: 'confirm', onClick: () => ui.resume() }),
    button('Charakterbogen', { cls: 'btn-menu', icon: icon({ glyph: 'mask', color: '#e8d6b0' }, 24, { name: 'C' }), onClick: () => ui.openScreen('charsheet') }),
    button('Einstellungen', { cls: 'btn-menu', icon: icon({ glyph: 'compass', color: '#e8d6b0' }, 24, { name: 'E' }), onClick: () => ui.openScreen('settings', { inRun: true }) }),
    button('Lauf aufgeben', {
      cls: 'btn-menu btn-danger', icon: icon({ glyph: 'skull', color: '#ff8a7a' }, 24, { name: 'L' }), sound: false,
      onClick: async () => {
        sfx.click();
        const ok = await ui.confirm({ title: 'Lauf aufgeben?', text: 'Dein Glutträger zerfällt zu Asche. Du erhältst Asche für den bisherigen Fortschritt.', confirmLabel: 'Aufgeben', danger: true });
        if (ok) game.abandonRun();
      },
    }),
    button('Zur Feuerstelle', {
      cls: 'btn-menu btn-ghost', icon: icon({ glyph: 'candle', color: '#e8d6b0' }, 24, { name: 'Z' }), sound: false,
      onClick: async () => {
        sfx.click();
        const ok = await ui.confirm({ title: 'Zur Feuerstelle zurückkehren?', text: 'Der laufende Abstieg wird beendet.', confirmLabel: 'Zurückkehren', danger: true });
        if (ok) game.toMenu();
      },
    }));
  const el = h('section.screen.screen-pause', { attrs: { 'aria-label': 'Pause' } },
    h('div.pause-panel.panel',
      h('div.pause-kicker', { text: 'Die Glut ruht' }),
      h('h1.pause-title', { text: 'Pause' }),
      info, menu, build));

  function refresh() {
    const run = game.run;
    info.textContent = runLine(run);
    clear(build);
    const p = run && run.player;
    if (!p) return;
    const ws = (p.weapons || []).filter(Boolean);
    const row = h('div.pb-row');
    for (const w of ws) {
      const def = w.def || content.WEAPONS[w.id] || {};
      const it = h('div.pb-weapon', { attrs: { tabindex: '0' } }, icon(def.icon, 32, { name: def.name }), h('span', { text: `${def.name || w.id} · St. ${w.level || 1}` }));
      attachTooltip(it, () => tipContent({ name: def.name, rarity: def.rarity, icon: def.icon, desc: def.desc, detail: `Stufe ${w.level || 1}/5` }));
      row.appendChild(it);
    }
    build.appendChild(row);
    const perks = [...(p.relics || []), ...(p.boons || [])];
    if (perks.length) build.appendChild(h('div.pb-perks', perkIcons(ui, p.relics || [], 'relic'), perkIcons(ui, p.boons || [], 'boon')));
  }
  refresh();

  return { el, refresh, back() { ui.resume(); }, focus() { return menu.querySelector('button'); } };
}

export function createCharsheet(ui) {
  const game = ui.game;
  const shell = screenShell(ui, { id: 'charsheet', title: 'Charakterbogen', kicker: 'Pause' });
  const run = game.run;
  const p = run && run.player;
  if (!p) {
    shell.body.appendChild(h('div.empty', { text: 'Kein laufender Abstieg.' }));
    return { el: shell.el };
  }
  const cdef = p.character || content.CHARACTERS[run.character] || {};
  const maxHp = (p.stats && p.stats.maxHp) || 100;
  const head = h('div.cs-head.panel',
    icon(cdef.sprite || `char_${run.character}`, 64, { name: cdef.name }),
    h('div.cs-names',
      h('div.cs-name', { text: cdef.name || 'Glutträger' }),
      h('div.cs-title', { text: text(cdef.title) }),
      h('div.cs-facts',
        h('span.tag', { text: `Stufe ${p.level || 1}` }),
        h('span.tag', { text: `Leben ${Math.ceil(p.hp || 0)} / ${Math.round(maxHp)}` }),
        p.shield > 0 ? h('span.tag', { text: `Schild ${Math.ceil(p.shield)}` }) : null,
        h('span.tag', { text: `${fmtInt(p.sparks || 0)} Funken` }),
        run.rerolls > 0 ? h('span.tag', { text: run.rerolls === 1 ? '1 Neuwurf' : `${run.rerolls} Neuwürfe` }) : null)));

  // weapons with level descriptions
  const weapons = h('div.cs-weapons', sectionTitle('Waffen'));
  for (const w of (p.weapons || []).filter(Boolean)) {
    const def = w.def || content.WEAPONS[w.id] || {};
    const r = rarityInfo(def.rarity || 'common', ui.RARITY_INFO);
    weapons.appendChild(h('div.cs-weapon.panel' + (w === p.weapon ? '.active' : ''), { attrs: { tabindex: '0' } },
      h('div.csw-head', icon(def.icon, 32, { name: def.name }), h('div', h('div.csw-name', { text: def.name || w.id, style: { color: r.color } }), h('div.csw-lvl', { text: `Stufe ${w.level || 1}/5${w === p.weapon ? ' · ausgerüstet' : ''}` }))),
      h('p.csw-desc', { text: text(def.desc) }),
      Array.isArray(def.levels) ? h('ul.csw-levels', def.levels.map((lv, i) => h('li' + (i + 2 <= (w.level || 1) ? '.on' : ''), h('span.lv-n', { text: `St. ${i + 2}` }), h('span', { text: text(lv && lv.desc) })))) : null));
  }
  if (p.skill && p.skill.def) {
    const sk = p.skill.def;
    weapons.appendChild(h('div.cs-weapon.panel', { attrs: { tabindex: '0' } },
      h('div.csw-head', icon(sk.icon, 32, { name: sk.name }), h('div', h('div.csw-name', { text: sk.name }), h('div.csw-lvl', { text: `Fertigkeit · ${String(Math.round((p.skill.cdMax || sk.cooldown || 0) * 10) / 10).replace('.', ',')} s` }))),
      h('p.csw-desc', { text: text(sk.desc) })));
  }
  if (p.passive && (p.passive.def || cdef.passive)) {
    const pas = cdef.passive || p.passive.def;
    weapons.appendChild(h('div.cs-weapon.panel', { attrs: { tabindex: '0' } },
      h('div.csw-head', icon(pas.icon || { glyph: 'star', color: '#ffd35a' }, 32, { name: pas.name }), h('div', h('div.csw-name', { text: pas.name }), h('div.csw-lvl', { text: 'Gabe' }))),
      h('p.csw-desc', { text: text(pas.desc) })));
  }

  // stats
  const statsEl = h('div.cs-stats', sectionTitle('Werte'));
  const base = content.BASE_STATS || {};
  let sheet = null;
  if (content.codex && content.codex.statSheet) { try { sheet = content.codex.statSheet(p.stats || {}, base); } catch { sheet = null; } }
  if (!sheet) {
    sheet = STAT_GROUPS.map((g) => ({
      name: g.name,
      rows: g.keys.filter((k) => p.stats && k in p.stats).map((k) => {
        const tr = statTrend(k, p.stats[k], base[k]);
        return { stat: k, name: statLabel(k), text: formatStat(k, p.stats[k]), changed: tr !== 0, better: tr > 0 };
      }),
    })).filter((g) => g.rows.length);
  }
  for (const g of sheet) {
    statsEl.appendChild(h('div.stat-group.panel', h('div.sg-name', { text: g.name }),
      h('div.sg-rows', g.rows.map((r) => h('div.sg-row' + (r.changed ? (r.better ? '.better' : '.worse') : ''), h('span.sg-label', { text: r.name }), h('span.sg-val', { text: r.text }))))));
  }

  const perks = h('div.cs-perks',
    sectionTitle(`Relikte (${(p.relics || []).length})`),
    (p.relics || []).length ? perkList(ui, p.relics, 'relic') : h('div.empty.small', { text: 'Noch keine Relikte.' }),
    sectionTitle(`Segen (${(p.boons || []).length})`),
    (p.boons || []).length ? perkList(ui, p.boons, 'boon') : h('div.empty.small', { text: 'Noch keine Segen.' }));

  shell.body.append(head, h('div.cs-grid', h('div.cs-col', weapons, perks), statsEl));
  return { el: shell.el, focus() { return shell.body.querySelector('[tabindex="0"]'); } };
}

function perkList(ui, list, kind) {
  return h('div.perk-list', list.map((perk) => {
    const def = perk.def || {};
    const r = rarityInfo(def.rarity || 'common', ui.RARITY_INFO);
    const stacks = perk.stacks || 1;
    return h('div.perk-row' + (def.rarity === 'curse' ? '.curse' : ''), { style: { '--rc': r.color }, attrs: { tabindex: '0' } },
      h('div.perk', icon(def.icon, 32, { name: def.name })),
      h('div.pr-text',
        h('div.pr-name', h('span', { text: def.name || perk.id, style: { color: r.color } }), h('span.pr-meta', { text: kind === 'boon' ? ` · Stufe ${stacks}/${def.maxStacks || 1}` : ` · ${r.name}` })),
        h('div.pr-desc', { text: descAt(def.desc, stacks) })));
  }));
}
