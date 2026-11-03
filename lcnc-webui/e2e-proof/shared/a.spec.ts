import { test } from "@playwright/test";
import { sharedCtl } from "./shared";
import { participantA } from "../isolation";

test("A on the one shared mock", async ({}, info) => {   // eslint-disable-line no-empty-pattern
  await participantA(sharedCtl, { parallelIndex: info.parallelIndex, shared: process.env.LCNC_PROOF_SHARED });
});
