// What one piece decode reads, in the "many pairs" union shape of the guard test.
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET } from "/home/cnc/lcnc-suite-mut/lcnc-webui/src/viewer/contactStore";
import { buildContactView, targetPos, targetKind, viewWork } from "/home/cnc/lcnc-suite-mut/lcnc-webui/src/viewer/contactView";
const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
function mk(g: number, shift: number, E: number, pairs: number, free: boolean): ContactStore {
  const st = new ContactStore(1, g, REQUEST_BUDGET);
  for (let e = 0; e < E; e++) {
    const ep = st.episodes.append({ pair: e % pairs, ordinal: Math.floor(e / pairs), onset: 12 * e + shift, end: 12 * e + 9 + shift + 1, closeAt: 12 * e + shift, closeDist: 0, firstIv: NONE, ivCount: 4 });
    let last = -1;
    for (let k = 0; k < 4; k++) {
      const a = 12 * e + 3 * k + shift;
      const iv = st.intervals.append({ episode: ep, enter: a, exit: a + 1, flags: D, next: NONE, witness: a + 0.5, freeAt: free ? a + 1.25 : NaN, freeR: free ? 0.2 : 0 });
      if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
      last = iv;
    }
  }
  return st;
}
for (const free of [true, false]) for (const [E, pairs] of [[4096, 1], [16384, 1], [16384, 64]] as const) {
  const cov = 12 * E + 5;
  const v = buildContactView({ sources: [{ stores: [mk(1, 1.5, E, pairs, free)], held: [mk(0, 0, E, pairs, free)], heldCoverage: [cov], at: c => c, ownCoverage: cov }],
    pairName: p => ({ a: `t${p}`, b: `w${p}` }), coverage: cov });
  let max = 0, sum = 0, ms = 0;
  for (let i = 0; i < v.n; i++) { const w0 = viewWork.n, t0 = performance.now(); targetPos(v, i); targetKind(v, i); const dt = performance.now() - t0, d = viewWork.n - w0; sum += d; if (d > max) max = d; if (dt > ms) ms = dt; }
  console.log(`free samples ${free}, intervals ${4 * E} a generation, pairs ${pairs}: targets ${v.n}, cells a query avg ${(sum / v.n).toFixed(0)}, max ${max}, slowest ${ms.toFixed(2)} ms`);
}
