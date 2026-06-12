import { defineConfig } from "@playwright/test";

// Smoke E2E (issue #26). Serves the BUILT frontend with `vite preview` and no
// gateway, so it verifies the app shell renders and the default-deny gating
// holds while disconnected — exactly the state a fresh load starts in.
//
//   npm run build && npm run test:e2e
//
// (browsers: `npx playwright install chromium` once.)
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /lifecycle\.spec\.ts/ },
    {
      // lifecycle.spec.ts drives mock-GLOBAL state (refuseWs, shutdownClose),
      // so it runs strictly AFTER the parallel project, never alongside it —
      // and serially WITHIN itself: a sibling's shutdownClose would trigger a
      // same-page reconnect whose hello carries resume_armed=true, masking a
      // broken reload-boot path (caught when proving the guard adversarially).
      name: "lifecycle",
      use: { browserName: "chromium" },
      dependencies: ["chromium"],
      testMatch: /lifecycle\.spec\.ts/,
      fullyParallel: false,
    },
  ],
  webServer: [
    {
      // Disconnected smoke tests (smoke.spec.ts) — plain built app, no gateway.
      command: "vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Armed-state tests (armed.spec.ts) — built app + a mock gateway WS.
      command: "node e2e/mock-gateway.mjs",
      url: "http://localhost:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
