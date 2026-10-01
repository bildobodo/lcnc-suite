import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r59-vitest-cache',test:{environment:'node',include:[
'src/viewer/toolBasis.test.ts','src/ws/bulkData.test.ts','src/ws/statusStore.test.ts',
'src/r59-consumers.test.ts','src/ws/r59-transitions.test.ts'],maxWorkers:1}});
