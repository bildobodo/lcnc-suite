import config from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({...config, workers:1, retries:0, forbidOnly:true, webServer:[],
 reporter:[['list'],['json',{outputFile:process.env.R279_REPORT ?? '/tmp/codex-r279/b-browser.json'}]]});
