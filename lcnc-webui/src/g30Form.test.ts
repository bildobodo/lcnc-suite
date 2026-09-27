import { describe, it, expect } from "vitest";
import { changedAxes, savePayload, sameG30, contextChanged } from "./g30Form";

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
  it("a captured draft is bound to its units and kinematics mode", () => {
    const at = { units: "mm", kinsType: 0 };
    expect(contextChanged(at, { units: "mm", kinsType: 0 })).toBe(false);
    expect(contextChanged(at, { units: "in", kinsType: 0 })).toBe(true);
    expect(contextChanged(at, { units: "mm", kinsType: 1 })).toBe(true);
    expect(contextChanged(null, { units: "mm", kinsType: 1 })).toBe(false);
  });
});
