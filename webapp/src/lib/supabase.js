import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase auth for the webapp. Without VITE_SUPABASE_URL / _ANON_KEY the app
// runs signed-out against an ALLOW_ANON dev API (supabase === null).
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

// The current access token, kept in sync so api.js can attach it synchronously
// (including on <img>/<video> URLs, which can't send headers).
let token = null;
export const authToken = () => token;

if (supabase) {
  supabase.auth.getSession().then(({ data }) => { token = data.session?.access_token || null; });
  supabase.auth.onAuthStateChange((_event, session) => { token = session?.access_token || null; });
}

/** undefined while loading, null when signed out, else the Supabase session. */
export function useSession() {
  const [session, setSession] = useState(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s || null));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export const signOut = () => supabase?.auth.signOut();
