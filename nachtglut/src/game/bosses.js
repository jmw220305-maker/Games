// STUB — replaced by the bosses owner.
import { bus } from '../core/events.js';
export const BOSSES = {
  boss_cinder: {
    id: 'boss_cinder', name: 'Schlackenkönig', title: 'Herr der Aschegruben', desc: 'Ein König aus erstarrter Glut.', biome: 'ash', boss: true,
    hp: 600, speed: 30, damage: 14, r: 18, mass: 0, xp: 60, sparks: [40, 60], sprite: 'boss_cinder', color: '#ff6a1f', ai: 'boss_stub', aiParams: {},
  },
};
export const BOSS_AI = {
  boss_stub: {
    init(w, e) { e.data.cd = 2; },
    update(w, e, dt) {
      const p = w.player;
      const d = w.flowDir(e.x, e.y);
      w.moveEntity(e, d.x * e.speed * e.slowMul * dt, d.y * e.speed * e.slowMul * dt);
      e.data.cd -= dt;
      if (e.data.cd <= 0) {
        e.data.cd = 2.2;
        const n = 12, base = w.rng.angle();
        for (let i = 0; i < n; i++) w.spawnProjectile({ x: e.x, y: e.y, angle: base + (i / n) * Math.PI * 2, speed: 90, r: 4, damage: 10 * e.dmgMul, type: 'fire', team: 'enemy', life: 4, sprite: 'proj_orb', color: '#ff6a1f', owner: e });
        bus.emit('enemy:attack', { enemy: e, kind: 'shoot' });
        if (!e.data.p2 && e.hp < e.maxHp / 2) { e.data.p2 = true; bus.emit('boss:phase', { boss: e, phase: 2 }); }
      }
    },
  },
};
