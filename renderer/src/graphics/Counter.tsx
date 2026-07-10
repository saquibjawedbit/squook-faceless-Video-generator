import {AbsoluteFill, interpolate, spring, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {Part} from './Part';

export const Counter: React.FC<{
  number: number;
  suffix: string;
  label: string;
  fps: number;
  partStyles?: Record<string, PartStyle>;
}> = ({number, suffix, label, fps, partStyles}) => {
  const frame = useCurrentFrame();
  const {palette, font} = useTheme();
  const ACCENT = palette.accent;
  const progress = interpolate(frame, [0, fps * 1.6], [0, 1], {
    extrapolateRight: 'clamp',
  });
  // Ease-out so the count decelerates into the final value.
  const eased = 1 - (1 - progress) ** 3;
  const value = number * eased;
  const decimals = Number.isInteger(number) ? 0 : 1;
  const pop = spring({frame, fps, config: {damping: 14}});

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <Part
        name="value"
        partStyles={partStyles}
        base={{
          color: ACCENT,
          fontFamily: font.family,
          fontSize: 220,
          fontWeight: 800,
          transform: `scale(${pop})`,
          textShadow: `0 0 60px ${ACCENT}55`,
        }}
      >
        {value.toLocaleString('en-US', {maximumFractionDigits: decimals})}
        {suffix}
      </Part>
      {label ? (
        <Part
          name="label"
          partStyles={partStyles}
          base={{
            color: palette.text,
            fontFamily: font.family,
            fontSize: 54,
            fontWeight: 700,
            marginTop: 24,
            opacity: interpolate(frame, [fps * 0.4, fps * 0.9], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {label}
        </Part>
      ) : null}
    </AbsoluteFill>
  );
};
