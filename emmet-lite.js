// DjangoNAUT Emmet-lite: a small, dependency-free HTML abbreviation expander
// (tag#id.class, nesting >, repetition *n, text {}). Pure and unit-testable.

const SELF_CLOSING = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']);

function splitTopLevel(input, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

// Parse a single segment like "div#app.main.foo{text}*3".
function parseSegment(seg) {
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)?(\{[^}]*\})?(\*\d+)?$/.exec(seg.trim());
  if (!m) return null;
  const tag = m[1] || 'div';
  const attrs = m[2] || '';
  const text = m[3] ? m[3].slice(1, -1) : null;
  const count = m[4] ? parseInt(m[4].slice(1), 10) : 1;
  let id = null;
  let classes = [];
  for (const a of attrs.match(/[.#][\w-]+/g) || []) {
    if (a[0] === '#') id = a.slice(1);
    else classes.push(a.slice(1));
  }
  if (!m[1] && !attrs && !m[3] && !m[4]) return null;
  return { tag, id, classes, text, count, children: [] };
}

function render(node) {
  if (SELF_CLOSING.has(node.tag)) return '<' + node.tag + toAttrs(node) + '/>';
  const inner = node.children.length
    ? node.children.map(render).join('\n')
    : (node.text || '');
  return '<' + node.tag + toAttrs(node) + '>' + inner + '</' + node.tag + '>';
}

function toAttrs(node) {
  const parts = [];
  if (node.id) parts.push('id="' + node.id + '"');
  if (node.classes.length) parts.push('class="' + node.classes.join(' ') + '"');
  return parts.length ? ' ' + parts.join(' ') : '';
}

// Returns the expanded HTML, or null if the abbreviation is invalid/empty.
function expandAbbreviation(abbr) {
  if (!abbr || typeof abbr !== 'string') return null;
  const trimmed = abbr.trim();
  if (!trimmed) return null;
  if (trimmed === '!') {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Document</title>\n</head>\n<body>\n  \n</body>\n</html>';
  }
  const segs = splitTopLevel(trimmed, '>');
  const parsed = [];
  for (const seg of segs) {
    const node = parseSegment(seg);
    if (!node) return null;
    parsed.push(node);
  }
  for (let i = 0; i < parsed.length - 1; i++) {
    const child = parsed[i + 1];
    const count = child.count || 1;
    for (let c = 0; c < count; c++) parsed[i].children.push(child);
  }
  const root = parsed[0];
  const count = root.count || 1;
  const expanded = [];
  for (let i = 0; i < count; i++) expanded.push(render(root));
  return expanded.join('\n');
}

module.exports = { expandAbbreviation, parseSegment };
