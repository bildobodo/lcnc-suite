import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base, workers:1, forbidOnly:true, retries:0,
  reporter:[['list'],['json',{outputFile:'/tmp/r459/browser-report.json'}]],
  use:{...base.use,baseURL:'http://localhost:4279'},
  webServer:[{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4279 --strictPort',
    url:'http://127.0.0.1:4279',reuseExistingServer:false,timeout:60000}],
});
