import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
class WorkerFake {
  static current: WorkerFake;
  onmessage: any; onerror: any; posted: any[]=[];
  constructor() { WorkerFake.current=this; }
  postMessage(x: any) { this.posted.push(x); }
}
vi.stubGlobal('Worker', WorkerFake);
vi.stubGlobal('fetch', () => new Promise(() => {}));
const bulk = await import('./bulkData');
const { status } = await import('./statusStore');
it('an old load failure is not the new active program error', async () => {
  status.value={ data:{ active_file:'/a.ngc', program_id:'E.1' } } as any;
  await nextTick();
  bulk.handleViewerGcodeReady({version:50,file:'/a.ngc',program_id:'E.1',origin:{source:'a'}});
  const req=WorkerFake.current.posted.at(-1);
  status.value={ data:{ active_file:'/b.ngc', program_id:'E.2' } } as any;
  await nextTick();
  WorkerFake.current.onmessage({data:{...req,error:'old A response failed'}});
  await nextTick();
  console.log('R452 late error', {active:'E.2', error:bulk.previewLoadError.value, shown:bulk.viewerGcode.value});
  expect(bulk.previewLoadError.value).toBeNull();
});
