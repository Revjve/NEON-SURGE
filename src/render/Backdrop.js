import { Mesh, Shader } from '../lib/pixi.js';
import { QUAD_VERT, BACKGROUND_FRAG } from './shaders.js';

/** Full-screen deep-space backdrop, drawn first into the scene target. */
export class Backdrop {
  constructor(quadGeometry) {
    this.shader = Shader.from({
      gl: { vertex: QUAD_VERT, fragment: BACKGROUND_FRAG, name: 'backdrop' },
      resources: {
        u: {
          uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uCam: { value: new Float32Array(2), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uTint: { value: new Float32Array(4), type: 'vec4<f32>' },
        },
      },
    });
    this.uniforms = this.shader.resources.u.uniforms;
    this.mesh = new Mesh({ geometry: quadGeometry, shader: this.shader });
  }

  update(width, height, time, camX, camY, tint) {
    this.mesh.scale.set(width, height);
    const u = this.uniforms;
    u.uResolution[0] = width;
    u.uResolution[1] = height;
    u.uCam[0] = camX;
    u.uCam[1] = camY;
    u.uTime = time % 3600;
    if (tint) u.uTint.set(tint);
  }
}
