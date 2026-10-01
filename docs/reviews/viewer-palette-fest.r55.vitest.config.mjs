// Copy into the archive's lcnc-webui before running. All caches stay there.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: './.r55-vite-cache',
  test: { environment: 'node', include: ['src/viewer/r55.consumer-probe.test.ts'], maxWorkers: 1 },
});
