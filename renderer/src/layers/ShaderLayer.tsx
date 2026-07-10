import {useEffect, useRef} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
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

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col;
  if (uKind == 0) col = nebula(uv, uTime);
  else if (uKind == 1) col = waves(uv, uTime);
  else col = grid(uv, uTime);
  // gentle vignette so foreground content pops
  vec2 c = uv - 0.5;
  col *= 1.0 - 0.55 * dot(c, c);
  gl_FragColor = vec4(col, 1.0);
}
`;

const KIND_INDEX: Record<string, number> = {nebula: 0, waves: 1, grid: 2};

type GLState = {
  gl: WebGLRenderingContext;
  uTime: WebGLUniformLocation;
  uRes: WebGLUniformLocation;
  uKind: WebGLUniformLocation;
  uBase: WebGLUniformLocation;
  uAccentA: WebGLUniformLocation;
  uAccentB: WebGLUniformLocation;
};

export const ShaderLayer: React.FC<{kind: 'nebula' | 'waves' | 'grid'}> = ({kind}) => {
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
    };
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.gl.viewport(0, 0, w, h);
    s.gl.uniform1f(s.uTime, frame / fps);
    s.gl.uniform2f(s.uRes, w, h);
    s.gl.uniform1i(s.uKind, KIND_INDEX[kind] ?? 0);
    s.gl.uniform3fv(s.uBase, hexToRgb(palette.bg));
    s.gl.uniform3fv(s.uAccentA, hexToRgb(palette.accent));
    s.gl.uniform3fv(s.uAccentB, hexToRgb(palette.accent2));
    s.gl.drawArrays(s.gl.TRIANGLES, 0, 3);
  }, [frame, fps, kind, w, h, palette]);

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
