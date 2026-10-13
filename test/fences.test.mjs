import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import { compile } from '@mdx-js/mdx';
import expressiveCode from 'rehype-expressive-code';
import { Sources } from '../src/source.js';
import { copyeditFences } from '../src/fences.js';
import { sourceScopes, patchSource } from '../src/raw.js';

// Synthetic code examples are rendered as text, never evaluated.
async function fixture(t, source, { format = 'md', plugins = [], expressive = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'copyedit-fences-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, `fixture.${format}`);
  await writeFile(path, source);
  const sources = new Sources({ root, roots: [root] });
  const render = async () => {
    const { content, frontmatter } = parseFrontmatter(await readFile(path, 'utf8'), { frontmatter: 'empty-with-spaces' });
    const options = { remarkPlugins: [...plugins, copyeditFences(sources)], rehypePlugins: expressive ? [expressiveCode] : [] };
    if (format === 'mdx') return String(await compile({ value: content, path }, options));
    const renderer = await createMarkdownProcessor({ ...options, ...(expressive ? { syntaxHighlight: false } : {}) });
    return (await renderer.render(content, { fileURL: pathToFileURL(path), frontmatter })).code;
  };
  return { path, sources, render, output: await render() };
}
for (const expressive of [false, true]) test(`fence provenance survives ${expressive ? 'Expressive Code' : 'Shiki'} highlighting; save edits code, language and metadata`, async t => {
  const fence = '```js title="before.js"\r\nconst value = 1;\r\n```';
  const original = '---\r\ntitle: Synthetic fixture\r\n---\r\nBefore.\r\n\r\n' + fence + '\r\n\r\nAfter.';
  const f = await fixture(t, original, { expressive });
  assert.match(f.output, /data-copyedit-code-id/);
  assert.match(f.output, expressive ? /expressive-code/ : /astro-code/);
  const [id] = f.sources.records.keys();
  assert.equal((await f.sources.source(id, '')).text, fence);
  const selected = await f.sources.source(id, undefined, 0, { start: 6, end: 11 });
  assert.equal(selected.text.replace(/\r\n/g, '\n').slice(selected.selection.start, selected.selection.end), 'value');
  await assert.rejects(f.sources.save(id, 'plain text'), { code: 'sourceOnly' });
  const replacement = '```ts title="after.ts"\nconst value: number = 2;\n```';
  await f.sources.save(id, replacement, 'source');
  assert.equal(await readFile(f.path, 'utf8'), original.replace(fence, replacement.replace(/\n/g, '\r\n')));
  assert.match(await f.render(), /data-copyedit-code-id/);
});
test('MDX code examples containing scripts stay inert and preserve imports and expressions', async t => {
  const fence = '```html\n<script>example()</script>\n```';
  const original = 'import Box from "./Box.astro";\n\n' + fence + '\n\n{generated}\n';
  const f = await fixture(t, original, { format: 'mdx' });
  const [id] = f.sources.records.keys();
  const replacement = '```jsx\n<Component onClick={() => example()} />\n```';
  await f.sources.save(id, replacement, 'source');
  assert.equal(await readFile(f.path, 'utf8'), original.replace(fence, replacement));
  await f.render();
});
test('duplicate and empty fences retain distinct source ranges; indented and generated code is not guessed', async t => {
  const f = await fixture(t, '```\n```\n\n```js\nsame\n```\n\n```js\nsame\n```\n\n    indented\n');
  const ids = [...f.sources.records.keys()];
  assert.equal(ids.length, 3);
  await f.sources.save(ids[2], '```js\ndifferent\n```', 'source');
  assert.equal(await readFile(f.path, 'utf8'), '```\n```\n\n```js\nsame\n```\n\n```js\ndifferent\n```\n\n    indented\n');
  await assert.rejects(f.sources.source(ids[0], ''), { code: 'conflict' });
  function changeCode() { return tree => { tree.children[0].value = 'generated'; }; }
  const generated = await fixture(t, '```js\noriginal\n```', { plugins: [changeCode] });
  assert.equal(generated.sources.records.size, 0);
});
test('fence saves reject missing or escaped delimiters, code-to-prose conversion, and stale source', async t => {
  const f = await fixture(t, '```js\noriginal\n```\n\nUntouched.');
  const [id] = f.sources.records.keys();
  for (const text of ['```js\nchanged', '```js\nchanged\n~~~', '```js\nchanged\n```\n\n<script>run()</script>', 'changed prose']) {
    await assert.rejects(f.sources.save(id, text, 'source'), { code: 'sourceStructure' });
  }
  await writeFile(f.path, 'External revision.');
  await assert.rejects(f.sources.save(id, '```js\nchanged\n```', 'source'), { code: 'conflict' });
  assert.equal(await readFile(f.path, 'utf8'), 'External revision.');
});
test('fences support tildes, longer delimiters, nesting, and empty code without consuming nearby prose', () => {
  for (const body of ['Before\n\n~~~~md\n```js\nexample\n```\n~~~~\n\nAfter', '> ```js\n> one\n> ```\n\nAfter', '- List\n\n  ```js\n  one\n  ```\n\nAfter']) {
    const scope = sourceScopes(body, 'md').find(s => s.type === 'code');
    assert(scope, body);
    const raw = body.slice(scope.start, scope.end);
    assert.equal(patchSource(body, scope, raw.replace(/one|example/, 'changed'), 'md'), body.replace(/one|example/, 'changed'));
  }
  assert.equal(sourceScopes('```js\nunterminated\n> ```', 'md').length, 0);
  assert.equal(sourceScopes('```js\nunterminated', 'md').length, 0);
});
test('MDX code fences inside opt-out elements are not instrumented', async t => {
  const f = await fixture(t, '<div data-copyedit-ignore>\n\n```js\nuntouched\n```\n\n</div>', { format: 'mdx' });
  assert.equal(f.sources.records.size, 0);
  assert.doesNotMatch(f.output, /data-copyedit-code-id/);
});
