/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import fixtures from "../../test-fixtures/fusion-tool-contours.json";
import { buildToolProfile, splitProfileAt, type ToolMeta } from "./toolGeometry";
import { toolUnitsPerMillimeter } from "./toolUnits";

// Exercise the real Python importer and TS renderer together. The importer is
// stdlib-only; no gateway, running LinuxCNC, or Fusion session is required.
const imported = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from fusion_import import parse_fusion_library
cases = json.load(sys.stdin)['cases']
print(json.dumps([{
    'id': c['id'],
    'mm': parse_fusion_library({'data': [c['raw']]}, 'mm')[0][0],
    'inch': parse_fusion_library({'data': [c['raw']]}, 'in')[0][0]
} for c in cases]))
`], {
  cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)),
  input: JSON.stringify(fixtures), encoding: "utf8",
})) as { id: string; mm: ToolMeta & { D: number }; inch: ToolMeta & { D: number } }[];

function expectSamePoints(a: THREE.Vector2[], b: THREE.Vector2[], factor = 1) {
  expect(b.length).toBe(a.length);
  a.forEach((p, i) => {
    expect(b[i]!.x * factor).toBeCloseTo(p.x, 9);
    expect(b[i]!.y * factor).toBeCloseTo(p.y, 9);
  });
}

describe("Fusion import → tool geometry", () => {
  for (const c of imported) {
    it(`${c.id}: same physical profile and cutter/shaft split in mm and inch`, () => {
      const mm = buildToolProfile(c.mm.D, c.mm.oal!, c.mm, 1);
      const inchScale = toolUnitsPerMillimeter("in");
      const inch = buildToolProfile(c.inch.D, c.inch.oal!, c.inch, inchScale);
      expectSamePoints(mm.pts, inch.pts, 25.4);
      expect(inch.fluteY * 25.4).toBeCloseTo(mm.fluteY, 9);
      const a = splitProfileAt(mm.pts, mm.fluteY, 1);
      const b = splitProfileAt(inch.pts, inch.fluteY, inchScale);
      expectSamePoints(a.cutter, b.cutter, 25.4);
      expectSamePoints(a.shaft, b.shaft, 25.4);
    });

    it(`${c.id}: changing measured visual length does not stretch an imported body`, () => {
      // These are the two fallback lengths the viewer would pass after a
      // measurement. Imported OAL remains authoritative for the physical body.
      const first = buildToolProfile(c.mm.D, 42.3 + 20, c.mm);
      const second = buildToolProfile(c.mm.D, 44.1 + 20, c.mm);
      expectSamePoints(first.pts, second.pts);
      expect(first.fluteY).toBe(second.fluteY);
    });
  }

  for (const id of ["bare-counter-sink", "bare-counter-sink-120", "bare-drill"]) {
    it(`${id}: reproduces the native Fusion tip geometry`, () => {
      const fixture = fixtures.cases.find(c => c.id === id)!;
      const c = imported.find(c => c.id === id)!;
      for (const unit of ["mm", "inch"] as const) {
        const scale = toolUnitsPerMillimeter(unit);
        const tool = c[unit];
        const { pts } = buildToolProfile(tool.D, tool.oal!, tool, scale);
        // Native sharp-tip fixtures begin at the axis, followed by the cone's
        // full-diameter endpoint. The remaining shoulder profile is later work.
        const native = fixture.nativePoints[1]!;
        expect(pts[0]!.toArray()).toEqual([0, 0]);
        expect(pts[1]!.x / scale).toBeCloseTo(native[0]!, 5);
        expect(pts[1]!.y / scale).toBeCloseTo(native[1]!, 5);
        expect(pts.every(p => p.y >= 0)).toBe(true);
        expect(2 * Math.max(...pts.map(p => p.x)) / scale).toBeCloseTo(fixture.raw.geometry.DC, 8);
      }
    });
  }

  it("keeps the observed 90° and 120° countersink heights", () => {
    for (const [id, expected] of [["bare-counter-sink", 5], ["bare-counter-sink-120", 5 / Math.sqrt(3)]] as const) {
      const tool = imported.find(c => c.id === id)!.mm;
      expect(buildToolProfile(tool.D, tool.oal!, tool).pts[1]!.y).toBeCloseTo(expected, 10);
    }
  });

  it("scales fixed visual fallback sizes and thresholds consistently", () => {
    for (const type of ["facemill", "dovetail", "tapered", "slotmill", "probe", "formmill"]) {
      const meta: ToolMeta = { type, oal: 10, flute_length: 1, body_length: 1,
        shaft_diameter: 0.01, corner_radius: 0.02,
        profile: [{end:[0,0]}, {end:[0.04,0]}, {end:[0.04,10]}, {end:[0,10]}] };
      const scale = 1 / 25.4;
      const small: ToolMeta = { ...meta, oal: 10*scale, flute_length: scale,
        body_length: scale, shaft_diameter: 0.01*scale, corner_radius: 0.02*scale,
        profile: meta.profile!.map(p => ({end:[p.end[0]*scale,p.end[1]*scale]})) };
      expectSamePoints(buildToolProfile(0.08, 10, meta).pts,
        buildToolProfile(0.08*scale, 10*scale, small, scale).pts, 25.4);
    }
  });

  it("recognizes machine inch spellings", () => {
    for (const unit of ["in", "inch", "inches"]) expect(toolUnitsPerMillimeter(unit)).toBe(1 / 25.4);
    expect(toolUnitsPerMillimeter("mm")).toBe(1);
  });
});
