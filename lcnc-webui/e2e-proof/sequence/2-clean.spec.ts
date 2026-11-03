import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../../e2e/test";
import { ctl } from "../../e2e/ctl";
import { mark } from "../barrier";

test("the next file of the same worker starts on the baseline", async ({ mock }) => {
  const dirty = JSON.parse(readFileSync(join(process.env.LCNC_PROOF_DIR!, "dirty"), "utf8"));
  expect(dirty.instance, "the same worker's mock").toBe(mock.instance);
  const s = ((await ctl({ op: "snapshot" })) as { snapshot: Record<string, unknown> }).snapshot;
  expect(s).toEqual(mock.pristine);
  mark("clean", { instance: mock.instance });
});
