import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../e2e/test";
import { ctl } from "../../e2e/ctl";
import { mark } from "../barrier";

test("the replacement worker binds a new mock on the slot, at the baseline", async ({ mock }) => {
  const crashed = JSON.parse(readFileSync(join(process.env.LCNC_PROOF_DIR!, "crashed"), "utf8"));
  expect(mock.slot, "the same slot").toBe(crashed.slot);
  expect(mock.workerIndex, "a new worker").not.toBe(crashed.workerIndex);
  expect(mock.instance, "a new mock").not.toBe(crashed.instance);
  const s = ((await ctl({ op: "snapshot" })) as { snapshot: Record<string, unknown> }).snapshot;
  expect(s).toEqual(mock.pristine);
  mark("replaced", { instance: mock.instance, workerIndex: mock.workerIndex });
});
