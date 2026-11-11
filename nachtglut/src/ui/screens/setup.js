// Run setup: character selection, Glutstufe, optional seed, "Aufbrechen".
import { h, clear, icon, button, sfx, setDisabled } from '../dom.js';
import { content } from '../content.js';
import { fmtDec, fmtInt, statProfile, describeMod, text } from '../format.js';
import * as prog from '../../meta/progression.js';
import { screenShell, progressBar, sectionTitle } from './common.js';

export function charOrder() {
  const ids = Object.keys(prog.CHARACTER_UNLOCKS || {});
  for (const id of Object.keys(content.CHARACTERS || {})) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function createSetup(ui) {
  const game = ui.game;
  const save = () => game.save || {};
  const prefs = () => save().uiPrefs || {};
  const shell = screenShell(ui, { id: 'setup', title: 'Abstieg vorbereiten', kicker: 'Feuerstelle', ash: true });
  const unlocked = (id) => { try { return prog.isCharacterUnlocked(save(), id); } catch { return id === 'bearer'; } };

  let selected = prefs().character && charOrder().includes(prefs().character) ? prefs().character : 'bearer';
  let diff = Math.min(prefs().difficulty | 0, maxDiff());
  function maxDiff() { try { return prog.difficultyUnlocked(save()); } catch { return 0; } }

  const charList = h('div.char-list', { attrs: { role: 'listbox', 'aria-label': 'Glutträger' } });
  const detail = h('div.char-detail.panel');
  const diffBox = h('div.diff-box.panel');
  const seedInput = h('input.seed-input', { type: 'text', maxLength: 32, placeholder: 'zufällig', attrs: { 'aria-label': 'Saat', autocomplete: 'off', spellcheck: 'false' } });
  const goBtn = button('Aufbrechen', { cls: 'btn-primary btn-go', sound: false, icon: icon({ glyph: 'flame', color: '#ffe2b8' }, 24, { name: 'A' }), onClick: start, onDenied: () => ui.toast({ text: goBtn.dataset.reason || 'Nicht verfügbar.', kind: 'bad' }) });

  shell.body.append(
    h('div.setup-grid',
      h('div.setup-chars', sectionTitle('Glutträger'), charList),
      detail,
      h('div.setup-config',
        diffBox,
        h('div.seed-box.panel', h('label.seed-label', { text: 'Saat (optional)' }), seedInput, h('div.seed-hint', { text: 'Gleiche Saat, gleicher Schacht.' })))),
    h('div.setup-footer', goBtn));

  function charDef(id) {
    const d = content.CHARACTERS[id];
    if (d) return d;
    const rule = prog.CHARACTER_UNLOCKS && prog.CHARACTER_UNLOCKS[id];
    return { id, name: rule ? rule.name : id, title: '', desc: '', sprite: `char_${id}` };
  }

  function renderList() {
    clear(charList);
    for (const id of charOrder()) {
      const d = charDef(id);
      const ok = unlocked(id);
      const card = h('button.char-card' + (id === selected ? '.on' : '') + (ok ? '' : '.locked'), {
        type: 'button', attrs: { role: 'option', 'aria-selected': String(id === selected) }, data: { id },
      },
      h('div.char-portrait', icon(d.sprite || `char_${id}`, 48, { name: d.name, silhouette: !ok }), ok ? null : h('span.lock-badge', icon({ glyph: 'key', color: '#c9b48a' }, 16, { name: 'L' }))),
      h('div.char-card-text', h('div.char-name', { text: d.name || id }), h('div.char-title', { text: ok ? text(d.title) : 'Verschlossen' })));
      card.addEventListener('click', () => { if (selected !== id) { sfx.click(); selected = id; renderList(); renderDetail(); } });
      card.addEventListener('focus', () => { if (selected !== id && card.matches(':focus-visible')) { selected = id; renderListMarks(); renderDetail(); } });
      charList.appendChild(card);
    }
  }
  function renderListMarks() {
    for (const c of charList.children) {
      const on = c.dataset.id === selected;
      c.classList.toggle('on', on);
      c.setAttribute('aria-selected', String(on));
    }
  }

  function renderDetail() {
    clear(detail);
    const d = charDef(selected);
    const ok = unlocked(selected);
    const head = h('div.cd-head',
      h('div.cd-portrait', icon(d.sprite || `char_${selected}`, 96, { name: d.name, silhouette: !ok })),
      h('div.cd-names', h('div.cd-name', { text: d.name || selected }), d.title ? h('div.cd-title', { text: text(d.title) }) : null,
        h('p.cd-desc', { text: ok ? text(d.desc) : (text(d.desc) || 'Ein Glutträger, der noch auf seinen Ruf wartet.') })));
    detail.appendChild(head);

    if (!ok) {
      let pr = null;
      try { pr = prog.characterUnlockProgress(save(), selected); } catch { pr = null; }
      const lock = h('div.cd-lock',
        h('div.cd-lock-title', icon({ glyph: 'key', color: '#ffd35a' }, 20, { name: 'L' }), h('span', { text: 'Verschlossen' })),
        h('div.cd-lock-text', { text: pr ? pr.text : (prog.characterUnlockText ? prog.characterUnlockText(selected) : '') }),
        pr && pr.target > 1 ? progressBar(pr.ratio, `${fmtInt(pr.current)} / ${fmtInt(pr.target)}`) : null);
      if (pr && pr.price != null) {
        const check = prog.canBuyCharacter ? prog.canBuyCharacter(save(), selected) : { ok: false };
        const buy = button(`Freikaufen – ${fmtInt(pr.price)} Asche`, {
          cls: 'btn-buy', icon: icon({ glyph: 'ember', color: '#ff9a4a' }, 20, { name: 'A' }), disabled: !check.ok, sound: false,
          onDenied: () => ui.toast({ text: check.reason || 'Nicht genug Asche.', kind: 'bad' }),
          onClick: () => {
            if (prog.buyCharacter(save(), selected)) {
              sfx.confirm();
              ui.toast({ text: `${d.name} schließt sich der Glut an.`, kind: 'unlock', icon: { glyph: 'mask', color: '#ffd35a' } });
              renderList(); renderDetail(); shell.ash.refresh();
            } else sfx.deny();
          },
        });
        if (!check.ok) buy.title = check.reason || '';
        lock.appendChild(buy);
        if (!check.ok && check.reason) lock.appendChild(h('div.cd-lock-reason', { text: check.reason }));
      }
      detail.appendChild(lock);
    }

    // stat profile
    const base = content.BASE_STATS;
    let stats = base;
    if (content.computeStats && Array.isArray(d.baseMods)) { try { stats = content.computeStats([d.baseMods]); } catch { stats = base; } }
    if (base && stats) {
      const prof = statProfile(stats, base);
      detail.appendChild(h('div.cd-profile', prof.map((p) => h('div.prof-row',
        h('span.prof-label', { text: p.label }),
        h('span.prof-bar', h('span.prof-fill', { style: { '--f': Math.round(p.value * 100) / 100 } }), h('span.prof-mid'))))));
    }
    const mods = (Array.isArray(d.baseMods) ? d.baseMods : []).map((m) => describeMod(m, null)).filter(Boolean);
    if (mods.length) detail.appendChild(h('div.cd-mods', mods.map((m) => h('span.tag', { text: m }))));

    // loadout
    const kit = h('div.cd-kit');
    const wdef = d.weapon && content.WEAPONS[d.weapon];
    if (wdef) kit.appendChild(kitRow(wdef.icon, 'Startwaffe', wdef.name, wdef.desc));
    if (d.skill) kit.appendChild(kitRow(d.skill.icon, `Fertigkeit · ${d.skill.cooldown ? fmtDec(d.skill.cooldown, 1) + ' s' : ''}`.replace(/ · $/, ''), d.skill.name, d.skill.desc));
    if (d.passive) kit.appendChild(kitRow(d.passive.icon || { glyph: 'star', color: d.color || '#ffd35a' }, 'Gabe', d.passive.name, d.passive.desc));
    if (kit.childElementCount) detail.appendChild(kit);
    updateGo();
  }

  function kitRow(ic, label, name, desc) {
    return h('div.kit-row', icon(ic, 32, { name }), h('div.kit-text', h('div.kit-label', { text: label }), h('div.kit-name', { text: text(name) }), h('div.kit-desc', { text: text(desc) })));
  }

  function renderDiff() {
    clear(diffBox);
    const list = prog.DIFFICULTIES || [];
    const max = maxDiff();
    diff = Math.max(0, Math.min(diff, max));
    const d = list[diff] || { level: diff, name: '', desc: '', mods: {} };
    const prev = button('', { cls: 'btn-step', title: 'Niedrigere Glutstufe', icon: h('span.arrow-l'), disabled: diff <= 0, sound: false, onClick: () => { sfx.click(); diff--; renderDiff(); prevFocus(); } });
    const next = button('', { cls: 'btn-step', title: 'Höhere Glutstufe', icon: h('span.arrow-r'), disabled: diff >= max, sound: false,
      onDenied: () => ui.toast({ text: diff >= 10 ? 'Dies ist die höchste Glutstufe.' : `Gewinne auf Glutstufe ${diff}, um Glutstufe ${diff + 1} freizuschalten.`, kind: 'info' }),
      onClick: () => { sfx.click(); diff++; renderDiff(); nextFocus(); } });
    prev.setAttribute('aria-label', 'Niedrigere Glutstufe');
    next.setAttribute('aria-label', 'Höhere Glutstufe');
    function prevFocus() { const b = diffBox.querySelector('.btn-step'); if (b) ui.focusEl(b, true); }
    function nextFocus() { const b = diffBox.querySelectorAll('.btn-step')[1]; if (b) ui.focusEl(b, true); }
    const pips = h('div.diff-pips', list.map((x) => h('span.dpip' + (x.level <= diff ? '.on' : '') + (x.level > max ? '.locked' : ''), { title: `Glutstufe ${x.level}` })));
    const ashMult = d.mods && d.mods.ashMult ? d.mods.ashMult : 1;
    diffBox.append(...[
      sectionTitle('Glutstufe', h('span.diff-ash', { text: `Asche ×${fmtDec(ashMult, 2)}` })),
      h('div.diff-stepper', prev, h('div.diff-current', h('div.diff-level', { text: `${diff}` }), h('div.diff-name', { text: d.name || '' })), next),
      pips,
      h('div.diff-desc', { text: d.desc || '' }),
      Array.isArray(d.effects) && d.effects.length ? h('div.diff-effects', d.effects.map((e) => h('span.tag', { text: e }))) : null,
      max < 10 ? h('div.diff-unlock', { text: `Siege auf Glutstufe ${max}, um Glutstufe ${max + 1} zu entfachen.` }) : null].filter(Boolean));
  }

  function updateGo() {
    const ok = unlocked(selected);
    setDisabled(goBtn, !ok);
    goBtn.dataset.reason = ok ? '' : 'Dieser Glutträger ist noch verschlossen.';
  }

  function start() {
    if (!unlocked(selected)) return;
    sfx.confirm();
    const s = save();
    s.uiPrefs = { ...(s.uiPrefs || {}), character: selected, difficulty: diff };
    ui.persist();
    const seed = seedInput.value.trim();
    ui.startRun({ character: selected, difficulty: diff, seed: seed || undefined });
  }

  function refresh() {
    renderList();
    renderDetail();
    renderDiff();
    shell.ash.refresh();
  }
  refresh();

  return {
    el: shell.el,
    refresh,
    focus() { return goBtn.getAttribute('aria-disabled') === 'true' ? charList.querySelector('.on') : charList.querySelector('.on') || goBtn; },
  };
}
