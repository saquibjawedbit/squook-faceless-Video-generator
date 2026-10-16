import {AbsoluteFill, Img, interpolate, useCurrentFrame} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {asset} from '../ir';
import {alpha, luminance, mix, useStyle} from '../styles';
import {useBeat, useEnter, useProgress} from './kit';
import {clamp01, useFrameBox} from './Hero';

// Text column (eyebrow, title, text, ticked bullets) beside a website
// screenshot in a drawn browser window. layout 'left' = image left,
// 'right' = image right. Vertical: image on top, text below.
// Secondary motion: slow push-in inside the window + an accent plate behind it
// drifting in parallax.

/** A browser window around a 16:10 screenshot. */
export const BrowserFrame: React.FC<{src?: string | null; width: number; tf: number; delay: number; from: -1 | 0 | 1; durationFrames: number}> = ({src, width, tf, delay, from, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const dark = luminance(s.palette.bg) < 0.3;
  const pE = useProgress(delay);
  const o = clamp01(pE * 1.5);
  const barH = Math.round(44 * tf);
  const r = Math.max(10, Math.min(s.radius, 18)) * tf;
  const screenH = (width * 10) / 16;
  const push = interpolate(frame, [delay, Math.max(delay + 1, durationFrames)], [1, 1.08], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const drift = interpolate(frame, [0, Math.max(1, durationFrames)], [0, 1]);
  const dot = 12 * tf;
  const chrome = dark ? mix(s.palette.surface, '#ffffff', 0.04) : mix(s.palette.surface, s.palette.text, 0.035);
  const plateOff = 28 * tf;
  const plateIn = clamp01(useProgress(delay + 6));

  return (
    <div style={{position: 'relative', width, height: screenH + barH, perspective: 2400}}>
      {/* accent plate behind the window (parallax) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: r * 1.2,
          background: `linear-gradient(135deg, ${alpha(s.palette.accent, dark ? 0.24 : 0.26)}, ${alpha(s.palette.accent2, dark ? 0.04 : 0.06)})`,
          transform: `translate(${(from >= 0 ? 1 : -1) * plateOff * (1 + 0.5 * drift)}px, ${plateOff * (1 + 0.5 * drift)}px)`,
          opacity: plateIn * 0.9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: r,
          overflow: 'hidden',
          background: s.palette.surface,
          border: `1px solid ${dark ? 'rgba(255,255,255,0.10)' : 'rgba(17,19,23,0.10)'}`,
          boxShadow: dark
            ? `0 ${40 * tf}px ${120 * tf}px rgba(0,0,0,0.55), 0 0 ${80 * tf}px ${alpha(s.palette.accent, 0.12)}`
            : `0 ${40 * tf}px ${100 * tf}px rgba(17,19,23,0.18), 0 ${8 * tf}px ${24 * tf}px rgba(17,19,23,0.08)`,
          opacity: o,
          transform: `rotateY(${(1 - pE) * from * 16}deg) translate(${(1 - pE) * from * 70 * tf}px, ${(1 - pE) * 50 * tf}px) scale(${0.94 + 0.06 * pE})`,
          transformOrigin: from < 0 ? '0% 50%' : from > 0 ? '100% 50%' : '50% 100%',
        }}
      >
        <div style={{height: barH, display: 'flex', alignItems: 'center', padding: `0 ${18 * tf}px`, gap: 8 * tf, background: chrome, borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(17,19,23,0.06)'}`}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{width: dot, height: dot, borderRadius: '50%', background: c, opacity: 0.9}} />
          ))}
          <div style={{flex: 1, display: 'flex', justifyContent: 'center'}}>
            <div style={{width: '44%', height: barH * 0.56, borderRadius: barH, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(17,19,23,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 * tf}}>
              <svg width={barH * 0.26} height={barH * 0.26} viewBox="0 0 24 24">
                <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" fill="none" stroke={s.palette.muted} strokeWidth={2.4} strokeLinejoin="round" />
              </svg>
              <div style={{width: '46%', height: barH * 0.12, borderRadius: 4, background: alpha(s.palette.muted, 0.35)}} />
            </div>
          </div>
          <div style={{width: dot * 3 + 16 * tf}} />
        </div>
        <div style={{position: 'relative', width: '100%', height: screenH, overflow: 'hidden', background: mix(s.palette.surface, s.palette.text, 0.06)}}>
          {src ? (
            <Img src={asset(src)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 0%', transform: `scale(${push})`, transformOrigin: '50% 15%', display: 'block'}} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

const Bullet: React.FC<{text: string; i: number; beats?: number[]; base: number; size: number; tf: number}> = ({text, i, beats, base, size, tf}) => {
  const s = useStyle();
  const d = useBeat(beats, i, base);
  const enter = useEnter(d);
  const draw = clamp01(useProgress(d + 4));
  const tick = size * 1.25;
  return (
    <div style={{display: 'flex', alignItems: 'flex-start', gap: 20 * tf, ...enter}}>
      <div style={{flex: 'none', width: tick, height: tick, borderRadius: Math.min(tick / 2, s.radius), background: alpha(s.palette.accent, 0.15), border: `1px solid ${alpha(s.palette.accent, 0.35)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: size * 0.02}}>
        <svg width={tick * 0.58} height={tick * 0.58} viewBox="0 0 24 24">
          <path d="M4 12.5l5 5L20 6.5" fill="none" stroke={s.palette.accent} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        </svg>
      </div>
      <div
        style={{
          fontFamily: s.font.body,
          fontSize: size,
          lineHeight: 1.3,
          color: s.palette.text,
          paddingTop: (tick - size * 1.3) / 2,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        } as CSSProperties}
      >
        {text}
      </div>
    </div>
  );
};

export const Split: React.FC<TemplateProps> = ({p, layout, beats, durationFrames}) => {
  const s = useStyle();
  const box = useFrameBox();
  const imageLeft = layout !== 'right';

  const eyebrow = p?.eyebrow ? String(p.eyebrow) : '';
  const title = String(p?.title ?? '').trim();
  const text = p?.text ? String(p.text) : '';
  const bullets: string[] = (Array.isArray(p?.bullets) ? p.bullets : []).filter((b: unknown) => b != null && String(b).trim()).map(String).slice(0, 4);
  const image = typeof p?.image === 'string' && p.image ? p.image : null;

  const upper = s.headingCase === 'upper';
  const n = title.length;
  const tSize = (box.vertical ? (n <= 24 ? 128 : n <= 44 ? 108 : 86) : n <= 24 ? 84 : n <= 44 ? 70 : 58) * s.scale * box.tf * (upper ? 0.88 : 1);
  const bodySize = (box.vertical ? 44 : 32) * box.tf;
  const bulletSize = (box.vertical ? 42 : 31) * box.tf;

  const tEye = 6;
  const tTitle = eyebrow ? 10 : 6;
  const tText = tTitle + 8;
  const tBullets = tText + (text ? 10 : 2);
  const tImg = 0;

  const eyeEnter = useEnter(tEye);
  const titleEnter = useEnter(tTitle);
  const textEnter = useEnter(tText);
  const rule = clamp01(useProgress(tEye + 2));

  const textCol = (
    <div style={{display: 'flex', flexDirection: 'column', minWidth: 0}}>
      {eyebrow ? (
        <div style={{display: 'flex', alignItems: 'center', gap: 16 * box.tf, marginBottom: 24 * box.tf, ...eyeEnter}}>
          <div style={{height: 2, width: 48 * box.tf * rule, background: s.palette.accent}} />
          <div style={{fontFamily: s.font.mono, fontSize: (box.vertical ? 32 : 24) * box.tf, letterSpacing: '0.18em', textTransform: 'uppercase', color: s.palette.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{eyebrow}</div>
        </div>
      ) : null}
      {title ? (
        <div
          style={{
            fontFamily: s.font.heading,
            fontWeight: s.headingWeight,
            fontSize: tSize,
            lineHeight: upper ? 1.0 : 1.08,
            letterSpacing: `${s.headingTracking}em`,
            textTransform: upper ? 'uppercase' : 'none',
            color: s.palette.text,
            textWrap: 'balance',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            paddingBottom: '0.06em',
            ...titleEnter,
          } as CSSProperties}
        >
          {title}
        </div>
      ) : null}
      {text ? (
        <div
          style={{
            fontFamily: s.font.body,
            fontSize: bodySize,
            lineHeight: 1.45,
            color: s.palette.muted,
            marginTop: 24 * box.tf,
            textWrap: 'pretty',
            display: '-webkit-box',
            WebkitLineClamp: bullets.length ? 3 : 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            ...textEnter,
          } as CSSProperties}
        >
          {text}
        </div>
      ) : null}
      {bullets.length ? (
        <div style={{display: 'flex', flexDirection: 'column', gap: 18 * box.tf, marginTop: 38 * box.tf}}>
          {bullets.map((b, i) => (
            <Bullet key={i} text={b} i={i} beats={beats} base={tBullets} size={bulletSize} tf={box.tf} />
          ))}
        </div>
      ) : null}
    </div>
  );

  const safe: CSSProperties = {position: 'absolute', left: box.pad.side, right: box.pad.side, top: box.pad.top, bottom: box.pad.bottom};

  if (box.vertical) {
    // Phone layout: a large screenshot on top (nearly full width), text below.
    const imgW = box.width * 0.9;
    return (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        <div style={{...safe, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 84 * box.tf}}>
          <div style={{marginLeft: (box.width * 0.84 - imgW) / 2 - 14 * box.tf}}>
            <BrowserFrame src={image} width={imgW - 28 * box.tf} tf={box.tf} delay={tImg} from={0} durationFrames={durationFrames} />
          </div>
          {textCol}
        </div>
      </AbsoluteFill>
    );
  }

  const innerW = box.width - box.pad.side * 2;
  const innerH = box.height - box.pad.top - box.pad.bottom;
  const gap = innerW * 0.06;
  const barH = 44 * box.tf;
  // Image column ~55% of the width, but never taller than the safe area.
  const imgW = Math.min(innerW * (box.square ? 0.56 : 0.55), ((innerH - barH - 40 * box.tf) * 16) / 10);
  const frameEl = <BrowserFrame src={image} width={imgW} tf={box.tf} delay={tImg} from={imageLeft ? -1 : 1} durationFrames={durationFrames} />;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{...safe, display: 'flex', flexDirection: 'row', alignItems: 'center', gap}}>
        {imageLeft ? <div style={{flex: 'none'}}>{frameEl}</div> : null}
        <div style={{flex: 1, minWidth: 0}}>{textCol}</div>
        {!imageLeft ? <div style={{flex: 'none'}}>{frameEl}</div> : null}
      </div>
    </AbsoluteFill>
  );
};
