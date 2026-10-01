// Copy into archive/lcnc-webui/src/viewer/r56.consumer-probe.test.ts.
// F5 plan experiment; not a product implementation. No browser/live state.
import { it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { decodePreviewStreams } from "../previewDecode";
import { buildScrubTrack, sampleTrack, type ScrubSample } from "./scrubTrack";
import { transformToPartFrame, liftToJoints, wcsTerms, tipWcs, type PartFrameMachine } from "./partFrame";
import { tloForIndex, TLO_NONE } from "./tloEvents";
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from "./collision";

const native = JSON.parse(readFileSync("../evidence/viewer-palette-fest.r56.native-probe.json", "utf8"));
const fixture = (name: string) => native.cases.find((c: any) => c.case === name);
const observations: any[] = [];
const machine: PartFrameMachine & CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
  kinematics: [
    { group: "head", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 1, type: "translate", direction: "y", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
type Strip = "all-matching" | "none" | "leading-carry";
function prepare(run: any, basis: number[], strip: Strip, normalize: boolean) {
  const payload = Object.fromEntries(Object.entries(run.payload).map(([k, v]: [string, any]) =>
    [k, v && v.bytes_b64 != null ? Uint8Array.from(Buffer.from(v.bytes_b64, "base64")) : structuredClone(v)]));
  const rows: number[][] = payload.tlo_events ?? [];
  const seedRow = (r: number[]) => r[0] === 0 && r.slice(1, 4).every((v, i) => v === run.seed[i]);
  if (strip === "all-matching") payload.tlo_events = rows.filter(r => !seedRow(r));
  // Narrow candidate: ONLY the leading inherited-tool carry may be elided.
  if (strip === "leading-carry") payload.tlo_events = rows.filter((r, i) => !(i === 0 && seedRow(r) && r[4] === -1));
  if (payload.tlo_events?.length === 0) delete payload.tlo_events;
  const d = decodePreviewStreams(payload);
  if (normalize) for (const stream of [d.feed, d.rapid]) {
    for (let i = 0; i < stream.pos.length / 3; i++) {
      if (stream.tlo?.[i] != null && stream.tlo[i] !== TLO_NONE) continue;
      for (let axis = 0; axis < 3; axis++) stream.pos[3*i+axis] += run.seed[axis] - basis[axis];
    }
  }
  return { payload, d };
}
function consume(run: any, basis: number[], strip: Strip = "all-matching", normalize = true) {
  const { payload, d } = prepare(run, basis, strip, normalize);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents)!;
  const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0, tool: basis };
  const joints: number[][] = [];
  for (let i = 0; i < track.count; i++) {
    const j: number[] = [];
    liftToJoints(...Array.from(track.pos.slice(3*i, 3*i+3)) as [number, number, number],
      0, 0, 0, wcsTerms(tipWcs(wcs)), tloForIndex(track.tlo?.[i], track.tloEvents, basis), j);
    joints.push(j);
  }
  const path = transformToPartFrame(machine, wcs, { ...track, tloEvents: d.tloEvents });
  const box = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const positions = new Float32Array(box.getAttribute("position").array); box.dispose();
  const model = buildCollisionModel(machine, [
    { id: "fixture", group: "table", positions, translate: [5, 0, -5] },
    { id: "tool", group: "head", positions: toolCylinderPositions(6, 10), tool: true },
  ]);
  const collisions = sweepCollisions(model, track, wcs, { margin: 0.1, tloEvents: d.tloEvents });
  const samples = [0, track.cum[1]! / 2, track.cum[track.count - 1]!].map(s => {
    const v = sampleTrack(track, s, {} as ScrubSample);
    const j: number[] = [];
    liftToJoints(v.px, v.py, v.pz, v.pa, v.pb, v.pc, wcsTerms(tipWcs(wcs)), v.tlo?.xyz ?? basis, j);
    return { s, v, joints: j };
  });
  const { feed: _f, rapid: _r, ...otherFields } = payload;
  return { basis, otherFields, decoded: d, track, samples, joints, path: Array.from(path.pos), collisions: collisions.hits };
}

for (const name of ["g53_same_machine", "percent_g53"]) {
  for (const [from, to] of [[0, 1], [1, 0]]) {
    it(`${name}: normalized old equals fresh for every tested consumer, ${from} -> ${to}`, () => {
      const runs = fixture(name).runs;
      const oldRaw = JSON.stringify(runs[from]);
      const normalized = consume(runs[from], runs[to].seed);
      const fresh = consume(runs[to], runs[to].seed);
      expect(normalized).toEqual(fresh);
      expect(JSON.stringify(runs[from])).toBe(oldRaw);
      observations.push({ case: name, from: runs[from].seed, to: runs[to].seed,
        equal: true, path: normalized.path, collisions: normalized.collisions });
    });
  }
}

it("negative control: retaining the old basis misses the collision at basis 10", () => {
  const [at10, at20] = fixture("g53_same_machine").runs;
  const retained = consume(at20, at20.seed);
  const fresh = consume(at10, at10.seed);
  expect(retained.collisions).toEqual([]);
  expect(fresh.collisions.length).toBeGreaterThan(0);
});

it("round trip always derives from the immutable original payload", () => {
  const [at10, at20] = fixture("g53_same_machine").runs;
  consume(at20, at10.seed);
  expect(consume(at20, at20.seed)).toEqual(consume(at20, at20.seed, "none", false));
});

it("G49 before motion is a same-result control", () => {
  const [a, b] = fixture("g49_first").runs;
  expect(consume(a, b.seed)).toEqual(consume(b, b.seed));
});

for (const name of ["absolute_g43_seed", "absolute_g49_seed"]) {
  it(`${name}: byte-exact event comparison prevents __SAME__ when a coincident explicit event was removed`, () => {
    const [a, b] = fixture(name).runs;
    expect(consume(a, b.seed).otherFields).not.toEqual(consume(b, b.seed).otherFields);
  });
}

it("counterexample: filtering every matching seq-0 row resurrects the preceding G49", () => {
  const run = fixture("g49_then_restore_seed").runs[0]; // start 10
  const reference = consume(run, run.seed, "none", false);
  const broad = consume(run, run.seed, "all-matching");
  const narrow = consume(run, run.seed, "leading-carry");
  expect(run.payload.tlo_events).toEqual([[0, 0, 0, 0, -1], [0, 0, 0, 10, -1]]);
  expect(reference.joints[0]![2]).toBe(10);
  expect(broad.joints[0]![2]).toBe(0);
  expect(narrow).toEqual(reference);
  observations.push({ case: "g49_then_restore_seed", seed: run.seed,
    originalRows: run.payload.tlo_events, broadRows: broad.otherFields.tlo_events,
    trueNativeMachinePoints: run.canon.rapid_m, referenceJoints: reference.joints,
    broadJoints: broad.joints, leadingCarryOnlyJoints: narrow.joints });
});

afterAll(() => writeFileSync("../evidence/viewer-palette-fest.r56.consumer-probe.json", JSON.stringify({
  commit: native.commit,
  method: "F5 normalization and seq-0 rules modeled in probe; existing product decoder/scrub/part-frame/sweep unchanged. " +
    "Broad seq-0 interpretation and narrower leading-carry alternative explicitly distinguished; no product implementation exists.",
  observations,
}, null, 2) + "\n"));
