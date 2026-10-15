import { useEffect, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { MainVideo } from '@renderer/MainVideo';
import Box from '../lib/Box.jsx';
import { css } from '../lib/css.js';
import { navigate, currentQuery } from '../lib/router.js';
import { apiBase, createFastVideo, getIR, getProject, getPlaybackUrl } from '../lib/api.js';

/**
 * Fast mode (`#/fast`, `#/fast?id=…`): paste a link or type a topic, and the
 * video plays here in seconds — the browser renders the scene templates live
 * from the IR. The MP4 is rendered on the server in the background and the
 * download button appears when it's ready.
 */

const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";
const ASPECT = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1' };
const LENGTHS = { promo: [15, 60, 30], explainer: [30, 180, 90] };
const LOOKS = [['', 'Auto style'], ['clean', 'Clean'], ['bold', 'Bold'], ['tech', 'Tech'], ['playful', 'Playful'], ['corporate', 'Corporate'], ['editorial', 'Editorial']];

const chip = (on) => `border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer;border:1px solid ${on ? 'var(--accent)' : 'rgba(255,255,255,0.14)'};background:${on ? 'rgba(255,107,53,0.12)' : 'transparent'};color:${on ? '#F4F3F0' : 'rgba(244,243,240,0.7)'}`;

export default function FastVideo() {
  const [id, setId] = useState(currentQuery().get('id'));
  const [input, setInput] = useState('');
  const [style, setStyle] = useState('promo');
  const [format, setFormat] = useState('16:9');
  const [duration, setDuration] = useState(30);
  const [look, setLook] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [took, setTook] = useState(null);
  const [error, setError] = useState(null);
  const [ir, setIr] = useState(null);
  const [project, setProject] = useState(null);
  const [mp4, setMp4] = useState(null);
  const started = useRef(0);

  // Media in the IR is served from the project's snapshot. Set during render,
  // not in an effect: the Player resolves asset URLs on its first render.
  if (id) globalThis.__SQUOOK_ASSET_RESOLVE__ = (p) => `${apiBase}/api/projects/${id}/assets/${p}`;
  useEffect(() => () => { delete globalThis.__SQUOOK_ASSET_RESOLVE__; }, []);

  // Opened from a link: load the saved IR.
  useEffect(() => {
    if (id && !ir) getIR(id).then(setIr).catch((e) => setError(String(e.message || e)));
  }, [id, ir]);

  // Poll for the background MP4.
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const p = await getProject(id);
        if (!alive) return;
        setProject(p);
        if (p.status === 'done') setMp4(await getPlaybackUrl(id));
        else if (p.status !== 'failed') timer = setTimeout(tick, 3000);
      } catch { timer = setTimeout(tick, 5000); }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [busy]);

  const pickStyle = (s) => { setStyle(s); setDuration(LENGTHS[s][2]); };

  const make = async () => {
    const text = input.trim();
    if (!text) return;
    const isUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text);
    setBusy(true); setError(null); setId(null); setIr(null); setMp4(null); setProject(null); setTook(null);
    started.current = Date.now(); setElapsed(0);
    try {
      const r = await createFastVideo({ ...(isUrl ? { url: text } : { topic: text }), style, look, format, duration });
      setTook(((Date.now() - started.current) / 1000).toFixed(1));
      setId(r.project.id);
      setIr(r.ir);
      window.history.replaceState(null, '', `#/fast?id=${r.project.id}`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const [min, max] = LENGTHS[style];
  const fileName = (ir?.metadata?.title || 'squook-video').replace(/[^\w-]+/g, '_') + '.mp4';
  const downloadHref = mp4 && mp4 + (mp4.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(fileName);
  const fmt = ir ? `${ir.metadata.width}x${ir.metadata.height}` : '';
  const aspect = ir ? (ir.metadata.width > ir.metadata.height ? '16 / 9' : ir.metadata.width < ir.metadata.height ? '9 / 16' : '1 / 1') : ASPECT[format];

  return (
    <div style={css('max-width:1100px;margin:0 auto;padding:40px 32px 80px')}>
      <Box t="a" href="#/app" onClick={(e) => { e.preventDefault(); navigate('app'); }} s="font-family:'JetBrains Mono',monospace;font-size:11.5px;letter-spacing:0.12em;color:rgba(244,243,240,0.55);text-decoration:none" sh="color:#F4F3F0">← BACK TO HOME</Box>
      <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent)', marginTop: 18 }}>FAST MODE</div>
      <h1 style={{ margin: '8px 0 18px', fontFamily: grotesk, fontWeight: 800, fontSize: 'clamp(26px,3.4vw,38px)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        A video in seconds, from a link or a topic.
      </h1>

      <div style={css('border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:16px;background:rgba(255,255,255,0.03)')}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) make(); }}
          placeholder="https://yourproduct.com — or a topic, e.g. “How UPI payments work”"
          rows={2}
          style={css('width:100%;resize:vertical;background:transparent;border:0;outline:0;color:#F4F3F0;font-size:16px;font-family:inherit')}
        />
        <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px')}>
          <button type="button" style={css(chip(style === 'promo'))} onClick={() => pickStyle('promo')}>Promo</button>
          <button type="button" style={css(chip(style === 'explainer'))} onClick={() => pickStyle('explainer')}>Explainer</button>
          <span style={{ width: 8 }} />
          {['16:9', '9:16', '1:1'].map((f) => (
            <button key={f} type="button" style={css(chip(format === f))} onClick={() => setFormat(f)}>{f}</button>
          ))}
          <select value={look} onChange={(e) => setLook(e.target.value)}
            style={css('border-radius:10px;padding:8px 12px;font-size:13px;background:#16161a;color:#F4F3F0;border:1px solid rgba(255,255,255,0.14)')}>
            {LOOKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label style={css('display:flex;align-items:center;gap:8px;font-family:' + mono + ';font-size:12px;color:rgba(244,243,240,0.7)')}>
            <input type="range" min={min} max={max} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            {duration}s
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" disabled={busy || !input.trim()} onClick={make}
            style={css(`border:0;border-radius:12px;padding:12px 20px;font-size:14.5px;font-weight:600;background:var(--accent);color:#0B0B0E;cursor:pointer;opacity:${busy || !input.trim() ? 0.5 : 1}`)}>
            {busy ? `Making… ${elapsed}s` : 'Make video →'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#ff8a7a', fontSize: 14, marginTop: 14 }}>{error}</p>}

      {ir && (
        <>
          <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:28px 0 16px')}>
            <div>
              <h2 style={{ margin: 0, fontFamily: grotesk, fontWeight: 700, fontSize: 24 }}>{ir.metadata.title}</h2>
              <div style={{ fontFamily: mono, fontSize: 12, color: 'rgba(244,243,240,0.45)', marginTop: 6 }}>
                {Math.round(ir.metadata.total_duration_seconds)}s · {ir.scenes.length} scenes · {ir.metadata.style ? `${ir.metadata.style} style · ` : ''}{fmt}{took ? ` · ready in ${took}s` : ''}
              </div>
            </div>
            {mp4 ? (
              <Box t="a" href={downloadHref} download={fileName} s="display:inline-flex;align-items:center;gap:9px;border-radius:12px;padding:12px 20px;font-size:14.5px;font-weight:600;background:var(--accent);color:#0B0B0E;text-decoration:none" sh="filter:brightness(1.1)">Download MP4</Box>
            ) : (
              <span style={{ fontFamily: mono, fontSize: 12, color: 'rgba(244,243,240,0.55)' }}>
                {project?.status === 'failed' ? project.error : 'MP4 rendering in the background…'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: aspect === '9 / 16' ? 'min(100%, 420px)' : '100%', aspectRatio: aspect, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#000' }}>
              <Player
                component={MainVideo}
                inputProps={{ ir }}
                durationInFrames={ir.metadata.total_frames}
                fps={ir.metadata.fps}
                compositionWidth={ir.metadata.width}
                compositionHeight={ir.metadata.height}
                style={{ width: '100%', height: '100%' }}
                controls
                autoPlay
                acknowledgeRemotionLicense
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
