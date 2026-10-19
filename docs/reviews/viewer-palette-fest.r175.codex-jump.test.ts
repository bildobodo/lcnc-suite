import fs from 'node:fs';
import { it, expect } from 'vitest';
import { buildCollisionModel, sweepCollisions, type CollisionMachine, type CollisionTrack } from './collision';
import { boxPositions } from './collisionFixtures';
import { ContactStore } from './contactStore';
import {buildContactView,lineMark,lineRuns,runsOf,trackLineAt} from './contactView';
const machine:CollisionMachine={groups:[{id:'fixed',parent:'root'},{id:'moving',parent:'root'}],kinematics:[{group:'moving',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'fixed',toolGroup:'moving',unitScale:1,axes:['X','Y','Z']};
const wcs:any={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
it('Codex R175: a jump must not certify the old near tail from the new distance',()=>{
 const result:any[]=[];
 for(const endX of [1,2.5])for(const lineSample of [true,false]){
  const xs=[-8]; for(let x=-2;x<endX-1e-5;x+=.5)xs.push(x);xs.push(endX,100,110);
  const n=xs.length,pos=new Float32Array(n*3),cum=new Float32Array(n),brk=new Uint8Array(n);
  for(let i=0;i<n;i++){pos[3*i]=xs[i]!;if(i)cum[i]=cum[i-1]!+(i===n-2?0:xs[i]!-xs[i-1]!);}brk[n-2]=1;
  const track:CollisionTrack={count:n,pos,abc:new Float32Array(n*3),cum,brk,lines:Uint32Array.from({length:n},(_,i)=>10+i),rapid:new Uint8Array(n)};
  const model=buildCollisionModel(machine,[{id:'fixed',group:'fixed',positions:boxPositions(2,20,20)},{id:'moving',group:'moving',positions:boxPositions(2,20,20,0,21.9)}]);
  const store=new ContactStore(1,0);const r=sweepCollisions(model,track,wcs,{margin:2,contacts:{store},lineSample});
  const ends=Array.from({length:store.episodes.rows},(_,k)=>store.episodes.get(k,'end'));
  const reached=Math.max(...ends);const lastLine=[cum[n-4],cum[n-3]];
  const v=buildContactView({sources:[{stores:[store],at:c=>c,ownCoverage:cum[n-1]!}],coverage:cum[n-1]!,pairName:p=>({a:model.bodies[model.pairs[p]![0]]!.id,b:model.bodies[model.pairs[p]![1]]!.id})});
  const mark=lineMark(v,track.lines[n-3]!,runsOf(lineRuns(track),track.lines[n-3]!),trackLineAt(track));
  result.push({endX,lineSample,ends,reached,expectedEnd:cum[n-3],missedTail:cum[n-3]!-reached,lastLine,mark,line:track.lines[n-3],truncated:r.truncated});
 }
 fs.writeFileSync('/tmp/codex-r175-27668dv6/jump.json',JSON.stringify(result,null,2));
 for(const r of result.filter(x=>!x.lineSample)){expect(r.missedTail,JSON.stringify(r)).toBeLessThanOrEqual(.251);expect(r.mark,'last known near line remains marked').toBeTruthy();}
});
