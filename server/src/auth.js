import { createClient } from '@supabase/supabase-js';
import { config, authEnabled } from './config.js';

// A server client used purely to validate a caller's access token. getUser()
// checks the JWT against the Supabase Auth server (network-verified), which is
// the safe choice and works with the publishable key — no service key needed.
const supabase = authEnabled
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (typeof req.query.token === 'string') return req.query.token; // for <video> src
  return null;
}

// Express middleware. Attaches req.user = { id, email }. If Supabase isn't
// configured, or ALLOW_ANON=true and no token is sent, falls back to a dev user.
export async function requireAuth(req, res, next) {
  const token = bearer(req);

  if (!authEnabled || (config.allowAnon && !token)) {
    req.user = { id: 'anon', email: 'anon@local' };
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = { id: data.user.id, email: data.user.email };
    next();
  } catch (e) {
    res.status(500).json({ error: 'Auth check failed', detail: String(e.message || e) });
  }
}
