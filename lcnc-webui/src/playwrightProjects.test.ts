// The browser suite's ONE project (per-worker mock, Codex R261/R262): a
// file's tests in order on one worker (fullyParallel false, no describe
// running its tests side by side), files spread over the workers, each
// worker with its own mock (the automatic fixture in e2e/test.ts). The old
// chain of serial projects existed only because ONE mock was shared — the
// clean-rebuild spec once loaded another spec's model and failed in every
// full run; that state is now each worker's own, reset before every test.
// The worker count comes from ONE variable (LCNC_E2E_WORKERS), which the
// round gate also uses for the slot ports it checks.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// node:fs, not an import: the config imports Playwright, which vitest need not load.
const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");

describe("Playwright project", () => {
  it("one project, a file's tests in order, the worker count from LCNC_E2E_WORKERS", () => {
    expect([...config.matchAll(/\bname:\s*"([\w-]+)"/g)].map(m => m[1])).toEqual(["e2e"]);
    expect(config).toMatch(/\bfullyParallel:\s*false\b/);
    expect(config).not.toMatch(/\bfullyParallel:\s*true\b/);
    expect(config).toMatch(/\bworkers:\s*Number\(process\.env\.LCNC_E2E_WORKERS \?\? 3\)/);
    expect(config).not.toMatch(/\bdependencies:/);
  });
});
