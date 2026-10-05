import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r75-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/viewer/cubeFaces.test.ts']}});
