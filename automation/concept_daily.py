#!/usr/bin/env python3
"""Concept Samjho: one Hinglish Class 10 lesson + one Short a day.

    python3 automation/concept_daily.py check      # token health check only
    python3 automation/concept_daily.py run        # make both videos and upload
    python3 automation/concept_daily.py run --dry  # make both videos, no upload

Squook makes the videos (its API, via the automation key); this script only
picks the topic, waits, adds a thumbnail and uploads. Stdlib only.

Env: SQUOOK_URL, SQUOOK_AUTOMATION_KEY, YT_CLIENT_ID, YT_CLIENT_SECRET,
YT_REFRESH_TOKEN. Lesson goes live at 17:00 IST, the Short next day 08:00 IST.
"""

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOPICS = HERE / "concept-topics.json"
STATE = HERE / "concept-state.json"
HISTORY = HERE / "concept-history.json"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
SQUOOK = os.getenv("SQUOOK_URL", "https://squook.saquibjawed4444.workers.dev").rstrip("/")

LESSON_NOTES = (
    "Audience: Indian Class 10 CBSE students preparing for the 2027 board exam. "
    "Teach in natural Hinglish (Hindi sentences in Roman script with English science and maths terms), "
    "respectful and warm like a good tutor ('aap' / 'chaliye'), never slangy. "
    "Follow the NCERT textbook exactly; do not add facts, numbers, dates or claims that are not in NCERT. "
    "Structure: a one-line hook question, the idea in simple words, formula or key terms on screen, "
    "a diagram or graph where it helps, one or two solved board-style examples step by step, "
    "a common mistake students make, and a 3-point recap. "
    "End with: 'Aise hi concepts ke liye Concept Samjho ko subscribe kijiye.'"
)
SHORT_NOTES = (
    "A 35-45 second vertical YouTube Short for Class 10 students, natural Hinglish, respectful. "
    "Open with the hook in the first 2 seconds, show exactly one formula, rule or trick big on screen, "
    "one quick example, then: 'Poora lesson Concept Samjho channel pe hai.' "
    "Only NCERT facts; nothing invented."
)


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def http(method, url, data=None, headers=None, timeout=120, raw=False):
    body = None
    headers = {"User-Agent": "ConceptSamjho/1.0 (+https://www.youtube.com/@ConceptSamjhoHQ)", **(headers or {})}
    if isinstance(data, (dict, list)):
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    elif data is not None:
        body = data
    key = headers.pop("x-automation-key", None)
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    if key:  # never forwarded on redirects (e.g. to signed storage URLs)
        req.add_unredirected_header("x-automation-key", key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = r.read()
            return out if raw else (json.loads(out) if out else {})
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"{method} {url.split('?')[0]} -> {e.code}: {detail}") from None


def squook(method, path, data=None, timeout=120):
    key = os.environ["SQUOOK_AUTOMATION_KEY"]
    return http(method, SQUOOK + path, data, {"x-automation-key": key}, timeout=timeout)


# ── YouTube ───────────────────────────────────────────────────────────────────

def yt_token():
    t = http("POST", "https://oauth2.googleapis.com/token", urllib.parse.urlencode({
        "client_id": os.environ["YT_CLIENT_ID"],
        "client_secret": os.environ["YT_CLIENT_SECRET"],
        "refresh_token": os.environ["YT_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode())
    return t["access_token"]


def check():
    tok = yt_token()
    me = http("GET", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
              headers={"Authorization": "Bearer " + tok})
    name = me["items"][0]["snippet"]["title"] if me.get("items") else None
    if not name:
        raise RuntimeError("YouTube key works but no channel is linked")
    print(f"YouTube key OK ({name})")
    return tok


def yt_upload(tok, path, meta):
    size = os.path.getsize(path)
    init = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        data=json.dumps(meta).encode(), method="POST",
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json",
                 "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size)})
    with urllib.request.urlopen(init, timeout=60) as r:
        loc = r.headers["Location"]
    with open(path, "rb") as f:
        put = urllib.request.Request(loc, data=f.read(), method="PUT",
                                     headers={"Content-Type": "video/mp4", "Content-Length": str(size)})
    with urllib.request.urlopen(put, timeout=900) as r:
        v = json.loads(r.read())
    print(f"uploaded {v['id']} ({v['status'].get('privacyStatus')}, upload {v['status'].get('uploadStatus')})")
    return v


def yt_thumbnail(tok, video_id, png):
    data = Path(png).read_bytes()
    http("POST", f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}",
         data, {"Authorization": "Bearer " + tok, "Content-Type": "image/png"})


# ── Squook ────────────────────────────────────────────────────────────────────

def make_video(topic, notes, fmt, seconds, label):
    print(f"[{label}] asking Squook for: {topic}", flush=True)
    res = squook("POST", "/api/fast", {
        "topic": topic, "style": "explainer", "format": fmt, "duration": seconds,
        "voiceLang": "hinglish", "notes": notes,
    }, timeout=1200)
    pid = res["project"]["id"]
    title = res.get("ir", {}).get("metadata", {}).get("title") or topic
    print(f"[{label}] project {pid}: '{title}'", flush=True)
    wait_done(pid, label)
    if fmt == "16:9":  # lessons go out in 1080p
        squook("POST", f"/api/fast/{pid}/render", {"quality": "hd"})
        time.sleep(20)
        wait_done(pid, label + " HD", "hd")
    url = squook("GET", f"/api/projects/{pid}/url")["url"]
    out = Path(tempfile.mkdtemp()) / f"{label}.mp4"
    out.write_bytes(http("GET", url, timeout=600, raw=True))
    print(f"[{label}] downloaded {out.stat().st_size // 1024} KB", flush=True)
    return pid, title, out


def wait_done(pid, label, quality="standard", limit_s=3600):
    start = time.time()
    last = None
    retries = 0
    while time.time() - start < limit_s:
        p = squook("GET", f"/api/projects/{pid}")
        st = (p.get("status"), p.get("stage"), p.get("progress"))
        if st != last:
            print(f"[{label}] {st[0]} {st[1]} {st[2]}%", flush=True)
            last = st
        if p.get("status") == "done":
            return p
        if p.get("status") == "failed" and "interrupted" in str(p.get("error")) and retries < 3:
            retries += 1  # a deploy restarted Squook mid-render: render again
            print(f"[{label}] render interrupted by a restart, retrying ({retries}/3)", flush=True)
            time.sleep(60)
            try:
                squook("POST", f"/api/fast/{pid}/render", {"quality": quality})
            except RuntimeError as e:
                print(f"[{label}] retry request failed: {e}", flush=True)
            continue
        if p.get("status") == "failed":
            raise RuntimeError(f"{label} failed in Squook: {p.get('error')}; log: {(p.get('log') or [])[-5:]}")
        time.sleep(30)
    raise RuntimeError(f"{label} not done after {limit_s // 60} min")


# ── Thumbnail (headless Chrome, no extra packages) ────────────────────────────

THUMB_HTML = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&display=swap" rel="stylesheet"><style>
body{{margin:0;width:1280px;height:720px;background:#0F2240;font-family:'Baloo 2',sans-serif;position:relative;overflow:hidden}}
.bg{{position:absolute;inset:0;background:url('{frame}') center/cover;opacity:.22}}
.tag{{position:absolute;left:64px;top:56px;background:#FFC83D;color:#0F2240;font-weight:800;font-size:38px;padding:6px 26px;border-radius:16px}}
h1{{position:absolute;left:64px;right:64px;top:150px;margin:0;color:#fff;font-weight:800;font-size:{size}px;line-height:1.02;letter-spacing:-1px}}
h1 b{{color:#FFC83D}}
.sub{{position:absolute;left:64px;bottom:58px;color:#C9D3E3;font-weight:700;font-size:40px}}
.logo{{position:absolute;right:56px;bottom:46px;background:#FFC83D;color:#0F2240;font-weight:800;font-size:56px;padding:2px 26px 0;border-radius:24px}}
</style></head><body><div class="bg"></div><div class="tag">CLASS 10 · {subject}</div>
<h1>{headline}</h1><div class="sub">Hinglish mein · NCERT · Board 2027</div><div class="logo">CS</div></body></html>"""


def chrome_bin():
    for c in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        if subprocess.run(["which", c], capture_output=True).returncode == 0 or os.path.exists(c):
            return c
    return None


def thumbnail(pid, entry):
    chrome = chrome_bin()
    if not chrome:
        print("no Chrome: skipping custom thumbnail")
        return None
    d = Path(tempfile.mkdtemp())
    frame = ""
    try:
        (d / "frame.jpg").write_bytes(http("GET", SQUOOK + f"/api/projects/{pid}/thumb", raw=True,
                                           headers={"x-automation-key": os.environ["SQUOOK_AUTOMATION_KEY"]}))
        frame = "frame.jpg"
    except Exception as e:
        print("no frame for thumbnail:", e)
    words = entry["topic"].split(":")[0].strip()
    w = words.split()
    headline = " ".join(w[:-2] + [f"<b>{' '.join(w[-2:])}</b>"]) if len(w) > 2 else f"<b>{words}</b>"
    size = 112 if len(words) <= 22 else 92 if len(words) <= 40 else 74
    (d / "t.html").write_text(THUMB_HTML.format(frame=frame, subject=entry["subject"].upper(),
                                                headline=headline, size=size), encoding="utf-8")
    png = d / "thumb.png"
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                    "--virtual-time-budget=8000", "--window-size=1280,720",
                    f"--screenshot={png}", (d / "t.html").as_uri()],
                   capture_output=True, timeout=90)
    return png if png.exists() and png.stat().st_size > 5000 else None


# ── Metadata ──────────────────────────────────────────────────────────────────

def lesson_meta(entry, publish_at):
    title = f"{entry['topic'].split(':')[0].strip()} | Class 10 {entry['subject']} | Hinglish | NCERT"
    if len(title) > 100:
        title = f"{entry['topic'][:60].strip()} | Class 10 {entry['subject']} Hinglish"
    desc = (
        f"{entry['topic']} — Class 10 {entry['subject']}, NCERT chapter: {entry['chapter']}.\n"
        f"Simple Hinglish mein concept, formula, diagram aur solved examples.\n\n"
        f"Board exam 2027 ki taiyari ke liye har din ek naya lesson. Subscribe kijiye: "
        f"https://www.youtube.com/@ConceptSamjhoHQ?sub_confirmation=1\n\n"
        f"Agla topic kya chahiye? Comment mein likhiye.\n\n"
        f"#Class10 #{entry['subject']} #NCERT #CBSE #BoardExam2027 #Hinglish"
    )
    return {
        "snippet": {
            "title": title, "description": desc, "categoryId": "27",
            "tags": ["class 10", f"class 10 {entry['subject'].lower()}", entry["chapter"].lower(),
                     "ncert", "cbse", "board exam 2027", "hinglish", "hindi", "concept samjho"],
            "defaultLanguage": "hi", "defaultAudioLanguage": "hi",
        },
        "status": {"privacyStatus": "private", "publishAt": publish_at, "selfDeclaredMadeForKids": False,
                   "containsSyntheticMedia": True},
    }


def short_meta(entry, publish_at, lesson_id):
    title = f"{entry['short']} | Class 10 #shorts"[:100]
    desc = (
        f"{entry['short']} — Class 10 {entry['subject']} ({entry['chapter']}).\n"
        f"Poora lesson: https://youtu.be/{lesson_id}\n\n#shorts #Class10 #NCERT #BoardExam2027"
    )
    return {
        "snippet": {"title": title, "description": desc, "categoryId": "27",
                    "tags": ["shorts", "class 10", "ncert", "hinglish"],
                    "defaultLanguage": "hi", "defaultAudioLanguage": "hi"},
        "status": {"privacyStatus": "private", "publishAt": publish_at, "selfDeclaredMadeForKids": False,
                   "containsSyntheticMedia": True},
    }


def iso_utc(t):
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def publish_times(now=None):
    now = (now or dt.datetime.now(IST)).astimezone(IST)
    if os.getenv("PUBLISH_TODAY"):  # test run: lesson in 15 min, Short 30 min later
        return iso_utc(now + dt.timedelta(minutes=15)), iso_utc(now + dt.timedelta(minutes=45))
    lesson = now.replace(hour=17, minute=0, second=0, microsecond=0)
    if lesson <= now + dt.timedelta(minutes=20):
        lesson += dt.timedelta(days=1)
    short = (lesson + dt.timedelta(days=1)).replace(hour=8)
    return iso_utc(lesson), iso_utc(short)


# ── Main ──────────────────────────────────────────────────────────────────────

def run(dry):
    tok = None if dry else check()
    topics = json.loads(TOPICS.read_text())
    state = json.loads(STATE.read_text())
    idx = state["next"] % len(topics)
    entry = topics[idx]
    print(f"Today #{idx + 1}/{len(topics)}: {entry['subject']} — {entry['topic']}", flush=True)

    lesson_topic = (f"Class 10 {entry['subject']} (NCERT chapter '{entry['chapter']}'): {entry['topic']}. "
                    f"A complete concept lesson.")
    short_topic = f"Class 10 {entry['subject']} ({entry['chapter']}): {entry['short']}"
    l_pid, l_title, l_mp4 = make_video(lesson_topic, LESSON_NOTES, "16:9", 300, "lesson")
    s_pid, s_title, s_mp4 = make_video(short_topic, SHORT_NOTES, "9:16", 40, "short")

    record = {"date": dt.datetime.now(IST).strftime("%Y-%m-%d"), "index": idx, "topic": entry["topic"],
              "lesson_project": l_pid, "short_project": s_pid}
    if dry:
        print("dry run: not uploading", l_mp4, s_mp4)
    else:
        lesson_at, short_at = publish_times()
        lv = yt_upload(tok, l_mp4, lesson_meta(entry, lesson_at))
        png = thumbnail(l_pid, entry)
        if png:
            try:
                yt_thumbnail(tok, lv["id"], png)
                print("thumbnail set")
            except Exception as e:  # needs a phone-verified channel
                print("thumbnail skipped:", e)
        sv = yt_upload(tok, s_mp4, short_meta(entry, short_at, lv["id"]))
        record.update(lesson_id=lv["id"], lesson_at=lesson_at, short_id=sv["id"], short_at=short_at,
                      lesson_status=lv["status"].get("privacyStatus"))

    hist = json.loads(HISTORY.read_text()) if HISTORY.exists() else []
    hist.append(record)
    HISTORY.write_text(json.dumps(hist, ensure_ascii=False, indent=1))
    STATE.write_text(json.dumps({"next": idx + 1}))
    print("done:", json.dumps(record, ensure_ascii=False))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "check":
        check()
    elif cmd == "run":
        run("--dry" in sys.argv)
    else:
        sys.exit(__doc__)
