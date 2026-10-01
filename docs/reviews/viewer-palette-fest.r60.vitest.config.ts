import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r60-vitest-cache',test:{environment:'node',
 include:['src/ws/bulkData.test.ts','src/ws/statusStore.test.ts','src/lcncWs.exports.test.ts','r60-transitions.test.ts'],maxWorkers:1}});
