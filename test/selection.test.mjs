import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sources } from '../src/source.js';
import { selectionScope, patchSource } from '../src/raw.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { astroTextLeaves } from '../src/astro.js';

// Synthetic fixtures exercise source boundaries, not publication content.
async function fixture(t, body, format = 'md') {
  const root = await mkdtemp(join(tmpdir(), 'copyedit-selection-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const path = join(root, `fixture.${format}`);
  await writeFile(path, body);
  const sources = new Sources({ root, roots: [root] });
  const register = await sources[format === 'astro' ? 'prepareAstro' : 'prepare'](path, body);
  const ids = [];
  if (format === 'astro') for (const node of astroTextLeaves(body)) ids.push(register(node).id);
  else {
    const parser = unified().use(remarkParse);
    if (format === 'mdx') parser.use(remarkMdx);
    const visit = n => { if (n.type === 'text') { const m = register(n); if (m) ids.push(m.id); } (n.children ?? []).forEach(visit); };
    visit(parser.parse(body));
  }
  return { root, path, sources, ids };
}
for (const format of ['md', 'mdx', 'astro']) test(`${format} selection expands to sibling blocks and preserves outside source and CRLF`, async t => {
  const fragment = format === 'astro' ? '<p>First <strong>bold</strong>.</p>\r\n<p>Second paragraph.</p>' : 'First **bold**.\r\n\r\nSecond paragraph.';
  const body = format === 'astro' ? `---\nconst untouched = 1;\n---\n<section>\n${fragment}\n<p>Outside.</p>\n</section>` : `Before.\r\n\r\n${fragment}\r\n\r\nAfter.`;
  const f = await fixture(t, body, format);
  const ids = f.ids.filter(id => /First|bold|^\.$|Second/.test(f.sources.records.get(id).text));
  const draft = await f.sources.selection(ids);
  assert.equal(draft.text, fragment);
  assert.equal(draft.scopes[0].type, 'fragment');
  const replacement = fragment.replace('First', 'New first').replace('Second paragraph.', 'Second **example**.');
  await f.sources.save(draft.id, replacement.replaceAll('\r\n', '\n'), 'source');
  assert.equal(await readFile(f.path, 'utf8'), body.replace(fragment, replacement));
  await assert.rejects(f.sources.save(draft.id, replacement, 'source'), { code: 'conflict' });
});
test('fragment edits can merge or split paragraphs but cannot consume adjacent text or insert executable MDX', () => {
  const body = 'Before.\n\nFirst.\n\nSecond.\n\nAfter.';
  const scope = selectionScope(body, 'mdx', [{ start: 9, end: 15 }, { start: 17, end: 24 }]);
  assert.equal(patchSource(body, scope, 'Combined.', 'mdx'), 'Before.\n\nCombined.\n\nAfter.');
  assert.equal(patchSource(body, scope, 'One.\n\nTwo.\n\nThree.', 'mdx'), 'Before.\n\nOne.\n\nTwo.\n\nThree.\n\nAfter.');
  for (const text of ['<script>run()</script>', '{run()}', '<Component />', '```js\nno closer', '[definition]: https://example.org']) {
    assert.throws(() => patchSource(body, scope, text, 'mdx'), { code: 'sourceStructure' });
  }
});
test('selections reject mixed files, source reordering, repeated component instances, and intervening expressions', async t => {
  const f = await fixture(t, 'First.\n\nSecond.');
  const other = join(f.root, 'other.md'); await writeFile(other, 'Other.');
  const register = await f.sources.prepare(other, 'Other.');
  const otherId = register(unified().use(remarkParse).parse('Other.').children[0].children[0]).id;
  await assert.rejects(f.sources.selection([f.ids[0], otherId]), { code: 'selectionFiles' });
  await assert.rejects(f.sources.selection([...f.ids].reverse()), { code: 'selectionOrder' });
  await assert.rejects(f.sources.selection([f.ids[0], f.ids[0]]), { code: 'selectionOrder' });
  const g = await fixture(t, 'First.\n\n{generated}\n\nSecond.', 'mdx');
  await assert.rejects(g.sources.selection(g.ids), { code: 'selectionStructure' });
  const h = await fixture(t, '<One>\n\nFirst.\n\n</One>\n\n<Two>\n\nSecond.\n\n</Two>', 'mdx');
  await assert.rejects(h.sources.selection(h.ids), { code: 'selectionStructure' });
});
test('selection keeps single-paragraph formatting and rejects oversized source fragments', async t => {
  const f = await fixture(t, 'First **bold** paragraph.');
  const draft = await f.sources.selection(f.ids);
  assert.equal(draft.text, 'First **bold** paragraph.');
  assert.equal(draft.scopes[0].type, 'paragraph');
  const g = await fixture(t, 'First.\n\n' + 'x'.repeat(16_384) + '\n\nLast.');
  await assert.rejects(g.sources.selection(g.ids), { code: 'tooLarge' });
});
test('a fragment can include neighboring fenced code, and components between selected blocks are rejected', () => {
  const body = 'Before.\n\n```js\nconst value = 1;\n```\n\nAfter.';
  const scope = selectionScope(body, 'md', [{ start: 0, end: 7 }, { start: 9, end: 35 }]);
  assert.equal(scope.type, 'fragment');
  const fragment = body.slice(scope.start, scope.end);
  assert.equal(patchSource(body, scope, fragment.replace('Before', 'Updated').replace('value = 1', 'value = 2'), 'md'), body.replace('Before', 'Updated').replace('value = 1', 'value = 2'));
  const mdx = '<p>First.</p>\n\n<Component />\n\n<p>Last.</p>';
  assert.throws(() => selectionScope(mdx, 'mdx', [{ start: 3, end: 9 }, { start: mdx.indexOf('Last'), end: mdx.indexOf('Last') + 5 }]), { code: 'selectionStructure' });
});
