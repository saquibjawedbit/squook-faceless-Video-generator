import Box from '../lib/Box.jsx';
import { navigate } from '../lib/router.js';

export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div
        style={{
          maxWidth: 1120, margin: '0 auto', padding: 32, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 16,
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            color: 'rgba(244,243,240,0.45)', fontSize: 13.5,
          }}
        >
          <span
            style={{
              width: 10, height: 10, background: 'var(--accent)',
              borderRadius: 2, transform: 'rotate(45deg)', display: 'inline-block',
            }}
          />
          © 2026 Squook
        </div>
        <nav style={{ display: 'flex', gap: 24, fontSize: 13.5 }}>
          {[
            { l: 'About', to: 'about' },
            { l: 'Contact', to: null },
            { l: 'Terms', to: null },
            { l: 'Privacy', to: null },
          ].map(({ l, to }) => (
            <Box
              key={l} t="a" href={to ? `#/${to}` : '#'}
              onClick={(e) => { e.preventDefault(); if (to) navigate(to); }}
              s="text-decoration:none;color:rgba(244,243,240,0.45)"
              sh="color:#F4F3F0"
            >
              {l}
            </Box>
          ))}
        </nav>
      </div>
    </footer>
  );
}
