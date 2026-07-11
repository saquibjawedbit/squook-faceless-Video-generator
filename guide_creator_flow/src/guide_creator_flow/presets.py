"""Content presets — declarative bundles that bias and constrain generation.

A preset here is the *genre* dimension (educational / animation / images) and is
distinct from the aspect ``preset`` in ``main.py`` (landscape / reel). Each
bundle both hard-constrains its defining trait — the ``media_policy`` is enforced
in code, before ``fetch_assets`` runs, so the genre's promise holds regardless of
what the crew chose — and softly steers tone via ``guidance`` snippets injected
into the crew and director prompts.

Empty / ``None`` fields mean "no opinion — fall through to the default
behaviour". Behaviour lives here, next to the vocabularies in ``ir_builder``; the
server mirrors only id/label/description for the composer UI. A user's custom
preset travels in the trigger payload as a full bundle of the same shape and is
merged onto ``auto`` and used verbatim.
"""

from __future__ import annotations

import copy

# ------------------------------------------------------------ built-in presets

PRESETS: dict[str, dict] = {
    "auto": {
        "id": "auto",
        "label": "Auto",
        "description": "Let the director choose everything from the prompt.",
        "media_policy": {"force": None, "prefer": None, "block": None, "ken_burns_all": False},
        "theme": {"mood_pool": None, "font_pool": None},
        "voice_default": "",
        "music_default": "",
        "guidance": {"writer": "", "director": "", "asset": "", "design": ""},
    },
    "educational": {
        "id": "educational",
        "label": "Educational",
        "description": "Clear explainers driven by diagrams, charts and title cards.",
        "media_policy": {
            "force": None,
            "prefer": ["graphic"],
            "block": None,
            "ken_burns_all": False,
        },
        "theme": {
            "mood_pool": ["premium", "calm"],
            "font_pool": ["grotesque_sans", "geometric_sans", "classic_serif"],
        },
        "voice_default": "",
        "music_default": "",
        "guidance": {
            "writer": "Teach one idea per scene in plain, structured language; define terms "
                      "simply and build from the basics to a clear takeaway.",
            "director": "Favour data-driven motion graphics — diagrams, charts, counters, "
                        "annotated callouts and title cards — over stock footage. Keep every "
                        "layout clean and legible.",
            "asset": "Prefer 'graphic' for concepts, numbers, processes and comparisons; use a "
                     "photo only for a concrete real-world subject a diagram cannot show.",
            "design": "A calm, credible, editorial register with a highly legible typeface.",
        },
    },
    "animation": {
        "id": "animation",
        "label": "Animation",
        "description": "Playful animated illustrations and motion graphics — no stock footage.",
        "media_policy": {
            "force": ["lottie", "graphic"],
            "prefer": None,
            "block": None,
            "ken_burns_all": False,
        },
        "theme": {
            "mood_pool": ["playful", "bold"],
            "font_pool": ["geometric_sans", "display_heavy", "techno_sans"],
        },
        "voice_default": "",
        "music_default": "",
        "guidance": {
            "writer": "Keep an energetic, playful voice with vivid metaphors an animated "
                      "illustration can act out.",
            "director": "Tell the story entirely through animated vector illustrations and "
                        "motion graphics — characters, mascots, object metaphors and data "
                        "graphics. No live-action or photographic footage.",
            "asset": "Use 'lottie' for characters, mascots, object metaphors and actions; use "
                     "'graphic' for numbers, diagrams and title cards. Never 'photo' or 'video'.",
            "design": "A bold, playful register with an expressive display typeface.",
        },
    },
    "images": {
        "id": "images",
        "label": "Images",
        "description": "Cinematic still photography with Ken Burns motion.",
        "media_policy": {
            "force": ["photo"],
            "prefer": None,
            "block": None,
            "ken_burns_all": True,
        },
        "theme": {
            "mood_pool": ["premium", "nature", "calm"],
            "font_pool": ["editorial_serif", "classic_serif", "editorial_display"],
        },
        "voice_default": "",
        "music_default": "",
        "guidance": {
            "writer": "Write evocative, image-led narration where every beat calls to mind a "
                      "single strong photograph.",
            "director": "Tell the story through a sequence of striking still photographs with "
                        "slow Ken Burns motion; avoid diagrams and animation.",
            "asset": "Use 'photo' for every scene — concrete, photogenic real-world subjects "
                     "with strong composition. No graphics, lotties or video.",
            "design": "A premium, editorial register suited to full-bleed photography.",
        },
    },
}

DEFAULT_GENRE = "auto"


# --------------------------------------------------------------- bundle resolve

def resolve(genre: str, custom_bundle: dict | None = None) -> dict:
    """The active bundle for a run: a custom bundle (merged onto ``auto`` to fill
    any missing keys) when supplied, else the built-in for ``genre``, else auto."""
    base = copy.deepcopy(PRESETS["auto"])
    chosen = custom_bundle if custom_bundle else PRESETS.get(genre)
    if not chosen:
        return base
    return _merge(base, chosen)


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in (over or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


# ------------------------------------------------------ hard media-policy pass

# Words in a curator query that signal a data/graphic-friendly scene, used to
# route a coerced entry to 'graphic' rather than an illustration.
_DATA_HINTS = (
    "chart", "graph", "percent", "%", "number", "count", "data", "growth",
    "stat", "trend", "compare", " vs ", "rate", "ratio", "timeline",
)

# Query prefixes that name a specific person/company face — stripped when a
# preset blocks them so the fallback treatment never fetches that face.
_NAME_PREFIXES = ("portrait of", "photo of", "logo of", "headshot of")


def _looks_like_data(query: str) -> bool:
    q = f" {(query or '').lower()} "
    if any(hint in q for hint in _DATA_HINTS):
        return True
    return any(ch.isdigit() for ch in q)


def _blocked(query: str, block: list[str]) -> bool:
    q = (query or "").strip().lower()
    for raw in block or []:
        b = str(raw).lower().strip()
        if b == "portrait" and (q.startswith(("portrait of", "photo of", "headshot of"))
                                or "headshot" in q):
            return True
        if b == "logo" and q.startswith("logo of"):
            return True
        if b and b in q:
            return True
    return False


def _neutralize(query: str) -> str:
    """Strip a person/company name out of a blocked query so the fallback
    treatment doesn't try to fetch that face ('portrait of Elon Musk' -> '')."""
    low = (query or "").strip().lower()
    for prefix in _NAME_PREFIXES:
        if low.startswith(prefix):
            return ""
    return (query or "").strip()


def _coerce(entry: dict, allowed: list[str]) -> None:
    """Rewrite ``entry['media_type']`` to the closest allowed type."""
    if entry.get("media_type") in allowed:
        return
    if "graphic" in allowed and _looks_like_data(entry.get("query", "")):
        entry["media_type"] = "graphic"
        return
    for candidate in allowed:            # first non-graphic option reads best…
        if candidate != "graphic":
            entry["media_type"] = candidate
            return
    entry["media_type"] = allowed[0]     # …else whatever is allowed


def apply_media_policy(asset_plan: list[dict], bundle: dict) -> list[dict]:
    """Hard-enforce a preset's media policy on the curator's plan, in place, and
    return the same list. Runs BEFORE ``fetch_assets`` so the genre's promise
    holds no matter what the LLM chose. 'upload' entries (the user's own footage)
    are never touched; ``prefer`` is intentionally soft (honoured via the asset
    guidance, not rewritten here) — only ``force`` and ``block`` are hard."""
    policy = (bundle or {}).get("media_policy") or {}
    force = policy.get("force") or None
    block = policy.get("block") or None
    if not force and not block:
        return asset_plan
    for entry in asset_plan:
        if not isinstance(entry, dict) or entry.get("media_type") == "upload":
            continue
        if block and _blocked(entry.get("query", ""), block):
            entry["query"] = _neutralize(entry.get("query", ""))
            _coerce(entry, force or (policy.get("prefer") or ["graphic"]))
            continue
        if force:
            _coerce(entry, force)
    return asset_plan
