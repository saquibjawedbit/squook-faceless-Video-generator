import { useState } from 'react';
import Box from '../lib/Box.jsx';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { navigate } from '../lib/router.js';

const eyebrow = {
  fontFamily: "'JetBrains Mono',monospace", fontSize: 12,
  letterSpacing: '0.14em', color: 'var(--accent)',
};

function Feature({ children }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: 'var(--accent)' }}>✓</span>
      {children}
    </div>
  );
}

function Tier({ featured, name, price, note, blurb, cta, ctaFilled, features }) {
  const wrap = featured
    ? {
        position: 'relative',
        border: '1px solid color-mix(in oklab, var(--accent) 55%, transparent)',
        borderRadius: 18, padding: '32px 28px',
        background: 'linear-gradient(180deg, color-mix(in oklab, var(--accent) 7%, transparent), rgba(255,255,255,0.02) 45%)',
        display: 'flex', flexDirection: 'column', gap: 24,
        boxShadow: '0 0 60px color-mix(in oklab, var(--accent) 12%, transparent)',
      }
    : {
        border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, padding: '32px 28px',
        background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 24,
      };

  return (
    <div style={wrap}>
      {featured && (
        <span
          style={{
            position: 'absolute', top: -11, left: 28, fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10.5, letterSpacing: '0.12em', background: 'var(--accent)', color: '#0B0B0E',
            fontWeight: 500, padding: '4px 10px', borderRadius: 99,
          }}
        >
          MOST POPULAR
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 20 }}>{name}</h3>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 44, letterSpacing: '-0.03em' }}>{price}</span>
          {note && <span style={{ fontSize: 14, color: 'rgba(244,243,240,0.5)' }}>{note}</span>}
        </div>
        <span style={{ fontSize: 13.5, color: 'rgba(244,243,240,0.5)' }}>{blurb}</span>
      </div>
      <Box
        t="a" href="#/app"
        onClick={(e) => { e.preventDefault(); navigate('app'); }}
        s={
          ctaFilled
            ? 'text-decoration:none;text-align:center;font-weight:600;font-size:15px;padding:13px 0;border-radius:11px;background:var(--accent);color:#0B0B0E;transition:filter .15s'
            : 'text-decoration:none;text-align:center;font-weight:600;font-size:15px;padding:13px 0;border-radius:11px;border:1px solid rgba(255,255,255,0.16);color:#F4F3F0;transition:border-color .15s'
        }
        sh={ctaFilled ? 'filter:brightness(1.12)' : 'border-color:rgba(255,255,255,0.4)'}
      >
        {cta}
      </Box>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14.5, lineHeight: 1.4, color: 'rgba(244,243,240,0.75)' }}>
        {features.map((f) => <Feature key={f}>{f}</Feature>)}
      </div>
    </div>
  );
}

const FAQ = [
  { q: 'Who owns the videos I make?', a: 'You do. On paid plans every render comes with a full commercial license — use it in ads, on your site, anywhere.' },
  { q: 'Is the footage and music licensed?', a: 'Yes. Everything Squook composes from — stock footage, music, motion graphics — is licensed for commercial use. No takedown surprises.' },
  { q: 'Can I use my own footage?', a: 'On Pro and Studio, upload product shots or b-roll and Squook edits them into the cut alongside — or instead of — stock.' },
  { q: 'What counts as a video?', a: "One finished render. Re-prompting or tweaking a draft before you export doesn't count — only the final download does." },
];

export default function Pricing() {
  const [yearly, setYearly] = useState(true);

  const on = '#F4F3F0';
  const off = 'transparent';
  const toggleBtn = (active, isMonthly) => ({
    border: 'none', cursor: 'pointer', borderRadius: 9, padding: '9px 20px',
    fontSize: 14, fontWeight: 600, transition: 'background .15s',
    background: active ? on : off,
    color: active ? '#0B0B0E' : 'rgba(244,243,240,0.6)',
  });

  const billNote = yearly ? '/mo, billed yearly' : '/mo, billed monthly';

  return (
    <>
      <Nav active="pricing" />

      {/* hero */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute', top: -280, left: '50%', transform: 'translateX(-50%)',
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
          <h1 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(44px,5.5vw,68px)', lineHeight: 1.03, letterSpacing: '-0.03em', textWrap: 'balance' }}>
            Simple pricing.
            <br />
            <span style={{ color: 'rgba(244,243,240,0.55)' }}>Serious videos.</span>
          </h1>
          <p style={{ margin: 0, maxWidth: 460, fontSize: 18, lineHeight: 1.55, color: 'rgba(244,243,240,0.66)' }}>
            Start free. Upgrade when you're ready to ship more.
          </p>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 4, border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: 4, background: 'rgba(255,255,255,0.03)',
            }}
          >
            <button onClick={() => setYearly(false)} style={toggleBtn(!yearly, true)}>Monthly</button>
            <button onClick={() => setYearly(true)} style={toggleBtn(yearly, false)}>
              Yearly <span style={{ opacity: 0.75, fontWeight: 500 }}>−20%</span>
            </button>
          </div>
        </div>
      </section>

      {/* tiers */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '56px 32px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, alignItems: 'stretch' }}>
          <Tier
            name="Starter" price="$0" blurb="For trying Squook out" cta="Start free"
            features={['3 videos per month', '720p, with watermark', 'Full stock footage & music library', 'Reels & Shorts formats']}
          />
          <Tier
            featured ctaFilled
            name="Pro" price={yearly ? '$25' : '$32'} note={billNote}
            blurb="For founders & creators shipping weekly" cta="Start with Pro"
            features={['30 videos per month', '1080p & 4K, no watermark', 'Upload your own footage', 'Every platform format, incl. ad specs', 'Full commercial license']}
          />
          <Tier
            name="Studio" price={yearly ? '$96' : '$120'} note={billNote}
            blurb="For teams that run on video" cta="Start with Studio"
            features={['Everything in Pro', '150 videos per month, 5 seats', 'Brand kit — your fonts, colors, logo', 'Priority renders', 'Dedicated support']}
          />
        </div>
        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 13.5, color: 'rgba(244,243,240,0.45)' }}>
          Every plan includes the AI director, licensed music, and motion graphics. Cancel anytime.
        </p>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '120px 32px 0' }}>
        <div style={eyebrow}>QUESTIONS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px 60px', marginTop: 28 }}>
          {FAQ.map((f) => (
            <div key={f.q} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 700, fontSize: 18 }}>{f.q}</h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'rgba(244,243,240,0.6)' }}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* closing CTA */}
      <section style={{ position: 'relative', overflow: 'hidden', marginTop: 130, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div
          style={{
            position: 'absolute', bottom: -300, left: '50%', transform: 'translateX(-50%)',
            width: 1000, height: 560, pointerEvents: 'none',
            background: 'radial-gradient(50% 50% at 50% 50%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '110px 32px',
            textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26,
          }}
        >
          <h2 style={{ margin: 0, fontFamily: "'Schibsted Grotesk',sans-serif", fontWeight: 800, fontSize: 'clamp(36px,4.5vw,56px)', letterSpacing: '-0.03em', lineHeight: 1.05, textWrap: 'balance' }}>
            Try it free.
            <br />
            Keep it if it's beautiful.
          </h2>
          <Box
            t="a" href="#/app"
            onClick={(e) => { e.preventDefault(); navigate('app'); }}
            s="display:inline-block;text-decoration:none;background:var(--accent);color:#0B0B0E;font-weight:600;font-size:17px;padding:16px 36px;border-radius:12px;transition:filter .15s, transform .15s"
            sh="filter:brightness(1.12);transform:translateY(-1px)"
          >
            Make your first video
          </Box>
        </div>
      </section>

      <Footer />
    </>
  );
}
