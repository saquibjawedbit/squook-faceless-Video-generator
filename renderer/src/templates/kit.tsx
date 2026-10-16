import {AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties, ReactNode} from 'react';
import {asset} from '../ir';
import {alpha, isLite, luminance, useStyle} from '../styles';
import type {EnterKind} from '../styles';

// Shared building blocks for scene templates. Every template should build from
// these so the style pack (fonts, colours, motion feel) applies everywhere.

/** Frame (relative to the scene) at which item `i` should appear: its word cue
 *  from the voice-over if the server provided one, else a pack-paced stagger. */
export function useBeat(beats: number[] | undefined, i: number, base = 6): number {
  const {fps} = useVideoConfig();
  const s = useStyle();
  const b = beats?.[i];
  return Number.isFinite(b) ? Math.max(0, Math.round((b as number) * fps)) : base + i * s.stagger * 2;
}

/** 0→1 progress of the pack's spring, starting at `delay` frames. */
export function useProgress(delay = 0): number {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = useStyle();
  return spring({frame: frame - delay, fps, config: s.spring});
}

/** Entrance style for an element appearing at `delay` frames, in the pack's manner. */
export function useEnter(delay = 0, kind?: EnterKind): CSSProperties {
  const p = useProgress(delay);
  const s = useStyle();
  const k = kind ?? s.enter;
  const o = Math.min(1, Math.max(0, p));
  switch (k) {
    case 'pop':
      return {opacity: o, transform: `scale(${0.6 + 0.4 * p})`};
    case 'blur':
      // No filter once settled (a blur(0) still costs a compositing pass), none at all in lite exports.
      return {opacity: o, filter: !isLite() && o < 0.99 ? `blur(${(1 - o) * 14}px)` : undefined, transform: `translateY(${(1 - p) * 24}px)`};
    case 'slide':
      return {opacity: o, transform: `translateX(${(1 - p) * -80}px)`};
    case 'mask':
      return {opacity: o, clipPath: `inset(0 ${(1 - o) * 100}% 0 0)`};
    case 'rise':
    default:
      return {opacity: o, transform: `translateY(${(1 - p) * 48}px)`};
  }
}

/** Fades the whole scene content out over its last ~10 frames (avoids hard pops). */
export function useExit(durationFrames: number): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [durationFrames - 10, durationFrames], [1, 0.0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
}

export const Stage: React.FC<{children: ReactNode; style?: CSSProperties; pad?: number}> = ({children, style, pad = 7}) => (
  <AbsoluteFill style={{padding: `${pad}% ${pad + 1}%`, display: 'flex', flexDirection: 'column', justifyContent: 'center', ...style}}>
    {children}
  </AbsoluteFill>
);

/** Headline in the pack's heading face. `size` is a base px at 1080p. */
export const Heading: React.FC<{children: ReactNode; size?: number; delay?: number; align?: 'left' | 'center' | 'right'; color?: string; style?: CSSProperties}> = ({children, size = 96, delay = 0, align = 'left', color, style}) => {
  const s = useStyle();
  const enter = useEnter(delay);
  return (
    <div
      style={{
        fontFamily: s.font.heading,
        fontWeight: s.headingWeight,
        fontSize: size * s.scale,
        lineHeight: s.headingCase === 'upper' ? 0.98 : 1.06,
        letterSpacing: `${s.headingTracking}em`,
        textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none',
        color: color ?? s.palette.text,
        textAlign: align,
        textWrap: 'balance',
        ...enter,
        ...style,
      } as CSSProperties}
    >
      {children}
    </div>
  );
};

export const Body: React.FC<{children: ReactNode; size?: number; delay?: number; align?: 'left' | 'center' | 'right'; muted?: boolean; style?: CSSProperties}> = ({children, size = 40, delay = 8, align = 'left', muted = true, style}) => {
  const s = useStyle();
  const enter = useEnter(delay);
  return (
    <div style={{fontFamily: s.font.body, fontSize: size, lineHeight: 1.35, color: muted ? s.palette.muted : s.palette.text, textAlign: align, textWrap: 'pretty', ...enter, ...style} as CSSProperties}>
      {children}
    </div>
  );
};

/** Small uppercase label above a headline. */
export const Eyebrow: React.FC<{children: ReactNode; delay?: number; align?: 'left' | 'center' | 'right'}> = ({children, delay = 0, align = 'left'}) => {
  const s = useStyle();
  const enter = useEnter(delay);
  return (
    <div style={{fontFamily: s.font.mono, fontSize: 26, letterSpacing: '0.18em', textTransform: 'uppercase', color: s.palette.accent, textAlign: align, marginBottom: 22, ...enter}}>
      {children}
    </div>
  );
};

export const Card: React.FC<{children: ReactNode; delay?: number; style?: CSSProperties; accent?: boolean}> = ({children, delay = 0, style, accent}) => {
  const s = useStyle();
  const enter = useEnter(delay);
  return (
    <div
      style={{
        background: accent ? s.palette.accent : s.card.bg,
        color: accent ? s.palette.onAccent : s.palette.text,
        border: `1px solid ${accent ? 'transparent' : s.card.border}`,
        boxShadow: s.card.shadow,
        borderRadius: s.radius,
        padding: '34px 38px',
        fontFamily: s.font.body,
        ...enter,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Accent pill / badge. */
export const Pill: React.FC<{children: ReactNode; delay?: number; style?: CSSProperties}> = ({children, delay = 0, style}) => {
  const s = useStyle();
  const enter = useEnter(delay, 'pop');
  return (
    <span style={{display: 'inline-block', background: alpha(s.palette.accent, 0.14), color: s.palette.accent, border: `1px solid ${alpha(s.palette.accent, 0.35)}`, borderRadius: 999, padding: '10px 22px', fontFamily: s.font.body, fontWeight: 600, fontSize: 28, ...enter, ...style}}>
      {children}
    </span>
  );
};

/** An icon from the project's assets, tinted already by the server. Falls back to a dot. */
export const Icon: React.FC<{src?: string | null; size?: number}> = ({src, size = 96}) => {
  const s = useStyle();
  if (src) return <Img src={asset(src)} style={{width: size, height: size, display: 'block'}} />;
  return <div style={{width: size * 0.5, height: size * 0.5, borderRadius: '50%', background: s.palette.accent}} />;
};

/** The brand's logo (if captured), else nothing. */
export const Logo: React.FC<{src?: string | null; height?: number; delay?: number}> = ({src, height = 72, delay = 0}) => {
  const s = useStyle();
  const enter = useEnter(delay, 'pop');
  if (!src) return null;
  const img = <Img src={asset(src)} style={{height, width: 'auto', maxWidth: 520, objectFit: 'contain', display: 'block'}} />;
  // A light logo on a light canvas (or dark on dark) would vanish: give it a chip.
  const lightBg = luminance(s.palette.bg) > 0.4;
  const clash = s.logoTone && (s.logoTone === 'light') === lightBg;
  if (!clash) return <div style={{display: 'inline-block', ...enter}}>{img}</div>;
  return (
    <div style={{display: 'inline-flex', padding: `${height * 0.22}px ${height * 0.38}px`, borderRadius: Math.min(s.radius, height * 0.5), background: s.logoTone === 'light' ? '#14161b' : '#ffffff', boxShadow: s.card.shadow === 'none' ? undefined : s.card.shadow, ...enter}}>
      {img}
    </div>
  );
};

/** Counts a number up from 0, starting at `delay`. Keeps the decimals of `to`. */
export function useCountUp(to: number, delay = 0, duration = 40): string {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, duration], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const eased = 1 - (1 - t) ** 3;
  const decimals = String(to).includes('.') ? String(to).split('.')[1].length : 0;
  const v = to * eased;
  return decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
}

/** Pick by layout with a default. */
export const isRight = (layout?: string) => layout === 'right';
export const isCenter = (layout?: string) => layout === 'center' || layout === 'full';

// ── vertical (9:16) helpers ─────────────────────────────────────────────────
// Phone frames are width-bound: a layout scaled from 16:9 ends up as a thin
// strip in the middle. These helpers give vertical branches a type unit tied
// to the width (u = 1 at 1080 wide) and a tall content block that sits between
// the top safe margin (~8%) and the caption band (bottom ~18%).

/** Vertical frame info. `v` is true only for clearly tall frames (H > 1.15 W). */
export function useVertical() {
  const {width: W, height: H} = useVideoConfig();
  const v = H > W * 1.15;
  const top = H * 0.08;
  const bottom = H * 0.18;
  return {v, W, H, u: W / 1080, top, bottom, side: W * 0.075, zoneH: H - top - bottom, blockH: H * 0.66};
}

/**
 * Vertical scene layout: an optional title at the top of a block ~66% of the
 * frame tall (centred above the caption band); the body fills the rest of the
 * block. Body children are laid out in a column (`justify` decides spacing).
 */
export const VFrame: React.FC<{
  children: ReactNode;
  /** Scene length; when given, the block fades out over the last frames. */
  durationFrames?: number;
  title?: ReactNode;
  titleGap?: number;
  blockH?: number;
  justify?: CSSProperties['justifyContent'];
  bodyStyle?: CSSProperties;
}> = ({children, durationFrames, title, titleGap, blockH, justify = 'space-evenly', bodyStyle}) => {
  const g = useVertical();
  const exit = useExit(durationFrames ?? 1e9);
  const h = Math.min(g.zoneH, blockH ?? g.blockH);
  return (
    <AbsoluteFill style={{padding: `${g.top}px ${g.side}px ${g.bottom}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: exit}}>
      <div style={{height: h, display: 'flex', flexDirection: 'column', minHeight: 0}}>
        {title ? <div style={{flex: 'none', marginBottom: titleGap ?? 56 * g.u}}>{title}</div> : null}
        <div style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: justify, ...bodyStyle}}>{children}</div>
      </div>
    </AbsoluteFill>
  );
};
