import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../../.test-sites/demo/src/content/articles/playground.md', import.meta.url);
const pagePath = new URL('../../.test-sites/demo/src/pages/notes.md', import.meta.url);
let original, originalPage;
const firstBold = source => source.match(/\*\*([^*]+)\*\*/)[1];
test.beforeAll(async () => { original = await readFile(sourcePath, 'utf8'); originalPage = await readFile(pagePath, 'utf8'); });
test.afterEach(async ({ page }) => {
  await page.close();
  if (await readFile(sourcePath, 'utf8') !== original) await writeFile(sourcePath, original);
  if (await readFile(pagePath, 'utf8') !== originalPage) await writeFile(pagePath, originalPage);
});
async function open(page, path = '/') {
  await page.goto(path);
  // Let any content-store reload caused by the preceding fixture restore finish.
  await page.waitForLoadState('networkidle');
}
test('edits a bold word through the browser, writes only the correction, and reloads', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await toggleCopyedit(page);
  const word = page.locator('strong [data-copyedit-id]').first();
  await word.click();
  await word.fill('proofread');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect(page.locator('strong [data-copyedit-id]').filter({ hasText: /^proofread$/ })).toBeVisible();
  await expect.poll(() => readFile(sourcePath, 'utf8')).toBe(original.replace(`**${firstBold(original)}**`, '**proofread**'));
  await expect(page.locator('[contenteditable="plaintext-only"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('cancel preserves the source, duplicate words are independent, and code stays protected', async ({ page }) => {
  await open(page);
  await toggleCopyedit(page);
  await expect(page.locator('pre [data-copyedit-id], code [data-copyedit-id]')).toHaveCount(0);
  const words = page.locator('strong [data-copyedit-id]').filter({ hasText: /^repeat$/ });
  await words.nth(1).click();
  await words.nth(1).fill('cancelled');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readFile(sourcePath, 'utf8')).toBe(original);
  await expect(words).toHaveCount(2);
  await words.nth(1).click();
  await words.nth(1).fill('unique');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => readFile(sourcePath, 'utf8')).toBe(original.replace('**repeat** and **repeat**', '**repeat** and **unique**'));
});
test('external changes retain the browser draft and reject stale saves', async ({ page }) => {
  await open(page);
  await toggleCopyedit(page);
  const word = page.locator('strong [data-copyedit-id]').first();
  await word.click();
  await word.fill('my draft');
  const external = original + '\nExternal synthetic test change.\n';
  await writeFile(sourcePath, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/out of date|changed since/);
  await expect(page.locator('[contenteditable="plaintext-only"]')).toHaveText('my draft');
  expect(await readFile(sourcePath, 'utf8')).toBe(external);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('Markdown page routes and localized editor controls work', async ({ page }) => {
  await open(page);
  await page.locator('#editor-locale').selectOption('es');
  await toggleCopyedit(page);
  await page.locator('strong [data-copyedit-id]').first().click();
  await expect(page.getByRole('button', { name: 'Guardar en Markdown', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await toggleCopyedit(page);
  await open(page, '/notes/');
  await toggleCopyedit(page);
  const word = page.locator('strong [data-copyedit-id]').first();
  await word.click();
  await word.fill('proofread');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect.poll(() => readFile(pagePath, 'utf8')).toBe(originalPage.replace(`**${firstBold(originalPage)}**`, '**proofread**'));
  await expect(page.locator('article strong')).toContainText('proofread');
});
test('toolbar is the sole activation control and keeps unsaved edits open', async ({ page }) => {
  await open(page);
  const editor = page.locator('astro-dev-toolbar-window.editor');
  await expect(page.locator('copyedit-panel')).toHaveCount(0);
  await expect(editor).toBeHidden();
  await toggleCopyedit(page);
  await expect(page.locator('html')).toHaveAttribute('data-copyedit-mode', '');
  await expect(editor).toBeHidden();
  const word = page.locator('strong [data-copyedit-id]').first();
  await word.click();
  await word.fill('unsaved draft');
  await expect(page.getByRole('button', { name: 'Save to Markdown', exact: true })).toBeVisible();
  await toggleCopyedit(page);
  await expect(word).toHaveText('unsaved draft');
  await expect(word).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.press('Escape');
  await expect(word).toHaveText(firstBold(original));
  await expect(page.getByRole('button', { name: 'Save to Markdown', exact: true })).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-copyedit-mode', '');
  await toggleCopyedit(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-copyedit-mode');
  expect(await readFile(sourcePath, 'utf8')).toBe(original);
});
async function toggleCopyedit(page) {
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
