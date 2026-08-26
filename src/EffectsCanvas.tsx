import { useEffect, useRef } from 'react';
import { buildFragmentShader, effectFlagsKey, ShaderEffectFlags, VERTEX_SHADER_SOURCE } from './webgl/shaders';

export type EffectAmounts = {
  chroma: number;
  grain: number;
  bulge: number;
  scanlines: number;
};

export type EffectsCanvasStatus = 'active' | 'context-lost';

export type EffectsCanvasProps = {
  // Whether this component should be running at all (the caller only mounts
  // it once WebGL is the chosen+available renderer).
  active: boolean;
  // Whether the underlying video is actually playing right now — the render
  // loop pauses otherwise (idle/paused/error state, or an idle-loop tab in
  // the background) so a static or absent frame doesn't burn GPU/CPU forever.
  playing: boolean;
  effects: ShaderEffectFlags;
  amounts: EffectAmounts;
  onStatusChange: (status: EffectsCanvasStatus) => void;
};

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${info}`);
  }
  return shader;
}

function linkProgram(gl: WebGLRenderingContext, flags: ShaderEffectFlags): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, buildFragmentShader(flags));
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${info}`);
  }
  return program;
}

// Imperative WebGL wrapper, in the same spirit as OvenPlayer.tsx: React just
// owns the <canvas> element and prop refs, everything else (GL context,
// compiled programs, the render loop) lives in refs and is driven by effects.
export default function EffectsCanvas({ active, playing, effects, amounts, onStatusChange }: EffectsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const positionBufferRef = useRef<WebGLBuffer | null>(null);
  const programCacheRef = useRef<Map<string, WebGLProgram>>(new Map());
  const currentProgramRef = useRef<WebGLProgram | null>(null);
  const rafRef = useRef<number | null>(null);
  const lostRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(performance.now());

  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const amountsRef = useRef(amounts);
  amountsRef.current = amounts;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Set up (and tear down) the GL context once per mount — the caller only
  // mounts this component while WebGL is the active renderer, so mount ===
  // "start using WebGL", unmount === "stop".
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      onStatusChangeRef.current('context-lost');
      return;
    }
    glRef.current = gl;
    lostRef.current = false;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    textureRef.current = texture;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    positionBufferRef.current = positionBuffer;

    programCacheRef.current.clear();
    currentProgramRef.current = null;

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      lostRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      onStatusChangeRef.current('context-lost');
    };
    const handleContextRestored = () => {
      // Programs/textures/buffers from the lost context are gone; the
      // simplest correct recovery is to remount this whole effect.
      lostRef.current = false;
      programCacheRef.current.clear();
      currentProgramRef.current = null;
      onStatusChangeRef.current('active');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    onStatusChangeRef.current('active');

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Explicitly free the GPU-side context rather than waiting on GC.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      glRef.current = null;
      programCacheRef.current.clear();
    };
  }, [active]);

  // The render loop itself: started/stopped by `playing` (and by context
  // loss/restore inside the effect above). Flags/amounts are read from refs
  // each frame so toggling a checkbox or dragging a slider never needs to
  // restart the loop.
  useEffect(() => {
    const gl = glRef.current;
    const canvas = canvasRef.current;
    if (!active || !playing || !gl || !canvas || lostRef.current) return;

    const renderFrame = () => {
      rafRef.current = requestAnimationFrame(renderFrame);
      const video = document.querySelector<HTMLVideoElement>('.ovenplayer video');
      if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;

      const flags = effectsRef.current;
      const key = effectFlagsKey(flags);
      let program = programCacheRef.current.get(key);
      if (!program) {
        program = linkProgram(gl, flags);
        programCacheRef.current.set(key, program);
      }
      currentProgramRef.current = program;

      const dpr = window.devicePixelRatio || 1;
      const displayWidth = Math.round(canvas.clientWidth * dpr);
      const displayHeight = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);

      gl.bindTexture(gl.TEXTURE_2D, textureRef.current);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } catch {
        // A frame can occasionally fail to upload (e.g. mid-seek); skip it.
        return;
      }

      gl.useProgram(program);
      const positionLoc = gl.getAttribLocation(program, 'a_position');
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBufferRef.current);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      const amounts = amountsRef.current;
      gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), (performance.now() - startTimeRef.current) / 1000);
      gl.uniform1f(gl.getUniformLocation(program, 'u_chromaAmount'), amounts.chroma / 100);
      gl.uniform1f(gl.getUniformLocation(program, 'u_grainAmount'), amounts.grain / 100);
      gl.uniform1f(gl.getUniformLocation(program, 'u_bulgeAmount'), amounts.bulge / 100);
      gl.uniform1f(gl.getUniformLocation(program, 'u_scanlineAmount'), amounts.scanlines / 100);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    rafRef.current = requestAnimationFrame(renderFrame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // effects/amounts intentionally excluded: read live via refs above so a
    // toggle/slider change doesn't tear down and restart the rAF loop.
  }, [active, playing]);

  return <canvas className="effects-canvas" ref={canvasRef} />;
}
