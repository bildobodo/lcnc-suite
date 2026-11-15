// The probe panel's two jobs the native stage runs through the UI's handlers
// (plan R380–R381, Codex VM380-01): scripts/test_fixtures/probe_panel_jobs.json
// names each one's panel state, view, button and WHOLE job. This guard builds
// each map from its panel with probeVars.ts — the ONE source of the numbers;
// probe-click.spec presses the button with that panel and compares the job
// the page sends, and native_run reads its vars from the same file. A Z
// surface job with Auto Zero on is mode 0 (it sets the WCO) — the panel's own
// starting point (autoZero false) would send mode 1. Node-side: it reads the
// repository.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProbeDefaults } from "./defaults";
import { PROBE_FALLBACK, probeVarMap, surfaceVarMap } from "./probeVars";

type Entry = { view: string; button: string; panel: ProbeDefaults;
               job: { cmd: string; routine?: string; vars: Record<string, number> } };
const JOBS = JSON.parse(readFileSync(new URL("../../scripts/test_fixtures/probe_panel_jobs.json", import.meta.url),
                                     "utf8")) as Record<string, Entry>;

const withoutAutoZero = (p: ProbeDefaults): Omit<ProbeDefaults, "autoZero"> => {
  const { autoZero: _, ...rest } = p;
  return rest;
};

describe("the probe panel's jobs (fixture)", () => {
  it("names exactly the two jobs, each with a whole panel state", () => {
    expect(Object.keys(JOBS).filter(k => !k.startsWith("_")).sort()).toEqual(["surface_scan", "z_surface"]);
    for (const [name, e] of Object.entries(JOBS).filter(([k]) => !k.startsWith("_"))) {
      expect(Object.keys(e.panel).sort(), `${name}: every panel input, no other`).toEqual(Object.keys(PROBE_FALLBACK).sort());
    }
  });
  it("Z surface: probe_z_minus_wco with Auto Zero ON — mode 0, the map of its panel", () => {
    const e = JOBS.z_surface!;
    expect(e.panel.autoZero).toBe(true);
    expect([e.view, e.button, e.job.cmd, e.job.routine]).toEqual(["Outside", "Z surface", "probe_run", "probe_z_minus_wco"]);
    expect(e.job.vars).toEqual(probeVarMap(withoutAutoZero(e.panel), e.panel.autoZero ? 0 : 1));
    expect(e.job.vars["3030"]).toBe(0);
  });
  it("Start Scan: surface_scan_run with the 3-axis profile's grid, the map of its panel", () => {
    const e = JOBS.surface_scan!;
    expect([e.view, e.button, e.job.cmd, e.job.routine]).toEqual(["Surface", "Start Scan", "surface_scan_run", undefined]);
    expect(e.job.vars).toEqual(surfaceVarMap(withoutAutoZero(e.panel)));
  });
});
