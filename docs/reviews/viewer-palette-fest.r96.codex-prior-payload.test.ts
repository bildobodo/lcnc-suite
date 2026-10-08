import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {decode} from '@msgpack/msgpack';
import * as THREE from 'three';
import {buildScrubTrack,type ScrubStream} from './scrubTrack';
import {parseTloEvents} from './tloEvents';
import {eventIdxFor,EVENT_NONE} from './eventIndex';
import {buildCollisionModel,sweepCollisions,type CollisionMachine} from './collision';

const evidence:Record<string,unknown>={};
const save=()=>writeFileSync('../evidence/viewer-palette-fest.r96.codex-native-sweep.json',JSON.stringify(evidence,null,2)+'\n');
const load=(name:string)=>{
 const wire=decode(readFileSync('../evidence/viewer-palette-fest.r96.codex-'+name+'.msgpack')) as Record<string,any>;
 const arr=(key:string,ctor:any)=>wire[key] instanceof Uint8Array ? new ctor(Uint8Array.from(wire[key]).buffer) : undefined;
 const events=parseTloEvents(wire.tlo_events);
 const stream=(prefix:string):ScrubStream=>{
  const seq=arr(prefix+'_seq',Uint32Array);
  return {pos:arr(prefix,Float32Array)??new Float32Array(),lines:arr(prefix+'_lines',Uint32Array),seq,
   abc:arr(prefix+'_abc',Float32Array),tcum:arr(prefix+'_tcum',Float32Array),
   brk:arr(prefix+'_brk',Uint8Array),ustart:arr(prefix+'_ustart',Uint8Array),
   tlo:eventIdxFor(seq,events?.map(e=>e.seq),EVENT_NONE)};
 };
 return {wire,events,track:buildScrubTrack(stream('feed'),stream('rapid'),undefined,undefined,undefined,events)!};
};
const machine:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'head',parent:'root'}],
 kinematics:[{group:'head',joint:2,type:'translate',direction:'z',sign:1}],
 workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
const positions=()=>{const g=new THREE.BoxGeometry(2,2,2).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const model=(z=500)=>buildCollisionModel(machine,[
 {id:'fixed',group:'table',positions:positions(),translate:[0,0,z]},
 {id:'head-shell',group:'head',positions:positions()},
]);
const sweep=(name:string,z=500)=>{
 const {wire,events,track}=load(name);
 const result=sweepCollisions(model(z),track,{g5x:[],g92:[],rotationDeg:0,tool:wire.tlo_start},{margin:.1,staleOffsetLines:wire.stale_offset_lines,staleOffsetUntracked:wire.stale_offset_untracked,tloEvents:events});
 evidence[name]={result,lines:Array.from(track.lines),cum:Array.from(track.cum),brk:Array.from(track.brk??[]),ustart:Array.from(track.ustart??[])};save();return {result,track};
};
for(const name of ['r92_m6_feed','r92_m6_feed_then_rapid','r92_m6_arc','r92_m6_g43_feed']) {
 it(name+': a native unknown M6 start reaches the sweep as an explicit caveat',()=>{
  const {result}=sweep(name);
  expect(result.uncertified,'TOOL_CHANGE_POSITION made this start unknown; the payload must not certify a guessed feed/arc').not.toBeNull();
 });
}
it('known native G43 movement has its true time and finds the obstacle between free endpoints',()=>{
 const {result,track}=sweep('r92_g43_mid',25);
 expect(Array.from(track.cum)).toEqual([0,0,3]);
 expect(result.uncertified).toBeNull();
 expect(result.hits.some(h=>h.line===4)).toBe(true);
});
it('native unknown rapid after M6 is named and has no invented duration',()=>{
 const {result,track}=sweep('r92_m6_rapid');
 expect(result.uncertified).toContain('1 move after a tool change');
 expect(Array.from(track.cum)).toEqual([0,0]);
});
it('native G49 and repeated G49 preserve zero-time relabels',()=>{
 const {result,track}=sweep('r92_g49_repeat');
 expect(result.uncertified).toBeNull();
 expect(track.cum[0]).toBe(track.cum[1]);expect(track.cum[2]).toBe(track.cum[3]);
 expect(track.cum[4]!-track.cum[3]!).toBeCloseTo(.5,5);
});
