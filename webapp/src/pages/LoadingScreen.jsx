const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";

// The generation pipeline is a fixed sequence, so a stepper (not a spinner) is
// the honest visual — it shows where in the process we are.
const STEPS = [
  { key: 'directing', label: 'Narrating & gathering footage', note: 'Voice-over, stock, graphics' },
  { key: 'rendering', label: 'Rendering the video', note: 'Compositing every frame' },
  { key: 'mastering', label: 'Mastering the audio', note: 'Balancing to broadcast loudness' },
];
const order = (k) => Math.max(0, STEPS.findIndex((s) => s.key === k));

export default function LoadingScreen({ stage, progress = 0, prompt = '', title = '' }) {
  const active = stage === 'done' ? STEPS.length : (stage === 'queued' || !stage ? 0 : order(stage));

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`@keyframes sqpulse{0%,100%{box-shadow:0 0 0 0 var(--accent)}50%{box-shadow:0 0 0 6px transparent}}
        @keyframes sqshimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--accent)' }}>GENERATING</div>
        <h1 style={{ margin: '10px 0 6px', fontFamily: grotesk, fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em', color: '#F4F3F0' }}>
          {title ? `Making “${title}”` : 'Making your video'}
        </h1>
        {prompt && (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'rgba(244,243,240,0.5)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {prompt}
          </p>
        )}

        {/* stepper */}
        <div style={{ margin: '30px 0 26px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {STEPS.map((s, i) => {
            const done = i < active;
            const now = i === active;
            const dotBg = done ? 'var(--accent)' : now ? 'transparent' : 'transparent';
            const dotBorder = done ? 'var(--accent)' : now ? 'var(--accent)' : 'rgba(255,255,255,0.18)';
            return (
              <div key={s.key} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0' }}>
                <div style={{ position: 'relative', flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%', background: dotBg, border: `2px solid ${dotBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: now ? 'sqpulse 1.4s ease-in-out infinite' : 'none',
                  }}>
                    {done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0B0B0E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  {i < STEPS.length - 1 && <span style={{ width: 2, height: 26, marginTop: 4, background: done ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }} />}
                </div>
                <div style={{ paddingTop: -1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: now ? 600 : 500, color: now ? '#F4F3F0' : done ? 'rgba(244,243,240,0.7)' : 'rgba(244,243,240,0.4)' }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: 'rgba(244,243,240,0.35)', marginTop: 2 }}>{s.note}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* progress */}
        <div style={{ position: 'relative', height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${Math.max(4, Math.min(100, progress))}%`, background: 'var(--accent)', borderRadius: 99, transition: 'width .5s ease' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent)', animation: 'sqshimmer 1.6s linear infinite' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 11.5, color: 'rgba(244,243,240,0.45)' }}>This usually takes a couple of minutes</span>
          <span style={{ fontFamily: mono, fontSize: 11.5, color: 'var(--accent)' }}>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}
