// Offline observations at feat/twp 584083b. No gateway or controller access.
// Bundle with aliases reviewed-ui=<checkout>/lcnc-webui/src and
// three=<checkout>/lcnc-webui/node_modules/three; output outside the app.
// Optional --timing measures only initialization and immediately aborts.
import * as THREE from 'three';
import { buildCollisionModel, sweepCollisions, sweepCollisionsIter, toolCylinderPositions,
    type CollisionMachine, type CollisionTrack } from 'reviewed-ui/viewer/collision';
import { buildScrubTrack } from 'reviewed-ui/viewer/scrubTrack';

const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };
const machine: CollisionMachine = {
    groups: [{ id: 'table', parent: 'root' }, { id: 'part', parent: 'table' }, { id: 'head', parent: 'root' }],
    kinematics: [{ group: 'head', joint: 0, type: 'translate', direction: 'x', sign: 1 }],
    workGroup: 'part', toolGroup: 'head', unitScale: 1, axes: ['X', 'Y', 'Z'],
};
function cube(size: number) {
    const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
    const p = new Float32Array(g.getAttribute('position').array); g.dispose(); return p;
}
function makeModel(spec: CollisionMachine = machine) {
    return buildCollisionModel(spec, [
        { id: 'vise', group: 'table', positions: cube(2), translate: [0, 0, 1] },
        { id: 'tool', group: 'head', positions: toolCylinderPositions(2, 2), tool: true },
    ]);
}
function track(xs: number[], brk?: number[]): CollisionTrack {
    const n = xs.length;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + (brk?.[i] ? 0 : Math.abs(xs[i]! - xs[i - 1]!));
    return { pos: new Float32Array(xs.flatMap(x => [x, 0, 0])), abc: new Float32Array(n * 3),
        count: n, lines: Uint32Array.from(xs.map((_, i) => i + 1)),
        rapid: new Uint8Array(n).fill(1), cum, ...(brk ? { brk: new Uint8Array(brk) } : {}) };
}
const report: Record<string, unknown> = {};
// Use the real stream merger: unknown-start becomes brk, exactly as the
// ThreeViewer request then forwards it to the collision worker.
const points = track([20, 19, 5, 0]);
const merged = buildScrubTrack({ pos: new Float32Array() }, {
    pos: points.pos, abc: points.abc, lines: points.lines,
    seq: new Uint32Array([1, 2, 3, 4]), ustart: new Uint8Array([0, 0, 1, 0]),
})!;
const gap = sweepCollisions(makeModel(), merged, wcs, { margin: .1 });
const suffix = sweepCollisions(makeModel(), track([5, 0]), wcs, { margin: .1 });
report.clearanceAcrossUnknownStart = {
    mergedBreaks: [...merged.brk!],
    combinedHits: gap.hits.length, independentSuffixHits: suffix.hits.length,
    combinedTruncated: gap.truncated, combinedUncertified: gap.uncertified,
    suffixContacts: suffix.hits.map(h => ({ a: h.a, b: h.b, dist: h.dist })),
};

if (process.argv.includes('--timing')) {
    // Identical cheap bodies, but real TWP model selection at each vertex.
    // This isolates work BEFORE the new joint-range-scan checkpoints.
    const twp: CollisionMachine = { ...machine, axes: ['X', 'Y', 'Z', 'A', 'B', 'C'],
        kins: { type: 'xyzacb-trsrn', module: 'xyzacb_trsrn', identity_first: false,
            trsrn: { yPivot: 50, zPivot: 120, xOffset: 0, yOffset: 0, yRotAxis: -1000, zRotAxis: -2000, nutAngle: 55 } } };
    const rows = [];
    for (const n of [100000, 1000000]) {
        const t = track(Array.from({ length: n }, (_, i) => 20 + i * .001));
        t.mode = new Uint8Array(n).fill(2);
        t.frame = new Uint32Array(n);
        t.frames = [[0, 0, 0]];
        for (let repeat = 0; repeat < 2; repeat++) {
            const model = makeModel(twp);
            const it = sweepCollisionsIter(model, t, wcs, { margin: .1, yieldMs: 8 });
            const start = performance.now();
            const first = it.next();
            const elapsedMs = performance.now() - start;
            const stopped = it.next(true);
            rows.push({ points: n, repeat, elapsedMs: Math.round(elapsedMs),
                firstYield: first.value, abortFinished: stopped.done });
        }
    }
    report.twpInitialization = rows;
}
console.log(JSON.stringify(report, null, 2));
