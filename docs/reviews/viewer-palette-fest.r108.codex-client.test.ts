import fs from 'node:fs';
import * as THREE from 'three';
import { decode } from '@msgpack/msgpack';
import { it, expect } from 'vitest';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, buildEntryTrack } from './scrubTrack';
import { epochTermsFor } from './wcsEpochs';
import { parseProbeStops, m600Events, m600ToolNotes, m600StatsText } from './probeStop';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
const ev='/tmp/codex-r108-nsubpv33/evidence/';
function load(n:string){
 const raw=decode(fs.readFileSync(ev+n+'.msgpack')) as Record<string,any>;
 const d=decodePreviewStreams(raw),t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 return {raw,d,t};
}
const XYZ:CollisionMachine={groups:[{id:'x',parent:'root'},{id:'y',parent:'x'},{id:'head',parent:'y'},{id:'table',parent:'root'}],kinematics:[{group:'x',joint:0,type:'translate',direction:'x',sign:1},{group:'y',joint:1,type:'translate',direction:'y',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
function sweep(n:string,p:[number,number,number]){
 const {raw,d,t}=load(n),wcs={g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start} as any;
 const cube=()=>new Float32Array(new THREE.BoxGeometry(.5,.5,.5).toNonIndexed().getAttribute('position').array);
 const model=buildCollisionModel(XYZ,[{id:'fixed',group:'table',positions:cube(),translate:p},{id:'head',group:'head',positions:cube()}]);
 const result=sweepCollisions(model,{...t,wcs:t.wcsEpoch},wcs,{margin:.1,tloEvents:d.tloEvents,probeStops:parseProbeStops(raw.probe_unpredicted),epochTerms:d.wcsEvents?.length ? epochTermsFor(d.wcsEvents,wcs,undefined) : undefined,staleOffsetLines:raw.stale_offset_lines,staleOffsetUntracked:raw.stale_offset_untracked});
 return {raw,t,result};
}
it('R108: near-integer callers have per-occurrence interpreter lines',()=>{
 const pair=load('near_call_pair').raw,single=load('near_call_single').raw;
 const events=m600Events(parseProbeStops(pair.probe_unpredicted),pair.toollen_table,'mm'),stats=m600StatsText(events,'mm');
 expect(pair.tool_change_lines).toEqual([[3,2],[5,1]]);expect(events.map(e=>e.line)).toEqual([3,5]);expect(m600ToolNotes(events).unbound).toHaveLength(0);
 expect(single.tool_change_lines).toEqual([[3,2]]);expect(single.toollen_table[0][3]).toBe(3);
 fs.writeFileSync(ev+'caller.json',JSON.stringify({events,stats,single:single.toollen_table},null,2)+'\n');
});
it('R108 nested foreign M600 is omitted before its first move',()=>{
 const r=sweep('foreign_remap_nested',[50,50,-50]);
 expect(r.raw.probe_unpredicted[0][2]).toBe('foreign_remap');expect(r.result.hits).toHaveLength(0);expect(r.t.cum[r.t.count-1]).toBe(0);
 const {raw,t}=load('unknown_first');
 const entry=buildEntryTrack(t,[0,0,0],['X','Y','Z'],{g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start} as any);
 expect(entry).toBeNull();
 fs.writeFileSync(ev+'coverage.json',JSON.stringify({nested:{stop:r.raw.probe_unpredicted,cum:[...r.t.cum],ustart:[...r.t.ustart!],unpredicted:[...r.t.unpredicted!],hits:r.result.hits,notes:r.result.notes},entry},null,2)+'\n');
});
it('R108 negated G-code expressions keep the stored-position caveat',()=>{
 const pairs=[['store_control','store_negative',[10,0,40]],['inactive_control','inactive_negative',[25,5,55]]] as const;
 const observations=[];
 for(const [control,other,pos] of pairs){
  const a=sweep(control,[...pos]),b=sweep(other,[...pos]);
  const pick=(r:typeof a)=>({stale:r.raw.stale_offset_lines,ustart:[...r.t.ustart!],lines:[...r.t.lines],cum:[...r.t.cum],hits:r.result.hits,uncertified:r.result.uncertified,notes:r.result.notes});
  observations.push({control,a:pick(a),other,b:pick(b)});
  expect(a.raw.stale_offset_lines).toEqual([4]);expect(b.raw.stale_offset_lines).toEqual([4]);
  expect(a.result.hits).toHaveLength(0);expect(b.result.hits).toHaveLength(0);expect(b.t.cum[b.t.count-1]).toBe(0);
 }
 fs.writeFileSync(ev+'negative-sweep.json',JSON.stringify(observations,null,2)+'\n');
});

it('R108 a named call inside another remap gets its true invoking line',()=>{
 const {raw}=load('sequence_named_body');
 const events=m600Events(parseProbeStops(raw.probe_unpredicted),raw.toollen_table,'mm');
 const stats=m600StatsText(events,'mm');
 expect(raw.tool_change_lines).toEqual([[3,2]]);expect(events[0]!.line).toBe(3);
 expect(stats).toContain('(L3)');
 fs.writeFileSync(ev+'sequence-client.json',JSON.stringify({events,stats,tool_change_lines:raw.tool_change_lines},null,2)+'\n');
});

it('R108 observation: an explicit write on the invoking line suppresses the remap body write',()=>{
 const pick=(name:string)=>{
  const r=sweep(name,[15,5,45]);
  return {name,stale:r.raw.stale_offset_lines,ustart:[...r.t.ustart!],lines:[...r.t.lines],cum:[...r.t.cum],hits:r.result.hits,notes:r.result.notes};
 };
 const same=pick('explicit_same_block'),separate=pick('explicit_separate_blocks'),alone=pick('remap_only');
 expect(same.stale).toBeFalsy();expect(same.hits.length).toBeGreaterThan(0);expect(same.cum.at(-1)).toBe(1);
 expect(separate.stale).toEqual([5]);expect(separate.hits).toHaveLength(0);expect(separate.cum.at(-1)).toBe(0);
 expect(alone.stale).toEqual([4]);expect(alone.hits).toHaveLength(0);
 fs.writeFileSync(ev+'same-block-sweep.json',JSON.stringify({same,separate,alone},null,2)+'\n');
});
