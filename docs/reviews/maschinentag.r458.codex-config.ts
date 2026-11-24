import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base, workers:1, forbidOnly:true, retries:0,
 reporter:[['list'],['json',{outputFile:'/tmp/r458/report.json'}]],
 use:{...base.use,baseURL:'http://localhost:4278'},
 webServer:[{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4278 --strictPort',url:'http://127.0.0.1:4278',reuseExistingServer:false,timeout:60000}]
});
