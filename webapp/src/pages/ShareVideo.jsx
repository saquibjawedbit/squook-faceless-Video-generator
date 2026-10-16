import { useEffect, useState } from 'react';
import { Player } from '@remotion/player';
import { prefetch } from 'remotion';
import { MainVideo } from '@renderer/MainVideo';
import { currentQuery, currentRoute } from '../lib/router.js';
import { apiBase, getShared } from '../lib/api.js';
import './fast.css';

/**
 * Public page for a video made for a prospect (`#/v/<token>`): no sign-in.
 * Plays the video and offers it — the founding plan's payment link comes from
 * the server's runtime settings (SALES_LINK).
 */

const runtime = (typeof window !== 'undefined' && window.__SQUOOK__) || {};
const CONTACT = 'saquibjawed4444@gmail.com';

export default function ShareVideo() {
  const token = currentRoute().split('/')[1] || '';
  const ref = currentQuery().get('r') || '';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  if (data) globalThis.__SQUOOK_ASSET_RESOLVE__ = (p) => `${apiBase}/api/projects/${data.id}/assets/${p}`;

  useEffect(() => { getShared(token, ref).then(setData).catch((e) => setError(String(e.message || e))); }, [token, ref]);

  useEffect(() => {
    if (!data) return undefined;
    const paths = new Set();
    const walk = (v) => {
      if (typeof v === 'string') { if (/^assets\/.+\.(jpe?g|png|svg|webp|mp3)$/i.test(v)) paths.add(v); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(data.ir);
    const handles = [...paths].map((p) => prefetch(`${apiBase}/api/projects/${data.id}/assets/${p}`, { method: 'blob-url' }));
    return () => handles.forEach((h) => h.free());
  }, [data]);

  const ir = data?.ir;
  const ar = ir ? ir.metadata.width / ir.metadata.height : 16 / 9;
  const price = runtime.salesPrice || '$29/month';
  const buy = runtime.salesLink || `mailto:${CONTACT}?subject=${encodeURIComponent(`I want the ${ir?.metadata?.title || ''} video`)}`;
  const credit = ir?.metadata?.credits;

  return (
    <div className="fx fx-share">
      <div className="fx-start-top">
        <a className="fx-brand" href="#/"><span className="fx-logo">S</span> Squook</a>
        <a className="fx-btn ghost" href={`mailto:${CONTACT}`}>Contact</a>
      </div>
      <div className="fx-share-main">
        {error ? <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '20vh' }}>{error}</p> : (
          <>
            <p className="fx-eyebrow">A video made for you</p>
            <h1 className="serif">{ir ? ir.metadata.title : 'Loading…'}</h1>
            <p className="sub">Made from your website by Squook, in under a minute. No editing, no filming.</p>
            <div className="fx-share-frame" style={{ '--ar': ar, maxWidth: ar < 1 ? 380 : 960 }}>
              {ir ? (
                <Player
                  component={MainVideo} inputProps={{ ir }}
                  durationInFrames={ir.metadata.total_frames} fps={ir.metadata.fps}
                  compositionWidth={ir.metadata.width} compositionHeight={ir.metadata.height}
                  style={{ width: '100%', height: '100%' }}
                  controls numberOfSharedAudioTags={24} acknowledgeRemotionLicense
                />
              ) : <div className="fx-skeleton">Loading the video…</div>}
            </div>
            {credit ? <div className="fx-credit" style={{ marginTop: 8 }}>{credit}</div> : null}

            <div className="fx-offer">
              <div>
                <div className="fx-offer-title">Want this video?</div>
                <ul>
                  <li>This video in full HD, yours to post anywhere</li>
                  <li>Change anything by just asking: wording, music, voice, scenes</li>
                  <li>Unlimited new videos for every launch and feature</li>
                  <li>Wide, tall and square versions for every channel</li>
                </ul>
              </div>
              <div className="fx-offer-buy">
                <div className="fx-price"><span className="serif">{price.split('/')[0]}</span>/{price.split('/')[1] || 'month'}</div>
                <div className="fx-price-note">Founding price, locked for a year. Cancel anytime.</div>
                <a className="fx-btn accent fx-buy" href={buy} target="_blank" rel="noreferrer">Get this video</a>
                <a className="fx-btn ghost" href={`mailto:${CONTACT}?subject=${encodeURIComponent('Question about Squook')}`}>Ask a question</a>
              </div>
            </div>
            <p className="fx-share-foot">Saquib Jawed, founder of Squook · <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
          </>
        )}
      </div>
    </div>
  );
}
