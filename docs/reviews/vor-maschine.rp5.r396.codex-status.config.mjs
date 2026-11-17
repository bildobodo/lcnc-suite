import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./r396-status-probe', repeatEach:2, workers:1, retries:0,
  projects:[{name:'e2e'}], reporter:[['json',{outputFile:'/tmp/r396-status-report.json'}]],
  outputDir:'/tmp/r396-status-output' });
