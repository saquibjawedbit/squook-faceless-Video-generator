"""Generate fast mode's built-in music beds and sound effects (run once; the
outputs are committed under server/media/). Beds are 64 s, loop cleanly, and
sit under a voice-over: soft pads, plus a light pulse/beat for the livelier
moods. Run from guide_creator_flow/ so numpy + soundfile are available:
  uv run python ../server/scripts/make_audio.py ../server/media
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "media")
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

def t_axis(sec): return np.arange(int(SR * sec)) / SR
def norm(x, peak=0.9): return x / (np.max(np.abs(x)) + 1e-9) * peak
def env_adsr(n, a=0.01, d=0.1, s=0.6, r=0.2):
    e = np.ones(n); A, D, R = int(a * SR), int(d * SR), int(r * SR)
    e[:A] = np.linspace(0, 1, A) if A else 1
    e[A:A + D] = np.linspace(1, s, D)
    e[A + D:] = s
    if R: e[-R:] *= np.linspace(1, 0, R)
    return e
def lowpass(x, cutoff):
    # one-pole low-pass, cheap and smooth
    a = np.exp(-2 * np.pi * cutoff / SR); y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y

NOTE = lambda n: 440.0 * 2 ** ((n - 69) / 12)
# Chord progressions as MIDI triads (root position-ish), 4 chords looping.
PROG = {
    "calm":      [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    "uplifting": [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    "energetic": [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    "tech":      [[52, 55, 59], [48, 52, 55], [50, 53, 57], [47, 50, 54]],
    "warm":      [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]],
    "corporate": [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
}
BPM = {"calm": 72, "uplifting": 100, "energetic": 118, "tech": 110, "warm": 84, "corporate": 96}

def pad(freqs, sec):
    t = t_axis(sec); x = np.zeros_like(t)
    for f in freqs:
        for h, amp in ((1, 1.0), (2, 0.3), (3, 0.1)):
            detune = 1 + rng.uniform(-0.002, 0.002)
            x += amp * np.sin(2 * np.pi * f * h * detune * t + rng.uniform(0, 6.28))
    x *= env_adsr(len(t), a=0.6, d=0.5, s=0.85, r=0.8)
    return x

def pluck(f, sec):
    t = t_axis(sec)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 7) + 0.3 * np.sin(4 * np.pi * f * t) * np.exp(-t * 11)

def kick():
    t = t_axis(0.35); f = 110 * np.exp(-t * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def hat():
    t = t_axis(0.06); n = rng.standard_normal(len(t))
    n = n - lowpass(n, 6000)
    return n * np.exp(-t * 70) * 0.35

def bed(mood, sec=64.0):
    bpm = BPM[mood]; beat = 60 / bpm; bar = beat * 4
    total = int(SR * sec); mix = np.zeros(total)
    chords = PROG[mood]
    # 2 bars per chord
    chord_len = bar * 2
    i, pos = 0, 0.0
    while pos < sec:
        c = chords[i % len(chords)]
        seg = pad([NOTE(n) for n in c], chord_len + 0.8)
        a = int(pos * SR); b = min(total, a + len(seg))
        mix[a:b] += seg[: b - a] * 0.22
        # bass on the root
        bass = pad([NOTE(c[0] - 12)], chord_len + 0.5) * 0.18
        b2 = min(total, a + len(bass)); mix[a:b2] += bass[: b2 - a]
        # arpeggio for the livelier moods
        if mood in ("uplifting", "energetic", "tech", "corporate"):
            step = beat / (2 if mood != "tech" else 4)
            k = 0
            while k * step < chord_len:
                n = c[k % 3] + 12 * (1 if mood != "warm" else 0)
                pl = pluck(NOTE(n), 0.5) * (0.09 if mood == "tech" else 0.07)
                s0 = int((pos + k * step) * SR); s1 = min(total, s0 + len(pl))
                if s0 < total: mix[s0:s1] += pl[: s1 - s0]
                k += 1
        pos += chord_len; i += 1
    # light drums
    if mood in ("energetic", "tech", "uplifting"):
        K, Hh = kick(), hat()
        nbeats = int(sec / beat)
        for b in range(nbeats):
            s0 = int(b * beat * SR)
            if mood != "uplifting" or b % 2 == 0:
                s1 = min(total, s0 + len(K)); mix[s0:s1] += K[: s1 - s0] * 0.32
            h0 = int((b + 0.5) * beat * SR); h1 = min(total, h0 + len(Hh))
            if h0 < total: mix[h0:h1] += Hh[: h1 - h0] * (0.5 if mood == "tech" else 0.35)
    mix = lowpass(mix, 7000)
    # crossfade the tail into the head so the bed loops seamlessly
    xf = int(SR * 2.0)
    mix[:xf] = mix[:xf] * np.linspace(0, 1, xf) + mix[-xf:] * np.linspace(1, 0, xf)
    mix = mix[: total - xf]
    return norm(mix, 0.8)

def whoosh():
    t = t_axis(0.7); n = rng.standard_normal(len(t))
    cut = np.linspace(400, 5000, len(t)) ** 1.0
    y = np.zeros_like(n); acc = 0.0
    for i in range(len(n)):
        a = np.exp(-2 * np.pi * cut[i] / SR); acc = (1 - a) * n[i] + a * acc; y[i] = acc
    e = np.sin(np.pi * np.linspace(0, 1, len(t))) ** 2
    return norm(y * e, 0.7)

def pop():
    t = t_axis(0.12); f = 900 * np.exp(-t * 30) + 300
    return norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 40), 0.6)

def click():
    t = t_axis(0.05); n = rng.standard_normal(len(t))
    return norm((n - lowpass(n, 2000)) * np.exp(-t * 160), 0.5)

def impact():
    t = t_axis(1.2); f = 70 * np.exp(-t * 4) + 35
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3)
    n = lowpass(rng.standard_normal(len(t)), 1200) * np.exp(-t * 12) * 0.6
    return norm(sub + n, 0.8)

def riser():
    t = t_axis(1.5); f = np.linspace(200, 1400, len(t))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.3
    n = lowpass(rng.standard_normal(len(t)), 3000) * 0.5
    return norm((tone + n) * np.linspace(0, 1, len(t)) ** 2, 0.6)

for mood in PROG:
    sf.write(OUT / f"bed_{mood}.wav", bed(mood), SR)
    print("bed", mood)
for name, fn in {"whoosh": whoosh, "pop": pop, "click": click, "impact": impact, "riser": riser}.items():
    sf.write(OUT / f"sfx_{name}.wav", fn(), SR)
    print("sfx", name)
