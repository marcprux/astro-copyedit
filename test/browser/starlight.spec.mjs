import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../../.test-sites/starlight/src/content/docs/index.md', import.meta.url);
const mdxPath = new URL('../../.test-sites/starlight/src/content/docs/components.mdx', import.meta.url);
let original, originalMdx;
test.beforeAll(async () => { original = await readFile(path, 'utf8'); originalMdx = await readFile(mdxPath, 'utf8'); });
test.afterEach(async ({ page }) => { await page.close(); await writeFile(path, original); await writeFile(mdxPath, originalMdx); });
async function open(page) {
  await page.goto('http://127.0.0.1:4324/');
  await page.waitForLoadState('networkidle');
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
test('standard Starlight Markdown saves with title, navigation, asides, and code intact', async ({ page }) => {
  await open(page);
  const word = page.locator('.sl-markdown-content strong [data-copyedit-id]').filter({ hasText: /^tpyo$/ });
  await word.click(); await word.fill('typo');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect.poll(() => readFile(path, 'utf8')).toBe(original.replace('**tpyo**', '**typo**'));
  await expect(page.locator('.sl-markdown-content strong [data-copyedit-id]').filter({ hasText: /^typo$/ })).toBeVisible();
  await expect(page.locator('#_top')).toHaveText('Editing documentation');
  await expect(page.locator('#_top [data-copyedit-id], nav [data-copyedit-id], pre [data-copyedit-id]')).toHaveCount(0);
  await expect(page.locator('.starlight-aside')).toContainText('mistakke');
  await expect(page.locator('.expressive-code')).toContainText('Code is read-only');
});
test('Starlight heading saves refresh the heading link and table of contents', async ({ page }) => {
  await open(page);
  const heading = page.locator('.sl-markdown-content h2 [data-copyedit-id]').filter({ hasText: 'A heading to improve' });
  await heading.click(); await heading.fill('A corrected heading');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => readFile(path, 'utf8')).toBe(original.replace('A heading to improve', 'A corrected heading'));
  await expect(page.locator('.sl-markdown-content #a-corrected-heading')).toBeVisible();
  await expect(page.locator('starlight-toc a[href="#a-corrected-heading"]').first()).toBeVisible();

});

test('Starlight MDX saves inside imported components and refreshes heading navigation', async ({ page }) => {
  await page.goto('http://127.0.0.1:4324/components/');
  await page.waitForLoadState('networkidle');
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
  const child = page.locator('.starlight-aside strong [data-copyedit-id]').filter({ hasText: /^mistakke$/ });
  await child.click(); await child.fill('mistake');
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.getByRole('button', { name: 'Save to MDX', exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await expect.poll(() => readFile(mdxPath, 'utf8')).toBe(originalMdx.replace('**mistakke**', '**mistake**'));
  await expect(page.locator('.starlight-aside strong [data-copyedit-id]').filter({ hasText: /^mistake$/ })).toBeVisible();
  const heading = page.locator('.sl-markdown-content h2 [data-copyedit-id]');
  await heading.click(); await heading.fill('Corrected MDX heading');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => readFile(mdxPath, 'utf8')).toBe(originalMdx.replace('**mistakke**', '**mistake**').replace('## Copyedit and components', '## Corrected MDX heading'));
  await expect(page.locator('.sl-markdown-content #corrected-mdx-heading')).toBeVisible();
  await expect(page.locator('starlight-toc a[href="#corrected-mdx-heading"]').first()).toBeVisible();
  await expect(page.locator('#_top [data-copyedit-id], pre [data-copyedit-id], [data-copyedit-ignore] [data-copyedit-id]')).toHaveCount(0);
  await expect(page.locator('.sl-markdown-content')).toContainText('An expression supplies this sentence.');
});
