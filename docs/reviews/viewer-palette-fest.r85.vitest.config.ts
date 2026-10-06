import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r85-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/viewer/clashTint.test.ts','src/viewer/sweepMerge.test.ts','src/themeTokens.test.ts','src/viewer/r85.tint.test.ts']}});
