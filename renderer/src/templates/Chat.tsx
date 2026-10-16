import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {alpha, luminance, mix, useStyle} from '../styles';
import type {StylePack} from '../styles';

// Chat: a phone-chat window where messages arrive one by one (typing dots
// before each incoming one). With `p.result`, the chat then moves aside and a
// clean order table builds row by row next to it, joined by a flow arrow.

type Msg = {from: 'me' | 'them'; text: string; time?: string; idx: number};
type Row = {left: string; right: string; flag: string};

const str = (v: unknown, max = 220): string => {
  const t = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const c = t.replace(/\s+/g, ' ').trim();
  return c.length > max ? c.slice(0, max - 1).trimEnd() + '…' : c;
};
const clampLines = (n: number): CSSProperties => ({display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden'} as CSSProperties);
const lin = (frame: number, from: number, len: number) => interpolate(frame, [from, from + len], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Design-space sizes (px); each block is scaled to fit the frame.
const CW = 720;
const TW = 780;
const BODY_FS = 28;

/** Colours for the chat window, derived from the pack so it sits on light and dark canvases. */
function chatColors(s: StylePack) {
  const dark = luminance(s.palette.bg) < 0.3;
  const wall = dark ? mix(s.palette.bg, '#ffffff', 0.05) : mix(s.palette.bg, '#e9e3d9', 0.55);
  return {
    dark,
    window: dark ? mix(s.palette.bg, '#ffffff', 0.08) : '#ffffff',
    header: dark ? mix(s.palette.bg, '#ffffff', 0.1) : '#ffffff',
    wall,
    pattern: dark ? alpha('#ffffff', 0.035) : alpha('#000000', 0.035),
    them: dark ? mix(s.palette.bg, '#ffffff', 0.15) : '#ffffff',
    themText: dark ? '#eef1f6' : '#14171c',
    me: s.palette.accent,
    meText: s.palette.onAccent,
    muted: dark ? '#93a0b2' : '#69707c',
    line: dark ? alpha('#ffffff', 0.08) : alpha('#000000', 0.08),
    warn: dark ? '#f5b544' : '#b45309',
  };
}

export const Chat: React.FC<TemplateProps> = ({p, beats, fps, durationFrames}) => {
  const s = useStyle();
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const c = chatColors(s);
  const R = Math.max(14, Math.min(34, s.radius + 10));

  // ── props, defensively ────────────────────────────────────────────────────
  const rawMsgs: any[] = Array.isArray(p?.messages) ? p.messages : [];
  const all: Msg[] = rawMsgs
    .map((m, idx) => ({from: m?.from === 'me' ? ('me' as const) : ('them' as const), text: str(m?.text, 240), time: str(m?.time, 8) || undefined, idx}))
    .filter((m) => m.text);
  const msgs = all.slice(-12);
  const res = p?.result && typeof p.result === 'object' ? p.result : null;
  const rows: Row[] = (Array.isArray(res?.rows) ? res.rows : [])
    .map((r: any) => ({left: str(r?.left, 80), right: str(r?.right, 48), flag: str(r?.flag, 70)}))
    .filter((r: Row) => r.left || r.right);
  const hasResult = !!res && (rows.length > 0 || !!str(res?.title));
  const contact = str(p?.contact, 32) || 'Customer';
  const app = str(p?.app, 20);
  const n = msgs.length;
  if (!n && !hasResult) return null;

  // ── timing ────────────────────────────────────────────────────────────────
  const beatF = (i: number): number | null => {
    const b = beats?.[i];
    return Number.isFinite(b) ? Math.max(0, Math.round((b as number) * fps)) : null;
  };
  const windowEnd = durationFrames * (hasResult ? 0.5 : 0.78);
  const firstAt = msgs[0]?.from === 'them' ? 18 : 10;
  const gap = Math.max(8, Math.min(30, (windowEnd - firstAt) / Math.max(1, n)));
  const at: number[] = [];
  msgs.forEach((m, i) => {
    const b = beatF(m.idx);
    let t = b ?? firstAt + i * gap;
    if (i > 0) t = Math.max(t, at[i - 1] + 6);
    at.push(Math.round(t));
  });
  const typingFrom = msgs.map((m, i) => {
    if (m.from !== 'them') return null;
    const start = Math.max(i > 0 ? at[i - 1] + 5 : 0, at[i] - 18);
    return at[i] - start >= 6 ? start : null;
  });
  const lastMsg = n ? at[n - 1] : 0;
  const resB = beatF(all.length ? all[all.length - 1].idx + 1 : 0);
  let resultAt = n ? Math.max(resB ?? 0, lastMsg + 20) : 6;
  resultAt = Math.min(resultAt, Math.max(n ? lastMsg + 6 : 6, durationFrames - 45));
  const maxRows = 7;
  const shownRows = rows.slice(0, maxRows);
  const moreRows = rows.length - shownRows.length;
  const rowsStart = resultAt + 14;
  const rowGap = Math.max(5, Math.min(12, (durationFrames - 24 - rowsStart) / Math.max(1, shownRows.length)));
  const rowAt = shownRows.map((_, j) => Math.round(rowsStart + j * rowGap));

  // ── geometry ──────────────────────────────────────────────────────────────
  const vertical = H > W * 1.1;
  const square = !vertical && W < H * 1.35;
  const zoneTop = H * (vertical ? 0.07 : 0.065);
  const zoneBot = H * (vertical ? 0.82 : 0.84);
  const zoneH = zoneBot - zoneTop;
  const zoneMid = (zoneTop + zoneBot) / 2;
  // Window height follows its content (last few messages), within limits.
  const bubbleMax = CW * 0.76;
  const estH = (m: Msg) => {
    const perLine = Math.max(8, Math.floor((bubbleMax - 44) / (BODY_FS * 0.56)));
    const lines = Math.min(8, Math.ceil((m.text.length + (m.time ? 8 : 0)) / perLine));
    return lines * BODY_FS * 1.32 + 30 + 12;
  };
  const contentH = msgs.slice(-5).reduce((a, m) => a + estH(m), 0) + 104 + 92 + 22 + 110;
  // Vertical: a tall phone-like window (more of the conversation visible).
  const CH = Math.round(vertical ? Math.max(920, Math.min(1180, contentH)) : Math.max(600, Math.min(square ? 760 : 780, contentH)));
  const kA = Math.min((vertical ? W * 0.86 : square ? W * 0.68 : W * 0.4) / CW, (zoneH * (vertical ? 0.94 : 0.96)) / CH);

  // Table height estimate (design px).
  const flagged = rows.filter((r) => r.flag).length;
  const TH = 132 + shownRows.reduce((a, r) => a + 76 + (r.flag ? 36 : 0), 0) + (moreRows > 0 ? 50 : 0) + 30;

  type Box = {x: number; y: number; k: number};
  let chatA: Box = {x: W / 2 - (CW * kA) / 2, y: zoneMid - (CH * kA) / 2, k: kA};
  let chatB: Box = chatA;
  let table: Box = {x: 0, y: 0, k: 1};
  let arrow: null | {x1: number; y1: number; x2: number; y2: number} = null;
  let dimChat = 0;
  let CHb = CH; // window height once the result is shown (vertical crops the top)
  if (hasResult && !n) {
    const kt = Math.min((vertical ? W * 0.86 : W * 0.5) / TW, (zoneH * 0.96) / TH);
    table = {x: W / 2 - (TW * kt) / 2, y: zoneMid - (TH * kt) / 2, k: kt};
  } else if (hasResult && vertical) {
    // The window stays wide and readable; it gets shorter from the top
    // (latest messages stay in view) to make room for the table below.
    const gapA = 100 * (W / 1080);
    const kt = Math.min((W * 0.88) / TW, (zoneH * 0.5) / TH);
    const avail = zoneH - TH * kt - gapA;
    let k2 = Math.min(kA, (W * 0.84) / CW);
    const minCH = 520;
    if (avail / k2 < minCH) k2 = Math.max(0.3, avail / minCH);
    CHb = Math.max(minCH, Math.min(CH, avail / k2));
    const total = CHb * k2 + gapA + TH * kt;
    const top = zoneTop + Math.max(0, (zoneH - total) / 2);
    chatB = {x: W / 2 - (CW * k2) / 2, y: top, k: k2};
    table = {x: W / 2 - (TW * kt) / 2, y: top + CHb * k2 + gapA, k: kt};
    arrow = {x1: W / 2, y1: top + CHb * k2 + gapA * 0.16, x2: W / 2, y2: top + CHb * k2 + gapA * 0.84};
  } else if (hasResult && square) {
    const k2 = kA * 0.74;
    const kt = Math.min((W * 0.6) / TW, (zoneH * 0.78) / TH);
    chatB = {x: W * 0.05, y: zoneTop, k: k2};
    table = {x: W * 0.95 - TW * kt, y: Math.min(zoneBot - TH * kt, zoneTop + zoneH * 0.3), k: kt};
    dimChat = 0.45;
  } else if (hasResult) {
    const k2 = kA * 0.86;
    const kt = Math.min((W * 0.42) / TW, (zoneH * 0.96) / TH);
    const cx = W * 0.28;
    const tx = W * 0.72;
    chatB = {x: cx - (CW * k2) / 2, y: zoneMid - (CH * k2) / 2, k: k2};
    table = {x: tx - (TW * kt) / 2, y: zoneMid - (TH * kt) / 2, k: kt};
    arrow = {x1: cx + (CW * k2) / 2 + 26, y1: zoneMid, x2: tx - (TW * kt) / 2 - 26, y2: zoneMid};
  }

  // ── motion ────────────────────────────────────────────────────────────────
  const soft = {damping: Math.max(s.spring.damping, 18), stiffness: Math.max(s.spring.stiffness, 110), mass: s.spring.mass};
  const enterW = spring({frame, fps, config: soft});
  const move = hasResult && n ? spring({frame: frame - resultAt, fps, config: soft}) : 0;
  const lerp = (a: number, b: number) => a + (b - a) * move;
  const cb: Box = {x: lerp(chatA.x, chatB.x), y: lerp(chatA.y, chatB.y), k: lerp(chatA.k, chatB.k)};
  const tIn = spring({frame: frame - (resultAt + 6), fps, config: soft});
  const typingNow = msgs.some((m, i) => typingFrom[i] != null && frame >= (typingFrom[i] as number) && frame < at[i]);

  // ── chat window ───────────────────────────────────────────────────────────
  const TYPING_H = 74;

  const chatWindow = n ? (
    <div
      style={{
        position: 'absolute', left: 0, top: 0, width: CW, height: CH + (CHb - CH) * move,
        transformOrigin: '0 0',
        transform: `translate(${cb.x}px, ${cb.y + (1 - enterW) * 50}px) scale(${cb.k * (0.95 + 0.05 * enterW)})`,
        opacity: clamp01(enterW * 1.4),
        background: c.window, borderRadius: R, overflow: 'hidden',
        border: `1px solid ${s.card.border}`,
        boxShadow: c.dark ? `0 40px 100px ${alpha('#000000', 0.45)}` : `0 40px 100px ${alpha('#101318', 0.16)}`,
        display: 'flex', flexDirection: 'column', fontFamily: s.font.body,
      }}
    >
      {/* header */}
      <div style={{height: 104, flex: 'none', display: 'flex', alignItems: 'center', gap: 18, padding: '0 28px', background: c.header, borderBottom: `1px solid ${c.line}`}}>
        <svg width={18} height={30} viewBox="0 0 18 30" style={{flex: 'none'}}>
          <path d="M14 3 L4 15 L14 27" fill="none" stroke={c.muted} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{width: 60, height: 60, borderRadius: '50%', flex: 'none', background: `linear-gradient(135deg, ${s.palette.accent}, ${mix(s.palette.accent, c.dark ? '#000000' : '#ffffff', 0.35)})`, color: s.palette.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 26}}>
          {initials(contact)}
        </div>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 29, fontWeight: 700, color: c.themText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{contact}</div>
          <div style={{fontSize: 21, color: typingNow ? s.palette.accent : c.muted, marginTop: 2}}>{typingNow ? 'typing…' : 'online'}</div>
        </div>
        {app ? (
          <div style={{flex: 'none', fontFamily: s.font.mono, fontSize: 17, letterSpacing: '0.14em', textTransform: 'uppercase', color: c.muted, border: `1px solid ${c.line}`, borderRadius: 999, padding: '7px 14px'}}>{app}</div>
        ) : null}
      </div>
      {/* body */}
      <div
        style={{
          flex: 1, minHeight: 0, position: 'relative', background: c.wall, overflow: 'hidden',
          backgroundImage: `radial-gradient(${c.pattern} 1.6px, transparent 1.8px)`, backgroundSize: '26px 26px',
        }}
      >
        <div
          style={{
            position: 'absolute', inset: 0, padding: '0 26px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 70px)', maskImage: 'linear-gradient(to bottom, transparent 0, black 70px)',
          } as CSSProperties}
        >
          {msgs.map((m, i) => {
            const tf = typingFrom[i];
            const nodes = [];
            if (tf != null && frame >= tf && frame < at[i]) {
              const grow = lin(frame, tf, 6);
              nodes.push(
                <div key={`t${i}`} style={{maxHeight: grow * TYPING_H, overflow: 'hidden', flex: 'none'}}>
                  <div style={{paddingTop: 12, display: 'flex', opacity: grow, transform: `scale(${0.7 + 0.3 * grow})`, transformOrigin: 'bottom left'}}>
                    <div style={{background: c.them, borderRadius: `24px 24px 24px 6px`, padding: '20px 24px', display: 'flex', gap: 9, boxShadow: `0 1px 1px ${alpha('#000000', 0.08)}`}}>
                      {[0, 1, 2].map((d) => {
                        const ph = (frame - tf) * 0.32 - d * 0.9;
                        const up = Math.max(0, Math.sin(ph));
                        return <div key={d} style={{width: 12, height: 12, borderRadius: '50%', background: c.muted, opacity: 0.45 + 0.55 * up, transform: `translateY(${-up * 7}px)`}} />;
                      })}
                    </div>
                  </div>
                </div>,
              );
            }
            if (frame >= at[i]) {
              const h = estH(m);
              const fromH = tf != null ? TYPING_H : 0;
              const g = lin(frame, at[i], 7);
              const pop = spring({frame: frame - at[i], fps, config: s.spring});
              const me = m.from === 'me';
              nodes.push(
                <div key={`m${i}`} style={{maxHeight: g < 1 ? fromH + g * (h * 1.35 - fromH) : undefined, overflow: g < 1 ? 'hidden' : 'visible', flex: 'none'}}>
                  <div style={{paddingTop: 12, display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start'}}>
                    <div
                      style={{
                        maxWidth: bubbleMax, background: me ? c.me : c.them, color: me ? c.meText : c.themText,
                        borderRadius: me ? '24px 24px 6px 24px' : '24px 24px 24px 6px',
                        padding: '14px 22px 12px', fontSize: BODY_FS, lineHeight: 1.32,
                        boxShadow: `0 1px 1px ${alpha('#000000', 0.1)}`,
                        opacity: clamp01(pop * 1.6), transform: `scale(${0.72 + 0.28 * pop})`, transformOrigin: me ? 'bottom right' : 'bottom left',
                      }}
                    >
                      <span style={clampLines(8)}>{m.text}</span>
                      {m.time || me ? (
                        <div style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 17, color: me ? alpha(c.meText, 0.72) : c.muted}}>
                          {m.time ? <span>{m.time}</span> : null}
                          {me ? <Ticks color={alpha(c.meText, 0.8)} /> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>,
              );
            }
            return nodes;
          })}
        </div>
      </div>
      {/* composer */}
      <div style={{height: 92, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', background: c.header, borderTop: `1px solid ${c.line}`}}>
        <div style={{flex: 1, height: 56, borderRadius: 28, background: c.dark ? alpha('#ffffff', 0.07) : alpha('#000000', 0.045), display: 'flex', alignItems: 'center', padding: '0 24px', fontSize: 23, color: c.muted}}>Message</div>
        <div style={{width: 56, height: 56, borderRadius: '50%', background: s.palette.accent, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <svg width={24} height={24} viewBox="0 0 24 24">
            <path d="M4 12 L20 4 L14 20 L11 13 Z" fill={s.palette.onAccent} />
          </svg>
        </div>
      </div>
      {dimChat ? <div style={{position: 'absolute', inset: 0, background: s.palette.bg, opacity: dimChat * move, pointerEvents: 'none'}} /> : null}
    </div>
  ) : null;

  // ── result table ──────────────────────────────────────────────────────────
  const fromSide = vertical || square ? {x: 0, y: 70} : {x: 90, y: 0};
  const tableCard = hasResult ? (
    <div
      style={{
        position: 'absolute', left: 0, top: 0, width: TW, transformOrigin: '0 0',
        transform: `translate(${table.x + (1 - tIn) * fromSide.x}px, ${table.y + (1 - tIn) * fromSide.y}px) scale(${table.k * (0.96 + 0.04 * tIn)})`,
        opacity: clamp01(tIn * 1.5),
        background: s.card.bg === 'transparent' ? s.palette.surface : s.card.bg,
        border: `1px solid ${s.card.border}`, boxShadow: s.card.shadow === 'none' ? (c.dark ? `0 30px 80px ${alpha('#000000', 0.4)}` : 'none') : s.card.shadow,
        borderRadius: R, overflow: 'hidden', fontFamily: s.font.body, color: s.palette.text,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 18, padding: '30px 34px 24px'}}>
        <div style={{width: 52, height: 52, borderRadius: Math.min(14, R), background: alpha(s.palette.accent, 0.14), display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none'}}>
          <svg width={28} height={28} viewBox="0 0 28 28">
            {[7, 14, 21].map((y) => (
              <g key={y}>
                <circle cx={5} cy={y} r={2.2} fill={s.palette.accent} />
                <rect x={10} y={y - 1.6} width={y === 21 ? 10 : 14} height={3.2} rx={1.6} fill={s.palette.accent} />
              </g>
            ))}
          </svg>
        </div>
        <div style={{flex: 1, minWidth: 0, fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: s.id === 'bold' ? 38 : 34, letterSpacing: `${s.headingTracking}em`, textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
          {str(res?.title, 48) || 'Order'}
        </div>
        {rows.length ? (
          <div style={{flex: 'none', fontFamily: s.font.mono, fontSize: 19, color: s.palette.muted, letterSpacing: '0.06em'}}>
            {Math.round(clamp01(lin(frame, rowsStart, Math.max(1, rowAt[rowAt.length - 1] - rowsStart + 1))) * rows.length)} / {rows.length}
          </div>
        ) : null}
      </div>
      <div style={{height: 1, background: s.card.border, margin: '0 34px'}} />
      <div style={{padding: '10px 20px 14px'}}>
        {shownRows.map((r, j) => {
          const rp = spring({frame: frame - rowAt[j], fps, config: soft});
          const flash = interpolate(frame - rowAt[j], [0, 4, 22], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const isFlag = !!r.flag;
          const tint = isFlag ? c.warn : s.palette.accent;
          const grow = lin(frame, rowAt[j], 6);
          const rowH = 76 + (isFlag ? 36 : 0) + 12;
          return (
            <div key={j} style={{maxHeight: grow < 1 ? grow * rowH * 1.3 : undefined, overflow: grow < 1 ? 'hidden' : 'visible'}}>
            <div
              style={{
                position: 'relative', margin: '6px 0', padding: '14px 16px 14px 22px', borderRadius: Math.min(12, R),
                background: isFlag ? alpha(c.warn, 0.1) : alpha(s.palette.accent, 0.1 * flash),
                opacity: clamp01(rp * 1.5), transform: `translateX(${(1 - rp) * 40}px)`,
              }}
            >
              {isFlag ? <div style={{position: 'absolute', left: 0, top: 10, bottom: 10, width: 5, borderRadius: 3, background: c.warn}} /> : null}
              <div style={{display: 'flex', alignItems: 'center', gap: 16, minHeight: 44}}>
                <div style={{flex: 1, minWidth: 0, fontSize: 27, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.left}</div>
                {r.right ? (
                  <div style={{flex: 'none', maxWidth: '46%', fontFamily: s.font.mono, fontSize: 22, fontWeight: 600, color: isFlag ? c.warn : s.palette.text, background: isFlag ? 'transparent' : alpha(s.palette.text, 0.06), border: isFlag ? `1px dashed ${alpha(c.warn, 0.6)}` : `1px solid ${alpha(s.palette.text, 0.08)}`, borderRadius: 8, padding: '6px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {r.right}
                  </div>
                ) : null}
                <StatusMark ok={!isFlag} color={tint} on={isFlag ? '#ffffff' : s.palette.onAccent} p={rp} />
              </div>
              {isFlag ? (
                <div style={{marginTop: 6, fontSize: 21, color: c.warn, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.flag}</div>
              ) : null}
            </div>
            </div>
          );
        })}
        {moreRows > 0 ? (
          <div style={{padding: '12px 22px 4px', fontSize: 22, color: s.palette.muted, opacity: lin(frame, rowAt[rowAt.length - 1] + 6, 8)}}>+ {moreRows} more</div>
        ) : null}
      </div>
      {flagged > 0 ? (
        <div style={{position: 'absolute', right: 0, top: 0, height: 4, width: '100%', background: `linear-gradient(90deg, ${s.palette.accent}, ${s.palette.accent} ${100 - (flagged / Math.max(1, rows.length)) * 100}%, ${c.warn} ${100 - (flagged / Math.max(1, rows.length)) * 100}%)`, transform: `scaleX(${lin(frame, rowsStart, rowGap * shownRows.length + 6)})`, transformOrigin: 'left'}} />
      ) : (
        <div style={{position: 'absolute', right: 0, top: 0, height: 4, width: '100%', background: s.palette.accent, transform: `scaleX(${lin(frame, rowsStart, rowGap * shownRows.length + 6)})`, transformOrigin: 'left'}} />
      )}
    </div>
  ) : null;

  // ── flow arrow (with a travelling pulse once drawn) ───────────────────────
  let arrowSvg = null;
  if (arrow && hasResult) {
    const draw = lin(frame, resultAt + 8, 12);
    const L = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
    const ux = (arrow.x2 - arrow.x1) / (L || 1);
    const uy = (arrow.y2 - arrow.y1) / (L || 1);
    const tipX = arrow.x1 + ux * L * draw;
    const tipY = arrow.y1 + uy * L * draw;
    const hs = 14 * (vertical ? table.k : 1);
    const cyc = ((frame - resultAt - 20) % 36 + 36) % 36 / 36;
    const pulseOn = frame > resultAt + 20 ? 1 : 0;
    const px = arrow.x1 + ux * L * cyc;
    const py = arrow.y1 + uy * L * cyc;
    const pulseA = pulseOn * Math.sin(Math.PI * cyc);
    arrowSvg = (
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
        <line x1={arrow.x1} y1={arrow.y1} x2={tipX} y2={tipY} stroke={alpha(s.palette.accent, 0.85)} strokeWidth={4} strokeLinecap="round" strokeDasharray="2 12" opacity={draw > 0 ? 1 : 0} />
        {draw > 0.2 ? (
          <path
            d={`M ${tipX - ux * hs - uy * hs} ${tipY - uy * hs + ux * hs} L ${tipX} ${tipY} L ${tipX - ux * hs + uy * hs} ${tipY - uy * hs - ux * hs}`}
            fill="none" stroke={s.palette.accent} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" opacity={draw}
          />
        ) : null}
        <circle cx={px} cy={py} r={9} fill={s.palette.accent} opacity={pulseA} />
        <circle cx={px} cy={py} r={20} fill={s.palette.accent} opacity={pulseA * 0.2} />
      </svg>
    );
  }

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      {chatWindow}
      {arrowSvg}
      {tableCard}
    </AbsoluteFill>
  );
};

function initials(name: string) {
  const parts = name.split(' ').filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

const Ticks: React.FC<{color: string}> = ({color}) => (
  <svg width={22} height={14} viewBox="0 0 22 14">
    <path d="M1 7.5 L5 11.5 L12.5 3" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.5 10.5 L9.5 11.5 L17 3" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const StatusMark: React.FC<{ok: boolean; color: string; on: string; p: number}> = ({ok, color, on, p}) => (
  <div style={{width: 34, height: 34, flex: 'none', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${Math.max(0, p)})`}}>
    <svg width={18} height={18} viewBox="0 0 18 18">
      {ok ? (
        <path d="M3.5 9.5 L7.5 13 L14.5 5" fill="none" stroke={on} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <g>
          <rect x={7.7} y={3} width={2.6} height={8} rx={1.3} fill={on} />
          <circle cx={9} cy={14.2} r={1.5} fill={on} />
        </g>
      )}
    </svg>
  </div>
);
