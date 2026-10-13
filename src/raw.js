import { parse } from '@astrojs/compiler-rs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import { decodeHTML } from 'entities';
import { EditError } from './errors.js';

const markdown = unified().use(remarkParse).use(remarkGfm);
const mdx = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
const blocks = new Set(['code', 'paragraph', 'heading', 'list', 'listItem', 'blockquote', 'table', 'tableCell']);
const prose = new Set([...blocks, 'tableRow', 'text', 'emphasis', 'strong', 'delete', 'inlineCode', 'break', 'link', 'linkReference', 'image', 'imageReference', 'thematicBreak']);
const html = new Set('a abbr address article aside b bdi bdo blockquote br caption cite code dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p q s samp section small span strong sub summary sup table tbody td th thead time tr u ul var wbr'.split(' '));
const htmlBlocks = new Set('address article aside blockquote dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header li main nav ol p section summary table td th ul'.split(' '));
const attributes = new Set(['href', 'src', 'alt', 'title', 'id', 'class', 'className', 'lang', 'dir', 'role', 'target', 'rel', 'colspan', 'rowspan', 'colSpan', 'rowSpan', 'datetime', 'dateTime', 'open', 'start', 'reversed', 'type']);
const startOf = n => n.position?.start.offset ?? n.start;
const endOf = n => n.position?.end.offset ?? n.end;
const nameOf = n => n.openingElement?.name?.name ?? n.name;
function safeUrl(value) {
  const url = [...decodeHTML(value)].filter(c => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127 && !/\s/.test(c)).join('');
  return !/^[a-z][\w+.-]*:/i.test(url) || /^(?:https?|mailto|tel):/i.test(url);
}
function safeAttribute(attribute, astro) {
  const name = astro ? attribute.name?.name : attribute.name;
  if (!(attributes.has(name) || /^aria-[a-z-]+$/.test(name ?? ''))) return false;
  if (astro ? attribute.type !== 'JSXAttribute' : attribute.type !== 'mdxJsxAttribute') return false;
  const value = astro ? attribute.value?.value : attribute.value;
  if (astro && attribute.value && attribute.value.type !== 'Literal') return false;
  if (value != null && typeof value !== 'string') return false;
  return !['href', 'src'].includes(name) || (typeof value === 'string' && safeUrl(value));
}
// Require a real closing delimiter, including inside lists and blockquotes.
// An unterminated fence must never swallow following content on save.
function closedFence(node, body) {
  const start = startOf(node), end = endOf(node);
  const raw = body.slice(start, end);
  const lines = raw.split(/\r?\n/);
  const opener = /^(`{3,}|~{3,})/.exec(lines[0]);
  if (!opener || lines.length < 2) return false;
  const prefix = body.slice(body.lastIndexOf('\n', start - 1) + 1, start);
  let last = lines.at(-1);
  for (let quotes = (prefix.match(/>/g) ?? []).length; quotes > 0; quotes--) {
    if (!/^[ \t]*>/.test(last)) return false;
    last = last.replace(/^[ \t]*> ?/, '');
  }
  const closer = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(last);
  return Boolean(closer && closer[1][0] === opener[1][0] && closer[1].length >= opener[1].length);
}
function safe(node, format, body) {
  if (node.type === 'code') return format !== 'astro' && closedFence(node, body);
  if (format === 'astro' && node.type === 'JSXText') return true;
  if (node.type === 'JSXElement' || node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    return html.has(nameOf(node)) && (node.openingElement?.attributes ?? node.attributes).every(a => safeAttribute(a, format === 'astro')) && node.children.every(n => safe(n, format, body));
  }
  return prose.has(node.type) && (!node.url || safeUrl(node.url)) && (node.children ?? []).every(n => safe(n, format, body));
}
function tree(source, format) {
  try {
    if (format !== 'astro') return (format === 'mdx' ? mdx : markdown).parse(source);
    const result = parse(source);
    if (result.diagnostics.some(d => d.severity === 1)) throw new Error();
    return result.ast;
  } catch { throw new EditError('sourceStructure'); }
}
function children(node) { return node.children ?? (node.type === 'AstroRoot' ? node.body : []) ?? []; }
function walk(node, visit) { visit(node); children(node).forEach(n => walk(n, visit)); }
function kind(node) {
  if (blocks.has(node.type)) return node.type;
  if (htmlBlocks.has(nameOf(node))) return 'html';
  return null;
}
/** Server-only ranges: source is fetched through the authenticated endpoint. */
export function sourceScopes(body, format) {
  const scopes = [];
  walk(tree(body, format), node => {
    const type = kind(node), start = startOf(node), end = endOf(node);
    if (type && Number.isInteger(start) && Number.isInteger(end) && end - start <= 16_384 && safe(node, format, body)) scopes.push({ start, end, type, ...(type === 'html' ? { tag: nameOf(node) } : {}) });
  });
  return scopes.sort((a, b) => (a.end - a.start) - (b.end - b.start));
}
function signature(ast, start, end) {
  return JSON.stringify(ast, (key, value) => {
    if (value && typeof value === 'object' && startOf(value) === start && endOf(value) === end && kind(value)) return { type: 'copyedit-source-range' };
    // Compiler/MDX offsets change after the selected range, but source values
    // of expressions remain in the comparison. Nothing outside it may change.
    if (['position', 'start', 'end', 'raw', 'estree'].includes(key)) return undefined;
    return value;
  });
}
export function patchSource(body, scope, text, format, newline = body.includes('\r\n') ? '\r\n' : '\n') {
  if (!scope) throw new EditError('sourceUnavailable');
  if (typeof text !== 'string' || !text.isWellFormed() || [...text].some(c => { const code = c.charCodeAt(0); return code < 9 || (code > 13 && code < 32) || code === 11 || code === 12 || code === 127; })) throw new EditError('sourceStructure');
  if (text.length > 16_384) throw new EditError('tooLarge', 413);
  // A textarea normalizes CRLF. Keep the document's line-ending convention.
  text = text.replace(/\r\n?/g, '\n');
  if (newline === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (!text.trim()) throw new EditError('sourceStructure');
  const { start, end } = scope;
  if (body.slice(start, end) === text) return body;
  const before = tree(body, format);
  const next = body.slice(0, start) + text + body.slice(end);
  const after = tree(next, format);
  if (scope.type === 'fragment') {
    if (fragmentSignature(before, body, start, end, format) !== fragmentSignature(after, next, start, start + text.length, format)) throw new EditError('sourceStructure');
    return next;
  }
  let oldNode, newNode;
  walk(before, n => { if (startOf(n) === start && endOf(n) === end && kind(n)) oldNode = n; });
  walk(after, n => {
    if (kind(n) && startOf(n) >= start && endOf(n) <= start + text.length &&
      !next.slice(start, startOf(n)).trim() && !next.slice(endOf(n), start + text.length).trim()) newNode = n;
  });
  if (!oldNode || !newNode || !safe(oldNode, format, body) || !safe(newNode, format, next) || (oldNode.type === 'code' && newNode.type !== 'code') || signature(before, start, end) !== signature(after, startOf(newNode), endOf(newNode))) throw new EditError('sourceStructure');
  return next;
}

const whitespace = n => ['JSXText', 'text'].includes(n.type) && !n.value.trim();
// Choose the smallest continuous group of sibling blocks enclosing the mapped
// leaves. Never jump across a component, expression, definition, or raw script.
export function selectionScope(body, format, ranges) {
  const start = Math.min(...ranges.map(r => r.start));
  const end = Math.max(...ranges.map(r => r.end));
  const candidates = sourceScopes(body, format).filter(s => s.start <= start && s.end >= end);
  walk(tree(body, format), parent => {
    const siblings = children(parent);
    const first = siblings.findIndex(n => startOf(n) <= start && endOf(n) > start);
    const last = siblings.findIndex(n => startOf(n) < end && endOf(n) >= end);
    if (first < 0 || last <= first) return;
    const selected = siblings.slice(first, last + 1);
    if (!selected.every(n => whitespace(n) || (kind(n) && safe(n, format, body)))) return;
    candidates.push({ start: startOf(selected[0]), end: endOf(selected.at(-1)), type: 'fragment' });
  });
  const scope = candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  if (!scope) throw new EditError('selectionStructure');
  if (scope.end - scope.start > 16_384) throw new EditError('tooLarge', 413);
  return scope;
}
function fragmentSignature(ast, body, start, end, format) {
  let group;
  walk(ast, parent => {
    const siblings = children(parent);
    const selected = siblings.filter(n => startOf(n) >= start && endOf(n) <= end);
    if (!selected.length || body.slice(start, startOf(selected[0])).trim() || body.slice(endOf(selected.at(-1)), end).trim()) return;
    if (!selected.every(n => whitespace(n) || (kind(n) && safe(n, format, body)))) return;
    group = { siblings, selected };
  });
  if (!group || !group.selected.some(n => !whitespace(n))) throw new EditError('sourceStructure');
  return JSON.stringify(ast, (key, value) => {
    if (value === group.siblings) {
      const first = value.indexOf(group.selected[0]), last = value.indexOf(group.selected.at(-1));
      return [...value.slice(0, first), { type: 'copyedit-source-range' }, ...value.slice(last + 1)];
    }
    if (['position', 'start', 'end', 'raw', 'estree'].includes(key)) return undefined;
    return value;
  });
}
