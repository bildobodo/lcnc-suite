import { defineConfig } from '@playwright/test';
process.env.LCNC_E2E_RUN='codex-r329';
process.env.LCNC_E2E_EVENTS='/tmp/r329-evidence/mock-events.jsonl';
export default defineConfig({testDir:'./e2e',fullyParallel:false,workers:1,retries:0,forbidOnly:true,
 timeout:30000,expect:{timeout:10000},outputDir:'/tmp/r329-evidence/browser-artifacts',
 reporter:[['list'],['json',{outputFile:'/tmp/r329-evidence/browser.json'}]],
 use:{browserName:'chromium',headless:true,launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']},
 deviceScaleFactor:1,locale:'en-GB',timezoneId:'UTC',trace:'retain-on-failure',screenshot:'only-on-failure'},
});
