"""Procedural ambient music bed: a soft synth-pad chord loop.

Generated locally (no API keys, no licensing) and mixed ~14 dB under the
narration by the renderer. Mood + transpose come from the Design Director,
so different videos get different beds.
"""
import math
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44100
FADE_S = 0.75
TARGET_RMS_DB = -20.0

# Each mood: (chord progression as frequency triads, seconds per chord,
# harmonic recipe). Progressions repeat twice for a clean loop.
MOODS = {
    "calm": {
        "chords": [
            [110.00, 130.81, 164.81],  # Am
            [87.31, 110.00, 130.81],   # F
            [130.81, 164.81, 196.00],  # C
            [98.00, 123.47, 146.83],   # G
        ],
        "chord_s": 8.0,
        "harmonics": ((1, 1.0), (2, 0.35), (3, 0.12)),
    },
    "uplifting": {
        "chords": [
            [130.81, 164.81, 196.00],  # C
            [98.00, 123.47, 146.83],   # G
            [110.00, 130.81, 164.81],  # Am
            [87.31, 110.00, 130.81],   # F
        ],
        "chord_s": 5.0,
        "harmonics": ((1, 1.0), (2, 0.5), (3, 0.22), (4, 0.08)),
    },
    "warm": {
        "chords": [
            [146.83, 174.61, 220.00],  # Dm
            [116.54, 146.83, 174.61],  # Bb
            [87.31, 110.00, 130.81],   # F
            [130.81, 164.81, 196.00],  # C
        ],
        "chord_s": 7.0,
        "harmonics": ((1, 1.0), (2, 0.42), (3, 0.1)),
    },
    "minimal": {
        "chords": [
            [82.41, 123.47, 164.81],   # Em
            [130.81, 164.81, 196.00],  # C
            [82.41, 123.47, 164.81],   # Em
            [146.83, 185.00, 220.00],  # D
        ],
        "chord_s": 10.0,
        "harmonics": ((1, 1.0), (2, 0.25)),
    },
}


def _chord_pad(freqs: list[float], duration_s: float, harmonics) -> np.ndarray:
    n = int(duration_s * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    left = np.zeros(n)
    right = np.zeros(n)
    for f in freqs:
        for harmonic, amp in harmonics:
            # Slight L/R detune widens the pad without a reverb dependency.
            left += amp * np.sin(2 * math.pi * f * harmonic * 0.9985 * t)
            right += amp * np.sin(2 * math.pi * f * harmonic * 1.0015 * t)
    fade = int(FADE_S * SAMPLE_RATE)
    envelope = np.ones(n)
    ramp = 0.5 - 0.5 * np.cos(math.pi * np.arange(fade) / fade)
    envelope[:fade] = ramp
    envelope[-fade:] = ramp[::-1]
    tremolo = 1 - 0.12 * (0.5 - 0.5 * np.cos(2 * math.pi * 0.15 * t))
    return np.stack([left, right]) * envelope * tremolo


def generate_bed(out_path: Path, mood: str = "calm", transpose: float = 1.0) -> float:
    """Write the stereo bed wav; returns its duration in seconds."""
    spec = MOODS.get(mood, MOODS["calm"])
    progression = spec["chords"] * 2
    stereo = np.concatenate(
        [
            _chord_pad([f * transpose for f in c], spec["chord_s"], spec["harmonics"])
            for c in progression
        ],
        axis=1,
    )
    rms = np.sqrt(np.mean(stereo**2))
    stereo *= (10 ** (TARGET_RMS_DB / 20)) / max(rms, 1e-9)
    stereo = np.clip(stereo, -0.9, 0.9)
    pcm = (stereo.T * 32767).astype(np.int16)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return pcm.shape[0] / SAMPLE_RATE


# Sidechain-style ducking. Remotion mixes music + narration at render time
# with static volumes, so the duck is baked into the bed file instead: the
# bed is tiled to the video's full length (Remotion's `loop` then never
# wraps, keeping the envelope aligned to the timeline) and dipped wherever
# narration plays.
DUCK_DB = -8.0
DUCK_ATTACK_S = 0.12   # how fast the music gets out of the voice's way
DUCK_RELEASE_S = 0.60  # how gently it swells back in pauses


def fit_and_duck(bed_path: Path, speech_spans: list[tuple[float, float]], total_s: float) -> None:
    """Tile the bed to `total_s` and duck it under the narration spans."""
    import soundfile as sf

    data, sr = sf.read(str(bed_path))
    if data.ndim == 1:
        data = data[:, None]
    need = int(total_s * sr) + sr  # +1s pad so the tail never runs dry
    reps = max(1, -(-need // len(data)))
    data = np.tile(data, (reps, 1))[:need]

    duck_gain = 10 ** (DUCK_DB / 20)
    target = np.ones(len(data))
    for start, end in speech_spans:
        a, b = max(0, int(start * sr)), min(len(data), int(end * sr))
        if b > a:
            target[a:b] = duck_gain
    # One-pole smoothing with distinct attack/release so the dips breathe.
    env = np.empty_like(target)
    level = 1.0
    a_att = 1 - math.exp(-1 / (sr * DUCK_ATTACK_S))
    a_rel = 1 - math.exp(-1 / (sr * DUCK_RELEASE_S))
    for i, t in enumerate(target):
        level += (a_att if t < level else a_rel) * (t - level)
        env[i] = level
    sf.write(str(bed_path), (data * env[:, None]).astype(np.float32), sr)
