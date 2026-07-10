import {AbsoluteFill, interpolate, spring, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {Part} from './Part';

export const TitleCard: React.FC<{
  title: string;
  subtitle: string;
  fps: number;
  partStyles?: Record<string, PartStyle>;
}> = ({title, subtitle, fps, partStyles}) => {
  const frame = useCurrentFrame();
  const {palette, font} = useTheme();
  const ACCENT = palette.accent;
  const rise = spring({frame, fps, config: {damping: 200}});
  const lineWidth = interpolate(frame, [8, 30], [0, 220], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        background: `radial-gradient(ellipse at 30% 20%, ${palette.accent2}33 0%, ${palette.bg} 65%)`,
      }}
    >
      <Part
        name="title"
        partStyles={partStyles}
        base={{
          color: palette.text,
          fontFamily: font.family,
          fontSize: font.title_size,
          fontWeight: 800,
          maxWidth: '75%',
          textAlign: 'center',
          opacity: rise,
          transform: `translateY(${(1 - rise) * 50}px)`,
        }}
      >
        {title}
      </Part>
      <div style={{height: 6, width: lineWidth, background: ACCENT, borderRadius: 3, margin: '36px 0'}} />
      {subtitle ? (
        <Part
          name="subtitle"
          partStyles={partStyles}
          base={{
            color: palette.text,
            fontFamily: font.family,
            fontSize: 44,
            fontWeight: 400,
            maxWidth: '65%',
            textAlign: 'center',
            opacity: 0.85 * interpolate(frame, [15, 35], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {subtitle}
        </Part>
      ) : null}
    </AbsoluteFill>
  );
};
