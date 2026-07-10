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

const ollama = createOpenAICompatible({ name: 'ollama', baseURL: `${config.ollamaBaseUrl}/v1` });

// OPS_SPEC's header demands a raw-JSON reply (the legacy /edit contract) — in
// tool mode we only want the ops documentation that follows it.
const OPS_DOCS = OPS_SPEC.slice(OPS_SPEC.indexOf('Available ops'));

const INSTRUCTIONS = `You are the Director — the editing agent for one short video. You converse with the user AND make real edits to the cut. Be concise and concrete; speak like a film editor. Never mention JSON, ops, tools, or layer indexes to the user — say "the captions in scene 2", not "scenes[1].layers[3]".

How to work:
- The "Current video JSON" in the user's latest message is the ONE source of truth for the video's present state. Earlier messages may describe edits that were only PROPOSED, never applied — never re-apply a past proposal. Respond ONLY to the user's newest message, and propose edits solely against the current JSON.
- If the user asks a question, wants an opinion, or is just discussing: answer in plain text. Do NOT call tools or invent an edit.
- If the request is ambiguous, ask ONE short clarifying question in plain text.
- For an actual change: optionally inspect_ir first, then call propose_edit — with ONLY the ops the newest message asks for, nothing carried over from before. READ its result — it reports exactly what changed, or why it was rejected. If rejected or nothing changed, correct your ops and try again, or explain honestly in plain text what can't be done.
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
  return 'Thinking…';
}

// Build the agent + a shared context object the tools write into (proposal it
// lands, trace of what it did). Used by both the streaming and one-shot paths.
function createDirectorAgent(ir) {
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
export async function runDirectorChat({ ir, message, selection, history = [] }) {
  if (config.mockEdits) {
    if (/\?\s*$/.test(message)) {
      return { reply: `(mock director) You asked: “${message.slice(0, 80)}” — with MOCK_EDITS off I answer from the actual cut.` };
    }
    const { next } = applyOps(ir, [{ op: 'set_theme', patch: { palette: { accent: '#3ad29f' } } }]);
    retime(next);
    return { reply: '(mock director) accent → mint', proposal: { ir: next, summary: '(mock) accent → mint', diff: irDiff(ir, next) } };
  }

  const { agent, ctx } = createDirectorAgent(ir);
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
export async function runDirectorChatStream({ ir, message, selection, history = [] }, onEvent) {
  if (config.mockEdits) {
    const r = await runDirectorChat({ ir, message, selection, history });
    onEvent({ type: 'delta', text: r.reply });
    onEvent({ type: 'done', ...r });
    return r;
  }

  const { agent, ctx } = createDirectorAgent(ir);
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
