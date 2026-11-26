// R492: independent probes; run against an archive of e8d99b0c.
import { FormLibrary, LIBRARY_BYTES_MAX } from './tree/lcnc-webui/src/toolLibrary';
import { formSteps } from './tree/lcnc-webui/src/toolForm';
import { ToolShapeCache, ENTRIES_MAX } from './tree/lcnc-webui/src/toolShapeCache';
import { runToEnd } from './tree/lcnc-webui/src/viewer/steps';

const results: any[] = [];
function check(name: string, ok: boolean, evidence: unknown) { results.push({name, verdict: ok ? 'PASS' : 'FAIL', evidence}); }
const binding = {path:'/table', instance:'old', units:1, rev:'r'};
const vertices = Array(100000).fill([0,0,1]);
const triangles = Array(200000).fill([0,1,2]);
const rows: any[] = Array.from({length:18}, (_,i) => ({T:i+1,native_mesh:{vertices,triangles}}));
// 18 * (3,600,000 + 1,024) leaves 2,290,432. The following mesh
// occupies 2,290,428 bytes, before its 1,024-byte record.
rows.push({T:19,native_mesh:{vertices, triangles:triangles.slice(0,90869)}});
const segments = Array.from({length:64}, () => ({height:1,lower_diameter:6,upper_diameter:6}));
for(let T=20;T<52;T++) rows.push({T,type:'endmill',shaft_segments:segments,holder_segments:segments});
const library = new FormLibrary(binding, rows, 1);
const at = performance.now();
runToEnd(library.normalise());
check('all retained library records obey 64 MiB', library.bytes <= LIBRARY_BYTES_MAX,
 {limit:LIBRARY_BYTES_MAX, actual:library.bytes, excess:library.bytes-LIBRARY_BYTES_MAX,
  T19:library.of(19)?.kind, T20:library.of(20)?.kind, T51:library.of(51)?.kind, ms:performance.now()-at});
const ordinary = new FormLibrary(binding,[{T:1,type:'endmill',flute_length:20}],1);
runToEnd(ordinary.normalise());
check('control: ordinary library',ordinary.bytes===1024 && ordinary.of(1)?.kind==='param', {bytes:ordinary.bytes});

class Jobs {
  jobs: any[]=[];
  run=(job:any,done:()=>void)=>{
    const j={job,done,cancelled:false,ended:false}; this.jobs.push(j);
    return {promise:new Promise<any>(()=>{}),cancel(){j.cancelled=true;job.return();},get running(){return !j.cancelled&&!j.ended;}};
  };
  step(){const j=this.jobs.find(j=>!j.ended&&!j.cancelled);if(!j)return false;
    if(j.job.next().done){j.ended=true;j.done();}return true;}
  all(){let n=0;while(this.step())if(++n>1000000)throw Error('step bound');}
}
const form=runToEnd(formSteps({type:'endmill',flute_length:20,shaft_diameter:8,oal:60},{},1,1e9));
const key=(T:number)=>({...binding,T,D:6,len:80});
const source=()=>({form,diam:6,len:80,units:1});
for(const scenario of ['private running / new binding','private queued / new binding','private / scene ended','private / still visible']) {
  const jobs=new Jobs(), cache=new ToolShapeCache({run:jobs.run});
  const owners=Array.from({length:ENTRIES_MAX},(_,T)=>cache.acquire(key(T),source()));
  if(!scenario.includes('queued'))jobs.all();
  const h=cache.acquire(key(99),source());let told=0;h.onSettled(()=>told++);
  if(scenario.includes('running'))jobs.step();
  if(scenario.includes('scene'))cache.endScene();else cache.retain(k=>scenario.includes('visible')&&k.T===99);
  const before={state:h.state,waiting:cache.waiting,live:jobs.jobs.filter(j=>!j.cancelled&&!j.ended).length};
  jobs.all();
  const wanted = scenario.includes('visible');
  check(scenario, wanted ? h.state==='ready'&&!!h.shape&&told===1 : h.shape===null&&told===0,
    {before,after:{state:h.state,shape:!!h.shape,told,cacheSize:cache.size}});
  cache.endScene();for(const owner of owners)owner.release();h.release();
}
console.log(JSON.stringify({head:'c0b5c516',results},null,2));
