// Parse a plain CSS declaration string ("color:red;padding:4px") into a React
// style object. Design Composer exports use inline CSS strings everywhere, so
// this lets us port the markup almost verbatim instead of hand-converting every
// declaration to camelCase object syntax.
export function css(str) {
  const out = {};
  if (!str) return out;
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const rawKey = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!rawKey || value === '') continue;
    // Custom properties (--accent) must be kept as-is; React passes them through.
    const key = rawKey.startsWith('--')
      ? rawKey
      : rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = value;
  }
  return out;
}

// Merge several CSS strings / style objects into one style object.
export function merge(...parts) {
  let out = {};
  for (const p of parts) {
    if (!p) continue;
    out = { ...out, ...(typeof p === 'string' ? css(p) : p) };
  }
  // Design Composer's style-hover often overrides only `border-color` while the
  // base style uses the `border` shorthand. React warns when a shorthand and its
  // longhand coexist across re-renders, so fold the color back into `border`.
  if (out.border && out.borderColor) {
    const [width = '1px', style = 'solid'] = String(out.border).split(/\s+/);
    out.border = `${width} ${style} ${out.borderColor}`;
    delete out.borderColor;
  }
  return out;
}
