// Independent R457 assertions against the actual decoder/binding path.
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from '@msgpack/msgpack';
import { it, expect, afterAll } from 'vitest';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, buildEntryTrack } from './scrubTrack';
import { epochTermsFor } from './wcsEpochs';
import { programToMachine } from './partFrame';
import { tloForIndex } from './tloEvents';
const DIR='/tmp/r459/out';
const meta=JSON.parse(readFileSync(`${DIR}/meta.json`,'utf8'));
const rows:any[]=[];
const noEntry=new Set(['comp_next_xyz_g55','arc_first_g55','tap_first_g55','cx_comp_g40','cx_cycle_g55']);
function observe(name:string, mode:string, away:boolean) {
 const m=meta[name], r:any=decode(readFileSync(`${DIR}/${name}.${mode}.msgpack`));
 const d=decodePreviewStreams(r);
 const base=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents,d.rotaryCmd,d.startBelieved,d.startUnbound)!;
 expect(base).toBeTruthy();
 const off=m.units==='in'?[.5,-.7,.3]:[13,-17,7];
 const P=m.P.map((v:number,k:number)=>v+(away?off[k]:0));
 // Live G54 before program start: these 21 cases have no stored rotation/G92.
 // The payload need not record an unused G54 epoch (a G55-first program).
 const wcs:any={g5x:[...m.P,0,0,0],g92:[0,0,0,0,0,0],rotationDeg:0,tool:r.tlo_start??[0,0,0]};
 const terms=epochTermsFor(d.wcsEvents!,wcs,undefined);
 const entry=buildEntryTrack(base,[...P,...(m.axes.length===4?[0]:[])],m.axes,wcs,undefined,terms,0,
 {linear:r.rapid_rate,rotary:r.rot_rapid_rate,axisVmax:r.axis_vmax,trajVmax:r.traj_vmax});
 const tip:number[]=[];
 if(entry) programToMachine(entry.pos[3]!,entry.pos[4]!,entry.pos[5]!,entry.abc[3]??0,entry.abc[4]??0,entry.abc[5]??0,terms[entry.wcsEpoch![1]!]!,tip);
 const tlo=entry?tloForIndex(entry.tlo?.[1],entry.tloEvents,wcs.tool):[0,0,0];
 const joint=entry?tip.slice(0,3).map((v,k)=>v+tlo[k]!):null;
 const want=P.map((v:number,k:number)=>name==='cx_m61_g91'?(v+(k===1?4:0)):m.cmd.includes(k)?m.first?.[k]:v);
 const observation={name,mode,away,believed:r.start_believed??null,unbound:d.startUnbound??null,live:P,joint,want};
 rows.push(observation);
 return observation;
}
for(const name of Object.keys(meta)) for(const away of [false,true]) {
 it(`${name} at ${away?'Q':'P'}`,()=>{
  const now=observe(name,'head',away);
  if(noEntry.has(name)) {
   expect(now.joint).toBeNull();
   expect(now.unbound?.length).toBeGreaterThan(0);
   if(name.includes('comp')) {expect(now.believed).toBeNull();expect(now.unbound).toEqual([0,1,2]);}
  } else {
   expect(now.joint).not.toBeNull();
   now.want.forEach((v:number,k:number)=>{expect(Number.isFinite(v)).toBe(true);expect(now.joint![k]).toBeCloseTo(v,3)});
  }
 });
}
afterAll(()=>writeFileSync('/tmp/r459/client-observations.json',JSON.stringify(rows,null,2)));
