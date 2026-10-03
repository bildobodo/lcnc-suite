import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r71-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/macro*.test.ts','src/useMacros.test.ts','src/viteProxyCoverage.test.ts','src/commandPath.test.ts','src/helpPlacement.test.ts','src/inputSession.test.ts','src/gcodeEditSession.test.ts']}});
