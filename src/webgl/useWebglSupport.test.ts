import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useWebglSupport } from './useWebglSupport';

function mockGetContext(gl: Partial<WebGLRenderingContext> | null) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
    if (contextId !== 'webgl' && contextId !== 'experimental-webgl') return null;
    return gl;
  }) as typeof HTMLCanvasElement.prototype.getContext);
}

afterEach(() => vi.restoreAllMocks());

describe('useWebglSupport', () => {
  it('reports available when context + shader compile succeed', async () => {
    mockGetContext({
      FRAGMENT_SHADER: 1,
      COMPILE_STATUS: 2,
      createShader: () => ({} as WebGLShader),
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
    } as unknown as WebGLRenderingContext);

    const { result } = renderHook(() => useWebglSupport());
    await waitFor(() => expect(result.current).toBe('available'));
  });

  it('reports unavailable when no context can be created', async () => {
    mockGetContext(null);
    const { result } = renderHook(() => useWebglSupport());
    await waitFor(() => expect(result.current).toBe('unavailable'));
  });

  it('reports unavailable when getContext throws', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('no webgl here');
    });
    const { result } = renderHook(() => useWebglSupport());
    await waitFor(() => expect(result.current).toBe('unavailable'));
  });
});
