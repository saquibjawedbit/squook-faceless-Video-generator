#!/usr/bin/env python3
"""One-time helper: mint the YouTube refresh token the daily uploader needs.

Run this LOCALLY (it opens a browser for Google OAuth consent):

    pip install google-auth-oauthlib
    python3 automation/get_youtube_token.py <client_id> <client_secret>

Prerequisites (one-time, in Google Cloud Console):
  1. Create a project and enable "YouTube Data API v3" AND
     "YouTube Analytics API".
  2. OAuth consent screen: External, add your own Google account as a test user.
  3. Credentials -> Create OAuth client ID -> type "Desktop app".

Store the printed value as the YT_REFRESH_TOKEN repo secret, together with
YT_CLIENT_ID and YT_CLIENT_SECRET.

A token minted before the analytics scopes were added only carries
youtube.upload, and Google will not widen an existing grant — re-run this to
mint a fresh token and replace the secret, otherwise automation/analytics.py
skips every fetch.
"""

import sys

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    # Per-video lifetime metrics (views, retention, watch time).
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    # Video metadata (publish time, duration) the analytics API does not return.
    "https://www.googleapis.com/auth/youtube.readonly",
]


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    client_id, client_secret = sys.argv[1], sys.argv[2]

    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        SCOPES,
    )
    creds = flow.run_local_server(port=0)
    print("\nYT_REFRESH_TOKEN:", creds.refresh_token)


if __name__ == "__main__":
    main()
