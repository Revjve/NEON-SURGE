import { autoDetectRenderer, Container, Mesh, MeshGeometry, Shader, RenderTexture } from '../lib/pixi.js';
import { QUAD_VERT, PREFILTER_FRAG, DOWNSAMPLE_FRAG, UPSAMPLE_FRAG, COMPOSITE_FRAG } from './shaders.js';

export const MAX_SHOCKS = 8;
const MAX_MIPS = 7;
const CLEAR = [0, 0, 0, 0];

export function createQuadGeometry() {
  return new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

/** One full-screen shader pass: a unit quad scaled to its render target. */
class Pass {
  constructor(geometry, fragment, name, resources, blendMode = 'normal') {
    this.shader = Shader.from({ gl: { vertex: QUAD_VERT, fragment, name }, resources });
    this.mesh = new Mesh({ geometry, shader: this.shader });
    this.mesh.blendMode = blendMode;
    // Blend modes only apply to children, never to the root handed to render().
    this.root = new Container();
    this.root.addChild(this.mesh);
  }

  get uniforms() {
    return this.shader.resources.u.uniforms;
  }

  setSource(name, texture) {
    this.shader.resources[name] = texture.source;
  }

  run(renderer, target, width, height, clear = true) {
    this.mesh.scale.set(width, height);
    renderer.render({ container: this.root, target, clear, clearColor: CLEAR });
  }
}

/**
 * Owns the Pixi renderer and the HDR post-processing chain:
 *   scene (rgba16f) -> prefilter -> 13-tap downsample mips -> tent upsample (additive)
 *   -> composite (refraction, CA, bloom, tonemap, grading) -> canvas
 */
export class Pipeline {
  static async create(host) {
    const renderer = await autoDetectRenderer({
      preference: 'webgl',
      preferWebGLVersion: 2,
      antialias: false,
      powerPreference: 'high-performance',
      background: 0x000000,
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      resolution: 1,
      autoDensity: true,
      hello: false,
    });
    const gl = renderer.gl;
    if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      renderer.destroy();
      throw new Error('WebGL 2 is not available. Please use an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.');
    }
    host.appendChild(renderer.canvas);
    return new Pipeline(renderer);
  }

  constructor(renderer) {
    this.renderer = renderer;
    this.hdr = !!renderer.context.extensions.colorBufferFloat;
    this.format = this.hdr ? 'rgba16float' : 'rgba8unorm';
    this.quad = createQuadGeometry();

    /** Everything drawn into the HDR scene target lives under this container. */
    this.scene = new Container();

    this.sceneRT = this._makeTarget(64, 64);
    this.mips = [];
    this.mipCount = 0;
    this.maxMips = 6;

    const texel = () => ({ value: new Float32Array(2), type: 'vec2<f32>' });
    this.prefilter = new Pass(this.quad, PREFILTER_FRAG, 'bloom-prefilter', {
      uSrc: this.sceneRT.source,
      u: {
        uTexel: texel(),
        uThreshold: {
          value: new Float32Array(this.hdr ? [0.85, 0.55, 40, 0] : [0.5, 0.3, 1, 0]),
          type: 'vec4<f32>',
        },
      },
    });
    this.down = [];
    this.up = [];
    for (let i = 0; i < MAX_MIPS; i++) {
      this.down.push(new Pass(this.quad, DOWNSAMPLE_FRAG, 'bloom-down', { uSrc: this.sceneRT.source, u: { uTexel: texel() } }));
      this.up.push(new Pass(this.quad, UPSAMPLE_FRAG, 'bloom-up', {
        uSrc: this.sceneRT.source,
        u: { uTexel: texel(), uWeight: { value: 1, type: 'f32' } },
      }, 'add'));
    }

    this.composite = new Pass(this.quad, COMPOSITE_FRAG, 'composite', {
      uScene: this.sceneRT.source,
      uBloom: this.sceneRT.source,
      u: {
        uResolution: { value: new Float32Array(2), type: 'vec2<f32>' },
        uTime: { value: 0, type: 'f32' },
        uShock: { value: new Float32Array(MAX_SHOCKS * 4), type: 'vec4<f32>', size: MAX_SHOCKS },
        uFlash: { value: new Float32Array(4), type: 'vec4<f32>' },
        uGrade: { value: new Float32Array([0.5, 1, 0, 1]), type: 'vec4<f32>' },
        uFx: { value: new Float32Array(4), type: 'vec4<f32>' },
        uFx2: { value: new Float32Array([0, 1, 0, 0]), type: 'vec4<f32>' },
      },
    });

    /** Post-processing parameters, written by the game every frame. */
    this.post = {
      bloom: 1.6,
      exposure: 1,
      chromatic: 0.0015,
      vignette: 0.85,
      scanlines: 0.045,
      grain: 0.03,
      danger: 0,
      desaturate: 0,
      fade: 0,
      flash: [1, 1, 1, 0],
    };

    this.cssWidth = 1;
    this.cssHeight = 1;
    this.dpr = 1;
    this.width = 64; // scene target size in pixels
    this.height = 64;
  }

  _makeTarget(width, height) {
    return RenderTexture.create({
      width,
      height,
      resolution: 1,
      format: this.format,
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
      antialias: false,
    });
  }

  /**
   * @param cssWidth/cssHeight canvas size in CSS pixels
   * @param dpr device pixel ratio used for the canvas
   * @param renderScale scene resolution relative to the canvas (dynamic resolution)
   * @param bloomMips number of bloom mip levels
   */
  resize(cssWidth, cssHeight, dpr, renderScale, bloomMips) {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = dpr;
    this.renderer.resize(this.cssWidth, this.cssHeight, dpr);

    const w = Math.max(64, Math.round(this.cssWidth * dpr * renderScale));
    const h = Math.max(64, Math.round(this.cssHeight * dpr * renderScale));
    this.width = w;
    this.height = h;
    this.sceneRT.resize(w, h);

    const possible = Math.max(1, Math.floor(Math.log2(Math.min(w, h))) - 3);
    this.mipCount = Math.min(bloomMips, possible, MAX_MIPS);
    let mw = w;
    let mh = h;
    for (let i = 0; i < this.mipCount; i++) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      if (!this.mips[i]) this.mips[i] = this._makeTarget(mw, mh);
      else this.mips[i].resize(mw, mh);
    }

    // Wire sources + texel sizes for the active chain.
    this.prefilter.setSource('uSrc', this.sceneRT);
    this.prefilter.uniforms.uTexel.set([1 / w, 1 / h]);
    for (let i = 1; i < this.mipCount; i++) {
      const src = this.mips[i - 1];
      this.down[i].setSource('uSrc', src);
      this.down[i].uniforms.uTexel.set([1 / src.width, 1 / src.height]);
    }
    for (let i = 0; i < this.mipCount - 1; i++) {
      const src = this.mips[i + 1];
      this.up[i].setSource('uSrc', src);
      this.up[i].uniforms.uTexel.set([1 / src.width, 1 / src.height]);
    }
    this.composite.setSource('uScene', this.sceneRT);
    this.composite.setSource('uBloom', this.mips[0]);
    this.composite.uniforms.uResolution.set([this.cssWidth * dpr, this.cssHeight * dpr]);
    this.composite.uniforms.uFx2[1] = dpr;
  }

  /**
   * Render one frame.
   * @param time seconds (for grain / animated effects)
   * @param shocks Float32Array(MAX_SHOCKS * 4) of shockwaves in screen uv space
   */
  render(time, shocks) {
    const r = this.renderer;
    r.render({ container: this.scene, target: this.sceneRT, clear: true, clearColor: [0, 0, 0, 1] });

    // Bloom chain.
    const mips = this.mips;
    const n = this.mipCount;
    this.prefilter.run(r, mips[0], mips[0].width, mips[0].height, true);
    for (let i = 1; i < n; i++) this.down[i].run(r, mips[i], mips[i].width, mips[i].height, true);
    for (let i = n - 2; i >= 0; i--) this.up[i].run(r, mips[i], mips[i].width, mips[i].height, false);

    // Composite to the canvas.
    const p = this.post;
    const u = this.composite.uniforms;
    u.uTime = time % 1000;
    u.uShock.set(shocks);
    u.uFlash[0] = p.flash[0];
    u.uFlash[1] = p.flash[1];
    u.uFlash[2] = p.flash[2];
    u.uFlash[3] = p.flash[3];
    // The additive upsample sums every mip level; normalise so `bloom` is total energy.
    u.uGrade[0] = p.bloom / Math.max(1, n);
    u.uGrade[1] = p.exposure;
    u.uGrade[2] = p.chromatic;
    u.uGrade[3] = p.vignette;
    u.uFx[0] = p.scanlines;
    u.uFx[1] = p.grain;
    u.uFx[2] = p.danger;
    u.uFx[3] = p.desaturate;
    u.uFx2[0] = p.fade;
    this.composite.run(r, undefined, this.cssWidth, this.cssHeight, true);
  }
}
