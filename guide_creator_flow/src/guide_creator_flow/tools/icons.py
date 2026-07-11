"""Vector-icon provider backed by Iconify (api.iconify.design).

200k+ open-source SVG icons (Material Design Icons, Lucide, Phosphor, Tabler…),
free and keyless. We resolve a plain concept word to an icon and download it as
an SVG recoloured to the theme accent — so icon_row scenes use crisp, on-brand
vector art instead of flat system emoji.

Failures are non-fatal: fetch() returns False and the renderer falls back to its
built-in emoji set for that slot.
"""
import re

import requests

SEARCH_URL = "https://api.iconify.design/search"
SVG_URL = "https://api.iconify.design/{prefix}/{name}.svg"
TIMEOUT = 20
# Prefer these well-drawn, visually consistent sets (in order) for search.
PREFIXES = "mdi,lucide,ph,tabler,material-symbols"

# Curated concept → Iconify name for the common explainer vocabulary, so the
# staple ideas always resolve to a good, consistent icon. Anything outside this
# map falls through to Iconify search.
_MAP = {
    "brain": "mdi:brain", "chip": "mdi:chip", "cpu": "mdi:cpu-64-bit",
    "database": "mdi:database", "network": "mdi:lan", "eye": "mdi:eye",
    "gear": "mdi:cog", "settings": "mdi:cog", "chart": "mdi:chart-line",
    "graph": "mdi:chart-line", "lightbulb": "mdi:lightbulb-on",
    "idea": "mdi:lightbulb-on", "clock": "mdi:clock-outline",
    "time": "mdi:clock-outline", "check": "mdi:check-circle",
    "cross": "mdi:close-circle", "arrow": "mdi:arrow-right",
    "rocket": "mdi:rocket-launch", "cloud": "mdi:cloud",
    "lock": "mdi:lock", "security": "mdi:shield-check", "shield": "mdi:shield-check",
    "code": "mdi:code-tags", "money": "mdi:cash", "growth": "mdi:trending-up",
    "people": "mdi:account-group", "user": "mdi:account", "globe": "mdi:earth",
    "world": "mdi:earth", "phone": "mdi:cellphone", "mobile": "mdi:cellphone",
    "email": "mdi:email", "search": "mdi:magnify", "star": "mdi:star",
    "heart": "mdi:heart", "fire": "mdi:fire", "flash": "mdi:lightning-bolt",
    "speed": "mdi:speedometer", "target": "mdi:target", "map": "mdi:map-marker",
    "calendar": "mdi:calendar", "document": "mdi:file-document",
    "folder": "mdi:folder", "cart": "mdi:cart", "gift": "mdi:gift",
    "warning": "mdi:alert", "info": "mdi:information", "link": "mdi:link-variant",
    "robot": "mdi:robot", "atom": "mdi:atom", "dna": "mdi:dna",
    "leaf": "mdi:leaf", "water": "mdi:water", "sun": "mdi:white-balance-sunny",
    "battery": "mdi:battery", "wifi": "mdi:wifi", "server": "mdi:server",
    "key": "mdi:key", "trophy": "mdi:trophy", "book": "mdi:book-open-variant",
}


def _resolve(concept: str) -> str | None:
    """Map a concept word to an Iconify `prefix:name`, via the curated map first
    then Iconify search."""
    key = re.sub(r"[^a-z0-9]+", " ", (concept or "").lower()).strip()
    if not key:
        return None
    if key in _MAP:
        return _MAP[key]
    # first word often carries the concept ("thinking robot" → "robot")
    for word in key.split():
        if word in _MAP:
            return _MAP[word]
    try:
        resp = requests.get(
            SEARCH_URL,
            params={"query": key, "limit": 1, "prefixes": PREFIXES},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        icons = resp.json().get("icons") or []
        return icons[0] if icons else None
    except Exception:
        return None


def fetch(concept: str, dest_path, color: str = "#ffffff", size: int = 240) -> bool:
    """Resolve `concept`, download the icon as an SVG recoloured to `color`, and
    write it to dest_path. Returns True on success, False on any failure."""
    name = _resolve(concept)
    if not name or ":" not in name:
        return False
    prefix, icon = name.split(":", 1)
    try:
        resp = requests.get(
            SVG_URL.format(prefix=prefix, name=icon),
            params={"color": color, "height": size},
            timeout=TIMEOUT,
        )
        if resp.status_code != 200 or "svg" not in resp.headers.get("content-type", ""):
            return False
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(resp.content)
        return True
    except Exception:
        return False
