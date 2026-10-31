import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,fullyParallel:false,timeout:30000,expect:{timeout:5000},reporter:'list',use:{browserName:'firefox',headless:true,baseURL:'http://127.0.0.1:4188/',viewport:{width:1440,height:1000},launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']},trace:'retain-on-failure',screenshot:'only-on-failure'}});
