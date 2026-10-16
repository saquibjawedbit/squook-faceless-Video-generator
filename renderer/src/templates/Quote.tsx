import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {isCenter, useEnter} from './kit';
import {useStyle} from '../styles';
import {resolveFont} from '../fonts';

// Quote: an oversized quotation mark, the quote lighting up word by word
// (read-along), then an accent rule that draws in ahead of author + role.

const str = (v: unknown, max = 400): string => {
  const t = (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim();
  const c = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return c.length > max ? c.slice(0, max - 1).trimEnd() + '…' : c;
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const Quote: React.FC<TemplateProps> = ({p, layout, beats, fps, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const text = str(p?.text);
  const author = str(p?.author, 60);
  const role = str(p?.role, 80);

  const center = isCenter(layout);
  const vertical = H > W * 1.1;
  const u = Math.min(W, H) / 1080;

  // ── timing ────────────────────────────────────────────────────────────────
  const b0 = Number.isFinite(beats?.[0]) ? Math.round((beats![0] as number) * fps) : 6;
  const words = text ? text.split(' ') : [];
  const textStart = b0 + 6;
  const span = Math.min(durationFrames * 0.5, Math.max(12, words.length * 3.2));
  const per = words.length > 1 ? span / (words.length - 1) : 0;
  const b1 = Number.isFinite(beats?.[1]) ? Math.round((beats![1] as number) * fps) : null;
  const authorAt = Math.min(durationFrames - 20, Math.max(b1 ?? 0, textStart + span * 0.7));

  const markEnter = spring({frame: frame - b0, fps, config: s.spring});
  const boxEnter = useEnter(b0);
  const authorEnter = useEnter(authorAt + 6);
  const rule = interpolate(frame, [authorAt, authorAt + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rule2 = 1 - (1 - rule) ** 3;
  if (!text) return null;

  // ── type size by length ───────────────────────────────────────────────────
  const len = text.length;
  const baseFs = len < 50 ? 96 : len < 90 ? 82 : len < 150 ? 70 : len < 240 ? 56 : 46;
  const lh = s.headingCase === 'upper' ? 1.08 : 1.22;
  const maxW = vertical ? W * 0.86 : Math.min(W * 0.72, 1460 * u);
  const zoneH = H * 0.74;
  // Vertical: type sized so the quote fills ~55% of the frame height (by an
  // estimate of the wrapped line count), within sensible limits.
  const cw = s.headingCase === 'upper' ? 0.46 : 0.5;
  const fitV = (() => {
    for (let f = 190 * u; f > 52 * u; f -= 2 * u) {
      const perLine = Math.max(6, Math.floor(maxW / (cw * f)));
      const lines = Math.ceil((len * 1.08) / perLine);
      if (lines * f * lh <= H * 0.5) return f;
    }
    return 52 * u;
  })();
  const fs = vertical ? fitV : baseFs * Math.min(1.12, s.scale) * u;
  const maxLines = Math.max(2, Math.floor((zoneH * (vertical ? 0.7 : 0.62)) / (fs * lh)));
  const markSize = (vertical ? 380 : 320) * u;
  const float = Math.sin((frame / fps) * 1.1) * 6 * u;

  const av = vertical ? 1.4 : 1; // author block scale
  const ghost = 0.14;
  const align = center ? 'center' : 'left';

  return (
    <AbsoluteFill
      style={{
        padding: `${H * 0.07}px ${(W - maxW) / 2}px ${H * 0.18}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: center ? 'center' : 'flex-start',
      }}
    >
      <div
        style={{
          fontFamily: s.id === 'tech' ? s.font.heading : resolveFont('Playfair Display') ?? 'serif', fontWeight: 700, fontSize: markSize, lineHeight: 0.62, height: markSize * 0.42,
          color: s.palette.accent, opacity: clamp01(markEnter * 1.4) * 0.95,
          transform: `translateY(${float + (1 - markEnter) * 40 * u}px) scale(${0.6 + 0.4 * markEnter}) rotate(${(1 - markEnter) * -10}deg)`,
          transformOrigin: center ? '50% 50%' : '0% 50%', marginLeft: center ? 0 : -markSize * 0.04,
          marginBottom: 28 * u,
        }}
      >
        “
      </div>
      <div
        style={{
          ...boxEnter,
          fontFamily: s.font.heading, fontWeight: s.id === 'bold' ? s.headingWeight : Math.min(s.headingWeight, 600),
          fontSize: fs, lineHeight: lh, letterSpacing: `${Math.min(s.headingTracking, -0.005)}em`,
          textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none',
          color: s.palette.text, textAlign: align, textWrap: 'balance', maxWidth: maxW,
          display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        } as CSSProperties}
      >
        {words.map((w, i) => {
          const t = textStart + i * per;
          const lit = clamp01((frame - t) / 5);
          return (
            <span key={i} style={{opacity: ghost + (1 - ghost) * lit, display: 'inline'}}>
              {w}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </div>
      {author || role ? (
        <div style={{display: 'flex', alignItems: 'center', gap: 26 * u * av, marginTop: 52 * u * av, flexDirection: center ? 'column' : 'row'}}>
          <div style={{width: 72 * u * av * rule2, height: 4 * u * av, borderRadius: 2, background: s.palette.accent, flex: 'none'}} />
          <div style={{...authorEnter, textAlign: align}}>
            {author ? <div style={{fontFamily: s.font.body, fontWeight: 700, fontSize: 36 * u * av, color: s.palette.text, letterSpacing: '-0.01em'}}>{author}</div> : null}
            {role ? <div style={{fontFamily: s.font.body, fontSize: 28 * u * av, color: s.palette.muted, marginTop: 6 * u * av}}>{role}</div> : null}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
