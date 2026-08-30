// Kins boundary (viewer/kins.ts): the trivkins model must reproduce the
// letter→slot permutation every consumer previously inlined — these tests
// pin the boundary's contract (null semantics, zero-fill, roundtrip) so
// phase-1c's real kinematics implementations slot in behind a proven
// interface. (Non-trivial models get compiled-C-oracle fixtures instead;
// trivkins is the identity permutation by definition.)
import { describe, expect, it, vi } from "vitest";
import { kinsFor, kinsForSegment, makeKins, specFromWire, warnWorldWithoutSpec, worldModeForSpec, worldModeForType } from "./kins";

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

describe("worldModeForSpec (raw wire type → mode, family-aware)", () => {
  // Client twin of gateway_util.kins_nonidentity_flags — the two must
  // never disagree on which segments leave the identity permutation.
  it("trt specs follow sparm via worldModeForType", () => {
    expect(worldModeForSpec(0, { type: "xyzac-trt" })).toBe(true);           // plain: 0 = world
    expect(worldModeForSpec(1, { type: "xyzac-trt" })).toBe(false);
    expect(worldModeForSpec(1, { type: "xyzac-trt", identityFirst: true })).toBe(true);
    expect(worldModeForSpec(0, { type: "xyzac-trt", identityFirst: true })).toBe(false);
    expect(worldModeForSpec(2, { type: "xyzac-trt", identityFirst: true })).toBe(false); // userk = identity
  });
  it("xyzacb-trsrn: type 0 identity, 1 (TCP) and 2 (TOOL) both non-identity", () => {
    expect(worldModeForSpec(0, { type: "xyzacb-trsrn" })).toBe(false);
    expect(worldModeForSpec(1, { type: "xyzacb-trsrn" })).toBe(true);
    expect(worldModeForSpec(2, { type: "xyzacb-trsrn" })).toBe(true);
  });
  it("no spec: any nonzero type reports true (loud-fallback path)", () => {
    expect(worldModeForSpec(0, undefined)).toBe(false);
    expect(worldModeForSpec(2, undefined)).toBe(true);
    expect(worldModeForSpec(undefined, undefined)).toBe(false);
  });
});

describe("kinsForSegment (phase 3 per-segment routing)", () => {
  const AXES6 = ["X", "Y", "Z", "A", "B", "C"];
  // The spike machine's INI wiring, through the real wire mapping.
  const TRSRN = specFromWire({
    type: "xyzacb-trsrn", identity_first: false,
    params: { y_pivot: 50, z_pivot: 120, x_offset: 0, y_offset: 0,
              y_rot_axis: -1000, z_rot_axis: -2000, nut_angle: 55 },
  })!;
  const FRAME: [number, number, number] = [-1.781762, 130.2455, -40.8555];

  it("routes trt exactly as phase 2b (world/identity by sparm)", () => {
    const spec = { type: "xyzac-trt", identityFirst: true, params: { yOffset: 20, zOffset: 10 } };
    const axes = ["X", "Y", "Z", "A", "C"];
    expect(kinsForSegment(axes, spec, 1, null, 5, "test").type).toBe("xyzac-trt");
    expect(kinsForSegment(axes, spec, 0, null, 5, "test").type).toBe("trivkins");
    expect(kinsForSegment(axes, spec, null, null, 5, "test").type).toBe("trivkins");
  });

  it("trsrn type 2 + frame: capture-pinned plane inverse (TLO ignored)", () => {
    // Live task run 2026-08-20 (simple_example.ngc end state, G43 h3=100):
    // stat.position vs joints — mode-2 world coords ARE the TLO-inclusive
    // machine position, no TLO term in the math.
    const m = kinsForSegment(AXES6, TRSRN, 2, FRAME, 100, "test");
    const joints: (number | null)[] = [];
    m.inverse([1609.597, -854.904, -571.098, 0, -40.855, 130.245], joints);
    expect(joints[0]).toBeCloseTo(1390.773, 2);
    expect(joints[1]).toBeCloseTo(-379.602, 2);
    expect(joints[2]).toBeCloseTo(-1279.861, 2);
  });

  it("trsrn type 1 (TCP): capture-pinned with TLO folded into the pivot", () => {
    // capture-g536 orient window: world pinned (1300,-200,-1200) while
    // the joints migrated (capture values, 1 decimal).
    const m = kinsForSegment(AXES6, TRSRN, 1, null, 100, "test");
    const world: number[] = [];
    m.forward([1309.7, -371.6, -1230.2, 0, -40.855, 130.245], world);
    expect(world[0]).toBeCloseTo(1300, 1);
    expect(world[1]).toBeCloseTo(-200, 1);
    expect(world[2]).toBeCloseTo(-1200, 1);
  });

  it("trsrn type 0 → trivkins; type 2 without frame → loud trivkins", () => {
    expect(kinsForSegment(AXES6, TRSRN, 0, null, 0, "test").type).toBe("trivkins");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(kinsForSegment(AXES6, TRSRN, 2, null, 0, "test").type).toBe("trivkins");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("memoizes: same segment inputs return the same instance", () => {
    const a = kinsForSegment(AXES6, TRSRN, 2, FRAME, 100, "test");
    const b = kinsForSegment(AXES6, TRSRN, 2, FRAME, 100, "test");
    expect(a).toBe(b);
  });
});

describe("kins memo eviction (schema 8)", () => {
  it("keeps a hot key resident across hundreds of distinct TLO keys", () => {
    const axes = ["X", "Y", "Z", "A", "C"];
    const spec = specFromWire({ type: "xyzac-trt", params: { y_rot_point: 1, z_rot_point: 2 } });
    const hot = kinsFor(axes, spec, 22);
    // 300 distinct offsets: a clear-at-cap memo would drop `hot` several
    // times over; oldest-key eviction keeps it as long as it is re-used.
    for (let i = 1; i <= 300; i++) {
      kinsFor(axes, spec, 1000 + i);
      if (i % 50 === 0) expect(kinsFor(axes, spec, 22)).toBe(hot);
    }
    expect(kinsFor(axes, spec, 22)).toBe(hot);
  });
});
