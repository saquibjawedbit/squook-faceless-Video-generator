import {AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {Heading, useEnter} from './kit';
import {asset} from '../ir';
import {alpha, useStyle} from '../styles';

// Logos: a calm wall of logos in quiet tiles, greyscale and softened, landing
// in a stagger. Once all are in, a spotlight passes along the row and briefly
// brings each one back to full colour.

const str = (v: unknown, max = 80): string => {
  const t = (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

export const Logos: React.FC<TemplateProps> = ({p, beats, fps, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const title = str(p?.title);
  const logos: string[] = (Array.isArray(p?.logos) ? p.logos : [])
    .map((l: unknown) => (typeof l === 'string' ? l : l && typeof (l as any).src === 'string' ? (l as any).src : ''))
    .filter(Boolean)
    .slice(0, 12);
  const n = logos.length;
  if (!n && !title) return null;

  const vertical = H > W * 1.1;
  const square = !vertical && W < H * 1.35;
  const u = Math.min(W, H) / 1080;
  const cols = vertical ? (n <= 2 ? n : n <= 6 ? 2 : 3) : square ? (n <= 3 ? n : n === 4 ? 2 : 3) : n <= 5 ? n : n === 6 || n === 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(n / Math.max(1, cols)));
  const availW = W * (vertical ? 0.84 : 0.8);
  const gap = 24 * u;
  const cellW = Math.min(420 * u, (availW - gap * (cols - 1)) / Math.max(1, cols));
  const availH = H * 0.6 - (title ? 140 * u : 0);
  const cellH = Math.min(cellW * 0.52, (availH - gap * (rows - 1)) / rows);

  const at = logos.map((_, i) => {
    const b = beats?.[i + (title ? 1 : 0)];
    return Number.isFinite(b) ? Math.round((b as number) * fps) : 10 + i * Math.max(3, s.stagger);
  });
  const titleAt = title && Number.isFinite(beats?.[0]) ? Math.round((beats![0] as number) * fps) : 0;
  const lastIn = at.length ? Math.max(...at) : 0;
  const sweepStart = lastIn + 18;
  const sweepGap = Math.max(4, Math.min(10, (durationFrames - 16 - sweepStart) / Math.max(1, n)));

  const short = title.length <= 34;
  return (
    <AbsoluteFill style={{padding: `${H * 0.07}px 0 ${H * 0.18}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
      {title ? (
        short ? (
          <TitleLabel text={title} delay={titleAt} />
        ) : (
          <Heading size={64 * u} delay={titleAt} align="center" style={{maxWidth: availW, marginBottom: 56 * u}}>
            {title}
          </Heading>
        )
      ) : null}
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, gap, justifyContent: 'center'}}>
        {logos.map((src, i) => {
          const lit = interpolate(frame - (sweepStart + i * sweepGap), [0, 8, 26], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return <Cell key={i} src={src} delay={at[i]} w={cellW} h={cellH} lit={lit} />;
        })}
      </div>
    </AbsoluteFill>
  );
};

const TitleLabel: React.FC<{text: string; delay: number}> = ({text, delay}) => {
  const s = useStyle();
  const {width: W, height: H} = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const enter = useEnter(delay);
  const frame = useCurrentFrame();
  const grow = interpolate(frame - delay, [4, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rule: CSSProperties = {height: 1, width: 90 * u * grow, background: alpha(s.palette.text, 0.25)};
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 28 * u, marginBottom: 64 * u, ...enter}}>
      <div style={rule} />
      <div style={{fontFamily: s.font.mono, fontSize: 26 * u, letterSpacing: '0.2em', textTransform: 'uppercase', color: s.palette.muted, textAlign: 'center'}}>{text}</div>
      <div style={rule} />
    </div>
  );
};

const Cell: React.FC<{src: string; delay: number; w: number; h: number; lit: number}> = ({src, delay, w, h, lit}) => {
  const s = useStyle();
  const enter = useEnter(delay);
  const r = Math.min(s.radius, 20);
  return (
    <div
      style={{
        width: w, height: h, borderRadius: r, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: alpha(s.palette.text, 0.035 + 0.03 * lit),
        border: `1px solid ${alpha(lit > 0.01 ? s.palette.accent : s.palette.text, 0.09 + 0.3 * lit)}`,
        ...enter,
      }}
    >
      <Img
        src={asset(src)}
        style={{
          maxWidth: '70%', maxHeight: '60%', objectFit: 'contain', borderRadius: Math.min(r, 8),
          filter: `grayscale(${1 - lit})`, opacity: 0.68 + 0.32 * lit,
          transform: `scale(${1 + 0.04 * lit})`,
        }}
      />
    </div>
  );
};
