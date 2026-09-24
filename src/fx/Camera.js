import { ARENA, CAMERA } from '../config.js';
import { damp, noise1 } from '../core/math.js';

/**
 * Trauma-driven camera (Eiserloh, "Juicing Your Cameras With Math"):
 *  - trauma accumulates from events and decays linearly; shake = trauma^2 so small hits
 *    stay subtle while big ones get violent,
 *  - offsets/rotation come from smooth noise, not white noise, so it rattles organically,
 *  - a spring-damped "kick" gives directional recoil, and a zoom spring gives punch-ins.
 */
export class Camera {
  constructor() {
    this.x = ARENA.w / 2;
    this.y = ARENA.h / 2;
    this.zoom = 1;
    this.zoomVel = 0;
    this.trauma = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.kickVX = 0;
    this.kickVY = 0;
    this.time = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeRot = 0;
    this.scale = 1;
    this.intensity = 1; // player "screen shake" setting
    this.viewW = 1;
    this.viewH = 1;
  }

  reset() {
    this.x = ARENA.w / 2;
    this.y = ARENA.h / 2;
    this.zoom = 1;
    this.zoomVel = 0;
    this.trauma = 0;
    this.kickX = this.kickY = this.kickVX = this.kickVY = 0;
  }

  /** Add trauma, optionally only up to `cap` (so rapid fire can't stack into a quake). */
  addTrauma(amount, cap = 1) {
    if (this.trauma < cap) this.trauma = Math.min(cap, this.trauma + amount);
  }

  /** Directional impulse in reference (1080p) pixels per second. */
  kick(dx, dy) {
    this.kickVX += dx;
    this.kickVY += dy;
  }

  /** Zoom impulse; positive punches in. */
  punch(amount) {
    this.zoomVel += amount;
  }

  update(dt, focusX, focusY) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - CAMERA.traumaDecay * dt);

    const tx = ARENA.w / 2 + (focusX - ARENA.w / 2) * CAMERA.follow;
    const ty = ARENA.h / 2 + (focusY - ARENA.h / 2) * CAMERA.follow;
    this.x = damp(this.x, tx, 3, dt);
    this.y = damp(this.y, ty, 3, dt);

    const k = 320;
    const c = 24;
    this.kickVX += (-this.kickX * k - this.kickVX * c) * dt;
    this.kickVY += (-this.kickY * k - this.kickVY * c) * dt;
    this.kickX += this.kickVX * dt;
    this.kickY += this.kickVY * dt;

    this.zoomVel += ((1 - this.zoom) * 170 - this.zoomVel * 15) * dt;
    this.zoom += this.zoomVel * dt;

    const s = this.trauma * this.trauma * this.intensity;
    const f = this.time * 19;
    this.shakeX = CAMERA.maxShake * s * noise1(f, 1);
    this.shakeY = CAMERA.maxShake * s * noise1(f, 2);
    this.shakeRot = CAMERA.maxShakeRot * s * noise1(f, 3);
  }

  /** Apply the camera to the world container rendered into a viewW x viewH target. */
  apply(container, viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    const fit = Math.min(viewW / (ARENA.w + CAMERA.margin * 2), viewH / (ARENA.h + CAMERA.margin * 2));
    this.scale = fit * this.zoom;
    const px = viewH / 1080;
    const kick = this.intensity;
    this.posX = viewW / 2 + (this.shakeX + this.kickX * kick) * px;
    this.posY = viewH / 2 + (this.shakeY + this.kickY * kick) * px;
    container.scale.set(this.scale);
    container.rotation = this.shakeRot;
    container.pivot.set(this.x, this.y);
    container.position.set(this.posX, this.posY);
  }

  /** World -> scene-target pixels *including* shake/kick/rotation (for DOM overlays). */
  project(wx, wy, out) {
    const lx = (wx - this.x) * this.scale;
    const ly = (wy - this.y) * this.scale;
    const c = Math.cos(this.shakeRot);
    const s = Math.sin(this.shakeRot);
    out.x = (this.posX ?? this.viewW / 2) + lx * c - ly * s;
    out.y = (this.posY ?? this.viewH / 2) + lx * s + ly * c;
    return out;
  }

  /** Shake-free mapping from scene-target pixels to world units (for stable aiming). */
  screenToWorld(sx, sy, out) {
    out.x = (sx - this.viewW / 2) / this.scale + this.x;
    out.y = (sy - this.viewH / 2) / this.scale + this.y;
    return out;
  }

  worldToScreen(wx, wy, out) {
    out.x = (wx - this.x) * this.scale + this.viewW / 2;
    out.y = (wy - this.y) * this.scale + this.viewH / 2;
    return out;
  }
}
