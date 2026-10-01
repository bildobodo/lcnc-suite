import {test,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {decodePreviewStreams,normalizeToToolBasis} from './previewDecode';
import {buildScrubTrack} from './viewer/scrubTrack';
import {liftToJoints,wcsTerms,tipWcs} from './viewer/partFrame';
import {tloForIndex} from './viewer/tloEvents';

test('R58 native subprogram: only a leading blank changes the reconstructed joint pose',()=>{
  const outputs:any[]=[];
  for (const name of ['percent_line1','percent_line2']) {
    const raw=JSON.parse(readFileSync('../evidence/viewer-palette-fest.r58.payloads.json','utf8'))[name];
    const wire=Object.fromEntries(Object.entries(raw).map(([k,v]:any)=>
      [k,v?.bytes_b64 ? Uint8Array.from(Buffer.from(v.bytes_b64,'base64')) : v]));
    const d=decodePreviewStreams(wire);
    const basis=normalizeToToolBasis(d,raw.tlo_start,null)!;
    const track=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
    const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0,tool:basis};
    const joints=[];
    for(let i=0;i<track.count;i++) {
      const j:number[]=[];
      liftToJoints(track.pos[3*i]!,track.pos[3*i+1]!,track.pos[3*i+2]!,0,0,0,
        wcsTerms(tipWcs(wcs)),tloForIndex(track.tlo?.[i],track.tloEvents,basis),j);
      joints.push(j);
    }
    outputs.push({name,tlo:raw.tlo_events,joints});
  }
  writeFileSync('../evidence/viewer-palette-fest.r58.consumers.json',JSON.stringify(outputs,null,2)+'\n');
  expect(outputs[0].joints.map((j:number[])=>j[2])).toEqual([10,20,20]);
  expect(outputs[1].joints.map((j:number[])=>j[2])).toEqual([10,10,10]);
});
