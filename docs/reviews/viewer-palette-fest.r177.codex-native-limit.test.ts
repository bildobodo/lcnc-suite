import fs from 'node:fs';
import {it,expect} from 'vitest';
import {decode} from '@msgpack/msgpack';
import {decodePreviewStreams} from '../previewDecode';
import {buildScrubTrack,displayLineOf,lineFirstMoveCum,programLineFirstMoveCum,programLineSpanCum} from './scrubTrack';
it('Codex R177: the native foreign limit remains on its violating motion, not a safe main-file namesake',()=>{
 const raw=decode(fs.readFileSync('/tmp/codex-r177-1dohjpbu/native-marked.msgpack')) as any;
 const d=decodePreviewStreams(raw);
 const t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents,undefined,d.startBelieved,d.startUnbound)!;
 const v=raw.violations[0]; const fromRaw=lineFirstMoveCum(t,v.line),move=programLineFirstMoveCum(t,v.line,t,!raw.lines_untrusted),span=programLineSpanCum(t,v.line,t,!raw.lines_untrusted);
 const points=Array.from({length:t.count},(_,i)=>({i,raw:t.lines[i],shown:displayLineOf(t,i,!raw.lines_untrusted),cum:t.cum[i],x:t.pos[3*i],outside:t.outside?.[i]}));
 fs.writeFileSync('/tmp/codex-r177-1dohjpbu/native-track.json',JSON.stringify({violation:v,fromRaw,move,span,points},null,2));
 expect(raw.parse_error).toBeFalsy();expect(v).toMatchObject({line:5,value:600,limit:500});
 const hit=points.find(p=>p.outside===1)!;expect(hit.shown).toBe(3);
 expect(move,'the limit belongs to the foreign move whose displayed line is the call at L3').toEqual([t.cum[hit.i-1],t.cum[hit.i]]);
});
