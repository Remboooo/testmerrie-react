import { describe, expect, test } from 'vitest';
import { buildPass1FragmentShader, buildPass2FragmentShader, pass1Key, pass2Key, VERTEX_SHADER_SOURCE } from './shaders';

describe('buildPass1FragmentShader', () => {
  test('includes no effect defines when everything is disabled', () => {
    const src = buildPass1FragmentShader({ chroma: false, bulge: false });
    expect(src).not.toMatch(/#define EFFECT_/);
  });

  test('includes a define only for each enabled effect', () => {
    const src = buildPass1FragmentShader({ chroma: true, bulge: true });
    expect(src).toContain('#define EFFECT_CHROMA');
    expect(src).toContain('#define EFFECT_BULGE');
  });

  test('bulge normalizes the warp by its corner-case value, so sampled uv never leaves [0,1]', () => {
    const src = buildPass1FragmentShader({ chroma: false, bulge: true });
    expect(src).toContain('maxWarp = 1.0 + 0.5 * (u_bulgeAmount * 0.6)');
  });

  test('chroma samples using uv, which bulge reassigns above it, so it reads the warped position', () => {
    const src = buildPass1FragmentShader({ chroma: true, bulge: true });
    expect(src.indexOf('uv = 0.5 + (centered * warp)')).toBeLessThan(src.indexOf('#ifdef EFFECT_CHROMA'));
  });

  test('chroma blurs each channel, with a fraction of the radial shift rather than a fixed/texel-based radius', () => {
    const src = buildPass1FragmentShader({ chroma: true, bulge: false });
    expect(src).toContain('blur = off * 1.5');
    // No resolution or texel-size term anywhere in pass 1 -- the blur (like
    // the shift) is a plain fraction of uv space, so it stays the same size
    // relative to the frame no matter what resolution pass 1 itself renders
    // at (which varies with source/viewport size) or how big the viewport is.
    expect(src).not.toContain('u_resolution');
  });
});

describe('pass1Key', () => {
  test('is stable and order-independent, and differs when the enabled set differs', () => {
    expect(pass1Key({ chroma: true, bulge: false })).toBe(pass1Key({ bulge: false, chroma: true }));
    expect(pass1Key({ chroma: true, bulge: false })).not.toBe(pass1Key({ chroma: true, bulge: true }));
    expect(pass1Key({ chroma: false, bulge: false })).toBe('');
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
