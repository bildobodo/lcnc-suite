import { test, expect } from "./test";
import { ctl } from "./ctl";

// The baseline fixture's contract (per-worker mock, Codex R261/R262
// PM261-01): whatever a test leaves on its worker's mock — another axis set,
// a status delta, a scripted reply, quiet, a setting — the next test of the
// same worker starts on the mock's baseline. The isolation harness proves
// the same across files and across workers.
const snapshot = async () => ((await ctl({ op: "snapshot" })) as { snapshot: Record<string, unknown> }).snapshot;

test("a test leaves its worker's mock dirty", async () => {
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"] });
  await ctl({ op: "status_delta", data: { active_file: "/dirty.ngc" } });
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [] } });
  await ctl({ op: "quiet", on: true });
  const s = await snapshot();
  expect(s.axes).toHaveLength(9);
  expect(s.replies).toEqual(["get_tool_table"]);
  expect(s.quiet).toBe(true);
});

test("the next test of the worker starts on the baseline", async ({ mock }) => {
  const s = await snapshot();
  expect(s.axes).toEqual(["X", "Y", "Z"]);
  expect(s.replies).toEqual([]);
  expect(s.quiet).toBe(false);
  expect(s.instance).toBe(mock.instance);
  expect(s).toEqual(mock.pristine);
});
