import { expect } from '@playwright/test';
// Change a word inside its complete source block, preserving surrounding markup.
export async function replaceInSource(page, before, after, last = false) {
  const source = page.locator('.raw-source');
  await expect(source).toBeVisible();
  const value = await source.inputValue();
  const index = last ? value.lastIndexOf(before) : value.indexOf(before);
  expect(index).toBeGreaterThanOrEqual(0);
  await source.fill(value.slice(0, index) + after + value.slice(index + before.length));
}

export async function selectPageText(page, locator) {
  await locator.evaluate(node => {
    document.activeElement?.blur();
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('pre code') ?? node);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}
export async function selectForEditing(page, locator) {
  const response = page.waitForResponse(r => r.url().endsWith('/__copyedit__/save') && ['source', 'selection'].includes(r.request().postDataJSON()?.operation));
  await selectPageText(page, locator);
  if (!await page.locator('astro-dev-toolbar-window.editor').isVisible()) {
    await page.locator('astro-dev-toolbar #dev-bar').focus();
    await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
  }
  await response;
  await expect(page.locator('.raw-source')).toBeVisible();
  await expect(page.locator('.save')).toBeEnabled();
}
