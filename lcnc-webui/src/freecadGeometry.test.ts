/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildToolGeometries, type ToolMeta } from "./toolGeometry";
import { toolPreviewNotice } from "./toolPreviewNotice";

const cases = JSON.parse(execFileSync("python3", ["-c", `
import json
from pathlib import Path
from freecad_import import parse_bit,decode_freecad_blob
from tool_table import _merge_tool_data,tool_visual_metadata
from tool_store import ToolLibraryStore
from tempfile import TemporaryDirectory
with Path('../test-fixtures/freecad/native-profiles.json').open() as f: cases=json.load(f)['cases']
with Path('../test-fixtures/freecad/custom-native.json').open('rb') as f: custom=f.read()
result=[]
for unit in ['mm','in']:
 tools=[parse_bit(c['bit'],1,'oracle',unit) for c in cases]+decode_freecad_blob(custom,unit)[0]
 for tool in tools:
  with TemporaryDirectory() as d:
   store=ToolLibraryStore(Path(d)/'tools.json',lambda:'/test.ini')
   store.save({'1':tool});meta=store.load()['1']
   table=_merge_tool_data([dict(T=1,P=7,D=tool['D'],Z=-42.3)],{'1':meta})[0]
   result.append(dict(name=tool['description'],unit=unit,table=table,viewer=tool_visual_metadata(meta)))
print(json.dumps(result))
`], { cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)), encoding: "utf8", maxBuffer: 5e6 })) as {
  name: string; unit: string; table: ToolMeta & { D: number; Z: number }; viewer: ToolMeta;
}[];

describe("FreeCAD source → persisted metadata → both rendered geometries", () => {
  for (const c of cases) {
    it(`${c.name} (${c.unit}) preserves native vertices and ignores measured length`, () => {
      const unit = c.unit === "mm" ? 1 : 1 / 25.4;
      const a = buildToolGeometries(c.table.D, 42.3, c.table, unit);
      const b = buildToolGeometries(c.table.D, 71, c.viewer, unit);
      expect(a.cutter).toBeNull(); // No fabricated cutting-face classification.
      expect(b.cutter).toBeNull();
      expect(a.shaft!.getAttribute("position").array).toEqual(b.shaft!.getAttribute("position").array);
      a.shaft!.computeBoundingBox();
      expect(a.shaft!.boundingBox!.min.z).toBeCloseTo(0, 5);
      expect(a.shaft!.boundingBox!.max.z / unit).toBeCloseTo(c.table.oal! / unit, 4);
      expect(c.table.Z).toBe(-42.3);
      expect(toolPreviewNotice(c.viewer, unit)).not.toContain("generic cylinder");
      a.shaft!.dispose(); b.shaft!.dispose();
    });
  }
  it("custom mesh preserves an asymmetric offset and an axial bore", () => {
    const c = cases.find(c => c.unit === "mm" && c.table.native_mesh)!;
    const geometry = buildToolGeometries(10, 90, c.table).shaft!;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(-3);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(5);
    // A ray along the bore axis must not hit a cap that would close the hole.
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    const ray = new THREE.Raycaster(new THREE.Vector3(1, 1, -1), new THREE.Vector3(0, 0, 1));
    expect(ray.intersectObject(mesh)).toHaveLength(0);
    ray.ray.origin.set(4, 2, -1);
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
    material.dispose();
    expect(geometry.getAttribute("position").count).toBe(c.table.native_mesh!.triangles.length * 3);
    geometry.dispose();
  });
});
