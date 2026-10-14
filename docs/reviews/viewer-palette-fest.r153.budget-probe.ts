// R152: the union view's cost and memory at the budget (Codex R151: one big
// group, many small groups, growing deltas, both side generations; build,
// bands, the visible window, every target, the tint; held bytes and heap after
// the queries, after a GC). Node, the product's modules bundled as they are.
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET, shareOf, type StoreBudget } from "/home/cnc/lcnc-suite-mut/lcnc-webui/src/viewer/contactStore";
import { buildContactView, contactBands, heldBytes, targetAt, targetWindow, tintAt, type ContactSource } from "/home/cnc/lcnc-suite-mut/lcnc-webui/src/viewer/contactView";

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
const gc = () => (globalThis as any).gc?.();
type Shape = "one pair, identical" | "one pair, every free sample cutting" | "many pairs, identical" | "many pairs, every free sample cutting";

/** A generation of `shape` with the first `count` intervals (of the budget's). */
function table(shape: Shape, generation: number, b: StoreBudget, count: number, request = 1): ContactStore {
  const st = new ContactStore(request, generation, b);
  const onePair = shape.startsWith("one pair"), cutting = shape.endsWith("cutting"), later = generation === 1 && cutting;
  const per = 4;
  let ep = -1, last = -1;
  for (let i = 0; i < count; i++) {
    const pair = onePair ? 0 : (i / per) | 0;
    if (i % per === 0) {
      const at = 3 * i + (later ? 1.5 : 0);
      ep = st.episodes.append({ pair, ordinal: onePair ? i / per : 0, flags: 0, onset: at, end: at + 3 * per, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: per });
      last = -1;
    }
    // identical: [3i, 3i + 1], witness 3i + 0.5, free at 3i + 2 (r 0.25). Cutting, the later generation
    // shifted by 1.5: its free sample at 3i + 3.2 cuts the earlier one's next contact, the earlier
    // one's at 3i + 2 cuts its own
    const enter = 3 * i + (later ? 1.5 : 0), exit = enter + 1;
    const iv = st.intervals.append({ episode: ep, enter, exit, flags: D, next: NONE, witness: later ? enter + 0.1 : enter + 0.5,
                                     freeAt: later ? 3 * i + 3.2 : 3 * i + 2, freeR: 0.25 });
    if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
    last = iv;
  }
  return st;
}

const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });
const side = shareOf(REQUEST_BUDGET, 8);
const N = REQUEST_BUDGET.intervals, NS = side.intervals;
const cov = 3 * N + 10, covS = 3 * NS + 10;
const lineAt = () => 1;

function view(shape: Shape, cur: ContactStore, held: ContactStore, curS: ContactStore, heldS: ContactStore) {
  const sources: ContactSource[] = [
    { stores: [cur], held: [held], heldCoverage: [cov], at: c => c, ownCoverage: cov },
    { stores: [curS], held: [heldS], heldCoverage: [covS], at: c => c, entry: true, ownCoverage: covS },
  ];
  return buildContactView({ sources, pairName: names, coverage: cov });
}

const out: Record<string, unknown> = {};
for (const shape of (process.env.SHAPES ? process.env.SHAPES.split("|") : ["one pair, identical", "one pair, every free sample cutting", "many pairs, identical", "many pairs, every free sample cutting"]) as Shape[]) {
  // the earlier generation whole (the pool's), the rerun growing: a rebuild after each of 16 deltas
  const held = table(shape, 0, REQUEST_BUDGET, N), heldS = table(shape, 0, side, NS, -1);
  const steps: number[] = [];
  let v!: ReturnType<typeof view>;
  for (let k = 1; k <= 16; k++) {
    const cur = table(shape, 1, REQUEST_BUDGET, Math.round(N * k / 16)), curS = table(shape, 1, side, Math.round(NS * k / 16), -1);
    gc();
    const t0 = performance.now();
    v = view(shape, cur, held, curS, heldS);
    steps.push(performance.now() - t0);
  }
  // a warm-up round on another view of the same shape: the code the queries compile is no data of this view
  {
    const w = view(shape, table(shape, 1, REQUEST_BUDGET, N >> 4), table(shape, 0, REQUEST_BUDGET, N >> 4),
                   table(shape, 1, side, NS >> 4, -1), table(shape, 0, side, NS >> 4, -1));
    contactBands(w, 8192, cov); targetWindow(w, w.n >> 1, 50, lineAt);
    for (let i = 0; i < w.n; i++) targetAt(w, i, lineAt);
    for (let q = 0; q < 1000; q++) tintAt(w, (q * 7919.37) % cov);
  }
  gc(); await new Promise(r => setTimeout(r, 300)); gc();
  const heldBefore = heldBytes(v), heap0 = process.memoryUsage();
  const t1 = performance.now();
  const bands = contactBands(v, 8192, cov);
  const t2 = performance.now();
  const win = targetWindow(v, v.n >> 1, 50, lineAt);
  const t3 = performance.now();
  let sum = 0;
  for (let i = 0; i < v.n; i++) sum += targetAt(v, i, lineAt).cum;
  const t4 = performance.now();
  for (let q = 0; q < 1000; q++) tintAt(v, (q * 7919.37) % cov);
  const t5 = performance.now();
  gc(); await new Promise(r => setTimeout(r, 300)); gc();
  const heap1 = process.memoryUsage();
  const heldAfter = heldBytes(v);
  // the same queries again: what a second round keeps (a cache growing with queries would show here)
  contactBands(v, 8192, cov); targetWindow(v, v.n >> 2, 50, lineAt);
  for (let i = 0; i < v.n; i++) sum += targetAt(v, i, lineAt).cum;
  for (let q = 0; q < 1000; q++) tintAt(v, (q * 4513.11) % cov);
  gc(); await new Promise(r => setTimeout(r, 300)); gc();
  const heap2 = process.memoryUsage();
  out[shape] = {
    targets: v.n, bandRuns: bands.length, window: win.targets.length, checksum: sum,
    buildMsPerDelta: steps.map(x => Math.round(x)), buildMsMax: Math.round(Math.max(...steps)),
    bandsMs: Math.round(t2 - t1), windowMs: +(t3 - t2).toFixed(2), allTargetsMs: Math.round(t4 - t3), tintUsPerQuery: +((t5 - t4)).toFixed(1),
    heldBytesBeforeQueries: heldBefore, heldBytesAfterQueries: heldAfter, limit: 8_400_000,
    heapRetainedByQueriesAfterGc: heap1.heapUsed - heap0.heapUsed, arrayBuffersRetainedByQueries: heap1.arrayBuffers - heap0.arrayBuffers,
    heapRetainedBySecondRound: heap2.heapUsed - heap1.heapUsed, arrayBuffersBySecondRound: heap2.arrayBuffers - heap1.arrayBuffers,
  };
  console.log(shape, JSON.stringify(out[shape]));
}
