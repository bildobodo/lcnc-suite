import { test } from "../../e2e/test";
import { ctl } from "../../e2e/ctl";
import { participantA } from "../isolation";

test("A on its own worker's mock", async ({ mock }, info) => {
  await participantA(ctl, { slot: mock.slot, parallelIndex: info.parallelIndex, instance: mock.instance });
});
