// In-run HUD: vitals, Funken, weapons, skill, dash, perks, minimap, floor/timer, boss bar,
// interact prompt, player status icons, low-HP pulse and the large map overlay.
// Only touches the DOM when a displayed value changes.
import { h, clear, icon, setText, toggleClass, setVar, sfx } from './dom.js';
import { attachTooltip, tipContent } from './tooltip.js';
import { content, biomeFor } from './content.js';
import { fmtInt, fmtTime, approach, clamp01, rarityInfo, text, descAt } from './format.js';
import { drawMap, mapSignature, ROOM_ICON } from './minimap.js';

const STATUS_ICON = {
  burn: { glyph: 'flame', color: '#ff8a3c', name: 'Brand' },
  poison: { glyph: 'drop', color: '#9be35a', name: 'Gift' },
  chill: { glyph: 'snowflake', color: '#8fd8ff', name: 'Kälte' },
  freeze: { glyph: 'snowflake', color: '#dff4ff', name: 'Gefroren' },
  slow: { glyph: 'hourglass', color: '#b9b3a8', name: 'Verlangsamt' },
  weak: { glyph: 'skull', color: '#b07cff', name: 'Geschwächt' },
  shock: { glyph: 'bolt', color: '#ffe75a', name: 'Schock' },
  stun: { glyph: 'star', color: '#ffe75a', name: 'Betäubt' },
  mark: { glyph: 'eye', color: '#ff6a5a', name: 'Markiert' },
};

const r2 = (v) => Math.round(v * 100) / 100;

export function createHud(ui) {
  const game = ui.game;
  const el = {};

  // ---- vitals ----------------------------------------------------------------------------
  el.hpLag = h('div.bar-fill.bar-lag');
  el.hpFill = h('div.bar-fill.bar-hp');
  el.shieldFill = h('div.bar-fill.bar-shield');
  el.hpText = h('span.bar-text');
  el.hp = h('div.hpbar', { attrs: { role: 'meter', 'aria-label': 'Leben' } }, h('div.bar-track', el.hpLag, el.hpFill, el.shieldFill, h('div.bar-gloss')), el.hpText);
  el.lvl = h('span.lvl', { text: '1' });
  el.xpFill = h('div.bar-fill.bar-xp');
  el.xp = h('div.xprow', h('span.lvl-badge', h('span.lvl-label', { text: 'Stufe' }), el.lvl), h('div.xpbar', h('div.bar-track', el.xpFill)));
  el.sparkNum = h('span.num', { text: '0' });
  el.sparks = h('div.sparks', { title: 'Funken' }, icon({ glyph: 'coin', color: '#ffcf5a' }, 20, { name: 'F' }), el.sparkNum);
  el.dash = h('div.dash-pips', { title: 'Sprintladungen' });
  el.statusRow = h('div.status-mini');
  el.vitals = h('div.hud-vitals.panel-lite', el.hp, el.xp, h('div.hud-row', el.sparks, el.dash, el.statusRow));

  // ---- weapons + skill -------------------------------------------------------------------
  el.weapons = h('div.weapons');
  el.skill = h('div.skill-ind');
  el.loadout = h('div.hud-loadout', el.weapons, el.skill);

  // ---- perks -----------------------------------------------------------------------------
  el.relics = h('div.perk-strip.relics');
  el.boons = h('div.perk-strip.boons');
  el.perks = h('div.hud-perks', el.relics, el.boons);

  // ---- minimap + floor -------------------------------------------------------------------
  el.mini = h('canvas.minimap', { attrs: { 'aria-label': 'Karte' } });
  el.mapBtn = h('button.hud-btn.map-btn', { type: 'button', title: 'Karte (M)', attrs: { 'aria-label': 'Karte', tabindex: '-1' } }, icon({ glyph: 'compass', color: '#e8d6b0' }, 20, { name: 'K' }));
  el.pauseBtn = h('button.hud-btn.pause-btn', { type: 'button', title: 'Pause (Esc)', attrs: { 'aria-label': 'Pause', tabindex: '-1' } }, h('span.pause-glyph'));
  el.mapBtn.addEventListener('click', () => { sfx.click(); ui.toggleMap(); });
  el.pauseBtn.addEventListener('click', () => { sfx.click(); ui.requestPause(); });
  el.mini.addEventListener('click', () => { sfx.click(); ui.toggleMap(); });
  el.floor = h('div.floor-name');
  el.diff = h('div.floor-diff');
  el.timer = h('div.run-timer');
  el.topRight = h('div.hud-top-right',
    h('div.mini-wrap.panel-lite', el.mini),
    h('div.hud-btns', el.mapBtn, el.pauseBtn),
    h('div.floor-info', el.floor, el.diff, el.timer));

  // ---- boss bar --------------------------------------------------------------------------
  el.bossName = h('div.boss-name');
  el.bossTitle = h('div.boss-title');
  el.bossFill = h('div.bar-fill.bar-boss');
  el.bossLag = h('div.bar-fill.bar-lag');
  el.bossNotches = h('div.boss-notches');
  el.boss = h('div.boss-bar', { attrs: { 'aria-live': 'polite' } },
    h('div.boss-head', h('span.boss-orn'), h('div.boss-names', el.bossName, el.bossTitle), h('span.boss-orn.r')),
    h('div.boss-track', h('div.bar-track', el.bossLag, el.bossFill, el.bossNotches)));

  // ---- world-anchored --------------------------------------------------------------------
  el.interactKey = h('kbd.ikey', { text: 'E' });
  el.interactText = h('span.itext');
  el.interact = h('div.interact-prompt', el.interactKey, el.interactText);
  el.interact.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ui.input?.setVirtualButton?.('interact', true);
    setTimeout(() => ui.input?.setVirtualButton?.('interact', false), 90);
  });
  el.playerStatus = h('div.player-status');
  el.lowhp = h('div.lowhp');
  el.hitflash = h('div.hitflash');

  // ---- big map ---------------------------------------------------------------------------
  el.bigCanvas = h('canvas.bigmap-canvas');
  el.bigTitle = h('div.bigmap-title');
  el.bigLegend = h('div.bigmap-legend', Object.entries(ROOM_ICON).filter(([k]) => k !== 'secret').map(([, v]) =>
    h('span.legend-item', h('span.legend-dot', { style: { background: v.color } }), v.name)));
  el.bigmap = h('div.bigmap', h('div.bigmap-inner.panel', el.bigTitle, el.bigCanvas, el.bigLegend, h('div.bigmap-hint', { text: 'M oder Kartenknopf zum Schließen' })));
  el.bigmap.addEventListener('click', () => ui.toggleMap(false));

  el.root = h('div.hud',
    h('div.hud-top-left', el.vitals, el.loadout, el.perks),
    el.topRight,
    el.boss,
    el.interact,
    el.playerStatus);
  el.fxLayer = h('div.hud-fx', el.lowhp, el.hitflash);

  // ---------------------------------------------------------------------------------------
  const last = { sparks: 0, sparkTarget: -1, hpLag: 1, bossLag: 1, mapSig: '', mapT: 0, weaponSig: '', perkSig: '', statusSig: '', bossRef: null, notchSig: '' };
  let mapOpen = false;

  function player() { return game.run && game.run.player; }

  function updateVitals(p, dt) {
    const maxHp = Math.max(1, (p.stats && p.stats.maxHp) || p.maxHp || 100);
    const hp = Math.max(0, p.hp || 0);
    const shield = Math.max(0, p.shield || 0);
    const total = Math.max(maxHp, hp + shield);
    const fHp = clamp01(hp / total), fSh = clamp01(shield / total);
    setVar(el.hpFill, '--f', r2(fHp));
    setVar(el.shieldFill, '--f', r2(fSh));
    setVar(el.shieldFill, '--x', `${r2(fHp * 100)}%`);
    // damage chip trails behind
    if (fHp > last.hpLag) last.hpLag = fHp;
    else last.hpLag = Math.max(fHp, last.hpLag - dt * 0.45);
    setVar(el.hpLag, '--f', r2(last.hpLag));
    setText(el.hpText, shield > 0 ? `${Math.ceil(hp)} / ${Math.round(maxHp)}  +${Math.ceil(shield)}` : `${Math.ceil(hp)} / ${Math.round(maxHp)}`);
    toggleClass(el.hp, 'has-shield', shield > 0);
    const low = p.alive !== false && hp > 0 && hp / maxHp <= 0.3;
    toggleClass(el.lowhp, 'on', low);
    toggleClass(el.hp, 'low', low);

    const xpNext = Math.max(1, p.xpNext || 1);
    setVar(el.xpFill, '--f', r2(clamp01((p.xp || 0) / xpNext)));
    setText(el.lvl, p.level || 1);

    // Funken count-up
    const target = Math.floor(p.sparks || 0);
    if (last.sparkTarget < 0) last.sparks = target;
    if (target !== last.sparkTarget) {
      if (target > last.sparkTarget && last.sparkTarget >= 0) {
        el.sparks.classList.remove('bump');
        void el.sparks.offsetWidth;
        el.sparks.classList.add('bump');
      }
      last.sparkTarget = target;
    }
    last.sparks = ui.reducedMotion() ? target : approach(last.sparks, target, dt, 9);
    setText(el.sparkNum, fmtInt(Math.round(last.sparks)));

    // dash charges
    const d = p.dash || {};
    const max = Math.max(1, d.max || (p.stats && p.stats.dashCharges) || 1);
    if (el.dash.childElementCount !== max) {
      clear(el.dash);
      for (let i = 0; i < max; i++) el.dash.appendChild(h('span.pip', h('span.pip-fill')));
    }
    const charges = Math.max(0, Math.min(max, d.charges ?? max));
    const frac = d.cdMax > 0 && charges < max ? clamp01(1 - (d.cd || 0) / d.cdMax) : 1;
    for (let i = 0; i < max; i++) {
      const pip = el.dash.children[i];
      const f = i < charges ? 1 : i === charges ? frac : 0;
      setVar(pip, '--f', r2(f));
      toggleClass(pip, 'full', i < charges);
    }

    // mini status icons
    const st = p.statuses || {};
    const ids = Object.keys(st).filter((k) => st[k] && (st[k].t ?? 1) > 0 && STATUS_ICON[k]);
    const sig = ids.join(',');
    if (sig !== last.statusSig) {
      last.statusSig = sig;
      clear(el.statusRow);
      clear(el.playerStatus);
      for (const id of ids) {
        const s = STATUS_ICON[id];
        el.statusRow.appendChild(h('span.status-ico', { title: s.name }, icon(s, 18, { name: s.name })));
        el.playerStatus.appendChild(h('span.status-ico', icon(s, 16, { name: s.name })));
      }
    }
  }

  function weaponSig(p) {
    const ws = Array.isArray(p.weapons) ? p.weapons : [];
    return ws.map((w) => (w ? `${w.id || (w.def && w.def.id)}:${w.level || 1}` : '-')).join('|') + '#' + (p.weaponIndex | 0) + (ui.touchMode ? 't' : 'k') + ui.inputDevice();
  }

  function buildWeapons(p) {
    clear(el.weapons);
    const ws = Array.isArray(p.weapons) ? p.weapons : [];
    const slots = Math.max(2, ws.length);
    for (let i = 0; i < slots; i++) {
      const w = ws[i];
      const def = w && (w.def || content.WEAPONS[w.id]);
      const active = i === (p.weaponIndex | 0);
      const pips = h('span.lvl-pips');
      for (let l = 1; l <= 5; l++) pips.appendChild(h('span.lp' + (w && l <= (w.level || 1) ? '.on' : '')));
      const slot = h('div.wslot' + (active ? '.active' : '') + (w ? '' : '.empty'),
        h('div.wslot-icon', w ? icon(def ? def.icon : null, 32, { name: def ? def.name : '?' }) : h('span.empty-mark', { text: '—' }), h('div.cd-sweep')),
        w ? pips : null);
      if (w) {
        attachTooltip(slot, () => tipContent({
          name: def ? def.name : w.id, rarity: def && def.rarity, icon: def && def.icon,
          detail: `Stufe ${w.level || 1}/5`, desc: def && def.desc,
          extra: def && Array.isArray(def.levels) ? h('ul.tip-levels', def.levels.map((lv, k) => h('li' + (k + 2 <= (w.level || 1) ? '.on' : ''), { text: `St. ${k + 2}: ${text(lv && lv.desc)}` }))) : null,
        }));
        slot.style.pointerEvents = 'auto';
      }
      el.weapons.appendChild(slot);
    }
    if (ws.filter(Boolean).length > 1 && !ui.touchMode) {
      el.weapons.appendChild(h('kbd.swap-key', { text: ui.inputDevice() === 'gamepad' ? 'Y' : 'R' }));
    }
  }

  function updateWeapons(p) {
    const sig = weaponSig(p);
    if (sig !== last.weaponSig) { last.weaponSig = sig; buildWeapons(p); }
    const ws = Array.isArray(p.weapons) ? p.weapons : [];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const slot = el.weapons.children[i];
      if (!w || !slot) continue;
      const fr = (p.stats && p.stats.fireRate) || 1;
      const max = w.cdMax || (w.stats && w.stats.cooldown ? w.stats.cooldown / fr : 0);
      const f = max >= 0.45 && w.cd > 0 ? clamp01(w.cd / max) : 0;
      const sweep = slot.querySelector('.cd-sweep');
      if (sweep) setVar(sweep, '--cd', r2(f));
    }

    // skill
    const sk = p.skill;
    if (!sk || !sk.def) {
      if (el.skill.__built !== 'none') { el.skill.__built = 'none'; clear(el.skill); }
    } else {
      const key = (sk.def.id || sk.def.name) + (ui.inputDevice() === 'gamepad' ? 'g' : 'k');
      if (el.skill.__built !== key) {
        el.skill.__built = key;
        clear(el.skill);
        const ring = h('div.skill-ring', icon(sk.def.icon, 32, { name: sk.def.name }), h('span.skill-cd'));
        el.skill.append(ring, h('kbd.skill-key', { text: ui.inputDevice() === 'gamepad' ? 'X' : 'Q' }));
        attachTooltip(el.skill, () => tipContent({ name: sk.def.name, icon: sk.def.icon, desc: sk.def.desc, detail: sk.def.cooldown ? `Abklingzeit ${String(sk.def.cooldown).replace('.', ',')} s` : '' }));
        el.skill.style.pointerEvents = 'auto';
      }
      const cdMax = sk.cdMax || sk.def.cooldown || 1;
      const f = sk.cd > 0 ? clamp01(sk.cd / cdMax) : 0;
      setVar(el.skill, '--cd', r2(f));
      toggleClass(el.skill, 'ready', f <= 0);
      toggleClass(el.skill, 'active', (sk.active || 0) > 0);
      const cdEl = el.skill.querySelector('.skill-cd');
      if (cdEl) setText(cdEl, sk.cd > 0 ? Math.ceil(sk.cd) : '');
    }
  }

  function perkSig(list) {
    return (Array.isArray(list) ? list : []).map((p) => `${p.id || (p.def && p.def.id)}:${p.stacks || 1}`).join(',');
  }

  function buildPerkStrip(container, list, kind) {
    clear(container);
    for (const perk of list) {
      const def = perk.def || (kind === 'boon' ? content.BOONS[perk.id] : content.RELICS[perk.id]) || {};
      const r = rarityInfo(def.rarity || 'common', ui.RARITY_INFO);
      const it = h('div.perk' + (def.rarity === 'curse' ? '.curse' : ''), { style: { '--rc': r.color } },
        icon(def.icon, 24, { name: def.name }),
        (perk.stacks || 1) > 1 ? h('span.perk-stack', { text: perk.stacks }) : null);
      attachTooltip(it, () => tipContent({
        name: def.name || perk.id, rarity: def.rarity, rarityTable: ui.RARITY_INFO, icon: def.icon,
        detail: kind === 'boon' ? `Stufe ${perk.stacks || 1}/${def.maxStacks || 1}` : (perk.stacks > 1 ? `×${perk.stacks}` : ''),
        desc: descAt(def.desc, perk.stacks || 1), flavor: def.flavor,
      }));
      container.appendChild(it);
    }
  }

  function updatePerks(p) {
    const sig = perkSig(p.relics) + '|' + perkSig(p.boons);
    if (sig === last.perkSig) return;
    last.perkSig = sig;
    buildPerkStrip(el.relics, Array.isArray(p.relics) ? p.relics : [], 'relic');
    buildPerkStrip(el.boons, Array.isArray(p.boons) ? p.boons : [], 'boon');
  }

  function updateMap(run, p, dt) {
    const sig = mapSignature(run.floor, run.roomId);
    last.mapT -= dt;
    if (sig !== last.mapSig || last.mapT <= 0) {
      last.mapSig = sig;
      last.mapT = 0.12;
      const room = run.world && run.world.room;
      drawMap(el.mini, run.floor, run.roomId, { mode: 'mini', cell: ui.compact() ? 15 : 18, player: p, room });
      if (mapOpen) drawMap(el.bigCanvas, run.floor, run.roomId, { mode: 'full', player: p, room });
    }
    const fi = (run.floor && run.floor.index) || run.floorIndex || 1;
    const biome = (run.floor && biomeFor(run.floor.biome)) || biomeFor(fi);
    const fname = `Ebene ${fi} · ${biome ? biome.name : ''}`.replace(/ · $/, '');
    setText(el.floor, fname);
    if (mapOpen) setText(el.bigTitle, fname);
    const dl = typeof run.difficulty === 'object' ? run.difficulty && run.difficulty.level : run.difficulty;
    setText(el.diff, dl > 0 ? `Glutstufe ${dl}` : '');
    const showTimer = ui.settings().showTimer !== false;
    toggleClass(el.timer, 'is-hidden', !showTimer);
    if (showTimer) setText(el.timer, fmtTime(run.time || 0));
  }

  function bossNotches(boss) {
    const d = boss.def || {};
    let ph = d.phases || d.phaseThresholds || (boss.data && boss.data.phases);
    if (!Array.isArray(ph)) ph = [0.5];
    return ph.map((v) => (typeof v === 'number' ? v : v && (v.hp ?? v.at ?? v.threshold))).filter((v) => typeof v === 'number' && v > 0 && v < 1);
  }

  function updateBoss(run, dt) {
    const w = run.world;
    const boss = w && w.boss && !w.boss.dead && (w.boss.hp > 0) ? w.boss : null;
    const show = !!boss && !(boss.spawnT > 0 && boss.hp >= boss.maxHp && false);
    toggleClass(el.boss, 'show', show);
    if (!boss) { last.bossRef = null; return; }
    if (last.bossRef !== boss) {
      last.bossRef = boss;
      last.bossLag = 1;
      setText(el.bossName, boss.name || (boss.def && boss.def.name) || 'Boss');
      setText(el.bossTitle, (boss.def && boss.def.title) || boss.title || '');
      clear(el.bossNotches);
      for (const n of bossNotches(boss)) el.bossNotches.appendChild(h('span.notch', { style: { left: `${n * 100}%` } }));
      el.boss.classList.remove('enter');
      void el.boss.offsetWidth;
      el.boss.classList.add('enter');
    }
    const f = clamp01((boss.hp || 0) / Math.max(1, boss.maxHp || 1));
    setVar(el.bossFill, '--f', r2(f));
    if (f > last.bossLag) last.bossLag = f; else last.bossLag = Math.max(f, last.bossLag - dt * 0.35);
    setVar(el.bossLag, '--f', r2(last.bossLag));
  }

  function updateWorldAnchored(run, p) {
    const w = run.world;
    const hint = w && w.interactHint;
    const canProject = typeof game.worldToScreen === 'function';
    if (hint && canProject && game.state === 'playing') {
      const s = game.worldToScreen(hint.x, hint.y);
      if (s && Number.isFinite(s.x)) {
        el.interact.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
        setText(el.interactText, text(hint.text, 'Benutzen'));
        const dev = ui.inputDevice();
        setText(el.interactKey, ui.touchMode ? 'Tippen' : dev === 'gamepad' ? 'B' : 'E');
        toggleClass(el.interact, 'touch', ui.touchMode);
        toggleClass(el.interact, 'show', true);
      }
    } else {
      toggleClass(el.interact, 'show', false);
    }
    if (last.statusSig && canProject && p) {
      const s = game.worldToScreen(p.x, p.y - (p.r || 6) - 14);
      if (s && Number.isFinite(s.x)) el.playerStatus.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
      toggleClass(el.playerStatus, 'show', true);
    } else {
      toggleClass(el.playerStatus, 'show', false);
    }
  }

  return {
    el,
    get mapOpen() { return mapOpen; },
    setMapOpen(open) {
      mapOpen = !!open;
      toggleClass(el.bigmap, 'show', mapOpen);
      if (mapOpen) last.mapT = 0;
    },
    onHit() {
      if (ui.settings().flashes === false) return;
      el.hitflash.classList.remove('on');
      void el.hitflash.offsetWidth;
      el.hitflash.classList.add('on');
      el.hp.classList.remove('hit');
      void el.hp.offsetWidth;
      el.hp.classList.add('hit');
    },
    reset() {
      last.sparkTarget = -1;
      last.hpLag = 1;
      last.weaponSig = last.perkSig = last.statusSig = last.mapSig = '';
      last.bossRef = null;
      el.skill.__built = '';
      clear(el.playerStatus);
      clear(el.statusRow);
    },
    invalidate() { last.weaponSig = ''; last.perkSig = ''; el.skill.__built = ''; },
    update(dt) {
      const run = game.run;
      const p = player();
      if (!run || !p) return;
      updateVitals(p, dt);
      updateWeapons(p);
      updatePerks(p);
      updateMap(run, p, dt);
      updateBoss(run, dt);
      updateWorldAnchored(run, p);
    },
  };
}
