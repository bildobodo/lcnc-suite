// Codex R144 independent contract probes. Run only in the archive copy.
import { describe, expect, it } from 'vitest';
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from './collision';
import { boxPositions } from './collisionFixtures';
import { ContactStore, NONE, GAP_TOOL_UNKNOWN, IV_ENDED_AT_GAP } from './contactStore';
import { entryJoins } from './contactMerge';
import { emptyLineIndex } from './lineIndex';
const W={g5x:[],g92:[],rotationDeg:0};
const M:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'part',parent:'table'},{id:'head',parent:'root'}],kinematics:[{group:'head',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'part',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
function run(xs:number[],rapid:number[],toolIndices:number[],stock=false){
 const n=xs.length,cum=new Float32Array(n); for(let i=1;i<n;i++)cum[i]=cum[i-1]!+Math.abs(xs[i]!-xs[i-1]!);
 const t={pos:new Float32Array(xs.flatMap(x=>[x,0,0])),abc:new Float32Array(n*3),lines:Uint32Array.from(xs.map((_,i)=>i+1)),rapid:new Uint8Array(rapid),cum,count:n,tlo:new Uint32Array(toolIndices),lineIndex:emptyLineIndex(),timeBased:false};
 const model=buildCollisionModel(M,[{id:'vise',group:'table',positions:boxPositions(2,2,2),translate:[0,0,1],stock},{id:'tool',group:'head',positions:toolCylinderPositions(20,2),tool:true}]);
 const store=new ContactStore(1,0);
 const result=sweepCollisions(model,t,W,{margin:.1,tloEvents:[{seq:0,xyz:[0,0,0],tool:1},{seq:1,xyz:[0,0,0],tool:3},{seq:2,xyz:[0,0,0],tool:1}],toolDims:{1:{diam:20,len:2}},liveTool:1,unknownTools:[3],contacts:{store}});
 const rows=(tab:any)=>Array.from({length:tab.rows},(_,i)=>Object.fromEntries(tab.schema.map(([k]:any)=>[k,tab.get(i,k)])));
 console.log(JSON.stringify({case:{xs,rapid,toolIndices,stock},episodes:rows(store.episodes),intervals:rows(store.intervals),gaps:rows(store.gaps),hits:result.hits.map(h=>({line:h.line,intervals:h.intervals})),notes:result.notes}));
 return {store,result,t};
}
describe('R144 contact store own probes',()=>{
 it('unknown tool without preceding episode still records its knowledge gap',()=>{
  const {store,result}=run([20,15,5],[1,1,1],[0,1,2]);
  expect(result.notes?.some(n=>n.includes('no length'))).toBe(true);
  expect(Array.from({length:store.gaps.rows},(_,i)=>store.gaps.get(i,'reason'))).toContain(GAP_TOOL_UNKNOWN);
 });
 it('after an unknown tool a previous muted feed contact does not hide a new rapid collision',()=>{
  const {store,result}=run([20,5,4,3],[0,0,1,1],[0,0,1,2],true);
  expect(result.hits.some(h=>h.line===4)).toBe(true);
  expect(store.intervals.rows).toBeGreaterThan(0);
 });
 it('rapid feed rapid: the second rapid part does not reach back across the feed',()=>{
  const {store,t}=run([20,5,4,3],[1,1,0,1],[0,0,0,0],true);
  expect(store.intervals.rows).toBe(2);
  expect(store.intervals.get(1,'enter')).toBeGreaterThanOrEqual(t.cum[2]!-1e-3);
 });
 it('entry join does not use an old contact ended at a tool-unknown gap',()=>{
  const entry=new ContactStore(1,0),base=new ContactStore(2,0);
  entry.episodes.append({pair:0,firstIv:0,ivCount:1,onset:1,end:2});
  entry.intervals.append({episode:0,enter:1,exit:NaN,flags:IV_ENDED_AT_GAP,next:NONE,witness:1,freeAt:NaN});
  entry.gaps.append({pair:0,start:2,end:9,reason:GAP_TOOL_UNKNOWN});
  entry.episodes.append({pair:0,firstIv:1,ivCount:1,onset:9,end:NaN});
  entry.intervals.append({episode:1,enter:9,exit:NaN,next:NONE,witness:9,freeAt:NaN});
  base.episodes.append({pair:0,firstIv:0,ivCount:1,onset:0,end:NaN});
  base.intervals.append({episode:0,enter:0,exit:NaN,next:NONE,witness:0,freeAt:NaN});
  const joins=[...entryJoins(entry,base)]; console.log(JSON.stringify({entry_join_across_gap:joins}));
  expect(joins).toEqual([[0,1]]);
 });
 it('entry join never bridges an already proved free point near a long entry endpoint',()=>{
  const entry=new ContactStore(1,0),base=new ContactStore(2,0);
  entry.episodes.append({pair:0,firstIv:0,ivCount:1,onset:900,end:999.5});
  entry.intervals.append({episode:0,enter:900,exit:999.5,next:NONE,witness:990,freeAt:999.75});
  base.episodes.append({pair:0,firstIv:0,ivCount:1,onset:0,end:NaN});
  base.intervals.append({episode:0,enter:0,exit:NaN,next:NONE,witness:0,freeAt:NaN});
  const joins=[...entryJoins(entry,base)];console.log(JSON.stringify({entry_join_after_proven_separation:joins}));
  expect(joins).toEqual([]);
 });
});
it('budget stop during re-sampling begins at the first unwritable finding, not the later outer sample',()=>{
 const fixed=new Float32Array([...boxPositions(1,4,4),...boxPositions(1,4,4,3)]);
 const machine:CollisionMachine={...M,toolGroup:'head'};
 const make=()=>buildCollisionModel(machine,[{id:'fixed',group:'table',positions:fixed},{id:'moving',group:'head',positions:boxPositions(1,4,4)}]);
 const t={pos:new Float32Array([-20,0,0,20,0,0]),abc:new Float32Array(6),lines:new Uint32Array([1,2]),rapid:new Uint8Array([1,1]),cum:new Float32Array([0,40]),count:2};
 const full=new ContactStore(1,0),small=new ContactStore(1,0,{episodes:100,intervals:1,gaps:100});
 sweepCollisions(make(),t,W,{margin:.1,contacts:{store:full}});
 const r=sweepCollisions(make(),t,W,{margin:.1,contacts:{store:small}});
 expect(full.intervals.rows).toBeGreaterThan(1);
 const missing=full.intervals.get(1,'witness');
 console.log(JSON.stringify({budget_resampling:{missingWitness:missing,incompleteFrom:r.incompleteFrom,truncated:r.truncated,rows:small.intervals.rows}}));
 expect(r.truncated?.reason).toBe('budget');
 expect(r.incompleteFrom).toBeLessThanOrEqual(missing);
});
