// Small, allocation-free math helpers shared by every system.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp01((v - a) / (b - a));
export const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, invLerp(a0, a1, v));

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

export const len = (x, y) => Math.sqrt(x * x + y * y);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

// Easing ------------------------------------------------------------------------------
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInCubic = (t) => t * t * t;
export const easeOutQuart = (t) => 1 - (1 - t) ** 4;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export function easeOutBack(t, s = 1.70158) {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
export function easeOutElastic(t) {
  if (t <= 0 || t >= 1) return clamp01(t);
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

// Colour ------------------------------------------------------------------------------
export const hexR = (hex) => (hex >> 16) & 255;
export const hexG = (hex) => (hex >> 8) & 255;
export const hexB = (hex) => hex & 255;

export function mixHex(a, b, t) {
  const r = Math.round(lerp(hexR(a), hexR(b), t));
  const g = Math.round(lerp(hexG(a), hexG(b), t));
  const bl = Math.round(lerp(hexB(a), hexB(b), t));
  return (r << 16) | (g << 8) | bl;
}

export const hexToRgb01 = (hex) => [hexR(hex) / 255, hexG(hex) / 255, hexB(hex) / 255];

export function hexToCss(hex, alpha = 1) {
  return `rgba(${hexR(hex)}, ${hexG(hex)}, ${hexB(hex)}, ${alpha})`;
}

// Deterministic 1D gradient noise (for organic camera shake) --------------------------
const PERM = new Uint8Array(512);
const GRAD = new Float32Array(256);
{
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) GRAD[i] = rnd() * 2 - 1;
}

/** Smooth noise in roughly [-1, 1]. `seed` offsets the lattice so channels decorrelate. */
export function noise1(x, seed = 0) {
  const xi = Math.floor(x);
  const xf = x - xi;
  const i0 = (xi + seed * 57) & 255;
  const g0 = GRAD[PERM[i0]] * xf;
  const g1 = GRAD[PERM[i0 + 1]] * (xf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  return (g0 + (g1 - g0) * u) * 2;
}
