import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:['layout.spec.ts','r62-packages.spec.ts'],workers:1,timeout:90000,reporter:'list',outputDir:'../evidence/r62-packages-output',use:{browserName:'chromium',headless:true,locale:'en-GB',timezoneId:'UTC'}});
