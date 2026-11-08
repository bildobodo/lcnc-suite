import {defineConfig} from '@playwright/test';
process.env.LCNC_E2E_RUN = `codex-r342-${process.pid}`;
process.env.LCNC_E2E_EVENTS = '/tmp/codex-r342-mock-events.jsonl';
export default defineConfig({testDir:'./e2e',workers:1,fullyParallel:false,retries:0,
  timeout:45000,expect:{timeout:10000},reporter:[['list']],
  use:{headless:true,viewport:{width:1600,height:1000},trace:'retain-on-failure'},
});
