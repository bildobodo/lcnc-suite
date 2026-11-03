// The NEGATIVE harness only (Codex R262): both workers bound to ONE mock the
// harness started at LCNC_PROOF_SHARED (its own transport — the e2e fixture
// keeps its owner checks and has no switch around them).
import WebSocket from "ws";

const CTL = `${(process.env.LCNC_PROOF_SHARED ?? "").replace(/^http/, "ws")}ctl`;

export function sharedCtl(op: Record<string, unknown>): Promise<{ snapshot?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const c = new WebSocket(CTL);
    c.once("open", () => c.send(JSON.stringify(op)));
    c.once("message", d => { c.close(); resolve(JSON.parse(String(d))); });
    c.once("error", reject);
  });
}
