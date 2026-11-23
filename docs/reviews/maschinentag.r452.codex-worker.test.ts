import { it, expect, vi } from 'vitest';
import { encode } from '@msgpack/msgpack';
const worker: any={postMessage:vi.fn()};
vi.stubGlobal('self',worker);
await import('./previewWorker');
let n=100;
for(const headers of [{}, {'X-Preview-Version':'100','X-Preview-Program':'E.foreign'}, {'X-Preview-Version':'-1','X-Preview-Program':'E.1'}]) {
  it(`worker rejects header pair before reading bytes ${JSON.stringify(headers)}`,async()=>{
    const read=vi.fn();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,headers:new Headers(headers),arrayBuffer:read})));
    worker.postMessage.mockClear();
    await worker.onmessage({data:{version:n,programId:'E.1',url:`/bad${n++}`,basisKey:'basis'}});
    expect(read).not.toHaveBeenCalled();
    expect(worker.postMessage.mock.calls.at(-1)?.[0].error).toMatch(/^protocol:/);
  });
}
it('worker 409 finishes superseded with no error and no body read',async()=>{
  const read=vi.fn();
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:409,arrayBuffer:read})));
  worker.postMessage.mockClear();
  await worker.onmessage({data:{version:200,programId:'E.1',url:'/conflict',basisKey:'basis'}});
  expect(read).not.toHaveBeenCalled();
  expect(worker.postMessage.mock.calls.at(-1)?.[0]).toEqual({version:200,programId:'E.1',basisKey:'basis',superseded:true});
});
it('worker decodes its validated pair and reuses only that URL',async()=>{
  const bytes=encode({file:'/a.ngc',preview_schema:11,feed:[],rapid:[],violations:[]});
  const fetcher=vi.fn(async()=>new Response(bytes,{headers:{'X-Preview-Version':'201','X-Preview-Program':'E.1'}}));
  vi.stubGlobal('fetch',fetcher);
  worker.postMessage.mockClear();
  await worker.onmessage({data:{version:201,programId:'E.1',url:'/valid',basisKey:'basis'}});
  expect(worker.postMessage.mock.calls.at(-1)?.[0].gcode.file).toBe('/a.ngc');
  await worker.onmessage({data:{version:201,programId:'E.1',url:'/valid',basisKey:'basis2'}});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(worker.postMessage.mock.calls.at(-1)?.[0].programId).toBe('E.1');
});
