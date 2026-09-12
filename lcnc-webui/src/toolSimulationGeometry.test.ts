/// <reference types="node" />
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import originalReference from "../../test-fixtures/fusion-tool-simulation/native-silhouettes.json";
import followupReference from "../../test-fixtures/fusion-tool-followup-simulation/native-silhouettes.json";
import { buildToolParts, buildToolProfile, type ToolMeta } from "./toolGeometry";
const reference = { cases: [
  ...originalReference.cases.map(c => ({ ...c, fixtureDirectory: "fusion-tool-simulation" })),
  ...followupReference.cases.map(c => ({ ...c, fixtureDirectory: "fusion-tool-followup-simulation" })),
] };

const imported = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from fusion_import import parse_fusion_library
cases = json.load(sys.stdin)
print(json.dumps([{unit: parse_fusion_library({'data': [c['raw']]}, unit)[0][0]
                   for unit in ['mm', 'in']} for c in cases]))
`], {
  cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)),
  input: JSON.stringify(reference.cases), encoding: "utf8",
})) as Record<"mm" | "in", ToolMeta & { D: number; oal: number }>[];

function distance(point: THREE.Vector2, line: THREE.Vector2[]) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}

function directedDistance(a: THREE.Vector2[], b: THREE.Vector2[]) {
  let worst = 0;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!, q = a[i]!;
    const steps = Math.max(1, Math.ceil(p.distanceTo(q) / 0.02));
    for (let j = 0; j <= steps; j++) {
      worst = Math.max(worst, distance(p.clone().lerp(q, j / steps), b));
    }
  }
  return worst;
}

describe("native Fusion simulation cutting silhouettes", () => {
  reference.cases.forEach((fixture, index) => {
    it(`${fixture.id}: retains original pixels and independent camera scale`, () => {
      const bytes = readFileSync(new URL(
        `../../test-fixtures/${fixture.fixtureDirectory}/${fixture.id}/native-front.png`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.screenshotSha256);
      expect(fixture.camera.type).toBe(0);
      expect(fixture.camera.up).toEqual([0, 0, 1]);
      const calibration = fixture.calibration;
      expect(Math.abs(calibration.stockWidthPx - calibration.stockWidthMm
        * calibration.pixelsPerMm)).toBeLessThan(2.1);
    });

    for (const unit of ["mm", "in"] as const) {
      it(`${fixture.id}: matches both native edges and cutting height in ${unit}`, () => {
        const scale = unit === "mm" ? 1 : 1 / 25.4;
        const tool = imported[index]![unit];
        const { cutter } = buildToolParts(tool.D, tool.oal, tool, scale);
        const rendered = cutter.map(p => p.clone().divideScalar(scale));
        // Pixel quantization and the native rotational mesh bound this test.
        // This is a screen-reference tolerance, not a machining tolerance.
        const chordError = "nativeMeridianChordErrorMm" in fixture
          ? Number(fixture.nativeMeridianChordErrorMm) : 0;
        const tolerance = Math.max(fixture.family === "thread" ? 0.04 : 0.08,
          chordError + 2 / fixture.calibration.pixelsPerMm);
        for (const side of [1, 2]) {
          const edge = [...fixture.samples].reverse().map(p => new THREE.Vector2(p[side]!, p[0]!));
          const native = [new THREE.Vector2(0, 0), new THREE.Vector2(edge[0]!.x, 0),
            ...edge, new THREE.Vector2(edge[edge.length - 1]!.x, fixture.goldHeightMm),
            new THREE.Vector2(0, fixture.goldHeightMm)];
          expect(directedDistance(native, rendered)).toBeLessThan(tolerance);
          expect(directedDistance(rendered, native)).toBeLessThan(tolerance);
        }
        expect(Math.abs(Math.max(...rendered.map(p => p.y)) - fixture.goldHeightMm))
          .toBeLessThan(tolerance);
      });
    }

    it(`${fixture.id}: measured installation and LB do not deform the physical tool`, () => {
      const tool = imported[index]!.mm;
      const first = buildToolProfile(tool.D, 42.3, tool);
      const second = buildToolProfile(tool.D, 44.1, { ...tool, body_length: 12 });
      expect(second.pts.map(p => p.toArray())).toEqual(first.pts.map(p => p.toArray()));
      expect(second.fluteY).toBe(first.fluteY);
      expect(Math.max(...first.pts.map(p => p.y))).toBeCloseTo(tool.oal, 10);
    });
  });
});
