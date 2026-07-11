import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '../lib/Box.jsx';
import { css } from '../lib/css.js';
import { navigate } from '../lib/router.js';
import { createProject, previewScript, listProjects, getProject, thumbSrc, listPresets, createPreset, deletePreset } from '../lib/api.js';
import ScriptReview from './ScriptReview.jsx';
import LoadingScreen from './LoadingScreen.jsx';

/**
 * Squook Home — a faithful React port of `Squook Home.dc.html`: the logged-in
 * dashboard. A hero + prompt composer (attach assets, format, length), quick
 * templates, drafts, your videos, and trending. Generating a video — or opening
 * any draft / video / remix — routes into the editor (`#/editor`).
 *
 * This page renders inside the normal app shell, so the site `Atmosphere`
 * (vignette + grain) is provided by App.jsx — the component does not draw its
 * own overlays. State mirrors the DCLogic class: one object updated through a
 * merge-style `setState` (a fn updater returning `null` is a no-op).
 */

const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";

const INITIAL = {
  prompt: '', assets: [], format: '16:9', lengthSec: 30,
  generating: false, genStage: '', genProgress: 0, note: '',
  previewing: false, review: null, // review = { script, asset_plan } once the script is written
  projects: null, // null = loading; [] = loaded-empty
  genre: 'auto',  // selected content preset id (built-in or custom-xxxx)
  presets: null,  // { builtins:[], custom:[] } | null while loading
  presetForm: null, // the "new preset" draft, or null when closed
};

// Fallbacks so a custom preset (no server icon) still renders a chip glyph, and
// the "new preset" form can offer the same vocabularies the flow understands
// (mirrors ir_builder.MOODS / FONT_STYLES and main.py voice/music ids).
const MEDIA_OPTS = [
  { v: 'mixed', l: 'Mixed (let AI choose)' },
  { v: 'images', l: 'Only photos' },
  { v: 'animation', l: 'Only animation' },
  { v: 'graphics', l: 'Prefer graphics' },
];
const MOOD_OPTS = ['', 'premium', 'playful', 'calm', 'bold', 'warm', 'nature'];
const FONT_OPTS = ['', 'geometric_sans', 'grotesque_sans', 'editorial_serif', 'classic_serif',
  'techno_sans', 'display_heavy', 'editorial_display'];
const VOICE_OPTS = ['', 'none', 'nova', 'atlas', 'juno', 'ryan', 'sonia', 'guy'];
const MUSIC_OPTS = ['', 'none', 'beat', 'warm', 'score'];
const EMPTY_PRESET_FORM = { label: '', media: 'mixed', mood: '', font: '', voice: '', music: '', noFaces: false, saving: false };

// Turn the compact form into a preset bundle the server/flow understands.
function formToBundle(f) {
  const mp = { force: null, prefer: null, block: null, ken_burns_all: false };
  if (f.media === 'images') { mp.force = ['photo']; mp.ken_burns_all = true; }
  else if (f.media === 'animation') mp.force = ['lottie', 'graphic'];
  else if (f.media === 'graphics') mp.prefer = ['graphic'];
  if (f.noFaces) mp.block = ['portrait', 'logo'];
  return {
    label: f.label.trim() || 'My preset',
    media_policy: mp,
    theme: { mood_pool: f.mood ? [f.mood] : null, font_pool: f.font ? [f.font] : null },
    voice_default: f.voice || '',
    music_default: f.music || '',
  };
}

// Placeholder tile gradients (drafts/failed have no rendered thumbnail).
const PALETTE = [
  'linear-gradient(135deg,#0f2540,#2563eb)', 'linear-gradient(135deg,#2a1c12,#a16207)',
  'linear-gradient(135deg,#0c2f2a,#0d9488)', 'linear-gradient(135deg,#241a3a,#7c3aed)',
  'linear-gradient(135deg,#3a2416,#c2410c)', 'linear-gradient(135deg,#111117,#3730a3)',
];
const gradFor = (id) => { let h = 0; for (const ch of String(id)) h = (h + ch.charCodeAt(0)) % PALETTE.length; return PALETTE[h]; };
const statusLabel = (p) => p.status === 'failed' ? 'Failed'
  : p.status === 'done' ? 'Ready to export'
  : p.stage ? (p.stage.charAt(0).toUpperCase() + p.stage.slice(1) + '…')
  : 'Queued';

// Footage + Image open a real file picker and upload to the pipeline (the
// asset-curator prefers uploaded files per scene). Brand kit + Reference have
// no backend feature yet, so they're honestly marked "coming soon".
const ATTACH_BTNS = [
  { key: 'footage', label: 'Footage', kind: 'VIDEO', accept: 'video/*', d: 'M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
  { key: 'image', label: 'Image', kind: 'IMAGE', accept: 'image/*', d: 'M4 4h16v16H4zM4 15l4-4 3 3 4-4 5 5' },
  { key: 'brand', label: 'Brand kit', soon: true, d: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5' },
  { key: 'ref', label: 'Reference', soon: true, d: 'M12 3l2.6 6H21l-5.2 4 2 7-5.8-4-5.8 4 2-7L3 9h6.4z' },
];

const fmtSize = (n) => (n == null ? '' : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

const TEMPLATES = [
  { label: 'Product launch film', p: 'Launch film for a project-management app — bold type, fast cuts, beat-synced' },
  { label: 'Instagram ad', p: 'Instagram ad for a single-origin coffee brand, warm and tactile' },
  { label: 'Explainer', p: '30-second explainer of how our API pricing works, clean motion graphics' },
  { label: 'Feature teaser', p: 'Vertical teaser for a fitness app — night city run, beat-synced' },
  { label: 'Founder announcement', p: 'Funding announcement — quiet confidence, serif overlays' },
  { label: 'Demo from recordings', p: 'Product demo of our analytics dashboard from screen recordings' },
];

const bg = (grad) => 'position:absolute;inset:0;background:' + grad;

const fmtDur = (s) => { if (!s) return null; const m = Math.floor(s / 60); return m + ':' + String(Math.round(s % 60)).padStart(2, '0'); };
const metaOf = (p) => [fmtDur(p.durationS), p.format].filter(Boolean).join(' · ');

const TRENDING = [
  { prompt: 'Launch film for a project-management app — bold type, fast cuts', creator: '@maya.builds', meta: '0:22 · 16:9', grad: 'linear-gradient(135deg,#3a2416,#c2410c)' },
  { prompt: 'Instagram ad for a single-origin coffee brand, warm and tactile', creator: '@sofiareyes.mkt', meta: '0:15 · 9:16', grad: 'linear-gradient(135deg,#2a1c12,#a16207)' },
  { prompt: '30-second explainer of how our API pricing works', creator: '@DevShipsDaily', meta: '0:30 · 16:9', grad: 'linear-gradient(135deg,#0c2f2a,#0d9488)' },
  { prompt: 'Night city run teaser for a fitness app, beat-synced', creator: '@liam.launches', meta: '0:18 · 9:16', grad: 'linear-gradient(135deg,#101830,#1e3a8a)' },
  { prompt: 'Abstract product loop with kinetic typography', creator: '@amara.creates', meta: '0:12 · 16:9', grad: 'linear-gradient(135deg,#2a1a2f,#db2777)' },
  { prompt: 'Founder update — warm, direct, serif overlays', creator: '@JonasExplains', meta: '0:20 · 16:9', grad: 'linear-gradient(135deg,#241a3a,#7c3aed)' },
];

let _uid = 0;
const uid = (p) => p + (++_uid);

export default function SquookHome({ userName = 'Alex' }) {
  const [state, setStateRaw] = useState(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  const taRef = useRef(null);
  const composerRef = useRef(null);
  const toastT = useRef(null);
  const pollRef = useRef(null);
  const fileRef = useRef(null);       // hidden <input type=file> for Footage/Image
  const pickKindRef = useRef(null);   // which button opened the picker (VIDEO|IMAGE)

  const setState = useCallback((patch) => {
    setStateRaw((s) => {
      const p = typeof patch === 'function' ? patch(s) : patch;
      return p == null ? s : { ...s, ...p };
    });
  }, []);

  // Declared before savePreset/onAttach/etc. which reference it — a useCallback
  // is a lexical const, so using it above this line is a temporal-dead-zone error.
  const toast = useCallback((msg) => {
    clearTimeout(toastT.current);
    setState({ note: msg });
    toastT.current = setTimeout(() => setState({ note: '' }), 2600);
  }, [setState]);

  useEffect(() => () => { clearTimeout(toastT.current); clearInterval(pollRef.current); }, []);

  // Load the caller's real projects (drafts + finished videos).
  useEffect(() => {
    let ok = true;
    listProjects().then((ps) => { if (ok) setState({ projects: ps }); }).catch(() => { if (ok) setState({ projects: [] }); });
    return () => { ok = false; };
  }, [setState]);

  // Load built-in + the caller's custom content presets for the picker.
  const reloadPresets = useCallback(() => listPresets()
    .then((p) => setState({ presets: p }))
    .catch(() => setState({ presets: { builtins: [], custom: [] } })), [setState]);
  useEffect(() => { reloadPresets(); }, [reloadPresets]);

  const savePreset = useCallback(() => {
    const f = stateRef.current.presetForm;
    if (!f || f.saving) return;
    if (!f.label.trim()) { toast('Name your preset first'); return; }
    setState((s) => ({ presetForm: { ...s.presetForm, saving: true } }));
    createPreset({ label: f.label.trim(), bundle: formToBundle(f) })
      .then(async (created) => {
        await reloadPresets();
        setState({ presetForm: null, genre: created.id });
        toast('Preset saved — “' + created.label + '”');
      })
      .catch((err) => { setState((s) => ({ presetForm: { ...s.presetForm, saving: false } })); toast('Could not save preset — ' + (err.message || err)); });
  }, [setState, toast, reloadPresets]);

  const removePreset = useCallback((id) => {
    deletePreset(id).catch(() => {});
    setState((s) => ({ genre: s.genre === id ? 'auto' : s.genre }));
    reloadPresets();
  }, [setState, reloadPresets]);

  // Footage/Image → open the real file picker; Brand kit/Reference → not built yet.
  const onAttach = (b) => {
    if (b.soon) { toast(b.label + ' — coming soon'); return; }
    const input = fileRef.current; if (!input) return;
    pickKindRef.current = b.kind;
    input.accept = b.accept || '';
    input.value = '';                 // let the same file be re-picked
    input.click();
  };
  const onFilesPicked = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const kind = pickKindRef.current || 'FILE';
    setState((s) => ({
      assets: s.assets.concat(files.map((f) => ({ id: uid('as'), kind, name: f.name, size: f.size, file: f }))),
    }));
    toast(files.length > 1 ? `Attached ${files.length} files` : 'Attached ' + files[0].name);
  };
  const removeAsset = (id) => setState((s) => ({ assets: s.assets.filter((a) => a.id !== id) }));

  const focusComposer = () => {
    // Let the controlled value flush to the DOM before scrolling / caret-to-end.
    setTimeout(() => {
      if (composerRef.current) {
        const y = composerRef.current.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      const ta = taRef.current;
      if (ta) { ta.focus(); const v = ta.value; try { ta.setSelectionRange(v.length, v.length); } catch { /* noop */ } }
    }, 0);
  };

  const applyTemplate = (text) => { setState({ prompt: text }); focusComposer(); };

  const remix = (e, text) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setState({ prompt: text });
    setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); taRef.current?.focus(); }, 0);
    toast('Remixed — tweak the prompt and generate');
  };

  const handlePaste = (e) => {
    // Capture a pasted image as a REAL file so it uploads with the project.
    const items = e.clipboardData && e.clipboardData.items;
    if (items) {
      for (const it of items) {
        if (it.type && it.type.indexOf('image') === 0) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            const name = f.name || `pasted-image.${(it.type.split('/')[1] || 'png')}`;
            setState((s) => ({ assets: s.assets.concat([{ id: uid('as'), kind: 'IMAGE', name, size: f.size, file: f }]) }));
            toast('Pasted image attached');
          }
          return;
        }
      }
    }
    // A pasted URL just lands in the prompt as text (the director reads it) —
    // no fake "link" chip, since the pipeline doesn't fetch links yet.
  };

  const keydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); } };

  const openEditor = (id) => navigate(id ? `editor?id=${id}` : 'editor');

  // Poll a project until it finishes rendering; resolves the final publicView.
  const pollProject = (id) => new Promise((resolve, reject) => {
    clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const p = await getProject(id);
        setState({ genStage: p.stage || p.status, genProgress: p.progress || 0 });
        if (p.status === 'done') { clearInterval(pollRef.current); resolve(p); }
        else if (p.status === 'failed') { clearInterval(pollRef.current); reject(new Error(p.error || 'render failed')); }
      } catch (e) { clearInterval(pollRef.current); reject(e); }
    };
    pollRef.current = setInterval(tick, 1500);
    tick();
  });

  // Step 1: write the script (directing only) and show it for review.
  const generate = () => {
    const S0 = stateRef.current;
    if (!S0.prompt.trim()) { toast('Describe your video first — or pick a starting point below'); taRef.current?.focus(); return; }
    if (S0.previewing || S0.generating) return;
    setState({ previewing: true });
    previewScript({
      prompt: S0.prompt.trim(), format: S0.format, duration: S0.lengthSec, genre: S0.genre,
      uploadNames: (S0.assets || []).map((a) => a.name).filter(Boolean),
    })
      .then((r) => { setState({ previewing: false, review: r }); window.scrollTo({ top: 0 }); })
      .catch((err) => { setState({ previewing: false }); toast('Couldn’t write the script — ' + (err.message || err)); });
  };

  // Step 2: the user approved/edited the script → run the full pipeline on it.
  const runGenerate = (editedScript) => {
    const S0 = stateRef.current;
    const files = (S0.assets || []).map((a) => a.file).filter(Boolean);
    setState({ generating: true, genStage: 'directing', genProgress: 0 });
    createProject({
      prompt: S0.prompt.trim(), format: S0.format, duration: S0.lengthSec, genre: S0.genre, files,
      editedScript, assetPlan: S0.review?.asset_plan,
    })
      .then((p) => pollProject(p.id))
      .then((p) => navigate(`editor?id=${p.id}`))
      .catch((err) => { setState({ generating: false }); toast('Generation failed — ' + (err.message || err)); });
  };

  const goGallery = () => { navigate(''); setTimeout(() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' }), 60); };

  /* ---- computed render values ---- */
  const S = state;

  // Generating (after approving the script) → full-screen progress.
  if (S.generating) {
    return (
      <LoadingScreen
        stage={S.genStage}
        progress={S.genProgress}
        prompt={S.prompt.trim()}
        title={S.review?.script?.metadata?.title || ''}
      />
    );
  }

  // Review step: the script is written — show it for edit/approval before render.
  if (S.review) {
    return (
      <ScriptReview
        review={S.review}
        prompt={S.prompt.trim()}
        busy={S.generating}
        onBack={() => setState({ review: null })}
        onGenerate={runGenerate}
      />
    );
  }
  const seg = (on) => 'cursor:pointer;border:none;background:' + (on ? 'rgba(255,255,255,0.1)' : 'transparent') + ';color:' + (on ? '#F4F3F0' : 'rgba(244,243,240,0.55)') + ';font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:8px;transition:background .15s,color .15s';
  const formatOpts = ['16:9', '9:16'].map((f) => ({ label: f, pick: () => setState({ format: f }), style: seg(S.format === f) }));
  // Built-ins first, then the caller's custom presets (marked deletable).
  const presetList = [
    ...((S.presets?.builtins) || []),
    ...((S.presets?.custom) || []).map((p) => ({ ...p, builtin: false })),
  ];
  const ls = S.lengthSec;
  const lengthLabel = ls < 60 ? ls + 's' : Math.floor(ls / 60) + ':' + String(ls % 60).padStart(2, '0');
  const canGen = S.prompt.trim().length > 0;
  const genStyle = 'cursor:pointer;display:inline-flex;align-items:center;gap:9px;border:none;border-radius:12px;padding:13px 24px;font-size:15px;font-weight:600;background:var(--accent);color:#0B0B0E;transition:filter .15s,transform .15s,opacity .15s;' + (canGen ? '' : 'opacity:0.5');
  const name = (userName ?? 'Alex').trim() || 'Alex';
  const initial = name.charAt(0).toUpperCase();

  // Real projects split into finished videos vs in-progress drafts.
  const loadingProjects = S.projects === null;
  const allProjects = S.projects || [];
  const draftItems = allProjects.filter((p) => p.status !== 'done');
  const videoItems = allProjects.filter((p) => p.status === 'done');

  const sectionLabel = (color) => ({ fontFamily: mono, fontSize: 11, letterSpacing: '0.14em', color });
  const h2Style = { margin: '8px 0 0', fontFamily: grotesk, fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' };

  return (
    <div className="sqh" style={{ position: 'relative', minHeight: '100vh', paddingBottom: 80 }}>
      <style>{`
        .sqh input[type=range]{-webkit-appearance:none;appearance:none;height:3px;border-radius:99px;background:rgba(255,255,255,0.18);outline:none;accent-color:var(--accent)}
        .sqh input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--accent);cursor:pointer;box-shadow:0 0 0 3px rgba(11,11,14,0.7)}
        .sqh input[type=range]::-moz-range-thumb{width:14px;height:14px;border:none;border-radius:50%;background:var(--accent);cursor:pointer}
        .sqh .sq-focus:focus-within{border-color:color-mix(in oklab, var(--accent) 55%, transparent)!important}
        @keyframes sqpulse{0%,100%{opacity:0.55;transform:rotate(45deg) scale(1)}50%{opacity:1;transform:rotate(45deg) scale(1.18)}}
        @keyframes sqshimmer{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}
      `}</style>

      {/* ============ NAV ============ */}
      <header style={css('position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);background:rgba(11,11,14,0.78);border-bottom:1px solid rgba(255,255,255,0.06)')}>
        <div style={css('max-width:1200px;margin:0 auto;padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between;gap:16px')}>
          <div style={css('display:flex;align-items:center;gap:24px;min-width:0')}>
            <Box t="a" href="#/" onClick={(e) => { e.preventDefault(); navigate(''); }} s="display:flex;align-items:center;gap:10px;text-decoration:none">
              <span style={css('width:14px;height:14px;background:var(--accent);border-radius:3px;transform:rotate(45deg);display:inline-block')} />
              <span style={{ fontFamily: grotesk, fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', color: '#F4F3F0' }}>Squook</span>
            </Box>
            <nav style={css('display:flex;align-items:center;gap:4px')}>
              <span style={css('font-size:13.5px;font-weight:600;color:#F4F3F0;background:rgba(255,255,255,0.07);padding:7px 13px;border-radius:9px')}>Home</span>
              <Box t="a" href="#/#gallery" onClick={(e) => { e.preventDefault(); goGallery(); }} s="font-size:13.5px;color:rgba(244,243,240,0.62);padding:7px 13px;border-radius:9px;text-decoration:none" sh="color:#F4F3F0">Gallery</Box>
              <Box t="a" href="#/pricing" onClick={(e) => { e.preventDefault(); navigate('pricing'); }} s="font-size:13.5px;color:rgba(244,243,240,0.62);padding:7px 13px;border-radius:9px;text-decoration:none" sh="color:#F4F3F0">Pricing</Box>
            </nav>
          </div>
          <div style={css('display:flex;align-items:center;gap:14px')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: mono, fontSize: 11, color: 'rgba(244,243,240,0.55)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 99, padding: '5px 11px' }}><span style={css('width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block')} />Pro · 24 renders left</span>
            <span style={css('width:31px;height:31px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;color:rgba(244,243,240,0.85)')}>{initial}</span>
          </div>
        </div>
      </header>

      <main style={css('max-width:1200px;margin:0 auto;padding:0 32px')}>

        {/* ===== HERO + COMPOSER ===== */}
        <section style={css('padding:52px 0 8px')}>
          <div style={css('margin-bottom:24px')}>
            <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: '0.16em', color: 'var(--accent)' }}>WELCOME BACK</div>
            <h1 style={{ margin: '12px 0 0', fontFamily: grotesk, fontWeight: 800, fontSize: 'clamp(30px,4vw,46px)', lineHeight: 1.04, letterSpacing: '-0.03em' }}>Good to see you, {name}.<br /><span style={{ color: 'rgba(244,243,240,0.5)' }}>What are we making today?</span></h1>
          </div>

          {/* composer card */}
          <div ref={composerRef} className="sq-focus" style={css('border:1px solid rgba(255,255,255,0.12);border-radius:20px;background:rgba(255,255,255,0.025);padding:20px 20px 16px;box-shadow:0 24px 70px rgba(0,0,0,0.35)')}>
            <textarea ref={taRef} value={S.prompt} onChange={(e) => setState({ prompt: e.target.value })} onKeyDown={keydown} onPaste={handlePaste} rows="3" placeholder="Describe the video you want — the audience, the mood, the length. Like briefing a director…" style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: 'none', background: 'transparent', color: '#F4F3F0', fontSize: 17, lineHeight: 1.55, outline: 'none', minHeight: 78 }} />

            {/* attached assets */}
            {S.assets.length > 0 && (
              <div style={css('display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px')}>
                {S.assets.map((a) => (
                  <span key={a.id} style={css('display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.13);border-radius:9px;padding:6px 8px 6px 10px;font-size:12.5px;color:rgba(244,243,240,0.88)')}>
                    <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', color: 'var(--accent)' }}>{a.kind}</span>
                    <span style={css('max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{a.name}</span>
                    {a.size != null && <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.4)' }}>{fmtSize(a.size)}</span>}
                    <Box t="button" onClick={() => removeAsset(a.id)} title="Remove" s="cursor:pointer;background:none;border:none;color:rgba(244,243,240,0.5);padding:0;font-size:13px;line-height:1;display:flex" sh="color:#F4F3F0">✕</Box>
                  </span>
                ))}
              </div>
            )}

            {/* toolbar: attach (left) + format/length (right) */}
            <div style={css('display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-top:14px;border-top:1px solid rgba(255,255,255,0.07)')}>
              <div style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
                <input ref={fileRef} type="file" multiple onChange={onFilesPicked} style={{ display: 'none' }} />
                {ATTACH_BTNS.map((b) => (
                  <Box key={b.key} t="button" onClick={() => onAttach(b)} title={b.soon ? 'Coming soon' : `Attach ${b.label.toLowerCase()}`} s={`cursor:pointer;display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:8px 12px;font-size:12.5px;color:rgba(244,243,240,${b.soon ? '0.4' : '0.75'});transition:border-color .15s,color .15s`} sh="border-color:rgba(255,255,255,0.28);color:#F4F3F0">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={b.d} /></svg>
                    {b.label}
                  </Box>
                ))}
              </div>
              <div style={css('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
                <div style={css('display:flex;gap:2px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:3px;background:rgba(255,255,255,0.02)')}>
                  {formatOpts.map((f) => (
                    <button key={f.label} onClick={f.pick} style={css(f.style)}>{f.label}</button>
                  ))}
                </div>
                <div style={css('display:flex;align-items:center;gap:11px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px 13px;background:rgba(255,255,255,0.02)')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(244,243,240,0.5)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  <input type="range" min="5" max="600" step="5" value={S.lengthSec} onChange={(e) => setState({ lengthSec: +e.target.value })} style={{ width: 120, accentColor: 'var(--accent)' }} />
                  <span style={{ fontFamily: mono, fontSize: 12, color: '#F4F3F0', minWidth: 36, textAlign: 'right' }}>{lengthLabel}</span>
                </div>
              </div>
            </div>

            {/* bottom row: hint + generate */}
            <div style={css('display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:14px')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: mono, fontSize: 11, color: 'rgba(244,243,240,0.4)' }}>
                <span style={css('border:1px solid rgba(255,255,255,0.16);border-radius:5px;padding:2px 6px')}>⌘ ⏎</span> to generate · paste or attach an image
              </span>
              <Box t="button" onClick={generate} s={genStyle + (S.previewing ? ';opacity:0.7;pointer-events:none' : '')} sh="filter:brightness(1.1);transform:translateY(-1px)">
                {S.previewing ? 'Writing your script…' : 'Write script'}
                {!S.previewing && <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>}
              </Box>
            </div>
          </div>

          {/* content-preset picker */}
          <div style={css('display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-top:16px')}>
            <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.4)', marginRight: 2, marginTop: 8 }}>STYLE</span>
            <div style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
              {presetList.map((p) => {
                const on = S.genre === p.id;
                return (
                  <Box key={p.id} t="button" onClick={() => setState({ genre: p.id })} title={p.description || ''}
                    s={`cursor:pointer;display:inline-flex;align-items:center;gap:7px;background:${on ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)'};border:1px solid ${on ? 'var(--accent)' : 'rgba(255,255,255,0.1)'};border-radius:99px;padding:7px 13px;font-size:12.5px;color:${on ? '#F4F3F0' : 'rgba(244,243,240,0.72)'};transition:border-color .15s,color .15s`} sh="border-color:var(--accent);color:#F4F3F0">
                    <span aria-hidden style={{ fontSize: 13 }}>{p.icon || '🎨'}</span>{p.label}
                    {!p.builtin && (
                      <Box t="span" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }} title="Delete preset" s="cursor:pointer;color:rgba(244,243,240,0.45);font-size:12px;line-height:1;margin-left:1px" sh="color:#F4F3F0">✕</Box>
                    )}
                  </Box>
                );
              })}
              <Box t="button" onClick={() => setState((s) => ({ presetForm: s.presetForm ? null : { ...EMPTY_PRESET_FORM } }))} title="Create your own preset"
                s="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px dashed rgba(255,255,255,0.22);border-radius:99px;padding:7px 13px;font-size:12.5px;color:rgba(244,243,240,0.6)" sh="border-color:var(--accent);color:#F4F3F0">＋ New preset</Box>
            </div>
          </div>

          {/* new-preset form */}
          {S.presetForm && (() => {
            const f = S.presetForm;
            const setF = (patch) => setState((s) => ({ presetForm: { ...s.presetForm, ...patch } }));
            const field = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:8px 11px;color:#F4F3F0;font-size:12.5px;outline:none';
            const lbl = { fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(244,243,240,0.45)', marginBottom: 5, display: 'block' };
            const opt = (v) => v ? (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ') : 'Auto';
            return (
              <div style={css('margin-top:12px;border:1px solid rgba(255,255,255,0.12);border-radius:14px;background:rgba(255,255,255,0.025);padding:16px 18px;display:flex;flex-direction:column;gap:14px')}>
                <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px')}>
                  <label><span style={lbl}>NAME</span><input value={f.label} onChange={(e) => setF({ label: e.target.value })} placeholder="e.g. Calm nature stills" style={{ ...css(field), width: '100%', boxSizing: 'border-box' }} /></label>
                  <label><span style={lbl}>MEDIA</span><select value={f.media} onChange={(e) => setF({ media: e.target.value })} style={{ ...css(field), width: '100%' }}>{MEDIA_OPTS.map((m) => <option key={m.v} value={m.v} style={{ color: '#000' }}>{m.l}</option>)}</select></label>
                  <label><span style={lbl}>MOOD</span><select value={f.mood} onChange={(e) => setF({ mood: e.target.value })} style={{ ...css(field), width: '100%' }}>{MOOD_OPTS.map((m) => <option key={m} value={m} style={{ color: '#000' }}>{opt(m)}</option>)}</select></label>
                  <label><span style={lbl}>FONT</span><select value={f.font} onChange={(e) => setF({ font: e.target.value })} style={{ ...css(field), width: '100%' }}>{FONT_OPTS.map((m) => <option key={m} value={m} style={{ color: '#000' }}>{opt(m)}</option>)}</select></label>
                  <label><span style={lbl}>VOICE</span><select value={f.voice} onChange={(e) => setF({ voice: e.target.value })} style={{ ...css(field), width: '100%' }}>{VOICE_OPTS.map((m) => <option key={m} value={m} style={{ color: '#000' }}>{m ? opt(m) : 'Auto'}</option>)}</select></label>
                  <label><span style={lbl}>MUSIC</span><select value={f.music} onChange={(e) => setF({ music: e.target.value })} style={{ ...css(field), width: '100%' }}>{MUSIC_OPTS.map((m) => <option key={m} value={m} style={{ color: '#000' }}>{m ? opt(m) : 'Auto'}</option>)}</select></label>
                </div>
                <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'rgba(244,243,240,0.75)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={f.noFaces} onChange={(e) => setF({ noFaces: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
                    No real faces (block portraits &amp; logos)
                  </label>
                  <div style={css('display:flex;align-items:center;gap:8px')}>
                    <Box t="button" onClick={() => setState({ presetForm: null })} s="cursor:pointer;background:transparent;border:1px solid rgba(255,255,255,0.14);border-radius:9px;padding:8px 14px;font-size:12.5px;color:rgba(244,243,240,0.7)" sh="color:#F4F3F0;border-color:rgba(255,255,255,0.3)">Cancel</Box>
                    <Box t="button" onClick={savePreset} s={`cursor:pointer;border:none;border-radius:9px;padding:8px 16px;font-size:12.5px;font-weight:600;background:var(--accent);color:#0B0B0E${f.saving ? ';opacity:0.6' : ''}`} sh="filter:brightness(1.1)">{f.saving ? 'Saving…' : 'Save preset'}</Box>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* quick-start templates */}
          <div style={css('display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px')}>
            <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.4)', marginRight: 2 }}>START FROM</span>
            {TEMPLATES.map((t) => (
              <Box key={t.label} t="button" onClick={() => applyTemplate(t.p)} s="cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:99px;padding:7px 14px;font-size:12.5px;color:rgba(244,243,240,0.72);transition:border-color .15s,color .15s" sh="border-color:var(--accent);color:#F4F3F0">{t.label}</Box>
            ))}
          </div>
        </section>

        {/* ===== CONTINUE / DRAFTS ===== */}
        <section style={css('padding:56px 0 0')}>
          <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px')}>
            <div>
              <div style={sectionLabel('var(--accent)')}>PICK UP WHERE YOU LEFT OFF</div>
              <h2 style={h2Style}>Your drafts</h2>
            </div>
          </div>
          {loadingProjects
            ? <div style={{ fontFamily: mono, fontSize: 12, color: 'rgba(244,243,240,0.4)' }}>Loading your projects…</div>
            : draftItems.length === 0
              ? <div style={{ fontFamily: mono, fontSize: 12.5, color: 'rgba(244,243,240,0.42)', lineHeight: 1.6 }}>No drafts in progress. Generate a video above and it’ll show up here while it renders.</div>
              : (
                <div style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:16px')}>
                  {draftItems.map((d) => (
                    <Box key={d.id} onClick={() => openEditor(d.id)} s="cursor:pointer;display:flex;gap:14px;border:1px solid rgba(255,255,255,0.09);border-radius:14px;background:rgba(255,255,255,0.02);padding:12px;transition:transform .18s,border-color .18s" sh="transform:translateY(-3px);border-color:rgba(255,255,255,0.24)">
                      <div style={css('position:relative;flex:none;width:104px;border-radius:10px;overflow:hidden;aspect-ratio:16/10')}>
                        <div style={css(bg(gradFor(d.id)))} />
                        <div style={css('position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.5),transparent 70%)')} />
                        <span style={css('position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.16);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center')}><span style={css('width:0;height:0;border-left:7px solid #fff;border-top:4.5px solid transparent;border-bottom:4.5px solid transparent;margin-left:2px')} /></span>
                      </div>
                      <div style={css('display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;padding:2px 0')}>
                        <span style={css('font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{d.title}</span>
                        <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.42)' }}>{['Draft ' + d.draft, metaOf(d)].filter(Boolean).join(' · ')}</span>
                        <span style={css('margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px')}>
                          <span style={css('font-size:11px;color:rgba(244,243,240,0.5)')}>{statusLabel(d)}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)' }}>Continue →</span>
                        </span>
                      </div>
                    </Box>
                  ))}
                </div>
              )}
        </section>

        {/* ===== YOUR VIDEOS ===== */}
        <section style={css('padding:56px 0 0')}>
          <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px')}>
            <div>
              <div style={sectionLabel('var(--accent)')}>RENDERED &amp; READY</div>
              <h2 style={h2Style}>Your videos</h2>
            </div>
            <Box t="a" href="#/#gallery" onClick={(e) => { e.preventDefault(); goGallery(); }} s="font-size:13px;color:rgba(244,243,240,0.55);text-decoration:none" sh="color:#F4F3F0">View all →</Box>
          </div>
          {loadingProjects
            ? <div style={{ fontFamily: mono, fontSize: 12, color: 'rgba(244,243,240,0.4)' }}>Loading…</div>
            : videoItems.length === 0
              ? <div style={{ fontFamily: mono, fontSize: 12.5, color: 'rgba(244,243,240,0.42)', lineHeight: 1.6 }}>No finished videos yet — your first render will land here.</div>
              : (
                <div style={css('display:grid;grid-template-columns:repeat(4,1fr);gap:16px')}>
                  {videoItems.map((v) => (
                    <Box key={v.id} onClick={() => openEditor(v.id)} s="position:relative;aspect-ratio:16/10;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.09);cursor:pointer;transition:transform .2s,border-color .2s" sh="transform:translateY(-4px);border-color:rgba(255,255,255,0.24)">
                      <div style={css(bg(gradFor(v.id)))} />
                      <img src={thumbSrc(v.id)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={css('position:absolute;inset:0;pointer-events:none;background:linear-gradient(to top, rgba(0,0,0,0.84) 0%, rgba(0,0,0,0.2) 40%, transparent 62%)')} />
                      <span style={{ position: 'absolute', top: 11, left: 11, pointerEvents: 'none', fontFamily: mono, fontSize: 10.5, color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)', padding: '3px 7px', borderRadius: 6 }}>{metaOf(v) || 'video'}</span>
                      <span style={css('position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.13);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.28);display:flex;align-items:center;justify-content:center')}><span style={css('width:0;height:0;border-left:11px solid rgba(255,255,255,0.95);border-top:7px solid transparent;border-bottom:7px solid transparent;margin-left:3px')} /></span>
                      <div style={css('position:absolute;left:0;right:0;bottom:0;pointer-events:none;padding:13px;display:flex;flex-direction:column;gap:5px')}>
                        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', color: 'var(--accent)' }}>PROMPT</span>
                        <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'rgba(255,255,255,0.9)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>“{v.prompt}”</span>
                      </div>
                    </Box>
                  ))}
                </div>
              )}
        </section>

        {/* ===== TRENDING ===== */}
        <section style={css('padding:56px 0 0')}>
          <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px')}>
            <div>
              <div style={sectionLabel('var(--accent)')}>MADE ON SQUOOK THIS WEEK</div>
              <h2 style={h2Style}>Trending</h2>
            </div>
            <Box t="a" href="#/#gallery" onClick={(e) => { e.preventDefault(); goGallery(); }} s="font-size:13px;color:rgba(244,243,240,0.55);text-decoration:none" sh="color:#F4F3F0">Explore →</Box>
          </div>
          <div style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:18px')}>
            {TRENDING.map((t) => {
              const avatar = t.creator.replace('@', '').charAt(0).toUpperCase();
              return (
                <Box key={t.prompt} onClick={openEditor} s="position:relative;aspect-ratio:16/10;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.09);cursor:pointer;transition:transform .2s,border-color .2s" sh="transform:translateY(-4px);border-color:rgba(255,255,255,0.24)">
                  <div style={css(bg(t.grad))} />
                  <div style={css('position:absolute;inset:0;pointer-events:none;background:linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.25) 42%, transparent 64%)')} />
                  <span style={{ position: 'absolute', top: 12, left: 12, pointerEvents: 'none', fontFamily: mono, fontSize: 10.5, color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)', padding: '3px 7px', borderRadius: 6 }}>{t.meta}</span>
                  <span style={css('position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.13);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.28);display:flex;align-items:center;justify-content:center')}><span style={css('width:0;height:0;border-left:13px solid rgba(255,255,255,0.95);border-top:8px solid transparent;border-bottom:8px solid transparent;margin-left:3px')} /></span>
                  <div style={css('position:absolute;left:0;right:0;bottom:0;pointer-events:none;padding:15px;display:flex;flex-direction:column;gap:8px')}>
                    <span style={{ fontSize: 13, lineHeight: 1.4, color: 'rgba(255,255,255,0.92)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>“{t.prompt}”</span>
                    <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'rgba(255,255,255,0.72)' }}><span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: grotesk, fontWeight: 700, fontSize: 10, color: '#fff' }}>{avatar}</span>{t.creator}</span>
                      <Box t="button" onClick={(e) => remix(e, t.prompt)} s="pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.12);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.26);color:#fff;font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:8px;transition:background .15s,border-color .15s,color .15s" sh="background:var(--accent);border-color:var(--accent);color:#0B0B0E">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                        Remix
                      </Box>
                    </div>
                  </div>
                </Box>
              );
            })}
          </div>
        </section>
      </main>

      {/* ===== GENERATING OVERLAY ===== */}
      {S.generating && (
        <div style={css('position:fixed;inset:0;z-index:100;background:rgba(11,11,14,0.9);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:32px;text-align:center')}>
          <span style={{ width: 34, height: 34, background: 'var(--accent)', borderRadius: 6, display: 'inline-block', animation: 'sqpulse 1s infinite' }} />
          <div style={css('display:flex;flex-direction:column;gap:10px;align-items:center;max-width:560px')}>
            <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent)' }}>{(S.genStage || 'directing').toUpperCase()}{S.genProgress ? ' · ' + S.genProgress + '%' : ''}</span>
            <span style={{ fontFamily: grotesk, fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Casting shots, cutting to the beat…</span>
            <span style={{ fontSize: 14, color: 'rgba(244,243,240,0.6)', lineHeight: 1.5, textWrap: 'pretty' }}>“{S.prompt}”</span>
          </div>
          <div style={css('position:relative;width:min(420px,80vw);height:3px;border-radius:99px;background:rgba(255,255,255,0.1);overflow:hidden')}>
            {S.genProgress > 0
              ? <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: S.genProgress + '%', borderRadius: 99, background: 'var(--accent)', transition: 'width .4s ease' }} />
              : <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '30%', borderRadius: 99, background: 'var(--accent)', animation: 'sqshimmer 1.1s infinite' }} />}
          </div>
        </div>
      )}

      {/* toast */}
      {!!S.note && (
        <div style={css('position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:110;background:rgba(20,20,25,0.96);border:1px solid color-mix(in oklab, var(--accent) 45%, transparent);border-radius:11px;padding:11px 18px;font-size:13px;color:#F4F3F0;box-shadow:0 12px 40px rgba(0,0,0,0.5);max-width:min(90vw,520px)')}>{S.note}</div>
      )}
    </div>
  );
}
