"""AI background-music source: generate a bespoke instrumental track with
Meta's MusicGen, served free on the Hugging Face Inference API
(facebook/musicgen-small). This is the no-attribution path — the generated
audio is an original work you own outright, so nothing needs crediting.

It slots in where a fetched track used to: the Director already writes a
search-friendly music description (mood + instrumentation), which is exactly a
text-to-music prompt. Callers fall back to the synthesised bed when the token
is missing or generation fails.

The free serverless endpoint "cold starts" — the first call after idle returns
503 "model is loading"; we retry until it's warm. Output arrives as FLAC/WAV
bytes, which we transcode to mp3 with Remotion's bundled ffmpeg (same as
mastering) so both the CLI render and the browser preview decode it cleanly.

Env: HF_TOKEN (free, no card, at https://huggingface.co/settings/tokens).
"""
import os
import subprocess
import time
from pathlib import Path

import requests

HF_MODEL = "facebook/musicgen-small"
# HF retired api-inference.huggingface.co; the free serverless inference now
# routes through router.huggingface.co/hf-inference.
API_URL = f"https://router.huggingface.co/hf-inference/models/{HF_MODEL}"
TIMEOUT = 120
# musicgen-small returns a fixed short clip (~8s); Remotion loops the bed under
# the whole video, so that's fine. Kept for signature compatibility.
MAX_DURATION_S = 30
# Remotion ships ffmpeg; reuse it for transcode (no system ffmpeg installed).
RENDERER = Path(__file__).resolve().parents[4] / "renderer"
# Cold-start / rate-limit handling.
LOAD_RETRIES = 5
RETRY_WAIT_S = 20


class HFTokenMissing(Exception):
    pass


def _token() -> str:
    tok = (
        os.getenv("HF_TOKEN")
        or os.getenv("HUGGINGFACE_API_KEY")
        or os.getenv("HUGGINGFACEHUB_API_TOKEN")
        or ""
    ).strip()
    if not tok or tok == "YOUR_TOKEN":
        raise HFTokenMissing(
            "HF_TOKEN is not set. Get a free token (no card) at "
            "https://huggingface.co/settings/tokens to generate AI music."
        )
    return tok


def _to_mp3(src: Path, dest: Path) -> None:
    """Transcode any audio file to mp3 via Remotion's bundled ffmpeg."""
    subprocess.run(
        ["npx", "remotion", "ffmpeg", "-loglevel", "error", "-i", str(src), "-y", str(dest)],
        cwd=RENDERER,
        check=True,
    )


def generate(
    prompt: str,
    dest_path: Path,
    duration_s: int = MAX_DURATION_S,
    model_version: str | None = None,
) -> None:
    """Generate an instrumental track from `prompt` and write it to dest_path
    as mp3. Raises HFTokenMissing if no token, or RuntimeError on any
    generation/transcode failure so the caller can fall back to the synth bed."""
    token = _token()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    headers = {"Authorization": f"Bearer {token}", "Accept": "audio/flac"}
    payload = {
        "inputs": (prompt or "calm ambient instrumental background music").strip(),
        # Ask HF to wait for a cold model rather than 503 immediately, when supported.
        "options": {"wait_for_model": True},
    }

    last_err = None
    for attempt in range(1, LOAD_RETRIES + 1):
        resp = requests.post(API_URL, headers=headers, json=payload, timeout=TIMEOUT)
        ctype = resp.headers.get("content-type", "")
        if resp.status_code == 200 and ctype.startswith("audio"):
            raw = dest_path.with_suffix(".hfraw")
            raw.write_bytes(resp.content)
            try:
                _to_mp3(raw, dest_path)
            finally:
                raw.unlink(missing_ok=True)
            return

        # Cold start (model loading) or rate limited → wait and retry.
        if resp.status_code in (503, 429):
            info = {}
            try:
                info = resp.json()
            except ValueError:
                pass
            last_err = (info.get("error") if isinstance(info, dict) else None) or f"HTTP {resp.status_code}"
            wait = RETRY_WAIT_S
            if isinstance(info, dict) and info.get("estimated_time"):
                wait = int(float(info["estimated_time"])) + 2
            print(f"  MusicGen warming up ({last_err}); retry {attempt}/{LOAD_RETRIES} in {min(wait,60)}s")
            time.sleep(min(max(wait, 5), 60))
            continue

        # Anything else is a hard error — surface HF's own message.
        try:
            detail = (resp.json() or {}).get("error") or resp.text
        except ValueError:
            detail = resp.text
        raise RuntimeError(f"HF {resp.status_code}: {detail}")

    raise RuntimeError(f"MusicGen not ready after {LOAD_RETRIES} retries ({last_err})")
