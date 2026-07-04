// Shared mock-gateway control channel helper (F6 consolidation — was
// triplicated as ctl/ctlSend/ctlQuery across viewer/frames/lifecycle specs).
// One short-lived socket per op: send → first reply → close. The mock answers
// every ctl message with a JSON {ok, ...} frame, so first-message == reply.
import WebSocket from "ws";

export const MOCK = "http://localhost:4174/";
export const CTL = "ws://localhost:4174/ctl";

/** Send a ctl op and resolve with the mock's parsed reply. */
export function ctl(op: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const c = new WebSocket(CTL);
    c.once("open", () => c.send(JSON.stringify(op)));
    c.once("message", (d) => { c.close(); resolve(JSON.parse(String(d))); });
    c.once("error", reject);
  });
}
