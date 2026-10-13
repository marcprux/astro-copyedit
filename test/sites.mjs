import { cp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
export const sites = new URL('.test-sites/', root);
export async function prepareSite(name) {
  const target = new URL(`${name}/`, sites);
  await mkdir(sites, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(new URL(name === 'demo' ? 'demo/' : 'examples/starlight/', root), target, {
    recursive: true,
    filter: source => !/(?:^|[/\\])(?:node_modules|\.astro|dist)(?:[/\\]|$)/.test(source),
  });
  // The copied demo keeps its relative imports of localized interface strings.
  await symlink(new URL('src/', root), new URL('src', sites), 'dir').catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (name === 'demo') {
    // Synthetic browser fixtures isolate selection and component-boundary cases.
    const paragraphs = 'First **bold** paragraph.\n\nSecond paragraph with a [link](https://example.org).';
    for (const format of ['md', 'mdx']) await writeFile(new URL(`src/pages/selection-${format}.${format}`, target), `---\nlayout: ../layouts/Note.astro\ntitle: Synthetic selection fixture\n---\nBefore.\n\n${paragraphs}\n\nAfter.\n`);
    await writeFile(new URL('src/components/SelectionOther.astro', target), '<p>Text from another component.</p>');
    await writeFile(new URL('src/pages/selection-html.astro', target), `---
import Other from '../components/SelectionOther.astro';
const generated = 'Generated text without a source mapping.';
---
<html><body>
<section id="single"><p>First <strong>bold</strong> paragraph.</p>
<p>Second paragraph with a <a href="https://example.org">link</a>.</p></section>
<section id="mixed"><p>Text from the page.</p><Other /></section>
<section id="repeated"><Other /><Other /></section>
<section id="dynamic"><p>Before generated.</p><p>{generated}</p><p>After generated.</p></section>
</body></html>`);
  }
  // Synthetic source-selection fixtures, including decoded text and inline code.
  const mapped = 'Repeated same same 🌿 "quotes" &amp; coffee...\n\nUse `const value = 1` with **bold** and a [link](https://example.org).';
  const formats = name === 'demo' ? ['md', 'mdx'] : ['md'];
  for (const format of formats) await writeFile(new URL(name === 'demo' ? `src/pages/mapping-${format}.${format}` : 'src/content/docs/mapping.md', target), `---\ntitle: Synthetic mapping fixture\n${name === 'demo' ? 'layout: ../layouts/Note.astro\n' : ''}---\n${mapped}\n`);
  if (name === 'demo') await writeFile(new URL('src/pages/mapping-astro.astro', target), '<html><body><p>Repeated same same 🌿.</p><p>Use <code>const value = 1</code> with <strong>bold</strong>.</p></body></html>');
  return target;
}
