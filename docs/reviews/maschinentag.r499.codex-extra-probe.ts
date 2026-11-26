// R499: re-admission, cache identity/unit and a drawing job's error exit.
import { drawableToolGeometries } from './tree/lcnc-webui/src/toolGeometry';
import { admitToolMeta, formMeta, formSteps, rawForm, ROW_BYTES_MAX } from './tree/lcnc-webui/src/toolForm';
import { ToolShapeCache } from './tree/lcnc-webui/src/toolShapeCache';
import { runToEnd } from './tree/lcnc-webui/src/viewer/steps';
const results:any[]=[];
const check=(name:string,ok:boolean,evidence:any)=>results.push({name,verdict:ok?'PASS':'FAIL',evidence});
function drawn(m:any,u=1,d=6,l=60){
 const g=drawableToolGeometries(d,l,m,u);
 const out={why:g.why,shape:JSON.stringify([g.cutter,g.shaft].map(x=>x?{p:Array.from(x.getAttribute('position').array),i:x.index?Array.from(x.index.array):null}:null))};
 g.cutter?.dispose();g.shaft?.dispose();return out;
}
const rows:any[]=[{}, {type:'endmill',flute_length:'20',oal:60,shaft_segments:[{height:'16',lower_diameter:12,upper_diameter:6}]},
 {native_mesh:{vertices:[[0,0,0],[3,0,0],[0,3,9]],triangles:[[0,1,2]]}},
 {native_profile:[[0,0],[3,0],[3,9],[0,9]]},
 {type:'formmill',profile:[{end:[0,0]},{end:[3,0]},{end:[3,9],arc:true,center:[0,4.5]},{end:[0,9]}]},
 {type:'endmill',oal:true}];
for(const u of [1,1/25.4]) for(const raw of rows){
 const a=admitToolMeta(raw,u),b=admitToolMeta(a.meta as any,u);
 const live=drawn(raw,u),tab=drawn(a.meta,u);
 const refused=a.record.kind==='refused';
 // Refusal is carried by the caller's record/note; the stripped fallback metadata
 // itself now describes a cylinder and need not carry the original refusal.
 check('readmit '+a.record.kind+' unit '+u,live.shape===tab.shape&&(refused?b.record.kind==='none':a.record.kind===b.record.kind&&a.record.bytes===b.record.bytes&&a.record.mesh===b.record.mesh&&a.record.profile===b.record.profile),
 {first:a.record.kind,second:b.record.kind,bytes:[a.record.bytes,b.record.bytes],liveWhy:live.why,tabWhy:tab.why});
}
let reads=0;
const raw=rows[1],watched=new Proxy(raw,{get(t,k,r){reads++;return Reflect.get(t,k,r);},ownKeys(t){reads++;return Reflect.ownKeys(t);}});
const a=drawn(watched),first=reads;
const b=drawn(watched,1,8,80),repeat=reads;
const c=drawn(watched,1/25.4),other=reads;
drawn(watched,1/25.4);const otherRepeat=reads;
drawn(watched);const again=reads;
check('one admission per object and unit, diameter/length still redraw',first>0&&repeat===first&&other>repeat&&otherRepeat===other&&again===other&&a.shape!==b.shape,{first,repeat,other,otherRepeat,again});
check('fresh object has fresh geometry',drawn({...raw,flute_length:5}).shape!==a.shape,{});
const boom=new Proxy({type:'endmill'},{get(t,k){if(k==='native_mesh')throw Error('r499 admission');return (t as any)[k];}});
check('admission exception names the cylinder',drawn(boom).why==='shape not drawn: r499 admission'&&drawn(boom).shape===drawn(null).shape,{});
const huge=drawn({type:'endmill',shaft_diameter:1e39});
check('admitted finite number whose drawing fails names the cylinder',huge.why==='shape not usable: a profile point'&&huge.shape===drawn(null).shape,{why:huge.why});
const noCylinder=drawn(null,1,6,1e39);
check('failed cylinder is named and draws nothing',!!noCylinder.why&&noCylinder.shape==='[null,null]',{why:noCylinder.why});
// Inject an unexpected draw error after a normally admitted source record.
const record=runToEnd(formSteps(rows[2],rawForm(rows[2]),1,ROW_BYTES_MAX));
const badForm={...record,mesh:new Proxy(record.mesh!,{get(t,k){if(k==='pos')throw new Error('r499 drawing job');return (t as any)[k];}})};
const jobs:any[]=[];const traces:any[]=[];
const cache=new ToolShapeCache({run(job,done){jobs.push({job,done});return {promise:new Promise(()=>{}),cancel(){job.return(undefined);},running:true};},trace(e,f){traces.push([e,f]);}});
const h=cache.acquire({path:'/test',instance:'one',rev:'one',T:1,D:6,len:60,units:1},{form:badForm,diam:6,len:60,units:1});
let told=0;h.onSettled(()=>told++);
for(const j of jobs){runToEnd(j.job);j.done();}
check('unexpected draw error ends cache job as refused and notifies once',h.state==='refused'&&h.why==='shape not usable'&&h.shape===null&&told===1,{state:h.state,why:h.why,told,traces});
h.release();cache.endScene();
console.log(JSON.stringify({head:'c0b5c516',results},null,2));
