#!/usr/bin/env python3
"""Adds the server-to-server automation key to Squook (approved by Saquib).

Requests carrying header `x-automation-key: <AUTOMATION_KEY>` act as the user
AUTOMATION_USER_ID. Both must be set as worker secrets, or the key does nothing.
Also lets owner accounts make lessons up to 7 minutes.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def edit(rel, old, new):
    p = os.path.join(ROOT, rel)
    s = open(p).read()
    if new in s:
        print("already done:", rel)
        return
    assert old in s, f"could not find the spot in {rel}"
    open(p, "w").write(s.replace(old, new, 1))
    print("updated:", rel)


edit("server/src/config.js", "  // LANDING_ONLY=true", """  // Server-to-server key for the YouTube automation; acts as this user id.
  automationKey: process.env.AUTOMATION_KEY || '',
  automationUserId: process.env.AUTOMATION_USER_ID || '',
  // LANDING_ONLY=true""")

edit("server/src/auth.js", "import { config, authEnabled } from './config.js';",
     "import { timingSafeEqual } from 'node:crypto';\nimport { config, authEnabled } from './config.js';")

edit("server/src/auth.js", """export async function requireAuth(req, res, next) {
  const token = bearer(req);
""", """function automationUser(req) {
  const key = req.headers['x-automation-key'];
  if (!config.automationKey || !config.automationUserId || typeof key !== 'string') return null;
  const a = Buffer.from(key), b = Buffer.from(config.automationKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: config.automationUserId, email: config.landingUnlimitedEmails[0] || 'automation@local' };
}

export async function requireAuth(req, res, next) {
  const auto = automationUser(req);
  if (auto) { req.user = auto; return next(); }
  const token = bearer(req);
""")

edit("server/src/index.js",
     "  const lengthS = Math.max(15, Math.min(180, Math.round(Number(b.duration) || 30)));",
     "  // Owners may make full lessons (up to 7 min); everyone else 3 min.\n"
     "  const lengthS = Math.max(15, Math.min(isOwnerAdmin(req.user) ? 420 : 180, Math.round(Number(b.duration) || 30)));")

edit("cloudflare/src/index.js", "'SARVAM_API_KEY',\n];",
     "'SARVAM_API_KEY',\n  'AUTOMATION_KEY', 'AUTOMATION_USER_ID',\n];")
