import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {Heading, Icon, isCenter, useEnter} from './kit';
import {alpha, useStyle} from '../styles';

// Icons: a 2–4 item feature grid. Card packs (clean, tech, playful, corporate)
// get cards; editorial and bold get an open layout with index numbers and
// hairline rules. Landscape: one row. Vertical / square: list (or 2x2 for 4).
// Secondary motion: each icon badge gets a soft ring pulse as it lands, then floats.

const str = (v: unknown, max: number): string => {
  const t = (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const clampLines = (n: number): CSSProperties => ({display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden'} as CSSProperties);

type Item = {icon?: string; label: string; text: string};
type Mode = 'row' | 'list' | 'grid';

export const Icons: React.FC<TemplateProps> = ({p, layout, beats, fps}) => {
  const s = useStyle();
  const {width: W, height: H} = useVideoConfig();
  const title = str(p?.title, 90);
  const items: Item[] = (Array.isArray(p?.items) ? p.items : [])
    .map((it: any) => ({icon: typeof it?.icon_src === 'string' ? it.icon_src : undefined, label: str(it?.label, 48), text: str(it?.text, 140)}))
    .filter((it: Item) => it.label || it.text)
    .slice(0, 4);
  const n = items.length;
  if (!n && !title) return null;

  const vertical = H > W * 1.1;
  const square = !vertical && W < H * 1.35;
  const u = Math.min(W, H) / 1080;
  const mode: Mode = vertical ? 'list' : square ? (n === 4 ? 'grid' : 'list') : 'row';
  const open = s.id === 'editorial' || s.id === 'bold';
  const center = isCenter(layout) || (mode === 'row' && !title) ;
  const availW = W * (vertical ? 0.86 : 0.84);
  const gap = (open ? 56 : 32) * u;
  const cols = mode === 'row' ? Math.max(1, n) : mode === 'grid' ? 2 : 1;
  const colW = (availW - gap * (cols - 1)) / cols;

  const beatAt = (i: number, fallback: number) => {
    const b = beats?.[i];
    return Number.isFinite(b) ? Math.round((b as number) * fps) : fallback;
  };
  const titleAt = title ? (Number.isFinite(beats?.[0]) && (beats?.length ?? 0) > n ? beatAt(0, 0) : 0) : 0;
  const off = title && (beats?.length ?? 0) > n ? 1 : 0;
  const at = items.map((_, i) => beatAt(i + off, (title ? 12 : 6) + i * s.stagger * 2));

  return (
    <AbsoluteFill
      style={{
        padding: `${H * 0.07}px ${(W - availW) / 2}px ${H * 0.18}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: center ? 'center' : 'stretch',
      }}
    >
      {title ? (
        <Heading size={(mode === 'row' ? 76 : mode === 'grid' ? 60 : 72) * u} delay={titleAt} align={center ? 'center' : 'left'} style={{marginBottom: (mode === 'row' ? 72 : mode === 'grid' ? 40 : 56) * u, maxWidth: mode === 'row' ? availW * (center ? 0.85 : 0.7) : availW}}>
          {title}
        </Heading>
      ) : null}
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${cols}, ${colW}px)`, gap: mode === 'row' ? gap : (open ? 36 : 24) * u, width: availW}}>
        {items.map((it, i) => (
          <Feature key={i} item={it} i={i} delay={at[i]} mode={mode} open={open} n={n} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Feature: React.FC<{item: Item; i: number; delay: number; mode: Mode; open: boolean; n: number}> = ({item, i, delay, mode, open, n}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {fps, width: W, height: H} = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const enter = useEnter(delay);
  const horizontal = mode === 'list';
  const big = mode === 'row' && n <= 3;
  const badge = (big ? 120 : mode === 'grid' ? 88 : 104) * u;
  const ring = interpolate(frame - delay, [4, 26], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const float = frame > delay ? Math.sin(((frame - delay) / fps) * 1.6 + i * 1.3) * 4 * u : 0;
  const labelFs = (mode === 'row' ? (big ? 44 : 38) : 40) * Math.min(1.1, s.scale) * u;
  const textFs = (mode === 'row' ? (big ? 30 : 27) : 28) * u;
  const R = Math.min(s.radius, 28);

  const badgeEl = (
    <div style={{position: 'relative', width: badge, height: badge, flex: 'none', transform: `translateY(${float}px)`}}>
      <div style={{position: 'absolute', inset: 0, borderRadius: open ? '50%' : Math.min(R, badge * 0.3), background: alpha(s.palette.accent, 0.12), border: `1px solid ${alpha(s.palette.accent, 0.22)}`}} />
      <div style={{position: 'absolute', inset: -6 * u, borderRadius: open ? '50%' : Math.min(R, badge * 0.3) + 6 * u, border: `2px solid ${s.palette.accent}`, opacity: (1 - ring) * 0.6 * (ring > 0 ? 1 : 0), transform: `scale(${1 + ring * 0.35})`}} />
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <Icon src={item.icon} size={badge * 0.56} />
      </div>
    </div>
  );
  const textEl = (
    <div style={{minWidth: 0}}>
      {item.label ? (
        <div style={{fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: labelFs, lineHeight: 1.1, letterSpacing: `${s.headingTracking}em`, textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none', color: s.palette.text, ...clampLines(2)}}>
          {item.label}
        </div>
      ) : null}
      {item.text ? (
        <div style={{fontFamily: s.font.body, fontSize: textFs, lineHeight: 1.38, color: s.palette.muted, marginTop: 12 * u, ...clampLines(3)}}>{item.text}</div>
      ) : null}
    </div>
  );

  const indexEl = open ? (
    <div style={{fontFamily: s.font.mono, fontSize: 22 * u, letterSpacing: '0.14em', color: s.palette.accent, marginBottom: horizontal ? 0 : 26 * u, width: horizontal ? 48 * u : undefined, flex: 'none'}}>
      {String(i + 1).padStart(2, '0')}
    </div>
  ) : null;

  const layoutStyle: CSSProperties = horizontal
    ? {display: 'flex', alignItems: 'center', gap: 32 * u}
    : {display: 'flex', flexDirection: 'column', gap: (mode === 'grid' ? 22 : 30) * u};

  if (open) {
    const draw = interpolate(frame - delay, [0, 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    return (
      <div style={{position: 'relative', paddingTop: (horizontal ? 26 : 34) * u, ...enter}}>
        <div style={{position: 'absolute', left: 0, top: 0, height: 1, width: `${draw * 100}%`, background: alpha(s.palette.text, 0.22)}} />
        <div style={{position: 'absolute', left: 0, top: -1, height: 3, width: `${draw * 22}%`, background: s.palette.accent}} />
        {horizontal ? (
          <div style={layoutStyle}>
            {indexEl}
            {badgeEl}
            {textEl}
          </div>
        ) : (
          <div>
            {indexEl}
            <div style={layoutStyle}>
              {badgeEl}
              {textEl}
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      style={{
        background: s.card.bg, border: `1px solid ${s.card.border}`, boxShadow: s.card.shadow, borderRadius: R,
        padding: horizontal ? `${28 * u}px ${34 * u}px` : mode === 'grid' ? `${32 * u}px ${34 * u}px` : `${44 * u}px ${40 * u}px ${48 * u}px`,
        ...layoutStyle, ...enter,
      }}
    >
      {badgeEl}
      {textEl}
    </div>
  );
};
