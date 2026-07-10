import 'dotenv/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url)); // server/src
export const SERVER_DIR = resolve(here, '..');        // server/
export const REPO_ROOT = resolve(SERVER_DIR, '..');   // repo root

// Pipeline locations
export const GUIDE_DIR = resolve(REPO_ROOT, 'guide_creator_flow');
export const RENDERER_DIR = resolve(REPO_ROOT, 'renderer');
export const FINAL_VIDEO = resolve(RENDERER_DIR, 'out', 'final.mp4');
export const FALLBACK_VIDEO = resolve(RENDERER_DIR, 'out', 'video.mp4');

// Per-job output artifacts (one mp4 each, so a new job never clobbers an old result)
export const ARTIFACTS_DIR = resolve(SERVER_DIR, 'artifacts');
mkdirSync(ARTIFACTS_DIR, { recursive: true });

// User-uploaded footage
export const UPLOADS_DIR = resolve(SERVER_DIR, 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

export const config = {
  port: Number(process.env.PORT || 8787),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey:
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  // Server-only secret — persists projects to the DB and uploads to Storage.
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  storageBucket: process.env.SUPABASE_BUCKET || 'videos',
  signedUrlTtl: Number(process.env.SIGNED_URL_TTL || 3600), // seconds
  allowAnon: String(process.env.ALLOW_ANON).toLowerCase() === 'true',
  pipelineMode: (process.env.PIPELINE_MODE || 'mock').toLowerCase(),
  // AI edits (editor chat) — same local Ollama the CrewAI flow uses.
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud',
  mockEdits: String(process.env.MOCK_EDITS).toLowerCase() === 'true',
};

export const authEnabled = Boolean(config.supabaseUrl && config.supabaseKey);
// Persistence + Storage require the service_role key. Without it the API still
// runs, using an in-memory store + local-disk delivery (no cross-restart history).
export const persistenceEnabled = Boolean(config.supabaseUrl && config.serviceRoleKey);
