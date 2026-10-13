import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { Sources } from '../src/source.js';
import { copyeditRehype } from '../src/rehype.js';

// Synthetic MDX fixtures: compiling does not execute their imports or expressions.
async function fixture(t, source, plugins = []) {
  const root = await mkdtemp(join(tmpdir(), 'copyedit-mdx-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'fixture.mdx');
  await writeFile(path, source);
  const sources = new Sources({ root, roots: [root] });
  const render = async () => {
    const value = parseFrontmatter(await readFile(path, 'utf8'), { frontmatter: 'empty-with-spaces' }).content;
    return String(await compile({ value, path }, { remarkPlugins: [remarkGfm], rehypePlugins: [...plugins, copyeditRehype(sources)] }));
  };
  const code = await render();
  const idFor = text => [...sources.records].find(([, record]) => record.text === text)?.[0];
  return { root, path, sources, code, render, idFor };
}
test('MDX preserves frontmatter, imports, exports, expressions, attributes, and CRLF when correcting prose', async t => {
  const original = '---\r\ntitle: Synthetic MDX\r\n---\r\n\r\nimport Box from "./Box.astro";\r\n\r\nThis **tpyo** precedes JavaScript.\r\n\r\nexport const label = "unchanged";\r\n\r\n<Box title={label}>Child text {label}.</Box>\r\n';
  const f = await fixture(t, original);
  assert.match(f.code, /data-copyedit-format/);
  await f.sources.save(f.idFor('tpyo'), 'typo corrected');
  assert.equal(await readFile(f.path, 'utf8'), original.replace('**tpyo**', '**typo corrected**'));
  assert.match(await f.render(), /typo corrected/);
});
test('MDX JSX child text is editable and duplicate passages remain independent', async t => {
  const original = '<Aside title="same"><strong>same</strong> and <strong>same</strong></Aside>';
  const f = await fixture(t, original);
  const ids = [...f.sources.records].filter(([, record]) => record.text === 'same').map(([id]) => id);
  assert.equal(ids.length, 2);
  await f.sources.save(ids[1], 'different');
  assert.equal(await readFile(f.path, 'utf8'), '<Aside title="same"><strong>same</strong> and <strong>different</strong></Aside>');
});
test('MDX excludes JavaScript, raw pre blocks, attributes, ignored and hydrated subtrees', async t => {
  const source = 'export const label = "generated";\n\n{label}\n\n<Box title="attribute" />\n\n<div data-copyedit-ignore>ignored</div>\n\n<Widget client:load><p>hydrated</p></Widget>\n\n<pre><code>code</code></pre>\n\n<svg><text>vector</text></svg>\n\n`inline`\n\n```js\nconst a = 1;\n```\n';
  const f = await fixture(t, source);
  assert.equal(f.sources.records.size, 1);
  assert(f.idFor('inline'));
});
test('MDX insertion escapes executable syntax instead of introducing components or expressions', async t => {
  const f = await fixture(t, '**word**\n\nexport const keep = 42;\n');
  const replacement = '<Widget /> {danger()} & *literal*';
  await f.sources.save(f.idFor('word'), replacement);
  const source = await readFile(f.path, 'utf8');
  assert(source.includes('\\<Widget \\/\\> \\{danger\\(\\)\\}'));
  assert(source.endsWith('\n\nexport const keep = 42;\n'));
  const code = await f.render();
  assert.doesNotMatch(code, /_createMdxContent.*danger\(\)/);
  assert(f.idFor(replacement), 'Escaped prose remains editable through the source editor');
});
test('MDX stale edits and attempts to remove structure cannot overwrite source', async t => {
  const f = await fixture(t, '<Aside>**word**</Aside>');
  const id = f.idFor('word');
  await assert.rejects(f.sources.save(id, ''), { code: 'structure' });
  await assert.rejects(f.sources.save(id, 'two\nlines'), { code: 'invalidText' });
  await writeFile(f.path, '<Aside>external</Aside>');
  await assert.rejects(f.sources.save(id, 'stale'), { code: 'conflict' });
  assert.equal(await readFile(f.path, 'utf8'), '<Aside>external</Aside>');
});
test('MDX rejects generated text with copied positions and supports table cells', async t => {
  function mutateText() {
    return tree => {
      const paragraph = tree.children.find(n => n.tagName === 'p');
      paragraph.children[0].value = 'generated';
    };
  }
  const f = await fixture(t, 'Original prose.\n\n| Heading |\n| --- |\n| Café 🌿 tpyo |\n', [mutateText]);
  assert.equal(f.idFor('generated'), undefined);
  await f.sources.save(f.idFor('Café 🌿 tpyo'), 'Café 🌿 typo');
  assert.equal(await readFile(f.path, 'utf8'), 'Original prose.\n\n| Heading |\n| --- |\n| Café 🌿 typo |\n');
});

test('literal inline HTML code in MDX participates in a complete paragraph source selection', async t => {
  const f = await fixture(t, 'Use <code>literal</code> and `markdown` together.');
  assert(f.idFor('literal'));
  assert(f.idFor('markdown'));
  const result = await f.sources.selection([...f.sources.records.keys()]);
  assert.equal(result.text, 'Use <code>literal</code> and `markdown` together.');
});
