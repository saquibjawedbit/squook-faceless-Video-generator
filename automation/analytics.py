#!/usr/bin/env python3
"""Fetch per-video performance for everything the daily pipeline has published
and cache it in automation/performance.json.

    python3 automation/analytics.py            # refresh the cache
    python3 automation/analytics.py --digest   # print the LLM-facing summary

Runs before generation in the daily workflow so the idea step can see how the
channel is actually doing. Never fails the build: any auth/scope/API problem is
reported and swallowed, leaving the previous cache in place.

Needs YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN, where the refresh
token was minted with the analytics scopes (see get_youtube_token.py). A token
predating those scopes authenticates fine but 403s on every report query — that
is the expected "not wired up yet" path, not an error to fix here.
"""

import argparse
import datetime as dt
import json
import os

from daily import channel_file, load_history, yt_credentials

# Per-channel, like the history it summarises: each language publishes to its
# own YouTube channel, and steering one channel's ideas on another's numbers
# would be worse than having no numbers at all.
PERFORMANCE = channel_file("performance.json")

# Lifetime per-video metrics. averageViewPercentage is the honest cross-format
# comparator: raw views scale with age and luck, retention reflects the video.
METRICS = ",".join([
    "views",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "averageViewPercentage",
    "likes",
    "shares",
    "subscribersGained",
])

# Below this many measured videos the numbers are noise, not signal: with a
# handful of uploads a single lucky video would look like proof that its format
# wins. Until then we collect data and leave the defaults alone. Override with
# MIN_VIDEOS_FOR_LEARNING to loosen (or tighten) the gate.
try:
    MIN_VIDEOS_FOR_LEARNING = int(os.getenv("MIN_VIDEOS_FOR_LEARNING", "20"))
except ValueError:
    MIN_VIDEOS_FOR_LEARNING = 20


def _utc_today() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def fetch() -> dict:
    """Pull lifetime metrics for every history entry that has a video_id."""
    from googleapiclient.discovery import build

    tracked = [h for h in load_history() if h.get("video_id")]
    if not tracked:
        print("No published videos with a video_id yet; nothing to fetch.", flush=True)
        return {}

    creds = yt_credentials()
    analytics = build("youtubeAnalytics", "v2", credentials=creds)
    by_id = {h["video_id"]: h for h in tracked}

    # The API caps `video==` filters at 500 ids; a daily channel will not reach
    # that for years, but chunk anyway so this never silently truncates.
    rows: list = []
    headers: list = []
    ids = list(by_id)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        resp = analytics.reports().query(
            ids="channel==MINE",
            # Channel-lifetime window: YouTube has no "all time" flag, and no
            # video predates this.
            startDate="2005-02-14",
            endDate=_utc_today().isoformat(),
            metrics=METRICS,
            dimensions="video",
            filters="video==" + ",".join(chunk),
        ).execute()
        rows.extend(resp.get("rows", []))
        headers = [c["name"] for c in resp.get("columnHeaders", [])] or headers

    if not rows:
        print("Analytics returned no rows (videos may be too new to report).", flush=True)
        return {}

    videos = {}
    for row in rows:
        rec = dict(zip(headers, row))
        vid = rec.pop("video")
        entry = by_id.get(vid, {})
        published = entry.get("published_at", "")
        videos[vid] = {
            "title": entry.get("title", ""),
            "preset": entry.get("preset", ""),
            "genre": entry.get("genre", ""),
            "duration": entry.get("duration", 0),
            "published_at": published,
            "age_days": _age_days(published),
            **rec,
        }
    return videos


def _age_days(published: str) -> int | None:
    if not published:
        return None
    try:
        then = dt.datetime.fromisoformat(published).date()
    except ValueError:
        return None
    return (_utc_today() - then).days


def refresh() -> dict:
    """Fetch and cache. Returns the cached payload; on failure returns whatever
    was already on disk so a transient API problem never blanks the record."""
    try:
        videos = fetch()
    except Exception as e:
        print(f"Analytics fetch skipped ({type(e).__name__}: {e})", flush=True)
        print("If this is a 403, the refresh token predates the analytics "
              "scopes — re-run automation/get_youtube_token.py.", flush=True)
        return load_performance()
    if not videos:
        return load_performance()
    payload = {
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "videos": videos,
    }
    PERFORMANCE.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Cached analytics for {len(videos)} video(s) -> {PERFORMANCE.name}", flush=True)
    return payload


def load_performance() -> dict:
    if not PERFORMANCE.exists():
        return {}
    try:
        return json.loads(PERFORMANCE.read_text())
    except json.JSONDecodeError:
        return {}


def digest(payload: dict | None = None) -> str:
    """A compact, honest performance summary for the idea prompt.

    Returns "" when there is not enough measured data to justify steering — the
    caller then leaves the format defaults untouched.
    """
    payload = payload if payload is not None else load_performance()
    videos = (payload or {}).get("videos", {})
    if len(videos) < MIN_VIDEOS_FOR_LEARNING:
        return ""

    ranked = sorted(
        videos.values(),
        key=lambda v: v.get("averageViewPercentage") or 0,
        reverse=True,
    )
    lines = [
        f"Channel performance to date ({len(ranked)} videos measured). "
        "Retention (avg view %) is the fairest comparator; view counts still "
        "favour older videos, so weigh them with age_days in mind.",
        "",
        "Best performers:",
    ]
    lines += [_line(v) for v in ranked[:5]]
    lines += ["", "Worst performers:"]
    lines += [_line(v) for v in ranked[-5:]]

    lines += ["", "By format (avg retention, n):"]
    for key in ("preset", "genre"):
        for name, group in _group(ranked, key).items():
            avg = sum(v.get("averageViewPercentage") or 0 for v in group) / len(group)
            lines.append(f"- {key}={name}: {avg:.1f}% over {len(group)} video(s)")
    return "\n".join(lines)


def _line(v: dict) -> str:
    age = v.get("age_days")
    age_s = f"{age}d old" if age is not None else "age unknown"
    return (f"- \"{v.get('title', '')[:70]}\" [{v.get('preset')}/{v.get('genre')}] "
            f"{v.get('averageViewPercentage') or 0:.0f}% retention, "
            f"{v.get('views') or 0} views, {age_s}")


def _group(videos: list, key: str) -> dict:
    out: dict = {}
    for v in videos:
        out.setdefault(v.get(key) or "unknown", []).append(v)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--digest", action="store_true",
                    help="print the LLM-facing summary from the cache, no fetch")
    args = ap.parse_args()

    if args.digest:
        text = digest()
        print(text or f"Not enough measured videos yet "
                      f"(need {MIN_VIDEOS_FOR_LEARNING}); no steering applied.")
        return
    refresh()


if __name__ == "__main__":
    main()
