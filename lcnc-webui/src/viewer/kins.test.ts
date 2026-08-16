// Kins boundary (viewer/kins.ts): the trivkins model must reproduce the
// letter→slot permutation every consumer previously inlined — these tests
// pin the boundary's contract (null semantics, zero-fill, roundtrip) so
// phase-1c's real kinematics implementations slot in behind a proven
// interface. (Non-trivial models get compiled-C-oracle fixtures instead;
// trivkins is the identity permutation by definition.)
import { describe, expect, it, vi } from "vitest";
import { kinsFor, makeKins } from "./kins";

describe("trivkins boundary", () => {
  it("XYZAC: letter-skipping permutation both ways (C = joint 4, slot 5)", () => {
    const k = makeKins(["X", "Y", "Z", "A", "C"]);
    const joints = k.inverse([1, 2, 3, 4, 5, 6], []);
    expect(joints).toEqual([1, 2, 3, 4, 6]);
    const world = k.forward([1, 2, 3, 4, 6], new Array(6).fill(9));
    expect(world).toEqual([1, 2, 3, 4, 0, 6]);  // B slot zero-filled, not stale
  });

  it("UVW joints yield null on inverse, contribute nothing on forward", () => {
    const k = makeKins(["X", "Y", "Z", "U", "V", "W"]);
    const joints = k.inverse([1, 2, 3, 0, 0, 0], []);
    expect(joints).toEqual([1, 2, 3, null, null, null]);
    expect(k.forward(joints, new Array(6).fill(9))).toEqual([1, 2, 3, 0, 0, 0]);
  });

  it("inverse→forward roundtrips machine coords on a full XYZABC machine", () => {
    const k = makeKins(["X", "Y", "Z", "A", "B", "C"]);
    const world = [10.5, -20.25, 3, -45, 90, 720];
    expect(k.forward(k.inverse(world, []), new Array(6).fill(0))).toEqual(world);
  });

  it("inverse resizes and reuses the caller's scratch array", () => {
    const k = makeKins(["X", "Z"]);
    const scratch: (number | null)[] = [7, 7, 7, 7];
    const out = k.inverse([1, 2, 3, 0, 0, 0], scratch);
    expect(out).toBe(scratch);
    expect(scratch).toEqual([1, 3]);
  });

  it("kinsFor memoizes per axes+type", () => {
    expect(kinsFor(["X", "Y", "Z"])).toBe(kinsFor(["X", "Y", "Z"]));
    expect(kinsFor(["X", "Y", "Z"])).not.toBe(kinsFor(["X", "Y"]));
  });

  it("unknown kins type falls back to trivkins LOUDLY", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const k = makeKins(["X", "Y", "Z"], { type: "xyzbc-nutating" });
    expect(k.type).toBe("trivkins");
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
