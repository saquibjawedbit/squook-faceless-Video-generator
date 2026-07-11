"""Render-IR compiler: turns the direction script + fetched assets into
machine-level render instructions (output/render_ir.json).

Pass 1 (code): estimate scene duration from narration word count.
Pass 2 (LLM):  Technical Director agent picks creative treatment per scene.
Pass 3 (code): resolver clamps everything against measured clip durations
               and converts to frames.
"""
import json
import math
import os
import random
import re
import secrets
from pathlib import Path
from typing import Literal

from crewai import Agent
from pydantic import BaseModel

from guide_creator_flow.crews.content_crew.content_crew import llm
from guide_creator_flow.tools import icons

FPS = 30
WIDTH = 1920
HEIGHT = 1080
# Loudness is baked in at the source (tts.TARGET_LUFS) because Remotion
# clamps <Audio volume> at 1 during render. Kept for future attenuation use.
NARRATION_GAIN = 1.0
MUSIC_SRC = "output/audio/music_bed.wav"
# The synth bed is RMS-normalised to -20 dBFS, so 0.3 sits it ~14 dB under the
# narration. A fetched commercial track is fully mastered (~-9..-12 dBFS), i.e.
# ~10 dB hotter, so it needs a correspondingly lower gain to sit at the same
# level under the voice-over.
MUSIC_VOLUME = 0.3
MUSIC_TRACK_VOLUME = 0.11
# Synthesized SFX kit (tools/sfx.py) mix levels — accents, never foreground.
SFX_WHOOSH_VOLUME = 0.40
SFX_IMPACT_VOLUME = 0.50
SFX_POP_VOLUME = 0.45
SFX_RISER_VOLUME = 0.32
WORDS_PER_SECOND = 2.5
SCENE_PADDING_S = 0.8
MIN_SCENE_S = 3
TRIM_SKIP_FRACTION = 0.15
MIN_PLAYBACK_RATE = 0.4
MAX_TRANSITION_S = 0.6


# --------------------------------------------------------- Design Director

MOODS = ("premium", "playful", "calm", "bold", "warm", "nature")
MUSIC_MOODS = ("calm", "uplifting", "warm", "minimal")

# palette: bg, bg used behind lottie, accent, secondary accent, body text.
# Three variants per mood so the background isn't a coin-flip between two looks.
PALETTES = {
    "premium": [
        {"bg": "#0a0a0c", "bg_light": "#ececec", "accent": "#d4d4d8", "accent2": "#3b82f6", "text": "#ffffff"},
        {"bg": "#0e0e14", "bg_light": "#e8e6e0", "accent": "#c9b037", "accent2": "#8b9dc3", "text": "#ffffff"},
        {"bg": "#0b0d10", "bg_light": "#eef0f2", "accent": "#c0a062", "accent2": "#6b7280", "text": "#ffffff"},
    ],
    "playful": [
        {"bg": "#1a1030", "bg_light": "#fdf0f6", "accent": "#ff7ac6", "accent2": "#ffd166", "text": "#ffffff"},
        {"bg": "#101828", "bg_light": "#eef6ff", "accent": "#ffd166", "accent2": "#4cc9f0", "text": "#ffffff"},
        {"bg": "#12102b", "bg_light": "#f3f0ff", "accent": "#7c5cff", "accent2": "#ff8fab", "text": "#ffffff"},
    ],
    "calm": [
        {"bg": "#0f1116", "bg_light": "#e9edf2", "accent": "#6ee7f9", "accent2": "#4f46e5", "text": "#ffffff"},
        {"bg": "#071a1e", "bg_light": "#e6f4f1", "accent": "#4cc9f0", "accent2": "#80ffdb", "text": "#ffffff"},
        {"bg": "#0c1418", "bg_light": "#e8f1f2", "accent": "#7dd3fc", "accent2": "#a7f3d0", "text": "#ffffff"},
    ],
    "bold": [
        {"bg": "#180a0a", "bg_light": "#f6ecec", "accent": "#ff4d4d", "accent2": "#ffb703", "text": "#ffffff"},
        {"bg": "#12071c", "bg_light": "#f1eaf7", "accent": "#b388ff", "accent2": "#ff5d8f", "text": "#ffffff"},
        {"bg": "#1a0b12", "bg_light": "#fdeef2", "accent": "#ff2e63", "accent2": "#ffd23f", "text": "#ffffff"},
    ],
    "warm": [
        {"bg": "#1c1210", "bg_light": "#f7efe6", "accent": "#fca311", "accent2": "#e63946", "text": "#fff8f0"},
        {"bg": "#191007", "bg_light": "#f5ecdf", "accent": "#f4a261", "accent2": "#e9c46a", "text": "#fff8f0"},
        {"bg": "#1a1008", "bg_light": "#f8f0e3", "accent": "#ff9f1c", "accent2": "#d62828", "text": "#fff8f0"},
    ],
    "nature": [
        {"bg": "#0d1a12", "bg_light": "#eaf4ec", "accent": "#6ee7a0", "accent2": "#2dd4bf", "text": "#f2fff6"},
        {"bg": "#101c0d", "bg_light": "#f0f5e9", "accent": "#a3e635", "accent2": "#34d399", "text": "#f6ffee"},
        {"bg": "#0b1710", "bg_light": "#e9f3ea", "accent": "#4ade80", "accent2": "#22d3ee", "text": "#f2fff6"},
    ],
}

# Typographic "personalities" the Design Director picks from, based on the topic.
# Anchored to fonts actually installed in the render environment — the old
# Arial/Georgia/Trebuchet stacks all collapsed to one generic fallback, which is
# why every video looked the same. Each entry here renders visibly differently.
# Keys use underscores because _pick() normalises hyphens/spaces to underscores
# when snapping the model's answer — a hyphenated LLM reply ("geometric-sans")
# still resolves here.
# Values are Google Font family names; the renderer loads them (fonts.ts) and
# resolves the name to a webfont stack, so typography renders identically on
# any machine. Keep this catalog in sync with renderer/src/fonts.ts.
FONT_STYLES = {
    "geometric_sans":    "Poppins",
    "condensed_sans":    "Oswald",
    "grotesque_sans":    "Inter",
    "light_sans":        "Montserrat",
    "editorial_serif":   "Playfair Display",
    "classic_serif":     "Lora",
    "techno_mono":       "JetBrains Mono",
    "techno_sans":       "Space Grotesk",
    "display_heavy":     "Anton",
    "display_tall":      "Bebas Neue",
    "editorial_display": "DM Serif Display",
}

# Fallback font per mood, so typography stays tied to meaning even when the LLM
# doesn't name one (or is unavailable).
MOOD_DEFAULT_FONT = {
    "premium": "editorial_serif",
    "playful": "condensed_sans",
    "calm":    "light_sans",
    "bold":    "grotesque_sans",
    "warm":    "classic_serif",
    "nature":  "geometric_sans",
}


def build_theme(prompt: str, mood_pool=None, font_pool=None, guidance: str = "") -> dict:
    """Prompt decides the mood (LLM); a seed decides the concrete design
    within that mood — so re-running the same prompt still varies.
    Set DESIGN_SEED for a reproducible look.

    A content preset may narrow the Design Director's palette: `mood_pool` /
    `font_pool` restrict the choices (and the fallback) to a subset, and
    `guidance` adds a one-line steer. Unknown pool entries are ignored; an empty
    intersection falls back to the full vocabulary."""
    # Restrict the offered moods/fonts to the preset's pools, keeping the
    # authored order. An empty/nonsense pool leaves the full vocabulary.
    moods = tuple(m for m in MOODS if m in set(mood_pool)) if mood_pool else MOODS
    moods = moods or MOODS
    fonts = tuple(f for f in FONT_STYLES if f in set(font_pool)) if font_pool else tuple(FONT_STYLES)
    fonts = fonts or tuple(FONT_STYLES)
    default_mood = moods[0] if mood_pool else "calm"
    default_font = fonts[0] if font_pool else MOOD_DEFAULT_FONT[default_mood]

    mood, music_mood = default_mood, "calm"
    font_style = default_font
    try:
        agent = Agent(
            role="Design Director",
            goal="Choose the art direction that fits a video topic",
            backstory=(
                "You set the art direction for short explainer and ad videos: "
                "you read the topic and choose the emotional register and the "
                "typographic voice the visuals, type, and music should live in."
            ),
            llm=llm,
            verbose=True,
        )
        result = agent.kickoff(
            "Choose the art direction for a short video about:\n"
            f'"{prompt}"\n'
            + (f"{guidance}\n" if guidance else "")
            + f"mood (emotional register): one of {list(moods)}\n"
            f"music: one of {list(MUSIC_MOODS)}\n"
            "font (the typographic personality that best fits this topic — "
            f"e.g. a serif reads editorial/premium, a mono reads technical): "
            f"one of {list(fonts)}\n"
            'Respond with RAW JSON ONLY: {"mood": "...", "music": "...", "font": "..."}'
        )
        text = result.raw.strip()
        fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        data = json.loads(text)
        mood = _pick(data.get("mood"), moods, default_mood)
        music_mood = _pick(data.get("music"), MUSIC_MOODS, "calm")
        # Fallback font must stay inside the pool; only when unconstrained do we
        # fall back to the mood's default font (original behaviour).
        font_fallback = fonts[0] if font_pool else MOOD_DEFAULT_FONT.get(mood, default_font)
        font_style = _pick(data.get("font"), fonts, font_fallback)
    except Exception as e:
        print(f"Design Director failed ({e}); using {default_mood} defaults")

    seed = os.getenv("DESIGN_SEED")
    rng = random.Random(int(seed) if seed else secrets.randbits(32))
    palette = rng.choice(PALETTES[mood])
    theme = {
        "mood": mood,
        "palette": palette,
        "font": {
            "family": FONT_STYLES[font_style],
            "style": font_style,
            "caption_size": rng.randint(40, 52),
            "title_size": rng.randint(80, 100),
        },
        "music": {
            "mood": music_mood,
            # ±3 semitones so even the same mood sits in a different key
            "transpose": round(2 ** (rng.randint(-3, 3) / 12), 4),
        },
    }
    print(
        f"Theme: mood={mood} font={font_style} "
        f"accent={palette['accent']} music={music_mood}"
    )
    return theme


# ---------------------------------------------------------------- Pass 1

def estimate_narration_seconds(narration: str) -> int:
    """Speech time at ~2.5 wps + pause bonuses + breathing padding, ceil'd.
    Erring slow is deliberate: a long scene holds the visual, a short one
    cuts narration mid-word."""
    text = re.sub(r"[*_`#]", "", narration).strip()
    words = len(text.split())
    sentence_pauses = len(re.findall(r"[.?!]", text))
    minor_pauses = len(re.findall(r"[,;:—–-]", text))
    speech = words / WORDS_PER_SECOND + 0.3 * sentence_pauses + 0.15 * minor_pauses
    return max(MIN_SCENE_S, math.ceil(speech + SCENE_PADDING_S))


# ---------------------------------------------------------------- Pass 2

class ScenePlan(BaseModel):
    index: int
    fit: Literal["cover", "contain"] = "cover"
    if_too_short: Literal["loop", "freeze", "slow_down"] = "loop"
    playback_rate: float = 1.0
    ken_burns: Literal["none", "zoom_in", "zoom_out", "pan_left", "pan_right"] = "none"
    text_position: Literal["lower_third", "center", "top", "none"] = "lower_third"
    text_enter: Literal["fade_up", "typewriter", "slide_in", "none"] = "fade_up"
    transition_out: Literal["cut", "crossfade", "slide"] = "crossfade"
    transition_duration_s: float = 0.4


class RenderPlan(BaseModel):
    scenes: list[ScenePlan]


def default_scene_plan(fact: dict, ken_burns_all: bool = False) -> ScenePlan:
    is_still = fact["media"] in ("photo", "image")
    return ScenePlan(
        index=fact["index"],
        ken_burns="zoom_in" if (is_still or (ken_burns_all and is_still)) else "none",
        text_position="lower_third" if fact["on_screen_text"] else "none",
        text_enter="fade_up" if fact["on_screen_text"] else "none",
    )


def _pick(value, allowed: tuple, fallback: str) -> str:
    """Snap a model-invented value onto the enum (prefix match), else fallback."""
    v = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    if v in allowed:
        return v
    for option in allowed:
        if v.startswith(option):
            return option
    return fallback


def _sanitize_scene_plan(entry: dict) -> ScenePlan | None:
    try:
        index = int(entry["index"])
    except (KeyError, TypeError, ValueError):
        return None
    try:
        rate = float(entry.get("playback_rate", 1.0))
    except (TypeError, ValueError):
        rate = 1.0
    try:
        transition_s = float(entry.get("transition_duration_s", 0.4))
    except (TypeError, ValueError):
        transition_s = 0.4
    return ScenePlan(
        index=index,
        fit=_pick(entry.get("fit"), ("cover", "contain"), "cover"),
        if_too_short=_pick(entry.get("if_too_short"), ("loop", "freeze", "slow_down"), "loop"),
        playback_rate=rate,
        ken_burns=_pick(entry.get("ken_burns"), ("none", "zoom_in", "zoom_out", "pan_left", "pan_right"), "none"),
        text_position=_pick(entry.get("text_position"), ("lower_third", "center", "top", "none"), "none"),
        text_enter=_pick(entry.get("text_enter"), ("fade_up", "typewriter", "slide_in", "none"), "fade_up"),
        transition_out=_pick(entry.get("transition_out"), ("cut", "crossfade", "slide"), "crossfade"),
        transition_duration_s=transition_s,
    )


def _parse_render_plan(raw: str) -> RenderPlan:
    """Tolerant parse: local models love markdown fences, bare arrays, and
    near-miss enum values. Salvage every scene entry we can."""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    data = json.loads(text)
    if isinstance(data, list):
        data = {"scenes": data}
    entries = data.get("scenes", []) if isinstance(data, dict) else []
    plans = [p for p in (_sanitize_scene_plan(e) for e in entries if isinstance(e, dict)) if p]
    return RenderPlan(scenes=plans)


def compile_render_plan(scene_facts: list[dict], ken_burns_all: bool = False,
                        guidance: str = "") -> RenderPlan:
    """Pass 2: the Technical Director decides creative treatment only.
    Mechanical truths (trims, frame counts) are resolved in code afterwards.

    `ken_burns_all` guarantees a Ken Burns move on every still (for the images
    preset); `guidance` adds a one-line genre steer to the prompt."""
    agent = Agent(
        role="Technical Director",
        goal=(
            "Choose the render treatment for every scene of a motion-graphics "
            "video so the footage serves the story"
        ),
        backstory=(
            "You're a motion-graphics technical director. You decide how stock "
            "footage is treated: how a clip fills the frame, what to do when a "
            "clip is shorter than its scene, how photos move (Ken Burns), where "
            "on-screen text sits and how it enters, and how scenes transition."
        ),
        llm=llm,
        verbose=True,
    )
    prompt = (
        (f"{guidance}\n" if guidance else "")
        + "For EVERY scene below, choose its render treatment. Rules:\n"
        "- fit: 'cover' normally; 'contain' only if cropping would destroy the visual.\n"
        "- if_too_short: what to do when the clip is shorter than the scene "
        "(loop for ambient/abstract footage, freeze for a strong final pose, "
        "slow_down for graceful slow motion).\n"
        "- playback_rate: 1.0 normally, down to 0.5 for moody slow motion.\n"
        "- ken_burns: ONLY for media 'photo' (pick a direction that matches the "
        "visual); 'none' for video or missing media.\n"
        "- text_position/text_enter: 'none' when on_screen_text is empty, "
        "otherwise pick placement and entrance that suit the scene.\n"
        "- transition_out: crossfade as default, cut for hard beat changes, "
        "slide sparingly.\n"
        "Return one entry per scene, same order, matching scene index.\n"
        "Respond with RAW JSON ONLY — no markdown fences, no commentary — as an "
        'object of the form {"scenes": [{"index": 1, "fit": "cover", '
        '"if_too_short": "loop", "playback_rate": 1.0, "ken_burns": "none", '
        '"text_position": "none", "text_enter": "none", '
        '"transition_out": "crossfade", "transition_duration_s": 0.4}, ...]}\n\n'
        f"Scenes:\n{json.dumps(scene_facts, indent=2)}"
    )
    result = agent.kickoff(prompt)
    plan = _parse_render_plan(result.raw)
    if not plan.scenes:
        raise ValueError("Technical Director returned no usable plan")
    if ken_burns_all:
        # Images preset: every still must move. Force a default zoom where the
        # director left it static (leave any direction it did pick).
        stills = {f["index"] for f in scene_facts if f.get("media") in ("photo", "image")}
        for scene_plan in plan.scenes:
            if scene_plan.index in stills and scene_plan.ken_burns == "none":
                scene_plan.ken_burns = "zoom_in"
    return plan


# ------------------------------------------------------- Pass 2b: graphics

GRAPHIC_KINDS = ("node_graph", "bar_chart", "counter", "icon_row", "title_card", "annotate")
# Concept vocabulary the Graphic Designer picks from for icon_row scenes. These
# are resolved to real Iconify SVGs at build time (tools/icons.py); the list is
# a menu of well-supported concepts, but any word resolves via Iconify search.
ICON_NAMES = (
    "brain", "chip", "cpu", "database", "network", "server", "eye", "gear",
    "chart", "growth", "lightbulb", "idea", "clock", "check", "cross", "arrow",
    "rocket", "cloud", "lock", "shield", "code", "money", "people", "user",
    "globe", "phone", "email", "search", "star", "heart", "fire", "flash",
    "speed", "target", "map", "calendar", "document", "folder", "cart", "gift",
    "warning", "info", "link", "robot", "atom", "dna", "leaf", "sun", "key",
    "trophy", "book", "wifi", "battery",
)


class GraphicSpec(BaseModel):
    scene_index: int
    kind: Literal["node_graph", "bar_chart", "counter", "icon_row", "title_card", "annotate"]
    title: str = ""
    subtitle: str = ""
    labels: list[str] = []
    values: list[float] = []
    icons: list[str] = []
    node_layers: list[int] = []
    pulse: Literal["forward", "backward", "none"] = "forward"
    number: float = 0
    suffix: str = ""
    label: str = ""
    annotation: Literal["arrow", "circle", "underline"] = "circle"


def fallback_graphic(fact: dict) -> GraphicSpec:
    title = fact.get("on_screen_text") or " ".join(fact["visual"].split()[:6])
    return GraphicSpec(scene_index=fact["index"], kind="title_card", title=title)


def _sanitize_graphic(entry: dict, fact: dict) -> GraphicSpec:
    def clean(v, limit):
        # JSON null and the model literally writing "None"/"null" both mean empty.
        if v is None or str(v).strip().lower() in ("none", "null"):
            return ""
        return str(v).strip()[:limit]

    def floats(v):
        out = []
        for x in v if isinstance(v, (list, tuple)) else []:
            try:
                out.append(float(x))
            except (TypeError, ValueError):
                pass
        return out

    def strings(v):
        if not isinstance(v, (list, tuple)):
            return []
        return [s for s in (clean(x, 60) for x in v) if s]

    try:
        number = float(entry.get("number") or 0)
    except (TypeError, ValueError):
        number = 0
    node_layers = [max(1, min(8, int(n))) for n in floats(entry.get("node_layers", []))][:5]
    spec = GraphicSpec(
        scene_index=fact["index"],
        kind=_pick(entry.get("kind"), GRAPHIC_KINDS, "title_card"),
        title=clean(entry.get("title"), 80),
        subtitle=clean(entry.get("subtitle"), 120),
        labels=strings(entry.get("labels", []))[:8],
        values=floats(entry.get("values", []))[:8],
        icons=[_pick(i, ICON_NAMES, "gear") for i in strings(entry.get("icons", []))][:6],
        node_layers=node_layers,
        pulse=_pick(entry.get("pulse"), ("forward", "backward", "none"), "forward"),
        number=number,
        suffix=clean(entry.get("suffix"), 8),
        label=clean(entry.get("label"), 60),
        annotation=_pick(entry.get("annotation"), ("arrow", "circle", "underline"), "circle"),
    )
    # Kind-specific minimums so components always have something to draw.
    if spec.kind == "node_graph" and not spec.node_layers:
        spec.node_layers = [3, 4, 2]
    if spec.kind == "bar_chart" and len(spec.values) < 2:
        spec.values = [3, 6, 4, 8]
    if spec.kind == "icon_row" and not spec.icons:
        spec.icons = ["gear", "chart", "lightbulb"]
    if spec.kind == "counter" and spec.number <= 0:
        # A counter with nothing to count teaches nothing; show the idea as a card.
        return GraphicSpec(
            scene_index=fact["index"],
            kind="title_card",
            title=spec.label or spec.title or fact.get("on_screen_text", "") or
            " ".join(fact["visual"].split()[:6]),
        )
    if spec.kind == "title_card" and not spec.title:
        return fallback_graphic(fact)
    return spec


def design_graphics(graphic_facts: list[dict], guidance: str = "") -> dict[int, GraphicSpec]:
    """Design animated graphics for scenes the curator flagged as 'graphic'.
    Returns {scene_index: spec}; falls back to title cards on any failure.
    `guidance` adds an optional one-line genre steer to the prompt."""
    if not graphic_facts:
        return {}
    agent = Agent(
        role="Motion Graphics Designer",
        goal="Design the animated graphic for each scene using a fixed component vocabulary",
        backstory=(
            "You design explainer-video motion graphics. You express each scene "
            "through one of six components: node_graph (layered network diagram), "
            "bar_chart (animated bars), counter (big animated number), icon_row "
            "(icons with labels), title_card (headline), annotate (arrow/circle/"
            "underline with a label). You pick the component that best teaches "
            "the scene's idea and fill in its parameters."
        ),
        llm=llm,
        verbose=True,
    )
    prompt = (
        (f"{guidance}\n" if guidance else "")
        + "For EVERY scene below choose ONE graphic component and its parameters.\n"
        "Components and their parameters:\n"
        "- node_graph: node_layers (list of 2-5 ints, nodes per layer), labels "
        "(optional, one per layer), pulse ('forward'|'backward'|'none')\n"
        "- bar_chart: values (2-8 numbers), labels (one per value), title\n"
        "- counter: number, suffix (e.g. 'M', '%'), label\n"
        f"- icon_row: icons (2-6 from: {', '.join(ICON_NAMES)}), labels (one per icon)\n"
        "- title_card: title (short headline), subtitle (optional)\n"
        "- annotate: annotation ('arrow'|'circle'|'underline'), label (the callout text)\n"
        "Respond with RAW JSON ONLY, no markdown fences, as "
        '{"graphics": [{"scene_index": 1, "kind": "node_graph", ...}, ...]} '
        "covering every scene.\n\n"
        f"Scenes:\n{json.dumps(graphic_facts, indent=2)}"
    )
    facts_by_index = {f["index"]: f for f in graphic_facts}
    specs = {f["index"]: fallback_graphic(f) for f in graphic_facts}
    try:
        result = agent.kickoff(prompt)
        text = result.raw.strip()
        fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        data = json.loads(text)
        entries = data.get("graphics", data) if isinstance(data, dict) else data
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict):
                continue
            try:
                index = int(entry.get("scene_index"))
            except (TypeError, ValueError):
                continue
            fact = facts_by_index.get(index)
            if fact:
                specs[index] = _sanitize_graphic(entry, fact)
    except Exception as e:
        print(f"Graphic Designer failed ({e}); using title-card fallbacks")
    return specs


def _graphic_layer(spec: GraphicSpec, theme: dict | None = None, scene_idx: int = 0) -> dict:
    params: dict = {}
    if spec.kind == "node_graph":
        params = {"node_layers": spec.node_layers, "labels": spec.labels, "pulse": spec.pulse}
    elif spec.kind == "bar_chart":
        params = {"values": spec.values, "labels": spec.labels, "title": spec.title}
    elif spec.kind == "counter":
        params = {"number": spec.number, "suffix": spec.suffix, "label": spec.label}
    elif spec.kind == "icon_row":
        params = {"icons": spec.icons, "labels": spec.labels}
        # Resolve each concept to a real Iconify SVG, recoloured to the accent.
        # icon_srcs[i] is null when a fetch fails → renderer falls back to emoji.
        accent = (theme or {}).get("palette", {}).get("accent", "#ffffff")
        srcs: list = []
        for i, concept in enumerate(spec.icons):
            rel = f"output/assets/icons/s{scene_idx}_{i}.svg"
            ok = icons.fetch(concept, Path(rel), color=accent, size=240)
            srcs.append(rel if ok else None)
        if any(srcs):
            params["icon_srcs"] = srcs
    elif spec.kind == "title_card":
        params = {"title": spec.title, "subtitle": spec.subtitle}
    elif spec.kind == "annotate":
        params = {"annotation": spec.annotation, "label": spec.label}
    return {"type": "graphic", "kind": spec.kind, "params": params}


# ---------------------------------------------------------------- Pass 3

def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _resolve_video_layer(asset: dict, plan: ScenePlan, duration_s: float) -> dict:
    clip = asset.get("clip_duration_s") or 0
    rate = _clamp(plan.playback_rate or 1.0, MIN_PLAYBACK_RATE, 1.25)
    layer = {
        "type": "video",
        "src": asset["local_path"],
        "fit": plan.fit,
        "playback_rate": rate,
        "loop": False,
        "freeze_last": False,
    }
    if clip <= 0:
        # Duration unknown (older fetch): play from the start and loop if needed.
        layer.update({"trim_start_s": 0, "trim_end_s": None, "loop": True})
        return layer

    needed = duration_s * rate  # source seconds consumed
    skip = clip * TRIM_SKIP_FRACTION
    if clip - skip >= needed:
        # Enough footage past the intro: center the window in what remains.
        start = skip + (clip - skip - needed) / 2
    elif clip >= needed:
        # Tight fit: drop the intro-skip, center in the full clip.
        start = (clip - needed) / 2
    else:
        # Clip genuinely shorter than the scene: apply the chosen strategy.
        if plan.if_too_short == "slow_down":
            rate = _clamp(clip / duration_s, MIN_PLAYBACK_RATE, 1.0)
            layer["playback_rate"] = round(rate, 2)
            needed = duration_s * rate
            if clip >= needed:
                start = (clip - needed) / 2
                layer.update({
                    "trim_start_s": round(start, 2),
                    "trim_end_s": round(start + needed, 2),
                })
                return layer
            layer["loop"] = True  # still short even at min rate
        elif plan.if_too_short == "freeze":
            layer["freeze_last"] = True
        else:
            layer["loop"] = True
        layer.update({"trim_start_s": 0, "trim_end_s": round(clip, 2)})
        return layer

    layer.update({
        "trim_start_s": round(start, 2),
        "trim_end_s": round(start + needed, 2),
    })
    return layer


def resolve_ir(
    script: dict,
    plan: RenderPlan,
    graphics: dict[int, GraphicSpec] | None = None,
    fps: int = FPS,
    width: int = WIDTH,
    height: int = HEIGHT,
    theme: dict | None = None,
    music_enabled: bool = True,
    music_src: str | None = None,
    music_volume: float = MUSIC_VOLUME,
    music_credit: dict | None = None,
    sfx: dict | None = None,
) -> dict:
    plans = {p.index: p for p in plan.scenes}
    graphics = graphics or {}
    lottie_bg = (theme or {}).get("palette", {}).get("bg_light", "#e9edf2")
    ir_scenes = []
    cursor = 0
    scene_count = len(script["scenes"])
    for scene_i, scene in enumerate(script["scenes"]):
        sp = plans.get(scene["index"]) or default_scene_plan({
            "index": scene["index"],
            "media": (scene.get("asset") or {}).get("media_type", "none"),
            "on_screen_text": scene.get("on_screen_text", ""),
        })
        duration_s = scene["duration_seconds"]
        duration_frames = round(duration_s * fps)
        layers = []

        # The scene's sequence extends into the next scene during a transition;
        # the clip must keep playing through that overlap or the crossfade dips
        # to black. Size the trim window for scene + transition.
        overlap_s = 0.0 if sp.transition_out == "cut" else _clamp(
            sp.transition_duration_s, 0.2, min(MAX_TRANSITION_S, duration_s / 2)
        )

        graphic = graphics.get(scene["index"])

        asset = scene.get("asset")
        if asset and asset.get("media_type") == "video":
            layers.append(_resolve_video_layer(asset, sp, duration_s + overlap_s))
        elif asset and asset.get("media_type") == "lottie":
            # Most public Lottie art is authored on light backgrounds; dark
            # fills vanish on our dark theme.
            layers.append({"type": "solid", "color": lottie_bg})
            layers.append({
                "type": "lottie",
                "src": asset["local_path"],
                "loop": True,
            })
        elif asset and asset.get("media_type") == "photo":
            layers.append({
                "type": "image",
                "src": asset["local_path"],
                "fit": sp.fit,
                "ken_burns": sp.ken_burns if sp.ken_burns != "none" else "zoom_in",
            })
        else:
            # Ambient shader instead of a flat solid, chosen to fit the beat and
            # varied by a per-scene seed so repeated kinds don't feel flat:
            #   title cards → soft, atmospheric (nebula / aurora / mesh)
            #   data graphics → structured, calm (grid / mesh / rays)
            #   everything else → flowing energy (waves / aurora / rays)
            srng = random.Random(f"{os.getenv('DESIGN_SEED') or '0'}-{scene['index']}")
            if graphic and graphic.kind == "title_card":
                shader = srng.choice(("nebula", "aurora", "mesh"))
            elif graphic and graphic.kind in ("node_graph", "bar_chart", "icon_row", "counter"):
                shader = srng.choice(("grid", "mesh", "rays"))
            else:
                shader = srng.choice(("waves", "aurora", "rays"))
            layers.append({"type": "shader", "kind": shader})

        if graphic:
            layers.append(_graphic_layer(graphic, theme, scene["index"]))

        audio = scene.get("audio")
        if audio:
            layers.append({"type": "audio", "src": audio["src"], "volume": NARRATION_GAIN})

        # Word-timed captions, but only when no on-screen text competes for
        # attention (and never over all-text graphics like title cards).
        words = (audio or {}).get("words") or []
        has_screen_text = bool(scene.get("on_screen_text", "").strip())
        text_heavy_graphic = graphic and graphic.kind in ("title_card", "counter")
        if words and not has_screen_text and not text_heavy_graphic:
            layers.append({"type": "captions", "words": words})

        text = scene.get("on_screen_text", "").strip()
        if graphic and graphic.kind in ("title_card", "counter"):
            text = ""  # those graphics already display their own headline/label
        if text:
            exit_at = max(1.0, duration_s - 0.5)
            layers.append({
                "type": "text",
                "content": text,
                "position": sp.text_position if sp.text_position != "none" else "lower_third",
                "enter": {
                    "anim": sp.text_enter if sp.text_enter != "none" else "fade_up",
                    "at_s": 0.5,
                },
                "exit": {"anim": "fade", "at_s": round(exit_at, 2)},
            })

        # CC BY / CC BY-SA assets (e.g. Wikimedia photos of public figures)
        # legally require visible credit — a small, muted line at the top,
        # away from captions and lower-third text.
        if asset and asset.get("attribution_required") and (asset.get("credit") or "").strip():
            credit = " · ".join(filter(None, [asset["credit"], asset.get("license", "")]))
            layers.append({
                "type": "text",
                "content": credit[:90],
                "position": "top",
                "enter": {"anim": "fade_up", "at_s": 0.2},
                "exit": {"anim": "fade", "at_s": round(max(1.0, duration_s - 0.3), 2)},
                "style": {
                    "font_size": 24,
                    "font_weight": 400,
                    "color": "rgba(255,255,255,0.85)",
                    "bg": "rgba(0,0,0,0.35)",
                },
            })

        transition_s = 0.0
        if sp.transition_out != "cut":
            transition_s = round(_clamp(sp.transition_duration_s, 0.2, min(MAX_TRANSITION_S, duration_s / 2)), 2)

        # ── Sound design (synthesized kit — owned, no licensing) ────────────
        # Deterministic placement: whoosh leading into each transition, an
        # impact under title moments, a pop on counters, and a riser building
        # into the final scene. Subtle by volume; the mix stays voice-first.
        if sfx:
            if sp.transition_out != "cut" and sfx.get("whoosh") and scene_i < scene_count - 1:
                # The whoosh peaks at the end of its 0.7s tail — start it so
                # the peak lands right on the cut point.
                layers.append({
                    "type": "audio", "src": sfx["whoosh"],
                    "volume": SFX_WHOOSH_VOLUME,
                    "start_s": round(max(0.0, duration_s + transition_s - 0.7), 2),
                })
            if graphic and graphic.kind == "title_card" and sfx.get("impact"):
                layers.append({
                    "type": "audio", "src": sfx["impact"],
                    "volume": SFX_IMPACT_VOLUME, "start_s": 0.05,
                })
            elif graphic and graphic.kind == "counter" and sfx.get("pop"):
                layers.append({
                    "type": "audio", "src": sfx["pop"],
                    "volume": SFX_POP_VOLUME, "start_s": 0.3,
                })
            elif text and sfx.get("impact"):
                # Text enters at 0.5s; the hit lands with it.
                layers.append({
                    "type": "audio", "src": sfx["impact"],
                    "volume": SFX_IMPACT_VOLUME * 0.7, "start_s": 0.35,
                })
            if scene_count >= 3 and scene_i == scene_count - 2 and sfx.get("riser"):
                layers.append({
                    "type": "audio", "src": sfx["riser"],
                    "volume": SFX_RISER_VOLUME,
                    "start_s": round(max(0.0, duration_s - 1.6), 2),
                })

        ir_scenes.append({
            "scene": scene["index"],
            "start_frame": cursor,
            "duration_frames": duration_frames,
            "duration_s": duration_s,
            "narration": scene["narration"],
            "layers": layers,
            "transition_out": {"type": sp.transition_out, "duration_s": transition_s},
        })
        cursor += duration_frames

    # Full credits list for the product surface (description, credits panel):
    # every stock asset that carries a credit, mandatory or not.
    credits = []
    for scene in script["scenes"]:
        a = scene.get("asset") or {}
        if (a.get("credit") or "").strip() and a.get("credit") != "user upload":
            credits.append({
                "scene": scene["index"],
                "credit": a["credit"],
                "license": a.get("license", ""),
                "source": a.get("page_url", ""),
                "required": bool(a.get("attribution_required")),
            })

    music_meta = None
    if music_enabled:
        music_meta = {"src": music_src or MUSIC_SRC, "volume": music_volume}
        # Carry the required credit for fetched CC tracks so the product can
        # display attribution; absent for the synthesised (in-house) bed.
        if music_credit:
            music_meta["attribution"] = music_credit

    return {
        "metadata": {
            "title": script["metadata"]["title"],
            "prompt": script["metadata"]["prompt"],
            "fps": fps,
            "width": width,
            "height": height,
            "scene_count": len(ir_scenes),
            "total_frames": cursor,
            "total_duration_seconds": round(cursor / fps, 2),
            "music": music_meta,
            "credits": credits,
            "theme": theme or {},
        },
        "scenes": ir_scenes,
    }
