import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sources } from '../src/source.js';
import { sourceScopes, patchSource } from '../src/raw.js';

// Synthetic fixtures, never the user's demo documents.
async function fixture(t, source, format = 'md', word = 'bold') {
  const root = await mkdtemp(join(tmpdir(), 'copyedit-raw-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, `fixture.${format}`);
  await writeFile(path, source);
  const sources = new Sources({ root, roots: [root] });
  const register = await (format === 'astro' ? sources.prepareAstro(path, source) : sources.prepare(path, source));
  const start = source.indexOf(word), end = start + word.length;
  const mapping = register(format === 'astro' ? { start, end, value: word } : { value: word, position: { start: { offset: start }, end: { offset: end } } });
  assert(mapping);
  return { sources, path, id: mapping.id, mapping };
}
const paragraph = 'This is _some_ **bold** text and a [link](https://example.org) that I can edit in a single run.';
test('raw Markdown merges an inline draft, changes several runs and links, and preserves surrounding bytes', async t => {
  const original = '# Before\r\n\r\n' + paragraph + '\r\n\r\nAfter.\r\n';
  const f = await fixture(t, original);
  const draft = await f.sources.source(f.id, 'strong');
  assert.equal(draft.text, paragraph.replace('bold', 'strong'));
  assert.equal(await readFile(f.path, 'utf8'), original);
  const replacement = 'This is **different** text\nand an [updated link](https://example.org/new).';
  await f.sources.save(f.id, replacement, 'source');
  assert.equal(await readFile(f.path, 'utf8'), original.replace(paragraph, replacement.replace('\n', '\r\n')));
});
test('source scopes expose an enclosing list without permitting changes to surrounding blocks', async t => {
  const original = 'Before.\n\n- **bold** and _other_\n- second\n\nAfter.';
  const f = await fixture(t, original);
  const { scopes } = await f.sources.source(f.id, 'bold');
  const index = scopes.findIndex(s => s.type === 'list');
  assert(index >= 0);
  const list = await f.sources.source(f.id, 'bold', index);
  assert.equal(list.text, '- **bold** and _other_\n- second');
  await assert.rejects(f.sources.save(f.id, 'changed\n\n[ref]: /changed', 'source'), { code: 'sourceStructure' });
  await f.sources.save(f.id, '- **first**\n- _second_\n- third', 'source', index);
  assert.equal(await readFile(f.path, 'utf8'), 'Before.\n\n- **first**\n- _second_\n- third\n\nAfter.');
});
test('source drafts keep revision checks, unknown-ID checks, per-file serialization, and size limits', async t => {
  const f = await fixture(t, paragraph);
  await assert.rejects(f.sources.source('missing', 'bold'), { code: 'unknownId' });
  await assert.rejects(f.sources.save(f.id, 'x'.repeat(16_385), 'source'), { code: 'tooLarge' });
  await assert.rejects(f.sources.save(f.id, '', 'source'), { code: 'sourceStructure' });
  await assert.rejects(f.sources.save(f.id, 'bad\0text', 'source'), { code: 'sourceStructure' });
  await assert.rejects(f.sources.source(f.id, 'bold', 999), { code: 'sourceUnavailable' });
  const results = await Promise.allSettled([f.sources.save(f.id, 'Updated **source**.', 'source'), f.sources.save(f.id, 'other')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(f.sources.source(f.id, 'bold'), { code: 'conflict' });
  await writeFile(f.path, 'External revision.');
  await assert.rejects(f.sources.save(f.id, 'stale', 'source'), { code: 'conflict' });
  assert.equal(await readFile(f.path, 'utf8'), 'External revision.');
});
test('MDX raw prose edits retain imports, expressions, and component attributes outside the selected block', async t => {
  const original = 'import Box from "./Box.astro";\n\n<Box title="unchanged">\n\n' + paragraph + '\n\n</Box>\n\n{computed}\n';
  const f = await fixture(t, original, 'mdx');
  const draft = await f.sources.source(f.id, 'bold');
  assert.equal(draft.text, paragraph);
  assert.equal(draft.scopes.length, 1, 'A component cannot become a source-editable ancestor');
  for (const text of ['Text {run()}', '<script>run()</script>', '<Widget />', '<span onClick="run()">text</span>']) {
    await assert.rejects(f.sources.save(f.id, text, 'source'), { code: 'sourceStructure' });
  }
  await f.sources.save(f.id, '<p>New <em>formatting</em> and a <a href="/next">link</a>.</p>', 'source');
  assert.equal(await readFile(f.path, 'utf8'), original.replace(paragraph, '<p>New <em>formatting</em> and a <a href="/next">link</a>.</p>'));
});
test('Astro HTML source edits preserve frontmatter, styles, and surrounding templates', async t => {
  const block = '<p class="lead">This is <em>some</em> <b>bold</b> and <a href="/old">a link</a>.</p>';
  const original = '---\nconst keep = 1;\n---\n<Layout>' + block + '<p>{computed}</p></Layout>\n<style>p { color: red; }</style>';
  const f = await fixture(t, original, 'astro');
  assert.equal((await f.sources.source(f.id, 'strong')).text, block.replace('bold', 'strong'));
  const replacement = '<p class="lead">New <strong>words</strong> and <a href="/new" title="Details">a link</a>.</p>';
  await f.sources.save(f.id, replacement, 'source');
  assert.equal(await readFile(f.path, 'utf8'), original.replace(block, replacement));
});
test('raw edits reject executable constructs and changes escaping the selected HTML range', () => {
  const body = '<p>bold</p><p>untouched</p>';
  const scope = sourceScopes(body, 'astro')[0];
  for (const text of [
    '<script>run()</script>', '<p>{run()}</p>', '<p onclick="run()">bad</p>', '<p><a href="java&#x73;cript:run()">bad</a></p>',
    '<p><a href="data:text/html,bad">bad</a></p>', '<p style="color:red">bad</p>', '<p client:load>bad</p>',
    '<p>first</p><p>second</p>', '<p>unclosed', '<Custom>bad</Custom>', '<p><!-- hidden --></p>',
  ]) assert.throws(() => patchSource(body, scope, text, 'astro'), { code: 'sourceStructure' }, text);
  assert.equal(sourceScopes('<p>bold {computed}</p>', 'astro').length, 0);
  assert.equal(sourceScopes('<p data-copyedit-ignore>bold</p>', 'astro').length, 0);
  assert.equal(sourceScopes('Text <Custom /> here.', 'mdx').length, 0);
});
test('Markdown raw mode rejects HTML and definitions that would affect other source ranges', () => {
  const body = paragraph + '\n\n[ref]: /original\n';
  const scope = sourceScopes(body, 'md')[0];
  for (const text of ['<script>run()</script>', '[bad](javascript:run)', '[ref]: /changed', 'one\n\ntwo']) {
    assert.throws(() => patchSource(body, scope, text, 'md'), { code: 'sourceStructure' });
  }
});

test('raw source accepts surrounding whitespace without escaping the selected block', () => {
  const body = 'Before.\n\n**bold** text.\n\nAfter.';
  const scope = sourceScopes(body, 'md').find(s => body.slice(s.start, s.end) === '**bold** text.');
  assert.equal(patchSource(body, scope, '\nNew _formatting_.\n', 'md'), body.replace('**bold** text.', '\nNew _formatting_.\n'));
});

test('collection source edits use file line endings even when the trimmed body has no newline', async t => {
  const original = '---\r\ntitle: Synthetic fixture\r\n---\r\nbold text';
  const f = await fixture(t, original, 'md', 'bold text');
  const sources = new Sources({ root: f.sources.root, roots: [f.sources.root] });
  const register = await sources.prepare(f.path, 'bold text');
  const { id } = register({ value: 'bold text', position: { start: { offset: 0 }, end: { offset: 9 } } });
  await sources.save(id, 'bold\ntext', 'source');
  assert.equal(await readFile(f.path, 'utf8'), original.replace('bold text', 'bold\r\ntext'));
});
