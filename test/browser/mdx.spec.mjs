import { replaceInSource, selectForEditing } from './helpers.mjs';
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../../.test-sites/demo/src/pages/mdx.mdx', import.meta.url);
let original;
test.beforeAll(async () => { original = await readFile(path, 'utf8'); });
test.afterEach(async ({ page }) => { await page.close(); await writeFile(path, original); });
async function open(page) {
  await page.goto('/mdx/');
  await page.waitForLoadState('networkidle');
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
test('MDX page saves prose and JSX children while preserving expressions and markup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const word = page.locator('strong [data-copyedit-id]').filter({ hasText: /^tpyo$/ });
  await selectForEditing(page, word); await replaceInSource(page, await word.textContent(), 'typo');
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.getByRole('button', { name: 'Save to MDX', exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await expect.poll(() => readFile(path, 'utf8')).toBe(original.replace('**tpyo**', '**typo**'));
  await expect(page.locator('strong [data-copyedit-id]').filter({ hasText: /^typo$/ })).toBeVisible();
  await expect(page.locator('[contenteditable]')).toHaveCount(0);
  const child = page.locator('.mdx-callout strong [data-copyedit-id]');
  await selectForEditing(page, child); await replaceInSource(page, await child.textContent(), 'mistake');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => readFile(path, 'utf8')).toBe(original.replace('**tpyo**', '**typo**').replace('<strong>mistakke</strong>', '<strong>mistake</strong>'));
  await expect(page.locator('.mdx-callout')).toHaveAttribute('title', 'Attributes stay in the source editor');
  await expect(page.locator('p').filter({ hasText: 'This sentence comes from an expression' }).locator('[data-copyedit-id]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('MDX cancellation and conflict checks protect drafts; code and opt-outs stay read-only', async ({ page }) => {
  await open(page);
  await expect(page.locator('code [data-copyedit-id], pre [data-copyedit-id], [data-copyedit-ignore] [data-copyedit-id]')).toHaveCount(0);
  const word = page.locator('strong [data-copyedit-id]').filter({ hasText: /^tpyo$/ });
  await selectForEditing(page, word); await replaceInSource(page, await word.textContent(), 'cancel this');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readFile(path, 'utf8')).toBe(original);
  await selectForEditing(page, word); await replaceInSource(page, await word.textContent(), 'browser draft');
  const external = original + '\nExternal synthetic MDX change.\n';
  await writeFile(path, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.getByRole('button', { name: 'Save to MDX', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/out of date|changed since/);
  await expect(page.locator('.raw-source')).toHaveValue(/browser draft/);
  expect(await readFile(path, 'utf8')).toBe(external);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
