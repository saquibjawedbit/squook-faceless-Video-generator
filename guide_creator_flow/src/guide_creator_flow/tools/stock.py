"""Multi-provider stock media search with LLM relevance ranking.

One entry point — search() — pools candidates from every configured provider
(Pexels, Pixabay, NASA; all royalty-free + commercial-use with no
attribution), drops anything already used by an earlier scene, then asks the
local LLM to pick the candidate that best matches the scene's visual
description — or reject them all, so the scene falls back to a designed
graphic rather than an off-topic clip.

Every provider failure is isolated: a missing key or a dead API just removes
that provider from the pool.
"""
import json
import re
from pathlib import Path

import requests

from guide_creator_flow.tools import logos, nasa, pexels, pixabay, wikimedia

# Priority order — also the tie-break when the LLM ranker is unavailable.
# logos first: it only ever answers explicit "logo of X" queries, where it is
# authoritative; wikimedia last: broad catalog, best when the ranker chooses.
PROVIDERS = [logos, pexels, pixabay, nasa, wikimedia]
CANDIDATES_PER_PROVIDER = 6
TIMEOUT = 30
_UA = {"User-Agent": "SquookVideoPipeline/1.0 (stock media fetch; contact: local dev)"}


class NoProvidersConfigured(Exception):
    pass


# "portrait of <full name>" is the curator's person-photo contract. These
# scenes are handled deterministically: only a candidate whose title names
# the person qualifies — never scenery from the rest of the visual, and the
# LLM never gets to overrule the name match.
_PORTRAIT_RE = re.compile(r"^\s*(?:a\s+)?portrait of\s+(.+?)\s*$", re.IGNORECASE)


def _pick_person(candidates: list[dict], name: str) -> dict | None:
    """Best candidate whose title contains EVERY word of the person's name.
    Prefers editorial sources (Wikimedia/NASA) over stock, then resolution."""
    tokens = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if len(t) > 1]
    if not tokens:
        return None
    matched = [
        c for c in candidates
        if all(t in (c.get("title") or "").lower() for t in tokens)
    ]
    if not matched:
        return None
    provider_rank = {"wikimedia": 0, "nasa": 1}
    return min(matched, key=lambda c: (
        provider_rank.get(c["provider"], 2),
        -((c.get("width") or 0) * (c.get("height") or 0)),
    ))


def _configured_providers() -> list:
    return [p for p in PROVIDERS if p.configured()]


def _rank_with_llm(candidates: list[dict], query: str, visual: str) -> dict | None:
    """Ask the crew's LLM to choose the best-matching candidate (or none).
    Returns the chosen candidate, or None for 'nothing fits'. Raises on any
    LLM problem so the caller can fall back to priority order."""
    from guide_creator_flow.crews.content_crew.content_crew import llm

    lines = []
    for i, c in enumerate(candidates):
        desc = ", ".join(filter(None, [
            c["title"],
            " ".join(c["tags"][:8]),
            f"{c['duration_s']}s" if c.get("duration_s") else "",
            f"{c['width']}x{c['height']}" if c.get("width") else "",
            c["provider"],
        ]))
        lines.append(f"{i}: {desc}")
    prompt = (
        "You are picking stock b-roll for one scene of a video.\n"
        f"Scene needs: {visual or query}\n"
        f"Search query used: {query}\n"
        "Candidates:\n" + "\n".join(lines) + "\n"
        "B-roll does not need to match the description literally — pick the "
        "candidate whose subject matter fits the scene best. Reply with RAW "
        "JSON ONLY: {\"pick\": <candidate number>} — or {\"pick\": -1} ONLY "
        "when every candidate is about a clearly different subject."
    )
    text = str(llm.call(prompt)).strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    pick = int(json.loads(text).get("pick", -1))
    if pick < 0:
        return None
    return candidates[pick] if pick < len(candidates) else candidates[0]


def _rewrite_query(query: str, visual: str) -> str | None:
    """Ask the LLM for a disambiguated stock query when the original one found
    nothing usable (e.g. 'falcon 9' returns birds, not rockets)."""
    from guide_creator_flow.crews.content_crew.content_crew import llm

    prompt = (
        f"The stock-footage search \"{query}\" found nothing usable for a video "
        f"scene that needs: {visual}\n"
        "Stock libraries match words literally (a 'falcon 9' search returns "
        "birds, not SpaceX rockets). Write ONE better 2-5 word English search "
        "query using generic, concrete, filmable words that name the subject "
        "class explicitly. Reply with RAW JSON ONLY: {\"query\": \"...\"}"
    )
    text = str(llm.call(prompt)).strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    rewritten = str(json.loads(text).get("query", "")).strip()
    return rewritten if rewritten and rewritten.lower() != query.lower() else None


def _provider_query(provider, query, media_type, orientation, target):
    try:
        return provider.search(
            query, media_type, orientation=orientation,
            limit=CANDIDATES_PER_PROVIDER, target=target,
        )
    except Exception as e:
        print(f"    stock: {provider.__name__.rsplit('.', 1)[-1]} search failed ({e})")
        return []


def _gather(providers, query, media_type, orientation, target, exclude) -> list[dict]:
    """All providers concurrently — pure HTTP wait, identical results."""
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        results = list(pool.map(
            lambda p: _provider_query(p, query, media_type, orientation, target), providers,
        ))
    return [
        h for hits in results for h in hits
        if h["id"] not in exclude and (h["page_url"] or h["id"]) not in exclude
    ]


def _finalize(chosen: dict, exclude: set) -> dict | None:
    """Resolve a lazy NASA URL and mark the pick as used. None if the asset
    manifest comes up empty."""
    if chosen["provider"] == "nasa" and not chosen["url"]:
        try:
            chosen["url"] = nasa.resolve_url(chosen)
        except Exception as e:
            print(f"    stock: NASA asset resolve failed ({e})")
        if not chosen["url"]:
            exclude.add(chosen["id"])
            return None
    exclude.add(chosen["id"])
    if chosen["page_url"]:
        exclude.add(chosen["page_url"])
    return chosen


def _candidate_line(i: int, c: dict) -> str:
    desc = ", ".join(filter(None, [
        c["title"],
        " ".join(c["tags"][:8]),
        f"{c['duration_s']}s" if c.get("duration_s") else "",
        f"{c['width']}x{c['height']}" if c.get("width") else "",
        c["provider"],
    ]))
    return f"  {i}: {desc}"


def _rank_batch_with_llm(items: list) -> dict:
    """ONE LLM call ranking every scene's candidates together (vs. a call per
    scene). Seeing all scenes at once also lets the model avoid picking
    near-identical footage twice. Returns {key: index|-1}; raises on LLM
    trouble so the caller can fall back."""
    from guide_creator_flow.crews.content_crew.content_crew import llm

    blocks = []
    for req, cands in items:
        lines = "\n".join(_candidate_line(i, c) for i, c in enumerate(cands))
        blocks.append(
            f"SCENE {req['key']} — needs: {req.get('visual') or req['query']}\n"
            f"(search query used: {req['query']})\n{lines}"
        )
    keys = ", ".join(f'"{req["key"]}": <index or -1>' for req, _ in items)
    prompt = (
        "You are picking stock b-roll for the scenes of one video.\n"
        "For each scene pick the candidate whose subject matter fits best — "
        "b-roll does not need to match the description literally. Use -1 ONLY "
        "when every candidate is about a clearly different subject. Never pick "
        "footage of the same subject/shot for two scenes.\n\n"
        + "\n\n".join(blocks)
        + "\n\nReply with RAW JSON ONLY: {" + keys + "}"
    )
    text = str(llm.call(prompt)).strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    data = json.loads(text)
    out = {}
    for k, v in data.items():
        try:
            out[str(k)] = int(v)
        except (TypeError, ValueError):
            pass
    return out


def search_batch(requests: list, exclude: set | None = None) -> dict:
    """Resolve stock for MANY scenes with a single ranking call.
    Each request: {key, query, media_type, orientation, visual, target}.
    Returns {key: hit|None}. Person portraits stay deterministic; scenes the
    batch ranker rejects fall back to the single-scene path (which includes
    the query-rewrite retry)."""
    providers = _configured_providers()
    if not providers:
        raise NoProvidersConfigured(
            "No stock provider is configured. Set PEXELS_API_KEY and/or "
            "PIXABAY_API_KEY in guide_creator_flow/.env"
        )
    exclude = exclude if exclude is not None else set()
    results: dict = {}

    # Gather every scene's candidates concurrently (pure HTTP).
    from concurrent.futures import ThreadPoolExecutor

    def _gather_for(req):
        return _gather(providers, req["query"], req["media_type"],
                       req.get("orientation"), req.get("target"), exclude)

    with ThreadPoolExecutor(max_workers=min(6, max(1, len(requests)))) as pool:
        all_cands = list(pool.map(_gather_for, requests))

    rankable = []
    fallback = []
    for req, cands in zip(requests, all_cands):
        person = _PORTRAIT_RE.match(req["query"])
        if person:
            chosen = _pick_person(cands, person.group(1))
            if chosen is None:
                print(f"    stock: no licensed photo of '{person.group(1)}' found")
            results[req["key"]] = _finalize(chosen, exclude) if chosen else None
        elif not cands:
            fallback.append(req)      # rewrite path may still rescue it
        elif len(cands) == 1:
            results[req["key"]] = _finalize(cands[0], exclude)
        else:
            rankable.append((req, cands))

    picks = {}
    if rankable:
        try:
            picks = _rank_batch_with_llm(rankable)
        except Exception as e:
            print(f"    stock: batch ranker unavailable ({e}); using provider priority")
            picks = {str(req["key"]): 0 for req, _ in rankable}

    for req, cands in rankable:
        idx = picks.get(str(req["key"]), 0)
        if idx is None or idx < 0 or idx >= len(cands):
            fallback.append(req)      # model rejected all → rewrite retry
            continue
        chosen = cands[idx]
        if chosen["id"] in exclude:   # dedup safety if the model repeated a pick
            chosen = next((c for c in cands if c["id"] not in exclude), None)
        results[req["key"]] = _finalize(chosen, exclude) if chosen else None

    for req in fallback:
        results[req["key"]] = search(
            req["query"], req["media_type"], orientation=req.get("orientation"),
            visual=req.get("visual", ""), target=req.get("target"), exclude=exclude,
        )
    return results


def search(
    query: str,
    media_type: str,
    orientation: str | None = None,
    visual: str = "",
    target: tuple[int, int] | None = None,
    exclude: set | None = None,
    _allow_rewrite: bool = True,
) -> dict | None:
    """Return the best stock candidate for a scene, or None (→ graphic).
    `exclude` is the set of candidate ids/page_urls already used by earlier
    scenes; the chosen hit's identifiers are added to it. When the ranker
    rejects every candidate (ambiguous query — wrong subject entirely), one
    retry runs with an LLM-disambiguated query."""
    providers = _configured_providers()
    if not providers:
        raise NoProvidersConfigured(
            "No stock provider is configured. Set PEXELS_API_KEY and/or "
            "PIXABAY_API_KEY in guide_creator_flow/.env"
        )
    exclude = exclude if exclude is not None else set()
    candidates = _gather(providers, query, media_type, orientation, target, exclude)
    person = _PORTRAIT_RE.match(query)
    if person:
        # Person scenes are all-or-nothing: the named person or a graphic.
        # A lenient "close enough" pick (someone else's face, or the scene's
        # backdrop) is worse than no photo at all — so the name match is
        # enforced in code and the LLM ranker/rewrite never runs.
        chosen = _pick_person(candidates, person.group(1))
        if chosen is None:
            print(f"    stock: no licensed photo of '{person.group(1)}' found")
            return None
    else:
        chosen = None
        if len(candidates) == 1:
            chosen = candidates[0]
        elif candidates:
            try:
                chosen = _rank_with_llm(candidates, query, visual)
            except Exception as e:
                print(f"    stock: ranker unavailable ({e}); using provider priority")
                chosen = candidates[0]

    if chosen is None:
        # Nothing found, or the model judged every candidate off-topic — the
        # query itself is probably ambiguous. One retry with a rewritten query.
        if _allow_rewrite and visual:
            try:
                better = _rewrite_query(query, visual)
            except Exception:
                better = None
            if better:
                print(f"    stock: '{query}' found nothing fitting; retrying as '{better}'")
                return search(better, media_type, orientation=orientation,
                              visual=visual, target=target, exclude=exclude,
                              _allow_rewrite=False)
        return None

    # NASA search results carry no direct file URL — resolve the manifest now;
    # if it comes up empty, retry without this candidate.
    if chosen["provider"] == "nasa" and not chosen["url"]:
        try:
            chosen["url"] = nasa.resolve_url(chosen)
        except Exception as e:
            print(f"    stock: NASA asset resolve failed ({e})")
        if not chosen["url"]:
            exclude.add(chosen["id"])
            return search(query, media_type, orientation=orientation,
                          visual=visual, target=target, exclude=exclude)

    exclude.add(chosen["id"])
    if chosen["page_url"]:
        exclude.add(chosen["page_url"])
    return chosen


def download(url: str, dest_path: Path) -> None:
    with requests.get(url, stream=True, headers=_UA, timeout=TIMEOUT * 4) as resp:
        resp.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                f.write(chunk)
