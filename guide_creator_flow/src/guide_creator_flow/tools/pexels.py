"""Pexels stock provider (photos + videos).

License: the Pexels license — free for commercial use, no attribution
required, modification allowed (https://www.pexels.com/license/).

Returns candidates in the shared stock-candidate shape (see tools/stock.py);
the video rendition is chosen to sit at-or-above the render target instead of
defaulting to the smallest SD file.
"""
import os
from pathlib import Path

import requests

PHOTO_SEARCH_URL = "https://api.pexels.com/v1/search"
VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search"
TIMEOUT = 30


class PexelsKeyMissing(Exception):
    pass


def configured() -> bool:
    return bool(os.getenv("PEXELS_API_KEY", "").strip())


def _headers() -> dict:
    api_key = os.getenv("PEXELS_API_KEY", "").strip()
    if not api_key:
        raise PexelsKeyMissing(
            "PEXELS_API_KEY is not set. Get a free key at https://www.pexels.com/api "
            "and add it to guide_creator_flow/.env"
        )
    return {"Authorization": api_key}


def pick_rendition(files: list[dict], target: tuple[int, int] | None) -> dict | None:
    """Choose the file whose area sits closest to the render target, preferring
    at-or-above it (a slight downscale beats a blurry upscale). Without a
    target, take the largest available."""
    files = [f for f in files if f.get("link") or f.get("url")]
    if not files:
        return None
    area = lambda f: (f.get("width") or 0) * (f.get("height") or 0)
    if not target:
        return max(files, key=area)
    want = target[0] * target[1]
    at_or_above = [f for f in files if area(f) >= want]
    if at_or_above:
        return min(at_or_above, key=area)
    return max(files, key=area)


def search_photos(query: str, orientation: str | None = None, limit: int = 6) -> list[dict]:
    """Return up to `limit` photo candidates in the shared candidate shape."""
    params = {"query": query, "per_page": limit}
    if orientation:
        params["orientation"] = orientation
    resp = requests.get(PHOTO_SEARCH_URL, headers=_headers(), params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    out = []
    for photo in resp.json().get("photos", []):
        src = photo.get("src", {})
        # `medium` is ~350px on its long edge — far too small for a fullscreen
        # 1080p+ background. Prefer a high-res rendition.
        url = src.get("large2x") or src.get("original") or src.get("large") or src.get("medium")
        if not url:
            continue
        out.append({
            "provider": "pexels",
            "id": f"pexels-photo-{photo.get('id')}",
            "title": photo.get("alt") or "",
            "tags": [],
            "url": url,
            "page_url": photo.get("url", ""),
            "credit": photo.get("photographer", ""),
            "ext": "jpg",
            "duration_s": None,
            "width": photo.get("width"),
            "height": photo.get("height"),
        })
    return out


def search_videos(
    query: str, orientation: str | None = None, limit: int = 6,
    target: tuple[int, int] | None = None,
) -> list[dict]:
    """Return up to `limit` video candidates in the shared candidate shape."""
    params = {"query": query, "per_page": limit}
    if orientation:
        params["orientation"] = orientation
    resp = requests.get(VIDEO_SEARCH_URL, headers=_headers(), params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    out = []
    for video in resp.json().get("videos", []):
        best = pick_rendition(video.get("video_files", []), target)
        if not best:
            continue
        out.append({
            "provider": "pexels",
            "id": f"pexels-video-{video.get('id')}",
            "title": (video.get("url") or "").rstrip("/").rsplit("/", 1)[-1].replace("-", " "),
            "tags": [],
            "url": best["link"],
            "page_url": video.get("url", ""),
            "credit": (video.get("user") or {}).get("name", ""),
            "ext": "mp4",
            "duration_s": video.get("duration"),
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
