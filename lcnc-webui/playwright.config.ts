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
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /(lifecycle|viewer|nine-axis)\.spec\.ts/ },
    // Mock-global-state specs run strictly ONE FILE AT A TIME via project
    // dependency CHAINING. fullyParallel:false alone is NOT enough — it only
    // serializes tests within a file; separate files still land on parallel
    // workers, and nine-axis's setAxes/reset broadcasts then swap the axis
    // set mid-assertion in lifecycle/viewer (observed: HUD A-row vanishing
    // under the °-suffix check, leak-probe geometry counts perturbed).
    //  • lifecycle.spec.ts — reconnect/shutdown banner windows (refuseWs/
    //    shutdownClose are mock-global).
    //  • nine-axis.spec.ts — setAxes swaps the mock-global axis set.
    //  • viewer.spec.ts — renderer.info leak probe needs a settled renderer;
    //    runs LAST, after all axis churn.
    {
      name: "serial-lifecycle",
      use: { browserName: "chromium" },
      dependencies: ["chromium"],
      testMatch: /lifecycle\.spec\.ts/,
      fullyParallel: false,
    },
    {
      name: "serial-nine-axis",
      use: { browserName: "chromium" },
      dependencies: ["serial-lifecycle"],
      testMatch: /nine-axis\.spec\.ts/,
      fullyParallel: false,
    },
    {
      name: "serial-viewer",
      use: { browserName: "chromium" },
      dependencies: ["serial-nine-axis"],
      testMatch: /viewer\.spec\.ts/,
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
