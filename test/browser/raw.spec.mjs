import { selectForEditing, selectPageText } from './helpers.mjs';
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const files = {
  starlight: new URL('../../.test-sites/starlight/src/content/docs/components.mdx', import.meta.url),
  md: new URL('../../.test-sites/demo/src/pages/notes.md', import.meta.url),
  mdx: new URL('../../.test-sites/demo/src/pages/mdx.mdx', import.meta.url),
  astro: new URL('../../.test-sites/demo/src/components/PracticeArticle.astro', import.meta.url),
};
const originals = {};
const paragraph = 'This is _some_ **bold** text and a [link](https://example.org) that I can edit in a single run.';
test.beforeAll(async () => { for (const [format, file] of Object.entries(files)) originals[format] = await readFile(file, 'utf8'); });
test.afterEach(async ({ page }) => {
  await page.close();
  for (const [format, file] of Object.entries(files)) if (await readFile(file, 'utf8') !== originals[format]) await writeFile(file, originals[format]);
});
async function open(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.locator('astro-dev-toolbar #dev-bar').focus();
  await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
}
async function save(page, format) {
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.getByRole('button', { name: `Save to ${format}`, exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
}
for (const format of ['md', 'mdx']) {
  test(`${format} source editor opens directly and saves formatting across a whole paragraph`, async ({ page }, testInfo) => {
    await open(page, format === 'md' ? '/notes/' : '/mdx/');
    const word = page.locator('strong [data-copyedit-id]').filter({ hasText: /^bold$/ });
    await selectForEditing(page, word);
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toHaveValue(paragraph);
    expect(await readFile(files[format], 'utf8')).toBe(originals[format]);
    expect((await page.locator('.editor.expanded').boundingBox()).width).toBeGreaterThan(500);
    if (format === 'md') await page.screenshot({ path: testInfo.outputPath('source-editor.png') });
    const replacement = 'This is **new** text, _another phrase_, and an [updated link](https://example.org/updated).';
    await source.fill(replacement);
    await save(page, format === 'md' ? 'Markdown' : 'MDX');
    expect(await readFile(files[format], 'utf8')).toBe(originals[format].replace(paragraph, replacement));
    await expect(page.locator('a[href="https://example.org/updated"]')).toContainText('updated link');
    await expect(page.locator('em')).toContainText(['another phrase']);
  });
}
test('HTML source edits update Astro tags and link attributes without changing surrounding source', async ({ page }) => {
  await open(page, '/astro/');
  await selectForEditing(page, page.locator('strong [data-copyedit-id]').filter({ hasText: /^bold$/ }));
  const source = page.getByRole('textbox', { name: 'HTML source', exact: true });
  const original = '<p>This is <em>some</em> <strong>bold</strong> text and a <a href="https://example.org">link</a> that I can edit in a single run.</p>';
  await expect(source).toHaveValue(original);
  const replacement = '<p>A <strong>new phrase</strong> with <a href="https://example.org/updated">a new link</a>.</p>';
  await source.fill(replacement);
  await save(page, 'Astro');
  expect(await readFile(files.astro, 'utf8')).toBe(originals.astro.replace(original, replacement));
  await expect(page.locator('a[href="https://example.org/updated"]')).toContainText('a new link');
});
test('source draft survives a different selection and cancel leaves rendered content untouched', async ({ page }) => {
  await open(page, '/notes/');
  const word = page.locator('strong [data-copyedit-id]').filter({ hasText: /^bold$/ });
  await selectForEditing(page, word);
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await expect(source).toHaveValue(paragraph);
  await source.fill('Changed **source draft**.');
  await selectPageText(page, page.locator('h1 [data-copyedit-id]').first());
  await expect(source).toHaveValue('Changed **source draft**.');
  await expect(page.getByRole('status')).toContainText('unsaved draft');
  await expect(page.locator('[contenteditable]')).toHaveCount(0);
  await expect(word).toHaveText('bold');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(source).toBeHidden();
  expect(await readFile(files.md, 'utf8')).toBe(originals.md);
});
test('invalid source and conflicting external changes retain the raw draft', async ({ page }) => {
  await open(page, '/mdx/');
  await selectForEditing(page, page.locator('strong [data-copyedit-id]').filter({ hasText: /^bold$/ }));
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.fill('Text {execute()}');
  await page.getByRole('button', { name: 'Save to MDX', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('valid source blocks');
  await expect(source).toHaveValue('Text {execute()}');
  expect(await readFile(files.mdx, 'utf8')).toBe(originals.mdx);
  await source.fill('New **draft**.');
  const external = originals.mdx + '\nExternal synthetic edit.\n';
  await writeFile(files.mdx, external);
  await expect(page.getByRole('status')).toContainText('changed while you were editing');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status')).toContainText(/changed since|out of date/);
  await expect(source).toHaveValue('New **draft**.');
  expect(await readFile(files.mdx, 'utf8')).toBe(external);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('source scope expands from a list paragraph to the complete list', async ({ page }) => {
  await open(page, '/notes/');
  await selectForEditing(page, page.locator('ol li [data-copyedit-id]').first());
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await expect(source).toHaveValue('Enable editing.');
  await page.getByLabel('Edit block', { exact: true }).selectOption({ label: 'List' });
  const list = '1. Enable editing.\n2. Choose a highlighted passage.\n3. Save your correction.';
  await expect(source).toHaveValue(list);
  const replacement = '1. Enable **editing**.\n2. Choose a passage.\n3. Save the source.';
  await source.fill(replacement);
  await save(page, 'Markdown');
  expect(await readFile(files.md, 'utf8')).toBe(originals.md.replace(list, replacement));
});

test('expanded source editor fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/notes/');
  await selectForEditing(page, page.locator('strong [data-copyedit-id]').filter({ hasText: /^bold$/ }));
  await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveValue(paragraph);
  const panel = await page.locator('.editor.expanded').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('Starlight raw MDX headings refresh anchors and table of contents', async ({ page }) => {
  await open(page, 'http://127.0.0.1:4324/components/');
  await selectForEditing(page, page.locator('.sl-markdown-content h2 [data-copyedit-id]').first());
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await expect(source).toHaveValue('## Copyedit and components');
  await source.fill('## Updated **source** heading');
  await save(page, 'MDX');
  expect(await readFile(files.starlight, 'utf8')).toBe(originals.starlight.replace('## Copyedit and components', '## Updated **source** heading'));
  await expect(page.locator('.sl-markdown-content #updated-source-heading')).toBeVisible();
  await expect(page.locator('starlight-toc a[href="#updated-source-heading"]').first()).toBeVisible();
  await expect(page.locator('.starlight-aside')).toContainText(['This MDX content', 'Literal component']);
});
