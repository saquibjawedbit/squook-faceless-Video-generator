import {AbsoluteFill, spring, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {Part} from './Part';

const EMOJI: Record<string, string> = {
  brain: '🧠',
  chip: '💻',
  database: '🗄️',
  network: '🕸️',
  eye: '👁️',
  gear: '⚙️',
  chart: '📈',
  lightbulb: '💡',
  clock: '⏱️',
  check: '✅',
  cross: '❌',
  arrow: '➡️',
};

export const IconRow: React.FC<{
  icons: string[];
  labels: string[];
  fps: number;
  partStyles?: Record<string, PartStyle>;
}> = ({icons, labels, fps, partStyles}) => {
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
            <div style={{fontSize: 160, lineHeight: 1.2}}>{EMOJI[name] ?? '⚙️'}</div>
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
