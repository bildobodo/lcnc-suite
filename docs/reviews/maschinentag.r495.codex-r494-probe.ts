// R494: pure boundary probes on the actual reviewed source; no browser/VM.
import { FormLibrary, LIBRARY_BYTES_MAX, LIBRARY_FULL } from './tree/lcnc-webui/src/toolLibrary';
import { baseBytes, formSteps, rawForm, formMeta } from './tree/lcnc-webui/src/toolForm';
import { libraryNumber } from './tree/lcnc-webui/src/toolDrawing';
import { toolDrawing, drawableToolGeometries } from './tree/lcnc-webui/src/toolGeometry';
import { runToEnd } from './tree/lcnc-webui/src/viewer/steps';
const results:any[]=[];
function safeDrawing(...args:any[]){try{return toolDrawing(...args as [any,any,any]);}catch(e){return {error:String(e)};}}
function check(name:string,ok:boolean,evidence:any){results.push({name,verdict:ok?'PASS':'FAIL',evidence});}
const binding={path:'/table',instance:'one',units:1,rev:'r'};

// Constructor reserves its single shared refusal. End of normalise must not
// reserve those same bytes twice. This input has no large geometry arrays.
for(const [label,note,n] of [
  ['shortest bases','',65537],
  ['1024-character notes','n'.repeat(1024),21846],
  ['control: largest notes','n'.repeat(1074),21900],
] as const){
  const lib=new FormLibrary(binding,Array.from({length:n},(_,i)=>({T:i+1,type:'ball',geometry_note:note})),1);
  let error:string|null=null;
  try{runToEnd(lib.normalise());}catch(e){error=String(e);}
  const base=baseBytes({geometry_note:note}),own=Math.floor((LIBRARY_BYTES_MAX-LIBRARY_FULL.bytes)/base);
  check(label,error===null&&lib.settled&&lib.bytes===own*base+LIBRARY_FULL.bytes&&lib.of(n)===LIBRARY_FULL,
    {base,rows:n,own,error,settled:lib.settled,bytes:lib.bytes,expectedBytes:own*base+LIBRARY_FULL.bytes,firstOwnKind:lib.of(1)?.kind});
}

for(const value of ['60\n','60\r','60\r\n','60\u2028','60\u2029','60 ',' 60']){
  const form=runToEnd(formSteps({type:'endmill',oal:value},{},1,1e6));
  const out=libraryNumber(value);
  check('strict text '+JSON.stringify(value),Number.isNaN(out)&&form.kind==='refused',
    {value,read:Number.isNaN(out)?'NaN':out,kind:form.kind,refused:form.refused});
}
for(const value of ['60','+60.0','6e1']){
  const form=runToEnd(formSteps({type:'endmill',oal:value},{},1,1e6));
  check('decimal control '+value,libraryNumber(value)===60&&form.scalars.oal===60&&form.kind==='param',
    {value,read:libraryNumber(value),kind:form.kind});
}

// The live marker calls the same drawer with raw tool_meta. Test a nested
// shaft field, not another top-level oal/flute_length example.
for(const value of ['0x10',' 16','16\t','16']){
  const raw:any={type:'endmill',flute_length:20,oal:60,shaft_diameter:6,
    shaft_segments:[{height:value,lower_diameter:12,upper_diameter:6}]};
  const f=runToEnd(formSteps(raw,rawForm(raw),1,1e6));
  const live=drawableToolGeometries(6,60,raw);
  const tab=drawableToolGeometries(6,60,formMeta(raw,f));
  const valid=value==='16';
  check('raw live shaft '+JSON.stringify(value),valid ? live.why===null&&f.kind==='param' : live.why!==null&&f.kind==='refused',
    {value,formKind:f.kind,formReason:f.refused,liveWhy:live.why,tabWhy:tab.why,
     liveHasShape:!!(live.cutter||live.shaft),rawEqualsNumeric:JSON.stringify(safeDrawing(6,60,raw))===JSON.stringify(safeDrawing(6,60,{...raw,shaft_segments:[{height:16,lower_diameter:12,upper_diameter:6}]}))});
  for(const shape of [live,tab]){shape.cutter?.dispose();shape.shaft?.dispose();}
}
console.log(JSON.stringify({head:'a31eb9d6',results},null,2));
