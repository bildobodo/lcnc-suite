import { afterAll, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { effectScope, nextTick, ref, shallowRef, watch } from 'vue';
import { ContactStore, NONE } from './contactStore';
import { ContactsReceiver, contactOwners } from './contactsReceiver';
const text=readFileSync(new URL('../ThreeViewer.vue',import.meta.url),'utf8');
const script=text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
const ast=ts.createSourceFile('ThreeViewer.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let owners='',cancel='',cleanupWatch='',release='';
function walk(n:ts.Node){
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='_colContactOwners')owners=n.getText(ast);
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='cancelCollisionCheck')cancel=n.getText(ast);
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='_colReleaseContacts')release=n.getText(ast);
 if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='watch'&&n.getText(ast).includes('_colReleaseContacts()'))cleanupWatch=n.getText(ast);
 ts.forEachChild(n,walk);
}
walk(ast);if(!owners||!cancel||!cleanupWatch||!release)throw Error('actual ownership functions/watch missing');
const code=`
 const _contacts=new ContactsReceiver(); let _colReqId=7,_colResultReq=7,_colSide=null,_colStopPending=false,_colSettleTimer;
 const _colStartedAt=performance.now(),sent=[];const _colWorker={postMessage:m=>sent.push(m)},emitTelemetry=()=>{};
 const collisionResult=shallowRef(withResult?{hits:[]}:null),collisionEntry=shallowRef(null),collisionRunSide=shallowRef(null),collisionSideFirst=shallowRef(null);
 const collisionPartial=shallowRef(withResult?null:{hits:[{line:2}]}),collisionBusy=ref(!withResult),collisionResumable=ref(false),collisionStopped=ref(null),collisionProgress=ref(.5);
 const _pendingContacts=[];
 ${owners}
 ${release}
 ${cleanupWatch}
 ${cancel}
 return {receiver:_contacts,cancel:cancelCollisionCheck,owners:_colContactOwners,setEntry:v=>collisionEntry.value=v,state:()=>({request:_colReqId,result:collisionResult.value,partial:collisionPartial.value,sent})};`;
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const factory=new Function('ContactsReceiver','contactOwners','watch','ref','shallowRef','withResult',js);
const results:Record<string,unknown>={};
afterAll(()=>{ if (process.env.R148_OWNERS_RESULTS) writeFileSync(process.env.R148_OWNERS_RESULTS,JSON.stringify(results,null,2)+'\n'); });
function receive(r:ContactsReceiver,id:number){const s=new ContactStore(id,0);s.episodes.append({pair:0,ordinal:0,onset:0,end:NaN,firstIv:NONE});r.apply({id,contacts:[s.takeDelta()!]});}
for(const shown of [true,false])it(`cancel with ${shown?'a shown result':'only a partial'} preserves exactly the current owners`,async()=>{
 const scope=effectScope(),x=scope.run(()=>factory(ContactsReceiver,contactOwners,watch,ref,shallowRef,shown))!;
 try{receive(x.receiver,7);x.cancel();await nextTick();
  const state={...x.state(),owners:[...x.owners()],held:x.receiver.ids()};results[shown?'resultCancel':'partialCancel']=state;
  expect(state.request).toBe(8);expect(state.partial).toBeNull();
  expect(x.receiver.ids().includes(7)).toBe(shown);
 }finally{scope.stop();}
});
it('positive control: clearing the shown entry without another message releases its table',async()=>{
 const scope=effectScope(),x=scope.run(()=>factory(ContactsReceiver,contactOwners,watch,ref,shallowRef,false))!;
 try{x.setEntry({id:-1});receive(x.receiver,-1);await nextTick();expect(x.receiver.current(-1)).not.toBeNull();x.setEntry(null);await nextTick();expect(x.receiver.current(-1)).toBeNull();}
 finally{scope.stop();}
});
