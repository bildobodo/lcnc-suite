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
// tsconfig, which has no node types. Every folder (#31 leftover, package 3c:
// the guard read the top folder only); not the tests, not the test-only
// inventory scanners (their strings name send forms), not the socket worker
// (its three frames are commandShapes.test.ts' WORKER_FRAMES inventory).
const SOURCES = import.meta.glob(
  ["./**/*.{ts,vue}", "!./**/*.test.ts", "!./inventory/**", "!./controlScan.ts", "!./controlInventory.ts",
   "!./wsWorker.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The source without its comments — a `send(…)` in a comment is no call.
 *  (Line comments only where `//` opens one: not inside a URL's `://`.) */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Commands that need no gate or latch at all. */
const NO_GATE_NEEDED = new Set([
  // Safety handshake and liveness: must work while disarmed / in E-Stop, and
  // the gateway maps them to gate "always" or handles them pre-dispatch.
  "arm", "estop", "estop_reset", "safety_trip_ack", "heartbeat", "hello",
  // Read-only queries and telemetry.
  "get_tool_table", "get_probe_results", "get_comp_grid",
  "get_wcs_table", "list_probe_macros", "client_diag", "timing_log",
  "halshow_live", "halshow_refresh", "tab_visibility", "save_settings",
  "get_settings",
  // The device profiles' own commands: answered by the reader like the
  // settings frames, no machine effect (settings split package 1).
  "device_rename", "device_reset", "device_delete",
  // Hold-to-move jog: pointer-down/up pairs. A busy latch would swallow the
  // paired stop and the machine would keep moving — permissions.ts states this
  // as policy, and `jog` is deliberately outside BUSY_GATES.
  "jog_cont", "jog_incr", "jog_stop", "jog_cont_multi", "jog_incr_multi",
  "jog_stop_multi",
]);

/**
 * State-changing commands whose only CLIENT-side gate is the catalog control
 * (MachineBtn/MachineInput self-gate, or the inner `<Gate>` around it — the
 * outer armed fieldset is gone since button gates package C), with the real
 * policy enforced by the backend (command_policy.COMMAND_GATES): the
 * overrides under `override` (OverridesStrip's Gate), `simulate_probe_trip`
 * under `simTrip` (armed), `shutdown` under `shutdown` (armed; the gateway
 * requires arm too since package C).
 *
 * They are raw on purpose, not by oversight: routing them through fire() would
 * add a third redundancy — an imperative re-check behind a gate that already
 * disables the control and a backend gate that already refuses the command —
 * for no reachable failure. The asymmetry that DID matter (one
 * command, two policies) is caught by the test above.
 *
 * This list is a RATCHET: a new raw-only command fails the suite until someone
 * classifies it. Same discipline as the gateway's INLINE_EXEMPT.
 */
const DOM_GATED_ONLY = new Set([
  // The tool-table writes (add/save/delete/renumber), the WCS writes
  // (set_wcs/clear_wcs), set_compensation (useDialogState's `fire` option),
  // set_compensation_method and set_mode moved onto fire() in the UI review
  // wave (WP3/WP6, 2026-09-20) and left this ratchet.
  "simulate_probe_trip",                                    // ProbePanel via App
  "set_feed_override", "set_spindle_override", "set_rapid_override",
  "shutdown",
  // G30 (ToolsetterSettings' g30Request): request() with ITS reply and a
  // busy flag of its own; Refresh / Use Current / Save self-gate
  // (parameterRead / g30Capture / g30Write) and the gateway refuses the same
  // classes — found once the guard read request() too (package 3c).
  "read_g30", "capture_g30", "set_g30",
]);

/**
 * Every call whose first argument is NOT an object literal naming its `cmd`
 * — a relay, a payload built elsewhere, a job — keyed `file|call text`. Each
 * names the path it is (`raw`: send()/request(); `fired`: fire() or a caller
 * that re-checks the gate and holds the busy latch itself; `relay`: hands on
 * what its callers pass, whose literal sends are collected where they are
 * written; `transport`: fire()'s or request()'s own send) and the commands it
 * carries.
 *
 * The carried commands are a DECLARATION: a source scan cannot evaluate the
 * argument. Where the code types it, the type names them (`fireJob`'s
 * Extract<WsCommand, …>, `JogStopCommand`, `g30Request`'s and `deviceCmd`'s
 * unions); the browser specs drive each path. What the scan DOES hold: a new
 * variable send fails until it is classified here, and an entry whose call is
 * gone fails as stale.
 */
const VARIABLE_SENDS: Record<string, { path: "raw" | "fired" | "relay" | "transport"; cmds: string[] }> = {
  "App.vue|send(payload)": { path: "transport", cmds: [] },                      // inside fire()
  "lcncWs.ts|send(obj)": { path: "transport", cmds: [] },                        // inside request()
  "App.vue|request(job, 15000)": { path: "fired", cmds: ["probe_run", "surface_scan_run", "tool_measure", "tool_unload_measure"] }, // fireJob: gate + busy latch
  "App.vue|fire(c, 'ready')": { path: "fired", cmds: ["mdi"] },                 // useMdiHistory's send
  "App.vue|send(viaGamepad(cmd))": { path: "relay", cmds: [] },                  // the pad's raw sends (useGamepad.ts)
  "App.vue|fire(viaGamepad(cmd), gate)": { path: "relay", cmds: [] },            // the pad's fired sends (useGamepad.ts)
  "ToolTablePanel.vue|fire(payload, \"toolTableWrite\")": { path: "fired", cmds: ["add_tool", "save_tool", "renumber_tool"] },
  "ToolsetterSettings.vue|request(msg, 15000)": { path: "raw", cmds: ["read_g30", "capture_g30", "set_g30"] },
  "DevicesSettings.vue|request(cmd)": { path: "raw", cmds: ["device_rename", "device_reset", "device_delete"] },
  "useDialogState.ts|opts.fire(payload, \"ready\")": { path: "fired", cmds: ["set_compensation"] },
  "useGamepad.ts|deps.send(c)": { path: "raw", cmds: ["jog_stop", "jog_stop_multi"] },
  "useGamepad.ts|deps.send(stop)": { path: "raw", cmds: ["jog_stop", "jog_stop_multi"] },
  "useKeyboardShortcuts.ts|opts.send(stop)": { path: "raw", cmds: ["jog_stop", "jog_stop_multi"] },
  "useKeyboardShortcuts.ts|opts.send(c)": { path: "raw", cmds: ["jog_stop", "jog_stop_multi"] },
  "JogStrip.vue|send(c)": { path: "raw", cmds: ["jog_stop", "jog_stop_multi"] },
};

const CALL = String.raw`\b(?<!function\s)((?:[\w$]+!?\.)?(?:send|fire|request))\(\s*`;

function add(out: Map<string, Set<string>>, cmd: string, path: string) {
  if (!out.has(cmd)) out.set(cmd, new Set());
  out.get(cmd)!.add(path);
}

/** Literal sends: `{ cmd: "x" …` and `{ cmd: cond ? "x" : "y" …` (both). */
function collect(callees: RegExp): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const lit = new RegExp(CALL + String.raw`\{\s*cmd:\s*['"]([a-z_0-9]+)['"]`, "g");
  const tern = new RegExp(CALL + String.raw`\{\s*cmd:\s*[^,}'"]*\?\s*['"]([a-z_0-9]+)['"]\s*:\s*['"]([a-z_0-9]+)['"]`, "g");
  for (const [path, src] of Object.entries(SOURCES)) {
    const rel = path.replace("./", ""), text = code(src);
    for (const m of text.matchAll(lit)) if (callees.test(m[1]!)) add(out, m[2]!, rel);
    for (const m of text.matchAll(tern)) if (callees.test(m[1]!)) { add(out, m[2]!, rel); add(out, m[3]!, rel); }
  }
  return out;
}

/** `file|call text` of every call whose argument is no object literal (and
 *  no string — `wakeLock.request("screen")`), and every object-literal call
 *  that does not open with `cmd:` (the literal scan could not read it). */
function variableSends(): { found: string[]; cmdNotFirst: string[] } {
  const found: string[] = [], cmdNotFirst: string[] = [];
  const v = new RegExp(CALL + String.raw`(?![{'"\x60\s)])([^,()]*(?:\([^()]*\))?[^,()]*)(\s*,[^()]*?)?\)`, "g");
  const o = new RegExp(CALL + String.raw`\{(?!\s*cmd:)`, "g");
  for (const [path, src] of Object.entries(SOURCES)) {
    const rel = path.replace("./", ""), text = code(src);
    for (const m of text.matchAll(v)) found.push(`${rel}|${m[0].slice(m[0].indexOf(m[1]!)).replace(/\s+/g, " ")}`);
    for (const m of text.matchAll(o)) cmdNotFirst.push(`${rel}|${m[0]}`);
  }
  return { found, cmdNotFirst };
}

describe("one client path per command", () => {
  const raw = collect(/(^|\.)(send|request)$/);
  const fired = collect(/(^|\.)fire$/);
  for (const [key, e] of Object.entries(VARIABLE_SENDS)) {
    const target = e.path === "raw" ? raw : e.path === "fired" ? fired : null;
    for (const c of e.cmds) if (target) add(target, c, key.split("|")[0]!);
  }

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

  it("every variable-argument send is classified, and no entry is stale", () => {
    const { found, cmdNotFirst } = variableSends();
    expect(found.length, "the scan found the relays (guard against a vacuous pass)").toBeGreaterThan(8);
    const unclassified = found.filter((k) => !(k in VARIABLE_SENDS));
    expect(unclassified, "a send whose command the scan cannot read — classify it in VARIABLE_SENDS").toEqual([]);
    const stale = Object.keys(VARIABLE_SENDS).filter((k) => !found.includes(k));
    expect(stale, "VARIABLE_SENDS names a call that is gone").toEqual([]);
    expect(cmdNotFirst, "an object-literal send whose first key is not cmd — put cmd first").toEqual([]);
  });

  it("the ternary form is read (coolant: both commands, fired)", () => {
    for (const c of ["flood_on", "flood_off", "mist_on", "mist_off"]) expect(fired.has(c), c).toBe(true);
  });

  it("stop commands are never routed somewhere that could drop them", () => {
    // abort is the one that bit: gate-checked but silently droppable.
    expect(raw.has("abort"), "abort must not be sent raw — it is gate-checked").toBe(false);
    expect(fired.has("abort")).toBe(true);
  });
});
