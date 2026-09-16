import { describe, expect, it } from "vitest";
import { boundsFromJointLimits, sameBox } from "./machineBounds";

describe("boundsFromJointLimits", () => {
  const XYZAC = ["X", "Y", "Z", "A", "C"];   // joint order: C is joint 4, canonical axis 5
  it("takes the X/Y/Z joints' limits in joint order", () => {
    const b = boundsFromJointLimits([[-200, 200], [-70, 70], [-30, 100], [-100, 50], [-360, 360]], XYZAC);
    expect(b).toEqual({ origin: [-200, -70, -30], size: [400, 140, 130] });
  });
  it("follows a live change (the TWP sim's Z window under TCP)", () => {
    const id = boundsFromJointLimits([[-5000, 5000], [-5000, 5000], [-2000, 0.01]], ["X", "Y", "Z"])!;
    const tcp = boundsFromJointLimits([[-5000, 5000], [-5000, 5000], [-5000, 5000]], ["X", "Y", "Z"])!;
    expect(id.size[2]).toBeCloseTo(2000.01, 9);
    expect(tcp.size[2]).toBe(10000);
    expect(sameBox(id, tcp)).toBe(false);
    expect(sameBox(id, { ...id })).toBe(true);
  });
  it("is null when a linear joint is missing, a limit is unknown, or min ≥ max", () => {
    expect(boundsFromJointLimits([[-1, 1], [-1, 1]], ["X", "Y"])).toBeNull();
    expect(boundsFromJointLimits([[-1, 1], [-1, 1], [null, 1]], ["X", "Y", "Z"])).toBeNull();
    expect(boundsFromJointLimits([[-1, 1], [-1, 1], null], ["X", "Y", "Z"])).toBeNull();
    expect(boundsFromJointLimits([[-1, 1], [-1, 1], [1, 1]], ["X", "Y", "Z"])).toBeNull();
    expect(boundsFromJointLimits(null, ["X", "Y", "Z"])).toBeNull();
    expect(boundsFromJointLimits([[-1, 1], [-1, 1], [-1, 1]], [])).toBeNull();
    expect(boundsFromJointLimits([[-1, 1], [-1, 1], [-1, 1]], ["x", "y", "z"])).not.toBeNull();
  });
  it("sameBox treats two nulls as equal and a null vs a box as different", () => {
    expect(sameBox(null, null)).toBe(true);
    expect(sameBox(null, { origin: [0, 0, 0], size: [1, 1, 1] })).toBe(false);
  });
});
