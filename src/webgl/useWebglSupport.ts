import { useEffect, useState } from 'react';

export type WebglSupport = 'checking' | 'available' | 'unavailable';

function probeWebglSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      return false;
    }
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!shader) {
      return false;
    }
    gl.shaderSource(shader, 'void main() { gl_FragColor = vec4(1.0); }');
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true;
  } catch {
    return false;
  }
}

// One-shot capability probe: can this browser/GPU create a WebGL context and
// compile a trivial shader at all. Runtime failures after that (context loss)
// are reported separately by EffectsCanvas, not by this hook.
export function useWebglSupport(): WebglSupport {
  const [support, setSupport] = useState<WebglSupport>('checking');

  useEffect(() => {
    setSupport(probeWebglSupport() ? 'available' : 'unavailable');
  }, []);

  return support;
}
