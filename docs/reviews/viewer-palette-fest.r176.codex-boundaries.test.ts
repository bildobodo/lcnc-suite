import fs from 'node:fs';
import {it,expect} from 'vitest';
import {buildCollisionModel,sweepCollisions,type CollisionMachine,type CollisionTrack,type CollisionOptions} from './collision';
import {boxPositions} from './collisionFixtures';
import {ContactStore} from './contactStore';
import {buildContactView,lineMark,lineRuns,runsOf,trackLineAt} from './contactView';
const WCS:any={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const machine:CollisionMachine={groups:[{id:'fixed',parent:'root'},{id:'moving',parent:'root'}],kinematics:[{group:'moving',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'fixed',toolGroup:'moving',unitScale:1,axes:['X','Y','Z']};
const model=()=>buildCollisionModel(machine,[{id:'fixed',group:'fixed',positions:boxPositions(2,20,20)},{id:'moving',group:'moving',positions:boxPositions(2,20,20),translate:[0,21.9,0],tool:true}]);
const extent=2+Math.sqrt(4-1.9**2);
const records:any[]=[];
for(const kind of ['jump','offset','geometry','unknown','double-jump','range'] as const)for(const endX of [1,2.5,3,3.5]){
 it(`Codex R176: ${kind} after X${endX} keeps each proven old near line`,()=>{
  const xs=[-8];for(let x=-2;x<endX-1e-5;x+=.5)xs.push(x);xs.push(endX);
  const last=xs.length-1,jumps=new Set<number>();
  if(kind==='jump'||kind==='range'){jumps.add(xs.length);xs.push(100,110);}
  else if(kind==='double-jump'){jumps.add(xs.length);xs.push(50);jumps.add(xs.length);xs.push(100,110);}
  else xs.push(endX+5,endX+15,endX+25);
  const n=xs.length,pos=new Float32Array(n*3),cum=new Float32Array(n),brk=new Uint8Array(n),tlo=new Uint32Array(n);
  for(let i=0;i<n;i++){pos[i*3]=xs[i]!;if(i)cum[i]=cum[i-1]!+(jumps.has(i)?0:xs[i]!-xs[i-1]!);if(jumps.has(i))brk[i]=1;}
  const opts:CollisionOptions={margin:2,liveTool:1};
  if(kind==='range')opts.range={from:2};
  if(['offset','geometry','unknown'].includes(kind)){
   tlo.fill(1,last+1);
   opts.tloEvents=[{seq:0,xyz:[0,0,0],tool:1},{seq:1,xyz:kind==='offset'?[0,0,50]:[0,0,0],tool:kind==='offset'?1:2}];
   if(kind==='geometry')opts.toolDims={2:{diam:.2,len:2}};
   if(kind==='unknown'){opts.unknownTools=[2];tlo[n-1]=0;}
  }
  const track:CollisionTrack={count:n,pos,abc:new Float32Array(n*3),cum,brk,tlo,lines:Uint32Array.from({length:n},(_,i)=>10+i),rapid:new Uint8Array(n)};
  const m=model(),store=new ContactStore(1,0);const r=sweepCollisions(m,track,WCS,{...opts,contacts:{store}});
  const E=store.episodes;const eps=Array.from({length:E.rows},(_,i)=>Object.fromEntries(E.schema.map(([name])=>[name,E.get(i,name)])));
  const v=buildContactView({sources:[{stores:[store],at:c=>c,ownCoverage:cum[n-1]!}],coverage:cum[n-1]!,pairName:p=>({a:m.bodies[m.pairs[p]![0]]!.id,b:m.bodies[m.pairs[p]![1]]!.id})});
  const checked=[];
  for(let i=kind==='range'?3:1;i<=last;i++){
   const lo=Math.max(xs[i-1]!, -extent),hi=Math.min(xs[i]!,extent);
   if(hi-lo<=.251)continue;
   const line=track.lines[i]!, mark=lineMark(v,line,runsOf(lineRuns(track),line),trackLineAt(track));
   checked.push({line,lo,hi,marked:!!mark});
  }
  records.push({kind,endX,truncated:r.truncated,eps,checked});
  fs.writeFileSync('/tmp/codex-r176-f1ztm26r/boundaries.json',JSON.stringify(records,null,2));
  expect(r.truncated).toBeNull();expect(checked.length).toBeGreaterThan(0);
  expect(checked.filter(x=>!x.marked),JSON.stringify({kind,endX,eps})).toEqual([]);
  // The first episode is the old near stretch; never extend it beyond its
  // confirmed old endpoint when the next geometry is absent/elsewhere.
  const oldEnd=Number.isNaN(eps[0]!.end)?cum[last]!:eps[0]!.end;
  expect(oldEnd).toBeGreaterThanOrEqual(Math.min(endX,extent)+8-.251);
  expect(oldEnd).toBeLessThanOrEqual(cum[last]!+1e-5);
 });
}
