// The two participants of the isolation proof (per-worker mock, Codex
// R261/R262 PM261-04), the same steps whatever mock they are bound to:
//  A dirties its mock (9 axes, a scripted reply, quiet), marks A-set, waits
//    for B-checked, then requires its state STILL standing (A-final).
//  B waits for A-set, resets its mock, requires the baseline, marks B-checked.
// Against own mocks both pass. Against ONE shared mock A must lose its state
// to B's confirmed reset — the expected deviation the outer harness requires.
import { expect } from "@playwright/test";
import { mark, waitFor } from "./barrier";

type Ctl = (op: Record<string, unknown>) => Promise<{ snapshot?: Record<string, unknown> }>;
const NINE = ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"];

export async function participantA(ctl: Ctl, who: Record<string, unknown>): Promise<void> {
  await ctl({ op: "setAxes", axes: NINE });
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [] } });
  await ctl({ op: "quiet", on: true });
  mark("A-set", who);
  await waitFor("B-checked");
  const s = (await ctl({ op: "snapshot" })).snapshot!;
  mark("A-final", { ...who, axes: s.axes, replies: s.replies, quiet: s.quiet });
  expect({ axes: s.axes, replies: s.replies, quiet: s.quiet }, "A's own state after B's reset")
    .toEqual({ axes: NINE, replies: ["get_tool_table"], quiet: true });
}

export async function participantB(ctl: Ctl, who: Record<string, unknown>): Promise<void> {
  await waitFor("A-set");
  await ctl({ op: "reset" });
  const s = (await ctl({ op: "snapshot" })).snapshot!;
  expect({ axes: s.axes, replies: s.replies, quiet: s.quiet }, "B's baseline")
    .toEqual({ axes: ["X", "Y", "Z"], replies: [], quiet: false });
  mark("B-checked", who);
}
