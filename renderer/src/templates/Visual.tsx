import {AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {TemplateProps} from '.';
import {asset} from '../ir';
import {alpha, useStyle} from '../styles';
import {useEnter} from './kit';

// A full-bleed AI-generated picture with a slow camera move and the scene's
// line of copy over a soft gradient. layout: 'left' (text bottom-left),
// 'center' (text centered low), 'right' (text bottom-right). The camera move
// alternates by `p.move` so consecutive pictures don't all drift the same way.
export const Visual: React.FC<TemplateProps> = ({p, layout, durationFrames}) => {
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const s = useStyle();
  const vertical = H > W;
  const t = interpolate(frame, [0, durationFrames], [0, 1], {extrapolateRight: 'clamp'});
  const move = String(p.move || 'push');
  const scale = move === 'pull' ? 1.14 - 0.1 * t : 1.04 + 0.1 * t;
  const tx = move === 'pan_left' ? 3 - 6 * t : move === 'pan_right' ? -3 + 6 * t : 0;
  const title = String(p.title || '').slice(0, 80);
  const caption = String(p.caption || '').slice(0, 120);
  const enterT = useEnter(6);
  const enterC = useEnter(14);
  const align = layout === 'right' ? 'right' : layout === 'center' || vertical ? 'center' : 'left';
  const ink = '#ffffff';

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{overflow: 'hidden'}}>
        {p.image ? (
          <Img src={asset(String(p.image))} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale}) translateX(${tx}%)`}} />
        ) : null}
      </AbsoluteFill>
      {/* Gradient so the copy reads on any picture; tinted toward the pack colour. */}
      <AbsoluteFill
        style={{
          background: vertical
            ? `linear-gradient(180deg, ${alpha('#000000', 0.45)} 0%, transparent 32%, transparent 52%, ${alpha('#000000', 0.78)} 100%)`
            : `linear-gradient(${align === 'right' ? 270 : align === 'left' ? 90 : 0}deg, ${alpha('#000000', 0.72)} 0%, ${alpha('#000000', 0.25)} 55%, transparent 80%), linear-gradient(0deg, ${alpha('#000000', 0.55)} 0%, transparent 45%)`,
        }}
      />
      <AbsoluteFill style={{boxShadow: `inset 0 0 220px ${alpha(s.palette.accent, 0.12)}`}} />
      {title || caption ? (
        <AbsoluteFill
          style={{
            padding: vertical ? '0 8% 30%' : '0 7% 15%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          }}
        >
          <div style={{maxWidth: vertical ? '100%' : '58%', textAlign: align}}>
            {title ? (
              <div
                style={{
                  fontFamily: s.font.heading,
                  fontWeight: s.headingWeight,
                  fontSize: (vertical ? 104 : 92) * s.scale,
                  lineHeight: s.headingCase === 'upper' ? 0.98 : 1.05,
                  letterSpacing: `${s.headingTracking}em`,
                  textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none',
                  color: ink,
                  textShadow: '0 4px 30px rgba(0,0,0,0.45)',
                  textWrap: 'balance',
                  ...enterT,
                } as React.CSSProperties}
              >
                {title}
              </div>
            ) : null}
            {title ? <div style={{height: 6, width: interpolate(frame, [10, 30], [0, 160], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), background: s.palette.accent, borderRadius: 3, margin: align === 'center' ? '26px auto' : align === 'right' ? '26px 0 26px auto' : '26px 0'}} /> : null}
            {caption ? (
              <div style={{fontFamily: s.font.body, fontSize: vertical ? 44 : 38, lineHeight: 1.35, color: alpha(ink, 0.88), textShadow: '0 2px 18px rgba(0,0,0,0.5)', ...enterC}}>
                {caption}
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
