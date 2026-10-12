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

// Landing-page videos: one HyperFrames project per job (server/hyperframes/<id>/)
export const HYPERFRAMES_DIR = resolve(SERVER_DIR, 'hyperframes');
mkdirSync(HYPERFRAMES_DIR, { recursive: true });

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
  // Stock-footage providers for the editor's "Replace footage" search. Either
  // (or both) may be blank — each provider is skipped when its key is absent.
  pexelsKey: process.env.PEXELS_API_KEY || '',
  pixabayKey: process.env.PIXABAY_API_KEY || '',
  // NASA + Wikimedia are keyless. logo.dev needs a (free) publishable token;
  // the secret is optional and only enables brand-name → domain search.
  logoDevToken: process.env.LOGO_DEV_TOKEN || '',
  logoDevSecret: process.env.LOGO_DEV_SECRET || '',
  // Landing page → video: a headless Claude Code run of the repo's
  // landing-page-video skill, which drives HyperFrames end to end.
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  landingModel: process.env.LANDING_CLAUDE_MODEL || '',
  landingTimeoutMin: Number(process.env.LANDING_TIMEOUT_MIN || 60),
  // Public MVP guards: videos per signed-in user per 24h, and across everyone
  // per 24h (caps the Claude bill). 0 = unlimited.
  landingDailyLimit: Number(process.env.LANDING_DAILY_LIMIT || 0),
  landingGlobalDailyLimit: Number(process.env.LANDING_GLOBAL_DAILY_LIMIT || 0),
  // LANDING_ONLY=true → only the landing-page feature is live; the prompt
  // pipeline routes (need Ollama + GPU) answer 403.
  landingOnly: String(process.env.LANDING_ONLY).toLowerCase() === 'true',
  // Run the agent on Cloudflare Workers AI instead of Anthropic (see
  // workersAiAdapter.js). Both token + account id must be set to enable it.
  cfApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  cfAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  cfModel: process.env.CLOUDFLARE_MODEL || '@cf/moonshotai/kimi-k2.6',
  cfMaxTokens: Number(process.env.CLOUDFLARE_MAX_TOKENS || 16000),
  cfThinking: String(process.env.CLOUDFLARE_THINKING ?? 'true').toLowerCase() !== 'false',
};

// Built webapp (webapp/dist) — served by the API when present, so a single
// deployment hosts both.
export const WEBAPP_DIST = resolve(REPO_ROOT, 'webapp', 'dist');

export const authEnabled = Boolean(config.supabaseUrl && config.supabaseKey);
// Persistence + Storage require the service_role key. Without it the API still
// runs, using an in-memory store + local-disk delivery (no cross-restart history).
export const persistenceEnabled = Boolean(config.supabaseUrl && config.serviceRoleKey);
