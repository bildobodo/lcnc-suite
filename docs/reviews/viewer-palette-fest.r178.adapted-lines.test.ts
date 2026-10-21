// Codex R177's lines probe (viewer-palette-fest.r177.codex-lines.test.ts), adapted: a record of
// program L5 without a bound stretch is placed nowhere — no target, no band — on both tracks.
import fs from 'node:fs';
import {it,expect} from 'vitest';
import {buildScrubTrack,displayLineOf} from './scrubTrack';
import {limitPlaces} from './limitPlaces';
const OUT=process.env.R178_OUT!;
const samples:any[]=[];
for(const legacy of [false,true])it(`Codex R177: a program line without a trustworthy location is not placed at a foreign raw number (${legacy?'legacy':'explicit provenance'})`,()=>{
 const t=buildScrubTrack({pos:new Float32Array()}, {pos:Float32Array.from([0,0,0, 10,0,0, 20,0,0, 30,0,0]),lines:Uint32Array.from([1,5,6,3]),seq:Uint32Array.from([1,2,3,4]),tcum:Float32Array.from([0,4,8,12])})!;
 if(!legacy){t.lineOk=Uint8Array.from([1,0,0,1]);t.cline=Uint16Array.from([0,2,2,0]);}
 const display=Array.from({length:t.count},(_,i)=>displayLineOf(t,i,false));
 const p=limitPlaces([{line:5,axis:'X',value:600,limit:500,kind:'max'}],t,t,false);
 samples.push({legacy,raw:Array.from(t.lines),display,targets:p.targets,bands:p.bands,placeless:p.placeless.length});
 fs.writeFileSync(`${OUT}/lines.json`,JSON.stringify(samples,null,2));
 expect(display).not.toContain(5);
 expect(p.targets,'no known location for program L5').toEqual([]);
 expect(p.bands,'no band on the called file\'s move').toEqual([]);
 expect(p.placeless).toHaveLength(1);
});
