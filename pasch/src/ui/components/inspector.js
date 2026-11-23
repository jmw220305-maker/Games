// Würfel-Inspektor: alle Würfel als Netz (alle Flächen). Reine Ansicht („Deine Würfel“) oder Zielwahl für
// Werkzeuge (face / faces / die / rolled) und für den Würfelbeutel (welcher Würfel wird ersetzt).
import { h } from '../dom.js';
import * as G from '../../game/index.js';
import { juice, nope } from '../../fx/index.js';
import { audio } from '../../audio/audio.js';
import { openModal } from '../overlay.js';
import { attachTooltip } from '../tooltip.js';
import { button } from './button.js';
import { rich } from '../text.js';

const P = { l: 26, c: 50, r: 74 };
const PIPS = {
  1: [['c', 'c']], 2: [['l', 'l'], ['r', 'r']], 3: [['l', 'l'], ['c', 'c'], ['r', 'r']],
  4: [['l', 'l'], ['r', 'l'], ['l', 'r'], ['r', 'r']], 5: [['l', 'l'], ['r', 'l'], ['c', 'c'], ['l', 'r'], ['r', 'r']],
  6: [['l', 'l'], ['l', 'c'], ['l', 'r'], ['r', 'l'], ['r', 'c'], ['r', 'r']],
};

/** Flache Würfelfläche (nutzt die Würfel-Styles). */
export function faceTile(face, die, { size = 46, hidden = false, value } = {}) {
  const v = value != null ? value : face ? face.v : 0;
  const mark = face && face.mark;
  const sides = die.sides || die.faces.length;
  let cls = mark ? `mk-${mark}` : '';
  let inner = '';
  if (hidden) { cls = 'is-hidden'; inner = '<span class="die-glyph die-q">?</span>'; }
  else if (mark === 'stone') { cls += ' is-stone'; inner = '<span class="die-stone-specks"></span>'; }
  else if (mark === 'star') { inner = `<span class="die-glyph die-star">✦</span>${v > 0 ? `<span class="die-corner">${v}</span>` : ''}`; }
  else if (v <= 0) { cls += ' is-blank'; inner = '<span class="die-scratch"></span>'; }
  else if (sides !== 6 || v > 6) inner = `<span class="die-glyph die-num">${v}</span>`;
  else inner = PIPS[v].map(([x, y]) => `<i class="pip" style="left:${P[x]}%;top:${P[y]}%"></i>`).join('');
  if (!hidden && mark === 'clover') inner += '<span class="die-corner die-clover">♣</span>';
  const el = h(`div.die.nf${die.material ? `.die--m-${die.material}` : ''}`, { vars: { 'die-size': `${size}px` } });
  el.innerHTML = `<div class="die-face ${cls}"><div class="die-face-in">${inner}</div></div>`;
  return el;
}

function faceInfo(face, die) {
  const parts = [];
  if (face.mark) { const m = G.MARK_INFO[face.mark]; parts.push(`<b class="kw kw-name">${m.name}</b>: ${rich(m.desc)}`); }
  if (die.material) { const m = G.MATERIAL_INFO[die.material]; parts.push(`<b class="kw kw-name">${m.name}</b> (Material): ${rich(m.desc)}`); }
  if (!parts.length) parts.push(face.v > 0 ? 'Normale Fläche.' : 'Leere Fläche: keine Augen.');
  return parts.join('<br>');
}

// Netz-Positionen [Spalte, Zeile] je Flächenindex
const NET = {
  6: [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2], [3, 1]], // 0 Mitte, Gegenseiten gegenüber
  4: [[0, 0], [1, 0], [2, 0], [3, 0]],
  8: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
};
const NET_SIZE = { 6: [4, 3], 4: [4, 1], 8: [4, 2] };

/** Netz eines Würfels → {el, faceEls[]} */
export function dieNet(die, { size = 40, onFace, isSel, label } = {}) {
  const n = die.faces.length;
  const pos = NET[n] || die.faces.map((_, i) => [i % 4, Math.floor(i / 4)]);
  const [cols, rows] = NET_SIZE[n] || [4, Math.ceil(n / 4)];
  const grid = h('div.net', { vars: { cols, rows, fs: `${size}px` } });
  const faceEls = die.faces.map((f, fi) => {
    const t = faceTile(f, die, { size });
    const cell = h('div.net-cell', { dataset: { face: String(fi) } }, t);
    cell.style.gridColumn = String(pos[fi][0] + 1);
    cell.style.gridRow = String(pos[fi][1] + 1);
    attachTooltip(cell, () => ({ title: f.mark ? G.MARK_INFO[f.mark].name : f.v > 0 ? `Fläche ${f.v}` : 'Leere Fläche', kind: `Würfel ${label || ''} · Fläche ${fi + 1}`, hue: f.mark ? G.MARK_INFO[f.mark].hue : 40, body: faceInfo(f, die) }));
    if (onFace) cell.addEventListener('click', () => onFace(fi, cell));
    if (isSel && isSel(fi)) cell.classList.add('net-cell--sel');
    grid.appendChild(cell);
    return cell;
  });
  return { el: grid, faceEls };
}

function dieTitle(die, i) {
  const parts = [`W${die.sides}`];
  if (die.material) parts.push(G.MATERIAL_INFO[die.material].name);
  if (die.src) parts.push('Talisman');
  return h('div.insp-die-title', h('span.insp-die-no', String(i + 1)), parts.join(' · '));
}

/**
 * openInspector(app, {mode:'view'} | {mode:'target', spec, def, title, sub, previewDie, confirmLabel})
 * → Promise<target|null>
 */
export function openInspector(app, o = {}) {
  const run = app.run;
  const spec = o.spec || null;
  const def = o.def || null;
  const mode = o.mode || 'view';
  let sel = { faces: [], die: null, rolled: null, value: null, delta: null };
  const content = h('div.insp');
  const status = h('div.insp-status');
  const extra = h('div.insp-extra');
  let confirmBtn = null;
  let modal = null;
  let result = null;
  const size = window.innerWidth < 520 ? 30 : 40;

  function currentTarget() {
    if (!spec) return null;
    switch (spec.type) {
      case 'face': {
        const f = sel.faces[0];
        if (!f) return null;
        const t = { die: f.die, face: f.face };
        if (spec.value) { if (sel.value == null) return null; t.value = sel.value; }
        return t;
      }
      case 'faces': return sel.faces.length ? { faces: sel.faces.map((f) => ({ die: f.die, face: f.face })) } : null;
      case 'die': return sel.die != null ? { die: sel.die } : null;
      case 'rolled': {
        if (sel.rolled == null) return null;
        const t = { rolled: sel.rolled };
        if (spec.delta) { if (!sel.delta) return null; t.delta = sel.delta; }
        return t;
      }
      default: return null;
    }
  }

  function check() {
    if (mode !== 'target') return null;
    const t = currentTarget();
    if (!t) return hintText();
    if (spec.type === 'faces' && spec.exact && sel.faces.length < spec.count) return hintText();
    if (def) {
      const e = G.validateTarget(run, def, t) || (def.validate ? def.validate(run, t) : null);
      if (e) return e;
    }
    if (o.dieCheck && t.die != null) { const e = o.dieCheck(t.die); if (e) return e; }
    return null;
  }

  function hintText() {
    if (!spec) return '';
    switch (spec.type) {
      case 'face': return spec.value ? (sel.faces.length ? 'Wähle den neuen Wert' : 'Wähle eine Fläche') : 'Wähle eine Fläche';
      case 'faces': return spec.sameDie ? (sel.faces.length ? 'Wähle die Zielfläche (gleicher Würfel)' : 'Wähle die Vorlage') : `Wähle bis zu ${spec.count} Flächen`;
      case 'die': return 'Wähle einen Würfel';
      case 'rolled': return spec.delta ? (sel.rolled == null ? 'Wähle einen geworfenen Würfel' : 'Höher oder niedriger?') : 'Wähle einen geworfenen Würfel';
      default: return '';
    }
  }

  function render() {
    content.innerHTML = '';
    if (o.previewDie) {
      content.appendChild(h('div.insp-new', h('div.insp-cap', 'Neuer Würfel'), h('div.insp-die.insp-die--new', dieTitle(o.previewDie, -1), dieNet(o.previewDie, { size, label: 'neu' }).el)));
    }
    const list = h('div.insp-list');
    if (spec && spec.type === 'rolled') {
      const rolled = run.round && run.round.rolled ? run.round.rolled : [];
      rolled.forEach((r, i) => {
        const die = run.dice[i];
        const face = die.faces[r.faceIndex];
        const tile = faceTile(face, die, { size: size * 1.4, hidden: r.hidden, value: r.v });
        const box = h('div.insp-rolled', { dataset: { i: String(i) } }, tile, h('div.insp-die-no', String(i + 1)));
        if (sel.rolled === i) box.classList.add('insp-rolled--sel');
        if (r.hidden) box.classList.add('insp-rolled--off');
        box.addEventListener('click', () => {
          if (r.hidden) { nope(box); audio.play('deny'); setStatus('Verdeckte Würfel können nicht verändert werden', true); return; }
          sel.rolled = i; sel.delta = null; audio.play('hold'); render(); juice(list.children[i], 0.2);
        });
        list.appendChild(box);
      });
      list.classList.add('insp-list--rolled');
    } else {
      run.dice.forEach((die, i) => {
        const pickDie = spec && spec.type === 'die';
        const box = h('div.insp-die', { dataset: { i: String(i) } });
        if (pickDie && sel.die === i) box.classList.add('insp-die--sel');
        box.appendChild(dieTitle(die, i));
        const isSel = (fi) => sel.faces.some((f) => f.die === i && f.face === fi);
        const net = dieNet(die, {
          size, label: String(i + 1), isSel,
          onFace: mode === 'target' && (spec.type === 'face' || spec.type === 'faces') ? (fi, cell) => onFace(i, fi, cell) : null,
        });
        // Reihenfolge-Nummern bei Spiegel
        if (spec && spec.sameDie) sel.faces.forEach((f, k) => { if (f.die === i) net.faceEls[f.face].appendChild(h('span.net-order', k === 0 ? 'Vorlage' : 'Ziel')); });
        box.appendChild(net.el);
        if (pickDie) box.addEventListener('click', () => { sel.die = i; audio.play('hold'); render(); juice(list.children[i], 0.15); });
        list.appendChild(box);
      });
    }
    content.appendChild(list);
    // Zusatz: Wertwahl / Richtung
    extra.innerHTML = '';
    if (spec && spec.type === 'face' && spec.value && sel.faces.length) {
      const f = sel.faces[0];
      const die = run.dice[f.die];
      const row = h('div.insp-values');
      for (let v = 1; v <= die.sides; v++) {
        const b = button(String(v), { kind: sel.value === v ? 'gold' : 'plain', size: 's', onClick: () => { sel.value = v; render(); } });
        row.appendChild(b);
      }
      extra.appendChild(h('div.insp-cap', 'Neuer Wert'));
      extra.appendChild(row);
    }
    if (spec && spec.type === 'rolled' && spec.delta && sel.rolled != null) {
      const row = h('div.insp-values');
      row.appendChild(button('−1', { kind: sel.delta === -1 ? 'gold' : 'plain', onClick: () => { sel.delta = -1; render(); } }));
      row.appendChild(button('+1', { kind: sel.delta === 1 ? 'gold' : 'plain', onClick: () => { sel.delta = 1; render(); } }));
      extra.appendChild(row);
    }
    content.appendChild(extra);
    if (mode === 'target') {
      content.appendChild(status);
      const err = check();
      setStatus(err || 'Bereit.', !!err && !!currentTarget());
      if (confirmBtn) confirmBtn.setDisabled(!!err, err);
    }
  }

  function setStatus(t, bad) {
    status.textContent = t;
    status.classList.toggle('insp-status--bad', !!bad);
  }

  function onFace(die, face, cell) {
    const k = sel.faces.findIndex((f) => f.die === die && f.face === face);
    if (spec.type === 'face') {
      sel.faces = k >= 0 ? [] : [{ die, face }];
      sel.value = null;
    } else if (k >= 0) {
      sel.faces.splice(k, 1);
    } else {
      if (spec.sameDie && sel.faces.length && sel.faces[0].die !== die) sel.faces = [];
      sel.faces.push({ die, face });
      while (sel.faces.length > spec.count) sel.faces.shift();
    }
    audio.play(k >= 0 ? 'unhold' : 'hold');
    render();
    const nc = content.querySelector(`.insp-die[data-i="${die}"] .net-cell[data-face="${face}"]`);
    if (nc) juice(nc, 0.25);
  }

  render();
  const buttons = [];
  if (mode === 'target') {
    buttons.push({ label: 'Abbrechen', kind: 'plain', onClick: (m) => m.close() });
  }
  modal = openModal({
    title: o.title || 'Deine Würfel',
    sub: o.sub || (mode === 'view' ? 'Alle Flächen deiner Würfel. Prägungen und Materialien: Zeiger darauf oder lange drücken.' : ''),
    content, cls: 'modal-panel--wide',
    buttons,
    onClose: () => { if (resolveFn) resolveFn(result); },
    onKey: (e) => {
      if (e.key === 'Enter' && confirmBtn) { confirmBtn.click(); return true; }
      return false;
    },
  });
  if (mode === 'target') {
    confirmBtn = button(o.confirmLabel || 'Anwenden', {
      kind: 'go',
      onClick: () => {
        const err = check();
        if (err) return;
        result = currentTarget();
        modal.close();
      },
      onDenied: (r) => setStatus(r || hintText(), true),
    });
    modal.panel.querySelector('.modal-buttons').appendChild(confirmBtn);
    render();
  }
  let resolveFn = null;
  return new Promise((resolve) => { resolveFn = resolve; });
}
