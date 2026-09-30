import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',testMatch:/scenes\.viewer\.spec\.ts|toolsetter\.viewer\.spec\.ts|r44\.spec\.ts/,
 workers:1,fullyParallel:false,timeout:60000,expect:{timeout:10000},
 outputDir:'../evidence/results',
 reporter:[['list'],['json',{outputFile:'../evidence/viewer-palette-fest.r44.ready-playwright.json'}]],
 use:{browserName:'chromium',headless:true,baseURL:'http://127.0.0.1:4188',locale:'en-GB',timezoneId:'UTC',deviceScaleFactor:1,screenshot:'only-on-failure'}
});
