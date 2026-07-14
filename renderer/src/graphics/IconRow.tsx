import {AbsoluteFill, spring, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {asset} from '../ir';
import {Part} from './Part';

export const IconRow: React.FC<{
  icons: string[];
  iconSrcs?: (string | null)[];
  labels: string[];
  fps: number;
  partStyles?: Record<string, PartStyle>;
}> = ({icons, iconSrcs = [], labels, fps, partStyles}) => {
  const frame = useCurrentFrame();
  const {palette, font} = useTheme();

  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 110}}
    >
      {icons.map((name, i) => {
        const pop = spring({frame: frame - i * 10, fps, config: {damping: 11}});
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transform: `scale(${pop})`,
            }}
          >
            {iconSrcs[i] ? (
              // Real fetched vector icon (Iconify), already recoloured to accent.
              <img src={asset(iconSrcs[i] as string)} width={160} height={160} style={{display: 'block'}} alt="" />
            ) : (
              // Icon fetch failed — a neutral accent ring with the concept's
              // initial. Emojis are banned from generated video output.
              <div
                style={{
                  width: 150,
                  height: 150,
                  borderRadius: '50%',
                  border: `6px solid ${palette.accent}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: palette.accent,
                  fontFamily: font.family,
                  fontWeight: 800,
                  fontSize: 72,
                }}
              >
                {((labels[i] || name || '?').trim().charAt(0) || '?').toUpperCase()}
              </div>
            )}
            <Part
              name={`label_${i}`}
              partStyles={partStyles}
              base={{
                color: palette.text,
                fontFamily: font.family,
                fontSize: 38,
                fontWeight: 700,
                marginTop: 20,
                maxWidth: 260,
                textAlign: 'center',
              }}
            >
              {labels[i] ?? ''}
            </Part>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
