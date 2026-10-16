"""Build fast mode's music library: Creative Commons tracks from artists who
publish them on their OWN YouTube channels, downloaded with yt-dlp, then
analysed once (tempo, beats, downbeats, 4-bar phrases, energy curve, peak) so
videos can cut on the beat and duck the music under the voice.

Only uploads that (1) come from a whitelisted artist channel and (2) carry
YouTube's "Creative Commons Attribution" licence are kept. Every track keeps
its credit line (CC BY needs attribution in the video's description/credits).

Run on a normal (residential) connection — YouTube blocks most cloud IPs:
  uv run --no-project --with librosa --with soundfile --with yt-dlp \
    python server/scripts/build_music_library.py <out_dir>
"""
import json
import subprocess
import sys
from pathlib import Path

import librosa
import numpy as np

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "music-library")
OUT.mkdir(parents=True, exist_ok=True)

# Artists who license their own uploads CC BY / CC0 (channel ids verified).
ARTISTS = {
    "UCSZXFhRIx6b0dFX3xS8L1yQ": "Kevin MacLeod",
    "UCQQnt1aRVykayQKpSEOuqqg": "Kevin MacLeod",
    "UCUuUqWLLsUjheuYkP9AWxTA": "Scott Buckley",
    "UC3M9CX5HWSw25k5QL3FkDEA": "Punch Deck",
    "UCfZCLQw3oSDqMJoCHu2X3cQ": "Holizna",
    "UCIbpHW0vqun4y7V9bPKLxqw": "Komiku (Loyalty Freak Music)",
}
# mood -> searches (each limited to the whitelist above)
MOODS = {
    "uplifting": ["Kevin MacLeod upbeat", "Punch Deck uplifting", "Scott Buckley uplifting"],
    "corporate": ["Kevin MacLeod corporate", "Kevin MacLeod inspiring"],
    "tech": ["Punch Deck electronic", "Punch Deck synthwave", "Kevin MacLeod electronic"],
    "energetic": ["Punch Deck energetic", "Kevin MacLeod rock", "Kevin MacLeod action"],
    "cinematic": ["Scott Buckley cinematic", "Scott Buckley epic"],
    "calm": ["Scott Buckley ambient", "Kevin MacLeod calm", "Kevin MacLeod piano"],
    "chill": ["HoliznaCC0 lofi", "Holizna chill", "Komiku Loyalty Freak"],
    "playful": ["Kevin MacLeod happy", "Kevin MacLeod quirky", "Komiku happy"],
}
PER_MOOD = 5
BAD = ("hour", "mix", "compilation", "live", "full album", "playlist", "1h", "remix")

def ytdlp(*args):
    return subprocess.run(["yt-dlp", *args], capture_output=True, text=True, timeout=600).stdout

def candidates(query):
    out = ytdlp(f"ytsearch15:{query}", "--skip-download", "--no-warnings",
                "--print", "%(id)s\t%(channel_id)s\t%(license)s\t%(duration)s\t%(title)s")
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        vid, chan, lic, dur, title = parts[:5]
        try:
            dur = float(dur)
        except ValueError:
            continue
        if chan in ARTISTS and "Creative Commons" in lic and 70 <= dur <= 420 and not any(b in title.lower() for b in BAD):
            yield {"id": vid, "artist": ARTISTS[chan], "title": title, "duration": dur}

def analyse(path):
    y, sr = librosa.load(path, sr=22050, mono=True)
    dur = len(y) / sr
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr)
    beats = librosa.frames_to_time(beat_frames, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    # Downbeat phase: the one of 4 beat offsets with the most onset energy.
    strength = onset[np.clip(beat_frames, 0, len(onset) - 1)] if len(beat_frames) else np.array([])
    phase = int(np.argmax([strength[k::4].sum() for k in range(4)])) if len(strength) >= 8 else 0
    downbeats = beats[phase::4]
    phrases = downbeats[::4]
    # How clearly rhythmic: onset at beats vs everywhere (drums ~>1.5, pads ~1).
    clarity = float(strength.mean() / (onset.mean() + 1e-9)) if len(strength) else 1.0
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=sr // 2)[0]  # 0.5 s steps
    e = rms / (rms.max() + 1e-9)
    per_sec = [round(float(e[i:i + 2].mean()), 3) for i in range(0, len(e), 2)]
    smooth = np.convolve(e, np.ones(16) / 16, mode="same")
    peak = float(np.argmax(smooth) * 0.5)
    return {
        "duration": round(dur, 2), "bpm": round(tempo, 1), "rhythmic": clarity > 1.35,
        "clarity": round(clarity, 2), "energy": round(float(e.mean()), 3), "peak": round(peak, 1),
        "beats": [round(float(b), 3) for b in beats],
        "downbeats": [round(float(b), 3) for b in downbeats],
        "phrases": [round(float(b), 3) for b in phrases],
        "energy_curve": per_sec,
    }

library, seen = [], set()
for mood, queries in MOODS.items():
    got = 0
    for q in queries:
        for c in candidates(q):
            if got >= PER_MOOD or c["id"] in seen:
                continue
            seen.add(c["id"])
            mp3 = OUT / f"{c['id']}.mp3"
            if not mp3.exists():
                ytdlp("-x", "--audio-format", "mp3", "--audio-quality", "5", "--no-warnings", "--no-playlist",
                      "-o", str(OUT / "%(id)s.%(ext)s"), f"https://www.youtube.com/watch?v={c['id']}")
            if not mp3.exists():
                print("  download failed", c["id"]); continue
            try:
                a = analyse(str(mp3))
            except Exception as ex:  # noqa: BLE001
                print("  analysis failed", c["id"], ex); continue
            library.append({
                "id": c["id"], "file": mp3.name, "mood": mood, "artist": c["artist"], "title": c["title"],
                "license": "CC BY 4.0" if c["artist"] in ("Kevin MacLeod", "Scott Buckley") else "Creative Commons Attribution",
                "source": f"https://www.youtube.com/watch?v={c['id']}",
                "credit": f"Music: \"{c['title']}\" by {c['artist']}, licensed under Creative Commons Attribution ({'https://www.youtube.com/watch?v=' + c['id']})",
                **a,
            })
            got += 1
            print(f"{mood:10s} {a['bpm']:6.1f} bpm rhythmic={a['rhythmic']!s:5s} {c['artist']}: {c['title'][:60]}")
    print(f"-- {mood}: {got}")

(OUT / "library.json").write_text(json.dumps(library, indent=1))
print("tracks:", len(library))
