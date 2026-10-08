import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from '@msgpack/msgpack';
import * as THREE from 'three';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack } from './scrubTrack';
import { epochTermsFor } from './wcsEpochs';
import { programToMachine } from './partFrame';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';

const reports: Record<string, unknown> = {};
const machine: CollisionMachine = {
  groups: [{id:'x',parent:'root'}, {id:'y',parent:'x'}, {id:'head',parent:'y'}, {id:'table',parent:'root'}],
  kinematics: [{group:'x',joint:0,type:'translate',direction:'x',sign:1},
    {group:'y',joint:1,type:'translate',direction:'y',sign:1},
    {group:'head',joint:2,type:'translate',direction:'z',sign:1}],
  workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z'],
};
function cube() {
  const g = new THREE.BoxGeometry(.5,.5,.5).toNonIndexed();
  const p = new Float32Array(g.getAttribute('position').array); g.dispose(); return p;
}
function inspect(name: string) {
  const raw = decode(readFileSync('../evidence/viewer-palette-fest.r100.codex-'+name+'.msgpack')) as Record<string,any>;
  const d = decodePreviewStreams(raw);
  const track = buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
  const obstacle: [number,number,number] = [15,5,15];
  const model = buildCollisionModel(machine,[
    {id:'fixed',group:'table',positions:cube(),translate:obstacle},
    {id:'head',group:'head',positions:cube()},
  ]);
  const wcs = {g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start};
  const result = sweepCollisions(model,{...track,wcs:track.wcsEpoch},wcs,{margin:.1,staleOffsetLines:raw.stale_offset_lines,staleOffsetUntracked:raw.stale_offset_untracked,tloEvents:d.tloEvents,
    epochTerms:d.wcsEvents?.length?epochTermsFor(d.wcsEvents,wcs,undefined):undefined});
  const terms = epochTermsFor(d.wcsEvents!,wcs,undefined);
  const endMachine: number[] = [];
  const i=track.count-1;
  programToMachine(track.pos[3*i]!,track.pos[3*i+1]!,track.pos[3*i+2]!,0,0,0,terms[track.wcsEpoch![i]!]!,endMachine);
  const report = {lines:Array.from(track.lines),pos:Array.from(track.pos),cum:Array.from(track.cum),
    ustart:Array.from(track.ustart??[]),brk:Array.from(track.brk??[]),wcsEvents:d.wcsEvents,endMachine,staleOffsetLines:raw.stale_offset_lines,staleOffsetUntracked:raw.stale_offset_untracked,obstacle,result};
  reports[name] = report;
  writeFileSync('../evidence/viewer-palette-fest.r100.codex-blocks-sweep.json',JSON.stringify(reports,null,2)+'\n');
  return report;
}


it.each(['r100_n_literal','r100_delete_n_literal','r100_n_computed','r100_delete_n_computed','r100_name_plain','r100_trailing_comment'])('%s keeps a foreign write unknown with no invented main-file line',name=>{
 const r=inspect(name);expect(r.ustart.at(-1)).toBe(1);expect(r.staleOffsetLines).toEqual([0]);expect(r.result.hits).toHaveLength(0);
});
it('the N-prefixed local sub keeps its executed G92 and its real file line',()=>{
 const r=inspect('r100_inline_write');expect(r.ustart.at(-1)).toBe(1);expect(r.staleOffsetLines).toEqual([2]);expect(r.result.hits).toHaveLength(0);
});
it('the N-prefixed explicit local offset permits the following known motion',()=>{
 const r=inspect('r100_inline_explicit');expect(r.ustart.at(-1)).toBe(0);expect(r.endMachine[2]).toBeCloseTo(45,5);expect(r.staleOffsetLines).toBeUndefined();
});
it.each(['r100_delete_n_skip','r100_name_local_control','r100_commented_call'])('%s does not invent a dependent write',name=>{
 const r=inspect(name);expect(r.ustart.at(-1)).toBe(0);expect(r.staleOffsetLines).toBeUndefined();expect(r.cum.at(-1)!-r.cum.at(-2)!).toBeCloseTo(1,5);
 if(name==='r100_commented_call')expect(r.staleOffsetUntracked).toBeUndefined();
});
