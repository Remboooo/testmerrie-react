import { describe, expect, test } from 'vitest';
import { buildFragmentShader, effectFlagsKey, VERTEX_SHADER_SOURCE, ShaderEffectFlags } from './shaders';

const NONE: ShaderEffectFlags = { chroma: false, grain: false, bulge: false, scanlines: false };

describe('buildFragmentShader', () => {
  test('includes no effect defines when everything is disabled', () => {
    const src = buildFragmentShader(NONE);
    expect(src).not.toMatch(/#define EFFECT_/);
  });

  test('includes a define only for each enabled effect', () => {
    const src = buildFragmentShader({ ...NONE, chroma: true, bulge: true });
    expect(src).toMatch(/#define EFFECT_CHROMA/);
    expect(src).toMatch(/#define EFFECT_BULGE/);
    expect(src).not.toMatch(/#define EFFECT_GRAIN/);
    expect(src).not.toMatch(/#define EFFECT_SCANLINES/);
  });

  test('all four effects enabled produces all four defines', () => {
    const src = buildFragmentShader({ chroma: true, grain: true, bulge: true, scanlines: true });
    for (const define of ['EFFECT_CHROMA', 'EFFECT_GRAIN', 'EFFECT_BULGE', 'EFFECT_SCANLINES']) {
      expect(src).toContain(`#define ${define}`);
    }
  });

  test('scanlines and chroma both read the (possibly bulge-warped) uv, not the raw varying', () => {
    const src = buildFragmentShader({ chroma: true, grain: false, bulge: true, scanlines: true });
    // Both effects must sample using `uv`, which bulge reassigns above them —
    // this is what makes scanlines curve with the bulge instead of staying straight.
    expect(src).toMatch(/uv = uv \+ centered/);
    expect(src.indexOf('uv = uv + centered')).toBeLessThan(src.indexOf('#ifdef EFFECT_CHROMA'));
    expect(src.indexOf('uv = uv + centered')).toBeLessThan(src.indexOf('#ifdef EFFECT_SCANLINES'));
  });
});

describe('effectFlagsKey', () => {
  test('is stable and order-independent across the flags object', () => {
    const a = effectFlagsKey({ chroma: true, scanlines: true, grain: false, bulge: false });
    const b = effectFlagsKey({ scanlines: true, bulge: false, chroma: true, grain: false });
    expect(a).toBe(b);
  });

  test('differs when the enabled set differs', () => {
    const a = effectFlagsKey({ chroma: true, grain: false, bulge: false, scanlines: false });
    const b = effectFlagsKey({ chroma: true, grain: true, bulge: false, scanlines: false });
    expect(a).not.toBe(b);
  });

  test('empty key for no effects', () => {
    expect(effectFlagsKey(NONE)).toBe('');
  });
});

test('vertex shader source is a stable fullscreen-triangle constant', () => {
  expect(VERTEX_SHADER_SOURCE).toContain('a_position');
  expect(VERTEX_SHADER_SOURCE).toContain('gl_Position');
});
