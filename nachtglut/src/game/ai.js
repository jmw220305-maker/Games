// STUB — replaced by the enemies owner.
import { bus } from '../core/events.js';
export const AI = {
  chaser: {
    update(w, e, dt) {
      const d = w.flowDir(e.x, e.y);
      const sp = e.speed * e.slowMul;
      w.moveEntity(e, d.x * sp * dt, d.y * sp * dt);
      if (d.x) e.flipX = d.x < 0;
      e.anim = 'walk';
    },
  },
  shooter: {
    init(w, e) { e.data.cd = w.rng.float(0.5, 1.5); },
    update(w, e, dt) {
      const p = w.player, a = e.def.aiParams;
      const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1;
      const sp = e.speed * e.slowMul;
      e.flipX = dx < 0;
      if (dist > a.range || !w.lineOfSight(e.x, e.y, p.x, p.y)) {
        const d = w.flowDir(e.x, e.y);
        w.moveEntity(e, d.x * sp * dt, d.y * sp * dt);
        e.anim = 'walk';
      } else if (dist < a.range * 0.5) {
        w.moveEntity(e, (-dx / dist) * sp * dt, (-dy / dist) * sp * dt);
        e.anim = 'walk';
      } else e.anim = 'idle';
      e.data.cd -= dt;
      if (e.data.cd <= 0 && dist < a.range * 1.3 && w.lineOfSight(e.x, e.y, p.x, p.y)) {
        e.data.cd = a.cooldown;
        e.anim = 'attack'; e.animT = 0;
        w.spawnProjectile({ x: e.x, y: e.y, angle: Math.atan2(dy, dx), speed: a.projSpeed, r: 3, damage: a.damage * e.dmgMul, type: 'fire', team: 'enemy', life: 2.5, sprite: 'proj_orb', color: '#ff8a3c', light: { r: 20, color: '#ff8a3c' }, owner: e });
        bus.emit('enemy:attack', { enemy: e, kind: 'shoot' });
      }
    },
  },
};
