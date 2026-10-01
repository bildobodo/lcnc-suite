import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:['r62.spec.ts','toolsetter.viewer.spec.ts'],workers:1,timeout:60000,reporter:'list',outputDir:'../evidence/r62-browser-output',use:{browserName:'chromium',headless:true,locale:'en-GB',timezoneId:'UTC'}});
