// Field-level diff between two IRs. The Director agent uses this to see what
// its proposed ops ACTUALLY changed (an empty diff = the sanitizer dropped
// everything, so the agent can self-correct instead of silently no-oping).
// Mirrors webapp/src/lib/irDiff.js. Derived timing fields are skipped: retime()
// recomputes them from duration_s, so they're noise, not signal.

const SKIP = new Set(['scene', 'start_frame', 'duration_frames', 'total_frames', 'total_duration_seconds', 'scene_count']);
const MAX_LINES = 60;

const fmtVal = (v) => {
  if (v === undefined) return '∅';
  const s = JSON.stringify(v);
  return s.length > 72 ? s.slice(0, 69) + '…' : s;
};

function walk(a, b, path, out) {
  if (a === b || out.length > MAX_LINES + 20) return;
  const aObj = typeof a === 'object' && a !== null;
  const bObj = typeof b === 'object' && b !== null;
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${fmtVal(a)} → ${fmtVal(b)}`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: ${a.length} items → ${b.length} items`);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push(`${path}[${i}]: + ${fmtVal(b[i])}`);
      else if (i >= b.length) out.push(`${path}[${i}]: − ${fmtVal(a[i])}`);
      else walk(a[i], b[i], `${path}[${i}]`, out);
    }
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (SKIP.has(k)) continue;
    const p = path ? `${path}.${k}` : k;
    if (!(k in b)) out.push(`${p}: ${fmtVal(a[k])} → ∅`);
    else if (!(k in a)) out.push(`${p}: ∅ → ${fmtVal(b[k])}`);
    else walk(a[k], b[k], p, out);
  }
}

export function irDiff(before, after) {
  const out = [];
  walk(before, after, '', out);
  return out.length > MAX_LINES
    ? out.slice(0, MAX_LINES).concat([`… ${out.length - MAX_LINES} more changes`])
    : out;
}
