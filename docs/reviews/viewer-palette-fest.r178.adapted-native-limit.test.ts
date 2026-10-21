// Codex R177's native probe (viewer-palette-fest.r177.codex-native-limit.test.ts), adapted to the
// head: the helpers it asked (programLineFirstMoveCum / programLineSpanCum) are gone; the same
// statements through limitPlaces on the payload his own case produces with the new worker.
import fs from 'node:fs';
import {it,expect} from 'vitest';
import {decode} from '@msgpack/msgpack';
import {decodePreviewStreams} from '../previewDecode';
import {buildScrubTrack,displayLineOf} from './scrubTrack';
import {limitPlaces} from './limitPlaces';
const OUT=process.env.R178_OUT!;
it('Codex R177: the native foreign limit remains on its violating motion, not a safe main-file namesake',()=>{
 const raw=decode(fs.readFileSync(`${OUT}/native-marked.msgpack`)) as any;
 const d=decodePreviewStreams(raw);
 const t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents,undefined,d.startBelieved,d.startUnbound)!;
 const v=raw.violations[0];const p=limitPlaces(raw.violations,t,t,!raw.lines_untrusted);
 const points=Array.from({length:t.count},(_,i)=>({i,raw:t.lines[i],shown:displayLineOf(t,i,!raw.lines_untrusted),cum:t.cum[i],x:t.pos[3*i],outside:t.outside?.[i]}));
 fs.writeFileSync(`${OUT}/native-track.json`,JSON.stringify({violation:v,targets:p.targets,bands:p.bands,points},null,2));
 expect(raw.parse_error).toBeFalsy();expect(v).toMatchObject({line:5,value:600,limit:500,sub:'r177_child',site:3});
 const hit=points.find(q=>q.outside===1)!;expect(hit.shown).toBe(3);
 expect(p.targets.map(x=>[x.line,x.cum,x.cumEnd]),'the limit belongs to the foreign move whose displayed line is the call at L3').toEqual([[3,t.cum[hit.i-1],t.cum[hit.i]]]);
 expect(p.bands,'its band is that move — none on the safe main L5').toEqual([[t.cum[hit.i-1],t.cum[hit.i]]]);
});
