/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import unverified from "../../test-fixtures/fusion-tool-unverified.json";
import verified from "../../test-fixtures/fusion-tool-followup.json";
import simulation from "../../test-fixtures/fusion-tool-followup-simulation/native-silhouettes.json";
import { buildToolProfile, type ToolMeta } from "./toolGeometry";
import { toolPreviewNotice } from "./toolPreviewNotice";

const fixtures = [...unverified.cases, ...verified.cases, ...simulation.cases];
const tools = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from fusion_import import parse_fusion_library
print(json.dumps([parse_fusion_library({'data': [c['raw']]}, 'mm')[0][0] for c in json.load(sys.stdin)]))
`], {
  cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)),
  input: JSON.stringify(fixtures), encoding: "utf8",
})) as (ToolMeta & { D: number; oal: number })[];

describe("honest tool preview coverage", () => {
  unverified.cases.forEach((fixture, i) => {
    it(`${fixture.id}: identifies the unverified native geometry`, () => {
      expect(toolPreviewNotice(tools[i])).not.toBeNull();
    });
  });

  it("does not mark the new native-contour cases as generic approximations", () => {
    for (const tool of tools.slice(unverified.cases.length)) expect(toolPreviewNotice(tool)).toBeNull();
  });

  it("identifies stale face, corner-chamfer and thread sidecars", () => {
    expect(toolPreviewNotice({ type: "facemill", taper_angle: 30 })).toContain("incomplete");
    expect(toolPreviewNotice({ type: "cornerchamfer" })).toContain("incomplete");
    expect(toolPreviewNotice({ type: "threadmill" })).toContain("incomplete");
  });

  it("identifies unsupported thread crests instead of silently claiming a match", () => {
    const meta: ToolMeta = { type: "threadmill", thread_pitch: 2, thread_profile_angle: 60,
      number_of_teeth: 3, thread_tip_type: "flat", thread_tip_width: 1.1 };
    expect(toolPreviewNotice(meta)).toContain("outside the supported range");
    expect(toolPreviewNotice({ ...meta, thread_tip_type: "round", thread_tip_radius: 1 })).not.toBeNull();
    expect(toolPreviewNotice({ ...meta, thread_profile_angle: 0 })).not.toBeNull();
  });

  it("removes the probe's self-intersection while retaining its approximation notice", () => {
    const tool = tools[unverified.cases.findIndex(c => c.id === "fu-probe-custom")]!;
    const { pts } = buildToolProfile(tool.D, tool.oal, tool);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.y).toBeGreaterThanOrEqual(pts[i - 1]!.y);
    const ballR = tool.D / 2;
    for (const p of pts.filter(p => p.y > 0 && p.y < 2 * ballR)) {
      expect(Math.hypot(p.x, p.y - ballR)).toBeCloseTo(ballR, 10);
    }
    expect(Math.max(...pts.map(p => p.y))).toBe(tool.oal);
    expect(toolPreviewNotice(tool)).toContain("native contour not verified");
  });
});
