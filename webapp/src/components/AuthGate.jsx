import { useState } from 'react';
import Box from '../lib/Box.jsx';
import { css } from '../lib/css.js';
import { supabase, useSession } from '../lib/supabase.js';

/**
 * Sign-in wall for the app routes. Email + password via Supabase; renders the
 * children once there's a session. With no Supabase config (local dev against
 * an ALLOW_ANON API) it's a pass-through.
 */

const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";
const field = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.14);border-radius:11px;padding:12px 14px;color:#F4F3F0;font-size:15px;outline:none';

export default function AuthGate({ children }) {
  const session = useSession();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { text, error }

  if (!supabase || session) return children;
  if (session === undefined) return null; // restoring a saved session

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'signup'
      ? await supabase.auth.signUp(creds)
      : await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) return setMsg({ text: error.message, error: true });
    // Projects that require email confirmation return no session on sign-up.
    if (mode === 'signup' && !data.session) setMsg({ text: 'Check your email to confirm your account, then sign in.' });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Box t="a" href="#/" s="display:flex;align-items:center;gap:10px;text-decoration:none;margin-bottom:14px">
          <span style={css('width:14px;height:14px;background:var(--accent);border-radius:3px;transform:rotate(45deg);display:inline-block')} />
          <span style={{ fontFamily: grotesk, fontWeight: 800, fontSize: 18, color: '#F4F3F0' }}>Squook</span>
        </Box>
        <h1 style={{ margin: 0, fontFamily: grotesk, fontWeight: 800, fontSize: 30, letterSpacing: '-0.02em', color: '#F4F3F0' }}>
          {mode === 'signup' ? 'Create your account' : 'Sign in'}
        </h1>
        <p style={{ margin: '0 0 8px', fontSize: 14.5, color: 'rgba(244,243,240,0.55)', lineHeight: 1.5 }}>
          Paste your landing page, get a launch video.
        </p>
        <input type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={css(field)} />
        <input type="password" required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={css(field)} />
        {msg && <div style={{ fontSize: 13.5, color: msg.error ? '#ff8a7a' : 'var(--accent)', lineHeight: 1.5 }}>{msg.text}</div>}
        <button type="submit" disabled={busy} style={css(`cursor:pointer;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:600;background:var(--accent);color:#0B0B0E;margin-top:4px${busy ? ';opacity:0.6' : ''}`)}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <button type="button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg(null); }}
          style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'rgba(244,243,240,0.6)', fontFamily: mono, fontSize: 12, marginTop: 4 }}>
          {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}
