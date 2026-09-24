// PixiJS resolver.
//
// The web build (itch.io / any static host) loads the pinned PixiJS release from the
// jsDelivr CDN. If the CDN is unreachable (offline, blocked, corporate proxy) or we are
// running inside the Electron desktop build, the byte-identical copy bundled in /vendor
// is used instead, so the game always boots. The local copy uses a plain `.js` extension:
// every static host serves that as JavaScript, while `.mjs` is sometimes served as
// application/octet-stream, which browsers refuse to run as a module.

export const PIXI_VERSION = '8.21.0';

const CDN_URL = `https://cdn.jsdelivr.net/npm/pixi.js@${PIXI_VERSION}/dist/pixi.min.mjs`;
const LOCAL_URL = new URL('../../vendor/pixi.min.js', import.meta.url).href;
const CDN_TIMEOUT_MS = 8000;

const params = new URLSearchParams(location.search);
const isHttp = location.protocol === 'http:' || location.protocol === 'https:';
const isDesktop = typeof window !== 'undefined' && !!window.neonDesktop;
const preferLocal = isDesktop || !isHttp || params.has('offline');

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Where PixiJS was actually loaded from: 'cdn' | 'local'. */
export let pixiSource = 'none';

async function resolvePixi() {
  const sources = preferLocal ? [LOCAL_URL, CDN_URL] : [CDN_URL, LOCAL_URL];
  let lastError = null;
  for (const url of sources) {
    try {
      const mod = url === CDN_URL ? await withTimeout(import(url), CDN_TIMEOUT_MS) : await import(url);
      pixiSource = url === CDN_URL ? 'cdn' : 'local';
      return mod;
    } catch (err) {
      lastError = err;
      console.warn(`[neon-surge] PixiJS unavailable from ${url}:`, err);
    }
  }
  throw new Error(`Could not load PixiJS (${lastError?.message ?? 'unknown error'})`);
}

const PIXI = await resolvePixi();

export default PIXI;
export const {
  autoDetectRenderer,
  Container,
  Mesh,
  MeshGeometry,
  Geometry,
  Buffer,
  BufferUsage,
  Shader,
  GlProgram,
  Texture,
  TextureSource,
  CanvasSource,
  TextureStyle,
  RenderTexture,
  Rectangle,
  Matrix,
  Particle,
  ParticleContainer,
} = PIXI;
