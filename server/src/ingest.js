// Bring a replacement clip into a project's editable snapshot. A stock result,
// a pasted direct URL, or an uploaded file all resolve to a local relative
// `src` under artifacts/<id>-assets/assets/, which is exactly where the
// snapshot keeps generated footage — so the IR validator accepts it, the
// preview streams it, and a re-render restores it into renderer/public.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assetSnapshotDir } from './snapshot.js';

const MAX_BYTES = 200 * 1024 * 1024; // mirror the multer upload cap
const EXT_OK = new Set(['.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const EXT_FROM_MIME = {
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/svg+xml': '.svg', // fetched vector icons (Iconify)
};

const badReq = (msg) => { const e = new Error(msg); e.status = 400; return e; };

// The IR `src` regex forbids most punctuation, so keep names to [\w.].
const safeName = (ext) => `rep_${randomBytes(6).toString('hex')}${ext}`;

// Basic SSRF guard: only public http(s) hosts. This route fetches an
// attacker-influenced URL server-side, so refuse loopback / link-local / RFC1918.
function assertPublicUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { throw badReq('invalid url'); }
  if (!/^https?:$/.test(url.protocol)) throw badReq('only http(s) urls are allowed');
  const h = url.hostname.toLowerCase();
  if (
    h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local')
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /^\[?::1\]?$/.test(h) || /^fe80:/i.test(h) || /^fc00:/i.test(h)
  ) throw badReq('url host is not allowed');
  return url;
}

// Resolve the extension from mime first, then the URL/name suffix.
function resolveExt(mime, nameOrPath) {
  const fromMime = EXT_FROM_MIME[(mime || '').split(';')[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  const fromName = extname(nameOrPath || '').toLowerCase();
  return EXT_OK.has(fromName) ? fromName : '';
}

async function assetDir(id) {
  const dir = join(assetSnapshotDir(id), 'assets');
  await mkdir(dir, { recursive: true });
  return dir;
}

// The IR src convention: generated footage lives at "output/assets/…", which
// the snapshot stores under <id>-assets/assets/… (output/ stripped).
const relSrc = (name) => `output/assets/${name}`;

// Download a remote video/image into the project. Streams to disk with a hard
// size cap so a huge/hostile response can't fill the volume.
export async function ingestUrl(id, rawUrl) {
  const url = assertPublicUrl(rawUrl);
  let r;
  try { r = await fetch(url, { redirect: 'follow' }); }
  catch (e) { throw badReq(`could not fetch url: ${e.message}`); }
  if (!r.ok || !r.body) throw badReq(`fetch failed (${r.status})`);

  const ct = r.headers.get('content-type') || '';
  const ext = resolveExt(ct, url.pathname);
  if (!ext) throw badReq('url is not a supported video/image file');

  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw badReq('file too large (200MB max)');

  const name = safeName(ext);
  const dest = join(await assetDir(id), name);
  const node = Readable.fromWeb(r.body);
  let bytes = 0;
  node.on('data', (c) => {
    bytes += c.length;
    if (bytes > MAX_BYTES) node.destroy(badReq('file too large (200MB max)'));
  });
  try {
    await pipeline(node, createWriteStream(dest));
  } catch (e) {
    await unlink(dest).catch(() => {});
    throw e.status ? e : badReq(`download failed: ${e.message}`);
  }
  return { src: relSrc(name), provider: 'url' };
}

// Move an already-uploaded (multer) temp file into the project asset dir.
export async function ingestUpload(id, file) {
  const ext = resolveExt(file.mimetype, file.originalname);
  if (!ext) { await unlink(file.path).catch(() => {}); throw badReq('unsupported media type'); }
  const name = safeName(ext);
  const dest = join(await assetDir(id), name);
  try {
    await rename(file.path, dest);
  } catch {
    // rename fails across devices (temp dir on a different mount) → copy + drop.
    await pipeline(createReadStream(file.path), createWriteStream(dest));
    await unlink(file.path).catch(() => {});
  }
  return { src: relSrc(name), provider: 'upload' };
}
