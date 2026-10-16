import { useEffect, useMemo, useState } from 'react';
import { css } from '../lib/css.js';
import { getFastEditable, editFastVideo, followUpFastVideo } from '../lib/api.js';

/**
 * Editing under a fast-mode video: a follow-up box ("make scene 3 about
 * pricing") and a manual scene editor. Both send the same edit operations to
 * the server, which rebuilds the video; `onIr` swaps the live preview.
 */

const mono = "'JetBrains Mono',monospace";
const panel = 'border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:16px;background:rgba(255,255,255,0.025)';
const input = 'width:100%;box-sizing:border-box;background:#16161a;color:#F4F3F0;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:9px 11px;font-size:14px;font-family:inherit';
const btn = (primary) => `border-radius:10px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;border:${primary ? '0' : '1px solid rgba(255,255,255,0.16)'};background:${primary ? 'var(--accent)' : 'transparent'};color:${primary ? '#0B0B0E' : '#F4F3F0'}`;
const label = `font-family:${mono};font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(244,243,240,0.45);margin:10px 0 5px`;

// Editable copy inside a scene spec: top-level strings + strings inside lists.
// Technical fields (camera targets, cue words, element ids…) stay out of the editor.
const SKIP = new Set(['template', 'narration', 'layout', 'image', 'shot', 'icon_src', 'el', 'action', 'cue', 'from', 'icon', 'time', 'move', 'kind', 'x', 'y', 'fill', 'stroke']);
function textFields(spec) {
  const out = [];
  for (const [k, v] of Object.entries(spec || {})) {
    if (SKIP.has(k)) continue;
    if (typeof v === 'string') out.push({ path: k, value: v });
    else if (Array.isArray(v)) {
      v.forEach((it, i) => {
        if (typeof it === 'string') out.push({ path: `${k}.${i}`, value: it });
        else if (it && typeof it === 'object') for (const [kk, vv] of Object.entries(it)) if (typeof vv === 'string' && !SKIP.has(kk)) out.push({ path: `${k}.${i}.${kk}`, value: vv });
      });
    } else if (v && typeof v === 'object') {
      for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'string') out.push({ path: `${k}.${kk}`, value: vv });
    }
  }
  return out.slice(0, 24);
}
const pretty = (path) => path.replace(/^focus\.(\d+)\.label$/, (_, n) => `zoom ${Number(n) + 1} label`).replace(/\.(\d+)\./g, (_, n) => ` ${Number(n) + 1} `).replace(/\.(\d+)$/, (_, n) => ` ${Number(n) + 1}`).replace(/_/g, ' ');

export default function FastEditor({ id, onIr }) {
  const [data, setData] = useState(null);       // editable view from the server
  const [draft, setDraft] = useState({});       // { [sceneId]: { narration?, layout?, template?, fields: {path: value} } }
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState(null);       // { text, ok }
  const [open, setOpen] = useState(null);       // expanded scene id

  useEffect(() => {
    let alive = true;
    getFastEditable(id).then((d) => alive && setData(d)).catch((e) => alive && setNote({ text: String(e.message || e), ok: false }));
    return () => { alive = false; };
  }, [id]);

  const dirty = useMemo(() => Object.values(draft).some((d) => d && (d.narration !== undefined || d.layout !== undefined || d.template !== undefined || Object.keys(d.fields || {}).length)), [draft]);

  if (!data) return note ? <p style={{ color: 'rgba(244,243,240,0.5)', fontSize: 13, marginTop: 18 }}>{note.text}</p> : null;

  const after = (out, okText) => {
    setData(out.editable);
    setDraft({});
    onIr(out.ir);
    setNote({ text: okText || (out.done?.length ? `Updated: ${out.done.join(', ')}` : 'Nothing changed'), ok: true });
  };
  const run = async (what, fn) => {
    setBusy(what); setNote(null);
    try { await fn(); } catch (e) { setNote({ text: String(e.message || e), ok: false }); } finally { setBusy(''); }
  };
  const send = (ops, what = 'Updating the video…') => run(what, async () => after(await editFastVideo(id, ops)));
  const ask = () => msg.trim() && run('Working on your request…', async () => { const out = await followUpFastVideo(id, msg.trim()); setMsg(''); after(out, out.reply || undefined); });

  const nOf = (sceneId) => data.scenes.findIndex((s) => s.id === sceneId) + 1;
  const edit = (sceneId, patch) => setDraft((d) => ({ ...d, [sceneId]: { ...(d[sceneId] || { fields: {} }), ...patch } }));
  const editField = (sceneId, path, value) => setDraft((d) => { const cur = d[sceneId] || { fields: {} }; return { ...d, [sceneId]: { ...cur, fields: { ...cur.fields, [path]: value } } }; });
  const save = () => {
    const ops = [];
    for (const sc of data.scenes) {
      const d = draft[sc.id];
      if (!d) continue;
      const n = nOf(sc.id);
      if (d.template !== undefined && d.template !== sc.spec.template) ops.push({ op: 'template', scene: n, template: d.template });
      if (d.narration !== undefined && d.narration.trim() && d.narration !== sc.spec.narration) ops.push({ op: 'narration', scene: n, text: d.narration.trim() });
      if (d.layout !== undefined && d.layout !== sc.spec.layout) ops.push({ op: 'layout', scene: n, value: d.layout });
      if (d.template === undefined || d.template === sc.spec.template) for (const [path, value] of Object.entries(d.fields || {})) ops.push({ op: 'set', scene: n, field: path, value });
    }
    if (ops.length) send(ops, 'Saving your edits…');
    else setDraft({});
  };

  const disabled = Boolean(busy);
  return (
    <div style={{ marginTop: 26 }}>
      {/* follow-up */}
      <div style={css(panel)}>
        <div style={css(label + ';margin-top:0')}>Ask for changes</div>
        <div style={css('display:flex;gap:10px;align-items:flex-start')}>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} disabled={disabled}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }}
            placeholder="e.g. “Make scene 3 about pricing”, “End with Book a demo”, “Calmer music”, “Add a scene showing the WhatsApp chat”"
            style={css(input + ';resize:vertical')} />
          <button type="button" onClick={ask} disabled={disabled || !msg.trim()} style={css(btn(true) + `;opacity:${disabled || !msg.trim() ? 0.5 : 1};white-space:nowrap;padding:11px 16px`)}>Apply</button>
        </div>
        {busy ? <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--accent)', margin: '10px 0 0' }}>{busy}</p> : null}
        {note ? <p style={{ fontSize: 13, color: note.ok ? 'rgba(244,243,240,0.75)' : '#ff8a7a', margin: '10px 0 0' }}>{note.text}</p> : null}
      </div>

      {/* whole-video settings */}
      <div style={css(panel + ';margin-top:14px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end')}>
        {[['Style', data.style, data.styles, (v) => send([{ op: 'style', value: v }], 'Restyling…')],
          ['Music', data.musicMood, data.moods, (v) => send([{ op: 'music', mood: v }], 'Finding new music…')],
          ['Voice', data.voice, data.voices, (v) => send([{ op: 'voice', value: v }], 'Re-recording the voice-over…')]].map(([name, value, opts, onChange]) => (
          <label key={name} style={{ minWidth: 150 }}>
            <div style={css(label + ';margin-top:0')}>{name}</div>
            <select value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={css(input)}>
              {!value ? <option value="">—</option> : null}
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>

      {/* scenes */}
      <div style={css('display:flex;align-items:center;justify-content:space-between;margin:20px 0 10px')}>
        <div style={css(label + ';margin:0')}>Scenes</div>
        {dirty ? (
          <div style={css('display:flex;gap:8px')}>
            <button type="button" onClick={() => setDraft({})} disabled={disabled} style={css(btn(false))}>Discard</button>
            <button type="button" onClick={save} disabled={disabled} style={css(btn(true))}>Save edits</button>
          </div>
        ) : null}
      </div>
      <div style={css('display:flex;flex-direction:column;gap:10px')}>
        {data.scenes.map((sc, i) => {
          const d = draft[sc.id] || { fields: {} };
          const isOpen = open === sc.id;
          const template = d.template ?? sc.spec.template;
          return (
            <div key={sc.id} style={css(panel + ';padding:12px 14px')}>
              <div style={css('display:flex;align-items:center;gap:10px;cursor:pointer')} onClick={() => setOpen(isOpen ? null : sc.id)}>
                <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--accent)', minWidth: 22 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: 'rgba(244,243,240,0.5)', minWidth: 92 }}>{template}{sc.hasPicture ? ' · pic' : ''}</span>
                <span style={{ flex: 1, fontSize: 14, color: 'rgba(244,243,240,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.narration ?? sc.spec.narration}</span>
                <span style={{ fontSize: 12, color: 'rgba(244,243,240,0.4)' }}>{sc.seconds}s {isOpen ? '▴' : '▾'}</span>
              </div>
              {isOpen ? (
                <div style={{ marginTop: 6 }}>
                  <div style={css(label)}>Spoken line</div>
                  <textarea rows={2} value={d.narration ?? sc.spec.narration} disabled={disabled} onChange={(e) => edit(sc.id, { narration: e.target.value })} style={css(input + ';resize:vertical')} />
                  <div style={css('display:flex;gap:12px;flex-wrap:wrap')}>
                    <label style={{ minWidth: 160 }}>
                      <div style={css(label)}>Scene type</div>
                      <select value={template} disabled={disabled} onChange={(e) => edit(sc.id, { template: e.target.value })} style={css(input)}>
                        {data.templates.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label style={{ minWidth: 130 }}>
                      <div style={css(label)}>Layout</div>
                      <select value={d.layout ?? sc.spec.layout ?? ''} disabled={disabled} onChange={(e) => edit(sc.id, { layout: e.target.value })} style={css(input)}>
                        {['left', 'center', 'right'].map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </label>
                  </div>
                  {d.template === undefined || d.template === sc.spec.template ? (
                    <>
                      {textFields(sc.spec).length ? <div style={css(label)}>On-screen text</div> : null}
                      <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px')}>
                        {textFields(sc.spec).map((f) => (
                          <label key={f.path}>
                            <div style={{ fontSize: 11, color: 'rgba(244,243,240,0.45)', marginBottom: 3 }}>{pretty(f.path)}</div>
                            <input value={d.fields?.[f.path] ?? f.value} disabled={disabled} onChange={(e) => editField(sc.id, f.path, e.target.value)} style={css(input)} />
                          </label>
                        ))}
                      </div>
                    </>
                  ) : <p style={{ fontSize: 12.5, color: 'rgba(244,243,240,0.55)' }}>Save to switch the scene type — its text is written for the new type.</p>}
                  <div style={css('display:flex;gap:8px;flex-wrap:wrap;margin-top:12px')}>
                    <button type="button" disabled={disabled} onClick={() => send([{ op: 'remake', scene: i + 1 }], 'Remaking the scene…')} style={css(btn(false))}>Remake scene</button>
                    <button type="button" disabled={disabled} onClick={() => { const desc = window.prompt('Describe the picture for this scene', sc.spec.image || ''); if (desc) send([{ op: 'picture', scene: i + 1, description: desc }], 'Making the picture…'); }} style={css(btn(false))}>{sc.hasPicture ? 'New picture' : 'Add picture'}</button>
                    {sc.hasPicture ? <button type="button" disabled={disabled} onClick={() => send([{ op: 'remove_picture', scene: i + 1 }])} style={css(btn(false))}>Remove picture</button> : null}
                    <button type="button" disabled={disabled || i === 0} onClick={() => send([{ op: 'move', scene: i + 1, to: i }], 'Reordering…')} style={css(btn(false))}>Move up</button>
                    <button type="button" disabled={disabled || i === data.scenes.length - 1} onClick={() => send([{ op: 'move', scene: i + 1, to: i + 2 }], 'Reordering…')} style={css(btn(false))}>Move down</button>
                    <button type="button" disabled={disabled} onClick={() => { const what = window.prompt('What should the new scene after this one say or show?'); if (what) send([{ op: 'add', after: i + 1, instruction: what }], 'Writing a new scene…'); }} style={css(btn(false))}>Add scene after</button>
                    <button type="button" disabled={disabled || data.scenes.length <= 2} onClick={() => send([{ op: 'remove', scene: i + 1 }], 'Removing…')} style={css(btn(false) + ';color:#ff8a7a')}>Delete</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
