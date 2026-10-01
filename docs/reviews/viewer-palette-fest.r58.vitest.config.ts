import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r58-vitest-cache',test:{environment:'node',
 include:['src/viewer/toolBasis.test.ts','src/ws/bulkData.test.ts','src/previewDecode.test.ts','src/r58-consumers.test.ts'],maxWorkers:1}});
