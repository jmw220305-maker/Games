// Chronik: codex (Gegner, Bosse, Relikte, Segen, Waffen), Erfolge, Statistik, Verlauf.
import { h, clear, icon, sfx } from '../dom.js';
import { content, biomeFor } from '../content.js';
import { fmtInt, fmtTime, fmtDate, rarityInfo, text, descAt, LIFETIME_STATS, formatLifetime, completion } from '../format.js';
import { screenShell, tabBar, progressBar, sectionTitle } from './common.js';

const TABS = [
  { id: 'enemies', label: 'Gegner' },
  { id: 'bosses', label: 'Bosse' },
  { id: 'relics', label: 'Relikte' },
  { id: 'boons', label: 'Segen' },
  { id: 'weapons', label: 'Waffen' },
  { id: 'achievements', label: 'Erfolge' },
  { id: 'stats', label: 'Statistik' },
  { id: 'history', label: 'Verlauf' },
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// ---- codex lists (meta/codex.js when present, else a local fallback) ----------------------
function list(kind, save) {
  const cx = content.codex;
  const c = (save && save.codex) || {};
  try {
    if (kind === 'enemies' && cx && cx.codexEnemies) return cx.codexEnemies(save, content.ENEMIES);
    if (kind === 'bosses' && cx && cx.codexBosses) return cx.codexBosses(save, content.BOSSES);
    if (kind === 'relics' && cx && cx.codexRelics) return cx.codexRelics(save, content.RELICS);
    if (kind === 'boons' && cx && cx.codexBoons) return cx.codexBoons(save, content.BOONS);
    if (kind === 'weapons' && cx && cx.codexWeapons) return cx.codexWeapons(save, content.WEAPONS);
  } catch (err) { console.warn('[ui] codex helper failed', err); }
  const reg = { enemies: content.ENEMIES, bosses: content.BOSSES, relics: content.RELICS, boons: content.BOONS, weapons: content.WEAPONS }[kind] || {};
  return Object.keys(reg).filter((id) => !(kind === 'enemies' && reg[id].boss)).map((id) => {
    const def = reg[id];
    const e = (c[kind] || {})[id];
    const kills = num(e && typeof e === 'object' ? e.kills : 0);
    const count = typeof e === 'number' ? e : 0;
    const seen = kind === 'enemies' || kind === 'bosses' ? !!(e && (e.seen || kills > 0)) : count > 0;
    return { id, def, seen, kills, count, bestTime: e && e.bestTime, name: seen ? def.name : '???', desc: seen ? text(def.desc) : '', title: seen ? def.title : '', rarity: def.rarity, unlocked: true };
  });
}

export function createChronik(ui) {
  const game = ui.game;
  const save = () => game.save || {};
  const shell = screenShell(ui, { id: 'chronik', title: 'Chronik', kicker: 'Feuerstelle', extra: h('div.chronik-total') });
  const totalEl = shell.head.querySelector('.chronik-total');
  const content_ = h('div.chronik-content');
  const tabs = tabBar(TABS, (id) => render(id), (save().uiPrefs && save().uiPrefs.chronikTab) || 'enemies');
  shell.body.append(tabs.el, content_);

  function setPref(tab) {
    const s = save();
    s.uiPrefs = { ...(s.uiPrefs || {}), chronikTab: tab };
  }

  function updateTotal() {
    const s = save();
    let found = 0, total = 0;
    for (const k of ['enemies', 'bosses', 'relics', 'weapons', 'boons']) {
      const l = list(k, s);
      total += l.length;
      found += l.filter((e) => e.seen).length;
    }
    const c = completion(found, total);
    clear(totalEl).append(h('span.ct-pct', { text: `${c.pct} %` }), h('span.ct-label', { text: 'entdeckt' }));
  }

  // ---- grid tabs ---------------------------------------------------------------------------
  function gridTab(kind) {
    const s = save();
    const items = list(kind, s);
    const c = completion(items.filter((e) => e.seen).length, items.length);
    const det = h('div.cx-detail.panel');
    const grid = h('div.cx-grid' + (kind === 'bosses' ? '.big' : ''));
    const label = { enemies: 'Gegner entdeckt', bosses: 'Bosse entdeckt', relics: 'Relikte gefunden', boons: 'Segen gewählt', weapons: 'Waffen geführt' }[kind];
    const head = h('div.cx-head', sectionTitle(`${c.have} / ${c.total} ${label}`, h('span.cx-pct', { text: `${c.pct} %` })), progressBar(c.pct / 100));

    function show(e) {
      clear(det);
      const def = e.def || {};
      const isPerk = kind === 'relics' || kind === 'boons';
      const ic = kind === 'enemies' || kind === 'bosses' ? (def.sprite || e.id) : def.icon;
      const r = isPerk || kind === 'weapons' ? rarityInfo(def.rarity || 'common', ui.RARITY_INFO) : null;
      const biome = def.biome ? biomeFor(def.biome) : null;
      const facts = [];
      if (kind === 'enemies') { if (e.seen) facts.push(`Besiegt: ${fmtInt(e.kills)}`); if (biome) facts.push(biome.name); }
      if (kind === 'bosses') { if (e.seen) facts.push(`Besiegt: ${fmtInt(e.kills)}`); if (e.bestTime > 0) facts.push(`Bestzeit ${fmtTime(e.bestTime)}`); if (biome) facts.push(biome.name); }
      if (isPerk && e.seen) facts.push(`${kind === 'boons' ? 'Gewählt' : 'Gefunden'}: ${fmtInt(e.count)}×`);
      if (kind === 'weapons' && e.seen) facts.push(`Geführt in ${fmtInt(e.count)} Abstiegen`);
      det.append(...[
        h('div.cxd-head',
          h('div.cxd-icon', icon(ic, kind === 'bosses' ? 96 : 64, { name: e.name, silhouette: !e.seen })),
          h('div.cxd-names',
            h('div.cxd-name', { text: e.seen || (kind === 'weapons' && e.unlocked) ? (def.name || e.name) : '???', style: r && e.seen ? { color: r.color } : null }),
            e.seen && (def.title || e.title) ? h('div.cxd-title', { text: def.title || e.title }) : null,
            r && e.seen ? h('div.cxd-rarity', { text: r.name, style: { color: r.color } }) : null)),
        h('p.cxd-desc', { text: e.seen ? descAt(def.desc, 1) || e.desc || '' : kind === 'weapons' && e.unlocked === false ? `Verschlossen: ${e.unlockText || ''}` : 'Noch nicht entdeckt. Steig tiefer hinab, um mehr zu erfahren.' }),
        e.seen && def.flavor ? h('p.cxd-flavor', { text: text(def.flavor) }) : null,
        facts.length ? h('div.cxd-facts', facts.map((f) => h('span.tag', { text: f }))) : null].filter(Boolean));
    }

    let firstSeen = null;
    let lastBiome = null;
    for (const e of items) {
      const def = e.def || {};
      if ((kind === 'enemies') && def.biome !== lastBiome) {
        lastBiome = def.biome;
        const b = biomeFor(def.biome);
        grid.appendChild(h('div.cx-group', { text: b ? `${b.name}` : String(def.biome || '') }));
      }
      const ic = kind === 'enemies' || kind === 'bosses' ? (def.sprite || e.id) : def.icon;
      const r = def.rarity ? rarityInfo(def.rarity, ui.RARITY_INFO) : null;
      const tile = h('button.ctile' + (e.seen ? '' : '.unseen') + (kind === 'weapons' && e.unlocked === false ? '.locked' : ''), {
        type: 'button', style: r ? { '--rc': r.color } : null, attrs: { 'aria-label': e.seen ? (def.name || e.name) : 'Unentdeckt' },
      },
      icon(ic, kind === 'bosses' ? 64 : 40, { name: e.name, silhouette: !e.seen }),
      h('span.ctile-name', { text: e.seen ? (def.name || e.name) : '???' }),
      e.seen && (e.kills || e.count) ? h('span.ctile-count', { text: fmtInt(e.kills || e.count) }) : null);
      const pick = () => { for (const t of grid.querySelectorAll('.ctile.on')) t.classList.remove('on'); tile.classList.add('on'); show(e); };
      tile.addEventListener('click', () => { sfx.click(); pick(); });
      tile.addEventListener('focus', pick);
      tile.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') show(e); });
      grid.appendChild(tile);
      if (!firstSeen && e.seen) firstSeen = { e, tile };
    }
    if (!items.length) grid.appendChild(h('div.empty', { text: 'Noch keine Einträge.' }));
    if (firstSeen) { firstSeen.tile.classList.add('on'); show(firstSeen.e); } else if (items[0]) show(items[0]);
    return h('div.cx-tab', head, h('div.cx-split', grid, det));
  }

  // ---- achievements ------------------------------------------------------------------------
  function achievementsTab() {
    const s = save();
    const am = content.achievements;
    let rows = [];
    if (am && am.achievementStatus) {
      try { rows = am.achievementStatus(s); } catch { rows = []; }
    } else if (content.ACHIEVEMENTS) {
      rows = Object.values(content.ACHIEVEMENTS).map((a) => ({ id: a.id, def: a, unlocked: !!(s.achievements && s.achievements[a.id]), name: a.name, desc: a.desc, icon: a.icon, reward: a.reward && a.reward.ash }));
    }
    const done = rows.filter((r) => r.unlocked).length;
    const c = completion(done, rows.length);
    const wrap = h('div.ach-tab', h('div.cx-head', sectionTitle(`${done} / ${rows.length} Erfolge errungen`, h('span.cx-pct', { text: `${c.pct} %` })), progressBar(c.pct / 100)));
    let cat = null;
    const listEl = h('div.ach-list');
    for (const r of rows) {
      if (r.categoryName && r.category !== cat) { cat = r.category; listEl.appendChild(h('div.cx-group', { text: r.categoryName })); }
      listEl.appendChild(h('div.ach-row' + (r.unlocked ? '.done' : ''), { attrs: { tabindex: '0' } },
        h('div.ach-icon', icon(r.icon, 32, { name: r.name, silhouette: !r.unlocked })),
        h('div.ach-text', h('div.ach-name', { text: r.name }), h('div.ach-desc', { text: text(r.desc) })),
        h('div.ach-side',
          r.reward ? h('div.ach-reward', icon({ glyph: 'ember', color: '#ff9a4a' }, 16, { name: 'A' }), h('span', { text: `+${fmtInt(r.reward)}` })) : null,
          h('div.ach-date', { text: r.unlocked ? (r.date ? fmtDate(r.date, false) : 'Errungen') : 'Offen' }))));
    }
    if (!rows.length) listEl.appendChild(h('div.empty', { text: 'Die Erfolge werden noch eingraviert …' }));
    wrap.appendChild(listEl);
    return wrap;
  }

  // ---- lifetime stats ----------------------------------------------------------------------
  function statsTab() {
    const s = save();
    let rows = null;
    if (content.codex && content.codex.lifetimeStats) { try { rows = content.codex.lifetimeStats(s); } catch { rows = null; } }
    if (!rows) {
      const st = s.stats || {};
      rows = LIFETIME_STATS.map((e) => ({ key: e.key, label: e.label, text: formatLifetime(e, st[e.key] ?? (e.key === 'highestDifficultyWon' ? -1 : 0)) }));
      rows.splice(1, 0, { key: 'totalAsh', label: 'Gesammelte Asche', text: fmtInt(s.totalAsh || 0) });
    }
    const big = ['runs', 'wins', 'kills', 'totalAsh'];
    const hero = h('div.stat-hero', rows.filter((r) => big.includes(r.key)).map((r) => h('div.stat-big.panel', h('div.sb-val', { text: r.text }), h('div.sb-label', { text: r.label }))));
    const table = h('div.stat-table', rows.filter((r) => !big.includes(r.key)).map((r) => h('div.stat-cell', { attrs: { tabindex: '0' } }, h('span.sc-label', { text: r.label }), h('span.sc-val', { text: r.text }))));
    // per-character summary
    const cs = s.characterStats || {};
    const chars = Object.keys(cs).filter((k) => cs[k] && cs[k].runs > 0);
    const charBox = chars.length ? h('div.char-stats',
      sectionTitle('Glutträger'),
      h('div.char-stat-list', chars.map((id) => {
        const d = content.CHARACTERS[id] || { name: id, sprite: `char_${id}` };
        const c = cs[id];
        return h('div.char-stat.panel', { attrs: { tabindex: '0' } }, icon(d.sprite || `char_${id}`, 40, { name: d.name }),
          h('div', h('div.cs-name', { text: d.name }), h('div.cs-line', { text: `${fmtInt(c.runs)} Abstiege · ${fmtInt(c.wins)} Siege · tiefste Ebene ${c.bestFloor || '–'}` })));
      }))) : null;
    return h('div.stats-tab', hero, table, charBox);
  }

  // ---- history -----------------------------------------------------------------------------
  function historyTab() {
    const s = save();
    const hist = Array.isArray(s.history) ? s.history : [];
    const wrap = h('div.hist-tab', sectionTitle(hist.length ? `Die letzten ${hist.length} Abstiege` : 'Verlauf'));
    if (!hist.length) {
      wrap.appendChild(h('div.empty', { text: 'Noch keine Abstiege verzeichnet. Die Feuerstelle wartet.' }));
      return wrap;
    }
    for (const e of hist) {
      const d = content.CHARACTERS[e.character] || { name: e.character, sprite: `char_${e.character}` };
      const b = biomeFor(e.biome || e.floor);
      const outcome = e.victory ? 'Sieg' : e.abandoned ? 'Aufgegeben' : 'Gefallen';
      const sub = [
        `Ebene ${e.floor}${b ? ' · ' + b.name : ''}`,
        e.difficulty ? `Glutstufe ${e.difficulty}` : null,
        !e.victory && e.killedBy ? `durch ${e.killedBy}` : null,
      ].filter(Boolean).join(' · ');
      wrap.appendChild(h('div.hist-row' + (e.victory ? '.win' : e.abandoned ? '.abandon' : '.loss'), { attrs: { tabindex: '0' } },
        h('div.hist-icon', icon(d.sprite || `char_${e.character}`, 40, { name: d.name })),
        h('div.hist-main',
          h('div.hist-top', h('span.hist-outcome', { text: outcome }), h('span.hist-char', { text: d.name })),
          h('div.hist-sub', { text: sub }),
          h('div.hist-facts',
            h('span', { text: fmtTime(e.time) }),
            h('span', { text: `${fmtInt(e.kills || 0)} Gegner` }),
            e.level ? h('span', { text: `Stufe ${e.level}` }) : null,
            e.seedLabel ? h('span.hist-seed', { text: `Saat ${e.seedLabel}` }) : null)),
        h('div.hist-side',
          h('div.hist-ash', icon({ glyph: 'ember', color: '#ff9a4a' }, 16, { name: 'A' }), h('span', { text: `+${fmtInt(e.ash || 0)}` })),
          h('div.hist-date', { text: fmtDate(e.date) }))));
    }
    return wrap;
  }

  function render(tab) {
    setPref(tab);
    clear(content_);
    let node;
    switch (tab) {
      case 'achievements': node = achievementsTab(); break;
      case 'stats': node = statsTab(); break;
      case 'history': node = historyTab(); break;
      default: node = gridTab(tab);
    }
    content_.appendChild(node);
    content_.scrollTop = 0;
    shell.body.scrollTop = 0;
  }

  function refresh() {
    updateTotal();
    render(tabs.current);
  }
  tabs.select(tabs.current, true);
  refresh();

  return {
    el: shell.el,
    refresh,
    tabStep(d) { const b = tabs.step(d); if (b) ui.focusEl(b, true); },
    focus() { return tabs.button(tabs.current); },
  };
}
