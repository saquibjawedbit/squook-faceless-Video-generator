// Fast mode's music: a library of Creative Commons tracks (built once by
// scripts/build_music_library.py, hosted at MUSIC_BASE_URL) with a beat map per
// track — tempo, beats, downbeats, 4-bar phrases, energy curve, peak. Used to
// pick a track that fits the video, start it so its peak lands on the finale,
// and snap scene cuts to the beat. Falls back to the built-in beds in
// server/media when the library isn't reachable.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = (process.env.MUSIC_BASE_URL || '').replace(/\/$/, '');
const CACHE = join(tmpdir(), 'squook-music');
export const MUSIC_MOODS = ['uplifting', 'corporate', 'tech', 'energetic', 'cinematic', 'calm', 'chill', 'playful'];

let libraryPromise;
export function loadLibrary() {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      if (!BASE) return [];
      try {
        const r = await fetch(`${BASE}/library.json`, { signal: AbortSignal.timeout(10_000) });
        return r.ok ? await r.json() : [];
      } catch { return []; }
    })().then((lib) => { if (!lib.length) libraryPromise = undefined; return lib; }); // retry later if it failed
  }
  return libraryPromise;
}

/** Local path of a track's MP3 (downloaded once per container). */
export async function trackFile(track) {
  await mkdir(CACHE, { recursive: true });
  const p = join(CACHE, track.file);
  try { await access(p); return p; } catch { /* download */ }
  const r = await fetch(`${BASE}/${track.file}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`music download ${r.status}`);
  await writeFile(p, Buffer.from(await r.arrayBuffer()));
  return p;
}

// Neighbouring moods, for when the asked-for mood has no tracks.
const NEAR = {
  uplifting: ['corporate', 'playful'], corporate: ['uplifting', 'calm'], tech: ['energetic', 'chill'],
  energetic: ['tech', 'uplifting'], cinematic: ['calm', 'uplifting'], calm: ['chill', 'cinematic'],
  chill: ['calm', 'tech'], playful: ['uplifting', 'chill'],
};

/** A library track by id (for re-assembling an edited video). */
export async function getTrack(id) {
  return (await loadLibrary()).find((t) => t.id === id) || null;
}

/** Pick a track for a mood: random among the matches, never the one used last. */
let lastId = null;
export async function pickTrack(mood, rng, minSeconds = 0) {
  const lib = await loadLibrary();
  if (!lib.length) return null;
  for (const m of [mood, ...(NEAR[mood] || []), ...MUSIC_MOODS]) {
    let pool = lib.filter((t) => t.mood === m && t.id !== lastId);
    const long = pool.filter((t) => t.duration >= minSeconds);
    if (long.length) pool = long;
    if (pool.length) {
      const t = pool[Math.floor(rng() * pool.length)];
      lastId = t.id;
      return t;
    }
  }
  return null;
}

/**
 * Where to start the track so its energy peak lands on the finale (the CTA),
 * on a phrase boundary, without running out of music. 0 if nothing fits.
 */
export function musicStart(track, videoLen, finaleAt) {
  const phrases = [0, ...(track.phrases || [])];
  let best = 0, bestErr = Infinity;
  for (const p of phrases) {
    if (p + videoLen > track.duration - 1) break; // would run off the end
    const err = Math.abs(p + finaleAt - track.peak);
    if (err < bestErr) { bestErr = err; best = p; }
  }
  return +best.toFixed(3);
}

/** Beat grid on the video timeline (track time minus the start offset). */
export function videoBeats(track, start) {
  const shift = (a) => (a || []).map((b) => b - start).filter((b) => b > 0.2);
  return { beats: shift(track.beats), downbeats: shift(track.downbeats), rhythmic: Boolean(track.rhythmic) };
}

/** The next beat at/after t within `max` seconds (downbeats first on rhythmic tracks). */
export function nextBeat(grid, t, max = 0.9) {
  const after = (arr, lim) => arr.find((b) => b >= t - 0.02 && b - t <= lim);
  if (grid.rhythmic) {
    const d = after(grid.downbeats, max);
    if (d !== undefined) return d;
  }
  return after(grid.beats, Math.min(max, 0.6));
}

/** Nearest beat to t within ±tol, else t. */
export function nearestBeat(grid, t, tol = 0.25) {
  let best = t, bestD = tol;
  for (const b of grid.beats) {
    const d = Math.abs(b - t);
    if (d < bestD) { bestD = d; best = b; }
    if (b > t + tol) break;
  }
  return +best.toFixed(3);
}

export async function libraryReady() { return (await loadLibrary()).length > 0; }
