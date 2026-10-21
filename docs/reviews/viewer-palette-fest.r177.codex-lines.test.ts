import fs from 'node:fs';
import {it,expect} from 'vitest';
import {buildScrubTrack,programLineFirstMoveCum,programLineSpanCum,displayLineOf} from './scrubTrack';
const samples:any[]=[];
for(const legacy of [false,true])it(`Codex R177: a program line without a trustworthy location is not placed at a foreign raw number (${legacy?'legacy':'explicit provenance'})`,()=>{
 const t=buildScrubTrack({pos:new Float32Array()}, {pos:Float32Array.from([0,0,0, 10,0,0, 20,0,0, 30,0,0]),lines:Uint32Array.from([1,5,6,3]),seq:Uint32Array.from([1,2,3,4]),tcum:Float32Array.from([0,4,8,12])})!;
 if(!legacy){t.lineOk=Uint8Array.from([1,0,0,1]);t.cline=Uint16Array.from([0,2,2,0]);}
 const display=Array.from({length:t.count},(_,i)=>displayLineOf(t,i,false));
 const move=programLineFirstMoveCum(t,5,t,false),span=programLineSpanCum(t,5,t,false);
 samples.push({legacy,raw:Array.from(t.lines),display,move,span});
 fs.writeFileSync('/tmp/codex-r177-1dohjpbu/lines.json',JSON.stringify(samples,null,2));
 expect(display).not.toContain(5);
 expect(move,'no known location for program L5').toBeNull();
 expect(span,'no band on the called file\'s move').toBeNull();
});
