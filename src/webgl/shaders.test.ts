import { describe, expect, test } from 'vitest';
import { buildPass1FragmentShader, buildPass2FragmentShader, pass1Key, pass2Key, VERTEX_SHADER_SOURCE } from './shaders';

const P1_NONE = { chroma: false, bulge: false, glow: false };

describe('buildPass1FragmentShader', () => {
  test('includes no effect defines when everything is disabled', () => {
    const src = buildPass1FragmentShader(P1_NONE);
    expect(src).not.toMatch(/#define EFFECT_/);
  });

  test('includes a define only for each enabled effect', () => {
    const src = buildPass1FragmentShader({ ...P1_NONE, chroma: true, bulge: true });
    expect(src).toContain('#define EFFECT_CHROMA');
    expect(src).toContain('#define EFFECT_BULGE');
    expect(src).not.toContain('#define EFFECT_GLOW');
  });

  test('bulge normalizes the warp by its corner-case value, so sampled uv never leaves [0,1]', () => {
    const src = buildPass1FragmentShader({ ...P1_NONE, bulge: true });
    expect(src).toContain('maxWarp = 1.0 + 0.5 * (u_bulgeAmount * 0.6)');
  });

  test('chroma samples using uv, which bulge reassigns above it, so it reads the warped position', () => {
    const src = buildPass1FragmentShader({ ...P1_NONE, chroma: true, bulge: true });
    expect(src.indexOf('uv = 0.5 + (centered * warp)')).toBeLessThan(src.indexOf('#ifdef EFFECT_CHROMA'));
  });

  test('chroma alone (no Gloed) compiles no glow code at all -- pure shift, no blur', () => {
    const src = buildPass1FragmentShader({ ...P1_NONE, chroma: true });
    expect(src).not.toContain('#define EFFECT_GLOW');
  });

  test('glow\'s radial-vs-flat branch is chosen by whether chroma is also active', () => {
    // Both blurDir5 (radial) and blurFlat5 (flat) calls exist in the raw
    // template text either way -- it's the GLSL preprocessor, not this
    // function, that picks one via #ifdef EFFECT_CHROMA. What this function
    // controls is only whether EFFECT_CHROMA is defined alongside EFFECT_GLOW.
    const withChroma = buildPass1FragmentShader({ ...P1_NONE, chroma: true, glow: true });
    expect(withChroma).toContain('#define EFFECT_CHROMA');
    expect(withChroma).toContain('#define EFFECT_GLOW');

    const withoutChroma = buildPass1FragmentShader({ ...P1_NONE, glow: true });
    expect(withoutChroma).not.toContain('#define EFFECT_CHROMA');
    expect(withoutChroma).toContain('#define EFFECT_GLOW');
    // Flat path fills the kernel with H+V binomials (step = radius/2), not
    // the old single-ring cross.
    expect(withoutChroma).toContain('radius * 0.5');
  });

  test('no resolution/texel-size term anywhere in pass 1 -- Gloed stays sized relative to the frame', () => {
    const src = buildPass1FragmentShader({ ...P1_NONE, chroma: true, glow: true, bulge: true });
    expect(src).not.toContain('u_resolution');
  });
});

describe('pass1Key', () => {
  test('is stable and order-independent, and differs when the enabled set differs', () => {
    expect(pass1Key({ ...P1_NONE, chroma: true })).toBe(pass1Key({ ...P1_NONE, chroma: true }));
    expect(pass1Key({ ...P1_NONE, chroma: true })).not.toBe(pass1Key({ ...P1_NONE, chroma: true, bulge: true }));
    expect(pass1Key({ ...P1_NONE, chroma: true })).not.toBe(pass1Key({ ...P1_NONE, chroma: true, glow: true }));
    expect(pass1Key(P1_NONE)).toBe('');
  });
});

describe('buildPass2FragmentShader', () => {
  test('includes no effect defines when everything is disabled', () => {
    const src = buildPass2FragmentShader({ scanlines: false, grain: false, bulge: false });
    expect(src).not.toMatch(/#define EFFECT_/);
  });

  test('scanlines re-derive the bulge warp (for curving), independent of grain', () => {
    const src = buildPass2FragmentShader({ scanlines: true, grain: false, bulge: true });
    expect(src).toContain('#define EFFECT_SCANLINES');
    expect(src).toContain('#define EFFECT_BULGE');
    expect(src).not.toContain('#define EFFECT_GRAIN');
    // The warp recompute must be nested inside the scanlines block, not the
    // other way around — bulge shouldn't run unless scanlines needs it.
    expect(src.indexOf('#ifdef EFFECT_SCANLINES')).toBeLessThan(src.indexOf('#ifdef EFFECT_BULGE'));
  });

  test('enables the derivatives extension only when capable', () => {
    const withDerivatives = buildPass2FragmentShader({ scanlines: true, grain: false, bulge: false }, { derivatives: true });
    expect(withDerivatives).toContain('#extension GL_OES_standard_derivatives : enable');
    expect(withDerivatives).toContain('#define HAS_DERIVATIVES');

    const without = buildPass2FragmentShader({ scanlines: true, grain: false, bulge: false }, { derivatives: false });
    expect(without).not.toContain('#extension');
    expect(without).not.toContain('#define HAS_DERIVATIVES');

    const defaulted = buildPass2FragmentShader({ scanlines: true, grain: false, bulge: false });
    expect(defaulted).not.toContain('#extension');
  });
});

describe('pass2Key', () => {
  test('is stable and order-independent, and differs when the enabled set differs', () => {
    const a = pass2Key({ scanlines: true, grain: false, bulge: true });
    const b = pass2Key({ bulge: true, scanlines: true, grain: false });
    expect(a).toBe(b);
    expect(a).not.toBe(pass2Key({ scanlines: true, grain: true, bulge: true }));
    expect(pass2Key({ scanlines: false, grain: false, bulge: false })).toBe('');
  });
});

test('vertex shader source is a stable fullscreen-triangle constant', () => {
  expect(VERTEX_SHADER_SOURCE).toContain('a_position');
  expect(VERTEX_SHADER_SOURCE).toContain('gl_Position');
});
