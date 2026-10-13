import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath, stat, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, join } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import { parseFrontmatter } from '@astrojs/markdown-remark';

import { normalizedMap, proseMap, inlineCodeMap, fencedCodeMap, sourceSelection } from './text-map.js';
import { EditError } from './errors.js';
import { sourceScopes, patchSource, selectionScope } from './raw.js';
import { astroTextLeaves, patchAstroText } from './astro.js';
export { EditError } from './errors.js';

const parser = unified().use(remarkParse).use(remarkGfm);
const mdxParser = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
const parserFor = format => format === 'mdx' ? mdxParser : parser;
const digest = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel));
};
function walk(node, visit) { visit(node); node.children?.forEach(child => walk(child, visit)); }
// MDX stores a derived JavaScript AST with absolute offsets in data.estree.
// Its source value is compared verbatim on the enclosing MDX node instead.
function comparable(tree) {
  return JSON.stringify(tree, (key, value) => key === 'position' || key === 'estree' ? undefined : value);
}

/** Change only the differing characters, escaping inserted Markdown punctuation. */
export function patchText(body, start, end, text, format = 'md') {
  const parser = parserFor(format);
  if (typeof text !== 'string' || !text.isWellFormed() || [...text].some(char => { const code = char.charCodeAt(0); return code < 9 || (code > 10 && code < 32) || code === 127; })) throw new EditError('invalidText');
  if (text.length > 16_384) throw new EditError('tooLarge', 413);
  const old = body.slice(start, end);
  if (old === text) return body;
  let prefix = 0;
  while (prefix < old.length && prefix < text.length && old[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < text.length - prefix && old[old.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
  const inserted = text.slice(prefix, text.length - suffix);
  const removed = old.slice(prefix, old.length - suffix);
  if (/[\r\n]/.test(inserted + removed)) throw new EditError('invalidText');
  const escaped = inserted.replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, '\\$&');
  const next = body.slice(0, start + prefix) + escaped + body.slice(end - suffix);
  const expected = parser.parse(body);
  let found = false;
  walk(expected, node => {
    if (['text', 'inlineCode'].includes(node.type) && node.position?.start.offset === start && node.position?.end.offset === end && node.value === old) {
      node.value = text;
      found = true;
    }
  });
  if (!found || comparable(expected) !== comparable(parser.parse(next))) throw new EditError('structure');
  return next;
}

export class Sources {
  constructor({ root, roots, onSource = () => {} }) {
    this.root = root;
    this.roots = roots;
    this.onSource = onSource;
    this.records = new Map();
    this.files = new Map();
    this.locks = new Map();
  }
  async canonical(path) {
    const target = await realpath(path);
    const roots = await Promise.all(this.roots.map(root => realpath(root).catch(() => resolve(root))));
    if (!['.md', '.mdx', '.astro'].includes(extname(target).toLowerCase()) || !roots.some(root => inside(root, target))) throw new EditError('outsideRoot', 403);
    return target;
  }
  snapshot(target, source) {
    const revision = digest(source);
    let snapshot = this.files.get(target);
    if (!snapshot || snapshot.revision !== revision) {
      for (const id of snapshot?.ids.values() ?? []) this.records.delete(id);
      snapshot = { revision, ids: new Map() };
      this.files.set(target, snapshot);
    }
    return snapshot;
  }
  // All source kinds share stable IDs for a file revision. Build records only
  // once; snapshot() removes them together when that revision changes.
  remember(snapshot, key, createRecord) {
    let id = snapshot.ids.get(key);
    if (!id) {
      id = randomBytes(16).toString('hex');
      this.records.set(id, createRecord());
      snapshot.ids.set(key, id);
    }
    return id;
  }
  async prepareAstro(path, body) {
    let target;
    try { target = await this.canonical(path); } catch { return null; }
    if (extname(target).toLowerCase() !== '.astro') return null;
    const source = await readFile(target, 'utf8');
    if (source !== body) return null;
    const scopes = sourceScopes(body, 'astro');
    const leaves = new Set(astroTextLeaves(source).map(node => `${node.start}:${node.end}`));
    const snapshot = this.snapshot(target, source);
    this.onSource(path, target);
    return node => {
      const { start, end } = node;
      const key = `${start}:${end}`;
      if (!leaves.has(key) || source.slice(start, end) !== node.value) return null;
      const id = this.remember(snapshot, key, () => ({ target, path, revision: snapshot.revision, bodyStart: 0, body, start, end, text: node.value, map: normalizedMap(node.value, start), format: 'astro', scopes: scopes.filter(s => s.start <= start && s.end >= end) }));
      return { id, raw: this.records.get(id).scopes.length > 0, source: `${relative(this.root, path).split('\\').join('/')}:${source.slice(0, start).split('\n').length}` };
    };
  }
  async prepare(path, body) {
    let target;
    try { target = await this.canonical(path); } catch { return null; }
    const source = await readFile(target, 'utf8');
    const format = extname(target).toLowerCase().slice(1);
    if (!['md', 'mdx'].includes(format)) return null;
    // Collection loaders may trim the parsed body; page routes may retain its
    // whitespace. Match only these known transformations, never a text search.
    const content = parseFrontmatter(source).content;
    const masked = parseFrontmatter(source, { frontmatter: 'empty-with-spaces' }).content;
    let bodyStart;
    if (body === source) bodyStart = 0;
    else if (body === masked) bodyStart = 0;
    else if (body === masked.trim()) bodyStart = masked.length - masked.trimStart().length;
    else if (source.endsWith(content) && body === content) bodyStart = source.length - content.length;
    else if (source.endsWith(content) && body === content.trim()) bodyStart = source.length - content.length + content.length - content.trimStart().length;
    else return null;
    const snapshot = this.snapshot(target, source);
    const revision = snapshot.revision;
    const scopes = sourceScopes(body, format);
    const leaves = new Map();
    const fences = new Map();
    walk(parserFor(format).parse(body), node => {
      if (node.type === 'code' && node.position) fences.set(`${node.position.start.offset}:${node.position.end.offset}`, node);
      if (['text', 'inlineCode'].includes(node.type) && node.position) leaves.set(`${node.position.start.offset}:${node.position.end.offset}`, node);
    });
    this.onSource(path, target);
    const register = (node) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const key = `${start}:${end}`;
      const original = leaves.get(key);
      if (!Number.isInteger(start) || !Number.isInteger(end) || !node.value?.trim() || !original) return null;
      const raw = body.slice(start, end);
      const rendered = node.value.replace(/\r\n?/g, '\n');
      const map = original.type === 'inlineCode'
        ? (original.value === node.value ? inlineCodeMap(raw, rendered, start) : undefined)
        : proseMap(raw, original.value, rendered, start);
      if (map === undefined) return null;
      const absoluteStart = bodyStart + start;
      const recordKey = `${absoluteStart}:${bodyStart + end}`;
      const id = this.remember(snapshot, recordKey, () => ({ target, path, revision, bodyStart, body, start, end, text: rendered, map, sourceOnly: raw !== rendered, format, scopes: scopes.filter(s => s.start <= start && s.end >= end) }));
      const line = source.slice(0, absoluteStart).split('\n').length;
      return { id, raw: this.records.get(id).scopes.length > 0, source: `${relative(this.root, path).split('\\').join('/')}:${line}` };
    };
    register.fence = node => {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      const original = fences.get(`${start}:${end}`);
      const scope = scopes.find(s => s.type === 'code' && s.start === start && s.end === end);
      if (!scope || !original || original.value !== node.value || original.lang !== node.lang || original.meta !== node.meta) return null;
      const absoluteStart = bodyStart + start;
      const key = `fence:${absoluteStart}:${bodyStart + end}`;
      const id = this.remember(snapshot, key, () => ({ target, path, revision, bodyStart, body, start, end, text: node.value, map: fencedCodeMap(body.slice(start, end), node.value, start), format, scopes: [scope], sourceOnly: true }));
      return { id, source: `${relative(this.root, path).split('\\').join('/')}:${source.slice(0, absoluteStart).split('\n').length}` };
    };
    return register;
  }
  async readRecord(record) {
    const target = await this.canonical(record.path);
    if (target !== record.target) throw new EditError('conflict', 409);
    const source = await readFile(target, 'utf8');
    if (digest(source) !== record.revision) throw new EditError('conflict', 409);
    return { target, source };
  }
  async selection(ids, selection) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 256) throw new EditError('badRequest');
    const records = ids.map(id => {
      const record = this.records.get(id);
      if (!record) throw new EditError('unknownId', 409);
      return record;
    });
    const first = records[0];
    if (records.some(r => r.target !== first.target || r.format !== first.format)) throw new EditError('selectionFiles');
    await this.readRecord(first);
    if (records.some(r => r.revision !== first.revision)) throw new EditError('conflict', 409);
    if (records.some(r => r.bodyStart !== first.bodyStart || r.body !== first.body)) throw new EditError('selectionStructure');
    // DOM order must correspond to source order. Repeated component instances or
    // reordered snippets cannot be represented as one unambiguous source range.
    if (records.some((r, i) => i > 0 && r.start < records[i - 1].end)) throw new EditError('selectionOrder');
    const scope = selectionScope(first.body, first.format, records);
    const snapshot = this.files.get(first.target);
    const key = `selection:${first.bodyStart + scope.start}:${first.bodyStart + scope.end}`;
    const id = this.remember(snapshot, key, () => ({ ...first, ...scope, scopes: [scope], sourceOnly: true }));
    const selected = sourceSelection(first, records.at(-1), selection, scope);
    if (selected === null) throw new EditError('badRequest');
    return { ...await this.source(id), id, selection: selected };
  }
  async source(id, text, scopeIndex = 0, selection) {
    const record = this.records.get(id);
    if (!record) throw new EditError('unknownId', 409);
    const { source } = await this.readRecord(record);
    const scope = record.scopes[scopeIndex];
    if (!scope) throw new EditError('sourceUnavailable');
    // Carry an unsaved inline correction into the raw source without writing it.
    const body = record.sourceOnly || text === undefined ? record.body : (record.format === 'astro' ? patchAstroText : patchText)(record.body, record.start, record.end, text, record.format);
    const selected = sourceSelection(record, record, selection, scope);
    if (selected === null) throw new EditError('badRequest');
    return {
      selection: selected,
      text: body.slice(scope.start, scope.end + body.length - record.body.length),
      scopes: record.scopes.map(s => ({ type: s.type, tag: s.tag, source: `${relative(this.root, record.path).split('\\').join('/')}:${source.slice(0, record.bodyStart + s.start).split('\n').length}` })),
    };
  }
  async save(id, text, mode = 'text', scopeIndex = 0) {
    const record = this.records.get(id);
    if (!record) throw new EditError('unknownId', 409);
    const previous = this.locks.get(record.target) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.write(record, text, mode, scopeIndex));
    this.locks.set(record.target, task);
    try { return await task; } finally { if (this.locks.get(record.target) === task) this.locks.delete(record.target); }
  }
  async write(record, text, mode, scopeIndex) {
    if (record.sourceOnly && mode !== 'source') throw new EditError('sourceOnly');
    const { target, source } = await this.readRecord(record);
    const range = mode === 'source' ? record.scopes[scopeIndex] : record;
    if (!range) throw new EditError('sourceUnavailable');
    const start = record.bodyStart + range.start;
    const end = record.bodyStart + range.end;
    const body = mode === 'source'
      ? patchSource(record.body, range, text, record.format, source.includes('\r\n') ? '\r\n' : '\n')
      : (record.format === 'astro' ? patchAstroText : patchText)(record.body, record.start, record.end, text, record.format);
    const replacement = body.slice(range.start, body.length - (record.body.length - range.end));
    const next = source.slice(0, start) + replacement + source.slice(end);
    if (next === source) return { path: record.path, changed: false };
    const temporary = join(dirname(target), `.copyedit-${randomBytes(12).toString('hex')}.tmp`);
    try {
      const mode = (await stat(target)).mode & 0o777;
      await writeFile(temporary, next, { flag: 'wx', mode });
      await chmod(temporary, mode);
      if (await this.canonical(record.path) !== target || digest(await readFile(target, 'utf8')) !== record.revision) throw new EditError('conflict', 409);
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
    return { path: record.path, changed: true };
  }
}
