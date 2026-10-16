// In-process Remotion rendering for fast mode: the renderer project is bundled
// ONCE per server and one headless browser is kept open, so a quality-check
// still costs well under a second and an MP4 skips the CLI's re-bundling.
// Media is streamed from this server's own asset route (metadata.asset_base),
// so nothing is copied into renderer/public.
import { createRequire } from 'node:module';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { config, RENDERER_DIR } from './config.js';

const req = createRequire(join(RENDERER_DIR, 'package.json'));
const CHROMIUM = { gl: 'swangle' }; // software WebGL: shader backgrounds render without a GPU

let bundled; // Promise<serveUrl>
let browser; // Promise<puppeteer instance>

async function serveUrl() {
  if (!bundled) {
    bundled = (async () => {
      // Root.tsx imports public/render_ir.json for the CLI default; make sure it exists.
      const placeholder = join(RENDERER_DIR, 'public', 'render_ir.json');
      try { await access(placeholder); } catch {
        await mkdir(join(RENDERER_DIR, 'public'), { recursive: true });
        await writeFile(placeholder, JSON.stringify({ metadata: { title: '', prompt: '', fps: 30, width: 1920, height: 1080, scene_count: 0, total_frames: 30, total_duration_seconds: 1 }, scenes: [] }));
      }
      const { bundle } = req('@remotion/bundler');
      return bundle({ entryPoint: join(RENDERER_DIR, 'src', 'index.ts') });
    })().catch((e) => { bundled = undefined; throw e; });
  }
  return bundled;
}

async function chrome() {
  if (!browser) {
    const { openBrowser } = req('@remotion/renderer');
    browser = openBrowser('chrome', { chromiumOptions: CHROMIUM }).catch((e) => { browser = undefined; throw e; });
  }
  return browser;
}

/** Warm up in the background at boot so the first video doesn't pay for it. */
export function warmRenderer() {
  serveUrl().then(chrome).catch((e) => console.warn('[render] warm-up failed:', e.message));
}

const withAssets = (projectId, ir) => ({
  ...ir,
  metadata: { ...ir.metadata, asset_base: `http://127.0.0.1:${config.port}/api/projects/${projectId}/assets/` },
});

async function composition(projectId, ir) {
  const { selectComposition } = req('@remotion/renderer');
  const url = await serveUrl();
  const inputProps = { ir: withAssets(projectId, ir) };
  const comp = await selectComposition({ serveUrl: url, id: 'Explainer', inputProps, puppeteerInstance: await chrome(), chromiumOptions: CHROMIUM });
  return { url, inputProps, comp };
}

/** JPEG stills of the given frames (small scale — for the vision check). */
export async function renderStills(projectId, ir, frames, outDir, scale = 0.4) {
  const { renderStill } = req('@remotion/renderer');
  const { url, inputProps, comp } = await composition(projectId, ir);
  const puppeteerInstance = await chrome();
  await mkdir(outDir, { recursive: true });
  const out = [];
  // A few at a time: one browser, several tabs.
  for (let i = 0; i < frames.length; i += 3) {
    out.push(...await Promise.all(frames.slice(i, i + 3).map(async (frame, k) => {
      const output = join(outDir, `check_${i + k + 1}.jpg`);
      await renderStill({ composition: comp, serveUrl: url, output, frame: Math.min(frame, comp.durationInFrames - 1), inputProps, imageFormat: 'jpeg', jpegQuality: 70, scale, puppeteerInstance, chromiumOptions: CHROMIUM, overwrite: true });
      return output;
    })));
  }
  return out;
}

/** Full MP4. */
export async function renderMp4(projectId, ir, outputLocation, onProgress = () => {}) {
  const { renderMedia } = req('@remotion/renderer');
  const { url, inputProps, comp } = await composition(projectId, ir);
  await renderMedia({
    composition: comp, serveUrl: url, codec: 'h264', outputLocation, inputProps,
    concurrency: Math.max(1, Math.min(6, cpus().length)),
    imageFormat: 'jpeg', jpegQuality: 85, chromiumOptions: CHROMIUM, overwrite: true,
    onProgress: ({ progress }) => onProgress(progress),
  });
  return outputLocation;
}
