import {useContext} from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {useTheme} from '../theme';
import type {PartStyle} from '../ir';
import {useEditor, LayerRefContext} from '../editor';

export const NodeGraph: React.FC<{
  nodeLayers: number[];
  labels: string[];
  pulse: 'forward' | 'backward' | 'none';
  fps: number;
  partStyles?: Record<string, PartStyle>;
}> = ({nodeLayers, labels, pulse, fps, partStyles}) => {
  const frame = useCurrentFrame();
  const {width: W, height: H} = useVideoConfig();
  const {palette, font} = useTheme();
  const ACCENT = palette.accent;
  const editor = useEditor();
  const layerRef = useContext(LayerRefContext);
  const cols = nodeLayers.length;
  const colX = (c: number) => W * 0.22 + (W * 0.56 * c) / Math.max(1, cols - 1);
  const nodeY = (c: number, i: number) => {
    const n = nodeLayers[c];
    return H / 2 + (i - (n - 1) / 2) * Math.min(150, (H * 0.6) / Math.max(1, n - 1 || 1));
  };

  // Pulse sweeps across columns repeatedly.
  const sweep = pulse === 'none' ? -1 : ((frame / fps) * 0.9) % (cols + 1);
  const colGlow = (c: number) => {
    if (sweep < 0) return 0;
    const pos = pulse === 'backward' ? cols - 1 - c : c;
    return Math.max(0, 1 - Math.abs(sweep - pos));
  };

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {nodeLayers.slice(0, -1).map((n, c) =>
          Array.from({length: n}).flatMap((_, i) =>
            Array.from({length: nodeLayers[c + 1]}).map((_, j) => {
              const grow = spring({frame: frame - (c * 8 + 5), fps, config: {damping: 200}});
              return (
                <line
                  key={`${c}-${i}-${j}`}
                  x1={colX(c)}
                  y1={nodeY(c, i)}
                  x2={colX(c) + (colX(c + 1) - colX(c)) * grow}
                  y2={nodeY(c, i) + (nodeY(c + 1, j) - nodeY(c, i)) * grow}
                  stroke={`rgba(255,255,255,${0.15 + 0.35 * colGlow(c)})`}
                  strokeWidth={2}
                />
              );
            })
          )
        )}
        {nodeLayers.map((n, c) =>
          Array.from({length: n}).map((_, i) => {
            const pop = spring({frame: frame - c * 8, fps, config: {damping: 12}});
            const glow = colGlow(c);
            return (
              <circle
                key={`${c}-${i}`}
                cx={colX(c)}
                cy={nodeY(c, i)}
                r={26 * pop * (1 + 0.15 * glow)}
                fill={glow > 0.4 ? ACCENT : '#1e2633'}
                stroke={ACCENT}
                strokeWidth={3}
                opacity={0.9}
              />
            );
          })
        )}
        {labels.slice(0, cols).map((label, c) => {
          const o = partStyles?.[`label_${c}`];
          const selected =
            editor && layerRef &&
            editor.selected?.scene === layerRef.scene &&
            editor.selected?.layer === layerRef.layer &&
            editor.selected?.part === `label_${c}`;
          const tx = ((o?.transform?.x_pct || 0) / 100) * W;
          const ty = ((o?.transform?.y_pct || 0) / 100) * H;
          return (
            <text
              key={c}
              x={colX(c) + tx}
              y={H * 0.88 + ty}
              fill={o?.color ?? palette.text}
              fontSize={o?.font_size ?? 34}
              fontFamily={o?.font_family ?? font.family}
              fontWeight={o?.font_weight ?? 700}
              fontStyle={o?.italic ? 'italic' : 'normal'}
              textAnchor="middle"
              style={editor ? {cursor: 'pointer'} : undefined}
              stroke={selected ? ACCENT : undefined}
              strokeWidth={selected ? 1 : undefined}
              onPointerDown={editor && layerRef ? (e) => {
                e.stopPropagation();
                editor.select(layerRef.scene, layerRef.layer, `label_${c}`);
              } : undefined}
              opacity={(o?.transform?.opacity ?? 1) * interpolate(frame, [c * 8 + 10, c * 8 + 25], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
