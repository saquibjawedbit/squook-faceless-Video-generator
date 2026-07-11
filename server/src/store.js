import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { admin } from './supabaseAdmin.js';
import { config, persistenceEnabled, ARTIFACTS_DIR } from './config.js';
import { deleteSnapshot } from './snapshot.js';

// In-memory mirror of projects created this process. Serves live progress during
// a run and is the ONLY store when persistence is off. Durable history lives in
// the `projects` table (read on demand) when the service_role key is present.
const mem = new Map();

// A readable name from the prompt; replaced by the AI-written title once known.
export function deriveTitle(prompt) {
  const words = prompt.trim().split(/\s+/).slice(0, 7).join(' ');
  const t = words.replace(/[.,;:!?]+$/, '');
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80) || 'Untitled video';
}

function publicView(p) {
  return {
    id: p.id,
    title: p.title,
    prompt: p.prompt,
    format: p.format,
    status: p.status,
    stage: p.stage,
    progress: p.progress,
    error: p.error,
    videoReady: p.status === 'done',
    // Generations render at half scale for speed; 'hd' after a full-res
    // render. Pre-quality projects (undefined) were full-res → 'hd'.
    quality: p.quality || 'hd',
    draft: p.draft ?? 1,
    durationS: p.durationS ?? null,
    uploads: (p.uploads || []).map((u) => ({ name: u.name, size: u.size })),
    createdAt: p.createdAt,
    log: (p.log || []).slice(-8),
  };
}

export async function createProject({ userId, prompt, format, preset, genre, presetBundle, uploads, music, voice, duration }) {
  const p = {
    id: randomUUID(),
    userId,
    prompt,
    title: deriveTitle(prompt),
    // No format given → the flow infers it from the prompt; the real aspect
    // is backfilled from the render IR when the video finishes.
    format: format || '',
    preset,
    // Content preset (genre): a built-in id or 'custom'. Persisted as a column
    // so the card/regeneration knows it. A custom preset's full bundle rides
    // `presetBundle` to the flow but isn't a column (passthrough, like music).
    genre: genre || 'auto',
    presetBundle: presetBundle || null,
    status: 'queued',
    stage: null,
    progress: 0,
    error: null,
    uploads: uploads || [],
    // Composer creative choices — passed to the flow, not persisted as columns.
    music: music || '',
    voice: voice || '',
    duration: duration || '',
    storagePath: null,
    thumbPath: null,
    durationS: null,
    videoPath: null, // local artifact path (fallback delivery)
    createdAt: new Date().toISOString(),
  };
  mem.set(p.id, p);

  if (persistenceEnabled) {
    const { error } = await admin.from('projects').insert({
      id: p.id, user_id: userId, title: p.title, prompt, format: p.format,
      preset, genre: p.genre, status: 'queued', progress: 0,
      uploads: p.uploads.map((u) => ({ name: u.name, size: u.size })),
    });
    if (error) console.warn('[db] insert failed:', error.message);
  }
  return p;
}

// Patch live state and (best-effort) persist the columns that matter.
export async function updateProject(id, patch) {
  const p = mem.get(id);
  if (p) Object.assign(p, patch);
  if (persistenceEnabled) {
    const cols = {};
    for (const k of ['status', 'stage', 'progress', 'error', 'title'])
      if (patch[k] !== undefined) cols[k] = patch[k];
    if (patch.storagePath !== undefined) cols.storage_path = patch.storagePath;
    if (patch.thumbPath !== undefined) cols.thumb_path = patch.thumbPath;
    if (patch.durationS !== undefined) cols.duration_s = patch.durationS;
    if (Object.keys(cols).length) {
      cols.updated_at = new Date().toISOString();
      const { error } = await admin.from('projects').update(cols).eq('id', id);
      if (error) console.warn('[db] update failed:', error.message);
    }
  }
  return p;
}

// Called when a render finishes: push the mp4 (+thumbnail) to Storage, or keep
// the local path for fallback delivery. Re-renders bump the draft counter.
export async function finishProject(id, { videoPath, thumbPath, title, durationS }, { rerender = false } = {}) {
  const p = mem.get(id);
  const patch = { status: 'done', stage: 'done', progress: 100, videoPath, durationS };
  if (title) patch.title = title;
  if (rerender) patch.draft = (p?.draft ?? 1) + 1;

  if (persistenceEnabled) {
    const storagePath = `${p.userId}/${id}.mp4`;
    const video = await readFile(videoPath);
    const up = await admin.storage.from(config.storageBucket)
      .upload(storagePath, video, { contentType: 'video/mp4', upsert: true });
    if (up.error) throw new Error(`storage upload failed: ${up.error.message}`);
    patch.storagePath = storagePath;

    if (thumbPath) {
      try {
        const thumb = await readFile(thumbPath);
        const tp = `${p.userId}/${id}.jpg`;
        const tu = await admin.storage.from(config.storageBucket)
          .upload(tp, thumb, { contentType: 'image/jpeg', upsert: true });
        if (!tu.error) patch.thumbPath = tp;
      } catch { /* thumbnail is best-effort */ }
    }
  }
  return updateProject(id, patch);
}

// Synchronous access to the live in-memory record (used by the worker).
export function live(id) {
  return mem.get(id) || null;
}

// Put a DB-loaded project into mem so the worker can track live progress on it.
export function rehydrate(p) {
  mem.set(p.id, p);
  return p;
}

export async function getProject(id) {
  if (mem.has(id)) return mem.get(id);
  if (persistenceEnabled) {
    const { data } = await admin.from('projects').select('*').eq('id', id).maybeSingle();
    return data ? fromRow(data) : null;
  }
  return null;
}

export async function listProjects(userId) {
  if (persistenceEnabled) {
    const { data, error } = await admin.from('projects')
      .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
    if (error) { console.warn('[db] list failed:', error.message); return []; }
    return data.map(fromRow);
  }
  return [...mem.values()].filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// A URL the browser can play: a short-lived signed Storage URL, or null (caller
// falls back to the local streaming route).
export async function playbackUrl(project) {
  if (persistenceEnabled && project.storagePath) {
    const { data, error } = await admin.storage.from(config.storageBucket)
      .createSignedUrl(project.storagePath, config.signedUrlTtl);
    if (error) { console.warn('[storage] sign failed:', error.message); return null; }
    return data.signedUrl;
  }
  return null;
}

export async function thumbUrl(project) {
  if (persistenceEnabled && project.thumbPath) {
    const { data } = await admin.storage.from(config.storageBucket)
      .createSignedUrl(project.thumbPath, config.signedUrlTtl);
    return data?.signedUrl || null;
  }
  return null;
}

export async function deleteProject(id) {
  const p = mem.get(id);
  if (persistenceEnabled) {
    const paths = [];
    if (p?.storagePath) paths.push(p.storagePath);
    if (p?.thumbPath) paths.push(p.thumbPath);
    if (paths.length) await admin.storage.from(config.storageBucket).remove(paths);
    await admin.from('projects').delete().eq('id', id);
  }
  // Clean up every local file this project owns: the mp4, its thumbnail, the
  // editable snapshot (IR + asset dir), and any uploaded footage.
  const locals = [];
  if (p?.videoPath) locals.push(p.videoPath, p.videoPath.replace(/\.mp4$/, '.jpg'));
  for (const u of p?.uploads || []) if (u?.path) locals.push(u.path);
  for (const f of locals) { try { await unlink(f); } catch { /* ignore */ } }
  try { await deleteSnapshot(id); } catch { /* ignore */ }
  mem.delete(id);
}

// When persistence is off the store is memory-only, but finished renders leave
// <id>.mp4 + <id>.ir.json in artifacts/. On boot, rebuild project records from
// those files so a server restart (e.g. node --watch picking up a code change)
// doesn't 404 every existing project.
export async function rehydrateFromArtifacts() {
  if (persistenceEnabled) return 0;
  const files = await readdir(ARTIFACTS_DIR).catch(() => []);
  let recovered = 0;
  for (const f of files) {
    const m = /^([0-9a-f-]{36})\.mp4$/.exec(f);
    if (!m || mem.has(m[1])) continue;
    const id = m[1];
    let ir = null;
    try { ir = JSON.parse(await readFile(join(ARTIFACTS_DIR, `${id}.ir.json`), 'utf8')); } catch { /* video-only */ }
    const st = await stat(join(ARTIFACTS_DIR, f)).catch(() => null);
    mem.set(id, {
      id, userId: 'anon',
      prompt: ir?.metadata?.prompt || '',
      title: ir?.metadata?.title || 'Recovered video',
      format: ir ? (ir.metadata.width >= ir.metadata.height ? '16:9' : '9:16') : '',
      preset: null, status: 'done', stage: 'done', progress: 100, error: null,
      uploads: [], music: '', voice: '', duration: '',
      storagePath: null, thumbPath: null,
      durationS: ir?.metadata?.total_duration_seconds ?? null,
      videoPath: join(ARTIFACTS_DIR, f),
      quality: 'draft', draft: 1,
      createdAt: (st?.mtime || new Date()).toISOString(),
      log: ['[recovered from artifacts after a server restart]'],
    });
    recovered++;
  }
  if (recovered) console.log(`[store] recovered ${recovered} project(s) from artifacts/`);
  return recovered;
}

// On startup, any project left 'queued'/'running' by a previous process is
// orphaned (the in-memory queue didn't survive the restart) — mark it failed so
// it doesn't show a forever-spinning status.
export async function reconcileInterrupted() {
  if (!persistenceEnabled) return;
  const { error } = await admin.from('projects')
    .update({ status: 'failed', error: 'interrupted by a server restart', updated_at: new Date().toISOString() })
    .in('status', ['queued', 'running']);
  if (error) console.warn('[db] reconcile failed:', error.message);
}

function fromRow(r) {
  return {
    id: r.id, userId: r.user_id, prompt: r.prompt, title: r.title,
    format: r.format, preset: r.preset, genre: r.genre || 'auto', status: r.status, stage: r.stage,
    progress: r.progress, error: r.error, uploads: r.uploads || [],
    storagePath: r.storage_path, thumbPath: r.thumb_path, durationS: r.duration_s,
    videoPath: null, createdAt: r.created_at,
  };
}

export { publicView };
