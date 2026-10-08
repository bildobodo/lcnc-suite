import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r93-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/viewer/*.test.ts'],testTimeout:240000}});
