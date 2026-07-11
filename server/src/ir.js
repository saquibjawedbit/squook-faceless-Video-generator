// Shared IR (render_ir.json) helpers: timing recompute + structural validation.
// Mirrors renderer/src/ir.ts types and guide_creator_flow's ir_builder timing
// logic — duration_s is the source of truth, frames are derived.

const LAYER_TYPES = new Set([
  'video', 'image', 'solid', 'audio', 'text', 'graphic', 'captions', 'lottie', 'shader', 'motion',
]);
const TRANSITIONS = new Set(['cut', 'crossfade', 'slide']);

// Recompute every derived timing field from scene duration_s values.
// Must be a NO-OP on a pristine IR produced by the Python builder.
export function retime(ir) {
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

// Structural validation for client-submitted IRs. Throws Error with .status=400.
export function validateIr(ir) {
  const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) fail('ir must be an object');
  const md = ir.metadata;
  if (!md || typeof md !== 'object') fail('metadata missing');
  for (const k of ['fps', 'width', 'height']) {
    if (!Number.isFinite(md[k]) || md[k] <= 0) fail(`metadata.${k} invalid`);
  }
  if (!Array.isArray(ir.scenes) || !ir.scenes.length) fail('scenes must be a non-empty array');
  // A sanity cap against pathological IRs, not a product limit — long videos are
  // legitimate (a ~7-min explainer is ~60 scenes at ~7s each). Generation renders
  // without validating, so keep this well above real content or HD re-render 422s.
  if (ir.scenes.length > 400) fail('too many scenes (over 400)');

  ir.scenes.forEach((s, i) => {
    const at = `scene ${i + 1}`;
    if (!s || typeof s !== 'object') fail(`${at}: not an object`);
    if (!Number.isFinite(s.duration_s) || s.duration_s <= 0 || s.duration_s > 120) {
      fail(`${at}: duration_s must be 0–120s`);
    }
    if (!Array.isArray(s.layers)) fail(`${at}: layers must be an array`);
    if (s.layers.length > 12) fail(`${at}: too many layers`);
    if (!s.transition_out || !TRANSITIONS.has(s.transition_out.type)) {
      s.transition_out = { type: 'cut', duration_s: 0 };
    }
    s.layers.forEach((l, j) => {
      if (!l || !LAYER_TYPES.has(l.type)) fail(`${at} layer ${j}: unknown type`);
      if (l.src !== undefined) {
        if (typeof l.src !== 'string' || l.src.includes('..') || l.src.startsWith('/')
          || !/^[\w@()\-,. /]+$/.test(l.src)) fail(`${at} layer ${j}: bad src`);
      }
    });
  });
  return ir;
}

// Every media path an IR references, with the "output/" prefix stripped
// (matching renderer's asset() convention).
export function referencedPaths(ir) {
  const out = new Set();
  const add = (src) => {
    if (typeof src === 'string' && src) out.add(src.replace(/^output\//, ''));
  };
  add(ir?.metadata?.music?.src);
  for (const s of ir?.scenes || []) for (const l of s.layers || []) {
    add(l.src);
    // Graphic icon_row fetches per-icon SVGs into params.icon_srcs — snapshot
    // them too, or a re-render loses the icons.
    for (const iconSrc of l.params?.icon_srcs || []) add(iconSrc);
  }
  return [...out];
}
