import { defineConfig } from "@playwright/test";

const toolSpecs = /(example-tool-library|freecad-import|tool-geometry|tool-holder|tool-import)\.spec\.ts/;

if (process.env.CI && process.argv.some(arg => arg.startsWith('--update-snapshots') || arg === '-u')) {
  throw new Error('CI must compare committed visual references, never update them.');
}

// Browser suite: the BUILT frontend with a plain preview for disconnected
// smoke tests and a mock gateway for state, layout and visual regression
// tests. No LinuxCNC instance is used.
//
//   npm run build && npm run test:e2e
//
// (browsers: `npx playwright install chromium` once.)
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: [/(lifecycle|viewer|nine-axis|touchoff|layout|layout-audit|visual)\.spec\.ts/, toolSpecs] },
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
      // Import/holder specs broadcast tool tables and reset the shared mock.
      // Serialize FILES too: fullyParallel:false only serializes each file's
      // tests, while workers:1 prevents competing fixture broadcasts.
      name: "serial-tools",
      use: { browserName: "chromium" },
      dependencies: ["chromium"],
      testMatch: toolSpecs,
      fullyParallel: false,
      workers: 1,
    },
    {
      name: "serial-lifecycle",
      use: { browserName: "chromium" },
      dependencies: ["serial-tools"],
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
      // touchoff.spec.ts — setAxes (rotary rows) + permissions deltas: same
      // mock-global churn as nine-axis, so it rides the chain right after it.
      name: "serial-touchoff",
      use: { browserName: "chromium" },
      dependencies: ["serial-nine-axis"],
      testMatch: /touchoff\.spec\.ts/,
      fullyParallel: false,
    },
    {
      name: "serial-layout",
      use: { browserName: "chromium" },
      dependencies: ["serial-touchoff"],
      testMatch: /(?:layout|layout-audit)\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
    },
    {
      name: "serial-visual",
      use: { browserName: "chromium" },
      dependencies: ["serial-layout"],
      testMatch: /visual\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
    },
    {
      name: "serial-viewer",
      use: { browserName: "chromium" },
      dependencies: ["serial-visual"],
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
