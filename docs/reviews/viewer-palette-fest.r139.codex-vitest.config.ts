import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'/tmp/codex-r139-p56dtkmu/vite-cache',test:{environment:'node',include:['src/**/*.test.ts'],maxWorkers:1,execArgv:['--expose-gc'],setupFiles:['./src/testGlobals.ts']}});
