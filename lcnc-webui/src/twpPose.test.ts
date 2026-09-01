import { describe, it, expect } from "vitest";
import { twpPoseStale, twpDatumStale, kinsModeChip, TWP_POSE_EPS_DEG, TWP_POSE_NONE_BELOW, TWP_DATUM_EPS, TWP_PROV_A_EPS } from "./twpPose";

describe("twpPoseStale", () => {
  it("makes no claim when no plane is defined", () => {
    expect(twpPoseStale(0, 30, false)).toBe(false);
    expect(twpPoseStale(0, 30, null)).toBe(false);
    expect(twpPoseStale(0, 30, undefined)).toBe(false);
  });

  it("treats the sentinel as no pose, not as a huge deviation", () => {
    expect(twpPoseStale(-1e9, 0, true)).toBe(false);
    expect(twpPoseStale(TWP_POSE_NONE_BELOW - 1, 0, true)).toBe(false);
  });

  it("makes no claim without both readings", () => {
    expect(twpPoseStale(null, 30, true)).toBe(false);
    expect(twpPoseStale(0, null, true)).toBe(false);
    expect(twpPoseStale(undefined, undefined, true)).toBe(false);
    expect(twpPoseStale(NaN, 0, true)).toBe(false);
    expect(twpPoseStale(0, NaN, true)).toBe(false);
  });

  it("is quiet at and below the epsilon, stale above it", () => {
    expect(twpPoseStale(0, TWP_POSE_EPS_DEG, true)).toBe(false);
    expect(twpPoseStale(0, TWP_POSE_EPS_DEG * 1.5, true)).toBe(true);
    expect(twpPoseStale(0, -TWP_POSE_EPS_DEG * 1.5, true)).toBe(true);
  });

  it("compares magnitudes around a nonzero definition pose", () => {
    expect(twpPoseStale(20, 20, true)).toBe(false);
    expect(twpPoseStale(20, 40, true)).toBe(true);
    expect(twpPoseStale(-33.25, -33.25, true)).toBe(false);
  });
});

describe("twpDatumStale", () => {
  const row = { x: 10, y: 20, z: 30 };
  it("stale when the live G54 row leaves the snapshot", () => {
    expect(twpDatumStale({ ...row, z: 30.5 }, [10, 20, 30], true)).toBe(true);
  });
  it("clean when they agree", () => {
    expect(twpDatumStale(row, [10, 20, 30], true)).toBe(false);
  });
  it("epsilon boundary: exactly at eps is not stale, just over is", () => {
    expect(twpDatumStale({ ...row, x: 10 + TWP_DATUM_EPS }, [10, 20, 30], true)).toBe(false);
    expect(twpDatumStale({ ...row, x: 10 + TWP_DATUM_EPS * 2 }, [10, 20, 30], true)).toBe(true);
  });
  it("unknown is not stale: no plane / no datum / unreadable row", () => {
    expect(twpDatumStale(row, [10, 20, 30], false)).toBe(false);
    expect(twpDatumStale(row, null, true)).toBe(false);
    expect(twpDatumStale(null, [10, 20, 30], true)).toBe(false);
    expect(twpDatumStale({ x: 10, y: 20 }, [10, 20, 30], true)).toBe(false);
    expect(twpDatumStale({ x: NaN, y: 20, z: 30 }, [10, 20, 30], true)).toBe(false);
  });
});

describe("twpDatumStale — W1 stamp rule", () => {
  const row = { x: 10, y: 20, z: 30 };
  it("a G54 stamped at a tilted A makes no claim (its row is not table-frame)", () => {
    expect(twpDatumStale({ ...row, z: 99 }, [10, 20, 30], true, 30)).toBe(false);
  });
  it("no stamp = touched off pre-W1 = compared as A0", () => {
    expect(twpDatumStale({ ...row, z: 99 }, [10, 20, 30], true, null)).toBe(true);
    expect(twpDatumStale({ ...row, z: 99 }, [10, 20, 30], true, undefined)).toBe(true);
  });
  it("a stamp within the A epsilon still compares", () => {
    expect(twpDatumStale({ ...row, z: 99 }, [10, 20, 30], true, TWP_PROV_A_EPS / 2)).toBe(true);
    expect(twpDatumStale(row, [10, 20, 30], true, 0)).toBe(false);
  });
});

describe("kinsModeChip priority table", () => {
  it("no switchable kins → null", () => {
    expect(kinsModeChip({ kinsType: null })).toBeNull();
    expect(kinsModeChip({ kinsType: undefined })).toBeNull();
  });
  it("identity → MACHINE muted", () => {
    expect(kinsModeChip({ kinsType: 0 })).toMatchObject({ text: "MACHINE", cls: "muted" });
  });
  it("TCP → ok", () => {
    expect(kinsModeChip({ kinsType: 1 })).toMatchObject({ text: "TCP", cls: "ok" });
  });
  it("TOOL kins without a plane → TOOL warn", () => {
    expect(kinsModeChip({ kinsType: 2, twpActive: false })).toMatchObject({ text: "TOOL", cls: "warn" });
  });
  it("TWP active → TWP warn", () => {
    expect(kinsModeChip({ kinsType: 2, twpActive: true })).toMatchObject({ text: "TWP", cls: "warn" });
  });
  it("head-stale beats active → bad", () => {
    expect(kinsModeChip({ kinsType: 2, twpActive: true, twpStale: true })).toMatchObject({ text: "TWP", cls: "bad" });
  });
  it("datum moved on an active plane → warn, text carries 'datum moved'", () => {
    const c = kinsModeChip({ kinsType: 2, twpActive: true, twpDatumMoved: true })!;
    expect(c.cls).toBe("warn");
    expect(c.text).toBe("TWP · datum moved");
  });
  it("datum moved AND head-stale → colour stays bad, text lists both", () => {
    const c = kinsModeChip({ kinsType: 2, twpActive: true, twpStale: true, twpDatumMoved: true })!;
    expect(c.cls).toBe("bad");
    expect(c.text).toBe("TWP · datum moved");
    expect(c.title).toContain("STALE");
  });
  it("datum moved on identity kins → 'MACHINE · datum moved'", () => {
    expect(kinsModeChip({ kinsType: 0, twpDatumMoved: true })).toMatchObject({ text: "MACHINE · datum moved", cls: "warn" });
  });
  it("rounds a raw float kins type", () => {
    expect(kinsModeChip({ kinsType: 1.0 })!.text).toBe("TCP");
  });
});
