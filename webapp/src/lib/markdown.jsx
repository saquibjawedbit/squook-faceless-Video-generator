// A tiny, dependency-free Markdown renderer for the Director chat. Renders to
// real React nodes (no dangerouslySetInnerHTML → no XSS surface). Supports the
// light Markdown an LLM actually emits: paragraphs, headings, ordered/unordered
// lists, blockquotes, fenced + inline code, bold, italic, strikethrough, links.

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const S = {
  wrap: { color: 'rgba(244,243,240,0.88)', fontSize: 13.5, lineHeight: 1.55 },
  p: { margin: '0 0 8px' },
  h: (lvl) => ({ margin: '2px 0 6px', fontWeight: 700, fontSize: [null, 17, 15.5, 14.5, 13.5][Math.min(lvl, 4)], lineHeight: 1.3 }),
  ul: { margin: '2px 0 8px', paddingLeft: 18, listStyle: 'disc' },
  ol: { margin: '2px 0 8px', paddingLeft: 20, listStyle: 'decimal' },
  li: { margin: '2px 0' },
  quote: { margin: '2px 0 8px', padding: '2px 0 2px 11px', borderLeft: '2px solid var(--accent)', color: 'rgba(244,243,240,0.7)' },
  pre: { margin: '2px 0 8px', padding: '10px 12px', background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflowX: 'auto', fontFamily: MONO, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre', color: 'rgba(244,243,240,0.9)' },
  code: { fontFamily: MONO, fontSize: '0.86em', background: 'rgba(255,255,255,0.09)', padding: '1px 5px', borderRadius: 5 },
  a: { color: 'var(--accent)', textDecoration: 'underline' },
  tableWrap: { margin: '2px 0 8px', overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12.5 },
  th: { border: '1px solid rgba(255,255,255,0.14)', padding: '5px 9px', fontWeight: 700, background: 'rgba(255,255,255,0.05)', whiteSpace: 'nowrap' },
  td: { border: '1px solid rgba(255,255,255,0.1)', padding: '5px 9px', verticalAlign: 'top' },
};

// Earliest of: inline code, bold (** or __), italic (* or _), strikethrough, link.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|(?<![A-Za-z0-9])_[^_\s][^_]*_(?![A-Za-z0-9]))|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/;

function renderInline(text, kp) {
  const out = [];
  let rest = String(text);
  let k = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${kp}.${k++}`;
    if (tok[0] === '`') {
      out.push(<code key={key} style={S.code}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith('~~')) {
      out.push(<span key={key} style={{ textDecoration: 'line-through', opacity: 0.7 }}>{renderInline(tok.slice(2, -2), key)}</span>);
    } else if (tok[0] === '[') {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      out.push(<a key={key} href={lm[2]} target="_blank" rel="noreferrer" style={S.a}>{renderInline(lm[1], key)}</a>);
    } else {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

// Text with soft line breaks (a single newline inside a paragraph → <br/>).
function inlineWithBreaks(text, kp) {
  const lines = String(text).split('\n');
  return lines.flatMap((ln, i) => (i === 0 ? renderInline(ln, `${kp}.l${i}`) : [<br key={`${kp}.br${i}`} />, ...renderInline(ln, `${kp}.l${i}`)]));
}

const SPECIAL = /^```|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>\s?/;

// A GFM table delimiter row: only | : - and spaces, has a dash and a pipe
// (so a plain "---" horizontal rule, which has no pipe, is excluded).
const isDelim = (l) => l.includes('|') && /-/.test(l) && /^[\s|:-]+$/.test(l);
// Split one table row into trimmed cells, honouring escaped pipes (\|).
const splitRow = (l) => {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
};
const isTableStart = (lines, i) => i + 1 < lines.length && lines[i].includes('|') && !isDelim(lines[i]) && isDelim(lines[i + 1]);
const alignOf = (cell) => {
  const c = cell.trim(); const l = c.startsWith(':'); const r = c.endsWith(':');
  return l && r ? 'center' : r ? 'right' : 'left';
};

function parseBlocks(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', text: buf.join('\n') });
    } else if (/^#{1,6}\s/.test(line)) {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      blocks.push({ type: 'h', level: h[1].length, text: h[2] }); i++;
    } else if (/^\s*[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      blocks.push({ type: 'ul', items });
    } else if (/^\s*\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      blocks.push({ type: 'ol', items });
    } else if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: buf.join('\n') });
    } else if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !SPECIAL.test(lines[i])) {
        rows.push(splitRow(lines[i])); i++;
      }
      blocks.push({ type: 'table', header, aligns, rows });
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !SPECIAL.test(lines[i]) && !isTableStart(lines, i)) { buf.push(lines[i]); i++; }
      blocks.push({ type: 'p', text: buf.join('\n') });
    }
  }
  return blocks;
}

function renderBlock(b, key, last) {
  const tail = last ? { marginBottom: 0 } : null;
  switch (b.type) {
    case 'code':
      return <pre key={key} style={{ ...S.pre, ...tail }}><code>{b.text}</code></pre>;
    case 'h': {
      const Tag = `h${Math.min(b.level, 4)}`;
      return <Tag key={key} style={{ ...S.h(b.level), ...tail }}>{renderInline(b.text, key)}</Tag>;
    }
    case 'ul':
      return <ul key={key} style={{ ...S.ul, ...tail }}>{b.items.map((it, j) => <li key={j} style={S.li}>{renderInline(it, `${key}.${j}`)}</li>)}</ul>;
    case 'ol':
      return <ol key={key} style={{ ...S.ol, ...tail }}>{b.items.map((it, j) => <li key={j} style={S.li}>{renderInline(it, `${key}.${j}`)}</li>)}</ol>;
    case 'quote':
      return <blockquote key={key} style={{ ...S.quote, ...tail }}>{inlineWithBreaks(b.text, key)}</blockquote>;
    case 'table':
      return (
        <div key={key} style={{ ...S.tableWrap, ...tail }}>
          <table style={S.table}>
            <thead><tr>{b.header.map((c, j) => <th key={j} style={{ ...S.th, textAlign: b.aligns[j] || 'left' }}>{renderInline(c, `${key}.h${j}`)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, ri) => (
              <tr key={ri}>{b.header.map((_, ci) => <td key={ci} style={{ ...S.td, textAlign: b.aligns[ci] || 'left' }}>{renderInline(r[ci] || '', `${key}.${ri}.${ci}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    default:
      return <p key={key} style={{ ...S.p, ...tail }}>{inlineWithBreaks(b.text, key)}</p>;
  }
}

export function Markdown({ text, style }) {
  const blocks = parseBlocks(String(text ?? ''));
  return <div style={{ ...S.wrap, ...(style || {}) }}>{blocks.map((b, i) => renderBlock(b, i, i === blocks.length - 1))}</div>;
}
