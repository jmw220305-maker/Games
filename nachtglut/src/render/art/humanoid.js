// Shared builder for small biped sprites (player characters and humanoid enemies).
// A figure = ASCII head map + ASCII torso map + programmatic legs, composed per pose so
// breathing, walking, dashing and recoiling come for free.
import { sprite } from './helpers.js';

/**
 * cfg: {
 *   w, h, pal,
 *   head: rows, hx, hy,           head map + position
 *   torso: rows | (p, c) => rows, tx, ty,   torso map + position
 *   legs: { xl, xr, y, leg, boot, bootHi, far } | null (robes)
 *   under(b, p, c), extra(b, p, c)   hooks drawn behind / in front. c = { by, hy } offsets
 *   anims: overrides for the default animation table
 * }
 * Pose keys: step (0..3 walk phase), breathe (0|1), dash, hurt, atk, cast, + anything custom.
 */
export function humanoid(key, cfg) {
  const { w, h, pal } = cfg;
  const draw = (b, p) => {
    const step = p.step === undefined ? -1 : p.step;
    const contact = step === 0 || step === 2;
    const by = (contact ? 1 : 0) + (p.by || 0);
    const hy = by + (p.breathe ? 1 : 0) + (p.hy || 0);
    const c = { by, hy, step, contact };
    if (cfg.under) cfg.under(b, p, c);
    const L = cfg.legs;
    if (L) {
      const leg = (x, spread, lift, far) => {
        const col = far && L.far ? L.far : L.leg;
        const top = L.y + (contact ? 1 : 0);
        const bottom = L.y + 2 - lift;
        for (let y = top; y <= bottom; y++) {
          const boot = y >= bottom - 1 + (lift ? 1 : 0);
          b.rect(x + spread, y, 2, 1, boot ? (far && L.bootFar ? L.bootFar : L.boot) : col);
        }
        if (L.bootHi && !lift) b.px(x + spread + 1, bottom, far ? L.boot : L.bootHi);
      };
      if (p.dash) {
        leg(L.xl - 2, 0, 1, true);
        leg(L.xr - 2, 0, 0, false);
        b.px(L.xr - 3, L.y + 2, L.boot);
      } else if (step === 0) { leg(L.xl, -1, 0, true); leg(L.xr, 1, 0, false); }
      else if (step === 1) { leg(L.xl, 0, 1, true); leg(L.xr, 0, 0, false); }
      else if (step === 2) { leg(L.xl, 1, 0, true); leg(L.xr, -1, 0, false); }
      else if (step === 3) { leg(L.xl, 0, 0, true); leg(L.xr, 0, 1, false); }
      else if (p.hurt) { leg(L.xl, -1, 0, true); leg(L.xr, 1, 0, false); }
      else { leg(L.xl, 0, 0, true); leg(L.xr, 0, 0, false); }
    }
    if (cfg.mid) cfg.mid(b, p, c);
    const tp = cfg.torsoPal ? cfg.torsoPal(p) || pal : pal;
    const torso = typeof cfg.torso === 'function' ? cfg.torso(p, c) : cfg.torso;
    b.map(torso, tp, cfg.tx || 0, (cfg.ty || 0) + by);
    const hp = cfg.headPal ? cfg.headPal(p) || pal : pal;
    b.map(p.hurt && cfg.headHurt ? cfg.headHurt : cfg.head, hp, (cfg.hx || 0) + (p.hx || 0), (cfg.hy || 0) + hy);
    if (cfg.extra) cfg.extra(b, p, c);
  };
  const anims = {
    idle: [3, { f: 0 }, { f: 1 }, { f: 2, breathe: 1 }, { f: 3, breathe: 1 }],
    walk: [8, { step: 0, f: 0 }, { step: 1, f: 1 }, { step: 2, f: 2 }, { step: 3, f: 3 }],
    dash: [12, { dash: 1, shear: 0.22, f: 0 }, { dash: 1, shear: 0.22, f: 1 }],
    hurt: [1, { hurt: 1, shear: -0.14 }],
    ...(cfg.anims || {}),
  };
  return sprite(key, w, h, draw, anims, cfg.opts || {});
}
