// Review-only probes; never a product edit. OLD_VIEWER points at 1adfc403's source.
import { beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import { copyTrackForWorker } from './viewer/colTrackCopy';
const emitted: any[] = [];
vi.mock('./ws/telemetry', () => ({emitTelemetry: (_kind: string, fields: unknown) => emitted.push(fields)}));
import { timeSpan, resetViewerPerf, recordApply, flushViewerPerf } from './viewerPerf';

const old = fs.readFileSync(process.env.OLD_VIEWER!, 'utf8');
const source = ts.createSourceFile('old.ts',old.slice(old.indexOf('<script setup lang="ts">')+24,old.indexOf('</script>')),ts.ScriptTarget.Latest,true);
let initializer: ts.Expression | undefined;
function find(n: ts.Node) {
  if(ts.isFunctionDeclaration(n) && n.name?.text === '_colBuildRequest') {
    const descend = (q: ts.Node) => { if(ts.isVariableDeclaration(q) && q.name.getText(source)==='trackCopy') initializer=q.initializer; ts.forEachChild(q,descend); };
    ts.forEachChild(n,descend);
  }
  ts.forEachChild(n,find);
}
find(source);
if(!initializer) throw Error('old track-copy expression not found');
const oldCopy = new Function('track', 'return '+ts.transpileModule('const x = '+initializer.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/^const x = /,'').trim().replace(/;$/,''));
const columns = {pos:Float32Array,abc:Float32Array,lines:Uint32Array,rapid:Uint8Array,cum:Float32Array,
 mode:Uint8Array,frame:Uint32Array,brk:Uint8Array,ustart:Uint8Array,dep:Uint8Array,wcsEpoch:Uint32Array,
 tlo:Uint32Array,unpredicted:Uint8Array,band:Uint8Array,cond:Uint8Array,lineOk:Uint8Array,sub:Uint16Array,cline:Uint32Array};

for (const kind of ['all subviews','only required','empty'] as const) {
 it(`same payload as before N1, all receiver values and original bytes: ${kind}`, () => {
  const t: any = {count:kind==='empty'?0:4,frames:[[1,2,3]],depEnd:2,startUnbound:true};
  // All input arrays share a larger source buffer; each is a subview. This
  // catches transferring whole backing storage or detaching a shared source.
  const backing = new ArrayBuffer(256);
  new Uint8Array(backing).set(Array.from({length:256},(_,i)=>(i*13)%251));
  for(const [i,[name,C]] of Object.entries(columns).entries()) {
    if(kind==='only required' && i>=5)continue;
    const n=kind==='empty'?0:(name==='pos'||name==='abc'?12:4);
    t[name]=new C(backing,16,n);
  }
  const originalBytes = Array.from(new Uint8Array(backing));
  const oldPayload = oldCopy(t);
  const {trackCopy,transfer,copies}=copyTrackForWorker(t);
  expect(transfer.length).toBe(copies);
  expect(new Set(transfer).size).toBe(transfer.length);
  expect(transfer).not.toContain(backing);
  const received=structuredClone(trackCopy,{transfer});
  expect(received).toEqual(oldPayload);
  expect(Array.from(new Uint8Array(backing))).toEqual(originalBytes);
  for(const [key,value] of Object.entries(oldPayload)) if(ArrayBuffer.isView(value)) {
    expect((received as any)[key].byteLength).toBe(value.byteLength);
    expect((trackCopy as any)[key].byteLength).toBe(0);
  }
 });
}

beforeEach(()=>{resetViewerPerf();emitted.length=0;vi.restoreAllMocks()});
it('nested failure preserves error identity and the next span becomes outer again',()=>{
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
 const error={identity:'must survive'};
 expect(()=>timeSpan('path_reply',()=>{
   clock+=2; timeSpan('path_programmed',()=>{clock+=3;throw error});
 })).toThrow(error);
 const result={returned:true};
 expect(timeSpan('col_copy',()=>{clock+=7;return result})).toBe(result);
 recordApply(1,1000);flushViewerPerf();
 expect(emitted.at(-1).span_path_reply).toEqual({n:1,sum:5,max:5});
 expect(emitted.at(-1).span_path_programmed).toEqual({n:0,sum:0,max:3,nested_n:1,nested_sum:3});
 expect(emitted.at(-1).span_col_copy).toEqual({n:1,sum:7,max:7});
 vi.restoreAllMocks();
});
