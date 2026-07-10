"""NASA Image and Video Library provider (images-api.nasa.gov).

License: NASA media is public domain (created by a US government agency) —
free for commercial use, no attribution required, no API key needed
(https://www.nasa.gov/nasa-brand-center/images-and-media/).

Unbeatable relevance for space/science topics; for anything else the search
simply returns weak candidates and the ranker (or provider priority) passes
over them. Search results don't carry direct file URLs — each item has an
asset manifest that is resolved lazily for the chosen candidate only.
"""
import requests

SEARCH_URL = "https://images-api.nasa.gov/search"
TIMEOUT = 30


def configured() -> bool:
    return True  # keyless public API


def search(query: str, media_type: str, orientation: str | None = None,
           limit: int = 6, target: tuple[int, int] | None = None) -> list[dict]:
    """Provider entry point for tools/stock.py. `url` is left empty — call
    resolve_url() on the chosen candidate to fetch the downloadable file."""
    api_media = "video" if media_type == "video" else "image"
    resp = requests.get(
        SEARCH_URL,
        params={"q": query[:100], "media_type": api_media, "page_size": max(3, limit)},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    items = (resp.json().get("collection") or {}).get("items", [])
    out = []
    for item in items[:limit]:
        data = (item.get("data") or [{}])[0]
        if not item.get("href") or not data.get("nasa_id"):
            continue
        out.append({
            "provider": "nasa",
            "id": f"nasa-{data['nasa_id']}",
            "title": data.get("title") or "",
            "tags": data.get("keywords") or [],
            "url": "",  # resolved lazily from the asset manifest
            "asset_manifest": item["href"],
            "page_url": f"https://images.nasa.gov/details/{data['nasa_id']}",
            "credit": "NASA",
            "ext": "mp4" if api_media == "video" else "jpg",
            "duration_s": None,
            "width": None,
            "height": None,
        })
    return out


def resolve_url(candidate: dict) -> str | None:
    """Fetch the candidate's asset manifest and pick a downloadable file:
    a medium/small mp4 for video (orig can be multi-GB), largest jpg otherwise."""
    resp = requests.get(candidate["asset_manifest"], timeout=TIMEOUT)
    resp.raise_for_status()
    files = [u for u in resp.json() if isinstance(u, str)]
    if candidate["ext"] == "mp4":
        mp4s = [u for u in files if u.lower().endswith(".mp4")]
        for marker in ("~medium", "~small", "~mobile", "~orig"):
            for u in mp4s:
                if marker in u.lower():
                    return u
        return mp4s[0] if mp4s else None
    jpgs = [u for u in files if u.lower().endswith((".jpg", ".jpeg", ".png"))]
    for marker in ("~large", "~orig", "~medium"):
        for u in jpgs:
            if marker in u.lower():
                return u
    return jpgs[0] if jpgs else None
