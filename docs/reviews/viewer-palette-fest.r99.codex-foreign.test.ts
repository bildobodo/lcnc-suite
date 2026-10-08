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
  const raw = decode(readFileSync('../evidence/viewer-palette-fest.r99.codex-'+name+'.msgpack')) as Record<string,any>;
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
  writeFileSync('../evidence/viewer-palette-fest.r99.codex-foreign-sweep.json',JSON.stringify(reports,null,2)+'\n');
  return report;
}


it('a foreign call with spaced keyword must not use a main-file explicit write to clear the real write',()=>{
 const r=inspect('r98_foreign_collision_spaced');expect(r.ustart.at(-1)).toBe(1);expect(r.result.hits.some(h=>h.line===7)).toBe(false);
});
it('the ordinary spelling keeps the foreign write unknown',()=>{
 const r=inspect('r98_foreign_collision_plain');expect(r.ustart.at(-1)).toBe(1);expect(r.result.hits).toHaveLength(0);
});
it('foreign line 2 must not be attributed to unrelated main-file line 2',()=>{
 const r=inspect('r98_foreign_collision_plain');expect(r.staleOffsetLines??[]).not.toContain(2);
});
it('the observable position control follows Z5, not the preview false path on Z15',()=>{
 const r=inspect('r98_foreign_collision_position_control');expect(r.ustart.at(-1)).toBe(0);expect(r.endMachine[2]).toBeCloseTo(5,5);expect(r.result.hits.some(h=>h.line===7)).toBe(false);
});
