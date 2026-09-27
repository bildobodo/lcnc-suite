// Every serial Playwright project runs its FILES on one worker. The serial
// projects share ONE mock gateway whose state (viewer_init, programs, axes)
// is global: `fullyParallel: false` only serialises a file's tests, so a
// project with two files and no `workers: 1` runs them side by side. That
// happened when scenes.viewer.spec.ts joined viewer.spec.ts (review round
// 6): the clean-rebuild spec loaded the scenes spec's model and previews and
// failed in every full `playwright test` — the offline gate — while the
// per-project runs, forced to one worker, stayed green.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// node:fs, not an import: the config imports Playwright, which vitest need not load.
const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");

describe("Playwright serial projects", () => {
  it("every serial project runs its files on one worker", () => {
    // A project object closes at four spaces of indentation.
    const projects = [...config.matchAll(/name:\s*"(serial-[\w-]+)"([\s\S]*?)\n {4}\}/g)];
    expect(projects.length, "the serial chain").toBeGreaterThanOrEqual(8);
    expect(projects.filter(([, , body]) => !/\bworkers:\s*1\b/.test(body!)).map(([, name]) => name)).toEqual([]);
  });
});
