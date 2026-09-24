import { Geometry, Buffer, BufferUsage, Mesh, Shader } from '../lib/pixi.js';
import { TRAIL_VERT, TRAIL_FRAG } from './shaders.js';

/**
 * Plasma ribbon that follows a moving point: a triangle strip rebuilt every frame from a
 * short position history, tapering and cooling from a white-hot head to a violet tail.
 */
export class Trail {
  constructor({ points = 42, width = 16, lifetime = 0.42, head = [0.45, 0.95, 1.0], tail = [0.55, 0.2, 1.0] } = {}) {
    this.max = points;
    this.width = width;
    this.lifetime = lifetime;
    this.hx = new Float32Array(points);
    this.hy = new Float32Array(points);
    this.ht = new Float32Array(points);
    this.hw = new Float32Array(points);
    this.count = 0;
    this.time = 0;

    this.positions = new Float32Array(points * 4);
    this.uvs = new Float32Array(points * 4);
    this.fade = new Float32Array(points * 2);
    const indices = new Uint32Array((points - 1) * 6);
    for (let i = 0, k = 0; i < points - 1; i++) {
      const a = i * 2;
      indices[k++] = a;
      indices[k++] = a + 1;
      indices[k++] = a + 2;
      indices[k++] = a + 1;
      indices[k++] = a + 3;
      indices[k++] = a + 2;
    }
    this.posBuffer = new Buffer({ data: this.positions, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.uvBuffer = new Buffer({ data: this.uvs, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.fadeBuffer = new Buffer({ data: this.fade, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.posBuffer, format: 'float32x2' },
        aUV: { buffer: this.uvBuffer, format: 'float32x2' },
        aFade: { buffer: this.fadeBuffer, format: 'float32' },
      },
      indexBuffer: indices,
    });
    this.shader = Shader.from({
      gl: { vertex: TRAIL_VERT, fragment: TRAIL_FRAG, name: 'trail' },
      resources: {
        u: {
          uHead: { value: new Float32Array(head), type: 'vec3<f32>' },
          uTail: { value: new Float32Array(tail), type: 'vec3<f32>' },
          uIntensity: { value: 1.8, type: 'f32' },
        },
      },
    });
    this.uniforms = this.shader.resources.u.uniforms;
    this.mesh = new Mesh({ geometry, shader: this.shader });
    this.mesh.blendMode = 'add';
  }

  reset() {
    this.count = 0;
  }

  /** Record the emitter position; `strength` (0..1) scales the ribbon width at this point. */
  push(x, y, dt, strength) {
    this.time += dt;
    const { hx, hy, ht, hw } = this;
    const moved = this.count > 0 ? Math.hypot(x - hx[0], y - hy[0]) : Infinity;
    if (moved > 5 || this.count === 0) {
      const n = Math.min(this.count + 1, this.max);
      for (let i = n - 1; i > 0; i--) {
        hx[i] = hx[i - 1];
        hy[i] = hy[i - 1];
        ht[i] = ht[i - 1];
        hw[i] = hw[i - 1];
      }
      this.count = n;
    }
    hx[0] = x;
    hy[0] = y;
    ht[0] = this.time;
    hw[0] = strength;
    while (this.count > 1 && this.time - ht[this.count - 1] > this.lifetime) this.count--;
  }

  rebuild(intensity = 1) {
    const { hx, hy, ht, hw, positions, uvs, fade, max } = this;
    const n = this.count;
    this.uniforms.uIntensity = intensity;
    for (let i = 0; i < max; i++) {
      const j = Math.min(i, Math.max(0, n - 1));
      let nx = 0;
      let ny = 0;
      if (n > 1) {
        const a = Math.max(0, j - 1);
        const b = Math.min(n - 1, j + 1);
        const tx = hx[a] - hx[b];
        const ty = hy[a] - hy[b];
        const tl = Math.hypot(tx, ty) || 1;
        nx = -ty / tl;
        ny = tx / tl;
      }
      const age = n > 0 ? Math.min(1, (this.time - ht[j]) / this.lifetime) : 1;
      const t = n > 1 ? Math.max(age, j / (n - 1) * 0.35) : 1;
      const w = this.width * (1 - t) ** 0.7 * (0.35 + 0.65 * hw[j]) * (i < n ? 1 : 0);
      const o = i * 4;
      positions[o] = hx[j] + nx * w;
      positions[o + 1] = hy[j] + ny * w;
      positions[o + 2] = hx[j] - nx * w;
      positions[o + 3] = hy[j] - ny * w;
      uvs[o] = t;
      uvs[o + 1] = 1;
      uvs[o + 2] = t;
      uvs[o + 3] = -1;
      const f = i < n ? 0.25 + 0.75 * hw[j] : 0;
      fade[i * 2] = f;
      fade[i * 2 + 1] = f;
    }
    this.posBuffer.update();
    this.uvBuffer.update();
    this.fadeBuffer.update();
  }
}
