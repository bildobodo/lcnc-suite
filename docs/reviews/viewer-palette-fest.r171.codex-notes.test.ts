import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ColumnTable, ContactStore, GAP_UNDECIDABLE, GAP_TOOL_UNKNOWN } from './contactStore';
import { buildContactView, undecidableStretchesSteps } from './contactView';
import { buildShownSteps, type ShownSpec } from './shownContacts';
import { Grow, STEP_OPS, runToEnd, withMeter } from './steps';
import type { GenerationTables } from './contactPublisher';

const out = process.env.R171_OUT!;
const pairs: [string, string][] = [['spindle', 'stock'], ['holder', 'machine'], ['A', 'C'], ['A', 'B']];
const names = (p: number) => ({ a: pairs[p]![0], b: pairs[p]![1] });
type Span = { pair: number; start: number; end: number; reason: number };
function store(id: number, gen: number, rows: Span[]) {
  const s = new ContactStore(id, gen);
  for (const row of rows) s.gaps.append(row);
  return s;
}

it('R171: the full page build agrees with an independent union across sources, shards, generations and folded coordinates', () => {
  let seed = 0x171;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const outcomes: object[] = [];
  for (let scenario = 0; scenario < 48; scenario++) {
    const groups = new Map<string, Array<[number, number]>>();
    const current = new Map<number, GenerationTables>(), earlier = new Map<number, GenerationTables>();
    const spec: ShownSpec = { base: { id: 1, map: null, coverage: 100, ownEnd: 100, ownCoverage: 70 },
      side: { id: 2, map: scenario % 2 ? { kind: 'minus', shift: 15 } : { kind: 'plus', shift: 15 }, coverage: 100, ownEnd: 100, ownCoverage: 60 }, axisEnd: 100 };
    for (const id of [1, 2]) for (const gen of [0, 1]) {
      const own = gen === 0 ? 100 : id === 1 ? 70 : 60;
      const at = (x: number) => id === 1 ? x : scenario % 2 ? Math.max(0, x - 15) : x + 15;
      const tables: ContactStore[] = [];
      for (let shard = 0; shard < 2; shard++) {
        const rows: Span[] = [];
        for (let k = 0; k < 32; k++) {
          const pair = Math.floor(4 * rng()), start = Math.floor(100 * rng());
          const end = k % 7 === 0 ? NaN : Math.min(100, start + Math.floor(10 * rng()));
          const reason = k % 6 ? GAP_UNDECIDABLE : GAP_TOOL_UNKNOWN;
          rows.push({ pair, start, end, reason });
          if (reason !== GAP_UNDECIDABLE || start > own) continue;
          const s = Math.min(100, at(start)), e = Math.min(100, at(Number.isNaN(end) ? own : Math.min(own, end)));
          const key = pairs[pair]!.join('\0');
          const spans = groups.get(key) ?? []; spans.push([s, Math.max(s, e)]); groups.set(key, spans);
        }
        // Reverse the insertion order in half the cases: an independent sort must still agree.
        tables.push(store(id, gen, scenario % 2 ? rows.reverse() : rows));
      }
      (gen ? current : earlier).set(id, { generation: gen, stores: tables, pairs, deltas: 1, ...(gen === 0 ? { covered: [1, 1] } : {}) });
    }
    const expected = [...groups].map(([key, spans]) => {
      const merged: Array<[number, number]> = [];
      for (const [s, e] of spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
        const last = merged.at(-1);
        if (last && s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e]);
      }
      const [a, b] = key.split('\0');
      return { a, b, spans: merged.slice(0, 3), more: merged.length > 3 };
    }).sort((x, y) => x.spans[0]![0] - y.spans[0]![0] || (x.a! + '\0' + x.b! < y.a! + '\0' + y.b! ? -1 : 1));
    const sv = runToEnd(buildShownSteps(id => current.get(id) ?? null, spec, id => earlier.get(id) ?? null, x => Math.floor(x) + 1, 300, 100));
    expect(sv?.derived?.undecidable, `scenario ${scenario}`).toEqual(expected);
    outcomes.push({ scenario, sourceCount: 2, shardsPerGeneration: 2, gaps: 256, pairCount: expected.length, pass: true });
  }
  writeFileSync(out + '/mapped-union.json', JSON.stringify(outcomes, null, 2) + '\n');
});

it('R171: reads of the temporary blocks as well as the source tables stay bounded between yields', () => {
  const results: object[] = [];
  for (const n of [1024, 8192, 16384]) {
    const stores = [0, 1].map(gen => store(1, gen, Array.from({ length: n }, (_, k) => ({ pair: 0, start: k * 4 + gen * 2, end: k * 4 + gen * 2 + 0.5, reason: GAP_UNDECIDABLE }))));
    const end = n * 4;
    const v = buildContactView({ sources: [{ stores: [stores[1]!], held: [stores[0]!], heldCoverage: [end], ownCoverage: end, at: x => x }], pairName: names, coverage: end });
    const get = ColumnTable.prototype.get, at = Grow.prototype.at, sort = Array.prototype.sort;
    let reads = 0, worst = 0, maxSort = 0, steps = 0;
    ColumnTable.prototype.get = function (...args) { reads++; return get.apply(this, args); };
    Grow.prototype.at = function (i) { reads++; return at.call(this, i); };
    Array.prototype.sort = function (...args) { maxSort = Math.max(maxSort, this.length); return sort.apply(this, args); };
    const meter = { bytes: 0 };
    try {
      const job = undecidableStretchesSteps(v);
      for (;;) {
        reads = 0; const r = withMeter(meter, () => job.next()); worst = Math.max(worst, reads); steps++;
        if (r.done) { expect(r.value[0]?.spans).toEqual([[0, 0.5], [2, 2.5], [4, 4.5]]); expect(r.value[0]?.more).toBe(true); break; }
      }
    } finally { ColumnTable.prototype.get = get; Grow.prototype.at = at; Array.prototype.sort = sort; }
    results.push({ nPerGeneration: n, steps, maxReadsPerStep: worst, maxNativeArraySort: maxSort, allocatedBytes: meter.bytes });
    expect(worst).toBeLessThanOrEqual(4 * STEP_OPS);
    expect(maxSort).toBe(0);
    expect(meter.bytes).toBeGreaterThanOrEqual(24 * 2 * n);
  }
  writeFileSync(out + '/bounded-reads.json', JSON.stringify(results, null, 2) + '\n');
});
