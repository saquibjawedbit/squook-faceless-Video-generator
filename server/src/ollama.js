// Minimal Ollama chat client for editor AI edits — same local model the
// CrewAI flow uses. Local models return messy JSON, so parsing is tolerant.
import { config } from './config.js';

export async function chatJSON({ system, user }) {
  return chatTurn({ system, messages: [{ role: 'user', content: user }] });
}

// Multi-turn variant for the Director agent loop — full message history in,
// one JSON action out.
export async function chatTurn({ system, messages }) {
  const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      format: 'json',
      options: { temperature: 0, num_ctx: 16384 },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200) || 'request failed'}`);
  }
  const data = await res.json();
  return parseLoose(data?.message?.content || '');
}

// Strip markdown fences → JSON.parse → fall back to the first balanced {...}.
export function parseLoose(text) {
  const t = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* keep going */ }
  const start = t.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < t.length; i++) {
      if (t[i] === '{') depth++;
      else if (t[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  const err = new Error('the model returned unparseable JSON');
  err.raw = String(text);
  throw err;
}
