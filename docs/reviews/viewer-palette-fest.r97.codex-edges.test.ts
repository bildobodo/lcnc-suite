import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from '@msgpack/msgpack';
import * as THREE from 'three';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack } from './scrubTrack';
import { epochTermsFor } from './wcsEpochs';
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
function inspect(name: string, passEpochs = true) {
  const raw = decode(readFileSync('../evidence/viewer-palette-fest.r97.codex-'+name+'.msgpack')) as Record<string,any>;
  const d = decodePreviewStreams(raw);
  const track = buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
  const obstacle: [number,number,number] = name.includes('cycle') ? [15,5,40] : [6.0355339059,13.1066017178,15];
  const model = buildCollisionModel(machine,[
    {id:'fixed',group:'table',positions:cube(),translate:obstacle},
    {id:'head',group:'head',positions:cube()},
  ]);
  const wcs = {g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start};
  const result = sweepCollisions(model,{...track,wcs:passEpochs ? track.wcsEpoch : undefined},wcs,{margin:.1,staleOffsetLines:raw.stale_offset_lines,staleOffsetUntracked:raw.stale_offset_untracked,tloEvents:d.tloEvents,
    epochTerms:d.wcsEvents?.length?epochTermsFor(d.wcsEvents,wcs,undefined):undefined});
  const report = {lines:Array.from(track.lines),pos:Array.from(track.pos),cum:Array.from(track.cum),
    ustart:Array.from(track.ustart??[]),brk:Array.from(track.brk??[]),wcsEvents:d.wcsEvents,obstacle,result};
  reports[name + (passEpochs ? '' : '_without_wcs')] = report;
  writeFileSync('../evidence/viewer-palette-fest.r97.codex-edges-sweep.json',JSON.stringify(reports,null,2)+'\n');
  return report;
}
for (const name of ['r94_g98_cycle','r94_rotated_after_partial']) {
  it(name+': the following move still starts from an unknown coordinate',()=>{
    const r = inspect(name);
    expect(r.ustart.at(-1),'G98 restores the stale initial height; a new rotation mixes in stale Y').toBe(1);
    expect(r.cum.at(-1),'no time assigned to an unconfirmed path').toBe(0);
    expect(r.result.hits,'no collision on the unconfirmed following path').toHaveLength(0);
  });
}
for (const name of ['r94_g99_cycle','r94_unrotated_after_partial','r94_rotated_complete']) {
  it(name+': a confirmed final position permits the next move',()=>{
    const r = inspect(name);
    expect(r.ustart.at(-1)).toBe(0);
    expect(r.cum.at(-1)!-r.cum.at(-2)!).toBeCloseTo(1,5);
  });
}

it('G98 position control: a visible move to the tool-change position returns to Z30',()=>{
  const r=inspect('r94_g98_cycle_position_control');
  expect(r.pos.at(-1)).toBe(30);
  expect(r.result.hits.some(h=>h.line===6)).toBe(false);
  expect(r.result.uncertified).toBeNull();
});
it('rotation position control: a visible move gives the next X move its actual distance',()=>{
  const r=inspect('r94_rotated_after_partial_position_control');
  expect(r.cum.at(-1)!-r.cum.at(-2)!).toBeCloseTo((Math.sqrt(450)-20)/10,5);
  expect(r.result.uncertified).toBeNull();
});

it('the page-style WCS mapping finds an obstacle on the known rotated L7 path',()=>{
 expect(inspect('r94_rotated_complete').result.hits.some(h=>h.line===7)).toBe(true);
});
it('negative control: without that WCS mapping the same obstacle is missed',()=>{
 expect(inspect('r94_rotated_complete',false).result.hits.some(h=>h.line===7)).toBe(false);
});
