import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './e2e', testMatch: /(?:collisions|sim-panel)\.viewer\.spec\.ts/,
 timeout: 120000, expect: { timeout: 10000 }, fullyParallel: false, workers: 1,
 outputDir: '/tmp/codex-r172-p00xom99/browser-results',
 reporter: [['json', { outputFile: '/tmp/codex-r172-p00xom99/browser.json' }]],
 use: { baseURL: 'http://127.0.0.1:4188', browserName: 'chromium', headless: true,
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
  deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'UTC', trace: 'off', screenshot: 'only-on-failure' },
 webServer: { command: 'MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs',
  url: 'http://127.0.0.1:4188', reuseExistingServer: false, timeout: 60000 }
});
