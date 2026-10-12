// R139 plan counterexamples, not tests of a built package 2.
// Usage: vitest run --config vitest.review.config.ts --configLoader runner src/viewer/r139.codex-plan.test.ts
import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import { mergeContiguousIntervals } from './collision';
import { MIN_ADV } from './collisionFixtures';
const out: Record<string, unknown> = {};
it('the proposed 2e-3 merge erases a known non-touching sample', () => {
  const intervals: Array<[number, number]> = [[0, 1], [1.001, 2]];
  const freeSample = 1.0005;
  const merged = mergeContiguousIntervals(intervals);
  expect(intervals.some(([a,b]) => freeSample >= a && freeSample <= b)).toBe(false);
  expect(merged).toEqual([[0,2]]);
  expect(merged.some(([a,b]) => freeSample >= a && freeSample <= b)).toBe(true);
  out.verifiedGap = { intervals, freeSample, merged, caution: 'A plan counterexample: no new sweep is implemented here.' };
});
it('the normal oracle grid can miss a whole contact wider than MIN_ADV', () => {
  // Existing collisionOracle.test.ts: STEP=0.5, s starts at STEP/2.
  const step = 0.5, interval: [number, number] = [0.35, 0.65];
  const coarse = Array.from({length: 4}, (_,i) => step / 2 + i * step);
  const fine = Array.from({length: 8}, (_,i) => MIN_ADV / 2 + i * MIN_ADV);
  const inContact = (s: number) => s >= interval[0] && s <= interval[1];
  expect(interval[1] - interval[0]).toBeGreaterThan(MIN_ADV);
  expect(coarse.some(inContact)).toBe(false);
  expect(fine.some(inContact)).toBe(true);
  out.oracleGrid = {step, MIN_ADV, interval, width: interval[1]-interval[0], coarse, coarseFinds: coarse.filter(inContact), fineFinds: fine.filter(inContact), caution:'An analytic sampling limit, not a demonstrated product miss.'};
});
it('a fixed table size does not bound repeated in-flight updates', () => {
  const episodes = 65536, intervals = 262144;
  const holder = episodes * 46 + intervals * 21;
  const blockUpdates = 4096 * 46;
  const queuedMessages = 1000;
  expect(blockUpdates * queuedMessages).toBeGreaterThan(31_000_000);
  out.transport = {holderBytes:holder, updateBlockBytes:blockUpdates, queuedMessages, queuedBytes:blockUpdates*queuedMessages, caution:'Permitted by the plan without acknowledgement/backpressure; illustrative arithmetic, not a measured allocation.'};
  fs.writeFileSync('/tmp/codex-r139-p56dtkmu/plan-counterexamples.json', JSON.stringify(out,null,2)+'\n');
});
