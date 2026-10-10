import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir: '/tmp/codex-r134-unmzpu6o/vite-cache', test: {environment:'node',maxWorkers:1, execArgv:['--expose-gc']}});
