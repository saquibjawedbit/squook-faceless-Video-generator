# Squook API (`server/`)

Node/Express API that turns a **prompt into a video** by orchestrating the pipeline,
then persists each render as a per-user **project** with history + isolated delivery.

```
prompt ─▶ CrewAI flow (guide_creator_flow)  ─▶ render_ir.json + assets
       ─▶ Remotion render (renderer)          ─▶ out/video.mp4
       ─▶ audio master (uv run master)         ─▶ out/final.mp4
       ─▶ project row (Supabase) + upload to Storage (videos/<user>/<id>.mp4)
       ─▶ served to the owner via a short-lived signed URL
```

Renders run **one at a time** (single-worker FIFO queue) because the pipeline writes
shared files (`renderer/public`, `renderer/out`).

## Run

```bash
cd server
cp .env.example .env
npm install
npm start                 # http://localhost:8787
```

`PIPELINE_MODE`:
- `mock` — simulates the three stages and returns the last real render. **Same video
  every time** (a stand-in) — good for exercising the API/UI/persistence instantly.
- `real` — runs `uv run run_with_trigger` → `npx remotion render` → `uv run master`,
  so every prompt is a **unique** video. Needs Ollama and a Pexels key (TTS runs
  locally via Kokoro); minutes per render.

## Persistence & Storage (user isolation + history)

Without a `service_role` key the API runs in **fallback mode**: in-memory projects +
local-disk delivery (no history across restarts). To turn on durable, per-user projects:

1. **Create the table** — open Supabase → SQL Editor → run [`db/schema.sql`](db/schema.sql)
   (creates `public.projects` + owner-only RLS).
2. **Add the service_role key** — Supabase → Project Settings → API → copy the
   `service_role` key into `server/.env` as `SUPABASE_SERVICE_ROLE_KEY=…` (server-only secret).
3. Restart. The server auto-creates the private `videos` bucket on boot.

Isolation model: RLS on `projects` (owner-only) → Storage path prefix `videos/<user_id>/`
→ short-lived **signed URLs** for playback. The browser never touches Storage directly;
the trusted server (service_role) writes rows/objects and mints signed URLs. Saving a
project requires a **signed-in** user (isolation needs a real `auth.uid()`).

## Auth

Bearer token verified via `auth.getUser(token)` (publishable key). `ALLOW_ANON=true`
permits tokenless requests in local/fallback dev.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET    | `/api/health` | mode, auth/persistence flags, stages |
| POST   | `/api/projects` | `{ prompt, format }` (+ multipart `files`) → creates a project + starts generation |
| GET    | `/api/projects` | the caller's projects, newest first (history) |
| GET    | `/api/projects/:id` | poll status `{ title, status, stage, progress, videoReady, … }` |
| GET    | `/api/projects/:id/url` | `{ url }` — signed Storage URL (or local stream in fallback) |
| GET    | `/api/projects/:id/thumb` | poster image (redirects to signed URL) |
| DELETE | `/api/projects/:id` | remove the project row + Storage objects |

`format` → flow preset: `9:16` → `reel` (1080×1920), else `landscape` (1920×1080).
Titles come from the AI director's `render_ir.metadata.title`, falling back to a
prompt-derived name; files are keyed by the immutable project UUID.

## Editor (per-project IR + AI edits)

Every finished render is **snapshotted**: `render_ir.json` + every referenced
asset are copied to `artifacts/<id>.ir.json` + `artifacts/<id>-assets/`, so a
project stays editable after later generations overwrite `renderer/public/`.
The webapp's editor previews the IR live with `@remotion/player` (importing the
same composition the CLI renders) and edits it as a document.

| Method | Path | Description |
|---|---|---|
| GET    | `/api/projects/:id/ir` | the project's editable IR (404 → pre-editor project) |
| PUT    | `/api/projects/:id/ir` | save an edited IR (validated + retimed server-side) |
| GET    | `/api/projects/:id/assets/*` | stream snapshot media for the live preview (Range) |
| POST   | `/api/projects/:id/render` | re-render from the saved IR — restores the snapshot into `renderer/public`, runs **render + master only** (no AI flow), bumps the draft counter |
| POST   | `/api/projects/:id/edit` | AI edit: `{ instruction, ir, selection? }` → `{ ir, summary }` (stateless — nothing persists until Save/Re-render) |

AI edits call Ollama directly (`OLLAMA_BASE_URL`, `OLLAMA_MODEL` — same model
as the CrewAI flow). A **selected element** is edited by echoing that one layer;
**global** instructions return a small validated ops list (never a full-IR echo).
Everything the model returns is whitelisted + clamped; `MOCK_EDITS=true` applies
a deterministic edit instead, so the UI loop is testable without Ollama.
