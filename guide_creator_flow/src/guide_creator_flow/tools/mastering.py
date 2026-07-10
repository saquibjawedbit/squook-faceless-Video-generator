"""Master the rendered video's audio to platform loudness.

Measures true BS.1770 integrated loudness, applies gain toward the target,
soft-limits the peaks (tanh — transparent except near the ceiling), and
remuxes into out/final.mp4. Uses Remotion's bundled ffmpeg for decode/encode
since no system ffmpeg is installed.
"""
import subprocess
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

TARGET_LUFS = -14.0
CEILING = 0.85  # ≈ -1.4 dBFS true-peak headroom

RENDERER = Path(__file__).resolve().parents[4] / "renderer"


def _ffmpeg(args: list[str]) -> None:
    subprocess.run(
        ["npx", "remotion", "ffmpeg", "-loglevel", "error", *args],
        cwd=RENDERER,
        check=True,
    )


def run() -> None:
    video = RENDERER / "out" / "video.mp4"
    if not video.exists():
        raise SystemExit(f"{video} not found — render first (npm run render)")
    wav = RENDERER / "out" / "_master_tmp.wav"

    _ffmpeg(["-i", str(video), "-map", "0:a:0", "-ar", "48000", "-f", "wav", str(wav), "-y"])
    data, rate = sf.read(str(wav))
    meter = pyln.Meter(rate)
    before = meter.integrated_loudness(data)

    # Two passes: limiting eats some loudness, the second pass compensates.
    for _ in range(2):
        lufs = meter.integrated_loudness(data)
        data = data * 10 ** ((TARGET_LUFS - lufs) / 20)
        data = np.tanh(data / CEILING) * CEILING

    after = meter.integrated_loudness(data)
    sf.write(str(wav), data, rate)

    out = RENDERER / "out" / "final.mp4"
    _ffmpeg([
        "-i", str(video), "-i", str(wav),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        str(out), "-y",
    ])
    wav.unlink()
    print(f"Mastered {before:.1f} → {after:.1f} LUFS (target {TARGET_LUFS}) — {out}")
