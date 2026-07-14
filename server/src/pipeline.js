import { spawn } from 'node:child_process';
import { copyFile, access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  GUIDE_DIR, RENDERER_DIR, FINAL_VIDEO, FALLBACK_VIDEO, ARTIFACTS_DIR, config,
} from './config.js';
import {
  snapshotProject, restoreProject, readIr, irSnapshotPath, assetSnapshotDir,
} from './snapshot.js';

export const STAGES = ['directing', 'rendering', 'mastering'];
export const RERENDER_STAGES = ['rendering', 'mastering'];
const RENDER_IR = resolve(RENDERER_DIR, 'public', 'render_ir.json');

/**
 * Generate JUST the script (directing crew), for the review-before-render step.
 * Runs the flow in preview mode — no TTS/assets/render — and returns the
 * { script, asset_plan } the review screen shows and later renders.
 */
export async function previewScript(params, onLog = () => {}) {
  const payload = JSON.stringify({
    prompt: params.prompt,
    preset: presetFor(params.format),
    genre: params.genre || '',
    ...(params.presetBundle ? { preset_bundle: params.presetBundle } : {}),
    uploads: (params.uploads || []).map((u) => ({ path: u.path || '', name: u.name, type: u.type || '' })),
    music: params.music || '',
    voice: params.voice || '',
    duration: params.duration || '',
    preview: true,
  });
  if (config.pipelineMode === 'mock') {
    return { script: { metadata: { title: params.prompt.slice(0, 60), prompt: params.prompt }, scenes: [
      { index: 1, narration: '(mock) This is the opening line of your video.', on_screen_text: 'Hello', visual: 'Title card' },
      { index: 2, narration: '(mock) And here is the second beat, ready to edit.', on_screen_text: '', visual: 'B-roll' },
    ] }, asset_plan: [] };
  }
  await run('uv', ['run', 'run_with_trigger', payload], GUIDE_DIR, onLog);
  const raw = await readFile(join(GUIDE_DIR, 'output', 'preview_script.json'), 'utf8');
  return JSON.parse(raw);
}

export function presetFor(format) {
  // No format given → '' so the flow infers the aspect from the prompt.
  if (!format) return '';
  return format === '9:16' ? 'reel' : 'landscape';
}

function run(cmd, args, cwd, onLog) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    // Keep the tail of the child's output so a failure reports *why*, not
    // just the exit code (box-drawing frames stripped, they're just chrome).
    const tail = [];
    const pump = (buf) => {
      for (const line of buf.toString().split('\n')) {
        if (!line.trim()) continue;
        onLog(line.trimEnd());
        if (!/^[\s│╭╰─╮╯]*$/.test(line)) {
          tail.push(line.trim());
          if (tail.length > 15) tail.shift();
        }
      }
    };
    child.stdout.on('data', pump);
    child.stderr.on('data', pump);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(
        `${cmd} ${args.join(' ')} exited with code ${code}\n${tail.join('\n')}`)));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function firstExisting(paths) {
  for (const p of paths) {
    try { await access(p, constants.R_OK); return p; } catch { /* next */ }
  }
  return null;
}

// The AI director writes a real title + duration into render_ir.json.
async function readIrMeta() {
  try {
    const ir = JSON.parse(await readFile(RENDER_IR, 'utf8'));
    const { width, height } = ir?.metadata || {};
    return {
      title: ir?.metadata?.title || null,
      durationS: ir?.metadata?.total_duration_seconds ?? null,
      // The aspect may have been inferred from the prompt by the flow — feed
      // the real one back so the project card can show it.
      format: width && height ? (height > width ? '9:16' : '16:9') : null,
    };
  } catch { return { title: null, durationS: null, format: null }; }
}

// Extract a poster frame using Remotion's bundled ffmpeg (no system ffmpeg needed).
async function makeThumb(videoPath, id) {
  const thumb = join(ARTIFACTS_DIR, `${id}.jpg`);
  try {
    await run('npx', ['remotion', 'ffmpeg', '-loglevel', 'error', '-i', videoPath,
      '-frames:v', '1', '-q:v', '3', thumb, '-y'], RENDERER_DIR, () => {});
    return thumb;
  } catch { return null; }
}

/**
 * Run the prompt → video pipeline.
 * @returns { videoPath, title, durationS, thumbPath }
 */
export async function runPipeline(project, update) {
  const dest = join(ARTIFACTS_DIR, `${project.id}.mp4`);
  const log = (line) => update({ log: line });
  const uploads = project.uploads || [];

  if (config.pipelineMode === 'mock') {
    if (uploads.length) log(`[mock] received ${uploads.length} file(s): ${uploads.map((u) => u.name).join(', ')}`);
    for (let i = 0; i < STAGES.length; i++) {
      update({ stage: STAGES[i], progress: Math.round((i / STAGES.length) * 100) });
      log(`[mock] ${STAGES[i]}…`);
      await wait(1200);
    }
    const sample = await firstExisting([FINAL_VIDEO, FALLBACK_VIDEO]);
    if (!sample) throw new Error('mock mode: no sample render in renderer/out/');
    await copyFile(sample, dest);
  } else {
    const payload = JSON.stringify({
      prompt: project.prompt,
      preset: project.preset,
      // Content preset (genre): a built-in id ('educational'|'animation'|
      // 'images'|'auto') or 'custom' with the resolved bundle the flow uses
      // verbatim. Empty/absent → the flow defaults to 'auto'.
      genre: project.genre || '',
      ...(project.presetBundle ? { preset_bundle: project.presetBundle } : {}),
      // Full upload records so the flow's crew can name/assign the user's own
      // footage (not just bare paths).
      uploads: uploads.map((u) => ({ path: u.path, name: u.name, type: u.type })),
      music: project.music || '',
      voice: project.voice || '',
      duration: project.duration || '',
      // Review edit: the user tweaked the script — the flow skips the crew and
      // narrates/renders their exact words (with the phase-1 asset plan reused).
      ...(project.editedScript?.scenes ? { edited_script: project.editedScript, asset_plan: project.assetPlan || [] } : {}),
    });
    update({ stage: 'directing', progress: 5 });
    await run('uv', ['run', 'run_with_trigger', payload], GUIDE_DIR, log);
    update({ stage: 'rendering', progress: 45 });
    // First cut renders at half scale — ~2.7× faster (measured). The user
    // upgrades to full resolution from the editor when they want the final.
    await run('npx', ['remotion', 'render', 'Explainer', 'out/video.mp4', '--scale', '0.5'], RENDERER_DIR, log);
    update({ stage: 'mastering', progress: 85 });
    await run('uv', ['run', 'master'], GUIDE_DIR, log);
    const out = await firstExisting([FINAL_VIDEO, FALLBACK_VIDEO]);
    if (!out) throw new Error('pipeline finished but no output video found');
    await copyFile(out, dest);
  }

  const meta = await readIrMeta();
  const thumbPath = await makeThumb(dest, project.id);
  // Snapshot the IR + referenced assets so the project stays editable after
  // the next generation overwrites renderer/public (best-effort in mock mode).
  try {
    await snapshotProject(project.id);
    update({ log: '[snapshot] saved editable source' });
  } catch (e) {
    update({ log: `[snapshot] unavailable: ${e.message}` });
  }
  if (meta.format) project.format = meta.format; // inferred aspect → card label
  project.quality = 'draft';
  update({ progress: 100, log: `done: ${meta.title || dest}` });
  return { videoPath: dest, title: meta.title, durationS: meta.durationS, thumbPath };
}

/**
 * Re-voice a project's narration in its snapshot — no render. Synthesizes a
 * fresh wav per scene with the requested voice and rewrites the snapshot IR
 * (audio srcs, captions, retimed durations). The editor previews straight
 * from the snapshot; the mp4 goes stale until the next re-render, exactly
 * like any other IR edit.
 */
export async function runRevoice(project, update, voice) {
  const log = (line) => update({ log: line });
  update({ stage: 'revoicing', progress: 10 });
  if (config.pipelineMode === 'mock') {
    log(`[mock] revoicing with '${voice}'…`);
    await wait(1200);
    return;
  }
  const payload = JSON.stringify({
    ir: irSnapshotPath(project.id),
    assets: assetSnapshotDir(project.id),
    voice,
  });
  await run('uv', ['run', 'revoice', payload], GUIDE_DIR, log);
}

/**
 * Re-render a project from its edited IR snapshot — no AI flow involved.
 * Restores the snapshot into renderer/public, then runs render + master only.
 */
export async function runRerender(project, update, quality = 'draft') {
  const dest = join(ARTIFACTS_DIR, `${project.id}.mp4`);
  const log = (line) => update({ log: line });

  if (config.pipelineMode === 'mock') {
    for (let i = 0; i < RERENDER_STAGES.length; i++) {
      update({ stage: RERENDER_STAGES[i], progress: Math.round((i / RERENDER_STAGES.length) * 100) });
      log(`[mock] ${RERENDER_STAGES[i]}…`);
      await wait(1200);
    }
    const sample = await firstExisting([dest, FINAL_VIDEO, FALLBACK_VIDEO]);
    if (!sample) throw new Error('mock mode: no sample render available');
    if (sample !== dest) await copyFile(sample, dest);
  } else {
    await restoreProject(project.id);
    update({ stage: 'rendering', progress: 10 });
    const scale = quality === 'hd' ? [] : ['--scale', '0.5'];
    await run('npx', ['remotion', 'render', 'Explainer', 'out/video.mp4', ...scale], RENDERER_DIR, log);
    update({ stage: 'mastering', progress: 75 });
    await run('uv', ['run', 'master'], GUIDE_DIR, log);
    const out = await firstExisting([FINAL_VIDEO, FALLBACK_VIDEO]);
    if (!out) throw new Error('re-render finished but no output video found');
    await copyFile(out, dest);
  }

  // Title/duration come from the project's own snapshot, not the shared IR.
  const ir = await readIr(project.id).catch(() => null);
  const thumbPath = await makeThumb(dest, project.id);
  project.quality = quality;
  update({ progress: 100, log: `done: ${quality === 'hd' ? 'HD render' : 're-render'}` });
  return {
    videoPath: dest,
    title: ir?.metadata?.title || null,
    durationS: ir?.metadata?.total_duration_seconds ?? null,
    thumbPath,
  };
}
