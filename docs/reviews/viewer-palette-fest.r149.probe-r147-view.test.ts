import { afterAll, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ContactStore, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_ENDED_AT_GAP, NONE, REQUEST_BUDGET } from './contactStore';
import { buildContactView, contactBands, lineMark, tintAt, targetPos, targetEnd, heldBytes, type ContactSource } from './contactView';

const results: Record<string, unknown> = {};
afterAll(() => { if (process.env.R148_REGRESSION_RESULTS) writeFileSync(process.env.R148_REGRESSION_RESULTS, JSON.stringify(results, null, 2) + '\n'); });
const pairName = (pair: number) => ({ a: `tool-${pair}`, b: `work-${pair}` });
const source = (s: ContactStore, props: Partial<ContactSource> = {}): ContactSource => ({ stores: [s], at: c => c, ...props });
function episode(s: ContactStore, ordinal: number, ivs: Array<[number, number, number?]>, end = ivs.at(-1)![1]) {
  const e = s.episodes.append({ pair: 0, ordinal, onset: ivs[0]![0], end, flags: 0, closeAt: ivs[0]![0], closeDist: 0, firstIv: NONE, ivCount: ivs.length });
  let last = NONE;
  for (const [enter, exit, flags = 0] of ivs) {
    const iv = s.intervals.append({ episode: e, enter, exit, flags, next: NONE, witness: enter, freeAt: NaN });
    if (last === NONE) s.episodes.set(e, 'firstIv', iv); else s.intervals.set(last, 'next', iv);
    last = iv;
  }
  return e;
}
function gap(s: ContactStore, start: number, end: number, reason = GAP_UNDECIDABLE) { s.gaps.append({ pair: 0, start, end, reason }); }
function view(s: ContactStore, coverage = 10) { return buildContactView({ sources: [source(s)], pairName, coverage }); }

it('positive controls: a broad free gap stays dark and decided contact stays lit', () => {
  const s = new ContactStore(1, 0); episode(s, 0, [[0, 1], [2, 3]]);
  const v = view(s); expect([...tintAt(v, 1.5)]).toEqual([]); expect(tintAt(v, 0.5).size).toBe(2);
});

it('a proven free point between close contacts is not filled by a view epsilon', () => {
  const s = new ContactStore(1, 0); episode(s, 0, [[0, 1], [1.001, 2]], 2);
  s.intervals.set(0, 'freeAt', 1.0005); s.intervals.set(0, 'freeR', 0.0001);
  const v = view(s, 4);
  results.freePoint = { defaultTint: [...tintAt(v, 1.0005)], exactTint: [...tintAt(v, 1.0005)], fineBands: contactBands(v, 8000, 4) };
  expect([...tintAt(v, 1.0005)]).toEqual([]);
});

it('a point-sized undecidable refinement gap is still unknown, with zero tolerance too', () => {
  const s = new ContactStore(1, 0); episode(s, 0, [[20, 21]], 21); gap(s, 20.75, 20.75);
  const v = view(s, 22);
  results.pointGap = { gap: [20.75, 20.75], tint: [...tintAt(v, 20.75)], mark: lineMark(v, 8, [[20.75, 20.75]]) };
  expect.soft([...tintAt(v, 20.75)]).toEqual([]);
  expect(lineMark(v, 8, [[20.75, 20.75]])).toBeNull();
});

it('a beginning mapped to zero keeps its contact when its pair has a later gap', () => {
  const s = new ContactStore(1, 0); episode(s, 0, [[1, 2]], 2);
  const mapped = () => buildContactView({ sources: [source(s, { at: c => Math.max(0, c - 3) })], pairName, coverage: 4 });
  // R149: a view reads its tables as built — read before the write
  const v0 = mapped(), before = { tint: [...tintAt(v0, 0)], bands: contactBands(v0, 100, 4) };
  gap(s, 5, 6); const after = mapped();
  results.pointContact = { before, after: { tint: [...tintAt(after, 0)], bands: contactBands(after, 100, 4), targets: after.n } };
  expect(before.tint.length).toBe(2);
  expect.soft([...tintAt(after, 0)]).toEqual(before.tint);
  expect(contactBands(after, 100, 4)).toEqual(before.bands);
});

it('only the unknown-tool gap terminates an IV_ENDED_AT_GAP interval', () => {
  const s = new ContactStore(1, 0); episode(s, 0, [[1, NaN, IV_ENDED_AT_GAP]], 6);
  gap(s, 3, 4); gap(s, 7, 9, GAP_TOOL_UNKNOWN);
  const v = view(s, 10);
  results.gapReason = { targetEnd: targetEnd(v, 0), recoveredTint: [...tintAt(v, 5)], mark: lineMark(v, 5, [[5, 5]]) };
  expect.soft(targetEnd(v, 0)).toBe(7);
  expect.soft([...tintAt(v, 5)]).toEqual(['tool-0', 'work-0']);
  expect([...tintAt(v, 3.5)]).toEqual([]);
});

it('an open side gap ends at its own coverage and cannot erase the later base contact', () => {
  const side = new ContactStore(-1, 0), base = new ContactStore(1, 0);
  gap(side, 2, NaN, GAP_UNDECIDABLE); episode(base, 0, [[2, 5]], 5);
  const v = buildContactView({ sources: [source(side, { entry: true, coverage: 10 }), source(base, { at: c => c + 10, coverage: 20 })], pairName, coverage: 20 });
  results.sourceCoverage = { sideCoverage: 10, viewCoverage: 20, targets: Array.from({length:v.n},(_,i)=>targetPos(v,i)), baseTint: [...tintAt(v, 13)], baseMark: lineMark(v, 13, [[13, 14]]) };
  expect.soft([...tintAt(v, 13)]).toEqual(['tool-0', 'work-0']);
  expect(lineMark(v, 13, [[13, 14]])).toEqual({ line: 13 });
});

it('one legal generation already must fit the total derivation budget of 8.4 MB', () => {
  const s = new ContactStore(1, 0);
  const t0 = performance.now();
  for (let e = 0; e < REQUEST_BUDGET.episodes; e++) {
    const p = e * 4;
    episode(s, e, [[p, p+.25], [p+1, p+1.25], [p+2, p+2.25], [p+3, p+3.25]], p+3.25);
  }
  const v = view(s, REQUEST_BUDGET.intervals + 1);
  const derivedBytes = heldBytes(v);
  results.memory = { rows: { episodes: s.episodes.rows, intervals: s.intervals.rows, gaps: s.gaps.rows }, targets: v.n, derivedBytes, allowedAllGenerationsAndSide: 8_400_000, constructionMs: performance.now()-t0, accounting: 'heldBytes (new reference-index API)' };
  expect(s.intervals.rows).toBe(REQUEST_BUDGET.intervals);
  expect(derivedBytes).toBeLessThanOrEqual(8_400_000);
});
