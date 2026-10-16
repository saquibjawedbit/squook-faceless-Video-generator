import { useMemo, useState } from 'react';

/**
 * The "Edit scenes" tab of the fast-mode studio: whole-video settings and a
 * card per scene. Changes go to the server as edit operations through `send`
 * (shared with the chat), which rebuilds the video and swaps the preview.
 */

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
const pretty = (path) => {
  const s = path.replace(/^focus\.(\d+)\.label$/, (_, n) => `zoom ${Number(n) + 1} label`).replace(/\.(\d+)\./g, (_, n) => ` ${Number(n) + 1} `).replace(/\.(\d+)$/, (_, n) => ` ${Number(n) + 1}`).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function FastEditor({ data, busy, selected, onSelect, send }) {
  const [draft, setDraft] = useState({});    // { [sceneId]: { narration?, layout?, template?, fields: {path: value} } }
  const [ask, setAsk] = useState(null);      // { kind: 'picture'|'add', scene, text }: inline prompt

  const dirty = useMemo(() => Object.values(draft).some((d) => d && (d.narration !== undefined || d.layout !== undefined || d.template !== undefined || Object.keys(d.fields || {}).length)), [draft]);

  if (data === null) return <div className="fx-scroll" style={{ color: 'var(--muted)' }}>Loading…</div>;
  if (!data) return <div className="fx-scroll" style={{ color: 'var(--muted)' }}>This video was made before editing existed, so it can't be edited. Make it again to edit it.</div>;

  const disabled = Boolean(busy);
  const edit = (sceneId, patch) => setDraft((d) => ({ ...d, [sceneId]: { ...(d[sceneId] || { fields: {} }), ...patch } }));
  const editField = (sceneId, path, value) => setDraft((d) => { const cur = d[sceneId] || { fields: {} }; return { ...d, [sceneId]: { ...cur, fields: { ...cur.fields, [path]: value } } }; });
  const run = async (ops, what) => { setAsk(null); if (await send(ops, what)) setDraft({}); };
  const save = () => {
    const ops = [];
    data.scenes.forEach((sc, i) => {
      const d = draft[sc.id];
      if (!d) return;
      const n = i + 1;
      if (d.template !== undefined && d.template !== sc.spec.template) ops.push({ op: 'template', scene: n, template: d.template });
      if (d.narration !== undefined && d.narration.trim() && d.narration !== sc.spec.narration) ops.push({ op: 'narration', scene: n, text: d.narration.trim() });
      if (d.layout !== undefined && d.layout !== sc.spec.layout) ops.push({ op: 'layout', scene: n, value: d.layout });
      if (d.template === undefined || d.template === sc.spec.template) for (const [path, value] of Object.entries(d.fields || {})) ops.push({ op: 'set', scene: n, field: path, value });
    });
    if (ops.length) run(ops, 'Saving your changes');
    else setDraft({});
  };

  return (
    <>
      <div className="fx-scroll">
        <div className="fx-section">Whole video</div>
        <div className="fx-card fx-grid3" style={{ marginBottom: 18 }}>
          {[['Style', data.style, data.styles, (v) => run([{ op: 'style', value: v }], 'Restyling')],
            ['Music', data.musicMood, data.moods, (v) => run([{ op: 'music', mood: v }], 'Finding new music')],
            ['Voice', data.voice, data.voices, (v) => run([{ op: 'voice', value: v }], 'Re-recording the voice')]].map(([name, value, opts, onChange]) => (
            <label key={name}>
              <span className="fx-label">{name}</span>
              <select className="fx-field" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
                {!value ? <option value="">–</option> : null}
                {opts.map((o) => <option key={o} value={o}>{cap(o)}</option>)}
              </select>
            </label>
          ))}
        </div>

        <div className="fx-section">Scenes</div>
        {data.scenes.map((sc, i) => {
          const d = draft[sc.id] || { fields: {} };
          const isOpen = selected === i;
          const template = d.template ?? sc.spec.template;
          const fields = textFields(sc.spec);
          return (
            <div key={sc.id} className={`fx-scene ${isOpen ? 'on' : ''}`}>
              <div className="fx-scene-head" onClick={() => onSelect(isOpen ? null : i)}>
                <span className="fx-num">{i + 1}</span>
                <span className="fx-scene-line">{d.narration ?? sc.spec.narration}</span>
                <span className="fx-scene-meta">{sc.seconds}s</span>
              </div>
              {isOpen ? (
                <div className="fx-scene-body">
                  <span className="fx-label">What the voice says</span>
                  <textarea className="fx-field" rows={3} value={d.narration ?? sc.spec.narration} disabled={disabled} onChange={(e) => edit(sc.id, { narration: e.target.value })} />
                  <div className="fx-fields" style={{ marginTop: 10 }}>
                    <label>
                      <span className="fx-label">Scene type</span>
                      <select className="fx-field" value={template} disabled={disabled} onChange={(e) => edit(sc.id, { template: e.target.value })}>
                        {data.templates.map((t) => <option key={t} value={t}>{cap(t.replace(/_/g, ' '))}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="fx-label">Layout</span>
                      <select className="fx-field" value={d.layout ?? sc.spec.layout ?? ''} disabled={disabled} onChange={(e) => edit(sc.id, { layout: e.target.value })}>
                        {['left', 'center', 'right'].map((l) => <option key={l} value={l}>{cap(l)}</option>)}
                      </select>
                    </label>
                  </div>
                  {d.template === undefined || d.template === sc.spec.template ? (
                    fields.length ? (
                      <>
                        <span className="fx-label" style={{ marginTop: 14 }}>Text on screen</span>
                        <div className="fx-fields">
                          {fields.map((f) => (
                            <label key={f.path}>
                              <span className="fx-label">{pretty(f.path)}</span>
                              <input className="fx-field" value={d.fields?.[f.path] ?? f.value} disabled={disabled} onChange={(e) => editField(sc.id, f.path, e.target.value)} />
                            </label>
                          ))}
                        </div>
                      </>
                    ) : null
                  ) : <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>Save to switch the scene type. Its text is written fresh for the new type.</p>}

                  <div className="fx-actions">
                    <button type="button" className="fx-btn small" disabled={disabled} onClick={() => run([{ op: 'remake', scene: i + 1 }], 'Remaking the scene')}>Remake</button>
                    <button type="button" className="fx-btn small" disabled={disabled} onClick={() => setAsk({ kind: 'picture', scene: i, text: sc.spec.image || '' })}>{sc.hasPicture ? 'New picture' : 'Add picture'}</button>
                    {sc.hasPicture ? <button type="button" className="fx-btn small" disabled={disabled} onClick={() => run([{ op: 'remove_picture', scene: i + 1 }], 'Removing the picture')}>Remove picture</button> : null}
                    <button type="button" className="fx-btn small" disabled={disabled} onClick={() => setAsk({ kind: 'add', scene: i, text: '' })}>Add scene after</button>
                    <button type="button" className="fx-btn small" title="Move up" disabled={disabled || i === 0} onClick={() => { onSelect(i - 1); run([{ op: 'move', scene: i + 1, to: i }], 'Reordering'); }}>↑</button>
                    <button type="button" className="fx-btn small" title="Move down" disabled={disabled || i === data.scenes.length - 1} onClick={() => { onSelect(i + 1); run([{ op: 'move', scene: i + 1, to: i + 2 }], 'Reordering'); }}>↓</button>
                    <button type="button" className="fx-btn small danger" disabled={disabled || data.scenes.length <= 2} onClick={() => { onSelect(null); run([{ op: 'remove', scene: i + 1 }], 'Removing the scene'); }}>Delete</button>
                  </div>
                  {ask && ask.scene === i ? (
                    <form className="fx-inline" onSubmit={(e) => {
                      e.preventDefault();
                      const text = ask.text.trim();
                      if (!text) return;
                      if (ask.kind === 'picture') run([{ op: 'picture', scene: i + 1, description: text }], 'Making the picture');
                      else run([{ op: 'add', after: i + 1, instruction: text }], 'Writing a new scene');
                    }}>
                      <input className="fx-field" autoFocus value={ask.text} onChange={(e) => setAsk({ ...ask, text: e.target.value })}
                        placeholder={ask.kind === 'picture' ? 'Describe the picture' : 'What should the new scene say or show?'} />
                      <button type="submit" className="fx-btn small accent" disabled={disabled || !ask.text.trim()}>{ask.kind === 'picture' ? 'Make' : 'Add'}</button>
                      <button type="button" className="fx-btn small ghost" onClick={() => setAsk(null)}>Cancel</button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {busy ? <p style={{ color: 'var(--accent)', fontSize: 13, margin: '6px 2px' }}>{busy}…</p> : null}
      </div>
      {dirty ? (
        <div className="fx-savebar">
          <span>Unsaved changes</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="fx-btn small ghost" onClick={() => setDraft({})} disabled={disabled}>Discard</button>
            <button type="button" className="fx-btn small primary" onClick={save} disabled={disabled}>Save changes</button>
          </span>
        </div>
      ) : null}
    </>
  );
}
