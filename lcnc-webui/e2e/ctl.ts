// Shared mock-gateway control channel helper (F6 consolidation — was
// triplicated as ctl/ctlSend/ctlQuery across viewer/frames/lifecycle specs).
// One short-lived socket per op: send → first reply → close. The mock answers
// every ctl message with a JSON {ok, ...} frame, so first-message == reply.
import WebSocket from "ws";
import { expect, type Page } from "@playwright/test";
import { mockUrl } from "./mockSlot.mjs";

// The mock of THIS worker (per-worker mock, Codex R262 PM261-02): its slot is
// the worker's TEST_PARALLEL_INDEX, known at import. HTTP, the app's /ws and
// /ctl all come from here; outside a worker (`--list`, the runner) the
// address is unbound and any use fails visibly — never a shared port.
export const MOCK = mockUrl(process.env.TEST_PARALLEL_INDEX);
export const CTL = `${MOCK.replace(/^http/, "ws")}ctl`;

/** Send a ctl op and resolve with the mock's parsed reply. */
export function ctl(op: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const c = new WebSocket(CTL);
    c.once("open", () => c.send(JSON.stringify(op)));
    c.once("message", (d) => { c.close(); resolve(JSON.parse(String(d))); });
    c.once("error", reject);
  });
}

/** A ctl op against a mock at `base` (the tool specs may run their own). */
function ctlAt(base: string, op: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const c = new WebSocket(new URL("ctl", base).href.replace(/^http/, "ws"));
    c.once("open", () => c.send(JSON.stringify(op)));
    c.once("message", (d) => { c.close(); resolve(JSON.parse(String(d))); });
    c.once("error", reject);
  });
}

/** Serve the tool table the way the gateway does (the mock answers a read
 *  with an EMPTY table by default; `replyFor … "silent"` scripts a gateway
 *  slow to answer): the mock answers every `get_tool_table` with its req_id (the Tools tab and the strip read through
 *  request() and take only their own reply — operator 2026-10-04, a lost
 *  reply left "Loading tools…"), and `tool_table_changed` makes both read it
 *  again. Never push an unsolicited reply: nothing takes it any more. */
let toolTableVersion = 10_000;
export async function publishToolTable(tools: unknown[], base: string = MOCK): Promise<void> {
  await ctlAt(base, { op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools } });
  await ctlAt(base, { op: "raw", frame: { type: "tool_table_changed", version: ++toolTableVersion } });
}

/** Connected, ARMED and the first status's permissions applied. The outer
 *  armed fieldset used to say all three (`fieldset[data-gate="armed"]` not
 *  disabled); button gates package C removed it: the ARMED pill says the
 *  arm, the Overrides section's `override` Gate (machine on + armed) says
 *  the permissions arrived. */
export async function expectArmed(page: Page, timeout?: number): Promise<void> {
  await expect(page.locator(".pill.armed")).toBeVisible(timeout ? { timeout } : undefined);
  // the attribute: toBeDisabled ignores a <fieldset disabled> (native controls only)
  await expect(page.locator('fieldset[data-gate="override"]').first()).not.toHaveAttribute("disabled", /.*/, timeout ? { timeout } : undefined);
}
