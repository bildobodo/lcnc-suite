// Every var file the examples ship declares every number the WebUI writes:
// the gateway refuses a number the machine's var file does not declare (W3),
// and the probe panel and the toolsetter send theirs with each call — the
// examples declared nothing past #3014, so every probe was refused
// (operator 2026-11-02: "Command: set_probe_vars: #3015 is not in this
// machine's var file"). LinuxCNC reads the file only in ascending order
// ("Parameter file out of order"). Node-side: it reads the repository.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROBE_FALLBACK, calibrationVarMap } from "./probeVars";
import { TOOLSETTER_FALLBACK, toolsetterVarMap } from "./toolsetterSetup";

const EXAMPLES = fileURLToPath(new URL("../../examples/sim_config", import.meta.url));
const VAR_FILES = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(EXAMPLES, d.name, "sim.var")))
  .map(d => join(d.name, "sim.var"));
const WRITTEN = [...new Set([
  ...Object.keys(calibrationVarMap(PROBE_FALLBACK, 1, 0)),
  ...Object.keys(toolsetterVarMap(TOOLSETTER_FALLBACK)),
].map(Number))].sort((a, b) => a - b);

describe("the shipped var files", () => {
  it("are found: one per example profile", () => {
    expect(VAR_FILES.length).toBeGreaterThanOrEqual(3);
  });
  for (const rel of VAR_FILES) {
    const nums = readFileSync(join(EXAMPLES, rel), "utf8").split(/\r?\n/)
      .map(l => l.trim().split(/\s+/)[0]).filter(t => t && /^\d+$/.test(t)).map(Number);
    it(`${rel} declares every number the probe panel and the toolsetter write`, () => {
      expect(WRITTEN.filter(n => !nums.includes(n))).toEqual([]);
    });
    it(`${rel} is in ascending order, as LinuxCNC reads it`, () => {
      expect(nums.filter((n, i) => i > 0 && n <= nums[i - 1]!)).toEqual([]);
    });
  }
});
