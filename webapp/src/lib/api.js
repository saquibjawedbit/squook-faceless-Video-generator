// Thin client for the Squook API (server/). The dev server allows anonymous
// access (ALLOW_ANON=true) so no auth token is attached; projects belong to the
// in-memory `anon` user. Override the host with VITE_API_BASE if the API isn't
// on localhost:8787.
const BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8787').replace(/\/$/, '');

async function jfetch(path, opts) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    let msg = res.statusText || ('HTTP ' + res.status);
    let raw;
    try { const j = await res.json(); if (j?.error) msg = j.error; raw = j?.raw; } catch { /* non-JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    if (raw) err.raw = raw; // /edit 422s include the model's raw output
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// Create a project + kick off generation. `files` is an optional array of File
// objects. Returns the project's publicView ({ id, status, stage, progress, … }).
export function createProject({ prompt, format, duration, files }) {
  const fd = new FormData();
  fd.append('prompt', prompt);
  if (format) fd.append('format', format);
  if (duration != null) fd.append('duration', String(duration));
  for (const f of files || []) fd.append('files', f);
  return jfetch('/api/projects', { method: 'POST', body: fd });
}

export const listProjects = () => jfetch('/api/projects');
export const getProject = (id) => jfetch(`/api/projects/${id}`);
export const deleteProject = (id) => jfetch(`/api/projects/${id}`, { method: 'DELETE' });

// A playable URL for a finished project (signed Storage URL, or the local
// streaming route in fallback mode).
export const getPlaybackUrl = (id) => jfetch(`/api/projects/${id}/url`).then((r) => r.url);

// Direct <img>/<video> src helpers — the routes accept the anon user by
// unguessable project id, so no fetch/headers needed.
export const thumbSrc = (id) => `${BASE}/api/projects/${id}/thumb`;
export const apiBase = BASE;

const json = (body, method = 'POST') => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ——— Editor: the per-project IR snapshot (the editable document) ———
export const getIR = (id) => jfetch(`/api/projects/${id}/ir`).then((r) => r.ir);
export const putIR = (id, ir) => jfetch(`/api/projects/${id}/ir`, json({ ir }, 'PUT'));

// AI edit — stateless: instruction + current IR (+ optional {scene, layer}
// selection) → { ir, summary }. Nothing persists until putIR/rerender.
export const aiEdit = (id, payload) => jfetch(`/api/projects/${id}/edit`, json(payload));

// ——— Director agent: conversational editing with a persistent session ———
// One turn: { message, ir, selection? } → { reply, proposal?: {ir, summary,
// diff}, trace }. History lives server-side (artifacts/<id>.chat.jsonl).
export const directorChat = (id, payload) => jfetch(`/api/projects/${id}/chat`, json(payload));
export const getChatLog = (id) => jfetch(`/api/projects/${id}/chat`).then((r) => r.messages);

// Streaming turn (Server-Sent Events). Calls onEvent for each event:
//   {type:'status', label} · {type:'delta', text} · {type:'done', reply,
//   proposal, trace} · {type:'error', error}. Resolves when the stream ends.
export async function directorChatStream(id, payload, onEvent, signal) {
  const res = await fetch(`${BASE}/api/projects/${id}/chat/stream`, { ...json(payload), signal });
  if (!res.ok || !res.body) {
    let msg = res.statusText || ('HTTP ' + res.status);
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* non-JSON */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // SSE frames are separated by a blank line; each `data:` line is one JSON event.
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue; // skip `:` heartbeats
        try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* partial */ }
      }
    }
  }
}
// Editor events the agent should know about next turn (applied/discarded).
export const chatNote = (id, text) => jfetch(`/api/projects/${id}/chat/note`, json({ text })).catch(() => {});

// Re-render the (just-saved) IR into a new draft. Returns 202 + publicView;
// poll getProject for progress.
export const rerenderProject = (id, ir, quality = 'draft') =>
  jfetch(`/api/projects/${id}/render`, json({ ir, quality }));
