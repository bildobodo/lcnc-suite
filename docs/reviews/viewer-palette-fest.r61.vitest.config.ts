import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r61-vitest-cache',test:{environment:'node',maxWorkers:1,execArgv:['--expose-gc'],include:[
'src/themeTokens.test.ts','src/viewer/toolOffsetState.test.ts','src/viewer/toolpathController.test.ts','src/viewer/fatPaths.test.ts',
'src/viewer/toolBasis.test.ts','src/ws/bulkData.test.ts','src/machineControls.test.ts']}});
