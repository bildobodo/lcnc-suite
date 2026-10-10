import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './e2e', testMatch: /collisions\.viewer\.spec\.ts/,
 fullyParallel: false, workers: 1, timeout: 150000, expect: { timeout: 15000 },
 reporter: [['list']], outputDir: '../r118-browser-results',
 use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4188/', headless: true,
 launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] }, deviceScaleFactor: 1,
 locale: 'en-GB', timezoneId: 'UTC', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
 webServer: { command: 'MOCK_PORT=4188 MOCK_HOST=127.0.0.1 node e2e/mock-gateway.mjs',
 url: 'http://127.0.0.1:4188/', reuseExistingServer: false, timeout: 30000 }
});
