"""Background-music source: search Creative-Commons tracks on Jamendo and
download one. Mirrors the pexels/lottie source pattern — gated on a free API
key, and callers fall back to a synthesised bed when the key is missing or a
search returns nothing. We ask for INSTRUMENTAL tracks only, since the video
already has a spoken voice-over.

Commercial safety: we restrict the search to licenses that permit COMMERCIAL
use and syncing into a video, i.e. we exclude the NonCommercial (NC),
ShareAlike (SA) and NoDerivatives (ND) clauses (ccnc/ccsa/ccnd = false). That
leaves effectively CC BY and CC0/public-domain tracks — usable in a commercial
product PROVIDED the artist is credited. `search()` returns the attribution
(name/artist/page_url/license) so the caller can thread a credit into the IR."""
import os
import re
from pathlib import Path

import requests

SEARCH_URL = "https://api.jamendo.com/v3.0/tracks/"
TIMEOUT = 15


class JamendoKeyMissing(Exception):
    pass


def _client_id() -> str:
    cid = os.getenv("JAMENDO_CLIENT_ID", "").strip()
    if not cid:
        raise JamendoKeyMissing(
            "JAMENDO_CLIENT_ID is not set. Get a free client id at "
            "https://developer.jamendo.com/ to fetch real music."
        )
    return cid


def _tags(query: str) -> str:
    """Turn a free-text music description into Jamendo '+'-joined fuzzytags."""
    words = re.findall(r"[a-z0-9]+", (query or "").lower())
    return "+".join(words[:4]) or "instrumental"


def _license_label(url: str) -> str:
    """Human label for a Creative-Commons license URL, e.g.
    '…/licenses/by/3.0/' -> 'CC BY 3.0', '…/publicdomain/zero/1.0/' -> 'CC0 1.0'.
    Returns '' when the URL is missing or unrecognised."""
    if not url:
        return ""
    m = re.search(r"/licenses/([a-z-]+)/([0-9.]+)", url)
    if m:
        return f"CC {m.group(1).upper()} {m.group(2)}"
    m = re.search(r"/publicdomain/zero/([0-9.]+)", url)
    if m:
        return f"CC0 {m.group(1)}"
    return ""


def search(query: str, instrumental: bool = True) -> dict | None:
    """Return the top matching track, or None. Raises JamendoKeyMissing if the
    key is absent so the caller can fall back."""
    cid = _client_id()  # raises if missing
    url = (
        f"{SEARCH_URL}?client_id={cid}&format=json&limit=1"
        f"&fuzzytags={_tags(query)}&audioformat=mp32&order=popularity_month"
        "&include=musicinfo&groupby=artist_id"
        # Commercial-safe licenses only: exclude NonCommercial, ShareAlike and
        # NoDerivatives so what we sync into a video is usable commercially
        # (leaves CC BY / CC0). Attribution is still required — see below.
        "&ccnc=false&ccsa=false&ccnd=false"
    )
    if instrumental:
        url += "&vocalinstrumental=instrumental"
    resp = requests.get(url, timeout=TIMEOUT)
    resp.raise_for_status()
    results = (resp.json() or {}).get("results") or []
    if not results:
        return None
    t = results[0]
    audio = t.get("audio") or t.get("audiodownload")
    if not audio:
        return None
    license_url = t.get("license_ccurl", "")
    return {
        "name": t.get("name", "untitled"),
        "artist": t.get("artist_name", "unknown"),
        "audio": audio,
        "page_url": t.get("shareurl", ""),
        "license": license_url,
        "license_name": _license_label(license_url),
    }


def download(url: str, dest_path: Path) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=TIMEOUT * 4) as resp:
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
