import {defineConfig} from "@playwright/test";
import full from "./playwright.config";
export default defineConfig({...full, workers:1, reporter:[["list"],["json",{outputFile:"/tmp/r438/browser-report.json"}]],
 webServer:[{command:"node node_modules/vite/bin/vite.js preview --port 4173 --strictPort",url:"http://localhost:4173",reuseExistingServer:false,timeout:60000}],
});
