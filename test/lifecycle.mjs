import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dev } from 'astro';
import { prepareSite } from './sites.mjs';
import { selectForEditing } from './browser/helpers.mjs';
import { chromium } from '@playwright/test';

// Exercise a real Astro restart and non-root base without changing demo content.
const root = await prepareSite('demo');
const cases = [
  { route: '', file: 'src/content/articles/playground.md', saveLabel: 'Save to Markdown' },
  { route: 'mdx/', file: 'src/pages/mdx.mdx', saveLabel: 'Save to MDX' },
];
for (const item of cases) item.original = await readFile(new URL(item.file, root), 'utf8');
const browser = await chromium.launch(process.env.COPYEDIT_BROWSER_CHANNEL ? { channel: process.env.COPYEDIT_BROWSER_CHANNEL } : {});
const previousIds = new Map();
try {
  for (let session = 0; session < 2; session++) {
    const server = await dev({ root, base: '/sandbox/', server: { host: '127.0.0.1', port: 4326 }, logLevel: 'error' });
    try {
      for (const item of cases) {
        const page = await browser.newPage();
        try {
          const previousId = previousIds.get(item.route);
          const origin = `http://127.0.0.1:${server.address.port}`;
          await page.goto(`${origin}/sandbox/${item.route}`);
          await page.waitForLoadState('networkidle');
          await page.locator('astro-dev-toolbar #dev-bar').focus();
          await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
          const word = page.locator('strong [data-copyedit-id]').first();
          const id = await word.getAttribute('data-copyedit-id');
          assert(id);
          if (previousId) assert.notEqual(id, previousId, 'Restart must regenerate source mappings');
          await selectForEditing(page, word);
          const responsePromise = page.waitForResponse(response => response.url().endsWith('/sandbox/__copyedit__/save'));
          await page.getByRole('button', { name: item.saveLabel, exact: true }).click();
          const response = await responsePromise;
          assert.equal(response.status(), 200);
          if (previousId) {
            const stale = await page.request.post(`${origin}/sandbox/__copyedit__/save`, {
              headers: { Origin: origin, 'X-Copyedit-Token': response.request().headers()['x-copyedit-token'] },
              data: { id: previousId, text: 'synthetic stale request' },
            });
            assert.equal(stale.status(), 409);
          }
          previousIds.set(item.route, id);
          assert.equal(await readFile(new URL(item.file, root), 'utf8'), item.original);
        } finally { await page.close(); }
      }
    } finally { await server.stop(); }
  }
  const originalConfig = await readFile(new URL('astro.config.mjs', root), 'utf8');
  const configurations = [];
  for (const shortcut of ['Ctrl+Shift+K', false]) {
    const configFile = `shortcut-${shortcut ? 'custom' : 'disabled'}.config.mjs`;
    await writeFile(new URL(configFile, root), originalConfig.replace('copyedit()', `copyedit({ shortcut: ${JSON.stringify(shortcut)} })`));
    configurations.push({ shortcut, configFile });
  }
  for (const { shortcut, configFile } of configurations) {
    const server = await dev({ root, configFile, server: { host: '127.0.0.1', port: 4326 }, logLevel: 'error' });
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${server.address.port}/notes/`);
      await page.waitForLoadState('networkidle');
      await page.locator('strong [data-copyedit-id]').first().evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      const defaultKey = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta+Shift+E' : 'Control+Shift+E');
      await page.keyboard.press(defaultKey);
      assert.equal(await page.locator('.editor').isVisible(), false, 'Default shortcut must be replaced or disabled');
      if (shortcut) {
        await page.keyboard.press('Control+Shift+K');
        await page.locator('.raw-source').waitFor({ state: 'visible' });
        assert.match(await page.locator('.raw-source').inputValue(), /misspellled/);
      } else {
        await page.locator('astro-dev-toolbar #dev-bar').focus();
        await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
        await page.locator('.raw-source').waitFor({ state: 'visible' });
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } finally { await page.close(); await server.stop(); }
  }
  console.log('Passed: Markdown and MDX non-root base, save endpoint, cached-content restart, stale-session rejection, and configured/disabled shortcuts.');
} finally { await browser.close(); }
