import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ContactStore, GAP_UNDECIDABLE } from './contactStore';
import { buildContactView, undecidableStretchesSteps } from './contactView';
import { runToEnd, STEP_OPS, withMeter } from './steps';

const out = process.env.R170_OUT!;
const names = () => ({ a: 'spindle', b: 'stock' });
function make(g: number, spans: number[][]) {
  const st = new ContactStore(1, g);
  for (const [start, end] of spans) st.gaps.append({ pair: 0, start, end, reason: GAP_UNDECIDABLE });
  return st;
}
function view(old: number[][], cur: number[][], coverage = 10, ownCoverage = coverage) {
  return buildContactView({ sources: [{ held: [make(0, old)], stores: [make(1, cur)],
    heldCoverage: [coverage], ownCoverage, at: x => x }], pairName: names, coverage });
}

it('R170: a smaller new undecidable gap cannot erase the earlier uncertainty on either side', () => {
  // The replacement run has only reached 5: it cannot have resolved the
  // earlier uncertainty on (5, 9], regardless of its answers before 5.
  const v = view([[1, 9]], [[4, 5]], 10, 5);
  const got = runToEnd(undecidableStretchesSteps(v));
  writeFileSync(out + '/uncertainty-union.json', JSON.stringify({ held: [1, 9], heldCoverage: 10,
    current: [4, 5], currentCoverage: 5, got }, null, 2) + '\n');
  expect(got).toEqual([{ a: 'spindle', b: 'stock', spans: [[1, 9]], more: false }]);
});

it('R170: overlapping held gaps retain their whole extent even with an empty replacement run', () => {
  const v = view([[1, 3], [2, 9]], []);
  const got = runToEnd(undecidableStretchesSteps(v));
  writeFileSync(out + '/held-gap-union.json', JSON.stringify({ held: [[1, 3], [2, 9]], current: [], got }, null, 2) + '\n');
  expect(got).toEqual([{ a: 'spindle', b: 'stock', spans: [[1, 9]], more: false }]);
});

it('R170: deriving notes cannot compare the whole gap table within one publisher step', () => {
  const measurements: unknown[] = [];
  let worst = 0;
  for (const n of [1024, 8192]) {
    const old = Array.from({ length: n }, (_, i) => [4 * i + 2, 4 * i + 2.5]);
    const cur = Array.from({ length: n }, (_, i) => [4 * i, 4 * i + 0.5]);
    const v = view(old, cur, 4 * n + 1), job = undecidableStretchesSteps(v);
    const origSome = Array.prototype.some, origSort = Array.prototype.sort, origPush = Array.prototype.push;
    let comparisons = 0, maxComparisons = 0, longestArray = 0, largestSort = 0, maxMs = 0, steps = 0;
    const meter = { bytes: 0 };
    Array.prototype.some = function (f, thisArg) {
      return origSome.call(this, (x, i, a) => { comparisons++; return f.call(thisArg, x, i, a); });
    };
    Array.prototype.sort = function (f) { largestSort = Math.max(largestSort, this.length); return origSort.call(this, f); };
    Array.prototype.push = function (...items) { const n = origPush.apply(this, items); longestArray = Math.max(longestArray, n); return n; };
    let result;
    try {
      for (;;) {
        comparisons = 0;
        const t = performance.now();
        const r = withMeter(meter, () => job.next());
        maxMs = Math.max(maxMs, performance.now() - t);
        maxComparisons = Math.max(maxComparisons, comparisons); steps++;
        if (r.done) { result = r.value; break; }
      }
    } finally { Array.prototype.some = origSome; Array.prototype.sort = origSort; Array.prototype.push = origPush; }
    measurements.push({ gapsPerGeneration: n, steps, maxComparisons, largestSort, longestArray,
      maxStepMs: maxMs, meteredBytes: meter.bytes, result });
    worst = Math.max(worst, maxComparisons);
  }
  writeFileSync(out + '/gap-cost.json', JSON.stringify(measurements, null, 2) + '\n');
  expect(worst, 'comparisons between yields must stay bounded by the step contract').toBeLessThanOrEqual(2 * STEP_OPS);
});
