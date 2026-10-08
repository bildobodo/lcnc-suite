import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import {it,expect,vi} from 'vitest';
import {buildCollisionModel,sweepCollisions,sweepCollisionsIter,type CollisionMachine,type SnapshotHandle,type CollisionResult} from './collision';
import {mergeShardResults} from './sweepShards';
import {mergeEntryResult} from './sweepMerge';
const ctl=vi.hoisted(()=>({unknown:false}));
vi.mock('./insideCheck',async orig=>{const m=await orig<typeof import('./insideCheck')>();return {...m,pointInside:(...a:Parameters<typeof m.pointInside>)=>ctl.unknown&&a[2].x>18&&a[2].x<19.5?'undecidable' as const:m.pointInside(...a)};});
const box=(s:number)=>{const g=new THREE.BoxGeometry(s,s,s).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array as Float32Array);g.dispose();return p;};
const machine:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'part',parent:'table'},{id:'head',parent:'root',translate:[40,0,0]}],kinematics:[{group:'head',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'part',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
const build=()=>{const outer=box(60),inner=box(40);for(let i=0;i<inner.length;i+=9)for(let k=0;k<3;k++){const x=inner[i+k]!;inner[i+k]=inner[i+3+k]!;inner[i+3+k]=x;}return buildCollisionModel(machine,[{id:'shell',group:'table',positions:new Float32Array([...outer,...inner])},{id:'nub',group:'head',positions:box(1)}]);};
const xs=[-40,...Array.from({length:65},(_,i)=>-20+i*.1)];
const t={count:xs.length,pos:new Float32Array(xs.flatMap(x=>[x,0,0])),abc:new Float32Array(xs.length*3),cum:Float32Array.from(xs,x=>x+40),lines:Uint32Array.from(xs,(_,i)=>i+1),rapid:new Uint8Array(xs.length)};
const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const shape=(r:CollisionResult)=>({hits:r.hits,notes:r.notes,samples:r.samples});
it('refinement-only warning survives repeated snapshots, memo reuse, resume, shards and entry merge',()=>{
 ctl.unknown=true;
 try{
  const base=sweepCollisions(build(),t,wcs,{margin:.1});
  const snap:SnapshotHandle={take:null,peek:null,records:null};const iter=sweepCollisionsIter(build(),t,wcs,{margin:.1,snapshot:snap});
  let r=iter.next();const snapshots:CollisionResult[]=[];
  while(!r.done){if(snap.take&&snap.peek){snapshots.push(snap.take('stopped'));snapshots.push(snap.peek());}r=iter.next();}
  const final=r.value as CollisionResult;
  expect(snapshots.length).toBeGreaterThan(3);
  // Snapshot refinement may differ by floating-point bisection tolerance.
  expect(final.notes).toEqual(base.notes);expect(final.samples).toEqual(base.samples);
  expect(final.hits).toHaveLength(base.hits.length);
  for(let i=0;i<base.hits.length;i++){
   const {intervals: ai,...a}=base.hits[i]!,{intervals:bi,...b}=final.hits[i]!;
   expect(b).toEqual(a);expect(bi).toHaveLength(ai!.length);
   for(let j=0;j<ai!.length;j++)for(let k=0;k<2;k++)expect(bi![j]![k]).toBeCloseTo(ai![j]![k]!,4);
  }
  expect(final.uncertified).toContain('inside check undecidable for nub ↔ shell (L2)');
  const nonempty=snapshots.filter(s=>s.hits.length);expect(nonempty.length).toBeGreaterThan(1);
  expect(nonempty.every(s=>s.uncertified?.includes('nub ↔ shell (L2)'))).toBe(true);
  const shards=[0,1].map(index=>sweepCollisions(build(),t,wcs,{margin:.1,shard:{index,of:2}}));
  const merged=mergeShardResults(shards);expect(merged.notes).toEqual(base.notes);
  const entry={...base,hits:[],notes:['entry-only note'],uncertified:'entry-only note'};
  const both=mergeEntryResult(entry,base,1,t.cum[t.count-1]!);
  expect(both.notes).toContain('entry-only note');expect(both.notes).toContain(base.notes![0]);
  writeFileSync('../evidence/viewer-palette-fest.r102.codex-retention.json',JSON.stringify({base,final,snapshots:snapshots.map(s=>({notes:s.notes,covered:s.truncated?.covered})),shardNotes:merged.notes,entryNotes:both.notes},null,2));
 }finally{ctl.unknown=false;}
});
