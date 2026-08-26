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
uniform float u_chromaAmount;
uniform float u_grainAmount;
uniform float u_bulgeAmount;
uniform float u_scanlineAmount;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = v_uv;
  float vignette = 1.0;

#ifdef EFFECT_BULGE
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  uv = uv + centered * r2 * (u_bulgeAmount * 0.6);
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
  float line = sin(uv.y * 800.0) * 0.5 + 0.5;
  color *= mix(1.0, line, u_scanlineAmount * 0.6);
#endif

#ifdef EFFECT_GRAIN
  float n = hash(v_uv * vec2(1920.0, 1080.0) + u_time);
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
