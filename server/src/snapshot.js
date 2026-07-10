// Per-project editable source: renderer/public is shared mutable state that
// every generation overwrites, so on finish we snapshot the project's IR +
// referenced media into artifacts/. The editor reads/writes the snapshot, and
// a re-render restores it into renderer/public before running Remotion.
import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ARTIFACTS_DIR, RENDERER_DIR } from './config.js';
import { retime, validateIr, referencedPaths } from './ir.js';

const RENDERER_PUBLIC = resolve(RENDERER_DIR, 'public');
const RENDER_IR = join(RENDERER_PUBLIC, 'render_ir.json');

export const irSnapshotPath = (id) => join(ARTIFACTS_DIR, `${id}.ir.json`);
export const assetSnapshotDir = (id) => join(ARTIFACTS_DIR, `${id}-assets`);

export async function hasSnapshot(id) {
  try { await access(irSnapshotPath(id)); return true; } catch { return false; }
}

// Copy the just-rendered IR + every asset it references out of renderer/public.
export async function snapshotProject(id) {
  const ir = JSON.parse(await readFile(RENDER_IR, 'utf8'));
  const dir = assetSnapshotDir(id);
  for (const p of referencedPaths(ir)) {
    const src = resolve(RENDERER_PUBLIC, p);
    if (!src.startsWith(RENDERER_PUBLIC)) continue; // never leave public/
    const dest = resolve(dir, p);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
    } catch (e) {
      console.warn(`[snapshot] skipped ${p}: ${e.message}`);
    }
  }
  await writeFile(irSnapshotPath(id), JSON.stringify(ir, null, 2));
  return ir;
}

// Put a project's snapshot back into renderer/public for a re-render.
export async function restoreProject(id) {
  await copyFile(irSnapshotPath(id), RENDER_IR);
  try {
    await cp(assetSnapshotDir(id), RENDERER_PUBLIC, { recursive: true, force: true });
  } catch { /* IRs with only graphics/shaders reference no files */ }
}

// Remove a project's snapshot IR + asset dir (called on project delete).
export async function deleteSnapshot(id) {
  await rm(irSnapshotPath(id), { force: true });
  await rm(assetSnapshotDir(id), { recursive: true, force: true });
}

export async function readIr(id) {
  return JSON.parse(await readFile(irSnapshotPath(id), 'utf8'));
}

// Validate + retime + persist a client-edited IR.
export async function writeIr(id, ir) {
  validateIr(ir);
  retime(ir);
  await writeFile(irSnapshotPath(id), JSON.stringify(ir, null, 2));
  return ir;
}
