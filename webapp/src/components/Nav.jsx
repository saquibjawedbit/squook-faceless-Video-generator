import Box from '../lib/Box.jsx';
import { navigate } from '../lib/router.js';

function Brand({ onClick }) {
  return (
    <Box
      t="a"
      href="#/"
      onClick={(e) => { e.preventDefault(); onClick(); }}
      s="display:flex;align-items:center;gap:10px;text-decoration:none"
    >
      <span
        style={{
          width: 14, height: 14, background: 'var(--accent)',
          borderRadius: 3, transform: 'rotate(45deg)', display: 'inline-block',
        }}
      />
      <span
        style={{
          fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800,
          fontSize: 19, letterSpacing: '-0.02em',
        }}
      >
        Squook
      </span>
    </Box>
  );
}

// Shared marketing-site header. `active` = 'landing' | 'pricing'.
export default function Nav({ active = 'landing' }) {
  const goGallery = (e) => {
    e.preventDefault();
    if (active === 'landing') {
      document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('');
      setTimeout(
        () => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }),
        60
      );
    }
  };

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(14px)',
        background: 'rgba(11,11,14,0.72)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          maxWidth: 1120, margin: '0 auto', padding: '0 32px', height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Brand onClick={() => navigate('')} />
        <nav style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Box
            t="a" href="#/#gallery" onClick={goGallery}
            s="text-decoration:none;font-size:14.5px;color:rgba(244,243,240,0.7)"
            sh="color:#F4F3F0"
          >
            Gallery
          </Box>
          {active === 'pricing' ? (
            <a
              href="#/pricing"
              onClick={(e) => e.preventDefault()}
              style={{ textDecoration: 'none', fontSize: 14.5, color: '#F4F3F0' }}
            >
              Pricing
            </a>
          ) : (
            <Box
              t="a" href="#/pricing"
              onClick={(e) => { e.preventDefault(); navigate('pricing'); }}
              s="text-decoration:none;font-size:14.5px;color:rgba(244,243,240,0.7)"
              sh="color:#F4F3F0"
            >
              Pricing
            </Box>
          )}
          <Box
            t="a" href="#/app"
            onClick={(e) => { e.preventDefault(); navigate('app'); }}
            s="text-decoration:none;font-size:14.5px;font-weight:600;background:var(--accent);color:#0B0B0E;padding:9px 18px;border-radius:9px;transition:filter .15s"
            sh="filter:brightness(1.12)"
          >
            Start free
          </Box>
        </nav>
      </div>
    </header>
  );
}
