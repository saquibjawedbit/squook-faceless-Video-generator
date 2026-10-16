import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Body, Heading, VFrame, useBeat, useEnter, useProgress, useVertical} from './kit';
import {SafeArea, clampLines, str, useFrameInfo, useRamp} from './Stat';

type Item = {title: string; text: string};

/** Numbered node: outlined until its beat, then fills with the accent. */
const Node: React.FC<{n: number; delay: number; size: number}> = ({n, delay, size}) => {
  const s = useStyle();
  const p = useProgress(delay);
  const fill = Math.max(0, Math.min(1, p));
  const pop = useEnter(delay, 'pop');
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        border: `${Math.max(2, size * 0.03)}px solid ${alpha(s.palette.accent, 0.5)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...pop,
      }}
    >
      <div style={{position: 'absolute', inset: -2, borderRadius: '50%', background: s.palette.accent, transform: `scale(${fill})`, boxShadow: s.id === 'tech' ? `0 0 ${size * 0.5}px ${alpha(s.palette.accent, 0.45)}` : undefined}} />
      <span
        style={{
          position: 'relative',
          fontFamily: s.font.heading,
          fontWeight: s.headingWeight,
          fontSize: size * 0.42,
          lineHeight: 1,
          color: fill > 0.5 ? s.palette.onAccent : s.palette.accent,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {String(n).padStart(2, '0')}
      </span>
    </div>
  );
};

/** Connector that draws from step i to step i+1 as the next step lands. */
const Connector: React.FC<{from: number; to: number; vertical: boolean; thick: number}> = ({from, to, vertical, thick}) => {
  const s = useStyle();
  const start = from + 8;
  const end = to > start + 4 ? to + 2 : start + 14;
  const g = useRamp(start, end);
  return (
    <div style={{position: 'relative', flex: 1, [vertical ? 'width' : 'height']: thick, borderRadius: thick, background: alpha(s.palette.text, 0.12), overflow: 'hidden'} as React.CSSProperties}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: s.palette.accent,
          transformOrigin: vertical ? '50% 0%' : '0% 50%',
          transform: vertical ? `scaleY(${g})` : `scaleX(${g})`,
        }}
      />
    </div>
  );
};

export const Steps: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const {k, tall} = useFrameInfo();
  const title = str(p.title);
  const items: Item[] = (Array.isArray(p.items) ? p.items : [])
    .slice(0, 6)
    .map((it: unknown) => {
      if (typeof it === 'string') return {title: it, text: ''};
      const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      return {title: str(o.title ?? o.label), text: str(o.text)};
    });
  const n = items.length;
  const base = title ? 10 : 4;
  const delays = [0, 1, 2, 3, 4, 5].map((i) => useBeat(beats, i, base)); // eslint-disable-line react-hooks/rules-of-hooks
  // Without voice cues, space steps out more so each one reads.
  const at = (i: number) => (Number.isFinite(beats?.[i]) ? delays[i] : base + i * 16);

  const node = (tall ? (n >= 5 ? 104 : 124) : n >= 5 ? 84 : 104) * k;
  const thick = 5 * k;
  const vg = useVertical();

  if (vg.v) {
    // Phone layout: big title on top, one step per row filling the block,
    // nodes joined by a connector that runs the full height between rows.
    const u = vg.u;
    const vn = (n >= 5 ? 124 : n === 4 ? 150 : 170) * u;
    const ts = n >= 5 ? 0.86 : n === 4 ? 1 : 1.12;
    return (
      <VFrame
        durationFrames={durationFrames}
        justify="flex-start"
        titleGap={(n >= 5 ? 60 : 84) * u}
        title={title ? <Heading size={104 * u} style={{...clampLines(3)}}>{title}</Heading> : null}
      >
        {items.map((it, i) => (
          <div key={i} style={{display: 'flex', gap: 44 * u, alignItems: 'stretch', flex: i < n - 1 ? '1 1 0' : 'none', minHeight: 0}}>
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: vn, flex: 'none'}}>
              <Node n={i + 1} delay={at(i)} size={vn} />
              {i < n - 1 ? (
                <div style={{flex: 1, display: 'flex', padding: `${18 * u}px 0`, minHeight: 30 * u}}>
                  <Connector from={at(i)} to={at(i + 1)} vertical thick={7 * u} />
                </div>
              ) : null}
            </div>
            <div style={{flex: 1, minWidth: 0, paddingTop: vn * 0.08, paddingBottom: i < n - 1 ? 36 * u : 0}}>
              {it.title ? (
                <Heading size={72 * u * ts} delay={at(i) + 2} style={{...clampLines(2)}}>
                  {it.title}
                </Heading>
              ) : null}
              {it.text ? (
                <Body size={44 * u * ts} delay={at(i) + 7} style={{marginTop: 14 * u, ...clampLines(3)}}>
                  {it.text}
                </Body>
              ) : null}
            </div>
          </div>
        ))}
      </VFrame>
    );
  }

  return (
    <SafeArea durationFrames={durationFrames}>
      {title ? (
        <Heading size={(tall ? 76 : 68) * k} style={{marginBottom: (tall ? 72 : 72) * k, maxWidth: tall ? '100%' : '78%', ...clampLines(2)}}>
          {title}
        </Heading>
      ) : null}

      {tall ? (
        <div style={{display: 'flex', flexDirection: 'column'}}>
          {items.map((it, i) => (
            <div key={i} style={{display: 'flex', gap: 40 * k, alignItems: 'stretch'}}>
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: node}}>
                <Node n={i + 1} delay={at(i)} size={node} />
                {i < n - 1 ? (
                  <div style={{flex: 1, display: 'flex', padding: `${14 * k}px 0`, minHeight: 40 * k}}>
                    <Connector from={at(i)} to={at(i + 1)} vertical thick={thick} />
                  </div>
                ) : null}
              </div>
              <div style={{flex: 1, minWidth: 0, paddingTop: node * 0.14, paddingBottom: i < n - 1 ? (n >= 5 ? 44 : 84) * k : 0}}>
                <StepText item={it} delay={at(i) + 2} size={n >= 5 ? 1.1 : 1.3} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{display: 'flex', alignItems: 'flex-start'}}>
          {items.map((it, i) => (
            <div key={i} style={{flex: i < n - 1 ? 1 : n === 1 ? 1 : 0.82, minWidth: 0}}>
              <div style={{display: 'flex', alignItems: 'center', marginBottom: 48 * k}}>
                <Node n={i + 1} delay={at(i)} size={node} />
                {i < n - 1 ? (
                  <div style={{flex: 1, display: 'flex', alignItems: 'center', padding: `0 ${22 * k}px`}}>
                    <Connector from={at(i)} to={at(i + 1)} vertical={false} thick={thick} />
                  </div>
                ) : null}
              </div>
              <div style={{paddingRight: 48 * k}}>
                <StepText item={it} delay={at(i) + 2} size={n >= 5 ? 0.86 : 1} />
              </div>
            </div>
          ))}
        </div>
      )}
    </SafeArea>
  );
};

const StepText: React.FC<{item: Item; delay: number; size: number}> = ({item, delay, size}) => {
  const {k} = useFrameInfo();
  return (
    <>
      {item.title ? (
        <Heading size={54 * k * size} delay={delay} style={{...clampLines(2)}}>
          {item.title}
        </Heading>
      ) : null}
      {item.text ? (
        <Body size={34 * k * size} delay={delay + 5} style={{marginTop: 16 * k, ...clampLines(3)}}>
          {item.text}
        </Body>
      ) : null}
    </>
  );
};
