import { unlink } from 'node:fs/promises';
import { createProject, updateProject, finishProject, live, getProject, rehydrate } from './store.js';
import { runPipeline, runRerender, presetFor } from './pipeline.js';

// Single-worker FIFO queue — the pipeline writes shared files (renderer/public,
// renderer/out), so projects must render one at a time.
const queue = [];
let working = false;
const MAX_LOG = 40;

export async function enqueueProject({ userId, prompt, format, genre, presetBundle, uploads, music, voice, duration, editedScript, assetPlan }) {
  const p = await createProject({
    userId, prompt, format, preset: presetFor(format),
    genre, presetBundle, uploads, music, voice, duration,
  });
  // Transient generation inputs (from the review screen) — mem only, not the DB.
  if (editedScript?.scenes) { p.editedScript = editedScript; p.assetPlan = assetPlan || []; }
  p.log = [];
  queue.push({ id: p.id, kind: 'generate' });
  drain();
  return p;
}

// Re-render a project from its edited IR snapshot (render + master only).
export async function enqueueRerender(id, quality = 'draft') {
  let p = live(id);
  if (!p) {
    p = await getProject(id);
    if (!p) return null;
    rehydrate(p); // DB row → mem so the worker's live() sees it
  }
  p.log ||= [];
  p.draft ??= 1;
  await updateProject(id, { status: 'queued', stage: null, progress: 0, error: null });
  queue.push({ id, kind: 'rerender', quality });
  drain();
  return p;
}

async function drain() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const { id, kind, quality } = queue.shift();
      const p = live(id);
      if (!p) continue;
      const firstStage = kind === 'rerender' ? 'rendering' : 'directing';
      await updateProject(id, { status: 'running', stage: firstStage, progress: 5 });

      let lastStage = null;
      const update = ({ stage, progress, log }) => {
        if (stage !== undefined) p.stage = stage;
        if (progress !== undefined) p.progress = progress;
        if (log) { (p.log ||= []).push(log); if (p.log.length > MAX_LOG) p.log.shift(); }
        // Persist only on stage change (not every progress tick) to spare the DB.
        if (stage && stage !== lastStage) {
          lastStage = stage;
          updateProject(id, { status: 'running', stage, progress: p.progress });
        }
      };

      try {
        const result = kind === 'rerender'
          ? await runRerender(p, update, quality)
          : await runPipeline(p, update);
        // Render succeeded. If persistence (Storage upload) then fails, keep the
        // job 'done' with the local artifact rather than mislabelling it failed.
        try {
          await finishProject(id, result, { rerender: kind === 'rerender' });
        } catch (e) {
          console.warn('[jobs] render ok but persist failed:', e.message);
          Object.assign(p, {
            status: 'done', stage: 'done', progress: 100,
            videoPath: result.videoPath,
            durationS: result.durationS ?? p.durationS,
            title: result.title || p.title,
          });
          await updateProject(id, {
            status: 'done', stage: 'done', progress: 100, durationS: p.durationS,
          }).catch(() => {});
        }
      } catch (e) {
        p.status = 'failed';
        p.error = String(e.message || e);
        await updateProject(id, { status: 'failed', error: p.error });
      } finally {
        // Uploaded footage has been consumed by the pipeline — free the disk.
        for (const u of p.uploads || []) {
          if (u?.path) { try { await unlink(u.path); } catch { /* ignore */ } }
        }
      }
    }
  } finally {
    working = false;
  }
}
