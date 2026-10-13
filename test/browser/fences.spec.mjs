import { selectForEditing } from './helpers.mjs';
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const cases = [
  { route: '/notes/', file: 'demo/src/pages/notes.md', format: 'Markdown', expressive: false },
  { route: '/mdx/', file: 'demo/src/pages/mdx.mdx', format: 'MDX', expressive: false },
  { route: 'http://127.0.0.1:4324/', file: 'starlight/src/content/docs/index.md', format: 'Markdown', expressive: true },
  { route: 'http://127.0.0.1:4324/components/', file: 'starlight/src/content/docs/components.mdx', format: 'MDX', expressive: true },
];
const originals = new Map();
test.beforeAll(async () => { for (const item of cases) { item.path = new URL(`../../.test-sites/${item.file}`, import.meta.url); originals.set(item.file, await readFile(item.path, 'utf8')); } });
test.afterEach(async ({ page }) => { await page.close(); for (const item of cases) if (await readFile(item.path, 'utf8') !== originals.get(item.file)) await writeFile(item.path, originals.get(item.file)); });
async function open(page, route) {
  await page.goto(route); await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-copyedit-fence]')).toHaveCount(0);
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
  await expect(page.locator('pre [data-copyedit-id], code [data-copyedit-id]')).toHaveCount(0);
}
for (const item of cases) test(`${item.format} code fence saves and re-highlights with ${item.expressive ? 'Expressive Code' : 'Shiki'}`, async ({ page }) => {
  await open(page, item.route);
  const wrapper = page.locator('[data-copyedit-code-id]').first();
  await selectForEditing(page, wrapper);
  const editor = page.getByRole('textbox', { name: 'Fenced code source', exact: true });
  await expect(editor).toBeVisible();
  const originalFence = await editor.inputValue();
  expect(await editor.evaluate(n => n.value.slice(n.selectionStart, n.selectionEnd))).toBe(await wrapper.locator('pre code').textContent());
  expect(originalFence).toMatch(/^```js/);
  await expect(page.getByRole('button', { name: 'Back to inline', exact: true })).toBeHidden();
  const replacement = '```ts title="updated.ts"\nconst example: number = 42;\nconsole.log(example);\n```';
  await editor.fill(replacement);
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.getByRole('button', { name: `Save to ${item.format}`, exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  expect(await readFile(item.path, 'utf8')).toBe(originals.get(item.file).replace(originalFence, replacement));
  await expect(wrapper.locator('pre code')).toContainText('const example: number = 42;');
  await expect(wrapper.locator('pre [style]').first()).toBeAttached();
  await expect(wrapper.locator('pre [contenteditable]')).toHaveCount(0);
  if (item.expressive) {
    await expect(wrapper.locator('.frame .title')).toHaveText('updated.ts');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await wrapper.locator('.copy button').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('const example: number = 42;\nconsole.log(example);');
  }
});
test('code fence drafts survive invalid saves and conflicts; cancel leaves highlighted markup intact', async ({ page }) => {
  const item = cases[0];
  await open(page, item.route);
  const wrapper = page.locator('[data-copyedit-code-id]').first();
  const highlighted = await wrapper.locator('pre').innerHTML();
  await selectForEditing(page, wrapper);
  const editor = page.getByRole('textbox', { name: 'Fenced code source', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill('```js\nmissing closer');
  await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('closed fence');
  await expect(editor).toHaveValue('```js\nmissing closer');
  expect(await readFile(item.path, 'utf8')).toBe(originals.get(item.file));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await wrapper.locator('pre').innerHTML()).toBe(highlighted);
  await selectForEditing(page, wrapper);
  await editor.fill('```js\nnew draft\n```');
  const external = originals.get(item.file) + '\nExternal synthetic revision.\n';
  await writeFile(item.path, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status')).toContainText(/changed since|out of date/);
  await expect(editor).toHaveValue('```js\nnew draft\n```');
  expect(await readFile(item.path, 'utf8')).toBe(external);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('a failed code source load can be retried or canceled without disabling prose saves', async ({ page }) => {
  await open(page, '/notes/');
  await page.route('**/__copyedit__/save', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict' }) }));
  const button = page.locator('[data-copyedit-code-id]').first();
  const save = page.getByRole('button', { name: 'Save to Markdown', exact: true });
  await button.evaluate(node => { document.activeElement?.blur(); const r = document.createRange(); r.selectNodeContents(node.querySelector('pre code')); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); });
  await expect(page.getByRole('status')).toContainText('changed since');
  await expect(save).toBeDisabled();
  await page.unroute('**/__copyedit__/save');
  await page.getByRole('button', { name: 'Retry loading source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Fenced code source', exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.route('**/__copyedit__/save', route => route.abort());
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
  await button.evaluate(node => { document.activeElement?.blur(); const r = document.createRange(); r.selectNodeContents(node.querySelector('pre code')); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); });
  await expect(page.getByRole('status')).not.toBeEmpty();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.unroute('**/__copyedit__/save');
  await selectForEditing(page, page.locator('p [data-copyedit-id]').first());
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
