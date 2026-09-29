import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:/(?:r34.merge-reentry|r34.sliders)\.spec\.ts/,
 workers:1,fullyParallel:false,timeout:90000,expect:{timeout:10000},outputDir:'../evidence/results',
 reporter:[['list'],['json',{outputFile:'../evidence/r34.extra-playwright.json'}]],use:{browserName:'chromium',headless:true,
 baseURL:'http://127.0.0.1:4188',locale:'en-GB',timezoneId:'UTC',deviceScaleFactor:1,
 launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']},screenshot:'only-on-failure'}});
