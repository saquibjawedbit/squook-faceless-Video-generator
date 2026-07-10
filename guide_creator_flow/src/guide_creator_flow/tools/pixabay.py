"""Pixabay stock provider (photos + videos).

License: the Pixabay Content License — free for commercial use, no
attribution required, modification allowed
(https://pixabay.com/service/license-summary/).

A genuinely different catalog than Pexels, and search hits carry tags, which
gives the LLM re-ranker real signal. Env: PIXABAY_API_KEY (free key at
https://pixabay.com/api/docs/).
"""
import os
from pathlib import Path

import requests

from guide_creator_flow.tools.pexels import pick_rendition

PHOTO_SEARCH_URL = "https://pixabay.com/api/"
VIDEO_SEARCH_URL = "https://pixabay.com/api/videos/"
TIMEOUT = 30


def configured() -> bool:
    return bool(os.getenv("PIXABAY_API_KEY", "").strip())


def _key() -> str:
    key = os.getenv("PIXABAY_API_KEY", "").strip()
    if not key:
        raise RuntimeError("PIXABAY_API_KEY is not set")
    return key


def search_photos(query: str, orientation: str | None = None, limit: int = 6) -> list[dict]:
    params = {
        "key": _key(), "q": query[:100], "image_type": "photo",
        "per_page": max(3, limit), "safesearch": "true",
        "orientation": {"portrait": "vertical", "landscape": "horizontal"}.get(orientation or "", "all"),
    }
    resp = requests.get(PHOTO_SEARCH_URL, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    out = []
    for hit in resp.json().get("hits", [])[:limit]:
        url = hit.get("largeImageURL") or hit.get("webformatURL")
        if not url:
            continue
        out.append({
            "provider": "pixabay",
            "id": f"pixabay-photo-{hit.get('id')}",
            "title": "",
            "tags": [t.strip() for t in (hit.get("tags") or "").split(",") if t.strip()],
            "url": url,
            "page_url": hit.get("pageURL", ""),
            "credit": hit.get("user", ""),
            "ext": "jpg",
            "duration_s": None,
            "width": hit.get("imageWidth"),
            "height": hit.get("imageHeight"),
        })
    return out


def search_videos(
    query: str, orientation: str | None = None, limit: int = 6,
    target: tuple[int, int] | None = None,
) -> list[dict]:
    # The videos endpoint has no orientation filter; portrait fit is handled
    # by the ranker/renderer (videos are cover-cropped into the frame).
    params = {"key": _key(), "q": query[:100], "per_page": max(3, limit), "safesearch": "true"}
    resp = requests.get(VIDEO_SEARCH_URL, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    out = []
    for hit in resp.json().get("hits", [])[:limit]:
        renditions = [
            {"link": v.get("url"), "width": v.get("width"), "height": v.get("height")}
            for v in (hit.get("videos") or {}).values() if v.get("url")
        ]
        best = pick_rendition(renditions, target)
        if not best:
            continue
        out.append({
            "provider": "pixabay",
            "id": f"pixabay-video-{hit.get('id')}",
            "title": "",
            "tags": [t.strip() for t in (hit.get("tags") or "").split(",") if t.strip()],
            "url": best["link"],
            "page_url": hit.get("pageURL", ""),
            "credit": hit.get("user", ""),
            "ext": "mp4",
            "duration_s": hit.get("duration"),
            "width": best.get("width"),
            "height": best.get("height"),
        })
    return out


def search(query: str, media_type: str, orientation: str | None = None,
           limit: int = 6, target: tuple[int, int] | None = None) -> list[dict]:
    """Provider entry point for tools/stock.py."""
    if media_type == "video":
        return search_videos(query, orientation, limit, target)
    return search_photos(query, orientation, limit)


def download(url: str, dest_path: Path) -> None:
    with requests.get(url, stream=True, timeout=TIMEOUT * 4) as resp:
        resp.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                f.write(chunk)
