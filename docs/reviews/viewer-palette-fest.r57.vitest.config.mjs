// Copy into archive/lcnc-webui; all caches stay in archive.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: './.r57-vite-cache',
  test: { environment: 'node', include: ['src/viewer/r57.consumer-probe.test.ts'], maxWorkers: 1 },
});
