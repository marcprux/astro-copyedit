import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dev } from 'astro';
import { prepareSite } from './sites.mjs';
import { chromium } from '@playwright/test';

// Exercise a real Astro restart and non-root base without changing demo content.
const root = await prepareSite('demo');
const source = new URL('src/content/articles/playground.md', root);
const original = await readFile(source, 'utf8');
const browser = await chromium.launch(process.env.COPYEDIT_BROWSER_CHANNEL ? { channel: process.env.COPYEDIT_BROWSER_CHANNEL } : {});
let previousId;
try {
  for (let session = 0; session < 2; session++) {
    const server = await dev({ root, base: '/sandbox/', server: { host: '127.0.0.1', port: 4326 }, logLevel: 'error' });
    const page = await browser.newPage();
    try {
      const origin = `http://127.0.0.1:${server.address.port}`;
      await page.goto(`${origin}/sandbox/`);
      await page.waitForLoadState('networkidle');
      await page.locator('astro-dev-toolbar #dev-bar').focus();
      await page.locator('astro-dev-toolbar button[data-app-id="astro-copyedit"]').click();
      const word = page.locator('strong [data-copyedit-id]').first();
      const id = await word.getAttribute('data-copyedit-id');
      assert(id);
      if (previousId) assert.notEqual(id, previousId, 'Restart must regenerate source mappings');
      await word.click();
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/sandbox/__copyedit__/save'));
      await page.getByRole('button', { name: 'Save to Markdown', exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      if (previousId) {
        const stale = await page.request.post(`${origin}/sandbox/__copyedit__/save`, {
          headers: { Origin: origin, 'X-Copyedit-Token': response.request().headers()['x-copyedit-token'] },
          data: { id: previousId, text: 'synthetic stale request' },
        });
        assert.equal(stale.status(), 409);
      }
      previousId = id;
      assert.equal(await readFile(source, 'utf8'), original);
    } finally { await page.close(); await server.stop(); }
  }
  console.log('Passed: non-root base, save endpoint, cached-content restart, and stale-session rejection.');
} finally { await browser.close(); }
