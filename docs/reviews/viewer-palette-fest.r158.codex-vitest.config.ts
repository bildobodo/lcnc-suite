import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['src/**/*.test.ts'],pool:'threads',maxWorkers:1,execArgv:[]}});
