import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {alpha, mix, useStyle} from '../styles';

// The pack's non-shader backgrounds (shader packs use the ShaderLayer).
// Slow drift keeps static scenes alive without distracting.
export const Backdrop: React.FC<{kind?: string}> = ({kind}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const k = kind || s.background.kind;
  const {bg, accent, accent2} = s.palette;
  const drift = Math.sin(frame / 90) * 6;
  if (k === 'gradient') {
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${30 + drift}% ${25 - drift}%, ${alpha(accent, 0.16)} 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at ${78 - drift}% ${80 + drift}%, ${alpha(accent2, 0.14)} 0%, transparent 60%), ${bg}`,
        }}
      />
    );
  }
  if (k === 'dots' || k === 'grid') {
    const line = alpha(mix(bg, s.palette.text, 0.5), k === 'dots' ? 0.18 : 0.08);
    const pattern = k === 'dots'
      ? `radial-gradient(${line} 2.2px, transparent 2.6px)`
      : `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`;
    return (
      <AbsoluteFill style={{background: bg}}>
        <AbsoluteFill style={{backgroundImage: pattern, backgroundSize: '44px 44px', backgroundPosition: `${frame * 0.3}px ${frame * 0.3}px`, maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)'}} />
        <AbsoluteFill style={{background: `radial-gradient(ellipse 50% 40% at 50% 50%, ${alpha(accent, 0.1)}, transparent 70%)`}} />
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill style={{background: bg}} />;
};
