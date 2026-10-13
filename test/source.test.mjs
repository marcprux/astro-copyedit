import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, lstat, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import { Sources, patchText } from '../src/source.js';
import { copyeditRehype } from '../src/rehype.js';

// All text and files here are synthetic fixtures, never the editable demo content.
async function fixture(t, source, plugins = []) {
  const root = await mkdtemp(join(tmpdir(), 'copyedit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'fixture.md');
  await writeFile(path, source);
  const sources = new Sources({ root, roots: [root] });
  const render = async () => {
    const raw = await readFile(path, 'utf8');
    const { content, frontmatter } = parseFrontmatter(raw);
    const renderer = await createMarkdownProcessor({ syntaxHighlight: false, rehypePlugins: [...plugins, copyeditRehype(sources)] });
    return (await renderer.render(content, { frontmatter, fileURL: pathToFileURL(path) })).code;
  };
  const html = await render();
  const idFor = text => [...sources.records].find(([, record]) => record.text === text)?.[0];
  return { root, path, sources, render, html, idFor };
}
test('bold typo changes only its source characters, preserving frontmatter and CRLF', async t => {
  const original = '---\r\ntitle: Synthetic fixture\r\n---\r\nThis is my **misspellled** string.\r\n';
  const f = await fixture(t, original);
  assert.match(f.html, /<strong><span data-copyedit-id=/);
  await f.sources.save(f.idFor('misspellled'), 'misspelled');
  assert.equal(await readFile(f.path, 'utf8'), original.replace('misspellled', 'misspelled'));
  assert.match(await f.render(), />misspelled<\/span>/);
});
test('duplicate words have independent provenance', async t => {
  const f = await fixture(t, '**same** and **same**');
  const ids = [...f.sources.records].filter(([, r]) => r.text === 'same').map(([id]) => id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  await f.sources.save(ids[1], 'different');
  assert.equal(await readFile(f.path, 'utf8'), '**same** and **different**');
});
test('link labels preserve destinations; inserted syntax is literal text', async t => {
  const f = await fixture(t, '[helpfull](https://example.test/path "fixture")');
  await f.sources.save(f.idFor('helpfull'), 'helpful *word* <script>');
  const result = await readFile(f.path, 'utf8');
  assert.match(result, /\]\(https:\/\/example\.test\/path "fixture"\)$/);
  const html = await f.render();
  assert.match(html, /helpful \*word\* &#x3C;script>/);
  assert.doesNotMatch(html, /<script>/);
});
test('stale edits and simultaneous saves cannot overwrite a newer revision', async t => {
  const f = await fixture(t, '**one** and **two**');
  const first = f.idFor('one');
  const second = f.idFor('two');
  const results = await Promise.allSettled([f.sources.save(first, 'ONE'), f.sources.save(second, 'TWO')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'conflict');
  assert.equal(await readFile(f.path, 'utf8'), '**ONE** and **two**');
  await writeFile(f.path, '**external edit**');
  await assert.rejects(f.sources.save(first, 'overwrite'), { code: 'conflict' });
  assert.equal(await readFile(f.path, 'utf8'), '**external edit**');
});
test('code, transformed typography, entities, and ambiguous plugin positions are read-only', async t => {
  function splitWithoutPositions() {
    return tree => {
      const paragraph = tree.children.find(n => n.type === 'element' && n.tagName === 'p');
      const original = paragraph.children[0];
      paragraph.children = [{ ...original, value: 'generated' }, ...paragraph.children.slice(1)];
    };
  }
  const f = await fixture(t, 'original text\n\n`code`\n\n```js\nconst code = 1;\n```\n\n"quotes" &amp; more', [splitWithoutPositions]);
  assert.equal(f.sources.records.size, 0);
  assert.doesNotMatch(f.html, /data-copyedit-id/);
});
test('Unicode and table cell edits retain the existing structure', async t => {
  const f = await fixture(t, '| Heading |\n| --- |\n| Café 🌿 tpyo |\n');
  await f.sources.save(f.idFor('Café 🌿 tpyo'), 'Café 🌿 typo');
  assert.equal(await readFile(f.path, 'utf8'), '| Heading |\n| --- |\n| Café 🌿 typo |\n');
});
test('rejects formatting destruction, multiline insertion, invalid text, and unknown IDs', async t => {
  const f = await fixture(t, '**word**');
  const id = f.idFor('word');
  await assert.rejects(f.sources.save(id, ''), { code: 'structure' });
  await assert.rejects(f.sources.save(id, ' leading'), { code: 'structure' });
  await assert.rejects(f.sources.save(id, 'new\nparagraph'), { code: 'invalidText' });
  await assert.rejects(f.sources.save(id, '\u0000'), { code: 'invalidText' });
  await assert.rejects(f.sources.save('unknown', 'text'), { code: 'unknownId' });
  assert.equal(await readFile(f.path, 'utf8'), '**word**');
});
test('a word correction preserves soft line breaks elsewhere in the same text run', () => {
  const body = 'First line\nwith a tpyo here.';
  assert.equal(patchText(body, 0, body.length, body.replace('tpyo', 'typo')), 'First line\nwith a typo here.');
});
test('symlinks require allowed real targets and are preserved when saving', async t => {
  const f = await fixture(t, 'fixture');
  const allowed = join(f.root, 'allowed');
  const outside = join(f.root, 'outside');
  await mkdir(allowed); await mkdir(outside);
  const target = join(outside, 'target.md');
  const link = join(allowed, 'link.md');
  await writeFile(target, '**tpyo**');
  await chmod(target, 0o664);
  await symlink(target, link);
  const restricted = new Sources({ root: f.root, roots: [allowed] });
  assert.equal(await restricted.prepare(link, '**tpyo**'), null);
  const sources = new Sources({ root: f.root, roots: [allowed, outside] });
  const register = await sources.prepare(link, '**tpyo**');
  const mapping = register({ value: 'tpyo', position: { start: { offset: 2 }, end: { offset: 6 } } });
  await sources.save(mapping.id, 'typo');
  assert.equal(await readFile(target, 'utf8'), '**typo**');
  assert((await lstat(link)).isSymbolicLink());
  assert.equal((await stat(target)).mode & 0o777, 0o664);
});
test('no guessed mapping when the supplied body is not an exact source suffix', async t => {
  const f = await fixture(t, 'actual source');
  assert.equal(await f.sources.prepare(f.path, 'transformed body'), null);
});
test('content collections can trim body whitespace without losing full-file offsets', async t => {
  const original = '---\ntitle: Synthetic fixture\n---\n\n**tpyo**\n\n';
  const f = await fixture(t, original);
  const register = await f.sources.prepare(f.path, '**tpyo**');
  const mapping = register({ value: 'tpyo', position: { start: { offset: 2 }, end: { offset: 6 } } });
  await f.sources.save(mapping.id, 'typo');
  assert.equal(await readFile(f.path, 'utf8'), original.replace('tpyo', 'typo'));
});
test('page routes mask frontmatter without changing its original bytes', async t => {
  const original = '---\nlayout: ../layouts/Test.astro\ntitle: Synthetic fixture\n---\n\n**tpyo**\n';
  const f = await fixture(t, original);
  const body = parseFrontmatter(original, { frontmatter: 'empty-with-spaces' }).content;
  const register = await f.sources.prepare(f.path, body);
  const start = body.indexOf('tpyo');
  const mapping = register({ value: 'tpyo', position: { start: { offset: start }, end: { offset: start + 4 } } });
  await f.sources.save(mapping.id, 'typo');
  assert.equal(await readFile(f.path, 'utf8'), original.replace('tpyo', 'typo'));
});
