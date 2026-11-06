import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, webServer: [], workers: 1, retries: 0, forbidOnly: true,
 testMatch: ['feedback-channels.spec.ts'], grep: /a safety trip/,
 outputDir: '/tmp/r325-evidence/browser-results',
 reporter: [['list'], ['json', {outputFile: '/tmp/r325-evidence/browser.json'}]] });
