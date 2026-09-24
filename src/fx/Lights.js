import { hexToRgb01 } from '../core/math.js';
import { MAX_LIGHTS } from '../render/WarpGrid.js';

/**
 * Short-lived point lights that illuminate the warp grid (explosions, muzzle flashes,
 * the surge nova). Persistent lights (the ship) are submitted fresh every frame.
 */
export class Lights {
  constructor(capacity = 48) {
    this.pool = [];
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ x: 0, y: 0, radius: 0, intensity: 0, base: 0, r: 1, g: 1, b: 1, life: 0, max: 1, grow: 0, active: false });
    }
    this.frame = [];
  }

  add(x, y, radius, intensity, color, life, grow = 0) {
    let slot = null;
    for (const l of this.pool) {
      if (!l.active) {
        slot = l;
        break;
      }
      if (!slot || l.intensity < slot.intensity) slot = l;
    }
    const [r, g, b] = hexToRgb01(color);
    Object.assign(slot, { x, y, radius, intensity, base: intensity, r, g, b, life, max: life, grow, active: true });
    return slot;
  }

  update(dt) {
    for (const l of this.pool) {
      if (!l.active) continue;
      l.life -= dt;
      if (l.life <= 0) {
        l.active = false;
        l.intensity = 0;
        continue;
      }
      const t = l.life / l.max;
      l.intensity = l.base * t * t;
      l.radius += l.grow * dt;
    }
  }

  clear() {
    for (const l of this.pool) l.active = false;
  }

  /** Merge persistent lights with the pooled ones, keep the strongest MAX_LIGHTS. */
  collect(persistent) {
    const out = this.frame;
    out.length = 0;
    for (const l of persistent) out.push(l);
    for (const l of this.pool) if (l.active) out.push(l);
    if (out.length > MAX_LIGHTS) {
      out.sort((a, b) => b.intensity * b.radius - a.intensity * a.radius);
      out.length = MAX_LIGHTS;
    }
    return out;
  }
}
