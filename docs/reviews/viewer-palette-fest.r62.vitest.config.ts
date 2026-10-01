import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r62-vitest-cache',test:{environment:'node',maxWorkers:1,execArgv:['--expose-gc'],include:['src/viewer/toolOffsetState.test.ts','src/viewer/toolpathController.test.ts','src/viewer/fatPaths.test.ts','src/themeTokens.test.ts']}});
