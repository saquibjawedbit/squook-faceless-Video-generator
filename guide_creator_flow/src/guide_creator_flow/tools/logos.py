"""Company-logo provider backed by logo.dev.

Participates ONLY when the scene's query is explicitly a logo request
("logo of SpaceX", "Nvidia logo") — for everything else it returns nothing,
so it never pollutes general b-roll scenes.

Legal note: logos are trademarks, not royalty-free content. Showing one is
fine as *nominative/editorial* use — a scene about that company — never as
decoration or implied endorsement/partnership.

Env:
  LOGO_DEV_TOKEN  — publishable image token (pk_…), free at https://logo.dev
  LOGO_DEV_SECRET — optional secret key (sk_…) enabling brand-name → domain
                    search; without it the domain is guessed as <name>.com.
"""
import os
import re

import requests

IMG_URL = "https://img.logo.dev/{domain}"
SEARCH_URL = "https://api.logo.dev/search"
TIMEOUT = 30

_LOGO_INTENT_RE = re.compile(r"\blogos?\b", re.IGNORECASE)
_STRIP_RE = re.compile(r"\b(logos?|of|the|company|brand|official)\b", re.IGNORECASE)


def configured() -> bool:
    return bool(os.getenv("LOGO_DEV_TOKEN", "").strip())


def _company_from(query: str) -> str:
    return re.sub(r"\s+", " ", _STRIP_RE.sub(" ", query)).strip()


def _resolve_domain(company: str) -> str | None:
    """Brand search when a secret key is set; else guess `<name>.com`."""
    secret = os.getenv("LOGO_DEV_SECRET", "").strip()
    if secret:
        resp = requests.get(
            SEARCH_URL, params={"q": company},
            headers={"Authorization": f"Bearer {secret}"}, timeout=TIMEOUT,
        )
        resp.raise_for_status()
        hits = resp.json() or []
        if hits and hits[0].get("domain"):
            return hits[0]["domain"]
        return None
    guess = re.sub(r"[^a-z0-9]", "", company.lower())
    return f"{guess}.com" if guess else None


def search(query: str, media_type: str, orientation: str | None = None,
           limit: int = 6, target: tuple[int, int] | None = None) -> list[dict]:
    """Provider entry point for tools/stock.py."""
    if media_type != "photo" or not _LOGO_INTENT_RE.search(query):
        return []
    company = _company_from(query)
    if not company:
        return []
    domain = _resolve_domain(company)
    if not domain:
        return []
    token = os.getenv("LOGO_DEV_TOKEN", "").strip()
    url = IMG_URL.format(domain=domain) + f"?token={token}&size=512&format=png"
    # Probe so a parked/unknown domain never becomes a broken scene asset.
    probe = requests.get(url, timeout=TIMEOUT)
    if probe.status_code != 200 or "image" not in probe.headers.get("content-type", ""):
        return []
    return [{
        "provider": "logodev",
        "id": f"logodev-{domain}",
        "title": f"{company} logo ({domain})",
        "tags": ["logo", company],
        "url": url,
        "page_url": f"https://{domain}",
        "credit": f"{company} logo — trademark of its owner (editorial use)",
        "ext": "png",
        "duration_s": None,
        "width": 512,
        "height": 512,
    }]
