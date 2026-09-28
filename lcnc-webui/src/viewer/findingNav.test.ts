import { describe, it, expect } from "vitest";
import { sampleCum, targetAfter, targetBefore, mapAcrossEntry, JUMP_NUDGE } from "./findingNav";

// Findings on the timeline (Codex R32 VP-I05/I06): a jump samples INSIDE the
// finding's own extent, and prev/next never lose a finding to a fixed window.
const T = (key: string, cum: number, cumEnd: number) => ({ key, cum, cumEnd });

describe("finding navigation (Codex R32 VP-I06)", () => {
  it("a jump samples a hair past the start — never past the middle of a short move", () => {
    expect(sampleCum(T("a", 1, 2))).toBeCloseTo(1 + JUMP_NUDGE, 12);
    // a 0.1 ms move (time axis): the fixed nudge (1 ms) left it for the next line
    const s = sampleCum(T("a", 1, 1.0001));
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(1.0001);
    expect(sampleCum(T("a", 3, 3)), "no extent: its start").toBe(3);
  });
  it("next after a jump reaches a finding 5 ms later — no fixed window drops it", () => {
    const list = [T("L7", 1.0, 1.005), T("L8", 1.005, 2)];
    const at = sampleCum(list[0]!);
    expect(targetAfter(list, at, { key: "L7", pos: at })!.key).toBe("L8");
    expect(targetAfter(list, at, null)!.key, "by position too").toBe("L8");
    expect(targetBefore(list, sampleCum(list[1]!), null)!.key).toBe("L7");
  });
  it("the selected finding is skipped by identity — two at one position are both reached", () => {
    const list = [T("A", 5, 6), T("B", 5, 6), T("C", 9, 10)];
    const at = sampleCum(list[0]!);
    expect(targetAfter(list, at, { key: "A", pos: at })!.key).toBe("B");
    expect(targetAfter(list, at, { key: "B", pos: at })!.key).toBe("C");
    expect(targetBefore(list, at, { key: "B", pos: at })!.key).toBe("A");
    // wrap at both ends
    expect(targetAfter(list, sampleCum(list[2]!), { key: "C", pos: sampleCum(list[2]!) })!.key).toBe("A");
    expect(targetBefore(list, at, { key: "A", pos: at })!.key).toBe("C");
  });
  it("after a manual scrub it navigates from the position again", () => {
    const list = [T("A", 5, 6), T("B", 9, 10)];
    expect(targetAfter(list, 7, { key: "A", pos: sampleCum(list[0]!) })!.key).toBe("B");
    expect(targetBefore(list, 7, { key: "B", pos: sampleCum(list[1]!) })!.key).toBe("A");
    expect(targetAfter(list, 20, null)!.key, "wraps").toBe("A");
    expect(targetAfter([], 0, null)).toBeNull();
  });
});

describe("a target across the entry track (Codex R32 VP-I05)", () => {
  it("a program finding moves by the entry move's length; an entry finding scales with its move", () => {
    // before: the base (no entry); after: an entry move of 100 in front
    expect(mapAcrossEntry(T("L7", 10, 11), 0, 100)).toEqual({ key: "L7", cum: 110, cumEnd: 111 });
    // from one entry track (40) to a rebuilt one (100)
    expect(mapAcrossEntry(T("L7", 50, 51), 40, 100)).toEqual({ key: "L7", cum: 110, cumEnd: 111 });
    // a finding ON the old entry move stays on the entry move — never shifted like a program finding
    expect(mapAcrossEntry(T("E", 10, 20), 40, 100)).toEqual({ key: "E", cum: 25, cumEnd: 50 });
  });
});
