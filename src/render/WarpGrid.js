import { Geometry, Buffer, BufferUsage, Mesh, Shader } from '../lib/pixi.js';
import { GRID_VERT, GRID_FRAG } from './shaders.js';
import { ARENA } from '../config.js';

export const MAX_LIGHTS = 16;
const STEP = 1 / 60;
const STIFFNESS = 0.28;
const SPRING_DAMPING = 0.06;
const ANCHOR_K = 0.012;
const ANCHOR_D = 0.03;
const NODE_DAMPING = 0.975;

/**
 * Geometry-Wars style spring-mass lattice. Nodes sit on every grid intersection and are
 * tied to their neighbours with tension springs (the outer ring is pinned), so impulses
 * ripple across the floor like a drum skin. Rendering happens on the GPU as a deformed
 * mesh; lines are resolved analytically in the fragment shader.
 */
export class WarpGrid {
  constructor(spacing = 60, extend = 4) {
    this.spacing = spacing;
    const cellsX = Math.round(ARENA.w / spacing) + extend * 2;
    const cellsY = Math.round(ARENA.h / spacing) + extend * 2;
    const cols = (this.cols = cellsX + 1);
    const rows = (this.rows = cellsY + 1);
    this.ox = -extend * spacing;
    this.oy = -extend * spacing;
    const n = (this.n = cols * rows);

    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.ax = new Float32Array(n);
    this.ay = new Float32Array(n);
    this.az = new Float32Array(n);
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    this.inv = new Float32Array(n);
    this.damp = new Float32Array(n).fill(NODE_DAMPING);
    this.heat = new Float32Array(n);

    const gridCoords = new Float32Array(n * 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        this.rx[i] = this.x[i] = this.ox + c * spacing;
        this.ry[i] = this.y[i] = this.oy + r * spacing;
        this.inv[i] = r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? 0 : 1;
        gridCoords[i * 2] = c - extend;
        gridCoords[i * 2 + 1] = r - extend;
      }
    }

    const indices = new Uint32Array(cellsX * cellsY * 6);
    let k = 0;
    for (let r = 0; r < cellsY; r++) {
      for (let c = 0; c < cellsX; c++) {
        const i = r * cols + c;
        indices[k++] = i;
        indices[k++] = i + 1;
        indices[k++] = i + cols + 1;
        indices[k++] = i;
        indices[k++] = i + cols + 1;
        indices[k++] = i + cols;
      }
    }

    this.positions = new Float32Array(n * 2);
    this.energy = new Float32Array(n);
    this.posBuffer = new Buffer({ data: this.positions, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.energyBuffer = new Buffer({ data: this.energy, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.posBuffer, format: 'float32x2' },
        aGrid: { buffer: new Buffer({ data: gridCoords, usage: BufferUsage.VERTEX }), format: 'float32x2' },
        aEnergy: { buffer: this.energyBuffer, format: 'float32' },
      },
      indexBuffer: indices,
    });

    this.lights = new Float32Array(MAX_LIGHTS * 4);
    this.lightColors = new Float32Array(MAX_LIGHTS * 4);
    this.shader = Shader.from({
      gl: { vertex: GRID_VERT, fragment: GRID_FRAG, name: 'warp-grid' },
      resources: {
        u: {
          uLights: { value: this.lights, type: 'vec4<f32>', size: MAX_LIGHTS },
          uLightColors: { value: this.lightColors, type: 'vec4<f32>', size: MAX_LIGHTS },
          uLineColor: { value: new Float32Array([0.03, 0.055, 0.23]), type: 'vec3<f32>' },
          uHotColor: { value: new Float32Array([0.25, 0.68, 1.0]), type: 'vec3<f32>' },
          uParams: { value: new Float32Array([1, 1, 0.04, 1]), type: 'vec4<f32>' },
        },
      },
    });
    this.params = this.shader.resources.u.uniforms.uParams;
    this.mesh = new Mesh({ geometry, shader: this.shader });
    this.mesh.blendMode = 'add';
    this.accumulator = 0;
    this.updateMesh(ARENA.w / 2, ARENA.h / 2);
  }

  // --- Forces -------------------------------------------------------------------------

  _range(px, py, radius) {
    const s = this.spacing;
    const c0 = Math.max(1, Math.floor((px - radius - this.ox) / s));
    const c1 = Math.min(this.cols - 2, Math.ceil((px + radius - this.ox) / s));
    const r0 = Math.max(1, Math.floor((py - radius - this.oy) / s));
    const r1 = Math.min(this.rows - 2, Math.ceil((py + radius - this.oy) / s));
    return [c0, c1, r0, r1];
  }

  /** Radial blast. Positive force pushes outward (and toward the viewer). */
  explode(px, py, force, radius, heat = 0) {
    const [c0, c1, r0, r1] = this._range(px, py, radius);
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const dx = this.x[i] - px;
        const dy = this.y[i] - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const d = Math.sqrt(d2) + 0.001;
        const fall = 1 - d / radius;
        const f = force * fall * fall;
        this.ax[i] += (dx / d) * f;
        this.ay[i] += (dy / d) * f;
        this.az[i] += f * 0.8;
        this.damp[i] = Math.min(this.damp[i], 0.94);
        if (heat > 0) this.heat[i] = Math.max(this.heat[i], heat * fall);
      }
    }
  }

  /** Pull toward a point (negative z: presses the lattice away from the viewer). */
  implode(px, py, force, radius) {
    const [c0, c1, r0, r1] = this._range(px, py, radius);
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const dx = px - this.x[i];
        const dy = py - this.y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const d = Math.sqrt(d2) + 0.001;
        const fall = 1 - d / radius;
        const f = force * fall;
        this.ax[i] += (dx / d) * f * Math.min(1, d / 40);
        this.ay[i] += (dy / d) * f * Math.min(1, d / 40);
        this.az[i] -= f * 0.9;
      }
    }
  }

  /** Directed shove (ship wake, bullets). (dirX, dirY) should be normalised. */
  push(px, py, dirX, dirY, force, radius) {
    const [c0, c1, r0, r1] = this._range(px, py, radius);
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const dx = this.x[i] - px;
        const dy = this.y[i] - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const fall = 1 - Math.sqrt(d2) / radius;
        const f = force * fall * fall;
        this.ax[i] += dirX * f;
        this.ay[i] += dirY * f;
      }
    }
  }

  // --- Simulation -----------------------------------------------------------------------

  _spring(a, b, restLength) {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const dz = z[b] - z[a];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d <= restLength) return; // tension springs: pull only
    const s = ((d - restLength) / d) * STIFFNESS;
    const fx = dx * s + (this.vx[b] - this.vx[a]) * SPRING_DAMPING;
    const fy = dy * s + (this.vy[b] - this.vy[a]) * SPRING_DAMPING;
    const fz = dz * s + (this.vz[b] - this.vz[a]) * SPRING_DAMPING;
    const ia = this.inv[a];
    const ib = this.inv[b];
    this.ax[a] += fx * ia;
    this.ay[a] += fy * ia;
    this.az[a] += fz * ia;
    this.ax[b] -= fx * ib;
    this.ay[b] -= fy * ib;
    this.az[b] -= fz * ib;
  }

  _step() {
    const { cols, rows, n } = this;
    const rest = this.spacing * 0.95;
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      for (let c = 0; c < cols - 1; c++) this._spring(base + c, base + c + 1, rest);
    }
    for (let i = 0; i < n - cols; i++) this._spring(i, i + cols, rest);

    const { x, y, z, vx, vy, vz, ax, ay, az, rx, ry, inv, damp } = this;
    for (let i = 0; i < n; i++) {
      if (inv[i] === 0) {
        ax[i] = ay[i] = az[i] = 0;
        continue;
      }
      ax[i] += (rx[i] - x[i]) * ANCHOR_K - vx[i] * ANCHOR_D;
      ay[i] += (ry[i] - y[i]) * ANCHOR_K - vy[i] * ANCHOR_D;
      az[i] += -z[i] * ANCHOR_K - vz[i] * ANCHOR_D;
      const d = damp[i];
      let nvx = (vx[i] + ax[i]) * d;
      let nvy = (vy[i] + ay[i]) * d;
      let nvz = (vz[i] + az[i]) * d;
      if (nvx * nvx + nvy * nvy + nvz * nvz < 1e-6) nvx = nvy = nvz = 0;
      vx[i] = nvx;
      vy[i] = nvy;
      vz[i] = nvz;
      x[i] += nvx;
      y[i] += nvy;
      z[i] += nvz;
      ax[i] = ay[i] = az[i] = 0;
      damp[i] = NODE_DAMPING;
    }
  }

  update(dt) {
    this.accumulator = Math.min(this.accumulator + dt, STEP * 4);
    while (this.accumulator >= STEP) {
      this._step();
      this.accumulator -= STEP;
    }
    const decay = Math.exp(-dt * 2.6);
    const heat = this.heat;
    for (let i = 0; i < this.n; i++) heat[i] *= decay;
  }

  /** Project nodes (subtle perspective from z) and upload to the GPU. */
  updateMesh(camX, camY) {
    const { x, y, z, rx, ry, heat, positions, energy } = this;
    const invSpan = 1 / (this.spacing * 0.6);
    for (let i = 0; i < this.n; i++) {
      const k = 1 + z[i] * 0.0006;
      positions[i * 2] = camX + (x[i] - camX) * k;
      positions[i * 2 + 1] = camY + (y[i] - camY) * k;
      const dx = x[i] - rx[i];
      const dy = y[i] - ry[i];
      // Soft-saturating: ripples glow, but a screen-wide quake doesn't blow the floor out.
      const disp = 1 - Math.exp(-Math.sqrt(dx * dx + dy * dy) * invSpan);
      const e = disp * 1.2 + Math.min(1, Math.abs(z[i]) * 0.01) * 0.5 + heat[i];
      energy[i] = e > 2.5 ? 2.5 : e;
    }
    this.posBuffer.update();
    this.energyBuffer.update();
  }

  /** lights: array of {x, y, radius, intensity, r, g, b}; the brightest MAX_LIGHTS win. */
  setLights(lights) {
    const L = this.lights;
    const C = this.lightColors;
    const count = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const o = i * 4;
      if (i < count) {
        const l = lights[i];
        L[o] = l.x;
        L[o + 1] = l.y;
        L[o + 2] = l.radius;
        L[o + 3] = l.intensity;
        C[o] = l.r;
        C[o + 1] = l.g;
        C[o + 2] = l.b;
      } else {
        L[o + 3] = 0;
      }
    }
  }

  reset() {
    this.x.set(this.rx);
    this.y.set(this.ry);
    this.z.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.vz.fill(0);
    this.heat.fill(0);
  }
}
