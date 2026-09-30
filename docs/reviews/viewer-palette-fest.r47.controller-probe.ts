// Part B (operator 2026-09-29, Codex R38/R39): every path line at PATH_PX as
// a screen-space line. The packing, and the EQUIVALENCE with the previous GL
// lines — the fat lines draw exactly the pairs the GL index ranges drew, per
// chunk and LOD level, the overlays and the finding's reveal included — plus
// the materials, the rapid's dash distances, the culling margin, the line-
// mode switch and the memory ledger.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { TOOLPATH_BOX_DASH_PX } from "./boxLines";
import { ref } from "vue";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { disposeObject } from "./disposal";
import { fatGeometry, packPairs, PATH_PX } from "./fatPaths";
import { createToolpathController, LIMIT_OVERLAY_RENDER_ORDER, type PathLineMode, type ToolpathCtx } from "./toolpathController";

function program() {
  const feed: number[] = [];
  for (let r = 0; r < 12; r++) for (let c = 0; c <= 10; c++) feed.push((r % 2 ? 10 - c : c) * 20, r * 15, 0);
  const nF = feed.length / 3;
  const rapid = [0, 0, 50, 0, 0, 2, 200, 165, 50, 200, 165, 2, 0, 0, 50];
  const nR = rapid.length / 3;
  const rapidDist = new Float32Array(nR);
  for (let i = 1; i < nR; i++) rapidDist[i] = rapidDist[i - 1]! + Math.hypot(rapid[i * 3]! - rapid[i * 3 - 3]!, rapid[i * 3 + 1]! - rapid[i * 3 - 2]!, rapid[i * 3 + 2]! - rapid[i * 3 - 1]!);
  const coarse: number[] = [];
  for (let r = 0; r < 12; r++) { coarse.push(r * 11, r * 11 + 10); if (r < 11) coarse.push(r * 11 + 10, r * 11 + 11); }
  const feedOutside = new Uint8Array(nF);
  // flagged: the segments ending at X 120..160 on the upper rows — INSIDE the
  // coarse level's row chords (X 0 → 200), never at their ends
  for (let i = 0; i < nF; i++) feedOutside[i] = feed[i * 3]! >= 120 && feed[i * 3]! <= 160 && feed[i * 3 + 1]! > 90 ? 1 : 0;
  return {
    feedPos: new Float32Array(feed), rapidPos: new Float32Array(rapid), rapidDist,
    feedBreaks: new Uint32Array([0, 66]),
    feedLod: [new Uint32Array(coarse)], lodTols: [0.01],
    feedOutside, rapidOutside: new Uint8Array([0, 0, 1, 1, 0]),
    feedSrc: Uint32Array.from({ length: nF }, (_, i) => i), rapidSrc: Uint32Array.from({ length: nR }, (_, i) => 1000 + i),
    bounds: { min: [0, 0, 0], max: [200, 165, 50] },
  } as any;
}

function build(mode: PathLineMode) {
  const ctx = {
    scene: new THREE.Scene(), workOrigin: new THREE.Group(), workRotGroup: new THREE.Group(),
    pathAnchor: null, pathRot: null, roomOrigin: null, roomRotGroup: null, roomAnchor: null, roomRot: null,
    pathAlwaysOnTop: false, units: "mm",
  } as unknown as ToolpathCtx & { workRotGroup: THREE.Group };
  const c = createToolpathController({
    requestRender: vi.fn(), boundsClipPlanes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -150)], insideBoundsClipPlanes: [],
    billboardLabels: [], makeLabel: vi.fn(() => { const o = new THREE.Object3D() as any; o.dispose = vi.fn(); return o; }),
    disposeObject, colors: () => ({ feed: "#00a83c", rapid: "#3d8bff", toolpathBounds: "#15181c", boundsAlt: "#f0f2f4", limit: "#e66b00" }),
    sceneBackground: () => new THREE.Color("#ffffff"), sceneForeground: () => new THREE.Color("#000000"),
    axisCss: { x: "#f00", y: "#0f0", z: "#00f" }, overflow: ref(false), chunkCells: 8, lineMode: mode,
  });
  c.apply(ctx, program());
  return { c, ctx };
}


import { writeFileSync } from 'node:fs';
const observations: Record<string, unknown> = {};
it('R47: records real geometry replacement across ABBAAB, source capacity and actual instances', () => {
  const { c, ctx } = build('fat');
  const feed = () => ctx.workRotGroup.children.filter(o => (o as any).material?.userData?.role === 'feed');
  const replacements: unknown[] = [];
  for (const mode of ['gl', 'fat', 'fat', 'gl', 'gl', 'fat'] as const) {
    const before = feed()[0];
    c.setLineMode(mode, ctx);
    replacements.push({mode, rebuilt: before !== feed()[0]});
  }
  observations.builds = replacements;
  expect(replacements).toEqual([
    {mode:'gl', rebuilt:true}, {mode:'fat', rebuilt:true}, {mode:'fat', rebuilt:false},
    {mode:'gl', rebuilt:true}, {mode:'gl', rebuilt:false}, {mode:'fat', rebuilt:true},
  ]);
  c.setRapidsVisible(false);
  const buildByteSamples = [];
  for(let i=0;i<3;i++) {
    c.setReveal(null);
    c.setReveal({run:[1001,1003],feed:false,rapid:true});
    const m=c.pathMemory();
    buildByteSamples.push({buildBytes:m.buildBytes,cpuTotal:m.cpu.total});
  }
  observations.buildByteSamples=buildByteSamples;
  expect(buildByteSamples[2]!.cpuTotal).toBe(buildByteSamples[0]!.cpuTotal);
  expect(buildByteSamples[2]!.buildBytes).toBeGreaterThan(buildByteSamples[0]!.buildBytes);
  const large = new ArrayBuffer(1024 * 1024);
  const src = new Uint32Array(large, 0, 3); src.set([0, 1, 2]);
  c.apply(ctx, {
    feedPos: new Float32Array([0,0,0, 0,0,0, 10,0,0]), rapidPos: new Float32Array(), feedSrc: src,
    feedOutside: new Uint8Array(3), bounds: {min:[0,0,0],max:[10,0,0]},
  } as any);
  const mem = c.pathMemory();
  const actual = feed().filter(o=>o.visible).reduce((n,o)=>n+(o as any).geometry.instanceCount,0);
  observations.sourceCapacity = { backingBufferBytes:large.byteLength, viewBytes:src.byteLength, reported:mem.cpu };
  observations.instances = { reported:mem.instances, actualVisibleGeometryInstances:actual };
  expect(mem.cpu.total).toBeLessThan(large.byteLength);
  expect(mem.instances).toBeGreaterThan(actual);
  c.dispose();
  writeFileSync('../evidence/viewer-palette-fest.r47.controller-probe.json', JSON.stringify(observations,null,2)+'\n');
});
