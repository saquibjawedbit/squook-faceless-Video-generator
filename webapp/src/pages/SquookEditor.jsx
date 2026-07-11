import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '../lib/Box.jsx';
import { css } from '../lib/css.js';
import { Markdown } from '../lib/markdown.jsx';
import { currentQuery } from '../lib/router.js';
import { getProject, getPlaybackUrl, getIR, putIR, rerenderProject, directorChatStream, getChatLog, chatNote, clearChat, searchStock, fetchAsset, uploadAsset, createPreset } from '../lib/api.js';
import { deriveView, retimeLocal, uiTf, irTfPatch, primaryVisualIx, selRefOf, sceneGrad, stageRegions, regionAt } from '../lib/irView.js';

/**
 * Squook Editor — a faithful React port of the `Squook Editor.dc.html` design
 * prototype. A full-viewport three-column editing surface: a Layers/Media rail,
 * a video stage with transport + annotate tools over a VID/TXT/AUD timeline, and
 * a Director-chat / Inspector / Comments rail on the right.
 *
 * Two modes:
 *  - Demo (no `?id=`): the design prototype's mock clips/texts/audio stand.
 *  - Real (#/editor?id=…): the project's IR snapshot is the document. The
 *    timeline/layers/inspector are derived from it (lib/irView.js), every edit
 *    mutates the IR (autosaved via PUT /ir, undo/redo-able), the Director chat
 *    is the server's AI edit endpoint, and Re-render bakes edits into a new
 *    draft of the MP4. Comments + annotations persist per project locally.
 */

const mono = "'JetBrains Mono',monospace";
const grotesk = "'Schibsted Grotesk',sans-serif";

const INITIAL = {
  leftTab: 'layers', rightTab: 'director', tool: 'select',
  sel: { type: 'clip', id: 'c1' },
  playing: false, time: 0.1, format: '16:9', draft: 2, note: '',
  thinking: false, agentStatus: '', streamText: '', input: '', commentInput: '', cropOn: false,
  // Real backend project (when opened as #/editor?id=…).
  projId: null, projTitle: '', videoUrl: null, vTime: 0, vDur: 0,
  ir: null, irPast: [], irFuture: [], saveState: 'saved',
  rendering: false, renderPct: 0, renderStage: '',
  inkLive: null, hoverHit: null, dev: false,
  // "Replace footage" panel (real IR projects only).
  replace: { open: false, tab: 'search', q: '', results: [], loading: false, err: '', busy: false, url: '' },
  // Media tab: live stock search + upload that add real footage as new scenes.
  media: { q: '', results: [], loading: false, err: '', busy: false },
  // Preview & trim overlay: play a clip and choose how much of it to use. The
  // used window (outS-inS) is locked to sceneDur — the scene being replaced.
  preview: { open: false, item: null, target: 'replace', sceneDur: 0, dur: 0, inS: 0, outS: 0, busy: false, err: '' },
  clips: [
    { id: 'c1', scene: 'HOOK', label: 'Skyline at dusk', alts: ['Skyline at dusk', 'Neon street pan', 'Aerial city sweep'], srcIx: 0, src: 'Stock', dur: 3.5, grad: 'linear-gradient(135deg,#3a2416,#c2410c)' },
    { id: 'c2', scene: 'PRODUCT', label: 'Dashboard screen-rec', alts: ['Dashboard screen-rec', 'App close-up', 'Hands on laptop'], srcIx: 0, src: 'Yours', dur: 6.0, grad: 'linear-gradient(135deg,#0f2540,#2563eb)' },
    { id: 'c3', scene: 'FEATURE', label: 'Feature highlight', alts: ['Feature highlight', 'UI zoom', 'Cursor demo'], srcIx: 0, src: 'Stock', dur: 4.0, grad: 'linear-gradient(135deg,#0c2f2a,#0d9488)' },
    { id: 'c4', scene: 'PROOF', label: 'Team at work', alts: ['Team at work', 'Customer smiling', 'Office b-roll'], srcIx: 0, src: 'Stock', dur: 4.5, grad: 'linear-gradient(135deg,#241a3a,#7c3aed)' },
    { id: 'c5', scene: 'CTA', label: 'Logo end card', alts: ['Logo end card', 'Big type end card', 'Product + tagline'], srcIx: 0, src: 'Brand kit', dur: 3.0, grad: 'linear-gradient(135deg,#111117,#2a2a33)' },
  ],
  texts: [
    { id: 't1', content: 'Ship faster.', start: 0.6, dur: 3.0, size: 46, ax: 0, ay: 22 },
    { id: 't2', content: '10× your output', start: 9.5, dur: 4.0, size: 40, ax: 0, ay: -8 },
    { id: 't3', content: 'northwind.io', start: 18.5, dur: 2.5, size: 30, ax: 0, ay: 30 },
  ],
  audio: [
    { id: 'a1', kind: 'music', label: 'Beat-synced electronic', vol: 68, alts: ['Beat-synced electronic', 'Warm acoustic', 'Cinematic score'], srcIx: 0 },
    { id: 'a2', kind: 'vo', label: 'Nova — warm', vol: 90, start: 2, dur: 15, alts: ['Nova — warm', 'Atlas — deep', 'Juno — energetic', 'No voiceover'], srcIx: 0 },
  ],
  tf: {
    c1: { scale: 100, x: 0, y: 0, rot: 0, op: 100 },
    c2: { scale: 100, x: 0, y: 0, rot: 0, op: 100 },
    c3: { scale: 100, x: 0, y: 0, rot: 0, op: 100 },
    c4: { scale: 100, x: 0, y: 0, rot: 0, op: 100 },
    c5: { scale: 100, x: 0, y: 0, rot: 0, op: 100 },
    t1: { scale: 100, x: 0, y: 22, rot: 0, op: 100 },
    t2: { scale: 100, x: 0, y: -8, rot: 0, op: 100 },
    t3: { scale: 100, x: 0, y: 30, rot: 0, op: 100 },
  },
  annotations: [],
  comments: [
    { id: 'cm0', kind: 'clip', ref: 'c2', at: '0:05 · Dashboard screen-rec', author: 'You', text: 'Can we push the accent color harder on this shot?' },
  ],
  chat: [
    { role: 'director', text: 'I cut a 21-second launch film — dusk hook, your dashboard recording, a proof beat, and a logo end card, timed to a beat-synced track. Tell me what to change, or edit any layer directly.' },
  ],
};

// A short, searchable stock query drawn from a scene's own text (its narration,
// or a text-layer caption) — used to pre-fill the Replace / Media search boxes
// with what the scene is about. Drops stopwords and keeps the first few keywords.
const QUERY_STOP = new Set(('the a an and or but of to in on at for with from by as is are was were be been being ' +
  'he she it they them his her its their our your you i we this that these those had has have will would can could ' +
  'about after before then than so just very more most some any all no not what which who into out up down over off ' +
  'his her their there here when where how why').split(' '));
const sceneQuery = (scene) => {
  if (!scene) return '';
  const caption = (scene.layers || []).find((l) => l.type === 'text' && l.content)?.content;
  const source = (scene.narration || caption || '').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const w of source.replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)) {
    if (w.length <= 2 || QUERY_STOP.has(w) || seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length >= 6) break;
  }
  return out.join(' ');
};

// A clean video/image layer for a footage `src`, carrying over an old layer's
// manual framing (fit/transform) and, for video, an optional {start, end} trim
// (seconds into the clip). Video layers MUST carry the full field set — the
// renderer reads trim_start_s/playback_rate directly and throws on undefined.
const footageLayer = (src, old, trim) => {
  const isVid = /\.(mp4|webm|mov)$/i.test(src);
  if (!isVid) {
    const img = { type: 'image', src, fit: old?.fit || 'cover' };
    if (old?.transform) img.transform = old.transform;
    return img;
  }
  const l = {
    type: 'video', src, fit: old?.fit || 'cover',
    playback_rate: old?.playback_rate ?? 1,
    loop: old?.loop ?? true,
    freeze_last: old?.freeze_last ?? false,
    trim_start_s: trim?.start ?? 0,
    trim_end_s: trim?.end ?? null,
  };
  if (old?.transform) l.transform = old.transform;
  return l;
};

/* ---- pure helpers over derived {clips, texts, audio} arrays ---- */
const totalOf = (clips) => clips.reduce((a, c) => a + c.dur, 0);
const startsOf = (clips) => { let t = 0; const m = {}; clips.forEach((c) => { m[c.id] = t; t += c.dur; }); return m; };
const currentClipAt = (clips, time) => { let acc = 0; let cur = clips[0]; for (const c of clips) { if (time >= acc - 0.001) cur = c; acc += c.dur; } return cur || clips[0]; };
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); const sec = Math.floor(t % 60); return m + ':' + String(sec).padStart(2, '0'); };
const getLayerIn = (v, sel) => {
  if (!sel) return null;
  if (sel.type === 'clip') return v.clips.find((c) => c.id === sel.id);
  if (sel.type === 'text') return v.texts.find((t) => t.id === sel.id);
  if (sel.type === 'audio') return v.audio.find((a) => a.id === sel.id);
  return null;
};
// The editing surface for a state snapshot: IR-derived in real mode, mock arrays otherwise.
const viewOf = (s) => (s.ir ? deriveView(s.ir) : { clips: s.clips, texts: s.texts, audio: s.audio, total: totalOf(s.clips) });
const tlTimeOf = (s) => (s.ir || s.videoUrl ? s.vTime : s.time);

// A monotonic counter replaces Date.now() for fresh ids (StrictMode-safe).
let _uid = 0;
const uid = (p) => p + (++_uid);
// After restoring persisted notes, push the counter past their id suffixes.
const bumpUid = (items) => {
  for (const x of items || []) {
    const m = /(\d+)$/.exec(String(x?.id || ''));
    if (m) _uid = Math.max(_uid, +m[1]);
  }
};

export default function SquookEditor({ accent = '#FF5A2D', grain = true, vignette = true }) {
  const [state, setStateRaw] = useState(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  const playIv = useRef(null);
  const toastT = useRef(null);
  const thinkT = useRef(null);
  const videoRef = useRef(null);
  const saveT = useRef(null);
  const pollIv = useRef(null);
  const drawing = useRef(false);
  const lastMut = useRef('');
  const delRef = useRef(null);          // latest del() for the keyboard shortcut
  const undoRef = useRef(null);         // latest undo/redo for the key handler
  const redoRef = useRef(null);
  const chatScrollRef = useRef(null);   // the Director chat scroll viewport
  const chatPinned = useRef(true);      // follow new messages while at the bottom

  // Merge setState: object → shallow-merge, fn → functional updater (null = no-op).
  const setState = useCallback((patch) => {
    setStateRaw((s) => {
      const p = typeof patch === 'function' ? patch(s) : patch;
      return p == null ? s : { ...s, ...p };
    });
  }, []);

  /* ---- lifecycle: lock scroll + drive theme vars ---- */
  useEffect(() => {
    const b = document.body.style;
    const prevOverflow = b.overflow;
    b.overflow = 'hidden';
    return () => {
      b.overflow = prevOverflow;
      b.removeProperty('--accent');
      b.removeProperty('--grain-o');
      b.removeProperty('--vig-o');
      clearInterval(playIv.current);
      clearTimeout(toastT.current);
      clearTimeout(thinkT.current);
      clearTimeout(saveT.current);
      clearInterval(pollIv.current);
      // Flush any pending autosave on the way out (fire-and-forget).
      const s = stateRef.current;
      if (s.projId && s.ir && s.saveState !== 'saved') putIR(s.projId, s.ir).catch(() => {});
    };
  }, []);

  // Auto-scroll the Director chat to the newest message — on send and as the
  // reply streams in — but only while the user is already near the bottom, so
  // scrolling up to read history isn't yanked back down.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && chatPinned.current) el.scrollTop = el.scrollHeight;
  }, [state.chat, state.streamText, state.thinking, state.agentStatus]);

  useEffect(() => {
    const b = document.body.style;
    b.setProperty('--accent', accent);
    b.setProperty('--grain-o', grain ? '0.04' : '0');
    b.setProperty('--vig-o', vignette ? '1' : '0');
  }, [accent, grain, vignette]);

  const toast = useCallback((msg) => {
    clearTimeout(toastT.current);
    setState({ note: msg });
    toastT.current = setTimeout(() => setState({ note: '' }), 2600);
  }, [setState]);

  /* ---- autosave: every IR mutation debounces a PUT /ir ---- */
  const flushSave = useCallback(async () => {
    const s = stateRef.current;
    if (!s.projId || !s.ir) return;
    clearTimeout(saveT.current);
    setState({ saveState: 'saving' });
    try {
      await putIR(s.projId, s.ir);
      if (s.dev) console.log('[sq-dev] PUT /ir (autosave)', s.ir);
      setState((cur) => (cur.saveState === 'saving' ? { saveState: 'saved' } : null));
    } catch (e) {
      setState({ saveState: 'error' });
      toast('Autosave failed — ' + (e.message || e));
    }
  }, [setState, toast]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveT.current);
    saveT.current = setTimeout(flushSave, 900);
  }, [flushSave]);

  // Apply a mutation to a deep clone of the IR: retime, push undo history,
  // mark unsaved, schedule the autosave. `fn` returning false aborts. A stable
  // `key` coalesces rapid-fire updates (slider drags, typing) into one undo step.
  const mutateIr = useCallback((key, fn) => {
    const coalesce = !!key && lastMut.current === key;
    lastMut.current = key || '';
    setState((s) => {
      if (!s.ir) return null;
      const next = structuredClone(s.ir);
      if (fn(next, s) === false) return null;
      retimeLocal(next);
      return {
        ir: next,
        irPast: coalesce ? s.irPast : s.irPast.concat([s.ir]).slice(-60),
        irFuture: [],
        saveState: 'unsaved',
      };
    });
    scheduleSave();
  }, [setState, scheduleSave]);

  const doUndo = () => {
    const s = stateRef.current;
    if (!s.ir) { toast('Undo'); return; }
    if (!s.irPast.length) { toast('Nothing to undo'); return; }
    lastMut.current = '';
    setState((cur) => {
      if (!cur.irPast.length) return null;
      const past = cur.irPast.slice();
      const prev = past.pop();
      return { ir: prev, irPast: past, irFuture: [cur.ir].concat(cur.irFuture).slice(0, 60), saveState: 'unsaved' };
    });
    scheduleSave();
  };

  const doRedo = () => {
    const s = stateRef.current;
    if (!s.ir) { toast('Redo'); return; }
    if (!s.irFuture.length) { toast('Nothing to redo'); return; }
    lastMut.current = '';
    setState((cur) => {
      if (!cur.irFuture.length) return null;
      const future = cur.irFuture.slice();
      const next = future.shift();
      return { ir: next, irPast: cur.irPast.concat([cur.ir]).slice(-60), irFuture: future, saveState: 'unsaved' };
    });
    scheduleSave();
  };
  // Refs so the once-bound key handler always calls the latest undo/redo.
  undoRef.current = doUndo;
  redoRef.current = doRedo;

  // If opened for a real project (#/editor?id=…), load it: rendered MP4 into
  // the stage, IR snapshot into the timeline, persisted notes from localStorage.
  // Dev mode: `?dev=1` turns it on (persists), `?dev=0` off; else localStorage.
  // Listens to hashchange too — editing the URL bar doesn't remount this page.
  useEffect(() => {
    const readDev = () => {
      const devQ = currentQuery().get('dev');
      const dev = devQ != null ? devQ !== '0' : localStorage.getItem('sq-dev') === '1';
      if (devQ != null) { try { localStorage.setItem('sq-dev', dev ? '1' : '0'); } catch { /* quota */ } }
      setState((s) => (s.dev === dev ? null : { dev }));
    };
    readDev();
    window.addEventListener('hashchange', readDev);
    return () => window.removeEventListener('hashchange', readDev);
  }, [setState]);

  useEffect(() => {
    const id = currentQuery().get('id');
    if (!id) return;
    let ok = true;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('sq-notes-' + id) || 'null'); } catch { /* corrupt */ }
    bumpUid(saved?.comments); bumpUid(saved?.annotations);
    setState({
      projId: id,
      comments: saved?.comments || [],
      annotations: saved?.annotations || [],
    });
    getProject(id).then((p) => {
      if (!ok) return;
      setState({ projTitle: p.title || '', draft: p.draft || 1 });
      if (p.status === 'done') {
        getPlaybackUrl(id).then((url) => { if (ok) setState({ videoUrl: url, playing: false, time: 0 }); }).catch(() => {});
      } else {
        toast('This project is still rendering — showing the editor preview.');
      }
      getIR(id).then((ir) => {
        if (!ok) return;
        retimeLocal(ir);
        const dur = ir.metadata.total_duration_seconds;
        const greeting = { role: 'director', text: `I directed “${p.title || 'your video'}” — ${ir.scenes.length} scenes over ${Math.round(dur)}s. Ask me anything about the cut or tell me what to change; everything autosaves, and Re-render bakes changes into the video.` };
        setState({ ir, sel: { type: 'clip', id: 'sc0' }, chat: [greeting] });
        // Restore the persistent Director conversation (server-side session).
        getChatLog(id).then((msgs) => {
          if (!ok || !msgs.length) return;
          // System notes record which proposals the user applied/discarded, keyed
          // by summary — so a reloaded proposal shows the right state (and an
          // already-applied one isn't offered for a regressive re-apply).
          const resolved = new Map();
          for (const m of msgs) {
            if (m.role !== 'system') continue;
            const am = /^User (APPLIED|DISCARDED) the proposed edit: (.*)$/s.exec(m.text || '');
            if (am) resolved.set(am[2].trim(), am[1] === 'APPLIED' ? 'applied' : 'discarded');
          }
          const restored = msgs.filter((m) => m.role !== 'system').map((m) => {
            const base = { role: m.role === 'user' ? 'user' : 'director', text: m.text };
            if (!m.proposal) return base;
            const state = resolved.get((m.proposal.summary || '').trim());
            if (state) return { ...base, plan: [m.proposal.summary], planState: state };
            // Still pending: rehydrate the proposed IR so Apply works after reload.
            if (m.proposal.ir) {
              return { ...base, plan: [], planState: 'pending', pendingIr: m.proposal.ir, planSummary: m.proposal.summary };
            }
            return { ...base, plan: [m.proposal.summary], planState: 'stale' }; // legacy: no IR persisted
          });
          setState({ chat: [greeting, ...restored] });
        }).catch(() => {});
      }).catch(() => { if (ok) toast('No editable source for this project — timeline shows the demo.'); });
    }).catch(() => { if (ok) toast('Couldn’t load that project — showing a demo timeline.'); });
    return () => { ok = false; };
  }, [setState, toast]);

  // Comments + annotations persist per project (no backend store for them).
  useEffect(() => {
    if (!state.projId) return;
    try {
      localStorage.setItem('sq-notes-' + state.projId, JSON.stringify({ comments: state.comments, annotations: state.annotations }));
    } catch { /* quota */ }
  }, [state.projId, state.comments, state.annotations]);

  /* ---- selection / transport ---- */
  const seekTo = (t) => {
    const s = stateRef.current;
    if (s.videoUrl) {
      const v = videoRef.current;
      if (v) { v.pause(); v.currentTime = Math.max(0, t); }
      setState({ vTime: Math.max(0, t), playing: false });
    } else {
      setState({ time: Math.max(0, t), vTime: Math.max(0, t), playing: false });
      clearInterval(playIv.current);
    }
  };

  const selectLayer = (type, id) => {
    const s = stateRef.current;
    const v = viewOf(s);
    const st = startsOf(v.clips);
    let jump = tlTimeOf(s);
    if (type === 'clip') jump = (st[id] ?? 0) + 0.15;
    if (type === 'text') { const t = v.texts.find((x) => x.id === id); if (t) jump = t.start + 0.15; }
    if (type === 'audio') { const a = v.audio.find((x) => x.id === id); if (a && a.start != null) jump = a.start + 0.05; }
    setState({ sel: { type, id }, rightTab: s.rightTab === 'comments' ? 'inspect' : s.rightTab });
    seekTo(jump);
  };

  // Select a component by clicking it on the video — no seek (it's already on
  // screen), and the current right-rail tab stays put so select → comment flows.
  const pickFromStage = (r) => {
    setState({ sel: r.sel, hoverHit: null });
    toast('Selected ' + r.label);
  };

  const play = () => {
    clearInterval(playIv.current);
    playIv.current = setInterval(() => {
      setState((s) => {
        if (!s.playing) { clearInterval(playIv.current); return null; }
        let t = s.time + 0.1;
        if (t >= totalOf(s.clips)) t = 0;
        return { time: t };
      });
    }, 100);
  };

  const togglePlay = () => {
    // Real project video: drive the <video> element; onPlay/onPause sync `playing`.
    if (stateRef.current.videoUrl) {
      const v = videoRef.current; if (!v) return;
      if (v.paused) v.play(); else v.pause();
      return;
    }
    const p = !stateRef.current.playing;
    setState({ playing: p });
    if (p) play(); else clearInterval(playIv.current);
  };

  const scrub = (e) => {
    const val = +e.target.value;
    if (stateRef.current.videoUrl) {
      const v = videoRef.current; if (v) v.currentTime = val;
      setState({ vTime: val });
      return;
    }
    setState({ time: val, playing: false });
    clearInterval(playIv.current);
  };

  const setTf = (id, prop, val) => {
    const s = stateRef.current;
    if (s.ir) {
      const ref = selRefOf(s.ir, viewOf(s), s.sel);
      if (!ref) { toast('This layer has no transform'); return; }
      mutateIr('tf:' + prop + ':' + id, (ir) => {
        const l = ir.scenes[ref.sceneIx]?.layers?.[ref.layerIx];
        if (!l || l.type === 'audio') return false;
        l.transform = { ...(l.transform || {}), ...irTfPatch(prop, +val) };
      });
      return;
    }
    setState((st) => ({ tf: { ...st.tf, [id]: { ...st.tf[id], [prop]: +val } } }));
  };

  // Trigger a browser download of a rendered MP4 URL. The `download` attribute
  // is ignored cross-origin (the webapp and API are different origins), so we
  // ask the server (or Supabase) for Content-Disposition: attachment via a query
  // param — that's what makes it save instead of navigate to the video.
  const triggerDownload = (url) => {
    const name = (stateRef.current.projTitle || 'squook-video').replace(/[^\w-]+/g, '_') + '.mp4';
    const href = url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(name);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Download the current preview render (540p) as-is — instant, no re-render.
  const exportPreview = async () => {
    const id = stateRef.current.projId;
    setState({ exportMenu: false });
    if (!id) { toast('▸ Export isn’t wired for the demo timeline — open a generated video to export.'); return; }
    try {
      triggerDownload(await getPlaybackUrl(id));
      toast('▸ Downloading your video…');
    } catch (e) { toast('▸ Export failed — ' + (e.message || e)); }
  };

  // Render the current edit at full 1080p, then download it automatically.
  const exportHD = async () => {
    const s0 = stateRef.current;
    setState({ exportMenu: false });
    if (!s0.projId || !s0.ir) { toast('HD export needs a generated project — this is the demo timeline.'); return; }
    if (s0.rendering) { toast('Already rendering — hang tight.'); return; }
    clearTimeout(saveT.current);
    setState({ rendering: true, renderPct: 0, renderStage: 'queued' });
    try {
      await rerenderProject(s0.projId, stateRef.current.ir, 'hd');
      setState({ saveState: 'saved' });
      toast('▸ Rendering HD (1080p) — we’ll download it when it’s ready…');
      clearInterval(pollIv.current);
      pollIv.current = setInterval(async () => {
        try {
          const p = await getProject(s0.projId);
          if (p.status === 'done') {
            clearInterval(pollIv.current);
            let url = await getPlaybackUrl(s0.projId);
            url += (url.includes('?') ? '&' : '?') + 'v=' + p.draft;
            setState({ rendering: false, draft: p.draft, videoUrl: url, vTime: 0, playing: false });
            triggerDownload(url);
            toast('✓ HD ready — downloading');
          } else if (p.status === 'failed') {
            clearInterval(pollIv.current); setState({ rendering: false });
            toast('HD export failed — ' + (p.error || 'unknown error'));
          } else {
            setState({ renderPct: p.progress || 0, renderStage: p.stage || '' });
          }
        } catch { /* transient poll error — keep polling */ }
      }, 1500);
    } catch (e) { setState({ rendering: false }); toast('HD export failed — ' + (e.message || e)); }
  };

  // Save this project's look (theme + inferred media mix) as a reusable preset
  // the composer can offer on the next video.
  const doSavePreset = async () => {
    const id = stateRef.current.projId;
    if (!id) { toast('▸ Save-as-preset needs a generated project — this is the demo timeline.'); return; }
    try {
      const created = await createPreset({ fromProjectId: id });
      toast('▸ Saved this style as a preset — “' + created.label + '”');
    } catch (e) { toast('▸ Could not save preset — ' + (e.message || e)); }
  };

  // Re-render the edited IR into a new draft, polling progress into the header.
  const doRender = async () => {
    const s0 = stateRef.current;
    if (!s0.projId || !s0.ir) { toast('Re-render needs a generated project — this is the demo timeline.'); return; }
    if (s0.rendering) { toast('Already rendering — hang tight.'); return; }
    clearTimeout(saveT.current);
    setState({ rendering: true, renderPct: 0, renderStage: 'queued' });
    try {
      await rerenderProject(s0.projId, stateRef.current.ir);
      setState({ saveState: 'saved' });
      toast('▸ Re-rendering draft ' + (s0.draft + 1) + '…');
      clearInterval(pollIv.current);
      pollIv.current = setInterval(async () => {
        try {
          const p = await getProject(s0.projId);
          if (p.status === 'done') {
            clearInterval(pollIv.current);
            let url = await getPlaybackUrl(s0.projId);
            url += (url.includes('?') ? '&' : '?') + 'v=' + p.draft;
            setState({ rendering: false, draft: p.draft, videoUrl: url, vTime: 0, playing: false, projTitle: p.title || stateRef.current.projTitle });
            toast('✓ Draft ' + p.draft + ' rendered');
          } else if (p.status === 'failed') {
            clearInterval(pollIv.current);
            setState({ rendering: false });
            toast('Render failed — ' + (p.error || 'unknown error'));
          } else {
            setState({ renderPct: p.progress || 0, renderStage: p.stage || '' });
          }
        } catch { /* transient poll error — keep polling */ }
      }, 1500);
    } catch (e) {
      setState({ rendering: false });
      toast('Couldn’t start the render — ' + (e.message || e));
    }
  };

  /* ---- chat / director ---- */
  const planFor = (text) => {
    const low = text.toLowerCase();
    if (low.match(/fast|snapp|quick|short|pace|energ/)) {
      return { intro: 'Got it — tightening the cut for a punchier pace.', act: 'faster',
        changes: ['Trim each shot by ~15%', 'Snap cuts to the beat grid', 'Bump music tempo to 128 BPM'] };
    }
    if (low.match(/slow|calm|breath|longer|gentle/)) {
      return { intro: 'Easing the pace so it breathes more.', act: 'slower',
        changes: ['Extend hook & proof shots', 'Add 0.4s cross-dissolves', 'Switch music to a warmer bed'] };
    }
    if (low.match(/add|more|another|insert|b-roll|shot|scene/)) {
      return { intro: 'Adding a shot and re-cutting around it.', act: 'addshot',
        changes: ['Insert a “Customer smiling” proof shot', 'Rebalance timing to keep it at 21s', 'Carry the caption style through'] };
    }
    if (low.match(/logo|brand|color|colour|end card|type|font/)) {
      return { intro: 'Pushing the brand treatment across the film.', act: 'brand',
        changes: ['Raise accent saturation on the CTA', 'Match caption type to brand kit', 'Hold the logo end card 0.5s longer'] };
    }
    return { intro: 'Here’s how I’d approach that.', act: 'generic',
      changes: ['Re-grade shots for a cohesive look', 'Refine caption timing to the VO', 'Keep the beat-synced music bed'] };
  };

  // What the user has selected, in words the model can use ("it", "this").
  const selDescOf = (s) => {
    if (!s.ir || !s.sel) return '';
    const L = getLayerIn(viewOf(s), s.sel);
    if (!L || L.sceneIx == null) return '';
    const n = L.sceneIx + 1;
    if (s.sel.type === 'clip') return `scene ${n} (${L.label})`;
    if (s.sel.type === 'text') {
      if (L.kind === 'captions') return `the captions in scene ${n}`;
      if (L.kind === 'graphic') return `the ${L.gkind || 'graphic'} in scene ${n}`;
      return `the text “${L.content}” in scene ${n}`;
    }
    return L.kind === 'music' ? 'the music track' : `the narration audio in scene ${n}`;
  };

  // Start a fresh Director conversation — wipes the server-side history (so the
  // agent carries no prior context, e.g. old refusals) and resets the panel to
  // a clean greeting.
  const newChat = async () => {
    const s0 = stateRef.current;
    if (s0.thinking) return;
    const dur = s0.ir?.metadata?.total_duration_seconds || 0;
    const scenes = s0.ir?.scenes?.length || 0;
    const greeting = { role: 'director', text: `Fresh start. I directed “${s0.projTitle || 'your video'}” — ${scenes} scenes over ${Math.round(dur)}s. What would you like to change?` };
    setState({ chat: [greeting], streamText: '', thinking: false, agentStatus: '' });
    chatPinned.current = true;
    if (s0.projId) { try { await clearChat(s0.projId); } catch { /* non-fatal */ } }
    toast('Started a new chat');
  };

  const send = async () => {
    const s0 = stateRef.current;
    const text = s0.input.trim();
    if (!text || s0.thinking) return;
    chatPinned.current = true; // sending your prompt → follow the conversation down

    // Real mode: one STREAMING turn of the server-side Director AGENT — a
    // tool-use loop that can discuss (reply), inspect the IR, or propose ops
    // that are sandbox-applied and self-corrected against the real diff. The
    // stream drives a live status line ("Reading scene 3…", "Writing…") and
    // types the reply in as it arrives, so long multi-step runs never look
    // hung. History lives server-side per project; selection rides as a hint.
    if (s0.ir && s0.projId) {
      const desc = selDescOf(s0);
      setState((s) => ({ chat: s.chat.concat([{ role: 'user', text }]), input: '', thinking: true, agentStatus: 'Thinking…', streamText: '' }));
      if (s0.dev) console.log('[sq-dev] /chat/stream request', { message: text, selection: desc, ir: s0.ir });
      let done = null;
      try {
        await directorChatStream(s0.projId, { message: text, ir: s0.ir, selection: desc || undefined }, (ev) => {
          if (ev.type === 'status') setState({ agentStatus: ev.label });
          else if (ev.type === 'delta') setState((s) => ({ streamText: s.streamText + ev.text, agentStatus: '' }));
          else if (ev.type === 'done') done = ev;
          else if (ev.type === 'error') throw new Error(ev.error);
        });
        const reply = (done?.reply || stateRef.current.streamText || 'Done.').trim();
        const proposal = done?.proposal;
        const trace = done?.trace;
        const devInfo = s0.dev
          ? { instruction: text + (desc ? `\n[selection: ${desc}]` : '') + (trace ? `\n[agent: ${trace.map((t) => t.action).join(' → ')}]` : ''), diff: proposal ? proposal.diff : undefined }
          : undefined;
        if (s0.dev) console.log('[sq-dev] /chat/stream done', { reply, trace, proposal });
        setState((s) => ({
          thinking: false, agentStatus: '', streamText: '', rightTab: 'director',
          chat: s.chat.concat([proposal
            ? { role: 'director', text: reply, plan: [], planState: 'pending', pendingIr: proposal.ir, planSummary: proposal.summary, devInfo }
            : { role: 'director', text: reply, devInfo }]),
        }));
      } catch (e) {
        const msg = (e.message || String(e));
        const partial = stateRef.current.streamText.trim();
        const devInfo = s0.dev ? { instruction: text, raw: e.raw, error: msg } : undefined;
        if (s0.dev) console.log('[sq-dev] /chat/stream FAILED', { message: text, error: msg, raw: e.raw });
        setState((s) => ({
          thinking: false, agentStatus: '', streamText: '',
          chat: s.chat.concat([{ role: 'director', text: partial || ('Something went wrong on my end — ' + msg + '. Try again in a moment.'), devInfo }]),
        }));
      }
      return;
    }

    // Demo mode: the design prototype's canned director.
    setState((s) => ({ chat: s.chat.concat([{ role: 'user', text }]), input: '', thinking: true }));
    clearTimeout(thinkT.current);
    thinkT.current = setTimeout(() => {
      const plan = planFor(text);
      setState((s) => ({ thinking: false, rightTab: 'director',
        chat: s.chat.concat([{ role: 'director', text: plan.intro, plan: plan.changes, planState: 'pending', act: plan.act }]) }));
    }, 1400);
  };

  const applyPlan = (idx) => {
    const s0 = stateRef.current;
    const msg = s0.chat[idx];
    if (!msg) return;

    // Real mode: adopt the AI-proposed IR (undoable, autosaved) and tell the
    // agent's session so its next turn knows the edit landed.
    if (msg.pendingIr && s0.ir) {
      const chat = s0.chat.slice();
      chat[idx] = { ...msg, planState: 'applied' };
      lastMut.current = '';
      setState({
        ir: msg.pendingIr,
        irPast: s0.irPast.concat([s0.ir]).slice(-60),
        irFuture: [],
        saveState: 'unsaved',
        chat: chat.concat([{ role: 'director', text: 'Applied to the edit. Hit Re-render to bake it into the video.' }]),
      });
      scheduleSave();
      if (s0.projId) chatNote(s0.projId, 'User APPLIED the proposed edit: ' + (msg.planSummary || msg.text || 'proposal'));
      toast('✓ Applied — Re-render to update the video');
      return;
    }

    const chat = s0.chat.slice();
    chat[idx] = { ...msg, planState: 'applied' };
    const extra = {};
    if (msg.act === 'faster') {
      extra.clips = s0.clips.map((c) => ({ ...c, dur: Math.max(1.2, +(c.dur * 0.85).toFixed(1)) }));
    } else if (msg.act === 'slower') {
      extra.clips = s0.clips.map((c) => ({ ...c, dur: +(c.dur * 1.15).toFixed(1) }));
    } else if (msg.act === 'addshot') {
      const nc = { id: uid('c'), scene: 'PROOF', label: 'Customer smiling', alts: ['Customer smiling', 'Testimonial b-roll'], srcIx: 0, src: 'Stock', dur: 3.5, grad: 'linear-gradient(135deg,#2a1a2f,#db2777)' };
      const clips = s0.clips.slice(); clips.splice(4, 0, nc);
      extra.clips = clips; extra.tf = { ...s0.tf, [nc.id]: { scale: 100, x: 0, y: 0, rot: 0, op: 100 } };
    }
    extra.chat = chat.concat([{ role: 'director', text: 'Done — Draft ' + (s0.draft + 1) + ' is ready in the preview.' }]);
    extra.draft = s0.draft + 1;
    setState(extra);
    toast('✓ Applied — Draft ' + (s0.draft + 1) + ' rendered');
  };

  const discardPlan = (idx) => {
    const s0 = stateRef.current;
    const msg = s0.chat[idx];
    if (msg?.pendingIr && s0.projId) {
      chatNote(s0.projId, 'User DISCARDED the proposed edit: ' + (msg.planSummary || msg.text || 'proposal'));
    }
    setState((s) => {
      const chat = s.chat.slice();
      if (chat[idx]) chat[idx] = { ...chat[idx], planState: 'discarded', pendingIr: undefined };
      return { chat };
    });
  };

  /* ---- clip ops (real mode mutates the IR; demo mode mutates mock arrays) ---- */
  const trim = (which) => {
    const s = stateRef.current;
    if (s.ir) {
      const v = viewOf(s);
      const sel = s.sel;
      if (sel?.type === 'clip') {
        const c = v.clips.find((x) => x.id === sel.id); if (!c) return;
        mutateIr('', (ir) => {
          const sc = ir.scenes[c.sceneIx];
          if (!sc || sc.duration_s <= 1) return false;
          sc.duration_s = +Math.max(1, sc.duration_s - 0.5).toFixed(2);
          if (which === 'in') for (const l of sc.layers) if (l.type === 'video') l.trim_start_s = +((l.trim_start_s || 0) + 0.5).toFixed(2);
        });
        toast(which === 'in' ? 'Trimmed 0.5s from the scene start' : 'Trimmed 0.5s from the scene end');
      } else if (sel?.type === 'text') {
        const t = v.texts.find((x) => x.id === sel.id);
        if (!t || t.kind !== 'text') { toast('Captions and graphics run the full scene — trim the scene instead'); return; }
        mutateIr('', (ir) => {
          const l = ir.scenes[t.sceneIx]?.layers?.[t.layerIx];
          if (!l || l.type !== 'text') return false;
          if (which === 'in') l.enter = { ...l.enter, at_s: +Math.min((l.enter?.at_s || 0) + 0.5, (l.exit?.at_s ?? 99) - 0.5).toFixed(2) };
          else l.exit = { ...l.exit, at_s: +Math.max((l.exit?.at_s ?? 3) - 0.5, (l.enter?.at_s || 0) + 0.5).toFixed(2) };
        });
        toast('Adjusted text timing');
      } else toast('Select a clip or text layer to trim');
      return;
    }
    const id = s.sel.id;
    setState((st) => ({ clips: st.clips.map((c) => c.id === id ? { ...c, dur: Math.max(1.0, +(c.dur - 0.5).toFixed(1)) } : c) }));
    toast(which === 'in' ? 'Trimmed 0.5s from the start' : 'Trimmed 0.5s from the end');
  };

  const split = () => {
    const s = stateRef.current;
    const sel = s.sel;
    if (sel?.type !== 'clip') { toast('Select a clip to split'); return; }
    if (s.ir) {
      const c = viewOf(s).clips.find((x) => x.id === sel.id); if (!c) return;
      mutateIr('', (ir) => {
        const sc = ir.scenes[c.sceneIx];
        if (!sc || sc.duration_s < 2 || ir.scenes.length >= 60) return false;
        const h = +(sc.duration_s / 2).toFixed(2);
        const second = structuredClone(sc);
        second.duration_s = +(sc.duration_s - h).toFixed(2);
        sc.duration_s = h;
        // Footage continues from the cut; narration audio + captions can't be
        // mid-file split, so they stay with the first half.
        second.layers = second.layers.filter((l) => l.type !== 'audio' && l.type !== 'captions');
        for (const l of second.layers) if (l.type === 'video') l.trim_start_s = +((l.trim_start_s || 0) + h).toFixed(2);
        second.narration = '';
        ir.scenes.splice(c.sceneIx + 1, 0, second);
      });
      toast('Split scene at the midpoint — narration stays with the first half');
      return;
    }
    setState((st) => {
      const clips = []; let added = null;
      st.clips.forEach((c) => {
        if (c.id === sel.id) {
          const h = +(c.dur / 2).toFixed(1);
          const b = { ...c, id: c.id + 'b', dur: c.dur - h, label: c.label };
          added = b;
          clips.push({ ...c, dur: h }); clips.push(b);
        } else clips.push(c);
      });
      const tf = { ...st.tf }; if (added) tf[added.id] = { ...st.tf[sel.id] };
      return { clips, tf };
    });
    toast('Split clip at the midpoint');
  };

  const duplicate = () => {
    const s = stateRef.current;
    const sel = s.sel; if (sel?.type !== 'clip') return;
    if (s.ir) {
      const c = viewOf(s).clips.find((x) => x.id === sel.id); if (!c) return;
      mutateIr('', (ir) => {
        if (ir.scenes.length >= 60) return false;
        ir.scenes.splice(c.sceneIx + 1, 0, structuredClone(ir.scenes[c.sceneIx]));
      });
      toast('Duplicated scene');
      return;
    }
    setState((st) => {
      const i = st.clips.findIndex((c) => c.id === sel.id); if (i < 0) return null;
      const src = st.clips[i]; const nc = { ...src, id: uid(src.id + 'd') };
      const clips = st.clips.slice(); clips.splice(i + 1, 0, nc);
      const tf = { ...st.tf, [nc.id]: { ...st.tf[src.id] } };
      return { clips, tf };
    });
    toast('Duplicated clip');
  };

  const move = (dir) => {
    const s = stateRef.current;
    const sel = s.sel; if (sel?.type !== 'clip') return;
    if (s.ir) {
      const c = viewOf(s).clips.find((x) => x.id === sel.id); if (!c) return;
      const j = c.sceneIx + dir;
      if (j < 0 || j >= s.ir.scenes.length) return;
      mutateIr('', (ir) => {
        const [x] = ir.scenes.splice(c.sceneIx, 1);
        ir.scenes.splice(j, 0, x);
      });
      setState({ sel: { type: 'clip', id: 'sc' + j } });
      return;
    }
    setState((st) => {
      const i = st.clips.findIndex((c) => c.id === sel.id); const j = i + dir;
      if (i < 0 || j < 0 || j >= st.clips.length) return null;
      const clips = st.clips.slice(); const [x] = clips.splice(i, 1); clips.splice(j, 0, x);
      return { clips };
    });
  };

  const swap = () => {
    const s = stateRef.current;
    const sel = s.sel; if (sel?.type !== 'clip') return;
    if (s.ir) {
      const c = viewOf(s).clips.find((x) => x.id === sel.id); if (!c) return;
      let flipped = null;
      mutateIr('', (ir) => {
        const l = ir.scenes[c.sceneIx]?.layers?.find((x) => x.type === 'video' || x.type === 'image');
        if (!l) return false;
        l.fit = l.fit === 'cover' ? 'contain' : 'cover';
        flipped = l.fit;
      });
      toast(flipped ? 'Framing set to “' + flipped + '”' : 'No footage in this scene to reframe — ask the Director for a different visual');
      return;
    }
    setState((st) => ({ clips: st.clips.map((c) => {
      if (c.id !== sel.id) return c;
      const ix = (c.srcIx + 1) % c.alts.length;
      return { ...c, srcIx: ix, label: c.alts[ix] };
    }) }));
    toast('Replaced shot');
  };

  /* ---- Replace footage: stock search + upload/URL ingest (IR projects) ---- */
  const setReplace = useCallback((patch) => {
    setState((s) => ({ replace: { ...s.replace, ...(typeof patch === 'function' ? patch(s.replace) : patch) } }));
  }, [setState]);

  const openReplace = () => {
    const s = stateRef.current;
    if (!s.ir) { toast('Replacing footage needs a real project — open one from Home'); return; }
    if (s.sel?.type !== 'clip' && s.sel?.type !== 'text') { toast('Select a scene or layer to replace'); return; }
    // Pre-fill the search with what this scene is about, and search it right away.
    const v = viewOf(s);
    const ref = selRefOf(s.ir, v, s.sel);
    const sceneIx = ref?.sceneIx ?? v.clips.find((x) => x.id === s.sel.id)?.sceneIx;
    const q = sceneQuery(s.ir.scenes[sceneIx]);
    setReplace({ open: true, tab: 'search', err: '', q, results: [] });
    if (q) runStockSearch(q);
  };
  const closeReplace = () => setReplace({ open: false, busy: false });

  const runStockSearch = async (query) => {
    const s = stateRef.current;
    const q = (query ?? s.replace.q).trim();
    if (!q) return;
    setReplace({ loading: true, err: '', results: [] });
    try {
      const results = await searchStock(s.projId, q);
      setReplace({ loading: false, results });
      if (!results.length) setReplace({ err: 'No clips found. Try different words — or add PEXELS_API_KEY / PIXABAY_API_KEY to the server .env.' });
    } catch (e) {
      setReplace({ loading: false, err: e.message || String(e) });
    }
  };

  // Replace WHATEVER layer is selected with the new footage — the selected
  // scene's visual (video, image, graphic, solid, lottie…), a selected caption,
  // whatever `selRefOf` resolves to. The layer is rebuilt as a clean video/image
  // in place (keeping its manual framing/crop) so no stale fields carry over.
  // Scene timing, narration and other layers are untouched. Falls back to the
  // selected scene's primary visual — or adds a layer — when there's no ref.
  const applyReplacementSrc = (src, trim) => {
    const s = stateRef.current;
    const v = viewOf(s);
    const ref = selRefOf(s.ir, v, s.sel);
    // Resolve the target scene synchronously (the mutateIr updater runs later, so
    // we can't rely on a flag it sets — validate up front instead).
    const sceneIx = ref ? ref.sceneIx : v.clips.find((x) => x.id === s.sel?.id)?.sceneIx;
    if (sceneIx == null || !s.ir.scenes[sceneIx]) return false;
    mutateIr('', (ir) => {
      const layers = ir.scenes[sceneIx]?.layers;
      if (!layers) return false;
      if (ref && layers[ref.layerIx]) { layers[ref.layerIx] = footageLayer(src, layers[ref.layerIx], trim); return; }
      const vi = layers.findIndex((x) => x.type === 'video' || x.type === 'image');
      if (vi >= 0) layers[vi] = footageLayer(src, layers[vi], trim);
      else layers.unshift(footageLayer(src, null, trim));
    });
    return true;
  };

  // Run an ingest promise (→ { src }), apply it, and close the panel.
  const ingestAndApply = async (promise, label) => {
    const s = stateRef.current;
    setReplace({ busy: true, err: '' });
    try {
      const { src } = await promise;
      if (!applyReplacementSrc(src)) throw new Error('Could not apply to the selected scene');
      chatNote(s.projId, `Replaced the selected scene's footage (${label}).`);
      toast('Footage replaced — Re-render to see it in the video');
      setReplace({ busy: false, open: false, url: '' });
    } catch (e) {
      setReplace({ busy: false, err: e.message || String(e) });
    }
  };

  // Stock / URL picks preview first (choose how much to use); upload applies now.
  const chooseStock = (item) => openPreview(item, 'replace');
  const chooseUrl = () => {
    const url = stateRef.current.replace.url.trim();
    if (!url) { setReplace({ err: 'Paste a direct video or image URL' }); return; }
    openPreview({ download: url, provider: 'link', credit: url.split('/').pop() || 'URL' }, 'replace');
  };
  const chooseUpload = (file) => { if (file) ingestAndApply(uploadAsset(stateRef.current.projId, file), file.name); };

  /* ---- Preview & trim: play a clip, pick how much of it to use ---- */
  const setPreview = useCallback((patch) => {
    setState((s) => ({ preview: { ...s.preview, ...(typeof patch === 'function' ? patch(s.preview) : patch) } }));
  }, [setState]);

  // The duration_s of the scene a preview would replace (the trim window width).
  const targetSceneDur = (target) => {
    const s = stateRef.current;
    if (!s.ir) return 0;
    const v = viewOf(s);
    let sceneIx;
    if (target === 'media') sceneIx = currentClipAt(v.clips, tlTimeOf(s))?.sceneIx;
    else { const ref = selRefOf(s.ir, v, s.sel); sceneIx = ref?.sceneIx ?? v.clips.find((x) => x.id === s.sel?.id)?.sceneIx; }
    return s.ir.scenes[sceneIx]?.duration_s || 0;
  };

  // target: 'replace' (selected layer) | 'media' (scene at the playhead).
  const openPreview = (item, target) => {
    if (!stateRef.current.ir) { toast('Open a real project first'); return; }
    setPreview({ open: true, item, target, sceneDur: targetSceneDur(target), dur: 0, inS: 0, outS: 0, busy: false, err: '' });
  };
  const closePreview = () => setPreview({ open: false, busy: false });

  const confirmPreview = async () => {
    const s = stateRef.current;
    const { item, target, inS, outS, dur } = s.preview;
    if (!item) return;
    setPreview({ busy: true, err: '' });
    // Only write a trim when the user actually narrowed the range.
    const narrowed = dur > 0 && (inS > 0.05 || outS < dur - 0.05);
    const trim = narrowed ? { start: +inS.toFixed(2), end: +outS.toFixed(2) } : { start: 0, end: null };
    try {
      const { src } = await fetchAsset(s.projId, item.download);
      const applied = target === 'media' ? replaceCurrentFootage(src, trim) : applyReplacementSrc(src, trim);
      if (!applied) throw new Error('Could not apply the footage to this scene');
      const amt = narrowed ? ` — using ${(outS - inS).toFixed(1)}s` : '';
      chatNote(s.projId, `Replaced footage with ${item.provider} · ${item.credit}${amt}.`);
      toast('Footage replaced' + amt + ' — Re-render to see it in the video');
      setPreview({ open: false, busy: false });
      setReplace({ open: false });
    } catch (e) {
      setPreview({ busy: false, err: e.message || String(e) });
    }
  };

  /* ---- Media tab: live stock search + upload → add real footage scenes ---- */
  const setMedia = useCallback((patch) => {
    setState((s) => ({ media: { ...s.media, ...(typeof patch === 'function' ? patch(s.media) : patch) } }));
  }, [setState]);

  const runMediaSearch = async (query) => {
    const s = stateRef.current;
    const q = (query ?? s.media.q).trim();
    if (!q) return;
    setMedia({ loading: true, err: '', results: [] });
    try {
      const results = await searchStock(s.projId, q);
      setMedia({ loading: false, results });
      if (!results.length) setMedia({ err: 'No clips found. Try different words — or check the stock API keys in server .env.' });
    } catch (e) {
      setMedia({ loading: false, err: e.message || String(e) });
    }
  };

  // Open the Media tab; if its box is empty, seed it from the current scene.
  const openMediaTab = () => {
    const s = stateRef.current;
    setState({ leftTab: 'media' });
    if (s.ir && !s.media.q.trim()) {
      const c = currentClipAt(viewOf(s).clips, tlTimeOf(s));
      const q = sceneQuery(s.ir.scenes[c?.sceneIx]);
      if (q) { setMedia({ q }); runMediaSearch(q); }
    }
  };

  // Replace the footage of the scene under the playhead — whatever's on screen
  // right now — with `src`. Keeps that scene's timing, narration and framing.
  const replaceCurrentFootage = (src, trim) => {
    const s = stateRef.current;
    const cur = currentClipAt(viewOf(s).clips, tlTimeOf(s));
    if (!cur || cur.sceneIx == null || !s.ir.scenes[cur.sceneIx]) return false;
    mutateIr('', (ir) => {
      const layers = ir.scenes[cur.sceneIx]?.layers;
      if (!layers) return false;
      const vi = primaryVisualIx(ir.scenes[cur.sceneIx]);
      if (vi >= 0) layers[vi] = footageLayer(src, layers[vi], trim);
      else layers.unshift(footageLayer(src, null, trim));
    });
    setState({ sel: { type: 'clip', id: cur.id }, rightTab: 'inspect' });
    return true;
  };

  const addFootage = async (promise, label) => {
    const s = stateRef.current;
    if (!s.ir) { toast('Open a real project to replace footage'); return; }
    setMedia({ busy: true, err: '' });
    try {
      const { src } = await promise;
      if (!replaceCurrentFootage(src)) throw new Error('No scene at the playhead to replace');
      chatNote(s.projId, `Replaced the current shot with ${label} footage.`);
      toast('Replaced the current shot — Re-render to see it in the video');
      setMedia({ busy: false });
    } catch (e) {
      setMedia({ busy: false, err: e.message || String(e) });
    }
  };

  const addStock = (item) => openPreview(item, 'media');
  const addUploadMedia = (file) => { if (file) addFootage(uploadAsset(stateRef.current.projId, file), file.name); };

  const del = () => {
    const s = stateRef.current;
    const sel = s.sel;
    if (s.ir) {
      const v = viewOf(s);
      if (sel?.type === 'clip') {
        if (s.ir.scenes.length <= 1) { toast('Keep at least one scene'); return; }
        const c = v.clips.find((x) => x.id === sel.id); if (!c) return;
        mutateIr('', (ir) => { ir.scenes.splice(c.sceneIx, 1); });
        setState({ sel: { type: 'clip', id: 'sc0' } });
      } else if (sel?.type === 'text') {
        const t = v.texts.find((x) => x.id === sel.id); if (!t) return;
        mutateIr('', (ir) => {
          const layers = ir.scenes[t.sceneIx]?.layers;
          if (!layers) return false;
          layers.splice(t.layerIx, 1);
        });
        setState({ sel: null });
      } else if (sel?.type === 'audio') {
        toast('Audio tracks can’t be removed — set volume to 0');
        return;
      }
      toast('Deleted layer');
      return;
    }
    if (sel.type === 'clip') {
      if (s.clips.length <= 1) { toast('Keep at least one clip'); return; }
      setState((st) => ({ clips: st.clips.filter((c) => c.id !== sel.id), sel: { type: 'clip', id: st.clips.find((c) => c.id !== sel.id).id } }));
    } else if (sel.type === 'text') {
      setState((st) => ({ texts: st.texts.filter((t) => t.id !== sel.id), sel: null }));
    } else if (sel.type === 'audio') {
      toast('Audio tracks can’t be removed — set volume to 0');
      return;
    }
    toast('Deleted layer');
  };
  delRef.current = del;

  // Keyboard: ctrl/⌘+Z undo, ctrl/⌘+shift+Z (or ctrl+Y) redo, Delete removes the
  // selected layer. All skip when a text field (search, chat, captions…) or the
  // Replace modal has focus, so native text editing / undo works there.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && !inField) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); (e.shiftKey ? redoRef : undoRef).current?.(); return; }
        if (k === 'y') { e.preventDefault(); redoRef.current?.(); return; }
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (inField) return;
      const s = stateRef.current;
      if (s.replace.open || s.preview.open || !s.sel) return;
      e.preventDefault();
      delRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addClip = (item) => {
    const s = stateRef.current;
    if (s.ir) {
      const v = viewOf(s);
      const cur = currentClipAt(v.clips, tlTimeOf(s));
      const at = (cur?.sceneIx ?? v.clips.length - 1) + 1;
      const color = (item.grad.match(/#[0-9a-fA-F]{3,8}/g) || ['#141419']).pop();
      mutateIr('', (ir) => {
        if (ir.scenes.length >= 60) return false;
        ir.scenes.splice(at, 0, {
          scene: 0, start_frame: 0, duration_frames: 0, duration_s: 3, narration: '',
          layers: [
            { type: 'solid', color },
            { type: 'text', content: item.label, position: 'center', enter: { anim: 'fade_up', at_s: 0.2 }, exit: { anim: 'fade', at_s: 2.6 } },
          ],
          transition_out: { type: 'crossfade', duration_s: 0.4 },
        });
      });
      setState({ sel: { type: 'clip', id: 'sc' + at }, rightTab: 'inspect' });
      toast('Added a “' + item.label + '” card — Re-render to see it in the video');
      return;
    }
    const nc = { id: uid('m'), scene: item.scene, label: item.label, alts: [item.label], srcIx: 0, src: item.src, dur: 3.0, grad: item.grad };
    setState((st) => ({ clips: st.clips.concat([nc]), tf: { ...st.tf, [nc.id]: { scale: 100, x: 0, y: 0, rot: 0, op: 100 } }, sel: { type: 'clip', id: nc.id }, rightTab: 'inspect' }));
    toast('Added “' + item.label + '” to the timeline');
  };

  const addText = () => {
    const s = stateRef.current;
    if (s.ir) {
      const v = viewOf(s);
      const t = tlTimeOf(s);
      const cur = currentClipAt(v.clips, t);
      if (!cur) return;
      const sceneStart = startsOf(v.clips)[cur.id] || 0;
      const si = cur.sceneIx;
      const li = s.ir.scenes[si].layers.length;
      const rel = Math.max(0, Math.min(t - sceneStart, cur.dur - 1));
      mutateIr('', (ir) => {
        const sc = ir.scenes[si];
        if (!sc || sc.layers.length >= 12) return false;
        sc.layers.push({
          type: 'text', content: 'New caption', position: 'center',
          enter: { anim: 'fade_up', at_s: +rel.toFixed(2) },
          exit: { anim: 'fade', at_s: +Math.min(cur.dur - 0.3, rel + 3).toFixed(2) },
        });
      });
      setState({ sel: { type: 'text', id: `ly${si}_${li}` }, rightTab: 'inspect' });
      toast('Added a text layer to scene ' + (si + 1));
      return;
    }
    setState((st) => {
      const nt = { id: uid('t'), content: 'New caption', start: Math.min(st.time, totalOf(st.clips) - 2), dur: 3, size: 38, ax: 0, ay: 0 };
      return { texts: st.texts.concat([nt]), tf: { ...st.tf, [nt.id]: { scale: 100, x: 0, y: 0, rot: 0, op: 100 } }, sel: { type: 'text', id: nt.id }, rightTab: 'inspect' };
    });
    toast('Added a text layer');
  };

  /* ---- annotations / comments ---- */
  const stageXY = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      +(((e.clientX - r.left) / r.width) * 100).toFixed(2),
      +(((e.clientY - r.top) / r.height) * 100).toFixed(2),
    ];
  };

  const pinComment = (e) => {
    const s = stateRef.current;
    const [x, y] = stageXY(e);
    const t = tlTimeOf(s);
    const v = viewOf(s);
    const cur = currentClipAt(v.clips, t);
    // Name (and select) the component under the pin, not just the scene.
    const hit = s.ir && cur ? regionAt(stageRegions(s.ir, cur.sceneIx, t - (startsOf(v.clips)[cur.id] || 0)), x, y) : null;
    const target = hit?.label || cur?.label || 'this frame';
    const num = s.annotations.filter((a) => a.kind !== 'ink').length + 1;
    const anno = { id: uid('an'), x, y, num, t };
    const cm = { id: uid('cm'), kind: 'pin', ref: num, annoId: anno.id, t, at: fmt(t) + ' · ' + target, author: 'You', text: 'Pinned note on ' + target + '.' };
    setState((st) => ({ annotations: st.annotations.concat([anno]), comments: st.comments.concat([cm]), rightTab: 'comments', tool: 'select', ...(hit ? { sel: hit.sel } : {}) }));
    toast('Pinned comment #' + num + ' on ' + target);
  };

  const stageDown = (e) => {
    const s = stateRef.current;
    if (s.tool === 'comment') { pinComment(e); return; }
    if (s.tool !== 'draw') return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    drawing.current = true;
    setState({ inkLive: [stageXY(e)] });
  };

  const stageMove = (e) => {
    if (!drawing.current) return;
    const pt = stageXY(e);
    setState((s) => {
      if (!s.inkLive) return null;
      const last = s.inkLive[s.inkLive.length - 1];
      if (Math.abs(pt[0] - last[0]) < 0.4 && Math.abs(pt[1] - last[1]) < 0.4) return null;
      return { inkLive: s.inkLive.concat([pt]) };
    });
  };

  const stageUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setState((s) => {
      if (!s.inkLive) return null;
      const patch = { inkLive: null };
      if (s.inkLive.length > 1) {
        patch.annotations = s.annotations.concat([{ id: uid('ink'), kind: 'ink', pts: s.inkLive, t: tlTimeOf(s) }]);
      }
      return patch;
    });
  };

  const clearInk = () => {
    setState((s) => ({ annotations: s.annotations.filter((a) => a.kind !== 'ink') }));
    toast('Cleared drawings');
  };

  const addComment = () => {
    const s = stateRef.current;
    const text = s.commentInput.trim(); if (!text) return;
    const v = viewOf(s);
    const L = getLayerIn(v, s.sel);
    const t = tlTimeOf(s);
    const at = s.sel ? (fmt(t) + ' · ' + (L ? (L.label || L.content) : 'clip')) : 'General';
    setState((st) => ({ comments: st.comments.concat([{ id: uid('cm'), kind: 'note', ref: '·', t, at, author: 'You', text }]), commentInput: '' }));
  };

  const resolveComment = (id) =>
    setState((s) => {
      const cm = s.comments.find((c) => c.id === id);
      return {
        comments: s.comments.filter((c) => c.id !== id),
        annotations: cm?.annoId ? s.annotations.filter((a) => a.id !== cm.annoId) : s.annotations,
      };
    });

  /* ============ computed render values (mirrors renderVals) ============ */
  const S = state;
  const V = S.ir ? deriveView(S.ir) : null;
  const clips = V ? V.clips : S.clips;
  const texts = V ? V.texts : S.texts;
  const audio = V ? V.audio : S.audio;
  const tlTime = tlTimeOf(S);
  const total = V ? V.total : totalOf(clips);
  const starts = startsOf(clips);
  const cur = currentClipAt(clips, tlTime);
  const sel = S.sel;
  const L = getLayerIn({ clips, texts, audio }, sel);
  const selRef = S.ir ? selRefOf(S.ir, { clips, texts, audio }, sel) : null;

  // Real-video transport (when a rendered project is loaded into the stage).
  const realVideo = !!S.videoUrl;
  const transTime = realVideo ? S.vTime : S.time;
  const transTotal = realVideo ? (S.vDur || total) : total;

  const tab = (on) => 'cursor:pointer;flex:1;padding:8px 6px;border-radius:8px;font-size:12px;font-weight:600;border:none;transition:background .15s,color .15s;' + (on ? 'background:rgba(255,255,255,0.07);color:#F4F3F0' : 'background:none;color:rgba(244,243,240,0.5)');

  const rowStyle = (on) => 'cursor:pointer;width:100%;display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:9px;text-align:left;transition:background .12s;' + (on ? 'background:color-mix(in oklab, var(--accent) 15%, transparent);border:1px solid color-mix(in oklab, var(--accent) 45%, transparent)' : 'background:transparent;border:1px solid transparent');

  const layerRows = [];
  clips.forEach((c) => {
    const on = sel && sel.type === 'clip' && sel.id === c.id;
    layerRows.push({ key: c.id, label: c.label, sub: c.scene + ' · ' + c.src, len: c.dur.toFixed(1) + 's',
      select: () => selectLayer('clip', c.id),
      dotStyle: 'width:8px;height:22px;border-radius:3px;flex:none;background:' + c.grad, style: rowStyle(on) });
  });
  texts.forEach((t) => {
    const on = sel && sel.type === 'text' && sel.id === t.id;
    layerRows.push({ key: t.id, label: t.kind === 'text' || !t.kind ? '“' + t.content + '”' : t.content, sub: (t.kind ? t.kind.toUpperCase() : 'TEXT') + ' · ' + fmt(t.start), len: t.dur.toFixed(1) + 's',
      select: () => selectLayer('text', t.id),
      dotStyle: 'width:8px;height:22px;border-radius:3px;flex:none;background:rgba(244,243,240,0.55)', style: rowStyle(on) });
  });
  audio.forEach((a) => {
    const on = sel && sel.type === 'audio' && sel.id === a.id;
    layerRows.push({ key: a.id, label: a.label, sub: (a.kind === 'music' ? 'MUSIC' : 'VOICEOVER') + ' · ' + a.vol + '%', len: '',
      select: () => selectLayer('audio', a.id),
      dotStyle: 'width:8px;height:22px;border-radius:3px;flex:none;background:' + (a.kind === 'music' ? '#5B7CFF' : '#00C2A8'), style: rowStyle(on) });
  });

  const mk = (label, scene, src, grad) => ({ label, add: () => addClip({ label, scene, src, grad }), bg: grad });
  const mediaGroups = [
    { label: 'YOUR UPLOADS', items: [
      mk('Dashboard 4K', 'PRODUCT', 'Yours', 'linear-gradient(135deg,#0f2540,#2563eb)'),
      mk('Team standup', 'PROOF', 'Yours', 'linear-gradient(135deg,#241a3a,#7c3aed)')] },
    { label: 'STOCK LIBRARY', items: [
      mk('City at dusk', 'HOOK', 'Stock', 'linear-gradient(135deg,#3a2416,#c2410c)'),
      mk('Coffee pour', 'HOOK', 'Stock', 'linear-gradient(135deg,#2a1c12,#a16207)'),
      mk('Runner, night', 'HOOK', 'Stock', 'linear-gradient(135deg,#101830,#1e3a8a)'),
      mk('Forest aerial', 'HOOK', 'Stock', 'linear-gradient(135deg,#0c2f2a,#0d9488)')] },
    { label: 'GENERATE', items: [
      mk('✦ Abstract loop', 'HOOK', 'AI', 'linear-gradient(135deg,#2a1a2f,#db2777)'),
      mk('✦ Logo reveal', 'CTA', 'AI', 'linear-gradient(135deg,#111117,#3730a3)')] },
  ];

  const ctf = S.ir
    ? uiTf(S.ir.scenes[cur?.sceneIx]?.layers?.[primaryVisualIx(S.ir.scenes[cur?.sceneIx])])
    : (S.tf[cur.id] || { scale: 100, x: 0, y: 0, rot: 0, op: 100 });
  const footageStyle = 'position:absolute;inset:0;background:' + (cur?.grad || sceneGrad(0)) +
    ';transform-origin:center;transform:translate(' + ctf.x + '%,' + ctf.y + '%) scale(' + (ctf.scale / 100) + ') rotate(' + ctf.rot + 'deg);opacity:' + (ctf.op / 100) +
    ';transition:opacity .12s;display:block';

  // Text overlays are mock-only: the real video has its type baked in.
  const activeTexts = (realVideo || S.ir) ? [] : S.texts.filter((t) => S.time >= t.start && S.time < t.start + t.dur).map((t) => {
    const on = sel && sel.type === 'text' && sel.id === t.id;
    const tf = S.tf[t.id] || { scale: 100, x: 0, y: 0, rot: 0, op: 100 };
    return { key: t.id, content: t.content, select: () => selectLayer('text', t.id),
      style: 'position:absolute;left:50%;top:50%;z-index:12;cursor:pointer;max-width:80%;text-align:center;font-family:Schibsted Grotesk,sans-serif;font-weight:800;letter-spacing:-0.02em;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,0.5);pointer-events:auto;font-size:' + Math.round(t.size * tf.scale / 100) + 'px;opacity:' + (tf.op / 100) +
        ';transform:translate(-50%,-50%) translate(' + (tf.x) + '%,' + (tf.y * 3) + '%) rotate(' + tf.rot + 'deg);' + (on ? 'outline:1.5px dashed var(--accent);outline-offset:6px;border-radius:2px' : '') };
  });

  // On-video component picking: hit regions for whatever the IR says is on
  // screen right now, plus a highlight box when one of them is selected.
  const regions = S.ir && cur ? stageRegions(S.ir, cur.sceneIx, tlTime - (starts[cur.id] || 0)) : [];
  const selRegion = (S.ir && sel && sel.type === 'text')
    ? regions.find((r) => r.sel.type === sel.type && r.sel.id === sel.id) || null
    : null;

  let hasSelBox = false, selBoxStyle = '', selBoxLabel = '';
  if (sel && sel.type === 'clip' && cur) {
    hasSelBox = true; selBoxLabel = cur.label;
    selBoxStyle = 'position:absolute;z-index:14;pointer-events:none;border:1.5px solid var(--accent);inset:5%;transform-origin:center;transform:translate(' + ctf.x + '%,' + ctf.y + '%) scale(' + (ctf.scale / 100) + ') rotate(' + ctf.rot + 'deg)';
    if (S.cropOn) selBoxStyle += ';border-style:dashed';
  }

  const pins = S.annotations.filter((a) => a.kind !== 'ink').map((a) => ({ key: a.id, num: a.num,
    open: () => { setState({ rightTab: 'comments' }); if (a.t != null) seekTo(a.t); },
    style: 'position:absolute;z-index:16;cursor:pointer;width:24px;height:24px;border-radius:50% 50% 50% 2px;background:var(--accent);color:#0B0B0E;font-family:JetBrains Mono,monospace;font-size:11px;font-weight:600;border:2px solid #0B0B0E;box-shadow:0 3px 10px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;transform:translate(-4px,-20px);left:' + a.x + '%;top:' + a.y + '%' }));

  const inkStrokes = S.annotations.filter((a) => a.kind === 'ink');

  const catcherStyle = 'position:absolute;inset:0;z-index:13;touch-action:none;' + (S.tool !== 'select' ? 'cursor:crosshair;pointer-events:auto' : 'pointer-events:none');

  const toolDefs = [
    { id: 'select', name: 'Select', svg: 'M3 3l7 17 2-7 7-2z' },
    { id: 'comment', name: 'Pin comment', svg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
    { id: 'draw', name: 'Draw', svg: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-1.5M2 22l3-1 12-12-2-2L3 19z' },
  ];
  const tools = toolDefs.map((t) => {
    const on = S.tool === t.id;
    const maskSvg = "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27" + t.svg + "%27/%3E%3C/svg%3E\") center/contain no-repeat";
    return { key: t.id, name: t.name, pick: () => setState({ tool: on && t.id !== 'select' ? 'select' : t.id }),
      style: 'cursor:pointer;width:30px;height:30px;border-radius:8px;border:none;display:flex;align-items:center;justify-content:center;transition:background .15s;' + (on ? 'background:var(--accent)' : 'background:transparent'),
      iconWrap: 'display:block;width:15px;height:15px;-webkit-mask:' + maskSvg + ';mask:' + maskSvg + ';background:' + (on ? '#0B0B0E' : 'rgba(244,243,240,0.7)') };
  });

  const trackW = (d) => (d / total * 100);
  let acc2 = 0;
  const clipBlocks = clips.map((c) => {
    const on = sel && sel.type === 'clip' && sel.id === c.id;
    const left = acc2 / total * 100; acc2 += c.dur;
    return { key: c.id, label: c.label, showWave: false, select: () => selectLayer('clip', c.id),
      style: 'position:absolute;top:3px;bottom:3px;border-radius:6px;background:' + c.grad + ';cursor:pointer;overflow:hidden;display:flex;align-items:center;color:#fff;transition:box-shadow .15s;left:calc(' + left + '% + 1px);width:calc(' + trackW(c.dur) + '% - 2px);border:1.5px solid ' + (on ? 'var(--accent)' : 'rgba(255,255,255,0.12)') + ';box-shadow:' + (on ? '0 0 0 2px color-mix(in oklab, var(--accent) 40%, transparent)' : 'none') };
  });
  const textBlocks = texts.map((t) => {
    const on = sel && sel.type === 'text' && sel.id === t.id;
    return { key: t.id, label: t.content, showWave: false, select: () => selectLayer('text', t.id),
      style: 'position:absolute;top:3px;bottom:3px;border-radius:6px;background:rgba(244,243,240,0.14);cursor:pointer;overflow:hidden;display:flex;align-items:center;color:rgba(244,243,240,0.92);transition:box-shadow .15s;left:calc(' + (t.start / total * 100) + '% + 1px);width:calc(' + trackW(t.dur) + '% - 2px);border:1.5px solid ' + (on ? 'var(--accent)' : 'rgba(255,255,255,0.14)') };
  });
  const audioBlocks = audio.map((a) => {
    const on = sel && sel.type === 'audio' && sel.id === a.id;
    const isMusic = a.kind === 'music';
    const left = isMusic ? 0 : (a.start / total * 100);
    const w = isMusic ? 100 : trackW(a.dur);
    const col = isMusic ? '#5B7CFF' : '#00C2A8';
    return { key: a.id, label: a.label, showWave: true, select: () => selectLayer('audio', a.id),
      waveStyle: 'position:absolute;inset:0;opacity:0.4;pointer-events:none;background:repeating-linear-gradient(90deg, transparent 0 3px, ' + col + ' 3px 4px)',
      style: 'position:absolute;top:3px;bottom:3px;border-radius:6px;background:color-mix(in oklab, ' + col + ' 22%, #141419);cursor:pointer;overflow:hidden;display:flex;align-items:center;color:#fff;transition:box-shadow .15s;left:calc(' + left + '% + 1px);width:calc(' + w + '% - 2px);border:1.5px solid ' + (on ? 'var(--accent)' : 'color-mix(in oklab, ' + col + ' 50%, transparent)') };
  });
  const tracks = [
    { key: 'vid', name: 'VID', h: '44px', iconStyle: 'width:8px;height:8px;border-radius:2px;background:rgba(244,243,240,0.4)', blocks: clipBlocks },
    { key: 'txt', name: 'TXT', h: '30px', iconStyle: 'width:8px;height:8px;border-radius:2px;background:rgba(244,243,240,0.4)', blocks: textBlocks },
    { key: 'aud', name: 'AUD', h: '30px', iconStyle: 'width:8px;height:8px;border-radius:2px;background:rgba(244,243,240,0.4)', blocks: audioBlocks },
  ];
  const ticks = [];
  for (let s = 0; s <= Math.ceil(total); s += 3) {
    ticks.push({ key: s, label: fmt(s), style: 'position:absolute;top:0;font-family:JetBrains Mono,monospace;font-size:8.5px;color:rgba(244,243,240,0.35);transform:translateX(-1px);left:' + (s / total * 100) + '%' });
  }
  const playheadStyle = 'position:absolute;top:0;bottom:0;width:1.5px;background:var(--accent);z-index:8;pointer-events:none;left:calc(52px + (100% - 52px) * ' + Math.min(1, total ? tlTime / total : 0) + ')';

  const isClip = sel && sel.type === 'clip';
  const ctBtn = (label, title, run, enabled) => ({ label, title, run: enabled ? run : () => toast('Select a clip first'),
    style: 'cursor:' + (enabled ? 'pointer' : 'default') + ';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:7px;padding:5px 10px;font-size:11px;color:' + (enabled ? 'rgba(244,243,240,0.85)' : 'rgba(244,243,240,0.3)') + ';transition:border-color .15s' });
  const clipTools = [
    { key: 'split', ...ctBtn('✂ Split', 'Split clip at playhead', () => split(), isClip) },
    { key: 'dup', ...ctBtn('⧉ Duplicate', 'Duplicate clip', () => duplicate(), isClip) },
    { key: 'ml', ...ctBtn('← Move', 'Move earlier', () => move(-1), isClip) },
    { key: 'mr', ...ctBtn('Move →', 'Move later', () => move(1), isClip) },
    { key: 'text', label: '＋ Text', title: 'Add text layer', run: () => addText(), style: 'cursor:pointer;background:color-mix(in oklab, var(--accent) 14%, transparent);border:1px solid color-mix(in oklab, var(--accent) 45%, transparent);border-radius:7px;padding:5px 10px;font-size:11px;color:var(--accent);transition:filter .15s' },
  ];

  /* ---- inspector ---- */
  const nothingSelected = !L, somethingSelected = !!L;
  let insp = null;
  if (L) {
    const isClipL = sel.type === 'clip', isTextL = sel.type === 'text', isAudioL = sel.type === 'audio';
    const tf = S.ir
      ? uiTf(selRef ? S.ir.scenes[selRef.sceneIx]?.layers?.[selRef.layerIx] : null)
      : (S.tf[sel.id] || { scale: 100, x: 0, y: 0, rot: 0, op: 100 });
    const trRow = (key, label, prop, min, max, step, readout) => ({ key, label, min, max, step, value: tf[prop], readout, set: (e) => setTf(sel.id, prop, e.target.value) });
    const realKind = isClipL ? ('SCENE ' + ((L.sceneIx ?? 0) + 1))
      : isTextL ? (L.kind === 'captions' ? 'CAPTIONS' : L.kind === 'graphic' ? 'GRAPHIC · ' + (L.gkind || '').replace('_', ' ').toUpperCase() : 'TEXT LAYER')
        : (L.kind === 'music' ? 'AUDIO · MUSIC' : 'AUDIO · VOICEOVER');
    insp = {
      inspKind: S.ir ? realKind : (isClipL ? ('CLIP · ' + L.scene) : (isTextL ? 'TEXT LAYER' : (L.kind === 'music' ? 'AUDIO · MUSIC' : 'AUDIO · VOICEOVER'))),
      inspTitle: isClipL ? L.label : (isTextL ? '“' + L.content + '”' : L.label),
      inspTiming: isClipL ? (fmt(starts[L.id] || 0) + ' · ' + L.dur.toFixed(1) + 's') : (isTextL ? (fmt(L.start) + ' · ' + L.dur.toFixed(1) + 's') : (isAudioL && L.kind === 'vo' ? fmt(L.start) + '–' + fmt(L.start + L.dur) : 'full')),
      inspIsClip: isClipL, inspIsText: isTextL, inspIsAudio: isAudioL,
      inspHasTransform: (isClipL || isTextL) && (!S.ir || !!selRef || isTextL),
      inspHasTrim: isClipL || isTextL,
      inspEditable: !S.ir || L.editable !== false,
      inspTextValue: isTextL ? (S.ir ? (L.editText || '') : L.content) : '',
      setTextContent: (e) => {
        const v = e.target.value;
        const s = stateRef.current;
        if (s.ir) {
          const it = viewOf(s).texts.find((x) => x.id === sel.id); if (!it) return;
          mutateIr('txt:' + sel.id, (ir) => {
            const l = ir.scenes[it.sceneIx]?.layers?.[it.layerIx];
            if (!l) return false;
            if (l.type === 'text') l.content = v;
            else if (l.type === 'graphic') {
              const p = { ...(l.params || {}) };
              if (p.title !== undefined) p.title = v; else p.label = v;
              l.params = p;
            } else return false;
          });
          return;
        }
        setState((st) => ({ texts: st.texts.map((t) => t.id === sel.id ? { ...t, content: v } : t) }));
      },
      transformRows: (isClipL || isTextL) ? [
        trRow('scale', 'Scale', 'scale', 40, 200, 1, tf.scale + '%'),
        trRow('x', 'Position X', 'x', -50, 50, 1, tf.x + ''),
        trRow('y', 'Position Y', 'y', -50, 50, 1, tf.y + ''),
        trRow('rot', 'Rotate', 'rot', -45, 45, 1, tf.rot + '°'),
        trRow('op', 'Opacity', 'op', 0, 100, 1, tf.op + '%'),
      ] : [],
      cropStyle: 'flex:1;cursor:pointer;border-radius:9px;padding:8px;font-size:12px;transition:border-color .15s;' + (S.cropOn ? 'background:color-mix(in oklab, var(--accent) 16%, transparent);border:1px solid var(--accent);color:var(--accent)' : 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(244,243,240,0.7)'),
      cropToggle: () => setState((s) => ({ cropOn: !s.cropOn })),
      resetTransform: () => {
        const s = stateRef.current;
        if (s.ir) {
          const ref = selRefOf(s.ir, viewOf(s), s.sel);
          if (ref) mutateIr('', (ir) => { const l = ir.scenes[ref.sceneIx]?.layers?.[ref.layerIx]; if (!l) return false; delete l.transform; });
          setState({ cropOn: false });
        } else {
          setState((st) => ({ tf: { ...st.tf, [sel.id]: { scale: 100, x: 0, y: 0, rot: 0, op: 100 } }, cropOn: false }));
        }
        toast('Transform reset');
      },
      trimStart: () => trim('in'), trimEnd: () => trim('out'),
      splitClip: () => split(), duplicateClip: () => duplicate(),
      swapClip: () => swap(),
      clipSource: isClipL ? (S.ir ? 'fit' : L.src) : '',
      moveLeft: () => move(-1), moveRight: () => move(1),
      // Per-clip audio: only video clips carry their own sound (muted by default).
      clipHasAudio: isClipL && S.ir && !!L.hasAudio,
      clipVol: isClipL ? (L.vol || 0) : 0,
      setClipVol: (e) => {
        const v = +e.target.value;
        const s = stateRef.current;
        const ref = selRefOf(s.ir, viewOf(s), s.sel);
        if (!ref) return;
        mutateIr('vol:clip:' + sel.id, (ir) => {
          const l = ir.scenes[ref.sceneIx]?.layers?.[ref.layerIx];
          if (!l || l.type !== 'video') return false;
          l.volume = v / 100;
        });
      },
      audioVol: isAudioL ? L.vol : 0, audioVolValue: isAudioL ? L.vol : 0,
      setVol: (e) => {
        const v = +e.target.value;
        const s = stateRef.current;
        if (s.ir) {
          if (sel.id === 'music') {
            mutateIr('vol:music', (ir) => { if (!ir.metadata.music) return false; ir.metadata.music.volume = v / 100; });
          } else {
            const it = viewOf(s).audio.find((x) => x.id === sel.id); if (!it) return;
            mutateIr('vol:' + sel.id, (ir) => {
              const l = ir.scenes[it.sceneIx]?.layers?.[it.layerIx];
              if (!l || l.type !== 'audio') return false;
              l.volume = v / 100;
            });
          }
          return;
        }
        setState((st) => ({ audio: st.audio.map((a) => a.id === sel.id ? { ...a, vol: v } : a) }));
      },
      audioPickLabel: isAudioL && L.kind === 'music' ? 'TRACK' : 'VOICE',
      audioOptions: isAudioL ? (L.alts || []).map((opt, ix) => ({ key: ix, label: opt, pick: () => { setState((st) => ({ audio: st.audio.map((a) => a.id === sel.id ? { ...a, srcIx: ix, label: opt } : a) })); toast('Set to “' + opt + '”'); },
        style: 'cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:9px;font-size:12.5px;transition:border-color .15s;text-align:left;' + (ix === L.srcIx ? 'background:color-mix(in oklab, var(--accent) 12%, transparent);border:1px solid var(--accent);color:#F4F3F0' : 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);color:rgba(244,243,240,0.8)'),
        dot: 'width:12px;height:12px;border-radius:50%;flex:none;' + (ix === L.srcIx ? 'background:var(--accent)' : 'border:1px solid rgba(255,255,255,0.25)') })) : [],
      deleteLayer: () => del(),
    };
  }

  const chat = S.chat.map((m, i) => {
    const isDir = m.role === 'director';
    return { key: i, isDirector: isDir, text: m.text,
      wrapStyle: isDir ? 'max-width:100%' : 'align-self:flex-end;max-width:88%',
      textStyle: isDir ? 'margin:0;font-size:13.5px;line-height:1.55;color:rgba(244,243,240,0.88)' : 'margin:0;font-size:13.5px;line-height:1.5;background:var(--accent);color:#0B0B0E;padding:10px 13px;border-radius:13px 13px 3px 13px;font-weight:500',
      hasPlan: !!m.plan, plan: m.plan || [],
      planPending: m.planState === 'pending', planApplied: m.planState === 'applied',
      planDiscarded: m.planState === 'discarded',
      devInfo: m.devInfo,
      apply: () => applyPlan(i), discard: () => discardPlan(i) };
  });
  const suggestions = S.ir ? [
    { key: 's1', label: 'Punchier captions', use: () => setState({ input: 'Make the captions bigger and bolder' }) },
    { key: 's2', label: 'Tighten the pace', use: () => setState({ input: 'Tighten the pacing — trim a second off the longest scenes' }) },
    { key: 's3', label: 'Brand the colors', use: () => setState({ input: 'Shift the accent color to a warm orange across the video' }) },
  ] : [
    { key: 's1', label: 'Make it snappier', use: () => setState({ input: 'Make it snappier and cut to the beat' }) },
    { key: 's2', label: 'Add a proof shot', use: () => setState({ input: 'Add another customer proof shot' }) },
    { key: 's3', label: 'Push the brand', use: () => setState({ input: 'Push the brand color and match the type' }) },
  ];
  const selForChat = L ? (sel.type === 'clip' ? L.label : (sel.type === 'text' ? '“' + L.content + '”' : L.label)) : '';

  const comments = S.comments.map((c) => ({ key: c.id,
    badge: c.kind === 'pin' ? String(c.ref) : '❝', author: c.author, at: c.at, text: c.text,
    badgeStyle: 'flex:none;width:24px;height:24px;border-radius:' + (c.kind === 'pin' ? '50% 50% 50% 2px' : '7px') + ';background:' + (c.kind === 'pin' ? 'var(--accent)' : 'rgba(255,255,255,0.08)') + ';color:' + (c.kind === 'pin' ? '#0B0B0E' : 'rgba(244,243,240,0.7)') + ';font-family:JetBrains Mono,monospace;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center',
    wrapStyle: 'cursor:pointer;border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(255,255,255,0.02);padding:12px;transition:border-color .15s',
    jump: () => { if (c.t != null) seekTo(c.t); }, resolve: () => resolveComment(c.id) }));

  const saveLabel = S.rendering
    ? ('rendering ' + S.renderPct + '%' + (S.renderStage ? ' · ' + S.renderStage : ''))
    : ({ unsaved: 'unsaved edits', saving: 'saving…', saved: 'autosaved', error: 'autosave failed' }[S.saveState] || 'autosaved');
  const draftChip = 'Draft ' + S.draft + ' · ' + saveLabel;
  const currentShotLabel = cur ? (cur.scene + ' · ' + cur.label) : '';
  const playIconStyle = S.playing ? 'display:block;width:11px;height:12px;border-left:3.5px solid #fff;border-right:3.5px solid #fff' : 'display:block;width:0;height:0;border-left:12px solid #fff;border-top:7px solid transparent;border-bottom:7px solid transparent;margin-left:3px';
  const sendStyle = 'cursor:pointer;flex:none;width:32px;height:32px;border-radius:9px;border:none;background:var(--accent);color:#0B0B0E;display:flex;align-items:center;justify-content:center';
  const commentTarget = L ? (sel.type === 'text' ? (L.content || 'text layer') : L.label) : 'the project';
  const formatChip = S.ir ? `${S.ir.metadata.width}×${S.ir.metadata.height} · ${S.ir.metadata.fps}fps` : '16:9 · 1920×1080';

  /* ============ render ============ */
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0B0B0E', color: '#F4F3F0', fontFamily: "'Instrument Sans',system-ui,sans-serif" }}>
      <style>{`
        .sqe input[type=range]{-webkit-appearance:none;appearance:none;height:3px;border-radius:99px;background:rgba(255,255,255,0.16);outline:none;accent-color:var(--accent)}
        .sqe input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--accent);cursor:pointer;box-shadow:0 0 0 3px rgba(11,11,14,0.6)}
        .sqe .sq-scroll::-webkit-scrollbar{width:9px;height:9px}
        .sqe .sq-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
        .sqe .sq-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.22);background-clip:padding-box}
        .sqe .sq-focus:focus-within{border-color:color-mix(in oklab, var(--accent) 55%, transparent)!important}
        @keyframes sqpulse{0%,100%{opacity:0.55;transform:scale(1)}50%{opacity:1;transform:scale(1.18)}}
        @keyframes sqblink{0%,100%{opacity:1}50%{opacity:0.25}}
      `}</style>

      {/* atmosphere */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200, opacity: 'var(--vig-o)', background: 'radial-gradient(120% 100% at 50% 30%, transparent 60%, rgba(0,0,0,0.45) 100%)' }} />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 201, opacity: 'var(--grain-o)', backgroundImage: "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/%3E%3C/filter%3E%3Crect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')" }} />

      <div className="sqe" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>

        {/* ============ TOP BAR ============ */}
        <header style={css('flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px;padding:0 18px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(11,11,14,0.9);backdrop-filter:blur(14px);z-index:60')}>
          <div style={css('display:flex;align-items:center;gap:16px;min-width:0')}>
            <span style={css('display:flex;align-items:center;gap:9px')}>
              <span style={css('width:13px;height:13px;background:var(--accent);border-radius:3px;transform:rotate(45deg);display:inline-block')} />
              <span style={css("font-family:'Schibsted Grotesk',sans-serif;font-weight:800;font-size:16px;letter-spacing:-0.02em")}>Squook</span>
            </span>
            <span style={css('width:1px;height:22px;background:rgba(255,255,255,0.1)')} />
            <div style={css('display:flex;flex-direction:column;gap:1px;min-width:0')}>
              <span style={css('font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{S.projTitle || 'Launch film — Northwind PM'}</span>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: S.saveState === 'error' ? 'rgba(255,120,120,0.85)' : 'rgba(244,243,240,0.4)' }}>{draftChip}</span>
            </div>
          </div>
          <div style={css('display:flex;align-items:center;gap:10px')}>
            {S.dev && (
              <Box t="button" onClick={() => { try { localStorage.setItem('sq-dev', '0'); } catch { /* quota */ } setState({ dev: false }); toast('Dev mode off'); }} title="Dev mode on — LLM prompts + IR diffs shown in chat. Click to disable." s="cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:0.12em;color:#5B7CFF;background:rgba(91,124,255,0.12);border:1px solid rgba(91,124,255,0.45);border-radius:6px;padding:4px 8px" sh="background:rgba(91,124,255,0.22)">DEV</Box>
            )}
            <div style={css('display:flex;align-items:center;gap:2px;border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:3px')}>
              <Box t="button" onClick={doUndo} title="Undo" s="cursor:pointer;background:none;border:none;color:rgba(244,243,240,0.65);padding:5px 7px;border-radius:6px;display:flex;transition:background .15s,color .15s" sh="background:rgba(255,255,255,0.06);color:#F4F3F0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
              </Box>
              <Box t="button" onClick={doRedo} title="Redo" s="cursor:pointer;background:none;border:none;color:rgba(244,243,240,0.65);padding:5px 7px;border-radius:6px;display:flex;transition:background .15s,color .15s" sh="background:rgba(255,255,255,0.06);color:#F4F3F0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" /></svg>
              </Box>
            </div>
            <Box t="button" onClick={doSavePreset} title="Save this video's look as a reusable preset" s="cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:8px 12px;font-size:13px;color:rgba(244,243,240,0.85);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">★ Save style</Box>
            <Box t="button" onClick={doRender} s={'cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:8px 14px;font-size:13px;transition:border-color .15s;' + (S.rendering ? 'color:var(--accent)' : 'color:rgba(244,243,240,0.85)')} sh="border-color:rgba(255,255,255,0.3)">{S.rendering ? `Rendering ${S.renderPct}%` : 'Re-render'}</Box>
            <div style={css('position:relative')}>
              <Box t="button" onClick={() => setState({ exportMenu: !S.exportMenu })} s="cursor:pointer;border:none;border-radius:9px;padding:8px 16px;background:var(--accent);color:#0B0B0E;font-size:13.5px;font-weight:600;display:inline-flex;align-items:center;gap:6px;transition:filter .15s" sh="filter:brightness(1.12)">
                Export
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </Box>
              {S.exportMenu && (
                <>
                  <div onClick={() => setState({ exportMenu: false })} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div style={css('position:absolute;right:0;top:calc(100% + 9px);z-index:41;width:268px;background:#141418;border:1px solid rgba(255,255,255,0.13);border-radius:13px;padding:6px;box-shadow:0 18px 44px rgba(0,0,0,0.55)')}>
                    <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.14em', color: 'rgba(244,243,240,0.4)', padding: '9px 11px 7px' }}>DOWNLOAD QUALITY</div>
                    <Box t="button" onClick={exportPreview} s="cursor:pointer;width:100%;text-align:left;background:none;border:none;border-radius:9px;padding:10px 11px;display:block;transition:background .12s" sh="background:rgba(255,255,255,0.05)">
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F4F3F0' }}>Preview · 540p</div>
                      <div style={{ fontSize: 11.5, color: 'rgba(244,243,240,0.5)', marginTop: 2 }}>Instant — downloads the current render</div>
                    </Box>
                    <Box t="button" onClick={exportHD} disabled={S.rendering} s={'cursor:pointer;width:100%;text-align:left;background:none;border:none;border-radius:9px;padding:10px 11px;display:block;transition:background .12s' + (S.rendering ? ';opacity:0.5;pointer-events:none' : '')} sh="background:rgba(255,255,255,0.05)">
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#F4F3F0', display: 'flex', alignItems: 'center', gap: 7 }}>
                        Full HD · 1080p
                        <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: '0.1em', background: 'color-mix(in oklab, var(--accent) 22%, transparent)', color: 'var(--accent)', padding: '2px 6px', borderRadius: 5 }}>BEST</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'rgba(244,243,240,0.5)', marginTop: 2 }}>Re-renders at full quality, then downloads</div>
                    </Box>
                  </div>
                </>
              )}
            </div>
            <span style={css('width:31px;height:31px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;color:rgba(244,243,240,0.8)')}>Y</span>
          </div>
        </header>

        {/* toast */}
        {!!S.note && (
          <div style={css('position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:120;background:rgba(20,20,25,0.96);border:1px solid color-mix(in oklab, var(--accent) 45%, transparent);border-radius:11px;padding:11px 18px;font-size:13px;color:#F4F3F0;box-shadow:0 12px 40px rgba(0,0,0,0.5);max-width:min(90vw,520px)')}>{S.note}</div>
        )}

        {/* ============ REPLACE FOOTAGE MODAL ============ */}
        {S.replace.open && (
          <div onClick={closeReplace} style={css('position:fixed;inset:0;z-index:300;background:rgba(6,6,9,0.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px')}>
            <div onClick={(e) => e.stopPropagation()} style={css('width:min(940px,95vw);max-height:88vh;display:flex;flex-direction:column;background:#141419;border:1px solid rgba(255,255,255,0.1);border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,0.65);overflow:hidden')}>
              {/* header */}
              <div style={css('display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08)')}>
                <div style={css('display:flex;flex-direction:column;gap:2px')}>
                  <span style={css('font-size:15px;font-weight:600;color:#F4F3F0')}>Replace footage</span>
                  <span style={{ fontFamily: mono, fontSize: 10.5, color: 'rgba(244,243,240,0.45)' }}>
                    {(clips.find((c) => c.id === sel?.id)?.label) || 'selected scene'} · keeps timing &amp; narration
                  </span>
                </div>
                <Box t="button" onClick={closeReplace} s="cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;width:30px;height:30px;font-size:15px;color:rgba(244,243,240,0.7);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.35)">✕</Box>
              </div>
              {/* tabs */}
              <div style={css('display:flex;gap:6px;padding:12px 20px 0')}>
                {[['search', '🔎 Search stock'], ['upload', '⭱ Upload file'], ['url', '🔗 Paste URL']].map(([k, label]) => (
                  <Box key={k} t="button" onClick={() => setReplace({ tab: k, err: '' })}
                    s={'cursor:pointer;padding:8px 14px;font-size:12.5px;border-radius:8px 8px 0 0;border:1px solid transparent;transition:all .15s;'
                      + (S.replace.tab === k ? 'background:rgba(255,255,255,0.06);color:#F4F3F0;border-color:rgba(255,255,255,0.1);border-bottom-color:transparent' : 'background:transparent;color:rgba(244,243,240,0.5)')}>{label}</Box>
                ))}
              </div>
              {/* body */}
              <div style={css('flex:1;min-height:0;overflow:auto;padding:18px 20px')}>
                {S.replace.tab === 'search' && (
                  <div style={css('display:flex;flex-direction:column;gap:14px')}>
                    <div style={css('display:flex;gap:8px')}>
                      <input autoFocus value={S.replace.q} placeholder="Search Pexels & Pixabay — e.g. city skyline, coffee, ocean…"
                        onChange={(e) => setReplace({ q: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') runStockSearch(); }}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 13px', fontSize: 13, color: '#F4F3F0', outline: 'none' }} />
                      <Box t="button" onClick={runStockSearch} s="cursor:pointer;background:var(--accent);border:none;border-radius:9px;padding:0 18px;font-size:13px;font-weight:600;color:#0B0B0E">Search</Box>
                    </div>
                    {S.replace.loading && <span style={css('font-size:12.5px;color:rgba(244,243,240,0.55)')}>Searching…</span>}
                    {!S.replace.loading && !!S.replace.results.length && (
                      <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px')}>
                        {S.replace.results.map((r) => (
                          <Box key={r.id} t="button" onClick={() => chooseStock(r)} title={`${r.provider} · ${r.credit}`}
                            s="cursor:pointer;position:relative;aspect-ratio:16/9;border-radius:9px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);background-color:#000;background-position:center;background-size:cover;background-repeat:no-repeat;padding:0;transition:border-color .15s"
                            sh="border-color:var(--accent)"
                            style={{ backgroundImage: r.thumb ? `url("${r.thumb}")` : 'none' }}>
                            <span style={{ position: 'absolute', top: 5, left: 5, fontFamily: mono, fontSize: 8.5, letterSpacing: '0.05em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 5px', borderRadius: 4 }}>{r.provider}</span>
                            {r.duration != null && <span style={{ position: 'absolute', bottom: 5, right: 5, fontFamily: mono, fontSize: 9, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 5px', borderRadius: 4 }}>{Math.round(r.duration)}s</span>}
                          </Box>
                        ))}
                      </div>
                    )}
                    {!S.replace.loading && !S.replace.results.length && !S.replace.err && (
                      <span style={css('font-size:12px;color:rgba(244,243,240,0.4);line-height:1.6')}>Type a search and press Enter. Results come from Pexels &amp; Pixabay — free, commercial-use stock footage.</span>
                    )}
                  </div>
                )}
                {S.replace.tab === 'upload' && (
                  <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 180, border: '1.5px dashed rgba(255,255,255,0.2)', borderRadius: 12, color: 'rgba(244,243,240,0.6)', fontSize: 13 }}>
                    <span style={{ fontSize: 26 }}>⭱</span>
                    <span>Click to choose a video or image</span>
                    <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.35)' }}>MP4 · MOV · WEBM · JPG · PNG · up to 200MB</span>
                    <input type="file" accept="video/*,image/*" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; chooseUpload(f); }} />
                  </label>
                )}
                {S.replace.tab === 'url' && (
                  <div style={css('display:flex;flex-direction:column;gap:12px')}>
                    <span style={css('font-size:12.5px;color:rgba(244,243,240,0.6);line-height:1.6')}>Paste a direct link to a video or image file. We download it into your project so it survives re-renders.</span>
                    <div style={css('display:flex;gap:8px')}>
                      <input value={S.replace.url} placeholder="https://…/clip.mp4"
                        onChange={(e) => setReplace({ url: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') chooseUrl(); }}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 13px', fontSize: 13, color: '#F4F3F0', outline: 'none' }} />
                      <Box t="button" onClick={chooseUrl} s="cursor:pointer;background:var(--accent);border:none;border-radius:9px;padding:0 18px;font-size:13px;font-weight:600;color:#0B0B0E">Fetch</Box>
                    </div>
                  </div>
                )}
              </div>
              {/* footer / status */}
              {(S.replace.err || S.replace.busy) && (
                <div style={css('padding:12px 20px;border-top:1px solid rgba(255,255,255,0.08);font-size:12.5px;color:' + (S.replace.busy ? 'var(--accent)' : '#ff8a6b'))}>
                  {S.replace.busy ? 'Adding footage to your project…' : S.replace.err}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ PREVIEW & TRIM OVERLAY ============ */}
        {S.preview.open && S.preview.item && (() => {
          const pv = S.preview;
          const isImg = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(pv.item.download || '');
          return (
            <div onClick={closePreview} style={css('position:fixed;inset:0;z-index:320;background:rgba(6,6,9,0.8);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:24px')}>
              <div onClick={(e) => e.stopPropagation()} style={css('width:min(760px,94vw);max-height:92vh;display:flex;flex-direction:column;background:#141419;border:1px solid rgba(255,255,255,0.1);border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,0.65);overflow:hidden')}>
                <div style={css('display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.08)')}>
                  <div style={css('display:flex;flex-direction:column;gap:2px')}>
                    <span style={css('font-size:14px;font-weight:600;color:#F4F3F0')}>Preview{isImg ? '' : ' & trim'}</span>
                    <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.45)' }}>{pv.item.provider} · {pv.item.credit} · {pv.target === 'media' ? 'replaces the shot at the playhead' : 'replaces the selected layer'}</span>
                  </div>
                  <Box t="button" onClick={closePreview} s="cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;width:30px;height:30px;font-size:15px;color:rgba(244,243,240,0.7)">✕</Box>
                </div>
                <div style={css('padding:16px 18px;display:flex;flex-direction:column;gap:14px;overflow:auto')}>
                  {isImg ? (
                    <img src={pv.item.download} alt="" style={{ width: '100%', maxHeight: '48vh', objectFit: 'contain', borderRadius: 10, background: '#000', display: 'block' }} />
                  ) : (
                    <video src={pv.item.download} controls autoPlay muted loop
                      onLoadedMetadata={(e) => { const d = e.currentTarget.duration || 0; const w = pv.sceneDur > 0 ? Math.min(d, pv.sceneDur) : d; setPreview({ dur: d, inS: 0, outS: w }); }}
                      style={{ width: '100%', maxHeight: '48vh', borderRadius: 10, background: '#000', display: 'block' }} />
                  )}
                  {!isImg && (() => {
                    const win = pv.sceneDur > 0 ? Math.min(pv.dur || pv.sceneDur, pv.sceneDur) : pv.dur;
                    const maxStart = Math.max(0, (pv.dur || 0) - (pv.sceneDur || 0));
                    const shorter = pv.dur > 0 && pv.sceneDur > 0 && pv.dur < pv.sceneDur - 0.05;
                    return (
                      <div style={css('display:flex;flex-direction:column;gap:10px')}>
                        <div style={css('display:flex;align-items:center;justify-content:space-between')}>
                          <span style={css('font-size:12px;color:rgba(244,243,240,0.7)')}>Start point <span style={{ opacity: 0.5 }}>· using {win ? win.toFixed(1) : '…'}s to fit the scene</span></span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--accent)' }}>{pv.dur ? pv.inS.toFixed(1) + 's → ' + pv.outS.toFixed(1) + 's' : 'loading…'}</span>
                        </div>
                        <div style={css('display:flex;align-items:center;gap:8px')}>
                          <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.45)', width: 34 }}>START</span>
                          <input type="range" min="0" max={Math.max(maxStart, 0.1)} step="0.1" value={pv.inS} disabled={!pv.dur || maxStart <= 0}
                            onChange={(e) => { const inS = Math.max(0, Math.min(+e.target.value, maxStart)); setPreview({ inS, outS: Math.min(pv.dur, inS + pv.sceneDur) }); }}
                            style={{ flex: 1, accentColor: 'var(--accent)' }} />
                          <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.8)', width: 42, textAlign: 'right' }}>{pv.inS.toFixed(1)}s</span>
                        </div>
                        {shorter && <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.4)', lineHeight: 1.5 }}>Clip is {pv.dur.toFixed(1)}s — shorter than the {pv.sceneDur.toFixed(1)}s scene; it loops to fill.</span>}
                      </div>
                    );
                  })()}
                  {!!pv.err && <span style={css('font-size:12px;color:#ff8a6b;line-height:1.5')}>{pv.err}</span>}
                </div>
                <div style={css('display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid rgba(255,255,255,0.08)')}>
                  <Box t="button" onClick={closePreview} s="cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:9px 16px;font-size:12.5px;color:rgba(244,243,240,0.8)">Cancel</Box>
                  <Box t="button" onClick={confirmPreview} s="cursor:pointer;background:var(--accent);border:none;border-radius:9px;padding:9px 18px;font-size:12.5px;font-weight:600;color:#0B0B0E">{pv.busy ? 'Adding…' : 'Use this clip'}</Box>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============ BODY: 3 COLUMNS ============ */}
        <div style={css('flex:1;display:flex;min-height:0;overflow:hidden')}>

          {/* ===== LEFT RAIL ===== */}
          <aside style={css('flex:none;width:258px;border-right:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;min-height:0;background:rgba(255,255,255,0.008)')}>
            <div style={css('flex:none;display:flex;padding:10px 12px 0;gap:4px')}>
              <Box t="button" onClick={() => setState({ leftTab: 'layers' })} s={tab(S.leftTab === 'layers')}>Layers</Box>
              <Box t="button" onClick={openMediaTab} s={tab(S.leftTab === 'media')}>Media</Box>
            </div>

            {S.leftTab === 'layers' && (
              <div className="sq-scroll" style={css('flex:1;overflow-y:auto;padding:12px')}>
                <div style={css('display:flex;flex-direction:column;gap:4px')}>
                  {layerRows.map((r) => (
                    <Box key={r.key} t="button" onClick={r.select} s={r.style}>
                      <span style={css(r.dotStyle)} />
                      <span style={css('display:flex;flex-direction:column;gap:1px;min-width:0;text-align:left;flex:1')}>
                        <span style={css('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.label}</span>
                        <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>
                      </span>
                      <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.35)' }}>{r.len}</span>
                    </Box>
                  ))}
                </div>
              </div>
            )}

            {S.leftTab === 'media' && (
              <div className="sq-scroll" style={css('flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:14px')}>
                {S.ir ? (
                  <>
                    {/* real upload → replaces the shot at the playhead */}
                    <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', color: 'rgba(244,243,240,0.65)', fontSize: 12.5, lineHeight: 1.5, padding: '16px 12px', textAlign: 'center' }}>
                      ⟳ Upload &amp; replace shot
                      <span style={{ fontSize: 10.5, color: 'rgba(244,243,240,0.35)' }}>MP4 · MOV · WEBM · JPG · PNG · up to 200MB</span>
                      <input type="file" accept="video/*,image/*" style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addUploadMedia(f); }} />
                    </label>
                    {/* live stock search */}
                    <div style={css('display:flex;gap:6px')}>
                      <input value={S.media.q} placeholder="Search stock footage…"
                        onChange={(e) => setMedia({ q: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') runMediaSearch(); }}
                        style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: '#F4F3F0', outline: 'none' }} />
                      <Box t="button" onClick={runMediaSearch} s="cursor:pointer;background:var(--accent);border:none;border-radius:8px;padding:0 12px;font-size:12px;font-weight:600;color:#0B0B0E">Go</Box>
                    </div>
                    {S.media.loading && <span style={css('font-size:11.5px;color:rgba(244,243,240,0.5)')}>Searching Pexels &amp; Pixabay…</span>}
                    {S.media.busy && <span style={css('font-size:11.5px;color:var(--accent)')}>Adding footage…</span>}
                    {!!S.media.err && <span style={css('font-size:11.5px;color:#ff8a6b;line-height:1.5')}>{S.media.err}</span>}
                    {!!S.media.results.length && (
                      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
                        {S.media.results.map((r) => (
                          <Box key={r.id} t="button" onClick={() => addStock(r)} title={`Replace the current shot · ${r.provider} · ${r.credit}`}
                            s="cursor:pointer;position:relative;aspect-ratio:16/10;border-radius:9px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;padding:0;background-color:#000;background-position:center;background-size:cover;background-repeat:no-repeat;transition:border-color .15s"
                            sh="border-color:var(--accent)"
                            style={{ backgroundImage: r.thumb ? `url("${r.thumb}")` : 'none' }}>
                            <span style={{ position: 'absolute', top: 5, left: 5, fontFamily: mono, fontSize: 8, letterSpacing: '0.05em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 4px', borderRadius: 3 }}>{r.provider}</span>
                            <span style={css('position:absolute;top:5px;right:5px;width:17px;height:17px;border-radius:50%;background:rgba(11,11,14,0.72);color:#fff;font-size:11px;line-height:17px;text-align:center')}>⟳</span>
                            {r.duration != null && <span style={{ position: 'absolute', bottom: 5, right: 5, fontFamily: mono, fontSize: 8.5, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 4px', borderRadius: 3 }}>{Math.round(r.duration)}s</span>}
                          </Box>
                        ))}
                      </div>
                    )}
                    {!S.media.loading && !S.media.results.length && !S.media.err && (
                      <span style={css('font-size:11.5px;color:rgba(244,243,240,0.4);line-height:1.6')}>Search Pexels &amp; Pixabay, or upload a file — picking one replaces the shot at the playhead. Move the playhead to choose which scene.</span>
                    )}
                  </>
                ) : (
                  // Mock prototype (no project loaded): the original sample swatches.
                  <div style={css('display:flex;flex-direction:column;gap:9px')}>
                    {mediaGroups.map((g) => (
                      <div key={g.label} style={css('display:flex;flex-direction:column;gap:8px')}>
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.4)' }}>{g.label}</span>
                        <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
                          {g.items.map((m) => (
                            <Box key={m.label} t="button" onClick={m.add} title="Add to timeline" s={'cursor:pointer;position:relative;aspect-ratio:16/10;border-radius:9px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;padding:0;background:' + m.bg + ';transition:border-color .15s'} sh="border-color:var(--accent)">
                              <span style={css('position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.7),transparent 60%)')} />
                              <span style={css('position:absolute;left:6px;right:6px;bottom:5px;font-size:10px;font-weight:600;color:#fff;text-align:left;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{m.label}</span>
                              <span style={css('position:absolute;top:5px;right:5px;width:17px;height:17px;border-radius:50%;background:rgba(11,11,14,0.65);color:#fff;font-size:12px;line-height:17px;text-align:center')}>＋</span>
                            </Box>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* ===== CENTER ===== */}
          <main style={css('flex:1;display:flex;flex-direction:column;min-width:0;min-height:0')}>

            {/* stage */}
            <div style={css('flex:1;display:flex;align-items:center;justify-content:center;padding:24px;min-height:0;position:relative;background:radial-gradient(80% 80% at 50% 40%, rgba(255,255,255,0.02), transparent)')}>
              <div style={css('position:relative;height:100%;max-height:100%;aspect-ratio:16/9;max-width:100%;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);box-shadow:0 24px 70px rgba(0,0,0,0.5)')}>

                {/* footage frame — real rendered MP4 when a project is loaded, else the mock gradient */}
                {realVideo ? (
                  <>
                    <video
                      ref={videoRef}
                      src={S.videoUrl}
                      playsInline
                      onLoadedMetadata={(e) => setState({ vDur: e.currentTarget.duration || 0 })}
                      onTimeUpdate={(e) => setState({ vTime: e.currentTarget.currentTime })}
                      onPlay={() => setState({ playing: true })}
                      onPause={() => setState({ playing: false })}
                      onEnded={() => setState({ playing: false })}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }}
                    />
                    <span style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: mono, fontSize: 10.5, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.72)', background: 'rgba(0,0,0,0.35)', padding: '3px 8px', borderRadius: 6 }}>{S.ir ? currentShotLabel : (S.projTitle || currentShotLabel)}</span>
                  </>
                ) : (
                  <div style={css(footageStyle)}>
                    <span style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: mono, fontSize: 10.5, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.72)', background: 'rgba(0,0,0,0.35)', padding: '3px 8px', borderRadius: 6 }}>{currentShotLabel}</span>
                  </div>
                )}

                {/* text overlays (mock preview only — real video has type baked in) */}
                {activeTexts.map((t) => (
                  <div key={t.key} onClick={t.select} style={css(t.style)}>{t.content}</div>
                ))}

                {/* component hit regions — Select tool picks IR layers off the video */}
                {regions.map((r) => {
                  const on = S.hoverHit === r.id;
                  return (
                    <div
                      key={'hit' + r.id}
                      onClick={() => pickFromStage(r)}
                      onMouseEnter={() => setState({ hoverHit: r.id })}
                      onMouseLeave={() => setState((s) => (s.hoverHit === r.id ? { hoverHit: null } : null))}
                      style={{ position: 'absolute', left: r.region.x + '%', top: r.region.y + '%', width: r.region.w + '%', height: r.region.h + '%', zIndex: r.z, cursor: 'pointer', borderRadius: 8, outline: on ? '1.5px dashed color-mix(in oklab, var(--accent) 75%, transparent)' : 'none', outlineOffset: -3 }}
                    >
                      {on && <span style={{ position: 'absolute', top: 5, left: 7, fontFamily: mono, fontSize: 9.5, background: 'rgba(11,11,14,0.85)', color: 'var(--accent)', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{r.label}</span>}
                    </div>
                  );
                })}

                {/* selected on-video component */}
                {selRegion && (
                  <div style={{ position: 'absolute', left: selRegion.region.x + '%', top: selRegion.region.y + '%', width: selRegion.region.w + '%', height: selRegion.region.h + '%', zIndex: 14, pointerEvents: 'none', border: '1.5px solid var(--accent)', borderRadius: 8 }}>
                    <span style={{ position: 'absolute', top: -22, left: 0, fontFamily: mono, fontSize: 9.5, background: 'var(--accent)', color: '#0B0B0E', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>{selRegion.label}</span>
                  </div>
                )}

                {/* selection bounding box */}
                {hasSelBox && (
                  <div style={css(selBoxStyle)}>
                    <span style={css('position:absolute;top:-9px;left:-9px;width:9px;height:9px;background:var(--accent);border-radius:2px')} />
                    <span style={css('position:absolute;top:-9px;right:-9px;width:9px;height:9px;background:var(--accent);border-radius:2px')} />
                    <span style={css('position:absolute;bottom:-9px;left:-9px;width:9px;height:9px;background:var(--accent);border-radius:2px')} />
                    <span style={css('position:absolute;bottom:-9px;right:-9px;width:9px;height:9px;background:var(--accent);border-radius:2px')} />
                    <span style={{ position: 'absolute', top: -24, left: 0, fontFamily: mono, fontSize: 9.5, background: 'var(--accent)', color: '#0B0B0E', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>{selBoxLabel}</span>
                  </div>
                )}

                {/* ink annotations (draw tool) */}
                {(inkStrokes.length > 0 || S.inkLive) && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 15, pointerEvents: 'none' }}>
                    {inkStrokes.map((a) => (
                      <polyline key={a.id} points={a.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="0.55" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
                    ))}
                    {S.inkLive && (
                      <polyline points={S.inkLive.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="0.55" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                )}

                {/* annotation pins */}
                {pins.map((p) => (
                  <button key={p.key} onClick={p.open} style={css(p.style)}>{p.num}</button>
                ))}

                {/* pointer-catcher for annotate tools (pin click + freehand draw) */}
                <div onPointerDown={stageDown} onPointerMove={stageMove} onPointerUp={stageUp} onPointerCancel={stageUp} style={css(catcherStyle)} />

                {/* annotate toolbar */}
                <div style={css('position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:20;display:flex;gap:3px;padding:4px;background:rgba(15,15,19,0.9);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.1);border-radius:11px')}>
                  {tools.map((tl) => (
                    <button key={tl.key} onClick={tl.pick} title={tl.name} style={css(tl.style)}>
                      <span style={css(tl.iconWrap)} />
                    </button>
                  ))}
                  {inkStrokes.length > 0 && (
                    <button onClick={clearInk} title="Clear drawings" style={css('cursor:pointer;width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:rgba(244,243,240,0.7);font-size:13px;display:flex;align-items:center;justify-content:center')}>⌫</button>
                  )}
                </div>

                {/* format chip */}
                <span style={{ position: 'absolute', top: 14, right: 14, zIndex: 15, fontFamily: mono, fontSize: 10, color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)', padding: '4px 9px', borderRadius: 6 }}>{formatChip}</span>

                {/* transport */}
                <div style={css('position:absolute;left:0;right:0;bottom:0;z-index:18;display:flex;align-items:center;gap:12px;padding:12px 14px;background:linear-gradient(to top,rgba(0,0,0,0.72),transparent)')}>
                  <Box t="button" onClick={togglePlay} s="cursor:pointer;flex:none;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.12);backdrop-filter:blur(6px);color:#fff;display:flex;align-items:center;justify-content:center;padding:0" sh="background:rgba(255,255,255,0.22)">
                    <span style={css(playIconStyle)} />
                  </Box>
                  <span style={{ fontFamily: mono, fontSize: 11, color: 'rgba(255,255,255,0.85)', flex: 'none' }}>{fmt(transTime)}</span>
                  <input type="range" min="0" max={transTotal || 0.1} step="0.1" value={transTime} onChange={scrub} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontFamily: mono, fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 'none' }}>{fmt(transTotal)}</span>
                </div>
              </div>
            </div>

            {/* ===== TIMELINE ===== */}
            <div style={css('flex:none;border-top:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.012);display:flex;flex-direction:column')}>
              <div style={css('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;border-bottom:1px solid rgba(255,255,255,0.05)')}>
                <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.14em', color: 'rgba(244,243,240,0.45)' }}>TIMELINE</span>
                <div style={css('display:flex;align-items:center;gap:6px')}>
                  {clipTools.map((ct) => (
                    <Box key={ct.key} t="button" onClick={ct.run} title={ct.title} s={ct.style} sh="border-color:rgba(255,255,255,0.3)">{ct.label}</Box>
                  ))}
                </div>
              </div>

              <div className="sq-scroll" style={css('overflow-x:auto;padding:10px 16px 14px')}>
                <div style={css('position:relative;min-width:640px')}>
                  {/* ruler */}
                  <div style={css('position:relative;height:16px;margin-left:52px;border-bottom:1px solid rgba(255,255,255,0.06)')}>
                    {ticks.map((tk) => (
                      <span key={tk.key} style={css(tk.style)}>{tk.label}</span>
                    ))}
                  </div>

                  {/* tracks */}
                  <div style={css('display:flex;flex-direction:column;gap:7px;margin-top:8px')}>
                    {tracks.map((tr) => (
                      <div key={tr.key} style={{ display: 'flex', alignItems: 'stretch', gap: 0, height: tr.h }}>
                        <span style={{ flex: 'none', width: 52, display: 'flex', alignItems: 'center', gap: 6, fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', color: 'rgba(244,243,240,0.4)', paddingRight: 8 }}>
                          <span style={css(tr.iconStyle)} />{tr.name}
                        </span>
                        <div style={css('position:relative;flex:1;border-radius:8px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.04)')}>
                          {tr.blocks.map((b) => (
                            <Box key={b.key} t="button" onClick={b.select} s={b.style}>
                              <span style={css('display:block;padding:0 8px;font-size:10.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2')}>{b.label}</span>
                              {b.showWave && <span style={css(b.waveStyle)} />}
                            </Box>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* playhead */}
                  <div style={css(playheadStyle)}>
                    <span style={css('position:absolute;top:-2px;left:50%;transform:translateX(-50%);width:11px;height:11px;background:var(--accent);border-radius:2px;box-shadow:0 0 0 3px rgba(11,11,14,0.7)')} />
                  </div>
                </div>
              </div>
            </div>
          </main>

          {/* ===== RIGHT RAIL ===== */}
          <aside style={css('flex:none;width:352px;border-left:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;min-height:0;background:rgba(255,255,255,0.008)')}>
            <div style={css('flex:none;display:flex;padding:10px 12px 0;gap:4px')}>
              <Box t="button" onClick={() => setState({ rightTab: 'director' })} s={tab(S.rightTab === 'director')}>Director</Box>
              <Box t="button" onClick={() => setState({ rightTab: 'inspect' })} s={tab(S.rightTab === 'inspect')}>Inspect</Box>
              <Box t="button" onClick={() => setState({ rightTab: 'comments' })} s={tab(S.rightTab === 'comments')}>
                Comments
                {S.comments.length > 0 && <span style={{ marginLeft: 5, fontFamily: mono, fontSize: 9, background: 'var(--accent)', color: '#0B0B0E', borderRadius: 99, padding: '1px 5px' }}>{S.comments.length}</span>}
              </Box>
            </div>

            {/* === DIRECTOR CHAT === */}
            {S.rightTab === 'director' && (
              <div style={css('flex:1;display:flex;flex-direction:column;min-height:0')}>
                <div style={css('display:flex;justify-content:flex-end;padding:8px 12px 0')}>
                  <Box t="button" onClick={newChat} title="Start a fresh conversation (clears the chat context)"
                    s="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:5px 10px;font-size:11.5px;color:rgba(244,243,240,0.7);transition:border-color .15s,color .15s"
                    sh="border-color:var(--accent);color:#F4F3F0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                    New chat
                  </Box>
                </div>
                <div
                  ref={chatScrollRef}
                  onScroll={(e) => { const el = e.currentTarget; chatPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
                  className="sq-scroll"
                  style={css('flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px')}
                >
                  {chat.map((msg) => (
                    <div key={msg.key} style={css(msg.wrapStyle)}>
                      {msg.isDirector && (
                        <span style={css('display:flex;align-items:center;gap:7px;margin-bottom:7px')}>
                          <span style={css('width:16px;height:16px;background:var(--accent);border-radius:3px;transform:rotate(45deg);display:inline-block;flex:none')} />
                          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.5)' }}>DIRECTOR</span>
                        </span>
                      )}
                      {msg.isDirector
                        ? <Markdown text={msg.text} />
                        : <p style={css(msg.textStyle)}>{msg.text}</p>}
                      {msg.hasPlan && (
                        <div style={css('margin-top:11px;border:1px solid rgba(255,255,255,0.1);border-radius:11px;background:rgba(255,255,255,0.02);overflow:hidden')}>
                          {msg.plan.length > 0 ? (
                            <div style={css('padding:11px 13px;display:flex;flex-direction:column;gap:8px')}>
                              <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', color: 'var(--accent)' }}>PROPOSED CHANGES</span>
                              {msg.plan.map((ch, ci) => (
                                <span key={ci} style={css('display:flex;gap:8px;font-size:12.5px;line-height:1.45;color:rgba(244,243,240,0.85)')}><span style={css('color:var(--accent);flex:none')}>›</span>{ch}</span>
                              ))}
                            </div>
                          ) : msg.planPending && (
                            <div style={css('padding:9px 13px;font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:0.12em;color:var(--accent)')}>APPLY THIS EDIT?</div>
                          )}
                          {msg.planPending && (
                            <div style={css('display:flex;border-top:1px solid rgba(255,255,255,0.08)')}>
                              <Box t="button" onClick={msg.apply} s="flex:1;cursor:pointer;background:none;border:none;border-right:1px solid rgba(255,255,255,0.08);padding:10px;font-size:12.5px;font-weight:600;color:var(--accent);transition:background .15s" sh="background:color-mix(in oklab, var(--accent) 12%, transparent)">Apply</Box>
                              <Box t="button" onClick={msg.discard} s="flex:1;cursor:pointer;background:none;border:none;padding:10px;font-size:12.5px;color:rgba(244,243,240,0.55);transition:color .15s" sh="color:#F4F3F0">Discard</Box>
                            </div>
                          )}
                          {msg.planApplied && (
                            <div style={css('border-top:1px solid rgba(255,255,255,0.08);padding:8px 13px;font-size:11.5px;color:rgba(244,243,240,0.5);display:flex;align-items:center;gap:6px')}><span style={css('color:var(--accent)')}>✓</span>Applied to Draft</div>
                          )}
                          {msg.planDiscarded && msg.plan.length === 0 && (
                            <div style={css('padding:8px 13px;font-size:11.5px;color:rgba(244,243,240,0.4)')}>✕ Discarded</div>
                          )}
                        </div>
                      )}
                      {/* dev mode: exactly what went to the LLM and what its edit changes */}
                      {msg.devInfo && (
                        <div style={css('margin-top:8px;border:1px dashed rgba(91,124,255,0.45);border-radius:9px;background:rgba(91,124,255,0.06);padding:9px 11px;display:flex;flex-direction:column;gap:7px')}>
                          <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: '0.14em', color: '#5B7CFF' }}>DEV · INSTRUCTION SENT</span>
                          <pre style={{ margin: 0, fontFamily: mono, fontSize: 10, lineHeight: 1.5, color: 'rgba(244,243,240,0.75)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 90, overflowY: 'auto' }}>{msg.devInfo.instruction}</pre>
                          {msg.devInfo.diff && (
                            <>
                              <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: '0.14em', color: '#5B7CFF' }}>DEV · IR CHANGES ({msg.devInfo.diff.length})</span>
                              <pre style={{ margin: 0, fontFamily: mono, fontSize: 10, lineHeight: 1.55, color: msg.devInfo.diff.length ? '#8fe3c0' : '#ffb37a', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflowY: 'auto' }}>{msg.devInfo.diff.length ? msg.devInfo.diff.join('\n') : '(no IR changes — everything the model proposed was dropped by the server sanitizer)'}</pre>
                            </>
                          )}
                          {msg.devInfo.error && (
                            <>
                              <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: '0.14em', color: '#ff8f8f' }}>DEV · SERVER ERROR</span>
                              <pre style={{ margin: 0, fontFamily: mono, fontSize: 10, lineHeight: 1.5, color: 'rgba(255,150,150,0.9)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.devInfo.error}</pre>
                            </>
                          )}
                          {msg.devInfo.raw && (
                            <>
                              <span style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: '0.14em', color: '#5B7CFF' }}>DEV · RAW MODEL OUTPUT</span>
                              <pre style={{ margin: 0, fontFamily: mono, fontSize: 10, lineHeight: 1.5, color: 'rgba(244,243,240,0.6)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflowY: 'auto' }}>{msg.devInfo.raw}</pre>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {S.thinking && (
                    <div style={css('max-width:100%')}>
                      <span style={css('display:flex;align-items:center;gap:7px;margin-bottom:7px')}>
                        <span style={{ width: 16, height: 16, background: 'var(--accent)', borderRadius: 3, transform: 'rotate(45deg)', display: 'inline-block', flex: 'none', animation: 'sqpulse 1s infinite' }} />
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.5)' }}>DIRECTOR</span>
                      </span>
                      {S.streamText ? (
                        // Reply streaming in live, with a blinking caret.
                        <p style={css('margin:0;font-size:13.5px;line-height:1.55;color:rgba(244,243,240,0.88)')}>
                          {S.streamText}
                          <span style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 2, background: 'var(--accent)', verticalAlign: 'text-bottom', animation: 'sqblink 1s steps(1) infinite' }} />
                        </p>
                      ) : (
                        // Pre-text: what the agent is currently doing.
                        <div style={css('display:flex;align-items:center;gap:8px;color:rgba(244,243,240,0.55);font-size:12.5px')}>
                          <span style={{ display: 'inline-flex', gap: 3 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'sqpulse 1s infinite' }} />
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'sqpulse 1s infinite 0.2s' }} />
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'sqpulse 1s infinite 0.4s' }} />
                          </span>
                          {S.agentStatus || 'Directing your change…'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={css('flex:none;padding:12px;border-top:1px solid rgba(255,255,255,0.07)')}>
                  {!!L && (
                    <span style={css('display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;font-size:11px;background:color-mix(in oklab, var(--accent) 12%, transparent);border:1px solid color-mix(in oklab, var(--accent) 40%, transparent);color:var(--accent);border-radius:99px;padding:3px 10px')}>Editing: {selForChat} <button onClick={() => setState({ sel: null })} style={css('cursor:pointer;background:none;border:none;color:inherit;padding:0;font-size:12px;line-height:1')}>✕</button></span>
                  )}
                  <div className="sq-focus" style={css('border:1px solid rgba(255,255,255,0.12);border-radius:13px;background:rgba(255,255,255,0.03);padding:10px 12px;display:flex;flex-direction:column;gap:9px')}>
                    <textarea rows="2" value={S.input} onChange={(e) => setState({ input: e.target.value })} placeholder="Tell the director what to change…" style={{ resize: 'none', border: 'none', background: 'transparent', color: '#F4F3F0', fontSize: 13.5, lineHeight: 1.5, outline: 'none' }} />
                    <div style={css('display:flex;align-items:center;justify-content:space-between')}>
                      <div style={css('display:flex;gap:5px;flex-wrap:wrap')}>
                        {suggestions.map((sg) => (
                          <Box key={sg.key} t="button" onClick={sg.use} s="cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:99px;padding:4px 9px;font-size:10.5px;color:rgba(244,243,240,0.65);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">{sg.label}</Box>
                        ))}
                      </div>
                      <button onClick={send} style={css(sendStyle)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* === INSPECTOR === */}
            {S.rightTab === 'inspect' && (
              <div className="sq-scroll" style={css('flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:0')}>
                {nothingSelected && (
                  <div style={css('margin-top:40px;text-align:center;color:rgba(244,243,240,0.4);font-size:13px;line-height:1.6;padding:0 20px')}>Select a clip, text layer, or audio track<br />to edit its properties.</div>
                )}
                {somethingSelected && insp && (
                  <div style={css('display:flex;flex-direction:column;gap:18px')}>
                    {/* header */}
                    <div style={css('display:flex;align-items:flex-start;justify-content:space-between;gap:10px')}>
                      <div style={css('display:flex;flex-direction:column;gap:3px;min-width:0')}>
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--accent)' }}>{insp.inspKind}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: grotesk, letterSpacing: '-0.01em' }}>{insp.inspTitle}</span>
                      </div>
                      <span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.4)', whiteSpace: 'nowrap', paddingTop: 3 }}>{insp.inspTiming}</span>
                    </div>

                    {/* editable text content */}
                    {insp.inspIsText && insp.inspEditable && (
                      <div style={css('display:flex;flex-direction:column;gap:8px')}>
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.45)' }}>TEXT</span>
                        <Box t="textarea" rows="2" value={insp.inspTextValue} onChange={insp.setTextContent} s="resize:none;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);border-radius:10px;color:#F4F3F0;font-size:13.5px;line-height:1.5;outline:none;padding:10px 12px" sf="border-color:color-mix(in oklab, var(--accent) 55%, transparent)" />
                      </div>
                    )}
                    {insp.inspIsText && !insp.inspEditable && (
                      <div style={css('border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.02);padding:10px 12px;font-size:12px;line-height:1.55;color:rgba(244,243,240,0.55)')}>Captions are word-timed to the narration — ask the Director to restyle or rewrite them.</div>
                    )}

                    {/* Replace this layer with footage */}
                    {S.ir && insp.inspIsText && (
                      <Box t="button" onClick={openReplace} s="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;background:color-mix(in oklab, var(--accent) 15%, transparent);border:1px solid color-mix(in oklab, var(--accent) 55%, transparent);border-radius:9px;padding:10px 12px;font-size:12.5px;color:var(--accent);font-weight:600;transition:border-color .15s" sh="border-color:var(--accent)"><span>⟳ Replace with footage</span><span style={{ fontFamily: mono, fontSize: 10, opacity: 0.7 }}>stock · upload · url</span></Box>
                    )}

                    {/* TRANSFORM */}
                    {insp.inspHasTransform && (
                      <div style={css('display:flex;flex-direction:column;gap:12px;border-top:1px solid rgba(255,255,255,0.07);padding-top:16px')}>
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.45)' }}>TRANSFORM</span>
                        {insp.transformRows.map((tf) => (
                          <div key={tf.key} style={css('display:flex;flex-direction:column;gap:5px')}>
                            <div style={css('display:flex;align-items:center;justify-content:space-between')}>
                              <span style={css('font-size:12px;color:rgba(244,243,240,0.7)')}>{tf.label}</span>
                              <span style={{ fontFamily: mono, fontSize: 11, color: 'rgba(244,243,240,0.9)' }}>{tf.readout}</span>
                            </div>
                            <input type="range" min={tf.min} max={tf.max} step={tf.step} value={tf.value} onChange={tf.set} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                          </div>
                        ))}
                        <div style={css('display:flex;gap:8px')}>
                          <Box t="button" onClick={insp.cropToggle} s={insp.cropStyle}>◲ Crop</Box>
                          <Box t="button" onClick={insp.resetTransform} s="flex:1;cursor:pointer;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:8px;font-size:12px;color:rgba(244,243,240,0.7);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">Reset</Box>
                        </div>
                        {S.ir && <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.35)', lineHeight: 1.5 }}>Transforms save to the edit — Re-render to see them in the video.</span>}
                      </div>
                    )}

                    {/* TRIM / SPLIT */}
                    {insp.inspHasTrim && (
                      <div style={css('display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:16px')}>
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.45)' }}>TIMING</span>
                        <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
                          <Box t="button" onClick={insp.trimStart} s="cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:9px;font-size:12px;color:rgba(244,243,240,0.8);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">⇥ Trim in</Box>
                          <Box t="button" onClick={insp.trimEnd} s="cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:9px;font-size:12px;color:rgba(244,243,240,0.8);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">⇤ Trim out</Box>
                          <Box t="button" onClick={insp.splitClip} s="cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:9px;font-size:12px;color:rgba(244,243,240,0.8);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">✂ Split at playhead</Box>
                          <Box t="button" onClick={insp.duplicateClip} s="cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:9px;font-size:12px;color:rgba(244,243,240,0.8);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">⧉ Duplicate</Box>
                        </div>
                      </div>
                    )}

                    {/* REPLACE / REORDER */}
                    {insp.inspIsClip && (
                      <div style={css('display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:16px')}>
                        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.45)' }}>SOURCE &amp; ORDER</span>
                        {S.ir && (
                          <Box t="button" onClick={openReplace} s="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;background:color-mix(in oklab, var(--accent) 15%, transparent);border:1px solid color-mix(in oklab, var(--accent) 55%, transparent);border-radius:9px;padding:10px 12px;font-size:12.5px;color:var(--accent);font-weight:600;transition:border-color .15s" sh="border-color:var(--accent)"><span>⟳ Replace footage</span><span style={{ fontFamily: mono, fontSize: 10, opacity: 0.7 }}>stock · upload · url</span></Box>
                        )}
                        <Box t="button" onClick={insp.swapClip} s="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:10px 12px;font-size:12.5px;color:rgba(244,243,240,0.85);transition:border-color .15s" sh="border-color:var(--accent)"><span>{S.ir ? '◲ Reframe shot' : '⟳ Replace shot'}</span><span style={{ fontFamily: mono, fontSize: 10, color: 'rgba(244,243,240,0.45)' }}>{insp.clipSource}</span></Box>
                        <div style={css('display:flex;gap:8px')}>
                          <Box t="button" onClick={insp.moveLeft} s="flex:1;cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:9px;font-size:12px;color:rgba(244,243,240,0.8);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">← Move</Box>
                          <Box t="button" onClick={insp.moveRight} s="flex:1;cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.11);border-radius:9px;padding:9px;font-size:12px;color:rgba(244,243,240,0.8);transition:border-color .15s" sh="border-color:rgba(255,255,255,0.3)">Move →</Box>
                        </div>
                      </div>
                    )}

                    {/* CLIP AUDIO — the video clip's own sound (muted by default) */}
                    {insp.clipHasAudio && (
                      <div style={css('display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(255,255,255,0.07);padding-top:16px')}>
                        <div style={css('display:flex;align-items:center;justify-content:space-between')}>
                          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.45)' }}>CLIP AUDIO</span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: insp.clipVol ? 'var(--accent)' : 'rgba(244,243,240,0.5)' }}>{insp.clipVol ? insp.clipVol + '%' : 'muted'}</span>
                        </div>
                        <input type="range" min="0" max="100" step="1" value={insp.clipVol} onChange={insp.setClipVol} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                        <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.35)', lineHeight: 1.5 }}>This clip's own sound, mixed under the narration. 0 = silent. Re-render to hear it.</span>
                      </div>
                    )}

                    {/* AUDIO */}
                    {insp.inspIsAudio && (
                      <div style={css('display:flex;flex-direction:column;gap:14px;border-top:1px solid rgba(255,255,255,0.07);padding-top:16px')}>
                        <div style={css('display:flex;flex-direction:column;gap:6px')}>
                          <div style={css('display:flex;align-items:center;justify-content:space-between')}>
                            <span style={css('font-size:12px;color:rgba(244,243,240,0.7)')}>Volume</span>
                            <span style={{ fontFamily: mono, fontSize: 11, color: 'rgba(244,243,240,0.9)' }}>{insp.audioVol}%</span>
                          </div>
                          <input type="range" min="0" max="100" step="1" value={insp.audioVolValue} onChange={insp.setVol} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                        </div>
                        {insp.audioOptions.length > 0 && (
                          <div style={css('display:flex;flex-direction:column;gap:8px')}>
                            <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.12em', color: 'rgba(244,243,240,0.45)' }}>{insp.audioPickLabel}</span>
                            <div style={css('display:flex;flex-direction:column;gap:6px')}>
                              {insp.audioOptions.map((ao) => (
                                <Box key={ao.key} t="button" onClick={ao.pick} s={ao.style}><span>{ao.label}</span><span style={css(ao.dot)} /></Box>
                              ))}
                            </div>
                          </div>
                        )}
                        {S.ir && <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.35)', lineHeight: 1.5 }}>Volume saves to the edit — Re-render to hear it.</span>}
                      </div>
                    )}

                    {/* delete */}
                    <Box t="button" onClick={insp.deleteLayer} s="cursor:pointer;background:none;border:1px solid rgba(255,90,90,0.3);border-radius:9px;padding:9px;font-size:12px;color:rgba(255,120,120,0.9);transition:background .15s;margin-top:4px" sh="background:rgba(255,90,90,0.1)">Delete layer</Box>
                  </div>
                )}
              </div>
            )}

            {/* === COMMENTS === */}
            {S.rightTab === 'comments' && (
              <div style={css('flex:1;display:flex;flex-direction:column;min-height:0')}>
                <div className="sq-scroll" style={css('flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px')}>
                  {S.comments.length === 0 && (
                    <div style={css('margin-top:36px;text-align:center;color:rgba(244,243,240,0.4);font-size:12.5px;line-height:1.6;padding:0 18px')}>No comments yet. Pick the <span style={css('color:var(--accent)')}>comment tool</span> above the video and click a frame to pin one — or add a note to the selected clip below.</div>
                  )}
                  {comments.map((cm) => (
                    <div key={cm.key} onClick={cm.jump} style={css(cm.wrapStyle)}>
                      <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:8px')}>
                        <span style={css(cm.badgeStyle)}>{cm.badge}</span>
                        <div style={css('display:flex;flex-direction:column;gap:1px;flex:1;min-width:0')}>
                          <span style={css('font-size:12.5px;font-weight:600')}>{cm.author}</span>
                          <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.45)' }}>{cm.at}</span>
                        </div>
                        <Box t="button" onClick={(e) => { e.stopPropagation(); cm.resolve(); }} title="Resolve" s="cursor:pointer;background:none;border:1px solid rgba(255,255,255,0.14);border-radius:7px;padding:3px 8px;font-size:10.5px;color:rgba(244,243,240,0.6);transition:border-color .15s" sh="border-color:var(--accent)">Resolve</Box>
                      </div>
                      <p style={css('margin:0;font-size:13px;line-height:1.5;color:rgba(244,243,240,0.85)')}>{cm.text}</p>
                    </div>
                  ))}
                </div>
                <div style={css('flex:none;padding:12px;border-top:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;gap:9px')}>
                  <span style={{ fontFamily: mono, fontSize: 9.5, color: 'rgba(244,243,240,0.4)' }}>Note on {commentTarget}</span>
                  <div style={css('display:flex;gap:8px')}>
                    <Box t="input" type="text" value={S.commentInput} onChange={(e) => setState({ commentInput: e.target.value })} placeholder="Add a comment…" s="flex:1;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);border-radius:10px;color:#F4F3F0;font-size:13px;outline:none;padding:9px 12px" sf="border-color:color-mix(in oklab, var(--accent) 55%, transparent)" />
                    <button onClick={addComment} style={css('cursor:pointer;flex:none;border:none;border-radius:10px;padding:0 14px;background:var(--accent);color:#0B0B0E;font-size:13px;font-weight:600')}>Post</button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
