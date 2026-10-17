import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { config, authEnabled, persistenceEnabled, UPLOADS_DIR, WEBAPP_DIST } from './config.js';
import { existsSync, readFileSync } from 'node:fs';
import { requireAuth } from './auth.js';
import { ensureBucket, admin } from './supabaseAdmin.js';
import { enqueueProject, enqueueRerender, enqueueRevoice, enqueueLanding, isBusy } from './jobs.js';
import { LANDING_STAGES, validateLandingUrl, landingOptions } from './landing.js';
import { countLandingSince, createProject, updateProject, finishProject, rehydrate, listInterruptedFast, getProject, listProjects, deleteProject, playbackUrl, thumbUrl, publicView, reconcileInterrupted, rehydrateFromArtifacts } from './store.js';
import { generateFastVideo, renderFastMp4, fastBusy, saveFastSource, ensureFastSource, applyEdits, followUp, editableView } from './fastVideo.js';
import { makeThumb } from './pipeline.js';
import { warmRenderer } from './renderService.js';
import { runDirectorChat, runDirectorChatStream } from './directorAgent.js';
import { appendChat, readChat, clearChat } from './chatStore.js';
import { STAGES, previewScript } from './pipeline.js';
import { reviseScript } from './scriptRevise.js';
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

// Fast mode: up to 12 photos/clips of the customer's own to build the video from.
const fastUpload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 200 * 1024 * 1024, files: 12 },
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
  res.json({ ok: true, busy: isBusy() || fastBusy(), pipelineMode: config.pipelineMode, authEnabled, persistenceEnabled, landingOnly: config.landingOnly, stages: STAGES, landingStages: LANDING_STAGES });
});

// LANDING_ONLY deployments: the prompt pipeline (Ollama + GPU) isn't available.
const promptPipeline = (_req, res, next) => (config.landingOnly
  ? res.status(403).json({ error: 'Only landing-page videos are available here' })
  : next());

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
  '.gif': 'image/gif', '.json': 'application/json', '.svg': 'image/svg+xml',
};

// Create a project + kick off generation (optionally with uploaded footage).
// Delete any footage multer already wrote to disk for a request we're rejecting.
async function discardUploads(req) {
  for (const f of req.files || []) { try { await unlink(f.path); } catch { /* ignore */ } }
}

app.post('/api/projects', promptPipeline, requireAuth, upload.array('files', 6), async (req, res) => {
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

// Landing page → video: paste a URL, HyperFrames builds a launch film (or a
// short motion teaser) from the site's real screens, brand and copy.
app.post('/api/landing', requireAuth, async (req, res) => {
  if (persistenceEnabled && req.user.id === 'anon') {
    return res.status(401).json({ error: 'Sign in to save video projects' });
  }
  let url;
  try { url = validateLandingUrl(req.body?.url); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const quota = await landingQuota(req.user).catch((e) => ({ error: e.message }));
  if (quota.error) return res.status(503).json({ error: quota.error });
  if (quota.globalLeft === 0) return res.status(429).json({ error: 'We’ve hit today’s video limit — please try again tomorrow.' });
  if (quota.left === 0) return res.status(429).json({ error: `You’ve used your ${config.landingDailyLimit} videos for today — come back tomorrow.` });
  const opts = landingOptions(req.body || {});
  const p = await enqueueLanding({ userId: req.user.id, url, ...opts });
  res.status(201).json(publicView(p));
});

// Remaining landing-page videos in the last 24h (null = unlimited).
async function landingQuota(user) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const left = (limit, used) => (limit > 0 ? Math.max(0, limit - used) : null);
  const unlimited = config.landingUnlimitedEmails.includes(String(user.email || '').toLowerCase());
  const userLimit = unlimited ? 0 : config.landingDailyLimit;
  return {
    left: left(userLimit, userLimit ? await countLandingSince(user.id, since) : 0),
    // The owner's own videos (e.g. pitches for prospects) don't use up everyone's daily pool.
    globalLeft: unlimited ? null : left(config.landingGlobalDailyLimit, config.landingGlobalDailyLimit ? await countLandingSince(null, since) : 0),
    limit: userLimit || null,
  };
}

// Fast mode: one model call → template-based video that plays in the browser
// within seconds; the MP4 renders in the background. Input: a URL or a topic.
app.post('/api/fast', requireAuth, fastUpload.array('media', 12), async (req, res) => {
  if (persistenceEnabled && req.user.id === 'anon') {
    return res.status(401).json({ error: 'Sign in to save video projects' });
  }
  const b = req.body || {};
  // Multipart sends nested fields as JSON strings.
  if (typeof b.demo === 'string') { try { b.demo = JSON.parse(b.demo); } catch { b.demo = null; } }
  const media = (req.files || []).map((f) => ({ path: f.path, name: f.originalname, type: f.mimetype }));
  let url = null;
  const topic = String(b.topic || (media.length && !b.url ? 'A short promo video made from these photos and clips' : '')).trim().slice(0, 1000);
  if (b.url) {
    try { url = validateLandingUrl(b.url); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  } else if (!topic && !b.demo?.appUrl) return res.status(400).json({ error: 'Paste a link or describe a topic' });
  const quota = await landingQuota(req.user).catch((e) => ({ error: e.message }));
  if (quota.error) return res.status(503).json({ error: quota.error });
  if (quota.globalLeft === 0) return res.status(429).json({ error: 'We’ve hit today’s video limit — please try again tomorrow.' });
  if (quota.left === 0) return res.status(429).json({ error: `You’ve used your ${config.landingDailyLimit} videos for today — come back tomorrow.` });

  // Optional demo login: the app is clicked through for real. Used for this
  // run only — never stored with the project.
  let demo = null;
  if (b.demo?.appUrl) {
    try { demo = { appUrl: validateLandingUrl(b.demo.appUrl), email: String(b.demo.email || '').slice(0, 200), password: String(b.demo.password || '').slice(0, 200), goal: String(b.demo.goal || '').slice(0, 400) }; }
    catch (e) { return res.status(400).json({ error: `App link: ${e.message}` }); }
    if (!url && !topic) url = demo.appUrl;
  }
  const style = b.style === 'explainer' ? 'explainer' : 'promo';
  const format = ['16:9', '9:16', '1:1'].includes(b.format) ? b.format : '16:9';
  // Owners may make full lessons (up to 7 min); everyone else 3 min.
  const lengthS = Math.max(15, Math.min(isOwnerAdmin(req.user) ? 420 : 180, Math.round(Number(b.duration) || 30)));
  const p = await createProject({
    userId: req.user.id, prompt: url || topic,
    title: url ? new URL(url).hostname.replace(/^www\./, '') : topic.slice(0, 60),
    format, genre: 'fast', duration: String(lengthS),
  });
  p.log = [];
  const log = (line) => { (p.log ||= []).push(line); console.log(`[fast ${p.id.slice(0, 8)}] ${line}`); };
  await updateProject(p.id, { status: 'running', stage: 'writing', progress: 10 });
  let ir;
  try {
    ir = await generateFastVideo(p, { url, topic, style, look: String(b.look || ''), format, lengthS, notes: String(b.notes || '').slice(0, 1000), demo, media, voiceLang: String(b.voiceLang || 'auto') }, log);
  } catch (e) {
    await updateProject(p.id, { status: 'failed', error: String(e.message || e) });
    return res.status(502).json({ error: String(e.message || e) });
  }
  await updateProject(p.id, { status: 'running', stage: 'rendering', progress: 60, title: ir.metadata.title });
  res.status(201).json({ project: publicView(p), ir });
  saveFastSource(p).catch((e) => log(`could not back up the preview source: ${e.message}`));

  // MP4 in the background; the browser already plays the preview.
  startFastRender(p, ir);
});

// Render (or re-render) a fast video's MP4 from its saved IR and publish it.
function startFastRender(p, ir, quality = 'standard') {
  rehydrate(p);
  p.quality = quality === 'hd' ? 'hd' : '720p';
  updateProject(p.id, { status: 'running', stage: 'rendering', progress: 60, error: null });
  // Progress 60→99% while frames render, so a stuck render is visible.
  return renderFastMp4(p.id, (line) => {
    const m = /render (\d+)%/.exec(line);
    if (m) updateProject(p.id, { progress: 60 + Math.round(Number(m[1]) * 0.39), stage: 'rendering' });
  }, quality)
    .then(async (videoPath) => finishProject(p.id, {
      videoPath, thumbPath: await makeThumb(videoPath, p.id).catch(() => null),
      title: ir.metadata.title, durationS: ir.metadata.total_duration_seconds,
    }))
    .catch((e) => {
      const msg = String(e.message || e);
      console.warn(`[fast ${p.id.slice(0, 8)}] render failed: ${msg.slice(-300)}`);
      // A restart/deploy kills the renderer mid-way: label it so it's resumed automatically.
      const killed = /signal 15|SIGTERM|SIGKILL|Target closed|browser has disconnected|Session closed|Protocol error/i.test(msg);
      const last = msg.trim().split('\n').filter(Boolean).pop() || msg;
      updateProject(p.id, { status: 'failed', error: killed ? 'interrupted by a server restart' : `MP4 render failed: ${last.slice(0, 200)}` });
    });
}

// "Render MP4 again" — after a failure or an interrupted render.
app.post('/api/fast/:id/render', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  if (p.genre !== 'fast') return res.status(400).json({ error: 'not a fast-mode video' });
  if (p.status === 'running') return res.json(publicView(p));
  if (!(await ensureFastSource(p).catch(() => false))) return res.status(404).json({ error: 'this video’s source is gone — please make it again' });
  startFastRender(p, await readIr(p.id), req.body?.quality === 'hd' ? 'hd' : 'standard');
  res.json(publicView(p));
});

// ————— Fast mode: editing (manual edits + follow-up requests) —————
// One edit at a time per video; each returns the rebuilt IR for the live preview.
const editing = new Map();
async function withEditLock(id, fn) {
  if (editing.has(id)) { const e = new Error('Another change to this video is still being applied'); e.status = 409; throw e; }
  editing.set(id, true);
  try { return await fn(); } finally { editing.delete(id); }
}
async function editableProject(req, res) {
  const p = await ownedProject(req, res);
  if (!p) return null;
  if (p.genre !== 'fast') { res.status(400).json({ error: 'only fast-mode videos can be edited here' }); return null; }
  if (!(await ensureFastSource(p).catch(() => false))) { res.status(404).json({ error: 'this video’s source is gone — please make it again' }); return null; }
  try { await editableView(p); } catch { res.status(409).json({ error: 'this video was made before editing existed — make it again to edit it' }); return null; }
  return p;
}

app.get('/api/fast/:id/edit', requireAuth, async (req, res) => {
  const p = await editableProject(req, res);
  if (!p) return;
  res.json(await editableView(p));
});

app.post('/api/fast/:id/edit', requireAuth, async (req, res) => {
  const p = await editableProject(req, res);
  if (!p) return;
  try {
    const out = await withEditLock(p.id, () => applyEdits(p, req.body?.ops, (l) => console.log(`[fast ${p.id.slice(0, 8)}] ${l}`)));
    saveFastSource(p).catch((e) => console.warn(`[fast ${p.id.slice(0, 8)}] backup after edit failed: ${e.message}`));
    res.json({ ir: out.ir, done: out.done, editable: await editableView(p) });
  } catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
});

app.post('/api/fast/:id/followup', requireAuth, async (req, res) => {
  const p = await editableProject(req, res);
  if (!p) return;
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Say what you’d like to change' });
  try {
    const out = await withEditLock(p.id, () => followUp(p, message, (l) => console.log(`[fast ${p.id.slice(0, 8)}] ${l}`)));
    saveFastSource(p).catch((e) => console.warn(`[fast ${p.id.slice(0, 8)}] backup after follow-up failed: ${e.message}`));
    res.json({ ir: out.ir, done: out.done, reply: out.reply, editable: await editableView(p) });
  } catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
});

// After a restart: re-render MP4s that the restart cut off.
async function resumeInterruptedFast() {
  for (const p of await listInterruptedFast()) {
    try {
      if (!(await ensureFastSource(p))) continue;
      console.log(`[fast ${p.id.slice(0, 8)}] resuming the MP4 render cut off by a restart`);
      startFastRender(p, await readIr(p.id));
    } catch (e) { console.warn(`[fast ${p.id.slice(0, 8)}] resume failed: ${e.message}`); }
  }
}

// ————— Public share links (sales: a video made for a prospect) —————
// A share token is `<id>.<sig>`; only the owner can get the signature, so a
// shared video is viewable without sign-in but other videos stay private.
const shareSig = (id) => createHmac('sha256', config.serviceRoleKey || config.supabaseKey || 'squook-dev').update(`share:${id}`).digest('base64url').slice(0, 16);
function shareId(token) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !sig) return null;
  const want = Buffer.from(shareSig(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
const isOwnerAdmin = (user) => config.landingUnlimitedEmails.includes(String(user?.email || '').toLowerCase());

app.get('/api/fast/:id/share', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (p) res.json({ token: `${p.id}.${shareSig(p.id)}` });
});

app.get('/api/share/:token', async (req, res) => {
  const id = shareId(req.params.token);
  const p = id && await getProject(id);
  if (!p || p.genre !== 'fast') return res.status(404).json({ error: 'This video link is not valid.' });
  await ensureFastSource(p).catch(() => {});
  let ir;
  try { ir = await readIr(p.id); } catch { return res.status(404).json({ error: 'This video is no longer available.' }); }
  // Record the view (who opened which pitch, and when) — Storage keeps it across restarts.
  const view = { at: new Date().toISOString(), title: p.title, ref: String(req.query.r || '').slice(0, 80), ua: String(req.get('user-agent') || '').slice(0, 160), country: req.get('cf-ipcountry') || '' };
  console.log(`[share] view ${p.id.slice(0, 8)} ${view.ref} ${view.country}`);
  if (admin) admin.storage.from(config.storageBucket).upload(`shares/${p.id}/${Date.now()}.json`, JSON.stringify(view), { contentType: 'application/json', upsert: true }).catch(() => {});
  res.json({ id: p.id, title: ir.metadata.title, ir });
});

// Who watched the shared videos (owner only).
app.get('/api/share-views', requireAuth, async (req, res) => {
  if (!isOwnerAdmin(req.user) || !admin) return res.status(404).json({ error: 'not found' });
  const bucket = admin.storage.from(config.storageBucket);
  const { data: dirs } = await bucket.list('shares', { limit: 500 });
  const out = [];
  for (const d of dirs || []) {
    const { data: files } = await bucket.list(`shares/${d.name}`, { limit: 200 });
    const p = await getProject(d.name).catch(() => null);
    const views = await Promise.all((files || []).map(async (f) => {
      const { data } = await bucket.download(`shares/${d.name}/${f.name}`);
      try { return JSON.parse(await data.text()); } catch { return null; }
    }));
    out.push({ id: d.name, title: p?.title, views: views.filter(Boolean).sort((a, b) => a.at.localeCompare(b.at)) });
  }
  res.json(out);
});

app.get('/api/landing/quota', requireAuth, async (req, res) => {
  try { res.json(await landingQuota(req.user)); }
  catch (e) { res.status(503).json({ error: String(e.message || e) }); }
});

// Generate JUST the script (directing) for the review-before-render step — no
// project, no render. Returns { script, asset_plan } the client shows and edits.
app.post('/api/script/preview', promptPipeline, requireAuth, async (req, res) => {
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

// AI-revise the review script from a plain-language instruction → { script }.
app.post('/api/script/revise', promptPipeline, requireAuth, async (req, res) => {
  const instruction = String(req.body?.instruction || '').trim();
  const script = req.body?.script;
  if (!instruction) return res.status(400).json({ error: 'instruction is required' });
  if (!script?.scenes?.length) return res.status(400).json({ error: 'script is required' });
  try {
    res.json({ script: await reviseScript(script, instruction) });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
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
  // Fast videos also show their last steps, so a slow run can be diagnosed.
  if (p) res.json({ ...publicView(p), ...(p.genre === 'fast' && p.log?.length ? { log: p.log.slice(-25) } : {}) });
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
  if (p.genre === 'fast') await ensureFastSource(p).catch(() => {});
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
  if (p.genre === 'fast') await ensureFastSource(p).catch(() => {});
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

// Change the narration voice: re-synthesize every scene's voiceover into the
// project snapshot (queued — TTS is heavy). No render; the editor previews
// from the snapshot and re-renders when ready.
const VOICE_IDS = ['nova', 'atlas', 'juno', 'ryan', 'sonia', 'guy']; // mirrors tts.VOICES
app.post('/api/projects/:id/revoice', requireAuth, async (req, res) => {
  const p = await ownedProject(req, res);
  if (!p) return;
  const voice = String(req.body?.voice || '').trim().toLowerCase();
  if (!VOICE_IDS.includes(voice)) return res.status(400).json({ error: 'unknown voice' });
  if (!(await hasSnapshot(p.id))) return res.status(404).json({ error: 'no editable source for this project' });
  if (p.status === 'running' || p.status === 'queued') return res.status(409).json({ error: 'busy' });
  const job = await enqueueRevoice(p.id, voice);
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
  // ?download forces a save-as (Content-Disposition: attachment) — the browser
  // download attribute is ignored cross-origin, so the header is what makes the
  // Export button download instead of navigating to the video.
  if (req.query.download !== undefined) {
    const q = String(req.query.download || '');
    const name = (/\.mp4$/i.test(q) ? q : `${p.title || 'squook-video'}.mp4`).replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  }
  await streamFile(req, res, p.videoPath, 'video/mp4');
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
  if (err) return res.status(400).json({ error: String(err.message || err) });
  res.status(500).json({ error: 'Internal error' });
});

// Serve the built webapp from the same origin when it's been built (the
// deployed image does this). The app uses a hash router, so static files suffice.
// The page gets its public settings at serve time (window.__SQUOOK__), so one
// image works on any host without rebuilding the bundle.
if (existsSync(WEBAPP_DIST)) {
  const html = readFileSync(resolve(WEBAPP_DIST, 'index.html'), 'utf8');
  const runtime = JSON.stringify({
    supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseKey, landingOnly: config.landingOnly,
    salesLink: process.env.SALES_LINK || '', salesPrice: process.env.SALES_PRICE || '$29/month',
  }).replace(/</g, '\\u003c');
  const page = html.replace('</head>', `<script>window.__SQUOOK__=${runtime}</script></head>`);
  app.get(['/', '/index.html'], (_req, res) => res.type('html').send(page));
  app.use(express.static(WEBAPP_DIST, { index: false }));
}

ensureBucket().finally(async () => {
  // Fail over any jobs orphaned by a previous process (the queue was in-memory).
  await reconcileInterrupted().catch(() => {});
  // Rebuild finished projects from artifacts/ (the store is memory-only without
  // persistence — restarts must not 404 existing videos).
  await rehydrateFromArtifacts().catch((e) => console.warn('[store] recover failed:', e.message));
  app.listen(config.port, () => {
    console.log(`Squook API on http://localhost:${config.port}  (pipeline: ${config.pipelineMode}, auth: ${authEnabled ? 'on' : 'off'}, persistence: ${persistenceEnabled ? 'on' : 'off'})`);
    // Fast mode: bundle the renderer + open its browser now, not on the first video.
    if (config.pipelineMode === 'real') { warmRenderer(); resumeInterruptedFast().catch((e) => console.warn('[fast] resume failed:', e.message)); }
  });
});
