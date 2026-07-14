# Daily video automation

Once a day, a GitHub Actions workflow (`.github/workflows/daily-video.yml`)
picks the next topic from `topics.json`, runs the full generation pipeline
(CrewAI flow -> Remotion render -> mastering), and uploads the result to
YouTube. Everything runs on free tiers.

## How it works

1. `daily.py` reads `state.json` (`next_index`) and picks that entry from
   `topics.json`, wrapping around at the end of the list.
2. It runs the same three stages the server's job queue runs:
   `uv run run_with_trigger <payload>` -> `npx remotion render Explainer` at
   full scale -> `uv run master`.
3. On successful generation it advances `state.json` (the workflow commits it
   back with `[skip ci]`), then uploads `renderer/out/final.mp4` to YouTube.
4. The MP4 is also attached to the run as a workflow artifact for 7 days, so
   you can review what was published.

The LLM in CI is Groq's free tier via the pipeline's `LLM_PROVIDER=openai-compat`
mode — it serves the same `gpt-oss-120b` / `gpt-oss-20b` models the pipeline
uses locally through Ollama. TTS stays local Kokoro (weights are cached
between runs), music is the built-in synth bed.

## One-time setup

### 1. LLM endpoint

The workflow talks to any OpenAI-compatible endpoint. Set the `LLM_API_KEY`
repo secret (Settings -> Secrets and variables -> Actions) to the key for it.

- Default (no variables set): Groq free tier (console.groq.com) serving
  `openai/gpt-oss-120b` / `openai/gpt-oss-20b`.
- Cloudflare Workers AI instead: set repo VARIABLES
  `LLM_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1`,
  `LLM_MODEL=@cf/openai/gpt-oss-120b`, `LLM_FAST_MODEL=@cf/openai/gpt-oss-20b`,
  and make `LLM_API_KEY` your Cloudflare API token.

### 2. YouTube upload credentials

1. In Google Cloud Console, create a project and enable **YouTube Data API v3**.
2. OAuth consent screen: type External; add your own Google account as a
   test user. (You do not need to publish/verify the app for personal use,
   but see the caveat below.)
3. Credentials -> Create OAuth client ID -> type **Desktop app**. Note the
   client ID and secret.
4. Locally, mint a refresh token (opens a browser):

       pip install google-auth-oauthlib
       python3 automation/get_youtube_token.py <client_id> <client_secret>

5. Save three repo secrets: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`,
   `YT_REFRESH_TOKEN`.

### 3. Optional secrets

- `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `LOGO_DEV_TOKEN` — stock footage and
  logos; without them the pipeline leans on generated graphics.
- `OPENAI_API_KEY` — switches TTS to OpenAI and design steps to GPT (paid).
- `ANTHROPIC_API_KEY` — routes design steps to Claude (paid).
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` — Workers AI for design
  steps (has a free daily allocation).

Leave any of these unset and the pipeline falls back gracefully.

## Editing the topic queue

Add entries to `topics.json`. Only `prompt` is required:

```json
{
  "prompt": "How does GPS know exactly where you are?",
  "duration": 60,
  "preset": "",
  "voice": "",
  "youtube": {
    "title": "Custom YouTube title (defaults to the prompt)",
    "description": "Custom description",
    "tags": ["a", "b"],
    "categoryId": "27"
  }
}
```

`prompt`, `preset`, `genre`, `music`, `voice`, `duration` are passed straight
into the pipeline's trigger payload. The list wraps around, so 7 topics give
you a weekly cycle; add more whenever.

## Manual runs and dry runs

- GitHub: Actions -> daily-video -> Run workflow. You can type a one-off
  prompt (skips rotation) and untick upload.
- Locally:

      python3 automation/daily.py --no-upload
      VIDEO_SCALE=0.5 python3 automation/daily.py --no-upload   # faster test

## Caveats

- **Free minutes**: unlimited on public repos; private repos get 2,000
  min/month and a run takes roughly 30-60 min, so a private repo supports
  roughly one run a day with little headroom.
- **Unverified OAuth app**: YouTube may lock videos uploaded through an
  unverified API project to private. If that happens, either keep
  `YT_PRIVACY: public` and complete Google's app verification, or accept
  private uploads and publish manually.
- **Schedule pausing**: GitHub disables cron workflows after 60 days without
  repo activity — the daily state-bump commit keeps it alive as a side
  effect, but only if runs succeed.
- **Groq free-tier limits**: per-minute token caps can slow or fail a run on
  heavy days; the workflow simply fails and tries again tomorrow (the topic
  is not consumed unless generation succeeded).
