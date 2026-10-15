import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {alpha, luminance, useStyle} from '../styles';
import {Logo, useBeat, useEnter, useProgress} from './kit';
import {WordReveal, clamp01, titleSize, useFrameBox, wordGap} from './Hero';

// Closing scene, centered. Logo → headline (word reveal) → subtitle → a button
// that pops in, gets pressed once (dip + ripple) and catches a light sweep →
// the URL typed out in mono. Secondary motion: slow push-in + breathing glow.

export const Cta: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const box = useFrameBox();
  const dark = luminance(s.palette.bg) < 0.3;

  const title = String(p?.title ?? '').trim() || ' ';
  const subtitle = p?.subtitle ? String(p.subtitle) : '';
  const button = p?.button ? String(p.button).slice(0, 32) : '';
  const url = p?.url ? String(p.url).replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 48) : '';
  const logo = typeof p?.logo === 'string' && p.logo ? p.logo : null;

  // Timeline
  const tLogo = 2;
  const tTitle = Math.max(useBeat(beats, 0, logo ? 10 : 4), 2);
  const nWords = Math.min(18, title.split(/\s+/).filter(Boolean).length);
  const tSub = tTitle + Math.round(nWords * wordGap(s.stagger, nWords)) + 4;
  const tBtn = Math.max(useBeat(beats, 1, tSub + (subtitle ? 10 : 2)), tSub);
  const tPress = tBtn + 26;
  const tUrl = tBtn + 12;

  const size = titleSize(title, box.vertical) * 0.9 * s.scale * box.tf * (s.headingCase === 'upper' ? 0.86 : 1);
  const subEnter = useEnter(tSub);
  const urlEnter = useEnter(tUrl);
  const glowIn = clamp01(useProgress(0));

  // Button pop: a livelier spring than the pack's so it always "lands".
  const pop = spring({frame: frame - tBtn, fps, config: {damping: 11, stiffness: 190, mass: 0.7}});
  const press = interpolate(frame, [tPress, tPress + 4, tPress + 14], [1, 0.94, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const ripple = interpolate(frame, [tPress + 2, tPress + 30], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const shine = interpolate(frame, [tPress + 4, tPress + 26], [-0.6, 1.6], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const arrowNudge = interpolate(frame, [tPress, tPress + 5, tPress + 16], [0, 8, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const breathe = 0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 0.8);

  // Secondary: slow push-in.
  const push = interpolate(frame, [0, Math.max(1, durationFrames)], [1, 1.04], {extrapolateRight: 'clamp'});

  // URL typed out.
  const typeN = Math.floor(interpolate(frame, [tUrl + 4, tUrl + 4 + Math.max(8, url.length * 1.1)], [0, url.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const caretOn = typeN < url.length || Math.floor(frame / 15) % 2 === 0;

  const btnH = (box.vertical ? 120 : 104) * box.tf;
  const btnFont = (box.vertical ? 44 : 38) * box.tf * Math.min(1.1, s.scale);
  const btnRadius = s.radius >= 14 ? 999 : Math.max(6, s.radius * 1.4);
  const subSize = (box.vertical ? 44 : 40) * box.tf * Math.max(0.95, Math.min(1.1, s.scale));

  const glowR = Math.min(box.width, box.height) * 0.7;
  const cy = (box.pad.top + box.height - box.pad.bottom) / 2;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: box.width / 2 - glowR,
          top: cy - glowR * 0.55,
          width: glowR * 2,
          height: glowR * 1.1,
          borderRadius: '50%',
          background: `radial-gradient(closest-side, ${alpha(s.palette.accent, (dark ? 0.2 : 0.11) * (0.7 + 0.3 * breathe) * glowIn)}, ${alpha(s.palette.accent, 0)})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: box.pad.side,
          right: box.pad.side,
          top: box.pad.top,
          bottom: box.pad.bottom,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${push})`,
        }}
      >
        {logo ? (
          <div style={{marginBottom: 44 * box.tf}}>
            <Logo src={logo} height={(box.vertical ? 96 : 80) * box.tf} delay={tLogo} />
          </div>
        ) : null}
        <div style={{width: '100%', maxWidth: box.vertical ? '100%' : box.width * 0.78}}>
          <WordReveal text={title} delay={tTitle} size={size} align="center" accentLast={false} />
        </div>
        {subtitle ? (
          <div
            style={{
              fontFamily: s.font.body,
              fontSize: subSize,
              lineHeight: 1.4,
              color: s.palette.muted,
              textAlign: 'center',
              textWrap: 'balance',
              maxWidth: box.vertical ? '94%' : box.width * 0.55,
              marginTop: 28 * box.tf,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              ...subEnter,
            } as CSSProperties}
          >
            {subtitle}
          </div>
        ) : null}

        {button ? (
          <div style={{position: 'relative', marginTop: 56 * box.tf, opacity: clamp01(pop * 2), transform: `scale(${(0.5 + 0.5 * pop) * press})`}}>
            {/* ripple from the press */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: btnRadius,
                border: `${Math.max(2, 3 * box.tf)}px solid ${s.palette.accent}`,
                opacity: ripple > 0 && ripple < 1 ? (1 - ripple) * 0.7 : 0,
                transform: `scale(${1 + ripple * 0.35}, ${1 + ripple * 0.9})`,
              }}
            />
            <div
              style={{
                position: 'relative',
                height: btnH,
                padding: `0 ${btnH * 0.55}px`,
                display: 'flex',
                alignItems: 'center',
                gap: btnFont * 0.55,
                borderRadius: btnRadius,
                background: s.palette.accent,
                color: s.palette.onAccent,
                fontFamily: s.font.body,
                fontWeight: 700,
                fontSize: btnFont,
                letterSpacing: s.headingCase === 'upper' ? '0.06em' : '-0.005em',
                textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                boxShadow: dark
                  ? `0 0 ${50 + 30 * breathe}px ${alpha(s.palette.accent, 0.35 + 0.15 * breathe)}, inset 0 1px 0 rgba(255,255,255,0.25)`
                  : `0 ${18 * box.tf}px ${44 * box.tf}px ${alpha(s.palette.accent, 0.32)}, inset 0 1px 0 rgba(255,255,255,0.3)`,
              }}
            >
              <span>{button}</span>
              <svg width={btnFont * 0.8} height={btnFont * 0.8} viewBox="0 0 24 24" style={{transform: `translateX(${arrowNudge * box.tf}px)`, flex: 'none'}}>
                <path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {/* light sweep */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: '40%',
                  left: `${shine * 100}%`,
                  transform: 'skewX(-20deg)',
                  background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0))',
                  opacity: shine > -0.6 && shine < 1.6 ? 1 : 0,
                }}
              />
            </div>
          </div>
        ) : null}

        {url ? (
          <div
            style={{
              marginTop: (button ? 34 : 48) * box.tf,
              fontFamily: s.font.mono,
              fontSize: (box.vertical ? 34 : 30) * box.tf,
              letterSpacing: '0.04em',
              color: button ? s.palette.muted : s.palette.accent,
              whiteSpace: 'nowrap',
              ...urlEnter,
            }}
          >
            <span>{url.slice(0, typeN)}</span>
            <span style={{visibility: 'hidden'}}>{url.slice(typeN)}</span>
            <span
              style={{
                display: 'inline-block',
                width: '0.08em',
                height: '1.05em',
                marginLeft: '0.12em',
                verticalAlign: '-0.15em',
                background: s.palette.accent,
                opacity: caretOn ? 0.9 : 0,
                position: 'relative',
                left: `${-(url.length - typeN) * 0.64}em`,
              }}
            />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
