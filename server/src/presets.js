import { randomUUID } from 'node:crypto';
import { admin } from './supabaseAdmin.js';
import { persistenceEnabled } from './config.js';
import { readIr } from './snapshot.js';

// Content presets (the "genre" dimension) — Educational / Animation / Images,
// plus user-created ones. Behaviour lives in the Python flow (presets.py); the
// server owns only the UI metadata for the built-ins and CRUD for custom
// presets. A custom preset is a full bundle (same shape as the Python built-ins)
// that rides the trigger payload as `preset_bundle` and is used verbatim.

// Built-in metadata for the composer picker. `id` must match Python PRESETS so
// the flow resolves behaviour from the id alone (no bundle needed).
export const BUILTIN_PRESETS = [
  { id: 'auto', label: 'Auto', description: 'Let the director choose everything from the prompt.', icon: '', builtin: true },
  { id: 'educational', label: 'Educational', description: 'Clear explainers driven by diagrams, charts and title cards.', icon: '', builtin: true },
  { id: 'animation', label: 'Animation', description: 'Playful animated illustrations and motion graphics — no stock footage.', icon: '', builtin: true },
  { id: 'footage', label: 'Footage', description: 'Real videos and photos only — no generated graphics.', icon: '', builtin: true },
  { id: 'images', label: 'Images', description: 'Cinematic still photography with Ken Burns motion.', icon: '', builtin: true },
];

const BUILTIN_IDS = new Set(BUILTIN_PRESETS.map((p) => p.id));

// In-memory store when persistence is off (mirrors store.js's `mem` pattern).
const mem = new Map(); // id -> { id, userId, label, bundle, createdAt }

const MEDIA_TYPES = ['photo', 'video', 'graphic', 'lottie'];

// Normalise an arbitrary client-supplied bundle into the canonical shape the
// flow expects. Unknown/garbage fields are dropped; missing ones stay null so
// the flow falls through to default behaviour.
export function normalizeBundle(input = {}, { id, label } = {}) {
  const mp = input.media_policy || {};
  const th = input.theme || {};
  const gd = input.guidance || {};
  const cleanList = (v, allowed) =>
    Array.isArray(v) && v.length
      ? v.map(String).filter((x) => !allowed || allowed.includes(x))
      : null;
  return {
    id: id || input.id || `custom-${randomUUID().slice(0, 8)}`,
    label: (label || input.label || 'My preset').slice(0, 60),
    description: (input.description || 'Custom preset.').slice(0, 200),
    media_policy: {
      force: cleanList(mp.force, MEDIA_TYPES),
      prefer: cleanList(mp.prefer, MEDIA_TYPES),
      block: cleanList(mp.block, null),
      ken_burns_all: Boolean(mp.ken_burns_all),
    },
    theme: {
      mood_pool: cleanList(th.mood_pool, null),
      font_pool: cleanList(th.font_pool, null),
    },
    voice_default: input.voice_default || '',
    music_default: input.music_default || '',
    guidance: {
      writer: (gd.writer || '').slice(0, 400),
      director: (gd.director || '').slice(0, 400),
      asset: (gd.asset || '').slice(0, 400),
      design: (gd.design || '').slice(0, 400),
    },
  };
}

// ---------------------------------------------------------------- read

// { builtins, custom } for the composer. Custom presets are the caller's own.
export async function listPresets(userId) {
  return { builtins: BUILTIN_PRESETS, custom: await listCustom(userId) };
}

async function listCustom(userId) {
  if (!persistenceEnabled) {
    return [...mem.values()].filter((p) => p.userId === userId).map(toView);
  }
  const { data, error } = await admin
    .from('presets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) { console.warn('[db] preset list failed:', error.message); return []; }
  return (data || []).map((r) => toView({ id: r.id, label: r.label, bundle: r.bundle, createdAt: r.created_at }));
}

function toView(p) {
  return { id: p.id, label: p.label, description: p.bundle?.description || '', builtin: false, bundle: p.bundle };
}

// The resolved bundle for a genre id: null for a built-in (the flow resolves it
// from the id) or an unknown id; the stored bundle for a custom preset.
export async function bundleFor(userId, genre) {
  if (!genre || BUILTIN_IDS.has(genre)) return null;
  if (!persistenceEnabled) {
    const p = mem.get(genre);
    return p && p.userId === userId ? p.bundle : null;
  }
  const { data, error } = await admin
    .from('presets').select('bundle').eq('user_id', userId).eq('id', genre).maybeSingle();
  if (error) { console.warn('[db] preset fetch failed:', error.message); return null; }
  return data?.bundle || null;
}

// ---------------------------------------------------------------- write

// Create a custom preset either from an explicit bundle (the composer form) or
// from an existing project's rendered look (`fromProjectId`, the editor's
// "save style as preset").
export async function createPreset(userId, { label, bundle, fromProjectId } = {}, resolveProject) {
  let raw = bundle;
  if (fromProjectId) {
    const project = resolveProject ? await resolveProject(fromProjectId) : null;
    if (!project) throw new Error('project not found');
    raw = await bundleFromProject(project);
  }
  const id = `custom-${randomUUID().slice(0, 8)}`;
  const norm = normalizeBundle(raw || {}, { id, label });
  const rec = { id, userId, label: norm.label, bundle: norm, createdAt: new Date().toISOString() };
  mem.set(id, rec);
  if (persistenceEnabled) {
    const { error } = await admin.from('presets').insert({
      id, user_id: userId, label: norm.label, bundle: norm,
    });
    if (error) console.warn('[db] preset insert failed:', error.message);
  }
  return toView(rec);
}

export async function deletePreset(userId, id) {
  const p = mem.get(id);
  if (p && p.userId === userId) mem.delete(id);
  if (persistenceEnabled) {
    const { error } = await admin.from('presets').delete().eq('user_id', userId).eq('id', id);
    if (error) { console.warn('[db] preset delete failed:', error.message); return false; }
  }
  return true;
}

// Derive a preset bundle from a finished project: copy its theme and infer the
// media policy from the actual layer-type mix of its rendered IR.
async function bundleFromProject(project) {
  const ir = await readIr(project.id).catch(() => null);
  const theme = ir?.metadata?.theme || {};
  const counts = { photo: 0, video: 0, graphic: 0, lottie: 0 };
  const scenes = ir?.scenes || ir?.timeline?.scenes || [];
  let total = 0;
  for (const scene of scenes) {
    for (const layer of scene.layers || []) {
      const t = layer.type === 'image' ? 'photo' : layer.type; // IR 'image' == asset 'photo'
      if (t in counts) { counts[t] += 1; total += 1; }
    }
  }
  const ranked = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const media_policy = { force: null, prefer: null, block: null, ken_burns_all: false };
  if (ranked.length) {
    const [top, topN] = ranked[0];
    if (topN / total >= 0.6) media_policy.force = [top];  // dominated → hard force
    else media_policy.prefer = [top];                     // mixed → soft prefer
    if (top === 'photo') media_policy.ken_burns_all = true;
  }
  return {
    label: deriveLabel(project),
    description: `Saved from “${project.title || project.prompt}”.`,
    media_policy,
    theme: {
      mood_pool: theme.mood ? [theme.mood] : null,
      font_pool: theme.font?.style ? [theme.font.style] : null,
    },
    voice_default: project.voice || '',
    music_default: project.music || '',
  };
}

function deriveLabel(project) {
  const base = (project.title || project.prompt || 'My style').trim();
  return `${base.split(/\s+/).slice(0, 4).join(' ')} style`.slice(0, 60);
}

export { BUILTIN_IDS };
