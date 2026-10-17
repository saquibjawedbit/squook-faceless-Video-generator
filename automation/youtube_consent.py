#!/usr/bin/env python3
"""One-time YouTube consent. No extra packages needed.

    python3 automation/youtube_consent.py [path/to/client_secret_*.json]

Without a path it uses the newest client_secret_*.json in ~/Downloads.
Opens Google's consent page in the browser; pick the channel and click Allow.
Saves client id, secret and refresh token to ~/.squook-youtube.json (mode 600)
and never prints them.

The token only stays valid long-term because the OAuth app is "In production".
Testing-mode apps get tokens that die after 7 days; the script refuses those.
"""

import glob
import http.server
import json
import os
import secrets
import sys
import urllib.parse
import urllib.error
import urllib.request
import webbrowser

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
OUT = os.path.expanduser("~/.squook-youtube.json")


def client_file() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    found = sorted(glob.glob(os.path.expanduser("~/Downloads/client_secret_*.json")), key=os.path.getmtime)
    if not found:
        sys.exit("No client_secret_*.json in ~/Downloads. Pass the path.")
    return found[-1]


def main() -> None:
    cfg = json.load(open(client_file()))["installed"]
    state = secrets.token_urlsafe(16)
    got = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] == state:
                got.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Done. You can close this tab.</h2>")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    redirect = f"http://127.0.0.1:{srv.server_port}"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        "redirect_uri": redirect,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    print("Opening the consent page. If it doesn't open, visit:\n" + url)
    webbrowser.open(url)
    while "code" not in got and "error" not in got:
        srv.handle_request()
    if "error" in got:
        sys.exit("Consent failed: " + got["error"])

    body = urllib.parse.urlencode({
        "code": got["code"],
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "redirect_uri": redirect,
        "grant_type": "authorization_code",
    }).encode()
    tok = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", body))
    if "refresh_token" not in tok:
        sys.exit("No refresh token returned. Remove the app at myaccount.google.com/permissions and retry.")
    if "refresh_token_expires_in" in tok:
        days = tok["refresh_token_expires_in"] // 86400
        sys.exit(f"Token expires in {days} days: the app is still in Testing. Publish it, then retry.")

    fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "refresh_token": tok["refresh_token"],
        }, f)
    print(f"Saved. Token has no expiry date. File: {OUT}")

    granted = tok.get("scope", "").split()
    missing = [s.rsplit("/", 1)[-1] for s in SCOPES if s not in granted]
    if missing:
        print("Not granted (tick every box on the consent page next time):", ", ".join(missing))

    req = urllib.request.Request(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        headers={"Authorization": "Bearer " + tok["access_token"]},
    )
    try:
        items = json.load(urllib.request.urlopen(req)).get("items", [])
        print("Channel:", items[0]["snippet"]["title"] if items else "(none on this account)")
    except urllib.error.HTTPError as e:
        err = json.load(e).get("error", {})
        print("Channel lookup failed:", e.code, err.get("message", ""))


if __name__ == "__main__":
    main()
