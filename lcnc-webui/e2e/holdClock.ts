// Hold-to-fire under test runs on the PAGE's clock (hold after a stall,
// Codex R397 / R399): MachineBtn ends a hold whose watch saw a gap past
// HOLD_STALL_MS ("Page delayed — hold again"), and a loaded test runner
// stalls pages — a real-time press would then test the runner, not the
// control. A press's duration is the test's here; the stall itself is the
// subject of hold-stall.spec.ts (real time, by design).
import type { Page } from "./test";

const installed = new WeakSet<Page>();

/** Before the page loads: the app's timers on a clock the test can pause
 *  (once per page — a helper and its test may both ask). */
export async function installHoldClock(page: Page): Promise<void> {
  if (installed.has(page)) return;
  installed.add(page);
  await page.clock.install();
}

/** Pause the page's clock a second ahead of its own time (under load `page
 *  time + 50 ms` was in the past by the call's arrival — run-hold.spec's
 *  orientation case, 2026-11-03), run `body` (which advances it with
 *  `page.clock.runFor`), then let it run again. */
export async function onPageClock(page: Page, body: () => Promise<void>): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
  try {
    await body();
  } finally {
    await page.clock.resume();
  }
}

/** A mouse press of `ms` on the page's clock at the pointer's place. */
export async function holdMouse(page: Page, ms: number): Promise<void> {
  await onPageClock(page, async () => {
    await page.mouse.down();
    await page.clock.runFor(ms);
    await page.mouse.up();
  });
}
