import { ARENA } from '../config.js';
import { mixHex } from '../core/math.js';

export const BOUNCE = 1; // collide with the arena walls
export const STRETCH = 2; // align to velocity and lengthen with speed (motion blur)
export const FLICKER = 4; // random per-frame intensity shimmer
export const SPIN = 8; // rotation comes from vrot instead of staying fixed

/**
 * Struct-of-arrays particle simulation. Zero allocations per frame: particles live in
 * typed arrays and dead ones are swap-removed. Rendering goes through a GlowLayer.
 */
export class Particles {
  constructor(atlas, capacity = 6000) {
    this.atlas = atlas;
    this.cap = capacity;
    this.n = 0;
    const F = Float32Array;
    this.x = new F(capacity);
    this.y = new F(capacity);
    this.vx = new F(capacity);
    this.vy = new F(capacity);
    this.life = new F(capacity);
    this.max = new F(capacity);
    this.s0 = new F(capacity);
    this.s1 = new F(capacity);
    this.i0 = new F(capacity);
    this.i1 = new F(capacity);
    this.rot = new F(capacity);
    this.vrot = new F(capacity);
    this.drag = new F(capacity);
    this.stretch = new F(capacity);
    this.aspect = new F(capacity);
    this.c0 = new Uint32Array(capacity);
    this.c1 = new Uint32Array(capacity);
    this.frame = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);

    this.frames = [];
    this.refX = [];
    this.refY = [];
    this.ids = {};
    const shapes = { spark: [64, 16], bullet: [48, 16], beam: [32, 16] };
    for (const name of Object.keys(atlas.frames)) {
      this.ids[name] = this.frames.length;
      this.frames.push(atlas.frames[name]);
      const r = shapes[name] ?? [atlas.ref[name], atlas.ref[name]];
      this.refX.push(r[0]);
      this.refY.push(r[1]);
    }
    this.budgetScale = 1;
  }

  id(name) {
    return this.ids[name];
  }

  /** Remaining room, so emitters can scale their counts down under heavy load. */
  get free() {
    return this.cap - this.n;
  }

  spawn(frameId, x, y, vx, vy, life, s0, s1, c0, c1, i0, i1, drag = 0, flags = 0, rot = 0, vrot = 0, stretch = 0, aspect = 1) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.frame[i] = frameId;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.c0[i] = c0;
    this.c1[i] = c1;
    this.i0[i] = i0;
    this.i1[i] = i1;
    this.drag[i] = drag;
    this.flags[i] = flags;
    this.rot[i] = rot;
    this.vrot[i] = vrot;
    this.stretch[i] = stretch;
    this.aspect[i] = aspect;
    return i;
  }

  _remove(i) {
    const j = --this.n;
    if (i === j) return;
    this.frame[i] = this.frame[j];
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.s0[i] = this.s0[j];
    this.s1[i] = this.s1[j];
    this.c0[i] = this.c0[j];
    this.c1[i] = this.c1[j];
    this.i0[i] = this.i0[j];
    this.i1[i] = this.i1[j];
    this.drag[i] = this.drag[j];
    this.flags[i] = this.flags[j];
    this.rot[i] = this.rot[j];
    this.vrot[i] = this.vrot[j];
    this.stretch[i] = this.stretch[j];
    this.aspect[i] = this.aspect[j];
  }

  clear() {
    this.n = 0;
  }

  update(dt) {
    if (dt <= 0) return;
    const { x, y, vx, vy, life, drag, flags, rot, vrot } = this;
    const W = ARENA.w;
    const H = ARENA.h;
    for (let i = 0; i < this.n; ) {
      life[i] -= dt;
      if (life[i] <= 0) {
        this._remove(i);
        continue;
      }
      const d = drag[i] > 0 ? Math.exp(-drag[i] * dt) : 1;
      vx[i] *= d;
      vy[i] *= d;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      const f = flags[i];
      if (f & SPIN) {
        rot[i] += vrot[i] * dt;
        vrot[i] *= d;
      }
      if (f & BOUNCE) {
        if (x[i] < 0) {
          x[i] = -x[i];
          vx[i] = -vx[i] * 0.55;
          vrot[i] *= -0.8;
        } else if (x[i] > W) {
          x[i] = 2 * W - x[i];
          vx[i] = -vx[i] * 0.55;
          vrot[i] *= -0.8;
        }
        if (y[i] < 0) {
          y[i] = -y[i];
          vy[i] = -vy[i] * 0.55;
          vrot[i] *= -0.8;
        } else if (y[i] > H) {
          y[i] = 2 * H - y[i];
          vy[i] = -vy[i] * 0.55;
          vrot[i] *= -0.8;
        }
      }
      i++;
    }
  }

  draw(layer) {
    const { x, y, vx, vy, life, max, s0, s1, i0, i1, c0, c1, frame, flags, rot, stretch, aspect, frames, refX, refY } = this;
    for (let i = 0; i < this.n; i++) {
      const t = 1 - life[i] / max[i];
      const size = s0[i] + (s1[i] - s0[i]) * t;
      let intensity = i0[i] + (i1[i] - i0[i]) * Math.pow(t, 1.5);
      const f = flags[i];
      if (f & FLICKER) intensity *= 0.55 + Math.random() * 0.45;
      const color = c0[i] === c1[i] ? c0[i] : mixHex(c0[i], c1[i], t);
      const fid = frame[i];
      let r = rot[i];
      let sx = (size * aspect[i]) / refX[fid];
      const sy = size / refY[fid];
      if (f & STRETCH) {
        const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        r = Math.atan2(vy[i], vx[i]);
        sx = (size * 2.2 + speed * stretch[i]) / refX[fid];
      }
      layer.draw(frames[fid], x[i], y[i], r, sx, sy, color, intensity);
    }
  }
}
