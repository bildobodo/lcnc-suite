// Kins boundary (viewer/kins.ts): the trivkins model must reproduce the
// letter→slot permutation every consumer previously inlined — these tests
// pin the boundary's contract (null semantics, zero-fill, roundtrip) so
// phase-1c's real kinematics implementations slot in behind a proven
// interface. (Non-trivial models get compiled-C-oracle fixtures instead;
// trivkins is the identity permutation by definition.)
import { describe, expect, it, vi } from "vitest";
import { kinsFor, makeKins, specFromWire, warnWorldWithoutSpec, worldModeForType } from "./kins";

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

  it("specFromWire maps the wire declaration; trivkins/absent → undefined", () => {
    expect(specFromWire(null)).toBeUndefined();
    expect(specFromWire({ type: "trivkins", params: {} })).toBeUndefined();
    const spec = specFromWire({
      type: "xyzac-trt",
      params: { x_rot_point: 1, y_offset: 20, z_offset: 10 },
    });
    expect(spec?.type).toBe("xyzac-trt");
    expect(spec?.params?.xRotPoint).toBe(1);
    expect(spec?.params?.yOffset).toBe(20);
    expect(spec?.params?.toolOffset).toBeUndefined();  // live TLO, never wire
    // The mapped spec builds the real model
    expect(makeKins(["X", "Y", "Z", "A", "C"], spec).type).toBe("xyzac-trt");
  });

  it("unknown kins type falls back to trivkins LOUDLY", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const k = makeKins(["X", "Y", "Z"], { type: "xyzbc-nutating" });
    expect(k.type).toBe("trivkins");
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it("trt type with required letters missing falls back to trivkins LOUDLY", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const k = makeKins(["X", "Y", "Z"], { type: "xyzac-trt" });  // no A/C axes
    expect(k.type).toBe("trivkins");
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it("specFromWire tolerates an absent params object", () => {
    const spec = specFromWire({ type: "xyzac-trt", params: undefined as never });
    expect(spec?.type).toBe("xyzac-trt");
    expect(spec?.params?.xRotPoint).toBeUndefined();
    // The model still builds — unset pivot params default to 0.
    expect(makeKins(["X", "Y", "Z", "A", "C"], spec).type).toBe("xyzac-trt");
  });

  it("warnWorldWithoutSpec logs exactly once per JS context", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    warnWorldWithoutSpec("test site");
    warnWorldWithoutSpec("test site");
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});

describe("worldModeForType (live switchkins pin → mode)", () => {
  // Must mirror gateway_util.kins_world_flags: identity_first ⇒ type 1 is
  // the world kins; plain ⇒ startup type 0 is; type 2 (userk) is identity
  // math in the stock template — under BOTH sparm settings.
  it("identityfirst configs: type 1 is world, 0 and 2 are identity", () => {
    expect(worldModeForType(1, true)).toBe(true);
    expect(worldModeForType(0, true)).toBe(false);
    expect(worldModeForType(2, true)).toBe(false);
  });
  it("plain configs: startup type 0 is world, 1 and 2 are identity", () => {
    expect(worldModeForType(0, false)).toBe(true);
    expect(worldModeForType(1, false)).toBe(false);
    expect(worldModeForType(2, false)).toBe(false);
  });
  it("tolerates HAL float noise around the integer type", () => {
    expect(worldModeForType(1.0000001, true)).toBe(true);
    expect(worldModeForType(0.9999999, true)).toBe(true);
  });
});
