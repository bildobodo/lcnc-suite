import * as THREE from 'three';
import { expect,it } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { decode } from '@msgpack/msgpack';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack } from './scrubTrack';
import { buildCollisionModel,sweepCollisions,type CollisionMachine } from './collision';
import { clashTargets } from './clashTargets';
const box=(x:number,y:number,z:number,c:number[])=>{
 const g=new THREE.BoxGeometry(x,y,z).toNonIndexed();g.translate(c[0]!,c[1]!,c[2]!);return new Float32Array(g.attributes.position!.array);
};
const MACHINE:CollisionMachine={
 groups:[{id:'table',parent:'root'},{id:'x',parent:'root'},{id:'y',parent:'x'},{id:'z',parent:'y'}],
 kinematics:[{group:'x',joint:0,type:'translate',direction:'x',sign:1},{group:'y',joint:1,type:'translate',direction:'y',sign:1},{group:'z',joint:2,type:'translate',direction:'z',sign:1}],
 axes:['X','Y','Z'],toolGroup:'z',workGroup:'table',unitScale:1,
};
it('native M600 hull feed cannot certify a cut before the following G0',()=>{
 const raw=decode(readFileSync('../r126.exit.msgpack')) as any;
 const d=decodePreviewStreams(raw);
 const t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 const floor=box(2,2,2,[10,10,-104.6]),wall=box(2,2,120,[14.5,10,-50]);
 const joined=new Float32Array(floor.length+wall.length);joined.set(floor);joined.set(wall,floor.length);
 const doSweep=(floorPresent:boolean,cutting:boolean)=>{
  const model=buildCollisionModel(MACHINE,[
   {id:'obstacle',group:'table',positions:floorPresent?joined:wall,stock:cutting},
   {id:'tool',group:'z',positions:box(2,2,2,[0,0,0]),tool:true},
  ]);
  return sweepCollisions(model,{...t,wcs:t.wcsEpoch},{g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start},{margin:2,tloEvents:d.tloEvents});
 };
 const actual=doSweep(true,true),control=doSweep(false,true),noncut=doSweep(true,false);
 writeFileSync('../r126.codex-native-contact.json',JSON.stringify({program:'G21 G90 / G0 X10 Y50 Z-100 / T2 M600 / G0 X20 Y10 / M2',rawBands:raw.probe_bands,actual,control,noncut,actualTargets:clashTargets(actual.hits),noncutTargets:clashTargets(noncut.hits)},null,2));
 expect(control.hits.some(h=>h.line===4)).toBe(true);
 expect(actual.hits.some(h=>h.line===4)).toBe(true);
});
