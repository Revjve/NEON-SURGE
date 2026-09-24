// GLSL ES 3.00 sources. Every program starts with `#version 300 es` so PixiJS compiles it
// as real WebGL2 GLSL (fwidth, texture(), uniform arrays, dynamic loops).

// ---------------------------------------------------------------------------------------
// Shared vertex shader for full-screen passes: a unit quad mesh scaled to its target.
export const QUAD_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

// ---------------------------------------------------------------------------------------
// Deep-space backdrop: midnight gradient, slow nebula, two parallax star layers.
export const BACKGROUND_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec2 uResolution;
uniform vec2 uCam;
uniform float uTime;
uniform vec4 uTint;
${HASH}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
vec3 stars(vec2 p, float density, float size, float seed) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = hash12(cell + seed);
  if (h > density) return vec3(0.0);
  vec2 pos = vec2(hash12(cell + 11.3 + seed), hash12(cell + 7.7 + seed)) * 0.7 + 0.15;
  float d = length(f - pos);
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + h * 9.0) + h * 91.0);
  float b = smoothstep(size, 0.0, d) * twinkle;
  vec3 tint = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.75, 0.95), hash12(cell + 3.1 + seed));
  return tint * b;
}
void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 c = (vUV - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  vec3 col = mix(vec3(0.014, 0.020, 0.062), vec3(0.002, 0.003, 0.013), smoothstep(0.05, 1.05, r));

  vec2 drift = vec2(uTime * 0.006, -uTime * 0.004);
  vec2 np = c * 1.7 + uCam * 0.00011 + drift;
  float n1 = fbm(np * 1.8);
  float n2 = fbm(np * 2.9 + vec2(5.2, 1.3));
  vec3 nebula = vec3(0.11, 0.025, 0.20) * smoothstep(0.42, 0.92, n1)
              + vec3(0.00, 0.07, 0.15) * smoothstep(0.48, 0.98, n2);
  col += nebula * 0.55;

  col += stars((c + uCam * 0.000045) * 95.0, 0.10, 0.09, 0.0) * 0.32;
  col += stars((c + uCam * 0.000095) * 48.0, 0.06, 0.075, 19.0) * 0.55;

  col += uTint.rgb * uTint.a * (0.35 + 0.65 * smoothstep(0.2, 1.1, r));
  finalColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------------------
// Spring-mass warp grid. Vertices are the simulated nodes; lines are drawn analytically in
// grid space so they stay razor sharp however hard the lattice is bent. Dynamic lights are
// evaluated per vertex (explosions, the ship, muzzle flashes) so the floor glows with them.
export const GRID_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aGrid;
in float aEnergy;
out vec2 vGrid;
out vec3 vLight;
out float vEnergy;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uLights[16];
uniform vec4 uLightColors[16];
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vGrid = aGrid;
  vEnergy = aEnergy;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    vec4 L = uLights[i];
    if (L.w <= 0.0) continue;
    vec2 d = aPosition - L.xy;
    float q = dot(d, d) / (L.z * L.z);
    float w = max(0.0, 1.0 - q);
    light += uLightColors[i].rgb * (L.w * w * w / (1.0 + 7.0 * q));
  }
  // Soft saturation: stacked lights tint the floor instead of blowing it out.
  float peak = max(light.r, max(light.g, light.b));
  vLight = light / (1.0 + peak * 0.6);
}`;

export const GRID_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vGrid;
in vec3 vLight;
in float vEnergy;
out vec4 finalColor;
uniform vec3 uLineColor;
uniform vec3 uHotColor;
uniform vec4 uParams; // x line gain, y minor gain, z floor wash, w global fade
float lineMask(vec2 g, float halfWidth, out float halo) {
  vec2 fw = max(fwidth(g), vec2(1e-5));
  vec2 dist = abs(fract(g + 0.5) - 0.5) / fw;
  float d = min(dist.x, dist.y);
  halo = exp(-d * d / (halfWidth * halfWidth * 18.0));
  return clamp(halfWidth + 0.5 - d, 0.0, 1.0);
}
void main() {
  float haloMajor;
  float major = lineMask(vGrid, 0.85, haloMajor);
  float haloMinor;
  float minor = lineMask(vGrid * 2.0, 0.55, haloMinor);
  float e = clamp(vEnergy, 0.0, 2.5);
  vec3 lineCol = mix(uLineColor, uHotColor, clamp(e * 0.55, 0.0, 1.0)) * (1.0 + e * 0.9);
  float lines = major + haloMajor * 0.25 + (minor * 0.22 + haloMinor * 0.04) * uParams.y;
  vec3 col = lineCol * lines * uParams.x;
  col += vLight * (major * 0.9 + haloMajor * 0.3 + minor * 0.16);
  col += vLight * uParams.z;
  finalColor = vec4(col * uParams.w, 0.0);
}`;

// ---------------------------------------------------------------------------------------
// HDR sprite batch (drives a ParticleContainer). The colour's alpha byte is repurposed as
// an intensity multiplier (0..8, quadratic) so sprites can emit far above 1.0 into the
// float scene target — that is what makes cores burn white and bloom properly.
export const GLOW_VERT = /* glsl */ `#version 300 es
in vec2 aVertex;
in vec2 aPosition;
in float aRotation;
in vec2 aUV;
in vec4 aColor;
out vec2 vUV;
out vec3 vColor;
uniform mat3 uTranslationMatrix;
uniform vec4 uColor;
void main() {
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 v = vec2(aVertex.x * c - aVertex.y * s, aVertex.x * s + aVertex.y * c) + aPosition;
  gl_Position = vec4((uTranslationMatrix * vec3(v, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  float intensity = aColor.a * aColor.a * 8.0;
  vColor = aColor.rgb * intensity * uColor.rgb * uColor.a;
}`;

export const GLOW_FRAG = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUV;
in vec3 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
void main() {
  vec4 t = texture(uTexture, vUV);
  finalColor = vec4(t.rgb * vColor, 0.0);
}`;

// ---------------------------------------------------------------------------------------
// Engine ribbon: white-hot core fading into a cyan -> violet plasma wake.
export const TRAIL_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in float aFade;
out vec2 vUV;
out float vFade;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vFade = aFade;
}`;

export const TRAIL_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in float vFade;
out vec4 finalColor;
uniform vec3 uHead;
uniform vec3 uTail;
uniform float uIntensity;
void main() {
  float t = clamp(vUV.x, 0.0, 1.0);
  float across = 1.0 - abs(vUV.y);
  float core = pow(across, 6.0);
  float halo = across * across;
  float fall = (1.0 - t) * (1.0 - t);
  vec3 tint = mix(uHead, uTail, smoothstep(0.0, 0.8, t));
  vec3 c = tint * halo * 1.2 + vec3(1.0) * core * (1.0 - t) * 1.6;
  finalColor = vec4(c * fall * vFade * uIntensity, 0.0);
}`;

// ---------------------------------------------------------------------------------------
// Bloom: 13-tap downsample chain (Jimenez / CoD:AW) with a Karis-weighted, soft-knee
// prefilter to kill fireflies, then a 9-tap tent upsample accumulated additively.
const DOWN_TAPS = /* glsl */ `
vec3 tap(vec2 o) { return texture(uSrc, vUV + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const PREFILTER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec4 uThreshold; // x threshold, y knee, z firefly clamp
${DOWN_TAPS}
void main() {
  vec3 a = tap(vec2(-2.0, -2.0)); vec3 b = tap(vec2(0.0, -2.0)); vec3 c = tap(vec2(2.0, -2.0));
  vec3 d = tap(vec2(-1.0, -1.0)); vec3 e = tap(vec2(1.0, -1.0));
  vec3 f = tap(vec2(-2.0, 0.0));  vec3 g = tap(vec2(0.0, 0.0));  vec3 h = tap(vec2(2.0, 0.0));
  vec3 i = tap(vec2(-1.0, 1.0));  vec3 j = tap(vec2(1.0, 1.0));
  vec3 k = tap(vec2(-2.0, 2.0));  vec3 l = tap(vec2(0.0, 2.0));  vec3 m = tap(vec2(2.0, 2.0));
  vec3 g0 = (d + e + i + j) * 0.25;
  vec3 g1 = (a + b + f + g) * 0.25;
  vec3 g2 = (b + c + g + h) * 0.25;
  vec3 g3 = (f + g + k + l) * 0.25;
  vec3 g4 = (g + h + l + m) * 0.25;
  float w0 = 0.5 / (1.0 + luma(g0));
  float w1 = 0.125 / (1.0 + luma(g1));
  float w2 = 0.125 / (1.0 + luma(g2));
  float w3 = 0.125 / (1.0 + luma(g3));
  float w4 = 0.125 / (1.0 + luma(g4));
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y);
  soft = soft * soft / (4.0 * uThreshold.y + 1e-4);
  col *= max(soft, br - uThreshold.x) / max(br, 1e-4);
  finalColor = vec4(min(col, vec3(uThreshold.z)), 1.0);
}`;

export const DOWNSAMPLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
${DOWN_TAPS}
void main() {
  vec3 a = tap(vec2(-2.0, -2.0)); vec3 b = tap(vec2(0.0, -2.0)); vec3 c = tap(vec2(2.0, -2.0));
  vec3 d = tap(vec2(-1.0, -1.0)); vec3 e = tap(vec2(1.0, -1.0));
  vec3 f = tap(vec2(-2.0, 0.0));  vec3 g = tap(vec2(0.0, 0.0));  vec3 h = tap(vec2(2.0, 0.0));
  vec3 i = tap(vec2(-1.0, 1.0));  vec3 j = tap(vec2(1.0, 1.0));
  vec3 k = tap(vec2(-2.0, 2.0));  vec3 l = tap(vec2(0.0, 2.0));  vec3 m = tap(vec2(2.0, 2.0));
  vec3 col = (d + e + i + j) * 0.125
           + (a + c + k + m) * 0.03125
           + (b + f + h + l) * 0.0625
           + g * 0.125;
  finalColor = vec4(col, 1.0);
}`;

export const UPSAMPLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
void main() {
  vec2 t = uTexel;
  vec3 s = texture(uSrc, vUV + vec2(-t.x, -t.y)).rgb
         + texture(uSrc, vUV + vec2(0.0, -t.y)).rgb * 2.0
         + texture(uSrc, vUV + vec2(t.x, -t.y)).rgb
         + texture(uSrc, vUV + vec2(-t.x, 0.0)).rgb * 2.0
         + texture(uSrc, vUV).rgb * 4.0
         + texture(uSrc, vUV + vec2(t.x, 0.0)).rgb * 2.0
         + texture(uSrc, vUV + vec2(-t.x, t.y)).rgb
         + texture(uSrc, vUV + vec2(0.0, t.y)).rgb * 2.0
         + texture(uSrc, vUV + vec2(t.x, t.y)).rgb;
  finalColor = vec4(s * (uWeight / 16.0), 1.0);
}`;

// ---------------------------------------------------------------------------------------
// Final composite: shockwave refraction, chromatic aberration, bloom, flash, filmic
// tonemap with highlight desaturation, vignette, danger pulse, scanlines, dithered grain.
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uShock[8];  // xy centre (uv), z radius (uv height units), w strength
uniform vec4 uFlash;     // rgb, amount
uniform vec4 uGrade;     // x bloom, y exposure, z chromatic, w vignette
uniform vec4 uFx;        // x scanlines, y grain, z danger, w desaturate
uniform vec4 uFx2;       // x fade to black, y pixel ratio
${HASH}
vec3 tonemap(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  c += vec3(max(peak - 1.0, 0.0) * 0.22);
  return 1.0 - exp(-c * 1.45);
}
void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = vUV;

  vec2 warp = vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 s = uShock[i];
    if (s.w == 0.0) continue;
    vec2 d = uv - s.xy;
    d.x *= aspect;
    float dist = length(d);
    float width = 0.028 + s.z * 0.10;
    float x = (dist - s.z) / width;
    float band = exp(-x * x);
    vec2 dir = d / max(dist, 1e-4);
    warp -= dir * vec2(1.0 / aspect, 1.0) * band * (1.0 - 0.6 * x) * s.w;
    ring += band * abs(s.w);
  }
  uv += warp;

  vec2 fromCenter = uv - 0.5;
  float ca = uGrade.z * (0.25 + 1.8 * dot(fromCenter, fromCenter)) + ring * 0.05;
  vec2 caOffset = fromCenter * ca;
  vec3 scene = vec3(texture(uScene, uv + caOffset).r,
                    texture(uScene, uv).g,
                    texture(uScene, uv - caOffset).b);
  vec3 bloom = vec3(texture(uBloom, uv + caOffset * 1.6).r,
                    texture(uBloom, uv).g,
                    texture(uBloom, uv - caOffset * 1.6).b);

  vec3 col = scene + bloom * uGrade.x;
  col += vec3(0.35, 0.55, 1.0) * ring * 0.06;
  col += uFlash.rgb * uFlash.a;
  col *= uGrade.y;
  col = tonemap(col);

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * vec3(1.05, 0.95, 1.0), uFx.w);

  float r = length(vUV - 0.5) * 1.4142;
  col *= mix(1.0, 1.0 - smoothstep(0.5, 1.12, r) * 0.9, uGrade.w);
  col += vec3(1.0, 0.04, 0.16) * smoothstep(0.55, 1.1, r) * uFx.z;

  float line = 0.5 + 0.5 * sin(gl_FragCoord.y / uFx2.y * 3.14159265);
  col *= 1.0 - uFx.x * line;
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 417.0) - 0.5) * uFx.y;
  col *= 1.0 - uFx2.x;
  finalColor = vec4(col, 1.0);
}`;
