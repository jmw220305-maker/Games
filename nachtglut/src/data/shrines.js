// STUB — replaced by the relics owner.
export const SHRINES = {
  blood: {
    id: 'blood', name: 'Blutaltar', text: 'Der Stein verlangt ein Opfer.', weight: 1,
    options(ctx) {
      return [
        { label: 'Blut geben', desc: 'Verliere 20 Leben, erhalte ein Relikt.', available: ctx.player.hp > 25, pick(c) { c.w.damagePlayer(20, { unblockable: true, type: 'shadow' }); c.run.giveRelic(); } },
        { label: 'Weitergehen', desc: 'Nichts geschieht.', pick() {} },
      ];
    },
  },
};
