import type {CSSProperties} from 'react';
import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Heading, VFrame, useBeat, useEnter, useProgress, useVertical} from './kit';
import {Mark, SafeArea, clampLines, ellipsis, str, useFrameInfo, useRamp, warnOf} from './Stat';

type Cell = boolean | string | null;
type Row = {label: string; a: Cell; b: Cell};

const toCell = (v: unknown): Cell => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no') return false;
  if (v == null) return null;
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' ? v : null;
};

const CellView: React.FC<{v: Cell; us: boolean; delay: number; rowH: number; z?: number}> = ({v, us, delay, rowH, z = 1}) => {
  const s = useStyle();
  const {k: k0} = useFrameInfo();
  const k = k0 * z;
  const draw = useRamp(delay + 3, delay + 17);
  const enter = useEnter(delay + 2);
  const size = Math.min(56 * k, rowH * (z > 1 ? 0.6 : 0.52));
  if (v === true || v === false) {
    const color = v ? (us ? s.palette.onAccent : s.palette.muted) : us ? s.palette.muted : warnOf(s);
    const fill = v && us ? s.palette.accent : undefined;
    const ring = v && !us ? alpha(s.palette.muted, 0.45) : !v ? alpha(color, 0.35) : undefined;
    return <Mark ok={v} size={size} progress={draw} color={color} fill={fill} ring={ring} />;
  }
  if (v === null) return <div style={{width: 28 * k, height: 3 * k, borderRadius: 2, background: alpha(s.palette.muted, 0.4), opacity: enter.opacity}} />;
  return (
    <div
      style={{
        ...clampLines(2),
        fontFamily: us ? s.font.heading : s.font.body,
        fontWeight: us ? Math.max(600, s.headingWeight) : 500,
        fontSize: (us ? 34 : 31) * k * (us ? s.scale : 1),
        lineHeight: 1.15,
        textAlign: 'center',
        color: us ? s.palette.text : s.palette.muted,
        padding: `0 ${14 * k}px`,
        ...enter,
      }}
    >
      {v}
    </div>
  );
};

const RowView: React.FC<{row: Row; delay: number; rowH: number; last: boolean; cols: string; z?: number}> = ({row, delay, rowH, last, cols, z = 1}) => {
  const s = useStyle();
  const {k: k0} = useFrameInfo();
  const k = k0 * z;
  const enter = useEnter(delay);
  const rule = useProgress(delay);
  const fillIn = Math.max(0, Math.min(1, useProgress(delay - 2)));
  const usCell: CSSProperties = {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: alpha(s.palette.accent, (s.id === 'clean' || s.id === 'editorial' || s.id === 'playful' ? 0.09 : 0.12) * fillIn),
    borderLeft: `1px solid ${alpha(s.palette.accent, 0.35 * fillIn)}`,
    borderRight: `1px solid ${alpha(s.palette.accent, 0.35 * fillIn)}`,
    borderBottom: last ? `1px solid ${alpha(s.palette.accent, 0.35 * fillIn)}` : undefined,
    borderRadius: last ? `0 0 ${s.radius * k}px ${s.radius * k}px` : 0,
  };
  return (
    <div style={{position: 'relative', display: 'grid', gridTemplateColumns: cols, height: rowH, alignItems: 'center'}}>
      {!last && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.max(1, z > 1 ? 2 : 1),
            background: alpha(s.palette.text, 0.12),
            transformOrigin: '0% 50%',
            transform: `scaleX(${Math.max(0, Math.min(1, rule))})`,
          }}
        />
      )}
      <div style={{...ellipsis, ...clampLines(2), whiteSpace: 'normal', fontFamily: s.font.body, fontSize: 36 * k, fontWeight: 500, lineHeight: 1.2, color: s.palette.text, paddingRight: 24 * k, ...enter}}>
        {row.label}
      </div>
      <div style={usCell}>
        <CellView v={row.a} us delay={delay} rowH={rowH} z={z} />
      </div>
      <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <CellView v={row.b} us={false} delay={delay + 3} rowH={rowH} z={z} />
      </div>
    </div>
  );
};

export const Compare: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const s = useStyle();
  const {H, k, tall} = useFrameInfo();
  const title = str(p.title);
  const colsIn: unknown[] = Array.isArray(p.columns) ? p.columns : [];
  const colA = str(colsIn[0]) || 'Us';
  const colB = str(colsIn[1]) || 'Others';
  const rows: Row[] = (Array.isArray(p.rows) ? p.rows : [])
    .slice(0, 8)
    .map((r: unknown) => {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return {label: str(o.label), a: toCell(o.a), b: toCell(o.b)};
    });
  const base = title ? 12 : 6;
  const delays = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => useBeat(beats, i, base)); // eslint-disable-line react-hooks/rules-of-hooks
  const at = (i: number) => (Number.isFinite(beats?.[i]) ? delays[i] : base + 6 + i * 10);
  const head = useEnter(title ? 6 : 0);
  const panel = useProgress(title ? 6 : 0);

  const headerH = (tall ? 120 : 104) * k;
  const avail = H * 0.74 - (title ? 170 * k : 0) - headerH;
  const rowH = Math.max(64 * k, Math.min((tall ? 128 : 104) * k, avail / Math.max(1, rows.length)));
  const cols = tall ? 'minmax(0,1.25fr) minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr)';
  const r = s.radius * k;
  const vg = useVertical();

  const header = (hH: number, z: number, gc = cols) => (
    <div style={{display: 'grid', gridTemplateColumns: gc, height: hH, alignItems: 'stretch', flex: 'none'}}>
      <div />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: s.palette.accent,
          borderRadius: `${r * z}px ${r * z}px 0 0`,
          padding: `0 ${16 * k}px`,
          transformOrigin: '50% 100%',
          transform: `scaleY(${0.4 + 0.6 * Math.max(0, Math.min(1, panel))})`,
          opacity: Math.min(1, Math.max(0, panel)),
        }}
      >
        <span style={{...(z > 1 ? {...clampLines(2), textAlign: 'center', lineHeight: 1.05} : ellipsis), fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: 38 * k * z * s.scale, color: s.palette.onAccent, textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none'}}>{colA}</span>
      </div>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${16 * k}px`, ...head}}>
        <span style={{...(z > 1 ? {...clampLines(2), textAlign: 'center', lineHeight: 1.1} : ellipsis), fontFamily: s.font.body, fontWeight: 600, fontSize: 32 * k * z, color: s.palette.muted}}>{colB}</span>
      </div>
    </div>
  );

  if (vg.v) {
    // Phone layout: big title, then a table that fills the block with tall
    // rows and large marks.
    const u = vg.u;
    const z = 1.3 / (k / u);
    const vCols = 'minmax(0,1.55fr) minmax(0,0.9fr) minmax(0,0.9fr)'; // type ~1.4x the old tall size, in width units
    const hH = 150 * u;
    const titleEst = title ? 2 * 104 * u * s.scale * 1.06 + 64 * u : 0;
    const vRow = Math.max(110 * u, Math.min(230 * u, (vg.blockH - titleEst - hH) / Math.max(1, rows.length)));
    return (
      <VFrame
        durationFrames={durationFrames}
        justify="center"
        titleGap={64 * u}
        title={title ? <Heading size={104 * u} style={{...clampLines(3)}}>{title}</Heading> : null}
      >
        {rows.length === 0 ? null : (
          <div style={{width: '100%'}}>
            {header(hH, z, vCols)}
            {rows.map((row, i) => (
              <RowView key={i} row={row} delay={at(i)} rowH={vRow} last={i === rows.length - 1} cols={vCols} z={z} />
            ))}
          </div>
        )}
      </VFrame>
    );
  }

  return (
    <SafeArea durationFrames={durationFrames}>
      {title ? (
        <Heading size={(tall ? 76 : 64) * k} style={{marginBottom: (tall ? 64 : 48) * k, maxWidth: tall ? '100%' : '80%', ...clampLines(2)}}>
          {title}
        </Heading>
      ) : null}
      {rows.length === 0 ? null : (
      <div style={{width: '100%'}}>
        <div style={{display: 'grid', gridTemplateColumns: cols, height: headerH, alignItems: 'stretch'}}>
          <div />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: s.palette.accent,
              borderRadius: `${r}px ${r}px 0 0`,
              padding: `0 ${16 * k}px`,
              transformOrigin: '50% 100%',
              transform: `scaleY(${0.4 + 0.6 * Math.max(0, Math.min(1, panel))})`,
              opacity: Math.min(1, Math.max(0, panel)),
            }}
          >
            <span style={{...ellipsis, fontFamily: s.font.heading, fontWeight: s.headingWeight, fontSize: 38 * k * s.scale, color: s.palette.onAccent, textTransform: s.headingCase === 'upper' ? 'uppercase' : 'none'}}>{colA}</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${16 * k}px`, ...head}}>
            <span style={{...ellipsis, fontFamily: s.font.body, fontWeight: 600, fontSize: 32 * k, color: s.palette.muted}}>{colB}</span>
          </div>
        </div>
        {rows.map((row, i) => (
          <RowView key={i} row={row} delay={at(i)} rowH={rowH} last={i === rows.length - 1} cols={cols} />
        ))}
      </div>
      )}
    </SafeArea>
  );
};
