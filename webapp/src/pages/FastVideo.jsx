import { useEffect, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { prefetch } from 'remotion';
import { MainVideo } from '@renderer/MainVideo';
import { navigate, currentQuery } from '../lib/router.js';
import FastEditor from './FastEditor.jsx';
import './fast.css';
import {
  apiBase, createFastVideo, getIR, getProject, getPlaybackUrl, rerenderFastVideo,
  getFastEditable, editFastVideo, followUpFastVideo,
} from '../lib/api.js';

/**
 * Fast mode (`#/fast`, `#/fast?id=…`): paste a link or type a topic, and the
 * video plays here in seconds — the browser renders the scene templates live
 * from the IR. Laid out as a studio: a chat on the left for asking for
 * changes (plus a manual Edit tab), the video on a canvas on the right.
 * The MP4 is rendered on the server in the background.
 */

const ASPECT = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };
const LENGTHS = { promo: [15, 60, 30], explainer: [30, 180, 90] };
const LOOKS = [['', 'Auto style'], ['clean', 'Clean'], ['bold', 'Bold'], ['tech', 'Tech'], ['playful', 'Playful'], ['corporate', 'Corporate'], ['editorial', 'Editorial']];
const EXAMPLES = ['https://linear.app', 'How UPI payments work', 'Why sleep matters for students', 'https://notion.so'];
const SUGGEST = ['Make it shorter', 'Calmer music', 'Punchier opening', 'End with “Book a demo”'];
// The server doesn't report stages, so the wait shows what it is usually doing by then.
const STAGES = [[0, 'Reading the page'], [9, 'Writing the script'], [20, 'Recording the voice and making pictures'], [34, 'Checking every scene'], [55, 'Almost there']];
const stageAt = (s) => STAGES.filter(([t]) => s >= t).pop()[1];

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Logo = () => <span className="fx-logo">S</span>;
const Dots = () => <span className="fx-dots"><i /><i /><i /></span>;

const loadChat = (id) => { try { return JSON.parse(localStorage.getItem(`fx-chat-${id}`)) || null; } catch { return null; } };
const saveChat = (id, msgs) => { try { localStorage.setItem(`fx-chat-${id}`, JSON.stringify(msgs.slice(-60))); } catch { /* private mode */ } };

export default function FastVideo() {
  const [id, setId] = useState(currentQuery().get('id'));
  const [input, setInput] = useState('');
  const [style, setStyle] = useState('promo');
  const [format, setFormat] = useState('16:9');
  const [duration, setDuration] = useState(30);
  const [look, setLook] = useState('');
  const [making, setMaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [ir, setIr] = useState(null);
  const [project, setProject] = useState(null);
  const [mp4, setMp4] = useState(null);
  const [editable, setEditable] = useState(null);
  const [chat, setChat] = useState(() => (id && loadChat(id)) || []);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');   // what an edit is doing right now
  const [tab, setTab] = useState('chat');
  const [selected, setSelected] = useState(null); // scene index
  const [playing, setPlaying] = useState(0);      // scene index under the playhead
  const started = useRef(0);
  const playerRef = useRef(null);
  const scrollRef = useRef(null);

  // Media in the IR is served from the project's snapshot. Set during render,
  // not in an effect: the Player resolves asset URLs on its first render.
  if (id) globalThis.__SQUOOK_ASSET_RESOLVE__ = (p) => `${apiBase}/api/projects/${id}/assets/${p}`;
  useEffect(() => () => { delete globalThis.__SQUOOK_ASSET_RESOLVE__; }, []);

  // Opened from a link: load the saved IR.
  useEffect(() => {
    if (id && !ir && !making) getIR(id).then(setIr).catch((e) => setError(String(e.message || e)));
  }, [id, ir, making]);

  // The editable recipe (videos made before editing existed have none).
  useEffect(() => {
    if (!id || making) return undefined;
    let alive = true;
    getFastEditable(id).then((d) => alive && setEditable(d)).catch(() => alive && setEditable(false));
    return () => { alive = false; };
  }, [id, making]);

  // Greet with a summary the first time a video is opened here.
  useEffect(() => {
    if (!id || !ir) return;
    setChat((c) => {
      if (c.some((m) => m.role === 'ai')) return c;
      const m = ir.metadata;
      const took = started.current ? ` in ${Math.round((Date.now() - started.current) / 1000)}s` : '';
      return [...c, { role: 'ai', text: `Here's your first cut${took}: **${m.title}**, ${Math.round(m.total_duration_seconds)} seconds, ${ir.scenes.length} scenes${m.style ? `, ${m.style} style` : ''}.\n\nTell me what to change, like the wording, music, voice or a scene. Or click a scene under the video to edit it yourself.` }];
    });
  }, [id, ir]);

  useEffect(() => { if (id) saveChat(id, chat); }, [id, chat]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [chat, busy, making, tab]);

  // Load every picture/sound up front so scenes never flash blank while an
  // image is still downloading (the Player uses the prefetched copies).
  useEffect(() => {
    if (!id || !ir) return undefined;
    const paths = new Set();
    const walk = (v) => {
      if (typeof v === 'string') { if (/^assets\/.+\.(jpe?g|png|svg|webp|mp3)$/i.test(v)) paths.add(v); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(ir);
    const handles = [...paths].map((p) => prefetch(`${apiBase}/api/projects/${id}/assets/${p}`, { method: 'blob-url' }));
    return () => handles.forEach((h) => h.free());
  }, [id, ir]);

  // Highlight the scene under the playhead.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !ir) return undefined;
    const onFrame = (e) => {
      const f = e.detail.frame;
      let i = 0;
      ir.scenes.forEach((s, k) => { if (f >= s.start_frame) i = k; });
      setPlaying(i);
    };
    p.addEventListener('frameupdate', onFrame);
    return () => p.removeEventListener('frameupdate', onFrame);
  }, [ir]);

  const [poll, setPoll] = useState(0);
  const autoRetried = useRef(false);
  const renderAgain = async (quality) => {
    try { setMp4(null); setProject(await rerenderFastVideo(id, quality)); setPoll((n) => n + 1); }
    catch (e) { setError(String(e.message || e)); }
  };

  // Poll for the background MP4.
  useEffect(() => {
    if (!id || making) return undefined;
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const p = await getProject(id);
        if (!alive) return;
        setProject(p);
        if (p.status === 'done') {
          setMp4(await getPlaybackUrl(id));
          getIR(id).then(setIr).catch(() => {}); // picks up which edit the MP4 now matches
        } else if (p.status === 'failed' && /server restart/i.test(p.error || '') && !autoRetried.current) {
          // A deploy/restart cut the MP4 off: render it again without asking.
          autoRetried.current = true;
          renderAgain();
        } else if (p.status !== 'failed') timer = setTimeout(tick, 3000);
      } catch { timer = setTimeout(tick, 5000); }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, poll, making]);

  useEffect(() => {
    if (!making && !busy) return undefined;
    const t0 = Date.now();
    const base = making ? started.current : t0;
    setElapsed(Math.round((t0 - base) / 1000));
    const t = setInterval(() => setElapsed(Math.round((Date.now() - base) / 1000)), 250);
    return () => clearInterval(t);
  }, [making, busy]);

  const pickStyle = (s) => { setStyle(s); setDuration(LENGTHS[s][2]); };

  const make = async (text = input.trim()) => {
    if (!text || making) return;
    const isUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text);
    setMaking(true); setError(null); setId(null); setIr(null); setMp4(null); setProject(null); setEditable(null);
    setSelected(null); setTab('chat'); setChat([{ role: 'user', text }]);
    started.current = Date.now();
    try {
      const r = await createFastVideo({ ...(isUrl ? { url: text } : { topic: text }), style, look, format, duration });
      setId(r.project.id);
      setIr(r.ir);
      window.history.replaceState(null, '', `#/fast?id=${r.project.id}`);
    } catch (e) {
      setChat((c) => [...c, { role: 'err', text: `Sorry, that didn't work: ${String(e.message || e)}` }]);
    } finally {
      setMaking(false);
    }
  };

  const newVideo = () => {
    setId(null); setIr(null); setMp4(null); setProject(null); setEditable(null); setChat([]); setError(null);
    setSelected(null); setInput(''); started.current = 0;
    window.history.replaceState(null, '', '#/fast');
  };

  // Edits — from the chat or the Edit tab — all come back as a new IR + recipe.
  const applied = (out) => { setEditable(out.editable); setIr(out.ir); };
  const send = async (ops, what = 'Updating the video') => {
    setBusy(what);
    try {
      const out = await editFastVideo(id, ops);
      applied(out);
      setChat((c) => [...c, { role: 'note', text: out.done?.length ? `Edited: ${out.done.join(', ')}` : 'Nothing changed' }]);
      return true;
    } catch (e) {
      setChat((c) => [...c, { role: 'err', text: String(e.message || e) }]);
      return false;
    } finally { setBusy(''); }
  };
  const ask = async (text = msg.trim()) => {
    if (!text || busy) return;
    if (!editable) {
      setChat((c) => [...c, { role: 'user', text }, { role: 'err', text: "This video was made before editing existed, so I can't change it. Make it again and you'll be able to edit it." }]);
      return;
    }
    setMsg('');
    setChat((c) => [...c, { role: 'user', text }]);
    setBusy('Working on it');
    try {
      const out = await followUpFastVideo(id, text);
      applied(out);
      setChat((c) => [...c, { role: 'ai', text: out.reply || (out.done?.length ? `Done: ${out.done.join(', ')}.` : 'I couldn’t find anything to change for that. Try saying which scene, or what it should say.') }]);
    } catch (e) {
      setChat((c) => [...c, { role: 'err', text: String(e.message || e) }]);
    } finally { setBusy(''); }
  };

  const selectScene = (i) => {
    setSelected(i);
    const s = ir?.scenes?.[i];
    if (s) { playerRef.current?.seekTo(s.start_frame); }
  };
  const openScene = (i) => { selectScene(i); setTab('edit'); };

  // ——— Start screen ———
  if (!id && !making) {
    const [min, max] = LENGTHS[style];
    return (
      <div className="fx fx-start">
        <div className="fx-start-top">
          <a className="fx-brand" href="#/app" onClick={(e) => { e.preventDefault(); navigate('app'); }}><Logo /> Squook</a>
        </div>
        <div className="fx-start-main">
          <h1 className="serif">What should we make?</h1>
          <p className="sub">Paste a link to your product, or describe a topic. You'll see the video in under a minute.</p>
          <div className="fx-composer">
            <textarea
              autoFocus rows={3} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); make(); } }}
              placeholder="https://yourproduct.com, or “How UPI payments work”"
            />
            <div className="fx-composer-row">
              <div className="fx-seg">
                <button type="button" className={style === 'promo' ? 'on' : ''} onClick={() => pickStyle('promo')}>Promo</button>
                <button type="button" className={style === 'explainer' ? 'on' : ''} onClick={() => pickStyle('explainer')}>Explainer</button>
              </div>
              <div className="fx-seg">
                {[['16:9', 'Wide'], ['9:16', 'Tall'], ['1:1', 'Square']].map(([f, l]) => (
                  <button key={f} type="button" title={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{l}</button>
                ))}
              </div>
              <select className="fx-mini-select" value={look} onChange={(e) => setLook(e.target.value)}>
                {LOOKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label className="fx-length">
                <input type="range" min={min} max={max} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                {duration}s
              </label>
              <span style={{ flex: 1 }} />
              <button type="button" className="fx-send" disabled={!input.trim()} onClick={() => make()} aria-label="Make video"><Arrow /></button>
            </div>
          </div>
          <div className="fx-examples">
            {EXAMPLES.map((x) => <button key={x} type="button" className="fx-chip" onClick={() => setInput(x)}>{x.replace(/^https:\/\//, '')}</button>)}
          </div>
          {error ? <p style={{ color: 'var(--danger)', marginTop: 16 }}>{error}</p> : null}
        </div>
      </div>
    );
  }

  // ——— Studio ———
  const ar = ir ? ir.metadata.width / ir.metadata.height : ASPECT[format];
  const fileName = (ir?.metadata?.title || 'squook-video').replace(/[^\w-]+/g, '_') + '.mp4';
  const downloadHref = mp4 && mp4 + (mp4.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(fileName);
  // An edited video whose MP4 doesn't record the same edit is out of date (a
  // restart can lose the record, which errs toward offering an update).
  const stale = mp4 && ir && (ir.metadata.revision || 0) > 0 && ir.metadata.rendered_revision !== ir.metadata.revision;
  const pct = project?.progress > 60 ? Math.round(((project.progress - 60) / 39) * 100) : 0;
  const lines = editable?.scenes?.map((s) => s.spec.narration) || [];
  const active = selected ?? playing;

  let exportArea;
  if (!ir) exportArea = null;
  else if (stale) exportArea = <><span className="fx-pill hide-sm">Edits not in the MP4 yet</span><button type="button" className="fx-btn accent" onClick={() => renderAgain()}>Update MP4</button></>;
  else if (mp4) exportArea = (
    <>
      <span className="fx-pill ok hide-sm"><span className="dot" />MP4 ready{project?.quality === 'hd' ? ' · full HD' : ' · 720p'}</span>
      {project?.quality !== 'hd' ? <button type="button" className="fx-btn ghost hide-sm" onClick={() => renderAgain('hd')} title="Full resolution with every effect. Takes a few minutes longer.">Export full HD</button> : null}
      <a className="fx-btn primary" href={downloadHref} download={fileName}>Download</a>
    </>
  );
  else if (project?.status === 'failed') exportArea = <><span className="fx-pill hide-sm">MP4 failed</span><button type="button" className="fx-btn" onClick={() => renderAgain()}>Try MP4 again</button></>;
  else exportArea = <span className="fx-pill"><span className="dot" />Preparing MP4{pct ? ` · ${pct}%` : '…'}</span>;

  return (
    <div className="fx fx-studio">
      <header className="fx-top">
        <a className="fx-brand" href="#/app" onClick={(e) => { e.preventDefault(); navigate('app'); }}><Logo /><span className="hide-sm">Squook</span></a>
        <span className="fx-crumb">/</span>
        <span className="fx-title">{ir?.metadata?.title || 'New video'}</span>
        {ir ? <span className="fx-pill hide-sm">{Math.round(ir.metadata.total_duration_seconds)}s · {ir.scenes.length} scenes</span> : null}
        <span style={{ flex: 1 }} />
        {exportArea}
        <button type="button" className="fx-btn ghost" onClick={newVideo} disabled={making}>New video</button>
      </header>

      <aside className="fx-side">
        <div className="fx-tabs">
          <button type="button" className={`fx-tab ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>Chat</button>
          <button type="button" className={`fx-tab ${tab === 'edit' ? 'on' : ''}`} onClick={() => setTab('edit')} disabled={!ir}>Edit scenes</button>
        </div>

        {tab === 'chat' ? (
          <>
            <div className="fx-scroll" ref={scrollRef}>
              {chat.map((m, i) => <Message key={i} m={m} />)}
              {making ? <div className="fx-msg ai"><Logo /><div className="fx-thinking"><Dots />{stageAt(elapsed)}… {elapsed}s</div></div> : null}
              {busy ? <div className="fx-msg ai"><Logo /><div className="fx-thinking"><Dots />{busy}… {elapsed}s</div></div> : null}
            </div>
            <div className="fx-chatbox">
              {ir && !busy && editable ? (
                <div className="fx-suggest">
                  {SUGGEST.map((s) => <button key={s} type="button" className="fx-chip" onClick={() => ask(s)}>{s}</button>)}
                </div>
              ) : null}
              <div className="fx-input">
                <textarea
                  rows={1} value={msg} disabled={!ir}
                  onChange={(e) => { setMsg(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                  placeholder={ir ? 'Ask for a change…' : 'Your video is on its way…'}
                />
                <button type="button" className="fx-send" disabled={!msg.trim() || Boolean(busy) || !ir} onClick={() => ask()} aria-label="Send"><Arrow /></button>
              </div>
            </div>
          </>
        ) : (
          <FastEditor
            data={editable} busy={busy} selected={selected} onSelect={selectScene} send={send}
          />
        )}
      </aside>

      <main className="fx-canvas">
        <div className="fx-stage">
          <div className="fx-frame" style={{ '--ar': ar }}>
            {ir ? (
              <Player
                ref={playerRef}
                key={`${id}-${ir.metadata.revision || 0}`}
                component={MainVideo}
                inputProps={{ ir }}
                durationInFrames={ir.metadata.total_frames}
                fps={ir.metadata.fps}
                compositionWidth={ir.metadata.width}
                compositionHeight={ir.metadata.height}
                style={{ width: '100%', height: '100%' }}
                controls
                autoPlay
                // Music + voice + overlapping whooshes/pops at a transition can
                // exceed the default of 5 simultaneous audio tags.
                numberOfSharedAudioTags={24}
                acknowledgeRemotionLicense
              />
            ) : (
              <div className="fx-skeleton">{making ? `${stageAt(elapsed)}…` : error || 'Loading…'}</div>
            )}
          </div>
        </div>
        {ir ? (
          <div className="fx-strip">
            {ir.scenes.map((s, i) => (
              <button key={i} type="button" className={`fx-thumb ${active === i ? 'on' : ''}`} onClick={() => openScene(i)}>
                <div className="t1"><span>Scene {i + 1}</span><span>{Math.round(s.duration_frames / ir.metadata.fps)}s</span></div>
                <div className="t2">{lines[i] || s.template || ''}</div>
              </button>
            ))}
          </div>
        ) : null}
        {ir?.metadata?.credits ? <div className="fx-credit">{ir.metadata.credits}. Keep this credit in your video's description.</div> : null}
      </main>
    </div>
  );
}

// Bold (**x**) and line breaks only — replies are short.
function Message({ m }) {
  if (m.role === 'user') return <div className="fx-msg user"><div>{m.text}</div></div>;
  if (m.role === 'note') return <div className="fx-msg note">{m.text}</div>;
  const parts = m.text.split(/\n\n/).map((p, i) => (
    <p key={i} style={{ margin: i ? '8px 0 0' : 0 }}>
      {p.split(/(\*\*[^*]+\*\*)/).map((t, k) => (t.startsWith('**') ? <strong key={k}>{t.slice(2, -2)}</strong> : t))}
    </p>
  ));
  return <div className={`fx-msg ai ${m.role === 'err' ? 'err' : ''}`}><Logo /><div>{parts}</div></div>;
}
