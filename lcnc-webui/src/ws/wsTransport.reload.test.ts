// Reload-resume boot path (A1.6). Separate file from wsTransport.test.ts on
// purpose: _prevArmed is initialized at MODULE IMPORT from sessionStorage, so
// the storage must be primed before the import — vitest gives each test file
// its own module registry, which makes that deterministic here.
import "../testGlobals";
import { describe, expect, it, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: any[] = [];
  onmessage: ((ev: { data: any }) => void) | null = null;
  constructor(_url: URL) { FakeWorker.instances.push(this); }
  postMessage(m: any) { this.posted.push(m); }
  terminate() {}
}
(globalThis as any).Worker = FakeWorker;

// Simulate the post-reload state: same tab (sessionStorage survived), last
// server-confirmed armed state was TRUE.
sessionStorage.setItem("lcnc-session-id", "fixed-session");
sessionStorage.setItem("lcnc-armed", "1");

const { connectTransport, persistArmedForReload } = await import("./wsTransport");

describe("reload-resume (A1 smoke finding: holds registered, requests never sent)", () => {
  it("boots resumeArmed from sessionStorage so the reload hello can request resume", () => {
    connectTransport("ws://x/ws", () => {});
    const w = FakeWorker.instances[0]!;
    expect(w.posted[0]).toMatchObject({
      type: "connect", resumeArmed: true, session: "fixed-session",
    });
  });

  it("the flag is consumed: the next connect in the same page is back to false", () => {
    connectTransport("ws://x/ws", () => {});
    expect(FakeWorker.instances[1]!.posted[0]).toMatchObject({ resumeArmed: false });
  });

  it("persistArmedForReload mirrors server state, writing only on change", () => {
    persistArmedForReload(false);
    expect(sessionStorage.getItem("lcnc-armed")).toBe("0");
    persistArmedForReload(true);
    expect(sessionStorage.getItem("lcnc-armed")).toBe("1");
    const setItem = vi.spyOn(sessionStorage, "setItem");
    persistArmedForReload(true);   // unchanged — must not touch storage
    expect(setItem).not.toHaveBeenCalled();
    persistArmedForReload(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });
});
