import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {decode} from '@msgpack/msgpack';
import {decodePreviewStreams} from '../previewDecode';
import {buildScrubTrack,lineFirstMoveCum} from './scrubTrack';
import {buildSimRows,limitStopOf} from './simRows';
it('an arc with safe endpoints does not prove a stop before its first movement',()=>{
 const raw=decode(readFileSync('../evidence/viewer-palette-fest.r98.codex-r96_arc_interior_limit.msgpack')) as Record<string,any>;
 const d=decodePreviewStreams(raw), t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 const span=lineFirstMoveCum(t,3)!;
 const at=1;
 let j=1; while(j<t.count-1 && t.cum[j]!<at) j++;
 const u=(at-t.cum[j-1]!)/(t.cum[j]!-t.cum[j-1]!);
 const positionAtOneSecond=[0,1,2].map(k=>t.pos[(j-1)*3+k]!+u*(t.pos[j*3+k]!-t.pos[(j-1)*3+k]!));
 const firstOutside=Array.from({length:t.count},(_,i)=>i).find(i=>t.pos[i*3+2]!>50)!;
 expect(positionAtOneSecond[2]).toBeLessThan(50);
 expect(t.cum[firstOutside]).toBeGreaterThan(at);
 const rows=buildSimRows({clash:[{key:'C3|head|fixed',line:3,cum:1,cumEnd:1.1,a:'head',b:'fixed',rapid:false}],
 limit:[{key:'L3',line:3,cum:span[0],cumEnd:span[1]}],tool:[],violations:raw.violations,unit:'mm',timeBased:true,axisEnd:t.cum.at(-1)!,stop:limitStopOf(t)});
 writeFileSync('../evidence/viewer-palette-fest.r98.codex-limit.json',JSON.stringify({violations:raw.violations,positionAtOneSecond,firstOutsideTime:t.cum[firstOutside],firstArcPoint:Array.from(t.pos.slice(3,6)),lastArcPoint:Array.from(t.pos.slice(-3)),span,rows},null,2)+'\n');
 expect(rows.find(r=>r.kind==='clash')!.note).not.toContain('after the limit stop');
});
