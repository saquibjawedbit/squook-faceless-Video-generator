import Box from '../lib/Box.jsx';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { navigate } from '../lib/router.js';

const eyebrow = {
  fontFamily: "'JetBrains Mono',monospace", fontSize: 12,
  letterSpacing: '0.14em', color: 'var(--accent)',
};

const STATS = [
  { n: '2M+', l: 'Videos rendered' },
  { n: '120k', l: 'Creators & teams' },
  { n: '190', l: 'Countries' },
  { n: '40s', l: 'Avg. time to first cut' },
];

const VALUES = [
  { h: 'Taste is the feature', p: 'Anyone can generate a video. We obsess over the ones that actually look designed — the typography, the pacing, the cut on the beat.' },
  { h: 'A sentence should be enough', p: 'The interface is the prompt. Every step we can remove between an idea and a finished video is a step we remove.' },
  { h: 'Licensed, always', p: 'Every frame of footage and every note of music Squook composes from is cleared for commercial use. No takedown surprises, ever.' },
  { h: 'Ship, then ship again', p: 'We would rather put something real in your hands this week than a perfect thing next quarter. The product improves in public.' },
];

const TEAM = [
  { i: 'R', name: 'Rhea Nair', role: 'Co-founder · CEO' },
  { i: 'T', name: 'Theo Larsson', role: 'Co-founder · CTO' },
  { i: 'M', name: 'Mina Adeyemi', role: 'Head of Design' },
  { i: 'K', name: 'Kai Tanaka', role: 'Head of Research' },
];

const cardStyle = {
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 28,
  background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 10,
};

export default function About() {
  return (
    <>
      <Nav active="about" />

      {/* hero */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute', top: -260, left: '50%', transform: 'translateX(-50%)',
            width: 1000, height: 560, pointerEvents: 'none',
            background: 'radial-gradient(50% 50% at 50% 50%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '96px 32px 0',
            textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22,
          }}
        >
          <div style={eyebrow}>ABOUT SQUOOK</div>
          <h1 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(44px,5.5vw,72px)', lineHeight: 1.02, letterSpacing: '-0.035em', textWrap: 'balance' }}>
            We think everyone
            <br />
            <span style={{ color: 'rgba(244,243,240,0.55)' }}>should be able to make video.</span>
          </h1>
          <p style={{ margin: 0, maxWidth: 620, fontSize: 19, lineHeight: 1.55, color: 'rgba(244,243,240,0.66)', textWrap: 'pretty' }}>
            Great video has always been gated behind editors, timelines, and taste most people
            never had time to build. Squook is an AI director that closes that gap — so a sentence
            is all it takes to ship something that looks designed.
          </p>
        </div>
      </section>

      {/* stats */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 32px 0' }}>
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 20,
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18,
            background: 'rgba(255,255,255,0.02)', padding: '36px 28px',
          }}
        >
          {STATS.map((s) => (
            <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', textAlign: 'center' }}>
              <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: '-0.03em' }}>{s.n}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: '0.08em', color: 'rgba(244,243,240,0.5)' }}>{s.l}</span>
            </div>
          ))}
        </div>
      </section>

      {/* story */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '128px 32px 0' }}>
        <div style={eyebrow}>OUR STORY</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 48, marginTop: 28, alignItems: 'start' }}>
          <h2 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 'clamp(28px,3.4vw,40px)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            It started with a bad launch video.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontSize: 16.5, lineHeight: 1.65, color: 'rgba(244,243,240,0.7)' }}>
            <p style={{ margin: 0 }}>
              In 2024 we were two founders and a designer trying to announce a product. A week of
              After Effects later, we had ninety seconds we weren't proud of — and we'd shipped nothing else.
            </p>
            <p style={{ margin: 0 }}>
              The tools that promised to help all produced the same templated slop you had to fix by hand.
              So we built the thing we actually wanted: a director you brief in plain words, that picks the
              footage and music, sets the type, and cuts to the beat — then hands you a file ready to post.
            </p>
            <p style={{ margin: 0 }}>
              Squook is that director. Today it's used by founders, marketers, and creators in 190 countries
              to make video that looks designed, from a sentence.
            </p>
          </div>
        </div>
      </section>

      {/* values */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '128px 32px 0' }}>
        <div style={eyebrow}>WHAT WE BELIEVE</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 28 }}>
          {VALUES.map((v) => (
            <div key={v.h} style={cardStyle}>
              <h3 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 21, letterSpacing: '-0.01em' }}>{v.h}</h3>
              <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: 'rgba(244,243,240,0.6)' }}>{v.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* team */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '128px 32px 0' }}>
        <div style={eyebrow}>THE TEAM</div>
        <p style={{ margin: '12px 0 0', maxWidth: 560, fontSize: 16, lineHeight: 1.55, color: 'rgba(244,243,240,0.6)' }}>
          A small crew of designers, engineers, and film people — building from Lisbon and remotely.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 20, marginTop: 28 }}>
          {TEAM.map((m) => (
            <div key={m.name} style={{ ...cardStyle, gap: 16 }}>
              <span
                style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'color-mix(in oklab, var(--accent) 18%, rgba(255,255,255,0.06))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 20,
                  color: '#F4F3F0',
                }}
              >
                {m.i}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 15.5, fontWeight: 600 }}>{m.name}</span>
                <span style={{ fontSize: 13, color: 'rgba(244,243,240,0.5)' }}>{m.role}</span>
              </div>
            </div>
          ))}
        </div>
        <p style={{ margin: '28px 0 0', fontSize: 14.5, color: 'rgba(244,243,240,0.5)' }}>
          We're hiring across design, research, and infrastructure.{' '}
          <span style={{ color: '#F4F3F0' }}>Come build the director with us.</span>
        </p>
      </section>

      {/* closing CTA */}
      <section style={{ position: 'relative', overflow: 'hidden', marginTop: 140, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div
          style={{
            position: 'absolute', bottom: -300, left: '50%', transform: 'translateX(-50%)',
            width: 1000, height: 560, pointerEvents: 'none',
            background: 'radial-gradient(50% 50% at 50% 50%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '120px 32px',
            textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26,
          }}
        >
          <h2 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(38px,4.5vw,60px)', letterSpacing: '-0.03em', lineHeight: 1.05, textWrap: 'balance' }}>
            Make something that
            <br />
            looks designed.
          </h2>
          <Box
            t="a" href="#/app"
            onClick={(e) => { e.preventDefault(); navigate('app'); }}
            s="display:inline-block;text-decoration:none;background:var(--accent);color:#0B0B0E;font-weight:600;font-size:17px;padding:16px 36px;border-radius:12px;transition:filter .15s, transform .15s"
            sh="filter:brightness(1.12);transform:translateY(-1px)"
          >
            Start free
          </Box>
        </div>
      </section>

      <Footer />
    </>
  );
}
