import { test } from "../../e2e/test";
import { ctl } from "../../e2e/ctl";
import { participantB } from "../isolation";

test("B on its own worker's mock", async ({ mock }, info) => {
  await participantB(ctl, { slot: mock.slot, parallelIndex: info.parallelIndex, instance: mock.instance });
});
