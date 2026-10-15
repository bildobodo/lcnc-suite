import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {buildCollisionModel,sweepCollisions,type CollisionMachine} from './collision';
import {boxPositions} from './collisionFixtures';
import {emptyLineIndex} from './lineIndex';
import {ContactStore,IV_ENDED_AT_FEED} from './contactStore';
import {buildContactView,targetPos,viewWork} from './contactView';
it('a real cutting sweep creates a growing run without free probes and without knowledge gaps',()=>{
 const machine:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'part',parent:'table'},{id:'head',parent:'root',translate:[0,0,50]}],kinematics:[{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'part',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
 const model=buildCollisionModel(machine,[{id:'stock',group:'part',positions:boxPositions(10,10,10),stock:true},{id:'tool',group:'head',positions:boxPositions(10,10,10),tool:true}]);
 const results:unknown[]=[];
 for(const cycles of [32,128]){
  const zs=[0,-43];const rr=[0,1];for(let i=0;i<cycles;i++){zs.push(-44,-43);rr.push(0,1);}
  const n=zs.length,cum=new Float32Array(n);for(let i=1;i<n;i++)cum[i]=cum[i-1]!+Math.abs(zs[i]!-zs[i-1]!);
  const track={pos:Float32Array.from(zs.flatMap(z=>[0,0,z])),abc:new Float32Array(n*3),lines:Uint32Array.from(zs,(_,i)=>i+1),rapid:Uint8Array.from(rr),cum,count:n,lineIndex:emptyLineIndex(),timeBased:false};
  const store=new ContactStore(1,0);const result=sweepCollisions(model,track,{g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0},{margin:2,contacts:{store}});
  expect(result.truncated).toBeNull();
  const iv=store.intervals;let free=0,endedAtFeed=0;for(let i=0;i<iv.rows;i++){if(Number.isFinite(iv.get(i,'freeAt')))free++;if(iv.get(i,'flags')&IV_ENDED_AT_FEED)endedAtFeed++;}
  expect(store.gaps.rows).toBe(0);expect(free).toBe(0);expect(endedAtFeed).toBeGreaterThanOrEqual(cycles);
  const end=cum[n-1]!;
  const v=buildContactView({sources:[{stores:[new ContactStore(1,1)],held:[store],heldCoverage:[end],at:x=>x,ownCoverage:0}],pairName:()=>({a:'tool',b:'stock'}),coverage:end});
  const w0=viewWork.n;targetPos(v,0);const reads=viewWork.n-w0;
  results.push({cycles,episodes:store.episodes.rows,intervals:iv.rows,gaps:store.gaps.rows,free,endedAtFeed,targets:v.n,firstQueryReads:reads});
 }
 console.log('r158 actual sweep without free samples',JSON.stringify(results));
 writeFileSync(`${process.env.R158_OUT ?? '/tmp/codex-r158-af75xrww'}/query.json`,JSON.stringify(results,null,2)+'\n');
});
