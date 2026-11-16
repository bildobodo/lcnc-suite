import { test, expect, type Page } from "./test";
import { MOCK } from "./ctl";

// The guard of the Firefox unload's receipt (Codex R386 VM-I25, their probe
// vor-maschine.ff.r386.codex-unload.spec.ts): the page fixture
// (e2e/test.ts unloadInContext) closes a context only once EACH beacon the
// unload handed off reached the mock, matched by its own mark — never by a
// count of POSTs, which an unrelated POST could fill for a beacon that never
// arrived (and the replay sees no request it could call ownerless).
//
// Not a core test and no `.spec.ts`: only the Firefox runner runs it
// (scripts/test_select/firefox.py, check firefox-unload-guard, with
// LCNC_FIREFOX_SET=unload-guard) and judges it on the fixture's unload EVENT,
// not only on the expected failure.

/** The app loaded, then the guard's own numbering of every sendBeacon call
 *  (the fixture's mark is added before it, in the same order), and — for
 *  the held case — an unrelated POST at beforeunload. */
async function openApp(page: Page, extraPost: boolean) {
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await page.evaluate((extra) => {
    const original = navigator.sendBeacon.bind(navigator);
    let seq = 0;
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const u = new URL(String(url), location.href);
      u.searchParams.set("guard_seq", String(++seq));
      return original(u.href, data);
    };
    if (extra) addEventListener("beforeunload", () => {
      void fetch("/telemetry?guard_extra=1", { method: "POST", body: '{"event":"guard.extra"}\n', keepalive: true });
    });
  }, extraPost);
}

test("held: the unload's second beacon never reaches the mock while an unrelated POST does", async ({ page }) => {
  test.fail(true, "the page fixture must refuse this unload: its second beacon was never received");
  await page.route("**/telemetry*", async route => {
    if (new URL(route.request().url()).searchParams.get("guard_seq") === "2") {
      console.log(`unload guard: held ${route.request().url()}`);
      return;   // never forwarded: pending until the context closes
    }
    await route.continue();
  });
  await openApp(page, true);
});

test("control: every beacon of the unload reaches the mock", async ({ page }) => {
  await openApp(page, false);
});
