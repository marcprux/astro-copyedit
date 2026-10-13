import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { selectPageText } from './helpers.mjs';
const file = new URL('../../.test-sites/demo/src/pages/selection-md.md', import.meta.url);
let original;
test.beforeAll(async () => { original = await readFile(file, 'utf8'); });
test.afterEach(async ({ page }) => { await page.close(); if (await readFile(file, 'utf8') !== original) await writeFile(file, original); });
const panel = page => page.locator('.editor');
const source = page => page.locator('.raw-source');
const first = page => page.locator('[data-copyedit-id]').filter({ hasText: /^First $/ }).first();
const second = page => page.locator('[data-copyedit-id]').filter({ hasText: /^Second paragraph with a $/ }).first();
async function openPage(page, path = '/selection-md/') { await page.goto(path); await page.waitForLoadState('networkidle'); }
async function toggle(page) { await page.locator('astro-dev-toolbar #dev-bar').focus(); await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click(); }
async function shortcut(page) { await page.keyboard.press(await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta+Shift+E' : 'Control+Shift+E')); }

test('select first, open with shortcut, edit, and save closes the overlay', async ({ page }) => {
  await openPage(page);
  const requests = [];
  page.on('request', r => { if (r.url().endsWith('/__copyedit__/save')) requests.push(r.postDataJSON()); });
  await selectPageText(page, first(page));
  await expect(panel(page)).toBeHidden();
  expect(requests).toEqual([]);
  await shortcut(page);
  await expect(source(page)).toHaveValue('First **bold** paragraph.');
  await expect(source(page)).toBeFocused();
  await source(page).fill('First **corrected** paragraph.');
  await Promise.all([
    page.waitForEvent('framenavigated', f => f === page.mainFrame()),
    page.keyboard.press('Control+Enter'),
  ]);
  await page.waitForLoadState('networkidle');
  await expect(panel(page)).toBeHidden();
  expect(await readFile(file, 'utf8')).toBe(original.replace('**bold**', '**corrected**'));
});
test('overlay opens empty; ordinary clicks, links, outlines, and tab order stay native', async ({ page }) => {
  await openPage(page, '/selection-html/');
  const node = page.locator('#single [data-copyedit-id]').first();
  const before = await node.evaluate(n => ({ outline: getComputedStyle(n).outline, cursor: getComputedStyle(n).cursor }));
  await toggle(page);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Select text on the page');
  await expect(page.locator('[data-copyedit-mode], [data-copyedit-id][role], [data-copyedit-id][tabindex], [data-copyedit-active]')).toHaveCount(0);
  expect(await node.evaluate(n => ({ outline: getComputedStyle(n).outline, cursor: getComputedStyle(n).cursor }))).toEqual(before);
  await node.click();
  await expect(source(page)).toBeHidden();
  const link = page.locator('#single a');
  await link.evaluate(n => n.href = '#single');
  await link.locator('[data-copyedit-id]').click();
  await expect(page).toHaveURL(/#single$/);
  await expect(source(page)).toBeHidden();
});
test('visible editor follows page selections without stealing focus or consuming the native range', async ({ page }) => {
  await openPage(page); await toggle(page);
  await selectPageText(page, first(page));
  await expect(source(page)).toHaveValue('First **bold** paragraph.');
  await expect(source(page)).not.toBeFocused();
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('First ');
  await selectPageText(page, second(page));
  await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
  await expect(source(page)).not.toBeFocused();
  await source(page).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
  // No editor selection may replace the page's source mapping.
  await source(page).fill('An unsaved **draft**.');
  await expect(page.locator('.status')).toBeEmpty();
  await toggle(page); await expect(panel(page)).toBeHidden();
  await toggle(page); await expect(source(page)).toHaveValue('An unsaved **draft**.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('a slow source response cannot overwrite a newer selection', async ({ page }) => {
  await openPage(page); await toggle(page);
  let release, firstReceived;
  const held = new Promise(resolve => release = resolve);
  const received = new Promise(resolve => firstReceived = resolve);
  let count = 0;
  await page.route('**/__copyedit__/save', async route => {
    const response = await route.fetch();
    if (++count === 1) { firstReceived(); await held; }
    await route.fulfill({ response });
  });
  try {
    await selectPageText(page, first(page)); await received;
    await selectPageText(page, second(page));
    await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
    const returned = page.waitForResponse(r => r.url().endsWith('/__copyedit__/save'));
    release(); await returned;
    await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
  } finally { release(); }
});
test('new selections retain a dirty draft; cancel then reopen edits the latest page selection', async ({ page }) => {
  await openPage(page); await selectPageText(page, first(page)); await shortcut(page);
  await expect(source(page)).toHaveValue('First **bold** paragraph.');
  await source(page).fill('My **draft**.');
  await selectPageText(page, second(page));
  await expect(page.getByRole('status')).toContainText('unsaved draft is retained');
  await expect(source(page)).toHaveValue('My **draft**.');
  await page.keyboard.press('Escape'); await expect(panel(page)).toBeHidden();
  await shortcut(page); await expect(source(page)).toHaveValue('My **draft**.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await shortcut(page);
  await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
});
test('shortcut leaves page form fields alone and unsupported selections show a limitation', async ({ page }) => {
  await openPage(page, '/selection-html/');
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'synthetic-input'; document.body.prepend(input); });
  await page.locator('#synthetic-input').focus(); await shortcut(page);
  await expect(panel(page)).toBeHidden();
  await selectPageText(page, page.locator('#dynamic p').nth(1));
  await shortcut(page);
  await expect(page.getByRole('status')).toContainText('no verified editable source');
  await expect(page.locator('.save')).toBeDisabled();
  await expect(source(page)).toBeHidden();
});

test('spellcheck preserves the draft and selection, localizes, and persists across reloads and source kinds', async ({ page }) => {
  await openPage(page); await selectPageText(page, first(page)); await shortcut(page);
  const checkbox = page.getByRole('checkbox', { name: 'Spellcheck', exact: true });
  await expect(source(page)).toBeVisible();
  await expect(checkbox).toBeChecked();
  await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  await source(page).fill('A synthetic **draft** with a tpyo.');
  await source(page).evaluate(n => n.setSelectionRange(12, 17));
  const before = await source(page).evaluate(n => ({ value: n.value, start: n.selectionStart, end: n.selectionEnd }));
  const requests = [];
  page.on('request', r => { if (r.url().endsWith('/__copyedit__/save')) requests.push(r.postDataJSON()); });
  await checkbox.uncheck();
  await expect(source(page)).toHaveAttribute('spellcheck', 'false');
  await checkbox.check();
  await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  expect(await source(page).evaluate(n => ({ value: n.value, start: n.selectionStart, end: n.selectionEnd }))).toEqual(before);
  await expect(page.locator('.status')).toBeEmpty();
  await page.keyboard.press('Escape'); await shortcut(page);
  await expect(checkbox).toBeChecked();
  await expect(source(page)).toHaveValue(before.value);
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload(); await page.waitForLoadState('networkidle');
  await selectPageText(page, first(page)); await shortcut(page);
  await expect(checkbox).toBeChecked();
  await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  await openPage(page, '/notes/');
  await selectPageText(page, page.locator('[data-copyedit-code-id]').first()); await shortcut(page);
  await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  await expect(source(page)).toHaveAccessibleName('Fenced code source');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('astro-copyedit:locale', { detail: { locale: 'es' } })));
  const translated = page.getByRole('checkbox', { name: 'Revisar ortografía', exact: true });
  await expect(translated).toBeChecked();
  await page.setViewportSize({ width: 320, height: 844 });
  const bounds = await translated.locator('..').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await translated.focus(); await page.keyboard.press('Space');
  await expect(translated).not.toBeChecked();
  await expect(source(page)).toHaveAttribute('spellcheck', 'false');
  await page.reload(); await page.waitForLoadState('networkidle');
  await selectPageText(page, page.locator('[data-copyedit-code-id]').first()); await shortcut(page);
  await expect(checkbox).not.toBeChecked();
  await expect(source(page)).toHaveAttribute('spellcheck', 'false');
});

test('spellcheck still works when preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ['getItem', 'setItem']) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function (key, ...args) {
        if (key === 'astro-copyedit:spellcheck') throw new DOMException('Synthetic storage restriction', 'SecurityError');
        return original.call(this, key, ...args);
      };
    }
  });
  await openPage(page); await selectPageText(page, first(page)); await shortcut(page);
  const checkbox = page.getByRole('checkbox', { name: 'Spellcheck', exact: true });
  await expect(checkbox).toBeChecked();
  await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  await checkbox.uncheck(); await expect(source(page)).toHaveAttribute('spellcheck', 'false');
  await checkbox.check(); await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  await selectPageText(page, second(page));
  await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
  await expect(checkbox).toBeChecked();
  await expect(source(page)).toHaveAttribute('spellcheck', 'true');
  await checkbox.uncheck(); await expect(source(page)).toHaveAttribute('spellcheck', 'false');
  await expect(page.locator('.save')).toBeEnabled();
  await expect(page.locator('.status')).toBeEmpty();
});

for (const preventFocus of [false, true]) test(`spellcheck clicks keep a clean editor open${preventFocus ? ' without control focus' : ''}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('astro-copyedit:spellcheck', 'true'));
  await openPage(page); await toggle(page);
  // Select on the page while the overlay is already open: the field has never
  // taken focus, and the browser still owns a native page selection.
  await selectPageText(page, first(page));
  await expect(source(page)).toHaveValue('First **bold** paragraph.');
  await expect(source(page)).not.toBeFocused();
  const originalField = await source(page).elementHandle();
  const before = await source(page).evaluate(n => ({ value: n.value, start: n.selectionStart, end: n.selectionEnd }));
  if (preventFocus) await page.locator('.spellcheck').evaluate(label => {
    // Exercise WebKit's no-focus selection collapse in Chromium CI as well.
    label.addEventListener('focusin', event => event.target.blur());
    label.addEventListener('mousedown', event => {
      event.preventDefault();
      window.getSelection().removeAllRanges();
    });
  });
  const requests = [];
  page.on('request', r => { if (r.url().endsWith('/__copyedit__/save')) requests.push(r.postDataJSON()); });
  const checkbox = page.getByRole('checkbox', { name: 'Spellcheck', exact: true });
  await expect(checkbox).toBeChecked();
  for (const [target, enabled] of [[page.locator('.spellcheck span'), false], [checkbox, true]]) {
    await target.click();
    // Let the 100 ms page-selection debounce run; an immediate assertion misses
    // the bug where the checkbox changes successfully and then the field hides.
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeVisible();
    await expect(source(page)).toBeVisible();
    await expect(source(page)).toHaveAttribute('spellcheck', String(enabled));
    expect(await source(page).evaluate((node, original) => node === original, originalField)).toBe(true);
    expect(await source(page).evaluate(n => ({ value: n.value, start: n.selectionStart, end: n.selectionEnd }))).toEqual(before);
    await expect(page.locator('.status')).toBeEmpty();
  }
  expect(requests).toEqual([]);
  // Subsequent page selections still work, and a real page deselection clears
  // the field instead of leaving the old selection pinned by the toolbar guard.
  await selectPageText(page, second(page));
  await expect(source(page)).toHaveValue('Second paragraph with a [link](https://example.org).');
  await second(page).click();
  await expect(source(page)).toBeHidden();
  await expect(panel(page)).toBeVisible();
});
