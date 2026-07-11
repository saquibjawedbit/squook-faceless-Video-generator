import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '../lib/Box.jsx';
import { css } from '../lib/css.js';
import { reviseScript } from '../lib/api.js';

const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";
const pad2 = (n) => String(n).padStart(2, '0');

// Auto-growing textarea — the narration is the hero line, so it should never
// clip or scroll internally.
function Grow({ value, onChange, placeholder, hero }) {
  const ref = useRef(null);
  const fit = (el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } };
  return (
    <textarea
      ref={(el) => { ref.current = el; fit(el); }}
      value={value}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); fit(e.target); }}
      rows={1}
      style={{
        width: '100%', boxSizing: 'border-box', resize: 'none', border: 'none', outline: 'none',
        background: 'transparent', color: hero ? '#F4F3F0' : 'rgba(244,243,240,0.82)',
        fontFamily: hero ? grotesk : 'inherit',
        fontSize: hero ? 19 : 14, lineHeight: hero ? 1.5 : 1.55, fontWeight: hero ? 500 : 400,
        padding: 0, overflow: 'hidden',
      }}
    />
  );
}

/**
 * Script review — the step between the prompt and the render. The user reads the
 * director's script scene by scene and edits the narration (what the voice says)
 * and the on-screen text before we commit to generating the video.
 */
export default function ScriptReview({ review, prompt, busy, onBack, onGenerate }) {
  const initial = useMemo(
    () => (review?.script?.scenes || []).map((s, i) => ({
      index: s.index ?? i + 1,
      narration: s.narration || '',
      on_screen_text: s.on_screen_text || '',
      visual: s.visual || '',
      duration_seconds: s.duration_seconds,
    })),
    [review],
  );
  const [scenes, setScenes] = useState(initial);

  // Undo/redo — the fields are controlled textareas, so native ctrl+z can't
  // work; we keep our own history. A burst of typing (< 700ms between keys)
  // collapses into one undo step, so ctrl+z jumps back a word/edit, not a char.
  const past = useRef([]);
  const future = useRef([]);
  const lastEditAt = useRef(0);

  const patch = (i, key, val) => setScenes((s) => {
    const now = Date.now();
    if (now - lastEditAt.current > 700) {
      past.current.push(s);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
    }
    lastEditAt.current = now;
    return s.map((sc, j) => (j === i ? { ...sc, [key]: val } : sc));
  });

  const undo = () => setScenes((s) => {
    if (!past.current.length) return s;
    future.current.push(s);
    lastEditAt.current = 0; // next keystroke starts a fresh undo step
    return past.current.pop();
  });
  const redo = () => setScenes((s) => {
    if (!future.current.length) return s;
    past.current.push(s);
    lastEditAt.current = 0;
    return future.current.pop();
  });

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // The revise prompt is an <input> — let it do native text undo there.
      if (e.target && e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // AI revise — send the current (edited) script + instruction to the agent.
  const [revising, setRevising] = useState(false);
  const [err, setErr] = useState('');
  const promptRef = useRef(null);

  const revise = () => {
    const instruction = (promptRef.current?.value || '').trim();
    if (!instruction || revising) return;
    setRevising(true); setErr('');
    const orig = review?.script || {};
    reviseScript({ script: { ...orig, scenes }, instruction })
      .then((revised) => {
        past.current.push(scenes); // AI revisions are undoable too
        future.current = [];
        lastEditAt.current = 0;
        setScenes((revised.scenes || []).map((s, i) => ({
          index: s.index ?? i + 1,
          narration: s.narration || '',
          on_screen_text: s.on_screen_text || '',
          visual: s.visual || '',
          duration_seconds: s.duration_seconds,
        })));
        if (promptRef.current) promptRef.current.value = '';
        setRevising(false);
      })
      .catch((e) => { setRevising(false); setErr(e.message || 'Revision failed — try rephrasing'); });
  };
  const total = scenes.reduce((n, s) => n + (s.duration_seconds || 0), 0);
  const words = scenes.reduce((n, s) => n + (s.narration.trim() ? s.narration.trim().split(/\s+/).length : 0), 0);

  const generate = () => {
    const orig = review?.script || {};
    // Preserve the whole script (incl. the top-level `music` decision) and only
    // override the scenes the user edited.
    onGenerate({
      ...orig,
      metadata: { ...(orig.metadata || {}), prompt: orig.metadata?.prompt || prompt, scene_count: scenes.length },
      scenes,
    });
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', paddingBottom: 120 }}>
      {/* header */}
      <div style={css('position:sticky;top:0;z-index:5;backdrop-filter:blur(10px);background:rgba(11,11,14,0.72);border-bottom:1px solid rgba(255,255,255,0.08)')}>
        <div style={css('max-width:840px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px')}>
          <div style={css('display:flex;align-items:center;gap:14px;min-width:0')}>
            <Box t="button" onClick={onBack} disabled={busy}
              s="cursor:pointer;background:none;border:1px solid rgba(255,255,255,0.14);border-radius:9px;color:rgba(244,243,240,0.7);font-size:13px;padding:7px 12px;transition:border-color .15s,color .15s"
              sh="border-color:rgba(255,255,255,0.3);color:#F4F3F0">← Back</Box>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--accent)' }}>REVIEW · STEP 2 OF 2</div>
              <div style={css('font-size:13px;color:rgba(244,243,240,0.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw')}>{prompt}</div>
            </div>
          </div>
          <Box t="button" onClick={generate} disabled={busy}
            s={'cursor:pointer;border:none;border-radius:11px;padding:11px 20px;font-size:14.5px;font-weight:600;background:var(--accent);color:#0B0B0E;display:inline-flex;align-items:center;gap:8px;transition:filter .15s,transform .15s;' + (busy ? 'opacity:0.6' : '')}
            sh="filter:brightness(1.08);transform:translateY(-1px)">
            {busy ? 'Starting…' : 'Generate video'} <span aria-hidden>→</span>
          </Box>
        </div>
      </div>

      <div style={css('max-width:840px;margin:0 auto;padding:34px 24px 0')}>
        <h1 style={{ margin: 0, fontFamily: grotesk, fontWeight: 700, fontSize: 34, letterSpacing: '-0.02em', color: '#F4F3F0' }}>Your script</h1>
        <p style={{ margin: '10px 0 4px', fontSize: 15, lineHeight: 1.6, color: 'rgba(244,243,240,0.6)', maxWidth: 560 }}>
          This is what the narrator will say, scene by scene. Edit any line before we shoot it — the voice-over and captions follow your words exactly.
        </p>
        <div style={{ fontFamily: mono, fontSize: 11.5, color: 'rgba(244,243,240,0.4)', margin: '14px 0 26px' }}>
          {scenes.length} scenes · ~{Math.round(total)}s · {words} words
        </div>

        {/* scene list — the number rail is the signature; this is a real sequence */}
        <div style={css('display:flex;flex-direction:column;gap:14px')}>
          {scenes.map((s, i) => (
            <div key={i} style={css('display:flex;gap:18px;border:1px solid rgba(255,255,255,0.09);border-radius:16px;background:rgba(255,255,255,0.02);padding:20px 22px')}>
              <div style={{ flex: 'none', width: 40, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{pad2(s.index)}</span>
                <span style={{ width: 1, flex: 1, marginTop: 12, background: 'linear-gradient(rgba(255,255,255,0.14),transparent)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* narration — the hero */}
                <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.14em', color: 'rgba(244,243,240,0.4)', marginBottom: 8 }}>NARRATION</div>
                <Grow hero value={s.narration} onChange={(v) => patch(i, 'narration', v)} placeholder="What the narrator says in this scene…" />
                {/* on-screen text + visual */}
                <div style={css('display:flex;flex-wrap:wrap;gap:18px 28px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06)')}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.14em', color: 'rgba(244,243,240,0.4)', marginBottom: 6 }}>ON-SCREEN TEXT</div>
                    <Grow value={s.on_screen_text} onChange={(v) => patch(i, 'on_screen_text', v)} placeholder="No on-screen text" />
                  </div>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.14em', color: 'rgba(244,243,240,0.4)', marginBottom: 6 }}>ON SCREEN</div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(244,243,240,0.5)', fontStyle: s.visual ? 'normal' : 'italic' }}>
                      {s.visual || 'Chosen automatically'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ margin: '26px 0 0', fontSize: 12.5, lineHeight: 1.6, color: 'rgba(244,243,240,0.38)' }}>
          The visuals (footage, graphics, music) are chosen when you generate. You can restyle everything in the editor afterward.
        </p>
      </div>

      {/* AI-revise bar — the instruction goes to the director, who rewrites the script */}
      <div style={css('position:fixed;left:0;right:0;bottom:0;z-index:6;backdrop-filter:blur(10px);background:rgba(11,11,14,0.82);border-top:1px solid rgba(255,255,255,0.08)')}>
        <div style={css('max-width:840px;margin:0 auto;padding:13px 24px')}>
          {err && <div style={{ fontSize: 12, color: '#ff9b7a', marginBottom: 8 }}>{err}</div>}
          <div style={css('display:flex;gap:8px;align-items:center;border:1px solid rgba(255,255,255,0.14);border-radius:12px;background:rgba(255,255,255,0.03);padding:5px 5px 5px 14px')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M12 3l1.9 5.6L20 10l-6.1 1.4L12 17l-1.9-5.6L4 10l6.1-1.4z" /></svg>
            <input
              ref={promptRef} type="text" disabled={revising}
              placeholder="Ask the director to revise — e.g. “make it punchier” or “add a scene on pricing”"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); revise(); } }}
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: '#F4F3F0', fontSize: 14 }}
            />
            <Box t="button" onClick={revise} disabled={revising}
              s={'cursor:pointer;border:none;border-radius:9px;padding:9px 16px;font-size:13.5px;font-weight:600;background:var(--accent);color:#0B0B0E;transition:filter .15s' + (revising ? ';opacity:0.6;pointer-events:none' : '')}
              sh="filter:brightness(1.1)">{revising ? 'Revising…' : 'Revise'}</Box>
          </div>
        </div>
      </div>
    </div>
  );
}
