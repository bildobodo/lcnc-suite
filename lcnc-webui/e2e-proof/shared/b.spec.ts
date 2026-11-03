import { test } from "@playwright/test";
import { sharedCtl } from "./shared";
import { participantB } from "../isolation";

test("B on the one shared mock", async ({}, info) => {   // eslint-disable-line no-empty-pattern
  await participantB(sharedCtl, { parallelIndex: info.parallelIndex, shared: process.env.LCNC_PROOF_SHARED });
});
