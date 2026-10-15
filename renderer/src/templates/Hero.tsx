import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {alpha, luminance, useStyle} from '../styles';
import {Logo, isCenter, useBeat, useEnter, useProgress} from './kit';

// Opening title scene. Logo → eyebrow (with drawn rules) → headline revealed
// word by word from a mask → subtitle. Secondary motion: a slow push-in on the
// whole block plus a softly breathing accent glow (center) / drifting accent
// ring and a drawn accent bar (left).

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Frame geometry: type scale factor + caption-safe padding (px). */
export function useFrameBox() {
  const {width, height} = useVideoConfig();
  const r = width / height;
  const vertical = r < 0.8;
  const square = !vertical && r < 1.3;
  const tf = vertical ? width / 1150 : square ? width / 1350 : Math.min(width / 1920, height / 1080);
  return {
    width, height, vertical, square, tf,
    pad: {top: height * (vertical ? 0.08 : 0.08), bottom: height * 0.18, side: width * (vertical ? 0.08 : 0.075)},
  };
}

/** Frames between words: the pack's rhythm, compressed so long titles finish in ~1.2s. */
export const wordGap = (stagger: number, n: number) => Math.max(1.5, Math.min(stagger * 0.7, 36 / Math.max(1, n)));

export function titleSize(title: string, vertical: boolean): number {
  const n = title.length;
  if (vertical) return n <= 16 ? 180 : n <= 30 ? 150 : n <= 50 ? 122 : n <= 80 ? 98 : 80;
  return n <= 18 ? 150 : n <= 32 ? 128 : n <= 52 ? 104 : n <= 80 ? 86 : 72;
}

/** Headline revealed word by word, each word rising out of its own mask. */
export const WordReveal: React.FC<{text: string; delay: number; size: number; align: 'left' | 'center'; accentLast?: boolean}> = ({text, delay, size, align, accentLast}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = useStyle();
  let words = text.split(/\s+/).filter(Boolean);
  if (words.length > 18) words = [...words.slice(0, 17), words[17] + '…'];
  const gap = wordGap(s.stagger, words.length);
  const upper = s.headingCase === 'upper';
  return (
    <div
      style={{
        fontFamily: s.font.heading,
        fontWeight: s.headingWeight,
        fontSize: size,
        lineHeight: upper ? 1.0 : 1.06,
        letterSpacing: `${s.headingTracking}em`,
        textTransform: upper ? 'uppercase' : 'none',
        color: s.palette.text,
        textAlign: align,
        textWrap: 'balance',
        overflowWrap: 'anywhere',
      } as CSSProperties}
    >
      {words.map((w, i) => {
        const p = spring({frame: frame - delay - i * gap, fps, config: s.spring});
        const o = clamp01(p * 1.4);
        const last = accentLast && i === words.length - 1;
        return (
          <span key={i}>
            <span style={{display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', padding: '0.08em 0.02em 0.12em', margin: '-0.08em -0.02em -0.12em'}}>
              <span
                style={{
                  display: 'inline-block',
                  transform: `translateY(${(1 - p) * 110}%) rotate(${(1 - p) * 3}deg)`,
                  transformOrigin: '0% 100%',
                  opacity: o,
                  filter: s.enter === 'blur' ? `blur(${(1 - o) * 10}px)` : undefined,
                  color: last ? s.palette.accent : undefined,
                }}
              >
                {w}
              </span>
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </div>
  );
};

export const Hero: React.FC<TemplateProps> = ({p, layout, beats, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const box = useFrameBox();
  const center = isCenter(layout) || (box.vertical && layout !== 'left');
  const dark = luminance(s.palette.bg) < 0.3;

  const title = String(p?.title ?? '').trim() || ' ';
  const eyebrow = p?.eyebrow ? String(p.eyebrow) : '';
  const subtitle = p?.subtitle ? String(p.subtitle) : '';
  const logo = typeof p?.logo === 'string' && p.logo ? p.logo : null;

  // Timeline (frames from scene start); beats[0] may move the headline onto a word cue.
  const t0 = 4;
  const tLogo = t0;
  const tEyebrow = t0 + (logo ? 8 : 0);
  const tTitle = Math.max(useBeat(beats, 0, tEyebrow + (eyebrow ? 8 : 2)), tEyebrow + 4);
  const nWords = Math.min(18, title.split(/\s+/).filter(Boolean).length);
  const tSub = tTitle + Math.round(nWords * wordGap(s.stagger, nWords)) + 4;

  const align: 'left' | 'center' = center ? 'center' : 'left';
  const size = titleSize(title, box.vertical) * s.scale * box.tf * (s.headingCase === 'upper' ? 0.86 : 1);
  const accentLast = nWords >= 3;

  // Secondary motion: slow push-in over the whole scene.
  const push = interpolate(frame, [0, Math.max(1, durationFrames)], [1, 1.045], {extrapolateRight: 'clamp'});
  const breathe = 0.75 + 0.25 * Math.sin((frame / 30) * Math.PI * 0.5);

  const eyebrowEnter = useEnter(tEyebrow);
  const eyebrowP = clamp01(useProgress(tEyebrow + 2));
  const subEnter = useEnter(tSub);
  const barP = clamp01(useProgress(tTitle - 2));
  const ringP = useProgress(t0);

  const eyebrowSize = 26 * box.tf * (box.vertical ? 1.25 : 1);
  const subSize = (box.vertical ? 46 : 42) * box.tf * Math.max(0.95, Math.min(1.1, s.scale));
  const ruleW = 64 * box.tf * eyebrowP;

  const eyebrowEl = eyebrow ? (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: center ? 'center' : 'flex-start', gap: 18 * box.tf, marginBottom: 30 * box.tf, ...eyebrowEnter}}>
      <div style={{height: 2, width: ruleW, background: s.palette.accent, opacity: 0.8}} />
      <div style={{fontFamily: s.font.mono, fontSize: eyebrowSize, letterSpacing: '0.2em', textTransform: 'uppercase', color: s.palette.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: box.width * 0.7}}>
        {eyebrow}
      </div>
      {center ? <div style={{height: 2, width: ruleW, background: s.palette.accent, opacity: 0.8}} /> : null}
    </div>
  ) : null;

  const subEl = subtitle ? (
    <div
      style={{
        fontFamily: s.font.body,
        fontSize: subSize,
        lineHeight: 1.4,
        color: s.palette.muted,
        textAlign: align,
        textWrap: 'pretty',
        maxWidth: center ? (box.vertical ? '92%' : '62%') : box.vertical ? '100%' : '78%',
        marginTop: 36 * box.tf,
        marginLeft: center ? 'auto' : 0,
        marginRight: center ? 'auto' : 0,
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        ...subEnter,
      } as CSSProperties}
    >
      {subtitle}
    </div>
  ) : null;

  const logoEl = logo ? (
    <div style={{display: 'flex', justifyContent: center ? 'center' : 'flex-start', marginBottom: 48 * box.tf}}>
      <Logo src={logo} height={(box.vertical ? 84 : 72) * box.tf} delay={tLogo} />
    </div>
  ) : null;

  const safe: CSSProperties = {
    position: 'absolute',
    left: box.pad.side,
    right: box.pad.side,
    top: box.pad.top,
    bottom: box.pad.bottom,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };

  if (center) {
    const glowR = Math.min(box.width, box.height) * 0.75;
    return (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        {/* soft breathing glow behind the headline */}
        <div
          style={{
            position: 'absolute',
            left: box.width / 2 - glowR,
            top: (box.pad.top + box.height - box.pad.bottom) / 2 - glowR * 0.6,
            width: glowR * 2,
            height: glowR * 1.2,
            borderRadius: '50%',
            background: `radial-gradient(closest-side, ${alpha(s.palette.accent, (dark ? 0.2 : 0.12) * breathe * clamp01(ringP))}, ${alpha(s.palette.accent, 0)})`,
          }}
        />
        <div style={{...safe, alignItems: 'center', transform: `scale(${push})`}}>
          <div style={{width: '100%', maxWidth: box.vertical ? '100%' : box.width * 0.8}}>
            {logoEl}
            {eyebrowEl}
            <WordReveal text={title} delay={tTitle} size={size} align="center" accentLast={accentLast} />
            {subEl}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  // Left: asymmetric. Drawn accent bar beside the block, large outlined ring
  // drifting slowly on the right.
  const ringD = Math.min(box.width, box.height) * (box.vertical ? 0.9 : 0.95);
  const drift = interpolate(frame, [0, Math.max(1, durationFrames)], [0, -40 * box.tf]);
  const ringRot = interpolate(frame, [0, Math.max(1, durationFrames)], [-8, 8]);
  const barW = Math.max(4, 6 * box.tf);
  return (
    <AbsoluteFill style={{pointerEvents: 'none', overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          width: ringD,
          height: ringD,
          right: -ringD * (box.vertical ? 0.45 : 0.22),
          top: box.vertical ? box.height * 0.06 : (box.height * 0.84 - ringD) / 2,
          transform: `translateY(${drift}px) rotate(${ringRot}deg) scale(${0.85 + 0.15 * ringP})`,
          opacity: clamp01(ringP),
        }}
      >
        <div style={{position: 'absolute', inset: 0, borderRadius: '50%', border: `${Math.max(2, 2 * box.tf)}px solid ${alpha(s.palette.accent, dark ? 0.35 : 0.3)}`}} />
        <div style={{position: 'absolute', inset: '14%', borderRadius: '50%', border: `1px dashed ${alpha(s.palette.accent, dark ? 0.25 : 0.22)}`}} />
        <div style={{position: 'absolute', inset: '30%', borderRadius: '50%', background: `radial-gradient(closest-side, ${alpha(s.palette.accent, (dark ? 0.32 : 0.18) * breathe)}, ${alpha(s.palette.accent, 0)})`}} />
        <div style={{position: 'absolute', width: '4%', height: '4%', left: '48%', top: '-2%', borderRadius: '50%', background: s.palette.accent}} />
      </div>
      <div style={{...safe, alignItems: 'flex-start', transform: `scale(${push})`, transformOrigin: '0% 50%'}}>
        <div style={{display: 'flex', gap: 44 * box.tf, alignItems: 'stretch', width: box.vertical ? '100%' : '78%'}}>
          <div style={{width: barW, flex: 'none', borderRadius: barW, background: `linear-gradient(${s.palette.accent}, ${alpha(s.palette.accent, 0.15)})`, transform: `scaleY(${barP})`, transformOrigin: '50% 0%'}} />
          <div style={{flex: 1, minWidth: 0, padding: `${8 * box.tf}px 0`}}>
            {logoEl}
            {eyebrowEl}
            <WordReveal text={title} delay={tTitle} size={size} align="left" accentLast={accentLast} />
            {subEl}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
