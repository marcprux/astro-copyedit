import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4323', browserName: 'chromium',
    ...(process.env.COPYEDIT_BROWSER_CHANNEL ? { channel: process.env.COPYEDIT_BROWSER_CHANNEL } : {}),
    viewport: { width: 1440, height: 1100 }, trace: 'retain-on-failure',
  },
  webServer: ['demo', 'starlight'].map((name, index) => ({ command: `node test/serve.mjs ${name}`, url: `http://127.0.0.1:${4323 + index}`, reuseExistingServer: false, timeout: 120_000 })),
});
