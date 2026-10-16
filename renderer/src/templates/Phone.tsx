import {AbsoluteFill, Easing, Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {asset} from '../ir';
import {alpha, luminance, useStyle} from '../styles';
import {isLite} from '../styles';
import {useEnter, useProgress} from './kit';
import {clamp01, useFrameBox} from './Hero';

// A phone (drawn in CSS: titanium frame, side buttons, dynamic island, glass
// sheen) showing a mobile screenshot that scrolls up slowly through the scene.
// The device swings in with a 3D turn, then floats. Title + text beside it
// (layout 'left' | 'right' = phone side). Vertical: title above, phone below.

const Device: React.FC<{src?: string | null; height: number; side: -1 | 0 | 1; delay: number; durationFrames: number}> = ({src, height, side, delay, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dark = luminance(s.palette.bg) < 0.3;
  const W = height * 0.49;
  const H = height;
  const bezel = W * 0.042;
  const R = W * 0.165;
  const sW = W - bezel * 2;
  const sH = H - bezel * 2;

  const pE = useProgress(delay);
  const o = clamp01(pE * 1.6);
  const t = frame / fps;
  const float = Math.sin(t * Math.PI * 0.55) * H * 0.01;
  const sway = Math.sin(t * Math.PI * 0.4) * 1.5;
  // Turn toward the text: phone on the left faces right and vice versa.
  const restY = side * -18;
  const rotY = restY + (1 - pE) * side * -28 + sway;
  const rotX = 5 + (1 - pE) * 8;

  // Scroll: the image sits in a box 25% taller than the screen, cover-cropped;
  // objectPosition walks through any extra height of a long screenshot while
  // the box itself slides up, so even a screen-sized shot moves.
  const sT = interpolate(frame, [delay + 24, Math.max(delay + 25, durationFrames - 10)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const over = 0.25;

  const btn = (top: number, h: number, left: boolean): CSSProperties => ({
    position: 'absolute',
    top: H * top,
    height: H * h,
    width: W * 0.018,
    [left ? 'left' : 'right']: -W * 0.012,
    borderRadius: W * 0.01,
    background: 'linear-gradient(90deg, #2b2d33, #4a4d55, #2b2d33)',
  });

  return (
    <div style={{position: 'relative', width: W, height: H, perspective: H * 2.2, opacity: o}}>
      {/* floor shadow */}
      <div
        style={{
          position: 'absolute',
          left: W * 0.08,
          right: W * 0.08,
          bottom: -H * 0.05,
          height: H * 0.06,
          borderRadius: '50%',
          background: `radial-gradient(closest-side, ${dark ? alpha(s.palette.accent, 0.28) : 'rgba(17,19,23,0.22)'}, rgba(0,0,0,0))`,
          transform: `scale(${1 - float / (H * 0.03)})`,
          filter: isLite() ? undefined : `blur(${H * 0.01}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${float + (1 - pE) * H * 0.12}px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${0.92 + 0.08 * pE})`,
          transformStyle: 'preserve-3d',
        }}
      >
        <div style={btn(0.16, 0.035, true)} />
        <div style={btn(0.22, 0.065, true)} />
        <div style={btn(0.3, 0.065, true)} />
        <div style={btn(0.25, 0.1, false)} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: R,
            background: 'linear-gradient(145deg, #5a5d66 0%, #1d1f24 22%, #121317 60%, #3c3f47 100%)',
            boxShadow: dark
              ? `0 0 0 1px rgba(255,255,255,0.14), 0 ${H * 0.06}px ${H * 0.14}px rgba(0,0,0,0.6), 0 0 ${H * 0.12}px ${alpha(s.palette.accent, 0.18)}`
              : `0 ${H * 0.06}px ${H * 0.12}px rgba(17,19,23,0.28), 0 ${H * 0.01}px ${H * 0.03}px rgba(17,19,23,0.18)`,
            padding: bezel,
          }}
        >
          {/* inner black bezel ring */}
          <div style={{position: 'absolute', inset: W * 0.012, borderRadius: R - W * 0.012, background: '#050506'}} />
          <div style={{position: 'relative', width: sW, height: sH, borderRadius: R - bezel, overflow: 'hidden', background: s.palette.surface}}>
            {src ? (
              <Img
                src={asset(src)}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: sH * (1 + over),
                  objectFit: 'cover',
                  objectPosition: `50% ${sT * 100}%`,
                  transform: `translateY(${-sT * over * sH}px)`,
                  display: 'block',
                }}
              />
            ) : (
              <div style={{position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${alpha(s.palette.accent, 0.25)}, ${s.palette.surface})`}} />
            )}
            {/* glass sheen */}
            <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 28%, rgba(255,255,255,0) 42%)'}} />
            {/* dynamic island */}
            <div style={{position: 'absolute', top: sH * 0.014, left: (sW - sW * 0.31) / 2, width: sW * 0.31, height: sH * 0.042, borderRadius: sH, background: '#000'}}>
              <div style={{position: 'absolute', right: sH * 0.012, top: sH * 0.011, width: sH * 0.02, height: sH * 0.02, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #2a3550, #07080c 70%)'}} />
            </div>
            {/* home indicator */}
            <div style={{position: 'absolute', bottom: sH * 0.01, left: (sW - sW * 0.34) / 2, width: sW * 0.34, height: sH * 0.006, borderRadius: sH, background: 'rgba(17,19,23,0.55)', boxShadow: '0 0 0 1px rgba(255,255,255,0.35)'}} />
          </div>
          {/* rim highlight */}
          <div style={{position: 'absolute', inset: 0, borderRadius: R, boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.18), inset 0 1px 0 rgba(255,255,255,0.3)', pointerEvents: 'none'}} />
        </div>
      </div>
    </div>
  );
};

export const Phone: React.FC<TemplateProps> = ({p, layout, durationFrames}) => {
  const s = useStyle();
  const box = useFrameBox();
  const phoneRight = layout === 'right';

  const eyebrow = p?.eyebrow ? String(p.eyebrow) : '';
  const title = String(p?.title ?? '').trim();
  const text = p?.text ? String(p.text) : '';
  const image = typeof p?.image === 'string' && p.image ? p.image : null;

  const upper = s.headingCase === 'upper';
  const n = title.length;
  const tSize = (box.vertical ? (n <= 22 ? 104 : n <= 44 ? 86 : 70) : n <= 22 ? 92 : n <= 44 ? 76 : 62) * s.scale * box.tf * (upper ? 0.88 : 1);
  const bodySize = (box.vertical ? 38 : 34) * box.tf;

  const tPhone = 0;
  const tEye = 6;
  const tTitle = eyebrow ? 10 : 6;
  const tText = tTitle + 9;
  const eyeEnter = useEnter(tEye);
  const titleEnter = useEnter(tTitle);
  const textEnter = useEnter(tText);
  const rule = clamp01(useProgress(tTitle + 6));

  const align: 'left' | 'center' = box.vertical ? 'center' : 'left';
  const hasText = Boolean(title || text || eyebrow);

  const textCol = hasText ? (
    <div style={{display: 'flex', flexDirection: 'column', alignItems: box.vertical ? 'center' : 'flex-start', minWidth: 0, textAlign: align}}>
      {eyebrow ? (
        <div style={{fontFamily: s.font.mono, fontSize: (box.vertical ? 28 : 24) * box.tf, letterSpacing: '0.18em', textTransform: 'uppercase', color: s.palette.accent, marginBottom: 22 * box.tf, ...eyeEnter}}>{eyebrow}</div>
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
            WebkitLineClamp: box.vertical ? 3 : 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            paddingBottom: '0.06em',
            ...titleEnter,
          } as CSSProperties}
        >
          {title}
        </div>
      ) : null}
      {title && !box.vertical ? (
        <div style={{height: Math.max(3, 4 * box.tf), width: 72 * box.tf * rule, background: s.palette.accent, borderRadius: 4, marginTop: 32 * box.tf}} />
      ) : null}
      {text ? (
        <div
          style={{
            fontFamily: s.font.body,
            fontSize: bodySize,
            lineHeight: 1.45,
            color: s.palette.muted,
            marginTop: (box.vertical ? 24 : 30) * box.tf,
            textWrap: 'pretty',
            maxWidth: box.vertical ? '92%' : '100%',
            display: '-webkit-box',
            WebkitLineClamp: box.vertical ? 3 : 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            ...textEnter,
          } as CSSProperties}
        >
          {text}
        </div>
      ) : null}
    </div>
  ) : null;

  const innerW = box.width - box.pad.side * 2;
  const innerH = box.height - box.pad.top - box.pad.bottom;
  const safe: CSSProperties = {position: 'absolute', left: box.pad.side, right: box.pad.side, top: box.pad.top, bottom: box.pad.bottom};

  if (box.vertical) {
    const textShare = !hasText ? 0 : text ? 0.3 : 0.2;
    const phoneH = Math.min(innerH * (1 - textShare) - 60 * box.tf, (innerW * 0.8) / 0.49);
    return (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        <div style={{...safe, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 64 * box.tf}}>
          {textCol}
          <Device src={image} height={phoneH} side={0} delay={tPhone} durationFrames={durationFrames} />
        </div>
      </AbsoluteFill>
    );
  }

  const phoneH = innerH * 0.96;
  if (!hasText) {
    return (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        <div style={{...safe, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Device src={image} height={phoneH} side={phoneRight ? 1 : -1} delay={tPhone} durationFrames={durationFrames} />
        </div>
      </AbsoluteFill>
    );
  }
  const phoneW = phoneH * 0.49;
  const side: -1 | 1 = phoneRight ? 1 : -1;
  const phoneEl = (
    <div style={{flex: 'none', width: Math.max(phoneW * 1.5, innerW * 0.42), display: 'flex', justifyContent: 'center'}}>
      <Device src={image} height={phoneH} side={side} delay={tPhone} durationFrames={durationFrames} />
    </div>
  );
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{...safe, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: innerW * 0.04}}>
        {!phoneRight ? phoneEl : null}
        <div style={{flex: 1, minWidth: 0, maxWidth: innerW * 0.5, marginLeft: phoneRight ? 'auto' : 0}}>{textCol}</div>
        {phoneRight ? phoneEl : null}
      </div>
    </AbsoluteFill>
  );
};
