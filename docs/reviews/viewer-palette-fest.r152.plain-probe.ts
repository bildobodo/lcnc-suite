// R152 baseline: the same budget tables WITHOUT a fallback — each generation a plain source (no union).
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET } from "/home/cnc/lcnc-suite-mut/lcnc-webui/src/viewer/contactStore";
import { buildContactView } from "/home/cnc/lcnc-suite-mut/lcnc-webui/src/viewer/contactView";
const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
function table(generation: number, onePair: boolean): ContactStore {
  const st = new ContactStore(1, generation, REQUEST_BUDGET);
  let ep = -1, last = -1;
  for (let i = 0; i < REQUEST_BUDGET.intervals; i++) {
    const pair = onePair ? 0 : (i / 4) | 0;
    if (i % 4 === 0) { ep = st.episodes.append({ pair, ordinal: onePair ? i / 4 : 0, flags: 0, onset: 3 * i, end: 3 * i + 12, closeAt: 3 * i, closeDist: 0, firstIv: NONE, ivCount: 4 }); last = -1; }
    const iv = st.intervals.append({ episode: ep, enter: 3 * i, exit: 3 * i + 1, flags: D, next: NONE, witness: 3 * i + 0.5, freeAt: 3 * i + 2, freeR: 0.25 });
    if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
    last = iv;
  }
  return st;
}
const cov = 3 * REQUEST_BUDGET.intervals + 10;
for (const onePair of [true, false]) {
  const a = table(0, onePair), b = table(1, onePair);
  const ms: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    buildContactView({ sources: [{ stores: [b], at: c => c, ownCoverage: cov }, { stores: [a], at: c => c, ownCoverage: cov }], pairName: p => ({ a: `t${p}`, b: "w" }), coverage: cov });
    ms.push(performance.now() - t0);
  }
  // the union of the same two tables (the fallback), for the comparison in one process
  const u: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    buildContactView({ sources: [{ stores: [b], held: [a], heldCoverage: [cov], at: c => c, ownCoverage: cov }], pairName: p => ({ a: `t${p}`, b: "w" }), coverage: cov });
    u.push(performance.now() - t0);
  }
  console.log(`${onePair ? "one pair" : "many pairs"}: two plain sources ${ms.map(Math.round).join(" ")} ms; the union of the same ${u.map(Math.round).join(" ")} ms`);
}
