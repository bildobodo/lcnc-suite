import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r84-vitest-cache',test:{environment:'node',maxWorkers:1,testTimeout:30000,include:['src/viewer/r84.probe.test.ts']}});
