// The hold gesture's rules, deterministically (Codex R397 VM397-03): a fake
// scheduler runs the timers in time order; `block` jumps the clock with
// nothing run (the main thread blocked); `runDue` then runs what came due —
// as the browser may, BEFORE a release queued during the block.
import { describe, it, expect } from "vitest";
import { HoldGesture, HOLD_STALL_MS, type HoldEnd, type HoldScheduler } from "./holdGesture";

class FakeScheduler implements HoldScheduler {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  /** keep cleared timers running: proves a continuation of an ended gesture is inert */
  private readonly leak: boolean;
  constructor(leak = false) { this.leak = leak; }
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(id: number) { if (!this.leak) this.timers.delete(id); }
  runUntil(to: number) {
    for (;;) {
      const next = [...this.timers.entries()].filter(([, x]) => x.at <= to)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = Math.max(this.t, to);
  }
  block(to: number) { this.t = to; }
  runDue() { this.runUntil(this.t); }
}

function press(s: HoldScheduler, holdMs = 500) {
  const log: { fired: number; ended: Array<[HoldEnd, number]> } = { fired: 0, ended: [] };
  const g = new HoldGesture(s, holdMs, { fire: () => { log.fired++; }, ended: (why, ms) => { log.ended.push([why, ms]); } });
  return { g, log };
}

describe("a hold gesture (Codex R397, operator Q397-1)", () => {
  it("fires once at the hold time on a smooth page — the normal hold unchanged", () => {
    const s = new FakeScheduler(); const { log } = press(s);
    s.runUntil(499); expect(log.fired).toBe(0);
    s.runUntil(500); expect(log.fired).toBe(1);
    s.runUntil(2000); expect(log.fired).toBe(1); expect(log.ended).toEqual([]);
  });

  it("a release before the hold time ends it; nothing fires", () => {
    const s = new FakeScheduler(); const { g, log } = press(s);
    s.runUntil(120); g.end("released");
    s.runUntil(2000);
    expect(log.fired).toBe(0); expect(log.ended).toEqual([["released", 120]]);
  });

  for (const blockEnd of [520, 540, 600, 700]) {
    it(`a stall over the hold time (blocked 100 → ${blockEnd} ms): the due step runs before the queued release — the gesture ends as stalled, nothing fires`, () => {
      const s = new FakeScheduler(); const { g, log } = press(s);
      s.runUntil(100); s.block(blockEnd);
      s.runDue();                        // the browser ran the timers first …
      g.end("released");                 // … then the release queued at 120 ms
      s.runUntil(2000);
      expect(log.fired).toBe(0);
      expect(log.ended).toEqual([["stalled", blockEnd]]);
    });
  }

  it("a stall before the hold time with the finger still down: stalled — hold again, never a later fire", () => {
    const s = new FakeScheduler(); const { log } = press(s);
    s.runUntil(100); s.block(400); s.runUntil(2000);
    expect(log.fired).toBe(0); expect(log.ended.map(e => e[0])).toEqual(["stalled"]);
  });

  it(`long tasks up to the limit (${HOLD_STALL_MS} ms between observations) keep the watch`, () => {
    const s = new FakeScheduler(); const { log } = press(s);
    // 80 ms tasks: each observation comes 100 ms after the last (20 ms period + 80)
    for (let t = 0; t < 600; t += 100) { s.runUntil(t + 20); s.block(t + 100); s.runDue(); }
    expect(log.ended).toEqual([]); expect(log.fired).toBe(1);
  });

  it("a gap just past the limit ends it", () => {
    const s = new FakeScheduler(); const { log } = press(s);
    s.runUntil(200); s.block(200 + HOLD_STALL_MS + 21); s.runDue(); s.runUntil(2000);
    expect(log.fired).toBe(0); expect(log.ended.map(e => e[0])).toEqual(["stalled"]);
  });

  it("a continuation of an ended gesture is inert — an old step never fires a new 114 ms press (VM397-02)", () => {
    const s = new FakeScheduler(true);  // cleared timers still run
    const first = press(s);
    s.runUntil(100); first.g.end("released");
    s.runUntil(450);
    const second = press(s);            // a new press at 450 ms
    s.runUntil(520);                    // the first gesture's due step (500) runs during it
    expect(first.log.fired).toBe(0); expect(second.log.fired).toBe(0);
    s.runUntil(564); second.g.end("released");   // the new press lasts 114 ms
    s.runUntil(2000);
    expect(second.log.fired).toBe(0); expect(second.log.ended).toEqual([["released", 114]]);
  });

  it(`the limit is exact: a gap of ${HOLD_STALL_MS} ms keeps the watch, ${HOLD_STALL_MS + 1} ms ends it`, () => {
    for (const [gap, stalled] of [[HOLD_STALL_MS, false], [HOLD_STALL_MS + 1, true]] as const) {
      const s = new FakeScheduler(); const { log } = press(s);
      s.runUntil(200);                    // the last observation at 200 ms
      s.block(200 + gap); s.runDue(); s.runUntil(2000);
      expect(log.ended.map(e => e[0])).toEqual(stalled ? ["stalled"] : []);
      expect(log.fired).toBe(stalled ? 0 : 1);
    }
  });

  it("the named limit (Codex R399): timers on time prove no delivered release — a release queued at 120 ms and delivered at 520 ms reads as a full hold", () => {
    // This pins what the watch does NOT exclude: the release waits in the
    // input queue while the timers still run on time (gaps of 100 ms).
    const s = new FakeScheduler(); const { g, log } = press(s);
    s.runUntil(100);
    for (const t of [200, 300, 400, 500]) { s.block(t); s.runDue(); }
    expect(log.fired).toBe(1);              // the due step ran first …
    s.block(520); g.end("released");        // … the release queued at 120 ms arrives
    expect(log.ended).toEqual([]);
  });

  for (const why of ["cancelled", "moved", "left", "hidden", "blur", "gate", "target", "unmount"] as const) {
    it(`ended by ${why}: nothing fires afterwards`, () => {
      const s = new FakeScheduler(true); const { g, log } = press(s);
      s.runUntil(300); g.end(why); s.runUntil(2000);
      expect(log.fired).toBe(0); expect(log.ended).toEqual([[why, 300]]);
    });
  }
});

describe("the refusal's evidence (P3, Codex R425 MT425-04)", () => {
  function pressWithGap(s: HoldScheduler) {
    const ends: Array<{ why: HoldEnd; held: number; gap: number | undefined; args: number }> = [];
    const g = new HoldGesture(s, 500, {
      fire: () => {},
      ended: (...a: [HoldEnd, number, number?]) => { ends.push({ why: a[0], held: a[1], gap: a[2], args: a.length }); },
    });
    return { g, ends };
  }

  it("a stalled end carries the gap that decided it — the gesture's own observation", () => {
    const s = new FakeScheduler(); const { ends } = pressWithGap(s);
    s.runUntil(100);                 // watched at 20, 40 … 100
    s.block(310); s.runDue();        // the next observation 210 ms after the last
    expect(ends).toEqual([{ why: "stalled", held: 310, gap: 210, args: 3 }]);
  });

  it("every other end has NO gap (never derived from the held time) — and an end is reported once", () => {
    const s = new FakeScheduler(); const { g, ends } = pressWithGap(s);
    s.runUntil(120); g.end("released"); g.end("cancelled"); s.runUntil(2000);
    expect(ends).toEqual([{ why: "released", held: 120, gap: undefined, args: 2 }]);
  });

  it("a release after a stall reports nothing more", () => {
    const s = new FakeScheduler(); const { g, ends } = pressWithGap(s);
    s.runUntil(100); s.block(400); s.runDue(); g.end("released"); s.runUntil(2000);
    expect(ends.map(e => e.why)).toEqual(["stalled"]);
  });
});
