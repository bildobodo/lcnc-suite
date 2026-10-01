// Copy into an archive's lcnc-webui/src/viewer/r55.consumer-probe.test.ts.
// Run with the sibling r55 vitest config and native-probe.json in ../evidence.
import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { decodePreviewStreams } from "../previewDecode";
import { buildScrubTrack } from "./scrubTrack";
import { transformToPartFrame, liftToJoints, wcsTerms, tipWcs, type PartFrameMachine } from "./partFrame";
import { tloForIndex } from "./tloEvents";
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from "./collision";

const evidence = JSON.parse(readFileSync("../evidence/viewer-palette-fest.r55.native-probe.json", "utf8"));
const pair = evidence.cases.find((r: any) => r.case === "g53_same_machine");
const machine: PartFrameMachine & CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
  kinematics: [
    { group: "head", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 1, type: "translate", direction: "y", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
function decode(run: any) {
  const payload = Object.fromEntries(Object.entries(run.payload).map(([k, v]: [string, any]) =>
    [k, v && v.bytes_b64 != null ? Uint8Array.from(Buffer.from(v.bytes_b64, "base64")) : v]));
  const d = decodePreviewStreams(payload);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents)!;
  // Each payload gets ITS proposed immutable tlo_start as resolver fallback.
  // Current resolver takes this fallback through wcs.tool. No live state is read.
  const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0, tool: run.seed };
  const joints: number[][] = [];
  for (let i = 0; i < track.count; i++) {
    const j: number[] = [];
    liftToJoints(...Array.from(track.pos.slice(3*i, 3*i+3)) as [number, number, number],
      0, 0, 0, wcsTerms(tipWcs(wcs)), tloForIndex(track.tlo?.[i], track.tloEvents, run.seed), j);
    joints.push(j);
  }
  const path = transformToPartFrame(machine, wcs, { ...track, tloEvents: d.tloEvents });
  const box = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const positions = new Float32Array(box.getAttribute("position").array);
  box.dispose();
  // Cylinder dimensions match the synthetic T1 table: diameter 6, length 10.
  const model = buildCollisionModel(machine, [
    { id: "fixture", group: "table", positions, translate: [5, 0, -5] },
    { id: "tool", group: "head", positions: toolCylinderPositions(6, 10), tool: true },
  ]);
  const collisions = sweepCollisions(model, track, wcs, { margin: 0.1, tloEvents: d.tloEvents });
  return { seed: run.seed, joints, path: Array.from(path.pos), collisions: collisions.hits };
}
const rows = pair.runs.map(decode);

it("equal machine points and every other wire field still yield different displayed paths", () => {
  expect(pair.raw_payload_differing_fields).toEqual(["rapid"]);
  expect(rows[0].joints).toEqual(rows[1].joints);
  expect(rows[0].path.slice(0, 6)).toEqual([0, 0, -10, 10, 0, -10]);
  expect(rows[1].path.slice(0, 6)).toEqual([0, 0, -20, 10, 0, -20]);
});

it("equal machine points do not preserve the collision sweep", () => {
  expect(rows[0].collisions.length).toBeGreaterThan(0);
  expect(rows[1].collisions).toEqual([]);
  writeFileSync("../evidence/viewer-palette-fest.r55.consumer-probe.json", JSON.stringify({
    commit: evidence.commit, method: "Actual preview decode, scrub, part-frame and collision functions; " +
      "synthetic XYZ machine, native payload pair, each seed supplied as tlo_start resolver fallback.", rows,
  }, null, 2) + "\n");
});
