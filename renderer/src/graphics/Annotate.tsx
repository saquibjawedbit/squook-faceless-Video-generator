import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {Part} from './Part';

// Draw-on annotation (circle / arrow / underline) with a label, centered on
// the frame; sits above whatever layer is underneath (footage or solid).
export const Annotate: React.FC<{
  annotation: 'arrow' | 'circle' | 'underline';
  label: string;
  fps: number;
  durationFrames: number;
  partStyles?: Record<string, PartStyle>;
}> = ({annotation, label, fps, partStyles}) => {
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const {palette, font} = useTheme();
  const ACCENT = palette.accent;
  const draw = interpolate(frame, [fps * 0.3, fps * 1.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const labelOpacity = interpolate(frame, [fps * 1.0, fps * 1.5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cx = W / 2;
  const cy = H * 0.45;
  const circleR = 190;
  const circleLen = 2 * Math.PI * circleR;
  const underlineY = H * 0.62;

  return (
    <AbsoluteFill>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {annotation === 'circle' ? (
          <circle
            cx={cx}
            cy={cy}
            r={circleR}
            fill="none"
            stroke={ACCENT}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={circleLen}
            strokeDashoffset={circleLen * (1 - draw)}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ) : null}
        {annotation === 'underline' ? (
          <line
            x1={W * 0.3}
            y1={underlineY}
            x2={W * 0.3 + W * 0.4 * draw}
            y2={underlineY}
            stroke={ACCENT}
            strokeWidth={12}
            strokeLinecap="round"
          />
        ) : null}
        {annotation === 'arrow' ? (
          <g stroke={ACCENT} strokeWidth={12} strokeLinecap="round" fill="none">
            <line
              x1={W * 0.25}
              y1={H * 0.75}
              x2={W * 0.25 + (cx - 60 - W * 0.25) * draw}
              y2={H * 0.75 + (cy + 60 - H * 0.75) * draw}
            />
            {draw >= 1 ? (
              <path
                d={`M ${cx - 60} ${cy + 60} l -70 10 M ${cx - 60} ${cy + 60} l -14 68`}
              />
            ) : null}
          </g>
        ) : null}
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: annotation === 'underline' ? underlineY + 40 : cy + circleR + 40,
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            opacity: labelOpacity,
          }}
        >
          <Part
            name="label"
            partStyles={partStyles}
            base={{
              color: palette.text,
              fontFamily: font.family,
              fontSize: 48,
              fontWeight: 700,
              background: 'rgba(0,0,0,0.55)',
              padding: '14px 36px',
              borderRadius: 12,
            }}
          >
            {label}
          </Part>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
