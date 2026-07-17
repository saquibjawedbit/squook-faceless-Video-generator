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
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "guide_creator_flow"
RENDERER = ROOT / "renderer"
FINAL = RENDERER / "out" / "final.mp4"

# The narration language, which also identifies the channel this run publishes
# to: each language is its own YouTube channel with its own credentials, and so
# its own topic rotation, history ledger and analytics cache. Without that
# split the two daily crons would overwrite each other's state and each would
# steer its ideas on the other channel's numbers.
LANGUAGES = ("en", "hi")
VIDEO_LANG = os.getenv("VIDEO_LANG", "en").strip().lower() or "en"
if VIDEO_LANG not in LANGUAGES:
    sys.exit(f"VIDEO_LANG={VIDEO_LANG!r} is not one of {LANGUAGES}")


def channel_file(name: str) -> Path:
    """This channel's copy of a state file. English keeps the original
    unsuffixed names, so the existing ledger, rotation and cache stay exactly
    where they are; every other language gets a suffixed sibling
    ('history.json' -> 'history.hi.json')."""
    if VIDEO_LANG == "en":
        return Path(__file__).with_name(name)
    stem, ext = name.rsplit(".", 1)
    return Path(__file__).with_name(f"{stem}.{VIDEO_LANG}.{ext}")


TOPICS = channel_file("topics.json")
STATE = channel_file("state.json")
HISTORY = channel_file("history.json")

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

# Appended to the idea prompt for a non-English channel. The split of languages
# here is deliberate: "prompt" is an instruction to the video team and feeds a
# research step that has far more to draw on in English, while the narration is
# written natively in the target language downstream (see LANGUAGE_RULES in the
# flow's main.py). Everything a viewer actually reads is in the channel's
# language.
LANGUAGE_PROMPTS = {
    "en": "",
    "hi": """

This is the channel's HINDI feed: every video is narrated in Hindi for a
Hindi-speaking audience, mostly in India. Choose subjects with real mass appeal
there — everyday science, the human body, money, food, trains and machines,
animals, space, history's oddities. A topic that only lands for an American
viewer (US sports, US politics, American brands nobody there uses) is a miss.
Do not make the topic ABOUT India or Hindi; pick universally interesting things
and simply choose the ones that travel.

Language of each field:
  "title" and "description" — write in Hindi, in Devanagari script, in the
  natural spoken register a Hindi YouTube channel actually uses (everyday
  loanwords like स्पेस, एनर्जी are good; stiff literary Hindi is not).
  "tags" — mix Hindi and English terms, since viewers search both ways.
  "prompt" — keep this one in ENGLISH. It briefs the video team and drives the
  research step; the narration itself is written in Hindi later.""",
}

# Appended to the idea prompt only once the channel has enough measured videos
# for the numbers to mean something (see analytics.MIN_VIDEOS_FOR_LEARNING).
# Until then the format stays pinned to the defaults rather than chasing noise.
STRATEGY_PROMPT = """\

You also choose the FORMAT for this video, using the channel's own performance
data below. Judge on retention (avg view %) rather than raw views — views track
how long a video has been up as much as how good it is.

Available formats:
  preset "reel"      = 9:16 vertical Short, duration 45-60 (the channel default)
  preset "landscape" = 16:9, duration 60-90
  genre "footage"    = real stock video/photos only (the channel default)
  genre "educational", "images", "animation", "auto" = other visual treatments

Pick the format that best fits THIS topic and what the data supports. Change
away from the defaults when the data or the topic genuinely justifies it, not
for variety's sake; a format with few videos behind it is a guess, not a
finding. Add these keys to your JSON response:
  "preset": "reel" | "landscape",
  "genre": "footage" | "educational" | "images" | "animation" | "auto",
  "duration": <seconds, within the preset's range>,
  "format_reason": "one sentence citing the data or topic fit behind the choice"
"""

# Payload keys run_with_trigger understands (see ContentFlow.plan_content).
PAYLOAD_KEYS = ("prompt", "preset", "genre", "music", "voice", "duration")


def sh(cmd: list[str], cwd: Path) -> None:
    print(f"+ {' '.join(cmd)}  (cwd={cwd})", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def yt_credentials():
    """OAuth credentials for both the uploader and analytics.py. Whether the
    analytics scopes are actually granted depends on when the refresh token was
    minted; the token endpoint decides, not this list."""
    from google.oauth2.credentials import Credentials

    return Credentials(
        None,
        refresh_token=os.environ["YT_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["YT_CLIENT_ID"],
        client_secret=os.environ["YT_CLIENT_SECRET"],
    )


def ai_topic() -> dict:
    """Ask the pipeline's LLM for one fresh viral-Shorts topic, steering it
    away from everything in history.json. Uses the same OpenAI-compatible
    endpoint env the workflow already provides (LLM_BASE_URL/LLM_API_KEY/
    LLM_MODEL). Raises on any failure; the caller falls back to the list.

    Once the channel has enough measured videos, the model also sees a
    performance digest and picks the format itself; below that it just writes
    the idea and the defaults stand."""
    import urllib.request

    import analytics

    base = os.environ["LLM_BASE_URL"].rstrip("/")
    used_titles = [u["title"] for u in load_history()[-60:]]
    perf = analytics.digest()
    system = (IDEA_SYSTEM_PROMPT + LANGUAGE_PROMPTS[VIDEO_LANG]
              + (STRATEGY_PROMPT if perf else ""))
    user = "Already-used topics (do not repeat or closely resemble):\n" + (
        "\n".join(f"- {t}" for t in used_titles) or "- (none yet)")
    if perf:
        user += "\n\n" + perf
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
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }).encode(),
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        content = json.load(resp)["choices"][0]["message"]["content"] or ""
    # Tolerate prose around the JSON object.
    idea = json.loads(content[content.index("{"):content.rindex("}") + 1])
    if not idea.get("prompt") or not idea.get("title"):
        raise ValueError(f"LLM idea missing prompt/title: {idea}")
    fmt = resolve_format(idea) if perf else {
        "preset": "reel", "genre": "footage", "duration": 60,
    }
    if perf:
        print(f"  format: {fmt['preset']}/{fmt['genre']} {fmt['duration']}s "
              f"— {idea.get('format_reason', 'no reason given')}", flush=True)
    else:
        print("  format: reel/footage 60s (defaults; not enough channel data "
              "to steer on yet)", flush=True)
    return {
        "prompt": idea["prompt"],
        **fmt,
        "youtube": {
            "title": idea["title"],
            "description": idea.get("description", ""),
            "tags": idea.get("tags", []),
        },
    }


# preset -> (min, max, default) duration. Mirrors PRESETS in the flow's
# main.py; a value outside the range yields a script the runtime can't fill.
DURATION_RANGE = {"reel": (45, 60, 60), "landscape": (60, 90, 90)}
GENRES = ("footage", "educational", "images", "animation", "auto")


def resolve_format(idea: dict) -> dict:
    """Clamp the model's format choice to what the pipeline actually supports.
    Anything unrecognised falls back to the channel default rather than failing
    the run — a bad format pick shouldn't cost a day's video."""
    preset = str(idea.get("preset", "")).strip().lower()
    if preset not in DURATION_RANGE:
        preset = "reel"
    genre = str(idea.get("genre", "")).strip().lower()
    if genre not in GENRES:
        genre = "footage"
    lo, hi, default = DURATION_RANGE[preset]
    try:
        duration = int(idea.get("duration") or default)
    except (TypeError, ValueError):
        duration = default
    return {"preset": preset, "genre": genre, "duration": max(lo, min(hi, duration))}


def load_history() -> list:
    return json.loads(HISTORY.read_text()) if HISTORY.exists() else []


def record_history(topic: dict) -> None:
    """Append the topic to the ledger. Also captures the format knobs it was
    produced with, so analytics.py can later join performance back to the
    decisions that made the video. video_id is filled in by attach_upload()
    once the upload succeeds."""
    used = load_history()
    meta = topic.get("youtube") or {}
    used.append({
        "title": meta.get("title") or topic["prompt"],
        "prompt": topic["prompt"],
        "preset": topic.get("preset", ""),
        "genre": topic.get("genre", ""),
        "duration": topic.get("duration", 0),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "video_id": None,
    })
    HISTORY.write_text(json.dumps(used, indent=2) + "\n")


def attach_upload(video_id: str) -> None:
    """Stamp the just-uploaded video's id onto the newest history entry — the
    join key every later analytics fetch depends on."""
    used = load_history()
    if not used:
        return
    used[-1]["video_id"] = video_id
    used[-1]["published_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
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
    # The channel decides the language, not the topic — a per-topic override
    # would let one entry publish English to the Hindi channel.
    payload["language"] = VIDEO_LANG
    sh(["uv", "run", "run_with_trigger", json.dumps(payload)], GUIDE)
    # Full-scale render for publishing; set VIDEO_SCALE=0.5 for cheap tests.
    scale = os.getenv("VIDEO_SCALE", "").strip()
    scale_args = ["--scale", scale] if scale else []
    sh(["npx", "remotion", "render", "Explainer", "out/video.mp4", *scale_args], RENDERER)
    sh(["uv", "run", "master"], GUIDE)
    if not FINAL.exists() or FINAL.stat().st_size < 100_000:
        sys.exit(f"mastered video missing or suspiciously small: {FINAL}")
    print(f"Generated {FINAL} ({FINAL.stat().st_size // 1024} KB)", flush=True)


def upload(topic: dict) -> str:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    yt = build("youtube", "v3", credentials=yt_credentials())

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
            # Declaring both is what lets YouTube localize and (where the
            # channel is eligible) auto-dub correctly. Guessing wrong is worse
            # than not setting them, so they track the channel's real language.
            "defaultLanguage": VIDEO_LANG,       # language of title/description
            "defaultAudioLanguage": VIDEO_LANG,  # language spoken in the audio
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
    return resp["id"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-upload", action="store_true", help="generate only")
    ap.add_argument("--prompt", help="one-off prompt; skips rotation and state bump")
    args = ap.parse_args()

    print(f"Channel: {VIDEO_LANG} (topics={TOPICS.name}, history={HISTORY.name})", flush=True)

    topic, idx = None, None
    if args.prompt:
        topic = {"prompt": args.prompt}
        print(f"One-off topic: {args.prompt}", flush=True)
    elif os.getenv("TOPIC_MODE", "ai").strip().lower() != "list":
        try:
            topic = ai_topic()
            print(f"AI topic: {topic['youtube']['title']}", flush=True)
            print(f"  brief: {topic['prompt']}", flush=True)
        except Exception as e:
            print(f"AI topic generation failed ({e}); falling back to topics.json", flush=True)
    if topic is None:
        topic, idx, total = pick_topic()
        print(f"Topic {idx + 1}/{total}: {topic['prompt']}", flush=True)

    generate(topic)
    # Record consumption only after a successful generation, so failures retry.
    # Every topic lands in the ledger now, not just AI ones — analytics.py needs
    # a row per uploaded video regardless of where the idea came from.
    record_history(topic)
    if idx is not None:
        bump_state(idx)

    if args.no_upload:
        print("Upload skipped (--no-upload)")
        return
    if not os.getenv("YT_REFRESH_TOKEN", "").strip():
        sys.exit("YT_REFRESH_TOKEN not set; pass --no-upload for a dry run")
    attach_upload(upload(topic))


if __name__ == "__main__":
    main()
