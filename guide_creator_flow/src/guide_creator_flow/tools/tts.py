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

# Do NOT split narration into per-sentence synthesis calls to add pauses.
# Measured: Kokoro already leaves 0.34-0.38s at sentence boundaries within a
# single call, which is a natural read. Splitting makes it pad every chunk
# separately — the same line went 7.83s/0.36s gaps as one call, but
# 9.12s/0.8s gaps per sentence, before adding any silence of our own.

# Voice catalog. Each composer voice id maps to a Kokoro voice (the default
# backend — local, Apache-2.0, commercial-safe, with real word-level timings)
# and an OpenAI tts-1-hd voice (used when OPENAI_API_KEY is set). Kokoro voice
# prefixes pick the G2P language: a* = American, b* = British, h* = Hindi —
# see _pipeline(). A voice therefore *is* a language choice, which is why every
# entry declares `lang`: callers pick the language, `default_voice()` picks the
# voice, and nothing downstream has to know about Kokoro's naming. `speed`
# tunes the read pace (1.0 = native).
#
# The OpenAI column is language-agnostic on purpose: tts-1-hd detects the
# language from the text itself, so the Hindi ids just name a voice whose
# timbre matches its Kokoro counterpart.
VOICES = {
    # English
    "nova":   {"label": "Nova",   "kokoro": "af_heart",   "openai": "nova",    "speed": 1.0,  "lang": "en"},
    "atlas":  {"label": "Atlas",  "kokoro": "am_michael", "openai": "onyx",    "speed": 0.97, "lang": "en"},
    "juno":   {"label": "Juno",   "kokoro": "af_bella",   "openai": "shimmer", "speed": 1.03, "lang": "en"},
    "ryan":   {"label": "Ryan",   "kokoro": "bm_george",  "openai": "echo",    "speed": 1.0,  "lang": "en"},
    "sonia":  {"label": "Sonia",  "kokoro": "bf_emma",    "openai": "fable",   "speed": 1.0,  "lang": "en"},
    "guy":    {"label": "Guy",    "kokoro": "am_puck",    "openai": "alloy",   "speed": 0.98, "lang": "en"},
    # Hindi
    "ananya": {"label": "Ananya", "kokoro": "hf_alpha",   "openai": "nova",    "speed": 1.0,  "lang": "hi"},
    "isha":   {"label": "Isha",   "kokoro": "hf_beta",    "openai": "shimmer", "speed": 1.0,  "lang": "hi"},
    "aarav":  {"label": "Aarav",  "kokoro": "hm_omega",   "openai": "onyx",    "speed": 1.0,  "lang": "hi"},
    "vihaan": {"label": "Vihaan", "kokoro": "hm_psi",     "openai": "echo",    "speed": 1.0,  "lang": "hi"},
}
DEFAULT_VOICE_ID = "nova"
# The voice a language falls back to when the caller names no specific one.
DEFAULT_VOICE_BY_LANG = {"en": "nova", "hi": "ananya"}
OPENAI_TTS_MODEL = "tts-1-hd"


def _voice(voice_id: str) -> dict:
    return VOICES.get((voice_id or "").strip().lower(), VOICES[DEFAULT_VOICE_ID])


def default_voice(lang: str) -> str:
    """The default voice id for a narration language."""
    return DEFAULT_VOICE_BY_LANG.get((lang or "").strip().lower(), DEFAULT_VOICE_ID)


def voices_for(lang: str) -> tuple[str, ...]:
    """The voice ids that actually speak `lang`. Picking an English voice for a
    Hindi script would route the text through the English G2P and produce
    gibberish, so callers must constrain their choices to this set."""
    want = (lang or "").strip().lower()
    return tuple(k for k, v in VOICES.items() if v["lang"] == want)


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
    # Hindi equivalents — a Hindi script's labels leak the same way, and an
    # unstripped one gets read aloud.
    "हुक", "समस्या", "समाधान", "परिचय", "निष्कर्ष", "सारांश", "अंत", "शुरुआत",
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
_SCENE_RE = re.compile(r"^\s*(?:scene|दृश्य)\s*\d+\s*" + _SEP + r"\s+", re.IGNORECASE)
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


# Emoji + pictograph ranges (misc symbols, dingbats, emoticons, transport,
# supplemental pictographs, flags) plus the joiners that glue them together.
# Local models sprinkle these into titles/captions; the product rule is
# NO emojis unless the user's prompt explicitly asks.
_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"   # emoticons, pictographs, transport, supplemental
    "\U00002600-\U000027BF"   # misc symbols + dingbats (☀★✅❌…)
    "\U0001F1E6-\U0001F1FF"   # regional indicators (flags)
    "\U00002B00-\U00002BFF"   # arrows/stars rendered as emoji (⬆⭐…)
    "\\uFE0F\\u200D"          # variation selector + zero-width joiner
    "]+"
)


def strip_emojis(text: str) -> str:
    """Remove emojis/pictographs and collapse the whitespace they leave."""
    cleaned = _EMOJI_RE.sub("", text or "")
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip()


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
# KPipeline is not documented as thread-safe, and every scene shares one
# instance — so concurrent scene synthesis (main.generate_narration's pool)
# serializes through this lock. Only the OpenAI path runs truly in parallel.
_KOKORO_INFER_LOCK = threading.Lock()


def _shorten_espeak_data_path() -> None:
    """espeak-ng keeps its data path in a fixed 160-byte buffer; a longer
    path is silently ignored and espeak exit(1)s on the wheel's nonexistent
    build-time path, killing the whole process. misaki points it at the
    venv's espeakng_loader data at import time, which can blow the limit on
    deep checkouts (e.g. CI) — re-route it through a short symlink. Must run
    after the kokoro/misaki import (misaki resets the path) and before
    KPipeline instantiation (which initializes espeak)."""
    try:
        import shutil
        import tempfile

        import espeakng_loader
        from phonemizer.backend.espeak.wrapper import EspeakWrapper

        data_path = str(espeakng_loader.get_data_path())
        if len(data_path) < 140:
            return
        # A real copy, not a symlink: phonemizer resolve()s the path before
        # handing it to espeak, so a symlink would round-trip to the long one.
        # tempfile honours TMPDIR, which may itself be long — force /tmp.
        copy = Path(tempfile.mkdtemp(prefix="esng-", dir="/tmp")) / "espeak-ng-data"
        shutil.copytree(data_path, copy)
        EspeakWrapper.set_data_path(str(copy))
    except Exception as e:
        print(f"  espeak data-path shortening skipped ({e})")


def _pipeline(lang_code: str):
    with _PIPELINE_LOCK:
        if lang_code not in _PIPELINES:
            from kokoro import KPipeline

            _shorten_espeak_data_path()
            _PIPELINES[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
        return _PIPELINES[lang_code]


def warmup(lang: str = "en") -> None:
    """Preload torch + the pipeline the run's language will actually use.
    Called from a background thread at flow start so the ~10s load happens
    while the crew is still writing. Warming the wrong language would just
    pay the load twice, so this keys off the language's default voice."""
    try:
        _pipeline(_voice(default_voice(lang))["kokoro"][0])
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
    pipeline = _pipeline(voice[0])  # 'a' → American English, 'b' → British, 'h' → Hindi
    chunks: list[np.ndarray] = []
    words: list[dict] = []
    offset = 0.0
    with _KOKORO_INFER_LOCK:
        results = list(pipeline(text, voice=voice, speed=speed))
    for result in results:
        audio = result.audio
        samples = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
        for tok in result.tokens or []:
            # Skip unaligned tokens and bare punctuation (Kokoro emits ','/'.'
            # as their own timed tokens; captions only want spoken words).
            if tok.start_ts is None or tok.end_ts is None:
                continue
            # Any script's letters/digits count, not just Latin — Hindi tokens
            # are Devanagari. (`[^\W_]` = word char minus underscore; str
            # patterns are Unicode-aware by default.)
            if not re.search(r"[^\W_]", tok.text):
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


def _openai_synthesize(
    text: str, out_path: Path, voice: str, speed: float = 1.0
) -> tuple[float, list[dict]]:
    """Synthesize with OpenAI tts-1-hd. Raises on any failure so the caller can
    fall back to local Kokoro."""
    from openai import OpenAI

    client = OpenAI(api_key=_openai_key())
    with client.audio.speech.with_streaming_response.create(
        model=OPENAI_TTS_MODEL, voice=voice, input=text, response_format="wav",
        # Without this the catalog's per-voice pace is silently dropped here,
        # so the same voice id reads at a different speed than it does locally.
        speed=speed,
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
            return _openai_synthesize(cleaned, out_path, spec["openai"], spec["speed"])
        except Exception as e:
            print(f"  OpenAI TTS failed ({e}); falling back to Kokoro")
    return _kokoro_synthesize(cleaned, out_path, spec["kokoro"], spec["speed"])
