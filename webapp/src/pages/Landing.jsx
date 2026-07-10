import Box from '../lib/Box.jsx';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import VideoTile from '../components/VideoTile.jsx';
import { navigate } from '../lib/router.js';

const WALL = [
  [
    { h: 430, prompt: 'Launch film for a project-management app — bold type, fast cuts', meta: '0:22 · 16:9' },
    { h: 250, prompt: 'Instagram ad for a single-origin coffee brand, warm and tactile', meta: '0:15 · 1:1' },
  ],
  [
    { h: 250, prompt: '30-second explainer of how our API pricing works', meta: '0:30 · 16:9' },
    { h: 430, prompt: 'Vertical teaser for a fitness app — night city run, beat-synced', meta: '0:18 · 9:16' },
  ],
  [
    { h: 340, prompt: 'Funding announcement — quiet confidence, serif overlays', meta: '0:20 · 16:9' },
    { h: 340, prompt: 'Product demo of our analytics dashboard from screen recordings', meta: '0:35 · 16:9' },
  ],
];
const COL_PAD = [0, 44, 20];

const STEPS = [
  { n: '01', h: 'Describe your video', p: 'Plain words. The audience, the mood, the length — like briefing a director.' },
  { n: '02', h: 'Squook directs & renders', p: 'It writes the concept, picks footage and music, sets the type, and cuts it to the beat.' },
  { n: '03', h: 'Download & post', p: 'Rendered in the right format for Reels, Shorts, or ads. Ready to ship.' },
];

const WHY = [
  { h: 'Actually looks designed', p: 'Real footage, clean typography, motion graphics synced to the music — not templated slop you have to fix.' },
  { h: 'No editing skills needed', p: 'If you can describe it, you can make it. No timeline, no keyframes, no software to learn.' },
  { h: 'Bring your own footage', p: 'Drop in product shots or b-roll and Squook edits them in — or works entirely from its licensed library.' },
  { h: 'Ready to post', p: 'Delivered in the exact format the platform wants — Reels, Shorts, TikTok, or ad specs.' },
];

const LOGOS = [
  { t: 'fathom', s: { fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: '-0.02em' } },
  { t: 'LOOPWORK', s: { fontFamily: "'JetBrains Mono',monospace", fontWeight: 500, fontSize: 15, letterSpacing: '0.2em' } },
  { t: 'Brightline', s: { fontFamily: 'Georgia,serif', fontStyle: 'italic', fontSize: 19 } },
  { t: 'NORTHWIND', s: { fontFamily: "'Instrument Sans',sans-serif", fontWeight: 600, fontSize: 17, letterSpacing: '0.08em' } },
  { t: 'atlas&co', s: { fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 500, fontSize: 18, letterSpacing: '0.02em' } },
];

const IgIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);
const YtIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M23 12c0-2.8-.3-4.6-.7-5.6-.4-1-1.2-1.6-2.2-1.8C18.2 4.2 12 4.2 12 4.2s-6.2 0-8.1.4c-1 .2-1.8.8-2.2 1.8C1.3 7.4 1 9.2 1 12s.3 4.6.7 5.6c.4 1 1.2 1.6 2.2 1.8 1.9.4 8.1.4 8.1.4s6.2 0 8.1-.4c1-.2 1.8-.8 2.2-1.8.4-1 .7-2.8.7-5.6z" opacity="0.9" />
    <path d="M10 8.8v6.4l5.5-3.2L10 8.8z" fill="#0B0B0E" />
  </svg>
);

const REVIEWS = [
  [
    { q: 'I typed two sentences and got a launch video that looked like we hired an agency. Our whole feed is Squook now.', a: 'Maya Chen', h: '@maya.builds', i: 'M', ig: true },
    { q: "My Shorts intro used to take a day in After Effects. Now it's a prompt.", a: 'Jonas Weber', h: '@JonasExplains', i: 'J', ig: false },
  ],
  [
    { q: "I've tried every AI video tool. This is the first one where I didn't open an editor afterward.", a: 'Dev Patel', h: '@DevShipsDaily', i: 'D', ig: false },
    { q: 'We shipped 12 ad variants in an afternoon. Every single one looked designed.', a: "Liam O'Connor", h: '@liam.launches', i: 'L', ig: true },
  ],
  [
    { q: 'Product ads in the right specs, cut to the beat. It replaced a week of back-and-forth with freelancers.', a: 'Sofia Reyes', h: '@sofiareyes.mkt', i: 'S', ig: true },
    { q: 'Uploaded my own b-roll and it cut it like a pro editor. The typography is actually clean.', a: 'Amara Osei', h: '@amara.creates', i: 'A', ig: true },
  ],
];

const eyebrow = {
  fontFamily: "'JetBrains Mono',monospace", fontSize: 12,
  letterSpacing: '0.14em', color: 'var(--accent)',
};
const cardStyle = {
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 28,
  background: 'rgba(255,255,255,0.02)',
};

export default function Landing() {
  return (
    <>
      <Nav active="landing" />

      {/* hero */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute', top: -260, left: '50%', transform: 'translateX(-50%)',
            width: 1100, height: 620, pointerEvents: 'none',
            background: 'radial-gradient(50% 50% at 50% 50%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 70%)',
          }}
        />
        <div style={{ position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '96px 32px 0', textAlign: 'center' }}>
          <h1
            style={{
              margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800,
              fontSize: 'clamp(52px,6.5vw,84px)', lineHeight: 1.02,
              letterSpacing: '-0.035em', textWrap: 'balance',
            }}
          >
            Videos that look designed.
            <br />
            <span style={{ color: 'rgba(244,243,240,0.55)' }}>Made from a sentence.</span>
          </h1>
          <p
            style={{
              margin: '24px auto 0', maxWidth: 560, fontSize: 19, lineHeight: 1.55,
              color: 'rgba(244,243,240,0.66)', textWrap: 'pretty',
            }}
          >
            Describe the video you want. Squook directs it — real footage, clean typography,
            motion graphics, cut to the beat — and renders it ready to post.
          </p>
        </div>

        {/* gallery wall */}
        <div
          id="gallery"
          style={{
            maxWidth: 1120, margin: '56px auto 0', padding: '0 32px', display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr', gap: 20, alignItems: 'start',
          }}
        >
          {WALL.map((col, ci) => (
            <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: COL_PAD[ci] }}>
              {col.map((tile, ti) => (
                <div key={ti} style={{ height: tile.h }}>
                  <VideoTile prompt={tile.prompt} meta={tile.meta} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p
          style={{
            margin: '18px auto 0', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12, color: 'rgba(244,243,240,0.38)',
          }}
        >
          Every video above was made from the prompt on its card. Nothing else.
        </p>

        <div style={{ textAlign: 'center', padding: '44px 32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Box
            t="a" href="#/app"
            onClick={(e) => { e.preventDefault(); navigate('app'); }}
            s="display:inline-block;text-decoration:none;background:var(--accent);color:#0B0B0E;font-weight:600;font-size:17px;padding:16px 36px;border-radius:12px;transition:filter .15s, transform .15s"
            sh="filter:brightness(1.12);transform:translateY(-1px)"
          >
            Try Squook — it's free
          </Box>
          <span style={{ fontSize: 13.5, color: 'rgba(244,243,240,0.45)' }}>No editing skills. No credit card.</span>
        </div>
      </section>

      {/* how it works */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '128px 32px 0' }}>
        <div style={eyebrow}>HOW IT WORKS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginTop: 28 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={cardStyle}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: 'rgba(244,243,240,0.4)' }}>{s.n}</div>
              <h3 style={{ margin: '14px 0 8px', fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 21, letterSpacing: '-0.01em' }}>{s.h}</h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'rgba(244,243,240,0.6)' }}>{s.p}</p>
            </div>
          ))}
        </div>
        <p style={{ margin: '20px 0 0', fontSize: 14.5, color: 'rgba(244,243,240,0.5)' }}>
          Squook composes from licensed stock footage, music, and motion graphics —{' '}
          <span style={{ color: '#F4F3F0' }}>or footage you upload yourself.</span>
        </p>
      </section>

      {/* why different */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '128px 32px 0' }}>
        <div style={eyebrow}>WHY SQUOOK</div>
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          {WHY.map((w) => (
            <div
              key={w.h}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'baseline',
                padding: '30px 0', borderBottom: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <h3 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 'clamp(26px,3vw,36px)', letterSpacing: '-0.02em' }}>{w.h}</h3>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: 'rgba(244,243,240,0.6)' }}>{w.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* social proof */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '112px 32px 0', textAlign: 'center' }}>
        <p style={{ margin: '0 0 28px', fontSize: 13.5, letterSpacing: '0.06em', color: 'rgba(244,243,240,0.4)' }}>
          Trusted by teams shipping video every week
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 52, flexWrap: 'wrap', opacity: 0.5 }}>
          {LOGOS.map((l) => (
            <span key={l.t} style={{ ...l.s, color: '#F4F3F0' }}>{l.t}</span>
          ))}
        </div>

        {/* review wall */}
        <div style={{ marginTop: 96, textAlign: 'left' }}>
          <div style={eyebrow}>REVIEW WALL</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginTop: 28, alignItems: 'start' }}>
            {REVIEWS.map((col, ci) => (
              <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {col.map((r) => (
                  <div
                    key={r.a}
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24,
                      background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 18,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: 'rgba(244,243,240,0.85)' }}>"{r.q}"</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 15,
                          color: 'rgba(244,243,240,0.8)',
                        }}
                      >
                        {r.i}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{r.a}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'rgba(244,243,240,0.5)' }}>
                          {r.ig ? <IgIcon /> : <YtIcon />}
                          {r.h}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* closing CTA */}
      <section
        style={{
          position: 'relative', overflow: 'hidden', marginTop: 140,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
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
            Your first video is
            <br />
            one sentence away.
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
