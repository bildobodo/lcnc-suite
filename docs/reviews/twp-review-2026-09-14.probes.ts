// Diagnostic counterexamples for twp-review-2026-09-14.md, reviewed at 1aa0730.
// Fix wave (2026-09-14/15): after TWP-06/07 the tool-change and interleaving
// observations flip (smallToLargeHits 1, interleavedMainHits 1, restored
// true, actualFallbackHits 0).
// Offline only: imports pure preview/collision modules; no gateway or motion.
// Build/run instructions are in the companion Markdown report.
// These print observations, not passing regression assertions. The reviewed
// defects should change these observations after fixes; preserve the fixtures.
import * as THREE from 'three';
import { decodePreviewStreams } from 'reviewed-ui/previewDecode';
import { twpPoseStale, twpPoseOriented } from 'reviewed-ui/twpPose';
import { buildCollisionModel, sweepCollisions, sweepCollisionsIter, toolCylinderPositions } from 'reviewed-ui/viewer/collision';
import { emptyLineIndex } from 'reviewed-ui/viewer/lineIndex';
import { mergeEntryResult } from 'reviewed-ui/viewer/sweepMerge';
// TWP-05 and TWP-04: event saturation and the available orientation inputs.
const report: Record<string, unknown> = {};
const events = Array.from({ length: 257 }, (_, i) => i);
const dec = decodePreviewStreams({ rapid: new Float32Array(3).buffer, rapid_seq: new Uint8Array(new Uint32Array([999]).buffer), kins_frames: events.map(i => [i, 0, i, 0]), wcs_frames: events.map(i => [i, 1, 0, 0, ...Array(12).fill(0)]), tlo_events: events.map(i => [i, 0, 0, i, 1]) });
report.events257 = { expectedIndex: 256, frame: dec.rapid.frame?.[0], wcs: dec.rapid.wcs?.[0], tlo: dec.rapid.tlo?.[0] };
report.orientation = { poseA: 0, liveA: 0, defined: true, oriented: twpPoseOriented(0, true), stale: twpPoseStale(0, 0, true), note: 'B/C are absent from these predicates' };
// Synthetic identity-kinematics fixture: tool approaches a fixed vise.
// The same sweep engine is used for the TWP model. No machine is connected.
const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };
const machine = { groups: [{ id: 'table', parent: 'root' }, { id: 'part', parent: 'table' }, { id: 'head', parent: 'root' }], kinematics: [{ group: 'head', joint: 0, type: 'translate', direction: 'x', sign: 1 }], workGroup: 'part', toolGroup: 'head', unitScale: 1, axes: ['X', 'Y', 'Z'] };
function cube(size: number) { const g = new THREE.BoxGeometry(size, size, size).toNonIndexed(); const p = new Float32Array(g.getAttribute('position').array); g.dispose(); return p; }
const makeModel = () => buildCollisionModel(machine as any, [{ id: 'vise', group: 'table', positions: cube(2), translate: [0, 0, 1] }, { id: 'tool', group: 'head', positions: toolCylinderPositions(2, 2), tool: true }]);
function track(n = 2) { return { pos: new Float32Array(Array.from({ length: n }, (_, i) => [20 - 15 * i / (n - 1), 0, 0]).flat()), abc: new Float32Array(n * 3), lines: new Uint32Array(Array.from({ length: n }, (_, i) => i + 1)), rapid: new Uint8Array(n).fill(1), cum: new Float32Array(Array.from({ length: n }, (_, i) => 15 * i / (n - 1))), count: n, tlo: new Uint8Array(n), lineIndex: emptyLineIndex(), timeBased: false }; }
const opts = (tool: number) => ({ margin: .1, tloEvents: [{ seq: 0, xyz: [0, 0, 0], tool }], toolDims: { 1: { diam: 20, len: 2 }, 2: { diam: 2, len: 2 } }, liveTool: 2 });
const finish = (it: any) => { let step = it.next(); while (!step.done)
    step = it.next(); return step.value; };
const commonOpts = { ...opts(1), tloEvents: [{ seq: 0, xyz: [0, 0, 0], tool: 2 }, { seq: 1, xyz: [0, 0, 0], tool: 1 }] };
// TWP-06: install the larger tool before the approach reaches contact.
const mainTrack = track(40);
mainTrack.tlo.fill(1, 5);
const changed = sweepCollisions(makeModel(), mainTrack, wcs, commonOpts);
const expected = sweepCollisions(makeModel(), track(), wcs, opts(1));
report.toolChangeCertificates = { smallToLargeHits: changed.hits.length, largeToolOnlyHits: expected.hits.length };
// TWP-07: suspend the main run, then let the side run change the shared
// body. Both runs use exactly the same tool table/event list.
const shared = makeModel();
const originalToolGeometry = shared.bodies.find(b => b.id === 'tool')!.geom;
const largeTrack = track();
largeTrack.tlo.fill(1);
const main = sweepCollisionsIter(shared, largeTrack, wcs, commonOpts);
main.next();
const side = sweepCollisionsIter(shared, track(), wcs, commonOpts);
side.next();
const mixed = finish(main);
finish(side);
report.interleavedTools = { standaloneMainHits: expected.hits.length, interleavedMainHits: mixed.hits.length, standalone: expected.hits.map(h => ({ a: h.a, b: h.b, dist: h.dist })), interleaved: mixed.hits };
// Comments follow-up: a side iterator can capture the main iterator's
// temporary large tool as its base. Correcting the cache and checkpoint
// alone still leaves that geometry installed after both runs finish.
report.residentToolAfterInterleaving = {
    restoredOriginalGeometry: shared.bodies.find(b => b.id === 'tool')!.geom === originalToolGeometry,
    expectedFallbackHits: sweepCollisions(makeModel(), track(), wcs, { margin: .1 }).hits.length,
    actualFallbackHits: sweepCollisions(shared, track(), wcs, { margin: .1 }).hits.length,
};
// TWP-11: initialization work before the first checkpoint.
const big = track(100000);
const prescreen = sweepCollisionsIter(makeModel(), big, wcs, opts(2));
const start = performance.now();
prescreen.next();
report.initialCheckpoint = { points: big.count, elapsedMs: Math.round(performance.now() - start), declaredYieldMs: 8 };
finish(prescreen);
// TWP-12: an incomplete entry must survive a merge with a complete base.
const clear = { hits: [], staticContacts: [], samples: 0, coarsened: false, uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null };
// Fix wave: mergeEntryResult takes the base length too (TWP-12) and reports a merged-axis prefix.
report.entryTruncation = (mergeEntryResult as any)({ ...clear, truncated: { covered: .25, reason: 'samples' } }, clear, 10, 90).truncated;
console.log(JSON.stringify(report, null, 2));
