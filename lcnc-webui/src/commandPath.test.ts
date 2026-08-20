// One client path per command (issue #31).
//
// `send()` is raw transport. `fire()` adds the permission re-check and the busy
// latch. When the SAME command goes both ways it has two policies, and which
// one applies depends on which button the operator happened to press —
// `abort` was sent raw from four places and fired from four others, and the
// fired ones could be silently dropped by an unrelated command's cooldown.
//
// This is a source-shape guard, deliberately mirroring the backend's
// coverage-contract discipline (lcnc-gateway/test_command_policy.py parses
// gateway.py the same way): the invariant is about call sites, so a runtime
// test cannot see it.
import { describe, it, expect } from "vitest";

// Vite's glob rather than node:fs — this suite typechecks under the browser
// tsconfig, which has no node types.
const SOURCES = import.meta.glob("./*.{ts,vue}", {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

/** Commands that need no gate or latch at all. */
const NO_GATE_NEEDED = new Set([
  // Safety handshake and liveness: must work while disarmed / in E-Stop, and
  // the gateway maps them to gate "always" or handles them pre-dispatch.
  "arm", "estop", "estop_reset", "safety_trip_ack", "heartbeat", "hello",
  // Read-only queries and telemetry.
  "get_tool_table", "get_probe_results", "get_comp_grid", "get_probe_vars",
  "get_wcs_table", "list_probe_macros", "client_diag", "timing_log",
  "halshow_live", "halshow_refresh", "tab_visibility", "save_settings",
  "get_settings",
  // Hold-to-move jog: pointer-down/up pairs. A busy latch would swallow the
  // paired stop and the machine would keep moving — permissions.ts states this
  // as policy, and `jog` is deliberately outside BUSY_GATES.
  "jog_cont", "jog_incr", "jog_stop", "jog_cont_multi", "jog_incr_multi",
  "jog_stop_multi",
]);

/**
 * State-changing commands whose only CLIENT-side gate is the catalog control
 * (MachineBtn/MachineInput self-gate) inside the outer `<Gate>` fieldset, with
 * the real policy enforced by the backend (command_policy.COMMAND_GATES).
 *
 * They are raw on purpose, not by oversight: routing them through fire() would
 * add a third redundancy — an imperative re-check behind a DOM gate that
 * already disables the control and a backend gate that already refuses the
 * command — for no reachable failure. The asymmetry that DID matter (one
 * command, two policies) is caught by the test above.
 *
 * This list is a RATCHET: a new raw-only command fails the suite until someone
 * classifies it. Same discipline as the gateway's INLINE_EXEMPT.
 */
const DOM_GATED_ONLY = new Set([
  "add_tool", "save_tool", "delete_tool", "renumber_tool",  // ToolTablePanel
  "set_wcs", "clear_wcs",                                   // OffsetPanel
  "set_compensation",                                       // useDialogState (confirm dialog)
  "set_compensation_method", "simulate_probe_trip",         // ProbePanel via App
  "set_feed_override", "set_spindle_override", "set_rapid_override",
  "set_mode", "shutdown",
]);

function collect(re: RegExp): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [path, src] of Object.entries(SOURCES)) {
    if (path.endsWith(".test.ts")) continue;
    for (const m of src.matchAll(re)) {
      const cmd = m[1]!;
      if (!out.has(cmd)) out.set(cmd, new Set());
      out.get(cmd)!.add(path.replace("./", ""));
    }
  }
  return out;
}

describe("one client path per command", () => {
  const raw = collect(/\bsend\(\s*\{\s*cmd:\s*['"]([a-z_0-9]+)['"]/g);
  const fired = collect(/\bfire\(\s*\{\s*cmd:\s*['"]([a-z_0-9]+)['"]/g);

  it("parsed both call-site sets (guard against a vacuous pass)", () => {
    expect(raw.size).toBeGreaterThan(5);
    expect(fired.size).toBeGreaterThan(5);
  });

  it("no command is sent through BOTH send() and fire()", () => {
    const dual = [...fired.keys()]
      .filter((c) => raw.has(c))
      .map((c) => `${c}: raw in [${[...raw.get(c)!].sort()}], fired in [${[...fired.get(c)!].sort()}]`);
    expect(dual).toEqual([]);
  });

  it("commands that are raw everywhere are raw ON PURPOSE", () => {
    // A state-changing command sent only via raw send() is not an asymmetry,
    // but it IS a gap unless it is one of the documented classes above.
    const undocumented = [...raw.keys()]
      .filter((c) => !NO_GATE_NEEDED.has(c) && !DOM_GATED_ONLY.has(c) && !fired.has(c));
    expect(
      undocumented,
      "raw-only command classified nowhere — route it through fire(), or add " +
      "it to NO_GATE_NEEDED / DOM_GATED_ONLY with a reason",
    ).toEqual([]);
  });

  it("no stale entries in the raw-only classifications", () => {
    // A command that moved onto fire() must not keep its exemption.
    for (const c of DOM_GATED_ONLY) {
      expect(fired.has(c), `${c} is fired now — drop it from DOM_GATED_ONLY`).toBe(false);
      expect(raw.has(c), `${c} is no longer sent raw — drop it from DOM_GATED_ONLY`).toBe(true);
    }
  });

  it("stop commands are never routed somewhere that could drop them", () => {
    // abort is the one that bit: gate-checked but silently droppable.
    expect(raw.has("abort"), "abort must not be sent raw — it is gate-checked").toBe(false);
    expect(fired.has("abort")).toBe(true);
  });
});
