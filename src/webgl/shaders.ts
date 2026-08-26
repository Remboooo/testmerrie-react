// Fullscreen triangle: (-1,-1), (3,-1), (-1,3) covers the whole clip-space
// quad with a single triangle, no index buffer needed. Shared by both passes.
export const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export type ShaderEffectFlags = {
  chroma: boolean;
  grain: boolean;
  bulge: boolean;
  scanlines: boolean;
};

export type ShaderCapabilities = {
  // Whether fwidth()/dFdx()/dFdy() (OES_standard_derivatives) are available —
  // used to band-limit the scanline pattern against aliasing. Universally
  // supported in practice, but gated on an explicit JS-side extension check
  // rather than assumed.
  derivatives: boolean;
};

type Pass1Flags = Pick<ShaderEffectFlags, "chroma" | "bulge">;
type Pass2Flags = Pick<ShaderEffectFlags, "scanlines" | "grain" | "bulge">;

// ---- Pass 1: the warp + chroma sampling, rendered at (at most) the video's
// own native resolution — see EffectsCanvas for why. Bulge warps uv first so
// chroma samples the already-warped position.
const PASS1_BODY = `
precision mediump float;

varying vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_chromaAmount;
uniform float u_bulgeAmount;

void main() {
  vec2 uv = v_uv;
  float vignette = 1.0;

#ifdef EFFECT_BULGE
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  float warp = 1.0 + r2 * (u_bulgeAmount * 0.6);
  // r2 maxes out at 0.5, at the screen corners. Dividing the whole warp by
  // its value there guarantees every sampled uv stays inside [0,1] even at
  // the corners, so the image scales up to keep covering the viewport
  // instead of the corners clamping to a stretched/repeated edge pixel.
  float maxWarp = 1.0 + 0.5 * (u_bulgeAmount * 0.6);
  uv = 0.5 + (centered * warp) / maxWarp;
  vec2 edge = abs(uv - 0.5);
  vignette = 1.0 - smoothstep(0.45, 0.5, max(edge.x, edge.y)) * u_bulgeAmount;
#endif

#ifdef EFFECT_CHROMA
  // Shift + a soft per-channel blur along the same radial axis, mirroring
  // the SVG version's per-channel feGaussianBlur (green blurred far less
  // than the shifted red/blue channels there too) — a bare offset alone
  // reads as a hard double-image rather than an optical aberration.
  // Both are plain fractions of uv space (no resolution/texel-size term
  // anywhere here — pass 1 doesn't even have a resolution uniform), so the
  // blur stays the same size relative to the frame regardless of pass 1's
  // actual resolution (which varies with source/viewport size) or the
  // viewport size itself.
  vec2 dir = uv - 0.5;
  float off = u_chromaAmount * 0.02;
  float blur = off * 0.5;
  vec2 rUv = uv + dir * off;
  vec2 bUv = uv - dir * off;
  float r = (texture2D(u_texture, rUv - dir * blur).r + texture2D(u_texture, rUv).r * 2.0 + texture2D(u_texture, rUv + dir * blur).r) * 0.25;
  float g = (texture2D(u_texture, uv - dir * blur * 0.25).g + texture2D(u_texture, uv).g * 2.0 + texture2D(u_texture, uv + dir * blur * 0.25).g) * 0.25;
  float b = (texture2D(u_texture, bUv - dir * blur).b + texture2D(u_texture, bUv).b * 2.0 + texture2D(u_texture, bUv + dir * blur).b) * 0.25;
  vec3 color = vec3(r, g, b);
#else
  vec3 color = texture2D(u_texture, uv).rgb;
#endif

  gl_FragColor = vec4(color * vignette, 1.0);
}
`;

export function buildPass1FragmentShader(flags: Pass1Flags): string {
  const defines = [
    flags.bulge && "#define EFFECT_BULGE",
    flags.chroma && "#define EFFECT_CHROMA",
  ].filter(Boolean).join("\n");
  return `${defines}\n${PASS1_BODY}`;
}

// Stable cache key for pass 1's enabled effects, e.g. "bulge,chroma".
export function pass1Key(flags: Pass1Flags): string {
  return [flags.bulge && "bulge", flags.chroma && "chroma"].filter(Boolean).join(",");
}

// ---- Pass 2: everything that only looks right evaluated at full display
// resolution — scanlines and grain — composited over pass 1's output.
// Scanlines re-derive the same bulge warp purely to know where the curved
// raster lines fall (cheap: no texture fetch, just the uv math); the color
// itself already came out of pass 1 warped, so this doesn't warp it twice.
const PASS2_BODY = `
precision mediump float;

varying vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_grainAmount;
uniform float u_bulgeAmount;
uniform float u_scanlineAmount;

// Dave Hoskins' "hash without sin": fract()/dot()-based instead of
// sin()-based, because sin() of the large-ish arguments this needs (real
// pixel coordinates, running time) loses enough precision under mediump to
// turn animated noise into visible structure/banding on a lot of GPUs.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 color = texture2D(u_texture, v_uv).rgb;

#ifdef EFFECT_SCANLINES
  vec2 uv = v_uv;
#ifdef EFFECT_BULGE
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  float warp = 1.0 + r2 * (u_bulgeAmount * 0.6);
  float maxWarp = 1.0 + 0.5 * (u_bulgeAmount * 0.6);
  uv = 0.5 + (centered * warp) / maxWarp;
#endif
  // Mirrors the SVG fallback's CSS gradient: a thin dark band every 4
  // logical pixels that fades out within ~30% of the band, not a full-cycle
  // sine wash — reads as fine scanlines rather than fat stripes.
  float y = uv.y * u_resolution.y;
  float cell = mod(y, 4.0) / 4.0;
  float distToLine = min(cell, 1.0 - cell);
#ifdef HAS_DERIVATIVES
  // Band-limit the edge against the pattern's actual on-screen footprint
  // (fwidth), so it fades toward flat instead of aliasing wherever a pixel
  // covers more than a sliver of a period — chiefly near the bulge warp,
  // where neighbouring fragments' uv.y can diverge sharply. This also
  // restores the soft edge the SVG version got for free from its
  // feGaussianBlur, scaled to how much softening is actually needed instead
  // of a fixed amount.
  float aa = max(fwidth(y) / 4.0, 0.001);
  float darkness = (1.0 - smoothstep(0.3 - aa, 0.3 + aa, distToLine)) * 0.25;
#else
  float darkness = clamp(1.0 - distToLine / 0.3, 0.0, 1.0) * 0.25;
#endif
  color *= 1.0 - darkness * (u_scanlineAmount * 2.0);
#endif

#ifdef EFFECT_GRAIN
  // gl_FragCoord is real per-texel pixel coordinates at pass 2's (full
  // display) resolution, so grain stays crisp instead of being computed
  // coarse and smeared across several display pixels. Time is wrapped so
  // long idle-loop sessions don't grow the hash input large enough to lose
  // precision.
  float n = hash(gl_FragCoord.xy + mod(u_time, 1000.0) * 97.0);
  color += (n - 0.5) * (u_grainAmount * 0.4);
#endif

  gl_FragColor = vec4(color, 1.0);
}
`;

export function buildPass2FragmentShader(flags: Pass2Flags, caps: ShaderCapabilities = { derivatives: false }): string {
  const extension = caps.derivatives ? "#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIVATIVES\n" : "";
  const defines = [
    flags.scanlines && "#define EFFECT_SCANLINES",
    flags.grain && "#define EFFECT_GRAIN",
    // Only read (inside EFFECT_SCANLINES) when curving the raster lines with
    // the bulge; harmless to define whenever bulge is on regardless.
    flags.bulge && "#define EFFECT_BULGE",
  ].filter(Boolean).join("\n");
  return `${extension}${defines}\n${PASS2_BODY}`;
}

// Stable cache key for pass 2's enabled effects, e.g. "bulge,grain,scanlines".
export function pass2Key(flags: Pass2Flags): string {
  return [flags.bulge && "bulge", flags.grain && "grain", flags.scanlines && "scanlines"].filter(Boolean).join(",");
}
