import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

// Anthropic Messages API → Cloudflare Workers AI adapter.
//
// The landing-page agent is Claude Code, which only speaks the Anthropic
// Messages API. When CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set we
// run this tiny translator on 127.0.0.1 and point the agent at it, so the
// agent's requests run on a Workers AI model (default Kimi K2.6) instead.
// The agent only ever sees a loopback URL and a throwaway per-process key —
// never the real Cloudflare token.

export const workersAiEnabled = Boolean(config.cfApiToken && config.cfAccountId);

let started = null; // Promise<{ baseUrl, key }>

/** Start the adapter once; resolves the env the agent needs to reach it. */
export function ensureAdapter() {
  if (!workersAiEnabled) return Promise.resolve(null);
  started ||= new Promise((resolvePromise, reject) => {
    const key = randomBytes(24).toString('hex');
    const server = createServer((req, res) => handle(req, res, key).catch((e) => {
      console.error('[workers-ai] request failed:', e.message);
      if (!res.headersSent) sendJson(res, 502, apiError('api_error', String(e.message || e)));
      else res.end();
    }));
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      console.log(`[workers-ai] adapter on 127.0.0.1:${port} → ${config.cfModel}`);
      resolvePromise({ baseUrl: `http://127.0.0.1:${port}`, key });
    });
  });
  return started;
}

// ---------------------------------------------------------------------------

const apiError = (type, message) => ({ type: 'error', error: { type, message } });

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handle(req, res, key) {
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-api-key'] !== key && req.headers.authorization !== `Bearer ${key}`) {
    return sendJson(res, 401, apiError('authentication_error', 'bad key'));
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
    const body = await readBody(req);
    // Rough estimate (~4 chars/token) — Claude Code only uses it for budgeting.
    return sendJson(res, 200, { input_tokens: Math.ceil(JSON.stringify(body).length / 4) });
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const body = await readBody(req);
    const out = await complete(body);
    if (body.stream) return streamMessage(res, out);
    return sendJson(res, 200, out);
  }
  sendJson(res, 404, apiError('not_found_error', `no route ${req.method} ${url.pathname}`));
}

// --- request: Anthropic → OpenAI-style chat ---------------------------------

const textOf = (content) => (typeof content === 'string'
  ? content
  : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

function toChatMessages(body) {
  const out = [];
  const system = textOf(body.system);
  if (system) out.push({ role: 'system', content: system });

  for (const m of body.messages || []) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || '', ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // user turn: tool results become `tool` messages; the rest stays a user message.
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const inner = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content || []);
        const text = inner.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? '[error] ' : '') + (text || '(no output)') });
        // Images inside a tool result (e.g. a screenshot the agent Read) ride
        // along in the next user message so the model can still see them.
        for (const c of inner) if (c.type === 'image') parts.push(imagePart(c));
      } else if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push(imagePart(b));
    }
    if (parts.length) {
      const onlyText = parts.every((p) => p.type === 'text');
      out.push({ role: 'user', content: onlyText ? parts.map((p) => p.text).join('\n') : parts });
    }
  }
  return out;
}

function imagePart(b) {
  const s = b.source || {};
  const url = s.type === 'base64' ? `data:${s.media_type};base64,${s.data}` : s.url;
  return { type: 'image_url', image_url: { url } };
}

function toChatTools(tools) {
  return (tools || [])
    .filter((t) => t.input_schema) // skip Anthropic server tools (web_search etc.)
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema } }));
}

function toToolChoice(tc) {
  if (!tc) return undefined;
  if (tc.type === 'any') return 'required';
  if (tc.type === 'tool') return { type: 'function', function: { name: tc.name } };
  if (tc.type === 'none') return 'none';
  return 'auto';
}

// --- the call -----------------------------------------------------------------

async function complete(body) {
  const tools = toChatTools(body.tools);
  const payload = {
    model: config.cfModel,
    messages: toChatMessages(body),
    max_tokens: Math.min(body.max_tokens || 4096, config.cfMaxTokens),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.stop_sequences?.length ? { stop: body.stop_sequences } : {}),
    ...(tools.length ? { tools, tool_choice: toToolChoice(body.tool_choice) } : {}),
    // Kimi K2.6 reasoning toggle; reasoning text is dropped on the way back.
    chat_template_kwargs: { thinking: config.cfThinking },
  };
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/ai/v1/chat/completions`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.cfApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) return toAnthropic(await r.json(), body.model);
    lastErr = `${r.status} ${(await r.text()).slice(0, 400)}`;
    if (r.status < 500 && r.status !== 429) break; // not retryable
    await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
  }
  throw new Error(`Workers AI: ${lastErr}`);
}

// --- response: OpenAI-style → Anthropic -------------------------------------

function parseArgs(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || '{}'); } catch { /* fall through */ }
  // Common model slip: trailing text after the JSON object.
  const m = /\{[\s\S]*\}/.exec(s || '');
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

const STOP = { tool_calls: 'tool_use', length: 'max_tokens', stop: 'end_turn', content_filter: 'end_turn' };

function toAnthropic(r, model) {
  const choice = r.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content && String(msg.content).trim()) content.push({ type: 'text', text: String(msg.content) });
  for (const tc of msg.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: tc.id || `toolu_${randomBytes(8).toString('hex')}`,
      name: tc.function?.name,
      input: parseArgs(tc.function?.arguments),
    });
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  const hasTools = content.some((c) => c.type === 'tool_use');
  return {
    id: `msg_${randomBytes(12).toString('hex')}`,
    type: 'message',
    role: 'assistant',
    model: model || config.cfModel,
    content,
    stop_reason: hasTools ? 'tool_use' : (STOP[choice.finish_reason] || 'end_turn'),
    stop_sequence: null,
    usage: { input_tokens: r.usage?.prompt_tokens || 0, output_tokens: r.usage?.completion_tokens || 0 },
  };
}

// Replay a finished message as Anthropic SSE (Claude Code streams by default).
function streamMessage(res, m) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...m, content: [], stop_reason: null, usage: { ...m.usage, output_tokens: 0 } } });
  m.content.forEach((block, index) => {
    if (block.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else {
      ev('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    ev('content_block_stop', { index });
  });
  ev('message_delta', { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: m.usage.output_tokens } });
  ev('message_stop', {});
  res.end();
}
