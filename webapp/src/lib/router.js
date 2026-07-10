import { useEffect, useState } from 'react';

// Tiny hash router — no dependency. Routes: '' (landing), 'pricing', 'app'.
export function currentRoute() {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h.split('?')[0];
}

// Query params carried in the hash, e.g. `#/editor?id=abc` → get('id') === 'abc'.
export function currentQuery() {
  const h = window.location.hash.replace(/^#\/?/, '');
  return new URLSearchParams(h.split('?')[1] || '');
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function navigate(to) {
  window.location.hash = to ? `/${to}` : '/';
}
