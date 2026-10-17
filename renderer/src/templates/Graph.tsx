import {interpolate, useCurrentFrame} from 'remotion';
import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Heading, useEnter} from './kit';
import {SafeArea, useFrameInfo} from './Stat';

// A simple x–y line graph that draws itself: axes with labels, ticks, the
// line through the points, and dots. Props:
//   { title?, x_label, y_label, points: [{ x, y }], note?, highlight?: index }
type Pt = {x: number; y: number};

const nice = (v: number) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
};

export const Graph: React.FC<TemplateProps> = ({p, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {k, tall} = useFrameInfo();
  const pts: Pt[] = (Array.isArray(p.points) ? p.points : [])
    .map((q: any) => ({x: Number(q?.x), y: Number(q?.y)}))
    .filter((q: Pt) => Number.isFinite(q.x) && Number.isFinite(q.y))
    .sort((a: Pt, b: Pt) => a.x - b.x)
    .slice(0, 8);
  const W = (tall ? 860 : 1180) * k, H = (tall ? 760 : 560) * k;
  const pad = {l: 110 * k, r: 40 * k, t: 30 * k, b: 90 * k};
  const maxX = nice(Math.max(1, ...pts.map((q) => q.x)));
  const maxY = nice(Math.max(1, ...pts.map((q) => q.y)));
  const X = (x: number) => pad.l + (x / maxX) * (W - pad.l - pad.r);
  const Y = (y: number) => H - pad.b - (y / maxY) * (H - pad.t - pad.b);
  const axes = interpolate(frame, [6, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const draw = interpolate(frame, [20, Math.max(40, Math.min(durationFrames * 0.55, 90))], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const path = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ');
  const len = pts.reduce((a, q, i) => (i ? a + Math.hypot(X(q.x) - X(pts[i - 1].x), Y(q.y) - Y(pts[i - 1].y)) : 0), 0) || 1;
  const ink = alpha(s.palette.text, 0.75);
  const fsAx = 30 * k;
  const ticks = [0.25, 0.5, 0.75, 1];
  const titleIn = useEnter(0);
  const noteIn = useEnter(Math.round(durationFrames * 0.5));
  return (
    <SafeArea durationFrames={durationFrames} style={{alignItems: 'center'}}>
      {p.title ? <div style={titleIn}><Heading size={(tall ? 66 : 58) * k} align="center" style={{marginBottom: 24 * k}}>{String(p.title).slice(0, 50)}</Heading></div> : null}
      <svg width={W} height={H} style={{overflow: 'visible'}}>
        <g opacity={axes}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={Y(t * maxY)} y2={Y(t * maxY)} stroke={alpha(s.palette.text, 0.1)} strokeWidth={2 * k} />
              <text x={pad.l - 16 * k} y={Y(t * maxY) + fsAx * 0.35} fontSize={fsAx * 0.85} fill={ink} textAnchor="end" fontFamily={s.font.body}>{+(t * maxY).toFixed(2)}</text>
              <text x={X(t * maxX)} y={H - pad.b + fsAx * 1.3} fontSize={fsAx * 0.85} fill={ink} textAnchor="middle" fontFamily={s.font.body}>{+(t * maxX).toFixed(2)}</text>
            </g>
          ))}
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r + 20 * k} y2={H - pad.b} stroke={s.palette.text} strokeWidth={4 * k} />
          <line x1={pad.l} y1={H - pad.b} x2={pad.l} y2={pad.t - 20 * k} stroke={s.palette.text} strokeWidth={4 * k} />
          <text x={(pad.l + W - pad.r) / 2} y={H - pad.b + fsAx * 2.6} fontSize={fsAx} fill={s.palette.text} textAnchor="middle" fontFamily={s.font.heading} fontWeight={600}>{String(p.x_label || '').slice(0, 30)}</text>
          <text x={0} y={0} transform={`translate(${pad.l - fsAx * 2.3}, ${(pad.t + H - pad.b) / 2}) rotate(-90)`} fontSize={fsAx} fill={s.palette.text} textAnchor="middle" fontFamily={s.font.heading} fontWeight={600}>{String(p.y_label || '').slice(0, 30)}</text>
        </g>
        {pts.length > 1 ? <path d={path} fill="none" stroke={s.palette.accent} strokeWidth={8 * k} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} /> : null}
        {pts.map((q, i) => {
          const at = pts.length > 1 ? i / (pts.length - 1) : 1;
          const on = interpolate(draw, [at - 0.02, at + 0.05], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const hi = Number(p.highlight) === i;
          return (
            <g key={i} opacity={on}>
              <circle cx={X(q.x)} cy={Y(q.y)} r={(hi ? 16 : 11) * k} fill={hi ? s.palette.accent : s.palette.bg} stroke={s.palette.accent} strokeWidth={5 * k} />
              {hi ? <text x={X(q.x) + 22 * k} y={Y(q.y) - 18 * k} fontSize={fsAx} fill={s.palette.accent} fontFamily={s.font.heading} fontWeight={700}>({q.x}, {q.y})</text> : null}
            </g>
          );
        })}
      </svg>
      {p.note ? <div style={{...noteIn, marginTop: 26 * k, fontFamily: s.font.body, fontSize: 34 * k, color: alpha(s.palette.text, 0.75), textAlign: 'center'}}>{String(p.note).slice(0, 90)}</div> : null}
    </SafeArea>
  );
};
