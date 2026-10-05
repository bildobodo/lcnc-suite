import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r76-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/flashClock.test.ts']}});
