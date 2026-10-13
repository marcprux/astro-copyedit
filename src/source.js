import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath, stat, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, join } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import { parseFrontmatter } from '@astrojs/markdown-remark';

import { EditError } from './errors.js';
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
    if (node.type === 'text' && node.position?.start.offset === start && node.position?.end.offset === end && node.value === old) {
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
  async prepareAstro(path, body) {
    let target;
    try { target = await this.canonical(path); } catch { return null; }
    if (extname(target).toLowerCase() !== '.astro') return null;
    const source = await readFile(target, 'utf8');
    if (source !== body) return null;
    const leaves = new Set(astroTextLeaves(source).map(node => `${node.start}:${node.end}`));
    const snapshot = this.snapshot(target, source);
    this.onSource(path, target);
    return node => {
      const { start, end } = node;
      const key = `${start}:${end}`;
      if (!leaves.has(key) || source.slice(start, end) !== node.value) return null;
      let id = snapshot.ids.get(key);
      if (!id) {
        id = randomBytes(16).toString('hex');
        snapshot.ids.set(key, id);
        this.records.set(id, { target, path, revision: snapshot.revision, bodyStart: 0, body, start, end, text: node.value, format: 'astro' });
      }
      return { id, source: `${relative(this.root, path).split('\\').join('/')}:${source.slice(0, start).split('\n').length}` };
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
    const leaves = new Map();
    walk(parserFor(format).parse(body), node => {
      if (node.type === 'text' && node.position) leaves.set(`${node.position.start.offset}:${node.position.end.offset}`, node.value);
    });
    this.onSource(path, target);
    return (node) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const key = `${start}:${end}`;
      if (!Number.isInteger(start) || !Number.isInteger(end) || !node.value.trim() || body.slice(start, end) !== node.value || leaves.get(key) !== node.value) return null;
      const absoluteStart = bodyStart + start;
      const recordKey = `${absoluteStart}:${bodyStart + end}`;
      let id = snapshot.ids.get(recordKey);
      if (!id) {
        id = randomBytes(16).toString('hex');
        snapshot.ids.set(recordKey, id);
        this.records.set(id, { target, path, revision, bodyStart, body, start, end, text: node.value, format });
      }
      const line = source.slice(0, absoluteStart).split('\n').length;
      return { id, source: `${relative(this.root, path).split('\\').join('/')}:${line}` };
    };
  }
  async save(id, text) {
    const record = this.records.get(id);
    if (!record) throw new EditError('unknownId', 409);
    const previous = this.locks.get(record.target) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.write(record, text));
    this.locks.set(record.target, task);
    try { return await task; } finally { if (this.locks.get(record.target) === task) this.locks.delete(record.target); }
  }
  async write(record, text) {
    const target = await this.canonical(record.path);
    if (target !== record.target) throw new EditError('conflict', 409);
    const source = await readFile(target, 'utf8');
    if (digest(source) !== record.revision) throw new EditError('conflict', 409);
    const start = record.bodyStart + record.start;
    const end = record.bodyStart + record.end;
    if (source.slice(start, end) !== record.text) throw new EditError('conflict', 409);
    const body = (record.format === 'astro' ? patchAstroText : patchText)(record.body, record.start, record.end, text, record.format);
    const replacement = body.slice(record.start, body.length - (record.body.length - record.end));
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
