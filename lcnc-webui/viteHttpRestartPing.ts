// Dev-only Vite plugin: the HMR client's "server connection lost. Polling for
// restart…" ping goes over HTTP instead of a WebSocket (2026-09-23).
//
// Why: Firefox lets only ONE WebSocket per IP ADDRESS — across ports — be
// connecting (or held by its failure backoff) at a time, and it remembers
// failed WebSocket connections per IP:port for up to 60 s, across reloads.
// Vite 7 pings a stopped dev server with `new WebSocket(url, "vite-ping")`
// and no timeout, once a second; through a suite restart that ran the :5173
// backoff up to 60 s, and every held ping queued the page's gateway socket
// (:8000, same IP) behind it — tabs sat on "reconnecting" 35–58 s (trace
// 2026-09-19/23). An HTTP ping never touches the WebSocket backoff. Vite's
// server still answers it: `viteHMRPingMiddleware` returns 204 for
// `Accept: text/x-vite-ping` (the ping Vite 4 itself used).
//
// The patch rewrites one function inside the installed client
// (vite/dist/client/client.mjs). If a Vite update changes that function the
// transform FAILS the request loudly — never a silent no-op — and
// viteHttpRestartPing.test.ts fails against the installed client.
import type { Plugin } from "vite";

const WS_PING = 'new WebSocket(socketUrl, "vite-ping")';
const PING_FN = "async function ping() {";
export const PATCH_MARKER = "lcnc-suite: HTTP restart ping";

// `waitForSuccessfulPingInternal` is stringified into a SharedWorker blob by
// the client, so the replacement must be self-contained (fetch, AbortController
// and setTimeout exist in a worker).
const HTTP_PING = `async function ping() {
		// ${PATCH_MARKER} (lcnc-webui/viteHttpRestartPing.ts)
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), 2000);
		try {
			await fetch(socketUrl.replace(/^ws/, "http"), {
				mode: "no-cors",
				cache: "no-store",
				headers: { Accept: "text/x-vite-ping" },
				signal: ctl.signal
			});
			return true;
		} catch {
			return false;
		} finally {
			clearTimeout(timer);
		}
	}`;

/** Replace the client's WebSocket `ping()` with the HTTP one; throw if it is not there. */
export function patchViteClientPing(code: string): string {
  const wsAt = code.indexOf(WS_PING);
  if (wsAt < 0 || code.indexOf(WS_PING, wsAt + 1) >= 0) {
    throw new Error(`viteHttpRestartPing: expected exactly one \`${WS_PING}\` in the Vite client — Vite changed; re-check the plugin`);
  }
  const start = code.lastIndexOf(PING_FN, wsAt);
  if (start < 0) {
    throw new Error("viteHttpRestartPing: no `async function ping() {` before the vite-ping WebSocket — Vite changed; re-check the plugin");
  }
  // Brace-match to the function's end (the body holds no braces in strings).
  let depth = 0;
  for (let i = start + PING_FN.length - 1; i < code.length; i++) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      return code.slice(0, start) + HTTP_PING + code.slice(i + 1);
    }
  }
  throw new Error("viteHttpRestartPing: unbalanced ping() body in the Vite client");
}

export function httpRestartPing(): Plugin {
  return {
    name: "lcnc-http-restart-ping",
    apply: "serve",
    transform(code, id) {
      if (!id.split("?")[0]!.replace(/\\/g, "/").endsWith("/vite/dist/client/client.mjs")) return null;
      try {
        return { code: patchViteClientPing(code), map: null };
      } catch (e) {
        this.error(e as Error);
      }
    },
  };
}
