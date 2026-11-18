import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/r398-fixtures/*.test.ts'], maxWorkers:1, fileParallelism:false, retry:0 } });
