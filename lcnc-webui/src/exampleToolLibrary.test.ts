import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Box3 } from "three";
import { buildToolGeometries, type ToolMeta } from "./toolGeometry";
import { toolPreviewNotice } from "./toolPreviewNotice";

// Exercise the shipped file through the actual decoder and persisted sidecar,
// then through both consumers: table preview and live-view metadata.
const libraries = JSON.parse(execFileSync("python3", ["-c", `
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from tool_import import decode_tool_blob, initial_z_offset
from tool_store import ToolLibraryStore
from tool_table import _merge_tool_data, tool_visual_metadata
with Path('../examples/sim_config/tool-libraries/fusion-freecad.json').open('rb') as f: raw=f.read()
result={}
for unit in ['mm','in']:
 tools,_=decode_tool_blob(raw,unit)
 with TemporaryDirectory() as d:
  store=ToolLibraryStore(Path(d)/'tools.json',lambda:'/test.ini')
  store.save({str(t['T']):t for t in tools});meta=store.load()
  result[unit]=[dict(nominalZ=initial_z_offset(t),table=_merge_tool_data([dict(T=t['T'],P=0,D=t['D'],Z=-42.3)],meta)[0],
   viewer=tool_visual_metadata(meta[str(t['T'])])) for t in tools]
print(json.dumps(result))
`], { cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)), encoding: "utf8", maxBuffer: 5e6 })) as
  Record<"mm" | "in", { nominalZ: number; table: ToolMeta & { T: number; D: number; Z: number }; viewer: ToolMeta }[]>;

describe("every bundled example renders through both tool consumers", () => {
  for (const [index, mm] of libraries.mm.entries()) {
    it(`T${mm.table.T}: finite geometry, physical length and equivalent inch geometry`, () => {
      const bounds: Box3[] = [];
      for (const unit of ["mm", "in"] as const) {
        const scale = unit === "mm" ? 1 : 1 / 25.4;
        const c = libraries[unit][index]!;
        const table = buildToolGeometries(c.table.D, 42.3, c.table, scale);
        const viewer = buildToolGeometries(c.table.D, 71, c.viewer, scale);
        const bound = new Box3();
        for (const key of ["cutter", "shaft"] as const) {
          const a = table[key], b = viewer[key];
          expect(Boolean(a)).toBe(Boolean(b));
          if (!a || !b) continue;
          const positions = a.getAttribute("position");
          expect(positions.count).toBeGreaterThan(0);
          expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
          expect(positions.array).toEqual(b.getAttribute("position").array);
          a.computeBoundingBox();
          bound.union(a.boundingBox!);
          // The working portion of ordinary Fusion cutters remains outside
          // the spindle. Form profiles include their shaft in the cutter mesh.
          if (key === 'cutter' && c.table.type !== 'formmill') {
            expect(a.boundingBox!.max.z).toBeLessThan(c.nominalZ);
          }
          a.dispose(); b.dispose();
        }
        expect(bound.isEmpty()).toBe(false);
        // No holder is modeled. Once the tip is at -Z, the tool must cross
        // the spindle face (z=0); a larger-than-OAL offset leaves it floating.
        expect(bound.max.z - c.nominalZ).toBeGreaterThan(0);
        expect(bound.min.z - c.nominalZ).toBeLessThan(0);
        bound.min.divideScalar(scale); bound.max.divideScalar(scale);
        expect(bound.min.z).toBeCloseTo(0, 4);
        expect(bound.max.z).toBeCloseTo(c.table.oal! / scale, 4);
        expect(c.table.Z).toBe(-42.3);
        const notice = toolPreviewNotice(c.viewer, scale);
        if (c.table.source_format === "freecad") expect(notice).not.toContain("generic cylinder");
        else expect(notice).toBeNull();
        bounds.push(bound);
      }
      for (const side of ["min", "max"] as const) {
        for (const axis of ["x", "y", "z"] as const) {
          expect(bounds[0]![side][axis]).toBeCloseTo(bounds[1]![side][axis], 4);
        }
      }
    });
  }
});
