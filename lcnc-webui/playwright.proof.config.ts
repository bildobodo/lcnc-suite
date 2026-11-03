import path from "node:path";
import { defineConfig } from "@playwright/test";

// The per-worker mock's isolation harness (Codex R261/R262 PM261-03/-04):
// run case by case by scripts/test_select/proof_harness.py, never by the
// suite or the gates. One project, files in path order, the worker count
// the case asks for, no retry.
process.env.LCNC_E2E_RUN ??= `${process.pid}-${Date.now()}`;
process.env.LCNC_E2E_EVENTS ??= path.resolve("test-results", "proof-events.jsonl");

export default defineConfig({
  testDir: "./e2e-proof",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: Number(process.env.LCNC_PROOF_WORKERS ?? 1),
  timeout: 120_000,
  projects: [{ name: "proof", use: { browserName: "chromium" } }],
});
