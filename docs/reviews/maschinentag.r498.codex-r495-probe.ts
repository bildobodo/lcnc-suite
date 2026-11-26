// R495: numeric-boundary and selected-branch checks on the reviewed sources.
// Pure BufferGeometry; no browser, gateway or live status connection.
import { drawableToolGeometries, numericMeta } from './tree/lcnc-webui/src/toolGeometry';
import { formSteps, rawForm, formMeta } from './tree/lcnc-webui/src/toolForm';
import { runToEnd } from './tree/lcnc-webui/src/viewer/steps';
const results:any[]=[];
const pos=(g:any)=>[g.cutter,g.shaft].map(x=>x?{positions:Array.from(x.getAttribute('position').array),index:x.index?Array.from(x.index.array):null}:null);
const same=(a:any,b:any)=>JSON.stringify(pos(a))===JSON.stringify(pos(b));
function check(name:string,raw:any,want:'refuse'|'keep',reference?:any){
 const record=runToEnd(formSteps(raw,rawForm(raw),1,1e6));
 const live=drawableToolGeometries(6,60,raw);
 const tab=drawableToolGeometries(6,60,formMeta(raw,record));
 const ref=drawableToolGeometries(6,60,reference??null);
 const passed=want==='refuse'?record.kind==='refused'&&live.why!==null:record.kind!=='refused'&&live.why===null&&same(live,tab)&&same(live,ref);
 results.push({name,verdict:passed?'PASS':'FAIL',evidence:{kind:record.kind,reason:record.refused,liveWhy:live.why,tabWhy:tab.why,sameTab: same(live,tab),sameReference:same(live,ref)}});
 for(const g of [live,tab,ref]){g.cutter?.dispose();g.shaft?.dispose();}
}
const shank={type:'endmill',flute_length:20,oal:60,shaft_segments:[{height:16,lower_diameter:12,upper_diameter:6}]};
for(const field of ['height','lower_diameter','upper_diameter'])
 check('required shaft '+field+' empty text',{...shank,shaft_segments:[{...shank.shaft_segments[0],[field]:''}]},'refuse');
const form={type:'formmill',profile:[{end:[0,0]},{end:[3,0]},{end:[3,9]},{end:[0,9]}]};
check('required form end empty text',{...form,profile:form.profile.map((s,i)=>i===1?{end:['',0]}:s)},'refuse');
const arc={type:'formmill',profile:[{end:[0,0]},{end:[3,0]},{end:[3,9],arc:true,ccw:true,center:[0,4.5]},{end:[0,9]}]};
check('required form arc center empty text',{...arc,profile:arc.profile.map((s,i)=>i===2?{...s,center:['',4.5]}:s)},'refuse');
check('valid form end decimal',{...form,profile:form.profile.map(s=>({end:s.end.map(String)}))},'keep',form);
check('valid form center decimal',{...arc,profile:arc.profile.map(s=>({...s,end:s.end.map(String),...('center' in s?{center:s.center!.map(String)}:{})}))},'keep',arc);
check('optional scalar empty uses default',{...shank,shoulder_length:''},'keep',shank);

const mesh={type:'endmill',native_mesh:{vertices:[[0,0,0],[3,0,0],[0,3,9]],triangles:[[0,1,2]]}};
const native={type:'endmill',native_profile:[[0,0],[3,0],[3,9],[0,9]]};
for(const [label,chosen] of [['mesh',mesh],['native profile',native]] as const){
 check(label+' ignores unused shaft',{...chosen,shaft_segments:[{height:'0x10',lower_diameter:12,upper_diameter:6}]},'keep',chosen);
 check(label+' ignores unused parametric profile',{...chosen,profile:[{end:[' 3',0]},{end:[3,9]}]},'keep',chosen);
}
check('parametric endmill ignores formmill-only profile',{...shank,profile:[{end:[' 3',0]},{end:[3,9]}]},'keep',shank);

for(const value of ['5','0x5']){
 const raw:any={...shank,holder_segments:[{height:value,lower_diameter:20,upper_diameter:20}]};
 const out=numericMeta(raw),valid=value==='5';
 const shape=drawableToolGeometries(6,60,out),ref=drawableToolGeometries(6,60,shank);
 results.push({name:'holder conversion isolated '+value,verdict:(same(shape,ref)&&shape.why===null&&(valid?out.holder_segments[0].height===5:out.holder_segments===null))?'PASS':'FAIL'});
 for(const g of [shape,ref]){g.cutter?.dispose();g.shaft?.dispose();}
}
console.log(JSON.stringify({head:'a31eb9d6',results},null,2));
