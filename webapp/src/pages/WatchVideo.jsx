import { useEffect, useState } from 'react';
import Box from '../lib/Box.jsx';
import { css } from '../lib/css.js';
import { navigate, currentQuery } from '../lib/router.js';
import { getProject, getPlaybackUrl } from '../lib/api.js';
import LoadingScreen from './LoadingScreen.jsx';

/**
 * Watch view for landing-page videos (`#/watch?id=…`). These are built by
 * HyperFrames rather than the IR pipeline, so there's no timeline to edit —
 * just the finished film, its source page, and a download. While the job is
 * still running it shows the landing-page progress stepper instead.
 */

const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";
const ASPECT = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1' };
const fmtDur = (s) => (s ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : null);

export default function WatchVideo() {
  const id = currentQuery().get('id');
  const [project, setProject] = useState(null);
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(id ? null : 'No video selected');

  // Poll until the project finishes (or fails), then fetch a playable URL.
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const p = await getProject(id);
        if (!alive) return;
        setProject(p);
        if (p.status === 'done') setUrl(await getPlaybackUrl(id));
        else if (p.status !== 'failed') timer = setTimeout(tick, 2000);
      } catch (e) {
        if (alive) setError(e.status === 404 ? 'That video doesn’t exist (or isn’t yours).' : String(e.message || e));
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  const back = <Box t="a" href="#/app" onClick={(e) => { e.preventDefault(); navigate('app'); }} s="font-family:'JetBrains Mono',monospace;font-size:11.5px;letter-spacing:0.12em;color:rgba(244,243,240,0.55);text-decoration:none" sh="color:#F4F3F0">← BACK TO HOME</Box>;

  if (error) {
    return (
      <div style={css('max-width:720px;margin:0 auto;padding:80px 32px')}>
        {back}
        <h1 style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 28, margin: '18px 0 8px' }}>Can’t show this video</h1>
        <p style={{ color: 'rgba(244,243,240,0.6)', fontSize: 15 }}>{error}</p>
      </div>
    );
  }
  if (!project) return null;

  if (project.status !== 'done' && project.status !== 'failed') {
    return <LoadingScreen stage={project.stage} progress={project.progress} prompt={project.prompt} variant="landing" />;
  }

  if (project.status === 'failed') {
    return (
      <div style={css('max-width:720px;margin:0 auto;padding:80px 32px')}>
        {back}
        <h1 style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 28, margin: '18px 0 8px' }}>This video didn’t finish</h1>
        <p style={{ color: 'rgba(244,243,240,0.6)', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{project.error || 'Something went wrong.'}</p>
        <p style={{ fontFamily: mono, fontSize: 12, color: 'rgba(244,243,240,0.4)', marginTop: 18 }}>{project.prompt}</p>
      </div>
    );
  }

  const vertical = project.format === '9:16';
  // ?download= makes the API send Content-Disposition: attachment — the anchor's
  // download attribute alone is ignored cross-origin (same trick as the editor).
  const fileName = (project.title || 'squook-video').replace(/[^\w-]+/g, '_') + '.mp4';
  const downloadHref = url && url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(fileName);
  const meta = [fmtDur(project.durationS), project.format].filter(Boolean).join(' · ');

  return (
    <div style={css('max-width:1100px;margin:0 auto;padding:40px 32px 80px')}>
      {back}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:18px 0 22px')}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent)' }}>FROM YOUR LANDING PAGE</div>
          <h1 style={{ margin: '8px 0 6px', fontFamily: grotesk, fontWeight: 800, fontSize: 'clamp(26px,3.4vw,38px)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{project.title}</h1>
          <div style={{ fontFamily: mono, fontSize: 12, color: 'rgba(244,243,240,0.45)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href={project.prompt} target="_blank" rel="noreferrer noopener" style={{ color: 'inherit' }}>{project.prompt}</a>
            {meta && <span>{meta}</span>}
          </div>
        </div>
        {url && (
          <Box t="a" href={downloadHref} download={fileName} s="display:inline-flex;align-items:center;gap:9px;border-radius:12px;padding:12px 20px;font-size:14.5px;font-weight:600;background:var(--accent);color:#0B0B0E;text-decoration:none" sh="filter:brightness(1.1)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg>
            Download MP4
          </Box>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: vertical ? 'min(100%, 420px)' : '100%', aspectRatio: ASPECT[project.format] || '16 / 9', borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#000', boxShadow: '0 30px 80px rgba(0,0,0,0.45)' }}>
          {url && <video src={url} controls autoPlay playsInline style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }} />}
        </div>
      </div>
    </div>
  );
}
