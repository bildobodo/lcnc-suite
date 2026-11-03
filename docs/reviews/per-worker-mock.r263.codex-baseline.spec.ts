import { test, expect } from "../../e2e/test";
import { ctl, MOCK } from "../../e2e/ctl";
import WebSocket from "ws";
const status = () => new Promise<any>((resolve, reject) => {
  const ws = new WebSocket(MOCK.replace(/^http/, "ws") + "ws");
  ws.on("error", reject);
  ws.on("message", data => {
    const m = JSON.parse(String(data));
    if (m.type === "status") { ws.close(); resolve(m); }
  });
});
test("R263 leave tool metadata from a previous test", async () => {
  await ctl({ op: "status_delta", data: {}, tool_meta: { id: 73, diameter: 42, holder_segments: [{ h: 23, d1: 51, d2: 51 }] } });
  expect((await status()).tool_meta.id).toBe(73);
});
test("R263 the auto baseline must remove the preceding tool metadata", async ({ mock }) => {
  const snapshot = (await ctl({ op: "snapshot" })).snapshot;
  expect(snapshot).toEqual(mock.pristine); // the new baseline claims success
  const frame = await status();
  console.log("R263 observed after auto reset: " + JSON.stringify(frame.tool_meta));
  expect(frame.tool_meta, "a fresh app must not inherit the previous test's tool").toBeUndefined();
});
