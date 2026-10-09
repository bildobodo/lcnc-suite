import fs from 'node:fs';
import * as THREE from 'three';
import { decode } from '@msgpack/msgpack';
import { it, expect } from 'vitest';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, buildEntryTrack } from './scrubTrack';
import { parseProbeStops, m600ToolNotes, m600Events, m600StatsText } from './probeStop';
import { buildSimRows } from './simRows';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
const ev = '/tmp/codex-r106-pq9gvy45/evidence/';
function load(n:string) {
 const raw=decode(fs.readFileSync(ev+n+'.msgpack')) as Record<string,any>;
 const d=decodePreviewStreams(raw);
 const track=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 return {raw,d,track};
}
it('R106: a stop before the first point prevents the entry move',()=>{
 const {raw,d,track}=load('unknown_first');
 const wcs={g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start} as any;
 const entry=buildEntryTrack(track,[0,0,0],['X','Y','Z'],wcs,undefined,undefined,0,{linear:raw.rapid_rate,rotary:raw.rot_rapid_rate})!;
 const machine:CollisionMachine={groups:[{id:'x',parent:'root'},{id:'y',parent:'x'},{id:'head',parent:'y'},{id:'table',parent:'root'}],kinematics:[{group:'x',joint:0,type:'translate',direction:'x',sign:1},{group:'y',joint:1,type:'translate',direction:'y',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
 const cube=()=>new Float32Array(new THREE.BoxGeometry(1,1,1).toNonIndexed().getAttribute('position').array);
 const model=buildCollisionModel(machine,[{id:'fixed',group:'table',positions:cube(),translate:[30,30,-50]},{id:'head',group:'head',positions:cube()}]);
 const sweep=(t:typeof track)=>sweepCollisions(model,{...t,wcs:t.wcsEpoch},wcs,{margin:0.1,tloEvents:d.tloEvents,probeStops:parseProbeStops(raw.probe_unpredicted)});
 const before=sweep(track);
 const out={stop:raw.probe_unpredicted,base:{count:track.count,ustart:[...track.ustart!],unpredicted:[...track.unpredicted!],cum:[...track.cum],hits:before.hits},entry};
 fs.writeFileSync(ev+'entry.json',JSON.stringify(out,null,2)+'\n');
 expect(track.unpredicted![0]).toBe(1);expect(before.hits).toHaveLength(0);
 expect(entry).toBeNull();expect(track.cum[track.count-1]).toBe(0);
});
it('R106: two unbound T2 measurements stay off both rows, named individually in stats',()=>{
 const {raw,track}=load('repeat_same_tool');
 const events=m600Events(parseProbeStops(raw.probe_unpredicted),raw.toollen_table,'mm');
 const notes=m600ToolNotes(events);const stats=m600StatsText(events,'mm');
 const rows=buildSimRows({clash:[],limit:[],tool:[{key:'T3',line:3,tool:2,cum:1,cumEnd:1},{key:'T6',line:6,tool:2,cum:2,cumEnd:2}],violations:[],unit:'mm',timeBased:true,axisEnd:track.cum[track.count-1]!,toolNotes:notes.byLine});
 fs.writeFileSync(ev+'notes.json',JSON.stringify({stops:raw.probe_unpredicted,lengths:raw.toollen_table,events,unbound:notes.unbound,stats,rows},null,2)+'\n');
 expect(raw.toollen_table[0][1]).toBe(2);expect(raw.probe_unpredicted[0][1]).toBe(2);
 expect(rows.every(r=>r.note==='')).toBe(true);expect(notes.unbound).toHaveLength(2);
 expect(events[0]!.length).toBe(80);expect(events[1]!.length).toBeNull();expect(stats).toContain('line not known');
});

it('R106 observation: the near-integer M600 call is still falsely attributed to the later literal call',()=>{
 const {raw}=load('near_call_pair');
 const events=m600Events(parseProbeStops(raw.probe_unpredicted),raw.toollen_table,'mm');
 const stats=m600StatsText(events,'mm');
 fs.writeFileSync(ev+'caller.json',JSON.stringify({events,stats,tool_change_lines:raw.tool_change_lines},null,2)+'\n');
 expect(raw.parse_error).toBeFalsy();expect(events.map(e=>e.line)).toEqual([5,5]);
 expect(raw.tool_change_lines).toEqual([[5,2],[5,1]]);
 expect(stats).toContain('T2 80.000 mm (L5)');
});
