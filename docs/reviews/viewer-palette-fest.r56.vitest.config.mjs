// Copy into archive/lcnc-webui. All caches stay in the archive.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: './.r56-vite-cache',
  test: { environment: 'node', include: ['src/viewer/r56.consumer-probe.test.ts'], maxWorkers: 1 },
});
