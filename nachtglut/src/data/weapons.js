// STUB — replaced by the weapons owner.
import { playerVolley } from '../game/combat.js';
export const WEAPONS = {
  ember_bolt: {
    id: 'ember_bolt', name: 'Glutbolzen', desc: 'Ein verlässlicher Bolzen aus gebündelter Glut.', rarity: 'common', type: 'fire',
    icon: { glyph: 'flame', color: '#ff8a3c' }, projSprite: 'proj_bolt', color: '#ffb347',
    base: { damage: 9, cooldown: 0.34, projSpeed: 260, range: 210, count: 1, spread: 0, pierce: 0, knockback: 50 },
    levels: [
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: '+15 % Feuerrate', mods: { cooldown: 0.85 } },
      { desc: 'Durchschlägt 1 Gegner', mods: { '+pierce': 1 } },
      { desc: '+1 Projektil', mods: { '+count': 1, spread: 1 } },
    ],
    fire(w, player, ws, aim) { playerVolley(w, ws, aim.angle, { trail: 'ember' }); },
  },
  scatter_coal: {
    id: 'scatter_coal', name: 'Streukohle', desc: 'Ein Fächer glühender Splitter auf kurze Distanz.', rarity: 'common', type: 'fire',
    icon: { glyph: 'ember', color: '#ff6a1f' }, projSprite: 'proj_shard', color: '#ff7a2f',
    base: { damage: 5, cooldown: 0.7, projSpeed: 230, range: 120, count: 5, spread: 0.6, pierce: 0, knockback: 90 },
    levels: [
      { desc: '+1 Splitter', mods: { '+count': 1 } },
      { desc: '+25 % Schaden', mods: { damage: 1.25 } },
      { desc: '+15 % Feuerrate', mods: { cooldown: 0.85 } },
      { desc: '+2 Splitter', mods: { '+count': 2 } },
    ],
    fire(w, player, ws, aim) { playerVolley(w, ws, aim.angle, { jitter: 0.05 }); },
  },
};
