import { describe, it, expect } from "vitest";
import { changedAxes, savePayload, sameG30, contextChanged, replyApplies } from "./g30Form";

const L = ["X", "Y", "Z", "A", "C"] as const;
const stored = { X: 100, Y: 0, Z: -26.275, A: 0, C: 0 };

describe("G30 draft (operator P4, Codex R21–R24)", () => {
  it("compares at the parameter file's precision", () => {
    expect(sameG30(-26.275, -26.2750004)).toBe(true);
    expect(sameG30(100, 100.00001)).toBe(false);
    expect(sameG30(null, 0)).toBe(false);
  });
  it("saves only the changed axes, on the whole basis", () => {
    expect(savePayload({ ...stored, X: 120, Z: -30 }, stored, L)).toEqual({
      values: { X: 120, Z: -30 }, based_on: stored });
    expect(changedAxes({ ...stored }, stored, L)).toEqual([]);
  });
  it("refuses without a known basis, without a change, with an empty field", () => {
    expect(savePayload({ ...stored, X: 1 }, null, L)).toEqual({ error: "Stored G30 not known — refresh first" });
    expect(savePayload({ ...stored, X: 1 }, { ...stored, Z: null }, L)).toEqual({ error: "Stored G30 not known — refresh first" });
    expect(savePayload({ ...stored }, stored, L)).toEqual({ error: "Nothing changed" });
    expect(savePayload({ ...stored, Z: null }, stored, L)).toEqual({ error: "Z: enter a value" });
  });
  it("a captured draft is bound to its units, kinematics mode and connection", () => {
    const at = { units: "mm", kinsType: 0, epoch: 1 };
    expect(contextChanged(at, { units: "mm", kinsType: 0, epoch: 1 })).toBe(false);
    expect(contextChanged(at, { units: "in", kinsType: 0, epoch: 1 })).toBe(true);
    expect(contextChanged(at, { units: "mm", kinsType: 1, epoch: 1 })).toBe(true);
    expect(contextChanged(at, { units: "mm", kinsType: 0, epoch: 2 })).toBe(true);
    expect(contextChanged(null, { units: "mm", kinsType: 1, epoch: 1 })).toBe(false);
  });
  it("a late reply changes only what is still its own (Codex R25 OP-I03)", () => {
    const ctx = { units: "mm", kinsType: 0, epoch: 1 };
    const t = { seq: 3, rev: 7, ctx };
    // nothing happened meanwhile: both
    expect(replyApplies(t, { appliedSeq: 2, rev: 7, ctx })).toEqual({ stored: true, reset: true, draft: true });
    // the operator typed while the save was out: the confirmation updates the
    // stored line, the newer entry stays a draft
    expect(replyApplies(t, { appliedSeq: 2, rev: 8, ctx })).toEqual({ stored: true, reset: false, draft: false });
    // the frame changed while a capture was out: its position is not taken
    // (a read's values may still reset an unedited draft: machine coordinates)
    expect(replyApplies(t, { appliedSeq: 2, rev: 7, ctx: { ...ctx, kinsType: 1 } })).toEqual({ stored: true, reset: true, draft: false });
    // a newer request's reply is already shown (a late initial file read)
    expect(replyApplies(t, { appliedSeq: 4, rev: 7, ctx })).toEqual({ stored: false, reset: false, draft: true });
    // Codex R26: an answer from before a reconnect (or in other units)
    // supplies neither the stored line nor the basis; the frame does not
    // change stored machine coordinates
    expect(replyApplies(t, { appliedSeq: 2, rev: 7, ctx: { ...ctx, epoch: 2 } }).stored).toBe(false);
    expect(replyApplies(t, { appliedSeq: 2, rev: 7, ctx: { ...ctx, units: "in" } }).stored).toBe(false);
    expect(replyApplies(t, { appliedSeq: 2, rev: 7, ctx: { ...ctx, kinsType: 1 } }).stored).toBe(true);
  });
});
