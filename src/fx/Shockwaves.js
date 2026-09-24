import { MAX_SHOCKS } from '../render/Pipeline.js';

/**
 * Screen-space refraction rings. Stored in world space, projected to the composite
 * shader's uv space every frame so they track the (shaking, zooming) camera.
 */
export class Shockwaves {
  constructor() {
    this.list = [];
    for (let i = 0; i < MAX_SHOCKS; i++) this.list.push({ x: 0, y: 0, r: 0, speed: 0, strength: 0, life: 0, max: 1, active: false });
    this.uniform = new Float32Array(MAX_SHOCKS * 4);
    this.scale = 1; // reduced-flash accessibility setting
    this._p = { x: 0, y: 0 };
  }

  add(x, y, speed, strength, life) {
    let slot = this.list.find((s) => !s.active);
    if (!slot) slot = this.list.reduce((a, b) => (a.life < b.life ? a : b));
    Object.assign(slot, { x, y, r: 0, speed, strength, life, max: life, active: true });
  }

  update(dt) {
    for (const s of this.list) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      s.r += s.speed * dt;
      s.speed *= Math.exp(-1.2 * dt);
    }
  }

  clear() {
    for (const s of this.list) s.active = false;
  }

  /** Fill the composite uniform: (u, v, radius in uv-height units, strength). */
  project(camera, viewW, viewH) {
    const u = this.uniform;
    const p = this._p;
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const s = this.list[i];
      const o = i * 4;
      if (!s.active) {
        u[o + 3] = 0;
        continue;
      }
      camera.worldToScreen(s.x, s.y, p);
      const t = s.life / s.max;
      u[o] = p.x / viewW;
      u[o + 1] = p.y / viewH;
      u[o + 2] = (s.r * camera.scale) / viewH;
      u[o + 3] = s.strength * t * t * this.scale;
    }
    return u;
  }
}
