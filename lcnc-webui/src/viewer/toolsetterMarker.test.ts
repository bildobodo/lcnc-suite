// The tool setter puck (operator 2026-09-29): placed only for a SET-UP tool
// setter, its top face at the contact Z, a machine part in the model's greys.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildToolsetterMarker, toolsetterPlacement, TOOLSETTER_HEIGHT_MM, TOOLSETTER_DIAMETER_MM } from "./toolsetterMarker";
import { toolsetterSetup, TOOLSETTER_FALLBACK } from "../toolsetterSetup";
import { MACHINE_PALETTE } from "./palette";

const SET_UP = { ...TOOLSETTER_FALLBACK, touchX: 150, touchY: 0, touchZ: -300, fastFeed: 2000, slowFeed: 200,
  traverseFeed: 6000, maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 };

describe("toolsetterPlacement", () => {
  it("the XYZAC sim's tool setter: top centre at G53 X150 Y0, contact Z −300", () => {
    const setup = toolsetterSetup(SET_UP);
    expect(setup.ok, JSON.stringify(setup)).toBe(true);
    expect(toolsetterPlacement(setup)).toEqual({ x: 150, y: 0, topZ: -300 });
  });

  it("not set up: no position — the fallback zeros are none", () => {
    expect(toolsetterPlacement(toolsetterSetup({}))).toBeNull();
    expect(toolsetterPlacement({ ok: false, reason: "x", missing: ["touchX"], invalid: [] })).toBeNull();
  });
});

describe("buildToolsetterMarker", () => {
  it("its origin is the contact face: everything lies below it, the top exactly at 0", () => {
    const g = buildToolsetterMarker(1, {});
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.z).toBeCloseTo(0, 9);
    expect(box.min.z).toBeCloseTo(-TOOLSETTER_HEIGHT_MM, 9);
    expect(box.max.x - box.min.x).toBeCloseTo(TOOLSETTER_DIAMETER_MM, 1);
  });

  it("scales with the machine's unit (an inch machine draws 30 mm, not 30 in)", () => {
    const g = buildToolsetterMarker(1 / 25.4, {});
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.z).toBeCloseTo(-TOOLSETTER_HEIGHT_MM / 25.4, 6);   // float32 geometry
  });

  it("a machine part in the model's greys: steel body, the lighter contact face", () => {
    const g = buildToolsetterMarker(1, {});
    const colours = g.children.map(m => ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex());
    expect(colours).toEqual([MACHINE_PALETTE.steel, MACHINE_PALETTE.marks]);
  });
});
