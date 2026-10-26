import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: /keyboard-guards.spec.ts/, fullyParallel:false, workers:1, timeout:30000, expect:{timeout:10000}, reporter:[["list"]], use:{baseURL:"http://127.0.0.1:4188",headless:true,browserName:"chromium",launchOptions:{args:["--disable-gpu"]}} });
