import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'/tmp/codex-r136-bapg7k2b/vite-cache',test:{environment:'node',maxWorkers:1,execArgv:['--expose-gc'],setupFiles:['./src/testGlobals.ts']}});
