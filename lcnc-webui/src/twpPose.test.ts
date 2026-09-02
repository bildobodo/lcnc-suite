import { describe, it, expect } from "vitest";
import { twpPoseStale, twpDatumStale, kinsModeChip, fixtureOffDatum, stampAForFixture, datumTriadVisible,
  TWP_POSE_EPS_DEG, TWP_POSE_NONE_BELOW, TWP_DATUM_EPS, TWP_PROV_A_EPS, DATUM_TRIAD_COINCIDENT_EPS } from "./twpPose";

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
  it("off datum on identity → 'MACHINE · off datum' warn, title quotes both angles", () => {
    const c = kinsModeChip({ kinsType: 0, offDatum: { stampA: 0, liveA: -5.149, stamped: true } })!;
    expect(c).toMatchObject({ text: "MACHINE · off datum", cls: "warn" });
    expect(c.title).toContain("0.00°");
    expect(c.title).toContain("-5.15°");
    expect(c.title).not.toContain("no provenance stamp");
  });
  it("off datum without a stamp says so in the title", () => {
    const c = kinsModeChip({ kinsType: 0, offDatum: { stampA: 0, liveA: 20, stamped: false } })!;
    expect(c.title).toContain("no provenance stamp");
  });
  it("off datum AND datum moved on identity → text lists both", () => {
    const c = kinsModeChip({ kinsType: 0, twpDatumMoved: true, offDatum: { stampA: 0, liveA: 20, stamped: true } })!;
    expect(c.text).toBe("MACHINE · off datum · datum moved");
    expect(c.cls).toBe("warn");
  });
  it("offDatum is ignored on non-identity modes (the predicate never yields one there)", () => {
    expect(kinsModeChip({ kinsType: 1, offDatum: { stampA: 0, liveA: 20, stamped: true } })).toMatchObject({ text: "TCP", cls: "ok" });
    expect(kinsModeChip({ kinsType: 2, twpActive: true, offDatum: { stampA: 0, liveA: 20, stamped: true } })!.text).toBe("TWP");
  });
});

describe("stampAForFixture", () => {
  const prov = [0, 35, null, null, null, null, null, null, null];
  it("indexes the 1-based active fixture into the 9-list", () => {
    expect(stampAForFixture(prov, 1)).toBe(0);
    expect(stampAForFixture(prov, 2)).toBe(35);
    expect(stampAForFixture(prov, 3)).toBeNull();
  });
  it("defaults to G54 and rounds a raw float index", () => {
    expect(stampAForFixture(prov, null)).toBe(0);
    expect(stampAForFixture(prov, 2.0)).toBe(35);
  });
  it("no list → null", () => {
    expect(stampAForFixture(null, 1)).toBeNull();
    expect(stampAForFixture(undefined, 1)).toBeNull();
  });
});

describe("fixtureOffDatum", () => {
  it("identity kins, table away from the stamp pose → the two angles", () => {
    expect(fixtureOffDatum(0, 0, -5.149)).toEqual({ stampA: 0, liveA: -5.149, stamped: true });
    expect(fixtureOffDatum(0, 35, 0)).toEqual({ stampA: 35, liveA: 0, stamped: true });
  });
  it("at the stamp pose → null (the fixture is on the part)", () => {
    expect(fixtureOffDatum(0, 35, 35)).toBeNull();
    expect(fixtureOffDatum(0, 0, 0)).toBeNull();
  });
  it("uses the stamp window: at eps quiet, above it a claim", () => {
    expect(fixtureOffDatum(0, 0, TWP_PROV_A_EPS)).toBeNull();
    expect(fixtureOffDatum(0, 0, TWP_PROV_A_EPS * 1.5)).not.toBeNull();
  });
  it("no stamp = the documented A=0 rule, flagged as unstamped", () => {
    expect(fixtureOffDatum(0, null, 20)).toEqual({ stampA: 0, liveA: 20, stamped: false });
    expect(fixtureOffDatum(0, undefined, 0)).toBeNull();
    expect(fixtureOffDatum(0, NaN, 20)!.stamped).toBe(false);
  });
  it("never a claim under TCP / TOOL kins or without switchable kins", () => {
    expect(fixtureOffDatum(1, 0, 20)).toBeNull();
    expect(fixtureOffDatum(2, 0, 20)).toBeNull();
    expect(fixtureOffDatum(null, 0, 20)).toBeNull();
    expect(fixtureOffDatum(undefined, 0, 20)).toBeNull();
  });
  it("no live reading → no claim", () => {
    expect(fixtureOffDatum(0, 0, null)).toBeNull();
    expect(fixtureOffDatum(0, 0, NaN)).toBeNull();
  });
  it("rounds a raw float kins type", () => {
    expect(fixtureOffDatum(0.0, 0, 20)).not.toBeNull();
  });
});

describe("datumTriadVisible", () => {
  const datum = [65.455, -599.345, 453.362];
  it("draws in every mode once a plane is defined and the active triad is elsewhere", () => {
    expect(datumTriadVisible({ layerOn: true, defined: true, datum, activePos: { x: 0, y: 0, z: 0 } })).toBe(true);
  });
  it("hides only while it sits under the active triad", () => {
    const on = { x: 65.455, y: -599.345, z: 453.362 };
    expect(datumTriadVisible({ layerOn: true, defined: true, datum, activePos: on })).toBe(false);
    const near = { x: on.x + DATUM_TRIAD_COINCIDENT_EPS * 0.5, y: on.y, z: on.z };
    expect(datumTriadVisible({ layerOn: true, defined: true, datum, activePos: near })).toBe(false);
    const apart = { x: on.x + DATUM_TRIAD_COINCIDENT_EPS * 1.5, y: on.y, z: on.z };
    expect(datumTriadVisible({ layerOn: true, defined: true, datum, activePos: apart })).toBe(true);
  });
  it("draws when the active triad is hidden (unknown frame) — the datum is still known", () => {
    expect(datumTriadVisible({ layerOn: true, defined: true, datum, activePos: null })).toBe(true);
  });
  it("never without a plane, the layer, or a readable datum", () => {
    expect(datumTriadVisible({ layerOn: false, defined: true, datum, activePos: null })).toBe(false);
    expect(datumTriadVisible({ layerOn: true, defined: false, datum, activePos: null })).toBe(false);
    expect(datumTriadVisible({ layerOn: true, defined: true, datum: null, activePos: null })).toBe(false);
    expect(datumTriadVisible({ layerOn: true, defined: true, datum: [1, 2], activePos: null })).toBe(false);
    expect(datumTriadVisible({ layerOn: true, defined: true, datum: [1, NaN, 3], activePos: null })).toBe(false);
  });
});
