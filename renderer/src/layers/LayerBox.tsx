import {useRef} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import type {Layer, Transform} from '../ir';
import {useEditor, LayerRefContext} from '../editor';

const ACCENT = '#FF5A2D';
const CLICK_SLOP_PX = 3; // pointer travel below this = click (select), not drag

const transformStyle = (t: Transform | undefined, width: number, height: number): React.CSSProperties => {
  if (!t) return {};
  const parts: string[] = [];
  if (t.x_pct || t.y_pct) {
    parts.push(`translate(${((t.x_pct || 0) / 100) * width}px, ${((t.y_pct || 0) / 100) * height}px)`);
  }
  if (t.scale != null && t.scale !== 1) parts.push(`scale(${t.scale})`);
  if (t.rotate_deg) parts.push(`rotate(${t.rotate_deg}deg)`);
  const style: React.CSSProperties = {};
  if (parts.length) style.transform = parts.join(' ');
  if (t.opacity != null) style.opacity = t.opacity;
  return style;
};

/**
 * Wraps every visual layer. Outside the editor it is a strict no-op unless the
 * layer carries a `transform` (then it just applies the styles). Inside the
 * editor it adds click-to-select, a selection outline, pointer-drag to move
 * (writes transform.x_pct/y_pct) and a corner handle to scale.
 */
export const LayerBox: React.FC<{
  layer: Layer;
  sceneIdx: number;
  layerIdx: number;
  children: React.ReactNode;
}> = ({layer, sceneIdx, layerIdx, children}) => {
  const editor = useEditor();
  const {width, height} = useVideoConfig();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    startX: number; startY: number;
    x0: number; y0: number; scale0: number;
    mode: 'move' | 'scale';
    moved: boolean;
    raf: number | null;
    pending: Transform | null;
  } | null>(null);

  const t = 'transform' in layer ? layer.transform : undefined;

  // CLI render / non-editor fast path.
  if (!editor && !t) return <>{children}</>;
  if (!editor) {
    return (
      <AbsoluteFill style={{...transformStyle(t, width, height), pointerEvents: 'none'}}>
        {children}
      </AbsoluteFill>
    );
  }

  const ref = {scene: sceneIdx, layer: layerIdx};

  const isSelected = editor.selected?.scene === sceneIdx && editor.selected?.layer === layerIdx;

  const flush = () => {
    const d = drag.current;
    if (!d || !d.pending) return;
    editor.patchLayer(sceneIdx, layerIdx, {transform: d.pending});
    d.pending = null;
    d.raf = null;
  };

  const schedule = (next: Transform) => {
    const d = drag.current;
    if (!d) return;
    d.pending = next;
    if (d.raf == null) d.raf = requestAnimationFrame(flush);
  };

  // Screen px → composition px: the box always spans the full composition.
  const compScale = () => {
    const rect = boxRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? width / rect.width : 1;
  };

  const onPointerDown = (mode: 'move' | 'scale') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* synthetic events have no active pointer */ }
    drag.current = {
      startX: e.clientX, startY: e.clientY,
      x0: t?.x_pct || 0, y0: t?.y_pct || 0, scale0: t?.scale ?? 1,
      mode, moved: false, raf: null, pending: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    d.moved = true;
    const k = compScale();
    if (d.mode === 'move') {
      schedule({
        ...t,
        x_pct: +(d.x0 + ((dx * k) / width) * 100).toFixed(2),
        y_pct: +(d.y0 + ((dy * k) / height) * 100).toFixed(2),
      });
    } else {
      const next = Math.min(5, Math.max(0.1, d.scale0 * (1 + ((dx + dy) * k) / width)));
      schedule({...t, scale: +next.toFixed(3)});
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.raf != null) cancelAnimationFrame(d.raf);
    flush();
    drag.current = null;
    if (d.moved) editor.commit();
    else editor.select(sceneIdx, layerIdx); // plain click = select (repeat-click cycles in the app)
  };

  return (
    <AbsoluteFill
      ref={boxRef}
      style={{
        ...transformStyle(t, width, height),
        pointerEvents: 'auto',
        cursor: isSelected ? 'move' : 'pointer',
        outline: isSelected ? `${Math.max(2, width / 360)}px dashed ${ACCENT}` : 'none',
        outlineOffset: -Math.max(2, width / 360),
      }}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <LayerRefContext.Provider value={ref}>{children}</LayerRefContext.Provider>
      {isSelected ? (
        <div
          onPointerDown={onPointerDown('scale')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: Math.max(18, width / 40),
            height: Math.max(18, width / 40),
            background: ACCENT,
            borderRadius: 4,
            cursor: 'nwse-resize',
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
