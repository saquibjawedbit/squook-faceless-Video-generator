import type {TemplateProps} from '.';
import {alpha, useStyle} from '../styles';
import {Body, Heading, useBeat, useEnter, useProgress} from './kit';
import {BigNumber, SafeArea, clampLines, finalNumberText, fitNumber, str, useFrameInfo, useNumberText} from './Stat';

type Item = {number?: unknown; prefix?: unknown; suffix?: unknown; label?: unknown};

const StatCard: React.FC<{item: Item; delay: number; size: number; index: number; single?: boolean}> = ({item, delay, size, index, single}) => {
  const s = useStyle();
  const {k, tall} = useFrameInfo();
  const enter = useEnter(delay);
  const bar = useProgress(delay + 8);
  const prefix = str(item.prefix);
  const suffix = str(item.suffix);
  const label = str(item.label);
  const text = useNumberText(item.number, delay + 4, 40);
  const first = index === 0;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        maxWidth: single ? 1000 * k : undefined,
        position: 'relative',
        overflow: 'hidden',
        background: s.card.bg,
        border: `1px solid ${s.card.border}`,
        boxShadow: s.card.shadow,
        borderRadius: s.radius * k * 1.2,
        padding: `${(tall ? 40 : 52) * k}px ${44 * k}px ${(tall ? 40 : 48) * k}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: (tall ? 250 : 330) * k,
        ...enter,
      }}
    >
      {/* accent rule that draws across the top edge as the card lands */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: 6 * k,
          width: `${Math.max(0, Math.min(1, bar)) * 100}%`,
          background: first ? s.palette.accent : alpha(s.palette.accent, 0.55),
        }}
      />
      <BigNumber text={text || '0'} final={finalNumberText(item.number)} prefix={prefix} suffix={suffix} size={size} />
      {label ? (
        <Body size={(tall ? 36 : 34) * k} delay={delay + 8} muted style={{marginTop: 28 * k, ...clampLines(2)}}>
          {label}
        </Body>
      ) : null}
    </div>
  );
};

export const Stats: React.FC<TemplateProps> = ({p, beats, durationFrames}) => {
  const s = useStyle();
  const {W, k, tall} = useFrameInfo();
  const title = str(p.title);
  const items: Item[] = (Array.isArray(p.items) ? p.items : []).filter((x: unknown) => x && typeof x === 'object').slice(0, 4);
  const base = title ? 10 : 4;
  const n = Math.max(1, items.length);
  const inner = Math.min(tall ? W * 0.84 - 88 * k : (W * 0.85 - (n - 1) * 32 * k) / n - 88 * k, n === 1 ? 1000 * k - 88 * k : Infinity);
  // One size for every card (the widest number decides), so the row reads as a set.
  const size = Math.min(
    ...items.map((it) => fitNumber((tall ? 170 : n >= 3 ? 170 : 210) * k * s.scale, inner, finalNumberText(it.number), str(it.prefix), str(it.suffix), s)),
    (tall ? 170 : 210) * k * s.scale,
  );
  const delays = [0, 1, 2, 3].map((i) => useBeat(beats, i, base)); // eslint-disable-line react-hooks/rules-of-hooks

  return (
    <SafeArea durationFrames={durationFrames}>
      {title ? (
        <Heading size={(tall ? 76 : 68) * k} style={{marginBottom: (tall ? 64 : 60) * k, maxWidth: tall ? '100%' : '78%', ...clampLines(2)}}>
          {title}
        </Heading>
      ) : null}
      <div style={{display: 'flex', flexDirection: tall ? 'column' : 'row', gap: (tall ? 28 : 32) * k, alignItems: 'stretch'}}>
        {items.map((it, i) => (
          <StatCard key={i} item={it} delay={delays[i]} size={size} index={i} single={items.length === 1} />
        ))}
      </div>
    </SafeArea>
  );
};
