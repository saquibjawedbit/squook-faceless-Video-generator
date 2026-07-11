import {useEffect, useRef} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ShaderIRLayer} from '../ir';
import {hexToRgb, useTheme} from '../theme';

// Ambient shader backgrounds. Rendered at half resolution (soft gradients
// don't need more) and driven by uTime = frame / fps, so output is
// deterministic frame-by-frame.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform int uKind;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

uniform vec3 BASE;    // theme background
uniform vec3 CYAN;    // theme accent
uniform vec3 INDIGO;  // theme secondary accent

vec3 nebula(vec2 uv, float t) {
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0) * 1.6;
  float n1 = fbm(p + t * 0.04 + vec2(0.0, 3.7));
  float n2 = fbm(p * 1.7 - t * 0.03 + vec2(5.2, 1.3));
  vec3 col = BASE;
  col += INDIGO * 0.16 * smoothstep(0.45, 0.85, n1);
  col += CYAN * 0.08 * smoothstep(0.55, 0.95, n2);
  col += CYAN * 0.03 * fbm(p * 3.0 + t * 0.06);
  return col;
}

vec3 waves(vec2 uv, float t) {
  vec3 col = BASE;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y = 0.25 + fi * 0.16
      + 0.05 * sin(uv.x * 4.0 + t * 0.35 + fi * 1.7)
      + 0.03 * sin(uv.x * 9.0 - t * 0.22 + fi * 3.1);
    float d = abs(uv.y - y);
    float glow = 0.0035 / (d * d + 0.004);
    vec3 tint = mix(INDIGO, CYAN, fi / 3.0);
    col += tint * glow * 0.045;
  }
  return col;
}

vec3 grid(vec2 uv, float t) {
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0) * 14.0;
  vec2 cell = fract(p) - 0.5;
  float d = length(cell);
  float dot_ = smoothstep(0.09, 0.02, d);
  // diagonal brightness wave traveling across the field
  float wave = 0.5 + 0.5 * sin((p.x + p.y) * 0.45 - t * 0.9);
  vec3 col = BASE + vec3(0.012);
  col += mix(INDIGO, CYAN, wave) * dot_ * (0.06 + 0.14 * wave);
  return col;
}

// Flowing northern-lights curtains — layered fbm bands rising from the floor.
vec3 aurora(vec2 uv, float t) {
  vec3 col = BASE;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x + 0.10 * sin(t * 0.20 + fi * 1.3);
    float band = fbm(vec2(x * 3.0 + fi * 2.4, uv.y * 1.5 - t * 0.16));
    float curtain = smoothstep(0.32, 0.92, band) * smoothstep(1.05, 0.15, uv.y);
    col += mix(INDIGO, CYAN, fi * 0.5) * curtain * 0.20;
  }
  return col;
}

// Soft drifting gradient-mesh blobs — a premium, out-of-focus bokeh wash.
vec3 mesh(vec2 uv, float t) {
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
  vec2 a = vec2(0.30 + 0.16 * sin(t * 0.23), 0.42 + 0.12 * cos(t * 0.19));
  vec2 b = vec2(0.72 + 0.13 * cos(t * 0.17), 0.60 + 0.15 * sin(t * 0.21));
  vec2 c = vec2(0.52 + 0.18 * sin(t * 0.13 + 2.0), 0.30 + 0.11 * cos(t * 0.27));
  vec3 col = BASE;
  col += CYAN   * 0.24 * smoothstep(0.55, 0.0, length(p - a));
  col += INDIGO * 0.22 * smoothstep(0.55, 0.0, length(p - b));
  col += CYAN   * 0.13 * smoothstep(0.48, 0.0, length(p - c));
  return col;
}

// Volumetric light rays fanning from an off-screen source near the top.
vec3 rays(vec2 uv, float t) {
  vec2 d = uv - vec2(0.5, 1.08);
  float ang = atan(d.x, -d.y);
  float r = length(d);
  float beams = 0.5 + 0.5 * sin(ang * 17.0 + sin(t * 0.2) * 2.0);
  beams *= 0.5 + 0.5 * sin(ang * 6.0 - t * 0.15);
  vec3 col = BASE;
  col += mix(INDIGO, CYAN, beams) * beams * smoothstep(1.35, 0.0, r) * 0.11;
  return col;
}

uniform float uIntensity; // scales the effect's deviation from the base bg

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col;
  if (uKind == 0) col = nebula(uv, uTime);
  else if (uKind == 1) col = waves(uv, uTime);
  else if (uKind == 2) col = grid(uv, uTime);
  else if (uKind == 3) col = aurora(uv, uTime);
  else if (uKind == 4) col = mesh(uv, uTime);
  else col = rays(uv, uTime);
  // A single global strength knob: scale how far the effect departs from BASE.
  col = BASE + (col - BASE) * uIntensity;
  // gentle vignette so foreground content pops
  vec2 c = uv - 0.5;
  col *= 1.0 - 0.55 * dot(c, c);
  gl_FragColor = vec4(col, 1.0);
}
`;

const KIND_INDEX: Record<string, number> = {nebula: 0, waves: 1, grid: 2, aurora: 3, mesh: 4, rays: 5};

type GLState = {
  gl: WebGLRenderingContext;
  uTime: WebGLUniformLocation;
  uRes: WebGLUniformLocation;
  uKind: WebGLUniformLocation;
  uBase: WebGLUniformLocation;
  uAccentA: WebGLUniformLocation;
  uAccentB: WebGLUniformLocation;
  uIntensity: WebGLUniformLocation;
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const hexOr = (v: string | undefined, fallback: string): string => (v && HEX.test(v) ? v : fallback);

export const ShaderLayer: React.FC<{layer: ShaderIRLayer}> = ({layer}) => {
  const {kind, speed, intensity, color_a, color_b} = layer;
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {palette} = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GLState | null>(null);

  const w = Math.round(width / 2);
  const h = Math.round(height / 2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stateRef.current) return;
    // preserveDrawingBuffer keeps the rendered frame in the buffer until the
    // headless screenshot is taken — without it the shader can capture black.
    const gl = canvas.getContext('webgl', {preserveDrawingBuffer: true});
    if (!gl) throw new Error('WebGL unavailable — check chromium GL renderer');

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    stateRef.current = {
      gl,
      uTime: gl.getUniformLocation(program, 'uTime')!,
      uRes: gl.getUniformLocation(program, 'uRes')!,
      uKind: gl.getUniformLocation(program, 'uKind')!,
      uBase: gl.getUniformLocation(program, 'BASE')!,
      uAccentA: gl.getUniformLocation(program, 'CYAN')!,
      uAccentB: gl.getUniformLocation(program, 'INDIGO')!,
      uIntensity: gl.getUniformLocation(program, 'uIntensity')!,
    };
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const spd = Number.isFinite(speed) ? Math.max(0, speed as number) : 1;
    const inten = Number.isFinite(intensity) ? Math.max(0, Math.min(3, intensity as number)) : 1;
    s.gl.viewport(0, 0, w, h);
    s.gl.uniform1f(s.uTime, (frame / fps) * spd);
    s.gl.uniform2f(s.uRes, w, h);
    s.gl.uniform1i(s.uKind, KIND_INDEX[kind] ?? 0);
    s.gl.uniform1f(s.uIntensity, inten);
    s.gl.uniform3fv(s.uBase, hexToRgb(palette.bg));
    s.gl.uniform3fv(s.uAccentA, hexToRgb(hexOr(color_a, palette.accent)));
    s.gl.uniform3fv(s.uAccentB, hexToRgb(hexOr(color_b, palette.accent2)));
    s.gl.drawArrays(s.gl.TRIANGLES, 0, 3);
  }, [frame, fps, kind, speed, intensity, color_a, color_b, w, h, palette]);

  return (
    <AbsoluteFill>
      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        style={{width: '100%', height: '100%'}}
      />
    </AbsoluteFill>
  );
};
