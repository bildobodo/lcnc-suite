import { test, expect } from "./test";
import { appConnectFrames, ctl } from "./ctl";

// The baseline fixture's contract (per-worker mock, Codex R261/R262
// PM261-01, R263 PM263-01): whatever a test leaves on its worker's mock —
// another axis set, a status delta, the tool's geometry, an envelope key, a
// kinematics declaration, the INI's increments, a scripted reply, quiet, a
// setting — the next test of the same worker starts on the mock's baseline,
// in its snapshot AND on the wire of a fresh app client. The isolation
// harness proves the same across files and across workers.
const snapshot = async () => ((await ctl({ op: "snapshot" })) as { snapshot: Record<string, unknown> }).snapshot;
const TOOL = { id: 73, diameter: 42, holder_segments: [{ h: 23, d1: 51, d2: 51 }] };

test("a test leaves its worker's mock dirty", async () => {
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"] });
  await ctl({ op: "status_delta", data: { active_file: "/dirty.ngc" }, tool_meta: TOOL,
    envelope: { run_basis: { version: 7 } } });
  await ctl({ op: "setKins", kins: { switchable: true } });
  await ctl({ op: "setIncrements", increments: [1, 10] });
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [] } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { dirty: true } } } });
  await ctl({ op: "settingsEcho", on: false });
  await ctl({ op: "quiet", on: true });
  const s = await snapshot();
  expect(s.axes).toHaveLength(9);
  expect(s.replies).toEqual(["get_tool_table"]);
  expect(s.quiet).toBe(true);
  // the dirt is on the wire: a fresh client sees the tool and the declaration
  const wire = await appConnectFrames();
  expect(wire.status.tool_meta).toEqual(TOOL);
  expect(wire.status.run_basis).toEqual({ version: 7 });
  expect((wire.viewerInit.data as Record<string, unknown>).kins).toEqual({ switchable: true });
});

test("the next test of the worker starts on the baseline", async ({ mock }) => {
  const s = await snapshot();
  expect(s.axes).toEqual(["X", "Y", "Z"]);
  expect(s.replies).toEqual([]);
  expect(s.quiet).toBe(false);
  expect(s.instance).toBe(mock.instance);
  expect(s).toEqual(mock.pristine);
  const wire = await appConnectFrames();
  expect(wire.status.tool_meta, "a fresh client must not get the previous test's tool").toBeUndefined();
  expect(wire.status.run_basis, "nor its envelope key").toBeUndefined();
  expect((wire.viewerInit.data as Record<string, unknown>).kins, "nor its kinematics").toBeUndefined();
  expect(wire).toEqual(mock.pristineWire);
});
