"""Wikimedia Commons stock provider (photos of public figures + editorial
imagery).

The only large, API-accessible source of commercially usable photos of real
people (conference/press/event shots). Results are filtered to a strict
license allowlist — public domain, CC0, CC BY, CC BY-SA — NC/ND and
unknown licenses are dropped. CC BY / CC BY-SA make attribution MANDATORY:
every candidate carries `license` + `attribution` so the pipeline can render
the credit.

Legal note: a CC license clears copyright, not personality rights — imagery
of real people is for editorial use (scenes about the person/company), never
implied endorsement.

Keyless; please keep the descriptive User-Agent (Wikimedia API etiquette).
"""
import re

import requests

API_URL = "https://commons.wikimedia.org/w/api.php"
TIMEOUT = 30
HEADERS = {"User-Agent": "SquookVideoPipeline/1.0 (stock media fetch; contact: local dev)"}

# LicenseShortName values we accept, matched as prefixes after lowercasing.
_ALLOWED_LICENSE_RE = re.compile(
    r"^(public domain|pd|no restrictions|cc0|cc[ -]by(?![ -]nc|[ -]nd)[\w\.\- ]*)", re.IGNORECASE
)
_TAG_RE = re.compile(r"<[^>]+>")


def configured() -> bool:
    return True  # keyless public API


def _clean(html: str) -> str:
    return _TAG_RE.sub("", html or "").strip()


def _license_ok(short_name: str) -> bool:
    return bool(_ALLOWED_LICENSE_RE.match((short_name or "").strip()))


def search(query: str, media_type: str, orientation: str | None = None,
           limit: int = 6, target: tuple[int, int] | None = None) -> list[dict]:
    """Provider entry point for tools/stock.py. Photos only — Commons video
    is sparse and mostly webm/ogv, which the render pipeline doesn't take."""
    if media_type != "photo":
        return []
    # Commons search is literal file-title/description matching — intent
    # words like "portrait of" only exclude good hits ("Jensen Huang at CES").
    query = re.sub(r"^\s*(a\s+)?(portrait|photo|picture|image)s?\s+of\s+", "", query, flags=re.IGNORECASE)
    params = {
        "action": "query", "format": "json", "formatversion": 2,
        "generator": "search",
        "gsrsearch": f"filetype:bitmap {query}",
        "gsrnamespace": 6,            # File: pages
        "gsrlimit": limit * 3,        # oversample — license filter drops many
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata",
        "iiurlwidth": (target[0] if target else 1920),
    }
    resp = requests.get(API_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    pages = ((resp.json().get("query") or {}).get("pages")) or []
    out = []
    for page in sorted(pages, key=lambda p: p.get("index", 99)):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        license_name = _clean((meta.get("LicenseShortName") or {}).get("value", ""))
        if not _license_ok(license_name):
            continue
        width, height = info.get("width") or 0, info.get("height") or 0
        if width < 640:  # thumbnails/icons aren't fullscreen material
            continue
        author = _clean((meta.get("Artist") or {}).get("value", "")) or "Wikimedia Commons"
        # A scaled rendition keeps downloads sane (originals can be 50MP+).
        url = info.get("thumburl") or info.get("url")
        if not url:
            continue
        title = re.sub(r"^File:|\.\w+$", "", page.get("title", ""))
        out.append({
            "provider": "wikimedia",
            "id": f"wikimedia-{page.get('pageid')}",
            "title": title,
            "tags": [],
            "url": url,
            "page_url": info.get("descriptionurl", ""),
            "credit": author[:120],
            "ext": "jpg",
            "duration_s": None,
            "width": info.get("thumbwidth") or width,
            "height": info.get("thumbheight") or height,
            "license": license_name,
            # PD/CC0 need no credit; CC BY / CC BY-SA legally require it.
            "attribution_required": license_name.lower().startswith("cc by"),
        })
        if len(out) >= limit:
            break
    return out


def download(url: str, dest_path):
    with requests.get(url, stream=True, headers=HEADERS, timeout=TIMEOUT * 4) as resp:
        resp.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                f.write(chunk)
