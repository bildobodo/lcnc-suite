import fs from 'node:fs';
import * as THREE from 'three';
import { decode } from '@msgpack/msgpack';
import { it, expect } from 'vitest';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, buildEntryTrack } from './scrubTrack';
import { epochTermsFor } from './wcsEpochs';
import { parseProbeStops, m600Events, m600ToolNotes, m600StatsText } from './probeStop';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
const ev='/tmp/codex-r110-zps9xr0e/evidence/';
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
const pick=(name:string,p:[number,number,number]=[15,5,45])=>{
 const r=sweep(name,p);
 return {name,stale:r.raw.stale_offset_lines,tlo:r.raw.tlo_events,ustart:[...r.t.ustart!],lines:[...r.t.lines],cum:[...r.t.cum],hits:r.result.hits,notes:r.result.notes};
};
it('R110: the R109 Python and NGC counterexamples all stay unknown',()=>{
 const names=['explicit_same_block','explicit_separate_blocks','remap_only','listed_same_block','python_explicit_same_block','python_explicit_separate_blocks','python_remap_only','python_listed_same_block','python_line4_explicit_same_block','python_line4_explicit_separate_blocks','python_line4_remap_only','python_line4_listed_same_block'];
 const results=names.map(n=>pick(n));
 for(const r of results){expect(r.stale).toEqual([r.name.includes('separate')?5:4]);expect(r.ustart.at(-1)).toBe(1);expect(r.cum.at(-1)).toBe(0);expect(r.hits).toHaveLength(0);}
 fs.writeFileSync(ev+'fixed-sweep.json',JSON.stringify(results,null,2)+'\n');
});
it('R110: the safe explicit writes alone still have a known path',()=>{
 const results=['explicit_alone','python_explicit_alone','inline_explicit'].map(n=>pick(n,[15,5,15]));
 for(const r of results){expect(r.stale).toBeFalsy();expect(r.ustart.at(-1)).toBe(0);expect(r.cum.at(-1)).toBe(1);expect(r.hits.length).toBeGreaterThan(0);}
 fs.writeFileSync(ev+'explicit-sweep.json',JSON.stringify(results,null,2)+'\n');
});
it('R110 observation: first Python M6+G92 still loses the persistent unknown',()=>{
 const results=['tc_g92_first','tc_g92_g21_first','tc_g92_percent_first','tc_g92_percent_g21_first'].map(n=>pick(n,[15,5,5]));
 fs.writeFileSync(ev+'first-sweep.json',JSON.stringify(results,null,2)+'\n');
 for(const r of results){expect(r.stale).toBeFalsy();expect(r.ustart.at(-1)).toBe(0);expect(r.cum.at(-1)).toBe(1);expect(r.hits.length).toBeGreaterThan(0);}
 fs.writeFileSync(ev+'first-sweep.json',JSON.stringify(results,null,2)+'\n');
});
it('R110: first-remap controls with a line argument or earlier motion stay unknown',()=>{
 const results=['tc_g92_first_line4','tc_g92_percent_first_line4','tc_g92_first_after_move'].map(n=>pick(n,[15,5,5]));
 for(const r of results){expect(r.stale).toEqual([r.name==='tc_g92_first_line4'?1:2]);expect(r.ustart.at(-1)).toBe(1);expect(r.cum.at(-1)).toBe(0);expect(r.hits).toHaveLength(0);}
 fs.writeFileSync(ev+'first-control-sweep.json',JSON.stringify(results,null,2)+'\n');
});
it('R110: record the first G43 remap and controls against two world heights',()=>{
 const results=['g43_first','g43_first_line4','g43_percent_first','g43_percent_first_line4','g43_first_after_move'].map(n=>({name:n,z40:pick(n,[5,0,40]),z50:pick(n,[5,0,50])}));
 for(const r of results){const bad=r.name==='g43_first'||r.name==='g43_percent_first';expect(r.z40.hits.length>0).toBe(bad);expect(r.z50.hits.length>0).toBe(!bad);}
 fs.writeFileSync(ev+'g43-sweep.json',JSON.stringify(results,null,2)+'\n');
});
