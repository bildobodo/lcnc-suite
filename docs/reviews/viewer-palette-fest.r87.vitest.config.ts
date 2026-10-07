import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r87-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/viewer/*.test.ts'],testTimeout:120000}});
