// The dev plugin's patch against the INSTALLED Vite client (2026-09-23): the
// restart ping must go over HTTP, the patched function must still run on its
// own (the client stringifies it into a SharedWorker blob), and a Vite update
// that changes the ping must fail here and in the dev server — never a silent
// no-op that brings the WebSocket ping back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PATCH_MARKER, httpRestartPing, patchViteClientPing } from "../viteHttpRestartPing";

const require_ = createRequire(import.meta.url);
const CLIENT_PATH = require_.resolve("vite/dist/client/client.mjs");
const client = readFileSync(CLIENT_PATH, "utf8");

/** Source of `async function <name>(…) { … }` in `code`, brace-matched. */
function functionSource(code: string, name: string): string {
  const start = code.indexOf(`async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = code.indexOf("{", start); i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("viteHttpRestartPing against the installed Vite client", () => {
  const patched = patchViteClientPing(client);

  it("replaces the WebSocket ping with the HTTP one", () => {
    expect(client).toContain('new WebSocket(socketUrl, "vite-ping")');
    expect(patched).not.toContain('"vite-ping"');
    expect(patched).toContain(PATCH_MARKER);
    // Only the ping changed: the HMR socket itself is untouched.
    expect(patched).toContain('"vite-hmr"');
  });

  it("the patched poller runs on its own and pings over HTTP until the server answers", async () => {
    // As the client does for its SharedWorker: the function's own source, nothing else.
    const src = functionSource(patched, "waitForSuccessfulPingInternal");
    const waitFor = new Function(`return (${src})`)() as
      (url: string, vis: { currentState: string; listeners: Set<unknown> }, ms?: number) => Promise<void>;
    const calls: Array<[string, RequestInit | undefined]> = [];
    let answers = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (++answers < 3) throw new TypeError("NetworkError");
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await waitFor("ws://192.168.64.4:5173/", { currentState: "visible", listeners: new Set() }, 1);
    expect(calls).toHaveLength(3);
    expect(calls[0]![0]).toBe("http://192.168.64.4:5173/");
    expect(calls[0]![1]).toMatchObject({ headers: { Accept: "text/x-vite-ping" }, cache: "no-store" });
  });

  it("the plugin transforms only the client module", () => {
    const plugin = httpRestartPing();
    const transform = plugin.transform as (this: unknown, code: string, id: string) => { code: string } | null;
    const ctx = { error(e: Error): never { throw e; } };
    expect(transform.call(ctx, "x", "/src/main.ts")).toBeNull();
    expect(transform.call(ctx, client, `${CLIENT_PATH}?v=abc`)!.code).toContain(PATCH_MARKER);
  });
});

describe("a Vite client without the expected ping fails loudly", () => {
  it("throws from the patch and errors the transform", () => {
    expect(() => patchViteClientPing("async function ping() { return true; }")).toThrow(/Vite changed/);
    const transform = httpRestartPing().transform as (this: unknown, code: string, id: string) => unknown;
    const ctx = { error(e: Error): never { throw e; } };
    expect(() => transform.call(ctx, "export {}", "/n/node_modules/vite/dist/client/client.mjs")).toThrow(/Vite changed/);
  });
});
