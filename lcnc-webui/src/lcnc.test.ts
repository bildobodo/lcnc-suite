import { describe, it, expect } from "vitest";
import { isQueueSafe, isNeverDebounced, cooldownFor, DEFAULT_COOLDOWN_MS } from "./lcnc";

describe("isQueueSafe (issue #18 — what may queue across a reconnect)", () => {
  it("allows read-only get_* commands", () => {
    expect(isQueueSafe("get_tool_table")).toBe(true);
    expect(isQueueSafe("get_probe_results")).toBe(true);
    expect(isQueueSafe("get_wcs_table")).toBe(true);
  });

  it("allows telemetry / visibility commands", () => {
    for (const c of ["heartbeat", "client_diag", "timing_log", "tab_visibility", "halshow_live", "safety_trip_ack"]) {
      expect(isQueueSafe(c)).toBe(true);
    }
  });

  it("DROPS motion / mutation commands", () => {
    for (const c of [
      "jog_cont", "jog_incr", "mdi", "cycle_start", "auto_run",
      "spindle_forward", "set_feed_override", "tool_change",
      "add_tool", "delete_tool", "renumber_tool", "load_file", "machine_on",
    ]) {
      expect(isQueueSafe(c)).toBe(false);
    }
  });
});

describe("client transport policy (issue #31)", () => {
  // The defect this exists to prevent: fire() opens with `if (busy.value)
  // return` — a SILENT drop — and abort is routed through it from the keyboard
  // and the gamepad, so an abort pressed within another action's cooldown was
  // discarded. A stop control must never depend on client-side pacing.
  it("never debounces a stop command", () => {
    for (const c of ["abort", "estop", "estop_reset", "jog_stop", "jog_stop_multi"]) {
      expect(isNeverDebounced(c), `${c} must bypass the busy latch`).toBe(true);
      expect(cooldownFor(c), `${c} must hold no latch`).toBe(0);
    }
  });

  it("debounces motion commands by default", () => {
    for (const c of ["mdi", "cycle_start", "auto_run", "home", "tool_change",
                     "spindle_forward", "set_probe_vars"]) {
      expect(isNeverDebounced(c)).toBe(false);
      expect(cooldownFor(c)).toBe(DEFAULT_COOLDOWN_MS);
    }
  });

  it("flag toggles and continuous inputs hold no latch", () => {
    // These used to route AROUND fire() because a flat 200 ms cooldown made a
    // checkbox feel laggy and dropped the second click of a deliberate pair —
    // which is how they ended up on a second code path.
    for (const c of ["set_optional_stop", "set_block_delete",
                     "set_feed_override", "set_spindle_override",
                     "set_rapid_override", "set_max_velocity"]) {
      expect(cooldownFor(c)).toBe(0);
      expect(isNeverDebounced(c), `${c} is paced, just not latched`).toBe(false);
    }
  });

  it("an unknown command gets the safe default, not zero", () => {
    expect(cooldownFor("something_new")).toBe(DEFAULT_COOLDOWN_MS);
  });

  it("carries no permission gates", async () => {
    // A gate table here would re-derive the backend's COMMAND_GATES on the
    // client — what permissions.ts forbids, and a guaranteed drift source.
    const src = await import("./lcnc?raw");
    expect(String(src.default)).not.toMatch(/gate\s*:/);
  });
});
