// The jog lease, the page's side (P1b, machine day 2026-11-21): jogLease.ts.
// The transport is a stand-in (vi.mock): what this pins is the module's own
// rule — one renewal frame from the MAIN thread's timer for every live lease,
// an end through the sender the gesture began with, an expiry that ends that
// one gesture only, a refused or unanswered start that ends its gesture, a
// connection loss that ends every gesture without a frame.
import "./testGlobals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const wire: { cmd: string; [k: string]: unknown }[] = [];
const replies = new Map<string, (r: unknown) => void>();
let frameHandler: ((msg: Record<string, unknown>) => void) | null = null;
let reqSeq = 0;
const connected = ref(true);
const messages: string[] = [];

vi.mock("./lcncWs", () => ({
  connected,
  send: (c: { cmd: string }) => { wire.push(c); return `r${++reqSeq}`; },
  awaitReply: (reqId: string, ms: number) => new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    replies.set(reqId, (r) => { clearTimeout(t); resolve(r); });
  }),
  setJogLeaseFrameHandler: (h: typeof frameHandler) => { frameHandler = h; },
}));
vi.mock("./ws/statusStore", () => ({ pushMessage: (_k: number, text: string) => { messages.push(text); } }));
vi.mock("./ws/telemetry", () => ({ emitTelemetry: () => {} }));

const lease = await import("./jogLease");

type Ended = { why: string; text: string };
function gesture(name = "g") {
  const ends: { cmd: string; lease: number; via?: string }[] = [];
  const outside: Ended[] = [];
  const id = lease.beginLease(c => { ends.push({ ...c, via: name }); }, (why, text) => { outside.push({ why, text }); });
  return { id, ends, outside };
}
const renewals = () => wire.filter(c => c.cmd === "jog_renew");

beforeEach(() => {
  vi.useFakeTimers();
  wire.length = 0; messages.length = 0; replies.clear();
  connected.value = true;
  lease._resetJogLeasesForTest();
});
afterEach(() => { lease._resetJogLeasesForTest(); vi.useRealTimers(); });

describe("renewal from the main thread's timer", () => {
  it("one jog_renew every RENEW_MS names every live lease, none once they ended", () => {
    const a = gesture("a");
    const b = gesture("b");
    expect(b.id).toBeGreaterThan(a.id);
    vi.advanceTimersByTime(lease.RENEW_MS * 3);
    expect(renewals()).toEqual(Array(3).fill({ cmd: "jog_renew", ids: [a.id, b.id] }));
    lease.endLease(a.id);
    vi.advanceTimersByTime(lease.RENEW_MS);
    expect(renewals()[renewals().length - 1]).toEqual({ cmd: "jog_renew", ids: [b.id] });
    lease.endLease(b.id);
    const n = renewals().length;
    vi.advanceTimersByTime(lease.RENEW_MS * 5);
    expect(renewals().length, "no lease, no frame").toBe(n);
  });

  it("the renewal period fits the gateway's validity (jog_lease.py: 500 ms, 100 ms expected)", () => {
    expect(lease.RENEW_MS).toBe(100);
    expect(lease.RENEW_IDS_MAX).toBe(16);
  });
});

describe("a gesture's ends", () => {
  it("its own end goes through the sender it began with, once, without a callback", () => {
    const g = gesture("pad");
    lease.endLease(g.id);
    lease.endLease(g.id);
    expect(g.ends).toEqual([{ cmd: "jog_lease_end", lease: g.id, via: "pad" }]);
    expect(g.outside).toEqual([]);
    expect(lease.isLeaseLive(g.id)).toBe(false);
  });

  it("an explicit stop ends every gesture; each source hears it", () => {
    const a = gesture("a");
    const b = gesture("b");
    lease.endAllLeases();
    expect(a.ends.length + b.ends.length).toBe(2);
    expect(a.outside).toEqual([{ why: "stopped", text: "" }]);
    expect(b.outside).toEqual([{ why: "stopped", text: "" }]);
    const c = gesture("c");
    lease.endAllLeases({ wire: false });   // the gateway ended them at the E-Stop's receipt
    expect(c.ends).toEqual([]);
    expect(c.outside).toEqual([{ why: "stopped", text: "" }]);
  });

  it("an expiry ends that gesture only; a late one for an older id touches nothing", () => {
    const a = gesture("a");
    const b = gesture("b");
    frameHandler!({ type: "jog_lease_expired", id: a.id, axes: [0], stop_failed: [] });
    expect(a.outside).toEqual([{ why: "expired", text: lease.LEASE_EXPIRED_TEXT }]);
    expect(lease.isLeaseLive(b.id)).toBe(true);
    expect(a.ends, "the gateway already stopped it: no end frame").toEqual([]);
    const a2 = gesture("a");           // the same owner's new gesture
    frameHandler!({ type: "jog_lease_expired", id: a.id, late_renewal: true });
    expect(lease.isLeaseLive(a2.id)).toBe(true);
    expect(a2.outside).toEqual([]);
  });

  it("a lease a STOP ended (abort, E-Stop, a disarm) ends its gesture without the page-delay words", () => {
    const a = gesture("a");
    frameHandler!({ type: "jog_lease_expired", id: a.id, axes: [], stop_failed: [], reason: "abort" });
    expect(a.outside).toEqual([{ why: "stopped", text: "" }]);
    expect(messages).toEqual([]);
  });

  it("a failed stop is said whatever the gesture's state — the axis may still move", () => {
    frameHandler!({ type: "jog_lease_expired", id: 99999, axes: [], stop_failed: [1],
                    error: "Jog stop failed — press E-Stop if it still moves" });
    expect(messages).toEqual(["Jog stop failed — press E-Stop if it still moves"]);
  });

  it("the connection's loss ends every gesture without a frame", async () => {
    const a = gesture("a");
    connected.value = false;
    await Promise.resolve();
    vi.advanceTimersByTime(lease.RENEW_MS);
    expect(a.outside).toEqual([{ why: "connection", text: lease.LEASE_CONNECTION_TEXT }]);
    expect(a.ends).toEqual([]);
    expect(renewals()).toEqual([]);
  });
});

describe("a start's reply", () => {
  it("refused: the gesture ends with the reason, and its lease ends at the gateway", async () => {
    const g = gesture("k");
    lease.watchLeaseReply(g.id, "r-x");
    replies.get("r-x")!({ ok: false, error: "Not homed — press Home All" });
    await vi.runAllTimersAsync();
    expect(g.outside).toEqual([{ why: "refused", text: "Not homed — press Home All" }]);
    expect(g.ends).toEqual([{ cmd: "jog_lease_end", lease: g.id, via: "k" }]);
  });

  it("refused as expired: the operator reads the page-delay words", async () => {
    const g = gesture("k");
    lease.watchLeaseReply(g.id, "r-y");
    replies.get("r-y")!({ ok: false, error: "Jog expired — release and press again", expired: true });
    await vi.runAllTimersAsync();
    expect(g.outside).toEqual([{ why: "expired", text: lease.LEASE_EXPIRED_TEXT }]);
  });

  it("unanswered within REPLY_MS: the gesture ends", async () => {
    const g = gesture("k");
    lease.watchLeaseReply(g.id, "r-z");
    await vi.advanceTimersByTimeAsync(lease.REPLY_MS + 1);
    expect(g.outside[0]?.why).toBe("refused");
    expect(lease.isLeaseLive(g.id)).toBe(false);
  });

  it("answered ok: nothing ends; nothing sent: it ends at once", async () => {
    const g = gesture("k");
    lease.watchLeaseReply(g.id, "r-ok");
    replies.get("r-ok")!({ ok: true });
    await Promise.resolve(); await Promise.resolve();
    expect(lease.isLeaseLive(g.id)).toBe(true);
    const h = gesture("k");
    lease.watchLeaseReply(h.id, null);
    expect(h.outside).toEqual([{ why: "refused", text: lease.LEASE_CONNECTION_TEXT }]);
  });
});
