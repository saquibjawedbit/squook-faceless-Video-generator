import json
from pathlib import Path

import requests

GRAPHQL_URL = "https://graphql.lottiefiles.com/2022-08"
TIMEOUT = 30

SEARCH_QUERY = """
query($q: String!) {
  searchPublicAnimations(query: $q, first: 8) {
    edges { node { id name jsonUrl url downloads } }
  }
}
"""


def search(query: str) -> dict | None:
    """Return the most-downloaded public animation for a query, or None."""
    resp = requests.post(
        GRAPHQL_URL,
        json={"query": SEARCH_QUERY, "variables": {"q": query}},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    edges = (
        resp.json()
        .get("data", {})
        .get("searchPublicAnimations", {})
        .get("edges", [])
    )
    nodes = [e["node"] for e in edges if e.get("node", {}).get("jsonUrl")]
    if not nodes:
        return None
    best = max(nodes, key=lambda n: n.get("downloads") or 0)
    return {
        "json_url": best["jsonUrl"],
        "name": best.get("name", ""),
        "page_url": best.get("url", ""),
    }


def download(json_url: str, dest_path: Path) -> None:
    resp = requests.get(json_url, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()  # validates it is real Lottie JSON before writing
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_text(json.dumps(data))
