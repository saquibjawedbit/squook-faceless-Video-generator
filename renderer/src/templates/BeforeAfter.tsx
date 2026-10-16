import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Heading, VFrame, useBeat, useEnter, useProgress, useVertical} from './kit';
import {Mark, SafeArea, clampLines, str, useFrameInfo, useRamp, warnOf} from './Stat';

type Side = {label: string; items: string[]};

const sideOf = (x: unknown, fallback: string): Side => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const items = (Array.isArray(o.items) ? o.items : []).map(str).filter(Boolean).slice(0, 6);
  return {label: str(o.label) || fallback, items};
};

// Deterministic "messy" offsets for the before items.
const TILT = [-1.4, 0.9, -0.6, 1.3, -1.0, 0.5];
const NUDGE = [0, 18, 6, 26, 10, 22];

const Tag: React.FC<{text: string; color: string; solid?: boolean; onSolid?: string; delay: number; z?: number}> = ({text, color, solid, onSolid, delay, z = 1}) => {
  const s = useStyle();
  const k = useFrameInfo().k * z;
  const e = useEnter(delay, 'pop');
  return (
    <div
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: s.font.mono,
        fontSize: 24 * k,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: solid ? onSolid : color,
        background: solid ? color : alpha(color, 0.12),
        border: `1px solid ${solid ? 'transparent' : alpha(color, 0.4)}`,
        borderRadius: 999,
        padding: `${10 * k}px ${22 * k}px`,
        marginBottom: (z > 1 ? 18 : 30) * k,
        ...e,
      }}
    >
      {text}
    </div>
  );
};

const BeforeItem: React.FC<{text: string; i: number; delay: number; strikeAt: number; z?: number}> = ({text, i, delay, strikeAt, z = 1}) => {
  const s = useStyle();
  const fi = useFrameInfo();
  const k = fi.k * z;
  const tall = fi.tall;
  const frame = useCurrentFrame();
  const e = useEnter(delay);
  const strike = useRamp(strikeAt + i * 3, strikeAt + i * 3 + 12);
  const warn = warnOf(s);
  const wobble = Math.sin((frame + i * 11) / 9) * 0.35 * (1 - strike);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18 * k,
        marginBottom: z > 1 ? 0 : 24 * k,
        marginLeft: (tall ? NUDGE[i % 6] * 0.6 : NUDGE[i % 6]) * k,
        opacity: e.opacity,
        filter: e.filter,
        clipPath: e.clipPath,
        transform: `${e.transform ?? ''} rotate(${TILT[i % 6] + wobble}deg)`,
      }}
    >
      <Mark ok={false} size={38 * k} progress={Math.min(1, e.opacity as number)} color={warn} ring={alpha(warn, 0.4)} />
      <div style={{position: 'relative', minWidth: 0}}>
        <div style={{...clampLines(1), fontFamily: s.font.body, fontSize: (tall ? 40 : 38) * k, lineHeight: 1.3, color: s.palette.muted}}>{text}</div>
        <div style={{position: 'absolute', left: -4 * k, right: -4 * k, top: '54%', height: 3 * k, background: warn, borderRadius: 2, transformOrigin: '0% 50%', transform: `scaleX(${strike})`}} />
      </div>
    </div>
  );
};

const AfterItem: React.FC<{text: string; delay: number; z?: number}> = ({text, delay, z = 1}) => {
  const s = useStyle();
  const fi = useFrameInfo();
  const k = fi.k * z;
  const tall = fi.tall;
  const e = useEnter(delay);
  const draw = useRamp(delay + 2, delay + 16);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 20 * k, marginBottom: z > 1 ? 0 : 24 * k, ...e}}>
      <Mark ok size={42 * k} progress={draw} color={s.palette.onAccent} fill={s.palette.accent} />
      <div style={{...clampLines(1), fontFamily: s.font.body, fontWeight: 600, fontSize: (tall ? 40 : 38) * k, lineHeight: 1.3, color: s.palette.text}}>{text}</div>
    </div>
  );
};

const Arrow: React.FC<{delay: number; vertical: boolean; z?: number}> = ({delay, vertical, z = 1}) => {
  const s = useStyle();
  const k = useFrameInfo().k * z;
  const e = useEnter(delay, 'pop');
  const draw = useRamp(delay + 2, delay + 14);
  const size = 92 * k;
  return (
    <div style={{width: size, height: size, borderRadius: '50%', background: s.palette.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 ${10 * k}px ${30 * k}px ${alpha(s.palette.accent, 0.35)}`, ...e}}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" style={{transform: vertical ? 'rotate(90deg)' : undefined}}>
        <path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke={s.palette.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
      </svg>
    </div>
  );
};

export const BeforeAfter: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const s = useStyle();
  const {fps} = useVideoConfig();
  const {k, tall} = useFrameInfo();
  const title = str(p.title);
  const before = sideOf(p.before, 'Before');
  const after = sideOf(p.after, 'After');
  const warn = warnOf(s);

  const t0 = useBeat(beats, 0, title ? 10 : 4);
  const b1 = useBeat(beats, 1);
  const fallbackAfter = Math.max(t0 + 26, Math.min(t0 + before.items.length * 7 + Math.round(0.9 * fps), Math.round(durationFrames * 0.45)));
  const tAfter = Number.isFinite(beats?.[1]) ? Math.max(t0 + 8, b1) : fallbackAfter;

  const beforeEnter = useEnter(t0);
  const afterEnter = useEnter(tAfter);
  const dim = useProgress(tAfter);
  const d = Math.max(0, Math.min(1, dim));

  const panelPad = `${(tall ? 40 : 48) * k}px ${(tall ? 44 : 48) * k}px ${(tall ? 24 : 30) * k}px`;
  const r = s.radius * k * 1.2;
  const vg = useVertical();

  if (vg.v) {
    // Phone layout: big title, then the two panels stacked and sharing the
    // block height, items spread evenly inside each panel, an arrow between.
    const u = vg.u;
    const most = Math.max(before.items.length, after.items.length, 1);
    const z = (most <= 3 ? 1.45 : most <= 4 ? 1.35 : 1.2) * (u / k);
    const kz = k * z;
    const pad = `${36 * kz}px ${40 * kz}px ${36 * kz}px`;
    const panel = (side: 'before' | 'after') => {
      const isB = side === 'before';
      const e = isB ? beforeEnter : afterEnter;
      return (
        <div
          style={{
            flex: '1 1 0',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-evenly',
            padding: pad,
            borderRadius: s.radius * u * 1.2,
            ...(isB
              ? {border: `${Math.max(2, 3 * u)}px dashed ${alpha(warn, 0.45)}`, background: alpha(s.palette.muted, 0.07)}
              : {background: s.card.bg, border: `${Math.max(2, 3 * u)}px solid ${s.palette.accent}`, boxShadow: s.card.shadow === 'none' ? `0 0 0 ${8 * u}px ${alpha(s.palette.accent, 0.12)}` : s.card.shadow}),
            ...e,
            ...(isB ? {opacity: (e.opacity as number) * (1 - 0.38 * d), transform: `${e.transform ?? ''} scale(${1 - 0.03 * d})`} : {}),
          }}
        >
          {isB ? <Tag text={before.label} color={warn} delay={t0} z={z} /> : <Tag text={after.label} color={s.palette.accent} solid onSolid={s.palette.onAccent} delay={tAfter + 2} z={z} />}
          {isB
            ? before.items.map((it, i) => <BeforeItem key={i} text={it} i={i} delay={t0 + 4 + i * Math.max(3, s.stagger)} strikeAt={tAfter + 4} z={z} />)
            : after.items.map((it, i) => <AfterItem key={i} text={it} delay={tAfter + 6 + i * Math.max(3, s.stagger)} z={z} />)}
        </div>
      );
    };
    return (
      <VFrame
        durationFrames={durationFrames}
        justify="flex-start"
        blockH={vg.H * 0.7}
        titleGap={52 * u}
        title={title ? <Heading size={100 * u} style={{...clampLines(3)}}>{title}</Heading> : null}
        bodyStyle={{alignItems: 'stretch'}}
      >
        {panel('before')}
        <div style={{display: 'flex', justifyContent: 'center', margin: `${-30 * u}px 0`, position: 'relative', zIndex: 2}}>
          <Arrow delay={Math.max(0, tAfter - 4)} vertical z={z} />
        </div>
        {panel('after')}
      </VFrame>
    );
  }

  return (
    <SafeArea durationFrames={durationFrames}>
      {title ? (
        <Heading size={(tall ? 76 : 64) * k} style={{marginBottom: (tall ? 56 : 52) * k, maxWidth: tall ? '100%' : '80%', ...clampLines(2)}}>
          {title}
        </Heading>
      ) : null}
      <div style={{display: 'flex', flexDirection: tall ? 'column' : 'row', alignItems: 'center', gap: (tall ? 26 : 36) * k}}>
        {/* before: muted, dashed, a little chaotic; dims and gets struck through once "after" lands */}
        <div
          style={{
            flex: 1,
            alignSelf: 'stretch',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: panelPad,
            borderRadius: r,
            border: `${Math.max(1.5, 2 * k)}px dashed ${alpha(warn, 0.45)}`,
            background: alpha(s.palette.muted, 0.07),
            ...beforeEnter,
            opacity: (beforeEnter.opacity as number) * (1 - 0.38 * d),
            transform: `${beforeEnter.transform ?? ''} scale(${1 - 0.03 * d})`,
          }}
        >
          <Tag text={before.label} color={warn} delay={t0} />
          {before.items.map((it, i) => (
            <BeforeItem key={i} text={it} i={i} delay={t0 + 4 + i * Math.max(3, s.stagger)} strikeAt={tAfter + 4} />
          ))}
        </div>

        <Arrow delay={Math.max(0, tAfter - 4)} vertical={tall} />

        {/* after: clean card in the accent */}
        <div
          style={{
            flex: 1,
            alignSelf: 'stretch',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: panelPad,
            borderRadius: r,
            background: s.card.bg,
            border: `${Math.max(1.5, 2 * k)}px solid ${s.palette.accent}`,
            boxShadow: s.card.shadow === 'none' ? `0 0 0 ${6 * k}px ${alpha(s.palette.accent, 0.12)}` : s.card.shadow,
            ...afterEnter,
          }}
        >
          <Tag text={after.label} color={s.palette.accent} solid onSolid={s.palette.onAccent} delay={tAfter + 2} />
          {after.items.map((it, i) => (
            <AfterItem key={i} text={it} delay={tAfter + 6 + i * Math.max(3, s.stagger)} />
          ))}
        </div>
      </div>
    </SafeArea>
  );
};
