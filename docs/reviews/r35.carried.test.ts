// Independent R35 checks: actual contact versus a near miss at the line boundary;
// a parked snapshot before a margin-only re-entry changes carriedFrom.
import {test,expect} from 'vitest';
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {buildCollisionModel,sweepCollisions,sweepCollisionsIter,type CollisionMachine,type SnapshotHandle} from '../src/viewer/collision';
import {buildScrubTrack} from '../src/viewer/scrubTrack';
import {clashTargets} from '../src/viewer/clashTargets';
const machine:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'work',parent:'table'},{id:'head',parent:'root',translate:[0,0,50]}],
 kinematics:[{group:'table',joint:0,type:'translate',direction:'x',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],
 workGroup:'work',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
const box=()=>{const g=new THREE.BoxGeometry(10,10,10).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const model=()=>buildCollisionModel(machine,[{id:'vise',group:'table',positions:box()},{id:'spindle',group:'head',positions:box()}]);
const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const track=(z:number[],lines:number[])=>buildScrubTrack({pos:new Float32Array(z.flatMap(v=>[0,0,v])),lines:new Uint32Array(lines),seq:new Uint32Array(lines.map((_,i)=>i+1))},{pos:new Float32Array()})!;
for(const previousContact of [false,true]) test(`R35 the first actual penetration after a margin-only boundary stays a target (earlier penetration: ${previousContact})`,()=>{
 // Contact begins at Z=-40; at Z=-39 there is a 1 mm gap (inside margin 2).
 const z=previousContact?[0,-45,-39,-10,-45,0]:[0,-39,-10,-45,0];
 const lines=previousContact?[25,25,25,26,26,26]:[25,25,26,26,26];
 const result=sweepCollisions(model(),track(z,lines),wcs,{margin:2});
 const targets=clashTargets(result.hits),h=result.hits.find(h=>h.line===26)!;
 writeFileSync(`../evidence/r35.margin-${previousContact?'earlier-contact':'near-only'}.json`,JSON.stringify({z,lines,result,targets},null,2)+'\n');
 expect(h.dist).toBeLessThan(1e-4);expect(h.intervals).toHaveLength(1);
 expect(h.carried).toBeUndefined();expect(h.continuation).toBeUndefined();
 expect(targets.filter(t=>t.line===26).map(t=>t.key)).toEqual(['C26|spindle|vise|0']);
});
test('R35 a snapshot before margin-only re-entry does not freeze the old continuation identity',()=>{
 // L26 first carries real contact from L25, leaves it, then approaches only
 // to Z=-39. Promotion adds carriedFrom without another contact sample.
 const t=track([0,-45,-10,-39],[25,25,26,26]);
 const plain=sweepCollisions(model(),t,wcs,{margin:2});
 const snap:SnapshotHandle={take:null,peek:null,records:null};let tick=0;
 const it=sweepCollisionsIter(model(),t,wcs,{margin:2,snapshot:snap,yieldMs:0,clock:()=>++tick});
 let r=it.next();let parked:any=null;
 while(!r.done){
  if(!parked&&snap.peek&&snap.take){
   const raw=snap.peek();
   // Park only AFTER the first contact was fully left (cum 80 of 109):
   // the later return ends at Z=-39, so it adds no contact samples.
   if((raw.truncated?.covered??0)>=80/109-1e-9&&raw.hits.some(h=>h.line===26&&h.continuation===25&&h.dist<1e-4))parked=snap.take('stopped');
  }
  r=it.next();
 }
 const result=r.value,targets=clashTargets(result.hits);
 writeFileSync('../evidence/r35.parked-promotion.json',JSON.stringify({parked,plain,result,targets},null,2)+'\n');
 expect(parked,'The probe must park after the first contact has been fully left').not.toBeNull();
 expect(parked.truncated.covered).toBeGreaterThanOrEqual(80/109-1e-9);
 expect(result.hits).toEqual(plain.hits);
 expect(result.hits.find(h=>h.line===26)!.carried).toBe(true);
 expect(targets.map(t=>t.key)).toEqual(['C25|spindle|vise|0']);
});
