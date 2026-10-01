import './src/testGlobals';
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
const bulk=await import('./src/ws/bulkData');
const store=await import('./src/ws/statusStore');

for (const a of [10,20]) test(`R60: A=${a} applied -> B pending -> A wanted -> late B ignored -> B wanted again`,async()=>{
  const file='/r60-return.ngc',version=6000+a,b=30;
  const rows:any[]=[];
  const want=async(z:number)=>{
    store.handleStatusMessage({type:'status',data:{},...(z===10 ? {} : {
      preview_tool_basis:{file,version,xyz:[0,0,z]}})});
    await nextTick();
  };
  const observe=(label:string)=>rows.push({label,wanted:store.previewToolBasis.value,
    pending:store.previewBasisPending.value,refresh:store.previewRefresh.value,
    applied:bulk.viewerGcode.value?.toolBasis,requests:worker.posted.map(m=>m.basisKey)});
  const deliver=(request:any,z:number)=>worker.onmessage!({data:{version,basisKey:request.basisKey,
    gcode:{file,toolBasis:[0,0,z]}}});
  await want(10);
  bulk.handleViewerGcodeReady({file,version});
  const worker=WorkerFake.all.at(-1)!;
  deliver(worker.posted.at(-1),10);
  if(a!==10){await want(a);deliver(worker.posted.at(-1),a);}
  expect(bulk.viewerGcode.value?.toolBasis).toEqual([0,0,a]);
  observe('A applied');
  await want(b);
  const oldRequest=worker.posted.at(-1),postedBeforeReturn=worker.posted.length;
  expect(store.previewBasisPending.value).toBe(true);
  observe('B pending');
  await want(a);
  expect(worker.posted.length).toBe(postedBeforeReturn);
  expect(store.previewBasisPending.value).toBe(false);
  observe('A wanted again: no extra decode');
  deliver(oldRequest,b);
  await nextTick();
  expect(bulk.viewerGcode.value?.toolBasis).toEqual([0,0,a]);
  observe('late B ignored');
  await want(a);
  expect(bulk.viewerGcode.value?.toolBasis).toEqual([0,0,a]);
  expect(store.previewRefresh.value).toBeNull();
  observe('unchanged status: A stays');
  await want(b);
  expect(worker.posted.length).toBe(postedBeforeReturn+1);
  expect(store.previewBasisPending.value).toBe(true);
  deliver(worker.posted.at(-1),b);
  await nextTick();
  expect(bulk.viewerGcode.value?.toolBasis).toEqual([0,0,b]);
  expect(store.previewBasisPending.value).toBe(false);
  expect(store.previewRefresh.value).toBeNull();
  observe('B newly requested and applied');
  writeFileSync(`../evidence/viewer-palette-fest.r60.transitions-${a}.json`,JSON.stringify(rows,null,2)+'\n');
});
