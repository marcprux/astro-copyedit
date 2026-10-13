import { replaceInSource, selectForEditing } from './helpers.mjs';
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
  await selectForEditing(page, word);
  await replaceInSource(page, await word.textContent(), 'proofread');
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
  await selectForEditing(page, words.nth(1));
  await replaceInSource(page, 'repeat', 'cancelled', true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readFile(sourcePath, 'utf8')).toBe(original);
  await expect(words).toHaveCount(2);
  await selectForEditing(page, words.nth(1));
  await replaceInSource(page, 'repeat', 'unique', true);
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => readFile(sourcePath, 'utf8')).toBe(original.replace('**repeat** and **repeat**', '**repeat** and **unique**'));
});
test('external changes retain the browser draft and reject stale saves', async ({ page }) => {
  await open(page);
  await toggleCopyedit(page);
  const word = page.locator('strong [data-copyedit-id]').first();
  await selectForEditing(page, word);
  await replaceInSource(page, await word.textContent(), 'my draft');
  const external = original + '\nExternal synthetic test change.\n';
  await writeFile(sourcePath, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/out of date|changed since/);
  await expect(page.locator('.raw-source')).toHaveValue(/my draft/);
  expect(await readFile(sourcePath, 'utf8')).toBe(external);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('Markdown page routes and localized editor controls work', async ({ page }) => {
  await open(page);
  await page.locator('#editor-locale').selectOption('es');
  await toggleCopyedit(page);
  await selectForEditing(page, page.locator('strong [data-copyedit-id]').first());
  await expect(page.getByRole('button', { name: 'Guardar en Markdown', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await toggleCopyedit(page);
  await open(page, '/notes/');
  await toggleCopyedit(page);
  const word = page.locator('strong [data-copyedit-id]').first();
  await selectForEditing(page, word);
  await replaceInSource(page, await word.textContent(), 'proofread');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect.poll(() => readFile(pagePath, 'utf8')).toBe(originalPage.replace(`**${firstBold(originalPage)}**`, '**proofread**'));
  await expect(page.locator('article strong').first()).toContainText('proofread');
});
test('toolbar toggles the overlay and preserves hidden unsaved drafts without changing the page', async ({ page }) => {
  await open(page);
  const editor = page.locator('astro-dev-toolbar-window.editor');
  await expect(editor).toBeHidden();
  await toggleCopyedit(page);
  await expect(editor).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Select text on the page');
  await expect(page.locator('[data-copyedit-mode], [data-copyedit-id][role], [data-copyedit-id][tabindex]')).toHaveCount(0);
  const word = page.locator('strong [data-copyedit-id]').first();
  await selectForEditing(page, word);
  await replaceInSource(page, await word.textContent(), 'unsaved draft');
  await toggleCopyedit(page);
  await expect(editor).toBeHidden();
  await toggleCopyedit(page);
  await expect(page.locator('.raw-source')).toHaveValue(/unsaved draft/);
  await expect(word).toHaveText(firstBold(original));
  await expect(page.locator('[contenteditable]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await toggleCopyedit(page);
  await expect(page.locator('.raw-source')).toHaveValue(/unsaved draft/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(editor).toBeHidden();
  expect(await readFile(sourcePath, 'utf8')).toBe(original);
});
async function toggleCopyedit(page) {
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
