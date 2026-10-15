import {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';

// Loads the brand's own Google font (the server only passes names it verified
// exist on Google Fonts). The render waits for it, with a timeout so a slow or
// failed font never blocks a video — it just falls back to the pack's face.
export const BrandFont: React.FC<{family: string; href?: string}> = ({family, href}) => {
  const [handle] = useState(() => delayRender(`brand font ${family}`, {timeoutInMilliseconds: 20000}));
  useEffect(() => {
    const id = `brand-font-${family}`;
    let done = false;
    const finish = () => { if (!done) { done = true; continueRender(handle); } };
    const loadFaces = () => Promise.all([400, 700].map((w) => document.fonts.load(`${w} 40px '${family}'`)))
      .catch(() => {})
      .finally(finish);
    const existing = document.getElementById(id) as HTMLLinkElement | null;
    if (existing) loadFaces();
    else {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      // The server picks a stylesheet URL it verified (with bold weights when the family has them).
      link.href = href || `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=block`;
      link.onload = loadFaces;
      link.onerror = finish;
      document.head.appendChild(link);
    }
    const t = setTimeout(finish, 8000);
    return () => clearTimeout(t);
  }, [family, href, handle]);
  return null;
};
