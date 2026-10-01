import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:['r61.spec.ts','toolsetter.viewer.spec.ts','collisions.viewer.spec.ts','layout.spec.ts','editor-guards.spec.ts','input-session.spec.ts','viewer.spec.ts'],workers:1,timeout:60000,
reporter:'list',outputDir:'../evidence/r61-browser-output',use:{browserName:'chromium',headless:true,locale:'en-GB',timezoneId:'UTC'}});
