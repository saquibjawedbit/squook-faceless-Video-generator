// AI edits for the editor. Two contracts:
//  - SCOPED (a layer is selected): the model echoes ONE updated layer.
//  - GLOBAL: the model returns a small ops list applied by pure JS — never a
//    full-IR echo (local models mangle 900-line JSON with word-level captions).
// Everything the model returns is whitelisted + clamped before it touches the IR.
import { config } from './config.js';
import { chatJSON } from './ollama.js';
import { retime } from './ir.js';

/* ---------- sanitizers ---------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (v, opts) => (opts.includes(v) ? v : undefined);
const cssColor = (v) => (typeof v === 'string' && v.length <= 60 && !/[<>;{}]/.test(v) ? v : undefined);

function sanitizeTransform(t) {
  if (!t || typeof t !== 'object') return undefined;
  const out = {};
  if (num(t.x_pct) !== undefined) out.x_pct = clamp(t.x_pct, -100, 100);
  if (num(t.y_pct) !== undefined) out.y_pct = clamp(t.y_pct, -100, 100);
  if (num(t.scale) !== undefined) out.scale = clamp(t.scale, 0.1, 5);
  if (num(t.rotate_deg) !== undefined) out.rotate_deg = clamp(t.rotate_deg, -180, 180);
  if (num(t.opacity) !== undefined) out.opacity = clamp(t.opacity, 0, 1);
  return Object.keys(out).length ? out : undefined;
}

function sanitizeStyle(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {};
  if (num(s.font_size) !== undefined) out.font_size = clamp(s.font_size, 12, 200);
  if (typeof s.font_family === 'string' && s.font_family.length <= 100 && !/[<>;{}]/.test(s.font_family)) {
    out.font_family = s.font_family;
  }
  if (num(s.font_weight) !== undefined) out.font_weight = clamp(Math.round(s.font_weight / 100) * 100, 100, 900);
  if (bool(s.italic) !== undefined) out.italic = s.italic;
  if (num(s.letter_spacing) !== undefined) out.letter_spacing = clamp(s.letter_spacing, -5, 40);
  if (oneOf(s.align, ['left', 'center', 'right'])) out.align = s.align;
  if (cssColor(s.color)) out.color = s.color;
  if (cssColor(s.bg)) out.bg = s.bg;
  return Object.keys(out).length ? out : undefined;
}

// Caption style = the generic text style plus caption-only controls:
// vertical position, active-word highlight colour, and all-caps.
function sanitizeCaptionStyle(s) {
  const out = sanitizeStyle(s) || {};
  if (s && typeof s === 'object') {
    if (oneOf(s.position, ['top', 'center', 'bottom'])) out.position = s.position;
    if (cssColor(s.highlight)) out.highlight = s.highlight;
    if (bool(s.uppercase) !== undefined) out.uppercase = s.uppercase;
  }
  return Object.keys(out).length ? out : undefined;
}

// A graphic sub-element's style override = TextStyle fields + a transform.
function sanitizePartStyle(s) {
  const style = sanitizeStyle(s) || {};
  const t = sanitizeTransform(s?.transform);
  if (t) style.transform = t;
  return Object.keys(style).length ? style : undefined;
}

// The primary editable text/value behind a graphic part (mirrors the webapp's
// graphicParts.js). Part names match renderer/src/graphics <Part name>.
function partPrimaryText(layer, part) {
  const p = layer.params || {};
  const m = /^label_(\d+)$/.exec(part);
  if (part === 'value') return p.number;
  if (part === 'label') return p.label;
  if (part === 'title') return p.title;
  if (part === 'subtitle') return p.subtitle;
  if (m && Array.isArray(p.labels)) return p.labels[+m[1]];
  return undefined;
}

// The renderer's default font size for each graphic part, so the model scales
// relative to reality (a counter's number is 220px, not 40px).
function partBaseFontSize(layer, part, ir) {
  if (/^label_\d+$/.test(part)) {
    return { bar_chart: 30, icon_row: 38, node_graph: 34 }[layer.kind] ?? 34;
  }
  switch (`${layer.kind}:${part}`) {
    case 'counter:value': return 220;
    case 'counter:label': return 54;
    case 'title_card:title': return ir.metadata.theme?.font?.title_size ?? 83;
    case 'title_card:subtitle': return 44;
    case 'bar_chart:title': return 52;
    case 'annotate:label': return 48;
    default: return 44;
  }
}

function setPartText(layer, part, value) {
  const p = { ...(layer.params || {}) };
  const m = /^label_(\d+)$/.exec(part);
  if (part === 'value') { const n = Number(value); if (Number.isFinite(n)) p.number = n; }
  else if (part === 'label') p.label = String(value).slice(0, 200);
  else if (part === 'title') p.title = String(value).slice(0, 200);
  else if (part === 'subtitle') p.subtitle = String(value).slice(0, 300);
  else if (m && Array.isArray(p.labels)) { const arr = p.labels.slice(); arr[+m[1]] = String(value).slice(0, 120); p.labels = arr; }
  else return;
  layer.params = p;
}

function sanitizeParams(p) {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  if (str(p.title, 120) !== undefined) out.title = p.title.slice(0, 120);
  if (str(p.subtitle, 200) !== undefined) out.subtitle = p.subtitle.slice(0, 200);
  if (str(p.label, 80) !== undefined) out.label = p.label.slice(0, 80);
  if (str(p.suffix, 12) !== undefined) out.suffix = p.suffix.slice(0, 12);
  if (num(p.number) !== undefined) out.number = Number(p.number);
  if (Array.isArray(p.labels)) out.labels = p.labels.map((x) => String(x).slice(0, 60)).slice(0, 12);
  if (Array.isArray(p.values)) out.values = p.values.map(Number).filter(Number.isFinite).slice(0, 12);
  if (Array.isArray(p.icons)) out.icons = p.icons.map((x) => String(x).slice(0, 30)).slice(0, 8);
  if (oneOf(p.pulse, ['forward', 'backward', 'none'])) out.pulse = p.pulse;
  if (oneOf(p.annotation, ['arrow', 'circle', 'underline'])) out.annotation = p.annotation;
  return Object.keys(out).length ? out : undefined;
}

// Merge a model-proposed layer patch onto the original, allowing only fields
// that are editable for that layer type. `src` and `words` are untouchable.
function sanitizeLayerPatch(original, proposed, sceneDuration) {
  if (!proposed || typeof proposed !== 'object') return {};
  const out = {};
  const t = sanitizeTransform(proposed.transform);
  if (t && original.type !== 'audio') out.transform = t;

  switch (original.type) {
    case 'text': {
      if (str(proposed.content) !== undefined) out.content = proposed.content.slice(0, 300);
      if (oneOf(proposed.position, ['lower_third', 'center', 'top'])) out.position = proposed.position;
      const style = sanitizeStyle(proposed.style);
      if (style) out.style = { ...original.style, ...style };
      if (proposed.enter && typeof proposed.enter === 'object') {
        const anim = oneOf(proposed.enter.anim, ['fade_up', 'typewriter', 'slide_in']);
        const at = num(proposed.enter.at_s);
        out.enter = {
          anim: anim || original.enter?.anim || 'fade_up',
          at_s: at !== undefined ? clamp(at, 0, sceneDuration) : (original.enter?.at_s ?? 0),
        };
      }
      if (proposed.exit && typeof proposed.exit === 'object') {
        const at = num(proposed.exit.at_s);
        if (at !== undefined) out.exit = { anim: 'fade', at_s: clamp(at, 0, sceneDuration) };
      }
      break;
    }
    case 'captions': {
      const style = sanitizeCaptionStyle(proposed.style);
      if (style) out.style = { ...original.style, ...style };
      break;
    }
    case 'video': {
      if (oneOf(proposed.fit, ['cover', 'contain'])) out.fit = proposed.fit;
      if (num(proposed.playback_rate) !== undefined) out.playback_rate = clamp(proposed.playback_rate, 0.25, 3);
      if (bool(proposed.loop) !== undefined) out.loop = proposed.loop;
      if (bool(proposed.freeze_last) !== undefined) out.freeze_last = proposed.freeze_last;
      if (num(proposed.trim_start_s) !== undefined) out.trim_start_s = Math.max(0, Number(proposed.trim_start_s));
      if (proposed.trim_end_s === null) out.trim_end_s = null;
      else if (num(proposed.trim_end_s) !== undefined) out.trim_end_s = Math.max(0, Number(proposed.trim_end_s));
      break;
    }
    case 'image': {
      if (oneOf(proposed.fit, ['cover', 'contain'])) out.fit = proposed.fit;
      if (oneOf(proposed.ken_burns, ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'])) out.ken_burns = proposed.ken_burns;
      break;
    }
    case 'solid': {
      if (cssColor(proposed.color)) out.color = proposed.color;
      break;
    }
    case 'graphic': {
      if (oneOf(proposed.kind, ['node_graph', 'bar_chart', 'counter', 'icon_row', 'title_card', 'annotate'])) out.kind = proposed.kind;
      const params = sanitizeParams(proposed.params);
      if (params) out.params = { ...original.params, ...params };
      // Per-part style overrides (counter number, title-card subtitle, …).
      if (proposed.part_styles && typeof proposed.part_styles === 'object') {
        const ps = { ...original.part_styles };
        for (const [k, v] of Object.entries(proposed.part_styles)) {
          const st = sanitizePartStyle(v);
          if (st) ps[k] = { ...ps[k], ...st };
        }
        if (Object.keys(ps).length) out.part_styles = ps;
      }
      break;
    }
    case 'shader': {
      if (oneOf(proposed.kind, ['nebula', 'waves', 'grid'])) out.kind = proposed.kind;
      break;
    }
    case 'lottie': {
      if (bool(proposed.loop) !== undefined) out.loop = proposed.loop;
      break;
    }
    case 'audio': {
      if (num(proposed.volume) !== undefined) out.volume = clamp(proposed.volume, 0, 1);
      break;
    }
  }
  return out;
}

/* ---------- compact IR view for global prompts ---------- */

function compactLayer(l, i) {
  const base = { i, type: l.type };
  if (l.transform) base.transform = l.transform;
  switch (l.type) {
    case 'text': return { ...base, content: l.content, position: l.position, style: l.style, enter: l.enter, exit: l.exit };
    case 'captions': return { ...base, words: `${l.words?.length || 0} timed words (not editable)`, style: l.style };
    case 'video': return { ...base, src: (l.src || '').split('/').pop(), fit: l.fit, playback_rate: l.playback_rate, trim_start_s: l.trim_start_s, trim_end_s: l.trim_end_s, loop: l.loop, freeze_last: l.freeze_last };
    case 'image': return { ...base, src: (l.src || '').split('/').pop(), fit: l.fit, ken_burns: l.ken_burns };
    case 'audio': return { ...base, role: 'voiceover', volume: l.volume ?? 1 };
    case 'graphic': return { ...base, kind: l.kind, params: l.params, ...(l.part_styles ? { part_styles: l.part_styles } : {}) };
    case 'shader': return { ...base, kind: l.kind };
    case 'solid': return { ...base, color: l.color };
    case 'lottie': return { ...base, loop: l.loop };
    default: return base;
  }
}

export function compactIr(ir) {
  return {
    metadata: {
      title: ir.metadata.title,
      total_duration_seconds: ir.metadata.total_duration_seconds,
      width: ir.metadata.width,
      height: ir.metadata.height,
      theme: ir.metadata.theme,
      music: ir.metadata.music,
    },
    scenes: ir.scenes.map((s) => ({
      scene: s.scene,
      duration_s: s.duration_s,
      narration: (s.narration || '').slice(0, 120),
      transition_out: s.transition_out,
      layers: s.layers.map(compactLayer),
    })),
  };
}

/* ---------- ops (global edits) ---------- */

export function applyOps(ir, ops) {
  const errors = [];
  if (!Array.isArray(ops)) return { errors: ['`ops` must be an array'] };
  if (ops.length > 20) return { errors: ['too many ops (max 20)'] };
  const next = structuredClone(ir);

  const sceneAt = (n, ctx) => {
    const idx = Number(n) - 1; // ops address scenes 1-based
    if (!Number.isInteger(idx) || idx < 0 || idx >= next.scenes.length) {
      errors.push(`${ctx}: scene ${n} does not exist (1–${next.scenes.length})`);
      return null;
    }
    return next.scenes[idx];
  };

  for (const op of ops) {
    if (!op || typeof op !== 'object') { errors.push('op is not an object'); continue; }
    switch (op.op) {
      case 'set_layer': {
        const scene = sceneAt(op.scene, 'set_layer');
        if (!scene) break;
        const layer = scene.layers[op.layer];
        if (!layer) { errors.push(`set_layer: scene ${op.scene} has no layer ${op.layer}`); break; }
        Object.assign(layer, sanitizeLayerPatch(layer, op.patch, scene.duration_s));
        break;
      }
      case 'set_scene': {
        const scene = sceneAt(op.scene, 'set_scene');
        if (!scene || !op.patch || typeof op.patch !== 'object') break;
        if (num(op.patch.duration_s) !== undefined) scene.duration_s = clamp(op.patch.duration_s, 0.5, 120);
        if (str(op.patch.narration, 500) !== undefined) scene.narration = op.patch.narration.slice(0, 500);
        if (op.patch.transition_out && typeof op.patch.transition_out === 'object') {
          const type = oneOf(op.patch.transition_out.type, ['cut', 'crossfade', 'slide']);
          if (type) {
            scene.transition_out = {
              type,
              duration_s: type === 'cut' ? 0 : clamp(num(op.patch.transition_out.duration_s) ?? 0.4, 0.1, 3),
            };
          }
        }
        break;
      }
      case 'set_theme': {
        const theme = next.metadata.theme || (next.metadata.theme = {});
        const p = op.patch || {};
        if (p.palette && typeof p.palette === 'object') {
          theme.palette = theme.palette || {};
          for (const k of ['bg', 'bg_light', 'accent', 'accent2', 'text']) {
            if (cssColor(p.palette[k])) theme.palette[k] = p.palette[k];
          }
        }
        if (p.font && typeof p.font === 'object') {
          theme.font = theme.font || {};
          if (num(p.font.caption_size) !== undefined) theme.font.caption_size = clamp(p.font.caption_size, 16, 120);
          if (num(p.font.title_size) !== undefined) theme.font.title_size = clamp(p.font.title_size, 24, 220);
        }
        break;
      }
      case 'set_music': {
        if (op.remove === true) delete next.metadata.music;
        else if (next.metadata.music && num(op.volume) !== undefined) {
          next.metadata.music.volume = clamp(op.volume, 0, 1);
        }
        break;
      }
      case 'reorder_scenes': {
        const order = op.order;
        const n = next.scenes.length;
        const valid = Array.isArray(order) && order.length === n
          && [...order].sort((a, b) => a - b).every((v, i) => v === i + 1);
        if (!valid) { errors.push(`reorder_scenes: order must be a permutation of 1–${n}`); break; }
        next.scenes = order.map((v) => next.scenes[v - 1]);
        break;
      }
      case 'remove_scene': {
        if (next.scenes.length <= 1) { errors.push('remove_scene: cannot remove the last scene'); break; }
        const scene = sceneAt(op.scene, 'remove_scene');
        if (scene) next.scenes.splice(next.scenes.indexOf(scene), 1);
        break;
      }
      case 'remove_layer': {
        const scene = sceneAt(op.scene, 'remove_layer');
        if (!scene) break;
        if (!scene.layers[op.layer]) { errors.push(`remove_layer: scene ${op.scene} has no layer ${op.layer}`); break; }
        scene.layers.splice(op.layer, 1);
        break;
      }
      case 'add_layer': {
        const scene = sceneAt(op.scene, 'add_layer');
        if (!scene) break;
        const l = op.layer || {};
        if (l.type === 'text') {
          const fresh = {
            type: 'text',
            content: str(l.content, 300) ?? 'New text',
            position: oneOf(l.position, ['lower_third', 'center', 'top']) || 'center',
            enter: { anim: 'fade_up', at_s: clamp(num(l.enter?.at_s) ?? 0.3, 0, scene.duration_s) },
            exit: { anim: 'fade', at_s: clamp(num(l.exit?.at_s) ?? Math.max(1, scene.duration_s - 0.5), 0, scene.duration_s) },
          };
          const style = sanitizeStyle(l.style);
          if (style) fresh.style = style;
          const t = sanitizeTransform(l.transform);
          if (t) fresh.transform = t;
          scene.layers.push(fresh);
        } else if (l.type === 'solid') {
          scene.layers.unshift({ type: 'solid', color: cssColor(l.color) || '#000000' });
        } else {
          errors.push(`add_layer: only "text" and "solid" layers can be added (got ${l.type})`);
        }
        break;
      }
      default:
        errors.push(`unknown op "${op.op}"`);
    }
  }
  return { next, errors };
}

/* ---------- prompts ---------- */

export const OPS_SPEC = `You edit a short video described by JSON. Respond with ONLY this JSON shape:
{"ops": [...], "summary": "<one short sentence describing what you changed>"}

Available ops (scene numbers are 1-based, layer indexes are 0-based, both refer to the JSON you were given):
{"op":"set_layer","scene":N,"layer":I,"patch":{...}}            — edit a layer's editable fields
{"op":"set_scene","scene":N,"patch":{"duration_s":S,"narration":"...","transition_out":{"type":"cut|crossfade|slide","duration_s":S}}}
{"op":"set_theme","patch":{"palette":{"bg":"#hex","accent":"#hex","accent2":"#hex","text":"#hex"},"font":{"caption_size":N,"title_size":N}}}
{"op":"set_music","volume":0..1}   or   {"op":"set_music","remove":true}
{"op":"reorder_scenes","order":[2,1,3,...]}                      — a full permutation
{"op":"remove_scene","scene":N}
{"op":"remove_layer","scene":N,"layer":I}
{"op":"add_layer","scene":N,"layer":{"type":"text","content":"...","position":"center","style":{"font_size":60,"color":"#fff"}}}

Layer patch fields by type:
- every visual layer: "transform": {"x_pct":-100..100,"y_pct":-100..100,"scale":0.1..5,"rotate_deg":-180..180,"opacity":0..1}
- text: content, position(lower_third|center|top), style{font_size,font_family,font_weight,italic,letter_spacing,align,color,bg}, enter{anim,at_s}, exit{at_s}
- captions: style{font_size,font_family,font_weight,italic,letter_spacing,color,bg,position(top|center|bottom),highlight(active-word color),uppercase(bool)} — the timed words themselves are NOT editable. font_family may be any Google font name (e.g. "Bebas Neue", "Playfair Display").
- video: fit(cover|contain), playback_rate(0.25..3), loop, freeze_last, trim_start_s, trim_end_s
- image: fit, ken_burns(zoom_in|zoom_out|pan_left|pan_right)
- solid: color; shader: kind(nebula|waves|grid); lottie: loop; audio: volume(0..1)
- graphic: kind, params{title,subtitle,label,number,suffix,labels[],values[],icons[]}, part_styles{<partName>:{font_size,color,font_family,font_weight,italic,transform}} — parts: counter→value,label; title_card→title,subtitle; bar_chart→title,label_0,label_1…; annotate→label

Rules: use the SMALLEST set of ops that fulfils the request. Never invent new media files.
Timing (start_frame etc.) is recomputed automatically — only ever change duration_s.`;

const STYLE_SPEC = 'style{font_size:12-200, font_family:"css font stack e.g. Georgia, serif", font_weight:100-900, italic:bool, letter_spacing:px, align:left|center|right, color, bg}';

const layerSpec = (type) => ({
  text: `fields: content, position(lower_third|center|top), ${STYLE_SPEC}, enter{anim:fade_up|typewriter|slide_in, at_s}, exit{at_s}, transform{x_pct,y_pct,scale,rotate_deg,opacity}`,
  captions: `fields: style{font_size:12-200, font_family(any Google font name e.g. "Bebas Neue"), font_weight:100-900, italic, letter_spacing, color, bg, position(top|center|bottom), highlight(active-word color), uppercase(bool)}, transform{...}. The timed words are NOT editable.`,
  video: 'fields: fit(cover|contain), playback_rate(0.25-3), loop, freeze_last, trim_start_s, trim_end_s, transform{...}. "src" is NOT editable.',
  image: 'fields: fit(cover|contain), ken_burns(zoom_in|zoom_out|pan_left|pan_right), transform{...}. "src" is NOT editable.',
  solid: 'fields: color, transform{...}',
  graphic: 'fields: kind(node_graph|bar_chart|counter|icon_row|title_card|annotate), params{title,subtitle,label,number,suffix,labels[],values[]}, transform{...}',
  shader: 'fields: kind(nebula|waves|grid), transform{...}',
  lottie: 'fields: loop, transform{...}',
  audio: 'fields: volume(0-1)',
}[type] || 'fields: transform{...}');

/* ---------- entry point ---------- */

// Compact transcript of the recent chat so follow-ups resolve ("shorter than
// that", "same but blue"). Capped hard — context, not a second document.
function historyBlock(history) {
  if (!Array.isArray(history) || !history.length) return '';
  const lines = history
    .filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'user' : 'editor'}: ${m.text.slice(0, 240)}`);
  return lines.length ? `Recent conversation (context for the instruction):\n${lines.join('\n')}\n\n` : '';
}

export async function runAiEdit({ ir, instruction, selection, history }) {
  const isPart = selection && selection.part != null;
  const convo = historyBlock(history);

  if (config.mockEdits) {
    // Deterministic edit so the whole loop is testable without Ollama.
    if (isPart) {
      const next = structuredClone(ir);
      const L = next.scenes[selection.scene]?.layers[selection.layer];
      if (L?.type === 'graphic') {
        L.part_styles = { ...L.part_styles, [selection.part]: { ...L.part_styles?.[selection.part], color: '#3ad29f' } };
      }
      return { ir: retime(next), summary: `(mock edit) “${selection.part}” → mint` };
    }
    const { next } = applyOps(ir, [{ op: 'set_theme', patch: { palette: { accent: '#3ad29f' } } }]);
    return { ir: retime(next), summary: `(mock edit) accent → mint — you asked: “${instruction.slice(0, 60)}”` };
  }

  // Part-scoped edit: one text element inside a composite graphic.
  if (isPart) {
    const scene = ir.scenes[selection.scene];
    const layer = scene?.layers[selection.layer];
    if (!layer || layer.type !== 'graphic') { const e = new Error('selected element no longer exists'); e.status = 400; throw e; }
    const curText = partPrimaryText(layer, selection.part);
    const baseSize = partBaseFontSize(layer, selection.part, ir);
    const curStyle = layer.part_styles?.[selection.part] || {};
    const system = `You restyle ONE text element ("${selection.part}") inside a "${layer.kind}" graphic. Respond with ONLY:
{"text": <new text or number, optional>, "style": {${STYLE_SPEC.replace('style', '')}, transform:{x_pct:-100..100,y_pct:-100..100,scale:0.1..5,rotate_deg,opacity:0..1}}, "summary":"<one short sentence>"}
Omit any field you are not changing. This element's current font size is ${curStyle.font_size ?? baseSize}px — scale relative to that (e.g. "bigger" ≈ ×1.3). Theme palette: ${JSON.stringify(ir.metadata.theme?.palette || {})}.`;
    const user = `${convo}Instruction: ${instruction}\nCurrent text: ${JSON.stringify(curText ?? '')}\nCurrent style: ${JSON.stringify(curStyle)}`;
    const response = await chatJSON({ system, user });
    const stylePatch = sanitizePartStyle(response?.style);
    const hasText = response?.text !== undefined && response?.text !== null && response?.text !== '';
    if (!stylePatch && !hasText) {
      const e = new Error('the model proposed no valid change — try rephrasing');
      e.status = 422; e.raw = JSON.stringify(response).slice(0, 500);
      throw e;
    }
    const next = structuredClone(ir);
    const L = next.scenes[selection.scene].layers[selection.layer];
    if (stylePatch) L.part_styles = { ...L.part_styles, [selection.part]: { ...L.part_styles?.[selection.part], ...stylePatch } };
    if (hasText) setPartText(L, selection.part, response.text);
    return { ir: retime(next), summary: str(response?.summary, 200) || 'Updated the element.' };
  }

  if (selection) {
    const scene = ir.scenes[selection.scene];
    const layer = scene?.layers[selection.layer];
    if (!layer) { const e = new Error('selected layer no longer exists'); e.status = 400; throw e; }
    const system = `You edit ONE layer of a video. Respond with ONLY this JSON shape:
{"layer": {<the full updated layer object>}, "summary": "<one short sentence>"}
This is a "${layer.type}" layer. Editable ${layerSpec(layer.type)}
Keep "type" unchanged. Copy fields you do not change. Scene duration: ${scene.duration_s}s. Theme palette: ${JSON.stringify(ir.metadata.theme?.palette || {})}.`;
    const user = `${convo}Instruction: ${instruction}\n\nCurrent layer JSON:\n${JSON.stringify(layer, null, 1)}`;
    const response = await chatJSON({ system, user });
    const patch = sanitizeLayerPatch(layer, response?.layer, scene.duration_s);
    if (!Object.keys(patch).length) {
      const e = new Error('the model proposed no valid change — try rephrasing');
      e.status = 422; e.raw = JSON.stringify(response).slice(0, 500);
      throw e;
    }
    const next = structuredClone(ir);
    Object.assign(next.scenes[selection.scene].layers[selection.layer], patch);
    return { ir: retime(next), summary: str(response?.summary, 200) || 'Updated the selected element.' };
  }

  // Global edit: compact view in, ops out, one guided retry on invalid ops.
  const user = `${convo}Instruction: ${instruction}\n\nVideo JSON:\n${JSON.stringify(compactIr(ir), null, 1)}`;
  let response = await chatJSON({ system: OPS_SPEC, user });
  let { next, errors } = applyOps(ir, response?.ops);
  if (errors.length) {
    response = await chatJSON({
      system: OPS_SPEC,
      user: `${user}\n\nYour previous ops had these problems:\n- ${errors.join('\n- ')}\nPrevious ops: ${JSON.stringify(response?.ops).slice(0, 1500)}\nReturn ONLY corrected {"ops":[...],"summary":"..."}.`,
    });
    ({ next, errors } = applyOps(ir, response?.ops));
  }
  if (errors.length || !response?.ops?.length) {
    const e = new Error(errors.length ? `the edit could not be applied: ${errors[0]}` : 'the model returned no ops — try rephrasing');
    e.status = 422; e.raw = JSON.stringify(response).slice(0, 500);
    throw e;
  }
  return { ir: retime(next), summary: str(response?.summary, 200) || 'Applied your change.' };
}
