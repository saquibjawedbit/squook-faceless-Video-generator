import os
import re
from pathlib import Path

import numpy as np
import soundfile as sf

# Narration lands at ~-16 LUFS in the final mix (speech-normal loudness).
# Gain must be baked into the file — Remotion clamps <Audio volume> at 1
# during render — so every synthesized clip is loudness-normalized here.
TARGET_LUFS = -16.0
SAMPLE_RATE = 24_000  # Kokoro's native output rate

# Voice catalog. Each composer voice id maps to a Kokoro voice (the default
# backend — local, Apache-2.0, commercial-safe, with real word-level timings)
# and an OpenAI tts-1-hd voice (used when OPENAI_API_KEY is set). Kokoro voice
# prefixes pick the G2P language: a* = American, b* = British. `speed` tunes
# the read pace (1.0 = native).
VOICES = {
    "nova":  {"label": "Nova",  "kokoro": "af_heart",   "openai": "nova",    "speed": 1.0},
    "atlas": {"label": "Atlas", "kokoro": "am_michael", "openai": "onyx",    "speed": 0.97},
    "juno":  {"label": "Juno",  "kokoro": "af_bella",   "openai": "shimmer", "speed": 1.03},
    "ryan":  {"label": "Ryan",  "kokoro": "bm_george",  "openai": "echo",    "speed": 1.0},
    "sonia": {"label": "Sonia", "kokoro": "bf_emma",    "openai": "fable",   "speed": 1.0},
    "guy":   {"label": "Guy",   "kokoro": "am_puck",    "openai": "alloy",   "speed": 0.98},
}
DEFAULT_VOICE_ID = "nova"
OPENAI_TTS_MODEL = "tts-1-hd"


def _voice(voice_id: str) -> dict:
    return VOICES.get((voice_id or "").strip().lower(), VOICES[DEFAULT_VOICE_ID])


def _openai_key() -> str | None:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    return key if key and key != "YOUR_API_KEY" else None


# Section/structure labels a director tends to prepend to a spoken line. These
# are stage directions, never voiced. Matched only at the very START of the
# line, before an em/en dash or colon, so mid-sentence punctuation is untouched.
_SECTION_LABELS = (
    "hook", "the hook", "problem", "the problem", "solution", "the solution",
    "intro", "introduction", "outro", "cta", "call to action",
    "the ask", "show and tell", "setup", "payoff", "recap",
    "conclusion", "takeaway", "closing", "opening",
)
# Words in a multi-word label may be joined by a space or any hyphen/dash
# variant ("call to action", "call-to-action", "call‑to‑action" with U+2011).
_CONNECT = r"[\s‐-―\-]+"
# Separator that follows a label: a colon or any hyphen/dash variant.
_SEP = r"[:‐-―\-]"


def _label_pattern(label: str) -> str:
    return _CONNECT.join(re.escape(w) for w in re.split(r"[\s\-]+", label))


_LABEL_RE = re.compile(
    r"^\s*(?:" + "|".join(_label_pattern(w) for w in _SECTION_LABELS) + r")\s*" + _SEP + r"\s+",
    re.IGNORECASE,
)
_SCENE_RE = re.compile(r"^\s*scene\s*\d+\s*" + _SEP + r"\s+", re.IGNORECASE)
_BRACKET_RE = re.compile(r"\[[^\]]*\]")  # bracketed stage cues: [cut to…], [upbeat music]

# ── In-prose UI leaks ────────────────────────────────────────────────────────
# The director sometimes narrates the viewer's screen instead of the subject —
# "the big caption flashes 'X'", "the caption reads 'Y'", "the screen pulses
# with 'Z'". The prompt forbids this, but local models slip; this is the
# deterministic net. We match a clause whose subject is a presentation element
# and whose verb is an on-screen-display verb, then drop the whole clause
# (including any quoted caption text it echoes).
_UI_NOUN = (
    r"(?:caption|captions|on-?screen\s+text|subtitle|subtitles|title\s*card|"
    r"headline|heading|banner|label|lower[\s-]?third|call[\s-]?to[\s-]?action|"
    r"cta|callout|call-?out|tagline|overlay|words|text|screen|display)"
)
_UI_VERB = (
    r"(?:reads?(?:\s+out)?|says?|said|flash(?:es|ing)?|show(?:s|ing)?|"
    r"display(?:s|ing)?|appears?|pop(?:s|ping)?(?:\s+up)?|puls(?:es|ing)?|"
    r"glow(?:s|ing)?|spell(?:s|ing)?(?:\s+out)?|animat(?:es|ing)?|slid(?:es|ing)?|"
    r"fad(?:es|ing)?(?:\s+in)?|blink(?:s|ing)?|light(?:s|ing)?\s+up|zoom(?:s|ing)?|"
    r"scroll(?:s|ing)?|roll(?:s|ing)?|announces?|that\s+says?|saying|reading|with)"
)
_QUOTE = r"[\"'“”‘’]"
# The meta clause: an optional leading boundary/connector (kept so we can
# re-emit a sentence break), a presentation subject, an on-screen verb, the
# rest of the clause, and any echoed caption in quotes — up to a clause end.
_UI_CLAUSE_RE = re.compile(
    r"(?ix)"
    r"(?P<lead>^|[.!?]\s+|[,;:]\s*|[—–]\s*|\b(?:and|while|as|then|where|which|that|so)\s+)"
    r"(?:the|a|an|its|our|this|that)?\s*"
    r"(?:big|bold|large|small|final|bright|animated|on-?screen)?\s*"
    + _UI_NOUN + r"\s+" + _UI_VERB + r"\b"
    r"[^.!?]*?"                                        # rest of the clause…
    r"(?:" + _QUOTE + r"[^\"'“”‘’]*" + _QUOTE + r")?"  # …incl. echoed caption
    r"(?=[,;.!?]|$)"
)


def _strip_ui_references(text: str) -> str:
    """Drop clauses that narrate the video's own captions/screen rather than
    the subject. Conservative: if scrubbing would empty the line, keep the
    original (a partly-meta line beats a silent scene)."""
    # Re-emit a sentence break when the removed clause began one; otherwise
    # just a space (the surrounding punctuation is tidied below).
    def _repl(m):
        return ". " if re.search(r"[.!?]", m.group("lead")) else " "

    scrubbed = _UI_CLAUSE_RE.sub(_repl, text)
    if scrubbed == text:
        return text
    # Tidy the seams: repeated/hanging commas, commas hugging a full stop,
    # orphaned connectors, spaces before punctuation, doubled terminators.
    scrubbed = re.sub(r"[,;:]\s*(?=[,;:])", "", scrubbed)
    scrubbed = re.sub(r"([.!?])\s*[,;:]+\s*", r"\1 ", scrubbed)
    scrubbed = re.sub(r"[,;:]+\s*(?=[.!?])", "", scrubbed)
    scrubbed = re.sub(r"(^|[.!?]\s+)(?:and|but|while|as|then|so|which|that|where)\b[\s,]*",
                      r"\1", scrubbed, flags=re.IGNORECASE)
    scrubbed = re.sub(r"\s+([,.;:!?])", r"\1", scrubbed)
    scrubbed = re.sub(r"([.!?])[\s.!?]*(?=[.!?])", "", scrubbed)
    scrubbed = re.sub(r"\s{2,}", " ", scrubbed).strip(" ,;:-")
    # Drop sentences with fewer than two real words (e.g. a lone "Finally.").
    keep = [s.strip() for s in re.split(r"(?<=[.!?])\s+", scrubbed)
            if len(re.findall(r"[A-Za-z]{2,}", s)) >= 2]
    scrubbed = " ".join(keep)
    # Recapitalise sentence starts the scrub may have exposed.
    scrubbed = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), scrubbed)
    return scrubbed.strip() or text.strip()


def sanitize_narration(text: str) -> str:
    """Return only what the voice-over should speak. Strips markdown emphasis,
    bracketed stage cues, a leading section label ('Hook —', 'CTA:',
    'Scene 3 -'), and in-prose UI/caption references the director leaked into
    the spoken line."""
    t = _BRACKET_RE.sub(" ", text or "")
    t = re.sub(r"[*_`#]", "", t)
    # A label may appear once (or, if the model double-prefixed, twice).
    for _ in range(2):
        t = _SCENE_RE.sub("", t)
        t = _LABEL_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    return _strip_ui_references(t)


def clean_narration(text: str) -> str:
    """Backwards-compatible alias — full narration sanitisation before TTS."""
    return sanitize_narration(text)


# Kokoro pipelines are heavyweight (torch + model weights); build one per
# language lazily and reuse it across every scene in the run.
import threading

_PIPELINES: dict[str, object] = {}
_PIPELINE_LOCK = threading.Lock()


def _pipeline(lang_code: str):
    with _PIPELINE_LOCK:
        if lang_code not in _PIPELINES:
            from kokoro import KPipeline

            _PIPELINES[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
        return _PIPELINES[lang_code]


def warmup() -> None:
    """Preload torch + the American-English pipeline (the default voice's).
    Called from a background thread at flow start so the ~10s load happens
    while the crew is still writing."""
    try:
        _pipeline("a")
    except Exception as e:
        print(f"  TTS warmup skipped ({e})")


def _normalize_loudness(samples: np.ndarray, sr: int) -> np.ndarray:
    """Bring speech to TARGET_LUFS (Remotion can't boost, only attenuate).
    Clips shorter than a loudness block fall back to unity gain; a peak
    ceiling stops the makeup gain from clipping."""
    try:
        import pyloudnorm as pyln

        loudness = pyln.Meter(sr).integrated_loudness(samples)
        if np.isfinite(loudness):
            samples = samples * (10 ** ((TARGET_LUFS - loudness) / 20))
    except Exception:
        pass
    peak = np.max(np.abs(samples)) if samples.size else 0.0
    if peak > 0.99:
        samples = samples * (0.99 / peak)
    return samples


def _kokoro_synthesize(
    text: str, out_path: Path, voice: str, speed: float = 1.0
) -> tuple[float, list[dict]]:
    """Synthesize locally with Kokoro-82M; return (duration, word timings).
    The English G2P emits per-token timestamps, so captions get real timings."""
    pipeline = _pipeline(voice[0])  # 'a' → American English, 'b' → British
    chunks: list[np.ndarray] = []
    words: list[dict] = []
    offset = 0.0
    for result in pipeline(text, voice=voice, speed=speed):
        audio = result.audio
        samples = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
        for tok in result.tokens or []:
            # Skip unaligned tokens and bare punctuation (Kokoro emits ','/'.'
            # as their own timed tokens; captions only want spoken words).
            if tok.start_ts is None or tok.end_ts is None:
                continue
            if not re.search(r"[A-Za-z0-9]", tok.text):
                continue
            words.append({
                "word": tok.text,
                "start_s": round(offset + tok.start_ts, 3),
                "end_s": round(offset + tok.end_ts, 3),
            })
        chunks.append(samples)
        offset += len(samples) / SAMPLE_RATE
    samples = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
    samples = _normalize_loudness(samples, SAMPLE_RATE)
    sf.write(str(out_path), samples, SAMPLE_RATE)
    duration = len(samples) / SAMPLE_RATE
    if not words:  # timestamps unavailable (non-English G2P edge case)
        words = _estimate_word_timings(text, duration)
    return duration, words


def _estimate_word_timings(text: str, total_len: float) -> list[dict]:
    """OpenAI TTS returns no word timings, so distribute the words across the
    measured audio length weighted by word length (good enough for captions)."""
    words = text.split()
    weights = [max(1, len(w)) for w in words]
    total_w = sum(weights)
    if not words or total_len <= 0 or total_w == 0:
        return []
    out, t = [], 0.0
    for w, wt in zip(words, weights):
        dur = total_len * wt / total_w
        out.append({"word": w, "start_s": round(t, 3), "end_s": round(t + dur, 3)})
        t += dur
    return out


def _openai_synthesize(text: str, out_path: Path, voice: str) -> tuple[float, list[dict]]:
    """Synthesize with OpenAI tts-1-hd. Raises on any failure so the caller can
    fall back to local Kokoro."""
    from openai import OpenAI

    client = OpenAI(api_key=_openai_key())
    with client.audio.speech.with_streaming_response.create(
        model=OPENAI_TTS_MODEL, voice=voice, input=text, response_format="wav"
    ) as resp:
        resp.stream_to_file(str(out_path))
    samples, sr = sf.read(str(out_path))
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    samples = _normalize_loudness(samples.astype(np.float32), sr)
    sf.write(str(out_path), samples, sr)
    length = len(samples) / sr
    return length, _estimate_word_timings(text, length)


def synthesize(text: str, out_path: Path, voice_id: str = DEFAULT_VOICE_ID) -> tuple[float, list[dict]]:
    """Generate the narration audio file (wav) for the chosen voice; return
    (duration, per-word timings). Uses OpenAI tts-1-hd when a key is set, else
    local Kokoro-82M (Apache-2.0 — safe for commercial use, no network)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cleaned = clean_narration(text)
    spec = _voice(voice_id)
    if _openai_key():
        try:
            return _openai_synthesize(cleaned, out_path, spec["openai"])
        except Exception as e:
            print(f"  OpenAI TTS failed ({e}); falling back to Kokoro")
    return _kokoro_synthesize(cleaned, out_path, spec["kokoro"], spec["speed"])
