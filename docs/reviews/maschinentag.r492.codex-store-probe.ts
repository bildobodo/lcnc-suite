import { ToolTableStore } from './tree/lcnc-webui/src/toolTableStore';
import { runToEnd } from './tree/lcnc-webui/src/viewer/steps';
const results:any[]=[];
function check(name:string,ok:boolean,evidence:unknown){results.push({name,verdict:ok?'PASS':'FAIL',evidence});}
const table={path:'/table',instance:'one'};
const mesh={vertices:[[0,0,0],[1,0,0],[0,1,1]],triangles:[[0,1,2]]};
const row={T:1,P:1,D:6,Z:40,remark:'first'};
function reply(same=false,t=table,remark='first',T=1){return {ok:true,tools:[{...row,T,remark,type:'formmill',...(same?{}:{native_mesh:structuredClone(mesh)})}],table:t,rev:{table:remark,library:'L1'},library:{rev:'L1',state:same?'same':'full'},proof:{state:'complete',proven:[T],missing:[],differs:[],extra:[],duplicates:[]},unread:[],edit_refusal:null};}
let next:any=reply(), calls:any[]=[];
const jobs:any[]=[];
const store=new ToolTableStore({ask:async have=>{calls.push(have);return typeof next==='function'?next(have):next;},units:()=>1,
 inlineMs:0,run:(job:any)=>{const j={job,cancelled:false};jobs.push(j);return {promise:new Promise(()=>{}),cancel(){j.cancelled=true;job.return();},get running(){return !j.cancelled;}};},onCurrent(){},onForms(){}});
const finish=()=>{for(const j of jobs.splice(0))if(!j.cancelled)runToEnd(j.job);};
async function main(){
 store.opened();await store.read();finish();
 const form=store.formOf(1);
 check('full reply: mesh record, raw payload absent from current rows',form?.kind==='mesh'&&!('native_mesh' in store.current.view!.rows[0]),{kind:form?.kind,recordBody:store.record.decide(row)?.body});
 next=reply(true,table,'new comment');await store.read();finish();
 check('same reply: current text, shared form, paired body',store.current.view?.rows[0].remark==='new comment'&&store.formOf(1)===form&&store.record.decide(row)?.body==='envelope',{calls:[...calls],remark:store.current.view?.rows[0].remark});
 const keys=JSON.stringify(store.record.keys);next={ok:false,error:'read failed'};await store.read();
 check('failure: empty current view and identity, historic proof unchanged',store.current.view?.kind==='failed'&&store.current.table===null&&store.current.view.rows.length===0&&JSON.stringify(store.record.keys)===keys&&store.record.decide(row)?.body==='envelope',{kind:store.current.view?.kind,keys:store.record.keys,table:store.current.table});
 store.closed();
 check('close: current and evidence cleared',store.current.view===null&&store.record.binding===null,{current:store.current.view,binding:store.record.binding});
 store.opened();next=reply(true);await store.read();finish();
 check('reconnect: same content is proven anew',store.formOf(1)===form&&store.record.decide(row)?.body==='envelope',{body:store.record.decide(row)?.body});
 const from=calls.length;
 next=(have:any)=>reply(!!have,{path:'/other',instance:'two'},'second');await store.read();finish();
 check('different identity: unresolved same replaced by exactly one full read',JSON.stringify(calls.slice(from))===JSON.stringify(['L1',null])&&store.current.table?.instance==='two',{calls:calls.slice(from),table:store.current.table});
 const missing=store.record.decide({...row,T:99});
 check('missing form says shape not read',missing?.why==='shape not read',{actual:missing?.why,body:missing?.body,warns:missing?.warns});
 store.closed();console.log(JSON.stringify({head:'e8d99b0c',results},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
