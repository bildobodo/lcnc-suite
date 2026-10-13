// Codex R149: ORIGINAL viewer source selectors -> real table view.
// No worker, machine, live server, or product source modified.
import { afterAll, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { ContactStore, NONE } from './contactStore';
import { buildContactView, contactBands, lineMark, targetAt, tintAt, trackLineAt } from './contactView';
import { shownContactView } from './shownContacts';
const src = readFileSync(new URL('../ThreeViewer.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
const ast=ts.createSourceFile('ThreeViewer.ts',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=['_sliceEnd','_colBaseSpec','_colRunSideSpec','_colViewSpec'];
const fns=names.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(ast)).join('\n');
const prelude=`
 const collisionRun={value:{gen:1}},collisionRunSide={value:null},collisionSideFirst={value:null},collisionEntry={value:null};
 const collisionResult={value:{truncated:null}},collisionTrack={value:base};
 const collisionPartial={value:null},collisionPartialTrack={value:null};
 let _colResultReq=1,_colPartialReq=null,_colReqId=1,_viewProgress=1,_viewSideProgress=progress;
 const _colRunSideBase=()=>null;
 const result={truncated:done&&progress<1?{covered:progress,reason:'budget'}:null};
 if(run){
   if(done)collisionRunSide.value={id:-1,gen:1,base,bound:side,result,shift,sliceEnd};
   else collisionSideFirst.value={id:-1,run:{gen:1},base,entry:side,shift,sliceEnd,first:{}};
 }else{
   if(done)collisionEntry.value={id:-1,base,track:side,result,shift,sliceEnd};
   else collisionSideFirst.value={id:-1,base,entry:side,shift,sliceEnd,first:{}};
 }
`;
const makeSpec=new Function('base','side','run','done','progress','shift','sliceEnd',ts.transpileModule(prelude+fns+'\nreturn _colViewSpec(run?base:side);',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText);
function table(id:number, intervals:Array<[number,number]>) {
 const st=new ContactStore(id,0);
 intervals.forEach(([a,b],k)=>{
   const e=st.episodes.append({pair:0,ordinal:k,onset:a,end:b,closeAt:a,closeDist:0,firstIv:NONE,ivCount:1,flags:0});
   st.episodes.set(e,'firstIv',st.intervals.append({episode:e,enter:a,exit:b,witness:a,freeAt:NaN,next:NONE,flags:0}));
 });
 return {generation:0,stores:[st],pairs:[['tool','work']] as Array<[string,string]>,deltas:1};
}
const base={count:2,cum:[0,5],lines:[5,5]}, side={count:5,cum:[0,2,4,10,15],lines:[21,21,22,23,5]};
const report:Record<string,unknown>={};
afterAll(()=>writeFileSync('/tmp/codex-r149-6y7rrmjw/coverage.json',JSON.stringify(report,null,2)+'\n'));
function inspect(run:boolean,done:boolean,progress:number,baseIvs:Array<[number,number]>=[]) {
 const T=new Map([[1,table(1,baseIvs)],[-1,table(-1,[[1,NaN]])]]);
 const spec=makeSpec(base,side,run,done,progress,10,10);
 const v=shownContactView(id=>T.get(id)??null,spec)!;
 const point=6,line=23;
 return {spec,target:targetAt(v,0,trackLineAt(run?base:side)),n:v.n,
   mark:lineMark(v,line,run?[]:[[4,10]],trackLineAt(run?base:side)),
   tint:[...tintAt(v,point)],bands:contactBands(v,100,run?5:10),
   ownCoverage:v.tables.filter(Boolean).map(t=>({id:t!.st.request,ownCov:t!.ownCov,cov:t!.cov}))};
}
for(const done of [false,true])it(`folded run beginning: ${done?'stopped':'running'} after 20% must not mark a not-yet-swept line`,()=>{
 const r=inspect(true,done,.2);report[done?'runStopped':'runRunning']=r;
 expect.soft(r.target.spanEndLine??r.target.line,'contact observed only through own cum 2 / line21').toBe(21);
 expect(r.mark,'line23 lies on own cum4..10, not swept').toBeNull();
});
it('stopped simulation side: its open contact does not tint the untested remainder',()=>{
 const r=inspect(false,true,.2);report.entryStopped=r;
 expect.soft(r.tint,'own cum6 lies after stop at own cum2').toEqual([]);
 expect.soft(r.bands,'band stops at coverage .2').toEqual([[.1,.2]]);
 expect(r.mark).toBeNull();
});
it('stopped run side: no proof of connection to the base, so do not merge its event into the base contact',()=>{
 const r=inspect(true,true,.2,[[0,3]]);report.stoppedJoin=r;
 expect(r.n,'8 units between the last side observation and the base were never swept').toBe(2);
});
it('control: a complete folded beginning marks its later line and can join to the base',()=>{
 const r=inspect(true,true,1,[[0,3]]);report.completeJoin=r;
 expect(r.mark).not.toBeNull();expect(r.n).toBe(1);
});
it('control: a running simulation side preserves its exact own coverage',()=>{
 const r=inspect(false,false,.2);report.entryRunning=r;
 expect(r.tint).toEqual([]);expect(r.bands).toEqual([[.1,.2]]);expect(r.mark).toBeNull();
});
it('control: the view already supports an exact ownCoverage for a folded source',()=>{
 const s=table(-1,[[1,NaN]]).stores[0]!;
 const v=buildContactView({sources:[{stores:[s],at:c=>Math.max(0,c-10),ownCoverage:2,entry:true,ownTrack:{lineAt:trackLineAt(side),runs:l=>l===23?[[4,10]]:[]}}],pairName:()=>({a:'tool',b:'work'}),coverage:5});
 expect(targetAt(v,0,trackLineAt(base)).spanEndLine).toBeUndefined();
 expect(lineMark(v,23,[],trackLineAt(base))).toBeNull();
});
