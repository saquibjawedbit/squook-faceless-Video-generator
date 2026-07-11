// The Director agent — built on the Vercel AI SDK's ToolLoopAgent. The library
// owns the agentic loop, native tool-call threading (real tool messages, not
// text-smuggled observations), zod-validated tool inputs, and retries; we own
// the domain: two tools over the IR, and the sanitizer feedback that makes
// proposals self-correcting.
//   inspect_ir   → read the exact JSON of any part of the current document
//   propose_edit → ops, sandbox-applied; returns the REAL diff or the
//                  rejection reasons, so the model fixes itself instead of
//                  silently no-oping
// Talks to the same local/cloud Ollama model via its OpenAI-compatible API.
import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { config } from './config.js';
import { OPS_SPEC, applyOps, compactIr } from './aiEdit.js';
import { retime } from './ir.js';
import { irDiff } from './irDiff.js';
import { searchStock } from './stock.js';
import { ingestUrl } from './ingest.js';
import { iconSvgUrl } from './icons.js';

const ollama = createOpenAICompatible({ name: 'ollama', baseURL: `${config.ollamaBaseUrl}/v1` });

// OPS_SPEC's header demands a raw-JSON reply (the legacy /edit contract) — in
// tool mode we only want the ops documentation that follows it.
const OPS_DOCS = OPS_SPEC.slice(OPS_SPEC.indexOf('Available ops'));

const INSTRUCTIONS = `You are the Director — the editing agent for one short video. You converse with the user AND make real edits to the cut. Be concise and concrete; speak like a film editor. Never mention JSON, ops, tools, or layer indexes to the user — say "the captions in scene 2", not "scenes[1].layers[3]".

How to work:
- YOUR CAPABILITIES — use them, never claim you lack them. Beyond editing existing layers you can: FETCH stock video/photos (add_stock), FETCH real vector icons (set_icons), ADD or restyle ambient shader BACKGROUNDS (set_shader), and BUILD a custom animation FROM SCRATCH — a molecule forming, an orbit, electrons, a cycle, a mechanism — with compose_animation, by drawing vector shapes with keyframes. If ANY earlier message in this chat claimed you "can't create a hand-drawn / custom animation" or "can only insert a stock clip / graphic / Lottie", that statement is FALSE and obsolete (it predates these tools) — do NOT repeat it, apologise for it and call the right tool instead. When the user asks for a custom animated diagram, your DEFAULT is compose_animation, not stock footage.
- The "Current video JSON" in the user's latest message is the ONE source of truth for the video's present state. Earlier messages may describe edits that were only PROPOSED, never applied — never re-apply a past proposal. Respond ONLY to the user's newest message, and propose edits solely against the current JSON.
- If the user asks a question, wants an opinion, or is just discussing: answer in plain text. Do NOT call tools or invent an edit.
- If the request is ambiguous, ask ONE short clarifying question in plain text.
- For an actual change: optionally inspect_ir first, then call propose_edit — with ONLY the ops the newest message asks for, nothing carried over from before. READ its result — it reports exactly what changed, or why it was rejected. If rejected or nothing changed, correct your ops and try again, or explain honestly in plain text what can't be done.
- NEW FOOTAGE the video doesn't already contain (a rocket launch, a city street, anything no scene uses yet): you CAN get it. You MUST call the add_stock tool — it searches the stock library (Pexels, Pixabay, NASA…) and drops a real clip or photo into the scene. NEVER reply that you can only reuse existing clips, and NEVER ask the user to upload or offer a placeholder — that is wrong, add_stock exists precisely for this. To swap something out (e.g. replace a counter graphic with a launch clip), call add_stock with replace_layer set to that layer's 0-based index. Only mention uploading if the user explicitly wants THEIR OWN file, or if add_stock returns nothing. If an earlier message in THIS chat refused this or asked the user to upload/reuse, that advice is obsolete — ignore it and just call add_stock now.
- ICONS in an icon_row scene: to change or improve them, call set_icons with concept words (e.g. ["rocket","shield","cloud"]) — it fetches real vector icons. Don't use set_layer for icon changes.
- BACKGROUND / ambient shader of a scene (make it calmer, livelier, a different look, or recolor it): call set_shader with a kind (nebula|waves|grid|aurora|mesh|rays) and optional speed/intensity/color_a/color_b. It adds a shader if the scene has none, else restyles the existing one.
- CUSTOM VISUALS no stock clip or preset graphic can give (a molecule forming, an orbit, a data flow, a mechanism, an abstract diagram): you CAN build them yourself with compose_animation — you literally draw the scene as vector shapes with keyframes; don't refuse or fall back to stock when the user wants a specific illustrated concept. Coordinates are 0..100 (% of frame, top-left origin), colors are "accent"/"accent2"/"text"/"bg" or hex, keyframe t is seconds into the scene, and a shape holds a keyframed prop's value before its first / after its last keyframe. Example — two atoms drifting together with a bond appearing: shapes:[{"kind":"circle","r":7,"fill":"accent","x":32,"y":50,"keyframes":[{"t":0,"x":32},{"t":1.6,"x":46}]},{"kind":"circle","r":7,"fill":"accent2","x":68,"y":50,"keyframes":[{"t":0,"x":68},{"t":1.6,"x":54}]},{"kind":"line","x":46,"y":50,"x2":54,"y2":50,"stroke":"text","stroke_width":3,"opacity":0,"keyframes":[{"t":1.4,"opacity":0},{"t":1.8,"opacity":1}]},{"kind":"text","text":"H₂O","x":50,"y":72,"size":56,"fill":"text","opacity":0,"keyframes":[{"t":1.8,"opacity":0},{"t":2.2,"opacity":1}]}].
- [editor event] lines in the conversation are ground truth about what the user applied, discarded, or changed by hand.

Ops reference for propose_edit:
${OPS_DOCS}`;

// Resolve "scenes[2].layers[0]" against the IR — read-only, tokens only.
function resolvePath(ir, path) {
  let cur = ir;
  const tokens = String(path).match(/[a-zA-Z_]\w*|\[\d+\]/g) || [];
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = t.startsWith('[') ? cur[Number(t.slice(1, -1))] : cur[t];
  }
  return cur;
}

// A friendly label for what the agent is doing right now, from a tool call —
// shown live in the chat while the agent thinks ("Reading scene 3…").
function prettyPath(path) {
  const m = /scenes\[(\d+)\](?:\.layers(?:\[(\d+)\])?)?/.exec(String(path || ''));
  if (m) {
    const scene = `scene ${Number(m[1]) + 1}`;
    if (m[2] != null) return `a layer in ${scene}`;
    if (/\.layers/.test(path)) return `${scene}'s layers`;
    return scene;
  }
  if (/theme/.test(path)) return 'the theme';
  if (/music/.test(path)) return 'the audio';
  return 'the video';
}
export function stepLabel(toolName, input) {
  if (toolName === 'inspect_ir') return `Reading ${prettyPath(input?.path)}…`;
  if (toolName === 'propose_edit') return 'Working out the edit…';
  if (toolName === 'add_stock') return `Finding ${input?.query ? `“${input.query}”` : 'stock'} footage…`;
  if (toolName === 'set_icons') return 'Fetching icons…';
  if (toolName === 'compose_animation') return 'Animating…';
  if (toolName === 'set_shader') return 'Restyling the background…';
  return 'Thinking…';
}

// Build the agent + a shared context object the tools write into (proposal it
// lands, trace of what it did). Used by both the streaming and one-shot paths.
// ── compose_animation: sanitize the model-authored vector-animation spec ──
const MOTION_KINDS = new Set(['circle', 'ring', 'dot', 'rect', 'line', 'text']);
const finN = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clampU = (v, lo, hi) => (v === undefined ? undefined : Math.min(hi, Math.max(lo, v)));
const motionColor = (v) => {
  if (typeof v !== 'string') return undefined;
  if (['accent', 'accent2', 'text', 'bg'].includes(v)) return v;
  return v.length <= 30 && !/[<>;{}]/.test(v) ? v : undefined; // hex / css name
};

// Clamp every number, cap counts, whitelist kinds/colors — a malformed spec
// yields fewer shapes or null, never anything that can crash the renderer.
function sanitizeMotion(rawShapes, rawBg) {
  const shapes = [];
  for (const s of (Array.isArray(rawShapes) ? rawShapes : []).slice(0, 48)) {
    if (!s || typeof s !== 'object' || !MOTION_KINDS.has(s.kind)) continue;
    const out = { kind: s.kind };
    const put = (k, v, lo, hi) => { const n = clampU(finN(v), lo, hi); if (n !== undefined) out[k] = n; };
    put('x', s.x, -20, 120); put('y', s.y, -20, 120);
    put('x2', s.x2, -20, 120); put('y2', s.y2, -20, 120);
    put('r', s.r, 0, 60); put('w', s.w, 0, 120); put('h', s.h, 0, 120);
    put('size', s.size, 6, 400); put('stroke_width', s.stroke_width, 0, 40);
    put('opacity', s.opacity, 0, 1);
    if (typeof s.text === 'string') out.text = s.text.slice(0, 48);
    const f = motionColor(s.fill); if (f) out.fill = f;
    const st = motionColor(s.stroke); if (st) out.stroke = st;
    if (Array.isArray(s.keyframes)) {
      const kfs = [];
      for (const k of s.keyframes.slice(0, 24)) {
        if (!k || typeof k !== 'object' || finN(k.t) === undefined) continue;
        const kf = { t: Math.max(0, k.t) };
        const putk = (key, v, lo, hi) => { const n = clampU(finN(v), lo, hi); if (n !== undefined) kf[key] = n; };
        putk('x', k.x, -20, 120); putk('y', k.y, -20, 120); putk('r', k.r, 0, 60);
        putk('scale', k.scale, 0, 8); putk('rotate', k.rotate, -360, 360); putk('opacity', k.opacity, 0, 1);
        kfs.push(kf);
      }
      if (kfs.length) out.keyframes = kfs.sort((a, b) => a.t - b.t);
    }
    shapes.push(out);
  }
  const bg = motionColor(rawBg);
  return shapes.length ? { type: 'motion', shapes, ...(bg ? { bg } : {}) } : null;
}

function createDirectorAgent(ir, projectId) {
  const ctx = { proposal: null, trace: [] };
  const agent = new ToolLoopAgent({
    id: 'squook-director',
    model: ollama(config.ollamaModel),
    temperature: 0,
    instructions: INSTRUCTIONS,
    // Stop as soon as a proposal lands (its summary is the reply) or after 6 steps.
    stopWhen: [stepCountIs(6), () => ctx.proposal != null],
    tools: {
      inspect_ir: tool({
        description: 'Read the full JSON at a path in the current video document (e.g. "scenes[2]", "scenes[0].layers", "metadata.theme"). Use before editing when the compact view is not enough.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          ctx.trace.push({ action: 'inspect', path });
          const val = resolvePath(ir, path);
          return val === undefined ? `Nothing exists at "${path}".` : JSON.stringify(val).slice(0, 4000);
        },
      }),
      propose_edit: tool({
        description: 'Propose an edit as a list of ops (see the ops reference). The system applies them to a copy and returns exactly what changed — or why they were rejected. A successful proposal is shown to the user for approval.',
        inputSchema: z.object({
          summary: z.string().describe('One plain-language sentence describing the edit, shown to the user'),
          ops: z.array(z.looseObject({ op: z.string() })).min(1),
        }),
        execute: async ({ summary, ops }) => {
          const { next, errors } = applyOps(ir, ops);
          if (errors?.length || !next) {
            ctx.trace.push({ action: 'propose', errors });
            return 'REJECTED:\n- ' + (errors || ['ops must be a non-empty array']).join('\n- ') + '\nCorrect the ops and call propose_edit again, or answer in plain text if this cannot be done.';
          }
          retime(next);
          const diff = irDiff(ir, next);
          if (!diff.length) {
            ctx.trace.push({ action: 'propose', empty: true });
            return 'NO-OP: the ops were accepted but changed NOTHING — every field was dropped by validation (wrong field name, wrong type, or not editable for that layer type). Re-check the ops reference and correct, or answer in plain text explaining what cannot be changed.';
          }
          ctx.trace.push({ action: 'propose', changes: diff.length });
          ctx.proposal = { ir: next, summary: String(summary || 'Here’s the edit.').slice(0, 240), diff };
          return 'SUCCESS — pending user approval. Exact changes:\n' + diff.join('\n');
        },
      }),
      add_stock: tool({
        description: 'Fetch NEW stock media the video does not already contain (video from Pexels/Pixabay/NASA; photos also from Wikimedia/logo.dev) and place it in a scene — optionally replacing an existing layer (e.g. a counter graphic). Use this instead of refusing or asking the user to upload, unless they want their OWN footage.',
        inputSchema: z.object({
          scene: z.number().int().describe('1-based scene number to place the media in'),
          query: z.string().min(2).describe('2–5 word concrete, filmable stock search, e.g. "rocket launch"'),
          media_type: z.enum(['video', 'photo']).default('video').describe('video for motion/clips, photo for a still image'),
          replace_layer: z.number().int().optional().describe('0-based index of a layer in that scene to remove first (e.g. the counter graphic being swapped out)'),
          summary: z.string().describe('One plain-language sentence describing the change, shown to the user'),
        }),
        execute: async ({ scene, query, media_type, replace_layer, summary }) => {
          if (!projectId) return 'Stock fetch is unavailable for this project.';
          const idx = Number(scene) - 1;
          if (!Number.isInteger(idx) || idx < 0 || idx >= ir.scenes.length) {
            return `Scene ${scene} does not exist (1–${ir.scenes.length}).`;
          }
          const mt = media_type === 'photo' ? 'photo' : 'video';
          let results;
          try {
            results = await searchStock(query, { provider: 'all', mediaType: mt });
          } catch (e) {
            return `Stock search failed: ${e.message}. Try again, or ask the user to upload the media.`;
          }
          // Prefer commercial, no-attribution media — the editor can't render a
          // credit, so skip Wikimedia CC-BY hits (they require one).
          const hit = (results || []).find((r) => r.download && !r.attributionRequired);
          if (!hit) return `No attribution-free stock ${mt === 'photo' ? 'photos' : 'clips'} found for "${query}". Try more concrete, filmable words, or ask the user to upload it.`;
          let src;
          try {
            ({ src } = await ingestUrl(projectId, hit.download));
          } catch (e) {
            return `Couldn't download the media: ${e.message}. Try again, or ask the user to upload it.`;
          }
          const next = structuredClone(ir);
          const sc = next.scenes[idx];
          // loop the clip so a short stock video fills the whole scene instead
          // of ending and freezing/blanking partway through.
          const layer = mt === 'photo' ? { type: 'image', src, fit: 'cover' } : { type: 'video', src, fit: 'cover', loop: true };
          if (Number.isInteger(replace_layer) && replace_layer >= 0 && replace_layer < sc.layers.length) {
            sc.layers.splice(replace_layer, 1); // drop the graphic being swapped out
          }
          // Insert the footage ABOVE the scene's background layers (shader/solid)
          // but below graphics/text/captions — so it's actually visible and never
          // buried under a shader/solid that renders on top. Layers render
          // bottom-to-top, so skip leading backgrounds and slot in just after them.
          let at = 0;
          while (at < sc.layers.length && (sc.layers[at].type === 'shader' || sc.layers[at].type === 'solid')) at++;
          sc.layers.splice(at, 0, layer);
          retime(next);
          const diff = irDiff(ir, next);
          ctx.trace.push({ action: 'add_stock', query, mediaType: mt, provider: hit.provider, changes: diff.length });
          ctx.proposal = { ir: next, summary: String(summary || `Added ${query} ${mt} to scene ${scene}.`).slice(0, 240), diff };
          return `SUCCESS — fetched a ${hit.provider} ${mt} for "${query}" and placed it in scene ${scene} (pending user approval). Changes:\n${diff.join('\n')}`;
        },
      }),
      set_icons: tool({
        description: 'Change the icons in an icon_row graphic — fetches real vector icons (Iconify) for the given concepts and recolours them to the theme. Use when the user wants different/better icons in a scene.',
        inputSchema: z.object({
          scene: z.number().int().describe('1-based scene number containing the icon_row'),
          icons: z.array(z.string().min(1)).min(1).max(6).describe('2–6 concept words, one per icon, e.g. ["rocket","shield","cloud"]'),
          labels: z.array(z.string()).optional().describe('optional new caption under each icon, same order/length'),
          summary: z.string().describe('One plain-language sentence describing the change, shown to the user'),
        }),
        execute: async ({ scene, icons, labels, summary }) => {
          if (!projectId) return 'Icon fetch is unavailable for this project.';
          const sc = ir.scenes[Number(scene) - 1];
          if (!sc) return `Scene ${scene} does not exist (1–${ir.scenes.length}).`;
          const li = sc.layers.findIndex((l) => l.type === 'graphic' && l.kind === 'icon_row');
          if (li < 0) return `Scene ${scene} has no icon_row graphic. Use add_stock for footage, or set_layer for other graphics.`;
          const accent = ir.metadata?.theme?.palette?.accent || '#ffffff';
          const srcs = [];
          for (const concept of icons) {
            let src = null;
            try {
              const url = await iconSvgUrl(concept, accent);
              if (url) ({ src } = await ingestUrl(projectId, url));
            } catch { /* leave null → renderer falls back to an emoji */ }
            srcs.push(src);
          }
          if (!srcs.some(Boolean)) return `Couldn't fetch icons for [${icons.join(', ')}]. Try more common concept words.`;
          const next = structuredClone(ir);
          const params = { ...(next.scenes[Number(scene) - 1].layers[li].params || {}) };
          params.icons = icons.slice(0, 6);
          params.icon_srcs = srcs;
          if (Array.isArray(labels) && labels.length) params.labels = labels.map((s) => String(s).slice(0, 60)).slice(0, 6);
          next.scenes[Number(scene) - 1].layers[li].params = params;
          retime(next);
          const diff = irDiff(ir, next);
          ctx.trace.push({ action: 'set_icons', icons, fetched: srcs.filter(Boolean).length });
          ctx.proposal = { ir: next, summary: String(summary || `Updated the icons in scene ${scene}.`).slice(0, 240), diff };
          return `SUCCESS — fetched ${srcs.filter(Boolean).length}/${icons.length} icons for scene ${scene} (pending user approval). Changes:\n${diff.join('\n')}`;
        },
      }),
      compose_animation: tool({
        description: 'Build a CUSTOM animated diagram from scratch as vector shapes — no stock clip needed. Draw with circles/rings/dots/rects/lines/text, each with optional keyframes (position/size/opacity/scale/rotate over time). Use for bespoke illustrated concepts: a molecule forming, an orbit, a cycle, a mechanism, a flow. Coordinates are 0..100 (% of frame, top-left origin); colors are "accent"|"accent2"|"text"|"bg" or hex; keyframe t is seconds into the scene.',
        inputSchema: z.object({
          scene: z.number().int().describe('1-based scene number to place the animation in'),
          shapes: z.array(z.looseObject({ kind: z.string() })).min(1).max(48).describe('the vector primitives + their keyframes'),
          bg: z.string().optional().describe('optional background color (token or hex)'),
          replace_layer: z.number().int().optional().describe('0-based index of a layer in that scene to remove first (e.g. a graphic being swapped out)'),
          summary: z.string().describe('One plain-language sentence describing the animation, shown to the user'),
        }),
        execute: async ({ scene, shapes, bg, replace_layer, summary }) => {
          const idx = Number(scene) - 1;
          if (!Number.isInteger(idx) || idx < 0 || idx >= ir.scenes.length) {
            return `Scene ${scene} does not exist (1–${ir.scenes.length}).`;
          }
          const motion = sanitizeMotion(shapes, bg);
          if (!motion) return 'No valid shapes. Each shape needs a kind (circle|ring|dot|rect|line|text) and coords in 0..100.';
          const next = structuredClone(ir);
          const sc = next.scenes[idx];
          if (Number.isInteger(replace_layer) && replace_layer >= 0 && replace_layer < sc.layers.length) {
            sc.layers.splice(replace_layer, 1);
          }
          // Sit above shader/solid backgrounds (visible), below text/captions.
          let at = 0;
          while (at < sc.layers.length && (sc.layers[at].type === 'shader' || sc.layers[at].type === 'solid')) at++;
          sc.layers.splice(at, 0, motion);
          retime(next);
          const diff = irDiff(ir, next);
          ctx.trace.push({ action: 'compose_animation', shapes: motion.shapes.length });
          ctx.proposal = { ir: next, summary: String(summary || `Composed a custom animation in scene ${scene}.`).slice(0, 240), diff };
          return `SUCCESS — composed a ${motion.shapes.length}-shape animation in scene ${scene} (pending user approval). Changes:\n${diff.join('\n')}`;
        },
      }),
      set_shader: tool({
        description: 'Add or restyle a scene’s ambient shader BACKGROUND. Kinds: nebula (soft clouds), waves (flowing lines), grid (dot matrix), aurora (light curtains), mesh (gradient bokeh), rays (light beams). Tunable: speed, intensity, and hex color overrides. If the scene has a shader it is updated; otherwise one is added behind everything.',
        inputSchema: z.object({
          scene: z.number().int().describe('1-based scene number'),
          kind: z.enum(['nebula', 'waves', 'grid', 'aurora', 'mesh', 'rays']),
          speed: z.number().optional().describe('time multiplier 0.2–3 (default 1); lower = calmer'),
          intensity: z.number().optional().describe('effect strength 0–3 (default 1)'),
          color_a: z.string().optional().describe('hex override for the primary accent, e.g. "#6ee7f9"'),
          color_b: z.string().optional().describe('hex override for the secondary accent'),
          summary: z.string().describe('One plain-language sentence describing the change, shown to the user'),
        }),
        execute: async ({ scene, kind, speed, intensity, color_a, color_b, summary }) => {
          const idx = Number(scene) - 1;
          if (!Number.isInteger(idx) || idx < 0 || idx >= ir.scenes.length) {
            return `Scene ${scene} does not exist (1–${ir.scenes.length}).`;
          }
          const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : undefined);
          const layer = { type: 'shader', kind };
          const spd = clampU(finN(speed), 0.2, 3); if (spd !== undefined) layer.speed = spd;
          const inten = clampU(finN(intensity), 0, 3); if (inten !== undefined) layer.intensity = inten;
          const ca = hex(color_a); if (ca) layer.color_a = ca;
          const cb = hex(color_b); if (cb) layer.color_b = cb;
          const next = structuredClone(ir);
          const sc = next.scenes[idx];
          const existing = sc.layers.findIndex((l) => l.type === 'shader');
          if (existing >= 0) sc.layers.splice(existing, 1, layer);
          else sc.layers.unshift(layer); // shader is the backdrop → very back
          retime(next);
          const diff = irDiff(ir, next);
          ctx.trace.push({ action: 'set_shader', kind });
          ctx.proposal = { ir: next, summary: String(summary || `Set scene ${scene}'s background to ${kind}.`).slice(0, 240), diff };
          return `SUCCESS — ${existing >= 0 ? 'restyled' : 'added'} a ${kind} shader background in scene ${scene} (pending user approval). Changes:\n${diff.join('\n')}`;
        },
      }),
    },
  });
  return { agent, ctx };
}

function buildIrMessages(ir, { message, selection, history }) {
  const messages = history.slice(-16).map((m) => (
    m.role === 'system'
      ? { role: 'user', content: `[editor event] ${m.text}` }
      : { role: m.role, content: String(m.text || '').slice(0, 600) }
  ));
  messages.push({
    role: 'user',
    content: `${selection ? `[User's current selection in the editor: ${selection} — pronouns like "it" refer to this unless the request names something else.]\n` : ''}${message}\n\nCurrent video JSON (compact):\n${JSON.stringify(compactIr(ir), null, 1)}`,
  });
  return messages;
}

const FALLBACK = 'I couldn’t work out a valid edit for that — could you rephrase, or point me at the exact scene?';

// history: chat-log entries ({role, text}); 'system' entries are editor events.
export async function runDirectorChat({ ir, message, selection, history = [], projectId }) {
  if (config.mockEdits) {
    if (/\?\s*$/.test(message)) {
      return { reply: `(mock director) You asked: “${message.slice(0, 80)}” — with MOCK_EDITS off I answer from the actual cut.` };
    }
    const { next } = applyOps(ir, [{ op: 'set_theme', patch: { palette: { accent: '#3ad29f' } } }]);
    retime(next);
    return { reply: '(mock director) accent → mint', proposal: { ir: next, summary: '(mock) accent → mint', diff: irDiff(ir, next) } };
  }

  const { agent, ctx } = createDirectorAgent(ir, projectId);
  const messages = buildIrMessages(ir, { message, selection, history });
  const result = await agent.generate({ messages });
  const text = (result.text || '').trim();
  if (text) ctx.trace.push({ action: 'reply' });
  return {
    reply: (text || ctx.proposal?.summary || FALLBACK).slice(0, 1200),
    proposal: ctx.proposal || undefined,
    trace: ctx.trace,
  };
}

// Streaming variant — drives the live "thinking" UI. onEvent receives:
//   {type:'status', label}  — current activity (thinking / reading X / editing)
//   {type:'delta',  text}   — a chunk of the reply as it's written
//   {type:'done', reply, proposal, trace}
export async function runDirectorChatStream({ ir, message, selection, history = [], projectId }, onEvent) {
  if (config.mockEdits) {
    const r = await runDirectorChat({ ir, message, selection, history });
    onEvent({ type: 'delta', text: r.reply });
    onEvent({ type: 'done', ...r });
    return r;
  }

  const { agent, ctx } = createDirectorAgent(ir, projectId);
  const messages = buildIrMessages(ir, { message, selection, history });

  onEvent({ type: 'status', label: 'Thinking…' });
  let text = '';
  let sawText = false;
  const res = await agent.stream({ messages });
  for await (const part of res.fullStream) {
    if (part.type === 'tool-call') {
      onEvent({ type: 'status', label: stepLabel(part.toolName, part.input) });
    } else if (part.type === 'text-delta' && part.text) {
      if (!sawText) { sawText = true; onEvent({ type: 'status', label: 'Writing…' }); }
      text += part.text;
      onEvent({ type: 'delta', text: part.text });
    }
  }

  text = text.trim();
  if (text) ctx.trace.push({ action: 'reply' });
  const reply = (text || ctx.proposal?.summary || FALLBACK).slice(0, 1200);
  // If the reply came only from the proposal summary (no streamed text), send it now.
  if (!text) onEvent({ type: 'delta', text: reply });
  const out = { reply, proposal: ctx.proposal || undefined, trace: ctx.trace };
  onEvent({ type: 'done', ...out });
  return out;
}
