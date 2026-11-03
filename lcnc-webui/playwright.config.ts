import path from "node:path";
import { defineConfig } from "@playwright/test";

if (process.env.CI && process.argv.some(arg => arg.startsWith('--update-snapshots') || arg === '-u')) {
  throw new Error('CI must compare committed visual references, never update them.');
}

// This run (per-worker mock): set once in the runner, inherited by every
// worker — the slot owners' registry and the fixture's event log carry it.
process.env.LCNC_E2E_RUN ??= `${process.pid}-${Date.now()}`;
process.env.LCNC_E2E_EVENTS ??= path.resolve("test-results", "mock-events.jsonl");

// Browser suite: the BUILT frontend with a plain preview for disconnected
// smoke tests and a mock gateway for state, layout and visual regression
// tests. No LinuxCNC instance is used.
//
//   npm run build && npm run test:e2e
//
// (browsers: `npx playwright install chromium` once.)
export default defineConfig({
  testDir: "./e2e",
  // A file's tests in order on one worker; files spread over the workers,
  // each worker with its OWN mock (e2e/test.ts — per-worker mock, Codex
  // R261/R262). The project chain that gave ONE shared mock one owner at a
  // time is gone with that mock; what it protected (an axis set swapped,
  // connections closed, a leak probe on a settled renderer) is now each
  // worker's own state, reset before every test.
  fullyParallel: false,
  workers: Number(process.env.LCNC_E2E_WORKERS ?? 3),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    // Headless Chromium hides scrollbars by default, so no scrollbar BAND
    // exists and the strip-band gate (WP4: the band must be reserved, the
    // negative controls must see it vanish) would pass on nothing. Real
    // Linux/Windows browsers show the band; so does the test browser.
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: "e2e", use: { browserName: "chromium" } },
  ],
  webServer: [
    {
      // Disconnected smoke tests (smoke.spec.ts) — plain built app, no gateway.
      command: "vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    // The mock gateway is no shared server any more: every worker starts its
    // own on its slot (e2e/test.ts, per-worker mock — Codex R261/R262).
  ],
});
