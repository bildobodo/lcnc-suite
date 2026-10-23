import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'r187.codex-queue.spec.ts',workers:1,timeout:20000,reporter:[['json',{outputFile:'/tmp/codex-r187-b4k897uq/queue-browser.json'}]],use:{browserName:'chromium',headless:true}});
