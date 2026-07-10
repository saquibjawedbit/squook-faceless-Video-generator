// Fixed full-screen vignette + film-grain overlays. Opacity is driven by the
// --vig-o / --grain-o CSS vars so the theme toggle can fade them out.
const GRAIN =
  "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/%3E%3C/filter%3E%3Crect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')";

export default function Atmosphere() {
  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 40,
          opacity: 'var(--vig-o)',
          background:
            'radial-gradient(120% 100% at 50% 30%, transparent 55%, rgba(0,0,0,0.5) 100%)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 41,
          opacity: 'var(--grain-o)',
          backgroundImage: GRAIN,
        }}
      />
    </>
  );
}
