import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',testMatch:/input-session\.spec\.ts|r41\.spec\.ts/,
 workers:1,fullyParallel:false,timeout:60000,expect:{timeout:10000},
 outputDir:'../evidence/results',
 reporter:[['list'],['json',{outputFile:'../evidence/midrun-tool-reparse.r41.playwright.json'}]],
 use:{browserName:'chromium',headless:true,baseURL:'http://127.0.0.1:4188',
 locale:'en-GB',timezoneId:'UTC',deviceScaleFactor:1,screenshot:'only-on-failure'}
});
