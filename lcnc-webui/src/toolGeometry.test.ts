/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import originalFixtures from "../../test-fixtures/fusion-tool-contours.json";
import shoulderFixtures from "../../test-fixtures/fusion-tool-shoulders.json";
import taperThreadFixtures from "../../test-fixtures/fusion-tool-tapers-threads.json";
const fixtures = { cases: [...originalFixtures.cases, ...shoulderFixtures.cases, ...taperThreadFixtures.cases] };
import { buildToolProfile, buildToolParts, type ToolMeta } from "./toolGeometry";
import { toolUnitsPerMillimeter } from "./toolUnits";

// Exercise the real Python importer and TS renderer together. The importer is
// stdlib-only; no gateway, running LinuxCNC, or Fusion session is required.
const imported = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from fusion_import import parse_fusion_library
from tool_table import _TOOL_META_FIELDS, _merge_tool_data, tool_visual_metadata
from tool_store import ToolLibraryStore
from pathlib import Path
from tempfile import TemporaryDirectory

def imported_case(raw, unit):
    parsed = parse_fusion_library({'data': [raw]}, unit)[0][0]
    key = str(parsed['T'])
    with TemporaryDirectory() as directory:
        store = ToolLibraryStore(Path(directory) / 'tools.json', lambda: '/test.ini')
        store.save({key: {k: parsed[k] for k in _TOOL_META_FIELDS if k in parsed}})
        saved = store.load()[key]
        table = _merge_tool_data([dict(T=parsed['T'], P=1, Z=-42.3, D=parsed['D'])], {key: saved})[0]
        return dict(parsed, preview=table, viewer=tool_visual_metadata(saved))

cases = json.load(sys.stdin)['cases']
print(json.dumps([{
    'id': c['id'],
    'mm': imported_case(c['raw'], 'mm'),
    'inch': imported_case(c['raw'], 'in')
} for c in cases]))
`], {
  cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)),
  input: JSON.stringify(fixtures), encoding: "utf8",
})) as { id: string; mm: ImportedTool; inch: ImportedTool }[];
type ImportedTool = ToolMeta & { D: number; preview: ToolMeta; viewer: ToolMeta };

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
      const a = buildToolParts(c.mm.D, c.mm.oal!, c.mm, 1);
      const b = buildToolParts(c.inch.D, c.inch.oal!, c.inch, inchScale);
      expectSamePoints(a.cutter, b.cutter, 25.4);
      expectSamePoints(a.shaft, b.shaft, 25.4);
    });

    it(`${c.id}: preserved geometry reaches both previews after persistence`, () => {
      for (const unit of ["mm", "inch"] as const) {
        const tool = c[unit];
        const scale = toolUnitsPerMillimeter(unit);
        const direct = buildToolParts(tool.D, tool.oal!, tool, scale);
        for (const meta of [tool.preview, tool.viewer]) {
          const parts = buildToolParts(tool.D, tool.oal!, meta, scale);
          expectSamePoints(direct.cutter, parts.cutter);
          expectSamePoints(direct.shaft, parts.shaft);
        }
      }
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
        // full-diameter endpoint; full contours are checked separately below.
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

// Native points are independently exported by Fusion, including finely sampled
// circular arcs. Sample both directions: checking vertices alone misses a
// spurious straight bridge across a native corner or arc.
function directedContourDistance(a: number[][], b: number[][]) {
  let worst = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!, q = a[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) / 0.05));
    for (let j = 0; j <= steps; j++) {
      const x = p[0]! + (q[0]! - p[0]!) * j / steps;
      const y = p[1]! + (q[1]! - p[1]!) * j / steps;
      let best = Infinity;
      for (let k = 1; k < b.length; k++) {
        const u = b[k - 1]!, v = b[k]!;
        const dx = v[0]! - u[0]!, dy = v[1]! - u[1]!;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((x-u[0]!)*dx + (y-u[1]!)*dy) / length2)) : 0;
        best = Math.min(best, Math.hypot(x-u[0]!-t*dx, y-u[1]!-t*dy));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

const verifiedTypes = new Set(["endmill", "ball", "bullnose", "drill", "countersink", "dovetail", "facemill", "lollipop", "tap", "tapered", "threadmill"]);
describe("native Fusion tool contours", () => {
  for (const tool of imported.filter(c => verifiedTypes.has(c.mm.type!))) {
    if (!fixtures.cases.find(c => c.id === tool.id)!.referenceUsable) continue;
    it(`${tool.id}: complete physical profile matches Fusion`, () => {
      const fixture = fixtures.cases.find(c => c.id === tool.id)!;
      for (const unit of ["mm", "inch"] as const) {
        const meta = tool[unit];
        const scale = toolUnitsPerMillimeter(unit);
        const actual = buildToolProfile(meta.D, meta.oal!, meta, scale).pts.map(p => [p.x / scale, p.y / scale]);
        // Lines: SVG rounding only. Curves retain the renderer's tessellation
        // error (R4 ball's 12 chords give <0.009 mm); this is not CAM tolerance.
        // Larger taper radii have six significant digits in Fusion's SVG
        // (e.g. 11.5023), so their coordinate rounding alone can reach 0.00005.
        const tolerance = fixture.nativeSVG.includes("A") ? 0.01 : meta.type === "tapered" ? 0.0001 : 0.00001;
        expect(directedContourDistance(actual, fixture.nativePoints)).toBeLessThan(tolerance);
        expect(directedContourDistance(fixture.nativePoints, actual)).toBeLessThan(tolerance);
        for (let i = 1; i < actual.length; i++) {
          expect(actual[i]![1]! + 1e-10).toBeGreaterThanOrEqual(actual[i-1]![1]!);
        }
      }
    });
  }

  it("holder and insertion metadata do not change the physical tool", () => {
    for (const tool of imported.filter(c => verifiedTypes.has(c.mm.type!))) {
      const meta = tool.mm;
      const changed = { ...meta, body_length: 10, assembly_gauge_length: 150,
        holder_segments: [{height: 60, lower_diameter: 30, upper_diameter: 40}] };
      expectSamePoints(buildToolProfile(meta.D, 42.3, meta).pts,
        buildToolProfile(meta.D, 44.1, changed).pts);
    }
  });
});

describe("taper and thread profile semantics", () => {
  it("uses NT for tooth count when LCF is independently longer", () => {
    const meta = imported.find(c => c.id === "thread-lcf-independent")!.mm;
    const { pts, fluteY } = buildToolProfile(meta.D, meta.oal!, meta);
    expect(pts.filter(p => p.x === meta.D / 2).map(p => p.y)).toEqual([0.875, 2.625, 4.375]);
    expect(fluteY).toBe(8);
  });

  it("does not invent a tooth that cannot fit within LCF", () => {
    const meta = imported.find(c => c.id === "thread-point-range")!.mm;
    expect(buildToolProfile(meta.D, meta.oal!, meta).pts.filter(p => p.y < 1.75)
      .every(p => p.x < meta.D / 2)).toBe(true);
  });

  it("tapered RE=0 retains the flat diameter DC at the tip", () => {
    for (const id of ["bare-tapered-zero-re-6", "bare-tapered-zero-re-12"]) {
      const meta = imported.find(c => c.id === id)!.mm;
      expect(buildToolProfile(meta.D, meta.oal!, meta).pts[1]!.toArray()).toEqual([3, 0]);
    }
  });

  it("retains the old thread approximation when discarded metadata is unavailable", () => {
    const meta: ToolMeta = { type: "threadmill", oal: 50, flute_length: 8, shaft_diameter: 6 };
    expect(buildToolProfile(8, 50, meta).pts.map(p => p.toArray()))
      .toEqual([[0,0],[4,0],[4,8],[3,8],[3,50],[0,50]]);
  });
});
