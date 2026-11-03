// Every spec's `test` (per-worker mock, Codex R261/R262): Playwright's, with
// two automatic fixtures. Specs import { test, expect, … } from "./test",
// never from "@playwright/test" (a guard holds it).
//
//  mock          (worker) — this worker's own mock gateway on its slot
//                (mockFixture.ts); the slot must be the worker's parallel
//                index, the address ctl.ts bound at import must be its port.
//  mockBaseline  (test)   — before every test, the confirmed baseline: no app
//                socket left from the test before, then `reset`, then the
//                mock's WHOLE snapshot equal to the one it had when it
//                started, and a fresh app client's connect frames (read off
//                the wire) equal to the ones it got then (Codex R263
//                PM263-01: a key the snapshot did not name once survived).
//                After the test, every context left open is closed (a
//                failing test's own contexts included). A mock that died
//                fails the test.
import { relative } from "node:path";
import { test as base, expect } from "@playwright/test";
import { appConnectFrames, ctl, MOCK } from "./ctl";
import { logEvent, startMock, stopMock, type MockHandle } from "./mockFixture";
import { portOf, slotOf } from "./mockSlot.mjs";

export * from "@playwright/test";

type Snapshot = Record<string, unknown>;
const snapshot = async (): Promise<Snapshot> => ((await ctl({ op: "snapshot" })) as { snapshot: Snapshot }).snapshot;

const noAppSockets = (why: string) => expect.poll(async () => (await snapshot()).clients,
  { timeout: 5_000, message: why }).toBe(0);
type Wire = Awaited<ReturnType<typeof appConnectFrames>>;

export const test = base.extend<{ mockBaseline: void }, { mock: MockHandle & { pristine: Snapshot; pristineWire: Wire } }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
  mock: [async ({}, use, workerInfo) => {
    const slot = slotOf(process.env.TEST_PARALLEL_INDEX);
    if (slot === null || slot !== workerInfo.parallelIndex)
      throw new Error(`worker slot ${process.env.TEST_PARALLEL_INDEX} is not the parallel index ${workerInfo.parallelIndex}`);
    if (MOCK !== `http://localhost:${portOf(slot)}/`)
      throw new Error(`ctl.ts bound ${MOCK}, the worker's slot is port ${portOf(slot)}`);
    const handle = await startMock(slot, workerInfo.workerIndex);
    const pristine = await snapshot();
    const pristineWire = await appConnectFrames();
    await noAppSockets("the pristine read's fresh client");
    try {
      await use({ ...handle, pristine, pristineWire });
    } finally {
      await stopMock(handle);
    }
  }, { scope: "worker", auto: true }],

  mockBaseline: [async ({ mock, browser }, use, testInfo) => {
    const where = { slot: mock.slot, workerIndex: mock.workerIndex, instance: mock.instance,
      file: relative(testInfo.project.testDir, testInfo.file), project: testInfo.project.name,
      title: testInfo.titlePath.slice(1).join(" › "),
      retry: testInfo.retry };
    if (mock.died()) throw new Error(`the worker's mock ended: ${mock.died()}`);
    // the test before closed its contexts at its end; their sockets close a moment later
    await noAppSockets("app sockets left from the test before");
    await ctl({ op: "reset" });
    // what a fresh app client gets (Codex R263 PM263-01), then its socket gone on the mock's side too
    const wire = await appConnectFrames();
    await noAppSockets("the baseline's own fresh client");
    expect(await snapshot(), "the mock's baseline after reset").toEqual(mock.pristine);
    expect(wire, "a fresh app client's connect frames after reset").toEqual(mock.pristineWire);
    logEvent({ event: "test-start", ...where });
    await use();   // resolves after the test, failed or not
    logEvent({ event: "test-end", ...where, status: testInfo.status });
    for (const c of browser.contexts()) await c.close().catch(() => {});
    if (mock.died()) throw new Error(`the worker's mock ended during the test: ${mock.died()}`);
  }, { auto: true }],
});
