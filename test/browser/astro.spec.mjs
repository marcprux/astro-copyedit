import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../../.test-sites/demo/src/components/PracticeArticle.astro', import.meta.url);
let original;
test.beforeAll(async () => { original = await readFile(path, 'utf8'); });
test.afterEach(async ({ page }) => { await page.close(); await writeFile(path, original); });
async function open(page) {
  await page.goto('/astro/');
  await page.waitForLoadState('networkidle');
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
test('Astro template edits preserve markup and scoped styles across a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(page.locator('[data-copyedit-format="astro"]')).not.toHaveCount(0);
  const word = page.locator('strong [data-copyedit-id]').first();
  const before = await word.evaluate(node => getComputedStyle(node.parentElement).fontWeight);
  const previous = await word.textContent();
  await word.click();
  await word.fill('corrected');
  await page.getByRole('button', { name: 'Save to Astro', exact: true }).click();
  await expect.poll(() => readFile(path, 'utf8')).toBe(original.replace(`<strong>${previous}</strong>`, '<strong>corrected</strong>'));
  await expect(page.locator('strong [data-copyedit-id]').first()).toHaveText('corrected');
  await expect(page.locator('[contenteditable]')).toHaveCount(0);
  await expect(page.locator('strong').first()).toHaveCSS('font-weight', before);
  expect(errors).toEqual([]);
});
test('Astro expressions and opt-outs stay read-only, cancel and stale checks protect source', async ({ page }) => {
  await open(page);
  await expect(page.locator('pre [data-copyedit-id], [data-copyedit-ignore] [data-copyedit-id]')).toHaveCount(0);
  await expect(page.locator('p').filter({ hasText: 'This sentence comes from an expression' }).locator('[data-copyedit-id]')).toHaveCount(0);
  const word = page.locator('strong [data-copyedit-id]').first();
  await word.click(); await word.fill('draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await readFile(path, 'utf8')).toBe(original);
  await word.click(); await word.fill('unsaved');
  const external = original + '\n<!-- External synthetic test change -->\n';
  await writeFile(path, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.getByRole('button', { name: 'Save to Astro', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/out of date|changed since/);
  expect(await readFile(path, 'utf8')).toBe(external);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
