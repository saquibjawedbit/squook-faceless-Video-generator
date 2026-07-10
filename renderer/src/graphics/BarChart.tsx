import {AbsoluteFill, spring, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {Part} from './Part';

export const BarChart: React.FC<{
  values: number[];
  labels: string[];
  title: string;
  fps: number;
  partStyles?: Record<string, PartStyle>;
}> = ({values, labels, title, fps, partStyles}) => {
  const frame = useCurrentFrame();
  const max = Math.max(...values, 1);
  const {palette, font} = useTheme();

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      {title ? (
        <Part
          name="title"
          partStyles={partStyles}
          base={{
            color: palette.text,
            fontFamily: font.family,
            fontSize: 52,
            fontWeight: 700,
            marginBottom: 60,
            opacity: spring({frame, fps, config: {damping: 200}}),
          }}
        >
          {title}
        </Part>
      ) : null}
      <div style={{display: 'flex', alignItems: 'flex-end', gap: 48, height: 520}}>
        {values.map((v, i) => {
          const grow = spring({frame: frame - i * 6, fps, config: {damping: 16}});
          return (
            <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <div
                style={{
                  width: 110,
                  height: Math.max(8, (v / max) * 440 * grow),
                  background: `linear-gradient(180deg, ${palette.accent}, ${palette.accent2})`,
                  borderRadius: 10,
                }}
              />
              <Part
                name={`label_${i}`}
                partStyles={partStyles}
                base={{
                  color: palette.text,
                  opacity: 0.8,
                  fontFamily: font.family,
                  fontSize: 30,
                  fontWeight: 700,
                  marginTop: 18,
                  maxWidth: 150,
                  textAlign: 'center',
                }}
              >
                {labels[i] ?? ''}
              </Part>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
