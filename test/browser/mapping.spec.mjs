import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { selectForEditing } from './helpers.mjs';
const cases = [
  { format: 'md', route: '/mapping-md/', file: 'demo/src/pages/mapping-md.md' },
  { format: 'mdx', route: '/mapping-mdx/', file: 'demo/src/pages/mapping-mdx.mdx' },
  { format: 'astro', route: '/mapping-astro/', file: 'demo/src/pages/mapping-astro.astro' },
  { format: 'starlight', route: 'http://127.0.0.1:4324/mapping/', file: 'starlight/src/content/docs/mapping.md' },
];
const original = new Map();
test.beforeAll(async () => { for (const item of cases) { item.path = new URL(`../../.test-sites/${item.file}`, import.meta.url); original.set(item.file, await readFile(item.path, 'utf8')); } });
test.afterEach(async ({ page }) => { await page.close(); for (const item of cases) if (await readFile(item.path, 'utf8') !== original.get(item.file)) await writeFile(item.path, original.get(item.file)); });
async function selected(page) { return page.locator('.raw-source').evaluate(n => ({ start: n.selectionStart, end: n.selectionEnd, text: n.value.slice(n.selectionStart, n.selectionEnd) })); }
async function selectWord(locator, word, last = false) {
  await locator.evaluate((node, { word, last }) => {
    document.activeElement?.blur();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const full = nodes.map(n => n.data).join('');
    const start = last ? full.lastIndexOf(word) : full.indexOf(word), end = start + word.length;
    if (start < 0) throw new Error('Missing synthetic selection word');
    const range = document.createRange();
    let offset = 0;
    for (const text of nodes) {
      if (start >= offset && start < offset + text.length) range.setStart(text, start - offset);
      if (end > offset && end <= offset + text.length) range.setEnd(text, end - offset);
      offset += text.length;
    }
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { word, last });
}
async function open(page) {
  await page.keyboard.press(await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta+Shift+E' : 'Control+Shift+E'));
}
for (const item of cases) test(`${item.format}: exact repeated-word selection, inline code paragraph, and source save`, async ({ page }) => {
  await page.goto(item.route); await page.waitForLoadState('networkidle');
  const paragraph = page.locator('p').filter({ hasText: /^Repeated same same/ });
  await selectWord(paragraph, 'same', true); await open(page);
  const editor = page.locator('.raw-source');
  await expect(editor).toBeVisible(); await expect(editor).toBeFocused();
  await expect.poll(() => selected(page)).toEqual({ start: item.format === 'astro' ? 17 : 14, end: item.format === 'astro' ? 21 : 18, text: 'same' });
  // A new range inside the same mapped element must update the selection.
  await selectWord(paragraph, 'same');
  await expect.poll(() => selected(page)).toEqual({ start: item.format === 'astro' ? 12 : 9, end: item.format === 'astro' ? 16 : 13, text: 'same' });
  await expect(editor).not.toBeFocused();
  if (item.format !== 'astro') {
    await selectWord(paragraph, '&');
    await expect.poll(async () => (await selected(page)).text).toBe('&amp;');
    // MDX does not necessarily enable smartypants; use the actual rendered quotes.
    const text = await paragraph.textContent();
    const quoted = text.includes('“') ? '“quotes”' : '"quotes"';
    await selectWord(paragraph, quoted);
    await expect.poll(async () => (await selected(page)).text).toBe('"quotes"');
  }
  const codeParagraph = page.locator('p').filter({ hasText: /^Use const value/ });
  await selectWord(codeParagraph, 'value');
  await expect.poll(async () => (await selected(page)).text).toBe('value');
  await selectForEditing(page, codeParagraph);
  await expect(editor).toHaveValue(item.format === 'astro' ? '<p>Use <code>const value = 1</code> with <strong>bold</strong>.</p>' : 'Use `const value = 1` with **bold** and a [link](https://example.org).');
  await expect.poll(async () => (await selected(page)).text).toBe(item.format === 'astro' ? 'Use <code>const value = 1</code> with <strong>bold</strong>.' : 'Use `const value = 1` with **bold** and a [link](https://example.org).');
  await editor.fill((await editor.inputValue()).replace('value', 'corrected'));
  await Promise.all([page.waitForEvent('framenavigated', f => f === page.mainFrame()), page.locator('.save').click()]);
  await expect.poll(() => readFile(item.path, 'utf8')).toBe(original.get(item.file).replace('value', 'corrected'));
  await expect(page.locator('p code')).toHaveText('const corrected = 1');
});
test('demo smart-punctuation paragraph is editable and source selection spans formatted runs', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  const paragraph = page.locator('p').filter({ hasText: /^Smart punctuation such as/ });
  await selectForEditing(page, paragraph);
  await expect(page.locator('.raw-source')).toHaveValue(/Smart punctuation such as "curly quotes".*&amp;/);
  await expect(page.locator('.save')).toBeEnabled();
  await page.goto('/mapping-md/'); await page.waitForLoadState('networkidle');
  const code = page.locator('p').filter({ hasText: /^Use const value/ });
  await selectWord(code, 'value = 1 with bold and a link'); await open(page);
  await expect.poll(async () => (await selected(page)).text).toBe('value = 1` with **bold** and a [link');
});
