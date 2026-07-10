"""Synthesized sound-effects kit — whooshes, impacts, risers, pops.

Every sound is generated from noise/oscillators in numpy, so the kit is an
original work owned outright: no licenses, no attribution, no downloads —
the same legal footing as the synth music bed. Deterministic (fixed seed),
cached under output/audio/sfx/ (which _sync_renderer already copies to
renderer/public).

Levels are tuned to sit under narration at layer volume 1.0; the IR mixes
them lower still (see ir_builder SFX_*_VOLUME).
"""
import numpy as np
import soundfile as sf
from pathlib import Path

SR = 48_000
KIT_DIR = Path("output/audio/sfx")
PEAK = 0.7  # dBFS headroom so stacked SFX never clip the master


def _fade(x: np.ndarray, in_s: float = 0.005, out_s: float = 0.02) -> np.ndarray:
    n_in, n_out = int(SR * in_s), int(SR * out_s)
    if n_in:
        x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out:
        x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def _norm(x: np.ndarray) -> np.ndarray:
    peak = np.max(np.abs(x)) or 1.0
    return (x / peak * PEAK).astype(np.float32)


def _moving_bandpass(noise: np.ndarray, centers: np.ndarray, width: float) -> np.ndarray:
    """Cheap time-varying band-pass: ring-modulate low-passed noise up to a
    sweeping center frequency. Good enough for whoosh/riser textures."""
    t = np.arange(len(noise)) / SR
    # Low-pass the noise by simple cumulative smoothing (one-pole).
    alpha = width / SR
    lp = np.empty_like(noise)
    acc = 0.0
    for i, v in enumerate(noise):  # small arrays; clarity over speed
        acc += alpha * (v - acc)
        lp[i] = acc
    phase = 2 * np.pi * np.cumsum(centers) / SR
    return lp * np.sin(phase) * 2.0


def _whoosh(rng) -> np.ndarray:
    """0.7s airy sweep that peaks right at the end — lead it into a cut."""
    n = int(SR * 0.7)
    noise = rng.standard_normal(n)
    centers = np.linspace(400, 2400, n)              # rising band = motion
    x = _moving_bandpass(noise, centers, width=900)
    x *= np.linspace(0.15, 1.0, n) ** 1.5            # swell toward the cut
    return _fade(x, 0.02, 0.06)


def _impact(rng) -> np.ndarray:
    """0.8s cinematic hit: sub-sine drop + noise burst + slow tail."""
    n = int(SR * 0.8)
    t = np.arange(n) / SR
    freq = np.linspace(110, 38, n)                   # falling sub
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 5)
    snap = rng.standard_normal(n) * np.exp(-t * 60)  # transient crack
    tail = rng.standard_normal(n) * np.exp(-t * 7) * 0.15
    return _fade(body * 0.9 + snap * 0.5 + tail)


def _riser(rng) -> np.ndarray:
    """1.6s tension riser: noise sweeping up with accelerating tremolo."""
    n = int(SR * 1.6)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    centers = np.linspace(250, 3200, n) ** 1.02
    x = _moving_bandpass(noise, centers, width=600)
    trem = 0.6 + 0.4 * np.sin(2 * np.pi * np.cumsum(np.linspace(3, 14, n)) / SR)
    x *= trem * np.linspace(0.1, 1.0, n) ** 2
    return _fade(x, 0.05, 0.03)


def _pop(rng) -> np.ndarray:
    """0.18s soft UI pop for counters/graphics."""
    n = int(SR * 0.18)
    t = np.arange(n) / SR
    freq = np.linspace(900, 350, n)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 28)
    click = rng.standard_normal(n) * np.exp(-t * 220) * 0.3
    return _fade(body + click)


_BUILDERS = {"whoosh": _whoosh, "impact": _impact, "riser": _riser, "pop": _pop}


def ensure_kit(kit_dir: Path = KIT_DIR) -> dict[str, str]:
    """Generate any missing kit sounds; return {name: path-for-the-IR}."""
    kit_dir.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, build in _BUILDERS.items():
        path = kit_dir / f"{name}.wav"
        if not path.exists():
            rng = np.random.default_rng(42)  # per-sound: kit is reproducible
            sf.write(str(path), _norm(build(rng)), SR)
        out[name] = str(path)
    return out
