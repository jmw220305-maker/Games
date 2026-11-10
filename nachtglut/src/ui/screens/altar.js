// Aschealtar: permanent upgrades grouped by branch; buy with Asche; full refund behind a confirm.
import { h, clear, icon, button, sfx } from '../dom.js';
import { fmtInt, text } from '../format.js';
import * as prog from '../../meta/progression.js';
import { screenShell } from './common.js';

export function createAltar(ui) {
  const game = ui.game;
  const save = () => game.save || {};
  const shell = screenShell(ui, { id: 'altar', title: 'Aschealtar', kicker: 'Feuerstelle', ash: true });
  const intro = h('div.altar-intro',
    h('p', { text: 'Die Asche der Gefallenen nährt die Feuerstelle. Opfere sie, um jeden künftigen Glutträger zu stärken.' }));
  const resetBtn = button('Asche zurückfordern', {
    cls: 'btn-small btn-ghost', icon: icon({ glyph: 'hourglass', color: '#c9b48a' }, 20, { name: 'Z' }), sound: false,
    onDenied: () => ui.toast({ text: 'Am Altar ist noch keine Asche geopfert.', kind: 'info' }),
    onClick: async () => {
      sfx.click();
      const spent = prog.spentAsh ? prog.spentAsh(save()) : 0;
      const ok = await ui.confirm({
        title: 'Altar zurücksetzen?',
        text: `Alle Verbesserungen werden entfernt. Du erhältst ${fmtInt(spent)} Asche zurück und kannst sie neu verteilen.`,
        confirmLabel: 'Zurücksetzen', danger: true,
      });
      if (!ok) return;
      const back = prog.refundAll(save());
      ui.toast({ text: `${fmtInt(back)} Asche zurückerhalten.`, kind: 'good', icon: { glyph: 'ember', color: '#ff9a4a' } });
      refresh();
      ui.focusEl(resetBtn, true);
    },
  });
  intro.appendChild(resetBtn);
  const grid = h('div.altar-grid');
  shell.body.append(intro, grid);

  function node(info) {
    const def = info.def;
    const pips = h('div.node-pips', Array.from({ length: info.maxLevel }, (_, i) => h('span.np' + (i < info.level ? '.on' : ''))));
    let costEl;
    if (info.maxed) costEl = h('div.node-cost.maxed', { text: 'Vollendet' });
    else costEl = h('div.node-cost' + (info.canBuy ? '.ok' : ''), icon({ glyph: 'ember', color: '#ff9a4a' }, 16, { name: 'A' }), h('span', { text: fmtInt(info.cost) }));
    const lines = h('div.node-lines');
    if (info.level > 0) lines.appendChild(h('div.node-line.cur', h('span.nl-k', { text: 'Jetzt' }), h('span', { text: text(info.current) })));
    if (!info.maxed) lines.appendChild(h('div.node-line.next', h('span.nl-k', { text: info.level > 0 ? 'Nächste' : 'Stufe 1' }), h('span', { text: text(info.next) })));
    const reason = !info.canBuy && !info.maxed ? h('div.node-reason' + (info.code === 'requires' ? '.req' : ''), { text: info.reason }) : null;
    const b = h('button.node' + (info.maxed ? '.maxed' : '') + (info.locked ? '.locked' : '') + (info.canBuy ? '.can' : ''), {
      type: 'button', style: { '--bc': (def.icon && def.icon.color) || '#ff8a3c' },
      attrs: { 'aria-label': `${def.name}, Stufe ${info.level} von ${info.maxLevel}${info.maxed ? ', vollendet' : `, kostet ${info.cost} Asche`}` },
    },
    h('div.node-top', icon(def.icon, 32, { name: def.name }), h('div.node-names', h('div.node-name', { text: def.name }), pips), costEl),
    lines, reason);
    if (!info.canBuy) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => {
      const cur = prog.upgradeInfo(save(), def.id);
      if (!cur || !cur.canBuy) {
        sfx.deny();
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
        if (cur && cur.reason) ui.toast({ text: cur.reason, kind: cur.code === 'max' ? 'info' : 'bad' });
        return;
      }
      if (prog.buyUpgrade(save(), def.id)) {
        sfx.confirm();
        const id = def.id;
        refresh();
        const nb = grid.querySelector(`[data-id="${id}"]`);
        if (nb) { nb.classList.add('bought'); ui.focusEl(nb, true); }
      } else sfx.deny();
    });
    b.dataset.id = def.id;
    return b;
  }

  function refresh() {
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    clear(grid);
    const order = prog.UPGRADE_BRANCH_ORDER || Object.keys(prog.UPGRADE_BRANCHES || {});
    for (const bid of order) {
      const br = prog.UPGRADE_BRANCHES[bid] || { name: String(bid), desc: '', icon: null };
      let infos = [];
      try { infos = prog.upgradesByBranch(save(), bid); } catch { infos = []; }
      const have = infos.reduce((s, i) => s + i.level, 0), total = infos.reduce((s, i) => s + i.maxLevel, 0);
      grid.appendChild(h('div.branch', { style: { '--bc': br.color || '#ff8a3c' } },
        h('div.branch-head', icon(br.icon, 32, { name: br.name }), h('div.branch-names', h('div.branch-name', { text: br.name }), h('div.branch-desc', { text: br.desc })), h('div.branch-count', { text: `${have}/${total}` })),
        h('div.branch-nodes', infos.map(node))));
    }
    shell.ash.refresh();
    const spent = prog.spentAsh ? prog.spentAsh(save()) : 0;
    if (spent > 0) resetBtn.removeAttribute('aria-disabled'); else resetBtn.setAttribute('aria-disabled', 'true');
    if (focusedId) {
      const nb = grid.querySelector(`[data-id="${focusedId}"]`);
      if (nb) ui.focusEl(nb, true);
    }
  }
  refresh();

  return { el: shell.el, refresh, focus() { return grid.querySelector('.node.can') || grid.querySelector('.node'); } };
}
