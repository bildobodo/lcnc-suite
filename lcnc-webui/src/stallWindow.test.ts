// The stall rows' definition (P3, Codex R425 MT425-04): gaps in the TIMER
// OBSERVATION past the hold guard's limit, per window; long tasks a
// separate quantity; hidden time no stall.
import { describe, it, expect } from "vitest";
import { HOLD_STALL_MS } from "./holdGesture";
import { StallWindow, STALL_IDLE_WINDOW_MS, stallBin } from "./stallWindow";

function observeAt(w: StallWindow, ...ts: number[]) {
  for (const t of ts) w.observe(t, false);
}

describe("the stall window", () => {
  it("counts gaps past the hold guard's own limit: 150 is none, 151 is one", () => {
    expect(HOLD_STALL_MS).toBe(150);
    const w = new StallWindow(0);
    observeAt(w, 1000, 1150, 1301);     // gaps 150 and 151
    const row = w.take(5000, 1400);
    expect(row).toMatchObject({ n: 1, observed: 2, max_ms: 151, h: { "150": 1 }, limit_ms: 150 });
  });

  it("a late observation is a stall without any single long task (a timer gap, not the Long Tasks API)", () => {
    const w = new StallWindow(0);
    w.setLongTaskSupported(true);
    observeAt(w, 100, 108, 318);        // the timer came 210 ms after the last — no long task reported
    const row = w.take(3000, 400);
    expect(row).toMatchObject({ n: 1, h: { "150": 1 }, lt_n: 0, lt_max_ms: 0 });
  });

  it("bins 150–250, 250–500, 500–1000, > 1000", () => {
    expect([151, 249, 250, 499, 500, 999, 1000, 5000].map(stallBin)).toEqual([150, 150, 250, 250, 500, 500, 1000, 1000]);
    const w = new StallWindow(0);
    observeAt(w, 0.5, 200, 500, 1100, 2400);
    expect(w.take(3000, 2500).h).toEqual({ "150": 1, "250": 1, "500": 1, "1000": 1 });
  });

  it("hidden time is no stall: hiding stops the count, showing re-anchors and the hidden time is reported", () => {
    const w = new StallWindow(0);
    observeAt(w, 100, 108);
    w.hide(110);
    w.observe(1110, true);              // a hidden page's clamped timer: no gap counted
    w.show(5110);
    observeAt(w, 6000, 6008);           // the first visible observation only anchors
    const row = w.take(10000, 6010);
    expect(row).toMatchObject({ n: 0, hidden_ms: 5000, anchor_resets: 1, observed: 2 });
  });

  it("without Long Tasks support the long-task fields are ABSENT, never 0", () => {
    const w = new StallWindow(0);
    const row = w.take(3000, 10);
    expect("lt_n" in row).toBe(false);
    expect("lt_max_ms" in row).toBe(false);
  });

  it("rows chain: a stall makes the window due, else the idle window; seq and the window edges join", () => {
    const w = new StallWindow(1000);
    expect(w.due(4000)).toBe(false);
    observeAt(w, 10, 400);
    expect(w.due(4000)).toBe(true);
    const a = w.take(4000, 410);
    expect(w.due(7000)).toBe(false);
    expect(w.due(4000 + STALL_IDLE_WINDOW_MS)).toBe(true);
    const b = w.take(4000 + STALL_IDLE_WINDOW_MS, 30410);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(b.win_start).toBe(a.win_end);
    expect(b).toMatchObject({ n: 0, h: {} });
  });
});
