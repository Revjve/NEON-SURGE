import { ParticleContainer, Particle, Shader, GlProgram, Texture, TextureStyle, Matrix } from '../lib/pixi.js';
import { GLOW_VERT, GLOW_FRAG } from './shaders.js';

function createGlowShader() {
  return new Shader({
    glProgram: GlProgram.from({ vertex: GLOW_VERT, fragment: GLOW_FRAG, name: 'glow-batch' }),
    resources: {
      // Both are swapped in by the ParticleContainer pipe right before drawing.
      uTexture: Texture.WHITE.source,
      uSampler: new TextureStyle({}),
      uniforms: {
        uTranslationMatrix: { value: new Matrix(), type: 'mat3x3<f32>' },
        uColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
        uRound: { value: 0, type: 'f32' },
        uResolution: { value: [0, 0], type: 'vec2<f32>' },
      },
    },
  });
}

/**
 * Immediate-mode additive HDR sprite batch built on PixiJS's ParticleContainer.
 * Call begin(), any number of draw() calls, then end() once per frame. All sprites share
 * the procedural atlas so the whole layer is a single draw call.
 */
export class GlowLayer {
  constructor(atlas) {
    this.atlas = atlas;
    this.container = new ParticleContainer({
      texture: atlas.texture,
      shader: createGlowShader(),
      roundPixels: false,
      dynamicProperties: { vertex: true, position: true, rotation: true, uvs: true, color: true },
    });
    this.container.blendMode = 'add';
    this.pool = [];
    this.count = 0;
    this.capacity = 20000;
  }

  begin() {
    this.count = 0;
  }

  /**
   * @param frame     atlas Texture
   * @param color     0xRRGGBB
   * @param intensity HDR multiplier, 0..8 (values > 1 bloom hard)
   */
  draw(frame, x, y, rotation, scaleX, scaleY, color, intensity, anchorX = 0.5, anchorY = 0.5) {
    if (intensity <= 0.003 || this.count >= this.capacity) return;
    let p = this.pool[this.count];
    if (!p) {
      p = new Particle({ texture: frame });
      this.pool.push(p);
    }
    p.texture = frame;
    p.x = x;
    p.y = y;
    p.rotation = rotation;
    p.scaleX = scaleX;
    p.scaleY = scaleY;
    p.anchorX = anchorX;
    p.anchorY = anchorY;
    const a = intensity >= 8 ? 255 : (Math.sqrt(intensity * 0.125) * 255 + 0.5) | 0;
    p.color = (((color >> 16) & 255) | (color & 0xff00) | ((color & 255) << 16) | (a << 24)) >>> 0;
    this.count++;
  }

  /** Draw a frame so that its reference radius covers `radius` world units. */
  sprite(name, x, y, rotation, radius, color, intensity) {
    const s = radius / this.atlas.ref[name];
    this.draw(this.atlas.frames[name], x, y, rotation, s, s, color, intensity);
  }

  /** A glowing line segment from (x1,y1) to (x2,y2) with the given half-thickness. */
  line(x1, y1, x2, y2, thickness, color, intensity) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.01) return;
    const frame = this.atlas.frames.beam;
    this.draw(frame, x1, y1, Math.atan2(dy, dx), length / frame.orig.width, thickness / 16, color, intensity, 0, 0.5);
  }

  end() {
    const kids = this.container.particleChildren;
    const n = this.count;
    kids.length = n;
    for (let i = 0; i < n; i++) kids[i] = this.pool[i];
  }
}
