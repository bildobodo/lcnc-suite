// The tool setter and the tool-change position (operator 2026-09-29/30):
// placed only where the position is known — a SET-UP tool setter, a G30 row
// read for X, Y and Z. Drawn as a pin with a label (pointMarker.ts).
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { toolChangePlacement, toolsetterPlacement } from "./toolsetterMarker";
import { buildPointMarker, pointMarkerSegments, posePointMarker, POINT_MARKER } from "./pointMarker";
import { toolsetterSetup, TOOLSETTER_FALLBACK } from "../toolsetterSetup";

const SET_UP = { ...TOOLSETTER_FALLBACK, touchX: 150, touchY: 0, touchZ: -300, fastFeed: 2000, slowFeed: 200,
  traverseFeed: 6000, maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 };

describe("toolsetterPlacement", () => {
  it("the XYZAC sim's tool setter: the contact point at G53 X150 Y0 Z−300", () => {
    const setup = toolsetterSetup(SET_UP);
    expect(setup.ok, JSON.stringify(setup)).toBe(true);
    expect(toolsetterPlacement(setup)).toEqual({ x: 150, y: 0, topZ: -300 });
  });

  it("not set up: no position — the fallback zeros are none", () => {
    expect(toolsetterPlacement(toolsetterSetup({}))).toBeNull();
    expect(toolsetterPlacement({ ok: false, reason: "x", missing: ["touchX"], invalid: [] })).toBeNull();
  });
});

describe("toolChangePlacement", () => {
  it("the stored G30's X, Y, Z", () => {
    expect(toolChangePlacement({ ok: true, values: { X: 150, Y: -20, Z: -10, A: 0, C: 90 } })).toEqual({ x: 150, y: -20, z: -10 });
  });
  it("a failed read, a missing row or a non-number: no position (never 0)", () => {
    expect(toolChangePlacement(null)).toBeNull();
    expect(toolChangePlacement({ ok: false, error: "No parameter file" })).toBeNull();
    expect(toolChangePlacement({ ok: true, values: { X: 150, Y: null, Z: 0 } })).toBeNull();
    expect(toolChangePlacement({ ok: true, values: { X: 150, Y: 0 } })).toBeNull();
  });
});

describe("buildPointMarker", () => {
  it("a cross at the point and a stem up, the label over the stem — no axis triad", () => {
    const label = new THREE.Object3D();
    const m = buildPointMarker({ color: "#15181c", alt: "#f0f2f4", label, name: "toolsetter" });
    const seg = pointMarkerSegments();
    expect(seg.length / 6, "three segments: two cross arms, one stem").toBe(3);
    expect(Math.max(...Array.from(seg).filter((_, i) => i % 3 === 2)), "the stem's top").toBe(POINT_MARKER.stemPx);
    expect(label.position.z).toBeGreaterThan(POINT_MARKER.stemPx);
    const roles = new Set<string>();
    m.traverse(o => { const r = ((o as THREE.Mesh).material as THREE.Material | undefined)?.userData?.role; if (r) roles.add(r); });
    expect([...roles].sort(), "its own role, never a box's (a box probe picks the longest box segment)").toEqual(["marker", "markerAlt"]);
  });
  it("the same size on screen at every zoom, the label up on SCREEN from the point", () => {
    const label = new THREE.Object3D();
    const m = buildPointMarker({ color: "#15181c", alt: "#f0f2f4", label, name: "toolChange" });
    posePointMarker(m, 0.5, new THREE.Vector3(0, 0, 1));   // 0.5 mm per px, a side view (screen up = +Z)
    m.updateMatrixWorld(true);
    const top = new THREE.Vector3(0, 0, POINT_MARKER.stemPx).applyMatrix4(m.matrixWorld);
    expect(top.z).toBeCloseTo(POINT_MARKER.stemPx * 0.5, 9);
    expect(label.position.z).toBeGreaterThan(POINT_MARKER.stemPx);
    // seen from above (screen up = +Y): the label beside the point on screen, never on the cross
    posePointMarker(m, 0.5, new THREE.Vector3(0, 1, 0));
    expect([label.position.x, label.position.z]).toEqual([0, 0]);
    expect(label.position.y).toBeGreaterThan(POINT_MARKER.stemPx);
    posePointMarker(m, 0, new THREE.Vector3(0, 1, 0));   // a degenerate read keeps the last size
    expect(m.scale.x).toBe(0.5);
  });
});
