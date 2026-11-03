import { defineConfig } from "@playwright/test";
import full from "./playwright.config";

// The gate's FULL browser run (scripts/test_select/round_gate.py, Codex R256
// TS256-05): the full run's projects, chain and settings with its own
// servers — a server already listening (another worktree's build or mock) is
// never reused in place of this tree's — and no focused test (forbidOnly).
// playwright.config.ts keeps reuse for the developer's own runs.
//
//   npx playwright test -c playwright.gate.config.ts
export default defineConfig({
  ...full,
  forbidOnly: true,
  webServer: (Array.isArray(full.webServer) ? full.webServer : [full.webServer!])
    .map(w => ({ ...w, reuseExistingServer: false })),
});
