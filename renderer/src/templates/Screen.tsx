import {AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {TemplateProps} from '.';
import {asset} from '../ir';
import {alpha, useStyle} from '../styles';
import {useEnter} from './kit';

// A real website screenshot in a browser window, with a camera that moves to
// whatever the voice-over is talking about: each focus point zooms the camera
// onto an element (box in 0–1 screenshot coordinates), outlines it, dims the
// rest, and for 'click' moves a cursor onto it and clicks.

type Focus = {box: [number, number, number, number]; at: number; action?: 'zoom' | 'highlight' | 'click'; label?: string};
type Cam = {k: number; tx: number; ty: number};

const BAR = 46;

export const Screen: React.FC<TemplateProps> = ({p, fps, durationFrames}) => {
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const s = useStyle();
  const vertical = H > W;

  const imgW = Number(p.img_w) || 1920;
  const imgH = Number(p.img_h) || 1200;
  // Window size: as large as fits above the caption band.
  let ww = W * (vertical ? 0.92 : 0.8);
  let sh = (ww * imgH) / imgW;
  const titled = Boolean(p.title);
  const maxH = H * (vertical ? 0.62 : titled ? 0.66 : 0.74);
  if (sh + BAR > maxH) { sh = maxH - BAR; ww = (sh * imgW) / imgH; }
  const cx0 = W / 2;
  const cy0 = H * (vertical ? 0.46 : titled ? 0.5 : 0.455);
  const left = cx0 - ww / 2;
  const top = cy0 - (sh + BAR) / 2;

  const focus: Focus[] = (Array.isArray(p.focus) ? p.focus : [])
    .filter((f: Focus) => Array.isArray(f?.box) && f.box.length === 4 && f.box.every((n) => Number.isFinite(n)))
    .map((f: Focus) => ({...f, at: Math.max(0.4, Number(f.at) || 0)}))
    .sort((a: Focus, b: Focus) => a.at - b.at)
    .slice(0, 4);

  // Camera target for one focus box, in window coordinates.
  const target = (f: Focus): Cam => {
    const [x, y, w, h] = f.box;
    const bw = Math.max(0.04, w) * ww;
    const bh = Math.max(0.03, h) * sh;
    const bx = x * ww + bw / 2;
    const by = BAR + y * sh + bh / 2;
    let k = Math.min((W * 0.62) / bw, (H * 0.5) / bh);
    const cap = f.action === 'highlight' ? 1.45 : f.action === 'click' ? 1.9 : 2.6;
    k = Math.max(1, Math.min(cap, k));
    return {k, tx: cx0 - left - k * bx, ty: cy0 - top - k * by};
  };
  const overview: Cam = {k: 1, tx: 0, ty: 0};

  // Blend from one camera state to the next with the pack's (damped) spring.
  let cam = overview;
  let active = -1;
  focus.forEach((f, i) => {
    const start = Math.round(f.at * fps) - 8; // start moving just before the word
    const pr = spring({frame: frame - start, fps, config: {damping: 200, stiffness: 70, mass: 1}});
    if (pr > 0.001) {
      const t = target(f);
      cam = {k: cam.k + (t.k - cam.k) * pr, tx: cam.tx + (t.tx - cam.tx) * pr, ty: cam.ty + (t.ty - cam.ty) * pr};
      if (frame >= start + 4) active = i;
    }
  });
  // Pull back out to the overview for the last ~0.8 s if there's room.
  const lastAt = focus.length ? focus[focus.length - 1].at : 0;
  const outStart = durationFrames - Math.round(0.9 * fps);
  if (focus.length && outStart > Math.round(lastAt * fps) + fps * 1.4) {
    const pr = spring({frame: frame - outStart, fps, config: {damping: 200, stiffness: 80}});
    cam = {k: cam.k + (1 - cam.k) * pr, tx: cam.tx * (1 - pr), ty: cam.ty * (1 - pr)};
    if (pr > 0.5) active = -1;
  }
  // Gentle drift so the overview never sits dead still.
  const drift = interpolate(frame, [0, durationFrames], [1, 1.035]);

  const enter = useEnter(0, 'rise');
  const titleEnter = useEnter(4);
  const f = active >= 0 ? focus[active] : null;
  const fStart = f ? Math.round(f.at * fps) : 0;
  const ring = f ? spring({frame: frame - fStart, fps, config: {damping: 18, stiffness: 120}}) : 0;

  // Box of the active focus, in window coordinates.
  const box = f ? {x: f.box[0] * ww, y: BAR + f.box[1] * sh, w: Math.max(0.04, f.box[2]) * ww, h: Math.max(0.03, f.box[3]) * sh} : null;
  const pad = 10 / cam.k;

  // Cursor for click focus: glides in from the lower right, then clicks at `at`.
  let cursor: null | {x: number; y: number; press: number; ripple: number} = null;
  if (f && f.action === 'click' && box) {
    const arrive = spring({frame: frame - (fStart - 18), fps, config: {damping: 200, stiffness: 90}});
    const tx = box.x + box.w / 2, ty = box.y + box.h / 2;
    const sx = box.x + box.w + 180 / cam.k, sy = box.y + box.h + 140 / cam.k;
    const local = frame - fStart;
    cursor = {
      x: sx + (tx - sx) * arrive,
      y: sy + (ty - sy) * arrive,
      press: local >= 0 && local < 6 ? 0.85 : 1,
      ripple: interpolate(local, [0, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
    };
  }

  return (
    <AbsoluteFill>
      {p.title ? (
        <div style={{position: 'absolute', top: H * (vertical ? 0.06 : 0.045), left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 2, ...titleEnter, opacity: (titleEnter.opacity as number) * (1 - Math.min(1, Math.max(0, (cam.k - 1) * 2)))}}>
          <div style={{fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: 52 * s.scale, color: s.palette.text, letterSpacing: `${s.headingTracking}em`, textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none'}}>
            {p.title}
          </div>
        </div>
      ) : null}

      <AbsoluteFill style={{...enter}}>
        <div
          style={{
            position: 'absolute', left, top, width: ww, height: sh + BAR,
            transformOrigin: '0 0',
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k * drift})`,
          }}
        >
          {/* browser window */}
          <div style={{position: 'absolute', inset: 0, borderRadius: 18, overflow: 'hidden', background: '#1b1d22', border: '1px solid rgba(255,255,255,0.16)', boxShadow: `0 50px 140px ${alpha('#000000', 0.5)}`}}>
            <div style={{height: BAR, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', background: '#24262c'}}>
              {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: 14, height: 14, borderRadius: 7, background: c}} />)}
              {p.url ? <div style={{marginLeft: 22, flex: 1, maxWidth: '50%', height: 26, borderRadius: 8, background: '#16171b', color: '#9aa0aa', fontFamily: s.font.mono, fontSize: 15, display: 'flex', alignItems: 'center', padding: '0 12px', overflow: 'hidden', whiteSpace: 'nowrap'}}>{p.url}</div> : null}
            </div>
            <Img src={asset(String(p.image || ''))} style={{display: 'block', width: ww, height: sh, objectFit: 'cover', objectPosition: 'top'}} />
          </div>

          {/* spotlight: dim everything but the focused element */}
          {box ? (
            <div
              style={{
                position: 'absolute', left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2,
                borderRadius: 12 / cam.k,
                boxShadow: `0 0 0 9999px ${alpha('#000000', 0.42 * Math.min(1, ring))}`,
                outline: `${4 / cam.k}px solid ${alpha(s.palette.accent, Math.min(1, ring))}`,
                outlineOffset: (2 / cam.k) * (1 - Math.min(1, ring)) * 10,
                pointerEvents: 'none',
              }}
            />
          ) : null}

          {/* label tooltip next to the element */}
          {box && f?.label ? (
            <div
              style={{
                position: 'absolute', left: box.x, top: box.y + box.h + pad + 14 / cam.k,
                transform: `scale(${1 / cam.k})`, transformOrigin: '0 0',
                opacity: Math.min(1, ring), whiteSpace: 'nowrap',
                background: s.palette.accent, color: s.palette.onAccent, borderRadius: 12, padding: '12px 22px',
                fontFamily: s.font.body, fontWeight: 700, fontSize: 30, boxShadow: '0 12px 30px rgba(0,0,0,0.3)',
              }}
            >
              {f.label}
            </div>
          ) : null}

          {/* cursor + click ripple, counter-scaled so it stays a normal size */}
          {cursor ? (
            <>
              <div style={{position: 'absolute', left: cursor.x, top: cursor.y, width: 0, height: 0}}>
                <div style={{position: 'absolute', left: -40 / cam.k, top: -40 / cam.k, width: 80 / cam.k, height: 80 / cam.k, borderRadius: '50%', border: `${3 / cam.k}px solid ${s.palette.accent}`, opacity: cursor.ripple > 0 ? 1 - cursor.ripple : 0, transform: `scale(${0.4 + cursor.ripple})`}} />
              </div>
              <svg
                width={40 / cam.k} height={48 / cam.k} viewBox="0 0 40 48"
                style={{position: 'absolute', left: cursor.x - 6 / cam.k, top: cursor.y - 4 / cam.k, transform: `scale(${cursor.press})`, transformOrigin: '6px 4px', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))'}}
              >
                <path d="M6 4 L6 38 L15 29 L21 43 L27 40 L21 27 L33 27 Z" fill="#ffffff" stroke="#111111" strokeWidth="2.5" strokeLinejoin="round" />
              </svg>
            </>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
