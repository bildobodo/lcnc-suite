/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fixtures from "../../test-fixtures/fusion-tool-holders.json";
import { buildHolderGeometry, buildToolProfile, type ToolMeta } from "./toolGeometry";
import { nominalHolderBase } from "./toolHolder";

type Tool = ToolMeta & { D: number; Z: number };
// Exercise the real importer, persisted whitelist, and table merge. Signed
// measurements deliberately differ from every nominal dimension in the input.
const imported = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from fusion_import import parse_fusion_library
from tool_table import _TOOL_META_FIELDS, _merge_tool_data
from tool_store import ToolLibraryStore
from pathlib import Path
from tempfile import TemporaryDirectory
result=[]
for case in json.load(sys.stdin)['cases']:
    pair=[]
    for unit in ('mm','in'):
        tool=parse_fusion_library({'data':[case['raw']]},unit)[0][0]
        key=str(tool['T'])
        with TemporaryDirectory() as directory:
            store=ToolLibraryStore(Path(directory)/'library.json',lambda:'/test.ini')
            store.save({key:{k:tool[k] for k in _TOOL_META_FIELDS if k in tool}})
            pair.append(_merge_tool_data([dict(T=tool['T'],P=7,Z=-42.3,D=tool['D'])],store.load())[0])
    result.append(pair)
print(json.dumps(result))
`], { cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)),
  input: JSON.stringify(fixtures), encoding: "utf8" })) as [Tool, Tool][];

function nativeHalf(svg: string): number[][] {
  const pts = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  return pts.slice(0, pts.findIndex(p => p[0]! < 0));
}

describe("nominal Fusion holder assembly", () => {
  for (const [i, fixture] of fixtures.cases.entries()) {
    it(`${fixture.id}: persisted mm/in profiles match the native holder SVG at LB`, () => {
      for (const [j, scale] of [1, 1 / 25.4].entries()) {
        const meta = imported[i]![j]!;
        const base = nominalHolderBase(meta)!;
        expect(base / scale).toBeCloseTo(fixture.raw.geometry.LB, 8);
        const geom = buildHolderGeometry(meta.holder_segments!, base)!;
        // Adjacent equal-radius segments can be joined by the native exporter.
        const expected = nativeHalf(fixture.reference.holderSVG);
        const actual = geom.parameters.points.map(p => [p.x / scale, p.y / scale]);
        for (const p of expected) {
          expect(Math.min(...actual.map(q => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!)))).toBeLessThan(0.00001);
        }
        for (const p of actual) expect(distanceToPolyline(p, expected)).toBeLessThan(0.00001);
        geom.computeBoundingBox();
        expect(geom.boundingBox!.min.z / scale).toBeCloseTo(fixture.raw.geometry.LB, 5);
        expect(geom.boundingBox!.max.z / scale).toBeCloseTo(fixture.raw.geometry.LB + 50, 5);
        expect(meta.Z).toBe(-42.3);
        expect(meta.holder_gauge_length! / scale).toBeCloseTo(fixture.raw.holder.gaugeLength, 8);
        geom.dispose();
      }
    });
  }

  it("changing insertion moves the nominal holder but never stretches the tool", () => {
    const meta = imported[0]![0];
    const other = { ...meta, body_length: 40, Z: 53.1, assembly_gauge_length: 300, holder_gauge_length: 20 };
    expect(buildToolProfile(meta.D, 42.3, meta).pts).toEqual(buildToolProfile(meta.D, 53.1, other).pts);
    expect(nominalHolderBase(other)).toBe(40);
    const geom = buildHolderGeometry(other.holder_segments!, nominalHolderBase(other)!)!;
    geom.computeBoundingBox();
    // A shorter gauge length must not remove upper physical segments.
    expect(geom.boundingBox!.max.z).toBeCloseTo(90);
    geom.dispose();
  });

  it("never guesses a missing placement from OAL, assembly length or measured Z", () => {
    const meta = imported[0]![0];
    for (const body_length of [undefined, null, NaN, Infinity, -1]) {
      expect(nominalHolderBase({ ...meta, body_length })).toBeNull();
    }
    expect(nominalHolderBase({ ...meta, body_length: 0 })).toBe(0);
    expect(nominalHolderBase({ ...meta, holder_segments: [] })).toBeNull();
    expect(nominalHolderBase(null)).toBeNull();
    for (const bad of [{ height: 0 }, { height: -1 }, { height: Infinity },
      { lower_diameter: -1 }, { upper_diameter: NaN }]) {
      const segments = [{ height: 10, lower_diameter: 20, upper_diameter: 30, ...bad }];
      expect(nominalHolderBase({ ...meta, holder_segments: segments })).toBeNull();
      expect(buildHolderGeometry(segments, 30)).toBeNull();
    }
  });

  it("matches the independently scaled native simulation silhouette", () => {
    const reference = fixtures.simulation;
    const png = readFileSync(new URL(`../../test-fixtures/${reference.image}`, import.meta.url));
    expect(createHash("sha256").update(png).digest("hex")).toBe(reference.sha256);
    expect(png.readUInt32BE(16)).toBe(2400);
    expect(png.readUInt32BE(20) / (Number(reference.camera.extents[2]) * 10)).toBe(reference.pixelsPerMm);
    expect(reference.stockWidthPixels / reference.pixelsPerMm).toBe(reference.stockWidthMm);
    const index = fixtures.cases.findIndex(c => c.id === reference.case);
    const meta = imported[index]![0];
    const geom = buildHolderGeometry(meta.holder_segments!, nominalHolderBase(meta)!)!;
    const outline = geom.parameters.points.slice(1, -1).map(p => [p.x, p.y]);
    for (const p of reference.rightEdgeMm) expect(distanceToPolyline(p, outline)).toBeLessThan(reference.toleranceMm);
    for (const p of outline) expect(distanceToPolyline(p, reference.rightEdgeMm)).toBeLessThan(reference.toleranceMm);
    geom.dispose();
  });
});

function distanceToPolyline(p: number[], points: number[][]): number {
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / len2)) : 0;
    min = Math.min(min, Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy));
  }
  return min;
}
