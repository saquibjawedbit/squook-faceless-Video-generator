import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { config, authEnabled, persistenceEnabled, UPLOADS_DIR } from './config.js';
import { requireAuth } from './auth.js';
import { ensureBucket } from './supabaseAdmin.js';
import { enqueueProject, enqueueRerender } from './jobs.js';
import { getProject, listProjects, deleteProject, playbackUrl, thumbUrl, publicView, reconcileInterrupted, rehydrateFromArtifacts } from './store.js';
import { runDirectorChat, runDirectorChatStream } from './directorAgent.js';
import { appendChat, readChat, clearChat } from './chatStore.js';
import { STAGES, previewScript } from './pipeline.js';
import { readIr, writeIr, hasSnapshot, assetSnapshotDir } from './snapshot.js';
import { validateIr } from './ir.js';
import { runAiEdit } from './aiEdit.js';
import { searchStock } from './stock.js';
import { ingestUrl, ingestUpload } from './ingest.js';
import { listPresets, createPreset, deletePreset, bundleFor } from './presets.js';

// A transient network failure (e.g. a Supabase auth check timing out) must
// degrade that one request, never kill the server — observed taking the whole
// API down mid-session. Log and keep serving.
process.on('unhandledRejection', (err) => console.error('[unhandled rejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaught exception]', err));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 200 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, /^(video|image)\//.test(file.mimetype)),
});

const app = express();
// Allow configured origins plus any localhost / 127.0.0.1 origin (any port).
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    cb(null, false);
  },
}));
app.use(express.json({ limit: '10mb' })); // edited IRs with word-level captions get big

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pipelineMode: config.pipelineMode, authEnabled, persistenceEnabled, stages: STAGES });
});

// Load a project and confirm the caller owns it.
async function ownedProject(req, res) {
  const p = await getProject(req.params.id);
  if (!p || p.userId !== req.user.id) { res.status(404).json({ error: 'not found' }); return null; }
  return p;
}

// Stream a local file with HTTP Range support (video/audio seeking).
async function streamFile(req, res, filePath, mime) {
  let size;
  try { ({ size } = await stat(filePath)); } catch { return res.status(404).end(); }
  res.setHeader('Content-Type', mime);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    // Clamp the last-byte-pos to EOF (per RFC 7233) — a client may request an
    // open-ended-ish large end; only an out-of-range START is a 416.
    const end = Math.min(m && m[2] ? parseInt(m[2], 10) : size - 1, size - 1);
    if (start >= size || start > end) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.set({ 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    createReadStream(filePath).pipe(res);
  }
}

const ASSET_MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.json': 'application/json',
};

// Create a project + kick off generation (optionally with uploaded footage).
// Delete any footage multer already wrote to disk for a request we're rejecting.
async function discardUploads(req) {
  for (const f of req.files || []) { try { await unlink(f.path); } catch { /* ignore */ } }
}

app.post('/api/projects', requireAuth, upload.array('files', 6), async (req, res) => {
  // Saving requires a real signed-in user (isolation needs a real auth.uid()).
  if (persistenceEnabled && req.user.id === 'anon') {
    await discardUploads(req);
    return res.status(401).json({ error: 'Sign in to save video projects' });
  }
  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) { await discardUploads(req); return res.status(400).json({ error: 'prompt is required' }); }
  if (prompt.length > 2000) { await discardUploads(req); return res.status(400).json({ error: 'prompt too long' }); }

  const uploads = (req.files || []).map((f) => ({
    path: f.path, name: f.originalname, size: f.size, type: f.mimetype,
  }));
  // Content preset (genre): built-in id resolves in the flow; a custom id needs
  // its stored bundle passed along so the flow uses it verbatim.
  const genre = (req.body?.genre || 'auto').trim();
  const presetBundle = await bundleFor(req.user.id, genre);
  // Optional reviewed/edited script (JSON strings in the multipart body).
  let editedScript, assetPlan;
  try { editedScript = req.body?.editedScript ? JSON.parse(req.body.editedScript) : undefined; } catch { /* ignore */ }
  try { assetPlan = req.body?.assetPlan ? JSON.parse(req.body.assetPlan) : undefined; } catch { /* ignore */ }
  const p = await enqueueProject({
    userId: req.user.id, prompt, format: req.body?.format, genre, presetBundle, uploads,
    music: req.body?.music, voice: req.body?.voice, duration: req.body?.duration,
    editedScript, assetPlan,
  });
  res.status(201).json(publicView(p));
});

// Generate JUST the script (directing) for the review-before-render step — no
// project, no render. Returns { script, asset_plan } the client shows and edits.
app.post('/api/script/preview', requireAuth, async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  if (prompt.length > 2000) return res.status(400).json({ error: 'prompt too long' });
  const genre = (req.body?.genre || 'auto').trim();
  const presetBundle = await bundleFor(req.user.id, genre);
  try {
    const out = await previewScript({
      prompt, format: req.body?.format, genre, presetBundle,
      uploads: Array.isArray(req.body?.uploadNames) ? req.body.uploadNames.map((n) => ({ name: String(n) })) : [],
      music: req.body?.music, voice: req.body?.voice, duration: req.body?.duration,
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- Content presets (genre) ----------------------------------------------

// List built-in + the caller's custom presets for the composer picker.
app.get('/api/presets', requireAuth, async (req, res) => {
  res.json(await listPresets(req.user.id));
});

// Create a custom preset — from an explicit bundle (composer form) or from an
// existing project's rendered look (`fromProjectId`, the editor's save action).
app.post('/api/presets', requireAuth, async (req, res) => {
  if (persistenceEnabled && req.user.id === 'anon') {
    return res.status(401).json({ error: 'Sign in to save presets' });
  }
  const { label, bundle, fromProjectId } = req.body || {};
  if (!label && !fromProjectId) return res.status(400).json({ error: 'label or fromProjectId required' });
  try {
    const resolveProject = async (id) => {
      const proj = await getProject(id);
      return proj && proj.userId === req.user.id ? proj : null;
    };
    const created = await createPreset(req.user.id, { label, bundle, fromProjectId }, resolveProject);
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.delete('/api/presets/:id', requireAuth, async (req, res) => {
  await deletePreset(req.user.id, req.params.id);
  res.json({ ok: true });
});

// List the caller's past projects (history).
app.get('/api/projects', requireAuth, async (req, res) => {
  const list = await listProjects(req.user.id);
  res.json(list.map(publicView));
});

// Poll a project's status.
app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (p) res.json(publicView(p));
});

// A playable URL for the video: short-lived signed Storage URL, or the local
// streaming route in fallback mode.
app.get('/api/projects/:id/url', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  if (p.status !== 'done') return res.status(409).json({ error: 'video not ready' });
  const signed = await playbackUrl(p);
  res.json({ url: signed || `${req.protocol}://${req.get('host')}/api/projects/${p.id}/file` });
});

// Thumbnail: redirect to signed Storage URL, or stream the local poster.
app.get('/api/projects/:id/thumb', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const signed = await thumbUrl(p);
  if (signed) return res.redirect(signed);
  try {
    const path = p.videoPath ? p.videoPath.replace(/\.mp4$/, '.jpg') : null;
    if (path) { await stat(path); return createReadStream(path).pipe(res.type('image/jpeg')); }
  } catch { /* fall through */ }
  res.status(404).end();
});

// ————— Editor: per-project IR (editable source) —————

app.get('/api/projects/:id/ir', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  try { res.json({ ir: await readIr(p.id) }); }
  catch { res.status(404).json({ error: 'no editable source for this project' }); }
});

app.put('/api/projects/:id/ir', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  if (!(await hasSnapshot(p.id))) return res.status(404).json({ error: 'no editable source for this project' });
  try {
    const ir = await writeIr(p.id, req.body?.ir);
    res.json({ ok: true, ir });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

// Snapshot media for the live preview. No auth — served by unguessable project
// UUID (same rationale as /file) because <video>/<img> can't send headers.
app.get('/api/projects/:id/assets/*', async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).end();
  const dir = assetSnapshotDir(p.id);
  const filePath = resolve(dir, req.params[0] || '');
  if (!filePath.startsWith(dir + '/')) return res.status(404).end(); // traversal guard
  await streamFile(req, res, filePath, ASSET_MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
});

// ————— Replace footage: stock search + asset ingest —————

// Unified stock-footage search (Pexels + Pixabay). `provider` = all|pexels|pixabay.
app.get('/api/projects/:id/stock', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  try {
    const results = await searchStock(q, { provider: String(req.query.provider || 'all') });
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Ingest a replacement clip from a direct/stock URL → returns the new IR `src`.
// The client then sets the target layer's src and PUTs the IR.
app.post('/api/projects/:id/assets/fetch', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  if (!(await hasSnapshot(p.id))) return res.status(404).json({ error: 'no editable source for this project' });
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const out = await ingestUrl(p.id, url);
    res.json(out);
  } catch (e) {
    res.status(e.status || 502).json({ error: String(e.message || e) });
  }
});

// Ingest a replacement clip from an uploaded file → returns the new IR `src`.
app.post('/api/projects/:id/assets/upload', requireAuth, upload.single('file'), async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) { if (req.file) await unlink(req.file.path).catch(() => {}); return; }
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  if (!(await hasSnapshot(p.id))) {
    await unlink(req.file.path).catch(() => {});
    return res.status(404).json({ error: 'no editable source for this project' });
  }
  try {
    const out = await ingestUpload(p.id, req.file);
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// Re-render from the (optionally just-saved) edited IR — render + master only,
// no AI flow. Produces a new draft of the same project.
app.post('/api/projects/:id/render', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  if (!(await hasSnapshot(p.id))) return res.status(404).json({ error: 'no editable source for this project' });
  if (p.status === 'running' || p.status === 'queued') return res.status(409).json({ error: 'already rendering' });
  if (req.body?.ir) {
    try { await writeIr(p.id, req.body.ir); }
    catch (e) { return res.status(e.status || 400).json({ error: String(e.message || e) }); }
  }
  const quality = req.body?.quality === 'hd' ? 'hd' : 'draft';
  const job = await enqueueRerender(p.id, quality);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.status(202).json(publicView(job));
});

// AI edit: instruction + the client's current IR (+ optional element
// selection) → new IR. Stateless — nothing persists until Save/Re-render.
app.post('/api/projects/:id/edit', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const { instruction, ir, selection, history } = req.body || {};
  if (!instruction || !String(instruction).trim()) return res.status(400).json({ error: 'instruction is required' });
  try { validateIr(ir); } catch (e) { return res.status(400).json({ error: `bad ir: ${e.message}` }); }
  try {
    const result = await runAiEdit({ ir, instruction: String(instruction).trim(), selection, history });
    res.json(result); // { ir, summary }
  } catch (e) {
    res.status(e.status || 422).json({ error: String(e.message || e), raw: e.raw });
  }
});

// ————— Director agent: conversational editing with persistent context —————

// Full chat history for a project (client renders it on editor load).
app.get('/api/projects/:id/chat', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  res.json({ messages: await readChat(p.id) });
});

// Start a fresh Director conversation — wipes the persisted history so the next
// turn carries no prior context (used by the editor's "New chat" button).
app.delete('/api/projects/:id/chat', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  await clearChat(p.id);
  res.json({ ok: true });
});

// One conversational turn. The agent loop can reply (talk/ask), inspect the IR,
// or propose ops — proposals are sandbox-applied and self-corrected against the
// real diff before the user ever sees them. Nothing persists until the client
// applies the returned IR (PUT /ir), same contract as /edit.
app.post('/api/projects/:id/chat', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const { message, ir, selection } = req.body || {};
  const msg = String(message || '').trim();
  if (!msg) return res.status(400).json({ error: 'message is required' });
  let doc = ir;
  if (doc) {
    try { validateIr(doc); } catch (e) { return res.status(400).json({ error: `bad ir: ${e.message}` }); }
  } else {
    try { doc = await readIr(p.id); } catch { return res.status(404).json({ error: 'no editable source for this project' }); }
  }
  try {
    const history = await readChat(p.id);
    const result = await runDirectorChat({
      ir: doc, message: msg,
      selection: typeof selection === 'string' ? selection.slice(0, 200) : undefined,
      history, projectId: p.id,
    });
    await appendChat(p.id, { role: 'user', text: msg });
    await appendChat(p.id, {
      role: 'assistant', text: result.reply,
      // Persist the proposed IR too, so the proposal stays appliable after a
      // reload (the client rehydrates pendingIr from it).
      ...(result.proposal ? { proposal: { summary: result.proposal.summary, diff: result.proposal.diff, ir: result.proposal.ir } } : {}),
    });
    res.json({ reply: result.reply, proposal: result.proposal || null, trace: result.trace });
  } catch (e) {
    res.status(e.status || 502).json({ error: String(e.message || e), raw: e.raw });
  }
});

// Streaming turn (Server-Sent Events): drives the live "thinking" UI. Emits
// `status` (what the agent is doing), `delta` (reply text as it's written),
// and a final `done` with the proposal. Same edit contract as /chat.
app.post('/api/projects/:id/chat/stream', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const { message, ir, selection } = req.body || {};
  const msg = String(message || '').trim();
  if (!msg) return res.status(400).json({ error: 'message is required' });
  let doc = ir;
  if (doc) {
    try { validateIr(doc); } catch (e) { return res.status(400).json({ error: `bad ir: ${e.message}` }); }
  } else {
    try { doc = await readIr(p.id); } catch { return res.status(404).json({ error: 'no editable source for this project' }); }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  try {
    const history = await readChat(p.id);
    const result = await runDirectorChatStream(
      { ir: doc, message: msg, selection: typeof selection === 'string' ? selection.slice(0, 200) : undefined, history, projectId: p.id },
      (ev) => send(ev),
    );
    await appendChat(p.id, { role: 'user', text: msg });
    await appendChat(p.id, {
      role: 'assistant', text: result.reply,
      ...(result.proposal ? { proposal: { summary: result.proposal.summary, diff: result.proposal.diff, ir: result.proposal.ir } } : {}),
    });
  } catch (e) {
    send({ type: 'error', error: String(e.message || e), raw: e.raw });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// Editor events the agent should know about next turn (applied/discarded/etc).
app.post('/api/projects/:id/chat/note', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const text = String(req.body?.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'text is required' });
  await appendChat(p.id, { role: 'system', text });
  res.json({ ok: true });
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  await deleteProject(p.id);
  res.json({ ok: true });
});

// Local fallback streaming (only used when Storage isn't configured). Served by
// unguessable id so a <video> element can load it without an auth header.
app.get('/api/projects/:id/file', async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p || !p.videoPath) return res.status(404).json({ error: 'not found' });
  await streamFile(req, res, p.videoPath, 'video/mp4');
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
  if (err) return res.status(400).json({ error: String(err.message || err) });
  res.status(500).json({ error: 'Internal error' });
});

ensureBucket().finally(async () => {
  // Fail over any jobs orphaned by a previous process (the queue was in-memory).
  await reconcileInterrupted().catch(() => {});
  // Rebuild finished projects from artifacts/ (the store is memory-only without
  // persistence — restarts must not 404 existing videos).
  await rehydrateFromArtifacts().catch((e) => console.warn('[store] recover failed:', e.message));
  app.listen(config.port, () => {
    console.log(`Squook API on http://localhost:${config.port}  (pipeline: ${config.pipelineMode}, auth: ${authEnabled ? 'on' : 'off'}, persistence: ${persistenceEnabled ? 'on' : 'off'})`);
  });
});
