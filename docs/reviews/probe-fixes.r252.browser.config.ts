import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', workers: 1, fullyParallel: false,
 timeout: 60000, expect: { timeout: 8000 }, reporter: 'list',
 use: { headless: true, baseURL: 'http://127.0.0.1:4188/', viewport: {width:1600,height:1000},
 trace: 'retain-on-failure', screenshot: 'only-on-failure' },
 projects: [{name:'chromium',use:{browserName:'chromium',launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}}},
 {name:'firefox159',use:{browserName:'firefox',channel:'moz-firefox',
 launchOptions:{executablePath:'/tmp/claude-1000/-home-cnc-lcnc-suite/8a5e50a4-3d46-4351-ab79-2eeb37ae17b1/scratchpad/ff159/firefox/firefox'}}}]
});
