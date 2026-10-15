import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties, ReactNode} from 'react';
import type {TemplateProps} from '.';
import {alpha, mix, useStyle} from '../styles';
import type {StylePack} from '../styles';
import {Body, Heading, isCenter, useBeat, useCountUp, useEnter, useExit, useProgress} from './kit';

// ── shared helpers for the data templates (Stat, Stats, Chart, Steps, Compare, BeforeAfter) ──

/** Frame geometry + a type unit `k` (1 at 1920x1080). */
export function useFrameInfo() {
  const {width: W, height: H} = useVideoConfig();
  const tall = H > W * 1.15;
  const square = !tall && W < H * 1.3;
  const k = tall ? W / 1180 : square ? W / 1500 : Math.min(W / 1920, H / 1080);
  return {W, H, tall, square, k};
}

/** Safe area: top/side margins, bottom ~18% left clear for captions; fades out at scene end. */
export const SafeArea: React.FC<{children: ReactNode; durationFrames: number; style?: CSSProperties}> = ({children, durationFrames, style}) => {
  const {W, H, tall} = useFrameInfo();
  const exit = useExit(durationFrames);
  return (
    <AbsoluteFill
      style={{
        padding: `${H * (tall ? 0.09 : 0.08)}px ${W * (tall ? 0.08 : 0.075)}px ${H * 0.18}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        opacity: exit,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const str = (x: unknown): string => (x == null ? '' : typeof x === 'object' ? '' : String(x));

/** Number from a prop (number or numeric string like "1,200"), else null. */
export function parseNum(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const t = x.replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Counted-up text for a numeric prop; non-numeric props are shown as-is. */
export function useNumberText(raw: unknown, delay: number, duration = 42): string {
  const n = parseNum(raw);
  const counted = useCountUp(n ?? 0, delay, duration);
  return n === null ? str(raw) : group(counted);
}

/** Adds thousands separators to a plain decimal string ("1234567.5" -> "1,234,567.5"). */
const group = (t: string) => (/^-?\d+\.\d+$/.test(t) ? t.replace(/^(-?\d+)/, (m) => Number(m).toLocaleString('en-US')) : t);

/** The settled text (for sizing). */
export function finalNumberText(raw: unknown): string {
  const n = parseNum(raw);
  if (n === null) return str(raw);
  const d = String(n).includes('.') ? String(n).split('.')[1].length : 0;
  return d ? group(n.toFixed(d)) : Math.round(n).toLocaleString('en-US');
}

export const clampLines = (lines: number): CSSProperties => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const ellipsis: CSSProperties = {whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0};

/** A "negative" tone derived from the pack (used for crosses / before states). */
export const warnOf = (s: StylePack) => mix(s.palette.muted, '#e5484d', 0.62);

/** Eased 0→1 between two frames. */
export function useRamp(from: number, to: number): number {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [from, Math.max(from + 1, to)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return 1 - (1 - t) ** 3;
}

/** Check / cross that strokes in with `progress` (0→1). */
export const Mark: React.FC<{ok: boolean; size: number; progress: number; color: string; fill?: string; ring?: string}> = ({ok, size, progress, color, fill, ring}) => {
  const p = Math.max(0, Math.min(1, progress));
  const a = Math.min(1, p * 1.6);
  const b = Math.max(0, Math.min(1, (p - 0.35) / 0.65));
  const sw = 2.4;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block', flexShrink: 0, overflow: 'visible'}}>
      {(fill || ring) && (
        <circle
          cx={12}
          cy={12}
          r={11}
          fill={fill ?? 'none'}
          stroke={ring ?? 'none'}
          strokeWidth={1.4}
          style={{transform: `scale(${0.6 + 0.4 * Math.min(1, p * 2)})`, transformOrigin: '12px 12px', opacity: Math.min(1, p * 3)}}
        />
      )}
      {ok ? (
        <path d="M7 12.4l3.3 3.3L17.2 8.8" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      ) : (
        <g fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
          <path d="M8.2 8.2l7.6 7.6" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - a} />
          <path d="M15.8 8.2l-7.6 7.6" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - b} />
        </g>
      )}
    </svg>
  );
};

/** Big number with prefix/suffix in the accent. */
export const BigNumber: React.FC<{text: string; final?: string; prefix?: string; suffix?: string; size: number; align?: 'left' | 'center'}> = ({text, final, prefix, suffix, size, align = 'left'}) => {
  const s = useStyle();
  const affix: CSSProperties = {color: s.palette.accent, fontSize: '0.56em', lineHeight: 1, marginBottom: '0.06em'};
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        fontFamily: s.font.heading,
        fontWeight: s.headingWeight,
        fontSize: size,
        lineHeight: 0.92,
        letterSpacing: `${Math.min(s.headingTracking, -0.01) * 1.4}em`,
        color: s.palette.text,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {prefix ? <span style={{...affix, marginRight: '0.04em'}}>{prefix}</span> : null}
      {/* the settled value reserves the width, so the suffix never jumps while counting */}
      <span style={{display: 'inline-grid', justifyItems: 'end'}}>
        <span style={{gridArea: '1 / 1', visibility: 'hidden'}}>{final ?? text}</span>
        <span style={{gridArea: '1 / 1'}}>{text}</span>
      </span>
      {suffix ? <span style={{...affix, marginLeft: '0.04em'}}>{suffix}</span> : null}
    </div>
  );
};

/** Font size so a number string fits `maxW` px. */
export function fitNumber(base: number, maxW: number, num: string, prefix: string, suffix: string, s: StylePack): number {
  const glyph = s.headingCase === 'upper' ? 0.5 : 0.6;
  const eff = Math.max(1, num.length + 0.56 * (prefix.length + suffix.length));
  return Math.max(24, Math.min(base, maxW / (eff * glyph)));
}

// ── Stat: one giant counting number ─────────────────────────────────────────

export const Stat: React.FC<TemplateProps> = ({p, layout, beats, durationFrames}) => {
  const s = useStyle();
  const {W, k, tall} = useFrameInfo();
  const center = isCenter(layout);
  const align = center ? 'center' : 'left';

  const t0 = useBeat(beats, 0, 4);
  const b1 = useBeat(beats, 1);
  const tLabel = Number.isFinite(beats?.[1]) ? b1 : t0 + 12;
  const prefix = str(p.prefix);
  const suffix = str(p.suffix);
  const label = str(p.label);
  const context = str(p.context);

  const text = useNumberText(p.number, t0 + 2, 48);
  const size = fitNumber((tall ? 320 : 400) * k * s.scale, W * (tall ? 0.84 : 0.8), finalNumberText(p.number), prefix, suffix, s);

  const enter = useEnter(t0);
  const settle = useProgress(t0);
  const line = useProgress(t0 + 14);
  const lineW = Math.max(0, Math.min(1.05, line)) * (tall ? 220 : 280) * k;

  return (
    <SafeArea durationFrames={durationFrames} style={{alignItems: center ? 'center' : 'flex-start'}}>
      <div style={{...enter, transform: `${enter.transform ?? ''} scale(${0.94 + 0.06 * Math.min(1, settle)})`, transformOrigin: center ? '50% 100%' : '0% 100%'}}>
        <BigNumber text={text || '0'} final={finalNumberText(p.number)} prefix={prefix} suffix={suffix} size={size} align={align} />
      </div>
      <div style={{height: 10 * k, width: lineW, background: s.palette.accent, borderRadius: 99, margin: `${34 * k}px 0 ${40 * k}px`, boxShadow: s.id === 'tech' ? `0 0 ${24 * k}px ${alpha(s.palette.accent, 0.6)}` : undefined}} />
      {label ? (
        <Heading size={(tall ? 66 : 64) * k} delay={tLabel} align={align} style={{maxWidth: center ? '86%' : tall ? '100%' : '70%', ...clampLines(3)}}>
          {label}
        </Heading>
      ) : null}
      {context ? (
        <Body size={(tall ? 38 : 34) * k} delay={tLabel + 8} align={align} style={{marginTop: 22 * k, maxWidth: center ? '72%' : tall ? '100%' : '56%', ...clampLines(3)}}>
          {context}
        </Body>
      ) : null}
    </SafeArea>
  );
};
