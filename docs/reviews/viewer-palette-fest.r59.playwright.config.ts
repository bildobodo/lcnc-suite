import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'r59.spec.ts',workers:1,timeout:60000,
  reporter:'list',outputDir:'../evidence/r59-browser-output',
  use:{browserName:'chromium',headless:true,locale:'en-GB',timezoneId:'UTC'}});
