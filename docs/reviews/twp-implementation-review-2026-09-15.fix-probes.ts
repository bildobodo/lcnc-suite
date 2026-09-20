// Companion measurements for the fixes to R-03 and R-04, written against the
// same fixtures as the review's own probes. Bundle exactly like those:
//   esbuild ... --alias:reviewed-ui=<checkout>/lcnc-webui/src --alias:three=...
// `--timing` reports collision-sweep initialization latency:
//   first     — time to the FIRST checkpoint (the review's measurement:
//               how long a cancel or pause request waits to be acknowledged)
//   toSweep   — time until the sweep reports non-zero progress, i.e. the
//               whole initialization (per-vertex passes + prescreen +
//               baseline pose) — what makes a sweep appear to start late
// Each row runs cold (a fresh model and a fresh track) and then warm.
import * as THREE from 'three';
import { buildCollisionModel, sweepCollisionsIter, toolCylinderPositions,
    type CollisionMachine, type CollisionTrack } from 'reviewed-ui/viewer/collision';

const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };
const machine: CollisionMachine = {
    groups: [{ id: 'table', parent: 'root' }, { id: 'part', parent: 'table' }, { id: 'head', parent: 'root' }],
    kinematics: [{ group: 'head', joint: 0, type: 'translate', direction: 'x', sign: 1 }],
    workGroup: 'part', toolGroup: 'head', unitScale: 1, axes: ['X', 'Y', 'Z'],
};
const twp: CollisionMachine = { ...machine, axes: ['X', 'Y', 'Z', 'A', 'B', 'C'],
    kins: { type: 'xyzacb-trsrn', module: 'xyzacb_trsrn', identity_first: false,
        trsrn: { yPivot: 50, zPivot: 120, xOffset: 0, yOffset: 0, yRotAxis: -1000, zRotAxis: -2000, nutAngle: 55 } } };
function cube(size: number) {
    const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
    const p = new Float32Array(g.getAttribute('position').array); g.dispose(); return p;
}
const makeModel = (spec: CollisionMachine) => buildCollisionModel(spec, [
    { id: 'vise', group: 'table', positions: cube(2), translate: [0, 0, 1] },
    { id: 'tool', group: 'head', positions: toolCylinderPositions(2, 2), tool: true },
]);
function twpTrack(n: number, frames: number): CollisionTrack {
    const xs = Array.from({ length: n }, (_, i) => 20 + i * .001);
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.abs(xs[i]! - xs[i - 1]!);
    const frame = new Uint32Array(n);
    // A handful of TWP frames, in runs — the shape a real plane program has.
    for (let i = 0; i < n; i++) frame[i] = Math.floor(i / Math.ceil(n / frames));
    return {
        pos: new Float32Array(xs.flatMap(x => [x, 0, 0])), abc: new Float32Array(n * 3),
        count: n, lines: Uint32Array.from(xs.map((_, i) => i + 1)),
        rapid: new Uint8Array(n).fill(1), cum,
        mode: new Uint8Array(n).fill(2), frame,
        frames: Array.from({ length: frames }, (_, k) => [k, k, k] as [number, number, number]),
    };
}
const report: Record<string, unknown> = {};
if (process.argv.includes('--timing')) {
    const rows = [];
    for (const n of [100000, 1000000]) {
        for (const frames of [1, 8]) {
            for (let repeat = 0; repeat < 2; repeat++) {
                const t = twpTrack(n, frames);
                const model = makeModel(twp);
                const it = sweepCollisionsIter(model, t, wcs, { margin: .1, yieldMs: 8 });
                const t0 = performance.now();
                const first = it.next();
                const firstMs = performance.now() - t0;
                let value = first.value, done = first.done;
                while (!done && !(typeof value === 'number' && value > 0)) {
                    const r = it.next(); value = r.value; done = !!r.done;
                }
                const toSweepMs = performance.now() - t0;
                // A mid-sweep abort yields its final progress before
                // returning (collision.ts's last `yield`), so the driver
                // pumps until done — count the calls rather than assume one.
                let calls = 1, r = it.next(true);
                while (!r.done && calls < 8) { r = it.next(); calls++; }
                rows.push({ points: n, frames, repeat,
                    first: Math.round(firstMs), toSweep: Math.round(toSweepMs),
                    abortCalls: calls, abortFinished: r.done === true });
            }
        }
    }
    report.twpInitialization = rows;
}
console.log(JSON.stringify(report, null, 2));
