import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r74-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/viewer/cubeFaces.test.ts','src/viewer/reach*.test.ts','src/themeTokens.test.ts','src/trackHighlight.test.ts','src/run*.test.ts','src/hold*.test.ts']}});
