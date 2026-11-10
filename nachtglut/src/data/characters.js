// STUB — replaced by the weapons owner.
import { skillDamage } from '../game/combat.js';
export const CHARACTERS = {
  bearer: {
    id: 'bearer', name: 'Glutträger', title: 'Der letzte Funke', desc: 'Ausgewogen. Trägt die Glut der Feuerstelle im Herzen.',
    sprite: 'char_bearer', color: '#ff8a3c', baseMods: [], weapon: 'ember_bolt',
    skill: {
      id: 'flame_wave', name: 'Flammenwoge', desc: 'Eine Woge aus Feuer verbrennt alle Gegner in der Nähe.', cooldown: 9, icon: { glyph: 'flame', color: '#ff8a3c' },
      use(w, player) {
        const r = 62;
        w.fx.ring(player.x, player.y, r, '#ff8a3c', 0.35);
        w.fx.burst('ember', player.x, player.y, { count: 24, speed: 140 });
        for (const e of w.enemiesInRadius(player.x, player.y, r)) {
          skillDamage(w, e, 26, { type: 'fire', source: 'skill', knockback: { x: e.x - player.x, y: e.y - player.y, force: 160 } });
          w.applyStatus(e, 'burn', { duration: 3, power: 6 });
        }
      },
    },
    unlock: { text: 'Von Beginn an verfügbar', default: true },
  },
};
