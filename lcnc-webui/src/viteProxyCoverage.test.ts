// The dev server (WEBUI_DEV=1, the live sim) serves the app on :5173 and
// forwards the gateway's HTTP routes through its proxy; the app fetches
// them from its own origin. A gateway route MISSING from the proxy answers
// in dev with Vite's index.html — the Macros tab read "JSON parse error"
// on the operator's live suite (2026-10-02), the sub view's source (/subfile)
// and a settings beacon on page hide (/settings) went nowhere, the camera
// stream (/camera) too. Every Playwright test runs the BUILT app against a
// mock, so none of them could see it. This test ties the two lists together.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const gateway = readFileSync(new URL("../../lcnc-gateway/gateway.py", import.meta.url), "utf8");
const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

/** Gateway HTTP routes, by their first path segment. */
const routes = [...new Set([...gateway.matchAll(/@app\.(?:get|post|put|delete|api_route)\(\s*"(\/[^"]*)"/g)]
  .map(m => "/" + m[1]!.split("/")[1]!.split("?")[0]!))];
/** The dev proxy's path prefixes (Vite matches a key as a prefix). */
const proxied = [...vite.matchAll(/^\s*'(\/[^']*)':/gm)].map(m => m[1]!);
/** Not fetched through the dev server's origin: the page itself, and the
 *  reconnect gate the WebSocket worker asks the gateway's port directly. */
const DIRECT = new Set(["/", "/index.html", "/ready", "/health"]);

describe("the dev server proxies every gateway HTTP route", () => {
  it("found both lists", () => {
    expect(routes.length).toBeGreaterThan(10);
    expect(proxied.length).toBeGreaterThan(10);
  });
  it("no route the app fetches from its own origin is missing from vite.config.ts", () => {
    const missing = routes.filter(r => !DIRECT.has(r) && !proxied.some(k => r.startsWith(k)));
    expect(missing, "add these to the proxy in vite.config.ts").toEqual([]);
  });
});
