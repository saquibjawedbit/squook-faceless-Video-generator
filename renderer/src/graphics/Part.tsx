import {useContext, useRef} from 'react';
import {useVideoConfig} from 'remotion';
import type {PartStyle, Transform} from '../ir';
import {useEditor, LayerRefContext} from '../editor';
import {resolveFont} from '../fonts';

const ACCENT = '#FF5A2D';
const CLICK_SLOP_PX = 3;

// Merge a graphic sub-element's animated base style with the user's per-part
// overrides (font, colour, transform). Absent overrides = original look.
export function applyPartStyle(
  base: React.CSSProperties,
  o: PartStyle | undefined,
  W: number,
  H: number,
): React.CSSProperties {
  if (!o) return base;
  const s: React.CSSProperties = {...base};
  if (o.font_size != null) s.fontSize = o.font_size;
  if (o.font_family) s.fontFamily = resolveFont(o.font_family);
  if (o.font_weight != null) s.fontWeight = o.font_weight;
  if (o.italic != null) s.fontStyle = o.italic ? 'italic' : 'normal';
  if (o.letter_spacing != null) s.letterSpacing = `${o.letter_spacing}px`;
  if (o.align) s.textAlign = o.align;
  if (o.color) s.color = o.color;
  if (o.bg) s.background = o.bg;
  const t = o.transform;
  if (t) {
    const parts: string[] = [];
    if (t.x_pct || t.y_pct) parts.push(`translate(${((t.x_pct || 0) / 100) * W}px, ${((t.y_pct || 0) / 100) * H}px)`);
    if (t.scale != null && t.scale !== 1) parts.push(`scale(${t.scale})`);
    if (t.rotate_deg) parts.push(`rotate(${t.rotate_deg}deg)`);
    // User transform composes on top of the component's animation transform.
    if (parts.length) s.transform = `${parts.join(' ')} ${base.transform || ''}`.trim();
    if (t.opacity != null) s.opacity = (typeof base.opacity === 'number' ? base.opacity : 1) * t.opacity;
  }
  return s;
}

/**
 * A selectable/draggable text sub-element inside a composite graphic (a
 * counter's number, a title card's subtitle …). A strict no-op wrapper in CLI
 * renders; in the editor it selects `part`, shows an outline, and drags to
 * write `part_styles[part].transform`.
 */
export const Part: React.FC<{
  name: string;
  base: React.CSSProperties;
  partStyles?: Record<string, PartStyle>;
  children: React.ReactNode;
}> = ({name, base, partStyles, children}) => {
  const editor = useEditor();
  const layerRef = useContext(LayerRefContext);
  const {width, height} = useVideoConfig();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{startX: number; startY: number; x0: number; y0: number; moved: boolean; raf: number | null; pending: Transform | null} | null>(null);

  const override = partStyles?.[name];
  const style = applyPartStyle(base, override, width, height);

  if (!editor || !layerRef) return <div style={style}>{children}</div>;

  const isSelected =
    editor.selected?.scene === layerRef.scene &&
    editor.selected?.layer === layerRef.layer &&
    editor.selected?.part === name;

  const flush = () => {
    const d = drag.current;
    if (!d || !d.pending) return;
    editor.patchPart(layerRef.scene, layerRef.layer, name, {transform: d.pending});
    d.pending = null;
    d.raf = null;
  };
  const schedule = (next: Transform) => {
    const d = drag.current;
    if (!d) return;
    d.pending = next;
    if (d.raf == null) d.raf = requestAnimationFrame(flush);
  };
  const compScale = () => {
    const rect = boxRef.current?.getBoundingClientRect();
    // Map screen px → composition px via the whole preview's scale.
    const player = boxRef.current?.closest('.__remotion-player') as HTMLElement | null;
    const pw = player?.getBoundingClientRect().width;
    return pw && pw > 0 ? width / pw : rect && rect.width > 0 ? 1 : 1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // beat LayerBox — select the part, not the whole graphic
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const t = override?.transform;
    drag.current = {startX: e.clientX, startY: e.clientY, x0: t?.x_pct || 0, y0: t?.y_pct || 0, moved: false, raf: null, pending: null};
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    d.moved = true;
    const k = compScale();
    schedule({
      ...override?.transform,
      x_pct: +(d.x0 + ((dx * k) / width) * 100).toFixed(2),
      y_pct: +(d.y0 + ((dy * k) / height) * 100).toFixed(2),
    });
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    if (d.raf != null) cancelAnimationFrame(d.raf);
    flush();
    drag.current = null;
    if (d.moved) editor.commit();
    else editor.select(layerRef.scene, layerRef.layer, name);
  };

  return (
    <div
      ref={boxRef}
      style={{
        ...style,
        cursor: isSelected ? 'move' : 'pointer',
        outline: isSelected ? `${Math.max(2, width / 400)}px dashed ${ACCENT}` : 'none',
        outlineOffset: 4,
        borderRadius: 4,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  );
};
