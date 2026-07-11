import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MotionLayer as MotionLayerType, MotionShape} from '../ir';
import {useTheme} from '../theme';

// Deterministic interpreter for the generic vector-animation layer. The Director
// authors shapes + keyframes as DATA (no generated code); we interpolate each
// animated prop by frame and draw SVG primitives. Everything is defensive: a
// missing/NaN value falls back to a sane default so a malformed spec can never
// crash the render.

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

// easeInOutQuad — smooth, no dependency on Remotion's strict interpolate().
const ease = (p: number): number =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

// Value of `prop` at time t, interpolated across the keyframes that define it.
// Returns undefined when no keyframe touches it (caller uses the base value).
function track(shape: MotionShape, prop: string, t: number): number | undefined {
  const kfs = (shape.keyframes || [])
    .filter((k) => typeof (k as Record<string, unknown>)[prop] === 'number' && Number.isFinite(k.t))
    .sort((a, b) => a.t - b.t);
  if (!kfs.length) return undefined;
  const val = (k: (typeof kfs)[number]) => (k as Record<string, number>)[prop];
  if (t <= kfs[0].t) return val(kfs[0]);
  if (t >= kfs[kfs.length - 1].t) return val(kfs[kfs.length - 1]);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const p = span > 0 ? ease((t - a.t) / span) : 0;
      return val(a) + (val(b) - val(a)) * p;
    }
  }
  return val(kfs[kfs.length - 1]);
}

export const MotionLayer: React.FC<{layer: MotionLayerType; fps: number}> = ({layer, fps}) => {
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const {palette, font} = useTheme();
  const t = frame / fps;
  const minDim = Math.min(W, H);

  const color = (v: string | undefined, fallback: string): string => {
    if (!v) return fallback;
    if (v === 'accent') return palette.accent;
    if (v === 'accent2') return palette.accent2;
    if (v === 'text') return palette.text;
    if (v === 'bg') return palette.bg;
    return v; // hex / css color (already sanitized server-side)
  };

  const shapes = Array.isArray(layer.shapes) ? layer.shapes : [];

  return (
    <AbsoluteFill style={{backgroundColor: layer.bg ? color(layer.bg, 'transparent') : 'transparent'}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{display: 'block'}}>
        {shapes.map((s, i) => {
          const opacity = Math.max(0, Math.min(1, track(s, 'opacity', t) ?? num(s.opacity, 1)));
          const scale = track(s, 'scale', t) ?? 1;
          const rotate = track(s, 'rotate', t) ?? 0;
          const cx = (track(s, 'x', t) ?? num(s.x, 50)) / 100 * W;
          const cy = (track(s, 'y', t) ?? num(s.y, 50)) / 100 * H;
          const fill = color(s.fill, palette.accent);
          const stroke = color(s.stroke, 'none');
          const sw = num(s.stroke_width, s.kind === 'ring' || s.kind === 'line' ? 4 : 0);

          if (s.kind === 'line') {
            // Lines animate their endpoints + opacity (no scale/rotate group).
            return (
              <line
                key={i}
                x1={cx} y1={cy}
                x2={num(s.x2, 50) / 100 * W} y2={num(s.y2, 50) / 100 * H}
                stroke={color(s.stroke || s.fill, palette.accent)}
                strokeWidth={num(s.stroke_width, 4)}
                strokeLinecap="round"
                opacity={opacity}
              />
            );
          }

          const g = `translate(${cx} ${cy}) rotate(${rotate}) scale(${scale})`;
          if (s.kind === 'text') {
            return (
              <g key={i} transform={g} opacity={opacity}>
                <text
                  x={0} y={0} textAnchor="middle" dominantBaseline="central"
                  fill={color(s.fill, palette.text)}
                  fontSize={num(s.size, 48)} fontWeight={700} fontFamily={font.family}
                >
                  {String(s.text ?? '')}
                </text>
              </g>
            );
          }
          if (s.kind === 'rect') {
            const w = num(s.w, 10) / 100 * W;
            const h = num(s.h, 10) / 100 * H;
            return (
              <g key={i} transform={g} opacity={opacity}>
                <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(w, h) * 0.08}
                  fill={fill} stroke={stroke} strokeWidth={sw} />
              </g>
            );
          }
          // circle | dot | ring
          const r = Math.max(0, (track(s, 'r', t) ?? num(s.r, s.kind === 'dot' ? 1.5 : 6)) / 100 * minDim);
          return (
            <g key={i} transform={g} opacity={opacity}>
              <circle
                cx={0} cy={0} r={r}
                fill={s.kind === 'ring' ? 'none' : fill}
                stroke={s.kind === 'ring' ? color(s.stroke || s.fill, palette.accent) : stroke}
                strokeWidth={s.kind === 'ring' ? num(s.stroke_width, 4) : sw}
              />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
