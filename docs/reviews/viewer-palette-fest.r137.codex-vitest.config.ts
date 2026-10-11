import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'/tmp/codex-r137-0s9wgq_s/vite-cache',test:{environment:'node',include:['src/**/*.test.ts'],maxWorkers:1,execArgv:['--expose-gc'],setupFiles:['./src/testGlobals.ts']}});
