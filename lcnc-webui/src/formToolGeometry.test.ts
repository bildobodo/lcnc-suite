import { describe, expect, it } from "vitest";
import * as THREE from "three";
import fixtures from "../../test-fixtures/fusion-tool-contours.json";
import simulation from "../../test-fixtures/fusion-form-simulation/native-silhouette.json";
import offsetSimulation from "../../test-fixtures/fusion-form-simulation/tip-offset-plus10/native-silhouette.json";
import { buildToolGeometry, buildToolParts, buildToolProfile, type ProfileSegment, type ToolMeta } from "./toolGeometry";

const form = (profile: ProfileSegment[], extra: ToolMeta = {}): ToolMeta => ({
  type: "formmill", oal: 20, flute_length: 8, profile, ...extra,
});
const lineProfile = (points: [number, number][]): ProfileSegment[] => points.map(end => ({ end }));
const scaleProfile = (profile: ProfileSegment[], scale: number): ProfileSegment[] => profile.map(s => ({
  ...s, end: [s.end[0] * scale, s.end[1] * scale],
  center: s.center ? [s.center[0] * scale, s.center[1] * scale] : undefined,
}));

// These tests verify the exported JSON's geometry and analytic primitives.
// Fusion's CAM post substitutes an end mill and is NOT a form-tool shape oracle.
describe("form tool closed profiles", () => {
  it("keeps every endpoint of the Autodesk sample, including the bottom axis", () => {
    const raw = fixtures.cases.find(c => c.raw.type === "form mill")!.raw;
    const profile: ProfileSegment[] = raw.geometry.profile!.map(s => ({
      ...s, end: [s.end[0]!, s.end[1]!],
      center: s.center ? [s.center[0]!, s.center[1]!] : undefined,
    }));
    const result = buildToolProfile(raw.geometry.DC, raw.geometry.OAL, form(profile));
    for (const segment of profile) {
      expect(result.pts.some(p => p.x === segment.end[0] && p.y === segment.end[1])).toBe(true);
    }
    expect(Math.max(...result.pts.map(p => p.x))).toBe(60.4068);
    expect(Math.max(...result.pts.map(p => p.y))).toBe(179.598);
  });

  it("actually closes the bottom of the rendered lathe mesh", () => {
    const profile = lineProfile([[0,0], [5,0], [5,3], [8,3], [8,10], [0,10]]);
    const parts = buildToolParts(10, 10, form(profile));
    const sides = 64;
    const geometry = buildToolGeometry(parts.cutter, sides);
    const position = geometry.getAttribute("position");
    const indices = geometry.index!;
    let bottomArea = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < indices.count; i += 3) {
      a.fromBufferAttribute(position, indices.getX(i));
      b.fromBufferAttribute(position, indices.getX(i + 1));
      c.fromBufferAttribute(position, indices.getX(i + 2));
      if ([a,b,c].every(p => Math.abs(p.z) < 1e-6)) {
        bottomArea += b.sub(a).cross(c.sub(a)).length() / 2;
      }
    }
    geometry.dispose();
    // Area of the regular polygon used by the lathe, independent of arc sampling.
    expect(bottomArea).toBeCloseTo(sides / 2 * 25 * Math.sin(2 * Math.PI / sides), 4);
  });

  it("retains a 5 micron radial step and 10 micron axial segments in mm and inch", () => {
    const points: [number, number][] = [[0,0], [2,0], [2,0.01], [2.005,0.01],
      [2.005,0.02], [2,0.02], [2,1], [0,1]];
    for (const scale of [1, 1 / 25.4]) {
      const meta = form(scaleProfile(lineProfile(points), scale));
      const { pts } = buildToolProfile(4 * scale, scale, meta, scale);
      expect(pts.length).toBe(points.length);
      pts.forEach((p, i) => {
        expect(p.x / scale).toBeCloseTo(points[i]![0], 12);
        expect(p.y / scale).toBeCloseTo(points[i]![1], 12);
      });
    }
  });

  it("keeps undercut connectivity through multiple crossings of LCF", () => {
    const points: [number, number][] = [[0,0], [5,0], [5,6], [3,4], [3,8], [6,8], [6,12], [0,12]];
    const profile = lineProfile(points);
    for (const flute_length of [2, 5, 10, 12, 50]) {
      const parts = buildToolParts(10, 12, form(profile, { flute_length }));
      expect(parts.cutter.map(p => p.toArray())).toEqual(points);
      expect(parts.shaft).toEqual([]);
    }
  });

  it("does not resize the custom outline to match DC, OAL or measured length", () => {
    const points: [number, number][] = [[0,0], [5,0], [5,10], [0,10]];
    for (const length of [8, 42.3, 44.1]) {
      const meta = form(lineProfile(points), { oal: 100, body_length: length, tip_offset: length,
        holder_segments: [{ height: 60, lower_diameter: 30, upper_diameter: 40 }] });
      expect(buildToolParts(100, length, meta).cutter.map(p => p.toArray())).toEqual(points);
    }
  });

  it("includes an off-axis profile's closing edge and renders either winding outward", () => {
    const points: [number, number][] = [[2,0], [5,0], [5,10], [2,10]];
    for (const input of [points, [...points].reverse()]) {
      const { cutter } = buildToolParts(10, 10, form(lineProfile(input)));
      expect(cutter[0]!.equals(cutter[cutter.length - 1]!)).toBe(true);
      const area2 = cutter.reduce((area, p, i) => {
        const q = cutter[(i + 1) % cutter.length]!;
        return area + p.x * q.y - q.x * p.y;
      }, 0);
      expect(area2).toBe(60);
    }
  });
});

describe("form tool circular arcs", () => {
  for (const ccw of [true, false]) {
    it(`${ccw ? "CCW major" : "CW minor"} arc follows its centre within 0.001 mm chord error`, () => {
      // CW is a quarter-circle; CCW traverses the other three quadrants.
      const profile: ProfileSegment[] = [{end:[6,4]}, {arc:true, ccw, center:[4,4], end:[4,2]}];
      for (const scale of [1, 1 / 25.4]) {
        const { pts } = buildToolProfile(12 * scale, 8 * scale,
          form(scaleProfile(profile, scale)), scale);
        // Ignore the implicit closing chord between start and end. Every other
        // edge approximates the independent circle (r-4)^2+(z-4)^2=4.
        const isEnd = (p: THREE.Vector2) =>
          Math.abs(p.x / scale - 4) < 1e-10 && Math.abs(p.y / scale - 2) < 1e-10;
        const isStart = (p: THREE.Vector2) =>
          Math.abs(p.x / scale - 6) < 1e-10 && Math.abs(p.y / scale - 4) < 1e-10;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i-1]!, b = pts[i]!;
          if ((isStart(a) && isEnd(b)) || (isEnd(a) && isStart(b))) continue;
          const radius = Math.hypot((a.x+b.x)/(2*scale)-4, (a.y+b.y)/(2*scale)-4);
          expect(2 - radius).toBeLessThanOrEqual(0.001 + 1e-12);
          expect(2 - radius).toBeGreaterThanOrEqual(-1e-12);
        }
        expect(Math.min(...pts.map(p => p.x / scale))).toBeCloseTo(ccw ? 2 : 4, 2);
        expect(Math.max(...pts.map(p => p.y / scale))).toBeCloseTo(ccw ? 6 : 4, 2);
      }
    });
  }

  it("keeps an explicit full circle with equal start and end instead of collapsing it", () => {
    const profile: ProfileSegment[] = [{end:[6,4]}, {arc:true, ccw:true, center:[4,4], end:[6,4]}];
    const { cutter } = buildToolParts(12, 8, form(profile));
    expect(cutter.length).toBeGreaterThan(10);
    expect(cutter[0]!.equals(cutter[cutter.length - 1]!)).toBe(true);
    expect(Math.min(...cutter.map(p => p.x))).toBeCloseTo(2, 2);
    expect(Math.min(...cutter.map(p => p.y))).toBeCloseTo(2, 2);
    expect(Math.max(...cutter.map(p => p.y))).toBeCloseTo(6, 2);
  });

  it("bounds tessellation for extreme imported radii", () => {
    const profile: ProfileSegment[] = [{end:[2e9,1e9]},
      {arc:true, ccw:true, center:[1e9,1e9], end:[2e9,1e9]}];
    const { cutter } = buildToolParts(1, 1, form(profile));
    expect(cutter.length).toBeLessThanOrEqual(4097);
    expect(cutter.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe("native Fusion form-tool simulation silhouette", () => {
  const distanceToPolyline = (p: THREE.Vector2, outline: THREE.Vector2[]): number => {
    let minimum = Infinity;
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1]!, b = outline[i]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
      minimum = Math.min(minimum, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return minimum;
  };

  for (const reference of [simulation, offsetSimulation]) {
    const profile: ProfileSegment[] = reference.raw.geometry.profile.map(s => ({
      ...s, end: [s.end[0]!, s.end[1]!],
      center: s.center ? [s.center[0]!, s.center[1]!] : undefined,
    }));
    for (const scale of [1, 1 / 25.4]) {
      it(`${reference.operation}: matches image edges in ${scale === 1 ? "mm" : "inch"}`, () => {
        const { cutter } = buildToolParts(reference.raw.geometry.DC * scale, 42.3 * scale,
          form(scaleProfile(profile, scale), {
            oal: reference.raw.geometry.OAL * scale,
            flute_length: reference.raw.geometry.LCF * scale,
            tip_offset: reference.raw.geometry["tip-offset"] * scale,
          }), scale);
        const rendered = cutter.map(p => p.clone().divideScalar(scale));
        for (const column of [1, 2]) {
          const native = reference.samples.map(s => new THREE.Vector2(s[column]!, s[0]!));
          // Calibration uses stock/camera measurements and the simulation's Z
          // readout. No fitted scale or alignment to LCNC's tool.
          for (const point of native) {
            expect(distanceToPolyline(point, rendered)).toBeLessThan(reference.toleranceMm);
          }
          // Reverse comparison catches contours extending beyond the reference.
          // Stay inside the image's sampled interval, and omit the axis closure.
          for (let i = 1; i < rendered.length; i++) {
            const a = rendered[i - 1]!, b = rendered[i]!;
            if (a.x === 0 && b.x === 0) continue;
            const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.1));
            for (let j = 0; j <= steps; j++) {
              const point = a.clone().lerp(b, j / steps);
              if (point.y < reference.coverageZMm[0]! + 1
                || point.y > reference.coverageZMm[1]! - 1) continue;
              expect(distanceToPolyline(point, native)).toBeLessThan(reference.toleranceMm);
            }
          }
        }
        if (reference.silhouetteBounds.fullHeightVisible) {
          // The nonzero-offset capture includes both ends. This rejects an extra
          // tip-offset translation and verifies OAL independently of shape fitting.
          expect(Math.abs(Math.min(...rendered.map(p => p.y))
            - reference.silhouetteBounds.minZMm)).toBeLessThan(reference.toleranceMm);
          expect(Math.abs(Math.max(...rendered.map(p => p.y))
            - reference.silhouetteBounds.maxZMm)).toBeLessThan(reference.toleranceMm);
        }
      });
    }
  }
});
