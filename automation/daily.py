#!/usr/bin/env python3
"""Daily video automation: pick the next topic, run the generation pipeline,
render + master, upload to YouTube.

Designed for GitHub Actions (.github/workflows/daily-video.yml) but runs
anywhere the repo's normal toolchain (uv, node) is installed:

    python3 automation/daily.py                 # full run: generate + upload
    python3 automation/daily.py --no-upload     # generate only (dry run)
    python3 automation/daily.py --prompt "..."  # one-off topic, no rotation

Topic rotation: automation/state.json holds the index of the next entry in
automation/topics.json (wraps around). The index advances after a successful
generation, BEFORE the upload — so a broken YouTube config doesn't burn a
fresh generation of the same topic every day. The workflow commits the bumped
state back to the repo.

Upload needs YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN in the
environment (see automation/get_youtube_token.py) and the
google-api-python-client package.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "guide_creator_flow"
RENDERER = ROOT / "renderer"
TOPICS = Path(__file__).with_name("topics.json")
STATE = Path(__file__).with_name("state.json")
HISTORY = Path(__file__).with_name("history.json")
FINAL = RENDERER / "out" / "final.mp4"

IDEA_SYSTEM_PROMPT = """\
You are a YouTube Shorts strategist for a faceless channel of 45-60 second
vertical explainers built entirely from real stock footage and photographs
(no presenter, no animation). Invent ONE new video topic with maximum viral
potential.

What performs: a curiosity gap the viewer must close ("why X does Y"),
mass-appeal subjects (space, the human body, animals, money, food, machines,
weather, history's oddities), a hook stateable in one breath, and visuals
that plainly exist as stock footage. Avoid: niche jargon, current-events or
dated references, anything needing charts or diagrams to explain, and
anything on the used-topics list or too similar to it.

Respond with ONLY a JSON object, no other text, no emojis anywhere:
{
  "prompt": "instruction for the video team: the topic, the surprising angle,
             and the hook to open with in the first sentence",
  "title": "click-worthy YouTube title, under 90 characters, no clickbait lies",
  "description": "1-2 sentence YouTube description",
  "tags": ["3-6", "search", "tags"]
}"""

# Payload keys run_with_trigger understands (see ContentFlow.plan_content).
PAYLOAD_KEYS = ("prompt", "preset", "genre", "music", "voice", "duration")


def sh(cmd: list[str], cwd: Path) -> None:
    print(f"+ {' '.join(cmd)}  (cwd={cwd})", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def ai_topic() -> dict:
    """Ask the pipeline's LLM for one fresh viral-Shorts topic, steering it
    away from everything in history.json. Uses the same OpenAI-compatible
    endpoint env the workflow already provides (LLM_BASE_URL/LLM_API_KEY/
    LLM_MODEL). Raises on any failure; the caller falls back to the list."""
    import urllib.request

    base = os.environ["LLM_BASE_URL"].rstrip("/")
    used = json.loads(HISTORY.read_text()) if HISTORY.exists() else []
    used_titles = [u["title"] for u in used[-60:]]
    req = urllib.request.Request(
        f"{base}/chat/completions",
        headers={
            "Authorization": f"Bearer {os.environ['LLM_API_KEY']}",
            "Content-Type": "application/json",
        },
        data=json.dumps({
            "model": os.environ.get("LLM_MODEL", "openai/gpt-oss-120b"),
            "temperature": 1.0,
            "max_tokens": 2048,
            "messages": [
                {"role": "system", "content": IDEA_SYSTEM_PROMPT},
                {"role": "user", "content": "Already-used topics (do not repeat or closely resemble):\n"
                    + ("\n".join(f"- {t}" for t in used_titles) or "- (none yet)")},
            ],
        }).encode(),
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        content = json.load(resp)["choices"][0]["message"]["content"] or ""
    # Tolerate prose around the JSON object.
    idea = json.loads(content[content.index("{"):content.rindex("}") + 1])
    if not idea.get("prompt") or not idea.get("title"):
        raise ValueError(f"LLM idea missing prompt/title: {idea}")
    return {
        "prompt": idea["prompt"],
        "duration": 60,
        "preset": "reel",
        "genre": "footage",
        "youtube": {
            "title": idea["title"],
            "description": idea.get("description", ""),
            "tags": idea.get("tags", []),
        },
    }


def record_history(topic: dict) -> None:
    used = json.loads(HISTORY.read_text()) if HISTORY.exists() else []
    used.append({"title": topic["youtube"]["title"], "prompt": topic["prompt"]})
    HISTORY.write_text(json.dumps(used, indent=2) + "\n")


def pick_topic() -> tuple[dict, int, int]:
    topics = json.loads(TOPICS.read_text())["topics"]
    if not topics:
        sys.exit("automation/topics.json has no topics")
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    idx = state.get("next_index", 0) % len(topics)
    return topics[idx], idx, len(topics)


def bump_state(idx: int) -> None:
    STATE.write_text(json.dumps({"next_index": idx + 1}, indent=2) + "\n")


def generate(topic: dict) -> None:
    payload = {k: topic[k] for k in PAYLOAD_KEYS if topic.get(k)}
    sh(["uv", "run", "run_with_trigger", json.dumps(payload)], GUIDE)
    # Full-scale render for publishing; set VIDEO_SCALE=0.5 for cheap tests.
    scale = os.getenv("VIDEO_SCALE", "").strip()
    scale_args = ["--scale", scale] if scale else []
    sh(["npx", "remotion", "render", "Explainer", "out/video.mp4", *scale_args], RENDERER)
    sh(["uv", "run", "master"], GUIDE)
    if not FINAL.exists() or FINAL.stat().st_size < 100_000:
        sys.exit(f"mastered video missing or suspiciously small: {FINAL}")
    print(f"Generated {FINAL} ({FINAL.stat().st_size // 1024} KB)", flush=True)


def upload(topic: dict) -> None:
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    creds = Credentials(
        None,
        refresh_token=os.environ["YT_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["YT_CLIENT_ID"],
        client_secret=os.environ["YT_CLIENT_SECRET"],
    )
    yt = build("youtube", "v3", credentials=creds)

    meta = topic.get("youtube") or {}
    description = meta.get("description", f"{topic['prompt']}\n\nGenerated automatically.")
    # 9:16 videos under 3 minutes are auto-classified as Shorts; the hashtag
    # just makes the intent explicit to YouTube's classifier.
    if topic.get("preset") == "reel" and "#shorts" not in description.lower():
        description += "\n\n#Shorts"
    body = {
        "snippet": {
            "title": (meta.get("title") or topic["prompt"])[:100],
            "description": description,
            "tags": meta.get("tags", []),
            # 27 = Education
            "categoryId": str(meta.get("categoryId", "27")),
        },
        "status": {
            "privacyStatus": os.getenv("YT_PRIVACY", "public"),
            "selfDeclaredMadeForKids": False,
        },
    }
    media = MediaFileUpload(str(FINAL), mimetype="video/mp4", chunksize=-1, resumable=True)
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status:
            print(f"upload {int(status.progress() * 100)}%", flush=True)
    print(f"Uploaded: https://youtu.be/{resp['id']}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-upload", action="store_true", help="generate only")
    ap.add_argument("--prompt", help="one-off prompt; skips rotation and state bump")
    args = ap.parse_args()

    topic, idx, is_ai = None, None, False
    if args.prompt:
        topic = {"prompt": args.prompt}
        print(f"One-off topic: {args.prompt}", flush=True)
    elif os.getenv("TOPIC_MODE", "ai").strip().lower() != "list":
        try:
            topic, is_ai = ai_topic(), True
            print(f"AI topic: {topic['youtube']['title']}", flush=True)
            print(f"  brief: {topic['prompt']}", flush=True)
        except Exception as e:
            print(f"AI topic generation failed ({e}); falling back to topics.json", flush=True)
    if topic is None:
        topic, idx, total = pick_topic()
        print(f"Topic {idx + 1}/{total}: {topic['prompt']}", flush=True)

    generate(topic)
    # Record consumption only after a successful generation, so failures retry.
    if is_ai:
        record_history(topic)
    elif idx is not None:
        bump_state(idx)

    if args.no_upload:
        print("Upload skipped (--no-upload)")
        return
    if not os.getenv("YT_REFRESH_TOKEN", "").strip():
        sys.exit("YT_REFRESH_TOKEN not set; pass --no-upload for a dry run")
    upload(topic)


if __name__ == "__main__":
    main()
