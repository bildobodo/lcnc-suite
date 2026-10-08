import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {decode} from '@msgpack/msgpack';
import * as THREE from 'three';
import {decodePreviewStreams} from '../previewDecode';
import {buildScrubTrack} from './scrubTrack';
import {epochTermsFor} from './wcsEpochs';
import {buildCollisionModel,sweepCollisions,type CollisionMachine} from './collision';

const evidence:Record<string,unknown>={};
const machine:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'head',parent:'root'}],
 kinematics:[{group:'head',joint:2,type:'translate',direction:'z',sign:1}],
 workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
const cube=()=>{const g=new THREE.BoxGeometry(.5,.5,.5).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
function inspect(name:string){
 const raw=decode(readFileSync('../evidence/viewer-palette-fest.r96.codex-'+name+'.msgpack')) as Record<string,any>;
 const d=decodePreviewStreams(raw);
 const track=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 const model=buildCollisionModel(machine,[{id:'fixed',group:'table',positions:cube(),translate:[0,0,39]},{id:'head',group:'head',positions:cube()}]);
 const wcs={g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start};
 const result=sweepCollisions(model,{...track,wcs:track.wcsEpoch},wcs,{margin:.1,staleOffsetLines:raw.stale_offset_lines,staleOffsetUntracked:raw.stale_offset_untracked,tloEvents:d.tloEvents,epochTerms:d.wcsEvents?.length?epochTermsFor(d.wcsEvents,wcs,undefined):undefined});
 const report={lines:Array.from(track.lines),pos:Array.from(track.pos),cum:Array.from(track.cum),ustart:Array.from(track.ustart??[]),rapid:Array.from(track.rapid),result};
 evidence[name]=report;writeFileSync('../evidence/viewer-palette-fest.r96.codex-recovery.json',JSON.stringify(evidence,null,2)+'\n');
 return report;
}
for(const name of ['r93_inline_g91_cycle','r93_separate_g91_cycle','r93_rotated_partial','r93_unrotated_partial']){
 it(name+': no path is treated as known before all required coordinates are re-established',()=>{
  const r=inspect(name);
  expect(r.ustart.slice(1).every(x=>x===1),'a relative move or omitted rotated Y cannot restore the missing position').toBe(true);
  expect(r.cum.at(-1),'no duration inferred from the old position').toBe(0);
  expect(r.result.hits,'no collision attributed to an invented path').toHaveLength(0);
 });
}
for(const name of ['r93_rotated_complete','r93_g90_same_block','r93_g90_separate_block']){
 it(name+': an absolute XYZ target restores the following X move',()=>{
  const r=inspect(name);
  expect(r.ustart.at(-1),'all XYZ values changed in an absolute target before this move').toBe(0);
  expect(r.cum.at(-1)!-r.cum.at(-2)!).toBeCloseTo(1,5);
 });
}

it('r93_inline_g91_g28: the return leg starts at an unknown relative waypoint',()=>{
 const r=inspect('r93_inline_g91_g28');
 // The G28 final endpoint is a reference target; do not assert that the
 // move AFTER reaching it must stay unknown. Its incoming leg starts
 // at the stale G91 intermediate waypoint and must not acquire a duration.
 expect(r.ustart[2]).toBe(1);
 expect(r.cum[2]).toBe(0);
});
