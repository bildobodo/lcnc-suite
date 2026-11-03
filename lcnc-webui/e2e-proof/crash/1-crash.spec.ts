import { test } from "../../e2e/test";
import { mark } from "../barrier";

test("the worker ends hard mid-test", async ({ mock }) => {
  mark("crashed", { instance: mock.instance, slot: mock.slot, workerIndex: mock.workerIndex });
  process.exit(1);
});
