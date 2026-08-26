// Fullscreen triangle: (-1,-1), (3,-1), (-1,3) covers the whole clip-space
// quad with a single triangle, no index buffer needed.
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

const EFFECT_DEFINES: { key: keyof ShaderEffectFlags; define: string }[] = [
  { key: "bulge", define: "EFFECT_BULGE" },
  { key: "chroma", define: "EFFECT_CHROMA" },
  { key: "scanlines", define: "EFFECT_SCANLINES" },
  { key: "grain", define: "EFFECT_GRAIN" },
];

// Order here is the shader's execution order, not just a list of #defines:
// bulge warps uv first, chroma and scanlines both read that warped uv (so
// scanlines curve with the bulge instead of staying straight over it), grain
// is added last as a screen-space pass independent of uv distortion.
const FRAGMENT_SHADER_BODY = `
precision mediump float;

varying vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_chromaAmount;
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
  vec2 dir = uv - 0.5;
  float off = u_chromaAmount * 0.02;
  vec3 color = vec3(
    texture2D(u_texture, uv + dir * off).r,
    texture2D(u_texture, uv).g,
    texture2D(u_texture, uv - dir * off).b
  );
#else
  vec3 color = texture2D(u_texture, uv).rgb;
#endif

  color *= vignette;

#ifdef EFFECT_SCANLINES
  // Mirrors the SVG fallback's CSS gradient: a thin dark band every 4
  // logical pixels that fades out within ~30% of the band, not a full-cycle
  // sine wash — reads as fine scanlines rather than fat stripes.
  float cell = mod(uv.y * u_resolution.y, 4.0) / 4.0;
  float distToLine = min(cell, 1.0 - cell);
  float darkness = clamp(1.0 - distToLine / 0.3, 0.0, 1.0) * 0.25;
  color *= 1.0 - darkness * (u_scanlineAmount * 2.0);
#endif

#ifdef EFFECT_GRAIN
  // gl_FragCoord is real per-texel pixel coordinates (unlike a fixed
  // 1920x1080 guess against normalized uv, which patterns/moirés on any
  // other resolution or aspect ratio). Time is wrapped so long idle-loop
  // sessions don't grow the hash input large enough to lose precision.
  float n = hash(gl_FragCoord.xy + mod(u_time, 1000.0) * 97.0);
  color += (n - 0.5) * (u_grainAmount * 0.4);
#endif

  gl_FragColor = vec4(color, 1.0);
}
`;

// Compiles only the enabled effects into the shader (as #defines guarding
// #ifdef blocks) so a disabled effect costs nothing at runtime, and so a
// distinct combination of enabled effects gets its own program the caller can
// cache and reuse.
export function buildFragmentShader(flags: ShaderEffectFlags): string {
  const defines = EFFECT_DEFINES
    .filter(({ key }) => flags[key])
    .map(({ define }) => `#define ${define}`)
    .join("\n");
  return `${defines}\n${FRAGMENT_SHADER_BODY}`;
}

// Stable cache key for a set of enabled effects, e.g. "bulge,chroma".
export function effectFlagsKey(flags: ShaderEffectFlags): string {
  return EFFECT_DEFINES.filter(({ key }) => flags[key]).map(({ key }) => key).join(",");
}
