# Squook — Prompt-to-Video Pipeline

Turn a text prompt into a finished, mastered video. A CrewAI agent flow writes the
script and plans the assets, Remotion renders the video, an Express API orchestrates
everything and persists projects to Supabase, and a React webapp is the front door
(auth, prompt UI, project history, and a live in-browser video editor).

```
prompt ─▶ guide_creator_flow (CrewAI: Researcher → Writer → Director) ─▶ render_ir.json + assets
       ─▶ renderer (Remotion)                                          ─▶ out/video.mp4
       ─▶ audio mastering (uv run master)                              ─▶ out/final.mp4
       ─▶ server (Express + Supabase)                                  ─▶ per-user project + signed URL
       ─▶ webapp (React + Vite + @remotion/player)                     ─▶ playback + IR editor
```

## Repository layout

| Directory | What it is | Runs as |
|---|---|---|
| [`guide_creator_flow/`](guide_creator_flow/) | CrewAI Flow (Python, managed with `uv`) that researches, writes the script, generates TTS narration (Kokoro-82M, local + Apache-2.0), fetches stock media (Pexels/Pixabay/NASA/Wikimedia Commons/logo.dev, LLM-ranked for relevance — all commercial-use; CC BY sources get an automatic on-screen credit), synthesizes owned music + SFX (whoosh/impact/riser/pop; music ducks −8 dB under narration), and emits `render_ir.json`. Also contains the −14 LUFS audio-mastering tool. Note: MusicGen is gated behind `MUSICGEN_OPTIN=true` — Meta's CC-BY-NC weights are not commercial-safe. | On-demand CLI (`uv run kickoff` / invoked by the server) |
| [`renderer/`](renderer/) | Remotion project that renders the IR into an MP4. | On-demand CLI (`npm run render`) or Remotion Studio |
| [`server/`](server/) | Express API that queues renders, runs the full pipeline, and persists projects to Supabase (details in [server/README.md](server/README.md)). | Long-running service on **http://localhost:8787** |
| [`webapp/`](webapp/) | React + Vite frontend: Supabase auth, prompt → video UI, project history, and a live IR editor built on `@remotion/player`. | Long-running dev server on **http://localhost:5173** |
| [`ui/`](ui/) | Static design comps (landing, onboarding, pricing, wireframes). Not a service. | — |

## Prerequisites

- **Node.js** 18+ and npm
- **[uv](https://docs.astral.sh/uv/)** (Python package manager) — Python 3.10–3.13 is resolved automatically from `guide_creator_flow/pyproject.toml`
- **[Ollama](https://ollama.com)** running locally with the `gpt-oss:120b-cloud` model — used by the CrewAI flow and the AI-edit endpoint (only needed for **real** renders / AI edits; see `PIPELINE_MODE` below)
- A **Supabase** project (free tier is fine) for auth, project history, and video storage

## One-time setup

**1. Install every component at once** (root command):

```bash
npm install        # installs the root runner (concurrently)
npm run setup      # npm install in server/, webapp/, renderer/ + uv sync in guide_creator_flow/
```

**2. Configure environment files:**

```bash
# API — copy and edit (Supabase keys, PIPELINE_MODE, service_role key for persistence)
cp server/.env.example server/.env

# Webapp — copy and fill in your Supabase URL + anon key
cp webapp/.env.example webapp/.env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL

# Flow — API keys for asset fetching (only needed for real renders)
# guide_creator_flow/.env : PEXELS_API_KEY, PIXABAY_API_KEY (optional), REPLICATE_API_TOKEN (optional)
```

Key settings in `server/.env`:

- `PIPELINE_MODE=mock` — simulates the pipeline and replays the last real render. No Ollama/GPU needed; ideal for developing the UI/API. `real` runs the full flow (minutes per render).
- `SUPABASE_SERVICE_ROLE_KEY` — enables durable per-user projects + Storage. Leave blank for in-memory fallback mode. To enable, run [`server/db/schema.sql`](server/db/schema.sql) in the Supabase SQL Editor first.
- `ALLOW_ANON=true` — allows tokenless requests for quick local testing.

## Run everything — the root command

```bash
npm run dev
```

This starts, in one terminal (color-coded, Ctrl-C stops both):

- **`api`** — Express server with auto-reload at http://localhost:8787
- **`web`** — Vite dev server at **http://localhost:5173** ← open this

The CrewAI flow and the Remotion render are **not** separate servers — the API spawns
them on demand for each render, so `npm run dev` really is the whole system.
Renders are processed one at a time (FIFO queue) because the pipeline writes shared files.

`npm start` is the same but runs the API without file-watching.

## Other root commands

| Command | What it does |
|---|---|
| `npm run setup` | Install all Node deps + sync the Python env |
| `npm run dev` | **Run everything** (API + webapp, concurrently) |
| `npm run start` | Same, API without auto-reload |
| `npm run studio` | Open Remotion Studio to inspect/debug compositions |
| `npm run render` | Manually render `renderer/public/render_ir.json` → `renderer/out/final.mp4` (render + master) |
| `npm run flow` | Run the CrewAI flow by itself (`uv run kickoff`) |

## Running components individually

Each component also works standalone:

```bash
# API only
cd server && npm run dev            # http://localhost:8787

# Webapp only (expects the API at VITE_API_URL)
cd webapp && npm run dev            # http://localhost:5173

# CrewAI flow only (writes render_ir.json + assets into renderer/public/)
cd guide_creator_flow && uv run kickoff

# Remotion: studio / manual render
cd renderer && npm run dev          # Remotion Studio
cd renderer && npm run render       # render + audio master
```

## Verifying it works

1. `npm run dev`
2. Check the API: `curl http://localhost:8787/api/health` → reports mode + persistence flags
3. Open http://localhost:5173, sign in (or set `ALLOW_ANON=true`), enter a prompt, and pick a format (`9:16` reel or landscape)
4. In `mock` mode you get a stand-in video instantly; in `real` mode the Researcher → Writer → Director → render → master stages stream progress until `final.mp4` is ready
5. Open a finished project in the **editor** to tweak the IR live (or use AI edits), then Save / Re-render

## Troubleshooting

- **`uv: command not found`** — install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `pip install uv`)
- **Real renders hang at the flow stage** — make sure Ollama is running (`ollama serve`) and the model is available: `ollama pull gpt-oss:120b-cloud`. Base URL/model are configurable via `OLLAMA_BASE_URL` / `OLLAMA_MODEL` in `server/.env`.
- **First real render is slow at the narration stage** — Kokoro downloads its model weights (~330 MB) from Hugging Face on first use; subsequent runs are fast and fully offline. If synthesis fails on out-of-dictionary words, install espeak-ng (`sudo apt install espeak-ng`).
- **No project history across restarts** — you're in fallback mode; set `SUPABASE_SERVICE_ROLE_KEY` and run `server/db/schema.sql` (see [server/README.md](server/README.md)).
- **CORS errors in the browser** — `CORS_ORIGIN` in `server/.env` must include the webapp origin (default `http://localhost:5173`).
- **Remotion version mismatch** — `remotion`, `@remotion/player`, `@remotion/cli`, and `@remotion/lottie` are pinned to **4.0.484** across `renderer/` and `webapp/`; keep them in lockstep when upgrading.
