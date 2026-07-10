// Editor view-model over the render IR (render_ir.json). The IR is the
// document; these helpers derive the timeline's clips/texts/audio arrays in
// the exact shape the SquookEditor prototype renders, and mirror the server's
// retime() so derived timing stays correct between autosaves.

const PALETTE = ['#c2410c', '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#a16207', '#1e3a8a', '#0e7490'];
const GRAPHIC_NAMES = {
  node_graph: 'Node graph', bar_chart: 'Bar chart', counter: 'Counter',
  icon_row: 'Icon row', title_card: 'Title card', annotate: 'Annotate',
};
// Which layer "is" the shot when a scene is selected as a clip.
const VISUAL_PRIORITY = ['video', 'image', 'graphic', 'lottie', 'shader', 'solid'];

export const basename = (src) => String(src || '').split('/').pop();

export function primaryVisualIx(scene) {
  for (const t of VISUAL_PRIORITY) {
    const ix = (scene?.layers || []).findIndex((l) => l.type === t);
    if (ix >= 0) return ix;
  }
  return -1;
}

export const sceneGrad = (ix) => `linear-gradient(135deg,#141419,${PALETTE[ix % PALETTE.length]})`;

function sceneLabel(scene) {
  const ix = primaryVisualIx(scene);
  const l = ix >= 0 ? scene.layers[ix] : null;
  if (!l) return 'Empty scene';
  if (l.type === 'video' || l.type === 'image' || l.type === 'lottie') return basename(l.src);
  if (l.type === 'graphic') return l.params?.title || GRAPHIC_NAMES[l.kind] || l.kind;
  if (l.type === 'shader') return `${l.kind} shader`;
  if (l.type === 'solid') return 'Solid card';
  return l.type;
}

// IR transform ({x_pct, y_pct, scale: 1, opacity: 1}) ↔ the inspector's
// slider space ({x, y, scale: 100, op: 100}).
export const uiTf = (layer) => {
  const t = layer?.transform || {};
  return {
    scale: Math.round((t.scale ?? 1) * 100),
    x: Math.round(t.x_pct ?? 0),
    y: Math.round(t.y_pct ?? 0),
    rot: Math.round(t.rotate_deg ?? 0),
    op: Math.round((t.opacity ?? 1) * 100),
  };
};

export const irTfPatch = (prop, val) => ({
  scale: { scale: val / 100 },
  x: { x_pct: val },
  y: { y_pct: val },
  rot: { rotate_deg: val },
  op: { opacity: val / 100 },
}[prop] || {});

// Derive {clips, texts, audio, total} from an IR — same field names the mock
// state used, so the render body works unchanged. Each item carries its
// sceneIx/layerIx back-reference for mutations.
export function deriveView(ir) {
  const clips = [];
  const texts = [];
  const audio = [];
  let start = 0;
  (ir.scenes || []).forEach((sc, si) => {
    const dur = sc.duration_s;
    clips.push({
      id: 'sc' + si, sceneIx: si, scene: 'S' + (si + 1), label: sceneLabel(sc),
      src: 'Scene ' + (si + 1), dur, grad: sceneGrad(si), narration: sc.narration || '',
    });
    (sc.layers || []).forEach((l, li) => {
      const id = `ly${si}_${li}`;
      if (l.type === 'text') {
        const at = l.enter?.at_s || 0;
        const out = Math.min(dur, l.exit?.at_s ?? dur);
        texts.push({
          id, sceneIx: si, layerIx: li, kind: 'text', editable: true,
          content: l.content || '', editText: l.content || '',
          start: +(start + at).toFixed(2), dur: Math.max(0.4, +(out - at).toFixed(2)),
          size: l.style?.font_size || 46,
        });
      } else if (l.type === 'captions') {
        texts.push({
          id, sceneIx: si, layerIx: li, kind: 'captions', editable: false,
          content: `Captions · ${(l.words || []).length} words`, editText: '',
          start, dur, size: 46,
        });
      } else if (l.type === 'graphic') {
        const editText = l.params?.title ?? l.params?.label ?? '';
        texts.push({
          id, sceneIx: si, layerIx: li, kind: 'graphic', gkind: l.kind,
          editable: l.params?.title !== undefined || l.params?.label !== undefined,
          content: (GRAPHIC_NAMES[l.kind] || l.kind) + (l.params?.title ? ` — ${l.params.title}` : ''),
          editText, start, dur, size: 46,
        });
      } else if (l.type === 'audio') {
        audio.push({
          id, sceneIx: si, layerIx: li, kind: 'vo',
          label: `Narration — scene ${si + 1}`, vol: Math.round((l.volume ?? 1) * 100),
          start: +(start + (l.start_s || 0)).toFixed(2), dur: Math.max(0.4, +(dur - (l.start_s || 0)).toFixed(2)),
        });
      }
    });
    start += dur;
  });
  if (ir.metadata?.music?.src) {
    audio.unshift({
      id: 'music', kind: 'music', label: 'Music — ' + basename(ir.metadata.music.src),
      vol: Math.round((ir.metadata.music.volume ?? 1) * 100),
    });
  }
  return { clips, texts, audio, total: +start.toFixed(2) };
}

// Approximate on-stage hit regions (percent coords) for the scene playing at
// `relT` seconds in. The MP4 is flat, but the IR says what's on screen and
// (roughly) where each layer type renders, so the Select tool can pick
// components straight off the video. Sorted overlays-first for hit priority.
export function stageRegions(ir, sceneIx, relT = 0) {
  const sc = ir?.scenes?.[sceneIx];
  if (!sc) return [];
  // The scene itself is always the full-frame base region (footage/shader/solid).
  const out = [{ id: 'sc' + sceneIx, sel: { type: 'clip', id: 'sc' + sceneIx }, label: sceneLabel(sc), region: { x: 0, y: 0, w: 100, h: 100 }, z: 10 }];
  (sc.layers || []).forEach((l, li) => {
    const id = `ly${sceneIx}_${li}`;
    if (l.type === 'captions') {
      out.push({ id, sel: { type: 'text', id }, label: 'Captions', region: { x: 8, y: 68, w: 84, h: 24 }, z: 12 });
    } else if (l.type === 'text') {
      // Only while the text is actually on screen.
      const at = l.enter?.at_s ?? 0;
      const out_s = l.exit?.at_s ?? sc.duration_s;
      if (relT < at - 0.2 || relT > out_s + 0.2) return;
      const pos = l.position || 'center';
      const region = pos === 'lower_third' ? { x: 8, y: 62, w: 84, h: 24 }
        : pos === 'top' ? { x: 8, y: 6, w: 84, h: 22 }
          : { x: 14, y: 32, w: 72, h: 34 };
      out.push({ id, sel: { type: 'text', id }, label: '“' + String(l.content || 'Text').slice(0, 26) + '”', region, z: 12 });
    } else if (l.type === 'graphic') {
      out.push({ id, sel: { type: 'text', id }, label: GRAPHIC_NAMES[l.kind] || l.kind, region: { x: 10, y: 10, w: 80, h: 56 }, z: 11 });
    }
  });
  return out.sort((a, b) => b.z - a.z);
}

// The topmost region under a stage point (percent coords).
export function regionAt(regions, x, y) {
  return regions.find((r) => x >= r.region.x && x <= r.region.x + r.region.w && y >= r.region.y && y <= r.region.y + r.region.h) || null;
}

// Resolve a selection to a concrete {sceneIx, layerIx} in the IR. Clip
// selections point at the scene's primary visual layer; 'music' lives in
// metadata, not a layer, so it resolves to null.
export function selRefOf(ir, view, sel) {
  if (!ir || !sel) return null;
  if (sel.type === 'clip') {
    const c = view.clips.find((x) => x.id === sel.id);
    if (!c) return null;
    const li = primaryVisualIx(ir.scenes[c.sceneIx]);
    return li >= 0 ? { sceneIx: c.sceneIx, layerIx: li } : null;
  }
  const it = (sel.type === 'text' ? view.texts : view.audio).find((x) => x.id === sel.id);
  return it && it.layerIx != null ? { sceneIx: it.sceneIx, layerIx: it.layerIx } : null;
}

// Client-side mirror of server/src/ir.js retime() — duration_s is the source
// of truth, every derived timing field is recomputed. No-op on a pristine IR.
export function retimeLocal(ir) {
  const fps = ir.metadata.fps;
  let cursor = 0;
  ir.scenes.forEach((s, i) => {
    s.scene = i + 1;
    s.duration_frames = Math.max(1, Math.round(s.duration_s * fps));
    s.start_frame = cursor;
    cursor += s.duration_frames;
    if (s.transition_out && s.transition_out.type !== 'cut') {
      s.transition_out.duration_s = Math.min(
        s.transition_out.duration_s, +(s.duration_s / 2).toFixed(2));
    }
    for (const l of s.layers || []) {
      if (l.type === 'text' && l.exit) {
        l.exit.at_s = Math.min(l.exit.at_s, Math.max(1, +(s.duration_s - 0.5).toFixed(2)));
      }
    }
  });
  ir.metadata.scene_count = ir.scenes.length;
  ir.metadata.total_frames = cursor;
  ir.metadata.total_duration_seconds = +(cursor / fps).toFixed(2);
  return ir;
}
