import "../testGlobals";
import {test,expect,vi} from 'vitest';
import {writeFileSync} from 'node:fs';
import {nextTick} from 'vue';

class WorkerFake {
  static all:WorkerFake[]=[];
  posted:any[]=[];
  onmessage:((event:any)=>void)|null=null;
  onerror:any=null;
  constructor(public url:URL){WorkerFake.all.push(this);}
  postMessage(message:any){this.posted.push(message);}
  terminate(){}
}
(globalThis as any).Worker=WorkerFake;
vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(new Response('G0 X0\nM2\n'))));
const bulk=await import('./bulkData');
const store=await import('./statusStore');

test('R59 diagnostic: returning to the applied basis must invalidate a pending different basis',async()=>{
  const file='/r59-return.ngc',version=5901;
  const rows:any[]=[];
  const observe=(label:string)=>rows.push({label,wanted:store.previewToolBasis.value,
    pending:store.previewBasisPending.value,refresh:store.previewRefresh.value,
    applied:bulk.viewerGcode.value?.toolBasis,requests:worker.posted.map(m=>m.basisKey)});
  bulk.handleViewerGcodeReady({file,version});
  const worker=WorkerFake.all.at(-1)!;
  const first=worker.posted.at(-1);
  worker.onmessage!({data:{version,basisKey:first.basisKey,gcode:{file,toolBasis:[0,0,10]}}});
  observe('initial start 10 applied');
  store.handleStatusMessage({type:'status',data:{},preview_tool_basis:{file,version,xyz:[0,0,20]}});
  await nextTick();
  const oldRequest=worker.posted.at(-1);
  expect(store.previewBasisPending.value).toBe(true);
  observe('20 pending');
  // Gateway's latest state requires the original start; 20's reply is still out.
  store.handleStatusMessage({type:'status',data:{}});
  await nextTick();
  expect(bulk.viewerGcode.value?.toolBasis).toEqual([0,0,10]);
  expect(store.previewBasisPending.value).toBe(false);
  observe('start 10 wanted again; no decode necessary');
  worker.onmessage!({data:{version,basisKey:oldRequest.basisKey,gcode:{file,toolBasis:[0,0,20]}}});
  await nextTick();
  observe('outdated 20 reply arrives');
  store.handleStatusMessage({type:'status',data:{}});
  await nextTick();
  observe('next unchanged gateway status');
  writeFileSync('../evidence/viewer-palette-fest.r59.transitions.json',JSON.stringify(rows,null,2)+'\n');
  // Positive diagnostic of the remaining bug, not a product acceptance assertion.
  expect(bulk.viewerGcode.value?.toolBasis).toEqual([0,0,20]);
  expect(store.previewToolBasis.value).toBeNull();
  expect(store.previewRefresh.value).toBeNull();
});
