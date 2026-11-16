import { test, expect } from "./test";
import { MOCK } from "./ctl";

test("R386: an unrelated POST can replace a missing unload beacon", async ({ page }) => {
  await page.route("**/telemetry*", async route => {
    const url = route.request().url();
    if (url.includes("codex-beacon=2")) {
      console.log("R386_HELD_PAGEHIDE: accepted by sendBeacon, never forwarded to the mock");
      // Leave this specific request pending until the context closes.
      return;
    }
    console.log("R386_FORWARDED:", url.includes("codex-extra") ? "ordinary fetch" : "other telemetry");
    await route.continue();
  });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await page.evaluate((extraPost) => {
    const original = navigator.sendBeacon.bind(navigator);
    let seq = 0;
    navigator.sendBeacon = (url, data) => {
      const marked = new URL(String(url), location.href);
      marked.searchParams.set("codex-beacon", String(++seq));
      return original(marked.href, data);
    };
    if (extraPost) addEventListener("beforeunload", () => {
      void fetch("/telemetry?codex-extra=1", { method: "POST", body: '{"event":"codex.extra"}\n', keepalive: true });
    });
  }, process.env.R386_EXTRA_POST !== "0");
  // The unchanged page fixture now counts two accepted sendBeacon calls;
  // only beforeunload + the unrelated fetch can reach the mock.
});
