import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Heading, VFrame, useBeat, useCountUp, useEnter, useProgress, useVertical} from './kit';
import {SafeArea, clampLines, ellipsis, parseNum, str, useFrameInfo} from './Stat';

type Bar = {label: string; value: number; hi: boolean; delay: number; pct: number};

const decimalsOf = (v: number) => (String(v).includes('.') ? String(v).split('.')[1].length : 0);

const ValueText: React.FC<{v: number; delay: number; unit: string; hi: boolean; size: number}> = ({v, delay, unit, hi, size}) => {
  const s = useStyle();
  const t = useCountUp(decimalsOf(v) > 2 ? Number(v.toFixed(2)) : v, delay, 36);
  const e = useEnter(delay + 4);
  const short = unit.length <= 3 ? unit : '';
  return (
    <div
      style={{
        fontFamily: s.font.heading,
        fontWeight: s.headingWeight,
        fontSize: size,
        color: hi ? s.palette.accent : s.palette.text,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        opacity: e.opacity,
      }}
    >
      {t}
      {short ? <span style={{fontSize: '0.62em', marginLeft: '0.08em', opacity: 0.75}}>{short}</span> : null}
    </div>
  );
};

/** Vertical column bar. */
const Column: React.FC<{b: Bar; chartH: number; colW: number; unit: string}> = ({b, chartH, colW, unit}) => {
  const s = useStyle();
  const {k} = useFrameInfo();
  const g = Math.max(0, useProgress(b.delay));
  const h = Math.max(0, chartH * b.pct * g);
  const barW = Math.min(150 * k, colW * 0.62);
  const r = Math.min(s.radius, 16) * k;
  return (
    <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%'}}>
      <div style={{marginBottom: 16 * k}}>
        <ValueText v={b.value} delay={b.delay} unit={unit} hi={b.hi} size={(b.hi ? 46 : 40) * k * s.scale} />
      </div>
      <div
        style={{
          width: barW,
          height: h,
          borderRadius: `${r}px ${r}px ${r * 0.25}px ${r * 0.25}px`,
          background: b.hi ? `linear-gradient(180deg, ${s.palette.accent}, ${alpha(s.palette.accent, 0.82)})` : alpha(s.palette.text, 0.14),
          boxShadow: b.hi && s.id === 'tech' ? `0 0 ${40 * k}px ${alpha(s.palette.accent, 0.35)}` : undefined,
        }}
      />
    </div>
  );
};

/** Horizontal bar row. */
const Row: React.FC<{b: Bar; rowH: number; labelW: number; stacked: boolean; unit: string}> = ({b, rowH, labelW, stacked, unit}) => {
  const s = useStyle();
  const {k} = useFrameInfo();
  const g = Math.max(0, useProgress(b.delay));
  const lab = useEnter(b.delay);
  const thick = Math.max(14 * k, rowH * (stacked ? 0.4 : 0.5));
  const r = Math.min(s.radius, 14) * k;
  const labelEl = (
    <div
      style={{
        ...ellipsis,
        width: stacked ? '100%' : labelW,
        flexShrink: 0,
        fontFamily: s.font.body,
        fontSize: (stacked ? 38 : 34) * k,
        fontWeight: b.hi ? 700 : 500,
        color: b.hi ? s.palette.text : s.palette.muted,
        textAlign: stacked ? 'left' : 'right',
        paddingRight: stacked ? 0 : 28 * k,
        marginBottom: stacked ? 12 * k : 0,
        ...lab,
      }}
    >
      {b.label}
    </div>
  );
  return (
    <div style={{height: rowH, display: 'flex', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', justifyContent: 'center'}}>
      {labelEl}
      <div style={{flex: stacked ? undefined : 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 18 * k}}>
        <div style={{flex: `0 0 calc(${b.pct * g * 82}% )`, height: thick, borderRadius: r, background: b.hi ? s.palette.accent : alpha(s.palette.text, 0.14), boxShadow: b.hi && s.id === 'tech' ? `0 0 ${36 * k}px ${alpha(s.palette.accent, 0.35)}` : undefined}} />
        <ValueText v={b.value} delay={b.delay} unit={unit} hi={b.hi} size={(b.hi ? 40 : 36) * k * s.scale} />
      </div>
    </div>
  );
};

export const Chart: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const s = useStyle();
  const {W, H, k, tall} = useFrameInfo();
  const title = str(p.title);
  const unit = str(p.unit);
  const raw: unknown[] = (Array.isArray(p.items) ? p.items : []).slice(0, 8);
  const base = title ? 10 : 4;
  const delays = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => useBeat(beats, i, base)); // eslint-disable-line react-hooks/rules-of-hooks
  const axis = useProgress(Math.max(0, (delays[0] ?? 0) - 6));
  const unitEnter = useEnter(4);

  const vals = raw.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    return {label: str(o.label), value: Math.max(0, parseNum(o.value) ?? 0)};
  });
  const max = Math.max(1e-9, ...vals.map((v) => v.value));
  const hiIn = typeof p.highlight === 'number' ? Math.round(p.highlight) : parseNum(p.highlight);
  const argmax = vals.reduce((best, v, i) => (v.value > (vals[best]?.value ?? -1) ? i : best), 0);
  const hi = hiIn !== null && hiIn >= 0 && hiIn < vals.length ? hiIn : argmax;
  const bars: Bar[] = vals.map((v, i) => ({...v, hi: i === hi, delay: delays[i], pct: v.value / max}));

  const longLabels = bars.some((b) => b.label.length > 14);
  const horizontal = tall || longLabels || bars.length > 6;

  const headerH = title ? 150 * k : unit.length > 3 ? 60 * k : 0;
  const availH = H * 0.74 - headerH;
  const innerW = W * (tall ? 0.84 : 0.85);
  const vg = useVertical();

  if (vg.v) {
    // Phone layout: big title, then thick horizontal bars, one per row, with
    // the label above each bar and a large value at its end.
    const u = vg.u;
    const nb = Math.max(1, bars.length);
    const z = nb <= 4 ? 1.25 : nb <= 6 ? 1.1 : 0.95;
    return (
      <VFrame
        durationFrames={durationFrames}
        justify="space-evenly"
        titleGap={40 * u}
        title={
          title || unit.length > 3 ? (
            <div>
              {title ? <Heading size={104 * u} style={{...clampLines(3)}}>{title}</Heading> : null}
              {unit.length > 3 ? (
                <div style={{fontFamily: s.font.mono, fontSize: 30 * u, letterSpacing: '0.16em', textTransform: 'uppercase', color: s.palette.muted, marginTop: 22 * u, ...unitEnter}}>
                  {unit}
                </div>
              ) : null}
            </div>
          ) : null
        }
      >
        {bars.map((b, i) => (
          <VRow key={i} b={b} z={z} u={u} unit={unit} />
        ))}
      </VFrame>
    );
  }

  return (
    <SafeArea durationFrames={durationFrames}>
      {(title || unit.length > 3) && (
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 * k, marginBottom: (tall ? 56 : 44) * k}}>
          {title ? (
            <Heading size={(tall ? 72 : 64) * k} style={{flex: 1, minWidth: 0, ...clampLines(2)}}>
              {title}
            </Heading>
          ) : (
            <div />
          )}
          {unit.length > 3 ? (
            <div style={{fontFamily: s.font.mono, fontSize: 24 * k, letterSpacing: '0.16em', textTransform: 'uppercase', color: s.palette.muted, whiteSpace: 'nowrap', paddingBottom: 10 * k, ...unitEnter}}>
              {unit}
            </div>
          ) : null}
        </div>
      )}
      {bars.length === 0 ? null : horizontal ? (
        <div style={{position: 'relative', paddingLeft: tall ? 0 : 0}}>
          {(() => {
            const rowH = Math.min((tall ? 160 : 124) * k, availH / bars.length);
            const labelW = Math.min(innerW * 0.3, 420 * k);
            return bars.map((b, i) => <Row key={i} b={b} rowH={rowH} labelW={labelW} stacked={tall} unit={unit} />);
          })()}
        </div>
      ) : (
        <div>
          {(() => {
            const chartH = Math.max(120 * k, Math.min(560 * k, availH - 150 * k));
            const colW = innerW / bars.length;
            return (
              <div style={{position: 'relative'}}>
                <div style={{display: 'flex', alignItems: 'flex-end', height: chartH + 64 * k}}>
                  {bars.map((b, i) => (
                    <Column key={i} b={b} chartH={chartH} colW={colW} unit={unit} />
                  ))}
                </div>
                {/* baseline draws across first */}
                <div style={{height: 2 * k, background: alpha(s.palette.text, 0.22), width: `${Math.max(0, Math.min(1, axis)) * 100}%`}} />
                <div style={{display: 'flex'}}>
                  {bars.map((b, i) => (
                    <ColumnLabel key={i} b={b} />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </SafeArea>
  );
};

/** Vertical (9:16) bar row: label on top, thick bar + big value below. */
const VRow: React.FC<{b: Bar; z: number; u: number; unit: string}> = ({b, z, u, unit}) => {
  const s = useStyle();
  const g = Math.max(0, useProgress(b.delay));
  const lab = useEnter(b.delay);
  const thick = 64 * u * z;
  const r = Math.min(s.radius, 16) * u * z;
  return (
    <div style={{display: 'flex', flexDirection: 'column'}}>
      <div
        style={{
          ...ellipsis,
          fontFamily: s.font.body,
          fontSize: 44 * u * z,
          fontWeight: b.hi ? 700 : 500,
          color: b.hi ? s.palette.text : s.palette.muted,
          marginBottom: 14 * u * z,
          ...lab,
        }}
      >
        {b.label}
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 24 * u}}>
        <div
          style={{
            flex: `0 0 calc(${Math.max(0.012, b.pct * g) * 72}%)`,
            height: thick,
            borderRadius: r,
            background: b.hi ? s.palette.accent : alpha(s.palette.text, 0.16),
            boxShadow: b.hi && s.id === 'tech' ? `0 0 ${40 * u}px ${alpha(s.palette.accent, 0.4)}` : undefined,
          }}
        />
        <ValueText v={b.value} delay={b.delay} unit={unit} hi={b.hi} size={(b.hi ? 64 : 56) * u * z * s.scale} />
      </div>
    </div>
  );
};

const ColumnLabel: React.FC<{b: Bar}> = ({b}) => {
  const s = useStyle();
  const {k} = useFrameInfo();
  const lab = useEnter(b.delay + 2);
  return (
    <div
      style={{
        flex: 1,
        ...ellipsis,
        padding: `${18 * k}px ${8 * k}px 0`,
        fontFamily: s.font.body,
        fontSize: 30 * k,
        fontWeight: b.hi ? 700 : 500,
        color: b.hi ? s.palette.text : s.palette.muted,
        textAlign: 'center',
        ...lab,
      }}
    >
      {b.label}
    </div>
  );
};
