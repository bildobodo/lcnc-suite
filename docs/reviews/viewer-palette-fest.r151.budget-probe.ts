import { ContactStore, GAP_UNDECIDABLE, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET, type StoreBudget } from "./viewer/contactStore";
import { buildContactView, contactBands, targetAt, tintAt } from "./viewer/contactView";
const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
const full = (generation: number, b: StoreBudget, shift: number, free: boolean) => {
  const st = new ContactStore(1, generation, b);
  const per = Math.floor(b.intervals / b.episodes);
  for (let e = 0; e < b.episodes; e++) {
    const p = e * 4;
    const ep = st.episodes.append({ pair: e, ordinal: 0, flags: 0, onset: p + shift, end: p + shift + 3.25, closeAt: p, closeDist: 0, firstIv: NONE, ivCount: per });
    let last = -1;
    for (let k = 0; k < per; k++) {
      const enter = p + k + shift, exit = enter + (free ? 0.75 : 0.25);
      const iv = st.intervals.append({ episode: ep, enter, exit, flags: D, next: NONE, witness: enter, freeAt: free ? exit + 0.125 : NaN, freeR: free ? 0.05 : 0 });
      if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
      last = iv;
    }
  }
  for (let g = 0; g < b.gaps; g++) st.gaps.append({ pair: g, start: g * 4 + 0.5, end: g * 4 + 0.6, reason: GAP_UNDECIDABLE });
  return st;
};
const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });
const cov = 4 * REQUEST_BUDGET.episodes + 1;
const shift = Number(process.env.B4_SHIFT ?? 0), free = !!process.env.B4_FREE;
const cur = full(1, REQUEST_BUDGET, shift, free), held = full(0, REQUEST_BUDGET, 0, free);
const t0 = performance.now();
const v = buildContactView({ sources: [{ stores: [cur], held: [held], at: c => c, ownCoverage: cov }], pairName: names, coverage: cov });
const t1 = performance.now();
contactBands(v, 8192, cov);
const t2 = performance.now();
let lines = 0;
for (let i = 0; i < v.n; i++) lines += targetAt(v, i, () => 1).line;
const t3 = performance.now();
for (let k = 0; k < 1000; k++) tintAt(v, (k * 997) % cov);
const t4 = performance.now();
// the same without a fallback: both generations as two plain sources
const w = buildContactView({ sources: [{ stores: [cur], at: c => c, ownCoverage: cov }, { stores: [held], at: c => c, ownCoverage: cov }], pairName: names, coverage: cov });
const t5 = performance.now();
for (let i = 0; i < w.n; i++) lines += targetAt(w, i, () => 1).line;
const t6 = performance.now();
console.log(`n ${v.n} build ${(t1 - t0).toFixed(0)} ms bands ${(t2 - t1).toFixed(0)} ms all targets ${(t3 - t2).toFixed(0)} ms tint ${((t4 - t3) / 1000 * 1000).toFixed(1)} µs/query | plain n ${w.n} build ${(t5 - t4).toFixed(0)} ms all targets ${(t6 - t5).toFixed(0)} ms`);
