import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e', testMatch:['frames.spec.ts','collisions.viewer.spec.ts'],
 grep:/the page reports the parse it sees|a parse made for the run is checked/,
 workers:1,fullyParallel:false,timeout:30000,expect:{timeout:10000},
 reporter:[['json',{outputFile:'/tmp/codex-r192-lplfoh4n/browser.json'}]],
 use:{browserName:'chromium',headless:true,baseURL:'http://127.0.0.1:4188',locale:'en-GB',timezoneId:'UTC'},
 webServer:{command:'MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs',url:'http://127.0.0.1:4188',reuseExistingServer:false,timeout:60000}
});
