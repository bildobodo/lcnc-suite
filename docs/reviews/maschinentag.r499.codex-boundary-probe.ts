// R498: both drawing entries must make the same admission decision for one
// JSON metadata object. All values below can occur in a tool_library.json.
import { drawableToolGeometries } from './tree/lcnc-webui/src/toolGeometry';
import { formSteps, rawForm, formMeta } from './tree/lcnc-webui/src/toolForm';
import { runToEnd } from './tree/lcnc-webui/src/viewer/steps';
const shape={type:'endmill',flute_length:20,oal:60,shaft_segments:[{height:16,lower_diameter:12,upper_diameter:6}]};
const result:any[]=[];
function geom(raw:any) {
 let d:any;
 try {
  d=drawableToolGeometries(6,60,raw);
  return {why:d.why,exception:null,parts:[d.cutter,d.shaft].map((g:any)=>g?{
   position:Array.from(g.getAttribute('position').array),index:g.index?Array.from(g.index.array):null}:null)};
 }catch(e){return {why:null,exception:String(e),parts:null};}
 finally{d?.cutter?.dispose();d?.shaft?.dispose();}
}
function check(name:string,meta:any,refused:boolean){
 const record=runToEnd(formSteps(meta,rawForm(meta),1,1e6));
 const live=geom(meta), tab=geom(formMeta(meta,record));
 const same=JSON.stringify(live.parts)===JSON.stringify(tab.parts);
 const passed=(record.kind==='refused')===refused&&!live.exception&&!tab.exception&&same&&(refused?live.why!==null:live.why===null);
 result.push({name,passed,input:meta,record:record.kind,reason:record.refused,liveWhy:live.why,liveException:live.exception,
  tabException:tab.exception,sameGeometry:same,liveVertices:live.parts?.map((p:any)=>p?.position.length/3||0),tabVertices:tab.parts?.map((p:any)=>p?.position.length/3||0)});
}
for(const k of ['flute_length','oal','shoulder_length']) for(const v of [true,false,[],[16],{}])
 check('optional number '+k+'='+JSON.stringify(v),{...shape,[k]:v},true);
for(const k of ['flute_length','oal','shoulder_length']) for(const v of [16,'16',null,''])
 check('optional control '+k+'='+JSON.stringify(v),{...shape,[k]:v},false);
for(const k of ['native_mesh','native_profile','shaft_segments']) for(const v of [false,0,'',{}])
 check('present branch '+k+'='+JSON.stringify(v),{...shape,[k]:v},true);
for(const k of ['native_mesh','native_profile','shaft_segments']) for(const v of [null,[]])
 check('absent branch '+k+'='+JSON.stringify(v),{...shape,[k]:v},false);
for(const v of [{vertices:[]},{triangles:[]},{vertices:[],triangles:[]}])
 check('incomplete/empty mesh '+JSON.stringify(v),{...shape,native_mesh:v},true);
const mesh={vertices:[[0,0,0],[3,0,0],[0,3,9]],triangles:[[0,1,2]]};
check('valid selected mesh, invalid unused shaft',{...shape,native_mesh:mesh,shaft_segments:{bad:true}},false);
check('valid selected native profile, invalid unused shaft',{...shape,native_profile:[[0,0],[3,0],[3,9],[0,9]],shaft_segments:{bad:true}},false);
console.log(JSON.stringify({head:process.env.REVIEW_HEAD??'c0b5c516',results:result,summary:{total:result.length,pass:result.filter(r=>r.passed).length,fail:result.filter(r=>!r.passed).length}},null,2));
