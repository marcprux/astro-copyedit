import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sources } from '../src/source.js';
import { astroTextLeaves, patchAstroText, copyeditAstro } from '../src/astro.js';

// Synthetic source fixtures, independent of publication content in the demo.
async function fixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'copyedit-astro-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'Page.astro');
  await writeFile(path, source);
  const sources = new Sources({ root, roots: [root] });
  const transformed = await copyeditAstro(sources).transform.handler(source, path);
  return { path, sources, transformed };
}
test('Astro source spans preserve frontmatter, inline markup, CRLF, Unicode, and styles', async t => {
  const original = '---\r\nconst label = "untouched";\r\n---\r\n<Layout><h1>Café 🌿 <b>tpyo</b>!</h1></Layout>\r\n<style>h1 { color: red; }</style>';
  const f = await fixture(t, original);
  assert.match(f.transformed.code, /data-copyedit-format="astro"/);
  assert(f.transformed.map.mappings);
  const id = [...f.sources.records].find(([, r]) => r.text === 'tpyo')[0];
  await f.sources.save(id, 'typo');
  assert.equal(await readFile(f.path, 'utf8'), original.replace('tpyo', 'typo'));
});
test('Astro excludes expressions, code, attributes, raw HTML, hydrated subtrees, entities, and ignored content', () => {
  const source = '<p title="attribute">allowed {value}</p><script>const a="script";</script><style>p{color:red}</style><pre>code</pre><svg><text>vector</text></svg><p data-copyedit-ignore>ignored</p><p is:raw>raw</p><Widget client:load><p>hydrated</p></Widget><p>&amp;</p><p>{[1].map(x => <b>expression</b>)}</p>';
  assert.deepEqual(astroTextLeaves(source).map(n => n.value), ['allowed ']);
});
test('Astro duplicates get distinct mappings and stale saves fail', async t => {
  const f = await fixture(t, '<p>same</p><p>same</p>');
  const ids = [...f.sources.records.keys()];
  assert.equal(ids.length, 2);
  await f.sources.save(ids[1], 'second');
  assert.equal(await readFile(f.path, 'utf8'), '<p>same</p><p>second</p>');
  await assert.rejects(f.sources.save(ids[0], 'stale'), { code: 'conflict' });
});
test('Astro saves escape executable syntax and keep the template structure', () => {
  const source = '<p>word</p>';
  const result = patchAstroText(source, 3, 7, '<script>{code} & text</script>');
  assert.equal(result, '<p>&lt;script&gt;&#123;code&#125; &amp; text&lt;/script&gt;</p>');
  assert.equal(patchAstroText(source, 3, 7, 'literal &amp;'), '<p>literal &amp;amp;</p>');
  assert.throws(() => patchAstroText(source, 3, 7, ''), { code: 'structure' });
  assert.throws(() => patchAstroText(source, 3, 7, 'two\nlines'), { code: 'invalidText' });
  assert.throws(() => patchAstroText(source, 3, 7, '\u0000'), { code: 'invalidText' });
});
test('Astro rejects transformed inputs and virtual submodules; retains untouched newlines', async t => {
  const f = await fixture(t, '<p>First line\nwith a tpyo.</p>');
  const id = [...f.sources.records.keys()][0];
  await f.sources.save(id, 'First line\nwith a typo.');
  assert.equal(await readFile(f.path, 'utf8'), '<p>First line\nwith a typo.</p>');
  assert.equal(await f.sources.prepareAstro(f.path, '<p>transformed</p>'), null);
  assert.equal(await copyeditAstro(f.sources).transform.handler('ignored', `${f.path}?astro&type=style`), undefined);
});
