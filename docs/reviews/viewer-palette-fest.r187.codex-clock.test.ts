// Review-only: actual collector, constant context offsets, bounded stamp errors.
import './testGlobals';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
const rows: Array<Record<string, any>> = [];
vi.mock('./ws/telemetry', () => ({ emitTelemetry: (tag: string, row: Record<string, any>) => { if(tag==='viewer.perf') rows.push(row); } }));
import { flushViewerPerf, noteClockExchange, receiptOnPage, notePendingReceipt, recordApply, resetClockRelation, resetViewerPerf } from './viewerPerf';
const out: Record<string, any> = {}, T0 = performance.timeOrigin;
let now = 1;
beforeEach(() => { vi.spyOn(performance,'now').mockImplementation(()=>now); resetViewerPerf(); rows.length=0; });
afterEach(() => { vi.restoreAllMocks(); writeFileSync('/tmp/codex-r187-b4k897uq/clock-evidence.json',JSON.stringify(out,null,2)); });
function show(rx:number, at:number) { notePendingReceipt(receiptOnPage(T0+rx)); now=at; recordApply(1); flushViewerPerf(); return rows.at(-1)!; }
it('R186 WS-ahead counterexample now has a conservative age, for either sign of the offset', () => {
  out.oldCounterexample=[];
  for (const offset of [2000,-2000]) {
    resetViewerPerf(); rows.length=0;
    noteClockExchange(T0+9000,T0+9001+offset,T0+9002);
    recordApply(0,1);
    const row=show(10000+offset,12100);
    expect(row.age_max_ms).toBeGreaterThanOrEqual(2100);
    expect(row.age_max_ms).toBeLessThanOrEqual(2110);
    out.oldCounterexample.push({offset,actualAge:2100,row});
  }
});
it('constant offsets, asymmetric exchanges and bounded timestamp errors never understate age', () => {
  let seed=187, minSlack=Infinity, maxSlack=0;
  const rand=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32; };
  for (let i=0;i<2000;i++) {
    resetViewerPerf(); rows.length=0;
    const base=10000+i*1000, theta=Math.floor(rand()*200001)-100000;
    // A timeOrigin error is constant for its context; now() varies per stamp.
    const ep=2*rand()-1, ew=2*rand()-1, err=()=>2*rand()-1;
    for (let k=0;k<4;k++) {
      const p=base+k*60, forward=2+rand()*25, back=2+rand()*25;
      noteClockExchange(T0+p+ep+err(),T0+p+forward+theta+ew+err(),T0+p+forward+back+ep+err());
    }
    const age=1+Math.floor(rand()*300), rx=base+400;
    recordApply(0,base);
    const row=show(rx+theta+ew+err(),rx+age+ep+err());
    const slack=row.age_max_ms-age;
    // Output max is rounded to 0.1 ms; histogram bins remain upper edges.
    expect(slack).toBeGreaterThanOrEqual(-0.05);
    expect(row.clk_conflicts).toBe(0); expect(row.age_unbound).toBe(0);
    minSlack=Math.min(minSlack,slack);maxSlack=Math.max(maxSlack,slack);
  }
  out.randomBounds={cases:2000,seed:187,minSlackMs:minSlack,maxSlackMs:maxSlack,nowErrorMs:1,originErrorMs:1};
});
it('missing relation, worker replacement and a contradictory relation remain explicit', () => {
  recordApply(0,1);
  const none=show(1000,2000);
  expect(none.age_n).toBe(0);expect(none.age_unbound).toBe(1);
  noteClockExchange(T0+2100,T0+4101,T0+2102);
  resetClockRelation();
  const restarted=show(4200,4300);
  expect(restarted.age_n).toBe(0);expect(restarted.age_unbound).toBe(1);
  noteClockExchange(T0+5000,T0+7001,T0+5002);
  noteClockExchange(T0+6000,T0+6001,T0+6002);
  const conflict=show(6100,6200);
  expect(conflict.clk_conflicts).toBe(1);
  out.unknown={none,restarted,conflict};
});
it('a pending receipt keeps its older conservative bound after a tighter exchange', () => {
  noteClockExchange(T0+100,T0+2190,T0+200); // U=2094
  recordApply(0,1);
  notePendingReceipt(receiptOnPage(T0+2300)); // true page receipt 300, mapped earlier 206
  noteClockExchange(T0+310,T0+2311,T0+312); // U=2005 now
  now=400;recordApply(1);flushViewerPerf();
  expect(rows.at(-1)?.age_max_ms).toBe(194);
  out.pendingBound={trueAge:100,row:rows.at(-1)};
});
