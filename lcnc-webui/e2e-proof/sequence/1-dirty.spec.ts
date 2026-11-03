import { test } from "../../e2e/test";
import { ctl } from "../../e2e/ctl";
import { mark } from "../barrier";

test("the first file leaves its worker's mock dirty", async ({ mock }) => {
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"] });
  await ctl({ op: "status_delta", data: { active_file: "/dirty.ngc" } });
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [] } });
  await ctl({ op: "quiet", on: true });
  mark("dirty", { instance: mock.instance, workerIndex: mock.workerIndex });
});
