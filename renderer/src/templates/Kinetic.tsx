import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {isCenter} from './kit';
import {alpha, useStyle} from '../styles';
import {isLite} from '../styles';

// Kinetic type: one big line per beat. Each new line lands in the pack's manner
// and pushes the stack up; earlier lines dim, the last line is in the accent.
// A marker tracks the active line (left layout); the block slowly pushes in.

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim();
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const Kinetic: React.FC<TemplateProps> = ({p, layout, beats, fps, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const raw: unknown[] = Array.isArray(p?.lines) ? p.lines : typeof p?.lines === 'string' ? [p.lines] : typeof p?.text === 'string' ? [p.text] : [];
  const lines = raw.map(str).filter(Boolean).map((l) => (l.length > 90 ? l.slice(0, 89).trimEnd() + '…' : l)).slice(0, 8);
  const n = lines.length;
  if (!n) return null;

  const center = isCenter(layout);
  const vertical = H > W * 1.1;
  const u = Math.min(W, H) / 1080;
  const padX = W * (vertical ? 0.08 : 0.09);
  const availW = W - padX * 2 - (center ? 0 : 40 * u);
  const zoneTop = H * 0.08;
  const zoneBot = H * 0.82;
  const zoneH = zoneBot - zoneTop;
  const zoneMid = (zoneTop + zoneBot) / 2;

  // ── type size: fill the width with the longest line, within limits ────────
  const upper = s.headingCase === 'upper';
  const cw = ({bold: 0.45, clean: 0.52, tech: 0.55, playful: 0.6, corporate: 0.62, editorial: 0.5} as Record<string, number>)[s.id] ?? 0.56;
  const maxLen = Math.max(...lines.map((l) => l.length));
  const longestWord = Math.max(...lines.flatMap((l) => l.split(' ').map((w) => w.length)));
  const visible = Math.min(n, 4);
  const lh = upper ? 1.0 : 1.08;
  const base = (vertical ? 250 : 176) * s.scale * u;
  const minFs = (vertical ? 64 : 72) * u;
  // Lines are broken into rows here (greedy, by estimated glyph width) so the
  // stack layout is exact rather than relying on the browser's wrapping.
  const wrap = (l: string, f: number): string[] => {
    const max = Math.max(4, Math.floor((availW * 0.94) / (cw * f)));
    const out: string[] = [];
    let cur = '';
    l.split(' ').forEach((w) => {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
      else {
        out.push(cur);
        cur = w;
      }
    });
    if (cur) out.push(cur);
    return out.length ? out : [l];
  };
  const rowsAt = (l: string, f: number) => wrap(l, f).length;
  let fs = minFs;
  if (vertical || W < H * 1.35) {
    // Tall or square frame: let lines wrap and grow the type until the stack fills it.
    const last = lines.slice(-visible);
    for (let f = base; f >= minFs; f -= 4 * u) {
      if (longestWord * cw * f > availW) continue;
      const total = last.reduce((a, l) => a + rowsAt(l, f), 0) * f * lh * 1.1;
      if (total <= zoneH * 0.9) {
        fs = f;
        break;
      }
    }
  } else {
    fs = Math.max(minFs, Math.min(base, availW / (maxLen * cw), zoneH / (visible * (lh + 0.1) * 1.06)));
  }
  const rowsList = lines.map((l) => wrap(l, fs));
  const gapY = fs * 0.1;
  const hOf = rowsList.map((r) => r.length * fs * lh + gapY);

  // ── timing ────────────────────────────────────────────────────────────────
  const gap = Math.max(10, Math.min(30, (durationFrames * 0.72) / n));
  const at: number[] = [];
  lines.forEach((_, i) => {
    const b = beats?.[i];
    let t = Number.isFinite(b) ? Math.round((b as number) * fps) : 4 + i * gap;
    if (i > 0) t = Math.max(t, at[i - 1] + 4);
    at.push(Math.max(0, t));
  });
  const pr = at.map((t) => spring({frame: frame - t, fps, config: s.spring}));
  const prC = pr.map((v) => clamp01(v));

  // ── stack: the visible block is centred; once it overflows, it scrolls ───
  const tops: number[] = [];
  let acc = 0;
  hOf.forEach((h) => {
    tops.push(acc);
    acc += h;
  });
  const V = hOf.reduce((a, h, i) => a + h * prC[i], 0);
  const blockTop = V <= zoneH ? zoneMid - V / 2 : zoneBot - V;

  // Active-line marker: follows the newest line.
  const active = Math.max(0, prC.reduce((a, v) => a + v, 0) - 1);
  const ai = Math.min(n - 1, Math.floor(active));
  const af = active - ai;
  const yOf = (i: number) => blockTop + tops[i];
  const markY = ai + 1 < n ? yOf(ai) + (yOf(ai + 1) - yOf(ai)) * af : yOf(ai);
  const markH = (ai + 1 < n ? hOf[ai] + (hOf[ai + 1] - hOf[ai]) * af : hOf[ai]) - gapY;

  const push = interpolate(frame, [0, Math.max(1, durationFrames)], [1, 1.035]);

  return (
    <AbsoluteFill style={{transform: `scale(${push})`, transformOrigin: center ? '50% 50%' : `${padX}px 50%`}}>
      {!center ? (
        <div
          style={{
            position: 'absolute', left: padX, top: markY + markH * 0.12, width: 10 * u, height: markH * 0.76,
            borderRadius: 6 * u, background: s.palette.accent, opacity: clamp01(pr[0] * 1.5),
          }}
        />
      ) : null}
      {lines.map((_, i) => {
        const y = yOf(i);
        const older = clamp01(pr.slice(i + 1).reduce((a, v) => a + clamp01(v), 0));
        const isLast = i === n - 1 && n > 1;
        const fadeTop = clamp01(interpolate(y, [zoneTop - hOf[i] * 0.6, zoneTop - fs * 0.15], [0, 1]));
        const dim = 1 - (n > 1 ? 0.62 : 0) * older;
        return (
          <Line
            key={i}
            rows={rowsList[i]}
            p={pr[i]}
            style={{
              position: 'absolute', left: center ? padX : padX + 40 * u, width: availW, top: y,
              fontSize: fs, lineHeight: lh, textAlign: center ? 'center' : 'left',
              color: isLast ? s.palette.accent : s.palette.text,
              opacity: dim * fadeTop,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Line: React.FC<{rows: string[]; p: number; style: CSSProperties}> = ({rows, p, style}) => {
  const s = useStyle();
  const o = clamp01(p);
  const fs = Number(style.fontSize) || 100;
  let inner: CSSProperties = {};
  let clip = false;
  switch (s.enter) {
    case 'pop': // slam: drops in from large and settles with the pack's bounce
      inner = {opacity: clamp01(p * 2.2), transform: `scale(${1 + (1 - p) * 0.55})`, transformOrigin: style.textAlign === 'center' ? '50% 60%' : '0% 60%'};
      break;
    case 'blur':
      inner = {opacity: o, filter: !isLite() && o < 0.99 ? `blur(${(1 - o) * 22}px)` : undefined, letterSpacing: `${(1 - o) * 0.12 + s.headingTracking}em`};
      break;
    case 'slide':
      inner = {opacity: o, transform: `translateX(${(1 - p) * -fs * 1.6}px)`};
      break;
    case 'mask':
      inner = {clipPath: `inset(-10% ${(1 - o) * 100}% -20% 0)`, transform: `translateX(${(1 - p) * fs * 0.25}px)`};
      break;
    case 'rise':
    default:
      clip = true;
      inner = {transform: `translateY(${(1 - p) * 105}%)`, opacity: clamp01(p * 3)};
  }
  return (
    <div
      style={{
        fontFamily: s.font.heading, fontWeight: s.headingWeight, letterSpacing: `${s.headingTracking}em`,
        textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none', whiteSpace: 'nowrap',
        overflow: clip ? 'hidden' : 'visible', paddingBottom: clip ? '0.06em' : 0,
        ...style,
      } as CSSProperties}
    >
      <div style={{...inner, textShadow: s.palette.text === '#ffffff' || s.id === 'tech' ? `0 0 40px ${alpha(s.palette.bg, 0.6)}` : undefined}}>
        {rows.map((r, k) => (
          <div key={k}>{r}</div>
        ))}
      </div>
    </div>
  );
};
