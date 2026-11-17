// The browser's HTTP record (replay step 5b — the contract FI265-02 Rest A
// and B, Codex R268/R269, with the deltas of R389–R391). Every request a
// test's browser contexts issue, with its own identity and what happened to
// it, in a log of this worker (LCNC_E2E_HTTP_DIR) that the replay joins with
// the mocks' logs (scripts/test_select/http_paths.py):
//
//  - three identities: the browser REQUEST (an id at its `request` event),
//    its redirect CHAIN (`redirectedFrom`), a test's FETCH operation (an id
//    of its own per `route.fetch`, sent as its header);
//  - a catch-all route registered FIRST on every context (the lowest
//    priority) continues each request no spec handler took with
//    `x-e2e-req: req:<id>`; the wrapped `continue` and `fetch` of a spec's
//    handler set the same header (`fetch:<op>` for a fetch) — the mock logs
//    it, so a server contact is ASSIGNED by that id only, never by URL or
//    order;
//  - every spec handler gets a wrapped Route whose fulfill / continue /
//    fallback / fetch / abort are recorded against the request's id;
//  - the CLOSING mark of a context, written right before it closes (the
//    fixture's own close and a spec's `context.close()`), and the service
//    workers it holds then (`serviceWorkers: "block"` — none may exist);
//  - the request's projection (e2e/routeProjection.ts): its route template
//    and variant — never a query VALUE, a body or a header value.
//
// What it changes, measured (R389 probe): no test result; a request a page
// issues while its context closes no longer reaches the mock (it stays in
// this log, class "closing"); Firefox no longer asks for /favicon.ico.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page, Request, Route } from "@playwright/test";
import { project, recordedPath } from "./routeProjection";

const DIR = process.env.LCNC_E2E_HTTP_DIR;
const RUN = process.env.LCNC_E2E_RUN ?? "local";
const WORKER = process.env.TEST_WORKER_INDEX ?? "x";
/** This worker's HTTP record — null when the run keeps none. */
export const httpRecordFile = (): string | null => DIR ? join(DIR, `${RUN}-w${WORKER}.jsonl`) : null;
let made = false;
function write(rec: Record<string, unknown>): void {
  const file = httpRecordFile();
  if (!file) return;
  if (!made) { mkdirSync(DIR!, { recursive: true }); made = true; }
  appendFileSync(file, JSON.stringify({ t: Date.now(), ...rec }) + "\n");
}

/** The header a forwarded request carries to the mock. */
export const REQ_HEADER = "x-e2e-req";

/** The attempt a context belongs to — the cookie origin's fields. */
export interface HttpOrigin { run: string; test: string; project: string; retry: number }

let reqSeq = 0, fetchSeq = 0, ctxSeq = 0;
const instrumented = new WeakSet<BrowserContext>();
const wrappedPages = new WeakSet<Page>();
const handlerWrap = new WeakMap<object, object>();

type Handler = (route: Route, request: Request) => unknown;
type RouteFn = (url: unknown, handler: Handler, options?: unknown) => Promise<void>;
type UnrouteFn = (url: unknown, handler?: Handler) => Promise<void>;

/** A request's own id — given at its `request` event (R389 probe: the route
 *  ALWAYS sees a request after that event; an id first given at the route is
 *  written as such and judged by the replay). */
function idFor(ids: WeakMap<Request, string>, r: Request, ctx: string, at: "request" | "route"): string {
  let id = ids.get(r);
  if (id) return id;
  id = `${WORKER}.${++reqSeq}`;
  ids.set(r, id);
  const u = new URL(r.url());
  const from = r.redirectedFrom();
  let sw: boolean;
  try { sw = r.serviceWorker() !== null; } catch { sw = false; }
  write({ k: "req", ctx, id, at, method: r.method(), host: u.host, path: recordedPath(u),
          qkeys: [...new Set(u.searchParams.keys())].sort(), type: r.resourceType(), sw,
          from: from ? idFor(ids, from, ctx, at) : null, ...project(r.method(), u) });
  return id;
}

function wrapRoute(route: Route, id: string): Route {
  const req = route.request();
  const headers = (extra: Record<string, string> | undefined, value: string) => ({ ...req.headers(), ...(extra ?? {}), [REQ_HEADER]: value });
  return new Proxy(route, {
    get(target, prop, receiver) {
      switch (prop) {
        case "fulfill":
          return async (o?: Parameters<Route["fulfill"]>[0]) => {
            const status = o?.status ?? (o?.response ? o.response.status() : 200);
            write({ k: "act", id, act: "fulfill", status, response: o?.response !== undefined });
            return target.fulfill(o);
          };
        case "continue":
          return async (o?: Parameters<Route["continue"]>[0]) => {
            write({ k: "act", id, act: "continue" });
            return target.continue({ ...(o ?? {}), headers: headers(o?.headers, `req:${id}`) });
          };
        case "fallback":
          return async (o?: Parameters<Route["fallback"]>[0]) => {
            write({ k: "act", id, act: "fallback" });
            return target.fallback(o);
          };
        case "abort":
          return async (code?: string) => {
            write({ k: "act", id, act: "abort" });
            return target.abort(code);
          };
        case "fetch":
          return async (o?: Parameters<Route["fetch"]>[0]) => {
            const op = `${WORKER}.f${++fetchSeq}`;
            write({ k: "act", id, act: "fetch", op });
            const resp = await target.fetch({ ...(o ?? {}), headers: headers(o?.headers, `fetch:${op}`) });
            write({ k: "fetched", id, op, status: resp.status() });
            return resp;
          };
        default: {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" ? v.bind(target) : v;
        }
      }
    },
  });
}

/** Wrap `route` / `unroute` of a page or a context: each spec handler gets
 *  the wrapped Route; entering it is recorded (a handler that never acts is
 *  "held"). `unroute(url, handler)` finds the wrapper of that handler. */
function wrapRouting(target: Page | BrowserContext, scope: "page" | "context", ids: WeakMap<Request, string>, ctx: string): void {
  const route = target.route.bind(target) as unknown as RouteFn;
  const unroute = target.unroute.bind(target) as unknown as UnrouteFn;
  (target as unknown as { route: RouteFn }).route = (url, handler, options) => {
    const wrapped: Handler = (r, request) => {
      const id = idFor(ids, request, ctx, "route");
      write({ k: "act", id, act: "handler", scope });
      return handler(wrapRoute(r, id), request);
    };
    handlerWrap.set(handler, wrapped);
    return route(url, wrapped, options);
  };
  (target as unknown as { unroute: UnrouteFn }).unroute = (url, handler) =>
    unroute(url, handler ? (handlerWrap.get(handler) as Handler | undefined) ?? handler : undefined);
}

/** Write the closing mark of a context and its service workers, then close it. */
async function closeMarked(context: BrowserContext, ctx: string, close: () => Promise<void>): Promise<void> {
  write({ k: "closing", ctx, sw: context.serviceWorkers().length });
  await close();
}

/** Instrument a context of a test attempt — once; its pages as they come. */
export async function instrument(context: BrowserContext, origin: HttpOrigin, how: "fixture" | "new"): Promise<void> {
  if (instrumented.has(context)) return;
  instrumented.add(context);
  const ctx = `${WORKER}.c${++ctxSeq}`;
  const ids = new WeakMap<Request, string>();
  write({ k: "ctx", ctx, how, ...origin });
  context.on("request", (r) => { idFor(ids, r, ctx, "request"); });
  context.on("requestfinished", (r) => {
    const id = idFor(ids, r, ctx, "request");
    void r.response().then((resp) => write({ k: "end", id, transport: "finished", status: resp?.status() ?? null }),
                            () => write({ k: "end", id, transport: "finished", status: null }));
  });
  context.on("requestfailed", (r) => write({ k: "end", id: idFor(ids, r, ctx, "request"), transport: "failed",
                                             error: r.failure()?.errorText ?? null }));
  // the catch-all FIRST: routes run last-registered first, so every spec
  // handler (and its fallback) comes before it
  await context.route(() => true, async (route) => {
    const id = idFor(ids, route.request(), ctx, "route");
    write({ k: "act", id, act: "catch-all" });
    await route.continue({ headers: { ...route.request().headers(), [REQ_HEADER]: `req:${id}` } });
  });
  wrapRouting(context, "context", ids, ctx);
  const pageWrap = (p: Page) => { if (!wrappedPages.has(p)) { wrappedPages.add(p); wrapRouting(p, "page", ids, ctx); } };
  context.pages().forEach(pageWrap);
  context.on("page", pageWrap);
  // a page a spec opens is wrapped before the spec can route on it
  const newPage = context.newPage.bind(context);
  context.newPage = async () => { const p = await newPage(); pageWrap(p); return p; };
  const close = context.close.bind(context);
  context.close = (o?: Parameters<BrowserContext["close"]>[0]) => closeMarked(context, ctx, () => close(o));
}
