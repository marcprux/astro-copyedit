import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const files = Object.fromEntries(['md', 'mdx', 'html'].map(format => [format, new URL(`../../.test-sites/demo/src/pages/selection-${format}.${format === 'html' ? 'astro' : format}`, import.meta.url)]));
const originals = {};
test.beforeAll(async () => { for (const [format, path] of Object.entries(files)) originals[format] = await readFile(path, 'utf8'); });
test.afterEach(async ({ page }) => { await page.close(); for (const [format, path] of Object.entries(files)) if (await readFile(path, 'utf8') !== originals[format]) await writeFile(path, originals[format]); });
async function open(page, format) {
  await page.goto(`/selection-${format}/`); await page.waitForLoadState('networkidle');
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
async function select(page, first, last, backward = false, keyboard = false) {
  if (!await page.locator('.editor').isVisible()) {
    await page.locator('astro-dev-toolbar #dev-bar').focus();
    await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
  }
  const start = await first.elementHandle(), end = await last.elementHandle();
  await page.evaluate(({ start, end, backward, keyboard }) => {
    document.activeElement?.blur();
    const a = start.firstChild, b = end.firstChild;
    const selection = window.getSelection();
    selection.removeAllRanges();
    if (backward) selection.setBaseAndExtent(b, b.textContent.length, a, 0);
    else selection.setBaseAndExtent(a, 0, b, b.textContent.length);
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(keyboard ? new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }) : new PointerEvent('pointerup', { bubbles: true }));
  }, { start, end, backward, keyboard });
}
for (const format of ['md', 'mdx', 'html']) test(`${format} selection opens and saves a continuous multi-paragraph source fragment`, async ({ page }) => {
  await open(page, format);
  const first = page.locator('[data-copyedit-id]').filter({ hasText: /^First $/ }).first();
  const last = page.locator('[data-copyedit-id]').filter({ hasText: /^Second paragraph with a $/ }).first();
  await select(page, first, last, format === 'mdx');
  const editor = page.locator('.raw-source');
  const original = format === 'html' ? '<p>First <strong>bold</strong> paragraph.</p>\n<p>Second paragraph with a <a href="https://example.org">link</a>.</p>' : 'First **bold** paragraph.\n\nSecond paragraph with a [link](https://example.org).';
  await expect(editor).toHaveValue(original);
  expect(await editor.evaluate(n => n.value.slice(n.selectionStart, n.selectionEnd))).toBe(original.slice(format === 'html' ? 3 : 0, original.indexOf(format === 'html' ? '<a ' : '[link')));
  await expect(page.locator('[contenteditable]')).toHaveCount(0);
  await expect(page.getByLabel('Edit block', { exact: true })).toHaveValue('0');
  const replacement = format === 'html' ? '<p>Updated <em>first</em> paragraph.</p>\n<p>Updated second.</p>' : 'Updated _first_ paragraph.\n\nUpdated second.\n\nAn added third.';
  await editor.fill(replacement);
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.getByRole('button', { name: `Save to ${format === 'html' ? 'Astro' : format === 'mdx' ? 'MDX' : 'Markdown'}`, exact: true }).click(),
  ]);
  await expect.poll(() => readFile(files[format], 'utf8')).toBe(originals[format].replace(original, replacement));
  await expect(page.locator('p').filter({ hasText: 'Updated second.' })).toBeVisible();
});
test('a real mouse drag and a keyboard selection open the source panel', async ({ page }) => {
  await open(page, 'html');
  const first = page.locator('#single p').first();
  const last = page.locator('#single p').last();
  const a = await first.boundingBox(), b = await last.boundingBox();
  await page.mouse.move(a.x + 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.raw-source')).toHaveValue(/<p>First[\s\S]*<p>Second/);
  await page.keyboard.press('Escape');
  await select(page, first.locator('[data-copyedit-id]').first(), last.locator('[data-copyedit-id]').first(), false, true);
  await expect(page.locator('.raw-source')).toHaveValue(/<p>First[\s\S]*<p>Second/);
});
test('mixed files, repeated component instances, and unmapped text report limitations without enabling Save', async ({ page }) => {
  await open(page, 'html');
  for (const [section, message] of [['mixed', 'multiple source files'], ['repeated', 'repeated or reordered'], ['dynamic', 'no verified editable source']]) {
    const nodes = page.locator(`#${section} [data-copyedit-id]`);
    await select(page, nodes.first(), nodes.last());
    await expect(page.getByRole('status')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Save to Astro', exact: true })).toBeDisabled();
    await expect(page.locator('.raw-source')).toBeHidden();
    await page.keyboard.press('Escape');
  }
  expect(await readFile(files.html, 'utf8')).toBe(originals.html);
});
test('a fragment draft survives an external change and is rejected on stale save', async ({ page }) => {
  await open(page, 'md');
  const first = page.locator('[data-copyedit-id]').filter({ hasText: /^First $/ }).first();
  const last = page.locator('[data-copyedit-id]').filter({ hasText: /^Second paragraph with a $/ }).first();
  await select(page, first, last);
  await expect(page.locator('.raw-source')).toBeVisible();
  await page.locator('.raw-source').fill('New first.\n\nNew second.');
  const external = originals.md + '\nExternal synthetic change.\n';
  await writeFile(files.md, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status')).toContainText(/changed since|out of date/);
  await expect(page.locator('.raw-source')).toHaveValue('New first.\n\nNew second.');
  expect(await readFile(files.md, 'utf8')).toBe(external);
  await page.keyboard.press('Escape');
});
