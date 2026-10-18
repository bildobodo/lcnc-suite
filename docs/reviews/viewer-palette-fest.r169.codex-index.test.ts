import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ColumnTable, ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_RAPID, NONE } from './contactStore';
import { buildContactView, targetKind, targetKey, targetPos, targetEnd, T_RAPID } from './contactView';

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
const names = (p: number) => ({ a: `body${p}`, b: 'stock' });
function interval(st: ContactStore, pair: number, ordinal: number, start: number, end: number, rapid: boolean, free = false) {
  const ep = st.episodes.append({ pair, ordinal, flags: 0, onset: start, end, closeAt: start,
    closeDist: 0, firstIv: NONE, ivCount: 1 });
  st.episodes.set(ep, 'firstIv', st.intervals.append({ episode: ep, enter: start, exit: end,
    flags: D | (rapid ? IV_RAPID : 0), next: NONE, witness: (start + end) / 2,
    freeAt: free ? end + 0.5 : NaN, freeR: free ? 0.2 : 0 }));
}
function view(held: ContactStore, current: ContactStore, end: number) {
  return buildContactView({ sources: [{ held: [held], stores: [current], ownCoverage: end,
    heldCoverage: [end], at: x => x }], pairName: names, coverage: end });
}

it('R169: interval rapid bits stay inside their events across 64-row block and pair boundaries, from either generation', () => {
  const results: unknown[] = [];
  for (const rapidGeneration of [0, 1]) {
    const stores = [new ContactStore(1, 0), new ContactStore(1, 1)];
    const flagged = new Set([0, 63, 64, 65, 127, 129]);
    for (let g = 0; g < 2; g++) for (let k = 0; k < 195; k++) {
      // The last 65 rows are a different pair, including a flag just before it.
      interval(stores[g]!, k < 130 ? 0 : 1, k < 130 ? k : k - 130,
        3 * k, 3 * k + 1, g === rapidGeneration && flagged.has(k), true);
    }
    const v = view(stores[0]!, stores[1]!, 600);
    expect(v.n).toBe(195);
    const actual = Array.from({ length: v.n }, (_, k) => (targetKind(v, k) & T_RAPID) !== 0);
    expect(actual).toEqual(Array.from({ length: 195 }, (_, k) => flagged.has(k)));
    expect(targetKey(v, 130)).toBe('C1|0|0');
    results.push({ rapidGeneration, rapidTargets: actual.flatMap((b, k) => b ? [k] : []) });
  }
  writeFileSync(process.env.R169_OUT! + '/block-boundaries.json', JSON.stringify(results, null, 2) + '\n');
});

it('R169: the last rapid in a joined piece is found without reading its interval chain', () => {
  // Both generations have apart intervals; their overlaps form one long
  // union. Only the final interval of the new generation has IV_RAPID.
  const measurements: Array<{ intervalsPerGeneration: number; rapid: boolean; reads: number }> = [];
  for (const n of [1024, 8192]) for (const rapid of [false, true]) {
    const stores = [new ContactStore(1, 0), new ContactStore(1, 1)];
    for (let g = 0; g < 2; g++) for (let k = 0; k < n; k++) {
      interval(stores[g]!, 0, k, 3 * k + g, 3 * k + g + 2.5,
        rapid && g === 1 && k === n - 1);
    }
    const proto = ColumnTable.prototype;
    const originalBlocks = proto.blocksOf, originalGet = proto.get;
    let reads = 0;
    const counted = new WeakMap<object, object>();
    proto.blocksOf = function (name) {
      return originalBlocks.call(this, name).map(block => {
        let p = counted.get(block);
        if (!p) { p = new Proxy(block, { get(t, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
          return Reflect.get(t, key, t);
        } }); counted.set(block, p); }
        return p;
      }) as ReturnType<typeof originalBlocks>;
    };
    proto.get = function (row, name) { reads++; return originalGet.call(this, row, name); };
    try {
      const v = view(stores[0]!, stores[1]!, 3 * n + 1);
      expect(v.n).toBe(1);
      reads = 0;
      expect((targetKind(v, 0) & T_RAPID) !== 0).toBe(rapid);
      const queryReads = reads;
      expect(targetPos(v, 0)).toBe(0);
      expect(targetEnd(v, 0)).toBe(3 * (n - 1) + 3.5);
      expect(targetKey(v, 0)).toBe('C0|0|0');
      measurements.push({ intervalsPerGeneration: n, rapid, reads: queryReads });
      // An interval chain scan would read at least n flags, vs bounded
      // blocks and logarithmic position searches here.
      expect(queryReads).toBeLessThan(2000);
    } finally { proto.blocksOf = originalBlocks; proto.get = originalGet; }
  }
  writeFileSync(process.env.R169_OUT! + '/bounded-query.json', JSON.stringify(measurements, null, 2) + '\n');
  for (const rapid of [false, true]) {
    const m = measurements.filter(x => x.rapid === rapid);
    expect(m[1]!.reads).toBeLessThanOrEqual(1.5 * m[0]!.reads + 256);
  }
});
