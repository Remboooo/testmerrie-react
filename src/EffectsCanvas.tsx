import { useEffect, useRef } from 'react';
import {
  buildPass1FragmentShader,
  buildPass2FragmentShader,
  pass1Key,
  pass2Key,
  ShaderCapabilities,
  ShaderEffectFlags,
  VERTEX_SHADER_SOURCE,
} from './webgl/shaders';

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

function linkProgram(gl: WebGLRenderingContext, fragmentSource: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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

function drawFullscreenTriangle(gl: WebGLRenderingContext, program: WebGLProgram, positionBuffer: WebGLBuffer) {
  gl.useProgram(program);
  const positionLoc = gl.getAttribLocation(program, 'a_position');
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function createRenderTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

// Imperative WebGL wrapper, in the same spirit as OvenPlayer.tsx: React just
// owns the <canvas> element and prop refs, everything else (GL context,
// compiled programs, the render loop) lives in refs and is driven by effects.
//
// Rendering is split into two passes so the expensive per-fragment math only
// runs where it actually helps:
//   Pass 1 (bulge warp + chroma) is fundamentally limited by the source
//   video's own resolution — sampling it at more fragments than that (or
//   more than the viewport can even show) adds render cost, not detail.
//   Pass 2 (scanlines + grain) is procedurally generated, not sourced from
//   the video texture, so it only looks right computed at full display
//   resolution — otherwise it's undersampled relative to what it's stretched
//   to and aliases.
export default function EffectsCanvas({ active, playing, effects, amounts, onStatusChange }: EffectsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const videoTextureRef = useRef<WebGLTexture | null>(null);
  const pass1FramebufferRef = useRef<WebGLFramebuffer | null>(null);
  const pass1TextureRef = useRef<WebGLTexture | null>(null);
  const pass1SizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const positionBufferRef = useRef<WebGLBuffer | null>(null);
  const pass1ProgramCacheRef = useRef<Map<string, WebGLProgram>>(new Map());
  const pass2ProgramCacheRef = useRef<Map<string, WebGLProgram>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lostRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(performance.now());
  const capsRef = useRef<ShaderCapabilities>({ derivatives: false });

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
    // Universally supported in practice, but gated on an explicit check
    // rather than assumed — used to band-limit the scanline pattern.
    capsRef.current = { derivatives: !!gl.getExtension('OES_standard_derivatives') };

    const videoTexture = createRenderTexture(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    videoTextureRef.current = videoTexture;

    pass1TextureRef.current = createRenderTexture(gl);
    pass1FramebufferRef.current = gl.createFramebuffer();
    pass1SizeRef.current = { width: 0, height: 0 };

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    positionBufferRef.current = positionBuffer;

    pass1ProgramCacheRef.current.clear();
    pass2ProgramCacheRef.current.clear();

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      lostRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      onStatusChangeRef.current('context-lost');
    };
    const handleContextRestored = () => {
      // Every GL object from the lost context is gone; the simplest correct
      // recovery is to remount this whole effect.
      lostRef.current = false;
      pass1ProgramCacheRef.current.clear();
      pass2ProgramCacheRef.current.clear();
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
      pass1ProgramCacheRef.current.clear();
      pass2ProgramCacheRef.current.clear();
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
      const amounts = amountsRef.current;
      const positionBuffer = positionBufferRef.current!;

      let pass1Program = pass1ProgramCacheRef.current.get(pass1Key(flags));
      if (!pass1Program) {
        pass1Program = linkProgram(gl, buildPass1FragmentShader(flags));
        pass1ProgramCacheRef.current.set(pass1Key(flags), pass1Program);
      }
      let pass2Program = pass2ProgramCacheRef.current.get(pass2Key(flags));
      if (!pass2Program) {
        pass2Program = linkProgram(gl, buildPass2FragmentShader(flags, capsRef.current));
        pass2ProgramCacheRef.current.set(pass2Key(flags), pass2Program);
      }

      // The canvas's *backing store* keeps the video's native aspect ratio
      // (not its CSS box's) — that's what gives it an intrinsic aspect ratio
      // for the "object-fit: contain/cover" CSS to actually act on, exactly
      // like the <video> element it's standing in for. Its *resolution* is
      // bumped to at least the display size when the source is lower-res, so
      // pass 2's procedural effects aren't undersampled relative to what
      // they're displayed at. Pass 1 gets the opposite treatment — capped at
      // whichever is *smaller* of native or display resolution, since its
      // work (the warp + chroma sampling) is fundamentally limited by the
      // source video's own detail and gains nothing from extra fragments,
      // whether that ceiling comes from the source or from a small viewport.
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.clientWidth * dpr;
      const displayHeight = canvas.clientHeight * dpr;
      const nativeWidth = video.videoWidth || displayWidth;
      const nativeHeight = video.videoHeight || displayHeight;
      const pass2Scale = Math.max(1, displayWidth / nativeWidth, displayHeight / nativeHeight);
      const pass1Scale = Math.min(1, displayWidth / nativeWidth, displayHeight / nativeHeight);
      const pass2Width = Math.round(nativeWidth * pass2Scale);
      const pass2Height = Math.round(nativeHeight * pass2Scale);
      const pass1Width = Math.max(1, Math.round(nativeWidth * pass1Scale));
      const pass1Height = Math.max(1, Math.round(nativeHeight * pass1Scale));

      if (canvas.width !== pass2Width || canvas.height !== pass2Height) {
        canvas.width = pass2Width;
        canvas.height = pass2Height;
      }
      if (pass1SizeRef.current.width !== pass1Width || pass1SizeRef.current.height !== pass1Height) {
        gl.bindTexture(gl.TEXTURE_2D, pass1TextureRef.current);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pass1Width, pass1Height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, pass1FramebufferRef.current);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pass1TextureRef.current, 0);
        pass1SizeRef.current = { width: pass1Width, height: pass1Height };
      }

      gl.bindTexture(gl.TEXTURE_2D, videoTextureRef.current);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } catch {
        // A frame can occasionally fail to upload (e.g. mid-seek); skip it.
        return;
      }

      // Pass 1: warp + chroma, video texture -> pass1 texture, at pass1 res.
      gl.bindFramebuffer(gl.FRAMEBUFFER, pass1FramebufferRef.current);
      gl.viewport(0, 0, pass1Width, pass1Height);
      gl.bindTexture(gl.TEXTURE_2D, videoTextureRef.current);
      gl.uniform1i(gl.getUniformLocation(pass1Program, 'u_texture'), 0);
      gl.uniform1f(gl.getUniformLocation(pass1Program, 'u_chromaAmount'), amounts.chroma / 100);
      gl.uniform1f(gl.getUniformLocation(pass1Program, 'u_bulgeAmount'), amounts.bulge / 100);
      drawFullscreenTriangle(gl, pass1Program, positionBuffer);

      // Pass 2: scanlines + grain, pass1 texture -> canvas, at display res.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, pass1TextureRef.current);
      gl.uniform1i(gl.getUniformLocation(pass2Program, 'u_texture'), 0);
      gl.uniform1f(gl.getUniformLocation(pass2Program, 'u_time'), (performance.now() - startTimeRef.current) / 1000);
      // Logical/CSS pixels (not canvas.width/height, which tracks source
      // resolution) so scanline pitch matches the SVG fallback's fixed
      // 4-CSS-pixel period regardless of source resolution or DPR.
      gl.uniform2f(gl.getUniformLocation(pass2Program, 'u_resolution'), canvas.clientWidth, canvas.clientHeight);
      gl.uniform1f(gl.getUniformLocation(pass2Program, 'u_grainAmount'), amounts.grain / 100);
      gl.uniform1f(gl.getUniformLocation(pass2Program, 'u_bulgeAmount'), amounts.bulge / 100);
      gl.uniform1f(gl.getUniformLocation(pass2Program, 'u_scanlineAmount'), amounts.scanlines / 100);
      drawFullscreenTriangle(gl, pass2Program, positionBuffer);
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
