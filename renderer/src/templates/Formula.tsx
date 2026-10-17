import {interpolate, useCurrentFrame} from 'remotion';
import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Heading, useBeat, useEnter} from './kit';
import {SafeArea, useFrameInfo} from './Stat';

// A formula, big and centred, with each symbol lighting up and its meaning
// appearing below as the voice reaches it. Props:
//   { title?, expr: "V = I × R", parts: [{ sym: "V", label: "Voltage", unit?: "volt" }], note? }
type Part = {sym: string; label: string; unit?: string};

const Label: React.FC<{part: Part; delay: number; color: string; size: number}> = ({part, delay, color, size}) => {
  const s = useStyle();
  const e = useEnter(delay);
  return (
    <div style={{...e, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 0.2, minWidth: size * 4}}>
      <div style={{fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: size * 1.5, color, lineHeight: 1}}>{part.sym}</div>
      <div style={{fontFamily: s.font.body, fontSize: size, color: s.palette.text, textAlign: 'center', lineHeight: 1.2}}>{part.label}</div>
      {part.unit ? <div style={{fontFamily: s.font.body, fontSize: size * 0.8, color: alpha(s.palette.text, 0.6)}}>{part.unit}</div> : null}
    </div>
  );
};

export const Formula: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {k, tall} = useFrameInfo();
  const expr = String(p.expr || '').slice(0, 40);
  const parts: Part[] = (Array.isArray(p.parts) ? p.parts : []).filter((x: Part) => x && x.sym && x.label).slice(0, 4);
  const colors = [s.palette.accent, s.palette.accent2 || s.palette.accent, s.palette.text, s.palette.accent];
  const exprIn = useEnter(4);
  const delays = parts.map((_, i) => useBeat(beats, i, 18 + i * 14)); // eslint-disable-line react-hooks/rules-of-hooks
  // Each symbol in the expression glows from the moment its label appears.
  const noteIn = useEnter((delays[delays.length - 1] ?? 20) + 20);
  const tokens = expr.split(/(\s+)/);
  const fs = Math.min((tall ? 190 : 210) * k, ((tall ? 900 : 1500) * k) / Math.max(4, expr.length * 0.62));
  return (
    <SafeArea durationFrames={durationFrames} style={{alignItems: 'center', textAlign: 'center'}}>
      {p.title ? <Heading size={(tall ? 64 : 56) * k} align="center" style={{marginBottom: 30 * k, opacity: 0.85}}>{String(p.title).slice(0, 50)}</Heading> : null}
      <div style={{...exprIn, fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: fs, lineHeight: 1.05, letterSpacing: '-0.01em', whiteSpace: 'nowrap', color: s.palette.text}}>
        {tokens.map((t, i) => {
          const j = parts.findIndex((x) => x.sym === t.trim());
          if (j < 0) return <span key={i}>{t}</span>;
          const on = interpolate(frame, [delays[j], delays[j] + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return <span key={i} style={{color: on > 0.5 ? colors[j] : s.palette.text, textShadow: on > 0.5 ? `0 0 ${30 * k}px ${alpha(colors[j], 0.35)}` : 'none'}}>{t}</span>;
        })}
      </div>
      {parts.length ? (
        <div style={{display: 'flex', justifyContent: 'center', gap: (tall ? 40 : 90) * k, marginTop: 60 * k, flexWrap: tall ? 'wrap' : 'nowrap'}}>
          {parts.map((part, i) => <Label key={i} part={part} delay={delays[i]} color={colors[i]} size={(tall ? 40 : 38) * k} />)}
        </div>
      ) : null}
      {p.note ? <div style={{...noteIn, marginTop: 44 * k, fontFamily: s.font.body, fontSize: 34 * k, color: alpha(s.palette.text, 0.7)}}>{String(p.note).slice(0, 80)}</div> : null}
    </SafeArea>
  );
};
