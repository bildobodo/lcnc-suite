import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'/tmp/codex-r138-0vg78d9n/vite-cache',test:{environment:'node',include:['src/**/*.test.ts'],maxWorkers:1,execArgv:['--expose-gc'],setupFiles:['./src/testGlobals.ts']}});
