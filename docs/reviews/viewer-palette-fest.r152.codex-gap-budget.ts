// Codex R152: independent budget extension of Claude's r152.budget-probe.ts.
// Same full main + side interval shape; freeR 0.1 avoids every confirmed-point
// conflict. Add the allowed gap budget on pair 1 (the contacts use pair 0),
// identically in both generations. Compare no gaps, undecidable, tool unknown.
// Copy into lcnc-webui, bundle with esbuild for Node, run node --expose-gc.
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET, shareOf, type StoreBudget } from "./src/viewer/contactStore";
import { buildContactView, contactBands, heldBytes, targetAt, targetWindow, tintAt, type ContactSource } from "./src/viewer/contactView";

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
    // Independent R152 extension: radius 0.1 avoids all confirmed-point conflicts.
    // shifted by 1.5: its free sample at 3i + 3.2 cuts the earlier one's next contact, the earlier
    // one's at 3i + 2 cuts its own
    const enter = 3 * i + (later ? 1.5 : 0), exit = enter + 1;
    const iv = st.intervals.append({ episode: ep, enter, exit, flags: D, next: NONE, witness: later ? enter + 0.1 : enter + 0.5,
                                     freeAt: later ? 3 * i + 3.2 : 3 * i + 2, freeR: 0.1 });
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


const output=[];
for (const gapReason of [null,1,2]) {
 const shape:Shape="one pair, every free sample cutting";
 const h=table(shape,0,REQUEST_BUDGET,N),c=table(shape,1,REQUEST_BUDGET,N),hs=table(shape,0,side,NS,-1),cs=table(shape,1,side,NS,-1);
 if(gapReason!==null) for(const [st,b] of [[h,REQUEST_BUDGET],[c,REQUEST_BUDGET],[hs,side],[cs,side]] as const) {
   for(let i=0;i<b.gaps;i++) st.gaps.append({pair:1,start:i*4,end:i*4+1,reason:gapReason});
 }
 const t0=performance.now(); const v=view(shape,c,h,cs,hs);
 output.push({gapReason,n:v.n,conflicts:v.conflicts,heldBytes:heldBytes(v),limit:8400000,buildMs:performance.now()-t0,gaps:[h.gaps.rows,c.gaps.rows,hs.gaps.rows,cs.gaps.rows]});
}
console.log(JSON.stringify(output,null,2));
